/** M5: AI assistant (scripted demonstration). */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const drawer = (page: Page) => page.getByRole("complementary", { name: "AI assistant" });
const viewport = (page: Page) => page.locator(".plant-viewport__box > svg");
const zoom = async (page: Page) => Number(await page.locator(".plant-viewport").getAttribute("data-zoom"));
const lastTurn = (page: Page) => page.locator(".agent-turn").last();

async function openMonitoring(page: Page, query = "") {
  await page.goto(`/?agentSpeed=fast${query}`);
  await expect(viewport(page).locator("[data-equipment-id]")).toHaveCount(16);
}

async function ask(page: Page, question: string) {
  await page.getByRole("button", { name: question }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete");
}

test("the drawer is clearly labelled and narrows the page instead of covering the plant", async ({ page }) => {
  await openMonitoring(page);
  const wide = await zoom(page);
  await page.getByRole("button", { name: "AI assistant" }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByText("Scripted demo", { exact: true }).first()).toBeVisible();
  await expect(drawer(page).getByText(/No language model is connected/)).toBeVisible();
  await expect.poll(() => zoom(page)).toBeLessThan(wide);
  const box = (await viewport(page).boundingBox())!;
  for (const id of ["cooling_towers_1", "terminal", "cooling_water_pump_4"]) {
    const b = (await viewport(page).locator(`[data-equipment-id="${id}"] .eq-node__art`).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  await drawer(page).getByRole("button", { name: "Close assistant" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBeCloseTo(wide, 2);
});

test("an investigation streams labelled simulated tool calls and a data-based answer", async ({ page }) => {
  await openMonitoring(page, "&scenario=tower-fault");
  await page.getByRole("button", { name: "AI assistant" }).click();
  await ask(page, "What needs attention right now?");
  const turn = lastTurn(page);
  await expect(turn.locator("[data-tool]")).toHaveCount(2);
  await expect(turn.locator('[data-tool="list_issues"]')).toContainText("Simulated tool");
  await expect(turn.locator('[data-tool="list_issues"]')).toContainText("2 open, 0 resolved.");
  await expect(turn.locator(".agent-prose")).toContainText("Cooling tower 4 fan fault (ISS-0142)");
  await turn.locator('[data-tool="list_issues"] .agent-tool__head').click();
  await expect(turn.locator('[data-tool="list_issues"]')).toContainText("Arguments");
  await expect(page.getByRole("status").filter({ hasText: "Answer complete." })).toBeAttached();
});

test("answers navigate to equipment, the plant and issue details", async ({ page }) => {
  await openMonitoring(page, "&scenario=tower-fault");
  await page.getByRole("button", { name: "AI assistant" }).click();
  await ask(page, "What needs attention right now?");
  const turn = lastTurn(page);

  await turn.getByRole("button", { name: "Open issues details" }).first().click();
  await expect(page.getByRole("complementary", { name: "Indicator details" }).locator("[data-issue]")).toHaveCount(2);

  await turn.getByRole("button", { name: "Locate Cooling tower 4" }).click();
  await expect(page.getByRole("complementary", { name: "Equipment inspector" }).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
  await expect.poll(() => zoom(page)).toBeGreaterThanOrEqual(1);

  await turn.getByRole("button", { name: "Show on plant" }).click();
  await expect(viewport(page).locator(".eq-node--highlighted")).toHaveCount(5);

  await turn.getByRole("button", { name: "Inspect Cooling tower 4" }).click();
  await expect(page).toHaveURL(/\/equipment\/cooling_towers_4/);
  await expect(page.getByRole("complementary", { name: "Equipment inspector" }).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
  // The drawer and its conversation stay open across screens.
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("ISS-0142");
});

test("asking from the equipment inspector investigates that equipment, with a failed knowledge tool shown", async ({ page }) => {
  await openMonitoring(page, "&scenario=tower-fault");
  await viewport(page).locator('[data-equipment-id="cooling_towers_4"] .eq-node__art').click();
  await page.getByRole("complementary", { name: "Equipment inspector" }).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete");
  await expect(drawer(page).locator(".agent-context")).toContainText("equipment Cooling tower 4");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("Cooling tower 4 is in fault");
  await expect(lastTurn(page).locator('[data-tool="search_knowledge"]')).toHaveAttribute("data-tool-status", "error");
  await expect(lastTurn(page).locator('[data-tool="search_knowledge"]')).toContainText("not available in this demo build");
  await expect(lastTurn(page).getByRole("img", { name: /Fan frequency today/ })).toBeVisible();
});

test("asking from a KPI panel identifies a cooling shortfall", async ({ page }) => {
  await openMonitoring(page, "&scenario=pump-trip&time=14:12&kpi=plant:cooling_delivered_kw");
  await page.getByRole("complementary", { name: "Indicator details" }).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("of demand is not being met");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("Shortfall periods today: 14:05 UTC+8 to now");
  await expect(lastTurn(page).locator(".ts-chart__legend")).toContainText("Running chiller capacity");
});

test("the forecast answer is a labelled baseline and links to the exact forecast", async ({ page }) => {
  await openMonitoring(page);
  await page.getByRole("button", { name: "AI assistant" }).click();
  await ask(page, "What cooling demand is forecast for the next 6 hours?");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("not a trained model");
  await lastTurn(page).getByRole("button", { name: "Open cooling prediction" }).click();
  await expect(page).toHaveURL(/\/prediction\?forecast=fc-normal-/);
  await expect(page.getByText(/Showing the forecast issued at/)).toBeVisible();
});

test("unmatched questions get an honest scripted reply; Enter sends", async ({ page }) => {
  await openMonitoring(page);
  await page.getByRole("button", { name: "AI assistant" }).click();
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("Write me a poem about chillers");
  await box.press("Enter");
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("no language model");
  await expect(lastTurn(page).locator("[data-tool]")).toHaveCount(0);
});

test("cancelling is confirmed and the composer works again", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByRole("button", { name: "Investigate Cooling tower 4" }).click();
  await expect(drawer(page).locator("[data-tool]").first()).toBeVisible();
  await drawer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "cancelled");
  await expect(lastTurn(page)).toContainText("Cancelled by you");
  await expect(lastTurn(page).locator('[data-tool-status="running"]')).toHaveCount(0);
  await expect(drawer(page).getByRole("button", { name: "Send" })).toBeVisible();
});

test("an unavailable assistant is reported and the question is kept", async ({ page }) => {
  await openMonitoring(page, "&fail=agent:unavailable");
  await page.getByRole("button", { name: "AI assistant" }).click();
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("What needs attention right now?");
  await drawer(page).getByRole("button", { name: "Send" }).click();
  await expect(drawer(page).getByText(/The assistant is not available/)).toBeVisible();
  await expect(box).toHaveValue("What needs attention right now?");
  await expect(drawer(page).getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a failed data tool is shown and the answer continues with what is available", async ({ page }) => {
  await openMonitoring(page, "&scenario=pump-trip&time=14:12&fail=history:timeout");
  await page.getByRole("button", { name: "AI assistant" }).click();
  await ask(page, "Is the plant meeting cooling demand?");
  await expect(lastTurn(page).locator('[data-tool="get_history"]')).toHaveAttribute("data-tool-status", "error");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("Today's history could not be retrieved");
});

test("conversation history keeps recorded context; links follow it; new questions use the current one", async ({ page }) => {
  await page.goto("/agent?agentSpeed=fast");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("AI assistant");
  const history = page.getByRole("navigation", { name: "Conversations" });
  await expect(history.locator("[data-conversation]")).toHaveCount(3);
  await history.getByRole("button", { name: /What needs attention right now\?/ }).click();
  await expect(page).toHaveURL(/conversation=demo-3/);
  await expect(page.getByText(/This conversation is about Cooling tower 4 fan fault at 15:15/)).toBeVisible();
  await expect(page.locator('[data-turn-status="complete"]')).toHaveCount(1);
  const tools = page.getByRole("region", { name: "Simulated tools" });
  await expect(tools.locator('[data-tool-name="search_knowledge"]')).toContainText("Not available");

  await page.getByRole("button", { name: "Ask in the current context" }).click();
  await expect(page.getByRole("heading", { name: "Suggested questions" })).toBeVisible();
  await page.getByRole("button", { name: "How efficient is the plant right now?" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete");
  await expect(history.locator("[data-conversation]")).toHaveCount(4);
  await expect(history.locator("[data-conversation]").first()).toContainText("How efficient is the plant right now?");

  // A link inside a recorded conversation switches the dashboard to its scenario.
  await history.getByRole("button", { name: /Is the plant meeting cooling demand\?/ }).click();
  await page.getByRole("button", { name: "Cooling delivered details" }).click();
  await expect(page.getByLabel("Demo scenario").filter({ visible: true })).toHaveValue("pump-trip");
  await expect(page.locator(".monitoring__status")).toContainText("Readings at 14:10");
});

test("narrow screens show the assistant full screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?agentSpeed=fast");
  await page.getByRole("button", { name: "AI assistant" }).click();
  await ask(page, "What needs attention right now?");
  await drawer(page).getByRole("button", { name: "Close assistant" }).click();
  await expect(drawer(page)).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

for (const [name, url] of [
  ["assistant page", "/agent?agentSpeed=fast&conversation=demo-1"],
  ["drawer on monitoring", "/?agentSpeed=fast&scenario=tower-fault"],
] as const) {
  test(`no serious accessibility violations: ${name}`, async ({ page }) => {
    await page.goto(url);
    if (name.startsWith("drawer")) {
      await page.getByRole("button", { name: "AI assistant" }).click();
      await ask(page, "What needs attention right now?");
    } else {
      await expect(page.locator('[data-turn-status="complete"]')).toHaveCount(1);
    }
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
  });
}
