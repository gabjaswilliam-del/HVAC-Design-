import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const openSample = async (page: Page) => {
  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  await expect(page.getByRole("heading", { name: "Preparing workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("heading", { name: /Water-cooled plant/, level: 2 })).toBeVisible();
};
const inspector = (page: Page) => page.getByRole("complementary", { name: "Object inspector" });
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const card = (page: Page, name: string) => page.locator(".cad-card-item", { hasText: name }).first();
const bytes = (text: string) => (globalThis as unknown as { Buffer: { from(text: string): Uint8Array } }).Buffer.from(text);
const drawing = (name: string, body = `AC1032 ${name}`) => ({ name, mimeType: "application/octet-stream", buffer: bytes(body) as never });
const seriousViolations = async (page: Page) =>
  (await new AxeBuilder({ page }).include(".cad-studio").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");

test("CAD Studio opens on Projects; the sample's drawing has the area and its review opens on demand", async ({ page }) => {
  await page.goto("/cad");
  await expect(page.getByRole("link", { name: "CAD Studio" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload drawing" }).first()).toBeVisible();
  await expect(page.getByText("No CAD parser connected")).toHaveCount(0);
  await openSample(page);

  await expect(page.locator(".cad-head").getByText("Prepared sample")).toBeVisible();
  await expect(page.locator(".cad-head").getByText("This tab only")).toBeVisible();
  await expect(tab(page, "Drawing")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("radio", { name: "3D" })).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(inspector(page)).toHaveCount(0);
  const area = await page.locator(".cad-studio").boundingBox();
  const canvas = await page.locator(".cad-drawing__canvas").boundingBox();
  expect((canvas!.width * canvas!.height) / (area!.width * area!.height)).toBeGreaterThan(0.85);

  // Zoom and Fit.
  const zoom = page.getByRole("status", { name: /Zoom level/ });
  const initialZoom = await zoom.textContent();
  await page.getByRole("group", { name: "Plant scene" }).hover();
  await page.mouse.wheel(0, -320);
  await expect(zoom).not.toHaveText(initialZoom ?? "");
  await page.getByRole("button", { name: "Fit drawing" }).click();

  // The synthetic source drawing beside the extraction: one pan and zoom, a resizable divider.
  await page.getByRole("button", { name: "Source drawing beside the extraction" }).click();
  await expect(page.getByRole("group", { name: "Synthetic source drawing" })).toBeVisible();
  const splitter = page.getByRole("separator", { name: "Resize comparison panels" });
  await expect(splitter).toHaveAttribute("aria-valuenow", "50");
  await splitter.press("ArrowRight");
  await expect(splitter).toHaveAttribute("aria-valuenow", "55");
  await page.getByRole("radio", { name: "Pan" }).click();
  const a = page.locator(".cad-review-canvas--a .cad-canvas-group");
  const b = page.locator(".cad-review-canvas--b .cad-canvas-group");
  const before = await b.getAttribute("style");
  const bounds = (await page.locator(".cad-viewport").boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.78, bounds.y + bounds.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => b.getAttribute("style")).not.toBe(before);
  await expect.poll(async () => (await a.getAttribute("style")) === (await b.getAttribute("style"))).toBe(true);
  await page.getByRole("radio", { name: "Select" }).click();
  await page.getByRole("button", { name: "Source drawing beside the extraction" }).click();

  // Selecting equipment opens the review: its evidence and its connections' review, as two rows.
  await page.getByRole("button", { name: "Fit drawing" }).click();
  await page.getByRole("group", { name: "Plant scene" }).getByRole("button", { name: /CW pump 4/i }).click();
  await expect(inspector(page).getByRole("heading", { name: /CW pump 4/, level: 3 })).toBeVisible();
  await expect(inspector(page).getByText("Connections needing review")).toBeVisible();
  await expect(inspector(page).getByText("1 of 2")).toBeVisible();
  await expect(inspector(page).getByRole("heading", { name: "Connections · 2" })).toBeVisible();
  await inspector(page).getByRole("tab", { name: "Evidence" }).click();
  await expect(inspector(page).getByRole("combobox", { name: "Equipment evidence" })).toHaveValue("confirmed");
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();

  await inspector(page).getByRole("button", { name: /Unknown connection/ }).click();
  await expect(page.getByText("CW pump 4:discharge")).toBeVisible();
  expect(await inspector(page).evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("combobox", { name: "Evidence" }).selectOption("confirmed");
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();
  await expect(inspector(page).getByRole("button", { name: /Unknown connection/ })).toHaveCount(0);
  await expect(page.locator(".cad-head").getByText("Unsaved changes")).toBeVisible();

  await inspector(page).getByRole("button", { name: /Unconnected port/ }).click();
  await page.getByRole("combobox", { name: "Connect from" }).selectOption("chiller_plant_2");
  await page.getByRole("button", { name: "Create connection" }).click();
  await expect(page.getByText("Chiller 2:evap_out")).toBeVisible();
  await inspector(page).getByRole("button", { name: /Back to findings/ }).click();
  await expect(inspector(page).getByText("No open findings")).toBeVisible();
  await page.getByRole("button", { name: "Close review" }).click();
  await expect(inspector(page)).toHaveCount(0);

  // Leaving CAD Studio keeps the open project and its review.
  await page.getByRole("link", { name: "Engineering", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Water-cooled plant/, level: 2 })).toHaveCount(0);
  await page.getByRole("link", { name: "CAD Studio", exact: true }).click();
  await expect(page.locator(".cad-head").getByText("Unsaved changes")).toBeVisible();

  await page.getByRole("button", { name: "Preview in Overview" }).click();
  await expect(page.getByRole("heading", { name: "Overview preview" })).toBeVisible();
  await expect(page.getByText("Draft scene · not validated or commissioned").first()).toBeVisible();
  await page.getByRole("button", { name: /Chiller 1/i }).click();
  await expect(page.locator(".cad-inspector--preview .cad-evidence")).toHaveText("Confirmed");
  await page.getByRole("button", { name: "Back to review" }).click();
  await expect(page.getByRole("heading", { name: /Water-cooled plant/, level: 2 })).toBeVisible();
});

test("uploads become projects with a history; the approved reference is chosen explicitly and never moved by a revision", async ({ page }) => {
  await page.goto("/cad");
  await page.locator('.cad-home input[type="file"]').setInputFiles([drawing("floor-a.dwg"), drawing("floor-b.dxf", "0\nSECTION\n")]);
  await expect(page.getByRole("heading", { name: "floor-a.dwg", level: 3 })).toBeVisible();
  await expect(page.locator(".cad-file")).toContainText("No extraction");
  await expect(page.getByText("Parser not connected")).toHaveCount(0);
  await expect(page.locator(".cad-file").getByRole("link", { name: "Download original" })).toHaveAttribute("download", "floor-a.dwg");

  await tab(page, "History").click();
  const versions = page.locator(".cad-version");
  await expect(versions).toHaveCount(1);
  await page.getByRole("button", { name: "Set floor-a.dwg as the approved reference" }).click();
  await expect(versions.first()).toContainText("Approved reference");

  // A revision is added to the history; the reference stays where it was put.
  await page.locator('.cad-head input[type="file"]').setInputFiles(drawing("floor-a-rev-b.dwg"));
  await expect(versions).toHaveCount(2);
  await expect(versions.first()).toContainText("floor-a-rev-b.dwg");
  await expect(versions.first()).not.toContainText("Approved reference");
  await expect(versions.last()).toContainText("Approved reference");

  // Changing the reference is confirmed, and says what stays.
  await page.getByRole("button", { name: "Set floor-a-rev-b.dwg as the approved reference" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Version 1 stays in the history");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(versions.last()).toContainText("Approved reference");

  // Files are compared as files: they are never parsed.
  await tab(page, "Compare").click();
  await expect(page.locator(".cad-filecmp")).toContainText("Different file");
  await expect(page.getByRole("combobox", { name: /Reference/ })).toHaveValue(/cadv_/);

  // Opening an older version shows its file read-only, with a way back.
  await tab(page, "History").click();
  await page.getByRole("button", { name: "Open floor-a.dwg" }).click();
  await expect(tab(page, "Drawing")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "floor-a.dwg", level: 3 })).toBeVisible();
  await page.getByRole("button", { name: "Back to working review" }).click();
  await expect(page.getByRole("heading", { name: "floor-a-rev-b.dwg", level: 3 })).toBeVisible();

  // Both uploads are projects on the home page, with their versions and the reference mark.
  await page.getByRole("button", { name: "Back to projects" }).click();
  await expect(card(page, "floor-a")).toContainText("2 versions");
  await expect(card(page, "floor-b")).toContainText("1 version");
  await expect(card(page, "floor-a").getByText("Approved reference")).toHaveCount(1);

  // Every project is a drawing, so there is one upload action and search, no file-type filter.
  await expect(page.getByRole("radio", { name: "All" })).toHaveCount(0);
  await expect(page.locator(".cad-home").getByRole("button", { name: /Upload/ })).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search projects" }).fill("floor-b");
  await expect(page.locator(".cad-card-item")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search projects" }).fill("nothing like this");
  await expect(page.getByText("No projects match")).toBeVisible();

  // One upload in a project: the header's. A file that is not a drawing is named and refused.
  await page.getByRole("searchbox", { name: "Search projects" }).fill("");
  await card(page, "floor-b").getByRole("button").first().click();
  await expect(page.locator(".cad-wb").getByRole("button", { name: /Upload/ })).toHaveCount(1);
  await page.locator('.cad-head input[type="file"]').setInputFiles([drawing("notes.pdf", "%PDF-1.7")]);
  await expect(page.locator(".cad-notice")).toContainText("Not uploaded: notes.pdf");
});

test("Compare shows the review against the approved reference side by side, as an overlay and as differences", async ({ page }) => {
  await page.goto("/cad");
  await openSample(page);
  await tab(page, "Compare").click();
  await expect(page.getByText("Save a version to compare the working review against it.")).toBeVisible();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.locator(".cad-head")).toContainText("Saved");
  await tab(page, "History").click();
  await page.getByRole("button", { name: "Set Version 1 as the approved reference" }).click();
  await expect(page.locator(".cad-version.is-reference")).toContainText("Version 1");

  await tab(page, "Drawing").click();
  await page.getByRole("button", { name: /^Review/ }).click();
  await inspector(page).getByRole("button", { name: /Unknown connection/ }).click();
  await page.getByRole("combobox", { name: "Evidence" }).selectOption("confirmed");

  await tab(page, "Compare").click();
  await expect(page.locator(".cad-diffsum")).toHaveText(/1 changed/);
  await expect(page.getByRole("radio", { name: "Side by side" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: /^Reference: Version 1/ })).toBeVisible();
  await expect(page.getByRole("group", { name: /^Target: Working review/ })).toBeVisible();
  await expect(page.locator('.cad-diff [data-diff="changed"]')).toHaveCount(2); // marked on both sides

  // The panes share one pan and zoom.
  await page.getByRole("button", { name: "Zoom in" }).click();
  const a = page.locator(".cad-review-canvas--a .cad-canvas-group");
  const b = page.locator(".cad-review-canvas--b .cad-canvas-group");
  await expect.poll(async () => (await a.getAttribute("style")) === (await b.getAttribute("style"))).toBe(true);

  await page.getByRole("radio", { name: "Overlay" }).click();
  await expect(page.getByRole("slider", { name: "Reference" })).toHaveValue("40");
  await expect(page.locator(".cad-layer-reference")).toHaveCount(1);
  await page.getByRole("radio", { name: "Differences" }).click();
  await expect(page.locator(".cad-layer-muted")).toHaveCount(1);
  await expect(page.locator('.cad-diff [data-diff="changed"]')).toHaveCount(1);

  await page.getByRole("button", { name: "Changes" }).click();
  const changes = page.getByRole("complementary", { name: "Changes" });
  await expect(changes).toContainText("Evidence changed");
  await expect(changes).toContainText("Unknown → Confirmed");
  expect(await seriousViolations(page)).toEqual([]);
});

for (const size of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
  test(`desktop layout keeps the drawing dominant without overflow at ${size.width} × ${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/cad");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await openSample(page);
    const area = (await page.locator(".cad-studio").boundingBox())!;
    const canvas = (await page.locator(".cad-drawing__canvas").boundingBox())!;
    expect((canvas.width * canvas.height) / (area.width * area.height)).toBeGreaterThan(0.85);
    for (const name of ["Drawing", "History", "Compare"]) {
      await tab(page, name).click();
      const head = (await page.locator(".cad-head").boundingBox())!;
      expect(head.height).toBeLessThanOrEqual(64);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    }
  });
}

test("CAD Studio has no serious accessibility violations and stays usable on a phone", async ({ page }) => {
  await page.goto("/cad");
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: /Projects/, level: 2 })).toBeVisible();
  await openSample(page);
  await expect(tab(page, "Compare")).toBeVisible();
  for (const target of await page.locator(".cad-head button:visible, .cad-float button:visible").all()) {
    const box = await target.boundingBox();
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(30);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await seriousViolations(page)).toEqual([]);
  await tab(page, "History").click();
  expect(await seriousViolations(page)).toEqual([]);
});
