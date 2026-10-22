"""Pre-send checks O1-O8 (RULEBOOK Section 13)."""
from __future__ import annotations

import math

from . import calculate as calc

NUMERIC = [
    "std_qty", "units_on_hand", "avg4", "avg12", "trend", "forward_demand", "cover_weeks",
    "min_weeks", "max_weeks", "order_qty_now", "next_cycle_qty", "cover_after", "shortfall_units",
]
# Section 11: these may be blank for JUDGMENT_ZONE rows
JZ_BLANKABLE = {"avg4", "avg12", "trend", "forward_demand", "cover_weeks", "cover_after"}
# trend is a fraction and may legitimately be negative
SIGNED = {"trend"}


def pre_send_checks(rows: list[dict], summary: dict, data, cfg) -> tuple[dict[str, bool], list[str]]:
    msgs: list[str] = []
    ok = {f"O{i}": True for i in range(1, 9)}

    def fail(code: str, msg: str) -> None:
        ok[code] = False
        msgs.append(f"{code}: {msg}")

    # O1
    ids = [r["sku_id"] for r in rows]
    master = [s["sku_id"] for s in data.skus]
    if sorted(ids) != sorted(master) or len(set(ids)) != len(ids):
        fail("O1", "plan rows do not match sku_master one-to-one")

    for r in rows:
        sid, st = r["sku_id"], r["status"]
        # O2
        if st != calc.JUDGMENT_ZONE:
            exp, _ = calc.decide(r["cover_weeks"], r["min_weeks"], r["max_weeks"], r["high_demand"])
            if exp != st:
                fail("O2", f"{sid} status {st} does not match cover (expected {exp})")
        # O3
        q = r["order_qty_now"]
        allowed = {0}
        if r["std_qty"]:
            mode = cfg["order_qty_rounding"]
            allowed |= {calc.order_quantity(r["std_qty"], None, mode),
                        calc.order_quantity(r["std_qty"], cfg["high_demand_multiplier"], mode)}
        if q not in allowed:
            fail("O3", f"{sid} order_qty_now {q} is not 0, 1x or 1.5x std_qty")
        if st in (calc.OVERSTOCK_RISK, calc.HEALTHY, calc.JUDGMENT_ZONE) and q != 0:
            fail("O3", f"{sid} has order_qty_now {q} with status {st}")
        # O6
        for c in NUMERIC:
            v = r[c]
            if v is None:
                if not (st == calc.JUDGMENT_ZONE and c in JZ_BLANKABLE):
                    fail("O6", f"{sid} {c} is blank")
                continue
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                fail("O6", f"{sid} {c} is NaN/inf")
            elif c not in SIGNED and v < 0:
                fail("O6", f"{sid} {c} is negative")
        # O7
        codes = [c for c in (r["review_flags"] or "").split(";") if c]
        if r["shortfall_units"] > 0 and "R1" not in codes:
            fail("O7", f"{sid} has shortfall but no R1")
        if st == calc.JUDGMENT_ZONE and not any(c.startswith("J") for c in codes):
            fail("O7", f"{sid} is JUDGMENT_ZONE without a J code")
        if bool(r["needs_raghav_review"]) != (bool(codes) or st == calc.JUDGMENT_ZONE):
            fail("O7", f"{sid} needs_raghav_review does not match flags")
        # O8
        if any(r[c] not in (None, "") for c in ("raghav_decision", "raghav_final_qty", "raghav_note")):
            fail("O8", f"{sid} has Raghav columns filled in generated output")

    # O4
    if summary["total_units_now"] != sum(r["order_qty_now"] for r in rows):
        fail("O4", "summary total does not equal sum of order_qty_now")
    # O5
    if summary["reorder_now"] + summary["pause_next_order"] + summary["healthy"] + summary["judgment_zone"] != len(rows):
        fail("O5", "REORDER_NOW + PAUSE + HEALTHY + JUDGMENT_ZONE != SKU count")
    return ok, msgs
