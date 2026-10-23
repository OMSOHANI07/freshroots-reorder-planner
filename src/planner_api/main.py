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
from .db import (
    PO, AuditLog, CurrentInventory, Decision, DistributorMaster, Explanation, FestivalCalendar, InputFileRec,
    JudgmentOverride, PlanLine, POLine, Run, SkuMaster, WeeklySales, audit, get_session, store_master_data, utcnow,
)
from .erpnext import ERPNextClient, ERPNextConfig, ERPNextError
from .settings import get_settings

log = logging.getLogger("planner_api")
app = FastAPI(title="Freshroots Reorder Planner API", version="1.2.0")

# The Analyst runs plans, Raghav only approves or rejects the whole plan,
# approval creates the supplier POs in ERPNext (RULEBOOK Section 19).
USERS = {"analyst": "Analyst", "raghav": "Raghav Kulkarni", "procurement": "Procurement"}
PO_STATUSES = ("Generated", "Downloaded", "Entered in ERPNext", "ERPNext sync failed")


# ---------- roles ----------

def current_role(x_role: str | None = Header(default=None)) -> str:
    if x_role not in USERS:
        raise HTTPException(401, "Sign in as Analyst, Raghav or Procurement (X-Role header)")
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
        "source": run.source or "upload",
        "source_run_id": run.source_run_id,
        "review_note": run.review_note,
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
    e = ERPNextConfig.from_env()
    return {"ok": True, "gemini_configured": bool(s.gemini_api_key), "gemini_model": s.gemini_model,
            "erp_sync_enabled": e.enabled, "erp_status": e.status()}


def latest_dataset(s: Session) -> Run | None:
    """'Fetch from SAP': the most recent run whose uploaded files passed validation."""
    return s.scalars(select(Run).where(Run.status != "failed", Run.source == "upload")
                     .order_by(Run.id.desc()).limit(1)).first()


@app.get("/api/master")
def master_data(role: str = Depends(current_role), s: Session = Depends(get_session)):
    """Read-only view of the latest SAP master data (RULEBOOK Section 16 governs changes)."""
    run = latest_dataset(s)
    if run is None:
        return None
    rid = run.id
    dists = {d.distributor_id: d for d in s.scalars(select(DistributorMaster).where(DistributorMaster.run_id == rid))}
    inv = {i.sku_id: i for i in s.scalars(select(CurrentInventory).where(CurrentInventory.run_id == rid))}
    sales: dict[str, list[dict]] = {}
    for w in s.scalars(select(WeeklySales).where(WeeklySales.run_id == rid)):
        sales.setdefault(w.sku_id, []).append({"week": w.week, "units": w.units_sold})
    skus = []
    for k in s.scalars(select(SkuMaster).where(SkuMaster.run_id == rid).order_by(SkuMaster.sku_id)):
        hist = sorted(sales.get(k.sku_id, []), key=lambda h: (int(h["week"][:4]), int(h["week"][6:])))
        d = dists.get(k.distributor_id)
        skus.append({"sku_id": k.sku_id, "sku_name": k.sku_name, "category": k.category,
                     "perishability": k.perishability, "standard_reorder_qty": k.standard_reorder_qty,
                     "unit_of_measure": k.unit_of_measure, "distributor_id": k.distributor_id,
                     "supplier_name": d.distributor_name if d else "",
                     "units_on_hand": inv[k.sku_id].units_on_hand if k.sku_id in inv else None,
                     "location": inv[k.sku_id].location if k.sku_id in inv else None,
                     "sales": hist[-16:]})
    suppliers = [{"distributor_id": d.distributor_id, "distributor_name": d.distributor_name, "region": d.region,
                  "status": d.status, "sku_count": sum(1 for k in skus if k["distributor_id"] == d.distributor_id)}
                 for d in sorted(dists.values(), key=lambda d: d.distributor_id)]
    calendar = [{"year_month": c.year_month, "is_festival_month": c.is_festival_month}
                for c in s.scalars(select(FestivalCalendar).where(FestivalCalendar.run_id == rid)
                                   .order_by(FestivalCalendar.year, FestivalCalendar.month))]
    overrides = [{"sku_id": o.sku_id, "reason": o.reason, "entered_by": o.entered_by, "valid_until": o.valid_until}
                 for o in s.scalars(select(JudgmentOverride).where(JudgmentOverride.run_id == rid))]
    return {"run_id": rid, "uploaded_at_local": local_ts(run.created_at), "uploaded_by": run.created_by,
            "as_of_date": (run.summary or {}).get("as_of_date"), "skus": skus, "suppliers": suppliers,
            "calendar": calendar, "overrides": overrides}


@app.get("/api/sap/latest")
def sap_latest(role: str = Depends(current_role), s: Session = Depends(get_session)):
    run = latest_dataset(s)
    if run is None:
        return None
    return {"run_id": run.id, "uploaded_at_local": local_ts(run.created_at), "uploaded_by": run.created_by,
            "as_of_date": (run.summary or {}).get("as_of_date"), "order_month": run.order_month,
            "files": [{"name": f.name, "sha256": f.sha256, "rows": f.row_count} for f in run.files]}


@app.get("/api/config")
def config_info():
    s = get_settings()
    cfg = load_config(s.config_path)
    return {"config_text": cfg["_text"], "config_sha256": cfg["_sha256"],
            "rulebook_version": rulebook_version(s.rulebook_path),
            "required_files": list(REQUIRED_FILES), "optional_files": list(OPTIONAL_FILES)}


@app.post("/api/runs")
async def create_run(
    files: list[UploadFile] | None = File(default=None),
    run_date: str | None = Form(default=None),
    source: Literal["upload", "sap_latest"] = Form(default="upload"),
    role: str = Depends(require("analyst")),
    s: Session = Depends(get_session),
):
    st = get_settings()
    today = datetime.now(st.timezone).date()
    try:
        rd = date.fromisoformat(run_date) if run_date else today
    except ValueError:
        raise HTTPException(400, "run_date must be YYYY-MM-DD")
    raw: dict[str, bytes] = {}
    source_run = None
    if source == "sap_latest":
        source_run = latest_dataset(s)
        if source_run is None:
            raise HTTPException(409, "No SAP data has been uploaded yet. Upload the files first.")
        raw = {f.name: f.content for f in source_run.files}
    else:
        if not files:
            raise HTTPException(400, "Upload the SAP files, or choose the latest SAP data")
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
        source=source, source_run_id=source_run.id if source_run else None,
    )
    s.add(run)
    s.flush()
    for name in sorted(raw):
        if name in known:
            pf = res.files[name]
            s.add(InputFileRec(run_id=run.id, name=name, sha256=pf.sha256, row_count=pf.row_count, content=raw[name]))
    if not res.fatal and source == "upload":
        store_master_data(s, run.id, {n: b for n, b in raw.items() if n in known})
    if not res.fatal:
        for r in res.rows:
            ex = res.extras[r["sku_id"]]
            s.add(PlanLine(run_id=run.id, sku_id=r["sku_id"], status=r["status"], action=r["action"],
                           order_qty_now=r["order_qty_now"], needs_review=bool(r["needs_raghav_review"]),
                           distributor_id=ex["distributor_id"], row=r, extra=ex))
    audit(s, USERS[role], "run.create", run.id, f"run:{run.id}", None,
          {"status": run.status, "run_date": run.run_date, "run_date_overridden": rd != today,
           "source": source, "source_run_id": run.source_run_id,
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


class ReviewIn(BaseModel):
    note: str | None = None


def _require_draft(run: Run) -> None:
    if run.status != "draft":
        raise HTTPException(409, f"Run {run.id} is {run.status}; it can no longer be approved or rejected")


@app.post("/api/runs/{run_id}/approve")
def approve(run_id: int, body: ReviewIn | None = None, role: str = Depends(require("raghav")),
            s: Session = Depends(get_session)):
    """Raghav approves the whole plan: lock it, raise one PO per supplier, push each PO to ERPNext."""
    run = get_run(s, run_id)
    _require_draft(run)
    st = get_settings()
    now = datetime.now(st.timezone)
    note = ((body.note if body else None) or "").strip() or None
    run.status = "final"
    run.finalised_at, run.finalised_by, run.review_note = now, USERS[role], note
    # Approval applies the engine quantity to every line (v1.2: whole-plan decision).
    for l in run.lines:
        s.add(Decision(run_id=run_id, sku_id=l.sku_id, decision="APPROVE", final_qty=l.order_qty_now,
                       note=note, decided_by=USERS[role], decided_at=now))
    s.flush()

    by_supplier: dict[str, list[PlanLine]] = {}
    for l in run.lines:
        if l.order_qty_now > 0:  # hard rule 2: paused, healthy and judgment-zone lines never get PO lines
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
                po_date=now.date().isoformat(), status="Generated", total_qty=sum(l.order_qty_now for l in lines))
        for l in lines:
            po.lines.append(POLine(sku_id=l.sku_id, sku_name=l.row["sku_name"], uom=l.extra["uom"],
                                   quantity=l.order_qty_now, decision_source="APPROVE", engine_qty=l.order_qty_now))
        s.add(po)
        created.append(po)
    s.flush()
    audit(s, USERS[role], "run.approve", run_id, f"run:{run_id}", {"status": "draft"},
          {"status": "final", "note": note, "pos": [p.po_number for p in created],
           "total_units": sum(p.total_qty for p in created)})
    s.commit()
    sync_to_erp(s, run, created, USERS[role])
    return {**run_brief(s, run), "pos": [po_dict(p) for p in created]}


@app.post("/api/runs/{run_id}/reject")
def reject(run_id: int, body: ReviewIn, role: str = Depends(require("raghav")), s: Session = Depends(get_session)):
    run = get_run(s, run_id)
    _require_draft(run)
    note = (body.note or "").strip()
    if not note:
        raise HTTPException(422, {"errors": ["Rejecting a plan needs a note"]})
    run.status = "rejected"
    run.finalised_at, run.finalised_by, run.review_note = datetime.now(get_settings().timezone), USERS[role], note
    audit(s, USERS[role], "run.reject", run_id, f"run:{run_id}", {"status": "draft"}, {"status": "rejected", "note": note})
    s.commit()
    return run_brief(s, run)


# ---------- ERPNext ----------

_erp_transport = None  # tests inject an httpx.MockTransport here


def sync_to_erp(s: Session, run: Run, pos: list[PO], actor: str) -> None:
    """Create each PO in ERPNext. Failures are recorded per PO and can be retried."""
    cfg = ERPNextConfig.from_env()
    if not pos:
        return
    if not cfg.ready:
        for p in pos:
            if not p.erp_po_name:
                p.erp_error = f"ERPNext not connected: {cfg.status()}"
        s.commit()
        return
    client = ERPNextClient(cfg, transport=_erp_transport)
    for p in pos:
        if p.erp_po_name:
            continue
        before = {"status": p.status, "erp_ref": p.erp_ref}
        try:
            doc = client.create_po(
                po_number=p.po_number, supplier_name=p.supplier_name, date=p.po_date,
                remarks=f"Freshroots plan {run.id} / {run.order_month}. Approved by {run.finalised_by} on "
                        f"{local_ts(run.finalised_at)}. Prices and lead times are not in the source data: "
                        f"set rates and the Required By date in ERPNext.",
                lines=[{"sku_id": l.sku_id, "quantity": l.quantity} for l in p.lines],
            )
            p.erp_po_name = str(doc.get("name") or "")
            p.erp_ref = p.erp_po_name
            p.erp_status = doc.get("status") or ("Draft" if not doc.get("docstatus") else "Submitted")
            p.erp_error = None
            p.status = "Entered in ERPNext"
            p.erp_synced_at = utcnow()
            audit(s, actor, "po.erp_created", p.run_id, f"po:{p.po_number}", before,
                  {"status": p.status, "erp_po_name": p.erp_po_name, "erp_status": p.erp_status})
        except (ERPNextError, Exception) as exc:  # network errors included; never lose the approval
            p.erp_error = str(exc)[:500]
            p.status = "ERPNext sync failed"
            audit(s, actor, "po.erp_failed", p.run_id, f"po:{p.po_number}", before,
                  {"status": p.status, "error": p.erp_error})
        s.commit()


@app.post("/api/pos/{po_id}/erp-sync")
def retry_erp(po_id: int, role: str = Depends(require("analyst", "procurement")), s: Session = Depends(get_session)):
    p = s.get(PO, po_id)
    if p is None:
        raise HTTPException(404, "PO not found")
    if p.erp_po_name:
        return po_dict(p)
    sync_to_erp(s, get_run(s, p.run_id), [p], USERS[role])
    return po_dict(p)


def erp_link(p: PO) -> str | None:
    url = ERPNextConfig.from_env().url
    return f"{url}/app/purchase-order/{p.erp_po_name}" if url and p.erp_po_name else None


def po_dict(p: PO) -> dict:
    return {"id": p.id, "run_id": p.run_id, "po_number": p.po_number, "distributor_id": p.distributor_id,
            "supplier_name": p.supplier_name, "supplier_region": p.supplier_region, "po_date": p.po_date,
            "status": p.status, "erp_ref": p.erp_ref, "erp_po_name": p.erp_po_name, "erp_status": p.erp_status,
            "erp_error": p.erp_error, "erp_url": erp_link(p), "total_qty": p.total_qty,
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
    status: Literal["Entered in ERPNext"]
    erp_ref: str


@app.patch("/api/pos/{po_id}")
def patch_po(po_id: int, body: POPatch, role: str = Depends(require("procurement")),
             s: Session = Depends(get_session)):
    """Fallback when ERPNext is unavailable: procurement records the PO entered by hand."""
    p = s.get(PO, po_id)
    if p is None:
        raise HTTPException(404, "PO not found")
    if p.erp_po_name:
        raise HTTPException(409, "This PO was created in ERPNext automatically")
    ref = body.erp_ref.strip()
    if not ref:
        raise HTTPException(422, "Enter the ERPNext PO reference")
    before = {"status": p.status, "erp_ref": p.erp_ref}
    p.status, p.erp_ref = body.status, ref
    audit(s, USERS[role], "po.entered_manually", p.run_id, f"po:{p.po_number}", before,
          {"status": p.status, "erp_ref": ref})
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
