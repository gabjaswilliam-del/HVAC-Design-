/**
 * The controls floating over Graph Memory's timeline: one search box, the filters (which are
 * the legend too), help, and the switch between the timeline and the list.
 *
 * The search box looks through every record, not only those on screen or within the filters:
 * titles, notes, equipment, kinds, provenance, run IDs and dates. Its choices open a record on
 * the timeline, show an equipment item's records, filter by kind, provenance or a range of
 * days, go to a day, or search all the records' text with the service (the words filter). An
 * ARIA combobox: arrows move, Enter takes the highlighted choice (the first by default),
 * Escape closes the list.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Boxes, CalendarDays, CalendarRange, CircleHelp, FileSearch, ListFilter, Search, SlidersHorizontal } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { MEMORY_KINDS, PROVENANCE, type MemoryKind, type MemoryRecord, type MemoryStatus, type Provenance } from "../../../lib/contracts/memory";
import { RadioGroup } from "../../../components/RadioGroup";
import { useDismissOutside, useEscapeLayer } from "../../../components/escape";
import { equipmentName, formatUtc, useFocusAway, useMenu } from "../shared";
import { KIND_COLOURS, KIND_ICONS, ProvenanceTag } from "./kinds";
import { parseDays } from "./timeline";

export type Window = "all" | "7d" | "30d" | "custom";
/** Graph Memory's three views of the same records. */
export type View = "3d" | "timeline" | "list";
export interface Filters {
  query: string;
  kinds: MemoryKind[];
  provenance: Provenance | "";
  equipment: string;
  window: Window;
  from: string;
  to: string;
  includeSuperseded: boolean;
}
export const NONE: Filters = { query: "", kinds: [], provenance: "", equipment: "", window: "all", from: "", to: "", includeSuperseded: false };
/** How many filters are on. */
export const active = (f: Filters) => [f.query, f.kinds.length, f.provenance, f.equipment, f.window !== "all", f.includeSuperseded].filter(Boolean).length;

export type SearchChoice =
  | { kind: "record"; id: string }
  | { kind: "equipment"; id: string }
  | { kind: "kind"; value: MemoryKind }
  | { kind: "provenance"; value: Provenance }
  | { kind: "day"; from: string; to: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "words"; q: string };

const dayName = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function MemorySearch({ records, equipment, words, onChoose }: { records: MemoryRecord[]; equipment: string[]; words: string; onChoose: (c: SearchChoice) => void }) {
  const t = useKnowledgeStrings();
  const s = t.memory.search;
  const m = t.memory;
  const [text, setText] = useState(words);
  useEffect(() => setText(words), [words]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const term = text.trim();
  const lower = term.toLowerCase();
  const tokens = lower.split(/\s+/).filter(Boolean);

  const options: { id: string; choice: SearchChoice; icon: ReactNode; name: string; meta: string; colour?: string }[] = [];
  if (term.length > 1) {
    const year = new Date(records.map((r) => r.occurredAt).sort().at(-1) ?? Date.now()).getUTCFullYear();
    const days = parseDays(term, year);
    if (days && days.from === days.to) options.push({ id: `${listId}-day`, choice: { kind: "day", ...days }, icon: <CalendarDays size={14} aria-hidden="true" />, name: s.day(dayName(days.from)), meta: "UTC" });
    if (days && days.from !== days.to) options.push({ id: `${listId}-range`, choice: { kind: "range", ...days }, icon: <CalendarRange size={14} aria-hidden="true" />, name: s.range(dayName(days.from), dayName(days.to)), meta: s.filter });
    for (const id of equipment.filter((e) => equipmentName(e).toLowerCase().includes(lower) || e.includes(lower)).slice(0, 3))
      options.push({ id: `${listId}-eq-${id}`, choice: { kind: "equipment", id }, icon: <Boxes size={14} aria-hidden="true" />, name: s.equipment(equipmentName(id)), meta: m.timeline.records(records.filter((r) => r.equipment.includes(id)).length) });
    // Records whose words, equipment, kind, provenance, run or date hold every word typed:
    // titles first, then the latest.
    const said = (r: MemoryRecord) => `${r.title} ${r.body} ${r.equipment.map(equipmentName).join(" ")} ${r.equipment.join(" ")} ${m.kinds[r.kind]} ${m.provenance.labels[r.provenance]} ${r.runId ?? ""} ${r.occurredAt.slice(0, 10)}`.toLowerCase();
    const found = records
      .filter((r) => tokens.every((w) => said(r).includes(w)))
      .sort((a, b) => Number(!a.title.toLowerCase().includes(lower)) - Number(!b.title.toLowerCase().includes(lower)) || b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 6);
    for (const r of found) {
      const Icon = KIND_ICONS[r.kind];
      options.push({
        id: `${listId}-${r.id}`,
        choice: { kind: "record", id: r.id },
        icon: <Icon size={14} aria-hidden="true" />,
        colour: KIND_COLOURS[r.kind],
        name: r.title,
        meta: `${s.record(m.kinds[r.kind], formatUtc(r.occurredAt), r.equipment.map(equipmentName).join(", "))}${r.status === "superseded" ? ` · ${m.superseded}` : ""}`,
      });
    }
    for (const k of MEMORY_KINDS.filter((k) => m.kinds[k].toLowerCase().startsWith(lower) || m.kindsPlural[k].startsWith(lower)).slice(0, 2))
      options.push({ id: `${listId}-kind-${k}`, choice: { kind: "kind", value: k }, icon: <ListFilter size={14} aria-hidden="true" />, name: s.kind(m.kindsPlural[k]), meta: s.filter });
    for (const p of PROVENANCE.filter((p) => m.provenance.labels[p].toLowerCase().includes(lower)).slice(0, 2))
      options.push({ id: `${listId}-prov-${p}`, choice: { kind: "provenance", value: p }, icon: <ListFilter size={14} aria-hidden="true" />, name: s.provenance(m.provenance.labels[p]), meta: s.filter });
    options.push({ id: `${listId}-words`, choice: { kind: "words", q: term }, icon: <FileSearch size={14} aria-hidden="true" />, name: s.words(term), meta: s.wordsHint });
  }
  const recordsFound = options.some((o) => o.choice.kind === "record");
  const shown = open && options.length > 0;
  const at = Math.min(active, options.length - 1);
  const close = useCallback(() => setOpen(false), []);
  useEscapeLayer(shown, close);
  useDismissOutside(shown, box, close);
  useFocusAway(shown, box, close);
  const activeId = shown ? options[at].id : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);
  const choose = (o: (typeof options)[number]) => {
    setOpen(false);
    if (o.choice.kind !== "words") setText("");
    onChoose(o.choice);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (Math.min(a, options.length - 1) + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Enter" && options.length) {
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
        maxLength={300}
        placeholder={s.placeholder}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {shown && (
        <div className="kn-search__pop" data-obstacle>
          {!recordsFound && <p className="kn-search__none kn-meta">{s.none}</p>}
          <ul id={listId} role="listbox" aria-label={s.options} className="kn-search__list">
            {options.map((o, i) => (
              <li
                key={o.id}
                id={o.id}
                role="option"
                aria-selected={i === at}
                className={`kn-search__option${o.choice.kind === "words" ? " kn-search__option--passages" : ""}`}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                <span className="kn-search__icon" style={o.colour ? { color: o.colour } : undefined}>
                  {o.icon}
                </span>
                <span className="kn-search__name">{o.name}</span>
                <span className="kn-meta">{o.meta}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The filters, and the legend: each kind with its icon, colour and count. */
export function MemoryFiltersMenu({ filters, setFilters, equipment, counts }: { filters: Filters; setFilters: (f: (prev: Filters) => Filters) => void; equipment: string[]; counts: Map<MemoryKind, number> }) {
  const m = useKnowledgeStrings().memory;
  const s = m.filters;
  const { open, setOpen, box, id } = useMenu();
  const on = active(filters);
  return (
    <div ref={box} className="kn-hud__menu">
      <button type="button" className="kn-hud__button" aria-expanded={open} aria-controls={open ? id : undefined} data-active={on > 0 || undefined} title={s.title} onClick={() => setOpen((v) => !v)}>
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span className="kn-hud__label">{on ? s.active(on) : s.open}</span>
      </button>
      {open && (
        <div id={id} className="kn-popover mm-filters" role="group" aria-label={s.panel} data-obstacle>
          <h4 className="kn-family__name">{s.legend}</h4>
          <div className="kn-filters" role="group" aria-label={s.kinds}>
            {MEMORY_KINDS.map((k) => {
              const Icon = KIND_ICONS[k];
              return (
                <button
                  key={k}
                  type="button"
                  className="kn-filter"
                  aria-pressed={filters.kinds.includes(k)}
                  onClick={() => setFilters((f) => ({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] }))}
                >
                  <Icon size={14} aria-hidden="true" style={{ color: KIND_COLOURS[k] }} />
                  {m.kinds[k]}
                  {counts.has(k) && <span className="kn-chip-count">{counts.get(k)}</span>}
                </button>
              );
            })}
          </div>
          <div className="mm-filters__grid">
            <label className="kn-field">
              <span>{s.equipment}</span>
              <select className="select" value={filters.equipment} onChange={(e) => setFilters((f) => ({ ...f, equipment: e.target.value }))}>
                <option value="">{s.anyEquipment}</option>
                {equipment.map((eq) => (
                  <option key={eq} value={eq}>
                    {equipmentName(eq)}
                  </option>
                ))}
              </select>
            </label>
            <label className="kn-field">
              <span>{s.provenance}</span>
              <select className="select" value={filters.provenance} onChange={(e) => setFilters((f) => ({ ...f, provenance: e.target.value as Provenance | "" }))}>
                <option value="">{s.anyProvenance}</option>
                {PROVENANCE.map((p) => (
                  <option key={p} value={p}>
                    {m.provenance.labels[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="kn-field">
              <span>{s.window}</span>
              <select className="select" value={filters.window} onChange={(e) => setFilters((f) => ({ ...f, window: e.target.value as Window }))}>
                {(["all", "7d", "30d", "custom"] as const).map((w) => (
                  <option key={w} value={w}>
                    {s.windows[w]}
                  </option>
                ))}
              </select>
            </label>
            {filters.window === "custom" && (
              <>
                <label className="kn-field">
                  <span>{s.from}</span>
                  <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
                </label>
                <label className="kn-field">
                  <span>{s.to}</span>
                  <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
                </label>
              </>
            )}
          </div>
          <label className="check kn-check">
            <input type="checkbox" checked={filters.includeSuperseded} onChange={(e) => setFilters((f) => ({ ...f, includeSuperseded: e.target.checked }))} />
            {s.superseded}
          </label>
          {on > 0 && (
            <button type="button" className="button button--small button--quiet mm-filters__clear" onClick={() => setFilters(() => NONE)}>
              {s.clear}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** How to read and move round the timeline, what Graph Memory stores and keeps, and the
 *  provenance labels: in Help, and the reading and keys also as the canvas's description. */
export function MemoryHelp({ status, demo, view }: { status?: MemoryStatus; demo: boolean; view: View }) {
  const t = useKnowledgeStrings();
  const m = t.memory;
  const { open, setOpen, box, id } = useMenu();
  return (
    <div ref={box} className="kn-hud__menu">
      <button type="button" className="icon-button" aria-label={m.help.open} title={m.help.open} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((v) => !v)}>
        <CircleHelp size={16} aria-hidden="true" />
      </button>
      {open && (
        // Focusable: it scrolls, and the keys can scroll it.
        <section id={id} className="kn-popover kn-popover--end mm-help" aria-labelledby={`${id}-title`} tabIndex={0} data-obstacle>
          <h3 id={`${id}-title`}>{m.help.title}</h3>
          <p>{t.lead.memory}</p>
          <p>{view === "3d" ? m.constellation.reading : m.help.reading}</p>
          <p>{m.help.axis}</p>
          <p>{view === "3d" ? m.constellation.hint : m.timeline.hint}</p>
          <p>{view === "3d" ? m.constellation.keys : m.timeline.keys}</p>
          <p>{m.help.search}</p>
          <h4>{m.help.rules}</h4>
          <ul>
            {m.rules.items.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {status && (
            <>
              <h4>{m.rules.provenanceTitle}</h4>
              <ul className="mm-help__provenance">
                {status.provenance.map((p) => (
                  <li key={p.id}>
                    <ProvenanceTag provenance={p.id} /> {m.provenance.explain[p.id]} {!p.allowed && <span className="kn-meta kn-meta--caution">{p.reason}</span>}
                  </li>
                ))}
              </ul>
              <h4>{m.rules.retentionTitle}</h4>
              <p>{status.retention}</p>
              <p className="kn-meta">{status.storage.persistent ? m.rules.storedLocal : m.rules.storedDemo}</p>
            </>
          )}
          {demo && <p className="kn-meta">{m.demoNote}</p>}
        </section>
      )}
    </div>
  );
}

/** 3D | Timeline | List among the tools (3D unavailable without WebGL). Switching replaces the
 *  tools, so the new switch takes the focus the old one had. */
export function ViewSwitch({ view, can3d, onChange, refocus }: { view: View; can3d: boolean; onChange: (v: View) => void; refocus: { current: boolean } }) {
  const s = useKnowledgeStrings().memory.views;
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
        value={view}
        onChange={onChange}
        options={[
          { value: "3d", label: s.three, disabled: !can3d },
          { value: "timeline", label: s.timeline },
          { value: "list", label: s.list },
        ]}
      />
    </div>
  );
}
