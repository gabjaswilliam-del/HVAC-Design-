/**
 * SCRIPTED demo conversations. A prompt is matched to one of a few pre-written
 * investigations by keywords; the investigation calls the simulated tools and fills
 * its wording from their results. There is no language model and no reasoning: every
 * number comes from a tool result, missing data is reported as missing, and no
 * operational recommendation is generated.
 */
import type { AgentContext, DataView } from "../lib/contracts/agent";
import type { Device, ForecastResult, History, SiteBundle, Snapshot } from "../lib/contracts";
import { formatNumber, formatTime, siteDayStart } from "../lib/format";
import { shortfallPeriods } from "../lib/plant";
import type { ToolEnv, ToolName, tools } from "./agentTools";

type ToolValue<K extends ToolName> = Awaited<ReturnType<(typeof tools)[K]>>["value"];

export interface ScriptHost {
  env: ToolEnv;
  context: AgentContext;
  /** Runs a simulated tool; returns null (after reporting the error) when it fails. */
  tool<K extends ToolName>(name: K, args: Record<string, string | number>): Promise<ToolValue<K> | null>;
  say(text: string): Promise<void>;
  view(view: DataView): void;
}

export type Intent =
  | { kind: "attention" }
  | { kind: "equipment"; id: string }
  | { kind: "shortfall" }
  | { kind: "forecast" }
  | { kind: "efficiency" }
  | { kind: "fallback" };

export const SUGGESTED_PROMPTS = [
  "What needs attention right now?",
  "Is the plant meeting cooling demand?",
  "What cooling demand is forecast for the next 6 hours?",
  "How efficient is the plant right now?",
  "Investigate Cooling tower 4",
];

export const equipmentPrompt = (label: string) => `Investigate ${label}`;

/** Keyword matching for the scripted demo; a model harness replaces this entirely. */
export function matchIntent(prompt: string, site: SiteBundle): Intent {
  const p = prompt.toLowerCase();
  const device = [...site.topology.devices]
    .sort((a, b) => b.label.length - a.label.length)
    .find((d) => p.includes(d.label.toLowerCase()) || p.includes(d.id));
  if (/forecast|predict|next \d+ ?h|coming hours|later today/.test(p)) return { kind: "forecast" };
  if (/shortfall|unmet|meeting (the )?(cooling )?demand|enough cooling|delivered/.test(p)) return { kind: "shortfall" };
  if (device) return { kind: "equipment", id: device.id };
  if (/attention|issue|alarm|problem|wrong|fault/.test(p)) return { kind: "attention" };
  if (/efficien|\bcop\b|power|energy/.test(p)) return { kind: "efficiency" };
  return { kind: "fallback" };
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const STATUS_WORD: Record<string, string> = {
  detected: "detected",
  investigating: "investigating",
  correction_proposed: "correction proposed",
  monitoring: "monitoring",
  resolved: "resolved",
};
const STATE_WORD = { running: "running", stopped: "stopped", fault: "in fault", unavailable: "not reporting (no data)" };
const HOUR = 3_600_000;

function helpers(h: ScriptHost) {
  const { site } = h.env;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const time = (iso: string) => `${formatTime(iso, tz)} ${tzLabel}`;
  const info = (key: string) => site.metrics.find((m) => m.key === key);
  const reading = (snap: Snapshot | null, key: string) => snap?.kpis[key] ?? snap?.values[key];
  const value = (snap: Snapshot | null, key: string) => {
    const r = reading(snap, key);
    const m = info(key);
    if (!r || r.value === null) return "unavailable";
    const v = `${formatNumber(r.value, m?.decimals ?? 1)}${m?.unit ? ` ${m.unit}` : ""}`;
    return r.quality === "stale" ? `${v} (stale)` : v;
  };
  const label = (id: string) => site.topology.devices.find((d) => d.id === id)?.label ?? id;
  const dayStart = new Date(siteDayStart(Date.parse(h.context.at), tz)).toISOString();
  const series = (hist: History, metric: string, role: "observed" | "forecast" | "delivered" | "capacity") => {
    const s = hist.series.find((x) => x.metric === metric);
    return s ? [{ id: metric, label: info(metric)?.label ?? metric, role, times: hist.times, values: s.values }] : [];
  };
  return { site, tz, time, info, value, label, dayStart, series };
}

async function attention(h: ScriptHost) {
  const { time, value, label } = helpers(h);
  const at = h.context.at;
  const issues = await h.tool("list_issues", { at });
  const snap = await h.tool("get_plant_snapshot", { at });
  let text = `Summary of the synthetic scenario at ${time(at)}.\n`;
  const open = (issues?.issues ?? []).filter((i) => i.status !== "resolved").sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (!issues) text += "The issue list could not be retrieved, so open issues cannot be reported.\n";
  else if (open.length === 0) text += "No issues are open at this time.\n";
  else {
    text += `${open.length} open issue${open.length > 1 ? "s" : ""}:\n`;
    for (const i of open) {
      const who = i.equipmentIds.length ? ` Affects ${i.equipmentIds.map(label).join(", ")}.` : "";
      text += `- ${i.severity[0].toUpperCase()}${i.severity.slice(1)}, ${STATUS_WORD[i.status]}: ${i.title} (${i.id}), first seen ${time(i.firstSeen)}.${who}\n`;
    }
  }
  if (snap) {
    const unmet = snap.kpis["plant:unmet_kw"]?.value;
    text += `Plant indicators: cooling demand ${value(snap, "plant:cooling_demand_kw")}, delivered ${value(snap, "plant:cooling_delivered_kw")}`;
    text += unmet ? `, ${value(snap, "plant:unmet_kw")} unmet` : "";
    text += `, system COP ${value(snap, "plant:cop")}.`;
    if (snap.connection === "disconnected") text += ` Telemetry is disconnected; these are the last values received at ${time(snap.latestSampleAt!)}.`;
  }
  await h.say(text);
  if (open.length) {
    h.view({ kind: "issues", title: "Open issues", issues: open.map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, equipmentIds: i.equipmentIds })) });
    const ids = [...new Set(open.flatMap((i) => i.equipmentIds))];
    if (ids.length) h.view({ kind: "equipment", title: "Affected equipment", ids });
  }
  h.view({ kind: "link", label: "Open issues details", target: { type: "monitoring_kpi", kpi: "issues" } });
}

async function equipment(h: ScriptHost, id: string) {
  const { site, time, value, label, dayStart, series, info } = helpers(h);
  const at = h.context.at;
  const eq = await h.tool("get_equipment", { id });
  const snap = await h.tool("get_plant_snapshot", { at });
  const issues = await h.tool("list_issues", { at });
  const metrics = site.metrics.filter((m) => m.key.startsWith(`${id}:`));
  const hist = metrics.length ? await h.tool("get_history", { metrics: metrics[0].key, from: dayStart, to: at }) : null;
  const device: Device | undefined = eq?.device ?? site.topology.devices.find((d) => d.id === id);
  const status = snap?.equipment[id];
  const related = (issues?.issues ?? []).filter((i) => i.equipmentIds.includes(id) && i.status !== "resolved");
  const knowledge = status?.state === "fault" || related.length ? await h.tool("search_knowledge", { query: `${device?.family ?? id} ${status?.state ?? ""}`.trim() }) : undefined;

  let text = `${label(id)}`;
  if (!status) text += ": its state could not be retrieved.\n";
  else {
    text += ` is ${status.stale ? `last reported as ${STATE_WORD[status.state]}, but that report is stale` : STATE_WORD[status.state]} at ${time(at)}.\n`;
  }
  if (metrics.length && snap) {
    text += `Readings: ${metrics.map((m) => `${m.label.toLowerCase()} ${value(snap, m.key)}`).join(", ")}.\n`;
  }
  if (related.length) {
    text += `Related open issues:\n${related.map((i) => `- ${i.title} (${i.id}), ${STATUS_WORD[i.status]} since ${time(i.firstSeen)}.`).join("\n")}\n`;
  } else if (issues) text += "No open issues mention this equipment.\n";
  if (eq) {
    const parts = eq.links.map((l) => {
      const outgoing = "device" in l.from && l.from.device === id;
      const other = outgoing ? l.to : l.from;
      const otherLabel = "device" in other ? label(other.device) : site.topology.buses.find((b) => b.id === other.bus)?.label ?? other.bus;
      return `${outgoing ? "to" : "from"} ${otherLabel} (${l.evidence})`;
    });
    if (parts.length) text += `Connections: ${parts.join("; ")}.`;
    const uncertain = eq.links.filter((l) => l.evidence === "inferred" || l.evidence === "unknown");
    if (uncertain.length) text += ` ${uncertain.length} of these ${uncertain.length > 1 ? "are" : "is"} not confirmed against the installation.`;
    const missing = site.topology.unconnectedPorts.filter((u) => u.device === id);
    if (missing.length) text += ` Not recorded: ${missing.map((u) => u.note).join("; ")}.`;
    text += "\n";
  }
  if (knowledge === null) text += "Engineering documents could not be searched: the knowledge base is not available in this demo build.";
  await h.say(text.trim());
  h.view({ kind: "equipment", title: "Equipment", ids: [id] });
  if (hist && metrics.length) {
    h.view({ kind: "chart", title: `${label(id)}: ${info(metrics[0].key)?.label} today`, unit: metrics[0].unit, decimals: metrics[0].decimals, series: series(hist, metrics[0].key, "observed") });
  }
  if (related.length) {
    h.view({ kind: "issues", title: "Related issues", issues: related.map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, equipmentIds: i.equipmentIds })) });
  }
  h.view({ kind: "link", label: `${label(id)} on the equipment page`, target: { type: "equipment_page", id } });
}

async function shortfall(h: ScriptHost) {
  const { time, value, dayStart, series } = helpers(h);
  const at = h.context.at;
  const snap = await h.tool("get_plant_snapshot", { at });
  const keys = ["plant:cooling_demand_kw", "plant:cooling_delivered_kw", "plant:unmet_kw", "plant:available_capacity_kw"];
  const hist = await h.tool("get_history", { metrics: keys.join(","), from: dayStart, to: at });
  let text = "";
  if (snap) {
    const unmet = snap.kpis["plant:unmet_kw"];
    text += `At ${time(at)} cooling demand is ${value(snap, "plant:cooling_demand_kw")} and the plant is delivering ${value(snap, "plant:cooling_delivered_kw")}`;
    if (unmet?.value) text += `: ${value(snap, "plant:unmet_kw")} of demand is not being met.`;
    else if (unmet?.quality === "good") text += ": delivered cooling meets demand.";
    else text += ". Unmet demand is not available, so a shortfall cannot be confirmed or ruled out.";
    text += ` Running chiller capacity is ${value(snap, "plant:available_capacity_kw")} (rated capacity of the chillers running now).\n`;
  } else text += "Current readings could not be retrieved.\n";
  if (hist) {
    const periods = shortfallPeriods(hist as History);
    text += periods.length
      ? `Shortfall periods today: ${periods.map((p) => `${time(p.from)} to ${p.ongoing ? "now" : time(p.to)}, peak ${formatNumber(p.peak, 0)} kWt unmet`).join("; ")}.`
      : "No shortfall so far today.";
  } else text += "Today's history could not be retrieved, so earlier shortfalls cannot be listed.";
  await h.say(text.trim());
  if (hist) {
    h.view({
      kind: "chart",
      title: "Demand, delivered cooling and running capacity today",
      unit: "kWt",
      decimals: 0,
      series: [...series(hist, keys[1], "delivered"), ...series(hist, keys[0], "observed"), ...series(hist, keys[3], "capacity")],
    });
  }
  h.view({ kind: "link", label: "Cooling delivered details", target: { type: "monitoring_kpi", kpi: "plant:cooling_delivered_kw" } });
}

async function forecast(h: ScriptHost) {
  const { time, value, series } = helpers(h);
  const at = h.context.at;
  const f = (await h.tool("get_forecast", { at, horizon_minutes: 360, step_minutes: 15 })) as ForecastResult | null;
  const snap = await h.tool("get_plant_snapshot", { at });
  const from = new Date(Date.parse(at) - 6 * HOUR).toISOString();
  const hist = await h.tool("get_history", { metrics: "plant:cooling_demand_kw", from, to: at });
  let text = "";
  if (!f) text = "The forecast could not be retrieved.";
  else if (f.status === "unavailable") {
    text = `No forecast is available (${f.reasonCode}). ${f.warnings.join(" ")} No forecast values are shown.`;
  } else {
    text = `The demonstration baseline forecasts site cooling demand peaking at ${f.summary ? `${formatNumber(f.summary.peakKw, 0)} kWt at ${time(f.summary.peakAt)}` : "an unreported value"} within the next ${f.horizonMinutes / 60} hours, from data through ${time(f.latestInputAt ?? f.asOf)}.`;
    text += " It is a seasonal-profile baseline on synthetic data, not a trained model; its shaded spread is uncalibrated and no accuracy is claimed.";
    if (f.quality.freshness === "stale") text += " Its inputs are stale.";
    if (snap) text += `\nRunning chiller capacity at ${time(at)} is ${value(snap, "plant:available_capacity_kw")}. Future chiller staging is not forecast, so this is not an overload prediction.`;
  }
  await h.say(text);
  if (f && f.status !== "unavailable") {
    h.view({
      kind: "chart",
      title: "Observed and forecast cooling demand",
      unit: "kWt",
      decimals: 0,
      series: [
        ...(hist ? series(hist, "plant:cooling_demand_kw", "observed") : []),
        { id: "forecast", label: "Predicted demand", role: "forecast", times: f.series.map((p) => p.timestamp), values: f.series.map((p) => p.valueKw) },
      ],
      band: f.interval
        ? { label: "Uncalibrated spread", times: f.series.map((p) => p.timestamp), lo: f.series.map((p) => p.lowerKw ?? null), hi: f.series.map((p) => p.upperKw ?? null) }
        : undefined,
      cutoff: f.asOf,
    });
  }
  h.view({ kind: "link", label: "Open cooling prediction", target: { type: "prediction", forecastId: f && f.status !== "unavailable" ? f.forecastId : undefined } });
}

async function efficiency(h: ScriptHost) {
  const { site, time, value, label, dayStart, series } = helpers(h);
  const at = h.context.at;
  const snap = await h.tool("get_plant_snapshot", { at });
  const hist = await h.tool("get_history", { metrics: "plant:cop", from: dayStart, to: at });
  let text = "";
  if (snap) {
    text = `At ${time(at)} system COP is ${value(snap, "plant:cop")}: ${value(snap, "plant:cooling_delivered_kw")} delivered for ${value(snap, "plant:power_kw")} of plant electrical power.`;
    const top = site.topology.devices
      .map((d) => ({ id: d.id, v: snap.values[`${d.id}:power_kw`]?.value ?? null }))
      .filter((x): x is { id: string; v: number } => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3);
    if (top.length) text += `\nLargest electrical loads: ${top.map((x) => `${label(x.id)} ${formatNumber(x.v, 1)} kW`).join(", ")}.`;
  } else text = "Current readings could not be retrieved.";
  await h.say(text);
  if (hist) h.view({ kind: "chart", title: "System COP today", unit: "", decimals: 2, series: series(hist as History, "plant:cop", "observed") });
  h.view({ kind: "link", label: "Plant power breakdown", target: { type: "monitoring_kpi", kpi: "plant:power_kw" } });
}

async function fallback(h: ScriptHost) {
  await h.say(
    `This scripted demonstration has no language model, so it only answers a few prepared questions. Try one of these:\n${SUGGESTED_PROMPTS.map((p) => `- ${p}`).join("\n")}`,
  );
}

export async function runScript(h: ScriptHost, prompt: string) {
  const intent = matchIntent(prompt, h.env.site);
  switch (intent.kind) {
    case "attention":
      return attention(h);
    case "equipment":
      return equipment(h, intent.id);
    case "shortfall":
      return shortfall(h);
    case "forecast":
      return forecast(h);
    case "efficiency":
      return efficiency(h);
    case "fallback":
      return fallback(h);
  }
}
