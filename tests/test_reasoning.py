"""Gemini guardrail tests (Phase 3): wrong numbers fall back to the template."""
from datetime import date

from planner_api.reasoning import RunExplanation, SkuExplanation, explain_run
from reorder.engine import run_plan
from reorder.io import read_dir


def _plan(cfg, oct_dir):
    res = run_plan(read_dir(oct_dir), cfg, date(2026, 10, 19))
    return res.rows, res.extras, res.summary


def fake(sku_text):
    def caller(payloads, summary, api_key, model):
        return RunExplanation(
            skus=[SkuExplanation(sku_id=p["sku_id"], **sku_text(p)) for p in payloads],
            procurement_note="Raise POs for 1,820 units across 5 SKUs.",
        )
    return caller


def test_wrong_number_falls_back_to_template(cfg, oct_dir):
    rows, extras, summary = _plan(cfg, oct_dir)

    def text(p):
        if p["sku_id"] == "SKU001":  # engine says 750; Gemini invents 800
            return {"summary": "Order 800 units now.", "why": "RULE-2 fired.", "what_to_check": "R3"}
        return {"summary": f"Cover is {p['cover_weeks']} weeks.", "why": "Rules in RULE-4 applied.",
                "what_to_check": None}

    out, (note, src) = explain_run(rows, extras, summary, cfg, api_key="k", model="m", caller=fake(text))
    assert out["SKU001"]["source"] == "template"
    assert "750" in out["SKU001"]["summary"]
    assert out["SKU002"]["source"] == "gemini"
    assert src == "gemini" and "1,820" in note


def test_gemini_failure_uses_templates(cfg, oct_dir):
    rows, extras, summary = _plan(cfg, oct_dir)
    calls = []

    def boom(*a):
        calls.append(1)
        raise TimeoutError("timeout")

    out, (_, src) = explain_run(rows, extras, summary, cfg, api_key="k", model="m", caller=boom)
    assert len(calls) == 3  # 1 try + 2 retries
    assert {v["source"] for v in out.values()} == {"template"}
    assert src == "template"


def test_percent_and_rule_ids_allowed(cfg, oct_dir):
    rows, extras, summary = _plan(cfg, oct_dir)

    def text(p):
        return {"summary": f"Trend {round(p['trend'] * 100, 1)}% with {p['order_qty_now']} units.",
                "why": "RULE-1 and RULE-4 fired. R3 applies.", "what_to_check": "Check uplift."}

    out, _ = explain_run(rows, extras, summary, cfg, api_key="k", model="m", caller=fake(text))
    assert out["SKU001"]["source"] == "gemini"
