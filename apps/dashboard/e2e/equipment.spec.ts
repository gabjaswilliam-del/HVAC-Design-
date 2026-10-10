/**
 * Equipment (F7): the roster is the Overview's list view, `/equipment` redirects to it,
 * Engineering is a hub, and `/equipment/:id` is the equipment record.
 */
import { expect, test, type Page } from "@playwright/test";

const rows = (page: Page) => page.locator("tbody tr[data-row]");
const inspector = (page: Page) => page.getByRole("complementary", { name: "Equipment inspector" });
const filters = (page: Page) => page.getByRole("search", { name: "Filter equipment" });

async function openList(page: Page, query = "") {
  await page.goto(`/?view=list${query}`);
  await expect(rows(page).first()).toBeVisible();
}

test("/equipment redirects to the Overview's list, keeping the demo context", async ({ page }) => {
  await page.goto("/equipment?scenario=tower-fault&time=14:00");
  await expect(page).toHaveURL(/\/\?.*view=list/);
  await expect(page).toHaveURL(/scenario=tower-fault/);
  await expect(page.getByRole("radio", { name: "Equipment list" })).toHaveAttribute("aria-checked", "true");
  await expect(rows(page)).toHaveCount(16);
  await expect(page.locator(".clock__time")).toContainText("14:00");
});

test("the list puts faults and open issues first, with severity marks and labelled data-hall readings", async ({ page }) => {
  await openList(page, "&scenario=tower-fault");
  await expect(rows(page).first()).toHaveAttribute("data-row", "cooling_towers_4");
  await expect(rows(page).first()).toContainText("Fault");
  await expect(rows(page).first()).toContainText("Critical, ISS-0142");
  await expect(rows(page).nth(1)).toContainText("Warning, ISS-0143");
  await expect(page.locator('[data-row="terminal"]')).toContainText(/Demand [\d,]+ kWt, delivered [\d,]+ kWt/);
  // A tower's readings are its fan's.
  await expect(page.locator('[data-row="cooling_towers_1"]')).toContainText(/Fan [\d.]+ Hz, [\d.]+ kW/);
  // States read as icon and word: Running a check in a circle, Stopped a dashed circle.
  await expect(page.locator('[data-row="cooling_towers_1"] .state-label--running svg')).toHaveClass(/lucide-circle-check/);
  await expect(page.locator('[data-row="cooling_water_pump_4"] .state-label--stopped svg')).toHaveClass(/lucide-circle-dashed/);
});

test("all sixteen rows fit the display at 1440x900", async ({ page }) => {
  await openList(page, "&scenario=tower-fault");
  await expect(rows(page)).toHaveCount(16);
  const stage = (await page.locator(".stage").boundingBox())!;
  const last = (await rows(page).last().boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(stage.y + stage.height - 5);
});

test("search and filters narrow the list with a live count and can be cleared", async ({ page }) => {
  await openList(page, "&scenario=pump-trip&time=14:12");
  const f = filters(page);
  await expect(f.getByText("Showing 16 of 16")).toBeVisible();
  await f.getByLabel("Type").selectOption("chiller_plant");
  await expect(rows(page)).toHaveCount(3);
  await f.getByLabel("Type").selectOption("");
  await f.getByLabel("State").selectOption("fault");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute("data-row", "chilled_water_pump_pri_2");
  await f.getByLabel("State").selectOption("");
  await f.getByLabel("Only with open issues").check();
  await expect(rows(page)).toHaveCount(3);
  await expect(f.getByText("Showing 3 of 16")).toBeVisible();
  await f.getByLabel("Find equipment").fill("zzz");
  await expect(page.getByText("No equipment matches these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(rows(page)).toHaveCount(16);
  await f.getByLabel("Find equipment").fill("tower 4");
  await expect(rows(page)).toHaveCount(1);
});

test("rows open Details; the list keeps its filters and focus returns to the row", async ({ page }) => {
  await openList(page);
  await filters(page).getByLabel("Type").selectOption("cooling_towers");
  await page.getByRole("button", { name: "Cooling tower 2", exact: true }).click();
  await expect(page).toHaveURL(/equipment=cooling_towers_2/);
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 2");
  await expect(rows(page)).toHaveCount(4);
  await inspector(page).getByRole("heading", { name: "Connections" }).waitFor();
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cooling tower 2", exact: true })).toBeFocused();
});

test("replay updates the list", async ({ page }) => {
  await openList(page, "&scenario=tower-fault&time=13:10");
  await expect(page.locator('[data-row="cooling_towers_4"]')).toContainText("Running");
  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let i = 0; i < 3; i++) await slider.press("ArrowRight");
  await expect(page.locator('[data-row="cooling_towers_4"]')).toContainText("Fault");
});

test("Engineering is a hub: investigations, records, Simulation, then CAD as a planned row", async ({ page }) => {
  await page.goto("/engineering?scenario=tower-fault");
  // The page header, then four flat sections.
  await expect(page.locator(".hub .page__head h2")).toHaveText("Engineering");
  await expect(page.locator(".hub .page__head")).toContainText("Investigations, equipment records, simulation and CAD for this plant.");
  const headings = page.locator(".hub__section h2");
  await expect(headings).toHaveText(["Investigations", "Equipment records", "Simulation history", "CAD and topology"]);
  // M6: Simulation is a labelled mock service; runs start in AI Pilot and are kept in the history.
  await expect(page.locator("#hub-simulation")).toContainText("Mock simulation service");
  await expect(page.locator("#hub-simulation")).toContainText("No simulation is running.");
  await expect(page.locator("#hub-simulation").getByRole("link", { name: "Open Simulation history" })).toHaveAttribute("href", "/simulation");
  await expect(page.locator("#hub-simulation").getByRole("button", { name: "Set up a simulation in AI Pilot" })).toBeVisible();
  await expect(page.locator("#hub-simulation")).not.toContainText("Planned");
  await expect(page.locator("#hub-cad")).toContainText("Needs the CAD service");
  // Real topology evidence, not a placeholder.
  await expect(page.getByRole("img", { name: "24 confirmed, 6 inferred, 1 unknown, 31 connections" })).toBeVisible();

  const records = page.getByRole("region", { name: "Equipment records" });
  await records.getByLabel("Find equipment").fill("chiller");
  await expect(records.getByRole("listitem")).toHaveCount(3);

  // Runs are set up in AI Pilot, which opens beside the hub; the hub stays.
  await page.locator("#hub-simulation").getByRole("button", { name: "Set up a simulation in AI Pilot" }).click();
  await expect(page.getByRole("complementary", { name: "AI Pilot" }).getByRole("heading", { name: "Start a simulation" })).toBeVisible();
  await expect(page).toHaveURL(/\/engineering/);

  await page.getByRole("link", { name: /Cooling tower 4 fan fault/ }).click();
  await expect(page).toHaveURL(/\/equipment\/cooling_towers_4/);
  await expect(page.getByRole("heading", { level: 2, name: "Cooling tower 4" })).toBeVisible();
});

test("the equipment record shows the trend, the operating point against nameplate, measurements and the issue timeline", async ({ page }) => {
  await page.goto("/equipment/chiller_plant_2?scenario=tower-fault");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Engineering");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Engineering/Equipment records/Chiller 2");
  await expect(page.getByLabel("Trend metric")).toHaveValue("chiller_plant_2:cooling_kw");
  // Read against the nameplate from 0, the whole day with a rule at now (FD-15).
  const chart = page.getByRole("img", { name: /Cooling output, trend today/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator(".ts-chart__tick")).toContainText(["0", "350", "700"]);
  await expect(chart.locator(".ts-chart__marker")).toHaveCount(1);
  await expect(chart.locator("path[stroke='var(--chart-neutral)']")).toHaveCount(1);
  await expect(page.getByText("kWt against the 700 kWt nameplate, 5-minute samples to 15:15 UTC+8.")).toBeVisible();
  await expect(page.getByText(/525 of 700 kWt \(75%\)/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Signal" })).toBeVisible();
  await expect(page.getByText("No issues mention Chiller 2 today.")).toBeVisible();

  await page.goto("/equipment/cooling_towers_4?scenario=tower-fault");
  await expect(page.getByText("Cooling tower 4 fan fault first seen (ISS-0142)")).toBeVisible();
  await expect(page.getByText(/Still investigating/)).toBeVisible();
});

test("the record's Locate opens the Overview with the equipment selected and in view", async ({ page }) => {
  await page.goto("/equipment/cooling_water_pump_2");
  await page.getByRole("button", { name: "Locate on plant" }).click();
  await expect(page).toHaveURL(/\/\?equipment=cooling_water_pump_2/);
  await expect(inspector(page).getByRole("heading", { level: 2 })).toHaveText("CW pump 2");
  const box = (await page.locator(".plant-view__box > svg").boundingBox())!;
  const art = (await page.locator('.plant-view__box [data-equipment-id="cooling_water_pump_2"] .eq-node__art').boundingBox())!;
  expect(art.x).toBeGreaterThanOrEqual(box.x);
  expect(art.y + art.height).toBeLessThanOrEqual(box.y + box.height);
});

test("Details link to the record; unknown IDs explain themselves", async ({ page }) => {
  await page.goto("/?equipment=chiller_plant_3");
  await inspector(page).getByRole("link", { name: "Open record" }).click();
  await expect(page).toHaveURL(/\/equipment\/chiller_plant_3/);
  // Details stay open beside the record, so the record's heading is the one in main.
  await expect(page.getByRole("main").getByRole("heading", { level: 2, name: "Chiller 3" })).toBeVisible();
  await page.goto("/equipment/pump_99");
  await expect(page.getByRole("heading", { name: "Equipment not found" })).toBeVisible();
});
