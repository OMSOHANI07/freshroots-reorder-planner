// Builds docs/Freshroots_Reorder_Planner_User_Manual.pdf from docs/manual.html.
// Usage: node scripts/build_manual_pdf.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(root, "docs", "manual.html")).href);
await page.pdf({
  path: path.join(root, "docs", "Freshroots_Reorder_Planner_User_Manual.pdf"),
  format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: '<div style="font-size:8px;color:#86868b;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Helvetica"><span>Freshroots Reorder Planner · User Manual</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
});
await browser.close();
console.log("Wrote docs/Freshroots_Reorder_Planner_User_Manual.pdf");
