import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("CAD Studio is a primary navigation destination with an honest demo workflow", async ({ page }) => {
  await page.goto("/cad");
  await expect(page.getByRole("link", { name: "CAD Studio" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No CAD parser connected")).toBeVisible();

  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  await expect(page.getByRole("heading", { name: "Preparing workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();

  await expect(page.getByRole("heading", { name: "CAD Studio", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Topology", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByText("Wheel to zoom")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Synthetic source drawing" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Plant scene" })).toBeVisible();
  const splitter = page.getByRole("separator", { name: "Resize comparison panels" });
  await expect(splitter).toHaveAttribute("aria-valuenow", "50");
  await splitter.press("ArrowRight");
  await expect(splitter).toHaveAttribute("aria-valuenow", "55");
  const splitterBounds = await splitter.boundingBox();
  if (!splitterBounds) throw new Error("Comparison divider has no bounds");
  await page.mouse.move(splitterBounds.x + splitterBounds.width / 2, splitterBounds.y + splitterBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(splitterBounds.x + 90, splitterBounds.y + splitterBounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await splitter.getAttribute("aria-valuenow"))).toBeGreaterThan(55);
  const initialZoom = await page.getByRole("status", { name: /Zoom level/ }).textContent();
  const canvas = page.getByRole("group", { name: "Drawing and extraction comparison" });
  await canvas.hover();
  await page.mouse.wheel(0, -320);
  await expect(page.getByRole("status", { name: /Zoom level/ })).not.toHaveText(initialZoom ?? "");
  await page.getByRole("button", { name: "Fit drawing" }).click();

  const extraction = page.locator(".cad-review-canvas--extraction .cad-canvas-group");
  const source = page.locator(".cad-review-canvas--source .cad-canvas-group");
  const beforePan = await extraction.getAttribute("style");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Comparison canvas has no bounds");
  await page.mouse.move(bounds.x + bounds.width * 0.48, bounds.y + bounds.height * 0.82);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.58, bounds.y + bounds.height * 0.72, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => extraction.getAttribute("style")).not.toBe(beforePan);
  await expect.poll(async () => {
    const [sourceView, extractionView] = await Promise.all([source.getAttribute("style"), extraction.getAttribute("style")]);
    return sourceView === extractionView;
  }).toBe(true);

  await page.getByRole("button", { name: "Fit drawing" }).click();
  await page.getByRole("button", { name: /CW pump 4/i }).click();
  await expect(page.getByText("2 connections highlighted on canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await page.getByRole("button", { name: "Unknown connection" }).click();
  await expect(page.getByRole("button", { name: "Compare" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("CW pump 4:discharge")).toBeVisible();
  expect(await page.locator(".cad-inspector").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("combobox", { name: "Evidence" }).selectOption("confirmed");
  await expect(page.getByRole("button", { name: "Unknown connection" })).toHaveCount(0);
  await expect(page.getByText("Unsaved")).toBeVisible();

  await page.getByRole("button", { name: "Fit drawing" }).click();
  await page.getByRole("button", { name: /Chiller 1/i }).evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(page.getByText("4 connections highlighted on canvas")).toBeVisible();

  const deviceNodes = page.locator('.cad-review-canvas--extraction .eq-node[role="button"]');
  for (let index = 0; index < await deviceNodes.count(); index += 1) {
    await deviceNodes.nth(index).evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await expect(page.locator(".cad-inspector")).toBeVisible();
    expect(await page.locator(".cad-inspector").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }

  await page.getByRole("button", { name: /Unconnected port/ }).click();
  await expect(page.getByRole("combobox", { name: "Connect from" })).toBeVisible();
  await page.getByRole("combobox", { name: "Connect from" }).selectOption("chiller_plant_2");
  await page.getByRole("button", { name: "Create connection" }).click();
  await expect(page.getByRole("button", { name: /Unconnected port/ })).toHaveCount(0);
  await expect(page.getByText("Chiller 2:evap_out")).toBeVisible();

  await page.getByRole("button", { name: "Preview in Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview preview" })).toBeVisible();
  await expect(page.getByText("Draft scene · not validated or commissioned").first()).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Chiller 1/i }).click();
  await expect(page.locator(".cad-inspector--preview .cad-evidence")).toHaveText("Confirmed");
  await page.getByRole("button", { name: "Back to review" }).click();
  await expect(page.getByRole("heading", { name: "CAD Studio", level: 2 })).toBeVisible();
});

test("CAD Studio has no serious accessibility violations and stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cad");
  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("button", { name: "Compare" })).toBeVisible();
  await expect(page.locator(".cad-compare-pane")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Unknown connection" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});
