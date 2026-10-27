/**
 * Graph Memory: what happened at the plant and what was decided, in time. The view fills the
 * page: the constellation in 3D (`MemoryConstellation`, where it opens), the timeline in 2D
 * (`MemoryTimeline`; also in high-contrast mode, without WebGL, or when 3D stops or cannot
 * start, saying which) or the same records as a list. Its controls float over it: one search
 * box over every record, the filters (kind, equipment, provenance, a time window, superseded
 * versions, which are the legend too), recording a memory with the local service, and the
 * view switch with zoom, Fit and help. One column beside it holds what was chosen: a record
 * with its versions, links and linked chain, a stored link, an equipment item's or a run's
 * records, or the form for a new record. Recording, correcting, linking and deleting go
 * through the local memory service. Typed address: `/knowledge?kn=memory&mem=mem_…`,
 * `&mlink=…` (a link), `&mv=timeline` or `&mv=list` (the other views).
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useSearchParams } from "react-router";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { useResource } from "../../../lib/api/useResource";
import type { MemoryClient } from "../../../lib/api/memory";
import type { MemoryFilters, MemoryKind, MemoryTimeline as MemoryTimelineData } from "../../../lib/contracts/memory";
import { Notice } from "../../../components/Notice";
import { equipmentName, formatUtc } from "../shared";
import { KindLabel, ProvenanceTag } from "./kinds";
import { LinkPanel, MemoryPanel, type RecordRef } from "./MemoryPanel";
import { MemoryForm } from "./MemoryForms";
import { MemoryTimeline } from "./MemoryTimeline";
import { MemoryFiltersMenu, MemoryHelp, MemorySearch, NONE, ViewSwitch, type Filters, type SearchChoice, type View } from "./MemoryControls";
import { chainOf, memoryTimelineLayout, type TimelineRecord } from "./timeline";
import { ThreeGuard, canDraw3d, forcedColors } from "../graph/scene3d";

const MemoryConstellation = lazy(() => import("./MemoryConstellation"));

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

export function MemoryWorkspace({ client, onCount }: { client: MemoryClient; onCount: (text: string | null) => void }) {
  const t = useKnowledgeStrings();
  const s = t.memory;
  const [params, setParams] = useSearchParams();
  // 3D where the browser can draw it, the timeline in 2D otherwise (and in high-contrast mode,
  // which the 2D drawing follows), or the list; the address holds a choice that differs from
  // that default. `mv=graph`, the old memory graph's address, is the 3D view.
  const can3d = useMemo(canDraw3d, []);
  const forced = useMemo(forcedColors, []);
  // The 3D view lost its graphics context, or could not start (no context, or its chunk did
  // not load): the timeline instead, saying which.
  const [failed, setFailed] = useState<"lost" | "start" | null>(null);
  const lost = useCallback(() => setFailed("lost"), []);
  const broke = useCallback(() => setFailed((f) => f ?? "start"), []);
  const asked = params.get("mv");
  const wants3d = asked === "3d" || asked === "graph" || (!asked && !forced);
  const view: View = asked === "list" ? "list" : asked === "timeline" || !wants3d || !can3d || failed ? "timeline" : "3d";
  const preferred: View = forced ? "timeline" : "3d";
  const selected = params.get("mem");
  const link = params.get("mlink");
  const [filters, setFilters] = useState<Filters>(NONE);
  const [revision, setRevision] = useState(0);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());
  const query = useMemo(() => toQuery(filters, now), [filters, now]);
  const key = `${JSON.stringify(query)}:${revision}`;
  const status = useResource(`mstatus:${revision}`, "mstatus", (signal) => client.status({ signal }));
  const graph = useResource(view !== "list" ? `mg:${key}` : null, "mgraph", (signal) => client.getMemoryGraph({ ...query, limit: 120 }, { signal }));
  const timeline = useResource(view === "list" ? `mt:${key}` : null, "mtimeline", (signal) => client.getMemoryTimeline(query, { signal }));
  // Every record (superseded versions too): what search looks through, the equipment the
  // filter offers and the forms' choices.
  const all = useResource(`mall:${revision}`, "mall", (signal) => client.listMemories({ includeSuperseded: true, limit: 200 }, { signal }));
  const records = useMemo(() => all.data?.memories ?? [], [all.data]);
  const equipment = useMemo(() => [...new Set(records.flatMap((m) => m.equipment))].sort(), [records]);
  const counts = useMemo(() => {
    const c = new Map<MemoryKind, number>();
    for (const m of records) if (m.status === "current") c.set(m.kind, (c.get(m.kind) ?? 0) + 1);
    return c;
  }, [records]);
  const local = client.mode === "local";
  const layout = useMemo(() => (graph.data ? memoryTimelineLayout(graph.data.nodes, graph.data.edges) : null), [graph.data]);
  // The filters the records shown answer: the timeline is fitted again when other filters'
  // records have arrived (not while the last ones are still shown, nor after an edit).
  const queryKey = JSON.stringify(query);
  const [shownKey, setShownKey] = useState(queryKey);
  if (view !== "list" && graph.data && !graph.loading && shownKey !== queryKey) setShownKey(queryKey);

  const count = status.data ? s.count(status.data.totals.current ?? 0, status.data.totals.superseded ?? 0, status.data.totals.links ?? 0) : null;
  useEffect(() => onCount(count), [count, onCount]);
  useEffect(() => () => onCount(null), [onCount]);

  const set = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
      return next;
    });
  const inspect = (id: string | null) => set({ mem: id, mlink: null });
  const changed = (id?: string | null) => {
    setRevision((r) => r + 1);
    if (id !== undefined) inspect(id);
  };

  // Bring what was chosen into view: centred when found by search, otherwise only if it is
  // out of sight.
  const [focus, setFocus] = useState<{ id: string; n: number; centre: boolean } | null>(null);
  const [goTo, setGoTo] = useState<{ from: number; to: number; n: number; lane?: string } | null>(null);
  const centre = useRef(false);
  useEffect(() => {
    if (!selected || selected.includes(":")) return;
    setFocus((f) => ({ id: selected, n: (f?.n ?? 0) + 1, centre: centre.current }));
    centre.current = false;
  }, [selected, layout]);
  const choose = (c: SearchChoice) => {
    if (c.kind === "record") {
      centre.current = true;
      if (c.id === selected) setFocus((f) => ({ id: c.id, n: (f?.n ?? 0) + 1, centre: true }));
      inspect(c.id);
    } else if (c.kind === "equipment") {
      // Its records shown: the time they span, on its lane.
      inspect(`equipment:${c.id}`);
      const times = (layout?.records ?? []).filter((r) => r.lane === c.id || r.echoes.includes(c.id)).map((r) => r.t);
      if (times.length) setGoTo((g) => ({ from: Math.min(...times), to: Math.max(...times), n: (g?.n ?? 0) + 1, lane: c.id }));
    } else if (c.kind === "kind") setFilters((f) => ({ ...f, kinds: [c.value] }));
    else if (c.kind === "provenance") setFilters((f) => ({ ...f, provenance: c.value }));
    else if (c.kind === "range") setFilters((f) => ({ ...f, window: "custom", from: c.from, to: c.to }));
    else if (c.kind === "words") setFilters((f) => ({ ...f, query: c.q }));
    else if (c.kind === "day" && view === "list") {
      // The list goes to that day, or the nearest earlier one (it runs latest first).
      const days = [...document.querySelectorAll<HTMLElement>(".mm-list .kn-day__title")];
      (days.find((d) => d.id.slice("kn-day-".length) <= c.from) ?? days.at(-1))?.scrollIntoView({ block: "start" });
    } else if (c.kind === "day") setGoTo((g) => ({ from: Date.parse(`${c.from}T00:00:00Z`), to: Date.parse(`${c.to}T23:59:59Z`), n: (g?.n ?? 0) + 1 }));
  };

  // The view: 3D, the timeline or the list. Switching replaces the tools, focus moves with it.
  const refocus = useRef(false);
  const setView = (v: View) => {
    if (v === view) return;
    refocus.current = true;
    set({ mv: v === preferred ? null : v });
  };
  const tools = {
    before: <ViewSwitch view={view} can3d={can3d && !failed} onChange={setView} refocus={refocus} />,
    after: <MemoryHelp status={status.data} demo={!local} view={view} />,
  };

  // Said plainly over the drawing: why it is in 2D, a cut-short view, the words searched, a
  // chosen record the filters leave out (with the way to show it).
  const chosenRecord = selected && !selected.includes(":") ? records.find((m) => m.id === selected) : undefined;
  const outside = view !== "list" && layout && chosenRecord && !layout.records.some((r) => r.id === chosenRecord.id);
  const why = view === "timeline" && asked !== "timeline" ? (failed ? null : wants3d && !can3d ? s.constellation.noWebgl : forced && !asked ? s.constellation.forcedColors : null) : null;
  const byRef = useMemo(() => {
    const map = new Map<string, RecordRef>();
    for (const m of records) map.set(m.id, { id: m.id, kind: m.kind, title: m.title, occurredAt: m.occurredAt });
    for (const r of layout?.records ?? []) if (!map.has(r.id)) map.set(r.id, { id: r.id, kind: r.kind, title: r.title, occurredAt: r.occurredAt });
    return map;
  }, [records, layout]);
  const chain = useMemo(() => {
    if (!layout || !selected || !layout.records.some((r) => r.id === selected)) return undefined;
    const ids = chainOf(selected, layout.links);
    return layout.records.filter((r) => ids.has(r.id)).map((r) => byRef.get(r.id)!);
  }, [layout, selected, byRef]);

  const describe = useCallback(
    (r: TimelineRecord) => s.nodeLabel(s.kinds[r.kind], r.title, formatUtc(r.occurredAt), r.provenance ? s.provenance.labels[r.provenance] : "", r.superseded),
    [s],
  );

  const column = creating && status.data ? (
    <MemoryForm
      client={client}
      status={status.data}
      equipment={equipment}
      records={records.filter((m) => m.status === "current")}
      onDone={(id) => {
        setCreating(false);
        if (id) changed(id);
      }}
    />
  ) : link ? (
    <LinkPanel client={client} id={link} link={layout?.links.find((l) => l.id === link)} records={byRef} revision={revision} onInspect={inspect} onClose={() => set({ mlink: null })} />
  ) : selected ? (
    <MemoryPanel
      client={client}
      id={selected}
      revision={revision}
      records={records.filter((m) => m.status === "current")}
      equipment={equipment}
      status={status.data}
      chain={chain}
      onInspect={inspect}
      onChanged={changed}
      onClose={() => inspect(null)}
    />
  ) : null;

  const stateTools = (
    <div className="kn-canvas__tools" data-band>
      {tools.before}
      {tools.after}
    </div>
  );

  return (
    <div className="kn-work">
      <div className="kn-work__stage">
        <section className="kn-graphview kn-memview" aria-labelledby="kn-memview-title" data-hud>
          <h2 id="kn-memview-title" className="visually-hidden">
            {s.timeline.title}
          </h2>
          <div className="kn-hud kn-hud--top" data-band>
            <MemorySearch records={records} equipment={equipment} words={filters.query} onChoose={choose} />
            <MemoryFiltersMenu filters={filters} setFilters={setFilters} equipment={equipment} counts={counts} />
            {local && (
              <button type="button" className="kn-hud__button kn-hud__button--primary" title={s.record} onClick={() => setCreating(true)} disabled={creating}>
                <Plus size={15} aria-hidden="true" />
                <span className="kn-hud__label">{s.record}</span>
              </button>
            )}
            {(filters.query || outside || graph.data?.truncated || (status.error && !status.data) || why || (failed && view === "timeline")) && (
              <div className="kn-hud__notes">
                {status.error && !status.data && <Notice tone="critical">{s.statusFailed(status.error.message)}</Notice>}
                {failed && view === "timeline" && <Notice tone="warning">{failed === "lost" ? s.constellation.failed : s.constellation.failedStart}</Notice>}
                {why && <p className="kn-note">{why}</p>}
                {filters.query && (
                  <p className="kn-note">
                    {s.notes.words(filters.query)}{" "}
                    <button type="button" className="text-button" onClick={() => setFilters((f) => ({ ...f, query: "" }))}>
                      {s.notes.showAll}
                    </button>
                  </p>
                )}
                {outside && (
                  <p className="kn-note">
                    {s.notes.outside}{" "}
                    <button type="button" className="text-button" onClick={() => setFilters({ ...NONE, includeSuperseded: chosenRecord!.status === "superseded" })}>
                      {s.notes.showAll}
                    </button>
                  </p>
                )}
                {graph.data?.truncated && <p className="kn-note">{s.truncated(graph.data.limit, graph.data.total)}</p>}
              </div>
            )}
          </div>
          {view === "list" ? (
            <>
              <MemoryList data={timeline.data} error={timeline.error?.message} retry={timeline.retry} selected={selected} onSelect={inspect} />
              {stateTools}
            </>
          ) : graph.error && !layout ? (
            <>
              <div className="kn-graphview__state">
                <Notice tone="critical" action={{ label: t.rag.retry, onClick: graph.retry }}>
                  {s.failed(graph.error.message)}
                </Notice>
              </div>
              {stateTools}
            </>
          ) : !layout ? (
            <>
              <p className="kn-loading kn-graphview__state" role="status">
                {s.loadingTimeline}
              </p>
              {stateTools}
            </>
          ) : !layout.records.length ? (
            <>
              <p className="kn-empty kn-graphview__state">{s.empty}</p>
              {stateTools}
            </>
          ) : view === "3d" ? (
            <ThreeGuard onError={broke}>
              <Suspense
                fallback={
                  <p className="kn-loading kn-3d-loading" role="status">
                    {s.constellation.loading}
                  </p>
                }
              >
                <MemoryConstellation
                  layout={layout}
                  selected={selected}
                  link={link}
                  onSelect={inspect}
                  onLink={(id) => set({ mlink: id, mem: null })}
                  focus={focus}
                  goTo={goTo}
                  layoutKey={shownKey}
                  label={s.constellation.label(layout.records.length, layout.links.filter((l) => l.type !== "SUPERSEDES").length)}
                  describe={describe}
                  onFail={lost}
                  tools={tools}
                />
              </Suspense>
            </ThreeGuard>
          ) : (
            <MemoryTimeline
              layout={layout}
              selected={selected}
              link={link}
              onSelect={inspect}
              onLink={(id) => set({ mlink: id, mem: null })}
              focus={focus}
              goTo={goTo}
              layoutKey={shownKey}
              label={s.timeline.label(layout.records.length, layout.links.filter((l) => l.type !== "SUPERSEDES").length)}
              describe={describe}
              tools={tools}
            />
          )}
        </section>
      </div>
      {column && <div className="kn-column">{column}</div>}
    </div>
  );
}

/** The same records as a list, newest first, grouped by day; each says what it followed on
 *  its equipment. Scrolls inside the workspace. */
function MemoryList({ data, error, retry, selected, onSelect }: { data?: MemoryTimelineData; error?: string; retry: () => void; selected: string | null; onSelect: (id: string) => void }) {
  const t = useKnowledgeStrings();
  const s = t.memory;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (data) motion.added(list.current ? Array.from(list.current.querySelectorAll(".kn-entry")).slice(0, 10) : []);
  }, [data]);
  if (error)
    return (
      <div className="kn-graphview__state">
        <Notice tone="critical" action={{ label: t.rag.retry, onClick: retry }}>
          {s.failed(error)}
        </Notice>
      </div>
    );
  if (!data)
    return (
      <p className="kn-loading kn-graphview__state" role="status">
        {s.loading}
      </p>
    );
  if (!data.entries.length) return <p className="kn-empty kn-graphview__state">{s.empty}</p>;
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  const days = new Map<string, typeof data.entries>();
  for (const e of data.entries) days.set(e.occurredAt.slice(0, 10), [...(days.get(e.occurredAt.slice(0, 10)) ?? []), e]);
  return (
    <div ref={list} className="mm-list kn-timeline">
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
