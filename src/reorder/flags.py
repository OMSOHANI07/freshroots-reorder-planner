"""Review flags R1-R4 and judgment-zone routing J1-J3 (RULEBOOK Sections 10-11).

Note texts must match the rule book exactly.
"""
from __future__ import annotations

NOTE_R1 = "Standard qty still leaves cover below minimum"
NOTE_R2 = "Close to threshold - check before acting"
NOTE_R3 = "Trend spike in festival month - uplift may double-count"
NOTE_R4 = "Order pushes cover above maximum"
NOTE_J1 = "New launch or short history - no reliable average"
NOTE_J3 = "No sales in long window - cover cannot be computed"


def note_j2(reason: str, entered_by: str) -> str:
    return f"Manual override: {reason} ({entered_by})"


def judgment_codes(
    history_weeks: int,
    min_history_weeks: int,
    overrides: list[dict],
    forward_demand: float | None,
) -> list[tuple[str, str]]:
    """All matching J codes in order J1, J2, J3 (C2: report every match)."""
    out: list[tuple[str, str]] = []
    if history_weeks < min_history_weeks:  # J1 / C1: new launch, don't stop the run
        out.append(("J1", NOTE_J1))
    for o in overrides:                     # J2 / C7: manual routing by Raghav
        out.append(("J2", note_j2(o["reason"], o["entered_by"])))
    if forward_demand is not None and forward_demand == 0:  # J3: no demand baseline
        out.append(("J3", NOTE_J3))
    return out


def review_flags(
    *,
    shortfall_units: int,
    cover_weeks: float,
    min_weeks: float,
    max_weeks: float,
    band: float,
    high_demand: bool,
    is_festival: bool,
    order_qty_now: int,
    cover_after: float,
) -> list[tuple[str, str]]:
    """Every applicable R flag, in order R1;R2;R3;R4 (C2)."""
    out: list[tuple[str, str]] = []
    if shortfall_units > 0:  # R1: order still too small
        out.append(("R1", NOTE_R1))
    if abs(cover_weeks - min_weeks) < band or abs(cover_weeks - max_weeks) < band:  # R2 / C3: any status
        out.append(("R2", NOTE_R2))
    if high_demand and is_festival:  # R3: possible festival double count
        out.append(("R3", NOTE_R3))
    if order_qty_now > 0 and cover_after > max_weeks:  # R4 / C4: cover after ordering
        out.append(("R4", NOTE_R4))
    return out
