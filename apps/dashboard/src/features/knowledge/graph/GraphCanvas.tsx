/**
 * The graph explorer's canvas, shared by Graph RAG (its 2D view) and Graph Memory: placed
 * nodes and edges in SVG, drawn in graphite (the knowledge graph's in its families'
 * colours) with laminate only for the selection. Nothing moves on its own: positions come
 * from the layout, and the only motion is the camera gliding to a chosen node.
 *
 * Pointer: drag the background to pan, wheel to zoom around the pointer, click a node or
 * a relationship to inspect it. Keyboard: the graph is one tab stop; arrow keys move to
 * the nearest node in that direction, Enter or Space inspects it, Escape clears, + and −
 * zoom, 0 fits. The page's smooth scrolling leaves the wheel to the canvas.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import type { Point } from "./layout";

export type Shape = "circle" | "ring" | "square" | "diamond" | "triangle" | "hexagon" | "page" | "tile" | "pill" | "bars" | "chevron";

export interface PlacedNode extends Point {
  id: string;
  type: string;
  label: string;
  /** Drawn with a dashed outline (a superseded version). */
  dashed?: boolean;
  /** A scope eyelet in the notice colour (simulation). */
  scope?: boolean;
  /** Labelled even when zoomed out. */
  important?: boolean;
}
export interface PlacedEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  /** Derived, not stored (drawn dashed). */
  derived?: boolean;
}
export type Selection = { kind: "node" | "edge"; id: string } | null;

const PATHS: Record<Shape, string> = {
  circle: "M0,-8a8,8 0 1,0 0.01,0Z",
  ring: "M0,-8a8,8 0 1,0 0.01,0ZM0,-3.5a3.5,3.5 0 1,1 -0.01,0Z",
  square: "M-7,-7H7V7H-7Z",
  diamond: "M0,-9L9,0L0,9L-9,0Z",
  triangle: "M0,-9L9,7H-9Z",
  hexagon: "M-4.6,-8H4.6L9.2,0L4.6,8H-4.6L-9.2,0Z",
  page: "M-7,-9H3L7,-5V9H-7Z",
  tile: "M-5,-4H5V4H-5Z",
  pill: "M-6,-6H6A6,6 0 0 1 6,6H-6A6,6 0 0 1 -6,-6Z",
  bars: "M-8,-7H8V-3H-8ZM-8,-1H8V3H-8ZM-8,5H8V9H-8Z",
  chevron: "M-7,-8H3L9,0L3,8H-7L-1,0Z",
};
const RADIUS = 10;

/** The shape as a small inline glyph, for legends and filter chips (in its family's colour
 *  when one is given). */
export function ShapeGlyph({ shape, size = 12, color }: { shape: Shape; size?: number; color?: string }) {
  return (
    <svg className="kn-glyph" width={size} height={size} viewBox="-10 -10 20 20" aria-hidden="true" style={color ? { fill: color } : undefined}>
      <path d={PATHS[shape]} fillRule="evenodd" />
    </svg>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const shorten = (s: string, n = 30) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function GraphCanvas({
  nodes,
  edges,
  shapes,
  selected,
  onSelect,
  label,
  hint,
  describe,
  layoutKey,
  focus,
  underlay,
  labelAll,
  colors,
}: {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  shapes: Record<string, Shape>;
  /** A fill per node type (the knowledge graph's families); graphite without. */
  colors?: Record<string, string>;
  selected: Selection;
  onSelect: (s: Selection) => void;
  label: string;
  hint: string;
  describe: (n: PlacedNode) => string;
  /** When this changes the view fits the graph again. */
  layoutKey: string;
  /** Bring this node into view (the counter re-requests the same node). */
  focus?: { id: string; n: number } | null;
  /** Drawn under the edges, in graph coordinates (the memory graph's lanes). */
  underlay?: ReactNode;
  /** Name every node at any zoom (default: when there are few). Otherwise names show for
   *  important nodes, the chosen one and its neighbours, and everything once zoomed in. */
  labelAll?: boolean;
}) {
  const g = useKnowledgeStrings().graph;
  const hintId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const stopGlide = useRef<() => void>(() => {});
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const apply = () => {
    const { x, y, k } = cam.current;
    layer.current?.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)})`);
    // Names stay the same size on screen at any zoom (CSS divides by --k).
    layer.current?.style.setProperty("--k", k.toFixed(4));
  };
  const settleZoom = useRef(0);
  const zoomed = () => {
    window.clearTimeout(settleZoom.current);
    settleZoom.current = window.setTimeout(() => setZoom(cam.current.k), 120);
  };
  const moveTo = (to: { x: number; y: number; k: number }, animate: boolean) => {
    stopGlide.current();
    if (!animate) {
      cam.current = to;
      apply();
      zoomed();
      return;
    }
    stopGlide.current = motion.glide({ ...cam.current }, to, (v) => {
      cam.current = { x: v.x, y: v.y, k: v.k };
      apply();
    });
    window.setTimeout(zoomed, 340);
  };
  const fitView = (animate: boolean) => {
    if (!nodes.length || !size.w) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = clamp(Math.min((size.w - 80) / Math.max(x1 - x0, 1), (size.h - 80) / Math.max(y1 - y0, 1)), 0.2, 1.6);
    moveTo({ k, x: size.w / 2 - ((x0 + x1) / 2) * k, y: size.h / 2 - ((y0 + y1) / 2) * k }, animate);
  };
  const zoomBy = (factor: number, px = size.w / 2, py = size.h / 2) => {
    const { x, y, k } = cam.current;
    const nk = clamp(k * factor, 0.2, 4);
    moveTo({ k: nk, x: px - ((px - x) * nk) / k, y: py - ((py - y) * nk) / k }, false);
  };

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new graph (or the first size) fits the view; expanding keeps the camera.
  const fitted = useRef("");
  useEffect(() => {
    if (!size.w || fitted.current === layoutKey) return;
    const first = fitted.current === "";
    fitted.current = layoutKey;
    fitView(!first);
  }, [layoutKey, size.w, size.h]);

  // Bring a requested node into view: centred, at a readable zoom.
  useEffect(() => {
    const n = focus ? byId.get(focus.id) : undefined;
    if (!n || !size.w) return;
    const k = Math.max(cam.current.k, 1.1);
    moveTo({ k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k }, true);
    setFocusId(n.id);
  }, [focus?.id, focus?.n, size.w]);

  // The wheel zooms here; it is not passive, so the page does not scroll as well.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  useEffect(() => () => (stopGlide.current(), window.clearTimeout(settleZoom.current)), []);

  // Pan by dragging the background; a press that does not move clears the selection.
  const drag = useRef<{ id: number; px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || (e.target as Element).closest(".kn-node, .kn-edge")) return;
    stopGlide.current();
    drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, x: cam.current.x, y: cam.current.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    cam.current = { ...cam.current, x: d.x + dx, y: d.y + dy };
    apply();
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) onSelect(null);
  };

  // Keyboard: the nearest node in the arrow's direction.
  const current = focusId && byId.has(focusId) ? focusId : selected?.kind === "node" && byId.has(selected.id) ? selected.id : nodes[0]?.id;
  const focusNode = (id: string) => {
    setFocusId(id);
    const n = byId.get(id)!;
    const { x, y, k } = cam.current;
    const sx = n.x * k + x;
    const sy = n.y * k + y;
    if (sx < 30 || sy < 30 || sx > size.w - 30 || sy > size.h - 30) moveTo({ k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k }, true);
    requestAnimationFrame(() => nodeEls.current.get(id)?.focus({ preventScroll: true }));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const from = current ? byId.get(current) : undefined;
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    if (dir && from) {
      e.preventDefault();
      let best: PlacedNode | undefined;
      let bestScore = Infinity;
      for (const n of nodes) {
        if (n.id === from.id) continue;
        const vx = n.x - from.x;
        const vy = n.y - from.y;
        const along = vx * dir[0] + vy * dir[1];
        if (along <= 0) continue;
        const across = Math.abs(vx * dir[1] - vy * dir[0]);
        if (across > along * 1.8) continue;
        const score = along + across * 2;
        if (score < bestScore) (bestScore = score), (best = n);
      }
      if (best) focusNode(best.id);
      return;
    }
    if ((e.key === "Enter" || e.key === " ") && from) {
      e.preventDefault();
      onSelect({ kind: "node", id: from.id });
    } else if (e.key === "Escape" && selected) {
      e.preventDefault();
      onSelect(null);
    } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(0.8);
    else if (e.key === "0") fitView(true);
  };

  // What the selection relates to stays bright; the rest dims.
  const related = useMemo(() => {
    if (!selected) return null;
    const keep = new Set<string>();
    if (selected.kind === "node") {
      keep.add(selected.id);
      for (const e of edges) if (e.source === selected.id || e.target === selected.id) keep.add(e.source), keep.add(e.target);
    } else {
      const e = edges.find((x) => x.id === selected.id);
      if (e) keep.add(e.source), keep.add(e.target);
    }
    return keep;
  }, [selected, edges]);
  const few = labelAll ?? nodes.length <= 24;

  return (
    <div ref={wrap} className="kn-canvas" data-lenis-prevent>
      <svg
        ref={svg}
        className="kn-canvas__svg"
        role="group"
        aria-label={label}
        aria-describedby={hintId}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        <defs>
          <marker id="kn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1L9,5L0,9Z" className="kn-arrow" />
          </marker>
          <marker id="kn-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,1L9,5L0,9Z" className="kn-arrow kn-arrow--on" />
          </marker>
        </defs>
        <g ref={layer}>
          {underlay}
          {edges.map((e) => {
            const a = byId.get(e.source);
            const b = byId.get(e.target);
            if (!a || !b) return null;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.hypot(dx, dy) || 1;
            const r = RADIUS / Math.max(Math.min(zoom, 1), 0.6);
            const [x1, y1, x2, y2] = [a.x + (dx / d) * r, a.y + (dy / d) * r, b.x - (dx / d) * (r + 2), b.y - (dy / d) * (r + 2)];
            const on = selected?.kind === "edge" && selected.id === e.id;
            const lit = on || (selected?.kind === "node" && (e.source === selected.id || e.target === selected.id));
            return (
              <g
                key={e.id}
                className={`kn-edge${lit ? " kn-edge--lit" : ""}${on ? " kn-edge--on" : ""}${related && !lit ? " kn-dim" : ""}${e.derived ? " kn-edge--derived" : ""}`}
                onClick={() => onSelect({ kind: "edge", id: e.id })}
              >
                <line className="kn-edge__hit" x1={x1} y1={y1} x2={x2} y2={y2} />
                <line className="kn-edge__line" x1={x1} y1={y1} x2={x2} y2={y2} markerEnd={on ? "url(#kn-arrow-on)" : "url(#kn-arrow)"} />
              </g>
            );
          })}
          {nodes.map((n) => {
            const on = selected?.kind === "node" && selected.id === n.id;
            const near = related?.has(n.id);
            const showLabel = on || near || hover === n.id || current === n.id || n.important || few || zoom >= 1.25;
            return (
              <g
                key={n.id}
                ref={(el) => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                className={`kn-node${on ? " kn-node--on" : ""}${related && !near ? " kn-dim" : ""}${n.dashed ? " kn-node--dashed" : ""}`}
                data-node-id={n.id}
                data-type={n.type}
                style={colors?.[n.type] ? ({ "--kn-node": colors[n.type] } as React.CSSProperties) : undefined}
                transform={`translate(${n.x} ${n.y})`}
                role="button"
                tabIndex={current === n.id ? 0 : -1}
                aria-label={describe(n)}
                aria-pressed={on}
                onClick={() => {
                  setFocusId(n.id);
                  onSelect({ kind: "node", id: n.id });
                }}
                onFocus={() => setFocusId(n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
              >
                <circle className="kn-node__hit" r="14" />
                <path className="kn-node__shape" d={PATHS[shapes[n.type] ?? "circle"]} fillRule="evenodd" />
                {n.scope && <circle className="kn-node__scope" cx="8" cy="-8" r="3.2" />}
                {showLabel && (
                  <text className="kn-node__label" y={22 / Math.max(Math.min(zoom, 1), 0.6)} textAnchor="middle">
                    {shorten(n.label)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="kn-canvas__tools">
        <button type="button" className="icon-button" aria-label={g.zoomIn} title={g.zoomIn} onClick={() => zoomBy(1.25)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label={g.zoomOut} title={g.zoomOut} onClick={() => zoomBy(0.8)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" className="button button--small button--quiet" onClick={() => fitView(true)}>
          {g.fit}
        </button>
      </div>
      <p id={hintId} className="kn-canvas__hint">
        {hint}
      </p>
    </div>
  );
}
