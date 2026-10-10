/**
 * AI Pilot's one source of truth for the live run: the run it is working with (live, or
 * the last one it ran), what the services last said about it (the run, the pilot's state
 * and, once the run has ended, the pilot's summary) and how AI Pilot is showing it (its
 * view, the issue chosen, whether a new run is being set up, a control the assistant
 * pointed to). Kept outside React, so the console keeps its run while the main display
 * changes screens, and nothing it does moves the main display. A recorded run's replay
 * and Simulation history read runs on their own, without changing this one.
 *
 * The service owns the run: this store only reads it (reading never advances the clock)
 * and forwards operator commands. When a read fails it keeps the last data it received,
 * says the service is unreachable and keeps trying, so it reconnects to the same run.
 */
import { useSyncExternalStore } from "react";
import { ApiError } from "../../lib/api/client";
import type {
  Correction,
  CorrectionRequest,
  PilotState,
  RunCommand,
  RunConfig,
  RunDetail,
  RunStatus,
  RunSummary,
  SimulationCapabilities,
} from "../../lib/contracts/simulation";
import { isFinal } from "../../lib/contracts/simulation";
import { pilotClient, simulationClient as sim, simulationPace } from "../../app/dataClient";

/** What AI Pilot shows of the run: live (its summary once ended), findings or corrections. */
export type PilotView = "live" | "findings" | "corrections";
/** Operator controls the assistant may point to (never press: F10). */
export type PilotControl = "start" | "pause" | "resume" | "step" | "stop" | "apply" | "corrections" | "monitoring";

export interface SimulationSession {
  caps: SimulationCapabilities | null;
  capsError: ApiError | null;
  runs: RunStatus[];
  runId: string | null;
  /** The attached run as last read; null until it has been read. */
  run: RunDetail | null;
  pilot: PilotState | null;
  pilotError: ApiError | null;
  /** The pilot's summary of the run, once it has ended. */
  summary: RunSummary | null;
  summaryError: ApiError | null;
  /** The newest read failed; what is shown is the last data received. */
  readError: ApiError | null;
  /** A run the service no longer knows (its state was cleared). */
  lostRunId: string | null;
  /** The operator command in flight; its button stays inert until the service answers. */
  busy: string | null;
  commandError: ApiError | null;
  view: PilotView;
  /** The issue chosen in Findings. */
  issueId: string | null;
  /** A new run is being set up while another stays attached. */
  composing: boolean;
  /** The run the operator has just started in AI Pilot: its controls take the focus the
   *  set-up form gave up. */
  launched: string | null;
  /** A control the assistant pointed to: shown, never pressed. */
  pointer: { control: PilotControl; issueId: string | null; nonce: number } | null;
}

/** How often the attached run is read while something shows it. */
const POLL_MS = 500;
const RUN_KEY = "hvac-agent.simulation.run";
const asError = (e: unknown) => (e instanceof ApiError ? e : new ApiError("UNAVAILABLE", String(e), true));

function savedRun() {
  try {
    return sessionStorage.getItem(RUN_KEY);
  } catch {
    return null;
  }
}

let state: SimulationSession = {
  caps: null,
  capsError: null,
  runs: [],
  runId: savedRun(),
  run: null,
  pilot: null,
  pilotError: null,
  summary: null,
  summaryError: null,
  readError: null,
  lostRunId: null,
  busy: null,
  commandError: null,
  view: "live",
  issueId: null,
  composing: false,
  launched: null,
  pointer: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<SimulationSession>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** Reads may overlap (a poll and the read after a command); only the newest one started
 *  is applied, so an older answer can never overwrite a fresher one. */
let latest = 0;

/** A read that returns what is already shown keeps the shown object, so nothing
 *  re-renders between steps or while a run is paused. */
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const changed = <K extends keyof SimulationSession>(key: K, value: SimulationSession[K]): Partial<SimulationSession> =>
  same(state[key], value) ? {} : { [key]: value };

async function refresh() {
  const ticket = ++latest;
  const current = () => ticket === latest;
  if (!state.caps) {
    try {
      const caps = await sim.getCapabilities();
      if (current()) set({ caps, capsError: null });
    } catch (e) {
      if (current()) set({ capsError: asError(e) });
      return;
    }
  }
  const runId = state.runId;
  try {
    const [runs, run] = await Promise.all([sim.listRuns(), runId ? sim.getRun(runId) : Promise.resolve(null)]);
    if (!current() || state.runId !== runId) return;
    const patch = { ...changed("runs", runs), ...changed("run", run), ...(state.readError ? { readError: null } : {}) };
    if (Object.keys(patch).length) set(patch);
  } catch (e) {
    if (!current() || state.runId !== runId) return;
    const err = asError(e);
    if (err.code === "NOT_FOUND" && runId) return session.attach(null, runId);
    if (state.readError?.message !== err.message) set({ readError: err });
    return;
  }
  if (!runId) return;
  if (!state.caps?.pilot.available) {
    if (state.run && isFinal(state.run.state) && !state.summaryError) {
      set({ summaryError: new ApiError("UNAVAILABLE", state.caps?.pilot.reason ?? "The pilot service is not available.", true) });
    }
    return;
  }
  try {
    const pilot = await pilotClient.getState(runId);
    if (!current() || state.runId !== runId) return;
    const patch = { ...changed("pilot", pilot), ...(state.pilotError ? { pilotError: null } : {}) };
    if (Object.keys(patch).length) set(patch);
  } catch (e) {
    const err = asError(e);
    if (current() && state.runId === runId && state.pilotError?.message !== err.message) set({ pilotError: err });
  }
  // The summary is written once, when the run ends; it is read once.
  if (state.run && isFinal(state.run.state) && state.summary?.runId !== runId) {
    try {
      const summary = await pilotClient.getRunSummary(runId);
      if (state.runId === runId) set({ summary, summaryError: null });
    } catch (e) {
      if (state.runId === runId) set({ summaryError: asError(e) });
    }
  }
}

/** The newest run that has not ended, if any: the one AI Pilot is running. */
export const liveRunOf = (runs: RunStatus[]) => runs.find((r) => !isFinal(r.state)) ?? null;

// One poll loop at most, running while anything shows the session.
let polling = false;
function poll() {
  polling = true;
  void refresh().finally(() => {
    if (listeners.size) setTimeout(poll, POLL_MS * simulationPace);
    else polling = false;
  });
}

// Stable functions, so React subscribes once per component rather than on every render.
function subscribe(l: () => void) {
  listeners.add(l);
  if (!polling) poll();
  return () => void listeners.delete(l);
}
const snapshot = () => state;
export const useSimulation = () => useSyncExternalStore(subscribe, snapshot);

/** One operator command at a time: a second click while one is in flight does nothing.
 *  `shown` puts the service's own answer on screen at once; the read after it fills in
 *  the rest. */
async function command<T>(busy: string, op: () => Promise<T>, shown?: (out: T) => Partial<SimulationSession>): Promise<T | null> {
  if (state.busy) return null;
  // Using a control answers any pointer to one.
  set({ busy, commandError: null, pointer: null });
  try {
    const out = await op();
    if (shown) set(shown(out));
    await refresh();
    return out;
  } catch (e) {
    set({ commandError: asError(e) });
    return null;
  } finally {
    set({ busy: null });
  }
}

/** A run command's answer is the run's new status. */
const statusShown = (s: RunStatus): Partial<SimulationSession> => (state.run?.runId === s.runId ? { run: { ...state.run, ...s } } : {});

export const session = {
  /** The state now, for code that must not act on a render's stale copy. */
  current: () => state,
  /** Attach to a run (or none). Remembered in this tab so a refresh reconnects to it. */
  attach(runId: string | null, lost: string | null = null) {
    try {
      if (runId) sessionStorage.setItem(RUN_KEY, runId);
      else sessionStorage.removeItem(RUN_KEY);
    } catch {
      // Not remembered; the run stays attached until the page is reloaded.
    }
    if (runId === state.runId && !lost) return;
    set({
      runId,
      run: null,
      pilot: null,
      pilotError: null,
      summary: null,
      summaryError: null,
      readError: null,
      commandError: null,
      lostRunId: lost,
      // Another run opens at its live view (its summary once ended).
      view: "live",
      issueId: null,
      pointer: null,
      ...(runId ? { composing: false } : {}),
    });
    void refresh();
  },
  /** Show live (or the summary), findings or corrections; choosing an issue shows findings. */
  setView: (view: PilotView) => set({ view, ...(view === "findings" ? {} : { issueId: null }) }),
  selectIssue: (issueId: string | null) => set({ issueId, ...(issueId ? { view: "findings" as const } : {}) }),
  /** Set up a new run (the attached one stays until the new one starts). */
  compose: (composing: boolean) => set({ composing, pointer: null }),
  /** The assistant points to a control: AI Pilot shows it; only the operator presses it. */
  point: (control: PilotControl, issueId: string | null = null) =>
    set({
      pointer: { control, issueId, nonce: Date.now() },
      // The view that holds the control: the proposal under its issue, the corrections form,
      // the set-up for a new run; the run band's controls show in every view.
      ...(issueId ? { issueId, view: "findings" as const } : {}),
      ...(control === "corrections" ? { view: "corrections" as const } : {}),
      ...(control === "start" ? { composing: true } : {}),
    }),
  clearPointer: () => state.pointer && set({ pointer: null }),
  retry: () => void refresh(),
  clearCommandError: () => set({ commandError: null }),

  /**
   * AI Pilot's launch: create the run, have the pilot monitor it, then start it (and play
   * it unless asked to start paused). Three operations on two services, each idempotent,
   * so a retried launch never creates a second run. The pilot is asked first, so it scans
   * the initial observation; a pilot that cannot monitor does not stop the simulation.
   */
  async launch(config: RunConfig, requestId: string, paused: boolean, name?: string) {
    return command(paused ? "launchPaused" : "launch", async () => {
      const created = await sim.createRun(config, requestId, name);
      session.attach(created.runId);
      set({ view: "live", composing: false, launched: created.runId });
      if (state.caps?.pilot.available) {
        try {
          await pilotClient.setMonitoring(created.runId, true);
        } catch (e) {
          set({ pilotError: asError(e) });
        }
      }
      const started = await sim.command(created.runId, "start");
      const status = !paused && started.state === "paused" ? await sim.command(created.runId, "play") : started;
      return status;
    }, statusShown);
  },
  /** Start records the initial observation and leaves the run paused (PR #2); `play`
   *  then runs it. "Start run" is both, as two service operations. */
  start: (runId: string, play: boolean) =>
    command(
      play ? "start" : "startPaused",
      async () => {
        const s = await sim.command(runId, "start");
        return play && s.state === "paused" ? sim.command(runId, "play") : s;
      },
      statusShown,
    ),
  // Stopping is a decision to end: AI Pilot turns to the outcome. (A run that ends on its
  // own leaves the operator where they were.)
  command: (runId: string, op: RunCommand) =>
    command(op, () => sim.command(runId, op), (s) => ({ ...statusShown(s), ...(op === "stop" ? { view: "live" as const, issueId: null } : {}) })),
  submit: (runId: string, request: CorrectionRequest): Promise<Correction | null> =>
    command(request.origin.kind === "pilot" ? `apply:${request.origin.issueId}` : `correct:${request.point}`, () => sim.submitCorrection(runId, request)),
  setMonitoring: (runId: string, on: boolean) => command("monitor", () => pilotClient.setMonitoring(runId, on)),
  rename: (runId: string, name: string) => command("rename", () => sim.renameRun(runId, name), statusShown),
  /** The operator declines an issue's standing proposal: nothing is applied. */
  decline: (runId: string, issueId: string) => command(`decline:${issueId}`, () => pilotClient.declineProposal(runId, issueId), (pilot) => (state.runId === runId ? { pilot } : {})),
};
