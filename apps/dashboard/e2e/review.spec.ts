import { test } from "@playwright/test";

// Captures review screenshots only when REVIEW_DIR is set; skipped in normal runs.
declare const process: { env: Record<string, string | undefined> };
const dir = process.env.REVIEW_DIR;

const sizes = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

test.describe("review screenshots", () => {
  test.skip(!dir, "set REVIEW_DIR to capture review screenshots");

  for (const size of sizes) {
    test(`monitoring at ${size.name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      await page.getByRole("button", { name: /Chiller 1/ }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${dir}/monitoring-${size.name}.png` });
      await page.getByRole("button", { name: /Chiller 2,/ }).click();
      await page.getByRole("complementary", { name: "Equipment inspector" }).waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${dir}/monitoring-${size.name}-inspector.png` });
    });
  }

  test("monitoring full page, tower fault scenario", async ({ page }) => {
    await page.goto("/?scenario=tower-fault");
    await page.getByRole("button", { name: /Cooling tower 4/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${dir}/monitoring-tower-fault-full.png`, fullPage: true });
  });

  test("monitoring at 390 wide", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("table").waitFor();
    await page.screenshot({ path: `${dir}/monitoring-390.png`, fullPage: true });
  });

  test("asset sheet", async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
    await page.goto("http://localhost:5173/asset-sheet.html");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/asset-sheet.png`, fullPage: true });
    await page.close();
  });
});
