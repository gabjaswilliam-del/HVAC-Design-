/**
 * Graph Memory: what happened at the plant and what was decided, in time. A timeline and
 * a memory graph over the same filters (words, kind, provenance, equipment, a time
 * window, superseded versions), one record inspector beside them, and recording,
 * correcting, linking and deleting through the local memory service. Typed address:
 * `/knowledge?kn=memory&mv=graph&mem=mem_…`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Eye, Flag, Gavel, ScanSearch, Wrench, type LucideIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { useResource } from "../../../lib/api/useResource";
import type { MemoryClient } from "../../../lib/api/memory";
import {
  MEMORY_KINDS,
  PROVENANCE,
  type MemoryFilters,
  type MemoryGraph,
  type MemoryKind,
  type MemoryNodeType,
  type MemoryStatus,
  type MemoryTimeline,
  type Provenance,
} from "../../../lib/contracts/memory";
import { RadioGroup } from "../../../components/RadioGroup";
import { Notice } from "../../../components/Notice";
import { GraphCanvas, ShapeGlyph, type Shape } from "../graph/GraphCanvas";
import { LANE, timeLayout } from "../graph/layout";
import { equipmentName, formatUtc } from "../shared";
import { MemoryPanel } from "./MemoryPanel";
import { MemoryForm } from "./MemoryForms";

export const KIND_ICONS: Record<MemoryKind, LucideIcon> = {
  event: Activity,
  observation: Eye,
  finding: ScanSearch,
  decision: Gavel,
  correction: Wrench,
  outcome: Flag,
};
export const MEMORY_SHAPES: Record<MemoryNodeType, Shape> = {
  event: "circle",
  observation: "ring",
  finding: "diamond",
  decision: "square",
  correction: "chevron",
  outcome: "triangle",
  equipment: "hexagon",
  simulation_run: "pill",
};

type Window = "all" | "7d" | "30d" | "custom";
interface Filters {
  query: string;
  kinds: MemoryKind[];
  provenance: Provenance | "";
  equipment: string;
  window: Window;
  from: string;
  to: string;
  includeSuperseded: boolean;
}
const NONE: Filters = { query: "", kinds: [], provenance: "", equipment: "", window: "all", from: "", to: "", includeSuperseded: false };

/** The filters as the service takes them (times in UTC). */
function toQuery(f: Filters, now: number): MemoryFilters {
  const days = f.window === "7d" ? 7 : f.window === "30d" ? 30 : 0;
  return {
    query: f.query.trim() || undefined,
    kinds: f.kinds.length ? f.kinds : undefined,
    provenance: f.provenance ? [f.provenance] : undefined,
    equipment: f.equipment ? [f.equipment] : undefined,
    from: days ? new Date(now - days * 86_400_000).toISOString().slice(0, 19) + "Z" : f.window === "custom" && f.from ? `${f.from}T00:00:00Z` : undefined,
    to: f.window === "custom" && f.to ? `${f.to}T23:59:59Z` : undefined,
    includeSuperseded: f.includeSuperseded || undefined,
  };
}

export function KindLabel({ kind }: { kind: MemoryKind }) {
  const s = useKnowledgeStrings().memory;
  const Icon = KIND_ICONS[kind];
  return (
    <span className="kn-kind">
      <Icon size={14} aria-hidden="true" />
      {s.kinds[kind]}
    </span>
  );
}

export function ProvenanceTag({ provenance, runId }: { provenance: Provenance; runId?: string | null }) {
  const s = useKnowledgeStrings().memory.provenance;
  const tone = provenance === "simulation" ? " tag-chip--notice" : provenance === "demo" ? " tag-chip--demo" : "";
  return (
    <span className={`tag-chip${tone}`} title={s.explain[provenance]}>
      {s.labels[provenance]}
      {provenance === "simulation" && runId ? ` · ${runId}` : ""}
    </span>
  );
}

export function MemoryWorkspace({ client }: { client: MemoryClient }) {
  const t = useKnowledgeStrings();
  const s = t.memory;
  const [params, setParams] = useSearchParams();
  const view = params.get("mv") === "graph" ? "graph" : "timeline";
  const selected = params.get("mem");
  const [filters, setFilters] = useState<Filters>(NONE);
  const [draftQuery, setDraftQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  const query = useMemo(() => toQuery(filters, now), [filters, now]);
  const key = `${JSON.stringify(query)}:${revision}`;
  const status = useResource(`mstatus:${revision}`, "mstatus", (signal) => client.status({ signal }));
  const timeline = useResource(view === "timeline" ? `mt:${key}` : null, "mtimeline", (signal) => client.getMemoryTimeline(query, { signal }));
  const graph = useResource(view === "graph" ? `mg:${key}` : null, "mgraph", (signal) => client.getMemoryGraph({ ...query, limit: 120 }, { signal }));
  // Every equipment item the records name, for the filter (and the form's suggestions).
  const all = useResource(`mall:${revision}`, "mall", (signal) => client.listMemories({ includeSuperseded: true, limit: 200 }, { signal }));
  const equipment = useMemo(() => [...new Set((all.data?.memories ?? []).flatMap((m) => m.equipment))].sort(), [all.data]);
  const local = client.mode === "local";

  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
      return next;
    });
  const inspect = (id: string | null) => set({ mem: id });
  const changed = (id?: string | null) => {
    setRevision((r) => r + 1);
    if (id !== undefined) inspect(id);
  };

  return (
    <div className="kn-memory">
      <div className="kn-section__head">
        <h2 className="visually-hidden">{s.title}</h2>
        {status.data && <span className="kn-count">{s.count(status.data.totals.current ?? 0, status.data.totals.superseded ?? 0, status.data.totals.links ?? 0)}</span>}
        {local && !creating && (
          <button type="button" className="button button--primary kn-section__action" onClick={() => setCreating(true)}>
            {s.record}
          </button>
        )}
      </div>
      {!local && <p className="kn-note">{s.demoNote}</p>}
      {status.error && !status.data && <Notice tone="critical">{s.statusFailed(status.error.message)}</Notice>}
      {creating && status.data && (
        <MemoryForm
          client={client}
          status={status.data}
          equipment={equipment}
          records={(all.data?.memories ?? []).filter((m) => m.status === "current")}
          onDone={(id) => {
            setCreating(false);
            if (id) changed(id);
          }}
        />
      )}
      <form
        className="kn-mfilters"
        role="search"
        aria-label={s.filters.label}
        onSubmit={(e) => {
          e.preventDefault();
          setFilters((f) => ({ ...f, query: draftQuery }));
        }}
      >
        <label className="kn-field kn-field--grow">
          <span>{s.filters.words}</span>
          <input type="search" value={draftQuery} maxLength={300} placeholder={s.filters.wordsPlaceholder} onChange={(e) => setDraftQuery(e.target.value)} />
        </label>
        <label className="kn-field">
          <span>{s.filters.equipment}</span>
          <select className="select" value={filters.equipment} onChange={(e) => setFilters((f) => ({ ...f, equipment: e.target.value }))}>
            <option value="">{s.filters.anyEquipment}</option>
            {equipment.map((id) => (
              <option key={id} value={id}>
                {equipmentName(id)}
              </option>
            ))}
          </select>
        </label>
        <label className="kn-field">
          <span>{s.filters.provenance}</span>
          <select className="select" value={filters.provenance} onChange={(e) => setFilters((f) => ({ ...f, provenance: e.target.value as Provenance | "" }))}>
            <option value="">{s.filters.anyProvenance}</option>
            {PROVENANCE.map((p) => (
              <option key={p} value={p}>
                {s.provenance.labels[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="kn-field">
          <span>{s.filters.window}</span>
          <select className="select" value={filters.window} onChange={(e) => setFilters((f) => ({ ...f, window: e.target.value as Window }))}>
            {(["all", "7d", "30d", "custom"] as const).map((w) => (
              <option key={w} value={w}>
                {s.filters.windows[w]}
              </option>
            ))}
          </select>
        </label>
        {filters.window === "custom" && (
          <>
            <label className="kn-field">
              <span>{s.filters.from}</span>
              <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
            </label>
            <label className="kn-field">
              <span>{s.filters.to}</span>
              <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
            </label>
          </>
        )}
        <label className="check kn-check">
          <input type="checkbox" checked={filters.includeSuperseded} onChange={(e) => setFilters((f) => ({ ...f, includeSuperseded: e.target.checked }))} />
          {s.filters.superseded}
        </label>
        <button type="submit" className="button">
          {s.filters.apply}
        </button>
        {JSON.stringify(filters) !== JSON.stringify(NONE) && (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              setFilters(NONE);
              setDraftQuery("");
            }}
          >
            {s.filters.clear}
          </button>
        )}
      </form>
      <div className="kn-filters" role="group" aria-label={s.filters.kinds}>
        {MEMORY_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="kn-filter"
            aria-pressed={filters.kinds.includes(k)}
            onClick={() => setFilters((f) => ({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] }))}
          >
            <ShapeGlyph shape={MEMORY_SHAPES[k]} />
            {s.kinds[k]}
          </button>
        ))}
      </div>
      <div className="kn-viewbar">
        <RadioGroup
          label={s.views.label}
          value={view}
          onChange={(v) => set({ mv: v === "graph" ? "graph" : null })}
          options={[
            { value: "timeline", label: s.views.timeline },
            { value: "graph", label: s.views.graph },
          ]}
        />
      </div>
      <div className={`kn-split${selected ? " kn-split--open" : ""}`}>
        <div className="kn-main">
          {view === "timeline" ? (
            <Timeline data={timeline.data} error={timeline.error?.message} retry={timeline.retry} selected={selected} onSelect={inspect} />
          ) : (
            <MemoryGraphView data={graph.data} error={graph.error?.message} retry={graph.retry} selected={selected} onSelect={inspect} />
          )}
        </div>
        {selected && (
          <div className="kn-side">
            <MemoryPanel
              client={client}
              id={selected}
              revision={revision}
              records={(all.data?.memories ?? []).filter((m) => m.status === "current")}
              equipment={equipment}
              status={status.data}
              onInspect={inspect}
              onChanged={changed}
              onClose={() => inspect(null)}
            />
          </div>
        )}
      </div>
      {status.data && <Rules status={status.data} />}
    </div>
  );
}

/** Records in time, newest first, grouped by day; each says what it followed on its equipment. */
function Timeline({ data, error, retry, selected, onSelect }: { data?: MemoryTimeline; error?: string; retry: () => void; selected: string | null; onSelect: (id: string) => void }) {
  const t = useKnowledgeStrings();
  const s = t.memory;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data) motion.added(list.current ? Array.from(list.current.querySelectorAll(".kn-entry")).slice(0, 10) : []);
  }, [data]);
  if (error)
    return (
      <Notice tone="critical" action={{ label: t.rag.retry, onClick: retry }}>
        {s.failed(error)}
      </Notice>
    );
  if (!data)
    return (
      <p className="kn-loading" role="status">
        {s.loading}
      </p>
    );
  if (!data.entries.length) return <p className="kn-empty">{s.empty}</p>;
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  const days = new Map<string, typeof data.entries>();
  for (const e of data.entries) days.set(e.occurredAt.slice(0, 10), [...(days.get(e.occurredAt.slice(0, 10)) ?? []), e]);
  return (
    <div ref={list} className="kn-timeline">
      <p className="kn-meta" role="status">
        {s.shown(data.entries.length, data.total)}
      </p>
      {[...days].map(([day, entries]) => (
        <section key={day} className="kn-day" aria-labelledby={`kn-day-${day}`}>
          <h3 id={`kn-day-${day}`} className="kn-day__title">
            {day}
          </h3>
          <ol className="kn-entries">
            {entries.map((e) => (
              <li key={e.id}>
                <button type="button" className={`kn-entry${e.status === "superseded" ? " kn-entry--old" : ""}`} aria-current={selected === e.id || undefined} onClick={() => onSelect(e.id)}>
                  <span className="kn-entry__time">{e.occurredAt.slice(11, 16)} UTC</span>
                  <KindLabel kind={e.kind} />
                  <span className="kn-entry__title">{e.title}</span>
                  <span className="kn-entry__meta">
                    <ProvenanceTag provenance={e.provenance} runId={e.runId} />
                    {e.status === "superseded" && <span className="tag-chip tag-chip--planned">{s.superseded}</span>}
                    {e.equipment.map((id) => (
                      <span key={id} className="kn-meta">
                        {equipmentName(id)}
                      </span>
                    ))}
                  </span>
                  {Object.entries(e.previous).map(([eq, prev]) => (
                    <span key={eq} className="kn-entry__after">
                      {s.after(equipmentName(eq), byId.get(prev)?.title ?? prev)}
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** The memory graph on a time axis: one lane per equipment item, simulation runs above. */
function MemoryGraphView({ data, error, retry, selected, onSelect }: { data?: MemoryGraph; error?: string; retry: () => void; selected: string | null; onSelect: (id: string | null) => void }) {
  const t = useKnowledgeStrings();
  const s = t.memory;
  const layout = useMemo(() => (data ? timeLayout(data.nodes) : null), [data]);
  const [sel, setSel] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const current = selected ? { kind: "node" as const, id: selected } : sel;
  if (error)
    return (
      <Notice tone="critical" action={{ label: t.rag.retry, onClick: retry }}>
        {s.failed(error)}
      </Notice>
    );
  if (!data || !layout)
    return (
      <p className="kn-loading" role="status">
        {s.loadingGraph}
      </p>
    );
  if (!data.nodes.length) return <p className="kn-empty">{s.empty}</p>;
  const nodes = data.nodes.map((n) => ({
    ...n,
    ...layout.positions.get(n.id)!,
    label: n.type === "equipment" ? equipmentName(n.label) : n.label,
    dashed: n.status === "superseded",
    scope: n.provenance === "simulation",
    important: n.type === "equipment" || n.type === "simulation_run",
  }));
  // A record's link to its own lane's equipment is the lane itself; only others are drawn.
  const lane = new Map(data.nodes.map((n) => [n.id, n.equipment?.[0]]));
  const edges = data.edges.filter((e) => !(e.type === "RELATES_TO" && e.target === `equipment:${lane.get(e.source)}`));
  const edge = sel?.kind === "edge" ? data.edges.find((e) => e.id === sel.id) : undefined;
  return (
    <div className="kn-mgraph">
      <p className="kn-meta" role="status">
        {s.graphCount(data.nodes.length, data.edges.length)}
        {data.truncated && ` ${s.graphTruncated(data.limit, data.total)}`}
      </p>
      <GraphCanvas
        nodes={nodes}
        edges={edges}
        shapes={MEMORY_SHAPES}
        selected={current}
        onSelect={(x) => {
          setSel(x);
          if (!x || x.kind === "node") onSelect(x?.id ?? null);
        }}
        label={s.canvasLabel(data.nodes.length, data.edges.length)}
        hint={t.graph.hint}
        describe={(n) => {
          const node = data.nodes.find((x) => x.id === n.id)!;
          return s.nodeLabel(s.nodeTypes[node.type], n.label, node.occurredAt ? formatUtc(node.occurredAt) : "", node.provenance ? s.provenance.labels[node.provenance] : "", node.status === "superseded");
        }}
        layoutKey={JSON.stringify(data.window) + data.total}
        labelAll={false}
        underlay={
          <g className="kn-lanes" aria-hidden="true">
            {layout.lanes.map((l) => (
              <g key={l.key}>
                <line x1={0} x2={layout.width} y1={l.y + LANE / 2} y2={l.y + LANE / 2} className="kn-lane__rule" />
                {(l.key === "runs" || l.key === "none") && (
                  <text x={0} y={l.y - 14} className="kn-lane__label">
                    {l.key === "runs" ? s.lanes.runs : s.lanes.none}
                  </text>
                )}
              </g>
            ))}
            {layout.days.map((d) => (
              <g key={d.day}>
                <line x1={d.x} x2={d.x} y1={-LANE / 2} y2={(layout.lanes.at(-1)?.y ?? 0) + LANE / 2} className="kn-lane__rule" />
                <text x={d.x + 6} y={-LANE / 2 + 4} className="kn-lane__label">
                  {d.day}
                </text>
              </g>
            ))}
          </g>
        }
      />
      {edge && (
        <p className="kn-note" role="status">
          {s.edgeNote(
            s.edgeTypes[edge.type],
            nodes.find((n) => n.id === edge.source)?.label ?? edge.source,
            nodes.find((n) => n.id === edge.target)?.label ?? edge.target,
            Boolean(edge.derived),
          )}
        </p>
      )}
      <ul className="kn-legend" aria-label={s.legend}>
        {(Object.keys(MEMORY_SHAPES) as MemoryNodeType[]).map((k) => (
          <li key={k}>
            <ShapeGlyph shape={MEMORY_SHAPES[k]} />
            {s.nodeTypes[k]}
          </li>
        ))}
        <li>
          <span className="kn-legend__dash" aria-hidden="true" />
          {s.legendDerived}
        </li>
      </ul>
    </div>
  );
}

/** What may be stored, and what is kept: the service's own rules. */
function Rules({ status }: { status: MemoryStatus }) {
  const s = useKnowledgeStrings().memory;
  return (
    <details className="kn-rulesbox">
      <summary>{s.rules.title}</summary>
      <ul>
        {s.rules.items.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <h4>{s.rules.provenanceTitle}</h4>
      <ul>
        {status.provenance.map((p) => (
          <li key={p.id}>
            <ProvenanceTag provenance={p.id} /> {s.provenance.explain[p.id]} {p.allowed ? "" : <span className="kn-meta kn-meta--caution">{p.reason}</span>}
          </li>
        ))}
      </ul>
      <h4>{s.rules.retentionTitle}</h4>
      <p>{status.retention}</p>
      <p className="kn-meta">{status.storage.persistent ? s.rules.storedLocal : s.rules.storedDemo}</p>
    </details>
  );
}
