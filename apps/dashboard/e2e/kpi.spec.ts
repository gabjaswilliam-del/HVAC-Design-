/** KPI cards and the indicator details panel on the monitoring screen. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const KPIS: [string, string][] = [
  ["plant:cooling_demand_kw", "Cooling demand"],
  ["plant:cooling_delivered_kw", "Cooling delivered"],
  ["plant:power_kw", "Plant electrical power"],
  ["plant:cop", "System COP"],
  ["chw_supply:temp_c", "CHW supply temperature"],
  ["plant:chw_delta_t_c", "CHW ΔT"],
  ["plant:approach_c", "Condenser approach"],
  ["weather:wet_bulb_c", "Wet bulb"],
  ["issues", "Open issues"],
];

const card = (page: Page, key: string) => page.locator(`button[data-kpi="${key}"]`);
const panel = (page: Page) => page.getByRole("complementary", { name: "Indicator details" });
const inspector = (page: Page) => page.getByRole("complementary", { name: "Equipment inspector" });
const viewport = (page: Page) => page.locator(".plant-viewport__box > svg");
const zoom = async (page: Page) => Number(await page.locator(".plant-viewport").getAttribute("data-zoom"));

async function open(page: Page, url = "/") {
  await page.goto(url);
  await expect(page.locator(".monitoring__status")).toContainText("Readings at");
  await expect(viewport(page).locator("[data-equipment-id]")).toHaveCount(16);
}

test("every KPI card opens its details panel; Escape closes it and returns focus", async ({ page }) => {
  await open(page);
  for (const [key, title] of KPIS) {
    await card(page, key).click();
    await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(title);
    await expect(card(page, key)).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page).getByText(/Synthetic scenario value/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`kpi=${encodeURIComponent(key).replace(/%3A/g, "(:|%3A)")}`));
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(card(page, key)).toBeFocused();
  }
});

test("clicking the open card again closes the panel; the schematic refits each way", async ({ page }) => {
  await open(page);
  const wide = await zoom(page);
  await card(page, "plant:cop").click();
  await expect(panel(page)).toBeVisible();
  await expect.poll(() => zoom(page)).toBeLessThan(wide);
  await card(page, "plant:cop").click();
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBeCloseTo(wide, 2);
});

test("indicator panels explain, show inputs, quality, trend and related equipment", async ({ page }) => {
  await open(page);
  await card(page, "plant:cop").click();
  const p = panel(page);
  await expect(p.getByRole("heading", { name: "What it shows" })).toBeVisible();
  await expect(p.getByText("Cooling delivered ÷ plant electrical power.")).toBeVisible();
  await expect(p.locator('[data-reading="plant:power_kw"]')).toContainText("kW");
  await expect(p.getByRole("heading", { name: "Data quality" })).toBeVisible();
  await expect(p.getByText("All inputs are current.")).toBeVisible();
  await expect(p.getByRole("img", { name: /System COP/ })).toBeVisible();
  await expect(p.locator("[data-equipment-row]")).toHaveCount(3);

  await card(page, "plant:power_kw").click();
  const rows = panel(page).locator("[data-equipment-row]");
  expect(await rows.count()).toBeGreaterThan(10);
  // Breakdown is ordered by reported power, largest first.
  await expect(rows.first()).toHaveAttribute("data-equipment-row", /chiller_plant_/);
});

test("Open issues lists the scenario's active issues with equipment, status and evidence", async ({ page }) => {
  await open(page, "/?scenario=tower-fault");
  await card(page, "issues").click();
  const p = panel(page);
  await expect(p.locator("[data-issue]")).toHaveCount(2);
  const fault = p.locator('[data-issue="ISS-0142"]');
  await expect(fault).toContainText("Critical, investigating, ISS-0142");
  await expect(fault).toContainText("Cooling tower 4 fan fault");
  await expect(fault).toContainText("Scenario description (synthetic)");
  await expect(fault.locator('[data-reading="cooling_towers_4:frequency_hz"]')).toContainText("0.0 Hz");
  await expect(fault.locator('[data-equipment-row="cooling_towers_4"]')).toContainText("Fault");
  // Affected equipment is pointed out on the schematic while the panel is open.
  await expect(viewport(page).locator('[data-equipment-id="cooling_towers_4"]')).toHaveClass(/eq-node--highlighted/);
  await expect(p.locator('[data-issue="ISS-0143"]')).toContainText("Warning, detected");
});

test("issue actions locate equipment on the plant and open its inspector", async ({ page }) => {
  await open(page, "/?scenario=tower-fault&kpi=issues");
  const row = panel(page).locator('[data-issue="ISS-0142"] [data-equipment-row="cooling_towers_4"]');
  await row.getByRole("button", { name: "Locate Cooling tower 4" }).click();
  await expect.poll(() => zoom(page)).toBeGreaterThanOrEqual(1);
  const box = (await viewport(page).boundingBox())!;
  const art = (await viewport(page).locator('[data-equipment-id="cooling_towers_4"] .eq-node__art').boundingBox())!;
  expect(art.x).toBeGreaterThanOrEqual(box.x);
  expect(art.x + art.width).toBeLessThanOrEqual(box.x + box.width);
  await expect(panel(page)).toBeVisible();

  await row.getByRole("button", { name: "Inspect Cooling tower 4" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
  await expect(card(page, "issues")).toHaveAttribute("aria-pressed", "false");
});

test("Open issues says plainly when there are none", async ({ page }) => {
  await open(page, "/?kpi=issues");
  await expect(panel(page).getByText("No open issues at 15:15 UTC+8 in this scenario.")).toBeVisible();
});

test("demand and delivered panels identify a shortfall, and replay keeps card and panel consistent", async ({ page }) => {
  await open(page, "/?scenario=pump-trip&time=14:12&kpi=plant:cooling_delivered_kw");
  const p = panel(page);
  await expect(p.getByRole("alert")).toContainText("Shortfall now");
  await expect(p.locator("[data-shortfall-periods]")).toContainText("14:05–ongoing");
  await expect(p.getByText(/Running capacity is the rated capacity/)).toBeVisible();
  const cardValue = await card(page, "plant:cooling_delivered_kw").locator(".kpi__value").innerText();
  const panelValue = await p.locator(".kpi-panel__value").innerText();
  expect(panelValue.replace(/\s+/g, " ")).toContain(cardValue.replace(/\s+/g, " ").split(" ")[0]);

  // Replay past the recovery: no shortfall now, the earlier period remains.
  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let i = 0; i < 6; i++) await slider.press("ArrowRight");
  await expect(page.locator(".monitoring__status")).toContainText("Readings at 14:40");
  await expect(p.getByText("No shortfall now: delivered cooling meets demand.")).toBeVisible();
  await expect(p.locator("[data-shortfall-periods]")).toContainText("14:05–14:15");
  expect((await p.locator(".kpi-panel__value").innerText()).split(/\s/)[0]).toBe(
    (await card(page, "plant:cooling_delivered_kw").locator(".kpi__value").innerText()).split(/\s/)[0],
  );

  await card(page, "plant:cooling_demand_kw").click();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Cooling demand");
  await expect(panel(page).getByRole("heading", { name: "Demand against delivered cooling" })).toBeVisible();
});

test("the panel follows scenario changes", async ({ page }) => {
  await open(page, "/?scenario=tower-fault&kpi=issues");
  await expect(panel(page).locator("[data-issue]")).toHaveCount(2);
  await page.getByLabel("Demo scenario").filter({ visible: true }).selectOption("normal");
  await expect(panel(page).getByText(/No open issues/)).toBeVisible();
  await expect(viewport(page).locator(".eq-node--highlighted")).toHaveCount(0);
});

test("stale and missing inputs are reported, never filled in", async ({ page }) => {
  await open(page, "/?scenario=disconnected&kpi=plant:cop");
  await expect(panel(page).locator(".kpi-panel__quality")).toHaveText("Stale");
  await expect(panel(page).getByText(/2 stale|3 stale/)).toBeVisible();

  await page.goto("/?scenario=sensor-issues&kpi=issues");
  const ev = panel(page).locator('[data-issue="ISS-0161"] [data-reading="chw_return:pressure_kpa"]');
  await expect(ev).toContainText("Unavailable");
});

test("selecting equipment on the plant replaces the indicator panel with the inspector", async ({ page }) => {
  await open(page, "/?kpi=plant:approach_c");
  await expect(viewport(page).locator('[data-equipment-id="cooling_towers_1"]')).toHaveClass(/eq-node--highlighted/);
  await viewport(page).locator('[data-equipment-id="chiller_plant_1"] .eq-node__art').click();
  await expect(panel(page)).toHaveCount(0);
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Chiller 1");
  await card(page, "plant:approach_c").click();
  await expect(inspector(page)).toHaveCount(0);
  await expect(panel(page)).toBeVisible();
});

test("keyboard: cards are reachable and operable", async ({ page }) => {
  await open(page);
  await card(page, "plant:cop").focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("heading", { level: 2 })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card(page, "plant:cop")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card(page, "chw_supply:temp_c")).toBeFocused();
  await page.keyboard.press(" ");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("CHW supply temperature");
});

for (const [w, h] of [
  [1024, 768],
  [1280, 720],
  [1920, 1080],
]) {
  test(`panel and schematic both fit at ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await open(page, "/?scenario=tower-fault&kpi=issues");
    await expect(panel(page)).toBeVisible();
    const box = (await viewport(page).boundingBox())!;
    for (const id of ["cooling_towers_1", "terminal", "cooling_water_pump_4"]) {
      const b = (await viewport(page).locator(`[data-equipment-id="${id}"] .eq-node__art`).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

test("narrow screens show the panel full screen and close back to the dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?scenario=tower-fault");
  await card(page, "issues").click();
  await expect(panel(page).locator("[data-issue]")).toHaveCount(2);
  await page.getByRole("button", { name: "Close indicator details" }).click();
  await expect(panel(page)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("no serious accessibility violations with an indicator panel open", async ({ page }) => {
  await open(page, "/?scenario=pump-trip&time=14:12&kpi=plant:cooling_demand_kw");
  await expect(panel(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
