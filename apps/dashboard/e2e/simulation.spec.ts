/**
 * M6: Simulation history, the archive of every run on the labelled mock simulation
 * service, and the Simulation replay, the one view of a recorded run, whether it is opened
 * from the history, from AI Pilot's result or by the assistant: its summary, the plant at
 * any recorded step, the results with that moment marked, matched comparison, findings,
 * corrections and events. Runs are started and controlled in AI Pilot only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { completion, consoleBand, consoleState, control, openConsole, pilotConsole, replay, startRun } from "./pilot-console";

/** Axe reads colours as drawn: let entry fades finish (looping loaders never do). */
const settled = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity));

/** The replay's run band (AI Pilot's console has its own). */
const band = (page: Page) => replay(page).locator(".sim-run");
const rows = (page: Page) => page.locator("[data-history-run]");

/** Run a short scenario to its end from AI Pilot; returns its ID. */
async function runToEnd(page: Page, opts: { start?: string; chw?: string } = {}) {
  await page.goto("/simulation?simSpeed=fast");
  await openConsole(page);
  const run = await startRun(page, { hours: "1 h", step: "15 min", ...opts });
  await expect(consoleState(page)).toHaveText("Stopped", { timeout: 10_000 });
  return run;
}

async function openHistory(page: Page) {
  await page.goto("/simulation?simSpeed=fast");
  await expect(page.getByRole("heading", { level: 1, name: "Simulation history" })).toBeVisible();
}

async function openReplay(page: Page, runId: string, query = "") {
  await page.goto(`/simulation/${runId}?simSpeed=fast${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Simulation" })).toBeVisible();
  await expect(band(page)).toHaveAttribute("data-run", runId);
}

test("an empty history says so and points to AI Pilot, where runs start", async ({ page }) => {
  await openHistory(page);
  await expect(page.getByText("No simulations have been run yet.")).toBeVisible();
  await expect(page.getByText("Mock simulation service", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: /Start simulation|Create run/ })).toHaveCount(0);
  // Runs are set up in AI Pilot, beside the history, not on another page.
  await page.getByRole("button", { name: "Start one in AI Pilot" }).click();
  await expect(pilotConsole(page).getByRole("heading", { name: "Start a simulation" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Simulation history" })).toBeVisible();
});

test("the archive lists every run, newest first; a run opens the same read-only replay as AI Pilot's result", async ({ page }) => {
  const first = await runToEnd(page);
  const second = await runToEnd(page, { chw: "9" });
  // AI Pilot's result opens the newer run's replay ...
  await completion(page).getByRole("link", { name: "View summary & replay" }).click();
  await expect(page).toHaveURL(new RegExp(`/simulation/${second}$`));
  await expect(band(page)).toHaveAttribute("data-run", second);

  await openHistory(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute("data-history-run", second);
  await expect(rows(page).first()).toContainText("Normal operation");
  await expect(rows(page).first()).toContainText("Stopped");
  await expect(rows(page).first()).toContainText("Ready");
  // ... and the history opens the same view: one replay, whichever way it is reached.
  await page.getByRole("link", { name: `Open ${second}` }).click();
  await expect(page).toHaveURL(new RegExp(`/simulation/${second}$`));
  await expect(band(page)).toHaveAttribute("data-run", second);
  await page.getByRole("link", { name: "All runs" }).click();
  await page.getByRole("link", { name: `Open ${first}` }).click();
  await expect(page).toHaveURL(new RegExp(`/simulation/${first}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Simulation");
  await expect(band(page)).toHaveAttribute("data-run", first);

  // Recorded and read-only: no lifecycle control, no correction form, no scenario switch.
  await expect(replay(page).getByText("Recorded run", { exact: true })).toBeVisible();
  for (const name of ["Resume", "Pause", "Step", "Stop simulation", "Start run", "New simulation", `Rename ${first}`]) await expect(page.getByRole("main").getByRole("button", { name })).toHaveCount(0);
  await expect(page.getByRole("main").getByLabel("Point", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("button", { name: /^Submit to |^Release / })).toHaveCount(0);
  await expect(band(page)).toContainText("ScenarioNormal operation");
  await expect(page.getByRole("main").getByRole("combobox")).toHaveCount(1); // Compare with, only
  const summary = page.getByRole("region", { name: `Run summary, ${first}` });
  await expect(summary).toContainText("From the recorded run");
  await expect(summary).toContainText("Normal operation: completed");
  await expect(page.locator(".sim-plant__box .stage-note")).toContainText(`Mock simulation ${first}, not site telemetry.`);
  for (const name of ["System COP", "Cooling demand and removed cooling", "Unmet demand", "Plant electrical power", "Electrical energy since start"]) {
    await expect(page.getByRole("img", { name: new RegExp(`^${name}( \\(|$)`) })).toBeVisible(); // a unitless chart has no "( )"
  }
  await expect(page.getByText(/the forecasting service supports telemetry sources only/)).toBeVisible();
  // The pilot's findings and the events are part of the record.
  await expect(replay(page).getByRole("navigation", { name: "Issues" })).toBeVisible();
  await expect(replay(page).locator(".sim-timeline, [data-event]").first()).toBeVisible();
});

test("the replay scrubs through the recorded run: the plant, what was held and the charts follow the step", async ({ page }) => {
  await page.goto("/?simSpeed=fast");
  await openConsole(page);
  const run = await startRun(page, { paused: true, hours: "1 h", step: "15 min" });
  await pilotConsole(page).getByRole("tab", { name: "Corrections" }).click();
  await pilotConsole(page).getByLabel("Point", { exact: true }).selectOption("chiller_plant_1:chilled_water_temp_set");
  await pilotConsole(page).getByLabel("Value (°C)").fill("9");
  await pilotConsole(page).getByRole("button", { name: `Submit to ${run}` }).click();
  await control(page, "Step"); // step 1 takes it
  await control(page, "Resume");
  await expect(consoleState(page)).toHaveText("Stopped", { timeout: 10_000 });
  await openReplay(page, run, "&equipment=chiller_plant_1");

  const scrubber = replay(page).getByRole("slider", { name: "Replay" });
  const plant = replay(page).locator(".sim-plant");
  const chosen = replay(page).locator('[data-selected="chiller_plant_1"]');
  // It opens at the run's last step, the final state.
  await expect(scrubber).toHaveAttribute("aria-valuetext", "13:00 simulated time, step 4 of 4");
  await expect(plant.getByRole("heading", { level: 2 })).toHaveText("Simulated plant at 13:00 (simulated time)");
  await expect(chosen).toContainText("Chilled-water supply setpoint held at 9 °C by COR-0001-1.");
  const atEnd = await chosen.locator(".sim-readings").innerText();

  // Back to the first observation: before the correction, nothing was held.
  await scrubber.focus();
  await page.keyboard.press("Home");
  await expect(scrubber).toHaveAttribute("aria-valuetext", "12:00 simulated time, step 0 of 4");
  await expect(plant.getByRole("heading", { level: 2 })).toHaveText("Simulated plant at 12:00 (simulated time)");
  await expect(chosen).toContainText("Nothing is held on it; it follows baseline control.");
  await expect(chosen.locator(".sim-readings")).not.toHaveText(atEnd);
  await expect(replay(page).locator(".sim-results .ts-chart__marker")).toHaveCount(5); // every chart marks the moment
  await expect(replay(page).locator(".sim-results .ts-chart").first()).toContainText("12:00");
  // One step on, the correction has taken.
  await page.keyboard.press("ArrowRight");
  await expect(scrubber).toHaveAttribute("aria-valuetext", "12:15 simulated time, step 1 of 4");
  await expect(chosen).toContainText("held at 9 °C by COR-0001-1.");
  // AI Pilot was not touched by the replay.
  await openConsole(page);
  await expect(consoleBand(page)).toHaveAttribute("data-run", run);
});

test("only matched runs compare, and a typed address can open a comparison", async ({ page }) => {
  const first = await runToEnd(page);
  await runToEnd(page, { start: "13:00" }); // a different start is not a match
  const third = await runToEnd(page, { chw: "9" });
  await openReplay(page, third);
  await expect(page.getByLabel("Compare with").locator("option")).toHaveText(["No comparison", `${first}, stopped`]);
  await page.getByLabel("Compare with").selectOption(first);
  await expect(page.locator(".sim-compare")).toContainText(`${third} used`);
  await expect(page.locator(".sim-compare")).toContainText("Baseline chilled-water setpoints 9 and 7 °C");

  await openReplay(page, third, `&compare=${first}`);
  await expect(page.getByLabel("Compare with")).toHaveValue(first);
  await expect(page.locator(".sim-results .ts-chart__legend").last()).toContainText(`${first}, compared`);
  // Matching does not depend on the setpoint, so the first run matches the third too.
  await openReplay(page, first);
  await expect(page.getByLabel("Compare with").locator("option")).toHaveText(["No comparison", `${third}, stopped`]);
});

test("a live run is listed as live; it is operated in AI Pilot, never from the archive or its address", async ({ page }) => {
  await page.goto("/simulation?simSpeed=fast");
  await openConsole(page);
  // Twelve hours from noon would end after the scenario day.
  expect(await startRun(page, { start: "08:00", hours: "12 h", paused: true })).toBe("RUN-0001");
  await page.getByRole("tab", { name: "Assistant" }).click();
  await openHistory(page);
  await expect(rows(page).first()).toContainText("Paused");
  await page.getByRole("link", { name: "Open RUN-0001" }).click();
  await expect(replay(page)).toContainText("RUN-0001 is live in AI Pilot, where it is operated and monitored.");
  await expect(page.getByRole("region", { name: "Run summary, RUN-0001" })).toHaveCount(0);
  await expect(page.locator("main [data-sim-frame]")).toHaveCount(0);
  await page.getByRole("link", { name: "All runs" }).click();
  await rows(page).first().getByRole("button", { name: "Live in AI Pilot" }).click();
  // AI Pilot opens with the run; the archive stays in the main display.
  await expect(consoleBand(page).getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page).toHaveURL(/\/simulation$/);
});

test("an unknown run is reported, not invented", async ({ page }) => {
  await page.goto("/simulation/RUN-0042?simSpeed=fast");
  await expect(page.getByText("No run RUN-0042 exists in the simulation service.")).toBeVisible();
});

test("accessibility and fit: no serious axe findings; at phone width the table becomes cards without sideways scrolling", async ({ page }) => {
  const run = await runToEnd(page);
  const axe = async () => {
    await settled(page);
    const results = await new AxeBuilder({ page }).include("main").analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  };
  await openHistory(page);
  await axe();
  await openReplay(page, run);
  await axe();
  const overflow = () =>
    page.evaluate(() => {
      const view = document.querySelector(".main__view")!;
      return Math.max(document.documentElement.scrollWidth - innerWidth, view.scrollWidth - view.clientWidth);
    });
  for (const [width, height] of [
    [1280, 800],
    [1024, 768],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await openHistory(page);
    await expect.poll(overflow).toBeLessThanOrEqual(1);
    if (width === 390) {
      // Cards: each cell carries its column's name.
      await expect(rows(page).first().locator('[data-label="Avg COP"]')).toBeVisible();
      await expect(page.locator(".history-table thead")).toBeHidden();
    }
    await openReplay(page, run);
    await expect.poll(overflow).toBeLessThanOrEqual(1);
  }
});
