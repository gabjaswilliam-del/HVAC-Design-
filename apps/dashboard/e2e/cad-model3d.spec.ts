import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openSample(page: Page, view = "3D") {
  await page.goto("/cad");
  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("radio", { name: view, exact: true }).click();
}

async function rendered(page: Page) {
  const host = page.locator(".cad-3d");
  await host.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => Number((document.querySelector(".cad-3d") as HTMLElement | null)?.dataset.frames) > 0);
  return host;
}

const stats = (page: Page) => page.locator(".cad-3d").evaluate((element) => ({ ...(element as HTMLElement).dataset }));

test("M3a renders lazily, selects equipment, synchronizes views, and idles", async ({ page }, testInfo) => {
  const requested: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("pageerror", (error) => errors.push(String(error)));
  await openSample(page, "Compare");
  expect(requested.some((url) => url.includes("/model3d/Plant3DCanvas"))).toBe(false);
  await page.getByRole("radio", { name: "3D", exact: true }).click();
  const host = await rendered(page);
  expect(requested.some((url) => url.includes("/model3d/Plant3DCanvas"))).toBe(true);
  const initial = await stats(page);
  expect(Number(initial.frames)).toBeGreaterThan(0);
  expect(Number(initial.equipment)).toBe(16);
  expect(Number(initial.runs)).toBe(41);
  expect(Number(initial.fittings)).toBe(20);
  // The M3a interaction contract now carries the complete M3b plant, with a bounded scene budget.
  expect(Number(initial.drawCalls)).toBeLessThan(250);
  expect(Number(initial.triangles)).toBeLessThan(40_000);
  expect(initial.zoom).toBe("1.0000");
  await page.screenshot({ path: testInfo.outputPath("m3a-desktop.png"), fullPage: true });

  await page.locator('[data-equipment-id="chiller_plant_1"]').click();
  await expect(page.locator("#cad-review-title")).toHaveText("Chiller 1");
  await expect(page.locator('[data-equipment-id="chiller_plant_1"]')).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("m3a-chiller-selected.png"), fullPage: true });
  await page.locator('[data-equipment-id="chilled_water_pump_pri_1"]').click();
  await expect(page.locator("#cad-review-title")).toHaveText("CHW pump 1");

  await page.getByRole("radio", { name: "Compare", exact: true }).click();
  await expect(page.locator("#cad-review-title")).toHaveText("CHW pump 1");
  await expect(page.getByRole("group", { name: "Plant scene" })).toBeVisible();
  await page.getByRole("radio", { name: "3D", exact: true }).click();
  await rendered(page);
  await expect(page.locator('[data-equipment-id="chilled_water_pump_pri_1"]')).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(async () => Number((await stats(page)).zoom)).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(async () => Number((await stats(page)).zoom)).toBeLessThan(1.3);
  await page.getByRole("button", { name: "Fit model", exact: true }).click();
  await expect.poll(async () => (await stats(page)).zoom).toBe("1.0000");
  await host.focus();
  await host.press("r");
  await expect.poll(async () => (await stats(page)).zoom).toBe("1.0000");

  await page.waitForTimeout(700);
  const idleFrames = (await stats(page)).frames;
  await page.waitForTimeout(400);
  expect((await stats(page)).frames).toBe(idleFrames);
  expect(errors).toEqual([]);
});

test("M3a has no serious or critical accessibility violations", async ({ page }) => {
  await openSample(page);
  await rendered(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});

test("M3a falls back to 2D when WebGL2 is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind === "webgl2" || kind === "webgl") return null;
      return original.call(this, kind, ...args);
    } as typeof original;
  });
  await openSample(page);
  await expect(page.getByText("3D is unavailable in this browser. Showing the 2D drawing.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Synthetic source drawing" }).first()).toBeVisible();
  await expect(page.locator(".cad-3d canvas")).toHaveCount(0);
});

test("M3a falls back to 2D after a graphics context loss", async ({ page }) => {
  await openSample(page);
  await rendered(page);
  await page.locator(".cad-3d canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2")!;
    gl.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(page.getByText("The 3D view stopped. Showing the 2D drawing.")).toBeVisible();
  await expect(page.getByRole("group", { name: "Synthetic source drawing" }).first()).toBeVisible();
});

test("M3a keeps touch targets and the Inspector usable on a phone", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  await openSample(page);
  await rendered(page);
  for (const name of ["Zoom out", "Zoom in", "Fit model", "Reset isometric view"]) {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const label = page.locator('[data-equipment-id="chiller_plant_1"]');
  await label.tap();
  await expect(page.locator("#cad-review-title")).toHaveText("Chiller 1");
  const canvas = await page.locator(".cad-wb__canvas").boundingBox();
  const inspector = await page.locator(".cad-insp").boundingBox();
  expect(inspector!.y).toBeGreaterThanOrEqual(canvas!.y + canvas!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("m3a-mobile.png"), fullPage: true });
  await context.close();
});
