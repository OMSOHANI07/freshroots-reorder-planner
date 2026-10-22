"""Database models (Neon Postgres via SQLAlchemy).

Tables: runs, input_files, plan_lines, decisions, explanations, pos, po_lines, audit_log.
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
    __tablename__ = "runs"
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
    __tablename__ = "input_files"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    sha256: Mapped[str] = mapped_column(String(64))
    row_count: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    run: Mapped[Run] = relationship(back_populates="files")


class PlanLine(Base):
    __tablename__ = "plan_lines"
    __table_args__ = (UniqueConstraint("run_id", "sku_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
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
    __tablename__ = "decisions"
    __table_args__ = (UniqueConstraint("run_id", "sku_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    decision: Mapped[str] = mapped_column(String(16))  # APPROVE | CHANGE | REJECT | HOLD
    final_qty: Mapped[int] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[str] = mapped_column(String(64))
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Explanation(Base):
    __tablename__ = "explanations"
    __table_args__ = (UniqueConstraint("run_id", "sku_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(Text)
    why: Mapped[str] = mapped_column(Text)
    what_to_check: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # gemini | template


class PO(Base):
    __tablename__ = "pos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), index=True)
    po_number: Mapped[str] = mapped_column(String(64), unique=True)
    distributor_id: Mapped[str] = mapped_column(String(32))
    supplier_name: Mapped[str] = mapped_column(String(128))
    supplier_region: Mapped[str] = mapped_column(String(128))
    po_date: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(32), default="Generated")
    zoho_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)      # Zoho PO number
    zoho_po_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    zoho_status: Mapped[str | None] = mapped_column(String(32), nullable=True)    # draft | issued (as Zoho reports)
    zoho_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    zoho_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    total_qty: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    lines: Mapped[list["POLine"]] = relationship(back_populates="po", cascade="all, delete-orphan",
                                                 order_by="POLine.sku_id")


class POLine(Base):
    __tablename__ = "po_lines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("pos.id"), index=True)
    sku_id: Mapped[str] = mapped_column(String(32))
    sku_name: Mapped[str] = mapped_column(String(256))
    uom: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[int] = mapped_column(Integer)
    decision_source: Mapped[str] = mapped_column(String(16))  # APPROVE | CHANGE
    engine_qty: Mapped[int] = mapped_column(Integer)
    po: Mapped[PO] = relationship(back_populates="lines")


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
    Base.metadata.create_all(_engine)
    if url.startswith("postgresql"):
        _migrate(_engine)
    _Session = sessionmaker(bind=_engine, expire_on_commit=False)


# Columns added after v1.1; create_all doesn't alter existing tables.
MIGRATIONS = [
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS source VARCHAR(16) DEFAULT 'upload'",
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS source_run_id INTEGER",
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS review_note TEXT",
    "ALTER TABLE pos ADD COLUMN IF NOT EXISTS zoho_po_id VARCHAR(64)",
    "ALTER TABLE pos ADD COLUMN IF NOT EXISTS zoho_status VARCHAR(32)",
    "ALTER TABLE pos ADD COLUMN IF NOT EXISTS zoho_error TEXT",
    "ALTER TABLE pos ADD COLUMN IF NOT EXISTS zoho_synced_at TIMESTAMPTZ",
]


def _migrate(engine) -> None:
    from sqlalchemy import text

    with engine.begin() as c:
        for stmt in MIGRATIONS:
            c.execute(text(stmt))


def get_session() -> Iterator[Session]:
    if _Session is None:
        init_engine()
    with _Session() as s:
        yield s


def audit(s: Session, actor: str, action: str, run_id: int | None = None, entity: str | None = None,
          before: dict | None = None, after: dict | None = None) -> None:
    s.add(AuditLog(actor=actor, action=action, run_id=run_id, entity=entity, before=before, after=after))
