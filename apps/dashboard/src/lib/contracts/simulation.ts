/**
 * Simulation and AI pilot boundary. Shaped after PR #2's run, submission and correction
 * semantics (`origin/feat/simulation-foundation` at 3d5663d, `run.py` and
 * `corrections.py`): backend-governed run states, a correction gate whose rejection is an
 * ordinary answer, "accepted is not applied", held manual overrides with explicit release,
 * and outcomes measured after the step that took the correction. Draft frontend schemas:
 * the wire schema is still to be agreed with the API owner.
 *
 * Everything here targets a simulation run. Nothing in this contract addresses physical
 * equipment.
 */
import { z } from "zod";
import { isoTime } from "./common";
import { issueSeverity, snapshot } from "./readings";

export const runState = z.enum(["created", "running", "paused", "stopped", "failed"]);
export type RunState = z.infer<typeof runState>;
export const isFinal = (s: RunState) => s === "stopped" || s === "failed";

export const runCommand = z.enum(["start", "play", "pause", "step", "stop"]);
export type RunCommand = z.infer<typeof runCommand>;

/** A point the simulation accepts a setpoint for, with the site's allowed range. */
export const commandablePoint = z.object({
  point: z.string(),
  equipmentId: z.string(),
  metric: z.enum(["chilled_water_temp_set", "frequency_setpoint"]),
  label: z.string(),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  /** The reading that shows what the plant actually reached. */
  readingKey: z.string(),
});
export type CommandablePoint = z.infer<typeof commandablePoint>;

export const simulationCapabilities = z.object({
  schemaVersion: z.literal(1),
  /** `mock` is the browser demo service; the modified PHYVAC service reports `phyvac`. */
  service: z.object({ kind: z.enum(["mock", "phyvac"]), engine: z.string(), revision: z.string() }),
  configRevision: z.number().int().positive(),
  topologyFamily: z.string(),
  scenarios: z.array(
    z.object({ id: z.string(), label: z.string(), description: z.string(), defaultStartMinute: z.number().int().min(0) }),
  ),
  durationsHours: z.array(z.number().positive()),
  stepsMinutes: z.array(z.number().int().positive()),
  chwSetpoint: z.object({ min: z.number(), max: z.number(), default: z.number() }),
  points: z.array(commandablePoint),
  controls: z.object({ step: z.boolean(), release: z.boolean() }),
  /** Known calibration and model limits, stated to the operator. */
  limits: z.array(z.string()),
  pilot: z.object({ available: z.boolean(), reason: z.string().nullable() }),
});
export type SimulationCapabilities = z.infer<typeof simulationCapabilities>;

export const runConfig = z.object({
  scenarioId: z.string(),
  /** Site-local minutes after midnight on the demo day. */
  startMinute: z.number().int().min(0).max(1435),
  durationHours: z.number().positive(),
  stepMinutes: z.number().int().positive(),
  /** Baseline control's chilled-water supply setpoint for every chiller (°C). */
  chwSetpointC: z.number(),
});
export type RunConfig = z.infer<typeof runConfig>;

export const rejectionCode = z.enum(["run_not_active", "wrong_run", "stale", "unknown_point", "out_of_limits", "malformed"]);
export const correctionStatus = z.enum(["rejected", "queued", "superseded", "expired", "applied"]);
export type CorrectionStatus = z.infer<typeof correctionStatus>;

export const correctionOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("operator") }),
  z.object({ kind: z.literal("pilot"), issueId: z.string() }),
]);

export const correctionRequest = z.object({
  /** `set` holds a manual value; `release` returns the point to baseline control. */
  kind: z.enum(["set", "release"]),
  point: z.string(),
  value: z.number().finite().nullable(),
  /** Simulated time of the observation the request was computed against. */
  basedOn: isoTime,
  origin: correctionOrigin,
});
export type CorrectionRequest = z.infer<typeof correctionRequest>;

export const correction = correctionRequest.extend({
  id: z.string(),
  runId: z.string(),
  equipmentId: z.string(),
  label: z.string(),
  unit: z.string(),
  allowed: z.tuple([z.number(), z.number()]),
  /** Simulated time at submission. */
  submittedAt: isoTime,
  status: correctionStatus,
  rejection: z.object({ code: rejectionCode, reason: z.string() }).optional(),
  /** The step that took it, as the run recorded it when taking it. */
  applied: z.object({ step: z.number().int(), at: isoTime }).optional(),
  /** What the plant did, measured after the step that took it. */
  outcome: z
    .object({ observedAt: isoTime, achieved: z.number().nullable(), shortfall: z.number().nullable(), reached: z.boolean(), note: z.string() })
    .optional(),
});
export type Correction = z.infer<typeof correction>;

export const heldOverride = z.object({
  point: z.string(),
  equipmentId: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  correctionId: z.string(),
  since: isoTime,
});
export type HeldOverride = z.infer<typeof heldOverride>;

/** What a run held after step `step`: the corrections it had applied by then, each set or
 *  released in turn. With the run's configuration it reproduces that recorded step. */
export function heldAt(corrections: Correction[], step: number): HeldOverride[] {
  const held = new Map<string, HeldOverride>();
  for (const c of corrections.filter((x) => x.applied && x.applied.step <= step).sort((a, b) => a.applied!.step - b.applied!.step)) {
    held.delete(c.point);
    if (c.kind === "set" && c.value !== null) {
      held.set(c.point, { point: c.point, equipmentId: c.equipmentId, label: c.label, value: c.value, unit: c.unit, correctionId: c.id, since: c.applied!.at });
    }
  }
  return [...held.values()];
}

export const runEvent = z.object({
  id: z.string(),
  /** Simulated time. */
  at: isoTime,
  kind: z.enum(["lifecycle", "correction", "failure"]),
  text: z.string(),
  correctionId: z.string().optional(),
});
export type RunEvent = z.infer<typeof runEvent>;

const series = z.array(z.number().finite().nullable());
/** Per-step results. Demand, removed cooling, unmet demand, power and energy are distinct. */
export const runResults = z.object({
  times: z.array(isoTime),
  demandKw: series,
  removedKw: series,
  unmetKw: series,
  powerKw: series,
  /** Cumulative electrical energy since the run started. */
  energyKwh: series,
  cop: series,
});
export type RunResults = z.infer<typeof runResults>;

/** Figures over a run's valid observations, computed by the simulation service. */
export const runStats = z.object({
  /** Simulated minutes covered by valid observations. */
  simulatedMinutes: z.number().int(),
  avgCop: z.number().nullable(),
  energyKwh: z.number(),
  avgPowerKw: z.number().nullable(),
  avgDemandKw: z.number().nullable(),
  peakUnmetKw: z.number(),
  /** Unmet cooling demand integrated over the run. */
  unmetKwh: z.number(),
});
export type RunStats = z.infer<typeof runStats>;

/** A run's name: the operator's label for it, never its identity (that is the run ID). */
export const runName = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((s) => !/[\u0000-\u001f]/.test(s), "A run name is plain text on one line.");

export const runStatus = z.object({
  runId: z.string(),
  /** The operator's label for the run; the service names it after its scenario if none is given. */
  name: z.string(),
  state: runState,
  scenario: z.object({ id: z.string(), label: z.string() }),
  config: runConfig,
  configRevision: z.number().int().positive(),
  /** Simulated time of the newest valid observation; null before the run starts. */
  simulatedTime: isoTime.nullable(),
  stepsTaken: z.number().int(),
  stepsTotal: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: isoTime,
  stats: runStats,
});
export type RunStatus = z.infer<typeof runStatus>;

/** Runs are comparable only with the same demand, weather, start, length and site
 *  configuration: the same scenario, start, duration, timestep and revision. */
export const matchedRuns = (a: RunStatus, b: RunStatus) =>
  a.runId !== b.runId &&
  a.scenario.id === b.scenario.id &&
  a.config.startMinute === b.config.startMinute &&
  a.config.durationHours === b.config.durationHours &&
  a.config.stepMinutes === b.config.stepMinutes &&
  a.configRevision === b.configRevision &&
  b.stepsTaken > 0;

export const runDetail = runStatus.extend({
  /** The newest valid observation. After a failure it is retained, never replaced. */
  frame: snapshot.nullable(),
  results: runResults,
  corrections: z.array(correction),
  overrides: z.array(heldOverride),
  events: z.array(runEvent),
});
export type RunDetail = z.infer<typeof runDetail>;

// AI pilot ------------------------------------------------------------------

export const pilotStage = z.enum(["detection", "investigation", "proposal", "application", "outcome", "resolution"]);
export type PilotStage = z.infer<typeof pilotStage>;

export const evidenceItem = z.object({
  id: z.string(),
  /** Simulated time the evidence refers to; kept as recorded. */
  at: isoTime,
  kind: z.enum(["detection", "reading", "tool", "reasoning", "proposal", "decision", "submission", "outcome", "resolution"]),
  text: z.string(),
  status: z.enum(["ok", "error"]).optional(),
  correctionId: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItem>;

export const pilotIssue = z.object({
  /** Backend issue ID: repeated detections update this issue. */
  id: z.string(),
  runId: z.string(),
  title: z.string(),
  severity: issueSeverity,
  equipmentIds: z.array(z.string()),
  firstSeen: isoTime,
  lastSeen: isoTime,
  detections: z.number().int(),
  /** An alert is a screening result, not a verified fault. */
  assessment: z.enum(["alert", "suspected", "confirmed"]),
  stage: pilotStage,
  open: z.boolean(),
  reasoning: z.object({ pending: z.boolean(), summary: z.string().nullable(), uncertainty: z.string().nullable() }),
  proposal: correctionRequest
    .extend({ equipmentId: z.string(), label: z.string(), unit: z.string(), allowed: z.tuple([z.number(), z.number()]), rationale: z.string() })
    .nullable(),
  /** Set when the investigation ends without a correction to propose. */
  advisory: z.string().nullable(),
  correctionIds: z.array(z.string()),
  /** When the operator declined the standing proposal; nothing was applied for it. */
  declinedAt: isoTime.nullable(),
  resolution: z.object({ at: isoTime, summary: z.string(), evidenceIds: z.array(z.string()) }).nullable(),
  evidence: z.array(evidenceItem),
});
export type PilotIssue = z.infer<typeof pilotIssue>;

export const pilotState = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  monitoring: z.boolean(),
  scans: z.number().int(),
  lastScanAt: isoTime.nullable(),
  reasoningPending: z.number().int(),
  issues: z.array(pilotIssue),
  activity: z.array(z.object({ id: z.string(), at: isoTime, text: z.string() })),
});
export type PilotState = z.infer<typeof pilotState>;

/**
 * The pilot's account of a run that has ended, generated from what was recorded: the
 * run's results, corrections and events, and the pilot's issues and evidence. Every
 * figure and sentence is derived from those records; nothing is inferred beyond them.
 */
export const runSummary = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  /** How it was produced. `recorded`: deterministic, from the run's records only. */
  basis: z.literal("recorded"),
  generatedAt: isoTime,
  identity: z.object({
    name: z.string(),
    scenario: z.object({ id: z.string(), label: z.string() }),
    configRevision: z.number().int().positive(),
    state: runState,
    endReason: z.enum(["completed", "stopped", "failed"]),
    /** Simulated times of the first and last valid observations. */
    startedAt: isoTime.nullable(),
    endedAt: isoTime.nullable(),
    simulatedMinutes: z.number().int(),
    plannedMinutes: z.number().int(),
    lastError: z.string().nullable(),
  }),
  performance: z.object({
    avgCop: z.number().nullable(),
    firstCop: z.number().nullable(),
    lastCop: z.number().nullable(),
    energyKwh: z.number(),
    avgPowerKw: z.number().nullable(),
    avgDemandKw: z.number().nullable(),
    peakDemandKw: z.number().nullable(),
    peakUnmetKw: z.number(),
    unmetKwh: z.number(),
    /** Observations with unmet demand, of all observations. */
    unmetSteps: z.number().int(),
    steps: z.number().int(),
  }),
  pilot: z.object({
    monitored: z.boolean(),
    issues: z.number().int(),
    resolved: z.number().int(),
    investigations: z.number().int(),
    proposals: z.number().int(),
    /** Proposals the operator declined. */
    declined: z.number().int(),
    unresolved: z.array(z.object({ issueId: z.string(), title: z.string(), severity: issueSeverity, stage: pilotStage })),
  }),
  corrections: z.object({
    operator: z.number().int(),
    pilot: z.number().int(),
    applied: z.number().int(),
    rejected: z.number().int(),
    superseded: z.number().int(),
    expired: z.number().int(),
    reached: z.number().int(),
    notReached: z.number().int(),
  }),
  timeline: z.array(
    z.object({
      at: isoTime,
      kind: z.enum(["lifecycle", "detection", "investigation", "proposal", "decision", "operator", "outcome", "resolution", "failure"]),
      text: z.string(),
      issueId: z.string().optional(),
      correctionId: z.string().optional(),
    }),
  ),
  assessment: z.array(z.object({ kind: z.enum(["observation", "improved", "not_improved", "concern"]), text: z.string() })),
  recommendations: z.array(z.object({ text: z.string(), basis: z.string() })),
});
export type RunSummary = z.infer<typeof runSummary>;
