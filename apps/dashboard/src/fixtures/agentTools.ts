/**
 * SIMULATED agent tools for the scripted demo. Each wraps the same DataClient the
 * screens use, so tool results are the synthetic scenario's data, not invented text.
 * A local harness would expose real tools with the same names and argument shapes.
 */
import type { DataClient } from "../lib/api/client";
import type { ForecastResult, History, IssueList, SiteBundle, Snapshot } from "../lib/contracts";
import { formatNumber, formatTime } from "../lib/format";

export interface ToolEnv {
  client: DataClient;
  site: SiteBundle;
}

export interface ToolOutcome<T> {
  value: T;
  summary: string;
}

const tz = (env: ToolEnv) => env.site.site.timezone;

export const TOOL_INFO = [
  { name: "get_plant_snapshot", description: "Latest equipment states and readings at a time." },
  { name: "list_issues", description: "Issues detected up to a time, with status and evidence." },
  { name: "get_equipment", description: "One item's topology connections, evidence and nameplate data." },
  { name: "get_history", description: "Reading history for metrics over a time range." },
  { name: "get_forecast", description: "Latest cooling-demand forecast issued at or before a time." },
  { name: "search_knowledge", description: "Search curated engineering documents." },
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
};
