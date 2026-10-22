"""RULEBOOK 14.1 golden test: October 2026 data. Never edit expected values to make it pass."""
from datetime import date

import pytest

from reorder.engine import run_plan
from reorder.io import read_dir
from reorder.output import plan_csv

T = True
F = False
# sku, avg4, avg12, trend, high_demand, forward, cover, status, qty, next, cover_after, shortfall, flags
EXPECTED = [
    ("SKU001", 261.0000, 214.9167, 0.2144, T, 268.6458, 3.3501, "STOCKOUT_RISK", 750, 0, 6.1419, 0, "R3"),
    ("SKU002", 83.7500, 83.7500, 0.0000, F, 104.6875, 11.4627, "HEALTHY", 0, 0, 11.4627, 0, ""),
    ("SKU003", 150.7500, 150.5000, 0.0017, F, 188.1250, 4.3588, "STOCKOUT_RISK", 300, 0, 5.9535, 9, "R1"),
    ("SKU004", 81.0000, 79.8333, 0.0146, F, 99.7917, 1.8038, "STOCKOUT_RISK", 150, 0, 3.3069, 0, ""),
    ("SKU005", 58.2500, 59.5000, -0.0210, F, 74.3750, 8.0672, "HEALTHY", 0, 0, 8.0672, 0, ""),
    ("SKU006", 40.2500, 39.5833, 0.0168, F, 49.4792, 22.2316, "OVERSTOCK_RISK", 0, 0, 22.2316, 0, ""),
    ("SKU007", 133.5000, 121.5000, 0.0988, F, 151.8750, 4.0823, "OVERSTOCK_RISK", 0, 0, 4.0823, 0, "R2"),
    ("SKU008", 103.0000, 108.7500, -0.0529, F, 135.9375, 6.9885, "HEALTHY", 0, 0, 6.9885, 0, ""),
    ("SKU009", 34.7500, 34.0833, 0.0196, F, 42.6042, 9.3888, "HEALTHY", 0, 0, 9.3888, 0, ""),
    ("SKU010", 24.7500, 24.4167, 0.0137, F, 30.5208, 8.5188, "HEALTHY", 0, 0, 8.5188, 0, ""),
    ("SKU011", 209.2500, 204.3333, 0.0241, F, 255.4167, 1.8010, "STOCKOUT_RISK", 500, 0, 3.7586, 0, ""),
    ("SKU012", 60.0000, 56.7500, 0.0573, F, 70.9375, 6.7665, "HEALTHY", 0, 0, 6.7665, 0, ""),
    ("SKU013", 44.7500, 45.4167, -0.0147, F, 56.7708, 3.1706, "STOCKOUT_RISK", 120, 0, 5.2844, 41, "R1"),
    ("SKU014", 77.5000, 72.4167, 0.0702, F, 90.5208, 6.8493, "HEALTHY", 0, 0, 6.8493, 0, ""),
    ("SKU015", 28.7500, 29.8333, -0.0363, F, 37.2917, 9.6536, "HEALTHY", 0, 0, 9.6536, 0, ""),
]
TOL = 0.0001


@pytest.fixture(scope="module")
def result(cfg, oct_dir):
    return run_plan(read_dir(oct_dir), cfg, date(2026, 10, 19))


def test_run_passes_validation_and_checks(result):
    assert result.validation.errors == []
    assert all(result.checks.values()), result.check_messages
    assert result.exit_code == 0
    assert result.summary["order_month"] == "2026-10"
    assert result.summary["is_festival"] is True


@pytest.mark.parametrize("exp", EXPECTED, ids=[e[0] for e in EXPECTED])
def test_golden_row(result, exp):
    sku, a4, a12, tr, hd, fd, cov, st, q, nx, ca, sf, fl = exp
    r = next(r for r in result.rows if r["sku_id"] == sku)
    for field, want in (("avg4", a4), ("avg12", a12), ("trend", tr), ("forward_demand", fd),
                        ("cover_weeks", cov), ("cover_after", ca)):
        assert abs(r[field] - want) <= TOL, (sku, field, r[field], want)
    assert r["high_demand"] is hd
    assert r["status"] == st
    assert r["order_qty_now"] == q
    assert r["next_cycle_qty"] == nx
    assert r["shortfall_units"] == sf
    assert r["review_flags"] == fl


def test_golden_summary(result):
    s = result.summary
    assert (s["reorder_now"], s["pause_next_order"], s["healthy"], s["judgment_zone"]) == (5, 2, 8, 0)
    assert s["total_units_now"] == 1820
    assert s["needs_review"] == 4
    flagged = sorted(r["sku_id"] for r in result.rows if r["needs_raghav_review"])
    assert flagged == ["SKU001", "SKU003", "SKU007", "SKU013"]


def test_determinism(cfg, oct_dir, result):
    again = run_plan(read_dir(oct_dir), cfg, date(2026, 10, 19))
    assert plan_csv(again) == plan_csv(result)
