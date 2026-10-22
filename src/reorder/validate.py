"""Input validation (RULEBOOK Section 7).

FATAL checks I1-I12 collect every failure (never stop at the first).
The SKU-level check J1 lives in flags.py because it routes, not stops.
Row numbers in messages are CSV line numbers (header = line 1).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .io import OPTIONAL_FILES, REQUIRED_FILES, InputFile

WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")
INT_RE = re.compile(r"^\d+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

Week = tuple[int, int]


def parse_week(s: str) -> Week | None:
    m = WEEK_RE.match(s)
    if not m:
        return None
    y, w = int(m.group(1)), int(m.group(2))
    try:
        date.fromisocalendar(y, w, 1)
    except ValueError:
        return None
    return (y, w)


def week_monday(w: Week) -> date:
    return date.fromisocalendar(w[0], w[1], 1)


def week_sunday(w: Week) -> date:
    return date.fromisocalendar(w[0], w[1], 7)


def shift_week(w: Week, n: int) -> Week:
    """The ISO week n weeks after w (negative n goes back). Handles year boundaries (T19)."""
    y, wk, _ = (week_monday(w) + timedelta(weeks=n)).isocalendar()
    return (y, wk)


def week_label(w: Week) -> str:
    return f"{w[0]}-W{w[1]:02d}"


def parse_date(s: str) -> date | None:
    if not DATE_RE.match(s):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


@dataclass
class ValidatedInputs:
    skus: list[dict] = field(default_factory=list)          # sorted by SKU_ID
    sales: dict[str, dict[Week, int]] = field(default_factory=dict)
    on_hand: dict[str, int] = field(default_factory=dict)
    distributors: dict[str, dict] = field(default_factory=dict)
    as_of: date | None = None
    order_month: str | None = None
    is_festival: bool | None = None
    reference_week: Week | None = None
    overrides: dict[str, list[dict]] = field(default_factory=dict)  # active rows only (J2)


@dataclass
class ValidationResult:
    errors: list[str]
    checks: dict[str, bool]          # I1..I12 -> passed
    data: ValidatedInputs

    @property
    def ok(self) -> bool:
        return not self.errors


CHECK_CODES = [f"I{i}" for i in range(1, 13)]


def validate(files: dict[str, InputFile], cfg: dict, run_date: date) -> ValidationResult:
    errs: dict[str, list[str]] = {c: [] for c in CHECK_CODES}
    data = ValidatedInputs()

    # I1: required files and columns present
    usable: dict[str, InputFile] = {}
    for name, cols in {**REQUIRED_FILES, **OPTIONAL_FILES}.items():
        f = files.get(name)
        if f is None:
            if name in REQUIRED_FILES:
                errs["I1"].append(f"I1: missing file or column: {name}")
            continue
        if f.frame is None:
            code = "I12" if name in OPTIONAL_FILES else "I1"
            errs[code].append(f"{code}: missing file or column: {name} could not be parsed ({f.parse_error})"
                              if code == "I1" else f"I12: {name} could not be parsed ({f.parse_error})")
            continue
        missing = [c for c in cols if c not in f.frame.columns]
        if missing:
            if name in OPTIONAL_FILES:
                errs["I12"].append(f"I12: {name} missing column(s) {', '.join(missing)}")
            else:
                errs["I1"].append(f"I1: missing file or column: {name}.{', '.join(missing)}")
            continue
        usable[name] = f

    sm = usable.get("sku_master.csv")
    inv = usable.get("current_inventory.csv")
    ws = usable.get("weekly_sales.csv")
    cal = usable.get("calendar.csv")
    dm = usable.get("distributor_master.csv")
    ov = usable.get("judgment_overrides.csv")

    def bad_value(fname: str, idx: int, detail: str) -> None:
        errs["I4"].append(f"I4: invalid value in {fname} row {idx + 2}: {detail}")

    # distributor_master
    if dm is not None:
        seen: set[str] = set()
        for i, r in dm.frame.iterrows():
            did = r["Distributor_ID"]
            if not did:
                bad_value("distributor_master.csv", i, "Distributor_ID is blank")
                continue
            if did in seen:
                errs["I8"].append(f"I8: duplicate Distributor_ID in distributor_master: {did}")
            seen.add(did)
            if not r["Distributor_Name"]:
                bad_value("distributor_master.csv", i, "Distributor_Name is blank")
            data.distributors[did] = {
                "id": did, "name": r["Distributor_Name"], "region": r["Region"], "status": r["Status"],
            }

    # sku_master
    master_ids: list[str] = []
    if sm is not None:
        for i, r in sm.frame.iterrows():
            sku = r["SKU_ID"]
            if not sku:
                bad_value("sku_master.csv", i, "SKU_ID is blank")
                continue
            master_ids.append(sku)
            for col in ("SKU_Name", "Category", "Unit_of_Measure", "Distributor_ID"):
                if not r[col]:
                    bad_value("sku_master.csv", i, f"{col} is blank")
            q = r["Standard_Reorder_Qty"]
            std_ok = bool(INT_RE.match(q)) and int(q) > 0
            if not std_ok:
                bad_value("sku_master.csv", i, f"Standard_Reorder_Qty '{q}' must be an integer > 0")
            if r["Perishability"] not in ("High", "Low"):
                errs["I5"].append(f"I5: invalid Perishability for {sku}")
            if dm is not None and r["Distributor_ID"] and r["Distributor_ID"] not in data.distributors:
                errs["I8"].append(f"I8: unknown Distributor_ID for {sku}")
            data.skus.append({
                "sku_id": sku,
                "sku_name": r["SKU_Name"],
                "category": r["Category"],
                "perishability": r["Perishability"],
                "std_qty": int(q) if std_ok else None,
                "uom": r["Unit_of_Measure"],
                "distributor_id": r["Distributor_ID"],
            })
        dups = sorted({s for s in master_ids if master_ids.count(s) > 1})
        if dups:
            errs["I2"].append(f"I2: SKU mismatch between sku_master and current_inventory: duplicate in sku_master {', '.join(dups)}")
        data.skus.sort(key=lambda s: s["sku_id"])
    master_set = set(master_ids)

    # current_inventory
    if inv is not None:
        inv_ids: list[str] = []
        dates: set[str] = set()
        for i, r in inv.frame.iterrows():
            sku = r["SKU_ID"]
            inv_ids.append(sku)
            if not r["Location"]:
                bad_value("current_inventory.csv", i, "Location is blank")
            u = r["Units_On_Hand"]
            if INT_RE.match(u):
                data.on_hand[sku] = int(u)
            else:
                bad_value("current_inventory.csv", i, f"Units_On_Hand '{u}' must be an integer >= 0")
            dates.add(r["As_Of_Date"])
        if sm is not None:
            dup_inv = sorted({s for s in inv_ids if inv_ids.count(s) > 1})
            only_master = sorted(master_set - set(inv_ids))
            only_inv = sorted(set(inv_ids) - master_set)
            mismatch = sorted(set(dup_inv) | set(only_master) | set(only_inv))
            if mismatch:
                errs["I2"].append(f"I2: SKU mismatch between sku_master and current_inventory: {', '.join(mismatch)}")
        if len(dates) != 1:
            errs["I6"].append(f"I6: inventory rows must share one As_Of_Date, found {', '.join(sorted(dates)) or 'none'}")
        else:
            d = parse_date(next(iter(dates)))
            if d is None:
                errs["I6"].append(f"I6: As_Of_Date '{next(iter(dates))}' is not an ISO date YYYY-MM-DD")
            else:
                data.as_of = d
                data.order_month = f"{d.year:04d}-{d.month:02d}"
                # I7: freshness
                age = (run_date - d).days
                if age < 0 or age > cfg["inventory_max_age_days"]:
                    errs["I7"].append(f"I7: inventory snapshot is stale or future-dated: {d.isoformat()}")

    # calendar
    if cal is not None:
        rows_for_month: list[bool | None] = []
        for i, r in cal.frame.iterrows():
            flag = r["Is_Festival_Month"].upper()
            if flag not in ("TRUE", "FALSE"):
                bad_value("calendar.csv", i, f"Is_Festival_Month '{r['Is_Festival_Month']}' must be TRUE or FALSE")
            if not INT_RE.match(r["Month"]) or not 1 <= int(r["Month"]) <= 12:
                bad_value("calendar.csv", i, f"Month '{r['Month']}' must be 1-12")
            if data.order_month and r["Year_Month"] == data.order_month:
                rows_for_month.append(flag == "TRUE" if flag in ("TRUE", "FALSE") else None)
        if data.order_month:
            if len(rows_for_month) != 1:
                errs["I6"].append(
                    f"I6: order month {data.order_month} must have exactly one row in calendar.csv, found {len(rows_for_month)}"
                )
            else:
                data.is_festival = rows_for_month[0]  # RULE-4: festival months only from calendar.csv

    # weekly_sales
    if ws is not None:
        unknown: set[str] = set()
        seen_keys: dict[tuple[str, Week], int] = {}
        dup_detail: list[str] = []
        for i, r in ws.frame.iterrows():
            sku = r["SKU_ID"]
            if sm is not None and sku not in master_set:
                unknown.add(sku)
            wk = parse_week(r["Week"])
            if wk is None:
                bad_value("weekly_sales.csv", i, f"Week '{r['Week']}' must be ISO week YYYY-Www")
                continue
            u = r["Units_Sold"]
            if not INT_RE.match(u):
                bad_value("weekly_sales.csv", i, f"Units_Sold '{u}' must be an integer >= 0")
                continue
            key = (sku, wk)
            if key in seen_keys:
                dup_detail.append(f"{sku} {week_label(wk)}")
                continue
            seen_keys[key] = i
            data.sales.setdefault(sku, {})[wk] = int(u)
        if unknown:
            errs["I3"].append(f"I3: unknown SKU in weekly_sales: {', '.join(sorted(unknown))}")
        if dup_detail:
            errs["I9"].append(f"I9: duplicate sales rows: {', '.join(sorted(set(dup_detail)))}")
        latest = {s: max(w) for s, w in data.sales.items() if w}
        if latest:
            ref = max(latest.values())  # ISO tuples sort by (year, week), never as strings
            data.reference_week = ref
            if data.as_of is not None and week_sunday(ref) > data.as_of:
                errs["I10"].append("I10: sales data runs past inventory date")
            off = sorted(f"{s} ends {week_label(w)}" for s, w in latest.items() if w != ref)
            if off:
                errs["I11"].append(f"I11: SKUs end in different weeks: {', '.join(off)} (reference {week_label(ref)})")

    # judgment_overrides (optional) -> I12, then J2 activation
    if ov is not None:
        for i, r in ov.frame.iterrows():
            line = i + 2
            problems = []
            if r["SKU_ID"] not in master_set:
                problems.append(f"unknown SKU_ID '{r['SKU_ID']}'")
            if not r["Reason"]:
                problems.append("Reason is blank")
            if not r["Entered_By"]:
                problems.append("Entered_By is blank")
            vu = parse_date(r["Valid_Until"])
            if vu is None:
                problems.append(f"Valid_Until '{r['Valid_Until']}' is not an ISO date")
            if problems:
                errs["I12"].append(f"I12: judgment_overrides.csv row {line}: {'; '.join(problems)}")
                continue
            if data.as_of is not None and data.as_of <= vu:  # J2 applies while As_Of_Date <= Valid_Until
                data.overrides.setdefault(r["SKU_ID"], []).append(
                    {"reason": r["Reason"], "entered_by": r["Entered_By"], "valid_until": vu.isoformat()}
                )

    flat = [e for c in CHECK_CODES for e in errs[c]]
    checks = {c: not errs[c] for c in CHECK_CODES}
    return ValidationResult(errors=flat, checks=checks, data=data)
