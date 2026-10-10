import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulationService } from "./simulationService";
import { summarizeRun } from "./runSummary";
import { heldAt, type RunConfig } from "../lib/contracts/simulation";

const NORMAL: RunConfig = { scenarioId: "normal", startMinute: 12 * 60, durationHours: 1, stepMinutes: 5, chwSetpointC: 7 };
const service = (failures?: { simulation?: string; pilot?: string }) => createSimulationService({ pace: 0, storage: null, failures });
/** Let the service's zero-delay timers (latency, reasoning) run. */
const settle = () => new Promise((r) => setTimeout(r, 5));

afterEach(() => vi.useRealTimers());

describe("mock simulation service: lifecycle", () => {
  it("creates once per request ID and governs every transition", async () => {
    const { simulation } = service();
    const a = await simulation.createRun(NORMAL, "req-1");
    const again = await simulation.createRun(NORMAL, "req-1");
    expect(again.runId).toBe(a.runId);
    expect(await simulation.listRuns()).toHaveLength(1);
    expect(a.state).toBe("created");

    await expect(simulation.command(a.runId, "play")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(simulation.command(a.runId, "step")).rejects.toMatchObject({ code: "CONFLICT" });

    const started = await simulation.command(a.runId, "start");
    expect(started).toMatchObject({ state: "paused", stepsTaken: 0 });
    // Reading never advances the clock.
    const t = (await simulation.getRun(a.runId)).simulatedTime;
    await simulation.getRun(a.runId);
    expect((await simulation.getRun(a.runId)).simulatedTime).toBe(t);

    expect((await simulation.command(a.runId, "step")).stepsTaken).toBe(1);
    expect((await simulation.command(a.runId, "pause")).state).toBe("paused"); // pausing a paused run changes nothing
    expect((await simulation.command(a.runId, "stop")).state).toBe("stopped");
    await expect(simulation.command(a.runId, "play")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await simulation.command(a.runId, "stop")).state).toBe("stopped"); // stopping again is the same answer
  });

  it("rejects configurations the service does not advertise", async () => {
    const { simulation } = service();
    await expect(simulation.createRun({ ...NORMAL, startMinute: 12 * 60 + 3 }, "r1")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(simulation.createRun({ ...NORMAL, startMinute: 22 * 60, durationHours: 3 }, "r2")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(simulation.createRun({ ...NORMAL, chwSetpointC: 13 }, "r3")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const { chwSetpointC: _, ...incomplete } = NORMAL;
    await expect(simulation.createRun(incomplete as RunConfig, "r4")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await simulation.listRuns()).toHaveLength(0);
  });

  it("ends a run after its last step, labelling its frames as simulation", async () => {
    const { simulation } = service();
    const { runId } = await simulation.createRun({ ...NORMAL, durationHours: 1, stepMinutes: 15 }, "r");
    await simulation.command(runId, "start");
    for (let i = 0; i < 4; i++) await simulation.command(runId, "step");
    const run = await simulation.getRun(runId);
    expect(run).toMatchObject({ state: "stopped", stepsTaken: 4, stepsTotal: 4 });
    expect(run.frame?.source).toEqual({ kind: "simulation", runId });
    expect(run.results.times).toHaveLength(5); // the initial observation and four steps
    expect(run.results.energyKwh.at(-1)).toBeGreaterThan(0);
  });
});

describe("mock simulation service: corrections", () => {
  async function pausedRun() {
    const svc = service();
    const { runId } = await svc.simulation.createRun(NORMAL, "r");
    await svc.simulation.command(runId, "start");
    const basedOn = (await svc.simulation.getRun(runId)).simulatedTime!;
    return { ...svc, runId, basedOn };
  }
  const set = (point: string, value: number, basedOn: string) => ({ kind: "set" as const, point, value, basedOn, origin: { kind: "operator" as const } });
  const CHW1 = "chiller_plant_1:chilled_water_temp_set";

  it("queues, applies at the next step, holds the override and measures the outcome after the step after", async () => {
    const { simulation, runId, basedOn } = await pausedRun();
    const c = await simulation.submitCorrection(runId, set(CHW1, 8.5, basedOn));
    expect(c.status).toBe("queued"); // accepted is not applied
    expect((await simulation.getRun(runId)).overrides).toHaveLength(0);

    await simulation.command(runId, "step");
    let run = await simulation.getRun(runId);
    expect(run.corrections[0]).toMatchObject({ status: "applied", applied: { step: 1 } });
    expect(run.corrections[0].outcome).toBeUndefined();
    expect(run.overrides).toMatchObject([{ point: CHW1, value: 8.5, correctionId: c.id }]);

    await simulation.command(runId, "step");
    run = await simulation.getRun(runId);
    expect(run.corrections[0].outcome).toMatchObject({ reached: true });
    expect(run.corrections[0].outcome!.achieved).toBeCloseTo(8.5, 0);
  });

  it("replays a recorded step as it was observed, with what the run held then", async () => {
    const { simulation, runId } = await pausedRun();
    await simulation.command(runId, "step");
    await simulation.submitCorrection(runId, set(CHW1, 9, (await simulation.getRun(runId)).simulatedTime!));
    await simulation.command(runId, "step"); // step 2 takes the correction
    await simulation.command(runId, "step");
    await simulation.command(runId, "stop");
    const run = await simulation.getRun(runId);
    expect(run.stepsTaken).toBe(3);

    // The last step is the run's own final observation; what it held follows from the ledger.
    expect(await simulation.getObservation(runId, 3)).toEqual(run.frame);
    expect(heldAt(run.corrections, 3)).toEqual(run.overrides);
    // Earlier steps come back as they were, before and after the correction took.
    const before = await simulation.getObservation(runId, 1);
    const after = await simulation.getObservation(runId, 2);
    expect(before.at).toBe(run.results.times[1]);
    expect(heldAt(run.corrections, 1)).toEqual([]);
    expect(heldAt(run.corrections, 2)).toMatchObject([{ point: CHW1, value: 9 }]);
    expect(after.values["chiller_plant_1:evap_out_temp_c"]!.value!).toBeGreaterThan(before.values["chiller_plant_1:evap_out_temp_c"]!.value!);
    expect(after.kpis["plant:power_kw"]!.value).toBe(run.results.powerKw[2]);
    // Reading again is the same answer; a step the run did not record is not invented.
    expect(await simulation.getObservation(runId, 1)).toEqual(before);
    await expect(simulation.getObservation(runId, 4)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(simulation.getObservation(runId, -1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("releases a held override back to baseline control", async () => {
    const { simulation, runId, basedOn } = await pausedRun();
    await simulation.submitCorrection(runId, set(CHW1, 9, basedOn));
    await simulation.command(runId, "step");
    const now = (await simulation.getRun(runId)).simulatedTime!;
    const r = await simulation.submitCorrection(runId, { kind: "release", point: CHW1, value: null, basedOn: now, origin: { kind: "operator" } });
    expect(r.status).toBe("queued");
    await simulation.command(runId, "step");
    expect((await simulation.getRun(runId)).overrides).toHaveLength(0);
  });

  it("rejects out-of-limit, unknown, stale and inactive requests, and keeps them in the ledger", async () => {
    const { simulation, runId, basedOn } = await pausedRun();
    expect((await simulation.submitCorrection(runId, set(CHW1, 15, basedOn))).rejection?.code).toBe("out_of_limits");
    expect((await simulation.submitCorrection(runId, set("chiller_plant_1:load_pct", 50, basedOn))).rejection?.code).toBe("unknown_point");
    await simulation.command(runId, "step");
    await simulation.command(runId, "step");
    expect((await simulation.submitCorrection(runId, set(CHW1, 8, basedOn))).rejection?.code).toBe("stale");
    await simulation.command(runId, "stop");
    const late = (await simulation.getRun(runId)).simulatedTime!;
    expect((await simulation.submitCorrection(runId, set(CHW1, 8, late))).rejection?.code).toBe("run_not_active");
    expect((await simulation.getRun(runId)).corrections.map((c) => c.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
  });

  it("supersedes a queued correction with a later one, and expires one the run never took", async () => {
    const { simulation, runId, basedOn } = await pausedRun();
    const first = await simulation.submitCorrection(runId, set(CHW1, 8, basedOn));
    const second = await simulation.submitCorrection(runId, set("cooling_towers_1:frequency_setpoint", 40, basedOn));
    let run = await simulation.getRun(runId);
    expect(run.corrections.find((c) => c.id === first.id)?.status).toBe("superseded");
    expect(run.corrections.find((c) => c.id === second.id)?.status).toBe("queued");
    await simulation.command(runId, "stop");
    run = await simulation.getRun(runId);
    expect(run.corrections.find((c) => c.id === second.id)?.status).toBe("expired");
  });

  it("says when an applied correction's outcome can no longer be measured", async () => {
    const { simulation } = service();
    const { runId } = await simulation.createRun({ ...NORMAL, stepMinutes: 15 }, "r");
    await simulation.command(runId, "start");
    for (let i = 0; i < 3; i++) await simulation.command(runId, "step");
    const now = (await simulation.getRun(runId)).simulatedTime!;
    await simulation.submitCorrection(runId, set(CHW1, 8, now));
    await simulation.command(runId, "step"); // the last step takes it; no step follows
    const run = await simulation.getRun(runId);
    expect(run.state).toBe("stopped");
    expect(run.corrections[0]).toMatchObject({ status: "applied" });
    expect(run.corrections[0].outcome).toBeUndefined();
  });
});

describe("mock simulation service: failures", () => {
  it("fails outside the envelope and retains the last valid observation", async () => {
    const { simulation } = service();
    const { runId } = await simulation.createRun({ scenarioId: "heat-wave", startMinute: 9 * 60, durationHours: 6, stepMinutes: 15, chwSetpointC: 7 }, "r");
    await simulation.command(runId, "start");
    let run = await simulation.getRun(runId);
    while (run.state === "paused") {
      await simulation.command(runId, "step");
      run = await simulation.getRun(runId);
    }
    expect(run.state).toBe("failed");
    expect(run.lastError).toMatch(/envelope/i);
    // The failed step is not counted, produced no frame, and the retained frame is the last valid one.
    expect(run.results.times).toHaveLength(run.stepsTaken + 1);
    expect(run.frame?.at).toBe(run.results.times.at(-1));
    expect(run.simulatedTime).toBe(run.frame?.at);
    expect(run.events.at(-1)?.text).toMatch(/retained/);
  });

  it("injects a solver failure on request", async () => {
    const { simulation } = service({ simulation: "solver" });
    const { runId } = await simulation.createRun(NORMAL, "r");
    await simulation.command(runId, "start");
    for (let i = 0; i < 4; i++) await simulation.command(runId, "step").catch(() => {});
    const run = await simulation.getRun(runId);
    expect(run).toMatchObject({ state: "failed", stepsTaken: 3 });
    expect(run.lastError).toMatch(/did not converge/);
  });

  it("reports an unavailable service", async () => {
    const { simulation } = service({ simulation: "unavailable" });
    await expect(simulation.getCapabilities()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("mock pilot", () => {
  it("follows an issue from detection to resolution without duplicate rows", async () => {
    const { simulation, pilot } = service();
    const { runId } = await simulation.createRun({ ...NORMAL, durationHours: 3 }, "r");
    await simulation.command(runId, "start");
    let state = await pilot.setMonitoring(runId, true);
    expect(state.monitoring).toBe(true);
    // The initial observation is scanned: two chillers at part load with a 7 °C setpoint.
    const first = state.issues.find((i) => i.equipmentIds[0] === "chiller_plant_1")!;
    expect(first).toMatchObject({ stage: "detection", assessment: "alert", open: true });

    for (let i = 0; i < 3; i++) await simulation.command(runId, "step");
    await settle(); // investigation
    await settle(); // proposal
    state = await pilot.getState(runId);
    let issue = state.issues.find((i) => i.id === first.id)!;
    expect(state.issues.filter((i) => i.equipmentIds[0] === "chiller_plant_1")).toHaveLength(1);
    expect(issue.detections).toBe(4);
    expect(issue.stage).toBe("proposal");
    expect(issue.assessment).toBe("suspected");
    expect(issue.evidence.some((e) => e.kind === "tool" && e.status === "error")).toBe(true); // the failed tool stays visible
    expect(issue.proposal).toMatchObject({ point: "chiller_plant_1:chilled_water_temp_set", value: 8.5, origin: { kind: "pilot", issueId: first.id } });

    // Application goes through the simulation's own gate.
    const p = issue.proposal!;
    const c = await simulation.submitCorrection(runId, { kind: p.kind, point: p.point, value: p.value, basedOn: p.basedOn, origin: p.origin });
    expect(c.status).toBe("queued");
    expect((await pilot.getState(runId)).issues.find((i) => i.id === first.id)!.stage).toBe("application");

    await simulation.command(runId, "step"); // applied
    await simulation.command(runId, "step"); // outcome measured
    issue = (await pilot.getState(runId)).issues.find((i) => i.id === first.id)!;
    expect(issue.stage).toBe("outcome");

    for (let i = 0; i < 3; i++) await simulation.command(runId, "step"); // not seen for three scans
    issue = (await pilot.getState(runId)).issues.find((i) => i.id === first.id)!;
    expect(issue).toMatchObject({ open: false, stage: "resolution" });
    const ids = issue.evidence.map((e) => e.id);
    expect(issue.resolution!.evidenceIds.length).toBeGreaterThan(0);
    expect(issue.resolution!.evidenceIds.every((id) => ids.includes(id))).toBe(true);
    expect(issue.evidence.find((e) => e.id === issue.resolution!.evidenceIds[0])?.kind).toBe("outcome");
  });

  it("keeps scanning while reasoning is slow, and a stale proposal is rejected and stays visible", async () => {
    const { simulation, pilot } = service();
    const { runId } = await simulation.createRun({ ...NORMAL, durationHours: 3 }, "r");
    await simulation.command(runId, "start");
    await pilot.setMonitoring(runId, true);
    await simulation.command(runId, "step");
    await settle();
    await settle();
    let state = await pilot.getState(runId);
    const issue = state.issues.find((i) => i.proposal)!;
    // Monitoring stops, the run moves on, and the proposal is no longer re-checked.
    await pilot.setMonitoring(runId, false);
    await simulation.command(runId, "step");
    await simulation.command(runId, "step");
    const p = issue.proposal!;
    const c = await simulation.submitCorrection(runId, { kind: p.kind, point: p.point, value: p.value, basedOn: p.basedOn, origin: p.origin });
    expect(c.rejection?.code).toBe("stale");
    state = await pilot.getState(runId);
    const after = state.issues.find((i) => i.id === issue.id)!;
    expect(after.stage).toBe("proposal");
    expect(after.evidence.at(-1)).toMatchObject({ kind: "submission", status: "error", correctionId: c.id });
  });

  it("does not start monitoring an ended run, and abandons reasoning when a run ends", async () => {
    const { simulation, pilot } = service();
    const { runId } = await simulation.createRun(NORMAL, "r");
    await simulation.command(runId, "start");
    await pilot.setMonitoring(runId, true);
    await simulation.command(runId, "stop"); // before the reasoning timers fire
    const state = await pilot.getState(runId);
    expect(state.monitoring).toBe(false);
    expect(state.reasoningPending).toBe(0);
    expect(state.issues.every((i) => i.evidence.some((e) => e.kind === "reasoning" && e.status === "error"))).toBe(true);
    await settle();
    expect((await pilot.getState(runId)).issues.every((i) => i.proposal === null)).toBe(true);
    await expect(pilot.setMonitoring(runId, true)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("reports a pilot that is not available", async () => {
    const { simulation, pilot } = service({ pilot: "unavailable" });
    expect((await simulation.getCapabilities()).pilot).toMatchObject({ available: false });
    const { runId } = await simulation.createRun(NORMAL, "r");
    await expect(pilot.getState(runId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("run summary", () => {
  it("is written only once a run ends, from its records, the same every time", async () => {
    const { simulation, pilot } = service();
    const { runId } = await simulation.createRun({ ...NORMAL, durationHours: 3 }, "r");
    await simulation.command(runId, "start");
    await pilot.setMonitoring(runId, true);
    await expect(pilot.getRunSummary(runId)).rejects.toMatchObject({ code: "CONFLICT" });
    for (let i = 0; i < 3; i++) await simulation.command(runId, "step");
    await settle();
    await settle();
    await simulation.command(runId, "stop");

    const s = await pilot.getRunSummary(runId);
    const run = await simulation.getRun(runId);
    expect(s).toMatchObject({ runId, basis: "recorded", identity: { endReason: "stopped", simulatedMinutes: 15, plannedMinutes: 180, state: "stopped" } });
    expect(s.performance).toMatchObject({ avgCop: run.stats.avgCop, energyKwh: run.stats.energyKwh, steps: run.results.times.length });
    expect(s.pilot.monitored).toBe(true);
    expect(s.pilot.issues).toBe((await pilot.getState(runId)).issues.length);
    expect(s.assessment[0].text).toMatch(/^The run was stopped by the operator after 15 of 180 simulated minutes, /);
    // The timeline is in simulated-time order; every issue in it exists.
    expect(s.timeline.map((l) => l.at)).toEqual([...s.timeline.map((l) => l.at)].sort());
    const ids = (await pilot.getState(runId)).issues.map((i) => i.id);
    expect(s.timeline.filter((l) => l.issueId).every((l) => ids.includes(l.issueId!))).toBe(true);
    // Each unresolved proposal is a recommendation, with its basis.
    for (const u of s.pilot.unresolved) expect(s.recommendations.some((r) => r.basis.startsWith(`${u.issueId}:`) || r.basis.startsWith(`${u.issueId} `))).toBe(true);

    const again = summarizeRun(run, await pilot.getState(runId), s.generatedAt, "Asia/Shanghai");
    expect(summarizeRun(run, await pilot.getState(runId), s.generatedAt, "Asia/Shanghai")).toEqual(again);
    expect((await pilot.listRunSummaries()).map((x) => x.runId)).toEqual([runId]);
  });

  it("says when the pilot did not monitor a run, and recommends running it from AI Pilot", async () => {
    const { simulation, pilot } = service();
    const { runId } = await simulation.createRun(NORMAL, "r");
    await simulation.command(runId, "start");
    for (let i = 0; i < 12; i++) await simulation.command(runId, "step");
    const s = await pilot.getRunSummary(runId);
    expect(s.identity.endReason).toBe("completed");
    expect(s.pilot).toMatchObject({ monitored: false, issues: 0 });
    expect(s.assessment.map((a) => a.text)).toContain("The pilot did not monitor this run, so no issues were screened.");
    expect(s.recommendations.map((r) => r.text)).toContain("Run the scenario again from AI Pilot so the pilot screens it.");
  });
});

describe("names and decisions", () => {
  it("names a run at creation (or after its scenario), and renames only its label", async () => {
    const { simulation } = service();
    const named = await simulation.createRun(NORMAL, "a", "  Afternoon check  ");
    expect(named.name).toBe("Afternoon check");
    const unnamed = await simulation.createRun(NORMAL, "b");
    expect(unnamed.name).toBe("Normal operation from 12:00");
    await expect(simulation.createRun(NORMAL, "c", "x".repeat(61))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const renamed = await simulation.renameRun(named.runId, "Baseline, 7 °C");
    expect(renamed).toMatchObject({ runId: named.runId, name: "Baseline, 7 °C", state: "created", config: named.config });
    await expect(simulation.renameRun(named.runId, "   ")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(simulation.renameRun(named.runId, "two\nlines")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await simulation.getRun(named.runId)).events.map((e) => e.text)).toContain("Renamed from “Afternoon check” to “Baseline, 7 °C”.");
  });

  it("records a declined proposal as the operator's decision, applies nothing, and then refuses to apply it", async () => {
    const { simulation, pilot } = service();
    const { runId } = await simulation.createRun({ ...NORMAL, durationHours: 3 }, "r");
    await simulation.command(runId, "start");
    await pilot.setMonitoring(runId, true);
    await simulation.command(runId, "step");
    await settle();
    await settle();
    const issue = (await pilot.getState(runId)).issues.find((i) => i.proposal)!;
    // Only a standing proposal can be declined.
    const other = (await pilot.getState(runId)).issues.find((i) => i.id !== issue.id && !i.proposal);
    if (other) await expect(pilot.declineProposal(runId, other.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(pilot.declineProposal(runId, "PIL-9999-1")).rejects.toMatchObject({ code: "NOT_FOUND" });

    const after = (await pilot.declineProposal(runId, issue.id)).issues.find((i) => i.id === issue.id)!;
    expect(after.declinedAt).not.toBeNull();
    expect(after.evidence.at(-1)).toMatchObject({ kind: "decision", text: `The operator declined the proposal; nothing was applied to ${runId}.` });
    expect((await simulation.getRun(runId)).corrections).toEqual([]);
    // Declining again is the same answer; applying it now is refused.
    expect((await pilot.declineProposal(runId, issue.id)).issues.find((i) => i.id === issue.id)!.declinedAt).toBe(after.declinedAt);
    const p = issue.proposal!;
    await expect(simulation.submitCorrection(runId, { kind: p.kind, point: p.point, value: p.value, basedOn: p.basedOn, origin: p.origin })).rejects.toMatchObject({ code: "CONFLICT" });

    await simulation.command(runId, "stop");
    const summary = await pilot.getRunSummary(runId);
    expect(summary.pilot.declined).toBe(1);
    expect(summary.timeline.some((l) => l.kind === "decision" && l.issueId === issue.id)).toBe(true);
    expect(summary.recommendations.some((r) => r.basis === `${issue.id}: the operator declined the proposal; nothing was applied.`)).toBe(true);
    expect(summary.identity.name).toBe("Normal operation from 12:00");
    await expect(pilot.declineProposal(runId, issue.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
