"""Plain-language explanations (RULEBOOK v1.1 amendment 1).

Gemini receives only the engine's computed fields, flags and rule IDs, and returns text.
It never computes or changes a number: any number in its text that is not in that SKU's
fields (allowing for rounding) causes the text to be discarded for the code-built template.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Callable

from pydantic import BaseModel, Field, ValidationError

log = logging.getLogger(__name__)

NUMERIC_FIELDS = [
    "std_qty", "units_on_hand", "avg4", "avg12", "trend", "forward_demand", "cover_weeks",
    "min_weeks", "max_weeks", "order_qty_now", "next_cycle_qty", "cover_after", "shortfall_units",
]
PAYLOAD_FIELDS = [
    "sku_id", "sku_name", "perishability", "supplier_name", "high_demand", "is_festival",
    "status", "action", *NUMERIC_FIELDS, "review_flags", "review_note",
]
# Rule and record identifiers are not quantities: strip them before checking numbers.
ID_RE = re.compile(
    r"\b(?:RULE-\d+|SKU\d+|DIST\d+|[RJIOC]\d+|\d{4}-W\d{2}|\d{4}-\d{2}(?:-\d{2})?)\b", re.IGNORECASE
)
NUM_RE = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")


class SkuExplanation(BaseModel):
    sku_id: str
    summary: str = Field(description="Plain-language summary, at most 25 words")
    why: str = Field(description="At most 2 sentences, citing the rule IDs that fired")
    what_to_check: str | None = Field(default=None, description="Only if the SKU is flagged")


class RunExplanation(BaseModel):
    skus: list[SkuExplanation]
    procurement_note: str = Field(description="Note to procurement, at most 120 words")


def _r(v, dp=2):
    return None if v is None else round(v, dp)


def sku_payload(row: dict, rules_fired: list[str], cfg: dict) -> dict:
    p = {k: row.get(k) for k in PAYLOAD_FIELDS}
    for k in ("avg4", "avg12", "forward_demand", "cover_weeks", "cover_after"):
        p[k] = _r(p[k], 2)
    p["trend"] = _r(p["trend"], 4)
    p["rules_fired"] = rules_fired
    # Rule parameters behind the numbers, so the text can cite them (from config.yaml).
    if "RULE-1" in rules_fired:
        p["high_demand_multiplier"] = cfg["high_demand_multiplier"]
    if row.get("is_festival"):
        p["festival_uplift"] = cfg["festival_uplift"]
    return p


def allowed_numbers(payload: dict) -> set[float]:
    out: set[float] = set()
    for k, v in payload.items():
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            continue
        for dp in range(0, 5):
            out.add(round(v, dp))
            out.add(round(v * 100, dp))  # fractions shown as percentages (trend, uplift)
        out.add(float(int(v)))
        out.add(float(-(-v // 1)))  # ceil
        out.add(abs(round(v * 100, 1)))
        out.add(abs(round(v * 100, 0)))
    return out


def numbers_in(text: str) -> list[float]:
    cleaned = ID_RE.sub(" ", text or "")
    vals = []
    for m in NUM_RE.findall(cleaned):
        try:
            vals.append(float(m.replace(",", "")))
        except ValueError:
            pass
    return vals


def text_is_grounded(text: str, allowed: set[float]) -> bool:
    for n in numbers_in(text):
        if not any(abs(n - a) <= 1e-6 or abs(abs(n) - abs(a)) <= 1e-6 for a in allowed):
            return False
    return True


def sentence_count(text: str) -> int:
    return len([p for p in re.split(r"[.!?](?:\s+|$)", text.strip()) if p.strip()])


def _fmt(v, dp=2):
    return "" if v is None else f"{v:,.{dp}f}"


def template_explanation(row: dict, rules_fired: list[str]) -> dict:
    """Code-built fallback. Uses only the engine's numbers."""
    st = row["status"]
    cover = row.get("cover_weeks")
    lim = f"{row['min_weeks']}-{row['max_weeks']} weeks"
    if st == "STOCKOUT_RISK":
        summary = f"Reorder {row['order_qty_now']} units now: cover is {_fmt(cover)} weeks, below the {lim} window."
    elif st == "OVERSTOCK_RISK":
        summary = f"Pause the next order: cover is {_fmt(cover)} weeks, above the {lim} window."
    elif st == "JUDGMENT_ZONE":
        summary = "Raghav to decide: the rules cannot decide this SKU automatically."
    elif row["action"] == "NEXT_ORDER_1_5X":
        summary = f"Healthy cover ({_fmt(cover)} weeks); demand is rising, so the next order is {row['next_cycle_qty']} units."
    else:
        summary = f"Healthy cover of {_fmt(cover)} weeks within the {lim} window; no order this cycle."
    rules = ", ".join(rules_fired) if rules_fired else "no rules"
    why = f"Rules applied: {rules}. Stock cover decides whether to order and the demand trend decides how much."
    check = row.get("review_note") or None
    return {"summary": summary, "why": why, "what_to_check": check}


def template_procurement_note(rows: list[dict], summary: dict) -> str:
    n = summary["reorder_now"]
    units = summary["total_units_now"]
    flagged = [r["sku_id"] for r in rows if r["needs_raghav_review"]]
    note = (f"This run recommends reordering {n} SKUs now for {units:,} units in total. "
            f"Once Raghav approves the plan, one PO per supplier is created in Zoho Inventory. ")
    if summary["pause_next_order"]:
        note += f"{summary['pause_next_order']} SKUs are paused because of overstock. "
    if flagged:
        note += f"Flagged for review: {', '.join(flagged)}. "
    note += "Prices are not in the data: set rates on the Zoho POs."
    return note


PROMPT = """You explain a demand-planning reorder plan to Freshroots staff.
The quantities were decided by a deterministic rules engine. You must NOT compute, change,
estimate or suggest any number. Use only numbers that appear in the input data, copied exactly.
Rule meanings: RULE-1 high demand (last 4 weeks >20% above 12-week average -> 1.5x standard qty);
RULE-2 stockout risk (cover below minimum -> reorder now); RULE-3 overstock (cover above max -> pause);
RULE-4 festival uplift on expected demand; RULE-5 perishable cover window.
Flags: R1 order still leaves cover below minimum; R2 close to a threshold; R3 trend spike in festival
month may double-count; R4 order pushes cover above max; J1 short history; J2 manual override;
J3 no sales baseline.
For each SKU return: summary (max 25 words), why (max 2 sentences citing the rule IDs in rules_fired),
what_to_check (only when review_flags is not empty, else null).
Also return procurement_note (max 120 words) for the procurement team for the whole run.
Write plain English for business readers; never use raw field names such as total_units_now.
Input JSON:
"""


def call_gemini(payloads: list[dict], summary: dict, api_key: str, model: str) -> RunExplanation:
    import os

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=20_000))
    body = json.dumps({"run_summary": summary, "skus": payloads}, default=str)
    resp = client.models.generate_content(
        model=model,
        contents=PROMPT + body,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=RunExplanation,
            temperature=0,
            # Low thinking keeps a 15-SKU run well inside the 20s timeout.
            thinking_config=types.ThinkingConfig(thinking_level=os.getenv("GEMINI_THINKING_LEVEL", "low")),
        ),
    )
    return RunExplanation.model_validate_json(resp.text)


def explain_run(
    rows: list[dict],
    extras: dict[str, dict],
    summary: dict,
    cfg: dict,
    *,
    api_key: str,
    model: str,
    caller: Callable[..., RunExplanation] = call_gemini,
    retries: int = 2,
) -> tuple[dict[str, dict], tuple[str, str]]:
    """Returns ({sku_id: {summary, why, what_to_check, source}}, (procurement_note, source))."""
    payloads = {r["sku_id"]: sku_payload(r, extras[r["sku_id"]]["rules_fired"], cfg) for r in rows}
    summ = {k: summary[k] for k in ("order_month", "is_festival", "reorder_now", "pause_next_order",
                                    "healthy", "judgment_zone", "total_units_now", "needs_review")}
    result: RunExplanation | None = None
    if api_key:
        for attempt in range(retries + 1):
            try:
                result = caller(list(payloads.values()), summ, api_key, model)
                break
            except (ValidationError, Exception) as exc:  # timeout, HTTP, invalid JSON
                log.warning("Gemini attempt %d failed: %s", attempt + 1, type(exc).__name__)

    by_sku = {e.sku_id: e for e in (result.skus if result else [])}
    out: dict[str, dict] = {}
    for r in rows:
        sid = r["sku_id"]
        fired = extras[sid]["rules_fired"]
        g = by_sku.get(sid)
        flagged = bool(r["review_flags"])
        ok = False
        if g is not None:
            allowed = allowed_numbers(payloads[sid])
            texts = [g.summary, g.why, g.what_to_check or ""]
            ok = (
                all(text_is_grounded(t, allowed) for t in texts)
                and len(g.summary.split()) <= 25
                and g.summary.strip() != "" and g.why.strip() != ""
                and sentence_count(g.why) <= 2
            )
        if ok:
            out[sid] = {"summary": g.summary.strip(), "why": g.why.strip(),
                        "what_to_check": ((g.what_to_check or "").strip() or None) if flagged else None,
                        "source": "gemini"}
        else:
            out[sid] = {**template_explanation(r, fired), "source": "template"}

    note_src = ("template", template_procurement_note(rows, summary))
    if result is not None:
        allowed_all: set[float] = set()
        for p in payloads.values():
            allowed_all |= allowed_numbers(p)
        allowed_all |= allowed_numbers({k: v for k, v in summ.items() if not isinstance(v, str)})
        pn = result.procurement_note.strip()
        if pn and len(pn.split()) <= 120 and text_is_grounded(pn, allowed_all):
            note_src = ("gemini", pn)
    return out, (note_src[1], note_src[0])
