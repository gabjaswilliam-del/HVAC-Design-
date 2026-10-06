/**
 * The attention slot (F3, F8): the most severe open issue as one laminate tag with two
 * sibling buttons (open, acknowledge), Locate beside it, a page-title prefix and an
 * announcement for new issues, and a slot that is always reserved so the plant never
 * moves when an issue arrives.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const slot = (page: Page) => page.getByRole("group", { name: "Attention" });
const openButton = (page: Page) => page.locator(".attention .att__open");
const ack = (page: Page) => page.getByRole("button", { name: "Acknowledge" });
const node = (page: Page, id: string) => page.locator(`.plant-view__box [data-equipment-id="${id}"]`);

async function art(page: Page, id: string) {
  return (await node(page, id).locator(".eq-node__art").boundingBox())!;
}

test("a new issue takes the reserved slot without moving the plant, and is announced", async ({ page }) => {
  await page.goto("/?scenario=tower-fault&time=13:10");
  await expect(page.locator(".attention")).toContainText("No open issues");
  await expect(node(page, "chiller_plant_1")).toBeVisible();
  await page.waitForTimeout(300);
  const zoom = await page.locator(".plant-view").getAttribute("data-zoom");
  const before = await art(page, "cooling_towers_4");
  await expect(page).toHaveTitle("HVAC Agent · Overview");

  const slider = page.getByRole("slider", { name: "Time of day" });
  for (let i = 0; i < 3; i++) await slider.press("ArrowRight");
  await expect(openButton(page)).toHaveAttribute("aria-label", /^Critical issue ISS-0142: Cooling tower 4 fan fault, since 13:20/);
  await expect(page.locator(".attention .tag--attention")).toHaveClass(/tag--new/);
  await expect(page.getByRole("alert").filter({ hasText: "Critical issue: Cooling tower 4 fan fault." })).toBeAttached();
  await expect(page).toHaveTitle("(1) Critical · HVAC Agent · Overview");

  // No layout shift: the plant keeps its zoom and position.
  await expect(page.locator(".plant-view")).toHaveAttribute("data-zoom", zoom!);
  const after = await art(page, "cooling_towers_4");
  expect(Math.abs(after.x - before.x)).toBeLessThan(0.5);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.5);
});

test("Acknowledge is its own button, applies in this browser only and stops the pulse", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await expect(openButton(page)).toBeVisible();
  await expect(openButton(page)).toContainText("+1");
  await expect(page).toHaveTitle("(2) Critical · HVAC Agent · Overview");
  await expect(ack(page)).toHaveAttribute("title", "Acknowledged in this browser only; not recorded at the site");
  // Two sibling buttons styled as one tag: never one nested in the other.
  await expect(openButton(page).locator("button")).toHaveCount(0);

  // Never a single-key shortcut.
  await page.locator("body").press("a");
  await expect(ack(page)).toBeVisible();

  await ack(page).focus();
  await page.keyboard.press("Enter");
  await expect(ack(page)).toHaveCount(0);
  await expect(page.locator(".attention .tag--attention")).not.toHaveClass(/tag--new/);
  await expect(page.getByRole("alert").filter({ hasText: "Acknowledged in this browser." })).toBeAttached();
  await expect(page).toHaveTitle("HVAC Agent · Overview");
  // The issue itself is still open and shown.
  await expect(openButton(page)).toContainText("Cooling tower 4 fan fault");

  // Nothing was recorded anywhere: a reload brings the unacknowledged state back.
  await page.reload();
  await expect(ack(page)).toBeVisible();
});

test("the tag opens the issues, Locate finds the equipment, and . steps through open issues", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await openButton(page).click();
  const details = page.getByRole("complementary", { name: "Indicator details" });
  await expect(details.getByRole("heading", { level: 2 })).toHaveText("Open issues");
  await expect(openButton(page)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(openButton(page)).toBeFocused();

  await slot(page).getByRole("button", { name: "Locate Cooling tower 4 on plant" }).click();
  const inspector = page.getByRole("complementary", { name: "Equipment inspector" });
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
  await expect(node(page, "cooling_towers_4")).toHaveAttribute("aria-pressed", "true");

  // From any screen: "." opens the next open issue's equipment on the Overview.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Analytics", exact: true }).click();
  await page.locator("body").press(".");
  await expect(page).toHaveURL(/\/\?.*equipment=cooling_towers_1/);
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Cooling tower 1");
  await page.locator("body").press(".");
  await expect(inspector.getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
});

test("the attention slot is quiet when nothing is open", async ({ page }) => {
  await page.goto("/?scenario=normal");
  await expect(page.locator(".attention")).toContainText("No open issues");
  await expect(page).toHaveTitle("HVAC Agent · Overview");
  await page.locator("body").press(".");
  await expect(page.getByRole("complementary", { name: "Indicator details" }).getByText(/No open issues at 15:15/)).toBeVisible();
});

test("no serious accessibility violations with an unacknowledged alarm", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await expect(ack(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
