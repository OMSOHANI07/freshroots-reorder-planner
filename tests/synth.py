"""Synthetic fixture builder for edge-case tests (RULEBOOK 14.2)."""
from __future__ import annotations

from datetime import date

from reorder.validate import shift_week, week_label


def build(skus, *, as_of=date(2026, 10, 19), ref=(2026, 42), festival=False, overrides=None,
          drop_sku_master_col=None):
    """skus: list of dicts {id, perish, std, on_hand, sales:[oldest..newest ending at ref]}."""
    order_month = f"{as_of.year:04d}-{as_of.month:02d}"
    sm_cols = ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty",
               "Unit_of_Measure", "Distributor_ID"]
    if drop_sku_master_col:
        sm_cols.remove(drop_sku_master_col)
    sm = [",".join(sm_cols)]
    inv = ["SKU_ID,Location,Units_On_Hand,As_Of_Date"]
    ws = ["SKU_ID,Week,Units_Sold"]
    for s in skus:
        rec = {"SKU_ID": s["id"], "SKU_Name": f"Test {s['id']}", "Category": "Test",
               "Perishability": s.get("perish", "Low"), "Standard_Reorder_Qty": str(s.get("std", 100)),
               "Unit_of_Measure": "Units", "Distributor_ID": "D1"}
        sm.append(",".join(rec[c] for c in sm_cols))
        inv.append(f"{s['id']},WH,{s['on_hand']},{as_of.isoformat()}")
        n = len(s["sales"])
        for i, u in enumerate(s["sales"]):
            ws.append(f"{s['id']},{week_label(shift_week(ref, i - n + 1))},{u}")
    cal = ["Year,Month,Year_Month,Is_Festival_Month"]
    for y in (as_of.year - 1, as_of.year, as_of.year + 1):
        for m in range(1, 13):
            ym = f"{y:04d}-{m:02d}"
            cal.append(f"{y},{m},{ym},{'TRUE' if (ym == order_month and festival) else 'FALSE'}")
    files = {
        "sku_master.csv": "\n".join(sm) + "\n",
        "current_inventory.csv": "\n".join(inv) + "\n",
        "weekly_sales.csv": "\n".join(ws) + "\n",
        "calendar.csv": "\n".join(cal) + "\n",
        "distributor_master.csv": "Distributor_ID,Distributor_Name,Region,Status\nD1,Test Supplier,Test,Active\n",
    }
    if overrides:
        rows = ["SKU_ID,Reason,Entered_By,Valid_Until"] + [
            f"{o['sku']},{o['reason']},{o['by']},{o['until']}" for o in overrides
        ]
        files["judgment_overrides.csv"] = "\n".join(rows) + "\n"
    return {k: v.encode() for k, v in files.items()}


def flat(n, v=100):
    return [v] * n
