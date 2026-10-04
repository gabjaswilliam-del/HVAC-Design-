import { test } from "@playwright/test";

// Captures review screenshots only when REVIEW_DIR is set; skipped in normal runs.
declare const process: { env: Record<string, string | undefined> };
const dir = process.env.REVIEW_DIR;

test.describe("review screenshots", () => {
  test.skip(!dir, "set REVIEW_DIR to capture review screenshots");

  test("monitoring at 1440x900", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/monitoring-1440.png`, fullPage: true });
  });

  test("monitoring scene detail at 2x", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    await page.goto("http://localhost:5173/");
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".monitoring__scene").screenshot({ path: `${dir}/scene-2x.png` });
    await page.close();
  });

  test("asset sheet", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    await page.goto("http://localhost:5173/asset-sheet.html");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/asset-sheet.png`, fullPage: true });
    const sections = page.locator("section");
    for (let i = 0; i < (await sections.count()); i++) {
      await sections.nth(i).screenshot({ path: `${dir}/asset-sheet-${i + 1}.png` });
    }
    await page.close();
  });
});
