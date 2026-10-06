/**
 * SCRIPTED demo conversations. A prompt is matched to one of a few pre-written
 * investigations by keywords; the investigation calls the simulated tools and fills
 * its wording from their results. There is no language model and no reasoning: every
 * number comes from a tool result, missing data is reported as missing, and no
 * operational recommendation is generated.
 *
 * Answers take the shape their content needs, as a model's would: a sentence or two for
 * a simple reading, paragraphs for an explanation, a list only for several separate
 * items and a table only for several readings side by side.
 */
import type { AgentContext, DataView } from "../lib/contracts/agent";
import type { Device, ForecastResult, History, Issue, SiteBundle, Snapshot } from "../lib/contracts";
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
const STATE_WORD = { running: "running", stopped: "stopped", fault: "in fault", unavailable: "not reporting (no data)" };
const HOUR = 3_600_000;

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const count = (n: number) => COUNT[n] ?? String(n);
/** "A", "A and B", "A, B and C". */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i ? " --: " : " --- ")).join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

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

const SEVERITY_PHRASE = { critical: "critical", warning: "a warning", info: "for information" };
const STATUS_TAIL: Record<Issue["status"], string> = {
  detected: "",
  investigating: " and now under investigation",
  correction_proposed: "; a correction has been proposed",
  monitoring: " and now being monitored",
  resolved: " and since resolved",
};

/** One open issue as a sentence: severity, first seen, status, and the equipment it
 *  affects unless its title already names it. */
function issueLine(h: ScriptHost, i: Issue) {
  const { time, label } = helpers(h);
  const others = i.equipmentIds.map(label).filter((l) => !i.title.includes(l));
  return `${i.title} (${i.id}) is ${SEVERITY_PHRASE[i.severity]}, first seen at ${time(i.firstSeen)}${STATUS_TAIL[i.status]}.${others.length ? ` It affects ${list(others)}.` : ""}`;
}

async function attention(h: ScriptHost) {
  const { time, value } = helpers(h);
  const at = h.context.at;
  const issues = await h.tool("list_issues", { at });
  const snap = await h.tool("get_plant_snapshot", { at });
  const open = (issues?.issues ?? []).filter((i) => i.status !== "resolved").sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const critical = open.filter((i) => i.severity === "critical").length;
  let text: string;
  if (!issues) text = `The issue list could not be retrieved, so open issues at ${time(at)} cannot be reported.`;
  else if (open.length === 0) text = `Nothing needs attention at ${time(at)}: no issues are open.`;
  else if (open.length === 1) text = `One issue is open at ${time(at)}. ${issueLine(h, open[0])}`;
  else {
    // Several separate issues read best as a list.
    const severity = critical === 0 ? "" : critical === open.length ? ", all of them critical" : `, ${count(critical).toLowerCase()} of them critical`;
    text = `${count(open.length)} issues are open at ${time(at)}${severity}.\n\n${open.map((i) => `- ${issueLine(h, i)}`).join("\n")}`;
  }
  if (snap) {
    const unmet = snap.kpis["plant:unmet_kw"]?.value;
    const cop = `system COP at ${value(snap, "plant:cop")}`;
    text += open.length ? "\n\n" : " ";
    text += unmet
      ? `The plant is short of demand: it is delivering ${value(snap, "plant:cooling_delivered_kw")} of ${value(snap, "plant:cooling_demand_kw")}, leaving ${value(snap, "plant:unmet_kw")} unmet, with ${cop}.`
      : unmet === 0
        ? `The plant is delivering all ${value(snap, "plant:cooling_demand_kw")} of cooling demand, with ${cop}.`
        : `Cooling demand is ${value(snap, "plant:cooling_demand_kw")} and the plant is delivering ${value(snap, "plant:cooling_delivered_kw")}, with ${cop}; unmet demand is not available.`;
    if (snap.connection === "disconnected") text += ` Telemetry is disconnected, so these are the last values received, at ${time(snap.latestSampleAt!)}.`;
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

  // The state, then the issues that name it: one in a sentence, several as a list.
  let text = !status
    ? `The state of ${label(id)} could not be retrieved`
    : status.stale
      ? `${label(id)} was last reported ${STATE_WORD[status.state]}, but that report is stale at ${time(at)}`
      : `${label(id)} is ${STATE_WORD[status.state]} at ${time(at)}`;
  if (related.length === 1) text += `, and one open issue names it. ${issueLine(h, related[0])}`;
  else if (related.length) text += `, and ${count(related.length).toLowerCase()} open issues name it:\n\n${related.map((i) => `- ${issueLine(h, i)}`).join("\n")}`;
  else text += issues ? ". No open issue names it." : ".";

  // Several readings side by side read best as a table; one or two as a sentence.
  if (metrics.length) {
    const readings = metrics.map((m) => ({ label: m.label, value: value(snap, m.key) }));
    const available = readings.filter((r) => r.value !== "unavailable");
    if (!snap) text += "\n\nIts readings could not be retrieved.";
    else if (available.length >= 3) text += `\n\nIts current readings:\n\n${table(["Reading", "Value"], readings.map((r) => [r.label, r.value]))}`;
    else if (available.length) text += `\n\nIts ${list(readings.map((r) => `${r.label.toLowerCase()} is ${r.value}`))}.`;
    else text += `\n\nNone of its readings (${list(readings.map((r) => r.label.toLowerCase()))}) are available.`;
  }
  if (eq) {
    const parts = eq.links.map((l) => {
      const outgoing = "device" in l.from && l.from.device === id;
      const other = outgoing ? l.to : l.from;
      const otherLabel = "device" in other ? label(other.device) : site.topology.buses.find((b) => b.id === other.bus)?.label ?? other.bus;
      return `${outgoing ? "to" : "from"} ${otherLabel} (${l.evidence})`;
    });
    const uncertain = eq.links.filter((l) => l.evidence === "inferred" || l.evidence === "unknown").length;
    const missing = site.topology.unconnectedPorts.filter((u) => u.device === id);
    if (parts.length || missing.length) text += "\n\n";
    if (parts.length) text += `It connects ${list(parts)}.`;
    if (uncertain) text += ` ${count(uncertain)} of these ${uncertain > 1 ? "are" : "is"} not confirmed against the installation.`;
    if (missing.length) text += ` Not recorded: ${missing.map((u) => u.note).join("; ")}.`;
  }
  if (knowledge === null) text += "\n\nThe engineering documents could not be searched, because the knowledge base is not available in this demo build.";
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
  const { tz, time, value, dayStart, series } = helpers(h);
  const at = h.context.at;
  const snap = await h.tool("get_plant_snapshot", { at });
  const keys = ["plant:cooling_demand_kw", "plant:cooling_delivered_kw", "plant:unmet_kw", "plant:available_capacity_kw"];
  const hist = await h.tool("get_history", { metrics: keys.join(","), from: dayStart, to: at });
  const unmet = snap?.kpis["plant:unmet_kw"];
  const capacity = value(snap, "plant:available_capacity_kw");
  let text: string;
  if (!snap) text = "Current readings could not be retrieved, so whether demand is being met cannot be said.";
  else if (unmet?.value) {
    text = `The plant is not meeting cooling demand. At ${time(at)} it is delivering ${value(snap, "plant:cooling_delivered_kw")} against a demand of ${value(snap, "plant:cooling_demand_kw")}, so ${value(snap, "plant:unmet_kw")} of demand is not being met.`;
    text += ` Running chiller capacity is ${capacity}, the rated capacity of the chillers running now.`;
  } else if (unmet?.quality === "good") {
    text = `The plant is meeting cooling demand: at ${time(at)} it is delivering all ${value(snap, "plant:cooling_demand_kw")}, with ${capacity} of chiller capacity running.`;
  } else {
    text = `At ${time(at)} cooling demand is ${value(snap, "plant:cooling_demand_kw")} and the plant is delivering ${value(snap, "plant:cooling_delivered_kw")}, but unmet demand is not available, so a shortfall cannot be confirmed or ruled out.`;
  }
  // One shortfall is told; several are tabled.
  const periods = hist ? shortfallPeriods(hist as History) : null;
  const span = (p: { from: string; to: string; ongoing: boolean }) => (p.ongoing ? `${time(p.from)} to now` : `${formatTime(p.from, tz)} to ${time(p.to)}`);
  if (!periods) text += " Today's history could not be retrieved, so earlier shortfalls cannot be listed.";
  else if (periods.length === 0) text += " There has been no shortfall today.";
  else if (periods.length === 1 && periods[0].ongoing) {
    text += `\n\nThe shortfall began at ${time(periods[0].from)} and is still going on, peaking at ${formatNumber(periods[0].peak, 0)} kWt unmet so far.`;
  } else if (periods.length === 1) {
    text += ` Earlier today there was one shortfall, from ${span(periods[0])}, peaking at ${formatNumber(periods[0].peak, 0)} kWt unmet.`;
  } else {
    text += `\n\nThere have been ${count(periods.length).toLowerCase()} shortfall periods today:\n\n`;
    text += table(["Period", "Peak unmet"], periods.map((p) => [span(p), `${formatNumber(p.peak, 0)} kWt`]));
  }
  await h.say(text);
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
    const hours = f.horizonMinutes / 60;
    text = f.summary
      ? `Cooling demand is forecast to peak at ${formatNumber(f.summary.peakKw, 0)} kWt around ${time(f.summary.peakAt)}, within the next ${hours} hours.`
      : `A forecast for the next ${hours} hours is available, but it does not report a peak.`;
    text += ` That comes from the demonstration baseline, using data through ${time(f.latestInputAt ?? f.asOf)}.`;
    text += "\n\nIt is a rough guide only: a seasonal-profile baseline on synthetic data, not a trained model, and its shaded spread is uncalibrated, so no accuracy is claimed.";
    if (f.quality.freshness === "stale") text += " Its inputs are stale.";
    if (snap) {
      text += ` For comparison, ${value(snap, "plant:available_capacity_kw")} of chiller capacity is running at ${time(at)}; future chiller staging is not forecast, so this is not an overload prediction.`;
    }
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
  // A simple question gets a short answer: the figure, what it is made of, the largest loads.
  let text = "";
  if (snap) {
    text = `System COP is ${value(snap, "plant:cop")} at ${time(at)}: the plant is delivering ${value(snap, "plant:cooling_delivered_kw")} of cooling for ${value(snap, "plant:power_kw")} of electrical power.`;
    const top = site.topology.devices
      .map((d) => ({ id: d.id, v: snap.values[`${d.id}:power_kw`]?.value ?? null }))
      .filter((x): x is { id: string; v: number } => x.v !== null && x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => ({ name: label(x.id), kw: `${formatNumber(x.v, 1)} kW` }));
    if (top.length) {
      // Equal loads share first place.
      const lead = top.filter((x) => x.kw === top[0].kw);
      const rest = top.slice(lead.length).map((x) => `${x.name} (${x.kw})`);
      text += lead.length > 1 ? ` ${list(lead.map((x) => x.name))} are the largest loads, at ${top[0].kw} each` : ` The largest load is ${top[0].name} at ${top[0].kw}`;
      text += rest.length ? `, followed by ${list(rest)}.` : ".";
    }
  } else text = "Current readings could not be retrieved.";
  await h.say(text);
  if (hist) h.view({ kind: "chart", title: "System COP today", unit: "", decimals: 2, series: series(hist as History, "plant:cop", "observed") });
  h.view({ kind: "link", label: "Plant power breakdown", target: { type: "monitoring_kpi", kpi: "plant:power_kw" } });
}

async function fallback(h: ScriptHost) {
  await h.say(
    `This scripted demonstration has no language model, so it can only answer a few prepared questions. Try one of these:\n\n${SUGGESTED_PROMPTS.map((p) => `- ${p}`).join("\n")}`,
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
