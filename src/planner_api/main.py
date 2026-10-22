"""FastAPI app. Orchestration only: every recommended number comes from `reorder` (the engine)."""
from __future__ import annotations

import logging
from datetime import date, datetime
from pathlib import PurePath
from typing import Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from reorder import run_plan
from reorder.config import load_config, load_config_text, rulebook_version
from reorder.io import OPTIONAL_FILES, REQUIRED_FILES
from reorder.output import plan_csv, plan_xlsx, run_log

from . import po_docs, reasoning
from .db import PO, AuditLog, Decision, Explanation, InputFileRec, PlanLine, POLine, Run, audit, get_session
from .settings import get_settings

log = logging.getLogger("planner_api")
app = FastAPI(title="Freshroots Reorder Planner API", version="1.1.0")

Role = Literal["raghav", "procurement"]
USERS = {"raghav": "Raghav Kulkarni", "procurement": "Procurement"}
DECISIONS = ("APPROVE", "CHANGE", "REJECT", "HOLD")
OVERRIDE_DECISIONS = ("CHANGE", "REJECT", "HOLD")
PO_STATUSES = ("Generated", "Downloaded", "Entered in Zoho")


# ---------- roles ----------

def current_role(x_role: str | None = Header(default=None)) -> str:
    if x_role not in USERS:
        raise HTTPException(401, "Sign in as Raghav or Procurement (X-Role header)")
    return x_role


def require(*roles: str):
    def dep(role: str = Depends(current_role)) -> str:
        if role not in roles:
            raise HTTPException(403, f"This action is limited to: {', '.join(USERS[r] for r in roles)}")
        return role
    return dep


# ---------- helpers ----------

def local_ts(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    s = get_settings()
    return dt.astimezone(s.timezone).strftime("%Y-%m-%d %H:%M %Z")


def get_run(s: Session, run_id: int) -> Run:
    run = s.get(Run, run_id)
    if run is None:
        raise HTTPException(404, f"Run {run_id} not found")
    return run


def decisions_for(s: Session, run_id: int) -> dict[str, Decision]:
    return {d.sku_id: d for d in s.scalars(select(Decision).where(Decision.run_id == run_id))}


def override_rate(lines: list[PlanLine], decs: dict[str, Decision]) -> float | None:
    if not lines:
        return None
    n = sum(1 for l in lines if l.sku_id in decs and decs[l.sku_id].decision in OVERRIDE_DECISIONS)
    return n / len(lines)


def run_brief(s: Session, run: Run) -> dict:
    decs = decisions_for(s, run.id)
    lines = run.lines
    return {
        "id": run.id,
        "created_at": run.created_at.isoformat(),
        "created_at_local": local_ts(run.created_at),
        "created_by": run.created_by,
        "run_date": run.run_date,
        "status": run.status,
        "order_month": run.order_month,
        "summary": run.summary,
        "rulebook_version": run.rulebook_version,
        "config_sha256": run.config_sha256,
        "decided": len(decs),
        "sku_count": len(lines),
        "override_rate": override_rate(lines, decs),
        "finalised_at": run.finalised_at.isoformat() if run.finalised_at else None,
        "finalised_at_local": local_ts(run.finalised_at),
        "finalised_by": run.finalised_by,
    }


def decision_dict(d: Decision | None) -> dict | None:
    if d is None:
        return None
    return {"decision": d.decision, "final_qty": d.final_qty, "note": d.note, "decided_by": d.decided_by,
            "decided_at": d.decided_at.isoformat(), "decided_at_local": local_ts(d.decided_at)}


def regenerate(run: Run):
    """Re-run the engine from stored inputs + stored config (deterministic)."""
    files = {f.name: f.content for f in run.files}
    return run_plan(files, load_config_text(run.config_text), date.fromisoformat(run.run_date))


# ---------- endpoints ----------

@app.get("/api/health")
def health():
    s = get_settings()
    return {"ok": True, "gemini_configured": bool(s.gemini_api_key), "gemini_model": s.gemini_model,
            "zoho_sync_enabled": s.zoho_sync_enabled}


@app.get("/api/config")
def config_info():
    s = get_settings()
    cfg = load_config(s.config_path)
    return {"config_text": cfg["_text"], "config_sha256": cfg["_sha256"],
            "rulebook_version": rulebook_version(s.rulebook_path),
            "required_files": list(REQUIRED_FILES), "optional_files": list(OPTIONAL_FILES)}


@app.post("/api/runs")
async def create_run(
    files: list[UploadFile] = File(...),
    run_date: str | None = Form(default=None),
    role: str = Depends(require("raghav")),
    s: Session = Depends(get_session),
):
    st = get_settings()
    today = datetime.now(st.timezone).date()
    try:
        rd = date.fromisoformat(run_date) if run_date else today
    except ValueError:
        raise HTTPException(400, "run_date must be YYYY-MM-DD")
    raw: dict[str, bytes] = {}
    for f in files:
        name = PurePath(f.filename or "").name
        raw[name] = await f.read()
    cfg = load_config(st.config_path)
    res = run_plan(raw, cfg, rd)
    known = set(REQUIRED_FILES) | set(OPTIONAL_FILES)
    ignored = sorted(set(raw) - known)
    if ignored:
        res.warnings.append(f"Ignored unrecognised files: {', '.join(ignored)}")

    validation = {"checks": res.validation.checks, "errors": res.validation.errors, "warnings": res.warnings,
                  "pre_send": res.checks, "pre_send_messages": res.check_messages}
    run = Run(
        created_by=USERS[role], run_date=rd.isoformat(), status="failed" if res.fatal else "draft",
        order_month=res.summary.get("order_month") if not res.fatal else None,
        config_text=cfg["_text"], config_sha256=cfg["_sha256"],
        rulebook_version=rulebook_version(st.rulebook_path),
        summary=res.summary or None, validation=validation, run_log=run_log(res),
    )
    s.add(run)
    s.flush()
    for name in sorted(raw):
        if name in known:
            pf = res.files[name]
            s.add(InputFileRec(run_id=run.id, name=name, sha256=pf.sha256, row_count=pf.row_count, content=raw[name]))
    if not res.fatal:
        for r in res.rows:
            ex = res.extras[r["sku_id"]]
            s.add(PlanLine(run_id=run.id, sku_id=r["sku_id"], status=r["status"], action=r["action"],
                           order_qty_now=r["order_qty_now"], needs_review=bool(r["needs_raghav_review"]),
                           distributor_id=ex["distributor_id"], row=r, extra=ex))
    audit(s, USERS[role], "run.create", run.id, f"run:{run.id}", None,
          {"status": run.status, "run_date": run.run_date, "run_date_overridden": rd != today,
           "files": {n: res.files[n].sha256 for n in sorted(raw) if n in known}, "summary": res.summary or None})
    s.commit()
    body = {"run_id": run.id, "status": run.status, "validation": validation, "summary": res.summary or None}
    if res.fatal:
        return JSONResponse(status_code=422, content=body)
    return body


@app.get("/api/runs")
def list_runs(role: str = Depends(current_role), s: Session = Depends(get_session)):
    runs = s.scalars(select(Run).order_by(Run.id.desc())).all()
    return [run_brief(s, r) for r in runs]


@app.get("/api/runs/latest")
def latest_run(role: str = Depends(current_role), s: Session = Depends(get_session)):
    run = s.scalars(select(Run).where(Run.status != "failed").order_by(Run.id.desc()).limit(1)).first()
    return run_brief(s, run) if run else None


@app.get("/api/runs/{run_id}")
def run_detail(run_id: int, role: str = Depends(current_role), s: Session = Depends(get_session)):
    run = get_run(s, run_id)
    decs = decisions_for(s, run_id)
    exps = {e.sku_id: e for e in s.scalars(select(Explanation).where(Explanation.run_id == run_id))}
    lines = []
    for l in run.lines:
        e = exps.get(l.sku_id)
        lines.append({
            **l.row, **{k: v for k, v in l.extra.items()},
            "decision": decision_dict(decs.get(l.sku_id)),
            "explanation": None if e is None else {"summary": e.summary, "why": e.why,
                                                   "what_to_check": e.what_to_check, "source": e.source},
        })
    return {**run_brief(s, run), "validation": run.validation, "lines": lines,
            "procurement_note": run.procurement_note, "procurement_note_source": run.procurement_note_source,
            "files": [{"name": f.name, "sha256": f.sha256, "rows": f.row_count} for f in run.files],
            "config_text": run.config_text}


@app.post("/api/runs/{run_id}/explain")
def explain(run_id: int, role: str = Depends(current_role), s: Session = Depends(get_session)):
    """Generate AI explanations once per run + SKU; later calls return the cache."""
    run = get_run(s, run_id)
    if run.status == "failed":
        raise HTTPException(409, "Failed runs have no plan to explain")
    have = {e.sku_id for e in s.scalars(select(Explanation).where(Explanation.run_id == run_id))}
    missing = [l for l in run.lines if l.sku_id not in have]
    if missing or run.procurement_note is None:
        st = get_settings()
        rows = [l.row for l in run.lines]
        extras = {l.sku_id: l.extra for l in run.lines}
        out, (note, note_src) = reasoning.explain_run(
            rows, extras, run.summary, load_config_text(run.config_text),
            api_key=st.gemini_api_key, model=st.gemini_model,
        )
        for l in missing:
            x = out[l.sku_id]
            s.add(Explanation(run_id=run_id, sku_id=l.sku_id, summary=x["summary"], why=x["why"],
                              what_to_check=x["what_to_check"], source=x["source"]))
        if run.procurement_note is None:
            run.procurement_note, run.procurement_note_source = note, note_src
        s.commit()
    exps = s.scalars(select(Explanation).where(Explanation.run_id == run_id)).all()
    return {"explanations": {e.sku_id: {"summary": e.summary, "why": e.why, "what_to_check": e.what_to_check,
                                        "source": e.source} for e in exps},
            "procurement_note": run.procurement_note, "procurement_note_source": run.procurement_note_source}


class DecisionIn(BaseModel):
    sku_id: str
    decision: Literal["APPROVE", "CHANGE", "REJECT", "HOLD"]
    final_qty: int | None = None
    note: str | None = None


class DecisionsIn(BaseModel):
    decisions: list[DecisionIn] = []
    approve_all_unflagged: bool = False


@app.post("/api/runs/{run_id}/decisions")
def save_decisions(run_id: int, body: DecisionsIn, role: str = Depends(require("raghav")),
                   s: Session = Depends(get_session)):
    run = get_run(s, run_id)
    if run.status != "draft":
        raise HTTPException(409, f"Run {run_id} is {run.status}; decisions are locked")
    lines = {l.sku_id: l for l in run.lines}
    decs = decisions_for(s, run_id)
    items = list(body.decisions)
    if body.approve_all_unflagged:
        explicit = {d.sku_id for d in items}
        items += [DecisionIn(sku_id=sid, decision="APPROVE") for sid, l in lines.items()
                  if not l.needs_review and sid not in explicit and sid not in decs]
    errors = []
    for d in items:
        line = lines.get(d.sku_id)
        if line is None:
            errors.append(f"{d.sku_id}: not in this run")
            continue
        note = (d.note or "").strip() or None
        if d.decision == "APPROVE":
            qty = line.order_qty_now  # Expert accepts the engine's quantity
        elif d.decision == "CHANGE":
            if d.final_qty is None or d.final_qty < 0:
                errors.append(f"{d.sku_id}: CHANGE needs a final quantity (integer >= 0)")
                continue
            if not note:
                errors.append(f"{d.sku_id}: CHANGE needs a note")
                continue
            qty = d.final_qty
        else:  # REJECT / HOLD
            if not note:
                errors.append(f"{d.sku_id}: {d.decision} needs a note")
                continue
            qty = 0
        if errors:
            continue
        prev = decs.get(d.sku_id)
        before = decision_dict(prev)
        if prev is None:
            prev = Decision(run_id=run_id, sku_id=d.sku_id, decision=d.decision, final_qty=qty, note=note,
                            decided_by=USERS[role])
            s.add(prev)
            decs[d.sku_id] = prev
        else:
            prev.decision, prev.final_qty, prev.note = d.decision, qty, note
            prev.decided_by = USERS[role]
            prev.decided_at = datetime.now(get_settings().timezone)
        audit(s, USERS[role], "decision.save", run_id, f"sku:{d.sku_id}", before,
              {"decision": d.decision, "final_qty": qty, "note": note, "engine_qty": line.order_qty_now})
    if errors:
        s.rollback()
        raise HTTPException(422, {"errors": errors})
    s.commit()
    return run_brief(s, run)


@app.post("/api/runs/{run_id}/finalise")
def finalise(run_id: int, role: str = Depends(require("raghav")), s: Session = Depends(get_session)):
    run = get_run(s, run_id)
    if run.status != "draft":
        raise HTTPException(409, f"Run {run_id} is {run.status}")
    decs = decisions_for(s, run_id)
    undecided = [l.sku_id for l in run.lines if l.sku_id not in decs]
    if undecided:
        raise HTTPException(409, {"errors": [f"Every SKU needs a decision. Missing: {', '.join(undecided)}"]})
    st = get_settings()
    now = datetime.now(st.timezone)
    run.status = "final"
    run.finalised_at = now
    run.finalised_by = USERS[role]
    s.flush()

    # One PO per supplier, only for lines Raghav set above 0 (hard rule 2).
    by_supplier: dict[str, list[PlanLine]] = {}
    for l in run.lines:
        if decs[l.sku_id].final_qty > 0:
            by_supplier.setdefault(l.distributor_id, []).append(l)
    stamp = now.strftime("%Y%m%d")
    created = []
    for dist_id in sorted(by_supplier):
        lines = by_supplier[dist_id]
        prefix = f"FR-PO-{stamp}-{dist_id}-"
        seq = s.scalar(select(func.count()).select_from(PO).where(PO.po_number.like(prefix + "%"))) + 1
        first = lines[0]
        po = PO(run_id=run_id, po_number=f"{prefix}{seq:03d}", distributor_id=dist_id,
                supplier_name=first.row["supplier_name"], supplier_region=first.extra.get("supplier_region", ""),
                po_date=now.date().isoformat(), status="Generated",
                total_qty=sum(decs[l.sku_id].final_qty for l in lines))
        for l in lines:
            d = decs[l.sku_id]
            po.lines.append(POLine(sku_id=l.sku_id, sku_name=l.row["sku_name"], uom=l.extra["uom"],
                                   quantity=d.final_qty, decision_source=d.decision, engine_qty=l.order_qty_now))
        s.add(po)
        created.append(po)
    s.flush()
    audit(s, USERS[role], "run.finalise", run_id, f"run:{run_id}", {"status": "draft"},
          {"status": "final", "override_rate": override_rate(run.lines, decs),
           "pos": [p.po_number for p in created]})
    s.commit()
    return {**run_brief(s, run), "pos": [po_dict(p) for p in created]}


def po_dict(p: PO) -> dict:
    return {"id": p.id, "run_id": p.run_id, "po_number": p.po_number, "distributor_id": p.distributor_id,
            "supplier_name": p.supplier_name, "supplier_region": p.supplier_region, "po_date": p.po_date,
            "status": p.status, "zoho_ref": p.zoho_ref, "total_qty": p.total_qty,
            "lines": [{"sku_id": l.sku_id, "sku_name": l.sku_name, "uom": l.uom, "quantity": l.quantity,
                       "decision_source": l.decision_source, "engine_qty": l.engine_qty} for l in p.lines]}


@app.get("/api/runs/{run_id}/pos")
def list_pos(run_id: int, role: str = Depends(current_role), s: Session = Depends(get_session)):
    get_run(s, run_id)
    return [po_dict(p) for p in s.scalars(select(PO).where(PO.run_id == run_id).order_by(PO.po_number))]


def to_doc(run: Run, p: PO) -> po_docs.PODoc:
    st = get_settings()
    return po_docs.PODoc(
        po_number=p.po_number, po_date=p.po_date, run_id=run.id, order_month=run.order_month or "",
        supplier_id=p.distributor_id, supplier_name=p.supplier_name, supplier_region=p.supplier_region,
        approved_at=local_ts(run.finalised_at) or "", company_name=st.company_name,
        company_address=st.company_address,
        lines=[{"sku_id": l.sku_id, "sku_name": l.sku_name, "uom": l.uom, "quantity": l.quantity,
                "decision_source": l.decision_source} for l in p.lines],
    )


def approval_log(s: Session, run: Run) -> list[dict]:
    decs = decisions_for(s, run.id)
    out = []
    for l in run.lines:
        d = decs.get(l.sku_id)
        if d:
            out.append({"sku_id": l.sku_id, "status": l.status, "engine_qty": l.order_qty_now,
                        "decision": d.decision, "final_qty": d.final_qty, "note": d.note,
                        "decided_by": d.decided_by, "decided_at": local_ts(d.decided_at)})
    return out


MEDIA = {"pdf": "application/pdf", "csv": "text/csv",
         "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "zip": "application/zip"}


def _file(data: bytes, fmt: str, name: str) -> Response:
    return Response(data, media_type=MEDIA[fmt], headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _mark_downloaded(s: Session, pos: list[PO], role: str, fmt: str) -> None:
    for p in pos:
        if p.status == "Generated":
            audit(s, USERS[role], "po.download", p.run_id, f"po:{p.po_number}", {"status": p.status},
                  {"status": "Downloaded", "format": fmt})
            p.status = "Downloaded"
    s.commit()


@app.get("/api/pos/{po_id}/download")
def download_po(po_id: int, format: Literal["pdf", "xlsx", "csv"] = Query(...),
                role: str = Depends(current_role), s: Session = Depends(get_session)):
    p = s.get(PO, po_id)
    if p is None:
        raise HTTPException(404, "PO not found")
    run = get_run(s, p.run_id)
    doc = to_doc(run, p)
    data = {"pdf": lambda: po_docs.po_pdf([doc]), "csv": lambda: po_docs.po_csv([doc]),
            "xlsx": lambda: po_docs.po_xlsx([doc], approval_log(s, run))}[format]()
    _mark_downloaded(s, [p], role, format)
    return _file(data, format, f"{p.po_number}.{format}")


@app.get("/api/runs/{run_id}/pos/download")
def download_run_pos(run_id: int, format: Literal["pdf", "xlsx", "csv", "zip"] = Query(...),
                     role: str = Depends(current_role), s: Session = Depends(get_session)):
    run = get_run(s, run_id)
    if run.status != "final":
        raise HTTPException(409, "POs exist only after Raghav finalises the plan")
    pos = s.scalars(select(PO).where(PO.run_id == run_id).order_by(PO.po_number)).all()
    docs = [to_doc(run, p) for p in pos]
    alog = approval_log(s, run)
    if format == "pdf":
        data = po_docs.po_pdf(docs)
    elif format == "xlsx":
        data = po_docs.po_xlsx(docs, alog)
    elif format == "csv":
        data = po_docs.po_csv(docs)
    else:
        res = regenerate(run)
        m = run.order_month
        data = po_docs.po_zip(docs, alog, {
            f"plan/reorder_plan_{m}.csv": plan_csv(res), f"plan/reorder_plan_{m}.xlsx": plan_xlsx(res),
            f"plan/run_log_{m}.txt": run.run_log.encode(),
        })
    _mark_downloaded(s, list(pos), role, format)
    return _file(data, format, f"freshroots_pos_run{run_id}_{run.order_month}.{format}")


class POPatch(BaseModel):
    status: Literal["Entered in Zoho"]
    zoho_ref: str


@app.patch("/api/pos/{po_id}")
def patch_po(po_id: int, body: POPatch, role: str = Depends(require("procurement")),
             s: Session = Depends(get_session)):
    p = s.get(PO, po_id)
    if p is None:
        raise HTTPException(404, "PO not found")
    ref = body.zoho_ref.strip()
    if not ref:
        raise HTTPException(422, "Enter the Zoho PO reference")
    before = {"status": p.status, "zoho_ref": p.zoho_ref}
    p.status, p.zoho_ref = body.status, ref
    audit(s, USERS[role], "po.entered_in_zoho", p.run_id, f"po:{p.po_number}", before,
          {"status": p.status, "zoho_ref": ref})
    s.commit()
    return po_dict(p)


@app.get("/api/runs/{run_id}/plan")
def download_plan(run_id: int, format: Literal["csv", "xlsx", "log"] = Query(...),
                  role: str = Depends(current_role), s: Session = Depends(get_session)):
    run = get_run(s, run_id)
    if format == "log":
        return Response(run.run_log, media_type="text/plain",
                        headers={"Content-Disposition": f'attachment; filename="run_log_{run_id}.txt"'})
    if run.status == "failed":
        raise HTTPException(409, "FATAL validation failure: no plan was written")
    res = regenerate(run)
    m = run.order_month
    if format == "csv":
        return _file(plan_csv(res), "csv", f"reorder_plan_{m}.csv")
    return _file(plan_xlsx(res), "xlsx", f"reorder_plan_{m}.xlsx")


@app.get("/api/audit")
def audit_log(run_id: int | None = None, limit: int = 200, role: str = Depends(current_role),
              s: Session = Depends(get_session)):
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000))
    if run_id is not None:
        q = q.where(AuditLog.run_id == run_id)
    return [{"id": a.id, "ts": a.ts.isoformat(), "ts_local": local_ts(a.ts), "actor": a.actor, "action": a.action,
             "run_id": a.run_id, "entity": a.entity, "before": a.before, "after": a.after}
            for a in s.scalars(q)]
