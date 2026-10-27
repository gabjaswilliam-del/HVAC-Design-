/**
 * Graph Memory's timeline: what happened at the plant, when, and how the records are joined.
 * Time runs left to right on the elastic axis (`timeline.ts`), one lane per equipment item,
 * simulation runs above. A record is an orb of constant size with its kind's icon and colour,
 * so zooming stretches time: a crowded stretch shows its first records, each counting the
 * others near it ("+2"), and opens up as one zooms in. Stored links arc between records, with
 * an arrow towards the linked one.
 * A superseded version sits dashed under its successor; a simulation record has a dashed ring
 * and its run's band above the lanes.
 *
 * Drawn in screen space from the camera (a time scale and two offsets), so shapes, lines and
 * names keep their size. Left-drag pans, the wheel and a pinch zoom time towards the pointer,
 * a click inspects, a click on empty space clears. One tab stop: Left and Right travel in
 * time, Up and Down across lanes, Enter inspects, Escape clears, + and − zoom, 0 fits. With
 * reduced motion the camera jumps.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Minus, Plus } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import type { MemoryKind } from "../../../lib/contracts/memory";
import { hudBands, type ExtraTools } from "../graph/GraphCanvas";
import { declutter, type LabelBox, type ScreenRect } from "../graph/layout";
import { SKY } from "../graph/sky";
import { equipmentName, formatUtc } from "../shared";
import { KIND_COLOURS, KIND_ICONS } from "./kinds";
import { chainOf, linkedTo, MIN_GAP, type MemoryTimelineLayout, type TimelineLane, type TimelineRecord } from "./timeline";

/** An orb's radius, a stacked record's step, a record lifted above its lane's line to clear
 *  the one before. */
const R = 17;
const ROW = 46;
const TIER = 44;
/** The date row; the runs' lane, slimmer on a short display; an equipment lane's height, and
 *  the least a short display gives one (an orb under the lane's name). */
const AXIS = 30;
const RUNS = 56;
const RUNS_LOW = 40;
const LANE_MIN = 120;
const LANE_LOW = 70;
const LANE_MAX = 176;
/** Where a lane's line is, at the least: under the lane's name. */
const MID_MIN = 32 + R;
/** Room kept at the left and right when the whole timeline is fitted; the most a fit zooms in
 *  (a record or two would otherwise fill the display), and the most one can. */
const PAD_L = 40;
const PAD_R = 72;
const FIT_MAX = 2;
const K_MAX = 12;
const DRAW = { dim: 0, normal: 1, chain: 2, linked: 3, on: 4 } as const;
const HOUR = 3_600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = (day: string, year: boolean) => `${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]}${year ? ` ${day.slice(0, 4)}` : ""}`;
const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The width of a name in the canvas's font (cached; a fixed estimate before fonts load). */
const widths = new Map<string, number>();
let measure: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string) {
  const key = `${font}|${text}`;
  let w = widths.get(key);
  if (w === undefined) {
    if (measure === undefined) measure = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (measure) measure.font = font;
    w = measure ? measure.measureText(text).width : text.length * 6.4;
    widths.set(key, w);
  }
  return w;
}

export interface Camera {
  k: number;
  x: number;
  y: number;
}

/** Where each record sits at a time scale: on its lane's line, or a step above it (where the
 *  lanes have room) when the one before on the line is nearer than two orbs. Where neither
 *  leaves room it waits for zoom, counted on the nearest record shown ("+2"). Decided in time
 *  order, so choosing a record never moves another. */
function placeAt(layout: MemoryTimelineLayout, roomy: boolean, k: number) {
  const tiers = new Map<string, number>();
  const crowded = new Set<string>();
  for (const l of layout.lanes) {
    const allowed = roomy ? [0, -1] : [0];
    const last = new Map<number, number>();
    for (const r of layout.records) {
      if (r.lane !== l.key || r.row > 0) continue;
      const x = r.x * k;
      const tier = allowed.find((t) => !last.has(t) || x - last.get(t)! >= 2 * R + 8);
      if (tier === undefined) crowded.add(r.id);
      else tiers.set(r.id, tier), last.set(tier, x);
    }
  }
  // A version stacked under another waits when that one does.
  for (const r of layout.records) if (r.row > 0 && layout.records.some((o) => o.row === 0 && o.lane === r.lane && o.x === r.x && crowded.has(o.id))) crowded.add(r.id);
  const hosts = new Map<string, string[]>();
  for (const r of layout.records) {
    if (!crowded.has(r.id)) continue;
    let host: TimelineRecord | undefined;
    for (const o of layout.records) if (o.lane === r.lane && o.row === 0 && !crowded.has(o.id) && (!host || Math.abs(o.x - r.x) < Math.abs(host.x - r.x))) host = o;
    if (host) hosts.set(host.id, [...(hosts.get(host.id) ?? []), r.id]);
  }
  return { tiers, crowded, hosts };
}

export function MemoryTimeline({
  layout,
  selected,
  link,
  onSelect,
  onLink,
  focus,
  goTo,
  layoutKey,
  label,
  describe,
  tools,
}: {
  layout: MemoryTimelineLayout;
  /** A record, `run:…` or `equipment:…`. */
  selected: string | null;
  /** A stored link. */
  link: string | null;
  onSelect: (id: string | null) => void;
  onLink: (id: string) => void;
  /** Bring this record into view (the counter asks again); centred when asked from search. */
  focus: { id: string; n: number; centre: boolean } | null;
  /** Show this stretch of time (UTC milliseconds), and this lane. */
  goTo: { from: number; to: number; n: number; lane?: string } | null;
  /** When this changes the whole timeline is fitted again. */
  layoutKey: string;
  label: string;
  describe: (r: TimelineRecord) => string;
  tools?: ExtraTools;
}) {
  const t = useKnowledgeStrings();
  const s = t.memory.timeline;
  const g = t.graph;
  const hintId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [bands, setBands] = useState({ top: 0, bottom: 0 });
  const [cam, setCam] = useState<Camera>({ k: 1, x: PAD_L, y: 0 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const stopTravel = useRef<() => void>(() => {});
  const [hover, setHover] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const byId = useMemo(() => new Map(layout.records.map((r) => [r.id, r])), [layout]);

  // ---- geometry ---------------------------------------------------------------------------
  const areaTop = bands.top + AXIS + 4;
  const areaBottom = size.h - bands.bottom - 6;
  const geo = useMemo(() => {
    const eq = layout.lanes.filter((l) => l.kind !== "runs");
    const hasRuns = layout.lanes.some((l) => l.kind === "runs");
    const extra = eq.reduce((sum, l) => sum + (l.rows - 1) * ROW, 0);
    const n = Math.max(eq.length, 1);
    // Lanes share the height. Where they cannot all have room to lift a record (a short
    // display), the runs' lane is slimmer and the lanes lower, and crowded records wait for zoom.
    const room = areaBottom - areaTop - extra;
    const roomy = room - (hasRuns ? RUNS : 0) >= n * LANE_MIN;
    const runsH = hasRuns ? (roomy ? RUNS : RUNS_LOW) : 0;
    const base = roomy ? Math.min((room - runsH) / n, LANE_MAX) : Math.max((room - runsH) / n, LANE_LOW);
    const lanes = new Map<string, { top: number; h: number; mid: number; base: number }>();
    let y = 0;
    for (const l of layout.lanes) {
      const h = l.kind === "runs" ? runsH : base + (l.rows - 1) * ROW;
      lanes.set(l.key, { top: y, h, mid: y + (l.kind === "runs" ? runsH / 2 : Math.max(base * 0.52, MID_MIN)), base });
      y += h;
    }
    return { lanes, total: y, roomy, runsH };
  }, [layout, areaTop, areaBottom]);
  const { tiers, crowded, hosts } = useMemo(() => placeAt(layout, geo.roomy, cam.k), [layout, geo.roomy, cam.k]);
  const overflow = Math.max(0, geo.total - (areaBottom - areaTop));
  const clampY = (y: number) => clamp(y, -overflow, 0);
  const fitK = size.w ? (size.w - PAD_L - PAD_R) / Math.max(layout.width, MIN_GAP) : 1;
  const kMin = Math.min(fitK * 0.6, 1);

  const sx = (x: number, c: Camera = cam) => x * c.k + c.x;
  const laneY = (lane: string) => areaTop + (geo.lanes.get(lane)?.mid ?? 0) + cam.y;
  const pos = (r: TimelineRecord, c: Camera = cam) => ({
    x: sx(r.x, c),
    y: areaTop + (geo.lanes.get(r.lane)?.mid ?? 0) + (r.row > 0 ? r.row * ROW : (tiers.get(r.id) ?? 0) * TIER) + c.y,
  });

  // ---- the camera ---------------------------------------------------------------------------
  /** Where the camera is travelling to, while it is, and what it frames on the way (all of it,
   *  or a stretch of time), to frame again if the display is resized meanwhile. */
  type Framing = "all" | { from: number; to: number; lane?: string };
  const travelTo = useRef<Camera | null>(null);
  const framing = useRef<Framing | null>(null);
  /** A stretch of time asked for (by search), framed again if the view narrows before anyone
   *  moves the camera (as when the panel it opened arrives after the camera does). */
  const asked = useRef<{ from: number; to: number; lane?: string } | null>(null);
  /** The camera to decide from: where it is going, else where it was last set (at once, not
   *  when next drawn). */
  const target = () => travelTo.current ?? camRef.current;
  /** Whether a record at this x is in sight across the view: its orb whole (a fitted view
   *  keeps the first at 40 px). */
  const across = (x: number) => x > R + 4 && x < size.w - R - 4;
  const moveTo = (to: Camera, animate: boolean, frames: Framing | null = null) => {
    stopTravel.current();
    asked.current = null;
    const next = { ...to, y: clampY(to.y) };
    if (!animate) {
      camRef.current = next;
      return setCam(next);
    }
    const done = () => ((travelTo.current = null), (framing.current = null));
    travelTo.current = next;
    framing.current = frames;
    const stop = motion.travel({ ...camRef.current }, next, (v) => {
      setCam({ k: v.k, x: v.x, y: v.y });
      if (Math.abs(v.k - next.k) < 1e-6 && Math.abs(v.x - next.x) < 0.01 && Math.abs(v.y - next.y) < 0.01) done();
    });
    stopTravel.current = () => {
      stop();
      done();
    };
  };
  const fit = (animate: boolean) => {
    if (!size.w) return;
    const k = clamp(Math.min(fitK, FIT_MAX), kMin, K_MAX);
    const room = size.w - PAD_L - PAD_R;
    moveTo({ k, x: PAD_L + Math.max(0, (room - layout.width * k) / 2), y: 0 }, animate, "all");
  };
  /** Show a stretch of time (UTC milliseconds) across the view, and a lane. */
  const frame = (f: { from: number; to: number; lane?: string }) => {
    const a = layout.xAt(f.from);
    const b = layout.xAt(f.to);
    const k = clamp(Math.min((size.w - PAD_L - PAD_R) / Math.max(b - a, MIN_GAP * 2), FIT_MAX), kMin, K_MAX);
    const laneTop = f.lane ? geo.lanes.get(f.lane)?.top : undefined;
    moveTo({ k, x: size.w / 2 - ((a + b) / 2) * k, y: laneTop === undefined ? target().y : -laneTop }, true, f);
    asked.current = f;
  };
  const zoomAt = (factor: number, px: number, animate = false) => {
    const c = target();
    const k = clamp(c.k * factor, kMin, K_MAX);
    moveTo({ k, x: px - ((px - c.x) * k) / c.k, y: c.y }, animate);
  };
  /** The scale at which a record's neighbours on its lane stand clear of it. */
  const readable = (r: TimelineRecord) => {
    const near = layout.records.filter((o) => o.lane === r.lane && o.row === 0 && o.id !== r.id && o.x !== r.x).map((o) => Math.abs(o.x - r.x));
    return near.length ? clamp((2 * R + 30) / Math.min(...near), kMin, K_MAX) : kMin;
  };
  /** Show a record: in sight, readable when asked to centre it (search, the keyboard) or when
   *  it or a record linked to it waits for zoom (the choice draws them, so they must stand
   *  apart); otherwise a record already in sight stays where it is. */
  const bring = (r: TimelineRecord, centre: boolean, animate = true) => {
    const c = target();
    const waitsAt = placeAt(layout, geo.roomy, c.k).crowded;
    const waiting = [r.id, ...linkedTo(r.id, layout.links)].filter((id) => waitsAt.has(id)).map((id) => byId.get(id)!);
    const k = centre || waiting.length ? Math.max(c.k, readable(r), ...waiting.map(readable)) : c.k;
    const p = pos(r, { ...c, k });
    const inside = across(p.x) && k === c.k;
    // Down the lanes too: in the middle, or on a short display with its lane's top (and name) at the top.
    const shown = p.y - R - 4 >= areaTop && p.y + R + 30 <= areaBottom;
    const short = areaBottom - areaTop < 2 * LANE_MIN;
    const y = shown ? c.y : short ? -((geo.lanes.get(r.lane)?.top ?? 0) + r.row * ROW) : c.y + (areaTop + areaBottom) / 2 - p.y;
    if (!centre && inside && shown) return;
    moveTo({ k, x: size.w / 2 - r.x * k, y }, animate);
  };
  /** Zoom in on a record and those waiting near it until they stand apart. */
  const reveal = (host: TimelineRecord) => {
    const c = target();
    const group = [host, ...(hosts.get(host.id) ?? []).map((id) => byId.get(id)!)];
    const k = Math.max(c.k, ...group.map(readable));
    const mid = (Math.min(...group.map((r) => r.x)) + Math.max(...group.map((r) => r.x))) / 2;
    moveTo({ k, x: size.w / 2 - mid * k, y: c.y }, true);
  };

  // Size, and the controls floating along the top and bottom.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measureBands = () => setBands((b) => ((n) => (n.top === b.top && n.bottom === b.bottom ? b : n))(hudBands(el)));
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
      measureBands();
    });
    ro.observe(el);
    const root = el.closest("[data-hud]");
    const bandsRo = new ResizeObserver(measureBands);
    root?.querySelectorAll("[data-band]").forEach((b) => bandsRo.observe(b));
    return () => (ro.disconnect(), bandsRo.disconnect());
  }, []);

  // A new set of records (or the first size): fit it all.
  const fitted = useRef("");
  useEffect(() => {
    if (!size.w || fitted.current === layoutKey) return;
    const first = fitted.current === "";
    fitted.current = layoutKey;
    fit(!first);
  }, [layoutKey, size.w]);

  // Resized (a panel opened or closed, the window changed): what is shown stays where it is,
  // so opening and closing a panel moves nothing; a chosen record the narrower view would
  // leave out of sight comes to the middle. A camera on its way still gets there: framing
  // all of it or a stretch of time again for the new width, or to the new middle.
  const lastW = useRef(0);
  useEffect(() => {
    const before = lastW.current;
    lastW.current = size.w;
    if (!before || !size.w || before === size.w || fitted.current !== layoutKey) return;
    const to = travelTo.current;
    const f = framing.current;
    if (to && f) return f === "all" ? fit(true) : frame(f);
    if (asked.current && size.w < before) return frame(asked.current);
    if (to) return moveTo({ ...to, x: to.x + (size.w - before) / 2 }, true);
    const r = chosen ? byId.get(chosen) : undefined;
    const c = camRef.current;
    const at = r ? r.x * c.k + c.x : size.w / 2;
    if (r && !across(at)) moveTo({ ...c, x: size.w / 2 - r.x * c.k }, false);
  }, [size.w]);
  useEffect(() => setCam((c) => (c.y < -overflow ? { ...c, y: -overflow } : c)), [overflow]);

  // Asked to show a record (again when the display's height changes, as when a panel opens
  // below it on a phone) or a stretch of time.
  useEffect(() => {
    const r = focus && focus.id === selected ? byId.get(focus.id) : undefined;
    if (!r || !size.w) return;
    asked.current = null;
    bring(r, focus!.centre);
  }, [focus?.id, focus?.n, size.w > 0, size.h]);
  useEffect(() => {
    if (goTo && size.w) frame(goTo);
  }, [goTo?.n]);
  useEffect(() => () => stopTravel.current(), []);

  // ---- pointer: drag pans, a pinch zooms, a click inspects -------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ x: number; y: number; cam: Camera; moved: boolean; target: Element | null; pinch?: { d: number; mx: number } } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const box = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button") || e.button > 0) return;
    stopTravel.current();
    asked.current = null;
    wrap.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const target = (e.target as Element).closest("[data-zoom-id], [data-mem-id], [data-link-id], [data-run-id]");
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { x: p.x, y: p.y, cam: camRef.current, moved: true, target: null, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 } };
    } else gesture.current = { x: p.x, y: p.y, cam: camRef.current, moved: false, target };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const gst = gesture.current;
    if (!gst || !pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (gst.pinch && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = clamp((gst.cam.k * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(gst.pinch.d, 1), kMin, K_MAX);
      const mx = (a.x + b.x) / 2;
      setCam({ k, x: mx - ((gst.pinch.mx - gst.cam.x) * k) / gst.cam.k, y: gst.cam.y });
      return;
    }
    if (!gst.moved && Math.hypot(p.x - gst.x, p.y - gst.y) < 4) return;
    gst.moved = true;
    setCam({ k: gst.cam.k, x: gst.cam.x + p.x - gst.x, y: clampY(gst.cam.y + p.y - gst.y) });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const gst = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) {
      // A pinch ending with a finger still down: that finger pans on from where things are.
      const [p] = [...pointers.current.values()];
      gesture.current = { x: p.x, y: p.y, cam: camRef.current, moved: true, target: null };
      return;
    }
    gesture.current = null;
    if (!gst || gst.moved) return;
    const el = gst.target as HTMLElement | null;
    if (el?.dataset.zoomId) reveal(byId.get(el.dataset.zoomId)!);
    else if (el?.dataset.memId) onSelect(el.dataset.memId);
    else if (el?.dataset.runId) onSelect(el.dataset.runId);
    else if (el?.dataset.linkId) onLink(el.dataset.linkId);
    else onSelect(null);
  };

  // The wheel zooms time towards the pointer (not passive, so the page does not scroll too);
  // a sideways wheel or Shift pans along it.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopTravel.current();
      asked.current = null;
      const p = local(e);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const c = camRef.current;
        return setCam({ ...c, x: c.x - (e.shiftKey ? e.deltaY : e.deltaX) });
      }
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p.x);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  // ---- what a choice concerns -------------------------------------------------------------------
  const chosen = selected && byId.has(selected) ? selected : null;
  const chosenLink = link ? layout.links.find((l) => l.id === link) : undefined;
  const run = selected?.startsWith("run:") ? layout.runs.find((r) => r.id === selected) : undefined;
  const lane = selected?.startsWith("equipment:") ? selected.slice("equipment:".length) : null;
  const direct = useMemo(() => {
    if (chosen) return linkedTo(chosen, layout.links);
    if (chosenLink) return new Set([chosenLink.source, chosenLink.target]);
    if (run) return new Set(run.records);
    if (lane) return new Set(layout.records.filter((r) => r.lane === lane || r.echoes.includes(lane)).map((r) => r.id));
    return null;
  }, [chosen, chosenLink, run, lane, layout]);
  const chain = useMemo(() => (chosen ? chainOf(chosen, layout.links) : null), [chosen, layout]);
  // A record chosen (by search, a click, a link, the keyboard) becomes the tab stop.
  useEffect(() => {
    if (chosen) setFocusId(null);
  }, [chosen]);
  const stateOf = (id: string) => (id === chosen ? "on" : direct?.has(id) ? "linked" : chain?.has(id) ? "chain" : direct ? "dim" : "normal");

  // ---- the frame's marks --------------------------------------------------------------------
  const font = useMemo(() => (typeof document === "undefined" ? "" : getComputedStyle(document.body).fontFamily), []);
  const visible = (x: number, margin = 80) => x > -margin && x < size.w + margin;
  const placed = layout.records.map((r) => ({ r, ...pos(r) }));
  const emphasised = (id: string) => id === chosen || id === focusId || id === hover || Boolean(direct?.has(id));
  // A crowded record waits for zoom unless a choice concerns it (not merely its equipment's).
  const waits = (id: string) => crowded.has(id) && !(id === chosen || id === focusId || (!lane && direct?.has(id)));

  // Names: the chosen record's in full with its kind and time (its name alone on a short
  // display), others shortened; the most important first, each clear of the others, the orbs,
  // their counts and the lane names, between the controls along the top and bottom.
  const nameFont = `500 12px ${font}`;
  const metaFont = `400 11px ${font}`;
  const lanesH = Math.max(areaBottom - areaTop, 0);
  const labelFor = (r: TimelineRecord) => {
    if (r.id === chosen) {
      const title = short(r.title, 54);
      const meta = lanesH < 140 ? "" : `${t.memory.kinds[r.kind]} · ${formatUtc(r.occurredAt)}`;
      return { title, meta, w: Math.max(textWidth(title, `600 12.5px ${font}`), meta ? textWidth(meta, metaFont) : 0) + 18, h: meta ? 38 : 26 };
    }
    const title = short(r.title, r.id === hover || direct?.has(r.id) ? 40 : 28);
    return { title, meta: "", w: textWidth(title, nameFont) + 16, h: 21 };
  };
  const rank: Record<MemoryKind, number> = { finding: 30, decision: 29, outcome: 28, correction: 27, observation: 22, event: 21 };
  // The lanes' names (pinned at each lane's top left; a short display leaves out the counts)
  // are kept clear too.
  const laneName = (l: TimelineLane) => (l.kind === "runs" ? s.runs : l.kind === "none" ? s.none : equipmentName(l.key));
  const nameBoxes: ScreenRect[] = layout.lanes.map((l) => ({
    id: `lane:${l.key}`,
    x: 8,
    y: (geo.lanes.get(l.key)?.top ?? 0) + cam.y + 6,
    w: 18 + textWidth(laneName(l), `600 12px ${font}`) + (l.kind === "equipment" && geo.roomy ? 8 + textWidth(s.records(l.records), `500 11px ${font}`) : 0),
    h: 22,
  }));
  const boxes: LabelBox[] = [];
  const texts = new Map<string, ReturnType<typeof labelFor>>();
  for (const p of placed) {
    if (waits(p.r.id) || !visible(p.x, 0) || (p.r.superseded && !emphasised(p.r.id))) continue;
    const l = labelFor(p.r);
    texts.set(p.r.id, l);
    const y = p.y - areaTop;
    const priority = p.r.id === chosen ? 100 : p.r.id === hover ? 90 : p.r.id === focusId ? 85 : direct?.has(p.r.id) ? 80 : chain?.has(p.r.id) ? 60 : rank[p.r.kind];
    boxes.push({
      id: p.r.id,
      priority,
      x: p.x - l.w / 2,
      y: y + R + 5,
      w: l.w,
      h: l.h,
      alt: [
        [p.x - l.w / 2, y - R - 5 - l.h],
        [p.x + R + 6, y - l.h / 2],
        [p.x - R - 6 - l.w, y - l.h / 2],
      ],
    });
  }
  // How many records wait for zoom near each one shown, counted at its top right (bottom right
  // where that would meet a lane's name).
  const nearby = (id: string) => (hosts.get(id) ?? []).filter(waits).length;
  const countBox = (p: { x: number; y: number }) => {
    const box = { x: p.x + 4, y: p.y - areaTop - R - 15, w: 30, h: 17 };
    const meets = nameBoxes.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
    return meets ? { ...box, y: p.y - areaTop + R - 3 } : box;
  };
  const orbs: ScreenRect[] = placed
    .filter((p) => visible(p.x) && !waits(p.r.id))
    .flatMap((p) => {
      const orb = { id: p.r.id, x: p.x - R, y: p.y - areaTop - R, w: 2 * R, h: 2 * R };
      return nearby(p.r.id) ? [orb, { id: `more:${p.r.id}`, ...countBox(p) }] : [orb];
    });
  const labels = declutter(boxes, size.w, lanesH, 4, [...orbs, ...nameBoxes]);

  // The date row: each day's start, hours when a day is wide, the shortened quiet stretches.
  const yearOf = (day: string, i: number) => i === 0 || day.slice(0, 4) !== layout.days[i - 1].day.slice(0, 4);
  const dayXs = layout.days.map((d) => ({ ...d, sx: sx(d.x) }));
  const dayWidth = dayXs.length > 1 ? Math.min(...dayXs.slice(1).map((d, i) => d.sx - dayXs[i].sx)) : Infinity;
  const hours: { x: number; label: string }[] = [];
  if (dayWidth > 360)
    for (const d of dayXs) {
      if (!visible(d.sx, dayWidth)) continue;
      const start = Date.parse(`${d.day}T00:00:00Z`);
      for (const h of dayWidth > 1500 ? [3, 6, 9, 12, 15, 18, 21] : [6, 12, 18]) {
        const x = sx(layout.xAt(start + h * HOUR));
        if (visible(x, 0)) hours.push({ x, label: `${String(h).padStart(2, "0")}:00` });
      }
    }
  const firstShown = dayXs.findIndex((d) => d.sx >= 0);
  // The day one is in, pinned at the left when its start is out of sight (and the next day's
  // name is not about to take its place).
  const before = firstShown > 0 ? dayXs[firstShown - 1] : firstShown === -1 && dayXs.length && dayXs.at(-1)!.sx < 0 ? dayXs.at(-1) : undefined;
  const stuck = before && (firstShown === -1 || dayXs[firstShown].sx > 120) ? before : undefined;
  // Its words, the most telling first, each kept only whole and clear of those already kept:
  // the pinned day, the days' starts, the quiet stretches, then the hours.
  const dayFont = `600 12px ${font}`;
  const smallFont = `500 11px ${font}`;
  const axis: { key: string; x: number; w: number; text: string; className: string; title?: string }[] = [];
  const offer = (key: string, x: number, text: string, f: string, className: string, title?: string) => {
    const w = textWidth(text, f);
    if (x + w <= size.w - 4 && axis.every((a) => x + w + 10 <= a.x || a.x + a.w + 10 <= x)) axis.push({ key, x, w, text, className, title });
  };
  if (stuck) offer("stuck", 10, dayName(stuck.day, true), dayFont, "mm-axis__day mm-axis__day--stuck");
  dayXs.forEach((d, i) => visible(d.sx, 0) && offer(d.day, d.sx + 6, dayName(d.day, yearOf(d.day, i)), dayFont, "mm-axis__day"));
  for (const b of layout.breaks) {
    const x = sx(b.x);
    const days = Math.round(b.hours / 24);
    const text = `≈ ${s.quiet(days)}`;
    if (visible(x, 0)) offer(`q${b.x}`, x - textWidth(text, smallFont) / 2, text, smallFont, "mm-axis__quiet", s.quietTitle(days));
  }
  for (const h of hours) offer(`t${h.x}`, h.x + 4, h.label, smallFont, "mm-axis__hour");

  // Simulation runs whose bands would meet take a second row in their lane.
  const runFont = `600 11.5px ${font}`;
  const runBands = new Map<string, { x0: number; w: number; row: number }>();
  const runEnds: number[] = [];
  for (const rn of layout.runs) {
    const x0 = sx(rn.x0) - 22;
    const w = Math.max(sx(rn.x1) + 22 - x0, textWidth(rn.runId, runFont) + 24);
    const free = runEnds.findIndex((e) => e <= x0);
    const row = Math.min(free === -1 ? runEnds.length : free, 1);
    runEnds[row] = Math.max(runEnds[row] ?? -Infinity, x0 + w + 6);
    runBands.set(rn.id, { x0, w, row });
  }
  const bandH = geo.runsH < RUNS ? 16 : runEnds.length > 1 ? 22 : 24;

  // ---- keyboard ---------------------------------------------------------------------------------
  // The one tab stop: the record last travelled to, the chosen one, or the latest one shown.
  const current = focusId && byId.has(focusId) ? focusId : (chosen ?? layout.records.findLast((r) => !crowded.has(r.id))?.id ?? null);
  const focusRecord = (id: string) => {
    const r = byId.get(id)!;
    setFocusId(id);
    setAnnounce(s.focused(describe(r)));
    asked.current = null;
    if (crowded.has(id) || !inView(r)) bring(r, true, false);
    requestAnimationFrame(() => nodeEls.current.get(id)?.focus({ preventScroll: true }));
  };
  const inView = (r: TimelineRecord) => {
    const p = pos(r, target());
    return across(p.x) && p.y >= areaTop && p.y <= areaBottom;
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // The browser's own keys (zoom, back) stay the browser's.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const order = layout.records;
    const at = order.findIndex((r) => r.id === current);
    const key = e.key;
    let next: TimelineRecord | undefined;
    if (key === "ArrowRight" || key === "ArrowLeft") next = order[at + (key === "ArrowRight" ? 1 : -1)];
    else if (key === "Home") next = order[0];
    else if (key === "End") next = order.at(-1);
    else if ((key === "ArrowUp" || key === "ArrowDown") && at >= 0) {
      // Lanes with records of their own (not only echoes of records on other lanes).
      const keys = layout.lanes.filter((l) => order.some((r) => r.lane === l.key)).map((l) => l.key);
      const laneKey = keys[keys.indexOf(order[at].lane) + (key === "ArrowDown" ? 1 : -1)];
      next = order.filter((r) => r.lane === laneKey).sort((a, b) => Math.abs(a.x - order[at].x) - Math.abs(b.x - order[at].x))[0];
    } else if ((key === "Enter" || key === " ") && current) {
      e.preventDefault();
      return onSelect(current);
    } else if (key === "Escape" && selected) {
      e.preventDefault();
      return onSelect(null);
    } else if (key === "+" || key === "=") {
      e.preventDefault();
      const r = current ? byId.get(current) : undefined;
      return zoomAt(1.4, r ? pos(r).x : size.w / 2, true);
    } else if (key === "-" || key === "_") {
      e.preventDefault();
      return zoomAt(1 / 1.4, size.w / 2, true);
    } else if (key === "0") {
      e.preventDefault();
      return fit(true);
    } else return;
    e.preventDefault();
    if (next) focusRecord(next.id);
  };

  // ---- drawing --------------------------------------------------------------------------------
  const linkPath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dy) < 2) {
      // On one lane: an arc over the records between, rising with the distance.
      const lift = clamp(Math.abs(dx) * 0.3, 26, 74);
      const dir = Math.sign(dx) || 1;
      return `M ${a.x + dir * R * 0.7} ${a.y - R * 0.7} C ${a.x + dir * R} ${a.y - lift}, ${b.x - dir * R} ${b.y - lift}, ${b.x - dir * R * 0.7} ${b.y - R * 0.7}`;
    }
    if (Math.abs(dx) < 3 * R) {
      const dir = Math.sign(dy);
      return `M ${a.x} ${a.y + dir * R} C ${a.x + 26} ${a.y + dy / 2}, ${b.x + 26} ${b.y - dy / 2}, ${b.x} ${b.y - dir * R}`;
    }
    const dir = Math.sign(dx);
    const c = Math.max(Math.abs(dx) * 0.45, 30);
    return `M ${a.x + dir * R} ${a.y} C ${a.x + dir * c} ${a.y}, ${b.x - dir * c} ${b.y}, ${b.x - dir * R} ${b.y}`;
  };

  return (
    <div className="mm-frame">
      <div
        ref={wrap}
        className="mm-canvas"
        data-lenis-prevent
        data-selected={selected ?? undefined}
        data-focused={current ?? undefined}
        data-k={cam.k.toFixed(3)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(e) => (pointers.current.delete(e.pointerId), (gesture.current = null))}
      >
        <div className="mm-canvas__sky" aria-hidden="true" style={{ backgroundImage: SKY }} />
        {size.w > 0 && (
          <svg className="mm-svg" width={size.w} height={size.h} role="group" aria-label={label} aria-describedby={hintId} onKeyDown={onKeyDown}>
            <defs>
              {(Object.keys(KIND_COLOURS) as MemoryKind[]).map((k) => (
                <radialGradient key={k} id={`mm-halo-${k}`}>
                  <stop offset="0" stopColor={KIND_COLOURS[k]} stopOpacity="0.42" />
                  <stop offset="1" stopColor={KIND_COLOURS[k]} stopOpacity="0" />
                </radialGradient>
              ))}
              <marker id="mm-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1L9,5L0,9Z" className="mm-arrow" />
              </marker>
              <marker id="mm-arrow-on" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,1L9,5L0,9Z" className="mm-arrow mm-arrow--on" />
              </marker>
              {/* The lanes' area: what is scrolled out of it is not drawn over the date row or the controls. */}
              <clipPath id="mm-lanes-clip">
                <rect x={0} y={areaTop - 1} width={size.w} height={lanesH + 1} />
              </clipPath>
            </defs>

            {/* Lanes, day lines and quiet stretches */}
            <g aria-hidden="true">
              <g clipPath="url(#mm-lanes-clip)">
                {layout.lanes.map((l, i) => {
                  const gl = geo.lanes.get(l.key)!;
                  const top = areaTop + gl.top + cam.y;
                  const track = layout.records.filter((r) => r.lane === l.key && r.row === 0 && !r.superseded);
                  return (
                    <g key={l.key} className={`mm-lane mm-lane--${l.kind}${lane === l.key ? " mm-lane--on" : ""}`}>
                      <rect x={0} y={top} width={size.w} height={gl.h} className={i % 2 ? "mm-lane__band mm-lane__band--alt" : "mm-lane__band"} />
                      {l.kind !== "runs" && <line x1={0} x2={size.w} y1={top + gl.mid - gl.top} y2={top + gl.mid - gl.top} className="mm-lane__rule" />}
                      {track.length > 1 && <line x1={sx(track[0].x)} x2={sx(track.at(-1)!.x)} y1={top + gl.mid - gl.top} y2={top + gl.mid - gl.top} className="mm-lane__track" />}
                    </g>
                  );
                })}
              </g>
              {dayXs.map((d) => visible(d.sx, 0) && <line key={d.day} x1={d.sx} x2={d.sx} y1={areaTop - 6} y2={areaTop + Math.min(geo.total + cam.y, lanesH)} className="mm-day" />)}
              {hours.map((h) => (
                <line key={`h${h.x}`} x1={h.x} x2={h.x} y1={areaTop} y2={areaTop + Math.min(geo.total + cam.y, lanesH)} className="mm-hour" />
              ))}
              {layout.breaks.map((b) => {
                const x = sx(b.x);
                return visible(x, 0) && <line key={`b${b.x}`} x1={x} x2={x} y1={areaTop - 6} y2={areaTop + Math.min(geo.total + cam.y, lanesH)} className="mm-break" />;
              })}
            </g>

            {/* The date row */}
            <g className="mm-axis" aria-hidden="true">
              {axis.map((a) => (
                <text key={a.key} x={a.x} y={areaTop - 12} className={a.className}>
                  {a.title && <title>{a.title}</title>}
                  {a.text}
                </text>
              ))}
            </g>

            <g clipPath="url(#mm-lanes-clip)">
              {/* Simulation runs: a band over the time their records span */}
              {layout.runs.map((rn) => {
                const band = runBands.get(rn.id)!;
                const y = laneY("runs") + (runEnds.length > 1 ? (band.row ? 1 : -1) * (bandH / 2 + 2) : 0);
                const on = rn.id === selected || rn.records.some((id) => id === chosen);
                return (
                  <g key={rn.id} className={`mm-run${on ? " mm-run--on" : ""}${direct && !on && !rn.records.some((id) => direct.has(id)) ? " mm-dim" : ""}`}>
                    {on &&
                      rn.records.map((id) => {
                        if (waits(id)) return null;
                        const p = pos(byId.get(id)!);
                        return <line key={id} x1={p.x} x2={p.x} y1={y + bandH / 2} y2={p.y - R - 3} className="mm-run__thread" />;
                      })}
                    <rect data-run-id={rn.id} x={band.x0} y={y - bandH / 2} width={band.w} height={bandH} rx={bandH / 2} className="mm-run__band">
                      <title>{s.run(rn.runId)}</title>
                    </rect>
                    <text x={band.x0 + 12} y={y + 4} className="mm-run__name" pointerEvents="none">
                      {rn.runId}
                    </text>
                  </g>
                );
              })}

              {/* Stored links, with an arrow towards the linked record */}
              <g className="mm-links">
                {layout.links.map((l) => {
                  // A link to a record waiting for zoom shows with it.
                  if (waits(l.source) || waits(l.target)) return null;
                  const a = byId.get(l.source)!;
                  const b = byId.get(l.target)!;
                  const pa = pos(a);
                  const pb = pos(b);
                  if (!visible(pa.x, size.w) && !visible(pb.x, size.w)) return null;
                  const lit = l.id === link || l.source === chosen || l.target === chosen;
                  const inChain = chain?.has(l.source) && chain.has(l.target);
                  const d = l.type === "SUPERSEDES" ? `M ${pa.x} ${pa.y + R} L ${pb.x} ${pb.y - R * 0.75}` : linkPath(pa, pb);
                  return (
                    <g key={l.id} className={`mm-link mm-link--${l.type.toLowerCase()}${lit ? " mm-link--lit" : inChain ? " mm-link--chain" : direct ? " mm-dim" : ""}`} data-link-type={l.type}>
                      <path d={d} className="mm-link__line" markerEnd={l.type === "SUPERSEDES" ? undefined : `url(#${lit ? "mm-arrow-on" : "mm-arrow"})`} />
                      {l.type !== "SUPERSEDES" && <path d={d} className="mm-link__hit" data-link-id={l.id} />}
                    </g>
                  );
                })}
              </g>

              {/* Echoes on the other lanes a record is about */}
              <g aria-hidden="true">
                {placed.flatMap((p) =>
                  (waits(p.r.id) ? [] : p.r.echoes).map((eq) => {
                    const y = laneY(eq);
                    return (
                      <g key={`${p.r.id}:${eq}`} className={`mm-echo${stateOf(p.r.id) === "dim" ? " mm-dim" : ""}`}>
                        {emphasised(p.r.id) && <line x1={p.x} x2={p.x} y1={p.y} y2={y} className="mm-echo__thread" />}
                        <circle cx={p.x} cy={y} r={6} className="mm-echo__dot" style={{ stroke: KIND_COLOURS[p.r.kind] }} />
                      </g>
                    );
                  }),
                )}
              </g>

              {/* The records */}
              <g className="mm-nodes">
                {/* What a choice concerns is drawn last, over the rest. */}
                {placed.toSorted((a, b) => DRAW[stateOf(a.r.id)] - DRAW[stateOf(b.r.id)]).map((p) => {
                  const r = p.r;
                  const state = stateOf(r.id);
                  const tabbable = r.id === current;
                  if (waits(r.id) || (!visible(p.x) && !tabbable && state !== "on")) return null;
                  const Icon = KIND_ICONS[r.kind];
                  const more = nearby(r.id);
                  return (
                    <g
                      key={r.id}
                      ref={(el) => {
                        if (el) nodeEls.current.set(r.id, el);
                        else nodeEls.current.delete(r.id);
                      }}
                      className={`mm-node mm-node--${state}${r.superseded ? " mm-node--old" : ""}${r.provenance === "simulation" ? " mm-node--sim" : ""}`}
                      transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                      style={{ "--mm-c": KIND_COLOURS[r.kind] } as React.CSSProperties}
                      role="button"
                      tabIndex={tabbable ? 0 : -1}
                      aria-label={more ? `${describe(r)}. ${s.nearby(more)}` : describe(r)}
                      aria-pressed={r.id === chosen}
                      data-mem-id={r.id}
                      data-kind={r.kind}
                      data-status={r.superseded ? "superseded" : "current"}
                      data-lane={r.lane}
                      data-state={state}
                      onPointerEnter={() => setHover(r.id)}
                      onPointerLeave={() => setHover((h) => (h === r.id ? null : h))}
                      onFocus={() => {
                        // Tabbed to out of sight (the view moved since): it comes into view.
                        setFocusId(r.id);
                        if (!inView(r)) bring(r, false, false);
                      }}
                    >
                      <circle r={R * 1.9} className="mm-node__halo" fill={`url(#mm-halo-${r.kind})`} />
                      {r.provenance === "simulation" && <circle r={R + 5} className="mm-node__sim" />}
                      <circle r={R} className="mm-node__orb" />
                      <Icon size={16} x={-8} y={-8} className="mm-node__icon" aria-hidden="true" />
                      <circle r={R + 4} className="mm-node__ring" />
                      {more > 0 && (
                        <g className="mm-node__more" transform={`translate(6 ${countBox(p).y + areaTop - p.y + 9})`} data-zoom-id={r.id}>
                          <title>{s.nearby(more)}</title>
                          <rect x={-2} y={-9} width={more > 9 ? 30 : 24} height={17} rx={8.5} />
                          <text x={more > 9 ? 13 : 10} y={4} textAnchor="middle">{`+${more}`}</text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        {/* Names, over the drawing */}
        <div className="mm-labels" aria-hidden="true">
          {[...labels].map(([id, [x, y]]) => {
            const r = byId.get(id)!;
            const l = texts.get(id)!;
            const state = stateOf(id);
            return (
              <span
                key={id}
                className={`mm-label mm-label--${state}`}
                data-mem-id={id}
                data-show=""
                style={{ transform: `translate(${x.toFixed(1)}px, ${(y + areaTop).toFixed(1)}px)`, width: `${l.w}px`, "--mm-c": KIND_COLOURS[r.kind] } as React.CSSProperties}
                onPointerEnter={() => setHover(id)}
                onPointerLeave={() => setHover((h) => (h === id ? null : h))}
              >
                <span className="mm-label__title">{l.title}</span>
                {l.meta && <span className="mm-label__meta">{l.meta}</span>}
              </span>
            );
          })}
        </div>

        {/* Lane names, pinned at the left: an equipment item's records on choosing it */}
        <div className="mm-lanes" style={{ top: 0 }}>
          {layout.lanes.map((l) => {
            const gl = geo.lanes.get(l.key)!;
            const top = areaTop + gl.top + cam.y + 6;
            if (top < areaTop - 4 || top > areaBottom - 16) return null;
            const name = laneName(l);
            return l.kind === "equipment" ? (
              <button
                key={l.key}
                type="button"
                className={`mm-lane__name${lane === l.key ? " mm-lane__name--on" : ""}`}
                style={{ transform: `translate(8px, ${top}px)` }}
                data-lane-key={l.key}
                aria-pressed={lane === l.key}
                onClick={() => onSelect(lane === l.key ? null : `equipment:${l.key}`)}
              >
                {name}
                <span className={geo.roomy ? "mm-lane__count" : "visually-hidden"}>{s.records(l.records)}</span>
              </button>
            ) : (
              <span key={l.key} className="mm-lane__name mm-lane__name--static" style={{ transform: `translate(8px, ${top}px)` }}>
                {name}
              </span>
            );
          })}
        </div>
      </div>
      <div className="kn-canvas__tools" data-band>
        {tools?.before}
        <button type="button" className="icon-button" aria-label={g.zoomIn} title={g.zoomIn} onClick={() => zoomAt(1.4, size.w / 2, true)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label={g.zoomOut} title={g.zoomOut} onClick={() => zoomAt(1 / 1.4, size.w / 2, true)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" className="button button--small button--quiet" onClick={() => fit(true)}>
          {g.fit}
        </button>
        {tools?.after}
      </div>
      <div id={hintId} className="kn-canvas__hint">
        <p>{s.hint}</p>
        <p>{s.keys}</p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
