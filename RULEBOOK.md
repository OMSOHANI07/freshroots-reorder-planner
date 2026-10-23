# Freshroots Reorder Plan — Rule Book

**Version:** 2.0 (23 Oct 2026)
**Status:** In force for the app. **Pending sign-off by Raghav Kulkarni and Deepa Nair** (Section 16).
**Purpose:** Single source of truth for the Freshroots reorder plan: the calculation rules, who does what, and how orders are raised.
**Audience:** The demand planning team (Raghav), the analyst, procurement, and whoever maintains the code.
**Built from:**

- **[EXP]** *Freshroots Expert Rule Book: Demand Planning*, the documented expertise of Raghav Kulkarni, Senior Demand Planner.
- **[SPEC]** *Freshroots Reorder Plan Rule Sheet*, the technical specification.
- The workflow decisions of 22 Oct 2026 (Section 19), which this version folds into the body.

**What changed in 2.0:** nothing in the calculations (Sections 5–14 and the golden test are unchanged). The workflow, roles, AI use and Zoho purchase orders, previously spread across change-log amendments, are now written out in Section 19, and the contradictions those amendments left in Sections 0, 1, 2, 12 and 16 are removed.

---

## 0. Instructions for whoever maintains the code (read first)

1. **This file is the specification.** Implement exactly what it says. Do not add rules, thresholds, data sources or behaviours that are not written here.
2. **Precedence: the Expert Rule Book [EXP] supersedes the Rule Sheet [SPEC].** Where the two disagree, Raghav's rule is final. Every known conflict is resolved in Section 2. Rules marked **[EXP]** or **[RESOLVED→EXP]** must never be changed to match a [SPEC] rule.
3. **If you find a conflict or gap that this file does not resolve, stop.** Do not choose an interpretation silently. Report it in the run log and to the product owner, then wait for a human decision.
4. **Never invent data.** Use only the input files in Section 5 and the parameters in Section 6. If a value is missing, apply the validation rule for it (Section 7); never estimate or fill it in. No prices, lead times or stock on order.
5. **The code recommends; Raghav decides.** The rules engine decides every recommended quantity. No purchase order exists, and nothing is sent to Zoho, until Raghav approves the plan (Section 19). AI may explain results but never sets or changes a number.
6. **External systems:** only the Gemini API (explanations) and the Zoho Inventory API (purchase orders after approval). Nothing else.
7. **All thresholds live in `config.yaml`** (Section 6). No threshold may be hard-coded in logic.
8. **Do the arithmetic in code.** Compare unrounded values. Round only when writing output (Section 12).
9. **The golden test (Section 14) must pass** before any output is considered valid. If it fails, the implementation is wrong. Do not edit the expected values to make it pass.
10. **Tags used throughout:**
    - `[EXP]`: Raghav's rule, final authority.
    - `[SPEC]`: technical rule from the Rule Sheet, valid where it doesn't conflict with [EXP].
    - `[RESOLVED→EXP]`: a conflict settled in favour of [EXP].
    - `[WF]`: a workflow rule decided on 22 Oct 2026 (Section 19).
    - `[IMPL]`: an implementation detail needed to make the rules runnable; it doesn't change any business rule.
    - `[PENDING]`: an open question for Raghav. Implement the stated default and keep it configurable.

---

## 1. Scope

**In scope.** Raghav's five documented rules, which cover about 80–85% of reorder decisions [EXP]:

| ID | Rule | Source |
|---|---|---|
| RULE-1 | High-demand signal: last 4 weeks more than 20% above the 12-week average → order 1.5x the standard quantity | [EXP] |
| RULE-2 | Stockout risk: weeks of cover below the minimum → reorder now | [EXP] |
| RULE-3 | Overstock risk: weeks of cover above the maximum → pause the next order | [EXP] |
| RULE-4 | Festival uplift: +25% demand in festival months, before threshold checks | [EXP] |
| RULE-5 | Perishable window: High-perishability SKUs use 3–4 weeks instead of 6–14 | [EXP] |

**Out of scope for automated decisions.** The judgment zone, about 15–20% of decisions [EXP]: new product launches, unusual distributor behaviour, one-off market events, close calls, insufficient order quantities and possible festival double-counting. The code must **detect and route** these cases to Raghav (Section 11). It must not decide them.

**Non-goals.** No orders without Raghav's approval. No forecasting models (ML or statistical) beyond the rules here. No lead-time, on-order or cost logic (the data doesn't exist yet; see Section 17).

---

## 2. Conflict register (all resolved)

| # | Topic | [SPEC] said | [EXP] says | Final rule |
|---|---|---|---|---|
| C1 | SKU with fewer than 12 weeks of history | Input check I2 failed and stopped the whole run | Treat it as a new launch: a judgment-zone case for Raghav | **[RESOLVED→EXP]** Don't stop the run. Mark that SKU `JUDGMENT_ZONE` with flag `J1`, recommend no order, and continue with the other SKUs. |
| C2 | Number of review flags shown | Show only the first matching flag | Any SKU matching any judgment-zone situation goes to Raghav with the reason | **[RESOLVED→EXP]** Report **all** matching flags per SKU. |
| C3 | Close-call flag | Only when status is not Healthy | Cover within half a week of a limit, especially for perishables, with no status limit | **[RESOLVED→EXP]** Apply the close-call flag to **every** status. |
| C4 | Cover after ordering | Not checked against the maximum | Check cover after ordering, not just before; a standard order can push a perishable past its maximum | **[RESOLVED→EXP]** New flag `R4` when cover after the order exceeds the maximum. |
| C5 | Healthy SKU with high demand | Counted 1.5x standard quantity in this run's order quantity and total | A high-demand SKU with healthy stock is not ordered early; its next order is simply larger | **[RESOLVED→EXP]** `order_qty_now = 0`. Put 1.5x standard quantity in a separate `next_cycle_qty` column, excluded from the order total. |
| C6 | Recording decisions | Not specified | Raghav decides each flagged SKU and records a short note on the decision and the reason | **[RESOLVED→EXP], then [WF]** The plan file carries blank columns 26–28. Since v1.2 Raghav decides the **whole plan** (approve, or reject with a note); the app records an APPROVE line per SKU at the engine quantity (Section 19.3). Per-SKU changes are an open question (Q9). |
| C7 | One-off market events | Not specified | Escalate to Raghav; can't be seen in sales history | **[RESOLVED→EXP]** Optional manual file `judgment_overrides.csv` (Section 5.6) routes listed SKUs to the judgment zone. |
| C8 | Who may change rules | Raghav, with Deepa's sign-off | Raghav owns the rules; changes need Raghav's agreement and Deepa's sign-off; procurement can't change them | Same in both. **[EXP]** wording is used. |

| C9 | Placing orders | The code must never place an order or call an external system | The workflow decision of 22 Oct 2026: approval should create purchase orders in Zoho | **[WF]** Orders are created only after Raghav approves the plan, and only in Zoho Inventory (Section 19.4). Pending sign-off. |

No other conflicts exist between the two source documents. Where only [SPEC] covers a topic (input checks, output checks, rounding, file formats), the [SPEC] rule applies.

---

## 3. Glossary

| Term | Code name | Definition | Source |
|---|---|---|---|
| Recent sales | `avg4` | Mean weekly Units_Sold over the 4 most recent weeks | [EXP] |
| Average weekly sales | `avg12` | Mean weekly Units_Sold over the 12 most recent weeks (includes the recent 4) | [EXP] |
| Trend | `trend` | `avg4 / avg12 − 1` | [SPEC] |
| Expected weekly sales | `forward_demand` | `avg12`, raised by the festival uplift in festival months | [EXP] |
| Weeks of cover | `cover_weeks` | `units_on_hand / forward_demand` | [EXP] |
| Standard quantity | `std_qty` | `Standard_Reorder_Qty` from sku_master | [EXP] |
| Perishability | `perishability` | `High` or `Low`, from sku_master | [EXP] |
| Festival month | `is_festival` | `Is_Festival_Month` for the order month in calendar.csv | [EXP] |
| Order month | `order_month` | The calendar month (YYYY-MM) containing the inventory `As_Of_Date` | [SPEC] |
| Judgment zone | `JUDGMENT_ZONE` | Cases the rules must not decide automatically | [EXP] |

---

## 4. Processing overview

```
load inputs → validate (Section 7) → per-SKU calculations (Section 8) → decision table (Section 9)
→ review flags (Section 10) → judgment-zone routing (Section 11) → output (Section 12)
→ pre-send checks (Section 13) → run log
```

Rule order [EXP]: RULE-4 and RULE-5 set the yardstick, RULE-2 and RULE-3 decide **whether** to order, and RULE-1 decides **how much**. No rule overrides a person.

---

## 5. Inputs

All files are CSV, UTF-8, comma-separated, with a header row. They may use CRLF line endings. Trim whitespace from all string fields. Column names are case-sensitive.

### 5.1 `weekly_sales.csv` (required)

| Column | Type | Constraint |
|---|---|---|
| SKU_ID | string | Present in sku_master |
| Week | string | ISO week, format `YYYY-Www` (e.g. `2026-W42`) |
| Units_Sold | integer | ≥ 0 |

One row per SKU per week. Weeks are ordered by ISO year, then ISO week number. Don't rely on string sorting.

### 5.2 `sku_master.csv` (required)

| Column | Type | Constraint |
|---|---|---|
| SKU_ID | string | Unique |
| SKU_Name | string | Non-empty |
| Category | string | Non-empty |
| Perishability | string | Exactly `High` or `Low` |
| Standard_Reorder_Qty | integer | > 0 |
| Unit_of_Measure | string | Non-empty |
| Distributor_ID | string | Present in distributor_master |

### 5.3 `current_inventory.csv` (required)

| Column | Type | Constraint |
|---|---|---|
| SKU_ID | string | Unique; present in sku_master |
| Location | string | Non-empty |
| Units_On_Hand | integer | ≥ 0 |
| As_Of_Date | date | ISO `YYYY-MM-DD`; the same value on every row |

### 5.4 `calendar.csv` (required)

| Column | Type | Constraint |
|---|---|---|
| Year | integer | |
| Month | integer | 1–12 |
| Year_Month | string | `YYYY-MM`, unique |
| Is_Festival_Month | boolean | `TRUE` or `FALSE` (case-insensitive) |

Festival months come **only** from this file [EXP], never from code or memory. Today they are March, October and November. Raghav maintains the file and updates it each year as festival dates move.

### 5.5 `distributor_master.csv` (required)

| Column | Type | Constraint |
|---|---|---|
| Distributor_ID | string | Unique |
| Distributor_Name | string | Non-empty |
| Region | string | |
| Status | string | |

Used only to show the supplier name on the plan.

### 5.6 `judgment_overrides.csv` (optional) [RESOLVED→EXP, C7]

Raghav uses this file to route SKUs to the judgment zone for reasons the data can't show (one-off market events, competitor schemes, supply disruptions, unusual distributor behaviour Raghav has seen). Since 2.0 the Analyst enters the rows on Raghav's behalf (Section 19.1).

| Column | Type | Constraint |
|---|---|---|
| SKU_ID | string | Present in sku_master |
| Reason | string | Non-empty, free text |
| Entered_By | string | Non-empty |
| Valid_Until | date | ISO `YYYY-MM-DD`; the row applies while `As_Of_Date ≤ Valid_Until` |

If the file is missing, skip this step. If it's present, it must pass the checks in Section 7.

---

## 6. Parameters (`config.yaml`)

Every threshold in the logic must be read from this config [SPEC]. These values are Raghav's [EXP] unless tagged otherwise.

```yaml
# Freshroots reorder rules: config v1.0
short_window_weeks: 4            # RULE-1 [EXP]
long_window_weeks: 12            # RULE-1, average weekly sales [EXP]
high_demand_threshold: 0.20      # RULE-1, strictly greater than [EXP]
high_demand_multiplier: 1.5      # RULE-1 [EXP]
festival_uplift: 0.25            # RULE-4 [EXP]
cover_window:
  Low:  {min_weeks: 6, max_weeks: 14}   # RULE-2, RULE-3 [EXP]
  High: {min_weeks: 3, max_weeks: 4}    # RULE-5 [EXP]
close_call_band_weeks: 0.5       # judgment zone "within half a week of a limit" [EXP]
min_history_weeks: 12            # below this = new launch, judgment zone [RESOLVED→EXP, C1]
inventory_max_age_days: 7        # input freshness check [SPEC]
order_qty_rounding: ceil         # whole units [SPEC]; rounding direction [PENDING]
```

---

## 7. Input validation

There are two levels of check. **FATAL** stops the run, writes no plan, and reports every failure found (don't stop at the first). **SKU-LEVEL** routes only that SKU to the judgment zone; the run continues.

| Code | Level | Check | Failure message |
|---|---|---|---|
| I1 | FATAL | All five required files exist and have the required columns | `I1: missing file or column: <detail>` |
| I2 | FATAL | Each SKU_ID in sku_master appears exactly once in current_inventory, and vice versa | `I2: SKU mismatch between sku_master and current_inventory: <ids>` |
| I3 | FATAL | Every SKU_ID in weekly_sales exists in sku_master | `I3: unknown SKU in weekly_sales: <ids>` |
| I4 | FATAL | Units_Sold and Units_On_Hand are integers ≥ 0; Standard_Reorder_Qty is an integer > 0; no blanks | `I4: invalid value in <file> row <n>: <detail>` |
| I5 | FATAL | Perishability is exactly `High` or `Low` | `I5: invalid Perishability for <SKU>` |
| I6 | FATAL | All rows share one As_Of_Date; the order month has exactly one row in calendar.csv | `I6: <detail>` |
| I7 | FATAL | As_Of_Date is no more than `inventory_max_age_days` before the run date, and not in the future | `I7: inventory snapshot is stale or future-dated: <date>` |
| I8 | FATAL | Every Distributor_ID in sku_master exists in distributor_master | `I8: unknown Distributor_ID for <SKU>` |
| I9 | FATAL | No duplicate (SKU_ID, Week) rows in weekly_sales | `I9: duplicate sales rows: <detail>` |
| I10 | FATAL | The latest sales week ends on or before As_Of_Date | `I10: sales data runs past inventory date` |
| I11 | FATAL | All SKUs with sales share the same latest week (the reference week) | `I11: SKUs end in different weeks: <detail>` |
| I12 | FATAL | If judgment_overrides.csv exists: columns valid, SKU_IDs known, dates valid | `I12: <detail>` |
| J1 | SKU-LEVEL | The SKU has at least `min_history_weeks` consecutive weeks ending at the reference week, with no gaps | Route to judgment zone, flag `J1` [RESOLVED→EXP, C1] |

**Reference week:** the latest week in weekly_sales. The short window is the 4 weeks ending at the reference week, and the long window is the 12 weeks ending at the reference week.

---

## 8. Per-SKU calculations

Run these for every SKU that passed J1. Use floating-point arithmetic and don't round until output.

| Step | Field | Formula | Source |
|---|---|---|---|
| C1 | `avg4` | mean(Units_Sold over the short window) | [EXP] RULE-1 |
| C2 | `avg12` | mean(Units_Sold over the long window) | [EXP] RULE-1 |
| C3 | `trend` | `avg4 / avg12 − 1`; if `avg12 == 0` then `trend = 0` | [SPEC] |
| C4 | `high_demand` | `trend > high_demand_threshold` (strictly greater; exactly 0.20 is False) | [EXP] RULE-1 |
| C5 | `is_festival` | calendar lookup for `order_month` | [EXP] RULE-4 |
| C6 | `forward_demand` | `avg12 × (1 + festival_uplift)` if `is_festival`, otherwise `avg12` | [EXP] RULE-4 |
| C7 | `cover_weeks` | `units_on_hand / forward_demand`; if `forward_demand == 0`, route to judgment zone with flag `J3` | [SPEC] + [IMPL] |
| C8 | `min_weeks`, `max_weeks` | from `cover_window[perishability]` | [EXP] RULE-2/3/5 |

**Rules that must not be "improved"** [EXP]:

- The festival uplift applies **only** to `forward_demand` (C6). It is **never** applied to `avg4`, `avg12` or `trend`. Lifting only one side of the trend test would mark almost every SKU high-demand.
- `cover_weeks` uses `avg12`, never `avg4`, even for high-demand SKUs. RULE-1 handles a recent jump through the order multiplier.
- Perishable windows **replace** the standard window. They are never added to it or combined with it.
- `cover_weeks` uses stock on hand only. Stock on order isn't in the data [PENDING].

---

## 9. Decision table

Evaluate the rows in order; the **first match wins**. Compare unrounded `cover_weeks`.

| Order | Condition | `status` | `action` | `order_qty_now` | `next_cycle_qty` | Source |
|---|---|---|---|---|---|---|
| 0 | SKU routed to judgment zone (Section 11) | `JUDGMENT_ZONE` | `RAGHAV_TO_DECIDE` | 0 | 0 | [EXP] |
| 1 | `cover_weeks < min_weeks` | `STOCKOUT_RISK` | `REORDER_NOW` | `std_qty × high_demand_multiplier` if `high_demand`, else `std_qty` | 0 | [EXP] RULE-2 + RULE-1 |
| 2 | `cover_weeks > max_weeks` | `OVERSTOCK_RISK` | `PAUSE_NEXT_ORDER` | 0 | 0 | [EXP] RULE-3 |
| 3 | `high_demand` is True | `HEALTHY` | `NEXT_ORDER_1_5X` | 0 | `std_qty × high_demand_multiplier` | [RESOLVED→EXP, C5] |
| 4 | otherwise | `HEALTHY` | `NORMAL_CYCLE` | 0 | 0 | [EXP] |

Rules that follow from this table [EXP]:

- Cover exactly equal to `min_weeks` or `max_weeks` is `HEALTHY`.
- Stock cover decides **whether** to order; demand trend decides **how much**.
- Overstock beats rising demand: an `OVERSTOCK_RISK` SKU is never ordered, even when high-demand.
- `order_qty_now` is always 0, 1x or 1.5x `std_qty`, never any other amount. Apply `order_qty_rounding` (ceil) to get whole units.

Derived fields for SKUs not in the judgment zone:

| Field | Formula |
|---|---|
| `cover_after` | `(units_on_hand + order_qty_now) / forward_demand` |
| `shortfall_units` | `0` if `status == OVERSTOCK_RISK`, otherwise `max(0, ceil(min_weeks × forward_demand − (units_on_hand + order_qty_now)))` |

---

## 10. Review flags

Evaluate **every** flag for every SKU not already in the judgment zone, and report **all** that apply [RESOLVED→EXP, C2]. A flag never changes `status`, `action` or quantities; it sends the SKU to Raghav for a decision.

| Flag | Condition | Note text (exact) | Source |
|---|---|---|---|
| R1 | `shortfall_units > 0` | `Standard qty still leaves cover below minimum` | [EXP] "order still too small" |
| R2 | `abs(cover_weeks − min_weeks) < close_call_band_weeks` OR `abs(cover_weeks − max_weeks) < close_call_band_weeks` (any status) | `Close to threshold - check before acting` | [RESOLVED→EXP, C3] |
| R3 | `high_demand` AND `is_festival` | `Trend spike in festival month - uplift may double-count` | [EXP] |
| R4 | `order_qty_now > 0` AND `cover_after > max_weeks` | `Order pushes cover above maximum` | [RESOLVED→EXP, C4] |

Output `review_flags` as the codes that apply, in the order R1;R2;R3;R4, joined by `;`, or empty. Output `review_note` as the matching note texts in the same order, joined by ` | `. Set `needs_raghav_review = True` if any flag applies or `status == JUDGMENT_ZONE`.

---

## 11. Judgment zone routing [EXP]

A SKU goes to `JUDGMENT_ZONE` (decision table row 0) if any of these apply. Report all matching codes in `review_flags`.

| Code | Situation | Detection | Note text (exact) |
|---|---|---|---|
| J1 | New product launch | Fewer than `min_history_weeks` consecutive weeks ending at the reference week | `New launch or short history - no reliable average` |
| J2 | One-off market event, or any reason Raghav enters | SKU listed in `judgment_overrides.csv` with `As_Of_Date ≤ Valid_Until` | `Manual override: <Reason> (<Entered_By>)` |
| J3 | No demand baseline | `forward_demand == 0` | `No sales in long window - cover cannot be computed` |

For judgment-zone SKUs:

- Still output `avg4`, `avg12`, `trend`, `forward_demand` and `cover_weeks` for information wherever they can be computed from available weeks. Leave them blank where they can't.
- Set `order_qty_now = 0`, `next_cycle_qty = 0` and `shortfall_units = 0`. Leave `cover_after` blank.
- Don't evaluate R1–R4.

**Unusual distributor behaviour** [EXP] can't be detected automatically: sales data is at SKU level, not distributor level. Don't build a proxy detector or invent a spike threshold. Until distributor-level data and a Raghav-approved threshold exist, these cases enter only through J2.

---

## 12. Output

### 12.1 Files

Write to `output/<order_month>/`:

1. `reorder_plan_<order_month>.csv`: one row per SKU (Section 12.2).
2. `reorder_plan_<order_month>.xlsx`: the same table with the formatting in 12.3, plus a `Summary` sheet (12.4) and a `Parameters` sheet (a copy of config.yaml).
3. `run_log_<order_month>.txt`: run timestamp, input file names with row counts, the config used, validation results, pre-send check results (Section 13), and any warnings.

Write no plan files if any FATAL check fails; write the run log only.

### 12.2 Columns (in this order)

| # | Column | Type | Format |
|---|---|---|---|
| 1 | sku_id | string | |
| 2 | sku_name | string | |
| 3 | category | string | |
| 4 | perishability | string | |
| 5 | supplier_name | string | from distributor_master |
| 6 | std_qty | int | |
| 7 | units_on_hand | int | |
| 8 | avg4 | float | 2 dp |
| 9 | avg12 | float | 2 dp |
| 10 | trend | float | stored as a fraction, 4 dp (shown as % in xlsx) |
| 11 | high_demand | bool | |
| 12 | is_festival | bool | |
| 13 | forward_demand | float | 2 dp |
| 14 | cover_weeks | float | 2 dp |
| 15 | min_weeks | int | |
| 16 | max_weeks | int | |
| 17 | status | enum | `STOCKOUT_RISK`, `OVERSTOCK_RISK`, `HEALTHY`, `JUDGMENT_ZONE` |
| 18 | action | enum | `REORDER_NOW`, `PAUSE_NEXT_ORDER`, `NEXT_ORDER_1_5X`, `NORMAL_CYCLE`, `RAGHAV_TO_DECIDE` |
| 19 | order_qty_now | int | |
| 20 | next_cycle_qty | int | |
| 21 | cover_after | float | 2 dp |
| 22 | shortfall_units | int | |
| 23 | review_flags | string | e.g. `R1;R3` |
| 24 | review_note | string | |
| 25 | needs_raghav_review | bool | |
| 26 | raghav_decision | string | **blank** in the generated file (O8); the decision is recorded by the app (Section 19.3) [C6] |
| 27 | raghav_final_qty | int | **blank** in the generated file (O8) [C6] |
| 28 | raghav_note | string | **blank** in the generated file (O8) [C6] |

Rows are sorted by `sku_id` ascending. Rounding to the decimal places above happens **only** at write time.

### 12.3 xlsx formatting

- Arial font. Header row frozen.
- `STOCKOUT_RISK` rows filled light red, `OVERSTOCK_RISK` light amber, `JUDGMENT_ZONE` light grey.
- Columns 26–28 shaded yellow to mark them as human input.
- Every value is a computed result, not an Excel formula. The code is the single place where rules live.

### 12.4 Summary sheet

| Metric | Definition |
|---|---|
| Order month / festival | `order_month`, `is_festival` |
| Inventory as of | `As_Of_Date` |
| SKUs: reorder now | count of `action == REORDER_NOW` |
| SKUs: pause next order | count of `action == PAUSE_NEXT_ORDER` |
| SKUs: healthy | count of `status == HEALTHY` |
| SKUs: judgment zone | count of `status == JUDGMENT_ZONE` |
| Total units to order now | sum of `order_qty_now` (excludes `next_cycle_qty`) [C5] |
| SKUs needing Raghav review | count of `needs_raghav_review == True` |

---

## 13. Pre-send checks [SPEC, updated for EXP]

Run these after building the plan. If any check fails, mark the plan **NOT FOR SENDING** in the run log and in the Summary sheet, and exit with a non-zero code.

| # | Check |
|---|---|
| O1 | Every SKU from sku_master appears exactly once; no other rows |
| O2 | Each non-judgment `status` matches `cover_weeks`, `min_weeks` and `max_weeks` under Section 9 |
| O3 | Every `order_qty_now` is 0, ceil(1x std_qty) or ceil(1.5x std_qty), and is 0 for every `OVERSTOCK_RISK`, `HEALTHY` and `JUDGMENT_ZONE` row |
| O4 | Summary total equals the sum of `order_qty_now` |
| O5 | The counts of REORDER_NOW, PAUSE_NEXT_ORDER, HEALTHY and JUDGMENT_ZONE add up to the number of SKUs |
| O6 | No NaN, inf or negative values in any numeric column, apart from blanks allowed for JUDGMENT_ZONE in Section 11 |
| O7 | Every row with `shortfall_units > 0` has R1; every JUDGMENT_ZONE row has a J code; `needs_raghav_review` matches the flags |
| O8 | Columns 26–28 are blank in generated output |

---

## 14. Tests

### 14.1 Golden test: October 2026 data (must pass exactly)

**Fixture:** the five uploaded files. Sales cover 2026-W27 to 2026-W42 (15 SKUs × 16 weeks), As_Of_Date is 2026-10-19, order month is 2026-10 (festival = TRUE), and there is no overrides file. For the test, the run date is fixed at 2026-10-19 so that I7 passes.

**Tolerance:** floats within ±0.0001 of the 4-dp values below; ints and enums exact.

| sku_id | avg4 | avg12 | trend | high_demand | forward_demand | cover_weeks | status | order_qty_now | next_cycle_qty | cover_after | shortfall_units | review_flags |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SKU001 | 261.0000 | 214.9167 | 0.2144 | True | 268.6458 | 3.3501 | STOCKOUT_RISK | 750 | 0 | 6.1419 | 0 | R3 |
| SKU002 | 83.7500 | 83.7500 | 0.0000 | False | 104.6875 | 11.4627 | HEALTHY | 0 | 0 | 11.4627 | 0 | |
| SKU003 | 150.7500 | 150.5000 | 0.0017 | False | 188.1250 | 4.3588 | STOCKOUT_RISK | 300 | 0 | 5.9535 | 9 | R1 |
| SKU004 | 81.0000 | 79.8333 | 0.0146 | False | 99.7917 | 1.8038 | STOCKOUT_RISK | 150 | 0 | 3.3069 | 0 | |
| SKU005 | 58.2500 | 59.5000 | -0.0210 | False | 74.3750 | 8.0672 | HEALTHY | 0 | 0 | 8.0672 | 0 | |
| SKU006 | 40.2500 | 39.5833 | 0.0168 | False | 49.4792 | 22.2316 | OVERSTOCK_RISK | 0 | 0 | 22.2316 | 0 | |
| SKU007 | 133.5000 | 121.5000 | 0.0988 | False | 151.8750 | 4.0823 | OVERSTOCK_RISK | 0 | 0 | 4.0823 | 0 | R2 |
| SKU008 | 103.0000 | 108.7500 | -0.0529 | False | 135.9375 | 6.9885 | HEALTHY | 0 | 0 | 6.9885 | 0 | |
| SKU009 | 34.7500 | 34.0833 | 0.0196 | False | 42.6042 | 9.3888 | HEALTHY | 0 | 0 | 9.3888 | 0 | |
| SKU010 | 24.7500 | 24.4167 | 0.0137 | False | 30.5208 | 8.5188 | HEALTHY | 0 | 0 | 8.5188 | 0 | |
| SKU011 | 209.2500 | 204.3333 | 0.0241 | False | 255.4167 | 1.8010 | STOCKOUT_RISK | 500 | 0 | 3.7586 | 0 | |
| SKU012 | 60.0000 | 56.7500 | 0.0573 | False | 70.9375 | 6.7665 | HEALTHY | 0 | 0 | 6.7665 | 0 | |
| SKU013 | 44.7500 | 45.4167 | -0.0147 | False | 56.7708 | 3.1706 | STOCKOUT_RISK | 120 | 0 | 5.2844 | 41 | R1 |
| SKU014 | 77.5000 | 72.4167 | 0.0702 | False | 90.5208 | 6.8493 | HEALTHY | 0 | 0 | 6.8493 | 0 | |
| SKU015 | 28.7500 | 29.8333 | -0.0363 | False | 37.2917 | 9.6536 | HEALTHY | 0 | 0 | 9.6536 | 0 | |

**Expected summary:** reorder now 5 · pause 2 · healthy 8 · judgment zone 0 · total units to order now **1,820** · needing Raghav review 4 (SKU001, SKU003, SKU007, SKU013).

### 14.2 Edge-case unit tests (synthetic data)

| # | Case | Expected |
|---|---|---|
| T1 | trend exactly 0.20 | `high_demand = False` |
| T2 | trend 0.2001 | `high_demand = True` |
| T3 | Low SKU, cover exactly 6.0 | `HEALTHY` (not stockout) |
| T4 | Low SKU, cover exactly 14.0 | `HEALTHY` (not overstock) |
| T5 | High SKU, cover 2.99 | `STOCKOUT_RISK`, `REORDER_NOW` |
| T6 | High SKU, cover 4.01 | `OVERSTOCK_RISK`, R2 also set |
| T7 | Overstock and high-demand | `PAUSE_NEXT_ORDER`, `order_qty_now = 0` |
| T8 | Healthy and high-demand | `NEXT_ORDER_1_5X`, `order_qty_now = 0`, `next_cycle_qty = 1.5 × std_qty`; excluded from total |
| T9 | Stockout and high-demand in a festival month | `REORDER_NOW` at 1.5x; flags include R3 |
| T10 | Non-festival month | `forward_demand == avg12` |
| T11 | SKU with 8 weeks of history | `JUDGMENT_ZONE`, J1; run continues for the other SKUs |
| T12 | All-zero sales in the long window | `JUDGMENT_ZONE`, J3; no division error |
| T13 | SKU in overrides with a future Valid_Until | `JUDGMENT_ZONE`, J2 with the reason text |
| T14 | Override that has expired | Ignored; normal rules apply |
| T15 | Perishable stockout where the order pushes cover past 4 | `REORDER_NOW`, R4 set |
| T16 | std_qty 75 with high demand | `order_qty_now = 113` (ceil of 112.5) |
| T17 | Missing column in sku_master | FATAL I1; no plan written; non-zero exit |
| T18 | Inventory dated 10 days before run date | FATAL I7 |
| T19 | Weeks spanning a year boundary (2026-W52 → 2027-W01) | Windows ordered correctly by ISO week |
| T20 | Cover within 0.5 of the minimum, status HEALTHY | R2 set (applies to every status) |

---

## 15. Implementation guidance [IMPL]

- **Engine:** Python 3.11+, with pandas, openpyxl, PyYAML and pytest, in `src/reorder/`. It has no network access.
- **Layout:**

```
config.yaml
RULEBOOK.md                 # this file
src/reorder/                # the rules engine (Sections 5–13)
  io.py  validate.py  calculate.py  flags.py  output.py  checks.py  engine.py  cli.py
src/planner_api/            # web API: runs, approval, POs, Zoho, AI explanations (Section 19)
app/  components/  lib/     # website
tests/                      # golden test, edge cases, API, AI guardrail
e2e/                        # end-to-end browser tests
```

- **CLI:** `python -m reorder.cli --input <dir> --config config.yaml --output <dir> [--run-date YYYY-MM-DD]`. The default run date is today; tests pass `--run-date 2026-10-19`.
- **Exit codes:** 0 means success and every pre-send check passed. 1 means a FATAL validation failure. 2 means a pre-send check failed.
- **Determinism:** the same inputs and config always give byte-identical CSV output. No randomness, no wall-clock dependence except the run date, and stable sorting.
- **Traceability:** put a comment in the code naming the rule ID (`RULE-1`, `C6`, `R2` and so on) beside each piece of logic.
- **Enum strings and note texts** must match this file exactly.
- **No silent fixes:** if the input data or this file looks wrong, record a warning in the run log and report it. Don't change the logic.

---

## 16. Governance (human-only decisions) [EXP, WF]

| Change or action | Who decides |
|---|---|
| Any parameter in config.yaml, the decision table, or the rule logic | Raghav Kulkarni, with sign-off from Deepa Nair (Head of Operations) |
| This rule book, including Section 19 | Raghav Kulkarni, with sign-off from Deepa Nair |
| Festival months in calendar.csv | Raghav Kulkarni |
| Standard_Reorder_Qty and Perishability in sku_master | Procurement, with Raghav |
| Running a plan (latest SAP data or a new upload) | Analyst |
| Entries in judgment_overrides (J2) | Entered by the Analyst on Raghav's behalf; Raghav owns them |
| Approving or rejecting a plan | Raghav Kulkarni only |
| Entering rates and issuing POs in Zoho | Procurement |

Procurement and the Analyst apply rules but do not change them. After any approved change:

1. Update this file and config.yaml.
2. Update the golden test if the expected results change, with a change-log entry giving the reason.
3. Re-run all tests.

**Growing the rules [EXP]:** when Raghav's notes show the same kind of exception handled the same way three times, it becomes a candidate for a new rule in the next version. A person adds it to this file; the code doesn't learn it.

---

## 17. Open questions [PENDING] and known data gaps

Implement the default shown and keep it configurable. **Don't resolve these yourself.**

| # | Question for Raghav | Current default |
|---|---|---|
| Q1 | Should average weekly sales always use the last 12 weeks? | 12 weeks |
| Q2 | Is a jump of exactly 20% high-demand? | No (strictly greater) |
| Q3 | Should the festival uplift follow fixed months or actual festival dates? | calendar.csv months |
| Q4 | Same 25% uplift for every category? | Yes, 25% flat |
| Q5 | What to order when the standard quantity leaves cover below the minimum? | Flag R1; Raghav decides |
| Q6 | What supplier lead time sits behind "immediate" reorder? | Not modelled |
| Q7 | Should stock already on order count towards cover? | Not counted (no data) |
| Q8 | How should 1.5x be rounded when it isn't a whole number? | Round up (ceil) |
| Q9 | With whole-plan approval, how should Raghav adjust a single SKU (for example, topping up an R1 shortfall)? | Not possible: reject the plan with a note and re-run |
| Q10 | Is the 40% kill criterion measured on rejected plans? | Yes: rejected plans ÷ decided plans |

**Data gaps.** There are no supplier lead times, units on order (Zoho Inventory), unit costs, or distributor-level sales. When any of these is added, the logic that uses it must be specified in this file first and approved under Section 16.

---

## 18. Change log

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0 | 22 Oct 2026 | Combined Expert Rule Book [EXP] and Rule Sheet [SPEC]; conflicts C1–C8 resolved in favour of [EXP]. | Pending Raghav Kulkarni and Deepa Nair |
| 1.1 | 22 Oct 2026 | Gemini allowed to explain results only (with a number guardrail and template fallback); PO files only after approval; per-SKU APPROVE / CHANGE / REJECT / HOLD; run date may be set for replays. | Product owner; pending Raghav and Deepa |
| 1.2 | 22 Oct 2026 | Analyst runs plans; Raghav approves or rejects the whole plan; approval creates POs in Zoho Inventory; kill criterion = plan rejection rate. Superseded the per-SKU decisions of 1.1. | Product owner; pending Raghav and Deepa |
| 2.0 | 23 Oct 2026 | Consolidation: the 1.1 and 1.2 workflow written into the body (Sections 0, 1, 2, 12, 16, new Section 19); contradictions removed; data storage named. **No change to any calculation, threshold or the golden test.** | Product owner; **pending Raghav Kulkarni and Deepa Nair** |

---

## 19. Workflow, approval and purchase orders [WF]

### 19.1 Roles

| Role | Can do | Cannot do |
|---|---|---|
| Analyst | Run a plan on the latest SAP data or a new upload; add J2 overrides; set the run date for replays; retry a failed Zoho sync | Approve or reject; change rules |
| Raghav Kulkarni | Approve or reject a plan | Run plans or edit data in the app |
| Procurement | View approved plans and POs; download PO files; retry a failed Zoho sync; record a PO entered by hand if Zoho is unavailable | Approve, reject, or change rules |

Every action is written to the audit log with who, when, what, and the before and after values.

### 19.2 Running a plan

1. The Analyst chooses **Latest SAP data** (the files of the most recent successful upload) or **Upload new files** (the five files in Section 5, plus optional overrides).
2. The app runs Sections 7–13 exactly. A FATAL check stops the run and shows the exact messages from Section 7.
3. The **run date** is today (Asia/Kolkata) unless the Analyst sets another date; a set date is recorded in the audit log and applies to I7 exactly as the CLI `--run-date` does.
4. Each run stores its input files with SHA-256 hashes, the config text and hash, and this file's version, so it can be reproduced byte for byte.

### 19.3 Approval

1. A successful run is a **draft** plan, waiting for Raghav.
2. Raghav sees the summary (Section 12.4), every flagged and judgment-zone SKU with its note, and any SKU's detail.
3. **Approve:** the plan is locked. Each SKU's final quantity is its `order_qty_now`; an APPROVE line per SKU records it. An optional note is kept.
4. **Reject:** a note is required. Nothing is ordered. The Analyst can run a new plan.
5. A decided plan can't be changed. R1 shortfalls are not topped up and judgment-zone SKUs are not ordered on approval (Q9).
6. **Kill criterion:** if more than 40% of decided plans are rejected, the rules need review (Q10).

### 19.4 Purchase orders

1. On approval, the app raises **one PO per supplier** (Distributor_ID), containing only lines with a final quantity above 0. Paused, healthy and judgment-zone SKUs never appear.
2. PO number: `FR-PO-YYYYMMDD-<Distributor_ID>-<seq>`, dated in Asia/Kolkata.
3. **Zoho Inventory:** when the connection is configured, each PO is created in Zoho via its API: vendor matched by exact `Distributor_Name`, items by exact SKU, the approved quantities, **no rates**. POs are created as Draft unless `ZOHO_MARK_ISSUED=true`. A failed PO keeps its reason and can be retried; retries never duplicate (the PO number is unique in Zoho).
4. PDF, Excel and Zoho-import CSV copies are always available, with price columns shown as "—" and a note.
5. If Zoho is not connected, POs are kept with the reason and procurement can record a Zoho reference entered by hand.

### 19.5 AI explanations

1. Gemini receives only each SKU's computed fields, flags and rule IDs, and returns a summary (≤ 25 words), a reason (≤ 2 sentences citing rule IDs), what to check (flagged SKUs only), and one note to procurement (≤ 120 words).
2. **Guardrail:** every number in the text must appear in that SKU's computed fields, allowing for rounding. Otherwise the text is discarded and a code-built template is used. The same applies if Gemini fails or times out (20 s, 2 retries).
3. Each explanation is stored with its source (`gemini` or `template`) and generated once per run and SKU.

### 19.6 Data storage

Neon Postgres, database `freshroots`; branch `production` for the live app, `development` for testing.

| Table | Holds |
|---|---|
| plan_runs | One row per run: status, summary, config, rule book version, approval |
| sap_upload_files | The raw SAP files of each run, with SHA-256 |
| sku_master, distributor_master, weekly_sales, current_inventory, festival_calendar, judgment_overrides | Readable copies of each upload's files (Section 5), tagged with the run |
| sku_plan_lines | The engine result per SKU (the Section 12.2 columns) |
| sku_approvals | The APPROVE line per SKU of an approved plan |
| sku_ai_explanations | The explanation per SKU and its source |
| purchase_orders, purchase_order_lines | POs per supplier and their lines, with Zoho status |
| audit_log | Every action: who, when, what, before and after |
