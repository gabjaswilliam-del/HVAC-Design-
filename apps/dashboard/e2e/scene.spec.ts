import { expect, test } from "@playwright/test";

const DEVICE_IDS = [
  ...[1, 2, 3, 4].map((i) => `cooling_towers_${i}`),
  ...[1, 2, 3].map((i) => `chiller_plant_${i}`),
  ...[1, 2, 3, 4].map((i) => `cooling_water_pump_${i}`),
  ...[1, 2, 3, 4].map((i) => `chilled_water_pump_pri_${i}`),
  "terminal",
];

test("monitoring scene draws every equipment item by stable ID with its state in words", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  const scene = page.getByRole("img", { name: "Plant schematic" });
  await expect(scene).toBeVisible();
  for (const id of DEVICE_IDS) {
    await expect(scene.locator(`[data-equipment-id="${id}"]`)).toHaveCount(1);
  }
  await expect(scene.locator('[data-equipment-id="cooling_towers_4"]')).toContainText("Fault");
  await expect(scene.locator('[data-equipment-id="chiller_plant_3"]')).toContainText("Stopped");
  await expect(scene.locator('[data-equipment-id="chilled_water_pump_pri_3"]')).toContainText("No data");
  // Missing readings say so; they are never drawn as zero.
  await expect(scene.getByText("Unavailable")).toHaveCount(3);
  await expect(page.getByText(/Synthetic demonstration topology/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("only running equipment and live pipes animate", async ({ page }) => {
  await page.goto("/");
  const anim = (sel: string) =>
    page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName);
  expect(await anim('[data-equipment-id="cooling_towers_1"] .eq-fan')).toBe("eq-spin");
  expect(await anim('[data-equipment-id="cooling_towers_4"] .eq-fan')).toBe("none");
  expect(await page.locator(".pipe-flow").count()).toBeGreaterThan(10);
});

test("reduced motion stops all equipment and flow animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const names = await page
    .locator(".eq-fan, .pipe-flow, .eq-guard-slots")
    .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).animationName))]);
  expect(names).toEqual(["none"]);
});
