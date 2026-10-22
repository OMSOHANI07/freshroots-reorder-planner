# Connecting Zoho Inventory

When Raghav approves a plan, the app creates one purchase order per supplier in Zoho Inventory.
It needs an OAuth refresh token from a Zoho **Self Client**. This takes about 10 minutes.

## 1. Check master data in Zoho Inventory

The app matches by exact text, so these must exist in Zoho first:

| Freshroots data | Must match in Zoho Inventory |
|---|---|
| `distributor_master.csv` → `Distributor_Name` (e.g. `NutriFlow Distributors`) | A **vendor** contact with exactly that name |
| `sku_master.csv` → `SKU_ID` (e.g. `SKU001`) | An **item** whose **SKU** field is exactly that ID |

If a vendor or item is missing, that supplier's PO shows "Zoho sync failed" with the reason, and
procurement or the analyst can press **Retry Zoho** after fixing it in Zoho. Other suppliers' POs are not affected.

## 2. Create a Self Client

1. Open the Zoho API Console for your data center: India `https://api-console.zoho.in`
   (US `api-console.zoho.com`, EU `api-console.zoho.eu`).
2. **Add Client → Self Client → Create.** Copy the **Client ID** and **Client Secret**.
3. On the **Generate Code** tab, enter the scopes:

   ```
   ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.purchaseorders.UPDATE,ZohoInventory.contacts.READ,ZohoInventory.items.READ
   ```

   Pick a 10-minute duration, add a description, and press **Create**. Copy the code (it expires quickly).

## 3. Exchange the code for a refresh token

Run this once, within the code's lifetime (use `accounts.zoho.com` / `.eu` for other data centers):

```bash
curl -X POST https://accounts.zoho.in/oauth/v2/token -d grant_type=authorization_code -d client_id=YOUR_CLIENT_ID -d client_secret=YOUR_CLIENT_SECRET -d code=YOUR_CODE
```

Copy `refresh_token` from the response. It doesn't expire unless revoked.

## 4. Find the organization ID

In Zoho Inventory: **Settings → Organization Profile**. The Organization ID is shown there.

## 5. Add the variables to Vercel (and `.env` for local use)

Vercel → project **freshroots-reorder-planner** → Settings → Environment Variables → Production:

| Name | Value |
|---|---|
| `ZOHO_SYNC_ENABLED` | `true` (replace the existing `false`) |
| `ZOHO_DC` | `in` (or `com`, `eu`, `com.au`, `jp`, `ca`, `sa`) |
| `ZOHO_CLIENT_ID` | from step 2 |
| `ZOHO_CLIENT_SECRET` | from step 2 |
| `ZOHO_REFRESH_TOKEN` | from step 3 |
| `ZOHO_ORGANIZATION_ID` | from step 4 |
| `ZOHO_MARK_ISSUED` | `false` keeps new POs as Draft in Zoho; `true` marks them Issued |

Then redeploy (Deployments → ⋯ → Redeploy). Check it is connected:

```bash
curl https://freshroots-reorder-planner.vercel.app/api/health
```

`"zoho_status": "ready"` means POs will go to Zoho on the next approval.

## What the app sends

`POST https://www.zohoapis.in/inventory/v1/purchaseorders?organization_id=…&ignore_auto_number_generation=true`

- `purchaseorder_number`: the Freshroots PO number (`FR-PO-YYYYMMDD-DIST001-001`), which also makes retries safe
- `vendor_id`: looked up by vendor name
- `date`, `reference_number` (`Freshroots run N / YYYY-MM`), `notes` (who approved and when)
- `line_items`: `item_id` (looked up by SKU) and `quantity` (the approved quantity)
- no `purchase_rate`: the source data has no prices, so set rates in Zoho

Reference: https://www.zoho.com/inventory/api/v1/purchaseorders/
