/**
 * The demo assistant's responders. With no language model connected, a request is read
 * into a typed intent by the offline understanding in `lib/agent/understand.ts`; the
 * responder for that intent calls the simulated, read-only tools and words its answer
 * from their results. Every number comes from a tool result or an attached file, missing
 * data is reported as missing, and no operational recommendation is generated.
 *
 * Whether the main display changes is the answering capability's decision, from what was
 * understood, not from the words used (`present`): a course over a period, a forecast,
 * equipment, a run, a comparison or an issue has a detailed view, which opens beside the
 * answer; a single value is answered here, with a link. A view already on screen is not
 * opened again. The chat is not the chart surface: charts open in the main display.
 * Requests to change something are declined, and the operator's control is pointed to in
 * AI Pilot (a typed `reveal`); the assistant never presses it (F10).
 *
 * Answers take the shape their content needs: a sentence or two for a simple reading,
 * paragraphs for an explanation, a list only for several separate items and a table only
 * for several readings side by side.
 */
import type { AgentContext, AgentMessage, DataView, NavTarget } from "../lib/contracts/agent";
import type { Device, ForecastResult, History, Issue, SiteBundle, Snapshot } from "../lib/contracts";
import { isFinal, matchedRuns, type PilotIssue, type RunStatus } from "../lib/contracts/simulation";
import { formatNumber, formatTime, siteDayStart } from "../lib/format";
import { shortfallPeriods } from "../lib/plant";
import { focusAfter, understand, type ControlTarget, type Focus, type SimulationControl, type TimeRange, type Vocabulary } from "../lib/agent/understand";
import { describeAttachment } from "../lib/agent/attachments";
import { TREND_KEYS } from "../features/monitoring/kpiDefinitions";
import type { ToolEnv, ToolName, tools } from "./agentTools";

type ToolValue<K extends ToolName> = Awaited<ReturnType<(typeof tools)[K]>>["value"];

export interface ScriptHost {
  env: ToolEnv;
  context: AgentContext;
  message: AgentMessage;
  /** The conversation's earlier questions, oldest first: what follow-ups lean on. */
  previous: string[];
  /** Runs a simulated tool; returns null (after reporting the error) when it fails. */
  tool<K extends ToolName>(name: K, args: Record<string, string | number>): Promise<ToolValue<K> | null>;
  say(text: string): Promise<void>;
  view(view: DataView): void;
  /** Ask the workspace to open a typed view. Read-only: a target only addresses a screen. */
  open(target: NavTarget, label: string): void;
  /** Point to an operator control in AI Pilot. It is shown, never pressed (F10). */
  reveal(control: RevealControl, label: string, ids?: { runId?: string; issueId?: string }): void;
}

export type RevealControl = SimulationControl | "apply" | "corrections";

/**
 * The one rule for the main display: open the detailed view when it materially helps the
 * answer (`useful`), otherwise offer it as a link. Either way the view is one press away.
 */
function present(h: ScriptHost, target: NavTarget, label: string, useful: boolean) {
  if (useful) h.open(target, label);
  else h.view({ kind: "link", label, target });
}

export const SUGGESTED_PROMPTS = [
  "What needs attention right now?",
  "Is the plant meeting cooling demand?",
  "Show me COP today",
  "How efficient is the plant right now?",
  "What cooling demand is forecast for the next 6 hours?",
  "How did the last simulation go?",
  "Investigate Cooling tower 4",
];

export const equipmentPrompt = (label: string) => `Investigate ${label}`;

/** What the offline understanding can name: this site's equipment and drawable indicators. */
export const vocabularyOf = (site: SiteBundle): Vocabulary => ({
  devices: site.topology.devices.map((d) => ({ id: d.id, label: d.label })),
  metrics: site.metrics.filter((m) => TREND_KEYS.includes(m.key)).map((m) => ({ key: m.key, label: m.label })),
});

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const STATE_WORD = { running: "running", stopped: "stopped", fault: "in fault", unavailable: "not reporting (no data)" };

const COUNT = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const count = (n: number) => COUNT[n] ?? String(n);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "A", "A and B", "A, B and C". */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const table = (head: string[], rows: string[][]) =>
  [`| ${head.join(" | ")} |`, `|${head.map((_, i) => (i ? " --: " : " --- ")).join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const fixed = (v: number | null, d: number) => (v === null ? "unavailable" : formatNumber(v, d));

const rangeWords = (r: TimeRange) =>
  r.kind === "last_hours" ? (r.hours === 1 ? "the last hour" : `the last ${r.hours} hours`) : r.kind === "next_hours" ? `the next ${r.hours} hours` : r.kind === "beyond" ? r.said : "today";
const oneDay = (said: string) =>
  `The demo data holds one synthetic day, so there is nothing for ${said}: no readings or issues before today's midnight, and none after now.`;

function helpers(h: ScriptHost) {
  const { site } = h.env;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const time = (iso: string) => `${formatTime(iso, tz)} ${tzLabel}`;
  const info = (key: string) => site.metrics.find((m) => m.key === key);
  const reading = (snap: Snapshot | null, key: string) => snap?.kpis[key] ?? snap?.values[key];
  const withUnit = (v: number, key: string) => {
    const m = info(key);
    return `${formatNumber(v, m?.decimals ?? 1)}${m?.unit ? ` ${m.unit}` : ""}`;
  };
  const value = (snap: Snapshot | null, key: string) => {
    const r = reading(snap, key);
    if (!r || r.value === null) return "unavailable";
    return r.quality === "stale" ? `${withUnit(r.value, key)} (stale)` : withUnit(r.value, key);
  };
  const label = (id: string) => site.topology.devices.find((d) => d.id === id)?.label ?? id;
  const dayStart = new Date(siteDayStart(Date.parse(h.context.at), tz)).toISOString();
  return { site, tz, time, info, value, withUnit, label, dayStart };
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

// Plant (telemetry) ------------------------------------------------------------

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

/** Issues detected over a period (today, or the last hours) up to the conversation's time,
 *  resolved ones included. */
async function faultHistory(h: ScriptHost, range: TimeRange | null) {
  const { time, tz } = helpers(h);
  const at = h.context.at;
  if (range?.kind === "beyond" || range?.kind === "next_hours") return h.say(oneDay(rangeWords(range)));
  const issues = await h.tool("list_issues", { at });
  const from = range?.kind === "last_hours" ? Date.parse(at) - range.hours * 3_600_000 : -Infinity;
  const period = range?.kind === "last_hours" ? `in ${rangeWords(range)} (since ${time(new Date(from).toISOString())})` : `up to ${time(at)}`;
  let text: string;
  const all = (issues?.issues ?? []).filter((i) => Date.parse(i.lastSeen) >= from).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
  if (!issues) text = `The issue list could not be retrieved, so earlier issues cannot be reported.`;
  else if (!all.length) text = `No issues were detected ${period}.`;
  else {
    const resolved = all.filter((i) => i.status === "resolved").length;
    text = `${count(all.length)} ${all.length === 1 ? "issue was" : "issues were"} detected or still present ${period}${resolved ? `, ${resolved} of them since resolved` : ""}.\n\n`;
    text += all.map((i) => `- ${formatTime(i.firstSeen, tz)}: ${i.title} (${i.id}), ${i.status === "resolved" ? "resolved" : `${SEVERITY_PHRASE[i.severity]}, still open`}.`).join("\n");
  }
  await h.say(text);
  h.view({ kind: "link", label: "Open issues details", target: { type: "monitoring_kpi", kpi: "issues" } });
}

async function equipmentInvestigation(h: ScriptHost, id: string) {
  const { site, time, value, label } = helpers(h);
  const at = h.context.at;
  const eq = await h.tool("get_equipment", { id });
  const snap = await h.tool("get_plant_snapshot", { at });
  const issues = await h.tool("list_issues", { at });
  const metrics = site.metrics.filter((m) => m.key.startsWith(`${id}:`));
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
  if (related.length) {
    h.view({ kind: "issues", title: "Related issues", issues: related.map((i) => ({ id: i.id, title: i.title, severity: i.severity, status: i.status, equipmentIds: i.equipmentIds })) });
  }
  // Its record holds its readings, trend and issues; asked from its own Details, it is on screen already.
  present(h, { type: "equipment_page", id }, `${label(id)} record`, h.context.equipmentId !== id);
}

/** Equipment over a period: its first reading's course today and the issues that named it. */
async function equipmentHistory(h: ScriptHost, id: string, range: TimeRange) {
  const { site, time, label, dayStart, withUnit } = helpers(h);
  if (range.kind === "beyond" || range.kind === "next_hours") return h.say(oneDay(rangeWords(range)));
  const at = h.context.at;
  const eq = await h.tool("get_equipment", { id });
  const metrics = site.metrics.filter((m) => m.key.startsWith(`${id}:`));
  const from = range.kind === "last_hours" ? new Date(Math.max(Date.parse(dayStart), Date.parse(at) - range.hours * 3_600_000)).toISOString() : dayStart;
  const hist = metrics.length ? await h.tool("get_history", { metrics: metrics[0].key, from, to: at }) : null;
  const issues = await h.tool("list_issues", { at });
  if (!eq) return h.say(`${label(id)} could not be read, so its history is not available.`);
  const period = range.kind === "last_hours" ? rangeWords(range) : "today";
  let text = `${eq.device.label} ${period}:`;
  const values = (hist?.series[0]?.values ?? []).filter((v): v is number => v !== null);
  if (metrics.length && values.length) {
    text += ` its ${metrics[0].label.toLowerCase()} ranged from ${withUnit(Math.min(...values), metrics[0].key)} to ${withUnit(Math.max(...values), metrics[0].key)}, ${withUnit(values.at(-1)!, metrics[0].key)} at ${time(at)}.`;
  } else text += metrics.length ? ` no ${metrics[0].label.toLowerCase()} readings were recorded.` : " it reports no readings of its own.";
  const named = (issues?.issues ?? []).filter((i) => i.equipmentIds.includes(id) && Date.parse(i.lastSeen) >= Date.parse(from));
  text += named.length
    ? ` ${count(named.length)} ${named.length === 1 ? "issue names" : "issues name"} it: ${list(named.map((i) => `${i.title} (${i.id}, ${i.status === "resolved" ? "resolved" : "open"})`))}.`
    : issues
      ? " No issue named it in that time."
      : "";
  await h.say(text);
  present(h, { type: "equipment_page", id }, `${eq.device.label} record`, h.context.equipmentId !== id);
}

/** "Open Chiller 2": its record in the main display, with a one-line state here. */
async function equipmentOpen(h: ScriptHost, id: string) {
  const { time, label } = helpers(h);
  const eq = await h.tool("get_equipment", { id });
  const snap = await h.tool("get_plant_snapshot", { at: h.context.at });
  if (!eq) return h.say(`${label(id)} could not be read, so its record was not opened.`);
  const status = snap?.equipment[id];
  await h.say(
    status
      ? `${eq.device.label} is ${STATE_WORD[status.state]}${status.stale ? " (stale report)" : ""} at ${time(h.context.at)}. Its record shows its readings, connections and nameplate data.`
      : `${eq.device.label}'s state could not be retrieved; its record shows its connections and nameplate data.`,
  );
  present(h, { type: "equipment_page", id }, `${eq.device.label} record`, true);
}

async function shortfall(h: ScriptHost) {
  const { tz, time, value, dayStart } = helpers(h);
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
  present(h, { type: "metric", key: "plant:unmet_kw" }, "Unmet demand today", Boolean(unmet?.value) || Boolean(periods?.length));
  h.view({ kind: "link", label: "Cooling delivered details", target: { type: "monitoring_kpi", kpi: "plant:cooling_delivered_kw" } });
}

async function forecast(h: ScriptHost) {
  const { time, value } = helpers(h);
  const at = h.context.at;
  const f = (await h.tool("get_forecast", { at, horizon_minutes: 360, step_minutes: 15 })) as ForecastResult | null;
  const snap = await h.tool("get_plant_snapshot", { at });
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
  const available = Boolean(f && f.status !== "unavailable");
  present(h, { type: "prediction", forecastId: f && f.status !== "unavailable" ? f.forecastId : undefined }, "Cooling prediction", available);
}

async function efficiency(h: ScriptHost) {
  const { site, time, value, label } = helpers(h);
  const at = h.context.at;
  const snap = await h.tool("get_plant_snapshot", { at });
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
  h.view({ kind: "link", label: "COP today", target: { type: "metric", key: "plant:cop" } });
  h.view({ kind: "link", label: "Plant power breakdown", target: { type: "monitoring_kpi", kpi: "plant:power_kw" } });
}

/** One indicator over a period (today, or the last hours): its trend opens in the main
 *  display, and the answer sums it up. A period the data does not hold is said so. */
async function metricTrend(h: ScriptHost, key: string, range: TimeRange) {
  const { time, info, value, withUnit, dayStart } = helpers(h);
  const at = h.context.at;
  const name = info(key)?.label ?? key;
  if (range.kind === "beyond") return h.say(oneDay(range.said));
  if (range.kind === "next_hours") {
    if (key === "plant:cooling_demand_kw") return forecast(h);
    return h.say(`Only cooling demand is forecast. ${name} has no forecast; its readings run to ${time(at)}.`);
  }
  const hours = range.kind === "last_hours" ? range.hours : undefined;
  const start = hours ? Math.max(Date.parse(dayStart), Date.parse(at) - hours * 3_600_000) : Date.parse(dayStart);
  const snap = await h.tool("get_plant_snapshot", { at });
  const hist = await h.tool("get_history", { metrics: key, from: new Date(start).toISOString(), to: at });
  const values = (hist?.series.find((s) => s.metric === key)?.values ?? []).filter((v): v is number => v !== null);
  const period = hours ? rangeWords(range) : "today";
  let text = snap ? `${name} is ${value(snap, key)} at ${time(at)}.` : `The current ${name.toLowerCase()} could not be retrieved.`;
  if (!hist) text += ` Its history for ${period} could not be retrieved.`;
  else if (!values.length) text += ` No values were recorded ${hours ? `in ${period}` : "today"}.`;
  else {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const since = hours ? `Over ${period}${start > Date.parse(at) - hours * 3_600_000 ? ` (the data starts at midnight)` : ""}` : "Since the start of the day";
    text += ` ${since} it has ranged from ${withUnit(Math.min(...values), key)} to ${withUnit(Math.max(...values), key)}, averaging ${withUnit(avg, key)}.`;
  }
  await h.say(text);
  present(h, { type: "metric", key, ...(hours ? { hours } : {}) }, hours ? `${name}, ${period}` : `${name} today`, true);
}

/** A current value, answered here; the trend is a link, not opened. */
async function metricValue(h: ScriptHost, key: string) {
  const { time, info, value } = helpers(h);
  const name = info(key)?.label ?? key;
  const snap = await h.tool("get_plant_snapshot", { at: h.context.at });
  await h.say(snap ? `${name} is ${value(snap, key)} at ${time(h.context.at)}.` : `The current ${name.toLowerCase()} could not be retrieved.`);
  h.view({ kind: "link", label: `${name} today`, target: { type: "metric", key } });
}

// Simulation and pilot (read only) ----------------------------------------------

const RUN_STATE = { created: "created and not started", running: "running", paused: "paused", stopped: "stopped", failed: "failed" } as const;
const STAGE_WORD: Record<PilotIssue["stage"], string> = {
  detection: "detected",
  investigation: "under investigation",
  proposal: "a correction proposed",
  application: "a correction applied, outcome pending",
  outcome: "outcome measured",
  resolution: "resolved",
};
const pilotLink: DataView = { kind: "link", label: "Open AI Pilot", target: { type: "pilot" } };

function runLine(h: ScriptHost, r: RunStatus) {
  const { time } = helpers(h);
  const planned = Math.round(r.config.durationHours * 60);
  const where = r.simulatedTime ? `, simulated time ${time(r.simulatedTime)}` : "";
  const cop = r.stats.avgCop === null ? "" : `, average COP ${fixed(r.stats.avgCop, 2)}`;
  return `${r.runId}, ${r.scenario.label}: ${RUN_STATE[r.state]}${where}, ${r.stats.simulatedMinutes} of ${planned} simulated minutes${cop}.`;
}

async function runs(h: ScriptHost) {
  const all = await h.tool("list_simulation_runs", {});
  if (!all) await h.say("The simulation service could not be reached, so its runs cannot be listed.");
  return all;
}

async function simulationHistory(h: ScriptHost) {
  const all = await runs(h);
  if (!all) return;
  if (!all.length) {
    await h.say("No simulation has been run yet. Simulations are started, watched and stopped by the operator in AI Pilot.");
    return h.view(pilotLink);
  }
  const live = all.filter((r) => !isFinal(r.state));
  let text = `${count(all.length)} simulation ${all.length === 1 ? "run is" : "runs are"} recorded`;
  text += live.length ? `; ${list(live.map((r) => r.runId))} ${live.length === 1 ? "is" : "are"} still active.` : ", all ended.";
  const shown = all.slice(0, 5);
  text += `\n\n${shown.map((r) => `- ${runLine(h, r)}`).join("\n")}`;
  if (all.length > shown.length) text += `\n\n${all.length - shown.length} older ${all.length - shown.length === 1 ? "run is" : "runs are"} in the history.`;
  await h.say(text);
  h.open({ type: "simulation" }, "Simulation history");
}

async function runSummary(h: ScriptHost, requested: string | null) {
  const all = await runs(h);
  if (!all) return;
  const run = requested ? all.find((r) => r.runId === requested) : all.find((r) => isFinal(r.state));
  if (!run) {
    await h.say(
      requested
        ? `There is no ${requested} in the simulation history${all.length ? `; the latest run is ${all[0].runId}` : ""}.`
        : all.length
          ? `No simulation has ended yet. ${runLine(h, all[0])}`
          : "No simulation has been run yet.",
    );
    return h.view(all.length ? { kind: "link", label: "Simulation history", target: { type: "simulation" } } : pilotLink);
  }
  if (!isFinal(run.state)) {
    const pilot = await h.tool("get_pilot_findings", { run_id: run.runId });
    let text = `${runLine(h, run)} Its summary is written when it ends.`;
    if (pilot) text += ` So far the pilot has found ${plural(pilot.issues.length, "issue")}, ${pilot.issues.filter((i) => i.open).length} open.`;
    await h.say(text);
    return h.open({ type: "pilot", runId: run.runId, view: "live" }, `${run.runId} in AI Pilot`);
  }
  const s = await h.tool("get_run_summary", { run_id: run.runId });
  if (!s) {
    await h.say(`${runLine(h, run)} Its summary could not be retrieved.`);
    return h.open({ type: "simulation", runId: run.runId }, `${run.runId} replay`);
  }
  const ended = { completed: "completed", stopped: "was stopped by the operator", failed: "failed" }[s.identity.endReason];
  const p = s.performance;
  let text = `${s.runId} (${s.identity.scenario.label}) ${ended} after ${s.identity.simulatedMinutes} of ${s.identity.plannedMinutes} simulated minutes.`;
  text += ` Average COP ${fixed(p.avgCop, 2)}, ${formatNumber(p.energyKwh, 0)} kWh of electrical energy`;
  text += p.unmetKwh > 0 ? `, and ${formatNumber(p.unmetKwh, 0)} kWh of cooling demand went unmet.` : "; cooling demand was met throughout.";
  if (s.identity.lastError) text += ` It failed: ${s.identity.lastError}`;
  if (!s.pilot.monitored) text += "\n\nThe pilot did not monitor this run.";
  else {
    text += `\n\nThe pilot found ${plural(s.pilot.issues, "issue")}${s.pilot.issues ? `, ${s.pilot.resolved} resolved` : ""}`;
    text += s.pilot.unresolved.length ? `; still open: ${list(s.pilot.unresolved.map((u) => `${u.issueId} (${u.title})`))}.` : ".";
  }
  if (s.corrections.operator + s.corrections.pilot) {
    text += ` ${plural(s.corrections.applied, "correction was", "corrections were")} applied, ${s.corrections.reached} reaching ${s.corrections.reached === 1 ? "its" : "their"} setpoint.`;
  }
  await h.say(text);
  h.open({ type: "simulation", runId: s.runId }, `${s.runId} summary and replay`);
}

async function currentSimulation(h: ScriptHost) {
  const all = await runs(h);
  if (!all) return;
  const live = all.find((r) => !isFinal(r.state));
  if (!live) {
    await h.say(`No simulation is running.${all.length ? ` The latest: ${runLine(h, all[0])}` : ""} Simulations are started by the operator in AI Pilot.`);
    return h.view(pilotLink);
  }
  const pilot = await h.tool("get_pilot_findings", { run_id: live.runId });
  let text = runLine(h, live);
  if (pilot) {
    const open = pilot.issues.filter((i) => i.open).length;
    text += pilot.monitoring
      ? ` The pilot is monitoring it and has found ${plural(pilot.issues.length, "issue")}, ${open} open.`
      : ` The pilot is not monitoring it${pilot.issues.length ? `; it found ${plural(pilot.issues.length, "issue")} earlier, ${open} open` : ""}.`;
  }
  await h.say(text);
  h.open({ type: "pilot", runId: live.runId, view: "live" }, `${live.runId} in AI Pilot`);
}

async function pilotFindings(h: ScriptHost, requested: string | null) {
  const all = await runs(h);
  if (!all) return;
  const run = requested ? all.find((r) => r.runId === requested) : (all.find((r) => !isFinal(r.state)) ?? all[0]);
  if (!run) {
    await h.say(requested ? `There is no ${requested} in the simulation history.` : "No simulation has been run, so the pilot has nothing to report. The pilot monitors runs started in AI Pilot.");
    return h.view(pilotLink);
  }
  const pilot = await h.tool("get_pilot_findings", { run_id: run.runId });
  if (!pilot) return h.say(`The pilot's findings on ${run.runId} could not be retrieved.`);
  const { time } = helpers(h);
  let text: string;
  if (!pilot.issues.length) {
    text = pilot.scans
      ? `The pilot found no issues on ${run.runId} (${run.scenario.label}) in ${plural(pilot.scans, "scan")}.`
      : `The pilot has not scanned ${run.runId} (${run.scenario.label}), so it has no findings.`;
  } else {
    const open = pilot.issues.filter((i) => i.open).length;
    text = `On ${run.runId} (${run.scenario.label}, ${RUN_STATE[run.state]}) the pilot found ${plural(pilot.issues.length, "issue")}, ${open} open:\n\n`;
    text += pilot.issues.map((i) => `- ${i.id}, ${i.title}: ${SEVERITY_PHRASE[i.severity]}, first seen at ${time(i.firstSeen)}, ${STAGE_WORD[i.stage]}.`).join("\n");
  }
  await h.say(text);
  if (!isFinal(run.state)) return h.open({ type: "pilot", runId: run.runId, view: "findings" }, `${run.runId} findings in AI Pilot`);
  const first = pilot.issues[0];
  h.open({ type: "simulation", runId: run.runId, ...(first ? { issueId: first.id } : {}) }, `${run.runId} findings in its replay`);
}

async function pilotIssue(h: ScriptHost, issueId: string) {
  const runId = `RUN-${issueId.split("-")[1]}`;
  const all = await runs(h);
  if (!all) return;
  const run = all.find((r) => r.runId === runId);
  if (!run) {
    await h.say(`There is no ${runId}, so there is no issue ${issueId}.`);
    return h.view({ kind: "link", label: "Simulation history", target: { type: "simulation" } });
  }
  const pilot = await h.tool("get_pilot_findings", { run_id: runId });
  if (!pilot) return h.say(`The pilot's findings on ${runId} could not be retrieved.`);
  const i = pilot.issues.find((x) => x.id === issueId);
  if (!i) {
    await h.say(`${runId} has no issue ${issueId}${pilot.issues.length ? `; its issues are ${list(pilot.issues.map((x) => x.id))}` : ""}.`);
    return h.view({ kind: "link", label: `${runId} findings`, target: isFinal(run.state) ? { type: "simulation", runId } : { type: "pilot", runId, view: "findings" } });
  }
  const { time } = helpers(h);
  let text = `${i.id}, ${i.title}, is ${SEVERITY_PHRASE[i.severity]} on ${runId}, first seen at ${time(i.firstSeen)} simulated time, with ${STAGE_WORD[i.stage]}.`;
  if (i.reasoning.summary) text += ` ${i.reasoning.summary}`;
  if (i.proposal) text += ` The pilot proposes ${i.proposal.label.toLowerCase()} ${i.proposal.value} ${i.proposal.unit}; only the operator can apply it, in AI Pilot, on the simulated run.`;
  else if (i.advisory) text += ` ${i.advisory}`;
  if (i.resolution) text += ` Resolved: ${i.resolution.summary}`;
  await h.say(text);
  // A live run's finding is decided in AI Pilot; an ended run's is read in its replay.
  if (isFinal(run.state)) h.open({ type: "simulation", runId, issueId }, `${issueId} in the ${runId} replay`);
  else h.open({ type: "pilot", runId, issueId }, `${issueId} in AI Pilot`);
}

async function compareRuns(h: ScriptHost, ids: string[]) {
  const all = await runs(h);
  if (!all) return;
  const missing = ids.filter((id) => !all.some((r) => r.runId === id));
  if (missing.length) {
    await h.say(`There is no ${list(missing)} in the simulation history.`);
    return h.view({ kind: "link", label: "Simulation history", target: { type: "simulation" } });
  }
  const withResults = all.filter((r) => r.stepsTaken > 0);
  const byId = (id: string) => all.find((r) => r.runId === id)!;
  let a: RunStatus | undefined;
  let b: RunStatus | undefined;
  if (ids.length === 2) [a, b] = [byId(ids[0]), byId(ids[1])];
  else if (ids.length === 1) {
    a = byId(ids[0]);
    b = withResults.find((r) => matchedRuns(a!, r));
  } else [a, b] = withResults;
  if (!a || !b) {
    await h.say(
      a ? `${a.runId} has no matched run to compare with: no other run used the same scenario, start, duration, timestep and configuration.` : "There are not yet two simulation runs with results to compare.",
    );
    return h.view({ kind: "link", label: "Simulation history", target: { type: "simulation" } });
  }
  if (!matchedRuns(a, b)) {
    const why = [
      a.scenario.id !== b.scenario.id && `scenario (${a.scenario.label}, ${b.scenario.label})`,
      a.config.startMinute !== b.config.startMinute && "start time",
      a.config.durationHours !== b.config.durationHours && "duration",
      a.config.stepMinutes !== b.config.stepMinutes && "timestep",
      a.configRevision !== b.configRevision && "configuration revision",
      b.stepsTaken === 0 && `results (${b.runId} has none)`,
    ].filter((x): x is string => Boolean(x));
    const partner = withResults.find((r) => matchedRuns(a!, r));
    await h.say(
      `${a.runId} and ${b.runId} are not matched: they differ in ${list(why)}, so their results are not compared.${partner ? ` ${a.runId}'s latest matched run is ${partner.runId}.` : ""}`,
    );
    return h.view(
      partner
        ? { kind: "link", label: `Compare ${a.runId} with ${partner.runId}`, target: { type: "simulation", runId: a.runId, compareWith: partner.runId } }
        : { kind: "link", label: "Simulation history", target: { type: "simulation" } },
    );
  }
  const row = (name: string, f: (r: RunStatus) => string) => [name, f(a!), f(b!)];
  let text = `${a.runId} and ${b.runId} are matched runs of ${a.scenario.label}.\n\n`;
  text += table(
    ["", a.runId, b.runId],
    [
      row("Simulated minutes", (r) => String(r.stats.simulatedMinutes)),
      row("Average COP", (r) => fixed(r.stats.avgCop, 2)),
      row("Electrical energy", (r) => `${formatNumber(r.stats.energyKwh, 0)} kWh`),
      row("Unmet demand", (r) => `${formatNumber(r.stats.unmetKwh, 0)} kWh`),
    ],
  );
  if (a.stats.simulatedMinutes !== b.stats.simulatedMinutes) {
    text += `\n\nThey cover different lengths of simulated time, so their energy totals are not directly comparable.`;
  } else if (b.stats.energyKwh > 0) {
    const d = a.stats.energyKwh - b.stats.energyKwh;
    text += `\n\n${a.runId} used ${formatNumber(Math.abs(d), 0)} kWh (${formatNumber((Math.abs(d) / b.stats.energyKwh) * 100, 1)} %) ${d <= 0 ? "less" : "more"} electrical energy than ${b.runId} over the same simulated time.`;
  }
  await h.say(text);
  h.open({ type: "simulation", runId: a.runId, compareWith: b.runId }, `${a.runId} compared with ${b.runId}`);
}

// Boundaries and conversation ---------------------------------------------------

/**
 * F10: the assistant reads; it never acts on a simulation, a proposal or equipment. Asked
 * to, it says so and points to the operator's own control in AI Pilot (a typed `reveal`:
 * the control is outlined and named there, never pressed or focused).
 */
async function control(h: ScriptHost, target: ControlTarget, asked: SimulationControl | null, runId: string | null, issueId: string | null) {
  if (target === "equipment") {
    return h.say("I can't operate equipment, and nothing in this dashboard can: there is no control of physical equipment here. Simulation runs are operated in AI Pilot.");
  }
  if (target === "setpoint" || target === "override") {
    const all = await h.tool("list_simulation_runs", {});
    const live = all?.find((r) => !isFinal(r.state));
    const what = target === "setpoint" ? "change setpoints" : "set or release overrides";
    if (!live) return h.say(`I can't ${what}. Corrections are the operator's, in AI Pilot, on a simulated run only, and no simulation is running now. Nothing in this dashboard actuates physical equipment.`);
    await h.say(`I can't ${what}. Corrections are yours, in AI Pilot's Corrections view, on ${live.runId} (simulation only); they pass the run's gate. Nothing in this dashboard actuates physical equipment.`);
    return h.reveal("corrections", `Corrections for ${live.runId}`, { runId: live.runId });
  }
  if (target === "proposal") {
    const all = await h.tool("list_simulation_runs", {});
    const live = all?.find((r) => !isFinal(r.state));
    const run = issueId ? `RUN-${issueId.split("-")[1]}` : live?.runId;
    const pilot = run ? await h.tool("get_pilot_findings", { run_id: run }) : null;
    const issue = pilot?.issues.find((i) => (issueId ? i.id === issueId : i.open && i.proposal && !i.declinedAt && i.stage === "proposal"));
    if (!issue?.proposal || issue.declinedAt || !issue.open) {
      return h.say(`I can't apply pilot proposals; only the operator can, in AI Pilot. ${issueId ? `${issueId} has no proposal waiting for a decision.` : "No proposal is waiting for a decision now."}`);
    }
    await h.say(`I can't apply ${issue.id}'s proposal (${issue.proposal.label.toLowerCase()} ${issue.proposal.value} ${issue.proposal.unit} on ${issue.runId}). Only you can, with Apply or Decline in AI Pilot, on the simulated run.`);
    return h.reveal("apply", `${issue.id}: Apply or Decline`, { runId: issue.runId, issueId: issue.id });
  }
  // The simulation's own controls.
  const all = await h.tool("list_simulation_runs", {});
  const live = runId ? all?.find((r) => r.runId === runId && !isFinal(r.state)) : all?.find((r) => !isFinal(r.state));
  const verb: Record<SimulationControl, string> = { start: "start", pause: "pause", resume: "resume", step: "step", stop: "stop", monitoring: "switch the pilot's monitoring for" };
  const named = asked ?? "start";
  if (named === "start") {
    await h.say(`I can't start simulations; only you can. AI Pilot's set-up is ready: choose the scenario and press Start simulation or Start paused.`);
    return h.reveal("start", "Start simulation");
  }
  if (!live) {
    return h.say(`I can't ${verb[named]} simulations, and ${runId ? `${runId} is not running` : "no simulation is running now"}. Simulations are started and operated by you in AI Pilot.`);
  }
  // Pointing to a control that does not apply now (Pause on a paused run) would mislead.
  const ok: Record<SimulationControl, boolean> = {
    start: false,
    stop: true,
    pause: live.state === "running",
    resume: live.state === "paused",
    step: live.state === "paused",
    monitoring: true,
  };
  if (!ok[named]) {
    return h.say(`I can't ${verb[named]} ${live.runId}, and it is ${live.state}, so that control is not offered now. Only you operate it, in AI Pilot.`);
  }
  const controlLabel: Record<SimulationControl, string> = { start: "Start simulation", stop: "Stop simulation", pause: "Pause", resume: "Resume", step: "Step", monitoring: "Pause or resume monitoring" };
  await h.say(`I can't ${verb[named]} ${live.runId}; only you can, in AI Pilot. ${controlLabel[named]} is outlined there for you.`);
  h.reveal(named, `${controlLabel[named]} for ${live.runId}`, { runId: live.runId });
}

async function attachments(h: ScriptHost) {
  const files = h.message.attachments;
  if (!files.length) return h.say("No file is attached to this question. Attach a text file (.txt, .md, .csv, .tsv, .json or .log) and ask again.");
  const vocab = vocabularyOf(h.env.site);
  const intro = files.length === 1 ? "I read the attached file." : `I read the ${count(files.length).toLowerCase()} attached files.`;
  const body = files.map((f) => describeAttachment(f, vocab)).join("\n\n");
  await h.say(`${intro}\n\n${body}\n\nWith no language model connected, I can describe what a file contains, as above, but not answer free-form questions about it.`);
}

const EXAMPLES = ["Show me COP today", "Open Chiller 2", "How did the last simulation go?", "What did the pilot find?", "Compare the latest two simulations"];

async function help(h: ScriptHost) {
  await h.say(
    `This assistant has no language model connected: offline rules in this browser read each request. They understand questions about plant indicators, equipment, issues and the cooling forecast; simulation runs, their summaries and comparisons; the AI pilot's findings; and attached text files. Views you ask to see open in the workspace. It only reads: it cannot control equipment or a simulation.\n\nFor example:\n\n${EXAMPLES.map((e) => `- ${e}`).join("\n")}`,
  );
}

/** A follow-up the conversation does not explain: ask for the subject rather than guess. */
async function unresolved(h: ScriptHost, reference: string) {
  await h.say(
    `I can't tell what “${reference}” refers to here: nothing earlier in this conversation names equipment, an indicator or a run it could mean. Name it, for example “Show Chiller 2's history” or “How has COP been today?”.`,
  );
}

async function unknown(h: ScriptHost) {
  await h.say(
    `This assistant has no language model connected, so requests are read by offline rules, and this one is outside what they cover. They understand questions about the plant, its equipment and issues, the forecast, simulation runs and the AI pilot. For example:\n\n${EXAMPLES.map((e) => `- ${e}`).join("\n")}`,
  );
}

/** What the conversation is about before this question: its earlier questions, read in turn. */
export function focusOf(previous: string[], vocab: Vocabulary): Focus {
  return previous.reduce<Focus>((focus, prompt) => focusAfter(focus, understand(prompt, vocab, { focus })), {});
}

export async function respond(h: ScriptHost) {
  const vocab = vocabularyOf(h.env.site);
  const intent = understand(h.message.prompt, vocab, { attachments: h.message.attachments.length, focus: focusOf(h.previous, vocab) });
  // Files sent with a question that is not about them are named, not silently ignored.
  const names = h.message.attachments.map((a) => a.name);
  let host = h;
  if (names.length && intent.kind !== "attachments") {
    let first = true;
    const note = `${list(names)} ${names.length === 1 ? "was" : "were"} attached but not used: this answer comes from the dashboard's data.`;
    host = { ...h, say: (text) => h.say(first ? ((first = false), `${text}\n\n${note}`) : text) };
  }
  switch (intent.kind) {
    case "attention":
      return attention(host);
    case "fault_history":
      return faultHistory(host, intent.range);
    case "equipment_open":
      return equipmentOpen(host, intent.id);
    case "equipment_investigate":
      return equipmentInvestigation(host, intent.id);
    case "equipment_history":
      return equipmentHistory(host, intent.id, intent.range);
    case "metric_trend":
      return metricTrend(host, intent.key, intent.range);
    case "metric_value":
      return metricValue(host, intent.key);
    case "shortfall":
      return shortfall(host);
    case "forecast":
      return forecast(host);
    case "efficiency":
      return efficiency(host);
    case "simulation_history":
      return simulationHistory(host);
    case "run_summary":
      return runSummary(host, intent.runId);
    case "current_simulation":
      return currentSimulation(host);
    case "pilot_findings":
      return pilotFindings(host, intent.runId);
    case "pilot_issue":
      return pilotIssue(host, intent.issueId);
    case "compare_runs":
      return compareRuns(host, intent.runIds);
    case "control":
      return control(host, intent.target, intent.control, intent.runId, intent.issueId);
    case "attachments":
      return attachments(host);
    case "greeting":
      return host.say("Hello. Ask about the plant, its equipment, the forecast, simulation runs or the AI pilot's findings. This assistant has no language model connected; offline rules read your request.");
    case "thanks":
      return host.say("You're welcome.");
    case "help":
      return help(host);
    case "unresolved":
      return unresolved(host, intent.reference);
    case "unknown":
      return unknown(host);
  }
}
