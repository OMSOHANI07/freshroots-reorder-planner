import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const FIX = path.join(__dirname, "..", "tests", "fixtures", "oct_2026");
const FILES = ["weekly_sales.csv", "sku_master.csv", "current_inventory.csv", "calendar.csv", "distributor_master.csv"].map((f) => path.join(FIX, f));

function tile(page: Page, label: string) {
  return page.locator("div.rounded-\\[22px\\]", { has: page.getByText(label, { exact: true }) }).locator("span.tabular").first();
}

function legend(page: Page, label: string) {
  return page.locator("li", { hasText: new RegExp(`^${label} \\d`) }).locator("span.tabular");
}

async function signIn(page: Page, who: RegExp) {
  await page.goto("/signin");
  await page.getByRole("button", { name: who }).click();
}

test("analyst uploads → Raghav approves → POs to Zoho + downloads", async ({ page }, info) => {
  await signIn(page, /^Data and runs Analyst/);
  await expect(page).toHaveURL(/\/runs\/new/);
  await page.getByRole("radio", { name: /Upload new files/ }).click();
  await page.getByTestId("file-input").setInputFiles(FILES);
  await page.getByText("More options").click();
  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByRole("button", { name: "Run the plan" }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/, { timeout: 60_000 });
  const runId = page.url().match(/runs\/(\d+)/)![1];

  // Summary: 5 reorder now, 2 paused, 8 healthy, 1,820 units, 4 flagged
  await expect(tile(page, "SKUs to reorder now")).toHaveText("5");
  await expect(tile(page, "Units to order")).toHaveText("1,820");
  await expect(tile(page, "Flagged for a closer look")).toHaveText("4");
  await expect(legend(page, "Pause")).toHaveText("2");
  await expect(legend(page, "Healthy")).toHaveText("8");
  await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(0); // analyst can't approve

  // Raghav: approve the whole plan
  await signIn(page, /Raghav Kulkarni/);
  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole("heading", { name: "Approve this plan?" })).toBeVisible();
  await page.getByRole("button", { name: "Approve plan" }).click();
  await page.getByLabel("Note (optional)").fill("Approved for October festival stock");
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/final$`), { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Purchase orders." })).toBeVisible();
  const tiles = page.locator("article[aria-labelledby^='po-']");
  await expect(tiles).toHaveCount(3);
  // each PO is either in Zoho or shows why it isn't (no credentials locally)
  for (const t of await tiles.all()) {
    await expect(t.getByText(/In Zoho Inventory as|Zoho not connected|not found in Zoho/)).toBeVisible();
  }

  const dir = info.outputPath("downloads");
  for (const label of ["All PDF", "All Excel", "All Zoho CSV", "All as ZIP"]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()]);
    await dl.saveAs(path.join(dir, dl.suggestedFilename()));
  }
  const out = execFileSync(path.join(__dirname, "..", ".venv", "bin", "python"),
    [path.join(__dirname, "..", "scripts", "verify_po_files.py"), dir], { encoding: "utf-8" });
  expect(out).toContain("PO FILES OK");
});

test("analyst reuses latest SAP data → Raghav rejects", async ({ page }) => {
  await signIn(page, /^Data and runs Analyst/);
  await expect(page.getByRole("radio", { name: /Latest SAP data/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText(/stock as of 2026-10-19/)).toBeVisible();
  await page.getByText("More options").click();
  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByRole("button", { name: "Run the plan" }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/, { timeout: 60_000 });
  const runId = page.url().match(/runs\/(\d+)/)![1];
  await page.getByRole("button", { name: "Details and downloads" }).click();
  await expect(page.getByText(/Latest SAP data \(from plan #\d+\)/)).toBeVisible();

  await signIn(page, /Raghav Kulkarni/);
  await page.goto(`/runs/${runId}`);
  await page.getByRole("button", { name: "Reject plan" }).click();
  await page.getByRole("button", { name: "Confirm rejection" }).click();
  await expect(page.getByText("Add a note saying why the plan is rejected.")).toBeVisible();
  await page.getByLabel(/Why are you rejecting it/).fill("Re-run after Thursday's SAP refresh");
  await page.getByRole("button", { name: "Confirm rejection" }).click();
  await expect(page.getByText("Raghav rejected this plan. No POs were created.")).toBeVisible({ timeout: 30_000 });
});

test("data page and guide", async ({ page }) => {
  await page.goto("/guide");
  await expect(page.getByRole("heading", { name: "How it works." })).toBeVisible();
  await page.getByRole("tab", { name: "Raghav" }).click();
  await expect(page.getByText(/Press Approve plan/)).toBeVisible();
  await signIn(page, /Procurement/);
  await page.goto("/data");
  await expect(page.getByText("SKU001", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Suppliers" }).click();
  await expect(page.getByText("NutriFlow Distributors", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Festival calendar" }).click();
  await expect(page.getByLabel("Oct 2026, festival month")).toBeVisible();
});
