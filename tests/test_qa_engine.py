"""QA suite for the rules engine: every validation rule, malformed files, output checks, fuzzing, scale.

Each test docstring is a test-case ID used in docs/TEST_REPORT.
"""
from __future__ import annotations

import math
import time
from datetime import date

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from reorder import calculate as calc
from reorder.checks import pre_send_checks
from reorder.config import ConfigError, load_config_text
from reorder.engine import run_plan
from reorder.io import read_dir
from reorder.output import plan_csv, plan_xlsx
from synth import build, flat

RUN = date(2026, 10, 19)


@pytest.fixture(scope="module")
def octo(oct_dir):
    return read_dir(oct_dir)


def mutate(files: dict[str, bytes], name: str, fn) -> dict[str, bytes]:
    out = dict(files)
    out[name] = fn(files[name].decode()).encode()
    return out


def errors(cfg, files, run_date=RUN):
    return run_plan(files, cfg, run_date).validation.errors


def codes(errs):
    return sorted({e.split(":")[0] for e in errs})


# ---------------- validation rules I1-I12 (one deliberate fault each) ----------------

VALIDATION_CASES = [
    ("V-I1a missing file", "I1", lambda f: {k: v for k, v in f.items() if k != "distributor_master.csv"}),
    ("V-I1b missing column", "I1", lambda f: mutate(f, "current_inventory.csv", lambda t: t.replace("Location,", "Loc,", 1))),
    ("V-I1c empty file", "I1", lambda f: {**f, "calendar.csv": b""}),
    ("V-I2a SKU missing from inventory", "I2", lambda f: mutate(f, "current_inventory.csv", lambda t: "\n".join(l for l in t.splitlines() if not l.startswith("SKU015")) + "\n")),
    ("V-I2b duplicate inventory row", "I2", lambda f: mutate(f, "current_inventory.csv", lambda t: t + "SKU001,Pune Central Warehouse,10,2026-10-19\n")),
    ("V-I2c duplicate SKU in master", "I2", lambda f: mutate(f, "sku_master.csv", lambda t: t + t.splitlines()[1] + "\n")),
    ("V-I3 unknown SKU in sales", "I3", lambda f: mutate(f, "weekly_sales.csv", lambda t: t + "SKU999,2026-W42,5\n")),
    ("V-I4a negative units sold", "I4", lambda f: mutate(f, "weekly_sales.csv", lambda t: t.replace("SKU001,2026-W42,259", "SKU001,2026-W42,-259"))),
    ("V-I4b decimal stock on hand", "I4", lambda f: mutate(f, "current_inventory.csv", lambda t: t.replace(",900,", ",900.5,"))),
    ("V-I4c blank units sold", "I4", lambda f: mutate(f, "weekly_sales.csv", lambda t: t.replace("SKU001,2026-W42,259", "SKU001,2026-W42,"))),
    ("V-I4d standard qty zero", "I4", lambda f: mutate(f, "sku_master.csv", lambda t: t.replace(",500,Units,DIST001", ",0,Units,DIST001", 1))),
    ("V-I4e text in quantity", "I4", lambda f: mutate(f, "weekly_sales.csv", lambda t: t.replace("SKU002,2026-W42,83", "SKU002,2026-W42,eighty"))),
    ("V-I4f malformed week", "I4", lambda f: mutate(f, "weekly_sales.csv", lambda t: t.replace("SKU002,2026-W42,83", "SKU002,2026-42,83"))),
    ("V-I4g bad festival flag", "I4", lambda f: mutate(f, "calendar.csv", lambda t: t.replace("2026,10,2026-10,TRUE", "2026,10,2026-10,YES"))),
    ("V-I5 lowercase perishability", "I5", lambda f: mutate(f, "sku_master.csv", lambda t: t.replace(",Beverage,Low,", ",Beverage,low,", 1))),
    ("V-I6a two stock dates", "I6", lambda f: mutate(f, "current_inventory.csv", lambda t: t.replace("SKU015,Pune Central Warehouse,360,2026-10-19", "SKU015,Pune Central Warehouse,360,2026-10-18"))),
    ("V-I6b order month not in calendar", "I6", lambda f: mutate(f, "calendar.csv", lambda t: "\n".join(l for l in t.splitlines() if "2026-10" not in l) + "\n")),
    ("V-I6c invalid stock date", "I6", lambda f: mutate(f, "current_inventory.csv", lambda t: t.replace("2026-10-19", "2026-02-30"))),
    ("V-I8 unknown distributor", "I8", lambda f: mutate(f, "sku_master.csv", lambda t: t.replace("SKU015,Freshroots Honey 500g,Condiment,Low,80,Units,DIST003", "SKU015,Freshroots Honey 500g,Condiment,Low,80,Units,DIST999"))),
    ("V-I9 duplicate sales row", "I9", lambda f: mutate(f, "weekly_sales.csv", lambda t: t + "SKU001,2026-W42,259\n")),
    ("V-I11 SKUs end in different weeks", "I11", lambda f: mutate(f, "weekly_sales.csv", lambda t: "\n".join(l for l in t.splitlines() if not l.startswith("SKU005,2026-W42")) + "\n")),
    ("V-I12a override unknown SKU", "I12", lambda f: {**f, "judgment_overrides.csv": b"SKU_ID,Reason,Entered_By,Valid_Until\nSKU999,Promo,Raghav,2026-11-30\n"}),
    ("V-I12b override bad date", "I12", lambda f: {**f, "judgment_overrides.csv": b"SKU_ID,Reason,Entered_By,Valid_Until\nSKU001,Promo,Raghav,30/11/2026\n"}),
    ("V-I12c override blank reason", "I12", lambda f: {**f, "judgment_overrides.csv": b"SKU_ID,Reason,Entered_By,Valid_Until\nSKU001,,Raghav,2026-11-30\n"}),
    ("V-I12d override missing column", "I12", lambda f: {**f, "judgment_overrides.csv": b"SKU_ID,Reason\nSKU001,Promo\n"}),
]


@pytest.mark.parametrize("label,code,fault", VALIDATION_CASES, ids=[c[0] for c in VALIDATION_CASES])
def test_validation_rule_fires(cfg, octo, label, code, fault):
    res = run_plan(fault(octo), cfg, RUN)
    assert res.fatal and res.exit_code == 1, label
    assert code in codes(res.validation.errors), (label, res.validation.errors)
    assert res.rows == []  # FATAL: no plan written


def test_V_I7_stale_and_future(cfg, octo):
    """V-I7: stock 8 days old fails, 7 days passes, future-dated fails."""
    assert "I7" in codes(errors(cfg, octo, date(2026, 10, 27)))
    assert errors(cfg, octo, date(2026, 10, 26)) == []
    assert "I7" in codes(errors(cfg, octo, date(2026, 10, 18)))


def test_V_I10_sales_past_stock_date(cfg):
    """V-I10: a sales week that ends after the stock date is FATAL."""
    # 2026-W42 ends on Sunday 18 Oct, but the stock snapshot is dated 14 Oct
    files = build([{"id": "S1", "on_hand": 500, "sales": flat(12)}], as_of=date(2026, 10, 14))
    assert "I10" in codes(errors(cfg, files, date(2026, 10, 14)))


def test_V_all_faults_reported_together(cfg, octo):
    """V-MULTI: several faults in one upload are all reported, not just the first."""
    f = mutate(octo, "weekly_sales.csv", lambda t: t + "SKU999,2026-W42,5\nSKU001,2026-W42,259\n")
    f = mutate(f, "sku_master.csv", lambda t: t.replace(",Beverage,Low,", ",Beverage,low,", 1))
    assert {"I3", "I5", "I9"} <= set(codes(errors(cfg, f)))


# ---------------- file robustness ----------------

def test_R_crlf_bom_whitespace_extra_columns(cfg, octo):
    """R-1: CRLF line endings, UTF-8 BOM, padded cells and extra columns give the identical plan."""
    base = plan_csv(run_plan(octo, cfg, RUN))
    messy = {}
    for name, raw in octo.items():
        lines = raw.decode().splitlines()
        lines = [lines[0] + ",Extra_Col"] + [", ".join(c for c in l.split(",")) + ",x" for l in lines[1:]]
        messy[name] = b"\xef\xbb\xbf" + "\r\n".join(lines).encode() + b"\r\n"
    assert plan_csv(run_plan(messy, cfg, RUN)) == base


def test_R_reordered_columns(cfg, octo):
    """R-2: columns in a different order give the identical plan."""
    base = plan_csv(run_plan(octo, cfg, RUN))
    lines = octo["sku_master.csv"].decode().splitlines()
    rows = [l.split(",") for l in lines]
    order = list(reversed(range(len(rows[0]))))
    swapped = "\n".join(",".join(r[i] for i in order) for r in rows) + "\n"
    assert plan_csv(run_plan({**octo, "sku_master.csv": swapped.encode()}, cfg, RUN)) == base


@pytest.mark.parametrize("payload", [b"\x00\x01\x02\xff\xfe binary", "SKU_ID;Week;Units\nSKU001;2026-W42;5\n".encode(),
                                     "SKU_ID,Week,Units_Sold\nSKU001,2026-W42,5\n".encode("utf-16")],
                         ids=["binary", "semicolon-separated", "utf-16"])
def test_R_garbage_file_is_fatal_not_crash(cfg, octo, payload):
    """R-3: binary, wrong-delimiter and wrong-encoding files fail validation instead of crashing."""
    res = run_plan({**octo, "weekly_sales.csv": payload}, cfg, RUN)
    assert res.fatal and "I1" in codes(res.validation.errors)


def test_R_header_only_sales(cfg, octo):
    """R-4: a sales file with only a header sends every SKU to the judgment zone, no crash."""
    res = run_plan({**octo, "weekly_sales.csv": b"SKU_ID,Week,Units_Sold\n"}, cfg, RUN)
    assert not res.fatal
    assert {r["status"] for r in res.rows} == {"JUDGMENT_ZONE"}
    assert all("J1" in r["review_flags"] for r in res.rows) and all(res.checks.values())


def test_R_unicode_and_quotes_in_names(cfg, octo):
    """R-5: Unicode, commas and quotes in names survive to the CSV and Excel outputs."""
    name = 'Freshroots "Desi" Ghee, 1L — शुद्ध'
    f = mutate(octo, "sku_master.csv", lambda t: t.replace("Freshroots Honey 500g", f'"{name.replace(chr(34), chr(34) * 2)}"'))
    res = run_plan(f, cfg, RUN)
    assert not res.fatal
    assert next(r for r in res.rows if r["sku_id"] == "SKU015")["sku_name"] == name
    assert name.encode() in plan_csv(res) or '"Desi"'.encode() in plan_csv(res)
    plan_xlsx(res)  # opens without error


# ---------------- config ----------------

def test_C_config_missing_key_and_bad_rounding(cfg):
    """C-1: config.yaml with a missing key or unknown rounding mode is refused."""
    text = cfg["_text"]
    with pytest.raises(ConfigError):
        load_config_text(text.replace("festival_uplift: 0.25", ""))
    with pytest.raises(ConfigError):
        load_config_text(text.replace("order_qty_rounding: ceil", "order_qty_rounding: bankers"))


def test_C_threshold_change_flows_through(cfg, octo):
    """C-2: changing a threshold in config changes the plan (nothing hard-coded)."""
    alt = load_config_text(cfg["_text"].replace("festival_uplift: 0.25", "festival_uplift: 0.0"))
    s0, s1 = run_plan(octo, cfg, RUN).summary, run_plan(octo, alt, RUN).summary
    assert s0 != s1


# ---------------- pre-send checks O1-O8 actually catch bad output ----------------

@pytest.mark.parametrize("code,corrupt", [
    ("O1", lambda rows: rows.pop()),
    ("O2", lambda rows: rows[0].update(status="HEALTHY")),
    ("O3", lambda rows: rows[0].update(order_qty_now=123)),
    ("O6", lambda rows: rows[1].update(avg4=float("nan"))),
    ("O7", lambda rows: rows[2].update(review_flags="", shortfall_units=5)),
    ("O8", lambda rows: rows[3].update(raghav_note="filled")),
], ids=["O1", "O2", "O3", "O6", "O7", "O8"])
def test_O_checks_catch_corruption(cfg, octo, code, corrupt):
    """O-n: each pre-send check fails when its rule is broken."""
    res = run_plan(octo, cfg, RUN)
    rows = [dict(r) for r in res.rows]
    corrupt(rows)
    ok, msgs = pre_send_checks(rows, res.summary, res.validation.data, cfg)
    assert ok[code] is False, msgs


def test_O4_O5_summary_mismatch(cfg, octo):
    """O-4/O-5: a summary that disagrees with the rows is caught."""
    res = run_plan(octo, cfg, RUN)
    bad = {**res.summary, "total_units_now": 1, "healthy": 99}
    ok, _ = pre_send_checks(res.rows, bad, res.validation.data, cfg)
    assert ok["O4"] is False and ok["O5"] is False


# ---------------- property-based fuzzing ----------------

sku_strategy = st.fixed_dictionaries({
    "perish": st.sampled_from(["High", "Low"]),
    "std": st.integers(1, 2000),
    "on_hand": st.integers(0, 50_000),
    "sales": st.lists(st.integers(0, 3_000), min_size=1, max_size=30),
})


@settings(max_examples=300, deadline=None, suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture])
@given(skus=st.lists(sku_strategy, min_size=1, max_size=25), festival=st.booleans())
def test_F_invariants_hold_for_random_data(cfg, skus, festival):
    """F-1: 300 random datasets: no crash, all output checks pass, quantities are 0/1x/1.5x, deterministic."""
    spec = [{**s, "id": f"S{i:03d}"} for i, s in enumerate(skus)]
    files = build(spec, festival=festival)
    res = run_plan(files, cfg, RUN)
    assert not res.fatal, res.validation.errors
    assert all(res.checks.values()), res.check_messages
    for r in res.rows:
        std = r["std_qty"]
        assert r["order_qty_now"] in {0, std, math.ceil(std * 1.5)}
        if r["status"] != "JUDGMENT_ZONE":
            assert r["status"] == calc.decide(r["cover_weeks"], r["min_weeks"], r["max_weeks"], r["high_demand"])[0]
        if r["status"] in ("OVERSTOCK_RISK", "HEALTHY", "JUDGMENT_ZONE"):
            assert r["order_qty_now"] == 0
        n = len([s for s in spec if s["id"] == r["sku_id"]][0]["sales"])
        if n < cfg["min_history_weeks"]:
            assert r["status"] == "JUDGMENT_ZONE" and "J1" in r["review_flags"]
    assert res.summary["total_units_now"] == sum(r["order_qty_now"] for r in res.rows)
    assert plan_csv(run_plan(files, cfg, RUN)) == plan_csv(res)


# ---------------- scale ----------------

@pytest.mark.parametrize("n_skus,weeks", [(1_000, 52), (5_000, 16)])
def test_S_scale(cfg, n_skus, weeks, record_property):
    """S-1: large catalogues run within budget (1,000 SKUs × 52 weeks; 5,000 SKUs × 16 weeks)."""
    import random
    rnd = random.Random(7)
    spec = [{"id": f"S{i:05d}", "perish": rnd.choice(["High", "Low"]), "std": rnd.randint(10, 900),
             "on_hand": rnd.randint(0, 5000), "sales": [rnd.randint(0, 400) for _ in range(weeks)]} for i in range(n_skus)]
    files = build(spec, festival=True)
    t = time.perf_counter()
    res = run_plan(files, cfg, RUN)
    plan_csv(res)
    secs = time.perf_counter() - t
    record_property("seconds", round(secs, 2))
    print(f"\nSCALE {n_skus} SKUs x {weeks} weeks ({n_skus * weeks:,} sales rows): {secs:.2f}s")
    assert not res.fatal and all(res.checks.values())
    assert len(res.rows) == n_skus
    assert secs < 60
