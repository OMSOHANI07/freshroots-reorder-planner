// QA: accessibility (axe), phone layout, keyboard, role guards. Read-only: safe to run against production.
// E2E_BASE_URL=https://freshroots-reorder-planner.vercel.app npx playwright test e2e/qa.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, devices, type Page } from "@playwright/test";
import fs from "node:fs";

const RUN = process.env.QA_RUN_ID ?? "13";
const PAGES: [string, string | null][] = [
  ["/", null], ["/guide", null], ["/signin", null], ["/", "raghav"], ["/runs", "procurement"],
  [`/runs/${RUN}`, "raghav"], [`/runs/${RUN}/final`, "procurement"], ["/data", "procurement"],
  ["/history", "procurement"], ["/runs/new", "analyst"],
];
const results: Record<string, unknown> = {};

async function as(page: Page, role: string | null) {
  await page.addInitScript((r) => { if (r) localStorage.setItem("fr-role", r); else localStorage.removeItem("fr-role"); }, role);
}

test.describe("UI-A11Y axe scan", () => {
  for (const [path, role] of PAGES) {
    test(`${path} as ${role ?? "visitor"}`, async ({ page }) => {
      await as(page, role);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, sample: x.nodes[0]?.target.join(" ") }));
      results[`${path} (${role ?? "visitor"})`] = v;
      expect(v.filter((x) => x.impact === "critical" || x.impact === "serious"), JSON.stringify(v)).toEqual([]);
    });
  }
  test.afterAll(() => {
    fs.mkdirSync("test-results", { recursive: true });
    fs.writeFileSync("test-results/qa_axe.json", JSON.stringify(results, null, 2));
  });
});

test.describe("UI-MOBILE phone layout", () => {
  const { defaultBrowserType: _ignored, ...phone } = devices["iPhone 13"];
  test.use(phone);
  for (const [path, role] of PAGES) {
    test(`${path} fits a phone (${role ?? "visitor"})`, async ({ page }) => {
      await as(page, role);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      expect(sw).toBeLessThanOrEqual(iw);
    });
  }
  test("menu opens and navigates on a phone", async ({ page }) => {
    await as(page, "procurement");
    await page.goto("/");
    await page.getByRole("button", { name: "Menu" }).click();
    await page.locator("#mobile-nav").getByRole("link", { name: "Data" }).click();
    await expect(page).toHaveURL(/\/data$/);
  });
});

test.describe("UI-KEYS keyboard and focus", () => {
  test("skip link, visible focus, drawer opens with Enter and closes with Escape", async ({ page }) => {
    await as(page, "raghav");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/runs/${RUN}`);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const row = page.getByRole("row", { name: "SKU003 details" });
    await row.focus();
    const outline = await row.evaluate((el) => getComputedStyle(el).outlineStyle + getComputedStyle(el).backgroundColor);
    expect(outline).not.toBe("");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Brown Rice 1kg")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("UI-ROLES role guards", () => {
  test("signed-out visitor is asked to sign in", async ({ page }) => {
    await as(page, null);
    await page.goto("/runs");
    await expect(page.getByRole("heading", { name: "Sign in to continue." })).toBeVisible();
  });
  test("procurement can't open New run; Raghav sees no Approve on a decided plan", async ({ page }) => {
    await as(page, "procurement");
    await page.goto("/runs/new");
    await expect(page.getByRole("heading", { name: "Not for this role." })).toBeVisible();
    await as(page, "raghav");
    await page.goto(`/runs/${RUN}`);
    await expect(page.getByRole("button", { name: "Approve plan" })).toHaveCount(0);
  });
  test("only procurement sees Complete order; no link to ERPNext login anywhere", async ({ page }) => {
    await as(page, "raghav");
    await page.goto(`/runs/${RUN}/final`);
    await expect(page.getByRole("heading", { name: "Purchase orders." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete order" })).toHaveCount(0);
    await as(page, "procurement");
    await page.goto(`/runs/${RUN}/final`);
    await expect(page.getByRole("button", { name: "Complete order" }).first()).toBeVisible();
    expect(await page.locator("a[href*='frappe']").count()).toBe(0);
  });
});
