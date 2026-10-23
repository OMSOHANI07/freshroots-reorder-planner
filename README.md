# Freshroots Reorder Planner

Turns weekly SAP sales and stock data into a reorder plan using Raghav Kulkarni's expert rules.
An **Analyst** runs the plan on the latest SAP data (or uploads new SAP files). **Raghav approves or
rejects the whole plan.** On approval the app creates one purchase order per supplier in
**Zoho Inventory**; PDF, Excel and CSV copies stay available for procurement.

**Principle: AI vs Expert → Expert wins.** The deterministic rules engine recommends, Gemini only
explains, and nothing is ordered until Raghav approves.

| # | Component | Where |
|---|---|---|
| 1–2 | SAP data download / Excel data | New run page → `POST /api/runs`; raw files + SHA-256 in `sap_upload_files`, readable copies in `sku_master`, `weekly_sales`, etc. |
| 3–4 | AI rules / Raghav's rules | `RULEBOOK.md`, `config.yaml`, `calendar.csv`, optional `judgment_overrides.csv` (version-stamped per run) |
| 5 | Predict | `src/reorder/` — deterministic Python engine (RULEBOOK Sections 5–13) |
| 6 | Reasoning | `src/planner_api/reasoning.py` — Gemini explanations with a number guardrail and template fallback |
| 7–9 | Draft dashboard / Approve-reject / Final dashboard | `app/runs/[id]` (Raghav's approve/reject panel), `app/runs/[id]/final` |
| 10 | PO raised | `src/planner_api/zoho.py` creates POs in Zoho Inventory on approval; `po_docs.py` makes PDF, Excel, CSV, ZIP copies |

## Stack

- **Engine:** Python 3.11+, pandas, PyYAML, openpyxl, pytest
- **API:** FastAPI (`src/planner_api`), SQLAlchemy on **Neon Postgres**
- **Docs:** ReportLab (PDF), openpyxl (Excel), stdlib zip
- **AI:** Google Gemini via `google-genai` (`GEMINI_MODEL`, default `gemini-3.8-flash`, low thinking), JSON output validated with Pydantic, 20 s timeout, 2 retries, then template
- **Web:** Next.js 15 (App Router), TypeScript, Tailwind CSS 4, Framer Motion, TanStack Table
- **Hosting:** Vercel (Next.js + Python function at `api/index.py`, region `sin1`), Neon (`aws-ap-southeast-1`)

## Setup

Requirements: Python 3.11+, Node 20+, [uv](https://docs.astral.sh/uv/) (optional but faster).

```bash
cp .env.example .env      # fill in GEMINI_API_KEY and DATABASE_URL (Neon pooled URL)
make setup                # Python venv + npm install
```

`.env` keys: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_THINKING_LEVEL`, `DATABASE_URL`,
`APP_TIMEZONE=Asia/Kolkata`, `COMPANY_NAME`, `COMPANY_ADDRESS` (printed on every PO), and the Zoho
keys (`ZOHO_SYNC_ENABLED`, `ZOHO_DC`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`,
`ZOHO_ORGANIZATION_ID`, `ZOHO_MARK_ISSUED`). Never commit `.env`; keys are never logged.

**Connecting Zoho:** follow [docs/ZOHO_SETUP.md](docs/ZOHO_SETUP.md).

Neon project `freshroots-reorder-planner`, database **`freshroots`**: branch **`production`** for the live site,
branch **`development`** for local work and tests. Tables (created and migrated automatically on start-up):

| Table | Holds |
|---|---|
| `plan_runs` | One row per plan run: status, summary, config, rule book version, approval |
| `sap_upload_files` | Raw SAP files per run, with SHA-256 |
| `sku_master`, `distributor_master`, `weekly_sales`, `current_inventory`, `festival_calendar`, `judgment_overrides` | Readable copies of each SAP upload |
| `sku_plan_lines` | Engine result per SKU |
| `sku_approvals` | APPROVE line per SKU of an approved plan |
| `sku_ai_explanations` | Gemini / template explanation per SKU |
| `purchase_orders`, `purchase_order_lines` | POs per supplier, with Zoho status |
| `audit_log` | Who did what, when, before and after |

**User manual and flow chart:** [docs/USER_MANUAL.md](docs/USER_MANUAL.md), also on the site under **Guide**.

## How to run

```bash
make dev        # API on :8000 + site on :3000 (open http://localhost:3000)
make test       # pytest: golden test, 20 edge cases, API/PO, Gemini guardrail
make e2e        # Playwright end-to-end (starts servers if needed)
make plan       # RULEBOOK CLI on the October fixture -> output/2026-10/
```

CLI (RULEBOOK Section 15):

```bash
PYTHONPATH=src python -m reorder.cli --input tests/fixtures/oct_2026 --config config.yaml --output output --run-date 2026-10-19
```

Exit codes: 0 success, 1 FATAL validation failure, 2 pre-send check failed.

Sign in (local demo, no passwords) as **Analyst** (run on latest SAP data or upload, overrides,
retry a failed Zoho sync), **Raghav** (approve or reject the plan, nothing else) or **Procurement**
(approved plan, Zoho PO status, PO downloads). The API enforces the role
on every action via the `X-Role` header, and every action is written to the audit log with
who, when, what and the before/after values.

## Where the rules live

- `RULEBOOK.md` — the specification, v2.0. `[EXP]` (Raghav) overrides `[SPEC]`. Section 19 covers roles, approval, POs, Zoho and AI.
- `config.yaml` — every threshold. Nothing is hard-coded in logic.
- `src/reorder/` — `validate.py` (I1–I12), `calculate.py` (C1–C8, decision table), `flags.py` (R1–R4, J1–J3),
  `checks.py` (O1–O8), `output.py` (CSV/xlsx/run log). Rule IDs are commented beside each piece of logic.
- `calendar.csv` — the only source of festival months.

## How to change a threshold (RULEBOOK Section 16)

1. Raghav Kulkarni proposes the change; Deepa Nair (Head of Operations) signs off. Procurement can't change rules.
2. Edit `config.yaml` **and** the matching text in `RULEBOOK.md`; add a change-log row with the reason and approvers.
3. If expected results change, update the golden test in `RULEBOOK.md` 14.1 and `tests/test_golden.py` together, with the reason in the change log.
4. Run `make test` and `make e2e`. Every run stores the config text, its SHA-256 and the rule book version, so old runs stay reproducible.

## Known gaps

- **Lead times** — not in the data; "reorder now" doesn't model supplier lead time (Q6).
- **Stock on order** — not counted in cover; Zoho on-order data isn't connected (Q7).
- **Unit costs** — no prices; PO price columns print "—" with a note. Enter rates in Zoho.
- **Zoho matching** — vendors match on exact `Distributor_Name`, items on exact SKU; missing ones fail that PO with a reason (retryable).
- **No rates in Zoho** — POs are created without `purchase_rate`; set rates in Zoho before issuing.
- **Whole-plan approval** — R1 shortfalls aren't topped up and judgment-zone SKUs aren't ordered when a plan is approved (RULEBOOK v1.2).
- **Zoho CSV columns** — a generic PO import layout (`Purchase Order Number, Purchase Order Date, Vendor Name, Reference#, Item Name, SKU, Quantity, Usage unit, Rate, Notes`) that could not be verified against Zoho's live docs; map columns in Zoho's import wizard if a label differs.
- **Distributor-level behaviour** — sales are SKU-level, so unusual distributor behaviour enters only via overrides (J2).
- **Auth** — demo role picker only; add real sign-in before production use.
- **Scheduled drop folder** — uploads are manual; `run_plan()` takes a `{filename: bytes}` map so a twice-weekly folder watcher can call it later.
