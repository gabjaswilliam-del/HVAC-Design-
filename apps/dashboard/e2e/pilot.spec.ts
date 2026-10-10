/**
 * AI Pilot, the operator console of a live simulation, in the workspace: set up and name a
 * run, start it, operate it, watch the pilot's findings, decide on its proposals and read
 * its short result when it ends. The main display stays the operator's own throughout; a
 * recorded run's Simulation replay opens only when asked. On the labelled mock simulation
 * and pilot services; nothing reaches physical equipment. `simSpeed=fast` runs the same
 * lifecycle at a tenth of the demonstration pace.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { completion, consoleBand, consoleState, control, idle, openConsole, pilotConsole, pilotStatus, replay, settled, startRun, viewReplay } from "./pilot-console";

const ledger = (page: Page, id: string) => pilotConsole(page).locator(`[data-correction="${id}"]`);
const elapsed = (page: Page) => consoleBand(page).locator("[data-elapsed]");
const minutesDone = async (page: Page) => {
  const [h, m] = ((await elapsed(page).innerText()).match(/^(\d+):(\d\d)/) ?? ["", "0", "0"]).slice(1).map(Number);
  return h * 60 + m;
};
const consoleTab = (page: Page, name: string | RegExp) => pilotConsole(page).getByRole("tab", { name });
/** Nothing of the run is in the main display: no band, no controls, no plant of it. */
const mainIsOwn = async (page: Page, path: RegExp, h1: string) => {
  await expect(page).toHaveURL(path);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
  await expect(page.locator("main .sim-run, main .replay, main [data-sim-frame]")).toHaveCount(0);
};

async function open(page: Page, query = "") {
  await page.goto(`/?simSpeed=fast${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await openConsole(page);
}

test("AI Pilot sets up, names and starts a run in one place; the main display stays where the operator left it", async ({ page }) => {
  await open(page);
  const c = pilotConsole(page);
  for (const tag of ["Simulation only", "Mock pilot service", "Mock simulation service"]) await expect(c.getByText(tag, { exact: true })).toBeVisible();
  await expect(c).toContainText("The pilot never controls physical equipment.");
  // Set-up lives in AI Pilot, from the service's capabilities: scenarios included.
  await expect(c.getByLabel("Scenario", { exact: true })).toContainText("Normal operation");
  await expect(c.getByLabel("Scenario", { exact: true })).toContainText("Afternoon peak");
  await expect(c.getByLabel("Scenario", { exact: true })).toContainText("Cooling tower 4 fan fault");
  await expect(c.getByLabel("Timestep").locator("option")).toHaveText(["5 min", "10 min", "15 min"]);
  await expect(c.getByLabel("Duration").locator("option")).toHaveText(["1 h", "3 h", "6 h", "12 h"]);
  await expect(c.getByLabel("Start time")).toHaveValue("12:00");
  await c.getByLabel("Name", { exact: true }).fill("Afternoon check");
  // A double click starts one run, not two.
  await c.getByRole("button", { name: "Start paused" }).dblclick();
  await expect(consoleBand(page)).toHaveAttribute("data-run", "RUN-0001");
  await idle(page);

  // The console operates it: the name, the ID, its state and only the controls it allows.
  await expect(consoleBand(page).getByRole("heading", { level: 2 })).toHaveText("Afternoon check RUN-0001");
  await expect(consoleState(page)).toHaveText("Paused");
  await expect(consoleBand(page).getByRole("group", { name: "Run controls" }).getByRole("button")).toHaveText(["Resume", "Step", "Stop simulation"]);
  // The form's focus moves to the run's first control.
  await expect(consoleBand(page).getByRole("button", { name: "Resume" })).toBeFocused();
  await expect(pilotStatus(page)).toHaveText("Waiting"); // monitoring from the first observation; nothing to switch on
  await expect(c.getByRole("region", { name: "Simulated readings at 12:00" }).locator("[data-reading]")).toHaveCount(6);

  // Start paused moved nothing in the main display: it is still the Overview.
  await mainIsOwn(page, /\/\?simSpeed=fast$/, "Overview");
  await expect(page.locator("main").getByRole("button", { name: /^(Resume|Pause|Step|Stop simulation|Apply|Decline)/ })).toHaveCount(0);

  await page.goto("/simulation?simSpeed=fast");
  await expect(page.locator("[data-history-run]")).toHaveCount(1);
  await expect(page.locator('[data-history-run="RUN-0001"]')).toContainText("Afternoon check");
});

test("Start keeps the main display on its screen too, and the run goes on while the operator works elsewhere", async ({ page }) => {
  await page.goto("/prediction?simSpeed=fast");
  await expect(page.getByRole("heading", { level: 1, name: "Cooling prediction" })).toBeVisible();
  await openConsole(page);
  await startRun(page, { hours: "12 h", start: "08:00" });
  await expect(consoleState(page)).toHaveText("Running");
  await mainIsOwn(page, /\/prediction\?simSpeed=fast$/, "Cooling prediction");
  // The operator moves on: the main display goes where they go; AI Pilot keeps the run.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  const before = await minutesDone(page);
  await expect.poll(() => minutesDone(page)).toBeGreaterThan(before);
  // Choosing a view in AI Pilot changes AI Pilot only.
  await consoleTab(page, /Findings/).click();
  await consoleTab(page, "Corrections").click();
  await mainIsOwn(page, /\/\?simSpeed=fast$/, "Overview");
});

test("a run can be renamed in AI Pilot; its name follows it everywhere", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true });
  await expect(consoleBand(page).locator("[data-run-name]")).toHaveText("Normal operation from 12:00");
  await consoleBand(page).getByRole("button", { name: "Rename RUN-0001" }).click();
  const field = consoleBand(page).getByLabel("Name of RUN-0001");
  await expect(field).toBeFocused();
  await field.fill("   ");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.press("Escape");
  await expect(consoleBand(page).locator("[data-run-name]")).toHaveText("Normal operation from 12:00");
  await consoleBand(page).getByRole("button", { name: "Rename RUN-0001" }).click();
  await consoleBand(page).getByLabel("Name of RUN-0001").fill("Warmer setpoint trial");
  await consoleBand(page).getByLabel("Name of RUN-0001").press("Enter");
  await expect(consoleBand(page).locator("[data-run-name]")).toHaveText("Warmer setpoint trial");
  await control(page, "Stop simulation");
  await expect(completion(page)).toContainText("Warmer setpoint trial");
  await viewReplay(page, "RUN-0001");
  await expect(replay(page).locator(".sim-run [data-run-name]")).toHaveText("Warmer setpoint trial");
  // The replay is read-only: no renaming there.
  await expect(page.locator("main").getByRole("button", { name: "Rename RUN-0001" })).toHaveCount(0);
  await page.goto("/simulation?simSpeed=fast");
  await expect(page.locator('[data-history-run="RUN-0001"]')).toContainText("Warmer setpoint trial");
});

test("the console operates the lifecycle; reading never advances the clock; the end gives a short result here and the replay on request", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true });
  await page.waitForTimeout(800); // many reads at this pace; the clock is held
  await expect(consoleBand(page)).toContainText("Simulated time12:00");
  await control(page, "Step");
  await expect(consoleBand(page)).toContainText("Simulated time12:05");
  await expect(elapsed(page)).toHaveText("0:05 of 3:00");

  await control(page, "Resume");
  await expect(consoleState(page)).toHaveText("Running");
  await expect(pilotStatus(page)).toHaveText("Monitoring");
  await expect.poll(() => minutesDone(page)).toBeGreaterThan(20);
  await control(page, "Pause");
  await expect(consoleState(page)).toHaveText("Paused");
  const held = await consoleBand(page).locator("[data-sim-time]").innerText();
  await page.waitForTimeout(600);
  await expect(consoleBand(page).locator("[data-sim-time]")).toHaveText(held);

  await control(page, "Stop simulation");
  await expect(consoleState(page)).toHaveText("Stopped");
  // Stopping opens nothing: AI Pilot gives the result, from what the run recorded.
  const result = completion(page);
  await expect(result.getByRole("heading", { level: 3 })).toHaveText("Simulation stopped");
  await expect(result).toContainText("Normal operation from 12:00 RUN-0001");
  for (const label of ["Findings detected", "Corrections applied", "Average COP", "Energy"]) await expect(result.getByText(label, { exact: true })).toBeVisible();
  const energy = (await result.locator("dd").nth(3).innerText()).trim();
  await expect(page.getByRole("status").filter({ hasText: "Simulation ended: Normal operation from 12:00, RUN-0001." })).toBeAttached();
  await expect(pilotConsole(page).getByRole("tab")).toHaveCount(0); // no live views once ended
  await mainIsOwn(page, /\/\?simSpeed=fast$/, "Overview");

  // The replay opens when asked, at that run, with the same recorded figures.
  await viewReplay(page, "RUN-0001");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulation");
  const summary = replay(page).getByRole("region", { name: "Run summary, RUN-0001" });
  await expect(summary).toContainText("From the recorded run");
  await expect(summary).toContainText(/Normal operation: stopped by the operator, 12:00 to \d\d:\d\d/);
  await expect(summary).toContainText(energy);

  // Another run starts from the same console.
  await consoleBand(page).getByRole("button", { name: "New simulation" }).click();
  await expect(pilotConsole(page).getByRole("heading", { name: "Start a simulation" })).toBeVisible();
  await pilotConsole(page).getByRole("button", { name: "Back to RUN-0001" }).click();
  await expect(consoleBand(page)).toHaveAttribute("data-run", "RUN-0001");
  const second = await startRun(page, { name: "Second run", hours: "1 h", step: "15 min" });
  expect(second).toBe("RUN-0002");
  // A run that completes on its own opens nothing either.
  await expect(completion(page).getByRole("heading", { level: 3 })).toHaveText("Simulation completed", { timeout: 10_000 });
  await expect(page).toHaveURL(/\/simulation\/RUN-0001$/);
});

test("monitoring is secondary: it pauses and resumes without touching the run", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true });
  const bar = pilotConsole(page).getByRole("group", { name: "Pilot status" });
  await bar.getByRole("button", { name: "Pause monitoring" }).click();
  await expect(pilotStatus(page)).toHaveText("Not monitoring");
  await expect(consoleState(page)).toHaveText("Paused");
  await bar.getByRole("button", { name: "Resume monitoring" }).click();
  await expect(pilotStatus(page)).toHaveText("Waiting");
});

test("proposals are decided explicitly in AI Pilot, with the pilot's why: Apply goes through the gate, Decline applies nothing", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true, hours: "6 h" });
  await control(page, "Step");
  await consoleTab(page, /Findings/).click();
  const row = (id: string) => pilotConsole(page).locator(`[data-pilot-issue="${id}"]`);
  await expect(row("PIL-0001-1")).toHaveAttribute("data-stage", "proposal");
  await expect(row("PIL-0001-2")).toHaveAttribute("data-stage", "proposal");

  // Choosing an issue opens it under its row: the investigation, the latest evidence, the decision.
  await row("PIL-0001-2").click();
  const decide2 = pilotConsole(page).locator('[data-decision-for="PIL-0001-2"]');
  await expect(decide2.locator(".pilot-decision__why")).toContainText("part load");
  await expect(decide2.getByRole("heading", { name: "Latest evidence" })).toBeVisible();
  await expect(decide2).toContainText("Chiller 2 chilled-water supply setpoint to 8.5 °C (allowed 7 to 12 °C) on RUN-0001.");
  await mainIsOwn(page, /\/\?simSpeed=fast$/, "Overview");
  await decide2.getByRole("button", { name: "Decline" }).click();
  await expect(decide2).toContainText(/Declined by the operator at \d\d:\d\d; nothing was applied\./);
  await expect(decide2.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
  await expect(row("PIL-0001-2")).toContainText("Declined");
  await expect(decide2.locator(".pilot-decision__evidence li").last()).toContainText("The operator declined the proposal");

  await row("PIL-0001-1").click();
  const decide1 = pilotConsole(page).locator('[data-decision-for="PIL-0001-1"]');
  await decide1.getByRole("button", { name: "Apply to simulation RUN-0001" }).click();
  await expect(decide1.locator("[data-correction-status]").last()).toHaveText("Queued");
  await expect(decide1.getByRole("button", { name: "Apply to simulation RUN-0001" })).toHaveAttribute("aria-disabled", "true");
  await expect(decide1).toContainText("A correction for this issue is waiting for the next step.");
  await consoleTab(page, "Corrections").click();
  // Only the applied proposal reached the run's ledger.
  await expect(pilotConsole(page).locator("[data-correction]")).toHaveCount(1);
  await expect(ledger(page, "COR-0001-1")).toContainText("chiller_plant_1:chilled_water_temp_set");
  // The ledger's pilot origin is the finding, chosen here.
  await ledger(page, "COR-0001-1").getByRole("button", { name: "Pilot, PIL-0001-1" }).click();
  await expect(consoleTab(page, /Findings/)).toHaveAttribute("aria-selected", "true");
  await expect(pilotConsole(page).locator('[data-decision-for="PIL-0001-1"]')).toBeVisible();
});

test("the pilot lifecycle runs to resolution from the console; the replay keeps the whole record and its evidence", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true, hours: "6 h" });
  await control(page, "Resume");
  await consoleTab(page, /Findings/).click();
  await expect(pilotConsole(page).locator('[data-pilot-issue="PIL-0001-1"][data-stage="proposal"]')).toBeVisible();
  await control(page, "Pause");
  await pilotConsole(page).locator('[data-pilot-issue="PIL-0001-1"]').click();
  await pilotConsole(page).locator('[data-decision-for="PIL-0001-1"]').getByRole("button", { name: "Apply to simulation RUN-0001" }).click();
  await control(page, "Resume");
  await expect(pilotConsole(page).locator('[data-pilot-issue="PIL-0001-1"]')).toHaveAttribute("data-stage", "resolution", { timeout: 15_000 });
  await control(page, "Stop simulation");
  await viewReplay(page, "RUN-0001");

  // The finding, in the replay: its lifecycle, evidence and outcome, read only.
  await replay(page).locator('[data-pilot-issue="PIL-0001-1"]').click();
  const detail = replay(page).locator('[data-pilot-detail="PIL-0001-1"]');
  await expect(detail.getByRole("heading").first()).toHaveText("Chiller 1: chilled-water setpoint colder than load requires");
  await expect(detail.locator('[aria-current="step"]')).toContainText("Resolution");
  await expect(detail.locator('[data-evidence-kind="tool"][data-evidence-status="error"]')).toContainText("get_forecast(source=simulation)");
  await expect(detail.locator("[data-outcome]")).toContainText("Reached");
  await expect(detail.getByRole("button", { name: /^(Apply|Decline)/ })).toHaveCount(0);
  const link = detail.locator("[data-evidence-link]").first();
  const target = await link.getAttribute("data-evidence-link");
  await link.click();
  await expect(page.locator(`#ev-${target}`)).toBeFocused();
  await expect(page.locator(`#ev-${target}`)).toHaveAttribute("data-evidence-kind", "outcome");
});

test("corrections are made in AI Pilot: explained limits, queued, applied at the next step, measured, released; the end expires the rest", async ({ page }) => {
  await open(page);
  const run = await startRun(page, { paused: true });
  await consoleTab(page, "Corrections").click();
  const c = pilotConsole(page);
  await c.getByLabel("Point", { exact: true }).selectOption("chiller_plant_1:chilled_water_temp_set");
  await expect(c.getByText("Now: baseline control, setpoint 7 °C")).toBeVisible();
  const value = c.getByLabel("Value (°C)");
  await value.fill("13");
  await expect(value).toHaveAttribute("aria-invalid", "true");
  await expect(c.getByText("Enter a value from 7 to 12 °C.")).toBeVisible();
  await value.fill("8.5");
  await c.getByRole("button", { name: `Submit to ${run}` }).click();
  const id = `COR-${run.slice(4)}-1`;
  await expect(ledger(page, id).locator("[data-correction-status]")).toHaveText("Queued");
  await control(page, "Step");
  await expect(ledger(page, id).locator("[data-correction-status]")).toHaveText("Applied");
  await expect(c.locator(`[data-override="chiller_plant_1:chilled_water_temp_set"]`)).toContainText("8.5 °C");
  await control(page, "Step");
  await expect(ledger(page, id).locator("[data-outcome]")).toContainText("Reached: chilled water out read");
  await c.getByRole("button", { name: "Release Chiller 1 chilled-water supply setpoint to baseline control" }).click();
  await control(page, "Step");
  await expect(c.getByText("No manual overrides. Every point follows baseline control.")).toBeVisible();
  await c.getByLabel("Point", { exact: true }).selectOption("cooling_towers_1:frequency_setpoint");
  await c.getByLabel("Value (Hz)").fill("40");
  await c.getByRole("button", { name: `Submit to ${run}` }).click();
  await control(page, "Stop simulation");
  // Applied corrections are counted in the result; the ledger stays with the recorded run.
  await expect(completion(page)).toContainText("Corrections applied2");
  await viewReplay(page, run);
  const record = (n: number) => replay(page).locator(`[data-correction="COR-${run.slice(4)}-${n}"] [data-correction-status]`);
  await expect(record(1)).toHaveText("Applied");
  await expect(record(3)).toHaveText("Expired");
  await expect(page.locator("main").getByRole("button", { name: `Submit to ${run}` })).toHaveCount(0);
});

test("a run that leaves the model envelope fails, says so, and keeps its last valid observation", async ({ page }) => {
  await open(page);
  const run = await startRun(page, { scenario: "Heat wave, beyond the model envelope", step: "15 min", hours: "6 h" });
  await expect(consoleState(page)).toHaveText("Failed", { timeout: 20_000 });
  await expect(completion(page).getByRole("heading", { level: 3 })).toHaveText("Simulation failed");
  await expect(completion(page)).toContainText("Outside the model envelope");
  const name = await consoleBand(page).locator("[data-run-name]").innerText();
  await expect(page.getByRole("status").filter({ hasText: `Simulation failed: ${name}, ${run}.` })).toBeAttached();
  const time = (await consoleBand(page).locator("[data-sim-time]").innerText()).trim();
  await viewReplay(page, run);
  await expect(page.getByRole("alert").filter({ hasText: "Run failed." }).first()).toContainText("Outside the model envelope");
  const summary = replay(page).getByRole("region", { name: `Run summary, ${run}` });
  await expect(summary).toContainText(`Results end at the last valid observation, ${time}.`);
  await expect(summary.locator("[data-recommendation]").filter({ hasText: "within the model's envelope" })).toHaveCount(1);
  await expect(page.locator("[data-retained]")).toHaveText(`Retained: last valid observation, ${time}`);
});

test("an injected solver failure fails the run at its fourth step", async ({ page }) => {
  await open(page, "&fail=simulation:solver");
  await startRun(page);
  await expect(consoleState(page)).toHaveText("Failed");
  await expect(completion(page)).toContainText("did not converge");
  await expect(elapsed(page)).toHaveText("0:15 of 3:00");
});

test("AI Pilot stays with its run on every screen and reconnects after a reload", async ({ page }) => {
  await open(page);
  const run = await startRun(page, { hours: "12 h", start: "08:00" });
  await expect(consoleState(page)).toHaveText("Running");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Engineering", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Engineering" })).toBeVisible();
  // The console is in the workspace beside every screen: the same run, still running.
  await expect(consoleBand(page)).toHaveAttribute("data-run", run);
  const before = await minutesDone(page);
  await page.reload();
  await openConsole(page);
  await expect(consoleBand(page)).toHaveAttribute("data-run", run);
  await expect.poll(() => minutesDone(page)).toBeGreaterThan(before);
});

test("a lost connection keeps the last data on screen and reconnects to the same run", async ({ page }) => {
  await open(page, "&fail=simulation:disconnect");
  const run = await startRun(page);
  await expect(pilotStatus(page)).toHaveText("Disconnected", { timeout: 10_000 });
  await expect(consoleBand(page)).toHaveAttribute("data-run", run);
  await expect(pilotStatus(page)).not.toHaveText("Disconnected", { timeout: 10_000 });
});

test("unavailable services say so instead of pretending", async ({ page }) => {
  await open(page, "&fail=simulation:unavailable");
  await expect(pilotConsole(page).getByRole("alert").filter({ hasText: "The simulation service is not available." })).toBeVisible();
  await expect(pilotConsole(page).getByRole("button", { name: "Start simulation" })).toHaveCount(0);

  await open(page, "&fail=pilot:unavailable");
  await startRun(page, { paused: true });
  await expect(pilotStatus(page)).toHaveText("Not available");
  await control(page, "Stop simulation");
  await expect(completion(page)).toContainText("The pilot's run summary is not available.");
  await expect(completion(page)).toContainText("Findings detected–");
  await viewReplay(page, "RUN-0001");
  await expect(replay(page).getByRole("alert").filter({ hasText: "The pilot's run summary is not available." })).toBeVisible();
  await expect(replay(page).getByRole("alert").filter({ hasText: "The pilot's findings on this run are not available." })).toBeVisible();
});

test("slow reasoning never freezes monitoring", async ({ page }) => {
  await open(page, "&fail=pilot:slow");
  await startRun(page, { paused: true });
  await control(page, "Resume");
  await expect(pilotStatus(page)).toHaveText("Investigating");
  const scan = async () => (await pilotConsole(page).getByRole("group", { name: "Pilot status" }).innerText()).match(/Last scan (\d\d:\d\d)/)?.[1];
  const first = await scan();
  await expect.poll(scan).not.toBe(first);
});

test("a stale proposal is rejected by the run's gate and stays visible", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true });
  await control(page, "Step");
  await pilotConsole(page).getByRole("group", { name: "Pilot status" }).getByRole("button", { name: "Pause monitoring" }).click();
  await control(page, "Step");
  await control(page, "Step");
  await consoleTab(page, /Findings/).click();
  await pilotConsole(page).locator('[data-pilot-issue="PIL-0001-1"]').click();
  const decide = pilotConsole(page).locator('[data-decision-for="PIL-0001-1"]');
  await expect(decide.locator(".pilot-stale")).toContainText("may reject this as stale");
  await decide.getByRole("button", { name: "Apply to simulation RUN-0001" }).click();
  await expect(decide.locator("[data-correction-status]").last()).toHaveText("Rejected");
  await expect(decide.locator(".cor-reason")).toContainText("the run has moved on");
  await expect(decide.locator(".pilot-decision__evidence li").filter({ hasText: "Rejected by the run's gate (stale)" })).toHaveCount(1);
});

test("one live operator: a live run's replay address points to AI Pilot; there is no live copy in the main display", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); // the workspace floats, closed
  await page.goto("/?simSpeed=fast");
  await openConsole(page);
  const run = await startRun(page, { paused: true });
  await page.getByRole("toolbar", { name: "Workspace" }).getByRole("button", { name: "AI Pilot" }).click(); // dismiss the floating panel
  await expect(pilotConsole(page)).toHaveCount(0);
  // AI Pilot is not a screen; the old live view's address leads nowhere.
  await page.goto("/pilot?simSpeed=fast");
  await expect(page.getByText("No screen exists at this address.")).toBeVisible();
  await page.goto(`/simulation/${run}?simSpeed=fast`);
  await expect(page.getByRole("heading", { level: 1, name: "Simulation" })).toBeVisible();
  await expect(replay(page)).toContainText(`${run} is live in AI Pilot, where it is operated and monitored. Its replay is here once it has ended.`);
  await expect(page.locator("main [data-sim-frame], main .pilot-readings, main [data-pilot-issue]")).toHaveCount(0);
  await expect(page.locator("main").getByRole("button", { name: /^(Resume|Pause|Step|Stop simulation)$/ })).toHaveCount(0);
  await replay(page).getByRole("button", { name: "Open AI Pilot" }).click();
  await expect(pilotConsole(page)).toBeVisible();
  await expect(consoleBand(page).getByRole("button", { name: "Resume" })).toBeVisible();
  // When it ends, this address is its replay.
  await control(page, "Stop simulation");
  await expect(replay(page).getByRole("region", { name: `Run summary, ${run}` })).toBeVisible();
});

test("keyboard and axe: console views move with arrow keys; nothing serious on the console, its result or the replay", async ({ page }) => {
  test.slow(); // five full accessibility scans, one of them the replay's plant and charts
  const axe = async (scope: string) => {
    await settled(page);
    const results = await new AxeBuilder({ page }).include(scope).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  };
  await open(page);
  await axe("#pilot-panel");
  await startRun(page, { paused: true });
  await control(page, "Step");
  await axe("#pilot-panel");
  const live = consoleTab(page, "Live");
  await live.focus();
  await page.keyboard.press("ArrowRight");
  await expect(consoleTab(page, /Findings/)).toBeFocused();
  await expect(consoleTab(page, /Findings/)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(consoleTab(page, "Corrections")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(live).toBeFocused();
  await consoleTab(page, /Findings/).click();
  await pilotConsole(page).locator('[data-pilot-issue="PIL-0001-1"]').click();
  await axe("#pilot-panel");
  await control(page, "Stop simulation");
  await expect(completion(page)).toBeVisible();
  await axe("#pilot-panel");
  await viewReplay(page, "RUN-0001");
  await expect(replay(page).getByRole("heading", { name: "Run summary, RUN-0001" })).toBeVisible();
  await axe("main");
});

test("reduced motion: every state change is immediate, smooth scrolling is off, and everything still works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await startRun(page, { paused: true });
  // No GSAP motion ran: the console's parts are at rest the moment they appear.
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? "")).toBe("");
  const opacities = await pilotConsole(page).locator(".pilot-console__body > *").evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity));
  expect(opacities.filter((o) => o !== "1")).toEqual([]);
  await expect(page.locator(".main__view.lenis")).toHaveCount(0);
  await control(page, "Stop simulation");
  await expect(completion(page)).toBeVisible();
  await viewReplay(page, "RUN-0001");
  await expect(replay(page).getByRole("heading", { name: "Run summary, RUN-0001" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.motion ?? "")).toBe("");
  await expect(page.locator(".main__view.lenis")).toHaveCount(0);
});

test("motion settles into the real state: quick changes leave nothing half-shown", async ({ page }) => {
  await open(page);
  await startRun(page, { paused: true });
  for (let i = 0; i < 3; i++) {
    await control(page, "Resume");
    await control(page, "Pause");
  }
  await settled(page);
  const styles = await pilotConsole(page).locator(".pilot-console__body > *").evaluateAll((els) => els.map((e) => [getComputedStyle(e).opacity, getComputedStyle(e).visibility, (e as HTMLElement).style.transform]));
  expect(styles.filter(([o, v, t]) => o !== "1" || v !== "visible" || t)).toEqual([]);
  await expect(consoleState(page)).toHaveText("Paused");
  // The result and the replay arrive and settle the same way.
  await control(page, "Stop simulation");
  await viewReplay(page, "RUN-0001");
  await settled(page);
  const parts = await replay(page).locator(".replay__content > *").evaluateAll((els) => els.map((e) => [getComputedStyle(e).opacity, (e as HTMLElement).style.transform]));
  expect(parts.filter(([o, t]) => o !== "1" || t)).toEqual([]);
});

for (const [width, height] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [390, 844],
]) {
  test(`fits ${width}x${height}: AI Pilot and the replay in reach, no sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/?simSpeed=fast");
    await openConsole(page);
    const overflow = () =>
      page.evaluate(() => {
        const view = document.querySelector(".main__view")!;
        const panel = document.querySelector("#pilot-panel");
        return Math.max(document.documentElement.scrollWidth - innerWidth, view.scrollWidth - view.clientWidth, panel ? panel.scrollWidth - panel.clientWidth : 0);
      });
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    await startRun(page, { paused: true });
    for (const name of ["Resume", "Step", "Stop simulation"]) await expect(consoleBand(page).getByRole("button", { name })).toBeVisible();
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    await consoleTab(page, "Corrections").click();
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    await control(page, "Stop simulation");
    await expect(completion(page)).toBeVisible();
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    await viewReplay(page, "RUN-0001");
    await expect(replay(page).getByRole("slider", { name: "Replay" })).toBeAttached();
    await expect.poll(overflow).toBeLessThanOrEqual(1);
  });
}
