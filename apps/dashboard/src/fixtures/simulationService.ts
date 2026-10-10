/**
 * MOCK simulation service and AI pilot for the explicit demo mode. Not PHYVAC, not a
 * solver, not the pilot's policy: a stand-in that keeps PR #2's run, gate and ledger
 * semantics so the dashboard can be built and tested before the real service is wired
 * in behind the same `SimulationClient` and `PilotClient` methods.
 *
 * FIXTURE ARITHMETIC, NOT PHYSICS. A run replays the synthetic scenario day from
 * `generate.ts` and adjusts it for the controls in force: a warmer chilled-water setpoint
 * or a slower tower fan changes temperatures and electrical power by fixed rules of
 * thumb. Nothing here is calibrated or says anything about a site.
 *
 * The service lives in this module, not in a component: a run keeps stepping whatever
 * screen is open, and its state is kept in session storage so a refresh reconnects to
 * the same run. Everything targets simulation runs; nothing reaches physical equipment.
 */
import { ApiError, validate } from "../lib/api/client";
import { formatTime } from "../lib/format";
import type { PilotClient, SimulationClient } from "../lib/api/simulation";
import type { Snapshot } from "../lib/contracts";
import { snapshot } from "../lib/contracts/readings";
import {
  correction as correctionSchema,
  heldAt,
  isFinal,
  pilotState,
  runConfig,
  runName,
  correctionRequest,
  runDetail,
  runStatus,
  runSummary,
  simulationCapabilities,
  type CommandablePoint,
  type Correction,
  type CorrectionRequest,
  type EvidenceItem,
  type HeldOverride,
  type PilotIssue,
  type PilotState,
  type RunCommand,
  type RunConfig,
  type RunDetail,
  type RunResults,
  type RunStats,
  type RunStatus,
  type RunSummary,
  type SimulationCapabilities,
} from "../lib/contracts/simulation";
import { demoTopology } from "./demoPlant";
import { delay } from "./fixtureClient";
import { summarizeRun } from "./runSummary";
import { DAY_START, MINUTE_MS, SAMPLES, SITE, STEP_MIN, generate, metricCatalog, type Dataset } from "./generate";
import { scenarioById, type ScenarioDef, type ScenarioId } from "./scenarios";

export interface SimulationFixtureOptions {
  /** Multiplies the wall-clock pacing (steps, reasoning, latency). Tests use a small value. */
  pace?: number;
  failures?: { simulation?: string; pilot?: string };
  /** Where the service keeps its state between page loads; null keeps it in memory. */
  storage?: Storage | null;
}

// Wall-clock pacing at pace 1.
const STEP_WALL_MS = 1200;
const LATENCY_MS = 220;
const REASON_MS = 1700;
const DISCONNECT_MS = 6000;
/** The mock's calibrated envelope: beyond this wet bulb a step produces no observation. */
const ENVELOPE_WB = 29.5;
const SOLVER_FAIL_STEP = 4;
/** Proposals may be one step behind the run (PR #2 DEFAULT_STALENESS_STEPS). */
const STALE_STEPS = 1;
/** Consecutive scans without a detection before the pilot resolves an issue. */
const CLEAR_SCANS = 3;
/** A point that reads within this many setpoint steps of the request counts as reached. */
const REACHED_STEPS = 3;
/** Versioned: a change to the stored shape must not be misread from an older tab's state. */
// v3: runs carry a name and issues an operator decision; older stored runs are not read.
const STORE_KEY = "hvac-agent.mock-simulation.v3";

const TEMPLATES: { id: string; base: ScenarioId; label?: string; description?: string; wetBulbExtra?: number; start: number }[] = [
  { id: "normal", base: "normal", start: 12 * 60 },
  { id: "peak", base: "peak", start: 12 * 60 },
  { id: "tower-fault", base: "tower-fault", start: 12 * 60 + 30 },
  {
    id: "heat-wave",
    base: "peak",
    label: "Heat wave, beyond the model envelope",
    description: `Wet bulb climbs past ${ENVELOPE_WB} °C during the morning; the run fails when the plant leaves the calibrated envelope.`,
    wetBulbExtra: 2.4,
    start: 9 * 60,
  },
];
const templateDef = (id: string): ScenarioDef | undefined => {
  const t = TEMPLATES.find((x) => x.id === id);
  const base = t && scenarioById(t.base);
  return base && { ...base, wetBulbOffset: base.wetBulbOffset + (t.wetBulbExtra ?? 0) };
};
const datasets = new Map<string, Dataset>();
const datasetFor = (id: string) => {
  if (!datasets.has(id)) datasets.set(id, generate(templateDef(id)!));
  return datasets.get(id)!;
};

const label = (id: string) => demoTopology.devices.find((d) => d.id === id)?.label ?? id;
export const POINTS: CommandablePoint[] = [
  ...[1, 2, 3].map((c) => ({
    point: `chiller_plant_${c}:chilled_water_temp_set`,
    equipmentId: `chiller_plant_${c}`,
    metric: "chilled_water_temp_set" as const,
    label: "Chilled-water supply setpoint",
    unit: "°C",
    min: 7,
    max: 12,
    step: 0.1,
    readingKey: `chiller_plant_${c}:evap_out_temp_c`,
  })),
  ...[1, 2, 3, 4].map((t) => ({
    point: `cooling_towers_${t}:frequency_setpoint`,
    equipmentId: `cooling_towers_${t}`,
    metric: "frequency_setpoint" as const,
    label: "Fan frequency setpoint",
    unit: "Hz",
    min: 25,
    max: 50,
    step: 0.5,
    readingKey: `cooling_towers_${t}:frequency_hz`,
  })),
];

const iso = (ms: number) => new Date(ms).toISOString();
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
const decimals = new Map(metricCatalog.map((m) => [m.key, m.decimals]));
/** Site-local time in the texts the service writes (events, evidence, reasons). */
const hhmm = (t: string) => formatTime(t, SITE.timezone);
const fmt = (v: number, d = 1) => v.toFixed(d);

class SimFailure extends Error {}

const valid = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
const mean = (xs: number[], d: number) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, d) : null);
/** Figures over a run's valid observations; energy and unmet energy integrate each step's reading. */
function statsOf(r: RunResults, stepMinutes: number): RunStats {
  const hours = stepMinutes / 60;
  const unmet = valid(r.unmetKw);
  return {
    simulatedMinutes: Math.max(0, r.times.length - 1) * stepMinutes,
    avgCop: mean(valid(r.cop), 2),
    energyKwh: r.energyKwh.at(-1) ?? 0,
    avgPowerKw: mean(valid(r.powerKw), 1),
    avgDemandKw: mean(valid(r.demandKw), 0),
    peakUnmetKw: unmet.length ? Math.max(...unmet) : 0,
    unmetKwh: round(r.unmetKw.slice(1).reduce<number>((a, v) => a + (v ?? 0) * hours, 0), 1),
  };
}

interface PilotRecord {
  monitoring: boolean;
  scans: number;
  lastScanAt: string | null;
  issues: PilotIssue[];
  activity: PilotState["activity"];
  /** Detection key -> issue ID, so repeated detections update one issue. */
  keys: Record<string, string>;
  /** Consecutive scans without a detection, per open issue. */
  clear: Record<string, number>;
  /** Reasoning still to come, per issue (survives a page reload). */
  reasoning: Record<string, "investigate" | "propose">;
}

interface RunRecord {
  status: RunStatus;
  requestId: string;
  frame: Snapshot | null;
  results: RunDetail["results"];
  corrections: Correction[];
  overrides: HeldOverride[];
  events: RunDetail["events"];
  pending: string | null;
  /** Applied corrections whose outcome the next observation measures. */
  measure: string[];
  pilot: PilotRecord;
  /** The pilot's summary, written when the run ends. */
  summary: RunSummary | null;
}

interface ServiceState {
  runs: RunRecord[];
  seq: number;
  lastWall: number;
}

export function createSimulationService(options: SimulationFixtureOptions = {}): { simulation: SimulationClient; pilot: PilotClient } {
  const pace = options.pace ?? 1;
  const failures = options.failures ?? {};
  const storage = options.storage === undefined ? (typeof sessionStorage === "undefined" ? null : sessionStorage) : options.storage;
  const reasonMs = REASON_MS * pace * (failures.pilot === "slow" ? 8 : 1);
  let disconnectUntil = 0;
  let disconnectSeen = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let ticker: ReturnType<typeof setInterval> | null = null;

  const state: ServiceState = restore() ?? { runs: [], seq: 0, lastWall: Date.now() };

  function restore(): ServiceState | null {
    try {
      const raw = storage?.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as ServiceState) : null;
    } catch {
      return null;
    }
  }
  function persist() {
    state.lastWall = Date.now();
    try {
      storage?.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Not kept; the runs last until the page is reloaded.
    }
  }

  const find = (runId: string) => {
    const rec = state.runs.find((r) => r.status.runId === runId);
    if (!rec) throw new ApiError("NOT_FOUND", `No simulation run ${runId} exists in this service.`, false);
    return rec;
  };
  const stepMs = (rec: RunRecord) => rec.status.config.stepMinutes * MINUTE_MS;
  const timeAt = (rec: RunRecord, k: number) => iso(DAY_START + (rec.status.config.startMinute + k * rec.status.config.stepMinutes) * MINUTE_MS);
  const now = (rec: RunRecord) => rec.status.simulatedTime ?? timeAt(rec, 0);
  const held = (rec: RunRecord, point: string) => rec.overrides.find((o) => o.point === point)?.value;
  const event = (rec: RunRecord, kind: RunDetail["events"][number]["kind"], text: string, correctionId?: string) =>
    rec.events.push({ id: `${rec.status.runId}-E${rec.events.length + 1}`, at: now(rec), kind, text, correctionId });

  // The plant for one step -------------------------------------------------------

  /** The observation after step `k` with `overrides` in force, or a failure. */
  function observe(rec: RunRecord, k: number, overrides: HeldOverride[]): Snapshot {
    const cfg = rec.status.config;
    const at = timeAt(rec, k);
    const i = Math.min(SAMPLES - 1, Math.round((cfg.startMinute + k * cfg.stepMinutes) / STEP_MIN));
    const ds = datasetFor(cfg.scenarioId);
    const wb = ds.metrics["weather:wet_bulb_c"].values[i]!;
    if (wb > ENVELOPE_WB) {
      throw new SimFailure(`Outside the model envelope: wet bulb ${fmt(wb)} °C is above the calibrated ${ENVELOPE_WB} °C. The step produced no observation.`);
    }
    if (failures.simulation === "solver" && k === SOLVER_FAIL_STEP) {
      throw new SimFailure("Solver did not converge: the hydraulic network had no solution in 50 iterations. The step produced no observation.");
    }
    // Missing stays missing (null with its quality), never zero.
    const v: Record<string, number> = Object.fromEntries(Object.keys(ds.metrics).map((key) => [key, ds.metrics[key].values[i] ?? Number.NaN]));
    const states = Object.fromEntries(Object.entries(ds.states).map(([id, s]) => [id, s[i]]));
    const hold = (point: string) => overrides.find((o) => o.point === point)?.value;
    let plantKw = v["plant:power_kw"];

    // A slower tower fan rejects less heat: warmer condenser water, less fan power.
    const towersOn = [1, 2, 3, 4].map((t) => `cooling_towers_${t}`).filter((id) => states[id] === "running");
    let dCw = 0;
    for (const id of towersOn) {
      const hz = hold(`${id}:frequency_setpoint`);
      if (hz === undefined) continue;
      dCw += ((v[`${id}:frequency_hz`] - hz) * 0.06) / towersOn.length;
      const kw = 5.5 * (hz / 50) ** 3;
      plantKw += kw - v[`${id}:power_kw`];
      v[`${id}:frequency_hz`] = hz;
      v[`${id}:power_kw`] = kw;
    }
    for (const id of towersOn) v[`${id}:water_out_temp_c`] += dCw;
    for (const key of ["cw_supply:temp_c", "cw_return:temp_c", "plant:approach_c"]) v[key] += dCw;

    // A warmer chilled-water setpoint and cooler condenser water each lower compressor power.
    const shifts: number[] = [];
    for (const c of [1, 2, 3]) {
      const id = `chiller_plant_${c}`;
      if (states[id] !== "running") continue;
      const d = (hold(`${id}:chilled_water_temp_set`) ?? cfg.chwSetpointC) - 7;
      shifts.push(d);
      for (const m of ["evap_out_temp_c", "evap_in_temp_c"]) v[`${id}:${m}`] += d;
      for (const m of ["cond_in_temp_c", "cond_out_temp_c"]) v[`${id}:${m}`] += dCw;
      const kw = (v[`${id}:power_kw`] * (1 + 0.025 * dCw)) / (1 + 0.03 * d);
      plantKw += kw - v[`${id}:power_kw`];
      v[`${id}:power_kw`] = kw;
    }
    const avg = shifts.length ? shifts.reduce((a, b) => a + b, 0) / shifts.length : 0;
    v["chw_supply:temp_c"] += avg;
    v["chw_return:temp_c"] += avg;
    v["plant:power_kw"] = plantKw;
    v["plant:cop"] = plantKw > 0 ? v["plant:cooling_delivered_kw"] / plantKw : 0;

    const reading = (key: string) =>
      Number.isFinite(v[key])
        ? { value: round(v[key], decimals.get(key) ?? 2), quality: "good" as const, sampleTime: at }
        : { value: null, quality: "unavailable" as const, sampleTime: null };
    const keys = Object.keys(v);
    return {
      schemaVersion: 1,
      source: { kind: "simulation", runId: rec.status.runId },
      configRevision: demoTopology.configRevision,
      at,
      latestSampleAt: at,
      connection: "connected",
      equipment: Object.fromEntries(Object.entries(states).map(([id, s]) => [id, { state: s, sampleTime: at }])),
      values: Object.fromEntries(keys.filter((k) => !/^(plant|weather):/.test(k)).map((k) => [k, reading(k)])),
      kpis: Object.fromEntries(keys.filter((k) => /^(plant|weather):/.test(k)).map((k) => [k, reading(k)])),
    };
  }

  function record(rec: RunRecord, frame: Snapshot) {
    const r = rec.results;
    const kpi = (k: string) => frame.kpis[k]?.value ?? null;
    const power = kpi("plant:power_kw");
    const hours = r.times.length ? rec.status.config.stepMinutes / 60 : 0;
    r.times.push(frame.at);
    r.demandKw.push(kpi("plant:cooling_demand_kw"));
    r.removedKw.push(kpi("plant:cooling_delivered_kw"));
    r.unmetKw.push(kpi("plant:unmet_kw"));
    r.powerKw.push(power);
    r.energyKwh.push(round((r.energyKwh.at(-1) ?? 0) + (power ?? 0) * hours, 1));
    r.cop.push(kpi("plant:cop"));
    rec.frame = frame;
    rec.status.simulatedTime = frame.at;
    rec.status.stats = statsOf(r, rec.status.config.stepMinutes);
  }

  function fail(rec: RunRecord, message: string) {
    rec.status.state = "failed";
    rec.status.lastError = message;
    const kept = rec.frame ? `The last valid observation (${hhmm(rec.frame.at)}) is retained.` : "No valid observation was produced.";
    event(rec, "failure", `Run failed. ${message} ${kept}`);
    expirePending(rec);
    endPilot(rec);
    summarize(rec);
  }

  function expirePending(rec: RunRecord) {
    const c = rec.corrections.find((x) => x.id === rec.pending);
    rec.pending = null;
    if (!c) return;
    c.status = "expired";
    event(rec, "correction", `${c.id} expired: the run ended before a step took it.`, c.id);
    pilotFollow(rec, c, "The run ended before a step took the correction; it never ran.", "error");
  }

  function finish(rec: RunRecord, text: string) {
    rec.status.state = "stopped";
    event(rec, "lifecycle", text);
    expirePending(rec);
    endPilot(rec);
    summarize(rec);
  }

  /** The pilot writes its account of the run once the run has ended. */
  function summarize(rec: RunRecord) {
    rec.summary = summarizeRun(detailOf(rec), rec.pilot, iso(Date.now()), SITE.timezone);
  }

  /** One step: take the pending correction, observe, measure earlier outcomes, scan. */
  function advance(rec: RunRecord) {
    const k = rec.status.stepsTaken + 1;
    const taken = rec.corrections.find((c) => c.id === rec.pending) ?? null;
    let overrides = rec.overrides;
    if (taken) {
      overrides = overrides.filter((o) => o.point !== taken.point);
      if (taken.kind === "set") {
        overrides.push({ point: taken.point, equipmentId: taken.equipmentId, label: taken.label, value: taken.value!, unit: taken.unit, correctionId: taken.id, since: timeAt(rec, k) });
      }
    }
    let frame: Snapshot;
    try {
      frame = observe(rec, k, overrides);
    } catch (e) {
      if (!(e instanceof SimFailure)) throw e;
      fail(rec, e.message); // the step did not complete, so it is not counted as taken
      return;
    }
    rec.status.stepsTaken = k;
    rec.overrides = overrides;
    record(rec, frame);
    for (const id of rec.measure) measure(rec, id, frame);
    rec.measure = [];
    if (taken) {
      rec.pending = null;
      taken.status = "applied";
      taken.applied = { step: k, at: frame.at };
      rec.measure.push(taken.id);
      const what = taken.kind === "set" ? `${label(taken.equipmentId)} ${taken.label.toLowerCase()} held at ${taken.value} ${taken.unit}` : `${label(taken.equipmentId)} returned to baseline control`;
      event(rec, "correction", `${taken.id} applied at step ${k}: ${what}.`, taken.id);
      pilotFollow(rec, taken, `Applied at step ${k} (${hhmm(frame.at)}). The outcome is measured after the next step.`, "ok");
    }
    if (rec.pilot.monitoring) scan(rec);
    if (k >= rec.status.stepsTotal) finish(rec, `Run completed its ${rec.status.config.durationHours} h scenario.`);
  }

  function measure(rec: RunRecord, id: string, frame: Snapshot) {
    const c = rec.corrections.find((x) => x.id === id);
    const p = POINTS.find((x) => x.point === c?.point);
    if (!c || !p) return;
    const running = frame.equipment[c.equipmentId]?.state === "running";
    const value = frame.values[p.readingKey]?.value ?? null;
    // What was read is the plant's response (the supply temperature, the fan speed), not the setpoint.
    const what = (metricCatalog.find((m) => m.key === p.readingKey)?.label ?? p.readingKey).toLowerCase();
    if (c.kind === "release") {
      c.outcome = { observedAt: frame.at, achieved: value, shortfall: null, reached: true, note: `Returned to baseline control; ${what} read ${value ?? "unavailable"} ${p.unit}.` };
    } else if (!running || value === null) {
      c.outcome = { observedAt: frame.at, achieved: null, shortfall: null, reached: false, note: `Not reached: ${label(c.equipmentId)} is not running.` };
    } else {
      const shortfall = round(c.value! - value, 2);
      const reached = Math.abs(shortfall) <= p.step * REACHED_STEPS;
      const note = reached
        ? `Reached: ${what} read ${value} ${p.unit} against ${c.value} ${p.unit} asked.`
        : `Not fully reached: ${what} read ${value} ${p.unit}, ${Math.abs(shortfall)} ${p.unit} from the ${c.value} ${p.unit} asked.`;
      c.outcome = { observedAt: frame.at, achieved: value, shortfall, reached, note };
    }
    event(rec, "correction", `${c.id} outcome measured. ${c.outcome.note}`, c.id);
    const cop = rec.results.cop;
    const copNote = cop.length > 2 ? ` Plant COP ${fmt(cop.at(-3) ?? 0, 2)} before, ${fmt(cop.at(-1) ?? 0, 2)} after.` : "";
    pilotFollow(rec, c, `${c.outcome.note}${copNote}`, c.outcome.reached ? "ok" : "error", "outcome");
  }

  // The correction gate ----------------------------------------------------------

  function submit(rec: RunRecord, req: CorrectionRequest): Correction {
    const p = POINTS.find((x) => x.point === req.point);
    const id = `COR-${rec.status.runId.slice(4)}-${rec.corrections.length + 1}`;
    const c: Correction = {
      ...req,
      id,
      runId: rec.status.runId,
      equipmentId: p?.equipmentId ?? req.point.split(":")[0],
      label: p?.label ?? req.point,
      unit: p?.unit ?? "",
      allowed: [p?.min ?? 0, p?.max ?? 0],
      submittedAt: now(rec),
      status: "queued",
    };
    const reject = (code: NonNullable<Correction["rejection"]>["code"], reason: string) => {
      c.status = "rejected";
      c.rejection = { code, reason };
    };
    const lag = Date.parse(now(rec)) - Date.parse(req.basedOn);
    const fromIssue = req.origin.kind === "pilot" ? rec.pilot.issues.find((i) => i.id === (req.origin as { issueId: string }).issueId) : undefined;
    if (fromIssue?.declinedAt) throw new ApiError("CONFLICT", `${fromIssue.id}'s proposal was declined by the operator; it is not applied.`, false);
    if (!p) reject("unknown_point", `${req.point} is not a point this simulation accepts a setpoint for.`);
    else if (req.kind === "set" && (req.value === null || !Number.isFinite(req.value))) reject("malformed", "A setpoint needs a value.");
    else if (req.kind === "release" && held(rec, req.point) === undefined) reject("malformed", "Nothing is held at this point, so there is nothing to release.");
    else if (rec.status.state === "created" || isFinal(rec.status.state)) {
      reject("run_not_active", rec.status.state === "created" ? "The run has not started, so there is no step to apply this to." : `The run has ${rec.status.state === "failed" ? "failed" : "ended"}; there is no next step to apply this to.`);
    } else if (req.kind === "set" && (req.value! < p.min || req.value! > p.max)) {
      reject("out_of_limits", `${req.value} ${p.unit} is outside the allowed ${p.min} to ${p.max} ${p.unit}.`);
    } else if (lag > STALE_STEPS * stepMs(rec)) {
      reject("stale", `Computed against the observation at ${hhmm(req.basedOn)}; the run has moved on to ${hhmm(now(rec))}.`);
    }
    rec.corrections.push(c);
    if (c.status === "rejected") {
      event(rec, "correction", `${c.id} rejected (${c.rejection!.code.replace("_", " ")}): ${c.rejection!.reason}`, c.id);
      pilotFollow(rec, c, `Rejected by the run's gate (${c.rejection!.code.replace("_", " ")}): ${c.rejection!.reason}`, "error");
      return c;
    }
    const before = rec.corrections.find((x) => x.id === rec.pending);
    if (before) {
      before.status = "superseded";
      event(rec, "correction", `${before.id} superseded by ${c.id} before any step took it.`, before.id);
      pilotFollow(rec, before, `Superseded by ${c.id} before any step took it; it never ran.`, "error");
    }
    rec.pending = c.id;
    const what = c.kind === "set" ? `${label(c.equipmentId)} ${c.label.toLowerCase()} ${c.value} ${c.unit}` : `release ${label(c.equipmentId)} ${c.label.toLowerCase()}`;
    event(rec, "correction", `${c.id} queued for the next step: ${what}.`, c.id);
    pilotFollow(rec, c, `Submitted to ${rec.status.runId}: ${what}. Queued for the next step; accepted is not applied.`, "ok");
    return c;
  }

  // The pilot -----------------------------------------------------------------------

  const activity = (rec: RunRecord, text: string) => {
    const a = rec.pilot.activity;
    a.push({ id: `${rec.status.runId}-A${a.length + 1}`, at: now(rec), text });
    if (a.length > 40) a.splice(0, a.length - 40);
  };
  const evidence = (rec: RunRecord, issue: PilotIssue, item: Omit<EvidenceItem, "id" | "at"> & { at?: string }) => {
    const e: EvidenceItem = { id: `${issue.id}-${issue.evidence.length + 1}`, at: now(rec), ...item };
    issue.evidence.push(e);
    return e;
  };

  /** Record what became of a pilot-originated correction on its issue. */
  function pilotFollow(rec: RunRecord, c: Correction, text: string, status: "ok" | "error", kind: "submission" | "outcome" = "submission") {
    if (c.origin.kind !== "pilot") return;
    const issueId = c.origin.issueId;
    const issue = rec.pilot.issues.find((i) => i.id === issueId);
    if (!issue) return;
    if (!issue.correctionIds.includes(c.id)) issue.correctionIds.push(c.id);
    evidence(rec, issue, { kind, text, status, correctionId: c.id });
    if (!issue.open) return;
    if (kind === "outcome") issue.stage = "outcome";
    else if (c.status === "queued" || c.status === "applied") issue.stage = "application";
    else if (issue.proposal) issue.stage = "proposal"; // rejected, superseded or expired: the proposal stands
    activity(rec, `${issue.id}: ${text}`);
  }

  interface Detection {
    key: string;
    title: string;
    severity: PilotIssue["severity"];
    equipmentIds: string[];
    readings: string[];
    proposal?: { point: string; value: number; rationale: string };
    advisory?: string;
  }

  /** Screening: cheap rules over the newest observation, never the slow reasoning. */
  function screen(rec: RunRecord, f: Snapshot): Detection[] {
    const out: Detection[] = [];
    const at = hhmm(f.at);
    for (const c of [1, 2, 3]) {
      const id = `chiller_plant_${c}`;
      if (f.equipment[id]?.state !== "running") continue;
      const point = `${id}:chilled_water_temp_set`;
      const set = held(rec, point) ?? rec.status.config.chwSetpointC;
      const load = f.values[`${id}:load_pct`]?.value ?? null;
      if (load === null || load >= 85 || set >= 8) continue;
      out.push({
        key: `chw-setpoint:${id}`,
        title: `${label(id)}: chilled-water setpoint colder than load requires`,
        severity: "info",
        equipmentIds: [id],
        readings: [`${label(id)} load ${load} % at ${at}.`, `Chilled-water supply setpoint ${fmt(set)} °C (${held(rec, point) === undefined ? "baseline control" : "held override"}).`],
        proposal: {
          point,
          value: 8.5,
          rationale: `At ${load} % load the data hall's demand is met with a warmer supply. In this mock's arithmetic each 1 °C warmer lowers compressor power by about 3 %.`,
        },
      });
    }
    for (const t of [1, 2, 3, 4]) {
      const id = `cooling_towers_${t}`;
      if (f.equipment[id]?.state !== "fault") continue;
      out.push({
        key: `fault:${id}`,
        title: `${label(id)} reported in fault`,
        severity: "warning",
        equipmentIds: [id],
        readings: [`${label(id)} state Fault at ${at}.`, `Condenser approach ${f.kpis["plant:approach_c"]?.value ?? "unavailable"} °C.`],
        advisory: "The fault is part of the scenario. The pilot cannot repair equipment and proposes no correction; it keeps watching condenser approach on the remaining towers.",
      });
    }
    const unmet = f.kpis["plant:unmet_kw"]?.value ?? 0;
    if (unmet > 0) {
      out.push({
        key: "unmet",
        title: "Cooling demand not met",
        severity: "critical",
        equipmentIds: ["terminal"],
        readings: [`Unmet demand ${unmet} kWt at ${at}.`, `Running chiller capacity ${f.kpis["plant:available_capacity_kw"]?.value ?? "unavailable"} kWt.`],
        advisory: "Running chiller capacity is the limit. Staging another chiller is the baseline controller's decision; the pilot proposes no correction for it.",
      });
    }
    return out;
  }

  function scan(rec: RunRecord) {
    const f = rec.frame;
    const p = rec.pilot;
    if (!f || p.lastScanAt === f.at) return;
    p.scans++;
    p.lastScanAt = f.at;
    const seen = new Set<string>();
    for (const d of screen(rec, f)) {
      let issue = p.issues.find((i) => i.id === p.keys[d.key]);
      if (!issue) {
        const id = `PIL-${rec.status.runId.slice(4)}-${p.issues.length + 1}`;
        p.keys[d.key] = id;
        issue = {
          id,
          runId: rec.status.runId,
          title: d.title,
          severity: d.severity,
          equipmentIds: d.equipmentIds,
          firstSeen: f.at,
          lastSeen: f.at,
          detections: 0,
          assessment: "alert",
          stage: "detection",
          open: true,
          reasoning: { pending: true, summary: null, uncertainty: null },
          proposal: null,
          advisory: null,
          correctionIds: [],
          declinedAt: null,
          resolution: null,
          evidence: [],
        };
        p.issues.push(issue);
        evidence(rec, issue, { kind: "detection", text: `Detected by screening: ${d.title}.` });
        for (const r of d.readings) evidence(rec, issue, { kind: "reading", text: r });
        activity(rec, `${id} detected: ${d.title}.`);
        think(rec, issue.id, "investigate");
      } else if (!issue.open) {
        Object.assign(issue, { open: true, stage: "detection", assessment: "alert", resolution: null, proposal: null, advisory: null, declinedAt: null, lastSeen: f.at });
        issue.reasoning = { ...issue.reasoning, pending: true };
        evidence(rec, issue, { kind: "detection", text: "Detected again after it was resolved." });
        activity(rec, `${issue.id} detected again.`);
        think(rec, issue.id, "investigate");
      }
      seen.add(issue.id);
      issue.detections++;
      issue.lastSeen = f.at;
      p.clear[issue.id] = 0;
      // Each scan re-checks a standing proposal against the newest observation.
      const waiting = issue.correctionIds.some((id) => rec.corrections.find((c) => c.id === id)?.status === "queued");
      if (issue.proposal && !waiting && issue.stage === "proposal" && !issue.declinedAt) issue.proposal = { ...issue.proposal, basedOn: f.at };
    }
    for (const issue of p.issues) {
      if (!issue.open || seen.has(issue.id)) continue;
      p.clear[issue.id] = (p.clear[issue.id] ?? 0) + 1;
      if (p.clear[issue.id] >= CLEAR_SCANS) resolve(rec, issue);
    }
  }

  function resolve(rec: RunRecord, issue: PilotIssue) {
    const scans = evidence(rec, issue, { kind: "reading", text: `Not detected in the last ${CLEAR_SCANS} scans, to ${hhmm(now(rec))}.` });
    const outcome = [...issue.evidence].reverse().find((e) => e.kind === "outcome" && e.status === "ok");
    const summary = outcome
      ? `Resolved after ${outcome.correctionId}: the condition has not been seen for ${CLEAR_SCANS} scans.`
      : `The condition cleared without a correction: not seen for ${CLEAR_SCANS} scans.`;
    const ids = outcome ? [outcome.id, scans.id] : [scans.id];
    evidence(rec, issue, { kind: "resolution", text: summary });
    Object.assign(issue, { open: false, stage: "resolution", resolution: { at: now(rec), summary, evidenceIds: ids } });
    issue.reasoning = { ...issue.reasoning, pending: false };
    delete rec.pilot.reasoning[issue.id];
    activity(rec, `${issue.id} resolved. ${summary}`);
  }

  const keyOf = (rec: RunRecord, issue: PilotIssue) => Object.entries(rec.pilot.keys).find(([, id]) => id === issue.id)?.[0] ?? "";

  /** The slower reasoning: off the step path, on its own timers, never blocking a scan. */
  function think(rec: RunRecord, issueId: string, phase: "investigate" | "propose") {
    rec.pilot.reasoning[issueId] = phase;
    clearTimeout(timers.get(issueId));
    timers.set(
      issueId,
      setTimeout(() => {
        timers.delete(issueId);
        const issue = rec.pilot.issues.find((i) => i.id === issueId);
        if (!issue || !issue.open || rec.pilot.reasoning[issueId] !== phase) return;
        if (phase === "investigate") investigate(rec, issue);
        else propose(rec, issue);
        persist();
      }, reasonMs),
    );
  }

  function investigate(rec: RunRecord, issue: PilotIssue) {
    const key = keyOf(rec, issue);
    const d = rec.frame && screen(rec, rec.frame).find((x) => x.key === key);
    const cop = rec.results.cop.slice(-6).filter((x): x is number => x !== null);
    const setpointRule = key.startsWith("chw-setpoint");
    const faultRule = key.startsWith("fault");
    issue.stage = "investigation";
    evidence(rec, issue, {
      kind: "tool",
      status: "ok",
      text: cop.length ? `read_results: plant COP ${fmt(Math.min(...cop), 2)} to ${fmt(Math.max(...cop), 2)} over the last ${cop.length} steps.` : "read_results: no earlier steps to compare.",
    });
    if (setpointRule) {
      const nameplate = demoTopology.devices.find((x) => x.id === issue.equipmentIds[0])?.nameplate ?? [];
      evidence(rec, issue, {
        kind: "tool",
        status: "ok",
        text: `read_nameplate: ${nameplate.slice(0, 2).map((n) => `${n.label.toLowerCase()} ${n.value} ${n.unit}`).join(", ")} (synthetic design data).`,
      });
    }
    if (!faultRule) {
      // The forecasting service advertises telemetry sources only, so this call fails and says so.
      evidence(rec, issue, {
        kind: "tool",
        status: "error",
        text: "get_forecast(source=simulation): the forecasting service does not support simulation sources; its capabilities list telemetry only. The investigation uses the run's own results instead.",
      });
    }
    if (setpointRule) {
      issue.assessment = "suspected";
      issue.reasoning = {
        pending: true,
        summary: "The chiller runs at part load with the coldest allowed supply. A warmer supply should meet the same demand with less compressor power.",
        uncertainty: "Medium. The saving comes from this mock's arithmetic, not a calibrated model; dehumidification limits are not modelled.",
      };
      think(rec, issue.id, "propose");
    } else {
      issue.assessment = faultRule ? "confirmed" : "suspected";
      issue.advisory = d?.advisory ?? "No correction is proposed.";
      issue.reasoning = {
        pending: false,
        summary: faultRule ? "The simulated plant reports the fault directly; it is not inferred." : "Demand exceeds the capacity of the chillers running at the time.",
        uncertainty: faultRule ? "Low: the state is reported by the simulated plant." : "Low for the shortfall itself; its cause is inferred from running capacity.",
      };
      delete rec.pilot.reasoning[issue.id];
    }
    evidence(rec, issue, { kind: "reasoning", text: issue.reasoning.summary! });
    activity(rec, `${issue.id}: investigation ${issue.reasoning.pending ? "in progress" : "complete"}.`);
  }

  function propose(rec: RunRecord, issue: PilotIssue) {
    const key = keyOf(rec, issue);
    const d = rec.frame && screen(rec, rec.frame).find((x) => x.key === key);
    delete rec.pilot.reasoning[issue.id];
    issue.reasoning = { ...issue.reasoning, pending: false };
    const p = d?.proposal && POINTS.find((x) => x.point === d.proposal!.point);
    if (!d?.proposal || !p) {
      issue.advisory = "The condition was no longer present when the investigation ended; nothing is proposed.";
      return;
    }
    issue.proposal = {
      kind: "set",
      point: p.point,
      value: d.proposal.value,
      basedOn: now(rec),
      origin: { kind: "pilot", issueId: issue.id },
      equipmentId: p.equipmentId,
      label: p.label,
      unit: p.unit,
      allowed: [p.min, p.max],
      rationale: d.proposal.rationale,
    };
    issue.stage = "proposal";
    evidence(rec, issue, { kind: "proposal", text: `Proposed for ${rec.status.runId}: ${label(p.equipmentId)} ${p.label.toLowerCase()} ${d.proposal.value} ${p.unit} (allowed ${p.min} to ${p.max} ${p.unit}).` });
    activity(rec, `${issue.id}: correction proposed, waiting for an operator to apply it to the simulation.`);
  }

  /** The run has ended: monitoring stops, and reasoning still in progress is abandoned
   *  rather than producing a proposal for a run that can no longer take it. */
  function endPilot(rec: RunRecord) {
    rec.measure = []; // no later observation will measure these
    for (const issue of rec.pilot.issues.filter((i) => i.reasoning.pending)) {
      clearTimeout(timers.get(issue.id));
      timers.delete(issue.id);
      delete rec.pilot.reasoning[issue.id];
      issue.reasoning = { ...issue.reasoning, pending: false };
      const ended = rec.status.state === "failed" ? "failed" : "ended";
      evidence(rec, issue, { kind: "reasoning", status: "error", text: `Reasoning stopped: the run ${ended} before the investigation finished.` });
    }
    if (!rec.pilot.monitoring) return;
    rec.pilot.monitoring = false;
    activity(rec, `Monitoring ended with the run (${rec.status.state}).`);
  }

  // Lifecycle and pacing --------------------------------------------------------------

  function tick() {
    const running = state.runs.filter((r) => r.status.state === "running");
    for (const rec of running) advance(rec);
    if (failures.simulation === "disconnect" && !disconnectSeen && running.some((r) => r.status.stepsTaken >= 6)) {
      disconnectSeen = true;
      disconnectUntil = Date.now() + DISCONNECT_MS * pace;
    }
    if (!state.runs.some((r) => r.status.state === "running") && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    persist();
  }
  const ensureTicker = () => {
    ticker ??= setInterval(tick, STEP_WALL_MS * pace);
  };

  // Catch up after a reload: the service kept stepping while the page was away.
  {
    const missed = Math.floor((Date.now() - state.lastWall) / (STEP_WALL_MS * pace));
    for (const rec of state.runs.filter((r) => r.status.state === "running")) {
      for (let n = 0; n < missed && rec.status.state === "running"; n++) advance(rec);
    }
    for (const rec of state.runs) for (const [id, phase] of Object.entries(rec.pilot.reasoning)) think(rec, id, phase);
    if (state.runs.some((r) => r.status.state === "running")) ensureTicker();
    persist();
  }

  // The client surface --------------------------------------------------------------

  const offline = () => {
    if (failures.simulation === "unavailable") throw new ApiError("UNAVAILABLE", "The simulation service is not running in this installation.", true);
    if (Date.now() < disconnectUntil) throw new ApiError("UNAVAILABLE", "The connection to the simulation service was lost.", true);
  };
  async function serve<T>(schema: Parameters<typeof validate<T>>[0], what: string, build: () => unknown, signal?: AbortSignal): Promise<T> {
    await delay(LATENCY_MS * pace, signal);
    offline();
    return validate(schema, JSON.parse(JSON.stringify(build())), what);
  }
  const statusOf = (rec: RunRecord) => rec.status;
  function detailOf(rec: RunRecord): RunDetail {
    return { ...rec.status, frame: rec.frame, results: rec.results, corrections: rec.corrections, overrides: rec.overrides, events: rec.events };
  }
  const pilotOf = (rec: RunRecord): PilotState => ({
    schemaVersion: 1,
    runId: rec.status.runId,
    monitoring: rec.pilot.monitoring,
    scans: rec.pilot.scans,
    lastScanAt: rec.pilot.lastScanAt,
    reasoningPending: rec.pilot.issues.filter((i) => i.reasoning.pending).length,
    issues: rec.pilot.issues,
    activity: rec.pilot.activity,
  });
  const pilotDown = () => {
    if (failures.pilot === "unavailable") throw new ApiError("UNAVAILABLE", "The pilot service is not running in this installation.", true);
  };

  const capabilities: SimulationCapabilities = {
    schemaVersion: 1,
    service: { kind: "mock", engine: "Mock simulation service (fixture arithmetic, not PHYVAC)", revision: "demo-mock-1" },
    configRevision: demoTopology.configRevision,
    topologyFamily: demoTopology.family,
    scenarios: TEMPLATES.map((t) => {
      const def = scenarioById(t.base)!;
      return { id: t.id, label: t.label ?? def.label, description: t.description ?? def.description, defaultStartMinute: t.start };
    }),
    durationsHours: [1, 3, 6, 12],
    stepsMinutes: [5, 10, 15],
    chwSetpoint: { min: 7, max: 12, default: 7 },
    points: POINTS,
    controls: { step: true, release: true },
    limits: [
      "Fixture arithmetic, not PHYVAC: results show how the dashboard handles a run, not how this plant behaves.",
      `Calibrated envelope: wet bulb up to ${ENVELOPE_WB} °C. Beyond it a step produces no observation and the run fails.`,
      "Steady state per step: no hydraulic transients, start-up delays or dehumidification limits.",
      "Chiller staging follows the scenario's baseline control; corrections cannot stage chillers.",
    ],
    pilot:
      failures.pilot === "unavailable"
        ? { available: false, reason: "The pilot service is not running in this installation." }
        : { available: true, reason: null },
  };

  const simulation: SimulationClient = {
    getCapabilities: (o) => serve(simulationCapabilities, "simulation capabilities", () => capabilities, o?.signal),
    listRuns: (o) => serve(runStatus.array(), "simulation runs", () => state.runs.map(statusOf).reverse(), o?.signal),
    getRun: (runId, o) => serve(runDetail, "simulation run", () => detailOf(find(runId)), o?.signal),
    // A recorded step is reproduced from the run's configuration and what it held then,
    // the way it was first observed; the newest is the one the run keeps.
    getObservation: (runId, step, o) =>
      serve(
        snapshot,
        "simulation observation",
        () => {
          const rec = find(runId);
          if (!rec.frame || !Number.isInteger(step) || step < 0 || step > rec.status.stepsTaken) {
            throw new ApiError("NOT_FOUND", `${runId} has no recorded observation at step ${step}.`, false);
          }
          if (step === rec.status.stepsTaken) return rec.frame;
          try {
            return observe(rec, step, heldAt(rec.corrections, step));
          } catch (e) {
            if (e instanceof SimFailure) throw new ApiError("UNAVAILABLE", e.message, true);
            throw e;
          }
        },
        o?.signal,
      ),

    async createRun(config, requestId, name) {
      await delay(LATENCY_MS * pace);
      offline();
      const again = state.runs.find((r) => r.requestId === requestId);
      if (again) return statusOf(again);
      checkConfig(config);
      const given = name === undefined || name.trim() === "" ? null : checkName(name);
      const def = capabilities.scenarios.find((s) => s.id === config.scenarioId)!;
      const runId = `RUN-${String(++state.seq).padStart(4, "0")}`;
      const rec: RunRecord = {
        status: {
          runId,
          name: given ?? `${def.label} from ${hhmm(iso(DAY_START + config.startMinute * MINUTE_MS))}`,
          state: "created",
          scenario: { id: def.id, label: def.label },
          config,
          configRevision: demoTopology.configRevision,
          simulatedTime: null,
          stepsTaken: 0,
          stepsTotal: Math.round((config.durationHours * 60) / config.stepMinutes),
          lastError: null,
          createdAt: iso(Date.now()),
          stats: statsOf({ times: [], demandKw: [], removedKw: [], unmetKw: [], powerKw: [], energyKwh: [], cop: [] }, config.stepMinutes),
        },
        requestId,
        frame: null,
        results: { times: [], demandKw: [], removedKw: [], unmetKw: [], powerKw: [], energyKwh: [], cop: [] },
        corrections: [],
        overrides: [],
        events: [],
        pending: null,
        measure: [],
        pilot: { monitoring: false, scans: 0, lastScanAt: null, issues: [], activity: [], keys: {}, clear: {}, reasoning: {} },
        summary: null,
      };
      state.runs.push(rec);
      event(rec, "lifecycle", `Run created as “${rec.status.name}”: ${def.label}, ${config.durationHours} h in ${config.stepMinutes}-minute steps, configuration revision ${demoTopology.configRevision}.`);
      persist();
      return statusOf(rec);
    },

    async renameRun(runId, name) {
      await delay(LATENCY_MS * pace);
      offline();
      const rec = find(runId);
      const next = checkName(name);
      if (next !== rec.status.name) {
        event(rec, "lifecycle", `Renamed from “${rec.status.name}” to “${next}”.`);
        rec.status.name = next;
        persist();
      }
      return statusOf(rec);
    },

    async command(runId, command: RunCommand) {
      await delay(LATENCY_MS * pace);
      offline();
      const rec = find(runId);
      const st = rec.status.state;
      const conflict = (msg: string) => new ApiError("CONFLICT", msg, false);
      switch (command) {
        case "start":
          if (st !== "created") break; // already started: the same answer again
          rec.status.state = "paused";
          try {
            record(rec, observe(rec, 0, []));
            event(rec, "lifecycle", "Run started: initial observation recorded.");
            if (rec.pilot.monitoring) scan(rec);
          } catch (e) {
            if (!(e instanceof SimFailure)) throw e;
            fail(rec, e.message);
          }
          break;
        case "play":
          if (st === "created") throw conflict("Start the run before playing it.");
          if (isFinal(st)) throw conflict(`A ${st} run cannot play again.`);
          if (st === "paused") {
            rec.status.state = "running";
            event(rec, "lifecycle", "Playing.");
            ensureTicker();
          }
          break;
        case "pause":
          if (st === "running") {
            rec.status.state = "paused";
            event(rec, "lifecycle", "Paused by the service; the simulated clock is held.");
          }
          break;
        case "step":
          if (st === "running") throw conflict("Pause the run before stepping it by hand.");
          if (st !== "paused") throw conflict(st === "created" ? "Start the run before stepping it." : `A ${st} run cannot be stepped.`);
          advance(rec);
          break;
        case "stop":
          if (!isFinal(st)) finish(rec, "Stopped by the operator.");
          break;
      }
      persist();
      return statusOf(rec);
    },

    async submitCorrection(runId, request) {
      await delay(LATENCY_MS * pace);
      offline();
      const rec = find(runId);
      if (!correctionRequest.safeParse(request).success) throw new ApiError("INVALID_REQUEST", "The correction request is malformed.", false);
      const c = submit(rec, request);
      persist();
      return validate(correctionSchema, JSON.parse(JSON.stringify(c)), "correction");
    },
  };

  function checkName(name: string) {
    const parsed = runName.safeParse(name);
    if (!parsed.success) throw new ApiError("INVALID_REQUEST", "A run name is 1 to 60 characters of plain text on one line.", false);
    return parsed.data;
  }

  function checkConfig(config: RunConfig) {
    const bad = (msg: string) => new ApiError("INVALID_REQUEST", msg, false);
    // The service validates what it is sent, as the real one will.
    const parsed = runConfig.safeParse(config);
    if (!parsed.success) throw bad(`The run configuration is incomplete (${parsed.error.issues[0]?.path.join(".")}).`);
    if (!capabilities.scenarios.some((s) => s.id === config.scenarioId)) throw bad(`Unknown scenario ${config.scenarioId}.`);
    if (!capabilities.durationsHours.includes(config.durationHours)) throw bad("That duration is not supported.");
    if (!capabilities.stepsMinutes.includes(config.stepMinutes)) throw bad("That timestep is not supported.");
    if (config.startMinute % STEP_MIN !== 0) throw bad("The start time must be on a 5-minute boundary.");
    if (config.startMinute + config.durationHours * 60 > SAMPLES * STEP_MIN - STEP_MIN) throw bad("The run must end within the scenario day.");
    if (config.chwSetpointC < capabilities.chwSetpoint.min || config.chwSetpointC > capabilities.chwSetpoint.max) throw bad("The chilled-water setpoint is outside the allowed range.");
  }

  const pilot: PilotClient = {
    async getState(runId, o) {
      await delay(LATENCY_MS * pace, o?.signal);
      offline();
      pilotDown();
      return validate(pilotState, JSON.parse(JSON.stringify(pilotOf(find(runId)))), "pilot state");
    },
    async setMonitoring(runId, monitoring) {
      await delay(LATENCY_MS * pace);
      offline();
      pilotDown();
      const rec = find(runId);
      if (monitoring && isFinal(rec.status.state)) throw new ApiError("CONFLICT", `${runId} has ended; the pilot monitors running simulations only.`, false);
      if (rec.pilot.monitoring !== monitoring) {
        rec.pilot.monitoring = monitoring;
        activity(rec, monitoring ? `Monitoring started for ${runId} (simulation only).` : `Monitoring stopped for ${runId}.`);
        if (monitoring) scan(rec);
      }
      persist();
      return validate(pilotState, JSON.parse(JSON.stringify(pilotOf(rec))), "pilot state");
    },
    async declineProposal(runId, issueId) {
      await delay(LATENCY_MS * pace);
      offline();
      pilotDown();
      const rec = find(runId);
      const issue = rec.pilot.issues.find((i) => i.id === issueId);
      if (!issue) throw new ApiError("NOT_FOUND", `${runId} has no issue ${issueId}.`, false);
      const conflict = (msg: string) => new ApiError("CONFLICT", msg, false);
      if (isFinal(rec.status.state)) throw conflict(`${runId} has ended; there is no proposal to decide on.`);
      if (!issue.open || !issue.proposal || issue.stage !== "proposal") throw conflict(`${issueId} has no standing proposal to decline.`);
      if (issue.declinedAt) return validate(pilotState, JSON.parse(JSON.stringify(pilotOf(rec))), "pilot state"); // declining again is the same answer
      if (issue.correctionIds.some((id) => rec.corrections.find((c) => c.id === id)?.status === "queued")) throw conflict(`${issueId}'s proposal is already queued for the next step.`);
      issue.declinedAt = now(rec);
      evidence(rec, issue, { kind: "decision", text: `The operator declined the proposal; nothing was applied to ${runId}.` });
      activity(rec, `${issueId}: proposal declined by the operator; nothing applied.`);
      persist();
      return validate(pilotState, JSON.parse(JSON.stringify(pilotOf(rec))), "pilot state");
    },
    async getRunSummary(runId, o) {
      await delay(LATENCY_MS * pace, o?.signal);
      offline();
      pilotDown();
      const rec = find(runId);
      if (!rec.summary) throw new ApiError("CONFLICT", `${runId} has not ended, so there is no summary yet.`, false);
      return validate(runSummary, JSON.parse(JSON.stringify(rec.summary)), "run summary");
    },
    async listRunSummaries(o) {
      await delay(LATENCY_MS * pace, o?.signal);
      offline();
      pilotDown();
      const all = state.runs.map((r) => r.summary).filter((x): x is RunSummary => x !== null).reverse();
      return validate(runSummary.array(), JSON.parse(JSON.stringify(all)), "run summaries");
    },
  };

  return { simulation, pilot };
}
