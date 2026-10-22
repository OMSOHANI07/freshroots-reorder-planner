"""Orchestrates one run: load -> validate -> calculate -> decide -> flag -> check (RULEBOOK Section 4)."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from . import calculate as calc
from .checks import pre_send_checks
from .flags import judgment_codes, review_flags
from .io import InputFile, load_bytes
from .validate import ValidatedInputs, ValidationResult, validate, week_label

COLUMNS = [
    "sku_id", "sku_name", "category", "perishability", "supplier_name", "std_qty",
    "units_on_hand", "avg4", "avg12", "trend", "high_demand", "is_festival",
    "forward_demand", "cover_weeks", "min_weeks", "max_weeks", "status", "action",
    "order_qty_now", "next_cycle_qty", "cover_after", "shortfall_units",
    "review_flags", "review_note", "needs_raghav_review",
    "raghav_decision", "raghav_final_qty", "raghav_note",
]


@dataclass
class RunResult:
    run_date: date
    files: dict[str, InputFile]
    validation: ValidationResult
    rows: list[dict] = field(default_factory=list)      # 28 plan columns, unrounded
    extras: dict[str, dict] = field(default_factory=dict)  # per SKU: uom, supplier, history, rules fired
    summary: dict = field(default_factory=dict)
    checks: dict[str, bool] = field(default_factory=dict)
    check_messages: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    config: dict = field(default_factory=dict)

    @property
    def fatal(self) -> bool:
        return not self.validation.ok

    @property
    def for_sending(self) -> bool:
        return not self.fatal and all(self.checks.values())

    @property
    def exit_code(self) -> int:
        if self.fatal:
            return 1
        return 0 if self.for_sending else 2


def _plan_row(sku: dict, d: ValidatedInputs, cfg: dict) -> tuple[dict, dict]:
    sid = sku["sku_id"]
    sales = d.sales.get(sid, {})
    ref = d.reference_week
    on_hand = d.on_hand[sid]
    win = cfg["cover_window"][sku["perishability"]]  # RULE-5: perishable window replaces the standard one
    min_w, max_w = win["min_weeks"], win["max_weeks"]
    is_fest = bool(d.is_festival)

    history = calc.consecutive_weeks(sales, ref) if ref else 0
    w4 = calc.window(sales, ref, cfg["short_window_weeks"]) if ref else None
    w12 = calc.window(sales, ref, cfg["long_window_weeks"]) if ref else None
    avg4 = calc.mean(w4) if w4 else None                       # C1
    avg12 = calc.mean(w12) if w12 else None                    # C2
    trend = None
    if avg4 is not None and avg12 is not None:
        trend = 0.0 if avg12 == 0 else avg4 / avg12 - 1        # C3 (uplift never applied here)
    high_demand = None if trend is None else trend > cfg["high_demand_threshold"]  # C4 / RULE-1, strict
    forward = None
    if avg12 is not None:
        forward = avg12 * (1 + cfg["festival_uplift"]) if is_fest else avg12        # C6 / RULE-4
    cover = on_hand / forward if forward else None             # C7, uses avg12 never avg4

    supplier = d.distributors.get(sku["distributor_id"], {})
    row = {
        "sku_id": sid, "sku_name": sku["sku_name"], "category": sku["category"],
        "perishability": sku["perishability"], "supplier_name": supplier.get("name", ""),
        "std_qty": sku["std_qty"], "units_on_hand": on_hand,
        "avg4": avg4, "avg12": avg12, "trend": trend, "high_demand": high_demand,
        "is_festival": is_fest, "forward_demand": forward, "cover_weeks": cover,
        "min_weeks": min_w, "max_weeks": max_w,
        "raghav_decision": None, "raghav_final_qty": None, "raghav_note": None,  # C6: blank for Raghav
    }
    rules = []
    if is_fest:
        rules.append("RULE-4")
    if sku["perishability"] == "High":
        rules.append("RULE-5")

    jz = judgment_codes(history, cfg["min_history_weeks"], d.overrides.get(sid, []), forward)
    if jz:  # decision table row 0 / Section 11
        row.update({
            "status": calc.JUDGMENT_ZONE, "action": calc.RAGHAV_TO_DECIDE,
            "order_qty_now": 0, "next_cycle_qty": 0, "cover_after": None, "shortfall_units": 0,
        })
        flags = jz
    else:
        status, action = calc.decide(cover, min_w, max_w, high_demand)
        qty = 0
        nxt = 0
        mode = cfg["order_qty_rounding"]
        if action == calc.REORDER_NOW:  # RULE-2 decides whether, RULE-1 decides how much
            qty = calc.order_quantity(sku["std_qty"], cfg["high_demand_multiplier"] if high_demand else None, mode)
        elif action == calc.NEXT_ORDER_1_5X:  # C5: excluded from this run's total
            nxt = calc.order_quantity(sku["std_qty"], cfg["high_demand_multiplier"], mode)
        cover_after = (on_hand + qty) / forward
        shortfall = 0 if status == calc.OVERSTOCK_RISK else max(
            0, calc.ceil_units(min_w * forward - (on_hand + qty))
        )
        row.update({
            "status": status, "action": action, "order_qty_now": qty, "next_cycle_qty": nxt,
            "cover_after": cover_after, "shortfall_units": shortfall,
        })
        flags = review_flags(
            shortfall_units=shortfall, cover_weeks=cover, min_weeks=min_w, max_weeks=max_w,
            band=cfg["close_call_band_weeks"], high_demand=high_demand, is_festival=is_fest,
            order_qty_now=qty, cover_after=cover_after,
        )
        if status == calc.STOCKOUT_RISK:
            rules.append("RULE-2")
        if status == calc.OVERSTOCK_RISK:
            rules.append("RULE-3")
        if high_demand:
            rules.append("RULE-1")

    codes: list[str] = []
    for c, _ in flags:
        if c not in codes:
            codes.append(c)
    row["review_flags"] = ";".join(codes)
    row["review_note"] = " | ".join(n for _, n in flags)
    row["needs_raghav_review"] = bool(flags) or row["status"] == calc.JUDGMENT_ZONE

    history_weeks = sorted(sales)[-16:]
    extra = {
        "uom": sku["uom"],
        "distributor_id": sku["distributor_id"],
        "supplier_region": supplier.get("region", ""),
        "history": [{"week": week_label(w), "units": sales[w]} for w in history_weeks],
        "history_weeks": history,
        "rules_fired": rules + codes,
    }
    return row, extra


def build_summary(rows: list[dict], d: ValidatedInputs) -> dict:
    return {
        "order_month": d.order_month,
        "is_festival": bool(d.is_festival),
        "as_of_date": d.as_of.isoformat() if d.as_of else None,
        "reference_week": week_label(d.reference_week) if d.reference_week else None,
        "skus_total": len(rows),
        "reorder_now": sum(r["action"] == calc.REORDER_NOW for r in rows),
        "pause_next_order": sum(r["action"] == calc.PAUSE_NEXT_ORDER for r in rows),
        "healthy": sum(r["status"] == calc.HEALTHY for r in rows),
        "judgment_zone": sum(r["status"] == calc.JUDGMENT_ZONE for r in rows),
        "total_units_now": sum(r["order_qty_now"] for r in rows),  # C5: excludes next_cycle_qty
        "needs_review": sum(bool(r["needs_raghav_review"]) for r in rows),
    }


def run_plan(files: dict[str, bytes], cfg: dict, run_date: date) -> RunResult:
    parsed = load_bytes(files)
    v = validate(parsed, cfg, run_date)
    res = RunResult(run_date=run_date, files=parsed, validation=v, config=cfg)
    unknown = sorted(set(files) - {f for f in parsed if f.endswith(".csv")})
    if unknown:
        res.warnings.append(f"Ignored unrecognised files: {', '.join(unknown)}")
    if not v.ok:
        return res
    for sku in v.data.skus:
        row, extra = _plan_row(sku, v.data, cfg)
        res.rows.append(row)
        res.extras[row["sku_id"]] = extra
    res.rows.sort(key=lambda r: r["sku_id"])
    res.summary = build_summary(res.rows, v.data)
    res.checks, res.check_messages = pre_send_checks(res.rows, res.summary, v.data, cfg)
    res.summary["for_sending"] = res.for_sending
    return res
