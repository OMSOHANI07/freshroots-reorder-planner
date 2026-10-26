"""Concurrency and load tests (QA report sections RACE and LOAD).

  race  — against a local multi-worker API on the Neon *development* branch (writes data):
          python scripts/qa_stress.py race http://127.0.0.1:8100
  load  — read-only load on any deployment (no writes):
          python scripts/qa_stress.py load https://freshroots-reorder-planner.vercel.app
"""
from __future__ import annotations

import asyncio
import json
import statistics
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "tests" / "fixtures" / "oct_2026"
A, R, P = {"X-Role": "analyst"}, {"X-Role": "raghav"}, {"X-Role": "procurement"}


def files():
    return [("files", (f.name, f.read_bytes(), "text/csv")) for f in sorted(FIX.glob("*.csv"))]


async def new_draft(c: httpx.AsyncClient) -> int:
    r = await c.post("/api/runs", files=files(), data={"run_date": "2026-10-19"}, headers=A)
    r.raise_for_status()
    return r.json()["run_id"]


async def race(base: str) -> dict:
    out: dict = {}
    async with httpx.AsyncClient(base_url=base, timeout=120) as c:
        # RACE-1: 10 simultaneous approvals of one draft
        rid = await new_draft(c)
        rs = await asyncio.gather(*[c.post(f"/api/runs/{rid}/approve", headers=R) for _ in range(10)])
        pos = (await c.get(f"/api/runs/{rid}/pos", headers=P)).json()
        out["RACE-1 double-approve"] = {"requests": 10, "status_codes": sorted(r.status_code for r in rs),
                                        "pos_created": len(pos), "expected_pos": 3}
        # RACE-2: approve and reject at the same moment
        rid = await new_draft(c)
        ra, rr = await asyncio.gather(c.post(f"/api/runs/{rid}/approve", headers=R),
                                      c.post(f"/api/runs/{rid}/reject", headers=R, json={"note": "race"}))
        final = (await c.get(f"/api/runs/{rid}", headers=R)).json()
        pos = (await c.get(f"/api/runs/{rid}/pos", headers=P)).json()
        out["RACE-2 approve-vs-reject"] = {"approve": ra.status_code, "reject": rr.status_code,
                                          "final_status": final["status"], "pos_created": len(pos)}
        # RACE-3: 3 different plans approved at once -> PO numbers must stay unique
        rids = await asyncio.gather(*[new_draft(c) for _ in range(3)])
        rs = await asyncio.gather(*[c.post(f"/api/runs/{x}/approve", headers=R) for x in rids])
        nums = [p["po_number"] for r in rs if r.status_code == 200 for p in r.json()["pos"]]
        out["RACE-3 parallel approvals, PO numbers"] = {"status_codes": [r.status_code for r in rs],
                                                        "po_numbers": len(nums), "unique": len(set(nums))}
        # RACE-4: 15 analysts uploading at once
        t = time.perf_counter()
        ups = await asyncio.gather(*[c.post("/api/runs", files=files(), data={"run_date": "2026-10-19"}, headers=A)
                                     for _ in range(15)], return_exceptions=True)
        ok = [u for u in ups if not isinstance(u, Exception) and u.status_code == 200]
        out["RACE-4 15 parallel uploads"] = {"ok": len(ok), "errors": [str(u)[:80] if isinstance(u, Exception)
                                                                        else u.status_code for u in ups if u not in ok],
                                             "unique_run_ids": len({u.json()["run_id"] for u in ok}),
                                             "seconds": round(time.perf_counter() - t, 1)}
    return out


async def load(base: str) -> dict:
    """Read-only load: ramp concurrency over the main pages and API calls."""
    async with httpx.AsyncClient(base_url=base, timeout=60, headers=P, follow_redirects=True) as c:
        runs = (await c.get("/api/runs")).json()
        rid = next(r["id"] for r in runs if r["status"] == "final")
        targets = {"home page (HTML)": "/", "guide page (HTML)": "/guide", "GET /api/health": "/api/health",
                   "GET /api/runs": "/api/runs", f"GET /api/runs/{rid}": f"/api/runs/{rid}",
                   "GET /api/master": "/api/master", f"GET /api/runs/{rid}/pos": f"/api/runs/{rid}/pos"}
        cold = {}
        for name, path in targets.items():  # first hit each (may include cold start)
            t = time.perf_counter()
            r = await c.get(path)
            cold[name] = {"status": r.status_code, "ms": round((time.perf_counter() - t) * 1000)}
        results = {"first_hit": cold, "levels": []}
        for conc, total in ((5, 50), (20, 200), (50, 400)):
            sem = asyncio.Semaphore(conc)
            lat: dict[str, list[float]] = {k: [] for k in targets}
            errs: dict[str, int] = {k: 0 for k in targets}
            names = list(targets)

            async def one(i: int):
                name = names[i % len(names)]
                async with sem:
                    t = time.perf_counter()
                    try:
                        r = await c.get(targets[name])
                        ok = r.status_code == 200
                    except Exception:
                        ok = False
                    lat[name].append((time.perf_counter() - t) * 1000)
                    if not ok:
                        errs[name] += 1
            t0 = time.perf_counter()
            await asyncio.gather(*[one(i) for i in range(total)])
            wall = time.perf_counter() - t0
            allv = sorted(v for vs in lat.values() for v in vs)
            q = lambda vs, p: round(sorted(vs)[min(len(vs) - 1, int(len(vs) * p))]) if vs else None
            results["levels"].append({
                "concurrency": conc, "requests": total, "seconds": round(wall, 1), "req_per_sec": round(total / wall, 1),
                "errors": sum(errs.values()), "p50_ms": q(allv, .5), "p95_ms": q(allv, .95), "p99_ms": q(allv, .99),
                "per_endpoint": {k: {"p50": q(v, .5), "p95": q(v, .95), "errors": errs[k]} for k, v in lat.items()},
            })
    return results


if __name__ == "__main__":
    mode, base = sys.argv[1], sys.argv[2].rstrip("/")
    res = asyncio.run(race(base) if mode == "race" else load(base))
    print(json.dumps(res, indent=2))
    out = ROOT / "test-results" / f"qa_{mode}.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(res, indent=2))
