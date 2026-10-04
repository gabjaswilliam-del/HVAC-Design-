/**
 * Milestone 3 acceptance (owner requirements recorded in VERSION_A.md):
 * 1 fit on open, 2 zoom controls, 3 wheel zoom at pointer + drag pan, 4 every
 * equipment clickable, 5 selection highlights pipes and opens the inspector,
 * 6 inspector never crops the schematic, 7 artwork preserved, 8 several desktop
 * resolutions and every equipment reachable by zoom and pan.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const IDS = [
  ...[1, 2, 3, 4].map((i) => `cooling_towers_${i}`),
  ...[1, 2, 3].map((i) => `chiller_plant_${i}`),
  ...[1, 2, 3, 4].map((i) => `cooling_water_pump_${i}`),
  ...[1, 2, 3, 4].map((i) => `chilled_water_pump_pri_${i}`),
  "terminal",
];
const LABELS: Record<string, string> = {
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`cooling_towers_${i}`, `Cooling tower ${i}`])),
  ...Object.fromEntries([1, 2, 3].map((i) => [`chiller_plant_${i}`, `Chiller ${i}`])),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`cooling_water_pump_${i}`, `CW pump ${i}`])),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`chilled_water_pump_pri_${i}`, `CHW pump ${i}`])),
  terminal: "Data hall",
};

const viewport = (page: Page) => page.locator(".plant-viewport__box > svg");
const node = (page: Page, id: string) => viewport(page).locator(`[data-equipment-id="${id}"]`);
const zoom = async (page: Page) => Number(await page.locator(".plant-viewport").getAttribute("data-zoom"));
const inspector = (page: Page) => page.getByRole("complementary", { name: "Equipment inspector" });

async function open(page: Page, url = "/") {
  await page.goto(url);
  await expect(node(page, "chiller_plant_1")).toBeVisible();
  // Readings loaded: the status line names the sample time.
  await expect(page.getByText(/Readings at/)).toBeVisible();
}

/** IDs whose artwork box is not fully inside the viewport box. */
async function outside(page: Page, ids = IDS) {
  const box = (await viewport(page).boundingBox())!;
  const out: string[] = [];
  for (const id of ids) {
    const b = (await node(page, id).locator(".eq-node__art").boundingBox())!;
    if (b.x < box.x - 1 || b.y < box.y - 1 || b.x + b.width > box.x + box.width + 1 || b.y + b.height > box.y + box.height + 1) out.push(id);
  }
  return out;
}

/** Fully visible, or, for equipment larger than the viewport, centred within it. */
async function reached(page: Page, id: string) {
  const box = (await viewport(page).boundingBox())!;
  const b = (await node(page, id).locator(".eq-node__art").boundingBox())!;
  if (b.width <= box.width && b.height <= box.height) return (await outside(page, [id])).length === 0;
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  return Math.abs(c.x - (box.x + box.width / 2)) < 40 && Math.abs(c.y - (box.y + box.height / 2)) < 40;
}

async function centre(page: Page, id: string) {
  const b = (await node(page, id).locator(".eq-node__art").boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe("1 and 8: fit to screen at desktop resolutions", () => {
  for (const [w, h] of [
    [1280, 720],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
    [2560, 1440],
  ]) {
    test(`whole plant visible on open at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await open(page);
      expect(await outside(page)).toEqual([]);
      // The schematic itself is within the browser window, not below the fold.
      const box = (await viewport(page).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(h);
    });
  }
});

test("2: zoom in, zoom out, 100% and fit to screen", async ({ page }) => {
  await open(page);
  const fitK = await zoom(page);
  const toolbar = page.getByRole("toolbar", { name: "Schematic controls" });
  await toolbar.getByRole("button", { name: "Zoom in" }).click();
  expect(await zoom(page)).toBeCloseTo(fitK * 1.25, 3);
  await toolbar.getByRole("button", { name: "Zoom out" }).click();
  await toolbar.getByRole("button", { name: "Zoom out" }).click();
  expect(await zoom(page)).toBeLessThan(fitK);
  await toolbar.getByRole("button", { name: /Actual size/ }).click();
  expect(await zoom(page)).toBe(1);
  await expect(toolbar.getByRole("button", { name: /Actual size/ })).toHaveText("100%");
  await toolbar.getByRole("button", { name: "Fit to screen" }).click();
  expect(await zoom(page)).toBeCloseTo(fitK, 4);
  expect(await outside(page)).toEqual([]);
});

test("3: wheel zoom keeps the equipment under the pointer in place", async ({ page }) => {
  await open(page);
  const before = await centre(page, "chiller_plant_2");
  const k0 = await zoom(page);
  await page.mouse.move(before.x, before.y);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => zoom(page)).toBeGreaterThan(k0 * 1.5);
  const after = await centre(page, "chiller_plant_2");
  expect(Math.abs(after.x - before.x)).toBeLessThan(3);
  expect(Math.abs(after.y - before.y)).toBeLessThan(3);
});

test("3: drag pans the plant, and a drag that starts on equipment does not select it", async ({ page }) => {
  await open(page);
  const start = await centre(page, "cooling_towers_1");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 30, { steps: 5 });
  await page.mouse.move(start.x + 150, start.y + 60, { steps: 5 });
  await page.mouse.up();
  const end = await centre(page, "cooling_towers_1");
  expect(end.x - start.x).toBeCloseTo(150, -1);
  expect(end.y - start.y).toBeCloseTo(60, -1);
  await expect(inspector(page)).toHaveCount(0);
});

test("4: every item of equipment is individually clickable", async ({ page }) => {
  await open(page);
  for (const id of IDS) {
    await page.getByRole("toolbar", { name: "Schematic controls" }).getByRole("button", { name: "Fit to screen" }).click();
    await node(page, id).locator(".eq-node__art").click();
    await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText(LABELS[id]);
    await expect(node(page, id)).toHaveAttribute("aria-pressed", "true");
  }
});

test("5: selection highlights connected pipelines and the inspector shows details", async ({ page }) => {
  await open(page);
  await node(page, "chiller_plant_2").locator(".eq-node__art").click();
  for (const link of [
    "cooling_water_pump_2_chiller_plant_2",
    "chiller_plant_2_cw_return",
    "chiller_plant_2_chilled_water_pump_pri_2",
    "chw_return_chiller_plant_2",
  ]) {
    await expect(viewport(page).locator(`[data-link-id="${link}"]`)).toHaveClass(/pipe--active/);
  }
  await expect(viewport(page).locator('[data-link-id="cooling_towers_1_out"]')).not.toHaveClass(/pipe--active/);
  await expect(node(page, "cooling_water_pump_2")).toHaveClass(/eq-node--related/);
  await expect(node(page, "cooling_towers_1")).not.toHaveClass(/eq-node--related/);

  const panel = inspector(page);
  await expect(panel.getByText("Running")).toBeVisible();
  await expect(panel.locator('[data-metric="chiller_plant_2:load_pct"]')).toContainText("%");
  await expect(panel.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Related issues" })).toBeVisible();
  await expect(panel.getByText("Inferred").first()).toBeVisible();
  await panel.getByRole("button", { name: "CW pump 2" }).click();
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("CW pump 2");
});

test("6: opening and closing the inspector refits instead of cropping", async ({ page }) => {
  await open(page);
  const fitWide = await zoom(page);
  await node(page, "chiller_plant_1").locator(".eq-node__art").click();
  await expect(inspector(page)).toBeVisible();
  await expect.poll(() => zoom(page)).toBeLessThan(fitWide);
  expect(await outside(page)).toEqual([]);

  // After a manual zoom the view is kept; Fit to screen recovers the whole plant.
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect((await outside(page)).length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Fit to screen" }).click();
  expect(await outside(page)).toEqual([]);

  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(inspector(page)).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBeCloseTo(fitWide, 3);
  await expect(node(page, "chiller_plant_1")).toBeFocused();
});

test("7: detailed equipment artwork is preserved in the interactive scene", async ({ page }) => {
  await open(page);
  expect(await viewport(page).locator(".eq-chiller").count()).toBe(3);
  expect(await viewport(page).locator(".eq-pump").count()).toBe(8);
  expect(await viewport(page).locator(".eq-tower").count()).toBe(4);
  // Each chiller drawing keeps its full detail (cabinet, shells, compressor, bolts...).
  expect(await node(page, "chiller_plant_1").locator(".eq-art *").count()).toBeGreaterThan(60);
  expect(await node(page, "cooling_towers_1").locator(".eq-fan path").count()).toBe(5);
});

test("8: every item of equipment is reachable by zooming in and panning", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  while ((await zoom(page)) < 2) await zoomIn.click();
  expect((await outside(page)).length).toBeGreaterThan(8);
  for (const id of IDS) {
    // Measure every time: selecting equipment opens the inspector and narrows the view.
    const box = (await viewport(page).boundingBox())!;
    const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Pan in steps until the equipment sits in the middle of the viewport.
    for (let i = 0; i < 12 && !(await reached(page, id)); i++) {
      const c = await centre(page, id);
      const dx = Math.max(-300, Math.min(300, mid.x - c.x));
      const dy = Math.max(-200, Math.min(200, mid.y - c.y));
      const from = { x: mid.x - dx / 2, y: mid.y - dy / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
      await page.mouse.up();
    }
    expect(await reached(page, id), id).toBe(true);
    await node(page, id).locator(".eq-node__art").click();
    await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText(LABELS[id]);
  }
});

test("keyboard: Enter selects focused equipment, Escape closes and restores focus", async ({ page }) => {
  await open(page);
  await node(page, "chilled_water_pump_pri_1").focus();
  await page.keyboard.press("Enter");
  await expect(inspector(page).getByRole("heading", { level: 2 })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  await expect(node(page, "chilled_water_pump_pri_1")).toBeFocused();
  await viewport(page).focus();
  const k0 = await zoom(page);
  await page.keyboard.press("+");
  expect(await zoom(page)).toBeGreaterThan(k0);
  await page.keyboard.press("0");
  expect(await zoom(page)).toBeCloseTo(k0, 4);
});

test("deep links select equipment; unknown IDs explain themselves", async ({ page }) => {
  await open(page, "/?equipment=cooling_towers_3");
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 3");
  await node(page, "chiller_plant_1").locator(".eq-node__art").click();
  await expect(page).toHaveURL(/equipment=chiller_plant_1/);
  await page.goto("/?equipment=pump_99");
  await expect(inspector(page).getByRole("heading", { name: "Equipment not found" })).toBeVisible();
});

test("locate on plant centres the equipment at 100% or more", async ({ page }) => {
  await open(page);
  await node(page, "terminal").locator(".eq-node__art").click();
  await inspector(page).getByRole("button", { name: "Locate on plant" }).click();
  await expect.poll(() => zoom(page)).toBeGreaterThanOrEqual(1);
  expect(await outside(page, ["terminal"])).toEqual([]);
});

test("playback and scenarios change the readings and states", async ({ page }) => {
  await open(page, "/?scenario=tower-fault&time=13:10");
  await expect(node(page, "cooling_towers_4")).toHaveAttribute("aria-label", /Running/);
  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let i = 0; i < 3; i++) await slider.press("ArrowRight");
  await expect(page.getByText(/Readings at 13:25/)).toBeVisible();
  await expect(node(page, "cooling_towers_4")).toHaveAttribute("aria-label", /Fault/);
  await expect(page.locator('[data-kpi="issues"] .kpi__value')).toHaveText("1");

  await page.getByLabel("Demo scenario").filter({ visible: true }).selectOption("normal");
  await expect(node(page, "cooling_towers_4")).toHaveAttribute("aria-label", /Stopped/);
  await expect(page.getByText(/Readings at 15:15/)).toBeVisible();
});

test("disconnected telemetry keeps last values, marked stale, and says so", async ({ page }) => {
  await open(page, "/?scenario=disconnected");
  await expect(page.getByRole("alert").filter({ hasText: "Telemetry disconnected" })).toBeVisible();
  await expect(node(page, "chiller_plant_1")).toHaveAttribute("aria-label", /Stale/);
  expect(await viewport(page).locator(".pipe-flow").count()).toBe(0);
});

test("scene revision mismatch falls back to the equipment list", async ({ page }) => {
  await page.goto("/?scenario=scene-mismatch");
  await expect(page.getByText("Scene does not match the site configuration")).toBeVisible();
  await expect(page.getByRole("button", { name: "Schematic" })).toBeDisabled();
  await page.getByRole("button", { name: "Chiller 2", exact: true }).click();
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Chiller 2");
});

test("a failed readings request shows a retryable error", async ({ page }) => {
  await page.goto("/?fail=snapshot:timeout");
  await expect(page.getByText(/Could not load readings/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
});

test("forecast summary shows the site-wide forecast and links to its exact ID", async ({ page }) => {
  await open(page);
  const summary = page.locator(".forecast-summary");
  await expect(summary.getByText("Seasonal-profile baseline", { exact: false })).toBeVisible();
  const id = await summary.getAttribute("data-forecast-id");
  expect(id).toMatch(/^fc-normal-/);
  await expect(summary.getByRole("link", { name: "View forecast" })).toHaveAttribute("href", `/prediction?forecast=${encodeURIComponent(id!)}`);
});

test("narrow screens default to the list and open the inspector full screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "CHW pump 2", exact: true }).click();
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("CHW pump 2");
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(inspector(page)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("no serious accessibility violations with the inspector open", async ({ page }) => {
  await open(page);
  await node(page, "chiller_plant_1").locator(".eq-node__art").click();
  await expect(inspector(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
