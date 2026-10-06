/**
 * The permanent right-hand workspace (Details, Assistant, Pilot). Treatment A (F6):
 * docked at 1440 px and wider, Details first with a strip handover while typing, and
 * floating panels below 1440 px that refit the plant beside them when it can.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const assistant = (page: Page) => page.getByRole("complementary", { name: "AI assistant" });
const inspector = (page: Page) => page.getByRole("complementary", { name: "Equipment inspector" });
const viewport = (page: Page) => page.locator(".plant-view__box > svg");
const zoom = async (page: Page) => Number(await page.locator(".plant-view").getAttribute("data-zoom"));
const lastTurn = (page: Page) => page.locator(".agent-turn").last();
const dockLink = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name, exact: true });
const wsDock = (page: Page) => page.getByRole("toolbar", { name: "Workspace" });
const composer = (page: Page) => assistant(page).getByRole("textbox", { name: "Question for the assistant" });

/** Details above the conversation never push its composer out of the window. */
async function expectComposerInView(page: Page) {
  const send = (await assistant(page).getByRole("button", { name: "Send" }).boundingBox())!;
  expect(send.y + send.height).toBeLessThanOrEqual(page.viewportSize()!.height);
}

async function openOverview(page: Page, query = "") {
  await page.goto(`/?agentSpeed=fast${query}`);
  await expect(viewport(page).locator("[data-equipment-id]")).toHaveCount(16);
}

/** The zoom once the first fit has settled. */
async function settledZoom(page: Page) {
  let last = -1;
  await expect
    .poll(async () => {
      const z = await zoom(page);
      const stable = z === last;
      last = z;
      return stable;
    }, { intervals: [250] })
    .toBe(true);
  return last;
}

/** Right edge of the plant drawing's artwork, in the page. */
async function plantRight(page: Page) {
  const boxes = await viewport(page).locator(".eq-node__art").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  return Math.max(...boxes);
}

test("the workspace stays open beside every screen and keeps its conversation", async ({ page }) => {
  await openOverview(page, "&scenario=tower-fault");
  await expect(assistant(page)).toBeVisible();
  await page.getByRole("button", { name: "What needs attention right now?" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  for (const [section, heading] of [
    ["Engineering", "Engineering"],
    ["Analytics", "Cooling prediction"],
    ["Knowledge", "Knowledge"],
    ["Overview", "Overview"],
  ]) {
    await dockLink(page, section).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(assistant(page)).toBeVisible();
    await expect(lastTurn(page).locator(".agent-prose")).toContainText("ISS-0142");
  }
});

test("an answer keeps streaming when the assistant is expanded to the full page", async ({ page }) => {
  // Normal speed, so the answer is still streaming when the page changes.
  await page.goto("/?scenario=tower-fault");
  await expect(viewport(page).locator("[data-equipment-id]")).toHaveCount(16);
  await page.getByRole("button", { name: "What needs attention right now?" }).click();
  await expect(page.locator('[data-turn-status="running"]')).toBeVisible();
  await page.getByRole("link", { name: "Open full page" }).click();
  await expect(page).toHaveURL(/\/agent\?conversation=/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI assistant");
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 20_000 });
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("ISS-0142");
  await expect(page.locator(".agent-turn")).toHaveCount(1);
});

test("resize by keyboard, the width is remembered, and the workspace collapses to a dock", async ({ page }) => {
  await openOverview(page);
  const separator = page.getByRole("separator", { name: "Resize workspace" });
  const width = Number(await separator.getAttribute("aria-valuenow"));
  expect(width).toBe(352);
  await separator.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", String(width + 32));
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "320");
  expect(Math.round((await page.locator(".workspace").boundingBox())!.width)).toBe(320);
  await page.reload();
  await expect(page.getByRole("separator", { name: "Resize workspace" })).toHaveAttribute("aria-valuenow", "320");

  await page.getByRole("button", { name: "Collapse workspace" }).click();
  await expect(assistant(page)).toHaveCount(0);
  await wsDock(page).getByRole("button", { name: "Pilot" }).click();
  await expect(page.getByRole("complementary", { name: "AI pilot" })).toBeVisible();
});

test("the pilot works on simulations only and says what it needs", async ({ page }) => {
  await openOverview(page);
  await page.getByRole("tab", { name: "Pilot" }).click();
  const pilot = page.getByRole("complementary", { name: "AI pilot" });
  await expect(pilot.getByText("Simulation only", { exact: true })).toBeVisible();
  await expect(pilot).toContainText("The pilot never controls physical equipment.");
  await expect(pilot).toContainText("Not available yet");
  await expect(pilot.getByText("Planned", { exact: true })).toBeVisible();
  await expect(assistant(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Pilot" }).press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Assistant" })).toBeFocused();
  await expect(assistant(page)).toBeVisible();
});

test("Details first: typing hands the space to the conversation, the strip restores Details with the text kept", async ({ page }) => {
  await openOverview(page, "&scenario=tower-fault");
  await viewport(page).locator('[data-equipment-id="chiller_plant_1"] .eq-node__art').click();
  await expect(inspector(page)).toBeVisible();
  // Details lead; the assistant keeps only its tabs and composer.
  const details = (await inspector(page).boundingBox())!;
  const box = (await composer(page).boundingBox())!;
  expect(details.y).toBeLessThan(box.y);
  await expectComposerInView(page);
  await expect(page.getByRole("button", { name: "What needs attention right now?" })).toBeHidden();

  // Typing hands over: Details fold to a one-line strip and the conversation shows.
  await composer(page).fill("A draft question");
  const strip = page.getByRole("button", { name: /Chiller 1.*Show details/ });
  await expect(strip).toBeVisible();
  await expect(inspector(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Investigate Chiller 1" })).toBeVisible();
  // Escape in the composer belongs to the composer.
  await composer(page).press("Escape");
  await expect(strip).toBeVisible();

  await strip.click();
  await expect(inspector(page)).toBeVisible();
  await expect(composer(page)).toHaveValue("A draft question");
  await inspector(page).getByRole("heading", { level: 2 }).focus();
  await page.keyboard.press("Escape");
  await expect(inspector(page)).toHaveCount(0);
  await expect(composer(page)).toHaveValue("A draft question");
});

test("below 1440 px the workspace floats: the plant refits beside it at 1280, and dismissing takes one action", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openOverview(page, "&scenario=tower-fault");
  await expect(assistant(page)).toHaveCount(0);
  await expect(wsDock(page)).toBeVisible();
  const collapsed = await settledZoom(page);

  // Open from the dock: the panel floats and the plant refits beside it at half size or more.
  await wsDock(page).getByRole("button", { name: "Assistant" }).click();
  await expect(assistant(page)).toBeVisible();
  await expect.poll(() => zoom(page)).toBeLessThan(collapsed);
  expect(await zoom(page)).toBeGreaterThanOrEqual(0.5);
  const panel = (await page.locator(".workspace--float").boundingBox())!;
  expect(await plantRight(page)).toBeLessThanOrEqual(panel.x);
  // The drawing controls move left of the panel.
  const controls = (await page.getByRole("toolbar", { name: "Drawing" }).boundingBox())!;
  expect(controls.x + controls.width).toBeLessThanOrEqual(panel.x);

  // The same dock button again closes it, and the plant takes the room back.
  await wsDock(page).getByRole("button", { name: "Assistant" }).click();
  await expect(assistant(page)).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBeCloseTo(collapsed, 3);

  // Escape closes it too.
  await wsDock(page).getByRole("button", { name: "Assistant" }).click();
  await expect(assistant(page)).toBeVisible();
  await page.locator("body").press("Escape");
  await expect(assistant(page)).toHaveCount(0);

  // Details float the same way; clicking empty drawing dismisses them.
  await viewport(page).locator('[data-equipment-id="chiller_plant_2"] .eq-node__art').click();
  await expect(inspector(page)).toBeVisible();
  await expectComposerInView(page);
  const vb = (await viewport(page).boundingBox())!;
  await page.mouse.click(vb.x + 30, vb.y + vb.height / 2);
  await expect(inspector(page)).toHaveCount(0);
  await expect(assistant(page)).toHaveCount(0);
});

test("at 1024 px the panel covers part of the plant: the fit stays, the selection stays in view", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openOverview(page, "&scenario=tower-fault");
  const before = await settledZoom(page);
  await wsDock(page).getByRole("button", { name: "Assistant" }).click();
  await expect(assistant(page)).toBeVisible();
  expect(await zoom(page)).toBeCloseTo(before, 4);
  await page.getByRole("button", { name: "Collapse workspace" }).click();
  await expect(assistant(page)).toHaveCount(0);

  await viewport(page).locator('[data-equipment-id="terminal"] .eq-node__art').click();
  await expect(inspector(page)).toBeVisible();
  const panel = (await page.locator(".workspace--float").boundingBox())!;
  await expect
    .poll(async () => {
      const b = (await viewport(page).locator('[data-equipment-id="terminal"] .eq-node__art').boundingBox())!;
      return b.x + b.width;
    })
    .toBeLessThanOrEqual(panel.x);
  await expectComposerInView(page);
});

test("no serious accessibility violations with the workspace collapsed and the System menu open", async ({ page }) => {
  await openOverview(page);
  await page.getByRole("button", { name: "Collapse workspace" }).click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "System", exact: true }).click();
  await expect(page.getByRole("group", { name: "System and installation" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});

test("no serious accessibility violations with Details floating at 1280 px", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openOverview(page, "&scenario=tower-fault");
  await viewport(page).locator('[data-equipment-id="cooling_towers_4"] .eq-node__art').click();
  await expect(inspector(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});
