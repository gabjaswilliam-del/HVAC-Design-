import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Search } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatReading, formatTime } from "../../lib/format";
import type { DeviceFamily } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { StateLabel } from "../../components/StateLabel";
import { operating } from "../../app/operatingContext";
import { PlaybackBar } from "../../app/PlaybackBar";
import { useIssues, useSite, useSnapshot } from "../../app/site";
import { EquipmentInspector } from "./EquipmentInspector";
import "./equipment.css";

type StateFilter = "" | "running" | "stopped" | "fault" | "unavailable" | "stale";
const STATES: Exclude<StateFilter, "">[] = ["running", "stopped", "fault", "unavailable", "stale"];

/**
 * Searchable equipment roster with the shared inspector. Uses the same snapshot,
 * issues and selection as monitoring; `/equipment/<id>` deep-links a selection.
 */
export function EquipmentPage() {
  const s = useStrings();
  const t = s.equipmentPage;
  const l = s.monitoring.list;
  const site = useSite();
  const snapshot = useSnapshot();
  const issues = useIssues();
  const { equipmentId = null } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<"" | DeviceFamily>("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [focusInspector, setFocusInspector] = useState(false);

  // Keep the shared selection in step so monitoring shows the same equipment.
  useEffect(() => {
    operating.select(equipmentId);
  }, [equipmentId]);

  const search = location.search;
  const select = useCallback(
    (id: string) => {
      setFocusInspector(true);
      navigate({ pathname: `/equipment/${encodeURIComponent(id)}`, search });
    },
    [navigate, search],
  );
  const close = useCallback(() => {
    const id = equipmentId;
    navigate({ pathname: "/equipment", search });
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-select-id="${id}"]`)?.focus());
  }, [navigate, search, equipmentId]);
  const showOnPlant = useCallback(
    (id: string) => {
      const next = new URLSearchParams(search);
      next.set("equipment", id);
      next.set("locate", "1");
      navigate({ pathname: "/", search: `?${next}` });
    },
    [navigate, search],
  );

  const openIssues = useMemo(() => (issues.data?.issues ?? []).filter((i) => i.status !== "resolved"), [issues.data]);

  if (site.error && !site.data) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{t.heading}</h1>
        <Notice tone="critical" action={{ label: s.monitoring.retry, onClick: site.retry }}>
          {s.monitoring.siteFailed} {site.error.message}
        </Notice>
      </div>
    );
  }
  if (!site.data) {
    return (
      <div className="page">
        <h1 tabIndex={-1}>{t.heading}</h1>
        <div className="skeleton" style={{ height: 400 }} />
      </div>
    );
  }

  const bundle = site.data;
  const snap = snapshot.data;
  const devices = bundle.topology.devices;
  const stateOf = (id: string): Exclude<StateFilter, ""> | null => {
    const st = snap?.equipment[id];
    return st ? (st.stale ? "stale" : st.state) : null;
  };
  const issueCount = (id: string) => openIssues.filter((i) => i.equipmentIds.includes(id)).length;
  const q = query.trim().toLowerCase();
  const rows = devices.filter(
    (d) =>
      (!q || d.label.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)) &&
      (!family || d.family === family) &&
      (!stateFilter || stateOf(d.id) === stateFilter) &&
      (!onlyIssues || issueCount(d.id) > 0),
  );
  const counts = STATES.map((x) => [x, devices.filter((d) => stateOf(d.id) === x).length] as const).filter(([, n]) => n > 0);
  const families = [...new Set(devices.map((d) => d.family))];
  const clear = () => (setQuery(""), setFamily(""), setStateFilter(""), setOnlyIssues(false));

  return (
    <div className="page equipment-page">
      <div className="page__head">
        <h1 tabIndex={-1}>{t.heading}</h1>
        <p className="page__notice num">
          {t.summary(devices.length)} {bundle.topology.configRevision}
          {snap && <>: {counts.map(([x, n]) => `${n} ${s.scene.states[x].toLowerCase()}`).join(", ")}</>}
        </p>
      </div>

      <div className="equipment-page__filters" role="search">
        <div className="equipment-page__search">
          <Search size={16} aria-hidden="true" />
          <label htmlFor={searchId} className="visually-hidden">
            {t.search}
          </label>
          <input
            id={searchId}
            type="search"
            className="select"
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="equipment-page__filter">
          <span>{t.type}</span>
          <select className="select" value={family} onChange={(e) => setFamily(e.target.value as DeviceFamily | "")}>
            <option value="">{t.allTypes}</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {s.families[f]}
              </option>
            ))}
          </select>
        </label>
        <label className="equipment-page__filter">
          <span>{t.state}</span>
          <select className="select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
            <option value="">{t.allStates}</option>
            {STATES.map((x) => (
              <option key={x} value={x}>
                {s.scene.states[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="equipment-page__check">
          <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> {t.withIssues}
        </label>
        <span className="equipment-page__count num" aria-live="polite">
          {t.showing(rows.length, devices.length)}
        </span>
      </div>

      {snapshot.error && (
        <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: snapshot.retry }}>
          {s.monitoring.loadFailed} {snapshot.error.message}
        </Notice>
      )}

      <div className={`equipment-page__work${equipmentId ? " equipment-page__work--inspecting" : ""}`}>
        <div className="equipment-list">
          {rows.length === 0 ? (
            <div className="equipment-page__empty">
              <p>{t.noMatch}</p>
              <button type="button" className="button button--small" onClick={clear}>
                {t.clear}
              </button>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{l.equipment}</th>
                  <th scope="col" className="equipment-list__type">
                    {l.type}
                  </th>
                  <th scope="col">{l.state}</th>
                  <th scope="col">{l.readings}</th>
                  <th scope="col" className="num">
                    {t.openIssues}
                  </th>
                  <th scope="col" className="equipment-list__type">
                    {t.evidence}
                  </th>
                  <th scope="col">{l.updated}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const status = snap?.equipment[d.id];
                  const readings = bundle.metrics
                    .filter((m) => m.key.startsWith(`${d.id}:`))
                    .slice(0, 2)
                    .map((m) => formatReading(snap?.values[m.key], m) ?? s.quality.unavailable);
                  const n = issueCount(d.id);
                  return (
                    <tr key={d.id} className={equipmentId === d.id ? "is-selected" : undefined} data-row={d.id}>
                      <th scope="row">
                        <button
                          type="button"
                          className="text-button equipment-list__name"
                          aria-pressed={equipmentId === d.id}
                          data-select-id={d.id}
                          onClick={() => select(d.id)}
                        >
                          {d.label}
                        </button>
                      </th>
                      <td className="equipment-list__type">{s.families[d.family]}</td>
                      <td>{status ? <StateLabel state={status.state} stale={status.stale} /> : s.quality.unavailable}</td>
                      <td className="num">{readings.join(", ")}</td>
                      <td className={`num${n ? " equipment-page__issues" : ""}`}>{n}</td>
                      <td className="equipment-list__type">
                        <span className={`badge badge--${d.evidence}`}>{s.evidence[d.evidence]}</span>
                      </td>
                      <td className="num">
                        {status?.sampleTime ? formatTime(status.sampleTime, bundle.site.timezone) : s.inspector.noSample}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {equipmentId && (
          <div className="equipment-page__inspector">
            <EquipmentInspector
              equipmentId={equipmentId}
              site={bundle}
              snapshot={snap}
              issues={issues.data?.issues ?? []}
              onSelect={select}
              onLocate={showOnPlant}
              onClose={close}
              focusOnOpen={focusInspector}
            />
          </div>
        )}
      </div>

      <PlaybackBar timeZone={bundle.site.timezone} timezoneLabel={bundle.site.timezoneLabel} />
    </div>
  );
}
