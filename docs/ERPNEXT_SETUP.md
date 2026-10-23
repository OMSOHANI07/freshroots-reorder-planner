# Connecting ERPNext

When Raghav approves a plan, the app creates one purchase order per supplier in ERPNext.
It needs one API key and secret. There's no OAuth and nothing expires. About 15 minutes.

## 1. Get an ERPNext site

- **Hosted (easiest):** sign up at https://frappecloud.com and create an ERPNext site,
  e.g. `freshroots.frappe.cloud`. Or use the free trial at https://erpnext.com.
- **Already have ERPNext:** use your existing site. It must be reachable over `https://`.

Finish the setup wizard: company **Freshroots**, country **India**, currency **INR**.

## 2. Add the master data

The app matches by exact text, so these must exist in ERPNext first:

| Freshroots data | Must match in ERPNext |
|---|---|
| `distributor_master.csv` → `Distributor_Name` (e.g. `NutriFlow Distributors`) | A **Supplier** with exactly that name |
| `sku_master.csv` → `SKU_ID` (e.g. `SKU001`) | An **Item** whose **Item Code** is exactly that ID (Maintain Stock ticked) |

If you give the API user permission to create suppliers and items, the planner team can load
these for you from the latest SAP upload. Otherwise, add them in ERPNext under **Buying → Supplier**
and **Stock → Item** (or import them with **Data Import**).

## 3. Create an API user and keys

1. **Settings → User → New**: e.g. `planner-api@your-domain`, with roles **Purchase User** and
   **Purchase Manager** (add **Item Manager** if the planner may create items).
2. Open that user → **Settings** tab → **API Access** → **Generate Keys**.
3. Copy the **API Key** and the **API Secret**. The secret is shown only once.

## 4. Add the variables to Vercel (and `.env` for local use)

Vercel → project **freshroots-reorder-planner** → Settings → Environment Variables → Production:

| Name | Value |
|---|---|
| `ERP_SYNC_ENABLED` | `true` |
| `ERPNEXT_URL` | `https://your-site.frappe.cloud` (no trailing slash) |
| `ERPNEXT_API_KEY` | from step 3 |
| `ERPNEXT_API_SECRET` | from step 3 |
| `ERPNEXT_COMPANY` | the company name exactly as in ERPNext, e.g. `Freshroots` |
| `ERPNEXT_WAREHOUSE` | optional, e.g. `Pune Central Warehouse - FR` |
| `ERPNEXT_SUBMIT` | `false` keeps new POs as Draft (recommended); `true` submits them |

Redeploy, then check:

```bash
curl https://freshroots-reorder-planner.vercel.app/api/health
```

`"erp_status": "ready"` means POs go to ERPNext on the next approval.

## What the app sends

`POST {ERPNEXT_URL}/api/resource/Purchase Order` with header `Authorization: token <key>:<secret>`:

- `title`: the Freshroots PO number (`FR-PO-YYYYMMDD-DIST001-001`), which makes retries safe
- `supplier`, `company`, `transaction_date` (approval date)
- `schedule_date` (Required By) = the PO date, since lead times aren't in the data; set the real date in ERPNext
- `items`: `item_code` (= SKU) and `qty` (the approved quantity); no `rate`, since the data has no prices
- `remarks`: the plan number, who approved it and when

Reference: https://docs.frappe.io/framework/user/en/api/rest
