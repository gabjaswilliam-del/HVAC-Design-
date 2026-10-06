import { useId, useState } from "react";
import { Search } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatReading, formatTime } from "../../lib/format";
import { openIssues } from "../../lib/issues";
import type { DeviceFamily, Issue, SiteBundle, Snapshot } from "../../lib/contracts";
import { StateLabel } from "../../components/StateLabel";

type StateFilter = "" | "running" | "stopped" | "fault" | "unavailable" | "stale";
const STATES: Exclude<StateFilter, "">[] = ["running", "stopped", "fault", "unavailable", "stale"];
const RANK = { critical: 1, warning: 2, info: 3 } as const;

/**
 * The plant as a list: the Overview's second view (and the phone's first). Filters by
 * name, type, state and open issues; faults first. Also the fallback when the scene
 * cannot be drawn.
 */
export function EquipmentList({
  site,
  snapshot,
  issues,
  selectedId,
  onSelect,
}: {
  site: SiteBundle;
  snapshot?: Snapshot;
  issues?: Issue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const s = useStrings();
  const l = s.monitoring.list;
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<"" | DeviceFamily>("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const devices = site.topology.devices;
  const families = [...new Set(devices.map((d) => d.family))];
  const open = openIssues(issues);
  const issueOf = (id: string) => open.find((i) => i.equipmentIds.includes(id));
  const stateOf = (id: string): Exclude<StateFilter, ""> | null => {
    const st = snapshot?.equipment[id];
    return st ? (st.stale ? "stale" : st.state) : null;
  };
  const rank = (id: string) => (stateOf(id) === "fault" ? 0 : RANK[issueOf(id)?.severity ?? "info"] + (issueOf(id) ? 0 : 1));
  const q = query.trim().toLowerCase();
  const rows = devices
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank(a.d.id) - rank(b.d.id) || a.i - b.i)
    .map(({ d }) => d)
    .filter(
      (d) =>
        (!q || d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)) &&
        (!family || d.family === family) &&
        (!stateFilter || stateOf(d.id) === stateFilter) &&
        (!onlyIssues || issueOf(d.id)),
    );
  const clear = () => {
    setQuery("");
    setFamily("");
    setStateFilter("");
    setOnlyIssues(false);
  };

  const readingsOf = (id: string, fam: DeviceFamily) => {
    const metrics = site.metrics.filter((m) => m.key.startsWith(`${id}:`));
    const text = (key: string) => formatReading(snapshot?.values[key], metrics.find((m) => m.key === key)) ?? s.quality.unavailable;
    if (fam === "terminal") return l.dataHall(text(`${id}:cooling_demand_kw`), text(`${id}:cooling_delivered_kw`));
    const pair = metrics
      .slice(0, 2)
      .map((m) => text(m.key))
      .join(", ");
    // A tower's readings are its fan's.
    return fam === "cooling_towers" ? l.fan(pair) : pair;
  };

  return (
    <div className="listview">
      <div className="filters" role="search" aria-label={l.filters}>
        <span className="field">
          <Search size={16} aria-hidden="true" />
          <label htmlFor={searchId} className="visually-hidden">
            {l.search}
          </label>
          <input id={searchId} type="search" placeholder={l.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <label>
          <span className="visually-hidden">{l.type}</span>
          <select className="select" value={family} onChange={(e) => setFamily(e.target.value as DeviceFamily | "")}>
            <option value="">{l.allTypes}</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {s.families[f]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="visually-hidden">{l.state}</span>
          <select className="select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
            <option value="">{l.allStates}</option>
            {STATES.map((x) => (
              <option key={x} value={x}>
                {s.scene.states[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
          {l.withIssues}
        </label>
        <span className="filters__count num" aria-live="polite">
          {l.showing(rows.length, devices.length)}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="listview__empty">
          <p>{l.noMatch}</p>
          <button type="button" className="button button--small" onClick={clear}>
            {l.clear}
          </button>
        </div>
      ) : (
        <table className="data-table equipment-list">
          <thead>
            <tr>
              <th scope="col">{l.equipment}</th>
              <th scope="col" className="equipment-list__type">
                {l.type}
              </th>
              <th scope="col">{l.state}</th>
              <th scope="col">{l.issue}</th>
              <th scope="col" className="num">
                {l.readings}
              </th>
              <th scope="col" className="num equipment-list__time">
                {l.updated}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const status = snapshot?.equipment[d.id];
              const issue = issueOf(d.id);
              return (
                <tr key={d.id} className={selectedId === d.id ? "is-selected" : undefined} data-row={d.id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="text-button equipment-list__name"
                      aria-pressed={selectedId === d.id}
                      data-select-id={d.id}
                      onClick={() => onSelect(d.id)}
                    >
                      {d.label}
                    </button>
                  </th>
                  <td className="equipment-list__type">{s.families[d.family]}</td>
                  <td>{status ? <StateLabel state={status.state} stale={status.stale} /> : s.quality.unavailable}</td>
                  <td>{issue && <span className={`sev sev--${issue.severity}`}>{`${s.issues.severity[issue.severity]}, ${issue.id}`}</span>}</td>
                  <td className="num">{readingsOf(d.id, d.family)}</td>
                  <td className="num equipment-list__time">
                    {status?.sampleTime ? formatTime(status.sampleTime, site.site.timezone) : s.inspector.noSample}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="listview__note">{l.note}</p>
    </div>
  );
}
