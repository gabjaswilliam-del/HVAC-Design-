/**
 * Offline understanding: reads a request into a typed intent without a language model.
 *
 * Not phrase matching. A request is reduced to a frame: what it is about (a plant
 * indicator, a piece of equipment, a simulation run, a pilot issue, attached files), over
 * what time (now, today, the last hours, the next hours, a day the data does not hold) and
 * what is asked (a value, its course, a comparison, a summary, a change). The intent
 * follows from that frame, so paraphrases meet ("show me COP", "how has COP been today",
 * "let me see COP performance") and no single word is required. Whether a detailed view
 * opens is decided later, by the capability that answers.
 *
 * A request with no subject of its own ("How about the last 6 hours?", "Show me its
 * history") is read against the conversation's focus: what its earlier turns were about.
 * One that cannot be read that way is reported as unresolved, never guessed. A local
 * language model would produce the same intents through the same tools and actions; this
 * is the fallback when none is connected, and it is labelled so wherever it answers.
 */

export interface Vocabulary {
  devices: { id: string; label: string }[];
  /** Plant indicators the workspace can draw. */
  metrics: { key: string; label: string }[];
}

export type ControlTarget = "simulation" | "setpoint" | "proposal" | "override" | "equipment";
/** The simulation control a request named, so the assistant can point to it (never press it). */
export type SimulationControl = "start" | "pause" | "resume" | "step" | "stop" | "monitoring";

export type TimeRange =
  | { kind: "now" }
  | { kind: "today" }
  | { kind: "last_hours"; hours: number }
  | { kind: "next_hours"; hours: number }
  /** A day or period the one-day demo data does not hold. */
  | { kind: "beyond"; said: string };

export type Intent =
  | { kind: "attention" }
  /** Issues over a period; `null` is everything detected up to now. */
  | { kind: "fault_history"; range: TimeRange | null }
  | { kind: "equipment_open"; id: string }
  | { kind: "equipment_investigate"; id: string }
  | { kind: "equipment_history"; id: string; range: TimeRange }
  | { kind: "metric_trend"; key: string; range: TimeRange }
  | { kind: "metric_value"; key: string }
  | { kind: "shortfall" }
  | { kind: "forecast" }
  | { kind: "efficiency" }
  | { kind: "simulation_history" }
  /** A run's summary; `null` is the latest run that has ended. */
  | { kind: "run_summary"; runId: string | null }
  | { kind: "current_simulation" }
  | { kind: "pilot_findings"; runId: string | null }
  | { kind: "pilot_issue"; issueId: string }
  /** Zero, one or two named runs; the responder finds the matched partner. */
  | { kind: "compare_runs"; runIds: string[] }
  /** A request to change something. The assistant cannot (F10); it points to the operator's control. */
  | { kind: "control"; target: ControlTarget; control: SimulationControl | null; runId: string | null; issueId: string | null }
  | { kind: "attachments" }
  /** A follow-up whose subject the conversation does not supply ("show me its history" first). */
  | { kind: "unresolved"; reference: string }
  | { kind: "greeting" }
  | { kind: "thanks" }
  | { kind: "help" }
  | { kind: "unknown" };

/** What the conversation has been about, carried from one turn to the next. */
export interface Focus {
  subject?: "metric" | "equipment" | "run" | "issue";
  metric?: string;
  /** Whether the metric was last asked as a course (trend) or a single value. */
  metricAs?: "trend" | "value";
  equipment?: string;
  runId?: string;
  issueId?: string;
  range?: TimeRange;
}

const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", twelve: "12" };

/** Lower case, plain apostrophes, number words as digits, single spaces, padded. */
export function normalize(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b(one|two|three|four|five|six|twelve)\b/g, (w) => NUMBER_WORDS[w])
    .replace(/[^a-z0-9'#.\-δ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

// What is asked.
const SHOW = /\b(show|open|display|view|see|visuali[sz]e|plot|chart|graph|bring up|pull up|go to|take me|navigate|inspect|look at|let me see|let's see|pop up)\b/;
const COURSE = /\b(trends?|trending|progress|over time|history|historical|performance|performing|perform|doing|been|evolv\w*|chang\w*|so far|graph|chart|curve|plot|lately|recently)\b/;
const CURRENT = /\b(current|currently|now|at the moment|value|reading|what is|what's|whats)\b/;
const COMPARE = /\b(compare|comparison|compared|versus|vs|against|difference|differ)\b/;
const LAST = /\b(last|latest|most recent|newest|previous)\b/;
const OUTCOME = /\b(go|went|goes|result|results|outcome|summary|summari[sz]e|turn out|turned out|end up|ended|finish|finished|end)\b/;
const LIVE = /\b(current|live|active|running|now|ongoing|in progress|right now)\b/;
const HISTORY = /\b(history|historical|previous|past|earlier|prior|all|list|ran|so far|before|recent|today|yesterday|did we|have we|we've)\b/;
const FIND = /\b(find|found|findings|detect\w*|issues?|problems?|discover\w*|flag\w*|spot\w*|saw|see|concerns?)\b/;
const ATTENTION = /\b(attention|wrong|problems?|issues?|alarms?|alerts?|faults?|faulty|broken|failing|failed|failures?|trouble|abnormal|anomal\w*|tripped|down)\b/;
const SINCE = /\b(last \d+ ?(h|hrs?|hours?)|past \d+ ?(h|hrs?|hours?)|since|today|yesterday|over the day|this morning|this afternoon|24 ?h|history|earlier)\b/;
const FORECAST = /\b(forecast\w*|predict\w*|outlook|next \d+ ?(h|hrs?|hours?)|coming hours|later today|tonight|tomorrow|expected|expect)\b/;
const SHORTFALL = /\b(meeting|meet|meets|enough|keeping up|keep up|keeps up|cover|covering|covered|shortfall|short of)\b/;
const EFFICIENCY = /\befficien\w*/;
const FILE = /\b(file|files|attachment|attachments|attached|document|csv|log|logs|json|this|it|these)\b/;
const READ = /\b(summari[sz]e|read|analy[sz]e|look at|what's in|what is in|check|review|explain|describe|tell me about)\b/;
const RECORD = /\b(record|details|page|history|historical|log|trend|over time|today|so far)\b/;
// A request that leans on the conversation: a pronoun, or an ellipsis ("and power?").
const PRONOUN = /\b(it|its|it's|this one|that one|that|them|their|the same|same one)\b/;
const ELLIPSIS = /^ (and|also|then|how about|what about|and what about|and how about|same for|now)\b/;

/**
 * A verb used as a request, not described: at the start ("stop the run"), after a request
 * ("can you stop it", "please stop", "I want you to stop") or as a stated intention ("we
 * need to raise the setpoint"). "When did the simulation end?" is a question, not this.
 */
const imperative = (verbs: string) =>
  new RegExp(
    // A run ID is not the verb "run" ("RUN-0001 vs RUN-0002").
    `^ (?:(?:please|ok|okay|now|hey|so|and|then|just)\\s)*(?:(?:can|could|would|will) you (?:please )?|(?:i want|i need|i'd like|id like) you to |(?:i want|i'd like|we need|we want|we should|let's|lets|i need) (?:to )?|go ahead and |you should |please )?(?:${verbs})\\b(?!-?\\s?#?\\d)`,
  );
const SIM_CONTROL = imperative("start|stop|pause|resume|halt|end|terminate|kill|launch|begin|restart|abort|cancel|run|step|continue|unpause|play");
const CHANGE = imperative("set|change|raise|lower|increase|decrease|adjust|apply|accept|release|override|actuate|turn on|turn off|switch on|switch off|shut down|shut off|power on|power off|start|stop|enable|disable|reset|bump|drop");
const SWITCH = /\b(turn on|turn off|switch on|switch off|shut down|shut off|power on|power off|start|stop|enable|disable|actuate|reset)\b/;
const SETPOINT = /\b(setpoints?|set point|frequency|speed|temperature|hz|degrees?)\b/;
const BARE_CONTROL = /^ (?:(?:please|ok|okay|now|just|and|then) )*(pause|resume|stop|step|start|continue)( it| now| please| the run| this)* $/;
/** A request that is only a time ("yesterday?", "the last 6 hours"): it asks about the same subject. */
const ONLY_TIME = /^ (?:(?:and|or|then|for|in|over|the|during) )*(yesterday|today|now|right now|this (morning|afternoon)|(the )?(last|past|next) (\d+ ?(h|hrs?|hours?)|hour|week|month))\s?$/;

/** Which simulation control a request names. */
function controlNamed(t: string): SimulationControl | null {
  if (/\bmonitoring\b/.test(t)) return "monitoring";
  if (/\b(stop|halt|end|terminate|kill|abort|cancel)\b/.test(t)) return "stop";
  if (/\b(pause)\b/.test(t)) return "pause";
  if (/\b(resume|continue|unpause|play)\b/.test(t)) return "resume";
  if (/\bstep\b/.test(t)) return "step";
  if (/\b(start|launch|begin|restart|run)\b/.test(t)) return "start";
  return null;
}

// What it is about.
const RUN_ADJ = "last|latest|previous|current|recent|live|active|matched|first|new|second|other|newest|this|that";
const SIMULATION = new RegExp(`\\b(simulations?|sims?|simulated runs?|runs)\\b|\\b(?:the|our|my|a|an|another|which|each|${RUN_ADJ}) (?:(?:${RUN_ADJ}) )?run\\b`);
const RUN_ID = /\brun(?:-|\s?#|\s)?(\d{1,4})\b(?!\s*(?:h|hrs?|hours?|min\w*|times?|simulations?|runs?|more)\b)/g;
const PILOT = /\b(pilot|ai pilot)\b/;
const PILOT_ISSUE = /\bpil-(\d{1,4})-(\d+)\b/;

const METRICS: [RegExp, string][] = [
  [/\bcop\b|coefficient of performance/, "plant:cop"],
  [/\b(delivered|removed|supplied) cooling\b|\bcooling (delivered|removed|supplied)\b/, "plant:cooling_delivered_kw"],
  [/\bunmet\b|\bdeficit\b/, "plant:unmet_kw"],
  [/\b(running |chiller |plant )?capacity\b/, "plant:available_capacity_kw"],
  [/\b(delta[ -]?t|δt)\b/, "plant:chw_delta_t_c"],
  [/\bapproach\b/, "plant:approach_c"],
  [/\b(chw|chilled[ -]water) supply( temp\w*)?\b|\bsupply temperature\b/, "chw_supply:temp_c"],
  [/\bwet[ -]?bulb\b/, "weather:wet_bulb_c"],
  [/\b(plant |electrical |electric |total )?power\b|\bconsumption\b|\belectricity\b|\benergy use\b|\bkilowatts?\b/, "plant:power_kw"],
  [/\b(cooling )?(demand|load)\b/, "plant:cooling_demand_kw"],
];

/** The time a request is about, if it names one. */
export function rangeIn(t: string): TimeRange | null {
  if (/\byesterday\b/.test(t)) return { kind: "beyond", said: "yesterday" };
  const beyond = /\b((last|past|previous) (week|month|year|\d+ days?)|this (week|month|year)|tomorrow)\b/.exec(t);
  if (beyond) return { kind: "beyond", said: beyond[1] };
  const ahead = /\bnext (\d+) ?(h|hrs?|hours?)\b/.exec(t);
  if (ahead) return { kind: "next_hours", hours: Number(ahead[1]) };
  const back = /\b(last|past|previous) (\d+) ?(h|hrs?|hours?)\b/.exec(t);
  if (back) return { kind: "last_hours", hours: Math.min(24, Math.max(1, Number(back[2]))) };
  if (/\b(last|past) hour\b/.test(t)) return { kind: "last_hours", hours: 1 };
  if (/\b(today|so far|since midnight|this morning|this afternoon|over the day|all day)\b/.test(t)) return { kind: "today" };
  if (/\b(now|right now|currently|current|at the moment|at present)\b/.test(t)) return { kind: "now" };
  return null;
}

/** Ways people name equipment: its label, its ID, and the usual abbreviations. */
function equipmentPatterns(d: { id: string; label: string }): RegExp[] {
  const esc = (s: string) => s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const n = /(\d+)$/.exec(d.label)?.[1];
  const out = [new RegExp(`\\b${esc(d.label)}\\b`), new RegExp(`\\b${esc(d.id)}\\b`)];
  const num = n ? `(?: ?#|[ -])?${n}\\b` : "";
  if (d.id.startsWith("chiller_plant")) out.push(new RegExp(`\\b(chiller|ch)${num}`));
  else if (d.id.startsWith("cooling_towers")) out.push(new RegExp(`\\b(cooling tower|tower|ct)${num}`));
  else if (d.id.startsWith("cooling_water_pump")) out.push(new RegExp(`\\b(cw pump|cwp|condenser( water)? pump)${num}`));
  else if (d.id.startsWith("chilled_water_pump")) out.push(new RegExp(`\\b(chw pump|chwp|chilled water pump|primary( chw)? pump)${num}`));
  else if (d.id === "terminal") out.push(/\b(data hall|terminal|it load|data center load)\b/);
  return out;
}

/** Equipment and indicators a text names, in the order of the vocabulary. */
export function mentions(text: string, vocab: Vocabulary) {
  const t = normalize(text);
  return {
    equipment: vocab.devices.filter((d) => equipmentPatterns(d).some((re) => re.test(t))).map((d) => d.id),
    metrics: METRICS.filter(([re, key]) => re.test(t) && vocab.metrics.some((m) => m.key === key)).map(([, key]) => key),
  };
}

function findEquipment(t: string, vocab: Vocabulary): string | null {
  let best: { id: string; at: number } | null = null;
  for (const d of vocab.devices) {
    for (const re of equipmentPatterns(d)) {
      const m = re.exec(t);
      if (m && (!best || m.index < best.at)) best = { id: d.id, at: m.index };
    }
  }
  return best?.id ?? null;
}

function findMetric(t: string, vocab: Vocabulary): string | null {
  for (const [re, key] of METRICS) if (re.test(t) && vocab.metrics.some((m) => m.key === key)) return key;
  return null;
}

const runIdsIn = (t: string) => [...new Set([...t.matchAll(RUN_ID)].map((m) => `RUN-${m[1].padStart(4, "0")}`))];

/** A metric request: its course over a period, or a single value. Time decides, not wording. */
function metricIntent(key: string, t: string, request: string, range: TimeRange | null, show: boolean): Intent {
  if (range?.kind === "now") return { kind: "metric_value", key };
  if (range) return { kind: "metric_trend", key, range };
  if (show || COURSE.test(t)) return { kind: "metric_trend", key, range: { kind: "today" } };
  if (CURRENT.test(t) || /\?\s*$/.test(request.trim())) return { kind: "metric_value", key };
  return { kind: "metric_trend", key, range: { kind: "today" } };
}

export function understand(request: string, vocab: Vocabulary, opts: { attachments?: number; focus?: Focus } = {}): Intent {
  const t = normalize(request);
  const attachments = opts.attachments ?? 0;
  const focus = opts.focus ?? {};
  if (!t.trim()) return attachments ? { kind: "attachments" } : { kind: "unknown" };

  const runIds = runIdsIn(t);
  const issue = PILOT_ISSUE.exec(t);
  const issueId = issue ? `PIL-${issue[1].padStart(4, "0")}-${issue[2]}` : null;
  const simulation = SIMULATION.test(t) || runIds.length > 0;
  const equipment = findEquipment(t, vocab);
  const metric = findMetric(t, vocab);
  const show = SHOW.test(t);
  const range = rangeIn(t);

  // Requests to change something come first, so "stop the simulation" is never read as
  // "show the simulation". The assistant points to the operator's control instead.
  if (BARE_CONTROL.test(t) || ((simulation || PILOT.test(t) || /\b(scenarios?|monitoring)\b/.test(t)) && SIM_CONTROL.test(t))) {
    return { kind: "control", target: "simulation", control: controlNamed(t), runId: runIds[0] ?? null, issueId: null };
  }
  if (CHANGE.test(t)) {
    const asked = { control: null, runId: runIds[0] ?? null, issueId };
    if (/\b(proposals?|suggestions?|recommendations?)\b/.test(t) || issue) return { kind: "control", target: "proposal", ...asked };
    if (/\boverrides?\b/.test(t)) return { kind: "control", target: "override", ...asked };
    if (SETPOINT.test(t) && (equipment || /\b(chillers?|pumps?|towers?|fans?|plant)\b/.test(t))) return { kind: "control", target: "setpoint", ...asked };
    if ((equipment || /\b(chillers?|pumps?|towers?|fans?)\b/.test(t)) && SWITCH.test(t)) return { kind: "control", target: "equipment", ...asked };
  }

  if (issueId) return { kind: "pilot_issue", issueId };
  if (COMPARE.test(t) && simulation) return { kind: "compare_runs", runIds: runIds.slice(0, 2) };
  if (runIds.length) return { kind: "run_summary", runId: runIds[0] };
  if (PILOT.test(t) && (FIND.test(t) || show || /\b(say|think|doing|status|up to)\b/.test(t) || t.trim() === "pilot")) {
    return { kind: "pilot_findings", runId: null };
  }
  if (simulation) {
    // "How did the last simulation go?", and also "show me (replay) the last simulation":
    // one run, its summary and replay. The last runs, or their history, are the list.
    const one = (show || /\breplay\b/.test(t)) && !/\b(history|simulations|runs)\b/.test(t);
    if (LAST.test(t) && (OUTCOME.test(t) || /\bhow\b/.test(t) || one)) return { kind: "run_summary", runId: null };
    if (LIVE.test(t) && !HISTORY.test(t)) return { kind: "current_simulation" };
    return { kind: "simulation_history" };
  }
  if (attachments && (FILE.test(t) || READ.test(t))) return { kind: "attachments" };

  // A request with no subject of its own leans on the conversation.
  if (!equipment && !metric && (PRONOUN.test(t) || ELLIPSIS.test(t) || ONLY_TIME.test(t))) {
    const followed = followUp(t, request, range, show, focus);
    if (followed) return followed;
  }

  // A forecast is about the time ahead of the load; a time ahead alone is not.
  const forecastAsked = /\b(forecast\w*|predict\w*|outlook)\b/.test(t) || (FORECAST.test(t) && /\b(demand|load|cooling)\b/.test(t));
  if (forecastAsked && (!metric || metric === "plant:cooling_demand_kw")) return { kind: "forecast" };
  if (SHORTFALL.test(t) && /\b(demand|load|cooling)\b/.test(t) && !show) return { kind: "shortfall" };
  if (/\b(any|is there|are we|were we)\b.*\bunmet\b/.test(t) && !show) return { kind: "shortfall" };

  if (equipment) {
    if (range && range.kind !== "now" && range.kind !== "next_hours") return { kind: "equipment_history", id: equipment, range };
    if (/\b(history|historical|log|over time|trend)\b/.test(t)) return { kind: "equipment_history", id: equipment, range: { kind: "today" } };
    if (show || RECORD.test(t)) return { kind: "equipment_open", id: equipment };
    return { kind: "equipment_investigate", id: equipment };
  }
  if (EFFICIENCY.test(t) && !show && !COURSE.test(t) && !metric && (!range || range.kind === "now")) return { kind: "efficiency" };
  if (metric || EFFICIENCY.test(t)) {
    // "And power?" after a trend keeps the trend's period; after a value, it is a value.
    if (metric && ELLIPSIS.test(t) && !range && focus.subject === "metric" && focus.metricAs) {
      return focus.metricAs === "value" ? { kind: "metric_value", key: metric } : { kind: "metric_trend", key: metric, range: focus.range ?? { kind: "today" } };
    }
    return metricIntent(metric ?? "plant:cop", t, request, range, show);
  }
  if (ATTENTION.test(t)) return SINCE.test(t) || (range && range.kind !== "now") ? { kind: "fault_history", range } : { kind: "attention" };
  if (attachments) return { kind: "attachments" };
  if (/^ (hi|hello|hey|good (morning|afternoon|evening))\b/.test(t)) return { kind: "greeting" };
  if (/\b(thanks|thank you|cheers)\b/.test(t)) return { kind: "thanks" };
  if (/\b(what can you do|help|capabilit\w*|what do you know|how do i use|what can i ask)\b/.test(t)) return { kind: "help" };
  if (PRONOUN.test(t) && RECORD.test(t)) return { kind: "unresolved", reference: referenceIn(t) };
  return { kind: "unknown" };
}

const referenceIn = (t: string) => (/\b(its|it's|it|this one|that one|that|them|their|the same|same one)\b/.exec(t)?.[1] ?? "that").replace("it's", "its");

/** Read a subject-less request against the conversation's focus, or say it cannot be. */
function followUp(t: string, request: string, range: TimeRange | null, show: boolean, focus: Focus): Intent | null {
  const asksHistory = /\b(history|historical|log|over time|trend|been|so far)\b/.test(t);
  const asksState = /\b(wrong|happening|going on|state|status|doing|ok|okay|running)\b/.test(t);
  const asksOpen = show || /\b(record|details|page)\b/.test(t);
  if (focus.subject === "metric" && focus.metric) {
    if (range?.kind === "now") return { kind: "metric_value", key: focus.metric };
    if (range) return { kind: "metric_trend", key: focus.metric, range };
    if (asksHistory || asksOpen) return { kind: "metric_trend", key: focus.metric, range: focus.range ?? { kind: "today" } };
  }
  if (focus.subject === "equipment" && focus.equipment) {
    if (range && range.kind !== "now" && range.kind !== "next_hours") return { kind: "equipment_history", id: focus.equipment, range };
    if (asksHistory) return { kind: "equipment_history", id: focus.equipment, range: { kind: "today" } };
    if (asksOpen) return { kind: "equipment_open", id: focus.equipment };
    if (asksState) return { kind: "equipment_investigate", id: focus.equipment };
  }
  if (focus.subject === "run" && focus.runId) {
    if (COMPARE.test(t)) return { kind: "compare_runs", runIds: [focus.runId] };
    if (asksOpen || asksHistory || /\b(summary|go|went|result)\b/.test(t)) return { kind: "run_summary", runId: focus.runId };
  }
  if (focus.subject === "issue" && focus.issueId && (asksOpen || asksState || /\b(evidence|proposal)\b/.test(t))) {
    return { kind: "pilot_issue", issueId: focus.issueId };
  }
  // A pronoun or an ellipsis with nothing to lean on: say so rather than guess.
  if (PRONOUN.test(t) || ELLIPSIS.test(t) || ONLY_TIME.test(t)) return { kind: "unresolved", reference: PRONOUN.test(t) ? referenceIn(t) : request.trim().replace(/[?.!]+$/, "") };
  return null;
}

/** What the conversation is about after a turn, for the next one. */
export function focusAfter(focus: Focus, intent: Intent): Focus {
  switch (intent.kind) {
    case "metric_trend":
      return { subject: "metric", metric: intent.key, metricAs: "trend", range: intent.range };
    case "metric_value":
      return { subject: "metric", metric: intent.key, metricAs: "value", range: { kind: "now" } };
    case "efficiency":
      return { subject: "metric", metric: "plant:cop", metricAs: "value", range: { kind: "now" } };
    case "forecast":
      return { subject: "metric", metric: "plant:cooling_demand_kw", metricAs: "trend", range: { kind: "today" } };
    case "shortfall":
      return { subject: "metric", metric: "plant:unmet_kw", metricAs: "trend", range: { kind: "today" } };
    case "equipment_open":
    case "equipment_investigate":
    case "equipment_history":
      return { subject: "equipment", equipment: intent.id };
    case "run_summary":
      return intent.runId ? { subject: "run", runId: intent.runId } : focus;
    case "compare_runs":
      return intent.runIds[0] ? { subject: "run", runId: intent.runIds[0] } : focus;
    case "pilot_issue":
      return { subject: "issue", issueId: intent.issueId, runId: `RUN-${intent.issueId.split("-")[1]}` };
    case "greeting":
    case "thanks":
    case "help":
    case "unknown":
    case "unresolved":
    case "attachments":
      return focus;
    default:
      return {};
  }
}
