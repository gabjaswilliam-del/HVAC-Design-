/**
 * The knowledge graph, drawn from the index itself: documents, sections and the entities
 * the vocabulary found, joined only by relationships that have source evidence. Bounded:
 * the overview shows the best-connected nodes (150 at most) with what the filters allow;
 * expanding a node adds its neighbours, up to 300 nodes in view.
 *
 * Two views of the same graph and the same address: 3D (the default where the browser can
 * draw it), clustered by document, and the 2D explorer. High-contrast mode opens in 2D,
 * which follows the system colours; a browser without WebGL, or a lost graphics context,
 * gets 2D with a sentence saying why.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { RotateCcw, Search } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { EDGE_TYPES, NODE_TYPES, type EdgeType, type GraphEdge, type GraphNode, type NodeType } from "../../../lib/contracts/knowledge";
import { Notice } from "../../../components/Notice";
import { RadioGroup } from "../../../components/RadioGroup";
import { GraphCanvas, ShapeGlyph, type PlacedNode, type Shape } from "../graph/GraphCanvas";
import { clusterLayout3d, forceLayout, type Point, type Point3 } from "../graph/layout";
import type { Inspect, RagNav } from "./RagWorkspace";

const GraphCanvas3D = lazy(() => import("../graph/GraphCanvas3D"));

export const KNOWLEDGE_SHAPES: Record<NodeType, Shape> = {
  document: "page",
  section: "tile",
  equipment: "hexagon",
  component: "square",
  fault: "triangle",
  symptom: "diamond",
  procedure: "bars",
  standard: "chevron",
  concept: "ring",
};

/** What the types are for: where it is written, the plant and its physics, what goes
 *  wrong, and what to do or comply with. */
export const KNOWLEDGE_FAMILIES = {
  sources: ["document", "section"],
  plant: ["equipment", "component", "concept"],
  problems: ["fault", "symptom"],
  guidance: ["procedure", "standard"],
} as const satisfies Record<string, readonly NodeType[]>;

/**
 * One colour per family; the sources in paper and graphite. Checked with the dataviz
 * validator against the graph's surface (#1A1D21) with every pair side by side, as nodes
 * in a graph can be: worst colour-vision separation ΔE 11.3 (protanopia and deuteranopia),
 * worst normal-vision separation 15.8, each at least 3:1 against the surface, and none
 * near the alarm red or the warning orange. Nine types cannot each keep a colour that
 * stays distinct that way, so colour names the family and the shape and name tell its
 * types apart.
 */
export const KNOWLEDGE_COLORS: Record<NodeType, string> = {
  document: "#c8c2b6",
  section: "#6a707a",
  equipment: "#20aa8b",
  component: "#20aa8b",
  concept: "#20aa8b",
  fault: "#9f8418",
  symptom: "#9f8418",
  procedure: "#5e56de",
  standard: "#5e56de",
};

const OVERVIEW = 150;
const IN_VIEW = 300;

let webgl: boolean | undefined;
/** Whether this browser can draw WebGL (asked once; the test context is released). */
function canDraw3d() {
  if (webgl === undefined) {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      webgl = Boolean(gl);
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
const forcedColors = () => typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches;

/** If the 3D view throws (a graphics context that cannot be created), show 2D instead. */
class ThreeGuard extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function KnowledgeGraphView({
  client,
  nav,
  selected,
  revision,
  expanded,
  onReset,
}: {
  client: KnowledgeClient;
  nav: RagNav;
  selected: Inspect;
  revision: number;
  expanded: string[];
  onReset: () => void;
}) {
  const t = useKnowledgeStrings();
  const s = t.graph;
  const [params, setParams] = useSearchParams();
  const [types, setTypes] = useState<NodeType[]>([...NODE_TYPES]);
  const [edgeTypes, setEdgeTypes] = useState<EdgeType[]>([...EDGE_TYPES]);
  const [find, setFind] = useState("");
  const allEdges = edgeTypes.length === EDGE_TYPES.length;
  const base = useResource(`kg:${types.join()}:${edgeTypes.join()}:${revision}`, "kgraph", (signal) =>
    client.getKnowledgeGraph({ types, edgeTypes: allEdges ? undefined : edgeTypes, limit: OVERVIEW }, { signal }),
  );
  // A node chosen elsewhere (a search result's entity, a passage) is shown with its
  // neighbours even when the overview did not include it.
  const focusId = selected?.kind === "node" ? selected.id : null;
  const wanted = useMemo(() => [...new Set([...expanded, ...(focusId ? [focusId] : [])])], [expanded, focusId]);
  const extra = useResource(wanted.length ? `kx:${wanted.join()}:${revision}` : null, "kexpand", (signal) =>
    Promise.all(wanted.map((id) => client.expandKnowledgeNode(id, { limit: 40, edgeTypes: allEdges ? undefined : edgeTypes }, { signal }).catch(() => null))),
  );

  // 3D where it can be drawn, unless the address asks for 2D (high contrast opens in 2D).
  const can3d = useMemo(canDraw3d, []);
  const forced = useMemo(forcedColors, []);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const asked = params.get("gv");
  const preferred = forced ? "2d" : "3d";
  const dims = !can3d || failed ? "2d" : asked === "2d" || asked === "3d" ? asked : preferred;
  const setDims = (v: "2d" | "3d") =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (v === preferred) next.delete("gv");
      else next.set("gv", v);
      return next;
    });

  const graph = useMemo(() => {
    const nodes = new Map<string, GraphNode>((base.data?.nodes ?? []).map((n) => [n.id, n]));
    const edges = new Map<string, GraphEdge>((base.data?.edges ?? []).map((e) => [e.id, e]));
    let capped = false;
    for (const detail of extra.data ?? []) {
      if (!detail) continue;
      for (const n of [detail.node, ...detail.neighbours.nodes]) {
        if (nodes.has(n.id)) continue;
        if (nodes.size >= IN_VIEW) {
          capped = true;
          continue;
        }
        nodes.set(n.id, n);
      }
      for (const e of detail.neighbours.edges) edges.set(e.id, e);
    }
    const kept = [...edges.values()].filter((e) => nodes.has(e.source) && nodes.has(e.target));
    return { nodes: [...nodes.values()], edges: kept, capped };
  }, [base.data, extra.data]);

  // Positions: deterministic, and nodes already on screen keep theirs when the graph grows.
  // (Read in render, written after commit: a render React repeats lays out the same.)
  // Only the view on screen is laid out.
  const previous = useRef<{ key: string; at: Map<string, Point> }>({ key: "", at: new Map() });
  const previous3 = useRef<{ key: string; at: Map<string, Point3> }>({ key: "", at: new Map() });
  const baseKey = `${types.join()}|${edgeTypes.join()}|${revision}`;
  const positions = useMemo(
    () =>
      dims === "2d"
        ? forceLayout(
            graph.nodes.map((n) => n.id),
            graph.edges,
            previous.current.key === baseKey ? previous.current.at : new Map(),
          )
        : new Map<string, Point>(),
    [graph, baseKey, dims],
  );
  const positions3 = useMemo(
    () => (dims === "3d" ? clusterLayout3d(graph.nodes, graph.edges, previous3.current.key === baseKey ? previous3.current.at : new Map()) : new Map<string, Point3>()),
    [graph, baseKey, dims],
  );
  useEffect(() => {
    if (dims === "2d") previous.current = { key: baseKey, at: positions };
    else previous3.current = { key: baseKey, at: positions3 };
  }, [positions, positions3, baseKey, dims]);
  const topDegree = useMemo(() => [...graph.nodes].sort((a, b) => b.degree - a.degree)[Math.min(7, graph.nodes.length - 1)]?.degree ?? 0, [graph.nodes]);
  const important = (n: GraphNode) => n.type === "document" || n.degree >= topDegree;
  const placed: PlacedNode[] = dims === "2d" ? graph.nodes.map((n) => ({ ...n, ...positions.get(n.id)!, important: important(n) })) : [];
  const nodes3 = useMemo(() => graph.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, degree: n.degree, important: n.type === "document" || n.degree >= topDegree })), [graph.nodes, topDegree]);

  const laidOut = dims === "2d" ? positions : positions3;
  // Go to a newly chosen node, and again when expanding it adds nodes (not when the same
  // graph is merely laid out again).
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const focused = useRef<{ id: string | null; size: number }>({ id: null, size: 0 });
  useEffect(() => {
    if (focusId && laidOut.has(focusId)) {
      if (focused.current.id === focusId && focused.current.size === laidOut.size) return;
      focused.current = { id: focusId, size: laidOut.size };
      setFocus((f) => ({ id: focusId, n: (f?.n ?? 0) + 1 }));
    } else if (!focusId) {
      focused.current = { id: null, size: 0 };
      setFocus(null); // a view opened later fits the whole graph
    }
  }, [focusId, laidOut]);

  const matches = find.trim().length > 1 ? graph.nodes.filter((n) => n.label.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 8) : [];
  const counts = new Map<string, number>();
  for (const n of base.data?.nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const toggle = <T extends string>(list: T[], v: T, set: (x: T[]) => void) => {
    const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
    if (next.length) set(next);
  };
  const selection = selected && (selected.kind === "node" || selected.kind === "edge") ? { kind: selected.kind, id: selected.id } : null;
  const onSelect = (sel: { kind: "node" | "edge"; id: string } | null) => nav.inspect(sel ? { kind: sel.kind, id: sel.id } : null, "graph");
  const describe = (n: { id: string; type: string; label: string }) => s.nodeLabel(t.types[n.type as NodeType] ?? n.type, n.label, graph.nodes.find((x) => x.id === n.id)?.degree ?? 0);

  return (
    <section className="kn-section kn-graphview" aria-labelledby="kn-graph-title">
      <div className="kn-section__head">
        <h2 id="kn-graph-title">{s.title}</h2>
        {base.data && (
          <span className="kn-count" role="status">
            {s.count(graph.nodes.length, graph.edges.length)}
          </span>
        )}
        <RadioGroup
          className="segmented--small kn-dims"
          label={s.view.label}
          value={dims}
          onChange={setDims}
          options={[
            { value: "3d", label: s.view.three, disabled: !can3d || failed },
            { value: "2d", label: s.view.two },
          ]}
        />
        {expanded.length > 0 && (
          <button type="button" className="button button--small button--quiet kn-section__action" onClick={onReset}>
            <RotateCcw size={14} aria-hidden="true" />
            {s.reset}
          </button>
        )}
      </div>
      {!can3d && <p className="kn-note">{s.view.noWebgl}</p>}
      {failed && <Notice tone="warning">{s.view.failed}</Notice>}
      {can3d && !failed && forced && !asked && <p className="kn-note">{s.view.forcedColors}</p>}
      <div className="kn-families" role="group" aria-label={s.typesLabel}>
        {(Object.keys(KNOWLEDGE_FAMILIES) as (keyof typeof KNOWLEDGE_FAMILIES)[]).map((family) => (
          <div key={family} className="kn-family" role="group" aria-labelledby={`kn-family-${family}`}>
            <span id={`kn-family-${family}`} className="kn-family__name">
              {s.families[family]}
            </span>
            {KNOWLEDGE_FAMILIES[family].map((type) => (
              <button key={type} type="button" className="kn-filter" aria-pressed={types.includes(type)} onClick={() => toggle(types, type, setTypes)}>
                <ShapeGlyph shape={KNOWLEDGE_SHAPES[type]} color={KNOWLEDGE_COLORS[type]} />
                {t.types[type]}
                {counts.has(type) && <span className="kn-chip-count">{counts.get(type)}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="kn-graphtools">
        <div className="kn-find">
          <Search size={15} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="kn-find">
            {s.find}
          </label>
          <input
            id="kn-find"
            type="search"
            value={find}
            placeholder={s.findPlaceholder}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => {
              // Enter takes the first match: find, then fly to it.
              if (e.key === "Enter" && matches[0]) (setFind(""), nav.inspect({ kind: "node", id: matches[0].id }, "graph"));
            }}
            autoComplete="off"
          />
          {matches.length > 0 && (
            <ul className="kn-find__list" aria-label={s.matches(matches.length)}>
              {matches.map((n) => (
                <li key={n.id}>
                  <button type="button" className="kn-rowlink" onClick={() => (setFind(""), nav.inspect({ kind: "node", id: n.id }, "graph"))}>
                    <ShapeGlyph shape={KNOWLEDGE_SHAPES[n.type]} color={KNOWLEDGE_COLORS[n.type]} />
                    {n.label}
                    <span className="kn-meta">{t.types[n.type]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {find.trim().length > 1 && !matches.length && <span className="kn-meta">{s.noMatch}</span>}
        </div>
        <details className="kn-edgefilter">
          <summary>{allEdges ? s.edgesAll : s.edgesSome(edgeTypes.length, EDGE_TYPES.length)}</summary>
          <div className="kn-filters" role="group" aria-label={s.edgesLabel}>
            {EDGE_TYPES.map((type) => (
              <button key={type} type="button" className="kn-filter" aria-pressed={edgeTypes.includes(type)} onClick={() => toggle(edgeTypes, type, setEdgeTypes)}>
                {t.relationNames[type]}
              </button>
            ))}
          </div>
        </details>
      </div>
      {base.data?.truncated && <p className="kn-note">{s.truncated(base.data.nodes.length, base.data.total)}</p>}
      {graph.capped && <p className="kn-note">{s.capped(IN_VIEW)}</p>}
      {base.error && (
        <Notice tone="critical" action={{ label: t.rag.retry, onClick: base.retry }}>
          {s.failed(base.error.message)}
        </Notice>
      )}
      {!base.data && !base.error && (
        <p className="kn-loading" role="status">
          {s.loading}
        </p>
      )}
      {base.data && !graph.nodes.length && <p className="kn-empty">{s.empty}</p>}
      {graph.nodes.length > 0 && dims === "2d" && (
        <GraphCanvas
          nodes={placed}
          edges={graph.edges}
          shapes={KNOWLEDGE_SHAPES}
          colors={KNOWLEDGE_COLORS}
          selected={selection}
          onSelect={onSelect}
          label={s.canvasLabel(graph.nodes.length, graph.edges.length)}
          hint={s.hint}
          describe={describe}
          layoutKey={baseKey}
          focus={focus}
        />
      )}
      {graph.nodes.length > 0 && dims === "3d" && (
        <ThreeGuard onError={fail}>
          <Suspense
            fallback={
              <p className="kn-loading kn-3d-loading" role="status">
                {s.view.loading}
              </p>
            }
          >
            <GraphCanvas3D
              nodes={nodes3}
              edges={graph.edges}
              positions={positions3}
              colors={KNOWLEDGE_COLORS}
              shapes={KNOWLEDGE_SHAPES}
              selected={selection}
              onSelect={onSelect}
              label={s.canvas3dLabel(graph.nodes.length, graph.edges.length)}
              hint={s.hint3d}
              keys={s.keys3d}
              describe={describe}
              layoutKey={baseKey}
              focus={focus}
              onFail={fail}
            />
          </Suspense>
        </ThreeGuard>
      )}
      {graph.nodes.length > 0 && <p className="kn-meta">{s.legendNote}</p>}
    </section>
  );
}
