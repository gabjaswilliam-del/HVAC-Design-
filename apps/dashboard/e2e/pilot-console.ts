/**
 * Shared steps for AI Pilot, the operator console in the workspace (opening it at any
 * width, setting up and starting a run, its controls, its completion result) and for the
 * Simulation replay of a recorded run in the main display.
 */
import { expect, type Page } from "@playwright/test";

export const pilotConsole = (page: Page) => page.getByRole("complementary", { name: "AI Pilot" });
export const consoleBand = (page: Page) => pilotConsole(page).locator(".sim-run");
export const consoleState = (page: Page) => consoleBand(page).locator("[data-run-state]");
export const pilotStatus = (page: Page) => pilotConsole(page).getByRole("group", { name: "Pilot status" }).locator("[data-pilot-status]");
/** The Simulation replay in the main display: one recorded run. */
export const replay = (page: Page) => page.locator("main .replay");
/** AI Pilot's short result once its run has ended. */
export const completion = (page: Page) => pilotConsole(page).locator("[data-completion-for]");

/** The run has ended: open its replay from AI Pilot's result, the one way it opens. */
export async function viewReplay(page: Page, runId: string) {
  await completion(page).getByRole("link", { name: "View summary & replay" }).click();
  await expect(page).toHaveURL(new RegExp(`/simulation/${runId}(\\?|$)`));
  await expect(replay(page).locator(".sim-run")).toHaveAttribute("data-run", runId);
}

/** Axe and contrast read colours as drawn: wait for CSS fades and GSAP motion to settle. */
export const settled = (page: Page) =>
  page.waitForFunction(
    () => !document.documentElement.dataset.motion && document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().endTime === Infinity),
  );

/** Open AI Pilot: the workspace tab when docked, its dock button when it floats, the sheet on a phone. */
export async function openConsole(page: Page) {
  const tab = page.getByRole("tab", { name: "AI Pilot" });
  if (!(await tab.isVisible())) {
    const dock = page.getByRole("toolbar", { name: "Workspace" }).getByRole("button", { name: "AI Pilot" });
    if (await dock.isVisible()) await dock.click();
    else await page.getByRole("button", { name: "Assistant", exact: true }).click();
  }
  if (await tab.isVisible()) {
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
  }
  await expect(pilotConsole(page)).toBeVisible();
}

export async function idle(page: Page) {
  await expect(consoleBand(page).locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(pilotConsole(page).locator('form [aria-busy="true"]')).toHaveCount(0);
}

/** Set up and start a run from AI Pilot; returns its ID. */
export async function startRun(
  page: Page,
  opts: { name?: string; scenario?: string; start?: string; hours?: string; step?: string; chw?: string; paused?: boolean } = {},
) {
  const c = pilotConsole(page);
  const form = c.getByRole("heading", { name: "Start a simulation" });
  await expect(form.or(consoleBand(page)).first()).toBeVisible(); // the service's capabilities have loaded
  if (!(await form.isVisible())) await consoleBand(page).getByRole("button", { name: "New simulation" }).click();
  await expect(form).toBeVisible();
  if (opts.name) await c.getByLabel("Name", { exact: true }).fill(opts.name);
  if (opts.scenario) await c.getByLabel("Scenario", { exact: true }).selectOption({ label: opts.scenario });
  if (opts.start) await c.getByLabel("Start time").fill(opts.start);
  if (opts.hours) await c.getByLabel("Duration").selectOption({ label: opts.hours });
  if (opts.step) await c.getByLabel("Timestep").selectOption({ label: opts.step });
  if (opts.chw) await c.getByLabel("Chilled-water setpoint (°C)").fill(opts.chw);
  await c.getByRole("button", { name: opts.paused ? "Start paused" : "Start simulation" }).click();
  await expect(consoleBand(page)).toBeVisible();
  await idle(page);
  return (await consoleBand(page).getAttribute("data-run"))!;
}

/** Press one of the run band's controls in AI Pilot and wait for the service's answer. */
export async function control(page: Page, name: string) {
  await idle(page);
  await consoleBand(page).getByRole("button", { name, exact: true }).click();
  await idle(page);
}
