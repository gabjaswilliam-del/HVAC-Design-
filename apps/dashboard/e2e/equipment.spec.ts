/** M4: Equipment page. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const rows = (page: Page) => page.locator("tbody tr[data-row]");
const inspector = (page: Page) => page.getByRole("complementary", { name: "Equipment inspector" });

async function open(page: Page, url = "/equipment") {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Equipment" })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

test("lists every item with state, readings and open issues", async ({ page }) => {
  await open(page, "/equipment?scenario=tower-fault");
  await expect(rows(page)).toHaveCount(16);
  await expect(page.getByText(/16 items in site configuration revision 1:/)).toContainText("1 fault");
  await expect(page.locator('[data-row="cooling_towers_4"]')).toContainText("Fault");
  await expect(page.locator('[data-row="cooling_towers_4"] td.num').nth(1)).toHaveText("1");
});

test("search and filters narrow the list and can be cleared", async ({ page }) => {
  await open(page, "/equipment?scenario=pump-trip&time=14:12");
  await page.getByLabel("Type").selectOption("chiller_plant");
  await expect(rows(page)).toHaveCount(3);
  await page.getByLabel("Type").selectOption("");
  await page.getByLabel("State").selectOption("fault");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-row", "chilled_water_pump_pri_2");
  await page.getByLabel("State").selectOption("");
  await page.getByLabel("Only with open issues").check();
  await expect(rows(page)).toHaveCount(3);
  await page.getByLabel("Search equipment").fill("zzz");
  await expect(page.getByText("No equipment matches these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(16);
  await page.getByLabel("Search equipment").fill("tower 4");
  await expect(rows(page)).toHaveCount(1);
});

test("selecting opens the shared inspector, updates the URL and keeps the filters", async ({ page }) => {
  await open(page);
  await page.getByLabel("Type").selectOption("cooling_towers");
  await page.getByRole("button", { name: "Cooling tower 2", exact: true }).click();
  await expect(page).toHaveURL(/\/equipment\/cooling_towers_2/);
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 2");
  await expect(rows(page)).toHaveCount(4);
  await inspector(page).getByRole("heading", { name: "Connections" }).waitFor();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/equipment(\?|$)/);
  await expect(page.getByRole("button", { name: "Cooling tower 2", exact: true })).toBeFocused();
});

test("deep links open equipment; unknown IDs explain themselves", async ({ page }) => {
  await open(page, "/equipment/chiller_plant_3");
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Chiller 3");
  await page.goto("/equipment/pump_99");
  await expect(inspector(page).getByRole("heading", { name: "Equipment not found" })).toBeVisible();
});

test("locate on plant opens monitoring with the equipment selected and centred", async ({ page }) => {
  await open(page, "/equipment/cooling_water_pump_2");
  await inspector(page).getByRole("button", { name: "Locate on plant" }).click();
  await expect(page).toHaveURL(/\/\?equipment=cooling_water_pump_2/);
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("CW pump 2");
  await expect.poll(async () => Number(await page.locator(".plant-viewport").getAttribute("data-zoom"))).toBeGreaterThanOrEqual(1);
  const box = (await page.locator(".plant-viewport__box > svg").boundingBox())!;
  const art = (await page.locator('.plant-viewport__box [data-equipment-id="cooling_water_pump_2"] .eq-node__art').boundingBox())!;
  expect(art.x).toBeGreaterThanOrEqual(box.x);
  expect(art.y + art.height).toBeLessThanOrEqual(box.y + box.height);
});

test("selection is shared with monitoring", async ({ page }) => {
  await open(page, "/equipment/chilled_water_pump_pri_1");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Monitoring" }).click();
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("CHW pump 1");
});

test("replay updates the list", async ({ page }) => {
  await open(page, "/equipment?scenario=tower-fault&time=13:10");
  await expect(page.locator('[data-row="cooling_towers_4"]')).toContainText("Running");
  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let i = 0; i < 3; i++) await slider.press("ArrowRight");
  await expect(page.locator('[data-row="cooling_towers_4"]')).toContainText("Fault");
});

test("narrow screens open the inspector full screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page.getByRole("button", { name: "Chiller 1", exact: true }).click();
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Chiller 1");
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(inspector(page)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("no serious accessibility violations with the inspector open", async ({ page }) => {
  await open(page, "/equipment/chiller_plant_1");
  await expect(inspector(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
