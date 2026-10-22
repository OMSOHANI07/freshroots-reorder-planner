import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const FIX = path.join(__dirname, "..", "tests", "fixtures", "oct_2026");
const FILES = ["weekly_sales.csv", "sku_master.csv", "current_inventory.csv", "calendar.csv", "distributor_master.csv"].map((f) => path.join(FIX, f));

async function tile(page: Page, label: string) {
  return page.locator("div.rounded-\\[20px\\]", { has: page.getByText(label, { exact: true }) }).locator("span.tabular").first();
}

test("upload → run → review → finalise → download POs", async ({ page }, info) => {
  // Sign in as Raghav
  await page.goto("/signin");
  await page.getByRole("button", { name: /Raghav Kulkarni/ }).click();
  await expect(page).toHaveURL(/\/runs\/new/);

  // Upload the October files and run with run date 2026-10-19
  await page.getByTestId("file-input").setInputFiles(FILES);
  await page.getByLabel("Run date").fill("2026-10-19");
  await page.getByRole("button", { name: "Run the plan" }).click();
  await expect(page).toHaveURL(/\/runs\/\d+$/, { timeout: 60_000 });
  const runId = page.url().match(/runs\/(\d+)/)![1];

  // Summary: 5 reorder now, 2 paused, 8 healthy, 1,820 units, 4 flagged
  await expect(await tile(page, "Reorder now")).toHaveText("5");
  await expect(await tile(page, "Pause next order")).toHaveText("2");
  await expect(await tile(page, "Healthy")).toHaveText("8");
  await expect(await tile(page, "Units to order now")).toHaveText("1,820");
  await expect(await tile(page, "Flagged for Raghav")).toHaveText("4");

  // Review: approve SKU001 + SKU013, change SKU003 to 309, reject SKU007
  await page.goto(`/runs/${runId}/review`);
  const card = (sku: string) => page.locator(`article[aria-labelledby="t-${sku}"]`).first();
  await expect(card("SKU001")).toBeVisible();
  await card("SKU001").getByRole("button", { name: /^Approve/ }).click();
  await expect(card("SKU001").getByText(/Raghav: Approve/)).toBeVisible();
  await card("SKU013").getByRole("button", { name: /^Approve/ }).click();
  await expect(card("SKU013").getByText(/Raghav: Approve/)).toBeVisible();

  await card("SKU003").getByRole("button", { name: "Change" }).click();
  await card("SKU003").getByLabel("Final quantity").fill("309");
  await card("SKU003").getByLabel("Note (required)").fill("Top up to clear the 9-unit shortfall (R1)");
  await card("SKU003").getByRole("button", { name: "Save change" }).click();
  await expect(card("SKU003").getByText(/Raghav: Change · final 309 units/)).toBeVisible();

  await card("SKU007").getByRole("button", { name: "Reject" }).click();
  await card("SKU007").getByLabel("Note (required)").fill("Close call on cover; hold coconut water this cycle");
  await card("SKU007").getByRole("button", { name: "Save reject" }).click();
  await expect(card("SKU007").getByText(/Raghav: Reject · final 0 units/)).toBeVisible();

  await page.getByRole("button", { name: /Approve all 11 unflagged/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve all" }).click();
  const fin = page.getByRole("button", { name: "Finalise plan & generate POs" });
  await expect(fin).toBeEnabled();
  await fin.click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}/final$`), { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Purchase orders." })).toBeVisible();
  await expect(page.locator("article[aria-labelledby^='po-']")).toHaveCount(3);

  // Download PDF, Excel, CSV and ZIP
  const dir = info.outputPath("downloads");
  for (const label of ["All PDF", "All Excel", "All Zoho CSV", "All as ZIP"]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()]);
    await dl.saveAs(path.join(dir, dl.suggestedFilename()));
  }

  // Verify the files contain only approved quantities, grouped by supplier
  const out = execFileSync(path.join(__dirname, "..", ".venv", "bin", "python"),
    [path.join(__dirname, "..", "scripts", "verify_po_files.py"), dir], { encoding: "utf-8" });
  expect(out).toContain("PO FILES OK");
});
