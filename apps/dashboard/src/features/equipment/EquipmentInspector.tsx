import { useEffect, useId, useRef, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Crosshair, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatReading, formatTime, siteDayStart } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import type { Issue, Link, LinkEnd, SiteBundle, Snapshot } from "../../lib/contracts";
import { StateLabel } from "../../components/StateLabel";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";
import { linkMedium } from "../../lib/topology";
import "./equipment.css";

interface EquipmentInspectorProps {
  equipmentId: string;
  site: SiteBundle;
  snapshot: Snapshot | undefined;
  issues: Issue[];
  onSelect: (id: string) => void;
  onLocate?: (id: string) => void;
  onClose: () => void;
  /** Move focus to the inspector heading (when opened by an operator action). */
  focusOnOpen?: boolean;
}

/**
 * The one equipment detail view, shared by monitoring, equipment, assistant and pilot.
 * Observed readings, nameplate data and topology evidence are kept visibly separate;
 * no equipment-level forecast is invented from the site total.
 */
export function EquipmentInspector({
  equipmentId,
  site,
  snapshot,
  issues,
  onSelect,
  onLocate,
  onClose,
  focusOnOpen = false,
}: EquipmentInspectorProps) {
  const s = useStrings();
  const t = s.inspector;
  const heading = useRef<HTMLHeadingElement>(null);
  const tz = site.site.timezone;
  const device = site.topology.devices.find((d) => d.id === equipmentId);

  useEffect(() => {
    if (focusOnOpen) heading.current?.focus();
  }, [equipmentId, focusOnOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closeButton = (
    <button type="button" className="icon-button" onClick={onClose} aria-label={t.close} title={t.close}>
      <X size={18} />
    </button>
  );

  if (!device) {
    return (
      <aside className="inspector" aria-label={t.label}>
        <div className="inspector__head">
          <h2 ref={heading} tabIndex={-1}>
            {t.unknownTitle}
          </h2>
          {closeButton}
        </div>
        <p className="inspector__muted">{t.unknownBody(equipmentId, site.topology.configRevision)}</p>
      </aside>
    );
  }

  const status = snapshot?.equipment[device.id];
  const metrics = site.metrics.filter((m) => m.key.startsWith(`${device.id}:`));
  const related = issues.filter((i) => i.equipmentIds.includes(device.id));
  const labelOf = (end: LinkEnd) =>
    "device" in end
      ? site.topology.devices.find((d) => d.id === end.device)?.label ?? end.device
      : site.topology.buses.find((b) => b.id === end.bus)?.label ?? end.bus;
  const connections = site.topology.links.filter((l) =>
    [l.from, l.to].some((e) => "device" in e && e.device === device.id),
  );
  const unconnected = site.topology.unconnectedPorts.filter((p) => p.device === device.id);

  return (
    <aside className="inspector" aria-label={t.label}>
      <div className="inspector__head">
        <div>
          <h2 ref={heading} tabIndex={-1}>
            {device.label}
          </h2>
          <p className="inspector__muted">
            {s.families[device.family]}
            {device.role === "standby" && <>, {t.standby.toLowerCase()}</>}
          </p>
        </div>
        {closeButton}
      </div>

      <dl className="inspector__facts">
        <div>
          <dt>{s.monitoring.list.state}</dt>
          <dd>{status ? <StateLabel state={status.state} stale={status.stale} /> : s.quality.unavailable}</dd>
        </div>
        <div>
          <dt>{t.sampled}</dt>
          <dd className="num">{status?.sampleTime ? `${formatTime(status.sampleTime, tz)} ${site.site.timezoneLabel}` : t.noSample}</dd>
        </div>
        <div>
          <dt>{t.id}</dt>
          <dd className="inspector__id">{device.id}</dd>
        </div>
        <div>
          <dt>{t.evidence}</dt>
          <dd>
            <span className={`badge badge--${device.evidence}`}>{s.evidence[device.evidence]}</span>
          </dd>
        </div>
      </dl>

      {onLocate && (
        <button type="button" className="button button--small" onClick={() => onLocate(device.id)}>
          <Crosshair size={15} aria-hidden="true" />
          {t.locate}
        </button>
      )}

      <section className="inspector__section">
        <h3>{t.measurements}</h3>
        {metrics.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t.metric}</th>
                <th scope="col" className="num">
                  {t.value}
                </th>
                <th scope="col">{t.quality}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const r = snapshot?.values[m.key];
                const text = formatReading(r, m);
                return (
                  <tr key={m.key} data-metric={m.key}>
                    <th scope="row">{m.label}</th>
                    <td className="num">{text ?? <span className="inspector__muted">{s.quality.unavailable}</span>}</td>
                    <td className={`quality quality--${r?.quality ?? "unavailable"}`}>{s.quality[r?.quality ?? "unavailable"]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="inspector__muted">{s.quality.unavailable}</p>
        )}
      </section>

      {metrics.length > 0 && snapshot && <Trend site={site} at={snapshot.at} metrics={metrics} />}

      <section className="inspector__section">
        <h3>{t.connections}</h3>
        <ul className="inspector__connections">
          {connections.map((l: Link) => {
            const outgoing = "device" in l.from && l.from.device === device.id;
            const own = (outgoing ? l.from : l.to) as { port: string };
            const other = outgoing ? l.to : l.from;
            return (
              <li key={l.id}>
                <span className="inspector__port">{t.ports[own.port] ?? own.port}</span>
                <span className="inspector__dir">{outgoing ? t.to : t.from}</span>
                {"device" in other ? (
                  <button type="button" className="text-button" onClick={() => onSelect(other.device)}>
                    {labelOf(other)}
                  </button>
                ) : (
                  <span>{labelOf(other)}</span>
                )}
                <span className="inspector__medium">{t.media[linkMedium(l)]}</span>
                <span className={`badge badge--${l.evidence}`} title={l.note}>
                  {s.evidence[l.evidence]}
                </span>
                {l.note && <span className="inspector__note">{l.note}</span>}
              </li>
            );
          })}
          {unconnected.map((u) => (
            <li key={u.port}>
              <span className="inspector__port">{t.ports[u.port] ?? u.port}</span>
              <span>{t.notRecorded}</span>
              <span className="badge badge--unknown">{s.evidence.unknown}</span>
              <span className="inspector__note">{u.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="inspector__section">
        <h3>{t.issues}</h3>
        {related.length ? (
          <ul className="inspector__issues">
            {related.map((i) => (
              <li key={i.id} className={`issue-line issue-line--${i.severity}`}>
                <span className="issue-line__severity">{s.issues.severity[i.severity]}</span>
                <span className="issue-line__title">{i.title}</span>
                <span className="inspector__muted">
                  {s.issues.status[i.status]}, {s.issues.firstSeen.toLowerCase()} {formatTime(i.firstSeen, tz)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="inspector__muted">{t.noIssues}</p>
        )}
      </section>

      <section className="inspector__section">
        <h3>{t.nameplate}</h3>
        {device.nameplate.length ? (
          <table className="data-table">
            <tbody>
              {device.nameplate.map((n) => (
                <tr key={n.label}>
                  <th scope="row">{n.label}</th>
                  <td className="num">
                    {n.value} {n.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="inspector__muted">{t.noNameplate}</p>
        )}
      </section>

      <p className="inspector__muted">
        <RouterLink className="link" to="/prediction">
          {t.siteForecast}
        </RouterLink>
        . {t.siteForecastNote}
      </p>
    </aside>
  );
}

function Trend({ site, at, metrics }: { site: SiteBundle; at: string; metrics: SiteBundle["metrics"] }) {
  const s = useStrings();
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const selectId = useId();
  const [metricKey, setMetricKey] = useState(metrics[0].key);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const atMs = Date.parse(at);
  const from = new Date(siteDayStart(atMs, site.site.timezone)).toISOString();
  const history = useResource(`trend:${metric.key}:${at}`, scenarioId, (signal) =>
    client.getHistory({ metrics: [metric.key], from, to: at }, { signal }),
  );
  const series = history.data?.series[0];

  return (
    <section className="inspector__section">
      <div className="inspector__trend-head">
        <h3>{s.inspector.trend}</h3>
        <label htmlFor={selectId} className="visually-hidden">
          {s.inspector.trendMetric}
        </label>
        <select id={selectId} className="select" value={metric.key} onChange={(e) => setMetricKey(e.target.value)}>
          {metrics.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      {history.error ? (
        <p className="inspector__muted">{history.error.message}</p>
      ) : !series ? (
        <div className="skeleton" style={{ height: 150 }} />
      ) : (
        <TimeSeriesChart
          title={`${metric.label}, ${s.inspector.trend.toLowerCase()}`}
          series={[
            {
              id: metric.key,
              label: metric.label,
              color: "var(--chart-observed)",
              points: history.data!.times.map((t, i) => ({ t: Date.parse(t), v: series.values[i] })),
            },
          ]}
          unit={metric.unit}
          decimals={metric.decimals}
          timeZone={site.site.timezone}
          xDomain={[Date.parse(from), atMs]}
          height={150}
        />
      )}
    </section>
  );
}
