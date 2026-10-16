/**
 * The RAG Graph, filling the workspace: drawn from the index itself (documents, sections
 * and the entities the vocabulary found, joined only by relationships that have source
 * evidence), with its controls floating over it. Bounded: the overview shows the
 * best-connected nodes (150 at most) with what the filters allow, and the documents that
 * leaves out (each is the centre of its group in 3D); expanding a node adds its neighbours,
 * up to 300 nodes in view.
 *
 * Over the graph: one search box (a node by name, or the passages for the words typed), the
 * library, and the filters with the legend at the top left; the view (3D or 2D), zoom, fit,
 * reset and help at the top right. Two views of the same graph and the same address: 3D
 * (the default where the browser can draw it), clustered by document, and the 2D explorer.
 * High-contrast mode opens in 2D, which follows the system colours; a browser without
 * WebGL, or a lost graphics context, gets 2D with a sentence saying why.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { CircleHelp, FileSearch, Library, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { useResource } from "../../../lib/api/useResource";
import type { KnowledgeClient } from "../../../lib/api/knowledge";
import { EDGE_TYPES, NODE_TYPES, type EdgeType, type GraphEdge, type GraphNode, type KnowledgeGraph, type NodeType } from "../../../lib/contracts/knowledge";
import { Notice } from "../../../components/Notice";
import { RadioGroup } from "../../../components/RadioGroup";
import { useDismissOutside, useEscapeLayer } from "../../../components/escape";
import { GraphCanvas, ShapeGlyph, type PlacedNode, type Shape } from "../graph/GraphCanvas";
import { forceLayout, planetaryLayout, type PlanetaryLayout, type Point } from "../graph/layout";
import { useMedia } from "../../../app/useMedia";
import { NARROW } from "../../../app/operatingContext";
import type { Drawer, Inspect, RagNav } from "./RagWorkspace";

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

/** An overview with the documents it left out added (within the view's limit), and how many
 *  were added. Nothing else changes: the nodes are the index's own. */
export function withDocuments(g: KnowledgeGraph, documents: readonly GraphNode[]): KnowledgeGraph & { added: number } {
  const ids = new Set(g.nodes.map((n) => n.id));
  const more = documents.filter((d) => !ids.has(d.id)).slice(0, Math.max(0, IN_VIEW - g.nodes.length));
  return { ...g, nodes: [...g.nodes, ...more], added: more.length };
}

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
  drawer,
  query,
  onNodes,
  onCount,
}: {
  client: KnowledgeClient;
  nav: RagNav;
  selected: Inspect;
  revision: number;
  expanded: string[];
  onReset: () => void;
  /** The list open beside the graph, if any. */
  drawer: Drawer | null;
  /** The passage search shown beside the graph (the search box shows it too). */
  query: string;
  /** The nodes in view (a search result says whether its section is among them). */
  onNodes: (ids: ReadonlySet<string>) => void;
  /** The node and relationship count, for the page's header. */
  onCount: (text: string | null) => void;
}) {
  const t = useKnowledgeStrings();
  const s = t.graph;
  const [params, setParams] = useSearchParams();
  const [types, setTypes] = useState<NodeType[]>([...NODE_TYPES]);
  const [edgeTypes, setEdgeTypes] = useState<EdgeType[]>([...EDGE_TYPES]);
  const allEdges = edgeTypes.length === EDGE_TYPES.length;
  const base = useResource(`kg:${types.join()}:${edgeTypes.join()}:${revision}`, "kgraph", async (signal) => {
    const overview = await client.getKnowledgeGraph({ types, edgeTypes: allEdges ? undefined : edgeTypes, limit: OVERVIEW }, { signal });
    // Documents are rarely among the best-connected; one cut out would leave its group
    // without a centre. (If asking for them fails, the overview stands as it is.)
    const docs = overview.truncated && types.includes("document") ? await client.getKnowledgeGraph({ types: ["document"], limit: IN_VIEW }, { signal }).then((d) => d.nodes, () => []) : [];
    return withDocuments(overview, docs);
  });
  // What is chosen is shown with its neighbours even when the overview did not include it
  // (a search result's entity, a passage's section); a document chosen in the library is
  // its group.
  const focusId = selected?.kind === "node" || selected?.kind === "doc" ? selected.id : null;
  const wanted = useMemo(() => [...new Set([...expanded, ...(focusId ? [focusId] : [])])], [expanded, focusId]);
  // Keyed even with nothing to ask (an empty answer at once), so what was added for an
  // earlier choice never shows again while the next choice loads.
  const extra = useResource(`kx:${wanted.join()}:${revision}`, "kexpand", (signal) =>
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
  const refocus = useRef(false);
  const setDims = (v: "2d" | "3d") => {
    if (v === dims) return;
    refocus.current = true;
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (v === preferred) next.delete("gv");
      else next.set("gv", v);
      return next;
    });
  };

  const graph = useMemo(() => {
    const nodes = new Map<string, GraphNode>((base.data?.nodes ?? []).map((n) => [n.id, n]));
    const edges = new Map<string, GraphEdge>((base.data?.edges ?? []).map((e) => [e.id, e]));
    let capped = false;
    // Nothing chosen or expanded any more: what was added for it goes (the resource keeps its
    // last answer when it has nothing to ask).
    for (const detail of wanted.length ? (extra.data ?? []) : []) {
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
  }, [base.data, extra.data, wanted.length]);
  const ids = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes]);
  useEffect(() => onNodes(ids), [ids, onNodes]);
  const count = base.data ? s.count(graph.nodes.length, graph.edges.length) : null;
  useEffect(() => onCount(count), [count, onCount]);
  useEffect(() => () => onCount(null), [onCount]);

  // Positions: deterministic, and nodes already on screen keep theirs when the graph grows.
  // (Read in render, written after commit: a render React repeats lays out the same.)
  // Only the view on screen is laid out.
  const previous = useRef<{ key: string; at: Map<string, Point> }>({ key: "", at: new Map() });
  const previous3 = useRef<{ key: string; at: PlanetaryLayout | null }>({ key: "", at: null });
  // A phone's canvas is portrait: two systems to a row there, three on wider screens.
  const narrow = useMedia(NARROW);
  // What is shown, not when it was read: the graph read again (a document indexed or
  // removed) grows or shrinks in place, and the camera stays where it is.
  const baseKey = `${types.join()}|${edgeTypes.join()}`;
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
  const key3 = `${baseKey}|${narrow ? "narrow" : "wide"}`;
  const layout3 = useMemo(
    () => (dims === "3d" ? planetaryLayout(graph.nodes, graph.edges, previous3.current.key === key3 ? previous3.current.at : null, narrow ? 2 : undefined) : null),
    [graph, key3, dims, narrow],
  );
  useEffect(() => {
    if (dims === "2d") previous.current = { key: baseKey, at: positions };
    else previous3.current = { key: key3, at: layout3 };
  }, [positions, layout3, baseKey, key3, dims]);
  const topDegree = useMemo(() => [...graph.nodes].sort((a, b) => b.degree - a.degree)[Math.min(7, graph.nodes.length - 1)]?.degree ?? 0, [graph.nodes]);
  const important = (n: GraphNode) => n.type === "document" || n.degree >= topDegree;
  const placed: PlacedNode[] = dims === "2d" ? graph.nodes.map((n) => ({ ...n, ...positions.get(n.id)!, important: important(n) })) : [];
  const nodes3 = useMemo(() => graph.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, degree: n.degree, important: n.type === "document" || n.degree >= topDegree })), [graph.nodes, topDegree]);

  const laidOut = dims === "2d" ? positions : (layout3?.positions ?? positions);
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

  const counts = new Map<string, number>();
  for (const n of base.data?.nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  // A document opened from the library is shown as its group.
  const selection = selected && (selected.kind === "node" || selected.kind === "edge") ? { kind: selected.kind, id: selected.id } : selected?.kind === "doc" && ids.has(selected.id) ? { kind: "node" as const, id: selected.id } : null;
  const onSelect = (sel: { kind: "node" | "edge"; id: string } | null) => nav.inspect(sel ? { kind: sel.kind, id: sel.id } : null);
  const describe = (n: { id: string; type: string; label: string }) => s.nodeLabel(t.types[n.type as NodeType] ?? n.type, n.label, graph.nodes.find((x) => x.id === n.id)?.degree ?? 0);
  const hiddenTypes = NODE_TYPES.length - types.length + EDGE_TYPES.length - edgeTypes.length;
  // The view and help join the canvas's own controls at the top right.
  const tools = {
    before: <ViewSwitch dims={dims} can3d={can3d && !failed} onChange={setDims} refocus={refocus} />,
    after: <Help dims={dims} />,
  };
  const notes = [
    base.data?.truncated && s.truncated(base.data.nodes.length - base.data.added, base.data.total, base.data.added),
    graph.capped && s.capped(IN_VIEW),
    !can3d && s.view.noWebgl,
    can3d && !failed && forced && !asked && s.view.forcedColors,
  ].filter((x): x is string => Boolean(x));

  return (
    <section className="kn-graphview" aria-labelledby="kn-graph-title" data-hud>
      <h2 id="kn-graph-title" className="visually-hidden">
        {s.title}
      </h2>
      <div className="kn-hud kn-hud--top" data-band>
        <GraphSearch nodes={graph.nodes} query={query} onNode={(id) => nav.inspect({ kind: "node", id })} onPassages={nav.search} />
        <button
          type="button"
          className="kn-hud__button"
          aria-pressed={drawer === "library"}
          title={t.rag.library.openTitle}
          onClick={() => nav.library(drawer !== "library")}
        >
          <Library size={15} aria-hidden="true" />
          <span className="kn-hud__label">{t.rag.library.open}</span>
        </button>
        <Filters label={hiddenTypes ? s.filters.hidden(hiddenTypes) : s.filters.open} active={hiddenTypes > 0}>
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
          <p className="kn-meta">{s.legendNote}</p>
          <h4 className="kn-family__name">{allEdges ? s.edgesAll : s.edgesSome(edgeTypes.length, EDGE_TYPES.length)}</h4>
          <div className="kn-filters" role="group" aria-label={s.edgesLabel}>
            {EDGE_TYPES.map((type) => (
              <button key={type} type="button" className="kn-filter" aria-pressed={edgeTypes.includes(type)} onClick={() => toggle(edgeTypes, type, setEdgeTypes)}>
                {t.relationNames[type]}
              </button>
            ))}
          </div>
        </Filters>
        {expanded.length > 0 && (
          <button type="button" className="kn-hud__button" title={s.reset} onClick={onReset}>
            <RotateCcw size={14} aria-hidden="true" />
            <span className="kn-hud__label">{s.reset}</span>
          </button>
        )}
        {(notes.length > 0 || failed) && (
          <div className="kn-hud__notes">
            {failed && <Notice tone="warning">{s.view.failed}</Notice>}
            {notes.map((n) => (
              <p key={n} className="kn-note">
                {n}
              </p>
            ))}
          </div>
        )}
      </div>
      {base.error && (
        <div className="kn-graphview__state">
          <Notice tone="critical" action={{ label: t.rag.retry, onClick: base.retry }}>
            {s.failed(base.error.message)}
          </Notice>
        </div>
      )}
      {!base.data && !base.error && (
        <p className="kn-loading kn-graphview__state" role="status">
          {s.loading}
        </p>
      )}
      {base.data && !graph.nodes.length && <p className="kn-empty kn-graphview__state">{s.empty}</p>}
      {graph.nodes.length > 0 && dims === "2d" && (
        <GraphCanvas
          nodes={placed}
          edges={graph.edges}
          shapes={KNOWLEDGE_SHAPES}
          colors={KNOWLEDGE_COLORS}
          selected={selection}
          onSelect={onSelect}
          label={s.canvasLabel(graph.nodes.length, graph.edges.length)}
          hint={`${s.hint} ${s.legendNote}`}
          describe={describe}
          layoutKey={baseKey}
          focus={focus}
          tools={tools}
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
              layout={layout3!}
              colors={KNOWLEDGE_COLORS}
              shapes={KNOWLEDGE_SHAPES}
              selected={selection}
              onSelect={onSelect}
              label={s.canvas3dLabel(graph.nodes.length, graph.edges.length)}
              hint={s.hint3d}
              keys={s.keys3d}
              describe={describe}
              layoutKey={key3}
              focus={focus}
              onFail={fail}
              tools={tools}
            />
          </Suspense>
        </ThreeGuard>
      )}
    </section>
  );
}

const toggle = <T extends string>(list: T[], v: T, set: (x: T[]) => void) => {
  const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  if (next.length) set(next);
};

/** 3D | 2D among the canvas's tools. Switching replaces the canvas and its tools, so the new
 *  switch takes the focus the old one had (and the arrows keep working). */
function ViewSwitch({ dims, can3d, onChange, refocus }: { dims: "2d" | "3d"; can3d: boolean; onChange: (v: "2d" | "3d") => void; refocus: { current: boolean } }) {
  const s = useKnowledgeStrings().graph.view;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [refocus]);
  return (
    <div ref={box} className="kn-dims">
      <RadioGroup
        className="segmented--small"
        label={s.label}
        value={dims}
        onChange={onChange}
        options={[
          { value: "3d", label: s.three, disabled: !can3d },
          { value: "2d", label: s.two },
        ]}
      />
    </div>
  );
}

/** While `open`, focus moving out of `box` (a keyboard user tabbing on) closes it. */
function useFocusAway(open: boolean, box: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const away = (e: FocusEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("focusin", away);
    return () => document.removeEventListener("focusin", away);
  }, [open, box, close]);
}

/** A small control over the graph that opens a panel under it (filters, help): Escape, a
 *  press elsewhere or focus moving on closes it. */
function useMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(open, close);
  useDismissOutside(open, box, close);
  useFocusAway(open, box, close);
  return { open, setOpen, box, id };
}

/** The filters and the legend; a dot on the button while some types are hidden. */
function Filters({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  const s = useKnowledgeStrings().graph.filters;
  const { open, setOpen, box, id } = useMenu();
  return (
    <div ref={box} className="kn-hud__menu">
      <button type="button" className="kn-hud__button" aria-expanded={open} aria-controls={open ? id : undefined} data-active={active || undefined} title={s.title} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span className="kn-hud__label">{label}</span>
      </button>
      {open && (
        <div id={id} className="kn-popover" role="group" aria-label={s.label} data-obstacle>
          {children}
        </div>
      )}
    </div>
  );
}

/** How to move round the graph, by pointer and by keys: in Help, and always in the canvas's
 *  accessible description. */
function Help({ dims }: { dims: "2d" | "3d" }) {
  const g = useKnowledgeStrings().graph;
  const { open, setOpen, box, id } = useMenu();
  return (
    <div ref={box} className="kn-hud__menu">
      <button type="button" className="icon-button" aria-label={g.help.open} title={g.help.open} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)}>
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {open && (
        // Focusable: on a small screen it scrolls, and the keys can scroll it.
        <section id={id} className="kn-popover kn-popover--end" aria-labelledby={`${id}-title`} tabIndex={0} data-obstacle>
          <h3 id={`${id}-title`}>{g.help.title}</h3>
          <p>{dims === "3d" ? g.hint3d : g.hint}</p>
          {dims === "3d" && <p>{g.keys3d}</p>}
          <p>{g.help.search}</p>
          <p>{g.help.library}</p>
        </section>
      )}
    </div>
  );
}

/**
 * The graph's one search box. As one types: the nodes in view whose names match (choosing
 * one flies to it), then "search passages" for the words typed (the indexed text, its
 * results beside the graph). Empty, it offers the example questions. An ARIA combobox:
 * arrows move through the choices, Enter takes the highlighted one (for typed words the
 * first by default; an example only once the arrows reach it), Escape closes the list.
 */
function GraphSearch({ nodes, query, onNode, onPassages }: { nodes: GraphNode[]; query: string; onNode: (id: string) => void; onPassages: (q: string) => void }) {
  const t = useKnowledgeStrings();
  const s = t.graph.search;
  const [text, setText] = useState(query);
  useEffect(() => setText(query), [query]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const term = text.trim();
  const matches = term.length > 1 ? nodes.filter((n) => n.label.toLowerCase().includes(term.toLowerCase())).slice(0, 6) : [];
  const options: { id: string; node: GraphNode | null; q: string }[] =
    term.length > 1
      ? [...matches.map((n) => ({ id: `${listId}-${n.id}`, node: n, q: term })), { id: `${listId}-passages`, node: null, q: term }]
      : term
        ? []
        : t.rag.search.exampleQueries.map((q, i) => ({ id: `${listId}-example-${i}`, node: null, q }));
  const shown = open && options.length > 0;
  const at = active < 0 ? -1 : Math.min(active, options.length - 1);
  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(shown, close);
  useDismissOutside(shown, box, close);
  useFocusAway(shown, box, close);
  // The highlighted choice stays in sight when the list scrolls (a short graph).
  const activeId = shown && at >= 0 ? options[at].id : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const choose = (o: (typeof options)[number]) => {
    setOpen(false);
    if (o.node) {
      setText("");
      onNode(o.node.id);
    } else onPassages(o.q);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length) {
      e.preventDefault();
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step > 0 ? 0 : options.length - 1) : (Math.min(a, options.length - 1) + step + options.length) % options.length));
    } else if (e.key === "Enter" && at >= 0) {
      e.preventDefault();
      choose(options[at]);
    }
  };
  return (
    <div ref={box} className="kn-search" role="search">
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        role="combobox"
        aria-label={s.label}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-activedescendant={activeId}
        value={text}
        maxLength={500}
        placeholder={s.placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setActive(e.target.value.trim() ? 0 : -1);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(term ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <div className="kn-search__pop" data-obstacle>
          {term && !matches.length && <p className="kn-search__none kn-meta">{t.graph.noMatch}</p>}
          <ul id={listId} role="listbox" aria-label={term ? s.options : s.examples} className="kn-search__list">
            {options.map((o, i) => (
              <li
                key={o.id}
                id={o.id}
                role="option"
                aria-selected={i === at}
                className={`kn-search__option${term && !o.node ? " kn-search__option--passages" : ""}`}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.node ? (
                  <>
                    <ShapeGlyph shape={KNOWLEDGE_SHAPES[o.node.type]} color={KNOWLEDGE_COLORS[o.node.type]} />
                    <span className="kn-search__name">{o.node.label}</span>
                    <span className="kn-meta">{t.types[o.node.type]}</span>
                  </>
                ) : term ? (
                  <>
                    <FileSearch size={14} aria-hidden="true" />
                    <span className="kn-search__name">{s.passages(term)}</span>
                    <span className="kn-meta">{s.passagesHint}</span>
                  </>
                ) : (
                  <>
                    <FileSearch size={14} aria-hidden="true" />
                    <span className="kn-search__name kn-search__name--example">{o.q}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
