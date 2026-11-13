import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const openSample = async (page: Page) => {
  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  await expect(page.getByRole("heading", { name: "Preparing workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: "Water-cooled plant", level: 2 })).toBeVisible();
};
const inspector = (page: Page) => page.getByRole("complementary", { name: "Object inspector" });

test("CAD Studio is a primary navigation destination with an honest demo workflow", async ({ page }) => {
  await page.goto("/cad");
  await expect(page.getByRole("link", { name: "CAD Studio" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  await expect(page.getByText("No CAD parser connected")).toHaveCount(0);
  await openSample(page);

  await expect(page.locator(".cad-tb").getByText("Prepared sample")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await expect(page.getByText("Wheel to zoom")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Compare" })).toHaveAttribute("aria-checked", "true");
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

  // Equipment: its own evidence and the review of its connections, as two rows.
  await page.getByRole("button", { name: "Fit drawing" }).click();
  await page.getByRole("group", { name: "Plant scene" }).getByRole("button", { name: /CW pump 4/i }).click();
  await expect(inspector(page).getByRole("heading", { name: /CW pump 4/, level: 3 })).toBeVisible();
  await expect(inspector(page).getByRole("combobox", { name: "Equipment evidence" })).toHaveValue("confirmed");
  await expect(inspector(page).getByText("Connections needing review")).toBeVisible();
  await expect(inspector(page).getByText("1 of 2")).toBeVisible();
  await expect(inspector(page).getByRole("heading", { name: "Connections · 2" })).toBeVisible();
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();

  await expect(inspector(page).getByText("Needs review · 2 inferred connections").first()).toBeVisible();
  await inspector(page).getByRole("button", { name: /Unknown connection/ }).click();
  await expect(page.getByRole("radio", { name: "Compare" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("CW pump 4:discharge")).toBeVisible();
  expect(await inspector(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("combobox", { name: "Evidence" }).selectOption("confirmed");
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();
  await expect(inspector(page).getByRole("button", { name: /Unknown connection/ })).toHaveCount(0);
  await expect(page.locator(".cad-tb").getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "Fit drawing" }).click();
  await page.getByRole("group", { name: "Plant scene" }).getByRole("button", { name: /Chiller 1/i }).evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await expect(inspector(page).getByRole("heading", { name: "Connections · 4" })).toBeVisible();

  const deviceNodes = page.locator('.cad-review-canvas--extraction .eq-node[role="button"]');
  for (let index = 0; index < await deviceNodes.count(); index += 1) {
    await deviceNodes.nth(index).evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await expect(inspector(page).getByRole("combobox", { name: "Equipment evidence" })).toBeVisible();
    expect(await inspector(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();

  await inspector(page).getByRole("button", { name: /Unconnected port/ }).click();
  await expect(page.getByRole("combobox", { name: "Connect from" })).toBeVisible();
  await page.getByRole("combobox", { name: "Connect from" }).selectOption("chiller_plant_2");
  await page.getByRole("button", { name: "Create connection" }).click();
  await expect(page.getByText("Chiller 2:evap_out")).toBeVisible();
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();
  await expect(inspector(page).getByRole("button", { name: /Unconnected port/ })).toHaveCount(0);
  await expect(inspector(page).getByText("No open findings")).toBeVisible();

  // Leaving CAD Studio keeps the review, the divider and the open project.
  const dividerPosition = await splitter.getAttribute("aria-valuenow");
  await page.getByRole("link", { name: "Engineering", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Water-cooled plant", level: 2 })).toHaveCount(0);
  await page.getByRole("link", { name: "CAD Studio", exact: true }).click();
  await expect(splitter).toHaveAttribute("aria-valuenow", dividerPosition ?? "");
  await expect(inspector(page).getByText("No open findings")).toBeVisible();

  await page.getByRole("button", { name: "Preview in Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview preview" })).toBeVisible();
  await expect(page.getByText("Draft scene · not validated or commissioned").first()).toBeVisible();
  await expect(page.getByText("Unavailable", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Chiller 1/i }).click();
  await expect(page.locator(".cad-inspector--preview .cad-evidence")).toHaveText("Confirmed");
  await page.getByRole("button", { name: "Back to review" }).click();
  await expect(page.getByRole("heading", { name: "Water-cooled plant", level: 2 })).toBeVisible();
});

test("local CAD drawings stay in the Library across navigation and further imports", async ({ page }) => {
  await page.goto("/cad");
  const buffer = (globalThis as unknown as { Buffer: { from(text: string): Uint8Array } }).Buffer.from("fixture");
  const drawing = (name: string) => ({ name, mimeType: "application/octet-stream", buffer });
  await page.locator('.cad-library input[type="file"]').setInputFiles([drawing("floor-a.dwg"), drawing("floor-b.dxf")]);
  const sheet = (name: string) => page.getByRole("heading", { name, level: 3 });
  await expect(sheet("floor-a.dwg")).toBeVisible();
  await expect(page.getByText("Parser not connected")).toHaveCount(0);
  await expect(page.locator(".cad-file").getByText("No extraction")).toBeVisible();

  // Below 1366 px of CAD area the Library starts closed; Projects opens it beside the canvas.
  const projects = page.getByRole("button", { name: "Projects" });
  await expect(projects).toHaveAttribute("aria-expanded", "false");
  await projects.click();
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  await page.locator(".cad-library--column .cad-row", { hasText: "floor-b.dxf" }).click();
  await expect(sheet("floor-b.dxf")).toBeVisible();
  await page.getByRole("link", { name: "Engineering", exact: true }).click();
  await page.getByRole("link", { name: "CAD Studio", exact: true }).click();
  await expect(sheet("floor-b.dxf")).toBeVisible();
  await expect(page.getByRole("group", { name: "Synthetic source drawing" })).toHaveCount(0);

  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("button", { name: "Close project" }).click();
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  await page.locator(".cad-library--page").evaluate((library) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["fixture"], "floor-c.dwg"));
    library.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });
  await expect(sheet("floor-c.dwg")).toBeVisible();
  const column = page.locator(".cad-library--column");
  await expect(column.locator(".cad-row__name > span:first-child")).toHaveText(["Water-cooled plant", "floor-a.dwg", "floor-b.dxf", "floor-c.dwg"]);
  await column.locator(".cad-row", { hasText: "Water-cooled plant" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("group", { name: "Synthetic source drawing" })).toBeVisible();
  await column.locator(".cad-row", { hasText: "floor-c.dwg" }).click();
  await expect(sheet("floor-c.dwg")).toBeVisible();
});

test("the Library docks beside the canvas when the CAD area is wide, and starts closed when it is not", async ({ page }) => {
  // At 1440 px the CAD area stays under 1366 px even with the app workspace collapsed: closed by default.
  await page.goto("/cad");
  await openSample(page);
  const projects = page.getByRole("button", { name: "Projects" });
  await page.getByRole("button", { name: "Collapse workspace" }).click();
  expect((await page.locator(".cad-wb").boundingBox())!.width).toBeLessThan(1366);
  await expect(projects).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".cad-library--column")).toHaveCount(0);
  // Wider, it docks.
  await page.setViewportSize({ width: 1680, height: 1000 });
  await expect(page.locator(".cad-library--column")).toBeVisible();
  await expect(projects).toHaveAttribute("aria-expanded", "true");
  const canvas = await page.locator(".cad-wb__canvas").boundingBox();
  const area = await page.locator(".cad-wb").boundingBox();
  expect(canvas!.width / area!.width).toBeGreaterThan(0.55);
});

test("CAD Studio has no serious accessibility violations and stays usable on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cad");
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  await openSample(page);
  await expect(page.getByRole("radio", { name: "Compare" })).toBeVisible();
  await expect(page.locator(".cad-compare-pane")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Unknown connection/ })).toBeVisible();
  for (const target of await page.locator(".cad-tb button:visible").all()) {
    const box = await target.boundingBox();
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(40);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
});
