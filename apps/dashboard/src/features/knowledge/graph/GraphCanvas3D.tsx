/**
 * The knowledge graph in 3D: react-force-graph-3d (three.js) in its own lazy chunk, loaded
 * only when this view is chosen. Positions come from `planetaryLayout` and are fixed, so
 * nothing drifts and no simulation runs. The scene renders while someone looks round (a
 * pointer, a key, a camera flight) and pauses shortly after, so an idle display costs
 * nothing.
 *
 * Each document is a planet with what it describes circling it; colour names a node's
 * family. Four ways of looking, from the address's selection:
 * - Overview: every group; links inside a group faint, links between groups fainter still.
 * - A group (a document chosen): the camera frames the whole system; its members and links
 *   are clear, the nodes elsewhere it links to half-shown, the other groups faded.
 * - A node: the camera comes to it and what it relates to; its relationships light up with
 *   arrows for direction; its own group stays half-shown for context; the rest fades.
 * - A relationship: both ends framed, the link lit.
 * Changes of emphasis cross-fade (none with reduced motion). A trail (Overview › group ›
 * node) shows where one is and leads back.
 *
 * Names are HTML over the canvas and never print over each other or over a planet: the
 * chosen node and what it relates to first, then the documents and the best-connected
 * nodes, then whatever the camera is close enough to read; each tries below, above, right
 * and left of its node. Behind everything, a still field of faint stars (an SVG background,
 * no events): a backdrop, never data.
 *
 * Pointer, like a map: dragging moves the graph (the point under the cursor stays under it),
 * also when the drag starts on a name; right-drag or Shift-drag turns the view; the wheel
 * zooms towards the pointer; clicking a node or its name flies to it, and a drag never
 * chooses. On touch, one finger moves the graph, two turn and pinch it. Once the reader has
 * moved the view, it stays where they put it. Keyboard: one tab stop; arrow keys move to the
 * nearest node on screen, Enter inspects, Shift with an arrow turns the view, + and − zoom,
 * 0 fits, R resets the view, Escape clears. With reduced motion the camera jumps.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import { ChevronRight, Minus, Plus } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { ShapeGlyph, hudBands, type ExtraTools, type Selection, type Shape } from "./GraphCanvas";
import { declutter, nearestInDirection, nodeRadius, type LabelBox, type PlanetaryLayout, type ScreenRect } from "./layout";

export interface Node3D {
  id: string;
  type: string;
  label: string;
  degree: number;
  /** A landmark: named whenever there is room. */
  important?: boolean;
}
export interface Edge3D {
  id: string;
  type: string;
  source: string;
  target: string;
}

interface V3 {
  x: number;
  y: number;
  z: number;
}
/** The parts of three's camera and OrbitControls used here (three ships no types). */
interface Camera3 {
  position: V3;
  fov: number;
  updateProjectionMatrix: () => void;
}
interface Orbit {
  target: V3;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  mouseButtons: { LEFT: number; MIDDLE: number; RIGHT: number };
  touches: { ONE: number; TWO: number };
  screenSpacePanning: boolean;
  zoomToCursor: boolean;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}
/** three's `MOUSE` and `TOUCH` actions. */
const MOUSE = { ROTATE: 0, DOLLY: 1, PAN: 2 } as const;
const TOUCH = { PAN: 1, DOLLY_ROTATE: 3 } as const;
type Mode = "overview" | "group" | "node" | "edge";
type Rgb = readonly [number, number, number];
interface Look {
  c: Rgb;
  a: number;
  /** A node's radius (links ignore it). */
  r: number;
}
interface Looks {
  node: Map<string, Look>;
  link: Map<string, Look>;
}
/** Where the camera was put, and from which direction, so a resized canvas (the side
 *  panel opening or closing) frames the same thing again rather than wherever a flight had
 *  reached; "free" once someone moves the view themselves. */
type Placement = ({ kind: "overview" } | { kind: "group"; doc: string } | { kind: "node"; id: string } | { kind: "edge"; id: string } | { kind: "free" }) & { dir?: V3 };

const LAMINATE: Rgb = [233, 236, 239];
const LIGHT: Rgb = [200, 205, 211];
const GREY: Rgb = [155, 161, 168];
/** The view a reset returns to: from the front, a little above and to the side. */
const FRONT = { x: 0.16, y: 0.24, z: 0.96 };
const IDLE_MS = 1500;
/** A narrow lens: planets keep their round shape at the edges of a wide view. */
const FOV = 34;
const shorten = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hexRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const rgba = (c: Rgb, a: number) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${Math.round(a * 1000) / 1000})`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v: V3) => Math.hypot(v.x, v.y, v.z) || 1;
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (v: V3) => {
  const l = len(v);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const cross = (a: V3, b: V3) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const along = (from: V3, dir: V3, d: number) => {
  const l = len(dir);
  return { x: from.x + (dir.x / l) * d, y: from.y + (dir.y / l) * d, z: from.z + (dir.z / l) * d };
};
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** What is on screen part-way through a cross-fade. */
function mixed(from: Looks, to: Looks, t: number): Looks {
  const each = (a: Map<string, Look>, b: Map<string, Look>) =>
    new Map(
      [...b].map(([id, y]) => {
        const x = a.get(id) ?? y;
        return [id, { c: [lerp(x.c[0], y.c[0], t), lerp(x.c[1], y.c[1], t), lerp(x.c[2], y.c[2], t)] as const, a: lerp(x.a, y.a, t), r: lerp(x.r, y.r, t) }];
      }),
    );
  return { node: each(from.node, to.node), link: each(from.link, to.link) };
}

/**
 * The sky behind the systems: still, faint stars, the same on every visit (a seeded
 * generator, mulberry32). Two layers whose tiles differ in size, so the pattern never visibly
 * repeats: many small dim stars, and a few brighter ones with a soft halo. All are far
 * smaller and dimmer than any node (1.35 px at most, against 4 px or more) and colourless, so
 * none reads as data.
 */
const SKY = (() => {
  let seed = 0x5eed;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const halo = "<defs><radialGradient id='h'><stop offset='0' stop-color='rgba(214,224,239,0.16)'/><stop offset='1' stop-color='rgba(214,224,239,0)'/></radialGradient></defs>";
  const layer = (w: number, h: number, count: number, bright: number) => {
    let stars = "";
    for (let i = 0; i < count; i++) {
      const x = (rand() * w).toFixed(1);
      const y = (rand() * h).toFixed(1);
      const big = rand() < bright;
      const r = big ? 0.9 + rand() * 0.45 : 0.5 + rand() * 0.4;
      const alpha = (big ? 0.5 + rand() * 0.25 : 0.2 + rand() * 0.3).toFixed(2);
      const fill = rand() < 0.15 ? `rgba(242,230,212,${alpha})` : `rgba(214,224,239,${alpha})`;
      if (big) stars += `<circle cx='${x}' cy='${y}' r='${(r * 4).toFixed(1)}' fill='url(#h)'/>`;
      stars += `<circle cx='${x}' cy='${y}' r='${r.toFixed(2)}' fill='${fill}'/>`;
    }
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${halo}${stars}</svg>`)}")`;
  };
  return `${layer(1187, 997, 190, 0)}, ${layer(1543, 1301, 55, 0.4)}`;
})();

export default function GraphCanvas3D({
  nodes,
  edges,
  layout,
  colors,
  shapes,
  selected,
  onSelect,
  label,
  hint,
  keys,
  describe,
  layoutKey,
  focus,
  onFail,
  tools: extraTools,
}: {
  nodes: Node3D[];
  edges: Edge3D[];
  layout: PlanetaryLayout;
  colors: Record<string, string>;
  shapes: Record<string, Shape>;
  selected: Selection;
  onSelect: (s: Selection) => void;
  label: string;
  hint: string;
  keys: string;
  describe: (n: Node3D) => string;
  /** When this changes the view fits the graph again. */
  layoutKey: string;
  /** Fly to this node (the counter re-requests the same node). */
  focus?: { id: string; n: number } | null;
  /** The graphics context was lost: the caller shows the 2D view instead. */
  onFail: () => void;
  /** Controls beside its own at the top right (the view, help). */
  tools?: ExtraTools;
}) {
  const t = useKnowledgeStrings();
  const g = t.graph;
  const hintId = useId();
  const fg = useRef<ForceGraphMethods | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLElement>(null);
  const labelEls = useRef(new Map<string, HTMLSpanElement>());
  const sizes = useRef(new Map<string, [number, number]>());
  const shown = useRef(new Set<string>());
  const screen = useRef(new Map<string, { id: string; x: number; y: number }>());
  const hover = useRef<string | null>(null);
  const stopTravel = useRef<() => void>(() => {});
  const placement = useRef<Placement>({ kind: "overview" });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const positions = layout.positions;
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeById = useMemo(() => new Map(edges.map((e) => [e.id, e])), [edges]);
  const homeOf = (id: string) => layout.home.get(id) ?? "";
  /** Important: on a system's middle orbit (four or more connections, or described in other
   *  documents too); named sooner and in a larger size. */
  const major = (n: Node3D) => n.type !== "document" && n.type !== "section" && (n.degree >= 4 || (layout.shared.get(n.id) ?? 0) > 0);
  const radiusOf = (id: string) => {
    const n = byId.get(id);
    return n ? nodeRadius(n.type, n.degree) : 8;
  };

  // ---- what is chosen, and what that concerns ----------------------------------------------
  const chosenEdge = selected?.kind === "edge" ? edgeById.get(selected.id) : undefined;
  const chosen = selected?.kind === "node" && byId.has(selected.id) ? selected.id : null;
  const mode: Mode = chosenEdge ? "edge" : chosen ? (byId.get(chosen)!.type === "document" ? "group" : "node") : "overview";
  const group = mode === "group" ? chosen! : mode === "node" ? homeOf(chosen!) : mode === "edge" ? homeOf(chosenEdge!.source) : null;
  const near = useMemo(() => {
    const members = new Set(group !== null ? (layout.systems.find((s) => s.doc === group)?.members ?? []) : []);
    const related = new Set<string>();
    const lit = new Set<string>();
    const touching = new Set<string>();
    for (const e of edges) {
      if (mode === "node" && (e.source === chosen || e.target === chosen)) lit.add(e.id), related.add(e.source).add(e.target);
      if (mode === "edge" && e.id === chosenEdge!.id) lit.add(e.id), related.add(e.source).add(e.target);
      if (mode === "group" && members.has(e.source) !== members.has(e.target)) touching.add(members.has(e.source) ? e.target : e.source);
    }
    if (chosen) related.add(chosen);
    return { members, related, lit, touching };
  }, [mode, chosen, chosenEdge, group, edges, layout]);

  const target = useMemo((): Looks => {
    const node = new Map<string, Look>();
    const link = new Map<string, Look>();
    for (const n of nodes) {
      const r = nodeRadius(n.type, n.degree);
      if (n.id === chosen) {
        node.set(n.id, { c: LAMINATE, a: 1, r: r * (n.type === "document" ? 1.1 : 1.35) });
        continue;
      }
      const a =
        mode === "group" ? (near.members.has(n.id) ? 1 : near.touching.has(n.id) ? 0.55 : 0.14)
        : mode === "overview" ? 1
        : near.related.has(n.id) ? 1
        : near.members.has(n.id) ? (n.type === "document" ? 0.2 : 0.36)
        : 0.12;
      node.set(n.id, { c: hexRgb(colors[n.type] ?? "#9ba1a8"), a, r });
    }
    for (const e of edges) {
      const inA = near.members.has(e.source);
      const inB = near.members.has(e.target);
      const look: [Rgb, number] =
        mode === "overview" ? [GREY, homeOf(e.source) === homeOf(e.target) ? 0.22 : 0.045]
        : mode === "group" ? (inA && inB ? [LIGHT, 0.46] : inA || inB ? [LAMINATE, 0.26] : [GREY, 0.03])
        : near.lit.has(e.id) ? [LAMINATE, 0.92]
        : inA && inB ? [GREY, 0.14]
        : [GREY, 0.03];
      link.set(e.id, { c: look[0], a: look[1], r: 0 });
    }
    return { node, link };
  }, [nodes, edges, colors, mode, chosen, near, layout]);

  // A change of emphasis cross-fades from what is on screen to the new state.
  const [blend, setBlend] = useState<{ from: Looks; to: Looks; t: number }>(() => ({ from: target, to: target, t: 1 }));
  useEffect(() => {
    if (blend.to === target) return;
    setBlend({ from: blend.t >= 1 ? blend.to : mixed(blend.from, blend.to, blend.t), to: target, t: 0 });
    return motion.blend((p) => setBlend((b) => (b.to === target ? { ...b, t: p } : b)));
  }, [target]);
  const view = useMemo(() => (blend.t >= 1 ? blend.to : mixed(blend.from, blend.to, blend.t)), [blend]);

  // The library writes into the objects it is given, so it gets its own copies, pinned.
  const data = useMemo(
    () => ({
      nodes: nodes.map((n) => {
        const p = positions.get(n.id) ?? { x: 0, y: 0, z: 0 };
        return { id: n.id, type: n.type, x: p.x, y: p.y, z: p.z, fx: p.x, fy: p.y, fz: p.z };
      }),
      links: edges.map((e) => ({ id: e.id, type: e.type, source: e.source, target: e.target })),
    }),
    [nodes, edges, positions],
  );
  const nodeVal = useMemo(() => (o: NodeObject) => (view.node.get(String(o.id))?.r ?? 8) ** 3, [view]);
  const nodeColor = useMemo(
    () => (o: NodeObject) => {
      const l = view.node.get(String(o.id));
      return l ? rgba(l.c, l.a) : "#9ba1a8";
    },
    [view],
  );
  const linkColor = useMemo(
    () => (o: LinkObject) => {
      const l = view.link.get(String(o.id));
      return l ? rgba(l.c, l.a) : "rgba(0, 0, 0, 0)";
    },
    [view],
  );
  // Widths and arrows change only when the lit links do, never frame by frame: the library
  // rebuilds every link when its width function changes.
  const litKey = `${mode}:${[...near.lit].sort().join()}`;
  const linkWidth = useMemo(() => (o: LinkObject) => (near.lit.has(String(o.id)) ? (mode === "edge" ? 1.5 : 1.1) : 0), [litKey]);
  const arrow = useMemo(() => (o: LinkObject) => (near.lit.has(String(o.id)) ? (mode === "edge" ? 7 : 5.5) : 0), [litKey]);
  // A pointer over a node, or a link one can see; elsewhere the open hand that says "drag"
  // (links faded almost to nothing, as between systems in the overview, still take a click).
  const pointerCursor = useMemo(() => (o: NodeObject | LinkObject | undefined) => !!o && (!("source" in o) || (view.link.get(String(o.id))?.a ?? 0) >= 0.2), [view]);
  // Links between groups arc through the space between them instead of crossing a group.
  const curvature = useMemo(
    () => (o: LinkObject) => {
      const e = edgeById.get(String(o.id));
      return e && homeOf(e.source) !== homeOf(e.target) ? 0.22 : 0;
    },
    [edgeById, layout],
  );

  // ---- rendering on demand -------------------------------------------------------------
  const awake = useRef(true);
  const sleep = useRef(0);
  const frame = useRef(0);
  const draw = useRef(() => {});
  const wake = () => {
    const f = fg.current;
    if (!f) return;
    if (!awake.current) {
      awake.current = true;
      f.resumeAnimation();
    }
    if (!frame.current) frame.current = requestAnimationFrame(loop);
    window.clearTimeout(sleep.current);
    sleep.current = window.setTimeout(() => {
      awake.current = false;
      fg.current?.pauseAnimation();
    }, IDLE_MS);
  };
  const loop = () => {
    frame.current = 0;
    draw.current();
    if (awake.current) frame.current = requestAnimationFrame(loop);
  };

  // ---- the camera ----------------------------------------------------------------------------
  const cam = () => fg.current?.camera() as unknown as Camera3 | undefined;
  const orbit = () => fg.current?.controls() as unknown as Orbit | undefined;
  const place = (to: V3, look: V3, animate: boolean, far = false) => {
    const c = cam();
    const tg = orbit()?.target;
    if (!c || !tg) return;
    stopTravel.current();
    const apply = (v: { x: number; y: number; z: number; lx: number; ly: number; lz: number }) => {
      fg.current?.cameraPosition({ x: v.x, y: v.y, z: v.z }, { x: v.lx, y: v.ly, z: v.lz }, 0);
      wake();
    };
    const goal = { x: to.x, y: to.y, z: to.z, lx: look.x, ly: look.y, lz: look.z };
    if (!animate) return apply(goal);
    stopTravel.current = motion.travel({ x: c.position.x, y: c.position.y, z: c.position.z, lx: tg.x, ly: tg.y, lz: tg.z }, goal, apply, far);
  };
  /**
   * Where the camera goes to show these nodes, looking along `dir` (from the scene to the
   * camera): centred on `centre` (or on the nodes' extent across the view) and just far
   * enough back that every one of them, its sphere and room for its name, is on screen,
   * clear of the controls floating along the top and bottom of the view.
   */
  const framing = (ids: string[], dir: V3, centre?: V3, least = 0, margin = 1.05) => {
    const c = cam();
    const ps = ids.flatMap((id) => (positions.has(id) ? [{ p: positions.get(id)!, r: radiusOf(id) }] : []));
    if (!c || !ps.length) return null;
    const d = unit(dir);
    const r0 = cross({ x: 0, y: 1, z: 0 }, d);
    const right = len(r0) > 1e-3 ? unit(r0) : { x: 1, y: 0, z: 0 };
    const up = cross(d, right);
    let mid = centre;
    if (!mid) {
      const xs = ps.map(({ p }) => dot(p, right));
      const ys = ps.map(({ p }) => dot(p, up));
      const zs = ps.reduce((sum, { p }) => sum + dot(p, d), 0) / ps.length;
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      mid = { x: right.x * cx + up.x * cy + d.x * zs, y: right.y * cx + up.y * cy + d.y * zs, z: right.z * cx + up.z * cy + d.z * zs };
    }
    // The nodes fit the band between the floating controls, and sit in its middle.
    const band = hudBands(wrap.current);
    const h = Math.max(size.h, 1);
    const tan = Math.tan((c.fov * Math.PI) / 360);
    const tv = (tan * Math.max(h - band.top - band.bottom, h * 0.2)) / h;
    const th = tan * (size.w / h);
    let dist = Math.max(60, least / Math.min(th, tv));
    for (const { p, r } of ps) {
      const q = sub(p, mid);
      dist = Math.max(dist, dot(q, d) + (Math.abs(dot(q, right)) + r + 18) / th, dot(q, d) + (Math.abs(dot(q, up)) + r + 26) / tv);
    }
    const far = dist * margin;
    // The band's middle is (top − bottom) / 2 px below the view's: look that much higher.
    const look = along(mid, up, ((band.top - band.bottom) / h) * far * tan);
    return { at: along(look, d, far), look, dist };
  };
  const dirNow = () => {
    const c = cam();
    const tg = orbit()?.target;
    return c && tg ? sub(c.position, tg) : FRONT;
  };
  const fit = (animate: boolean, from: V3 | null, far = false) => {
    const dir = from ?? dirNow();
    const f = framing(
      nodes.map((n) => n.id),
      dir,
    );
    if (!f) return;
    placement.current = { kind: "overview", dir };
    place(f.at, f.look, animate, far);
  };
  const frameGroup = (doc: string, from?: V3) => {
    const sys = layout.systems.find((s) => s.doc === doc);
    const dir = from ?? dirNow();
    // Room round the outer orbit for the members' names.
    const f = sys && framing(sys.members, dir, sys.center, 0, 1.3);
    if (!f) return;
    placement.current = { kind: "group", doc, dir };
    place(f.at, f.look, true, true);
  };
  const flyTo = (id: string, from?: V3) => {
    const p = positions.get(id);
    if (!p) return;
    if (byId.get(id)?.type === "document") return frameGroup(id, from);
    const dir = from ?? dirNow();
    const neighbours = edges.filter((e) => e.source === id || e.target === id).map((e) => (e.source === id ? e.target : e.source));
    // Everything it relates to, unless neighbours in other groups would push the camera so
    // far back that the node itself is hard to read: then its own group's neighbourhood,
    // with the far names held at the edge of the view.
    const all = framing([id, ...neighbours], dir, p, 150);
    const local = framing([id, ...neighbours.filter((o) => homeOf(o) === homeOf(id))], dir, p, 150);
    const f = all && local && all.dist > local.dist * 1.8 ? local : all;
    if (!f) return;
    placement.current = { kind: "node", id, dir };
    place(f.at, f.look, true);
  };
  const frameEdge = (id: string, from?: V3) => {
    const e = edgeById.get(id);
    const a = e && positions.get(e.source);
    const b = e && positions.get(e.target);
    const dir = from ?? dirNow();
    const f = e && a && b && framing([e.source, e.target], dir, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }, 170);
    if (!f) return;
    placement.current = { kind: "edge", id, dir };
    place(f.at, f.look, true);
  };
  const zoom = (factor: number) => {
    const c = cam();
    const tg = orbit()?.target;
    if (!c || !tg) return;
    const d = Math.min(Math.max(len(sub(c.position, tg)) * factor, 30), 9000);
    placement.current = { kind: "free" };
    place(along(tg, sub(c.position, tg), d), tg, false);
  };
  /** Turn the view round its centre: left and right round the vertical, up and down over it. */
  const turn = (dx: number, dy: number) => {
    const c = cam();
    const tg = orbit()?.target;
    if (!c || !tg) return;
    const o = sub(c.position, tg);
    const r = len(o);
    const theta = Math.atan2(o.x, o.z) - dx * (Math.PI / 12);
    const phi = Math.min(Math.max(Math.acos(Math.min(Math.max(o.y / r, -1), 1)) + dy * (Math.PI / 18), 0.15), Math.PI - 0.15);
    placement.current = { kind: "free" };
    place({ x: tg.x + r * Math.sin(phi) * Math.sin(theta), y: tg.y + r * Math.cos(phi), z: tg.z + r * Math.sin(phi) * Math.cos(theta) }, tg, false);
  };
  // Overview clears the choice; the camera goes to the overview once that has rendered.
  // (Choices reach the canvas as router transitions, after camera requests made for the
  // previous choice: fitting at the click would let a late request for it win.)
  const toOverview = useRef(false);
  const overview = () => {
    if (!selected) return fit(true, FRONT, true);
    toOverview.current = true;
    onSelect(null);
  };
  useLayoutEffect(() => {
    if (mode !== "overview" || !toOverview.current) return;
    toOverview.current = false;
    fit(true, FRONT, true);
  }, [mode]);

  // ---- names over the canvas -------------------------------------------------------------
  const ranked = (n: Node3D, r: number, keyboard: boolean) => {
    if (n.id === chosen) return 100;
    if (n.id === focusId && keyboard) return 95;
    if (n.id === hover.current) return 90;
    const doc = n.type === "document";
    switch (mode) {
      case "overview":
        return doc ? 60 : n.important ? 40 + n.degree / 100 : r >= 9 ? 10 + r / 100 : 0;
      case "group":
        // The group's structure and its important members first; the rest as one comes closer.
        if (near.members.has(n.id)) return n.type === "section" || major(n) ? 55 + n.degree / 100 : r >= 9 ? 50 : 0;
        return doc ? 28 : near.touching.has(n.id) && r >= 6 ? 20 : 0;
      case "edge":
        // A relationship: its two ends, and the documents for bearings.
        return near.related.has(n.id) ? 80 : doc ? 28 : 0;
      default:
        return near.related.has(n.id) ? 70 + n.degree / 100 : doc ? 28 : near.members.has(n.id) && r >= 12 ? 15 : 0;
    }
  };
  draw.current = () => {
    const f = fg.current;
    const c = cam();
    const tg = orbit()?.target;
    if (!f || !c || !tg || !size.w) return;
    const fwd = sub(tg, c.position);
    const fl = len(fwd);
    const focal = size.h / 2 / Math.tan((c.fov * Math.PI) / 360);
    const keyboard = document.activeElement === wrap.current;
    const at = new Map<string, { id: string; x: number; y: number; r: number }>();
    const obstacles: ScreenRect[] = [];
    for (const n of nodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      const depth = ((p.x - c.position.x) * fwd.x + (p.y - c.position.y) * fwd.y + (p.z - c.position.z) * fwd.z) / fl;
      if (depth < 4) continue; // behind the camera
      const s = f.graph2ScreenCoords(p.x, p.y, p.z);
      const r = ((view.node.get(n.id)?.r ?? 8) * focal) / depth;
      at.set(n.id, { id: n.id, x: s.x, y: s.y, r });
      // Names keep off the planets and the chosen node.
      if (n.type === "document" || n.id === chosen) obstacles.push({ id: n.id, x: s.x - r, y: s.y - r, w: 2 * r, h: 2 * r });
    }
    // Names keep clear of the controls drawn over the canvas: its own, and those the page
    // floats over it (marked in its `data-hud` box), open menus included.
    const box = wrap.current?.getBoundingClientRect();
    const hud = wrap.current?.closest("[data-hud]");
    for (const el of hud ? hud.querySelectorAll("[data-band], [data-obstacle]") : [tools.current, trail.current]) {
      const r = el?.getBoundingClientRect();
      if (box && r?.width) obstacles.push({ x: r.left - box.left - 4, y: r.top - box.top - 4, w: r.width + 8, h: r.height + 8 });
    }
    const boxes: LabelBox[] = [];
    for (const n of nodes) {
      const s = at.get(n.id);
      if (!s) continue;
      const priority = ranked(n, s.r, keyboard);
      if (!priority) continue;
      let wh = sizes.current.get(n.id);
      const el = labelEls.current.get(n.id);
      if (!wh && el) sizes.current.set(n.id, (wh = [el.offsetWidth, el.offsetHeight]));
      if (!wh) continue;
      const [w, h] = wh;
      // Names that matter stay inside the view while their node is on screen; the chosen
      // node's and what it relates to are held at the edge even when it is not.
      const hold = priority >= 70 || (priority >= 55 && s.x >= 0 && s.y >= 0 && s.x <= size.w && s.y <= size.h);
      const fits = (x: number, y: number) => (hold ? ([Math.min(Math.max(x, 2), size.w - w - 2), Math.min(Math.max(y, 2), size.h - h - 2)] as const) : ([x, y] as const));
      const [x, y] = fits(s.x - w / 2, s.y + s.r + 4);
      boxes.push({ id: n.id, x, y, w, h, priority, alt: [fits(s.x - w / 2, s.y - s.r - 4 - h), fits(s.x + s.r + 6, s.y - h / 2), fits(s.x - s.r - 6 - w, s.y - h / 2)] });
    }
    const placed = declutter(boxes, size.w, size.h, 3, obstacles);
    for (const [id, [x, y]] of placed) {
      const el = labelEls.current.get(id);
      if (!el) continue;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.dataset.show = "";
    }
    for (const id of shown.current) if (!placed.has(id)) delete labelEls.current.get(id)?.dataset.show;
    shown.current = new Set(placed.keys());
    screen.current = at;
    const fp = focusId ? at.get(focusId) : undefined;
    if (ring.current) {
      if (fp) {
        const d = Math.max(fp.r * 2 + 10, 18);
        ring.current.style.transform = `translate(${(fp.x - d / 2).toFixed(1)}px, ${(fp.y - d / 2).toFixed(1)}px)`;
        ring.current.style.width = ring.current.style.height = `${d.toFixed(1)}px`;
        ring.current.dataset.show = "";
      } else delete ring.current.dataset.show;
    }
  };

  // ---- effects ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Every change re-renders the scene once, then it rests.
  useEffect(() => wake());

  // The controls, like a map: dragging moves the graph in the plane of the screen (the point
  // under the cursor stays under it), the right button or Shift turns the view, the wheel
  // zooms towards the pointer; on touch one finger moves, two turn and pinch. A short glide
  // after a drag (none with reduced motion), a wake on every camera change so names follow,
  // and the view is the reader's once they move it. A lost context hands over to the 2D view.
  const ready = size.w > 0;
  useEffect(() => {
    const o = orbit();
    const canvas = fg.current?.renderer()?.domElement as HTMLCanvasElement | undefined;
    if (!o || !canvas) return;
    const c = cam();
    if (c && c.fov !== FOV) {
      c.fov = FOV;
      c.updateProjectionMatrix();
    }
    o.enableDamping = !reducedMotion();
    o.dampingFactor = 0.14;
    o.minDistance = 30;
    o.maxDistance = 9000;
    o.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    o.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    o.screenSpacePanning = true;
    o.zoomToCursor = true;
    const changed = () => wake();
    const moved = () => {
      stopTravel.current();
      placement.current = { kind: "free" };
    };
    const lost = (e: Event) => (e.preventDefault(), onFail());
    o.addEventListener("change", changed);
    o.addEventListener("start", moved);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      o.removeEventListener("change", changed);
      o.removeEventListener("start", moved);
      canvas.removeEventListener("webglcontextlost", lost);
    };
  }, [ready, onFail]);

  useEffect(
    () => () => {
      stopTravel.current();
      window.clearTimeout(sleep.current);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  // A new graph (or the first size) fits the view; expanding keeps the camera.
  const fitted = useRef("");
  useEffect(() => {
    if (!ready || !nodes.length || fitted.current === layoutKey) return;
    const first = fitted.current === "";
    fitted.current = layoutKey;
    fit(!first, first ? FRONT : null, true);
  }, [layoutKey, ready, nodes.length]);

  // Fly to a requested node (a document: its whole group); the keyboard carries on from there.
  // A request that arrives after the choice has changed (Overview pressed while it was on its
  // way) is out of date: acting on it would take the camera away from what is shown. So is a
  // repeated one for the node already flown to (more of its neighbours arriving) once the
  // reader has moved the view: it stays where they put it. A new choice always flies.
  const flown = useRef<string | null>(null);
  useEffect(() => {
    if (chosen !== flown.current) flown.current = null;
  }, [chosen]);
  useEffect(() => {
    if (!focus || !ready || !positions.has(focus.id) || focus.id !== chosen) return;
    if (focus.id === flown.current && placement.current.kind === "free") return;
    flown.current = focus.id;
    flyTo(focus.id);
    setFocusId(focus.id);
  }, [focus?.id, focus?.n, ready]);

  // A chosen relationship: both ends in view.
  useEffect(() => {
    if (ready && chosenEdge) frameEdge(chosenEdge.id);
  }, [chosenEdge?.id, ready]);

  // The canvas resized (the side panel opened or closed): frame the same thing again.
  const lastSize = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const before = lastSize.current;
    lastSize.current = size;
    if (!ready || !before.w || (Math.abs(before.w - size.w) < 8 && Math.abs(before.h - size.h) < 8)) return;
    const p = placement.current;
    if (p.kind === "overview") fit(true, p.dir ?? null);
    else if (p.kind === "group") frameGroup(p.doc, p.dir);
    else if (p.kind === "node") flyTo(p.id, p.dir);
    else if (p.kind === "edge") frameEdge(p.id, p.dir);
  }, [size.w, size.h]);

  // Names are measured once per graph, and again when a phone-sized canvas shortens them or
  // the choice changes (the chosen name is bolder).
  const compact = size.w > 0 && size.w < 480;
  useEffect(() => sizes.current.clear(), [nodes, compact, chosen]);

  // ---- keyboard ---------------------------------------------------------------------------
  const current = focusId && byId.has(focusId) ? focusId : chosen && byId.has(chosen) ? chosen : nodes.toSorted((a, b) => b.degree - a.degree)[0]?.id;
  const [announce, setAnnounce] = useState("");
  const focusNode = (id: string) => {
    setFocusId(id);
    setAnnounce(g.focused(describe(byId.get(id)!)));
    const p = screen.current.get(id);
    const band = hudBands(wrap.current);
    if (!p || p.x < 24 || p.y < band.top + 24 || p.x > size.w - 24 || p.y > size.h - band.bottom - 24) {
      // Off screen or under the controls: bring it to the middle without turning (keys do
      // not animate).
      const q = positions.get(id);
      const c = cam();
      const tg = orbit()?.target;
      if (q && c && tg) {
        placement.current = { kind: "free" };
        place(along(q, sub(c.position, tg), len(sub(c.position, tg))), q, false);
      }
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    wake();
    const dir = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as const)[e.key as "ArrowRight"];
    if (dir && e.shiftKey) {
      e.preventDefault();
      turn(dir[0], dir[1]);
      return;
    }
    if (dir && current) {
      e.preventDefault();
      const pts = [...screen.current.values()].filter((p) => p.x >= 0 && p.y >= 0 && p.x <= size.w && p.y <= size.h);
      const from = screen.current.get(current) ?? pts[0];
      const next = from && nearestInDirection(from, pts, dir);
      if (next) focusNode(next.id);
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && current) {
      e.preventDefault();
      onSelect({ kind: "node", id: current });
    } else if (e.key === "Escape" && selected) {
      e.preventDefault();
      onSelect(null);
    } else if (e.key === "+" || e.key === "=") zoom(0.8);
    else if (e.key === "-" || e.key === "_") zoom(1.25);
    else if (e.key === "0") fit(true, null);
    else if (e.key === "r" || e.key === "R") fit(true, FRONT, true);
  };

  const groupName = group ? byId.get(group)?.label : undefined;
  const dim = (id: string) => (target.node.get(id)?.a ?? 1) < 0.5;

  // Touch pans are measured in page coordinates, which Chromium leaves unscrolled on a touch's
  // first event and on a handed-over press while the page is scrolled (a phone scrolls the
  // whole page): set them from the client position, so a drag does not jump by the scroll.
  const pageXY = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const n = e.nativeEvent;
    Object.defineProperties(n, { pageX: { value: n.clientX + window.scrollX }, pageY: { value: n.clientY + window.scrollY } });
  };

  // A press on a name is a click until the pointer moves; then it is handed to the camera
  // controls (they capture the pointer from there), so a drag that starts on a name moves
  // the graph like one on the canvas, and chooses nothing.
  const handOver = (e: React.PointerEvent) => {
    const canvas = fg.current?.renderer()?.domElement as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const { pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, shiftKey, ctrlKey, metaKey, altKey } = e;
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
    };
    const move = (m: PointerEvent) => {
      if (m.pointerId !== pointerId || Math.hypot(m.clientX - clientX, m.clientY - clientY) < 4) return;
      done();
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, pointerId, pointerType, isPrimary, button, buttons, clientX, clientY, shiftKey, ctrlKey, metaKey, altKey }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };

  return (
    <div className="kn-3d-frame">
      <div className="kn-3d-stage">
        <div
          ref={wrap}
          className="kn-3d"
          data-lenis-prevent
          role="application"
          aria-label={label}
          aria-describedby={hintId}
          tabIndex={0}
          data-mode={mode}
          data-group={group ?? undefined}
          data-selected={chosen ?? undefined}
          data-focused={current ?? undefined}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            if (e.target !== e.currentTarget || !current) return;
            setFocusId(current);
            setAnnounce(g.focused(describe(byId.get(current)!)));
          }}
          onPointerMove={wake}
          onPointerDown={wake}
          onPointerDownCapture={pageXY}
          onPointerMoveCapture={pageXY}
          onPointerUpCapture={pageXY}
          onPointerLeave={() => ((hover.current = null), wake())}
          onWheel={wake}
          onBlur={wake}
          // The right button turns the view, here and on the names: no browser menu.
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="kn-3d__sky" aria-hidden="true" style={{ backgroundImage: SKY }} />
          {ready && (
            <ForceGraph3D
              ref={fg}
              width={size.w}
              height={size.h}
              graphData={data}
              controlType="orbit"
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              nodeLabel=""
              linkLabel=""
              nodeRelSize={1}
              nodeVal={nodeVal}
              nodeColor={nodeColor}
              nodeOpacity={1}
              nodeResolution={20}
              linkColor={linkColor}
              linkWidth={linkWidth}
              linkOpacity={1}
              linkCurvature={curvature}
              linkCurveRotation={Math.PI / 2}
              linkDirectionalArrowLength={arrow}
              linkDirectionalArrowColor={linkColor}
              linkDirectionalArrowRelPos={1}
              linkHoverPrecision={3}
              enableNodeDrag={false}
              showPointerCursor={pointerCursor}
              warmupTicks={0}
              cooldownTicks={0}
              onNodeHover={(o) => {
                hover.current = o ? String(o.id) : null;
                if (wrap.current) wrap.current.dataset.hover = hover.current ?? "";
                wake();
              }}
              onNodeClick={(o) => onSelect({ kind: "node", id: String(o.id) })}
              onLinkClick={(o) => onSelect({ kind: "edge", id: String(o.id) })}
              onBackgroundClick={() => onSelect(null)}
            />
          )}
          <div className="kn-3d__labels" aria-hidden="true">
            {nodes.map((n) => {
              const others = layout.shared.get(n.id) ?? 0;
              return (
                <span
                  key={n.id}
                  ref={(el) => {
                    if (el) labelEls.current.set(n.id, el);
                    else labelEls.current.delete(n.id);
                  }}
                  className={`kn-3d__label${n.id === chosen ? " kn-3d__label--on" : ""}${n.type === "document" ? " kn-3d__label--doc" : major(n) ? " kn-3d__label--major" : ""}${dim(n.id) ? " kn-3d__label--dim" : ""}`}
                  data-node-id={n.id}
                  data-home={homeOf(n.id)}
                  style={{ "--kn-c": n.id === chosen ? undefined : colors[n.type] } as React.CSSProperties}
                  onClick={() => onSelect({ kind: "node", id: n.id })}
                  onPointerDown={handOver}
                  onPointerEnter={() => ((hover.current = n.id), wake())}
                  onPointerLeave={() => ((hover.current = hover.current === n.id ? null : hover.current), wake())}
                >
                  <ShapeGlyph shape={shapes[n.type] ?? "circle"} size={n.type === "document" ? 12 : 10} />
                  {shorten(n.label, n.type === "document" ? (compact ? 24 : 36) : 30)}
                  {others > 0 && (
                    <span className="kn-3d__shared" title={g.shared(others)}>
                      +{others}
                    </span>
                  )}
                </span>
              );
            })}
            <div ref={ring} className="kn-3d__ring" />
          </div>
        </div>
        {mode !== "overview" && (
          <nav ref={trail} className="kn-3d__trail" aria-label={g.trail.label} data-band>
            <button type="button" className="kn-3d__crumb" title={g.trail.overviewTitle} onClick={overview}>
              {g.trail.overview}
            </button>
            {groupName && (
              <>
                <ChevronRight size={13} aria-hidden="true" />
                {mode === "group" ? (
                  <span className="kn-3d__crumb kn-3d__crumb--here" aria-current="location">
                    {shorten(groupName, 40)}
                  </span>
                ) : (
                  <button type="button" className="kn-3d__crumb" title={g.trail.group(groupName)} onClick={() => onSelect({ kind: "node", id: group! })}>
                    {shorten(groupName, 28)}
                  </button>
                )}
              </>
            )}
            {mode !== "group" && (
              <>
                <ChevronRight size={13} aria-hidden="true" />
                <span className="kn-3d__crumb kn-3d__crumb--here" aria-current="location">
                  {mode === "edge" ? t.relationNames[chosenEdge!.type as keyof typeof t.relationNames] : shorten(byId.get(chosen!)?.label ?? "", 30)}
                </span>
              </>
            )}
          </nav>
        )}
        <div ref={tools} className="kn-canvas__tools" data-band>
          {extraTools?.before}
          <button type="button" className="icon-button" aria-label={g.zoomIn} title={g.zoomIn} onClick={() => zoom(0.8)}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label={g.zoomOut} title={g.zoomOut} onClick={() => zoom(1.25)}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <button type="button" className="button button--small button--quiet" onClick={() => fit(true, null)}>
            {g.fit}
          </button>
          <button type="button" className="button button--small button--quiet" onClick={() => fit(true, FRONT, true)}>
            {g.resetView}
          </button>
          {extraTools?.after}
        </div>
      </div>
      <div id={hintId} className="kn-canvas__hint">
        <p>{hint}</p>
        <p>{keys}</p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
