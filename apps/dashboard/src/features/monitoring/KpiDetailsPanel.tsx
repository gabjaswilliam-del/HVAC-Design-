import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "react-router";
import { Beaker, Crosshair, PanelRight, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatReading, formatTime, siteDayStart } from "../../lib/format";
import { useResource, type Resource } from "../../lib/api/useResource";
import type { History, Issue, IssueList, Reading, SiteBundle, Snapshot } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { StateLabel } from "../../components/StateLabel";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";
import { ISSUES_KPI, KPI_DEFS, type EquipmentRef } from "./kpiDefinitions";

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const SERIES_COLOR: Record<string, string> = {
  "plant:cooling_demand_kw": "var(--chart-observed)",
  "plant:cooling_delivered_kw": "var(--chart-delivered)",
  "plant:available_capacity_kw": "var(--text-muted)",
};

interface KpiDetailsPanelProps {
  kpiKey: string;
  site: SiteBundle;
  snapshot: Snapshot | undefined;
  issues: Resource<IssueList>;
  onClose: () => void;
  onLocate: (id: string) => void;
  onInspect: (id: string) => void;
  focusOnOpen?: boolean;
}

/**
 * Details for one plant indicator, in the same side column as the equipment inspector.
 * Arranges values the backend reported for the current playback time; it does not
 * recalculate indicators, invent missing readings or add recommendations.
 */
export function KpiDetailsPanel({ kpiKey, site, snapshot, issues, onClose, onLocate, onInspect, focusOnOpen }: KpiDetailsPanelProps) {
  const s = useStrings();
  const p = s.kpiPanel;
  const heading = useRef<HTMLHeadingElement>(null);
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const isIssues = kpiKey === ISSUES_KPI;
  const info = site.metrics.find((m) => m.key === kpiKey);
  const title = isIssues ? p.issues.heading : info?.label ?? kpiKey;

  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [kpiKey, focusOnOpen]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reading = (key: string): Reading | undefined => snapshot?.kpis[key] ?? snapshot?.values[key];
  const current = reading(kpiKey);
  const openIssues = (issues.data?.issues ?? []).filter((i) => i.status !== "resolved");

  return (
    <aside className="inspector kpi-panel" id="kpi-panel" aria-label={p.label} data-kpi-panel={kpiKey}>
      <div className="inspector__head">
        <div>
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <p className="kpi-panel__value num">
            {isIssues ? (
              issues.data ? openIssues.length : " "
            ) : current && current.value !== null ? (
              <>
                {formatNumber(current.value, info?.decimals ?? 1)}
                {info?.unit && <span className="kpi__unit"> {info.unit}</span>}
                {current.quality !== "good" && <span className="kpi-panel__quality"> {s.quality[current.quality]}</span>}
              </>
            ) : (
              <span className="inspector__muted">{snapshot ? s.quality.unavailable : " "}</span>
            )}
          </p>
          {snapshot && (
            <p className="inspector__muted num">
              {s.monitoring.readingsAt} {formatTime(snapshot.at, tz)} {tzLabel}
            </p>
          )}
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={p.close} title={p.close}>
          <X size={18} />
        </button>
      </div>
      <p className="kpi-panel__synthetic">
        <Beaker size={14} aria-hidden="true" /> {p.synthetic}
      </p>

      {isIssues ? (
        <IssuesBody site={site} snapshot={snapshot} issues={issues} onLocate={onLocate} onInspect={onInspect} />
      ) : (
        <IndicatorBody kpiKey={kpiKey} site={site} snapshot={snapshot} onLocate={onLocate} onInspect={onInspect} />
      )}
    </aside>
  );
}

function useReadingTools(site: SiteBundle, snapshot: Snapshot | undefined) {
  const s = useStrings();
  const info = (key: string) => site.metrics.find((m) => m.key === key);
  const reading = (key: string): Reading | undefined => snapshot?.kpis[key] ?? snapshot?.values[key];
  const label = (key: string) => {
    const m = info(key);
    const owner = site.topology.devices.find((d) => d.id === key.split(":")[0]);
    return owner ? `${owner.label}: ${m?.label ?? key}` : m?.label ?? key;
  };
  const value = (key: string) => formatReading(reading(key), info(key)) ?? s.quality.unavailable;
  return { info, reading, label, value };
}

function ReadingsTable({ keys, site, snapshot }: { keys: string[]; site: SiteBundle; snapshot: Snapshot | undefined }) {
  const s = useStrings();
  const { reading, label, value } = useReadingTools(site, snapshot);
  return (
    <table className="data-table">
      <tbody>
        {keys.map((k) => {
          const q = reading(k)?.quality ?? "unavailable";
          return (
            <tr key={k} data-reading={k}>
              <th scope="row">{label(k)}</th>
              <td className="num">{value(k)}</td>
              <td className={`quality quality--${q}`}>{s.quality[q]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EquipmentRows({
  refs,
  site,
  snapshot,
  onLocate,
  onInspect,
  sortByValue = false,
}: {
  refs: EquipmentRef[];
  site: SiteBundle;
  snapshot: Snapshot | undefined;
  onLocate: (id: string) => void;
  onInspect: (id: string) => void;
  sortByValue?: boolean;
}) {
  const s = useStrings();
  const { reading, value } = useReadingTools(site, snapshot);
  const rows = refs
    .map((r) => ({ ...r, device: site.topology.devices.find((d) => d.id === r.id), v: r.metric ? reading(r.metric)?.value ?? null : null }))
    .filter((r) => r.device);
  if (sortByValue) rows.sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
  const max = Math.max(...rows.map((r) => r.v ?? 0), 1);
  return (
    <ul className="kpi-panel__equipment">
      {rows.map((r) => {
        const status = snapshot?.equipment[r.id];
        return (
          <li key={r.id} data-equipment-row={r.id}>
            <span className="kpi-panel__equipment-name">{r.device!.label}</span>
            {status && <StateLabel state={status.state} stale={status.stale} />}
            {r.metric && <span className="num kpi-panel__equipment-value">{value(r.metric)}</span>}
            {sortByValue && <span className="kpi-panel__bar" style={{ width: `${((r.v ?? 0) / max) * 100}%` }} aria-hidden="true" />}
            <span className="kpi-panel__actions">
              <button type="button" className="button button--small" onClick={() => onLocate(r.id)} aria-label={`${s.kpiPanel.locate} ${r.device!.label}`}>
                <Crosshair size={14} aria-hidden="true" />
                {s.kpiPanel.locate}
              </button>
              <button type="button" className="button button--small" onClick={() => onInspect(r.id)} aria-label={`${s.kpiPanel.inspect} ${r.device!.label}`}>
                <PanelRight size={14} aria-hidden="true" />
                {s.kpiPanel.inspect}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** Contiguous periods in which the reported unmet demand was above zero. */
export function shortfallPeriods(history: History | undefined) {
  const unmet = history?.series.find((x) => x.metric === "plant:unmet_kw");
  if (!history || !unmet) return [];
  const periods: { from: string; to: string; peak: number; ongoing: boolean }[] = [];
  unmet.values.forEach((v, i) => {
    const t = history.times[i];
    const last = periods.at(-1);
    if (v !== null && v > 0) {
      if (last && last.ongoing) (last.to = t), (last.peak = Math.max(last.peak, v));
      else periods.push({ from: t, to: t, peak: v, ongoing: true });
    } else if (last) last.ongoing = false;
  });
  return periods;
}

function IndicatorBody({
  kpiKey,
  site,
  snapshot,
  onLocate,
  onInspect,
}: {
  kpiKey: string;
  site: SiteBundle;
  snapshot: Snapshot | undefined;
  onLocate: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const s = useStrings();
  const p = s.kpiPanel;
  const def = KPI_DEFS[kpiKey];
  const text = s.kpiText[kpiKey];
  const tz = site.site.timezone;
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const { info, reading, value } = useReadingTools(site, snapshot);
  const at = snapshot?.at ?? null;
  const from = at ? new Date(siteDayStart(Date.parse(at), tz)).toISOString() : "";
  const metrics = def.comparison ? [...def.trend, "plant:unmet_kw"] : def.trend;
  const history = useResource(at && `kpi:${kpiKey}:${at}`, scenarioId, (signal) =>
    client.getHistory({ metrics, from, to: at! }, { signal }),
  );

  const qualityKeys = [...new Set([kpiKey, ...def.inputs, ...def.measurements])];
  const problems = qualityKeys.filter((k) => (reading(k)?.quality ?? "unavailable") !== "good");
  const stale = problems.filter((k) => reading(k)?.quality === "stale").length;
  const references = def.references.flatMap((r) => {
    const device = site.topology.devices.find((d) => d.family === r.family);
    return (device?.nameplate ?? []).filter((n) => r.labels.includes(n.label));
  });

  // Delivered first and wider, so demand drawn on top stays visible where they coincide.
  const drawOrder = (m: string) => (m === "plant:cooling_delivered_kw" ? 0 : 1);
  const series: ChartSeries[] = (history.data?.series ?? [])
    .filter((x) => def.trend.includes(x.metric))
    .sort((a, b) => drawOrder(a.metric) - drawOrder(b.metric))
    .map((x) => ({
      id: x.metric,
      label: info(x.metric)?.label ?? x.metric,
      color: SERIES_COLOR[x.metric] ?? "var(--chart-observed)",
      dashed: x.metric === "plant:available_capacity_kw",
      width: x.metric === "plant:cooling_delivered_kw" ? 5 : 2,
      points: history.data!.times.map((t, i) => ({ t: Date.parse(t), v: x.values[i] })),
    }));
  const unmetNow = reading("plant:unmet_kw");
  const periods = def.comparison ? shortfallPeriods(history.data) : [];

  return (
    <>
      <Section title={p.about}>
        <p className="kpi-panel__text">{text?.about}</p>
      </Section>

      {(text?.definition || def.inputs.length > 0) && (
        <Section title={p.definition}>
          {text?.definition && <p className="kpi-panel__text">{text.definition}</p>}
          {def.inputs.length > 0 && (
            <>
              <ReadingsTable keys={def.inputs} site={site} snapshot={snapshot} />
              <p className="inspector__muted">{p.definitionNote}</p>
            </>
          )}
        </Section>
      )}

      {def.comparison && snapshot && (
        <Section title={p.comparison}>
          {unmetNow?.value ? (
            <Notice tone="warning">{p.shortfallNow(value("plant:unmet_kw"))}</Notice>
          ) : unmetNow?.quality === "good" ? (
            <p className="kpi-panel__text">{p.noShortfallNow}</p>
          ) : null}
          <h4 className="kpi-panel__subhead">{p.shortfallPeriods}</h4>
          {!history.data ? (
            <div className="skeleton" style={{ height: 24 }} />
          ) : periods.length ? (
            <ul className="kpi-panel__periods" data-shortfall-periods>
              {periods.map((x) => (
                <li key={x.from} className="num">
                  {p.period(formatTime(x.from, tz), x.ongoing ? p.ongoing : formatTime(x.to, tz), `${formatNumber(x.peak, 0)} kWt`)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="inspector__muted">{p.noShortfallToday}</p>
          )}
          <p className="inspector__muted">{p.capacityNote}</p>
        </Section>
      )}

      <Section title={p.trend}>
        {history.error ? (
          <p className="inspector__muted">{history.error.message}</p>
        ) : !history.data ? (
          <div className="skeleton" style={{ height: 160 }} />
        ) : (
          <TimeSeriesChart
            title={`${info(kpiKey)?.label}, ${p.trend.toLowerCase()}`}
            series={series}
            unit={info(kpiKey)?.unit ?? ""}
            decimals={info(kpiKey)?.decimals ?? 1}
            timeZone={tz}
            xDomain={[Date.parse(from), Date.parse(at!)]}
            height={170}
          />
        )}
        {def.comparison && (
          <Link className="link" to="/prediction">
            {p.openForecast}
          </Link>
        )}
      </Section>

      {def.measurements.length > 0 && (
        <Section title={p.measurements}>
          <ReadingsTable keys={def.measurements} site={site} snapshot={snapshot} />
        </Section>
      )}

      {references.length > 0 && (
        <Section title={p.references}>
          <table className="data-table">
            <tbody>
              {references.map((n) => (
                <tr key={n.label}>
                  <th scope="row">{n.label}</th>
                  <td className="num">
                    {n.value} {n.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={p.quality}>
        {problems.length === 0 ? (
          <p className="kpi-panel__text">{p.allGood}</p>
        ) : (
          <>
            <p className="kpi-panel__text">{p.qualityIssues(stale, problems.length - stale)}</p>
            <ReadingsTable keys={problems} site={site} snapshot={snapshot} />
          </>
        )}
        {snapshot?.latestSampleAt && (
          <p className="inspector__muted num">
            {p.lastSample} {formatTime(snapshot.latestSampleAt, tz)} {site.site.timezoneLabel}
          </p>
        )}
      </Section>

      <Section title={def.breakdown ? p.breakdown : p.equipment}>
        <EquipmentRows
          refs={def.equipment(site)}
          site={site}
          snapshot={snapshot}
          onLocate={onLocate}
          onInspect={onInspect}
          sortByValue={def.breakdown}
        />
      </Section>
    </>
  );
}

function IssuesBody({
  site,
  snapshot,
  issues,
  onLocate,
  onInspect,
}: {
  site: SiteBundle;
  snapshot: Snapshot | undefined;
  issues: Resource<IssueList>;
  onLocate: (id: string) => void;
  onInspect: (id: string) => void;
}) {
  const s = useStrings();
  const p = s.kpiPanel.issues;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  if (issues.error && !issues.data) {
    return (
      <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: issues.retry }}>
        {s.issues.loadFailed} {issues.error.message}
      </Notice>
    );
  }
  if (!issues.data) return <div className="skeleton" style={{ height: 120 }} />;
  const sorted = [...issues.data.issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const open = sorted.filter((i) => i.status !== "resolved");
  const resolved = sorted.filter((i) => i.status === "resolved");

  const card = (i: Issue) => (
    <article key={i.id} className={`issue-card issue-line issue-line--${i.severity}`} data-issue={i.id}>
      <span className="issue-line__severity">
        {s.issues.severity[i.severity]}, {s.issues.status[i.status].toLowerCase()}, {i.id}
      </span>
      <h3 className="issue-line__title">{i.title}</h3>
      <p className="inspector__muted num">
        {s.issues.firstSeen} {formatTime(i.firstSeen, tz)}, {i.status === "resolved" ? p.resolvedAt : p.lastSeen.toLowerCase()}{" "}
        {formatTime(i.lastSeen, tz)} {tzLabel}
      </p>
      <p className="kpi-panel__text">
        <span className="kpi-panel__label">{p.scenarioText}: </span>
        {i.summary}
      </p>
      {i.status !== "resolved" && (
        <>
          <h4 className="kpi-panel__subhead">{p.affected}</h4>
          {i.equipmentIds.length ? (
            <EquipmentRows refs={i.equipmentIds.map((id) => ({ id }))} site={site} snapshot={snapshot} onLocate={onLocate} onInspect={onInspect} />
          ) : (
            <p className="inspector__muted">{p.noAffected}</p>
          )}
          <h4 className="kpi-panel__subhead">{p.evidence}</h4>
          {i.evidence.length ? (
            <ReadingsTable keys={i.evidence} site={site} snapshot={snapshot} />
          ) : (
            <p className="inspector__muted">{p.noEvidence}</p>
          )}
        </>
      )}
    </article>
  );

  return (
    <>
      {open.length === 0 ? (
        <p className="kpi-panel__text">{p.none(`${formatTime(issues.data.at, tz)} ${tzLabel}`)}</p>
      ) : (
        <div className="kpi-panel__issues">{open.map(card)}</div>
      )}
      {resolved.length > 0 && (
        <Section title={p.resolved}>
          <div className="kpi-panel__issues">{resolved.map(card)}</div>
        </Section>
      )}
    </>
  );
}
