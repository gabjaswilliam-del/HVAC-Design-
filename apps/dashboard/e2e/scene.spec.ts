import { expect, test, type Page } from "@playwright/test";

const viewport = (page: Page) => page.locator(".plant-view__box > svg");
const overlay = (page: Page) => page.locator(".plant-view__overlay");
const plant = (page: Page) => page.locator(".plant-view");

test("scene states are named in words; missing values read Unavailable, never zero", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  // All readings: the drawing's own names, states and tags.
  await page.goto("/?scenario=sensor-issues&read=all");
  const scene = viewport(page);
  await expect(scene.locator('[data-equipment-id="chilled_water_pump_pri_3"]')).toContainText("No data");
  await expect(scene.locator('[data-equipment-id="chiller_plant_3"]')).toContainText("Stopped");
  await expect(scene.getByText("Unavailable")).toHaveCount(3); // pump 3 Hz and kW, return-header pressure
  await expect(scene.locator(".tag--stale")).toHaveCount(1);
  await expect(page.getByText("Synthetic plant", { exact: true })).toBeVisible();
  await expect(page.getByText("Not a customer site or a simulation.")).toBeVisible();

  await page.goto("/?scenario=tower-fault&read=all");
  await expect(viewport(page).locator('[data-equipment-id="cooling_towers_4"]')).toContainText("Fault");
  // Every equipment hit area is a button named with its state.
  await expect(viewport(page).getByRole("button", { name: "Cooling tower 4, Fault" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("below 80% zoom, Auto shows key readings in screen space; from 80% the drawn readings return", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await expect(plant(page)).toHaveAttribute("data-read", "key");
  expect(Number(await plant(page).getAttribute("data-zoom"))).toBeLessThan(0.8);
  // The drawing's own text is hidden; names and one primary reading per item are drawn
  // at a legible size in screen space.
  await expect(viewport(page).locator(".tag__value")).toHaveCount(0);
  await expect(viewport(page).locator(".eq-node__label")).toHaveCount(0);
  await expect(overlay(page).locator('.lbl[data-for="chiller_plant_2"]')).toContainText(/Chiller 2\s*525\s*kWt/);
  await expect(overlay(page).locator('.key[data-for="cooling_towers_1"]')).toHaveText(/49\.2\s*Hz/);
  await expect(overlay(page).locator(".key", { hasText: "CHW supply" })).toContainText("7.0");
  // State words only for Fault and Stopped.
  await expect(overlay(page).locator('.lbl[data-for="cooling_towers_4"]')).toContainText("Fault");
  await expect(overlay(page).locator('.lbl[data-for="cooling_towers_1"]')).not.toContainText("Running");
  const size = await overlay(page).locator('.key[data-for="cooling_towers_1"]').evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("13px");

  // Zooming to 80% or more brings the drawn readings back, with a short hint.
  const zoomIn = page.getByRole("toolbar", { name: "Drawing" }).getByRole("button", { name: "Zoom in" });
  await zoomIn.click();
  await expect(plant(page)).toHaveAttribute("data-read", "all");
  await expect(page.locator(".readmode-hint")).toHaveText("All readings from 80% zoom.");
  await expect(viewport(page).locator(".tag__value").first()).toBeVisible();
  await expect(overlay(page).locator(".key")).toHaveCount(0);
});

test("Key, All and Off override Auto; Auto is a visible toggle", async ({ page }) => {
  await page.goto("/?scenario=normal");
  const controls = page.getByRole("toolbar", { name: "Drawing" });
  const auto = controls.getByRole("button", { name: "Auto" });
  const modes = controls.getByRole("radiogroup", { name: "Readings" });
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(modes.getByRole("radio", { name: "Key" })).toHaveAttribute("aria-checked", "true");

  await modes.getByRole("radio", { name: "All" }).click();
  await expect(auto).toHaveAttribute("aria-pressed", "false");
  await expect(plant(page)).toHaveAttribute("data-read", "all");
  await expect(viewport(page).locator(".tag__value").first()).toBeVisible();

  await modes.getByRole("radio", { name: "Off" }).click();
  await expect(viewport(page).locator(".tag__value")).toHaveCount(0);
  await expect(overlay(page).locator(".key")).toHaveCount(0);
  // Below 80% the names stay legible even with readings off.
  await expect(overlay(page).locator(".lbl").first()).toBeVisible();

  await auto.click();
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(plant(page)).toHaveAttribute("data-read", "key");
});

test("open issues hang on their equipment: the most severe in full, the next folded", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  const top = overlay(page).getByRole("button", { name: /Critical issue ISS-0142, Cooling tower 4 fan fault/ });
  await expect(top).toBeVisible();
  await expect(top).toContainText("Cooling tower 4");
  const folded = overlay(page).getByRole("button", { name: /Warning issue ISS-0143/ });
  await expect(folded.locator(".tag__sub")).toBeHidden();
  // Hover opens it and outlines every item it reaches.
  await folded.hover();
  await expect(folded.locator(".tag__sub")).toHaveText("4 items");
  for (const id of ["cooling_towers_1", "cooling_towers_2", "cooling_towers_3", "chiller_plant_1"]) {
    await expect(viewport(page).locator(`[data-equipment-id="${id}"]`)).toHaveClass(/eq-node--highlighted/);
  }
  await top.click();
  await expect(page.getByRole("complementary", { name: "Equipment inspector" }).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
});

test("only running equipment and live pipes animate", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  const scene = viewport(page);
  await expect(scene.locator('[data-equipment-id="cooling_towers_4"]')).toHaveAttribute("aria-label", /Fault/);
  const anim = (sel: string) => scene.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim('[data-equipment-id="cooling_towers_1"] .eq-fan')).toBe("eq-spin");
  expect(await anim('[data-equipment-id="cooling_towers_4"] .eq-fan')).toBe("none");
  expect(await scene.locator(".pipe-flow").count()).toBeGreaterThan(10);
});

test("reduced motion stops all equipment and flow animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(viewport(page).locator(".eq-fan").first()).toBeAttached();
  const names = await page
    .locator(".eq-fan, .pipe-flow, .eq-guard-slots")
    .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).animationName))]);
  expect(names).toEqual(["none"]);
});
