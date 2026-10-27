/**
 * Graph Memory's timeline, laid out: pure and deterministic, nothing drawn here.
 *
 * Time runs left to right on an elastic axis. Between two consecutive moments the distance
 * grows with the time between them (as its square root, from a minimum that keeps records
 * apart), up to a cap: a quiet stretch longer than three days is drawn at that cap and
 * marked as a break. So the order and the relative spacing are the records' own, without
 * days of empty space. Nothing is moved to suggest a link.
 *
 * Lanes are the equipment items, in the order they first appear; simulation runs have a lane
 * of their own above them; records about no equipment share the last lane. A record lies on
 * the lane of the first equipment item it is about and echoes on its others. Records at the
 * same moment on one lane are stacked, a superseded version under its successor.
 *
 * The links drawn are the stored ones (and SUPERSEDES between versions shown). The order of
 * the records about one equipment item, which the service derives, is the lane itself.
 */
import type { MemoryEdge, MemoryKind, MemoryNode, Provenance } from "../../../lib/contracts/memory";

/** Links people store between records. */
export const STORED = ["SUPPORTED_BY", "RESOLVED_BY", "RESULTED_IN"] as const;
export type TimelineLinkType = (typeof STORED)[number] | "SUPERSEDES";

const HOUR = 3_600_000;
/** World units between two distinct moments at least, and this much more per √hour. */
export const MIN_GAP = 70;
const PER_ROOT_HOUR = 40;
/** A stretch with no record longer than this is drawn as long as this one, and marked. */
export const BREAK_HOURS = 72;
const CAP = MIN_GAP + PER_ROOT_HOUR * Math.sqrt(BREAK_HOURS);
/** How far apart two moments are drawn. */
export const span = (hours: number) => (hours <= 0 ? 0 : Math.min(MIN_GAP + PER_ROOT_HOUR * Math.sqrt(hours), CAP));

export interface TimelineRecord {
  id: string;
  kind: MemoryKind;
  title: string;
  occurredAt: string;
  t: number;
  x: number;
  lane: string;
  /** 0 on the lane; 1, 2… stacked under it (records at the same moment on this lane). */
  row: number;
  /** The other equipment items it is about (their lanes echo it). */
  echoes: string[];
  superseded: boolean;
  provenance?: Provenance;
  runId: string | null;
}
export interface TimelineLane {
  key: string;
  kind: "runs" | "equipment" | "none";
  records: number;
  rows: number;
}
export interface TimelineRun {
  id: string;
  runId: string;
  x0: number;
  x1: number;
  records: string[];
}
export interface TimelineLink {
  id: string;
  type: TimelineLinkType;
  source: string;
  target: string;
}
export interface MemoryTimelineLayout {
  /** In time order, then by ID. */
  records: TimelineRecord[];
  lanes: TimelineLane[];
  runs: TimelineRun[];
  links: TimelineLink[];
  /** Each UTC day's start (outside the breaks). */
  days: { day: string; x: number }[];
  breaks: { x: number; hours: number }[];
  /** The last moment's x (the first is at 0). */
  width: number;
  /** Where any time lies, between the moments as their positions say. */
  xAt: (t: number) => number;
}

const isRecord = (n: MemoryNode) => Boolean(n.occurredAt) && n.type !== "equipment" && n.type !== "simulation_run";

export function memoryTimelineLayout(nodes: readonly MemoryNode[], edges: readonly MemoryEdge[]): MemoryTimelineLayout {
  const recs = nodes.filter(isRecord).map((n) => ({ n, t: Date.parse(n.occurredAt!) }));
  recs.sort((a, b) => a.t - b.t || a.n.id.localeCompare(b.n.id));

  // The elastic axis: a position for each distinct moment.
  const times = [...new Set(recs.map((r) => r.t))];
  const xs: number[] = [];
  const breaks: { x: number; hours: number }[] = [];
  times.forEach((t, i) => {
    if (!i) return void xs.push(0);
    const hours = (t - times[i - 1]) / HOUR;
    xs.push(xs[i - 1] + span(hours));
    if (hours > BREAK_HOURS) breaks.push({ x: (xs[i - 1] + xs[i]) / 2, hours });
  });
  const xAt = (t: number) => {
    if (!times.length) return 0;
    if (t <= times[0]) return -span((times[0] - t) / HOUR);
    const last = times.length - 1;
    if (t >= times[last]) return xs[last] + span((t - times[last]) / HOUR);
    let i = 0;
    while (times[i + 1] < t) i++;
    return xs[i] + ((t - times[i]) / (times[i + 1] - times[i])) * (xs[i + 1] - xs[i]);
  };
  const xOf = new Map(times.map((t, i) => [t, xs[i]]));

  // Lanes: runs, then equipment in the order it first appears, then records about nothing.
  const keys: string[] = [];
  if (recs.some((r) => r.n.runId)) keys.push("runs");
  for (const { n } of recs) {
    const key = n.equipment?.[0] ?? "";
    if (key && !keys.includes(key)) keys.push(key);
  }
  for (const n of nodes) if (n.type === "equipment" && !keys.includes(n.id.slice("equipment:".length))) keys.push(n.id.slice("equipment:".length));
  if (recs.some((r) => !r.n.equipment?.length)) keys.push("none");

  // Records at one moment on one lane: current versions first, then superseded ones.
  const placed = new Map<string, number>();
  const stacked = recs.toSorted((a, b) => a.t - b.t || Number(a.n.status === "superseded") - Number(b.n.status === "superseded") || a.n.id.localeCompare(b.n.id));
  const rows = new Map<string, number>();
  for (const { n, t } of stacked) {
    const at = `${n.equipment?.[0] ?? "none"}@${t}`;
    rows.set(n.id, placed.get(at) ?? 0);
    placed.set(at, (placed.get(at) ?? 0) + 1);
  }
  const records: TimelineRecord[] = recs.map(({ n, t }) => ({
    id: n.id,
    kind: n.type as MemoryKind,
    title: n.label,
    occurredAt: n.occurredAt!,
    t,
    x: xOf.get(t)!,
    lane: n.equipment?.[0] ?? "none",
    row: rows.get(n.id)!,
    echoes: (n.equipment ?? []).slice(1),
    superseded: n.status === "superseded",
    provenance: n.provenance,
    runId: n.runId ?? null,
  }));
  const lanes: TimelineLane[] = keys.map((key) => {
    const on = records.filter((r) => key !== "runs" && r.lane === key);
    const about = key === "runs" ? 0 : records.filter((r) => r.lane === key || r.echoes.includes(key)).length;
    return { key, kind: key === "runs" ? "runs" : key === "none" ? "none" : "equipment", records: about, rows: Math.max(1, ...on.map((r) => r.row + 1)) };
  });

  const runs: TimelineRun[] = [];
  for (const r of records) {
    if (!r.runId) continue;
    const run = runs.find((x) => x.runId === r.runId);
    if (run) (run.x1 = r.x), run.records.push(r.id);
    else runs.push({ id: `run:${r.runId}`, runId: r.runId, x0: r.x, x1: r.x, records: [r.id] });
  }

  const shown = new Set(records.map((r) => r.id));
  const links: TimelineLink[] = [];
  for (const e of edges) {
    if (!(STORED as readonly string[]).includes(e.type) && e.type !== "SUPERSEDES") continue;
    if (!shown.has(e.source) || !shown.has(e.target) || links.some((l) => l.id === e.id)) continue;
    links.push({ id: e.id, type: e.type as TimelineLinkType, source: e.source, target: e.target });
  }

  // A tick at each UTC day's start, from the first record's day. Inside a break only the day
  // of the record that ends it is marked.
  const days: { day: string; x: number }[] = [];
  if (times.length) {
    const start = new Date(times[0]);
    start.setUTCHours(0, 0, 0, 0);
    for (let d = start.getTime(); d <= times.at(-1)!; d += 24 * HOUR) {
      const i = times.findIndex((t) => t > d);
      const quiet = i > 0 && d > times[i - 1] && (times[i] - times[i - 1]) / HOUR > BREAK_HOURS;
      if (quiet && d + 24 * HOUR <= times[i]) continue;
      days.push({ day: new Date(d).toISOString().slice(0, 10), x: xAt(d) });
    }
  }

  return { records, lanes, runs, links, days, breaks, width: xs.at(-1) ?? 0, xAt };
}

/** The records a record is linked to directly: its stored links, and its other versions. */
export function linkedTo(id: string, links: readonly TimelineLink[]): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (l.source === id) out.add(l.target);
    if (l.target === id) out.add(l.source);
  }
  return out;
}

/** Every record joined to this one through stored links (not versions), it included. */
export function chainOf(id: string, links: readonly TimelineLink[]): Set<string> {
  const seen = new Set([id]);
  const next = [id];
  while (next.length) {
    const at = next.pop()!;
    for (const l of links) {
      if (l.type === "SUPERSEDES") continue;
      const other = l.source === at ? l.target : l.target === at ? l.source : null;
      if (other && !seen.has(other)) seen.add(other), next.push(other);
    }
  }
  return seen;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m, d));
  return date.getUTCMonth() === m && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};
function parseDay(text: string, year: number): string | null {
  const t = text.trim().toLowerCase().replace(/,/g, "");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})\s+([a-z]{3,})\.?(?:\s+(\d{4}))?$/.exec(t);
  if (m && MONTHS.includes(m[2].slice(0, 3))) return iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[2].slice(0, 3)), +m[1]);
  m = /^([a-z]{3,})\.?\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(t);
  if (m && MONTHS.includes(m[1].slice(0, 3))) return iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[1].slice(0, 3)), +m[2]);
  return null;
}

/** A day, or a range of days, typed in a search box (UTC): "2026-09-29", "29 Sep",
 *  "Sep 29 2026", "28 Sep to 1 Oct", "2026-09-28..2026-10-01". `year` when none is typed. */
export function parseDays(q: string, year: number): { from: string; to: string } | null {
  const parts = q.trim().split(/\s*(?:\.\.|–|—|\s-\s|\s+to\s+)\s*/i);
  if (parts.length > 2) return null;
  const from = parseDay(parts[0], year);
  const to = parts.length === 2 ? parseDay(parts[1], year) : from;
  return from && to && from <= to ? { from, to } : null;
}
