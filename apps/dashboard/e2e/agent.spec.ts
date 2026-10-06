/**
 * M5: AI assistant (scripted demonstration). Treatment A: the workspace is open beside
 * the plant at 1440 px; Details opened from an answer wait as a strip so the answer
 * stays in view.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const drawer = (page: Page) => page.getByRole("complementary", { name: "AI assistant" });
const viewport = (page: Page) => page.locator(".plant-view__box > svg");
const zoom = async (page: Page) => Number(await page.locator(".plant-view").getAttribute("data-zoom"));
const strip = (page: Page, name: string) => page.locator(".det-strip", { hasText: name });
const lastTurn = (page: Page) => page.locator(".agent-turn").last();

async function openMonitoring(page: Page, query = "") {
  await page.goto(`/?agentSpeed=fast${query}`);
  await expect(viewport(page).locator("[data-equipment-id]")).toHaveCount(16);
}

async function ask(page: Page, question: string) {
  await page.getByRole("button", { name: question }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
}

test("the assistant is clearly labelled and narrows the page instead of covering the plant", async ({ page }) => {
  // Width-bound fit (see monitoring test 6); start with the workspace collapsed.
  await page.setViewportSize({ width: 1440, height: 1100 });
  await openMonitoring(page);
  const docked = await zoom(page);
  await page.getByRole("button", { name: "Collapse workspace" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBeGreaterThan(docked);
  const wide = await zoom(page);
  await page.getByRole("toolbar", { name: "Workspace" }).getByRole("button", { name: "Assistant" }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByText("Scripted demo", { exact: true }).first()).toBeVisible();
  await expect(drawer(page).getByText(/No language model is connected/)).toBeVisible();
  await expect.poll(() => zoom(page)).toBeLessThan(wide);
  const box = (await viewport(page).boundingBox())!;
  for (const id of ["cooling_towers_1", "terminal", "cooling_water_pump_4"]) {
    const b = (await viewport(page).locator(`[data-equipment-id="${id}"] .eq-node__art`).boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
  await page.getByRole("button", { name: "Collapse workspace" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect.poll(() => zoom(page)).toBeCloseTo(wide, 2);
});

test("an investigation streams labelled simulated tool calls and a data-based answer", async ({ page }) => {
  await openMonitoring(page, "&scenario=tower-fault");
  await ask(page, "What needs attention right now?");
  const turn = lastTurn(page);
  await expect(turn.locator("[data-tool]")).toHaveCount(2);
  // Once the answer is written the steps fold into one line that names them simulated.
  const steps = turn.locator(".agent-activity__head");
  await expect(steps).toHaveText("Used 2 simulated tools");
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(turn.locator('[data-tool="list_issues"]')).toContainText("2 open, 0 resolved.");
  await expect(turn.locator(".agent-prose")).toContainText("Cooling tower 4 fan fault (ISS-0142)");
  await steps.click();
  await expect(turn.locator('[data-tool="list_issues"]')).toBeVisible();
  await expect(turn.locator('[data-tool="list_issues"] .agent-tool__label')).toHaveText("List open issues");
  await expect(turn.locator('[data-tool="list_issues"] .agent-tool__status')).toHaveText("Complete");
  await turn.locator('[data-tool="list_issues"] .agent-tool__head').click();
  await expect(turn.locator('[data-tool="list_issues"]')).toContainText("Arguments");
  await expect(turn.locator('[data-tool="list_issues"]')).toContainText("list_issues, simulated tool");
  await expect(page.getByRole("status").filter({ hasText: "Answer complete." })).toBeAttached();
});

test("answers navigate to equipment, the plant and issue details, keeping the answer in view", async ({ page }) => {
  await openMonitoring(page, "&scenario=tower-fault");
  await ask(page, "What needs attention right now?");
  const turn = lastTurn(page);

  // Locate selects the equipment and centres it; Details wait as a strip.
  await turn.getByRole("button", { name: "Locate Cooling tower 4" }).click();
  await expect(strip(page, "Cooling tower 4")).toBeVisible();
  await expect(viewport(page).locator('[data-equipment-id="cooling_towers_4"]')).toHaveAttribute("aria-pressed", "true");
  await expect(turn).toBeVisible();

  await turn.getByRole("button", { name: "Show on plant" }).click();
  await expect(viewport(page).locator(".eq-node--highlighted")).toHaveCount(5);

  await turn.getByRole("button", { name: "Open issues details" }).first().click();
  await expect(strip(page, "Open issues")).toBeVisible();
  await strip(page, "Open issues").click();
  const issues = page.getByRole("complementary", { name: "Indicator details" });
  await expect(issues.locator("[data-issue]")).toHaveCount(2);
  await issues.getByRole("button", { name: "Close indicator details" }).click();

  // Inspect opens Details from any screen; the conversation is kept.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Engineering", exact: true }).click();
  await lastTurn(page).getByRole("button", { name: "Inspect Cooling tower 4" }).click();
  await expect(page).toHaveURL(/\/\?equipment=cooling_towers_4/);
  await strip(page, "Cooling tower 4").click();
  await expect(page.getByRole("complementary", { name: "Equipment inspector" }).getByRole("heading", { level: 2 })).toHaveText("Cooling tower 4");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("ISS-0142");
});

test("asking from the equipment inspector investigates that equipment, with a failed knowledge tool shown", async ({ page }) => {
  await openMonitoring(page, "&scenario=tower-fault");
  await viewport(page).locator('[data-equipment-id="cooling_towers_4"] .eq-node__art').click();
  await page.getByRole("complementary", { name: "Equipment inspector" }).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(drawer(page).locator(".agent-context")).toContainText("equipment Cooling tower 4");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("Cooling tower 4 is in fault");
  await expect(lastTurn(page).locator('[data-tool="search_knowledge"]')).toHaveAttribute("data-tool-status", "error");
  await expect(lastTurn(page).locator('[data-tool="search_knowledge"]')).toContainText("not available in this demo build");
  await expect(lastTurn(page).getByRole("img", { name: /Fan frequency today/ })).toBeVisible();
});

test("asking from a KPI panel identifies a cooling shortfall", async ({ page }) => {
  await openMonitoring(page, "&scenario=pump-trip&time=14:12&kpi=plant:cooling_delivered_kw");
  await page.getByRole("complementary", { name: "Indicator details" }).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("of demand is not being met");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("The shortfall began at 14:05 UTC+8 and is still going on");
  await expect(lastTurn(page).locator(".ts-chart__legend")).toContainText("Running chiller capacity");
});

test("the forecast answer is a labelled baseline and links to the exact forecast", async ({ page }) => {
  await openMonitoring(page);
  await ask(page, "What cooling demand is forecast for the next 6 hours?");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("not a trained model");
  await lastTurn(page).getByRole("button", { name: "Open cooling prediction" }).click();
  await expect(page).toHaveURL(/\/prediction\?forecast=fc-normal-/);
  await expect(page.getByText(/Showing the forecast issued at/)).toBeVisible();
});

test("unmatched questions get an honest scripted reply; Enter sends", async ({ page }) => {
  await openMonitoring(page);
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("Write me a poem about chillers");
  await box.press("Enter");
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("no language model");
  await expect(lastTurn(page).locator("[data-tool]")).toHaveCount(0);
});

test("cancelling is confirmed and the composer works again", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
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
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("What needs attention right now?");
  await drawer(page).getByRole("button", { name: "Send" }).click();
  await expect(drawer(page).getByText(/The assistant is not available/)).toBeVisible();
  await expect(box).toHaveValue("What needs attention right now?");
  await expect(drawer(page).getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a failed data tool is shown and the answer continues with what is available", async ({ page }) => {
  await openMonitoring(page, "&scenario=pump-trip&time=14:12&fail=history:timeout");
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
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(history.locator("[data-conversation]")).toHaveCount(4);
  await expect(history.locator("[data-conversation]").first()).toContainText("How efficient is the plant right now?");

  // A link inside a recorded conversation switches the dashboard to its scenario.
  await history.getByRole("button", { name: /Is the plant meeting cooling demand\?/ }).click();
  await page.getByRole("button", { name: "Cooling delivered details" }).click();
  await expect(page.getByLabel("Demo scenario")).toHaveValue("pump-trip");
  await expect(page.locator(".clock__time")).toContainText("14:10");
});

test("narrow screens show the assistant full screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?agentSpeed=fast");
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await ask(page, "What needs attention right now?");
  await page.getByRole("button", { name: "Collapse workspace" }).click();
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
          await ask(page, "What needs attention right now?");
    } else {
      await expect(page.locator('[data-turn-status="complete"]')).toHaveCount(1);
    }
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
    // Answer views sit one level under the page's section headings.
    if (name === "assistant page") expect(results.violations.map((v) => v.id)).not.toContain("heading-order");
  });
}

/* Response experience, at the demonstration's own pace (no agentSpeed=fast). --------- */

const scroller = (page: Page) => drawer(page).locator(".agent-turns");
const position = (page: Page) => scroller(page).evaluate((el) => ({ top: el.scrollTop, end: el.scrollHeight - el.clientHeight }));
const behindEnd = async (page: Page) => {
  const p = await position(page);
  return p.end - p.top;
};
/** Records how the conversation is scrolled: "smooth" glides or instant moves. */
const recordScrolls = (page: Page) =>
  scroller(page).evaluate((el) => {
    const w = window as unknown as { scrolls: string[] };
    w.scrolls = [];
    const to = el.scrollTo.bind(el) as (o?: ScrollToOptions) => void;
    el.scrollTo = ((o?: ScrollToOptions) => (w.scrolls.push(String(o?.behavior)), to(o))) as typeof el.scrollTo;
  });
const scrolls = (page: Page) => page.evaluate(() => (window as unknown as { scrolls: string[] }).scrolls);

async function askLong(page: Page) {
  test.setTimeout(60_000); // a long answer at the demonstration's own pace
  await page.setViewportSize({ width: 1440, height: 760 });
  await page.goto("/?scenario=normal");
  await expect(drawer(page).getByRole("heading", { name: "Suggested questions" })).toBeVisible();
  await recordScrolls(page);
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("Investigate Chiller 2");
  await box.press("Enter");
  // The answer outgrows the panel while it is still being written.
  await expect.poll(async () => (await position(page)).end, { timeout: 15_000 }).toBeGreaterThan(120);
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "running");
}

test("a question shows at once, then a working line, the steps and an answer written in progressively", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await page.getByRole("button", { name: "What needs attention right now?" }).click();
  const turn = lastTurn(page);
  // Before the harness has replied: the question and a quiet working line, no steps yet.
  await expect(turn.locator(".agent-turn__prompt")).toContainText("What needs attention right now?");
  await expect(turn.locator(".agent-working")).toHaveText("Working");
  expect(await turn.locator("[data-tool]").count()).toBe(0);
  // Each step says what it is doing while it runs.
  await expect(turn.locator(".agent-tool--running .agent-tool__label").first()).toHaveText(/^(Listing open issues|Checking plant data)…$/);
  // The answer: written in while the turn runs, the steps folded, a caret at the end.
  const prose = turn.locator(".agent-prose");
  await expect(turn.locator(".agent-word").first()).toBeVisible({ timeout: 10_000 });
  await expect(turn).toHaveAttribute("data-turn-status", "running");
  await expect(turn.locator(".agent-activity__head")).toHaveAttribute("aria-expanded", "false");
  await expect(turn.locator(".agent-caret")).toHaveCount(1);
  // New words fade in; what is already shown stays as more arrives.
  await expect.poll(() => turn.locator(".agent-word").last().evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
  const first = (await prose.textContent())!;
  await expect.poll(async () => (await prose.textContent())!.length).toBeGreaterThan(first.length + 12);
  expect((await prose.textContent())!.startsWith(first)).toBe(true);
  await expect(turn).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(turn.locator(".agent-caret, .agent-word, .agent-working")).toHaveCount(0);
  // Two separate issues read as a list.
  await expect(prose.locator("li")).toHaveCount(2);
});

test("the view follows the answer until the reader scrolls up; Jump to latest brings it back", async ({ page }) => {
  await askLong(page);
  const turn = lastTurn(page);
  await expect.poll(() => behindEnd(page)).toBeLessThan(4);
  expect(await scrolls(page)).toContain("smooth"); // it glides to each new line
  // Scrolling up mid-answer: the view stays where the reader left it, even mid-glide.
  const end = (await position(page)).end;
  const box = (await scroller(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100);
  await page.mouse.wheel(0, -150);
  const jump = drawer(page).getByRole("button", { name: "Jump to latest" });
  await expect(jump).toBeVisible();
  await page.waitForTimeout(200);
  const held = (await position(page)).top;
  await expect.poll(async () => (await position(page)).end, { timeout: 15_000 }).toBeGreaterThan(end + 60);
  expect(Math.abs((await position(page)).top - held)).toBeLessThan(2);
  // Back to the latest, following again to the end of the answer.
  await jump.click();
  await expect(jump).toHaveCount(0);
  await expect(turn).toHaveAttribute("data-turn-status", "complete", { timeout: 20_000 });
  await expect.poll(() => behindEnd(page)).toBeLessThan(4);
});

test("keyboard: Home stops following, Jump to latest keeps focus in the conversation, steps open with Enter and Space", async ({ page }) => {
  await askLong(page);
  const turn = lastTurn(page);
  const log = drawer(page).getByRole("region", { name: "Conversation" });
  await log.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => (await position(page)).top).toBe(0);
  const jump = drawer(page).getByRole("button", { name: "Jump to latest" });
  await expect(jump).toBeVisible();
  await expect(turn).toHaveAttribute("data-turn-status", "complete", { timeout: 20_000 });
  expect((await position(page)).top).toBe(0);
  await jump.focus();
  await page.keyboard.press("Enter");
  await expect(jump).toHaveCount(0);
  await expect(log).toBeFocused();
  await expect.poll(() => behindEnd(page)).toBeLessThan(4);
  const steps = turn.locator(".agent-activity__head");
  await steps.focus();
  await page.keyboard.press("Enter");
  await expect(steps).toHaveAttribute("aria-expanded", "true");
  await expect(turn.locator('[data-tool="get_equipment"] .agent-tool__label')).toHaveText("Read equipment details");
  await page.keyboard.press("Space");
  await expect(steps).toHaveAttribute("aria-expanded", "false");
  await expect(turn.locator('[data-tool="get_equipment"]')).toBeHidden();
  // Opened steps and a finished answer meet the accessibility bar.
  await page.keyboard.press("Enter");
  const results = await new AxeBuilder({ page }).include("#assistant-panel").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
});

test("reduced motion: the answer still arrives progressively, without fades or glides", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await askLong(page);
  const turn = lastTurn(page);
  // Each new word is shown at full strength the moment it arrives.
  for (let i = 0; i < 5; i++) {
    const opacities = await turn.evaluate((el) => [...el.querySelectorAll(".agent-word")].map((w) => getComputedStyle(w).opacity));
    expect(opacities.filter((o) => o !== "1")).toEqual([]);
    await page.waitForTimeout(150);
  }
  await expect(turn).toHaveAttribute("data-turn-status", "complete", { timeout: 20_000 });
  const moves = await scrolls(page);
  expect(moves.length).toBeGreaterThan(0);
  expect(moves).not.toContain("smooth");
  await expect.poll(() => behindEnd(page)).toBeLessThan(2);
});

test("cancelling mid-answer keeps what was written, and the next question follows on", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await page.getByRole("button", { name: "Investigate Cooling tower 4" }).click();
  const turn = lastTurn(page);
  await expect(turn.locator(".agent-word").nth(5)).toBeVisible({ timeout: 15_000 });
  await drawer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(turn).toHaveAttribute("data-turn-status", "cancelled");
  await expect(turn).toContainText("Cancelled by you");
  await expect(turn.locator(".agent-caret, .agent-word")).toHaveCount(0);
  const kept = (await turn.locator(".agent-prose").textContent())!;
  expect(kept).toMatch(/^Cooling tower 4 is in fault/);
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("How efficient is the plant right now?");
  await box.press("Enter");
  await expect(page.locator(".agent-turn")).toHaveCount(2);
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(page.locator(".agent-turn").first().locator(".agent-prose")).toHaveText(kept);
  await expect(lastTurn(page).locator(".agent-prose p")).toHaveCount(1); // a simple question, a short answer
});

test("Cancel pressed before the first step still stops the answer", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await page.getByRole("button", { name: "What needs attention right now?" }).click();
  await drawer(page).getByRole("button", { name: "Cancel" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "cancelled");
  await expect(lastTurn(page).locator("[data-tool]")).toHaveCount(0);
  await expect(drawer(page).getByRole("button", { name: "Send" })).toBeVisible();
});
