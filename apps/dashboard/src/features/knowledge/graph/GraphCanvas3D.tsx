/**
 * The knowledge graph in 3D: react-force-graph-3d (three.js) in its own lazy chunk, loaded
 * only when this view is chosen. Positions come from `clusterLayout3d` and are fixed, so
 * nothing drifts and no simulation runs. The scene renders while someone looks round (a
 * pointer, a key, a camera flight) and pauses shortly after, so an idle display costs
 * nothing.
 *
 * Colour names a node's family. The chosen node turns laminate; what it relates to keeps
 * its colour and their relationships light up, with arrows for direction; everything
 * else fades. Names are HTML over the canvas and never print over each other: the chosen
 * node and what it relates to first, then the documents and the best-connected nodes,
 * then whatever the camera is close enough to read.
 *
 * Pointer: drag turns the view (orbit), right-drag or Shift-drag pans, the wheel or a pinch
 * zooms, clicking a node or its name flies to it. Keyboard: one tab stop; arrow keys move
 * to the nearest node on screen, Enter inspects, Shift with an arrow turns the view, + and
 * − zoom, 0 fits, R resets the view, Escape clears. With reduced motion the camera jumps.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import { Minus, Plus } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { ShapeGlyph, type Selection, type Shape } from "./GraphCanvas";
import { declutter, nearestInDirection, type LabelBox, type Point3 } from "./layout";

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
}
interface Orbit {
  target: V3;
  enableDamping: boolean;
  dampingFactor: number;
  minDistance: number;
  maxDistance: number;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
}

const LAMINATE = "#e9ecef";
const REL_SIZE = 4;
/** The view a reset returns to: from the front, a little above. */
const FRONT = { x: 0.2, y: 0.3, z: 0.93 };
const IDLE_MS = 1500;
const shorten = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const rgba = (hex: string, a: number) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;
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

export default function GraphCanvas3D({
  nodes,
  edges,
  positions,
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
}: {
  nodes: Node3D[];
  edges: Edge3D[];
  positions: ReadonlyMap<string, Point3>;
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
}) {
  const g = useKnowledgeStrings().graph;
  const hintId = useId();
  const fg = useRef<ForceGraphMethods | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const labelEls = useRef(new Map<string, HTMLSpanElement>());
  const sizes = useRef(new Map<string, [number, number]>());
  const shown = useRef(new Set<string>());
  const screen = useRef(new Map<string, { id: string; x: number; y: number }>());
  const hover = useRef<string | null>(null);
  const stopTravel = useRef<() => void>(() => {});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // What the selection relates to stays bright; the rest fades.
  const { related, lit } = useMemo(() => {
    if (!selected) return { related: null, lit: new Set<string>() };
    const keep = new Set<string>();
    const on = new Set<string>();
    for (const e of edges) {
      if (selected.kind === "node" ? e.source === selected.id || e.target === selected.id : e.id === selected.id) {
        on.add(e.id);
        keep.add(e.source).add(e.target);
      }
    }
    if (selected.kind === "node") keep.add(selected.id);
    return { related: keep, lit: on };
  }, [selected, edges]);
  const chosen = selected?.kind === "node" ? selected.id : null;
  const value = (n: Node3D) => (n.type === "document" ? 22 : n.type === "section" ? 1.6 : 2 + Math.min(n.degree, 16) * 0.5) * (n.id === chosen ? 1.7 : 1);
  const radius = (n: Node3D) => Math.cbrt(value(n)) * REL_SIZE;

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
  const nodeVal = useMemo(() => (o: NodeObject) => value(byId.get(String(o.id))!), [byId, chosen]);
  const nodeColor = useMemo(
    () => (o: NodeObject) => {
      const id = String(o.id);
      if (id === chosen) return LAMINATE;
      const c = colors[String(o.type)] ?? "#9ba1a8";
      return related && !related.has(id) ? rgba(c, 0.12) : c;
    },
    [chosen, related, colors],
  );
  const linkColor = useMemo(
    () => (o: LinkObject) => (lit.has(String(o.id)) ? rgba(LAMINATE, 0.9) : related ? "rgba(123, 130, 139, 0.07)" : "rgba(155, 161, 168, 0.24)"),
    [lit, related],
  );
  const linkWidth = useMemo(() => (o: LinkObject) => (lit.has(String(o.id)) ? 1.1 : 0), [lit]);
  const arrow = useMemo(() => (o: LinkObject) => (lit.has(String(o.id)) ? 5 : 0), [lit]);

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

  const cam = () => fg.current?.camera() as unknown as Camera3 | undefined;
  const orbit = () => fg.current?.controls() as unknown as Orbit | undefined;
  const place = (to: V3, look: V3, animate: boolean) => {
    const c = cam();
    const t = orbit()?.target;
    if (!c || !t) return;
    stopTravel.current();
    const apply = (v: { x: number; y: number; z: number; lx: number; ly: number; lz: number }) => {
      fg.current?.cameraPosition({ x: v.x, y: v.y, z: v.z }, { x: v.lx, y: v.ly, z: v.lz }, 0);
      wake();
    };
    const goal = { x: to.x, y: to.y, z: to.z, lx: look.x, ly: look.y, lz: look.z };
    if (!animate) return apply(goal);
    stopTravel.current = motion.travel({ x: c.position.x, y: c.position.y, z: c.position.z, lx: t.x, ly: t.y, lz: t.z }, goal, apply);
  };
  /**
   * Where the camera goes to show these nodes, looking along `dir` (from the scene to the
   * camera): centred on `centre` (or on the nodes' extent across the view) and just far
   * enough back that every one of them, and room for its name, is on screen.
   */
  const framing = (ids: string[], dir: V3, centre?: V3) => {
    const c = cam();
    const ps = ids.map((id) => positions.get(id)).filter((p): p is Point3 => Boolean(p));
    if (!c || !ps.length) return null;
    const d = unit(dir);
    const r0 = cross({ x: 0, y: 1, z: 0 }, d);
    const right = len(r0) > 1e-3 ? unit(r0) : { x: 1, y: 0, z: 0 };
    const up = cross(d, right);
    let mid = centre;
    if (!mid) {
      const xs = ps.map((p) => dot(p, right));
      const ys = ps.map((p) => dot(p, up));
      const zs = ps.reduce((sum, p) => sum + dot(p, d), 0) / ps.length;
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      mid = { x: right.x * cx + up.x * cy + d.x * zs, y: right.y * cx + up.y * cy + d.y * zs, z: right.z * cx + up.z * cy + d.z * zs };
    }
    const tv = Math.tan((c.fov * Math.PI) / 360);
    const th = tv * (size.w / Math.max(size.h, 1));
    let dist = 60;
    for (const p of ps) {
      const q = sub(p, mid);
      // Room for the node and, below it, its name.
      dist = Math.max(dist, dot(q, d) + (Math.abs(dot(q, right)) + 16) / th, dot(q, d) + (Math.abs(dot(q, up)) + 22) / tv);
    }
    return { at: along(mid, d, dist * 1.06), look: mid };
  };
  const fit = (animate: boolean, from: V3 | null) => {
    const c = cam();
    const t = orbit()?.target;
    const f = c && t && framing(nodes.map((n) => n.id), from ?? sub(c.position, t));
    if (f) place(f.at, f.look, animate);
  };
  const flyTo = (id: string) => {
    const p = positions.get(id);
    const c = cam();
    const t = orbit()?.target;
    if (!p || !c || !t) return;
    const near = edges.filter((e) => e.source === id || e.target === id).map((e) => (e.source === id ? e.target : e.source));
    const f = framing([id, ...near], sub(c.position, t), p);
    if (f) place(f.at, f.look, true);
  };
  const zoom = (factor: number) => {
    const c = cam();
    const t = orbit()?.target;
    if (!c || !t) return;
    const d = Math.min(Math.max(len(sub(c.position, t)) * factor, 30), 6000);
    place(along(t, sub(c.position, t), d), t, false);
  };
  /** Turn the view round its centre: left and right round the vertical, up and down over it. */
  const turn = (dx: number, dy: number) => {
    const c = cam();
    const t = orbit()?.target;
    if (!c || !t) return;
    const o = sub(c.position, t);
    const r = len(o);
    const theta = Math.atan2(o.x, o.z) - dx * (Math.PI / 12);
    const phi = Math.min(Math.max(Math.acos(Math.min(Math.max(o.y / r, -1), 1)) + dy * (Math.PI / 18), 0.15), Math.PI - 0.15);
    place({ x: t.x + r * Math.sin(phi) * Math.sin(theta), y: t.y + r * Math.cos(phi), z: t.z + r * Math.sin(phi) * Math.cos(theta) }, t, false);
  };

  // ---- names over the canvas -------------------------------------------------------------
  draw.current = () => {
    const f = fg.current;
    const c = cam();
    const t = orbit()?.target;
    if (!f || !c || !t || !size.w) return;
    const fwd = sub(t, c.position);
    const fl = len(fwd);
    const focal = size.h / 2 / Math.tan((c.fov * Math.PI) / 360);
    const boxes: LabelBox[] = [];
    const at = new Map<string, { id: string; x: number; y: number; r: number }>();
    const keyboard = document.activeElement === wrap.current;
    for (const n of nodes) {
      const p = positions.get(n.id);
      if (!p) continue;
      const depth = ((p.x - c.position.x) * fwd.x + (p.y - c.position.y) * fwd.y + (p.z - c.position.z) * fwd.z) / fl;
      if (depth < 4) continue; // behind the camera
      const s = f.graph2ScreenCoords(p.x, p.y, p.z);
      const r = (radius(n) * focal) / depth;
      at.set(n.id, { id: n.id, x: s.x, y: s.y, r });
      const near = related?.has(n.id);
      const priority =
        n.id === chosen ? 100
        : n.id === focusId && keyboard ? 95
        : n.id === hover.current ? 90
        : near ? 70 + n.degree / 100
        : related ? (n.type === "document" ? 20 : 0)
        : n.type === "document" ? 50
        : n.important ? 40 + n.degree / 100
        : r >= 7 ? 10 + r / 100
        : 0;
      if (!priority) continue;
      let wh = sizes.current.get(n.id);
      const el = labelEls.current.get(n.id);
      if (!wh && el) sizes.current.set(n.id, (wh = [el.offsetWidth, el.offsetHeight]));
      if (!wh) continue;
      let x = s.x - wh[0] / 2;
      let y = s.y + r + 3;
      if (priority >= 60) {
        // The chosen node and what it relates to keep their names at the edge of the view.
        x = Math.min(Math.max(x, 2), size.w - wh[0] - 2);
        y = Math.min(Math.max(y, 2), size.h - wh[1] - 2);
      }
      boxes.push({ id: n.id, x, y, w: wh[0], h: wh[1], priority });
    }
    const keep = declutter(boxes, size.w, size.h);
    for (const b of boxes) {
      const el = labelEls.current.get(b.id);
      if (!el) continue;
      if (keep.has(b.id)) {
        el.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px)`;
        el.dataset.show = "";
      }
    }
    for (const id of shown.current) if (!keep.has(id)) delete labelEls.current.get(id)?.dataset.show;
    shown.current = keep;
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

  // The controls: a short glide after a drag (none with reduced motion), and a wake on
  // every camera change so names follow. A lost context hands over to the 2D view.
  const ready = size.w > 0;
  useEffect(() => {
    const o = orbit();
    const canvas = fg.current?.renderer()?.domElement as HTMLCanvasElement | undefined;
    if (!o || !canvas) return;
    o.enableDamping = !reducedMotion();
    o.dampingFactor = 0.14;
    o.minDistance = 30;
    o.maxDistance = 6000;
    const changed = () => wake();
    const lost = (e: Event) => (e.preventDefault(), onFail());
    o.addEventListener("change", changed);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      o.removeEventListener("change", changed);
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
    fit(!first, first ? FRONT : null);
  }, [layoutKey, ready, nodes.length]);

  // Fly to a requested node; the keyboard carries on from there.
  useEffect(() => {
    if (!focus || !ready || !positions.has(focus.id)) return;
    flyTo(focus.id);
    setFocusId(focus.id);
  }, [focus?.id, focus?.n, ready]);

  // A chosen relationship: both ends in view.
  const chosenEdge = selected?.kind === "edge" ? edges.find((e) => e.id === selected.id) : undefined;
  useEffect(() => {
    const c = cam();
    const t = orbit()?.target;
    const a = chosenEdge && positions.get(chosenEdge.source);
    const b = chosenEdge && positions.get(chosenEdge.target);
    if (!ready || !chosenEdge || !a || !b || !c || !t) return;
    const f = framing([chosenEdge.source, chosenEdge.target], sub(c.position, t), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    if (f) place(f.at, f.look, true);
  }, [chosenEdge?.id, ready]);

  // Names are measured once per graph.
  useEffect(() => sizes.current.clear(), [nodes]);

  // ---- keyboard ---------------------------------------------------------------------------
  const current = focusId && byId.has(focusId) ? focusId : chosen && byId.has(chosen) ? chosen : nodes.toSorted((a, b) => b.degree - a.degree)[0]?.id;
  const [announce, setAnnounce] = useState("");
  const focusNode = (id: string) => {
    setFocusId(id);
    setAnnounce(g.focused(describe(byId.get(id)!)));
    const p = screen.current.get(id);
    if (!p || p.x < 24 || p.y < 24 || p.x > size.w - 24 || p.y > size.h - 24) {
      // Off screen: bring it to the middle without turning (keys do not animate).
      const q = positions.get(id);
      const c = cam();
      const t = orbit()?.target;
      if (q && c && t) place(along(q, sub(c.position, t), len(sub(c.position, t))), q, false);
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
    else if (e.key === "r" || e.key === "R") fit(true, FRONT);
  };

  return (
    <div className="kn-3d-frame">
      <div
        ref={wrap}
        className="kn-3d"
        data-lenis-prevent
        role="application"
        aria-label={label}
        aria-describedby={hintId}
        tabIndex={0}
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
        onPointerLeave={() => ((hover.current = null), wake())}
        onWheel={wake}
        onBlur={wake}
      >
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
            nodeRelSize={REL_SIZE}
            nodeVal={nodeVal}
            nodeColor={nodeColor}
            nodeOpacity={1}
            nodeResolution={14}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkOpacity={1}
            linkDirectionalArrowLength={arrow}
            linkDirectionalArrowColor={linkColor}
            linkDirectionalArrowRelPos={1}
            linkHoverPrecision={3}
            enableNodeDrag={false}
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
          {nodes.map((n) => (
            <span
              key={n.id}
              ref={(el) => {
                if (el) labelEls.current.set(n.id, el);
                else labelEls.current.delete(n.id);
              }}
              className={`kn-3d__label${n.id === chosen ? " kn-3d__label--on" : ""}${n.type === "document" ? " kn-3d__label--doc" : ""}${related && !related.has(n.id) ? " kn-3d__label--dim" : ""}`}
              data-node-id={n.id}
              style={{ "--kn-c": n.id === chosen ? undefined : colors[n.type] } as React.CSSProperties}
              onClick={() => onSelect({ kind: "node", id: n.id })}
              onPointerEnter={() => ((hover.current = n.id), wake())}
              onPointerLeave={() => ((hover.current = hover.current === n.id ? null : hover.current), wake())}
            >
              <ShapeGlyph shape={shapes[n.type] ?? "circle"} size={10} />
              {shorten(n.label)}
            </span>
          ))}
          <div ref={ring} className="kn-3d__ring" />
        </div>
      </div>
      <div className="kn-canvas__tools">
        <button type="button" className="icon-button" aria-label={g.zoomIn} title={g.zoomIn} onClick={() => zoom(0.8)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label={g.zoomOut} title={g.zoomOut} onClick={() => zoom(1.25)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" className="button button--small button--quiet" onClick={() => fit(true, null)}>
          {g.fit}
        </button>
        <button type="button" className="button button--small button--quiet" onClick={() => fit(true, FRONT)}>
          {g.resetView}
        </button>
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
