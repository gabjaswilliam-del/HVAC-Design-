import { expect, test } from "@playwright/test";

const viewport = (page: import("@playwright/test").Page) => page.locator(".plant-viewport__box > svg");

test("scene states are named in words; missing values read Unavailable, never zero", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/?scenario=sensor-issues");
  const scene = viewport(page);
  await expect(scene.locator('[data-equipment-id="chilled_water_pump_pri_3"]')).toContainText("No data");
  await expect(scene.locator('[data-equipment-id="chiller_plant_3"]')).toContainText("Stopped");
  await expect(scene.getByText("Unavailable")).toHaveCount(3); // pump 3 Hz and kW, return-header pressure
  await expect(scene.locator(".tag--stale")).toHaveCount(1);
  await expect(page.getByText(/Synthetic demonstration topology/)).toBeVisible();

  await page.goto("/?scenario=tower-fault");
  await expect(viewport(page).locator('[data-equipment-id="cooling_towers_4"]')).toContainText("Fault");
  expect(errors).toEqual([]);
});

test("only running equipment and live pipes animate", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  const scene = viewport(page);
  await expect(scene.locator('[data-equipment-id="cooling_towers_4"]')).toContainText("Fault");
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
