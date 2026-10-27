/**
 * M5/M6: AI assistant, offline (no language model connected): offline rules read each
 * request into a typed intent; answers come from simulated, read-only tools; views the
 * request asks to see open in the workspace through typed actions. Treatment A: the
 * workspace is open beside the plant at 1440 px; Details opened from an answer wait as a
 * strip so the answer stays in view.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { consoleBand, consoleState, openConsole, pilotConsole, pilotStatus, startRun } from "./pilot-console";

const drawer = (page: Page) => page.getByRole("complementary", { name: "AI assistant" });
const viewport = (page: Page) => page.locator(".plant-view__box > svg");
const zoom = async (page: Page) => Number(await page.locator(".plant-view").getAttribute("data-zoom"));
const strip = (page: Page, name: string) => page.locator(".det-strip", { hasText: name });
const lastTurn = (page: Page) => page.locator(".agent-turn").last();
/** The Overview's AI display, and what it shows. */
const aiDisplay = (page: Page) => page.locator(".ai-display");
const shownTitle = (page: Page) => aiDisplay(page).getByRole("heading", { level: 2 });

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
  // What answers is said in words: no language model, offline rules.
  await expect(drawer(page).locator('[data-engine="offline"]')).toHaveText("No language model connected");
  await expect(drawer(page).getByText(/No language model is connected: offline rules read each request/)).toBeVisible();
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
  // The chat is not the chart surface: no chart here. Asked from its own Details, the
  // record is one link away and nothing else opens.
  await expect(lastTurn(page).locator(".ts-chart")).toHaveCount(0);
  await expect(lastTurn(page).getByRole("button", { name: "Cooling tower 4 record" })).toBeVisible();
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveCount(0);
});

test("asking from a KPI panel identifies a cooling shortfall", async ({ page }) => {
  await openMonitoring(page, "&scenario=pump-trip&time=14:12&kpi=plant:cooling_delivered_kw");
  await page.getByRole("complementary", { name: "Indicator details" }).getByRole("button", { name: "Ask the assistant" }).click();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("of demand is not being met");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("The shortfall began at 14:05 UTC+8 and is still going on");
  // The day's demand and delivery are shown on the Overview's AI display, not in the chat.
  await expect(lastTurn(page).locator(".ts-chart")).toHaveCount(0);
  await expect(lastTurn(page).locator('[data-view="display"]')).toHaveText(/Shown on the AI display: Cooling demand and delivery today/);
  await expect(page.getByRole("radio", { name: "AI display" })).toHaveAttribute("aria-checked", "true");
  await expect(shownTitle(page)).toHaveText("Cooling demand and delivery today");
  await expect(aiDisplay(page).getByRole("img", { name: /Cooling demand and delivery today/ })).toBeVisible();
  // The trend page is still one press away.
  await lastTurn(page).getByRole("button", { name: "Unmet demand trend" }).click();
  await expect(page).toHaveURL(/\/trend\?metric=plant%3Aunmet_kw/);
});

test("the forecast answer is a labelled baseline and opens the exact forecast it read", async ({ page }) => {
  await openMonitoring(page);
  await ask(page, "What cooling demand is forecast for the next 6 hours?");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("not a trained model");
  // The answer is a view, so it opens without being asked to.
  await expect(page).toHaveURL(/\/prediction\?forecast=fc-normal-/);
  await expect(page.getByText(/Showing the forecast issued at/)).toBeVisible();
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveText(/Opened in the workspace: Cooling prediction/);
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
  await expect(page.getByLabel("Demo scenario")).toHaveCount(0); // no scenario switch outside AI Pilot
  await expect(page.locator(".attention")).toContainText("CHW pump 2");
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
  await page.clock.install();
  await page.goto("/?scenario=tower-fault");
  const question = page.getByRole("button", { name: "What needs attention right now?" });
  await expect(question).toBeVisible();
  // Time stands still while the question is asked and cancelled: no step can have begun.
  // A margin the page's clock cannot pass before the pause, however loaded the machine.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 2000);
  await question.click();
  await drawer(page).getByRole("button", { name: "Cancel" }).click();
  await page.clock.resume();
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "cancelled");
  await expect(lastTurn(page).locator("[data-tool]")).toHaveCount(0);
  await expect(drawer(page).getByRole("button", { name: "Send" })).toBeVisible();
});

// M6 ---------------------------------------------------------------------------------

test("Stop from the keyboard: Escape in the composer stops the answer at once and keeps what was written", async ({ page }) => {
  await page.goto("/?scenario=tower-fault"); // the full demonstration pace
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("What needs attention right now?");
  await box.press("Enter");
  const turn = lastTurn(page);
  await expect(turn.locator(".agent-word").nth(3)).toBeVisible({ timeout: 15_000 });
  await expect(box).toBeFocused();
  await box.press("Escape");
  await expect(turn).toHaveAttribute("data-turn-status", "cancelled");
  const kept = (await turn.locator(".agent-prose").textContent())!;
  expect(kept.length).toBeGreaterThan(0);
  await page.waitForTimeout(800); // nothing more arrives after Stop
  await expect(turn.locator(".agent-prose")).toHaveText(kept);
  await expect(box).toBeFocused();
  await expect(drawer(page).getByRole("button", { name: "Send" })).toBeVisible();
  await expect(drawer(page)).toBeVisible(); // Escape here closes nothing else
});

test("the Stop button names its shortcut and hands focus back to the composer", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await page.getByRole("button", { name: "Investigate Cooling tower 4" }).click();
  await expect(drawer(page).locator("[data-tool]").first()).toBeVisible();
  const stop = drawer(page).getByRole("button", { name: "Cancel" });
  await expect(stop).toHaveAttribute("aria-keyshortcuts", "Escape");
  await stop.focus();
  await page.keyboard.press("Enter");
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "cancelled");
  await expect(drawer(page).getByLabel("Question for the assistant")).toBeFocused();
});

/* Workspace actions: what a request asks to see opens in the main display ------------- */

async function askTyped(page: Page, text: string, scope = drawer(page)) {
  const turns = await page.locator(".agent-turn").count();
  const box = scope.getByLabel("Question for the assistant");
  await box.fill(text);
  await box.press("Enter");
  await expect(page.locator(".agent-turn")).toHaveCount(turns + 1);
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
}

test("what the assistant retrieves is shown on the AI display; questions only answer", async ({ page }) => {
  await openMonitoring(page);
  await expect(page.getByRole("radio", { name: "Schematic" })).toHaveAttribute("aria-checked", "true");
  await askTyped(page, "Show me COP today");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
  await expect(page.getByRole("radio", { name: "AI display" })).toHaveAttribute("aria-checked", "true");
  await expect(shownTitle(page)).toHaveText("System COP today");
  await expect(aiDisplay(page).getByRole("img", { name: /System COP today/ })).toBeVisible();
  await expect(aiDisplay(page)).toContainText("From the assistant");
  const shown = page.locator(".agent-turn").first().locator('[data-view="display"]');
  await expect(shown).toHaveText(/Shown on the AI display: System COP today/);
  await expect(page.locator('.agent-turn').first().locator('[data-view="action"]')).toHaveCount(0);
  await expect(lastTurn(page).locator(".agent-prose")).toContainText(/^System COP is [\d.]+ at 15:15 UTC\+8\. Since the start of the day it has ranged from /);
  // The conversation keeps focus for a follow-up; what was shown is announced.
  await expect(drawer(page).getByLabel("Question for the assistant")).toBeFocused();
  await expect(drawer(page).getByRole("status").filter({ hasText: "Answer complete. Shown on the AI display: System COP today." })).toBeAttached();

  // A value now is answered in the conversation; the display keeps what it shows.
  await askTyped(page, "What's the COP now?");
  await expect(lastTurn(page).locator('[data-view="display"]')).toHaveCount(0);
  await expect(shownTitle(page)).toHaveText("System COP today");
  // A new retrieval replaces it; the earlier one stays one step away.
  await askTyped(page, "Is the plant meeting cooling demand?");
  await expect(shownTitle(page)).toHaveText("Cooling demand and delivery today");
  await expect(aiDisplay(page).getByLabel("Shown earlier")).toBeVisible();

  // Equipment opens its record; the earlier display item is one press away again.
  await askTyped(page, "open Chiller 2");
  await expect(page).toHaveURL(/\/equipment\/chiller_plant_2/);
  await shown.getByRole("button", { name: "Show: System COP today" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
  await expect(shownTitle(page)).toHaveText("System COP today");
});

test("simulation requests read the history and open recorded runs' replays, comparisons and findings", async ({ page }) => {
  // Two matched runs, ended, monitored from their first observation.
  await page.goto("/?simSpeed=fast&agentSpeed=fast");
  await openConsole(page);
  for (const run of ["RUN-0001", "RUN-0002"]) {
    expect(await startRun(page, { hours: "1 h", step: "15 min" })).toBe(run);
    await expect(consoleState(page)).toHaveText("Stopped", { timeout: 10_000 });
  }
  // Ending them opened nothing: the main display is still the Overview.
  await expect(page).toHaveURL(/\/\?simSpeed=fast&agentSpeed=fast$/);
  await page.getByRole("tab", { name: "Assistant" }).click(); // the docked workspace switches by tab

  await askTyped(page, "tell me our simulation history");
  await expect(page).toHaveURL(/\/simulation$/);
  await expect(lastTurn(page).locator('[data-tool="list_simulation_runs"]')).toHaveCount(1);
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("Two simulation runs are recorded, all ended.");

  await askTyped(page, "How did the last simulation go?");
  await expect(page).toHaveURL(/\/simulation\/RUN-0002$/);
  await expect(page.getByRole("region", { name: "Run summary, RUN-0002" })).toBeVisible();
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("RUN-0002 (Normal operation) completed after 60 of 60 simulated minutes.");
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveText(/Opened in the workspace: RUN-0002 summary and replay/);

  await askTyped(page, "compare the latest two simulations");
  await expect(page).toHaveURL(/\/simulation\/RUN-0002\?compare=RUN-0001/);
  await expect(page.getByLabel("Compare with")).toHaveValue("RUN-0001");
  await expect(lastTurn(page).locator(".agent-prose table")).toContainText("Average COP");

  // A recorded run asked to be shown is its replay.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Overview", exact: true }).click();
  await askTyped(page, "Show me the last simulation.");
  await expect(page).toHaveURL(/\/simulation\/RUN-0002$/);
  await expect(page.locator("main .replay .sim-run")).toHaveAttribute("data-run", "RUN-0002");
  const scrubber = page.locator("main").getByRole("slider", { name: "Replay" });
  await scrubber.focus();
  await page.keyboard.press("Home");
  await expect(scrubber).toHaveAttribute("aria-valuetext", /step 0 of 4$/);

  // An ended run's finding opens in its replay, chosen and in view; that replay starts at
  // its own last step, not where the previous one was scrubbed to.
  await askTyped(page, "inspect PIL-0001-1");
  await expect(page).toHaveURL(/\/simulation\/RUN-0001\?issue=PIL-0001-1/);
  await expect(page.locator('main [data-pilot-detail="PIL-0001-1"]')).toBeInViewport();
  await expect(scrubber).toHaveAttribute("aria-valuetext", /step 4 of 4$/);

  // Not found is said, and nothing opens.
  await askTyped(page, "open RUN-0099");
  await expect(page).toHaveURL(/\/simulation\/RUN-0001\?issue=PIL-0001-1/);
  await expect(lastTurn(page).locator(".agent-prose")).toHaveText("There is no RUN-0099 in the simulation history; the latest run is RUN-0002.");
});

test("F10: asked to operate the simulation, the assistant points to the operator's control and presses nothing", async ({ page }) => {
  await page.goto("/?simSpeed=fast&agentSpeed=fast");
  await openConsole(page);
  await startRun(page, { paused: true });
  await expect(consoleState(page)).toHaveText("Paused");
  const elapsed = await consoleBand(page).locator("[data-elapsed]").innerText();
  const pointed = pilotConsole(page).locator("[data-pointed]");
  const readOnly = ["list_simulation_runs", "get_simulation_run", "get_pilot_findings"];
  for (const [request, control] of [
    ["Stop the simulation", "stop"],
    ["Resume the simulation", "resume"],
    ["stop RUN-0001", "stop"],
    ["pause monitoring", "monitoring"],
    ["apply PIL-0001-1", "apply"], // the pilot's proposal from the first observation
    ["set chiller 1 setpoint to 9", "corrections"],
  ] as const) {
    await page.getByRole("tab", { name: "Assistant" }).click();
    await askTyped(page, request);
    await expect(lastTurn(page).locator(".agent-prose")).toContainText(/^I can't /);
    for (const tool of await lastTurn(page).locator("[data-tool]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tool")))) expect(readOnly).toContain(tool);
    // The one action points: AI Pilot opens with the control outlined, named in a note
    // that takes focus; the control itself is neither pressed nor focused.
    await expect(lastTurn(page).locator('[data-view="action"]')).toHaveAttribute("data-action", "reveal");
    await expect(lastTurn(page).locator('[data-view="action"]')).toContainText("Pointed to in AI Pilot (yours to press):");
    await expect(pointed).toHaveAttribute("data-pilot-control", control);
    await expect(pointed).not.toBeFocused();
    await expect(pilotConsole(page).locator(`[data-pointer="${control}"]`)).toBeFocused();
    await expect(consoleState(page)).toHaveText("Paused");
    await expect(consoleBand(page).locator("[data-elapsed]")).toHaveText(elapsed);
  }
  // Nothing to point to: said, and nothing opens.
  await page.getByRole("tab", { name: "Assistant" }).click();
  await askTyped(page, "apply PIL-0001-9");
  await expect(lastTurn(page).locator(".agent-prose")).toHaveText("I can't apply pilot proposals; only the operator can, in AI Pilot. PIL-0001-9 has no proposal waiting for a decision.");
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveCount(0);
  await askTyped(page, "Pause the simulation");
  await expect(lastTurn(page).locator(".agent-prose")).toHaveText("I can't pause RUN-0001, and it is paused, so that control is not offered now. Only you operate it, in AI Pilot.");
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveCount(0);
  await askTyped(page, "turn off chiller 1");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("I can't operate equipment, and nothing in this dashboard can");
  await expect(lastTurn(page).locator("[data-tool]")).toHaveCount(0);

  await openConsole(page);
  await expect(consoleState(page)).toHaveText("Paused");
  await expect(consoleBand(page).locator("[data-elapsed]")).toHaveText(elapsed);
  await expect(pilotStatus(page)).toHaveText("Waiting"); // still monitoring
  await pilotConsole(page).getByRole("tab", { name: "Corrections" }).click();
  await expect(pilotConsole(page).getByText("No corrections yet.")).toBeVisible();
  // Pointing moved nothing in the main display either: it is still the Overview.
  await expect(page).toHaveURL(/\/\?simSpeed=fast&agentSpeed=fast$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
});

test("questions whose answer is a view open it; follow-ups read the conversation; a value stays in the conversation", async ({ page }) => {
  await openMonitoring(page);
  // Nothing earlier to refer to: the assistant asks rather than guesses.
  await askTyped(page, "Show me its history");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText(/^I can't tell what “its” refers to here/);
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/");

  await askTyped(page, "How has COP been today?");
  await expect(shownTitle(page)).toHaveText("System COP today");
  // The indicator carries over; the period changes.
  await askTyped(page, "What about the last 6 hours?");
  await expect(lastTurn(page).locator('[data-view="display"]')).toHaveText(/Shown on the AI display: System COP, the last 6 hours/);
  await expect(shownTitle(page)).toHaveText("System COP, the last 6 hours");
  // Outside the one demo day: said plainly, and the display keeps what it shows.
  await askTyped(page, "How about yesterday?");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText("The demo data holds one synthetic day, so there is nothing for yesterday");
  await expect(lastTurn(page).locator('[data-view="display"]')).toHaveCount(0);
  await expect(shownTitle(page)).toHaveText("System COP, the last 6 hours");

  // Equipment opens its record; "its history" is that equipment's.
  await askTyped(page, "What is happening with Chiller 2?");
  await expect(page).toHaveURL(/\/equipment\/chiller_plant_2/);
  await askTyped(page, "Show me its history");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText(/^Chiller 2 today:/);
  await expect(page).toHaveURL(/\/equipment\/chiller_plant_2/);

  // A value now is answered in the conversation; the display stays, the trend a press away.
  await askTyped(page, "What's the COP now?");
  await expect(lastTurn(page).locator(".agent-prose")).toContainText(/^System COP is [\d.]+ at /);
  await expect(lastTurn(page).locator('[data-view="action"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/equipment\/chiller_plant_2/);
  await lastTurn(page).getByRole("button", { name: "System COP today" }).click();
  await expect(page).toHaveURL(/\/trend\?metric=plant%3Acop$/);
});

test("F10: the assistant's tools only read; simulation and pilot tools are named read only", async ({ page }) => {
  await page.goto("/agent?agentSpeed=fast");
  const tools = page.locator("[data-tool-name]");
  // Ten reading tools and show_on_display, which only draws on the operator's AI display.
  await expect(tools).toHaveCount(11);
  const names = await tools.evaluateAll((els) => els.map((e) => e.getAttribute("data-tool-name") ?? ""));
  expect(names.filter((n) => /correct|override|setpoint|release|start|stop|pause|resume|step|apply|monitor|create|command|submit/i.test(n))).toEqual([]);
  for (const name of ["list_simulation_runs", "get_simulation_run", "get_run_summary", "get_pilot_findings"]) {
    await expect(page.locator(`[data-tool-name="${name}"]`)).toContainText("Read only.");
  }
});

test("Stop before the action: a stopped answer opens nothing", async ({ page }) => {
  await page.goto("/?scenario=normal"); // the full demonstration pace
  await expect(drawer(page).getByRole("heading", { name: "Suggested questions" })).toBeVisible();
  const box = drawer(page).getByLabel("Question for the assistant");
  await box.fill("Show me COP today");
  await box.press("Enter");
  await expect(lastTurn(page).locator("[data-tool]").first()).toBeVisible({ timeout: 15_000 });
  await box.press("Escape");
  await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "cancelled");
  await page.waitForTimeout(1500); // past where the display would have come
  expect(new URL(page.url()).pathname).toBe("/");
  await expect(lastTurn(page).locator('[data-view="display"]')).toHaveCount(0);
  await expect(page.getByRole("radio", { name: "Schematic" })).toHaveAttribute("aria-checked", "true");
});

test("from the full assistant page, a display item takes the Overview and the conversation moves to the workspace", async ({ page }) => {
  await page.goto("/agent?agentSpeed=fast");
  await askTyped(page, "Show me COP today", page.getByRole("region", { name: "AI assistant" }));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
  await expect(shownTitle(page)).toHaveText("System COP today");
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).locator('[data-view="display"]')).toHaveText(/Shown on the AI display: System COP today/);
});

test("on a phone the AI display waits behind the conversation; Show reveals it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?agentSpeed=fast");
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await askTyped(page, "Show me COP today");
  await lastTurn(page).getByRole("button", { name: "Show: System COP today" }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(aiDisplay(page).getByRole("img", { name: /System COP today/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

/* Attachments: read in this browser; their content reaches the assistant ----------------- */

/** Node's Buffer, which file payloads take, reached through globalThis (no Node typings here). */
const bytes = (data: string | number[]) => (globalThis as unknown as { Buffer: { from(d: string | number[]): Uint8Array } }).Buffer.from(data);

test("attached text files are read, named in the question and described from their content; other files are refused with a reason", async ({ page }) => {
  await openMonitoring(page);
  const input = drawer(page).locator("[data-attach-input]");
  await expect(input).toHaveAttribute("accept", ".txt,.md,.csv,.tsv,.json,.log");
  await expect(drawer(page).getByRole("button", { name: "Attach text files" })).toHaveAccessibleDescription(/Text files only/);
  await input.setInputFiles([
    { name: "shift.csv", mimeType: "text/csv", buffer: bytes("time,cop,power_kw\n10:00,4.4,300\n10:15,4.6,310\n") },
    { name: "photo.png", mimeType: "image/png", buffer: bytes([137, 80, 78, 71, 13, 10, 26, 10]) },
  ]);
  const chips = drawer(page).getByRole("list", { name: "Attached files" });
  await expect(chips.getByRole("listitem")).toHaveText([/shift\.csv/]);
  await expect(drawer(page).getByRole("alert")).toHaveText("photo.png was not attached: only text files (.txt, .md, .csv, .tsv, .json, .log) can be read.");

  // A file can be removed, and chosen again.
  await chips.getByRole("button", { name: "Remove shift.csv" }).click();
  await expect(chips).toHaveCount(0);
  await expect(drawer(page).getByLabel("Question for the assistant")).toBeFocused();
  await input.setInputFiles([{ name: "shift.csv", mimeType: "text/csv", buffer: bytes("time,cop,power_kw\n10:00,4.4,300\n10:15,4.6,310\n") }]);
  await askTyped(page, "summarize this file");
  const turn = lastTurn(page);
  await expect(turn.locator(".agent-turn__prompt .agent-file")).toContainText("shift.csv");
  await expect(turn.locator(".agent-prose")).toContainText("It is a table of 2 rows and 3 columns: time, cop and power_kw.");
  await expect(turn.locator(".agent-prose")).toContainText("cop from 4.40 to 4.60 (mean 4.50)");
  await expect(drawer(page).getByRole("list", { name: "Attached files" })).toHaveCount(1); // only the sent turn's
});

/* Voice: behind the speech-to-text boundary -------------------------------------------- */

const countMicrophone = () => {
  const w = window as unknown as { micRequests: number };
  w.micRequests = 0;
  navigator.mediaDevices.getUserMedia = async () => {
    w.micRequests++;
    throw new DOMException("not expected", "NotAllowedError");
  };
};

test("voice without a speech-to-text service says so and never opens the microphone", async ({ page }) => {
  const stt: string[] = [];
  page.on("request", (r) => r.url().includes("/api/stt") && stt.push(r.url()));
  await page.addInitScript(countMicrophone);
  await openMonitoring(page);
  const mic = drawer(page).getByRole("button", { name: "Voice input: speech-to-text not connected" });
  await expect(mic).toHaveAttribute("aria-disabled", "true");
  // aria-disabled, not disabled: it stays reachable and a press explains.
  await mic.focus();
  await page.keyboard.press("Enter");
  await expect(drawer(page).getByRole("status").filter({ hasText: "Voice input needs a speech-to-text service. No speech-to-text service is connected in this build. The microphone is not used." })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { micRequests: number }).micRequests)).toBe(0);
  expect(stt).toEqual([]); // nothing probed or sent: no service is configured
  await expect(page.locator(".agent-turn")).toHaveCount(0);
});

test.describe("with a speech-to-text service", () => {
  /** A synthetic microphone: a tone, so MediaRecorder has real audio to encode. */
  const fakeMicrophone = () => {
    const w = window as unknown as { micRequests: number };
    w.micRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      w.micRequests++;
      const ctx = new AudioContext();
      const tone = ctx.createOscillator();
      const out = ctx.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      return out.stream;
    };
  };

  async function withService(page: Page, transcript = "show me COP today") {
    const posted: { type: string; bytes: number }[] = [];
    await page.route("**/api/stt/v1/models", (r) => r.fulfill({ json: { data: [{ id: "whisper-test" }] } }));
    await page.route("**/api/stt/v1/audio/transcriptions", async (r) => {
      posted.push({ type: r.request().headers()["content-type"] ?? "", bytes: r.request().postDataBuffer()?.length ?? 0 });
      await r.fulfill({ json: { text: transcript } });
    });
    return posted;
  }

  test("a recording is transcribed into the draft and sent like typed text", async ({ page }) => {
    const posted = await withService(page);
    await page.addInitScript(fakeMicrophone);
    await openMonitoring(page, "&stt=local");
    const mic = drawer(page).getByRole("button", { name: "Start voice input" });
    await mic.click();
    await expect(drawer(page).locator('[data-voice="recording"]')).toContainText("Recording");
    await expect(drawer(page).getByRole("button", { name: "Stop and transcribe" }).first()).toBeVisible();
    await page.waitForTimeout(600);
    await drawer(page).locator(".agent-voice").getByRole("button", { name: "Stop and transcribe" }).click();
    const box = drawer(page).getByLabel("Question for the assistant");
    await expect(box).toHaveValue("show me COP today");
    await expect(box).toBeFocused();
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toMatch(/^multipart\/form-data/);
    expect(posted[0].bytes).toBeGreaterThan(200);
    // The words are the operator's to send: the same path as typing.
    await expect(page.locator(".agent-turn")).toHaveCount(0);
    await box.press("Enter");
    await expect(lastTurn(page)).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/trend\?metric=plant%3Acop/);
  });

  test("a discarded recording sends nothing; a refused microphone is explained", async ({ page }) => {
    const posted = await withService(page);
    await page.addInitScript(fakeMicrophone);
    await openMonitoring(page, "&stt=local");
    await drawer(page).getByRole("button", { name: "Start voice input" }).click();
    await drawer(page).getByRole("button", { name: "Discard recording" }).click();
    await expect(drawer(page).locator(".agent-voice")).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(posted).toHaveLength(0);
    await expect(drawer(page).getByLabel("Question for the assistant")).toHaveValue("");

    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("denied", "NotAllowedError");
      };
    });
    await drawer(page).getByRole("button", { name: "Start voice input" }).click();
    await expect(drawer(page).getByRole("alert")).toHaveText(/Microphone access was refused/);
  });
});
