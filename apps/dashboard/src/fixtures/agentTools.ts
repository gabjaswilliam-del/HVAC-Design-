/**
 * SIMULATED agent tools for the demo assistant. Each wraps a client the screens use, so
 * tool results are the synthetic scenario's data and the mock simulation service's
 * records, not invented text. A local harness would expose real tools with the same
 * names and argument shapes. Every tool reads; none can start, pause, step or stop a
 * simulation, submit a correction, apply a proposal or switch monitoring (F10): the
 * simulation and pilot are reached only through read-only facades.
 */
import type { DataClient } from "../lib/api/client";
import type { PilotReader, SimulationReader } from "../lib/api/simulation";
import type { ForecastResult, History, IssueList, SiteBundle, Snapshot } from "../lib/contracts";
import { isFinal, type PilotState, type RunDetail, type RunStatus, type RunSummary } from "../lib/contracts/simulation";
import { formatNumber, formatTime } from "../lib/format";

export interface ToolEnv {
  client: DataClient;
  site: SiteBundle;
  simulation: SimulationReader;
  pilot: PilotReader;
}

export interface ToolOutcome<T> {
  value: T;
  summary: string;
}

const tz = (env: ToolEnv) => env.site.site.timezone;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const TOOL_INFO = [
  { name: "get_plant_snapshot", description: "Latest equipment states and readings at a time." },
  { name: "list_issues", description: "Issues detected up to a time, with status and evidence." },
  { name: "get_equipment", description: "One item's topology connections, evidence and nameplate data." },
  { name: "get_history", description: "Reading history for metrics over a time range." },
  { name: "get_forecast", description: "Latest cooling-demand forecast issued at or before a time." },
  { name: "search_knowledge", description: "Search curated engineering documents." },
  { name: "list_simulation_runs", description: "Simulation runs, newest first, with their state and results so far. Read only." },
  { name: "get_simulation_run", description: "One simulation run's record: configuration, results, corrections and events. Read only." },
  { name: "get_run_summary", description: "The pilot's summary of a simulation run that has ended. Read only." },
  { name: "get_pilot_findings", description: "The AI pilot's issues, evidence and proposals on one simulation run. Read only." },
] as const;

export type ToolName = (typeof TOOL_INFO)[number]["name"];

export const tools = {
  async get_plant_snapshot(env: ToolEnv, args: { at: string }): Promise<ToolOutcome<Snapshot>> {
    const snap = await env.client.getSnapshot({ at: args.at });
    const stale = Object.values(snap.values).filter((r) => r.quality === "stale").length;
    const missing = Object.values(snap.values).filter((r) => r.quality === "unavailable").length;
    return {
      value: snap,
      summary: `${Object.keys(snap.equipment).length} equipment states and ${Object.keys(snap.values).length} readings at ${formatTime(snap.at, tz(env))}; ${stale} stale, ${missing} unavailable${snap.connection === "disconnected" ? "; telemetry disconnected" : ""}.`,
    };
  },

  async list_issues(env: ToolEnv, args: { at: string }): Promise<ToolOutcome<IssueList>> {
    const list = await env.client.getIssues({ at: args.at });
    const open = list.issues.filter((i) => i.status !== "resolved").length;
    return { value: list, summary: `${open} open, ${list.issues.length - open} resolved.` };
  },

  async get_equipment(env: ToolEnv, args: { id: string }) {
    const device = env.site.topology.devices.find((d) => d.id === args.id);
    if (!device) throw new Error(`No equipment with ID ${args.id} in configuration revision ${env.site.topology.configRevision}.`);
    const links = env.site.topology.links.filter((l) => [l.from, l.to].some((e) => "device" in e && e.device === args.id));
    const uncertain = links.filter((l) => l.evidence === "inferred" || l.evidence === "unknown").length;
    return {
      value: { device, links },
      summary: `${device.label}: ${links.length} connections (${uncertain} inferred or unknown), ${device.nameplate.length} nameplate values.`,
    };
  },

  async get_history(env: ToolEnv, args: { metrics: string; from: string; to: string }): Promise<ToolOutcome<History>> {
    const h = await env.client.getHistory({ metrics: args.metrics.split(","), from: args.from, to: args.to });
    return { value: h, summary: `${h.series.length} series, ${h.times.length} samples each.` };
  },

  async get_forecast(env: ToolEnv, args: { at: string; horizon_minutes: number; step_minutes: number }): Promise<ToolOutcome<ForecastResult>> {
    const f = await env.client.getLatestForecast({ at: args.at, horizonMinutes: args.horizon_minutes, stepMinutes: args.step_minutes });
    return {
      value: f,
      summary:
        f.status === "unavailable"
          ? `Unavailable: ${f.reasonCode}.`
          : `${f.status}, ${f.model?.mode} method, peak ${f.summary ? `${formatNumber(f.summary.peakKw, 0)} kWt at ${formatTime(f.summary.peakAt, tz(env))}` : "not reported"}.`,
    };
  },

  async search_knowledge(): Promise<ToolOutcome<never>> {
    throw new Error("The knowledge base is not available in this demo build (planned for a later milestone).");
  },

  async list_simulation_runs(env: ToolEnv): Promise<ToolOutcome<RunStatus[]>> {
    const runs = await env.simulation.listRuns();
    const active = runs.filter((r) => !isFinal(r.state)).length;
    return { value: runs, summary: runs.length ? `${plural(runs.length, "run")}: ${active} active, ${runs.length - active} ended.` : "No runs yet." };
  },

  async get_simulation_run(env: ToolEnv, args: { run_id: string }): Promise<ToolOutcome<RunDetail>> {
    const r = await env.simulation.getRun(args.run_id);
    return { value: r, summary: `${r.runId}, ${r.scenario.label}: ${r.state}, ${r.stepsTaken} of ${r.stepsTotal} steps.` };
  },

  async get_run_summary(env: ToolEnv, args: { run_id: string }): Promise<ToolOutcome<RunSummary>> {
    const s = await env.pilot.getRunSummary(args.run_id);
    return { value: s, summary: `${s.runId} ${s.identity.endReason}; ${plural(s.pilot.issues, "pilot issue")}, ${s.pilot.unresolved.length} unresolved.` };
  },

  async get_pilot_findings(env: ToolEnv, args: { run_id: string }): Promise<ToolOutcome<PilotState>> {
    const p = await env.pilot.getState(args.run_id);
    const open = p.issues.filter((i) => i.open).length;
    return { value: p, summary: `${plural(p.issues.length, "issue")} (${open} open) from ${plural(p.scans, "scan")}; monitoring ${p.monitoring ? "on" : "off"}.` };
  },
};
