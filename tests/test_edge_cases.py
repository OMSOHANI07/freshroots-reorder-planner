"""RULEBOOK 14.2 edge-case tests T1-T20 on synthetic data."""
from datetime import date

from reorder.cli import main as cli_main
from reorder.engine import run_plan
from synth import build, flat

RUN = date(2026, 10, 19)


def run(cfg, skus, **kw):
    run_date = kw.pop("run_date", RUN)
    return run_plan(build(skus, **kw), cfg, run_date)


def row(res, sku="S1"):
    return next(r for r in res.rows if r["sku_id"] == sku)


def codes(r):
    return [c for c in r["review_flags"].split(";") if c]


# 8 weeks at x then 4 weeks at y -> avg12 = (8x + 4y) / 12, avg4 = y
def stepped(x, y):
    return [x] * 8 + [y] * 4


def test_t1_trend_exactly_020_is_not_high_demand(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 1000, "sales": stepped(90, 120)}]))
    assert abs(r["trend"] - 0.20) < 1e-12
    assert r["high_demand"] is False


def test_t2_trend_02001_is_high_demand(cfg):
    sales = [9000] * 7 + [8996] + [12001] * 4  # avg12 = 10000, avg4 = 12001
    r = row(run(cfg, [{"id": "S1", "on_hand": 100000, "sales": sales}]))
    assert abs(r["trend"] - 0.2001) < 1e-9
    assert r["high_demand"] is True


def test_t3_low_cover_exactly_min_is_healthy(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 600, "sales": flat(12)}]))
    assert r["cover_weeks"] == 6.0
    assert r["status"] == "HEALTHY"


def test_t4_low_cover_exactly_max_is_healthy(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 1400, "sales": flat(12)}]))
    assert r["cover_weeks"] == 14.0
    assert r["status"] == "HEALTHY"


def test_t5_high_cover_299_is_stockout(cfg):
    r = row(run(cfg, [{"id": "S1", "perish": "High", "on_hand": 299, "sales": flat(12)}]))
    assert (r["status"], r["action"]) == ("STOCKOUT_RISK", "REORDER_NOW")


def test_t6_high_cover_401_is_overstock_with_r2(cfg):
    r = row(run(cfg, [{"id": "S1", "perish": "High", "on_hand": 401, "sales": flat(12)}]))
    assert r["status"] == "OVERSTOCK_RISK"
    assert "R2" in codes(r)


def test_t7_overstock_beats_high_demand(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 2000, "sales": stepped(50, 200)}]))
    assert r["high_demand"] is True
    assert r["action"] == "PAUSE_NEXT_ORDER"
    assert r["order_qty_now"] == 0


def test_t8_healthy_high_demand_next_cycle_only(cfg):
    res = run(cfg, [{"id": "S1", "std": 100, "on_hand": 1000, "sales": stepped(50, 200)}])
    r = row(res)
    assert r["action"] == "NEXT_ORDER_1_5X"
    assert r["order_qty_now"] == 0
    assert r["next_cycle_qty"] == 150
    assert res.summary["total_units_now"] == 0


def test_t9_stockout_high_demand_festival(cfg):
    r = row(run(cfg, [{"id": "S1", "std": 100, "on_hand": 100, "sales": stepped(50, 200)}], festival=True))
    assert r["action"] == "REORDER_NOW"
    assert r["order_qty_now"] == 150
    assert "R3" in codes(r)


def test_t10_non_festival_forward_equals_avg12(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 800, "sales": stepped(90, 120)}], festival=False))
    assert r["is_festival"] is False
    assert r["forward_demand"] == r["avg12"]


def test_t11_short_history_routes_to_judgment_zone(cfg):
    res = run(cfg, [
        {"id": "S1", "on_hand": 500, "sales": flat(8)},
        {"id": "S2", "on_hand": 800, "sales": flat(12)},
    ])
    assert res.validation.errors == []
    r = row(res, "S1")
    assert (r["status"], r["action"]) == ("JUDGMENT_ZONE", "RAGHAV_TO_DECIDE")
    assert "J1" in codes(r)
    assert r["order_qty_now"] == 0 and r["cover_after"] is None
    assert r["avg4"] == 100 and r["avg12"] is None  # information where computable
    assert row(res, "S2")["status"] == "HEALTHY"
    assert all(res.checks.values()), res.check_messages


def test_t12_zero_sales_routes_j3(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 50, "sales": flat(12, 0)}]))
    assert r["status"] == "JUDGMENT_ZONE"
    assert "J3" in codes(r)
    assert r["cover_weeks"] is None
    assert r["trend"] == 0.0


def test_t13_active_override_routes_j2(cfg):
    res = run(cfg, [{"id": "S1", "on_hand": 800, "sales": flat(12)}],
              overrides=[{"sku": "S1", "reason": "Competitor scheme", "by": "Raghav", "until": "2026-11-30"}])
    r = row(res)
    assert r["status"] == "JUDGMENT_ZONE"
    assert codes(r) == ["J2"]
    assert r["review_note"] == "Manual override: Competitor scheme (Raghav)"


def test_t14_expired_override_ignored(cfg):
    res = run(cfg, [{"id": "S1", "on_hand": 800, "sales": flat(12)}],
              overrides=[{"sku": "S1", "reason": "Old event", "by": "Raghav", "until": "2026-10-01"}])
    assert res.validation.errors == []
    assert row(res)["status"] == "HEALTHY"


def test_t15_perishable_order_pushes_cover_past_max(cfg):
    r = row(run(cfg, [{"id": "S1", "perish": "High", "std": 300, "on_hand": 200, "sales": flat(12)}]))
    assert r["action"] == "REORDER_NOW"
    assert r["cover_after"] == 5.0
    assert "R4" in codes(r)


def test_t16_ceil_of_one_point_five_times_75(cfg):
    r = row(run(cfg, [{"id": "S1", "std": 75, "on_hand": 100, "sales": stepped(50, 200)}]))
    assert r["order_qty_now"] == 113


def test_t17_missing_column_is_fatal_i1(cfg, tmp_path):
    files = build([{"id": "S1", "on_hand": 800, "sales": flat(12)}], drop_sku_master_col="Category")
    inp = tmp_path / "in"
    inp.mkdir()
    for name, raw in files.items():
        (inp / name).write_bytes(raw)
    out = tmp_path / "out"
    code = cli_main(["--input", str(inp), "--config", "config.yaml", "--output", str(out),
                     "--run-date", "2026-10-19"])
    assert code == 1
    assert not list(out.rglob("reorder_plan_*"))
    log = next(out.glob("run_log_*.txt")).read_text()
    assert "I1: missing file or column: sku_master.csv.Category" in log


def test_t18_stale_inventory_is_fatal_i7(cfg):
    res = run(cfg, [{"id": "S1", "on_hand": 800, "sales": flat(12)}], run_date=date(2026, 10, 29))
    assert res.fatal and res.exit_code == 1
    assert "I7: inventory snapshot is stale or future-dated: 2026-10-19" in res.validation.errors
    assert res.rows == []


def test_t19_year_boundary_windows(cfg):
    # 2026 has 53 ISO weeks, so the run crosses 2026-W52 -> 2026-W53 -> 2027-W01.
    sales = [100] * 8 + [10, 20, 30, 40]  # last 4 weeks: 2026-W52, 2026-W53, 2027-W01, 2027-W02
    res = run(cfg, [{"id": "S1", "on_hand": 500, "sales": sales}],
              as_of=date(2027, 1, 18), ref=(2027, 2), run_date=date(2027, 1, 18))
    assert res.validation.errors == []
    weeks = [h["week"] for h in res.extras["S1"]["history"]]
    assert weeks[-5:] == ["2026-W51", "2026-W52", "2026-W53", "2027-W01", "2027-W02"]
    r = row(res)
    assert r["avg4"] == 25.0
    assert r["avg12"] == (800 + 100) / 12


def test_t20_close_call_on_healthy(cfg):
    r = row(run(cfg, [{"id": "S1", "on_hand": 630, "sales": flat(12)}]))
    assert r["status"] == "HEALTHY"
    assert "R2" in codes(r)
