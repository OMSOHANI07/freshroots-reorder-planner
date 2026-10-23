"""Database models (Neon Postgres via SQLAlchemy).

Workflow tables:
  plan_runs             one row per reorder-plan run (status, summary, config used, approval)
  sap_upload_files      the raw SAP CSV files of each run, with SHA-256 (keeps runs reproducible)
  sku_plan_lines        the engine's result for each SKU in a run (the 28 RULEBOOK columns)
  sku_approvals         Raghav's approval recorded per SKU when a plan is approved
  sku_ai_explanations   Gemini / template explanation per SKU
  purchase_orders       one PO per supplier for an approved plan, with ERPNext sync status
  purchase_order_lines  the SKU lines on each PO
  audit_log             who did what, when, before and after

SAP master data (readable copies of each uploaded file, tagged with the run that uploaded it):
  sku_master, distributor_master, weekly_sales, current_inventory, festival_calendar, judgment_overrides
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import (
    JSON, Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import NullPool

from .settings import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Run(Base):
    __tablename__ = "plan_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[str] = mapped_column(String(64))
    run_date: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(16))  # failed | draft | final (approved) | rejected
    source: Mapped[str] = mapped_column(String(16), default="upload")  # upload | sap_latest
    source_run_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)  # Raghav's note on approve/reject
    order_month: Mapped[str | None] = mapped_column(String(7), nullable=True)
    config_text: Mapped[str] = mapped_column(Text)
    config_sha256: Mapped[str] = mapped_column(String(64))
    rulebook_version: Mapped[str] = mapped_column(String(64))
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    validation: Mapped[dict] = mapped_column(JSON)
    run_log: Mapped[str] = mapped_column(Text)
    procurement_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    procurement_note_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    finalised_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # approved/rejected at
    finalised_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    files: Mapped[list["InputFileRec"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    lines: Mapped[list["PlanLine"]] = relationship(back_populates="run", cascade="all, delete-orphan",
                                                   order_by="PlanLine.sku_id")


class InputFileRec(Base):
    __tablename__ = "sap_upload_files"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    sha256: Mapped[str] = mapped_column(String(64))
    row_count: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    run: Mapped[Run] = relationship(back_populates="files")


class PlanLine(Base):
    __tablename__ = "sku_plan_lines"
    __table_args__ = (UniqueConstraint("run_id", "sku_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    action: Mapped[str] = mapped_column(String(32))
    order_qty_now: Mapped[int] = mapped_column(Integer)
    needs_review: Mapped[bool] = mapped_column(Boolean)
    distributor_id: Mapped[str] = mapped_column(String(32))
    row: Mapped[dict] = mapped_column(JSON)     # the 28 RULEBOOK columns (unrounded)
    extra: Mapped[dict] = mapped_column(JSON)   # uom, history, rules fired
    run: Mapped[Run] = relationship(back_populates="lines")


class Decision(Base):
    __tablename__ = "sku_approvals"
    __table_args__ = (UniqueConstraint("run_id", "sku_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    decision: Mapped[str] = mapped_column(String(16))  # APPROVE | CHANGE | REJECT | HOLD
    final_qty: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[str] = mapped_column(String(64))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Explanation(Base):
    __tablename__ = "sku_ai_explanations"
    __table_args__ = (UniqueConstraint("run_id", "sku_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text)
    why: Mapped[str] = mapped_column(Text)
    what_to_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # gemini | template


class PO(Base):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    po_number: Mapped[str] = mapped_column(String(64), unique=True)
    distributor_id: Mapped[str] = mapped_column(String(32))
    supplier_name: Mapped[str] = mapped_column(String(128))
    supplier_region: Mapped[str] = mapped_column(String(128))
    po_date: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(32), default="Generated")
    erp_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)       # ERPNext PO name, or a manual ref
    erp_po_name: Mapped[str | None] = mapped_column(String(64), nullable=True)    # set only when created via the API
    erp_status: Mapped[str | None] = mapped_column(String(32), nullable=True)     # Draft | To Receive and Bill | ...
    erp_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    erp_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_qty: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lines: Mapped[list["POLine"]] = relationship(back_populates="po", cascade="all, delete-orphan",
                                                 order_by="POLine.sku_id")


class POLine(Base):
    __tablename__ = "purchase_order_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    sku_name: Mapped[str] = mapped_column(String(256))
    uom: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[int] = mapped_column(Integer)
    decision_source: Mapped[str] = mapped_column(String(16))  # APPROVE | CHANGE
    engine_qty: Mapped[int] = mapped_column(Integer)
    po: Mapped[PO] = relationship(back_populates="lines")


# ---------- SAP master data ----------

class SkuMaster(Base):
    __tablename__ = "sku_master"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32), index=True)
    sku_name: Mapped[str] = mapped_column(String(256))
    category: Mapped[str] = mapped_column(String(64))
    perishability: Mapped[str] = mapped_column(String(8))
    standard_reorder_qty: Mapped[int] = mapped_column(Integer)
    unit_of_measure: Mapped[str] = mapped_column(String(32))
    distributor_id: Mapped[str] = mapped_column(String(32))


class DistributorMaster(Base):
    __tablename__ = "distributor_master"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    distributor_id: Mapped[str] = mapped_column(String(32))
    distributor_name: Mapped[str] = mapped_column(String(128))
    region: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32))


class WeeklySales(Base):
    __tablename__ = "weekly_sales"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32), index=True)
    week: Mapped[str] = mapped_column(String(8))
    units_sold: Mapped[int] = mapped_column(Integer)


class CurrentInventory(Base):
    __tablename__ = "current_inventory"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    location: Mapped[str] = mapped_column(String(128))
    units_on_hand: Mapped[int] = mapped_column(Integer)
    as_of_date: Mapped[str] = mapped_column(String(10))


class FestivalCalendar(Base):
    __tablename__ = "festival_calendar"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    year_month: Mapped[str] = mapped_column(String(7))
    is_festival_month: Mapped[bool] = mapped_column(Boolean)


class JudgmentOverride(Base):
    __tablename__ = "judgment_overrides"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("plan_runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    reason: Mapped[str] = mapped_column(Text)
    entered_by: Mapped[str] = mapped_column(String(64))
    valid_until: Mapped[str] = mapped_column(String(10))


def store_master_data(s: Session, run_id: int, files: dict[str, bytes]) -> None:
    """Copy a validated SAP upload into the readable master-data tables."""
    from reorder.io import parse_csv

    def rows(name: str):
        if name not in files:
            return []
        f = parse_csv(name, files[name])
        return [] if f.frame is None else f.frame.to_dict("records")

    for r in rows("sku_master.csv"):
        s.add(SkuMaster(run_id=run_id, sku_id=r["SKU_ID"], sku_name=r["SKU_Name"], category=r["Category"],
                        perishability=r["Perishability"], standard_reorder_qty=int(r["Standard_Reorder_Qty"]),
                        unit_of_measure=r["Unit_of_Measure"], distributor_id=r["Distributor_ID"]))
    for r in rows("distributor_master.csv"):
        s.add(DistributorMaster(run_id=run_id, distributor_id=r["Distributor_ID"], distributor_name=r["Distributor_Name"],
                                region=r["Region"], status=r["Status"]))
    for r in rows("weekly_sales.csv"):
        s.add(WeeklySales(run_id=run_id, sku_id=r["SKU_ID"], week=r["Week"], units_sold=int(r["Units_Sold"])))
    for r in rows("current_inventory.csv"):
        s.add(CurrentInventory(run_id=run_id, sku_id=r["SKU_ID"], location=r["Location"],
                               units_on_hand=int(r["Units_On_Hand"]), as_of_date=r["As_Of_Date"]))
    for r in rows("calendar.csv"):
        s.add(FestivalCalendar(run_id=run_id, year=int(r["Year"]), month=int(r["Month"]), year_month=r["Year_Month"],
                               is_festival_month=r["Is_Festival_Month"].upper() == "TRUE"))
    for r in rows("judgment_overrides.csv"):
        s.add(JudgmentOverride(run_id=run_id, sku_id=r["SKU_ID"], reason=r["Reason"], entered_by=r["Entered_By"],
                               valid_until=r["Valid_Until"]))


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    run_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    entity: Mapped[str | None] = mapped_column(String(128), nullable=True)
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)


_engine = None
_Session: sessionmaker | None = None


def _sqlalchemy_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://"):]
    return url


def init_engine(url: str | None = None) -> None:
    """Create the engine once per process; serverless-friendly (no pool kept open)."""
    global _engine, _Session
    url = _sqlalchemy_url(url or get_settings().database_url)
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    kwargs: dict = {}
    if url.startswith("postgresql"):
        # Neon's pooler runs PgBouncer in transaction mode: disable server-side prepared statements.
        kwargs = {"poolclass": NullPool, "connect_args": {"prepare_threshold": None}}
    _engine = create_engine(url, **kwargs)
    if url.startswith("postgresql"):
        _rename_tables(_engine)
    Base.metadata.create_all(_engine)
    if url.startswith("postgresql"):
        _rename_columns(_engine)
        _add_columns(_engine)
    _Session = sessionmaker(bind=_engine, expire_on_commit=False)
    _backfill_master_data()


# v2.0 table names (old name -> new name); renamed in place so no data moves.
RENAMES = [
    ("runs", "plan_runs"), ("input_files", "sap_upload_files"), ("plan_lines", "sku_plan_lines"),
    ("decisions", "sku_approvals"), ("explanations", "sku_ai_explanations"), ("pos", "purchase_orders"),
    ("po_lines", "purchase_order_lines"),
]

# v2.1: the PO system moved from Zoho to ERPNext (table, old column -> new column).
COLUMN_RENAMES = [
    ("purchase_orders", "zoho_ref", "erp_ref"), ("purchase_orders", "zoho_po_id", "erp_po_name"),
    ("purchase_orders", "zoho_status", "erp_status"), ("purchase_orders", "zoho_error", "erp_error"),
    ("purchase_orders", "zoho_synced_at", "erp_synced_at"),
]
STATUS_RENAMES = [("Entered in Zoho", "Entered in ERPNext"), ("Zoho sync failed", "ERPNext sync failed")]

# Columns added after v1.1; create_all doesn't alter existing tables.
ADD_COLUMNS = [
    "ALTER TABLE plan_runs ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'upload'",
    "ALTER TABLE plan_runs ADD COLUMN IF NOT EXISTS source_run_id INTEGER",
    "ALTER TABLE plan_runs ADD COLUMN IF NOT EXISTS review_note TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_ref VARCHAR(128)",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_po_name VARCHAR(64)",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_status VARCHAR(32)",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_error TEXT",
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS erp_synced_at TIMESTAMPTZ",
]


def _rename_tables(engine) -> None:
    from sqlalchemy import inspect, text

    existing = set(inspect(engine).get_table_names())
    with engine.begin() as c:
        for old, new in RENAMES:
            if old in existing and new not in existing:
                c.execute(text(f'ALTER TABLE "{old}" RENAME TO "{new}"'))


def _rename_columns(engine) -> None:
    from sqlalchemy import inspect, text

    cols = {c["name"] for c in inspect(engine).get_columns("purchase_orders")}
    with engine.begin() as c:
        for table, old, new in COLUMN_RENAMES:
            if old in cols and new not in cols:
                c.execute(text(f'ALTER TABLE "{table}" RENAME COLUMN "{old}" TO "{new}"'))
        for old, new in STATUS_RENAMES:
            c.execute(text("UPDATE purchase_orders SET status = :new WHERE status = :old"), {"old": old, "new": new})


def _add_columns(engine) -> None:
    from sqlalchemy import text

    with engine.begin() as c:
        for stmt in ADD_COLUMNS:
            c.execute(text(stmt))


def _backfill_master_data() -> None:
    """Fill the master-data tables for uploads made before they existed (one-off, cheap check)."""
    from sqlalchemy import exists, select

    with _Session() as s:
        missing = s.scalars(
            select(Run).where(Run.status != "failed", Run.source == "upload",
                              ~exists().where(SkuMaster.run_id == Run.id))
        ).all()
        for run in missing:
            store_master_data(s, run.id, {f.name: f.content for f in run.files})
        if missing:
            s.commit()


def get_session() -> Iterator[Session]:
    if _Session is None:
        init_engine()
    with _Session() as s:
        yield s


def audit(s: Session, actor: str, action: str, run_id: int | None = None, entity: str | None = None,
          before: dict | None = None, after: dict | None = None) -> None:
    s.add(AuditLog(actor=actor, action=action, run_id=run_id, entity=entity, before=before, after=after))
