"""Per-SKU calculations and the decision table (RULEBOOK Sections 8-9).

All arithmetic is unrounded floats; rounding happens only at write time (Section 12).
"""
from __future__ import annotations

import math
from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal

from .validate import Week, shift_week

STOCKOUT_RISK = "STOCKOUT_RISK"
OVERSTOCK_RISK = "OVERSTOCK_RISK"
HEALTHY = "HEALTHY"
JUDGMENT_ZONE = "JUDGMENT_ZONE"

REORDER_NOW = "REORDER_NOW"
PAUSE_NEXT_ORDER = "PAUSE_NEXT_ORDER"
NEXT_ORDER_1_5X = "NEXT_ORDER_1_5X"
NORMAL_CYCLE = "NORMAL_CYCLE"
RAGHAV_TO_DECIDE = "RAGHAV_TO_DECIDE"

_ROUNDING = {"ceil": ROUND_CEILING, "floor": ROUND_FLOOR, "round_half_up": ROUND_HALF_UP}


def window(sales: dict[Week, int], ref: Week, n: int) -> list[int] | None:
    """Units for the n weeks ending at the reference week, or None if any week is missing."""
    weeks = [shift_week(ref, -k) for k in range(n - 1, -1, -1)]
    if not all(w in sales for w in weeks):
        return None
    return [sales[w] for w in weeks]


def consecutive_weeks(sales: dict[Week, int], ref: Week) -> int:
    """Consecutive weeks with a sales row, counting back from the reference week (J1)."""
    n, w = 0, ref
    while w in sales:
        n += 1
        w = shift_week(w, -1)
    return n


def mean(xs: list[int]) -> float:
    return sum(xs) / len(xs)


def order_quantity(std_qty: int, multiplier: float | None, mode: str) -> int:
    """order_qty_now is 1x or 1.5x std_qty in whole units (RULE-1, Q8).

    Decimal avoids binary noise such as 100 * 1.1 = 110.00000000000001 rounding up to 111.
    """
    q = Decimal(std_qty) * (Decimal(str(multiplier)) if multiplier is not None else Decimal(1))
    return int(q.to_integral_value(rounding=_ROUNDING[mode]))


def ceil_units(x: float) -> int:
    # [IMPL] strip float noise below 1e-9 so e.g. 9.0000000001 does not become 10
    return math.ceil(round(x, 9))


def decide(cover_weeks: float, min_weeks: float, max_weeks: float, high_demand: bool) -> tuple[str, str]:
    """Decision table rows 1-4; first match wins on the unrounded cover."""
    if cover_weeks < min_weeks:          # RULE-2 stockout (exactly min is HEALTHY)
        return STOCKOUT_RISK, REORDER_NOW
    if cover_weeks > max_weeks:          # RULE-3 overstock beats rising demand
        return OVERSTOCK_RISK, PAUSE_NEXT_ORDER
    if high_demand:                      # C5: healthy + high demand -> larger next order, not now
        return HEALTHY, NEXT_ORDER_1_5X
    return HEALTHY, NORMAL_CYCLE
