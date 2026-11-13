import { expect, test, type Page } from "@playwright/test";

/** Ids defined more than once in the document: a `url(#id)` paint resolves to the first one. */
const duplicateIds = (page: Page) =>
  page.evaluate(() => {
    const counts = new Map<string, number>();
    for (const element of document.querySelectorAll("[id]")) counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
  });

/** Equipment paints whose gradient or clip path resolves into a subtree that is not displayed (it never paints). */
const unpaintedReferences = (page: Page) =>
  page.evaluate(() => {
    const hidden = (element: Element | null) => {
      for (let node = element; node; node = node.parentElement) if (getComputedStyle(node).display === "none") return true;
      return false;
    };
    const misses = new Set<string>();
    for (const element of document.querySelectorAll(".eq-node *")) {
      for (const attribute of ["fill", "stroke", "clip-path"]) {
        const id = element.getAttribute(attribute)?.match(/^url\(#(.+)\)$/)?.[1];
        if (id && hidden(document.getElementById(id))) misses.add(id);
      }
    }
    return [...misses];
  });

test("leaving CAD Studio leaves no hidden copy behind, so the Overview's equipment keeps its colours", async ({ page }) => {
  await page.goto("/cad");
  await page.getByRole("button", { name: /Water-cooled plant/i }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  // Compare draws the extracted plant with the same equipment paints as the Overview.
  await expect(page.getByRole("group", { name: "Plant scene" })).toBeVisible();

  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.locator(".eq-node:visible").first()).toBeVisible();
  expect(await duplicateIds(page)).toEqual([]);
  expect(await unpaintedReferences(page)).toEqual([]);
});

test("the Overview loads no CAD Studio code; CAD Studio loads when it is opened", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await page.goto("/");
  await expect(page.locator(".eq-node:visible").first()).toBeVisible();
  expect(requested.filter((path) => path.includes("/features/cad-studio/"))).toEqual([]);

  await page.getByRole("link", { name: "CAD Studio", exact: true }).click();
  await expect(page.getByRole("button", { name: /Water-cooled plant/i })).toBeVisible();
  expect(requested.some((path) => path.includes("/features/cad-studio/"))).toBe(true);
});
