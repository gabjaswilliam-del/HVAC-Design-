/**
 * The agent map inside the AI assistant: one control in the composer, left of Send, for the
 * conversation's current (or latest) execution. Its badge counts subagents running now. The
 * demo harness reports one agent, the root offline responder, so it shows 0 and no green dot,
 * and no token usage.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const map = (page: Page) => page.getByRole("dialog", { name: "Agent map" });
const assistant = (page: Page) => page.getByRole("complementary", { name: "AI assistant" });
const mapButton = (page: Page) => page.locator(".agent-composer").getByRole("button", { name: /^Agent map/ });

test("the composer's agent map follows the running answer, opens from the keyboard and closes back to it", async ({ page }) => {
  await page.goto("/?scenario=tower-fault");
  await expect(assistant(page)).toBeVisible();
  await expect(mapButton(page)).toHaveCount(0); // nothing has run in this conversation yet
  await assistant(page).getByRole("button", { name: "What needs attention right now?" }).click();
  const turn = page.locator(".agent-turn").last();
  await expect(turn).toHaveAttribute("data-turn-status", "running");

  // One entry point, in the composer's bar just before Stop/Send; none in the answer.
  await expect(mapButton(page)).toBeVisible();
  await expect(page.locator(".agent-turn .agent-map-button")).toHaveCount(0);
  const bar = page.locator(".agent-composer__bar");
  expect(await bar.evaluate((el) => {
    const kids = Array.from(el.children);
    return kids.indexOf(el.querySelector(".agent-map-button")!) === kids.length - 2;
  })).toBe(true);
  // The demo's only agent is the root: no subagent runs, so no green dot and a count of 0.
  await expect(mapButton(page)).toHaveAttribute("aria-label", "Agent map, 0 subagents running");
  await expect(mapButton(page)).toHaveAttribute("data-state", "idle");

  await mapButton(page).focus();
  await page.keyboard.press("Enter");
  const dialog = map(page);
  await expect(dialog).toBeVisible();
  await expect(mapButton(page)).toHaveAttribute("aria-expanded", "true"); // its open state
  await expect(dialog).toContainText("What needs attention right now?");
  await expect(dialog).toContainText("Token usage not reported");
  // The request is the task card (its execution, the root agent, is the card itself).
  const task = dialog.locator('.agent-map__card[data-kind="task"]');
  await expect(task).toHaveCount(1);
  await expect(task).toContainText("What needs attention right now?");
  await expect(task).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator('.agent-map__card[data-kind="agent"]')).toHaveCount(0);
  const details = dialog.getByRole("complementary", { name: "Agent details" });
  await expect(details).toContainText("Executed byAI Assistant");

  // The turn finishes while the map is open: its status, time and tool calls follow.
  await expect(task).toHaveAttribute("data-status", "complete", { timeout: 20_000 });
  await expect(details).toContainText("Complete");
  // Its tool calls branch right from the task card off one spine.
  const taskKey = await task.getAttribute("data-node-key");
  await expect(dialog.locator(`.agent-map__card[data-kind="tool"][data-parent-key="${taskKey}"]`)).toHaveCount(2);
  await expect(dialog.locator(".agent-map__edges path")).toHaveCount(4); // stub, spine, 2 branches
  await expect(task).toContainText("2 tools");
  await expect(details).toContainText(/Duration\s*\d/);
  const serious = (await new AxeBuilder({ page }).include(".agent-map").analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(mapButton(page)).toBeFocused();
  await expect(mapButton(page)).toHaveAttribute("aria-expanded", "false");
  // The pill matches Send's height and sits on the same centre line.
  const pill = (await mapButton(page).boundingBox())!;
  const send = (await page.locator(".agent-composer__bar").getByRole("button", { name: "Send" }).boundingBox())!;
  expect(pill.height).toBeGreaterThanOrEqual(34);
  expect(pill.height).toBeLessThanOrEqual(38);
  expect(Math.abs(pill.y + pill.height / 2 - (send.y + send.height / 2))).toBeLessThanOrEqual(1);
  await expect(turn).toHaveAttribute("data-turn-status", "complete");
});

test("the owner's scenario: three requests in one conversation are three branches, stacked, all kept", async ({ page }) => {
  await page.goto("/agent?agentSpeed=fast&scenario=tower-fault");
  const box = page.getByRole("textbox", { name: "Question for the assistant" });
  const prompts = ["Calculate Chiller 1 COP.", "Check simulation.", "Compare temperatures."];
  for (const [i, prompt] of prompts.entries()) {
    await box.fill(prompt);
    await box.press("Enter");
    await expect(page.locator(".agent-turn")).toHaveCount(i + 1);
    await expect(page.locator(".agent-turn").last()).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  }
  await mapButton(page).click();
  const dialog = map(page);
  await expect(dialog).toContainText("3 tasks");
  const tasks = dialog.locator('.agent-map__card[data-kind="task"]');
  await expect(tasks).toHaveCount(3);
  const boxes = await tasks.evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? "", key: e.getAttribute("data-node-key")!, left: parseFloat((e as HTMLElement).style.left), top: parseFloat((e as HTMLElement).style.top) })));
  // In the order asked, top to bottom, every task card in the left column.
  boxes.forEach((b, i) => expect(b.text).toContain(prompts[i]));
  expect(new Set(boxes.map((b) => b.left)).size).toBe(1);
  expect(boxes[0].top).toBeLessThan(boxes[1].top);
  expect(boxes[1].top).toBeLessThan(boxes[2].top);
  // Each task's steps branch right from it and stay inside its own band.
  const cards = await dialog.locator(".agent-map__card").evaluateAll((els) => els.map((e) => ({ task: e.getAttribute("data-task-key")!, parent: e.getAttribute("data-parent-key"), left: parseFloat((e as HTMLElement).style.left), top: parseFloat((e as HTMLElement).style.top) })));
  for (const b of boxes) {
    const own = cards.filter((c) => c.task === b.key);
    for (const c of own.filter((x) => x.parent === b.key)) expect(c.left).toBeGreaterThan(b.left);
    const next = boxes[boxes.indexOf(b) + 1];
    if (next) for (const c of own) expect(c.top).toBeLessThan(Math.min(...cards.filter((x) => x.task === next.key).map((x) => x.top)));
  }
  // Every branch can be scrolled into view.
  await tasks.first().scrollIntoViewIfNeeded();
  await expect(tasks.first()).toBeInViewport();
  await tasks.last().scrollIntoViewIfNeeded();
  await expect(tasks.last()).toBeInViewport();
});

test("a past conversation's map stays available, and each conversation shows its own", async ({ page }) => {
  await page.goto("/agent?agentSpeed=fast&conversation=demo-1");
  await expect(page.locator(".agent-turn").first()).toHaveAttribute("data-turn-status", "complete");
  // A stored answer reads without its tool calls, which stay in the map.
  await expect(page.locator(".agent-turn .agent-prose").first()).not.toBeEmpty();
  await expect(page.locator(".agent-turn [data-tool], .agent-turn .agent-activity")).toHaveCount(0);
  await mapButton(page).click();
  await expect(map(page)).toContainText("Investigate CHW pump 3");
  expect(await map(page).locator('.agent-map__card[data-kind="tool"]').count()).toBeGreaterThan(0);
  await expect(map(page).locator('.agent-map__card[data-kind="task"]')).toHaveCount(1);
  await expect(map(page).locator('.agent-map__card[data-kind="task"]')).toHaveAttribute("data-status", "complete");
  await map(page).getByRole("button", { name: "Close agent map" }).click();
  await expect(map(page)).toHaveCount(0);

  await page.getByRole("navigation", { name: "Conversations" }).getByRole("button", { name: /What needs attention right now\?/ }).click();
  await expect(page).toHaveURL(/conversation=demo-3/);
  await mapButton(page).click();
  await expect(map(page)).toContainText("What needs attention right now?");
  await expect(map(page)).not.toContainText("Investigate CHW pump 3");
});

test("on a phone the control keeps its count beside Send without covering it or the question box", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?agentSpeed=fast");
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  await assistant(page).getByRole("button", { name: "What needs attention right now?" }).click();
  await expect(page.locator(".agent-turn").last()).toHaveAttribute("data-turn-status", "complete", { timeout: 15_000 });
  const control = (await mapButton(page).boundingBox())!;
  const send = (await assistant(page).getByRole("button", { name: "Send" }).boundingBox())!;
  const input = (await assistant(page).getByRole("textbox", { name: "Question for the assistant" }).boundingBox())!;
  expect(control.x + control.width).toBeLessThanOrEqual(send.x);
  expect(control.y).toBeGreaterThanOrEqual(input.y + input.height);
  await expect(mapButton(page).locator(".agent-map-button__count")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
