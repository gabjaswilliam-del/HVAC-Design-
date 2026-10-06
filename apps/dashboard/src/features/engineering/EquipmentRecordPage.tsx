import { Link, useParams } from "react-router";
import { Crosshair, MessageSquareText } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatReading, formatTime } from "../../lib/format";
import type { Device, Issue, MetricInfo, SiteBundle, Snapshot } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { StateLabel } from "../../components/StateLabel";
import { Trend } from "../equipment";
import { sceneMatchesTopology } from "../monitoring";
import { operating } from "../../app/operatingContext";
import { useIssues, useSite, useSnapshot } from "../../app/site";
import { useShowOnPlant } from "../../app/useShowOnPlant";
import "./engineering.css";

/** The trend a record opens on: what the equipment is for. */
const PRIMARY: Record<string, string> = {
  cooling_towers: "frequency_hz",
  cooling_water_pump: "frequency_hz",
  chilled_water_pump_pri: "frequency_hz",
  chiller_plant: "cooling_kw",
  terminal: "cooling_demand_kw",
};
/** Quantities an operating point can be read against: rated power, cooling and flow. */
const RATED_UNITS = ["kW", "kWt", "m³/h"];

/** One equipment record at `/equipment/:id`: trend today, operating point against
 *  nameplate, measurements and the issue timeline, with Locate and Ask. */
export function EquipmentRecordPage() {
  const s = useStrings();
  const r = s.record;
  const { equipmentId = "" } = useParams();
  const site = useSite();
  const snapshot = useSnapshot();
  const issues = useIssues();

  if (site.error && !site.data) {
    return (
      <div className="page">
        <Notice tone="critical" action={{ label: s.monitoring.retry, onClick: site.retry }}>
          {s.monitoring.siteFailed} {site.error.message}
        </Notice>
      </div>
    );
  }
  if (!site.data) return <div className="page" aria-busy="true" />;
  const device = site.data.topology.devices.find((d) => d.id === equipmentId);

  return (
    <div className="page record">
      <nav className="crumbs" aria-label={r.crumbs}>
        <Link className="link" to="/engineering">
          {s.engineering.heading}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{r.records}</span>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{device?.label ?? equipmentId}</span>
      </nav>
      {device ? (
        <Record device={device} site={site.data} snapshot={snapshot.data} issues={issues.data?.issues ?? []} />
      ) : (
        <section className="record__missing">
          <h2>{s.inspector.unknownTitle}</h2>
          <p>{s.inspector.unknownBody(equipmentId, site.data.topology.configRevision)}</p>
        </section>
      )}
    </div>
  );
}

function Record({ device, site, snapshot, issues }: { device: Device; site: SiteBundle; snapshot?: Snapshot; issues: Issue[] }) {
  const s = useStrings();
  const r = s.record;
  const showOnPlant = useShowOnPlant();
  const tz = site.site.timezone;
  const status = snapshot?.equipment[device.id];
  const metrics = site.metrics.filter((m) => m.key.startsWith(`${device.id}:`));
  const timeline = issues.filter((i) => i.equipmentIds.includes(device.id));

  // A nameplate rating reads against the one measurement in its unit (rated power,
  // cooling or flow), when both are unambiguous.
  const ratingOf = (m: MetricInfo) => {
    const plates = device.nameplate.filter((n) => n.unit === m.unit && n.value > 0);
    const same = metrics.filter((x) => x.unit === m.unit);
    return RATED_UNITS.includes(m.unit) && plates.length === 1 && same.length === 1 ? plates[0] : undefined;
  };
  // Operating point: each rated measurement against its nameplate value.
  const points = metrics.flatMap((metric) => {
    const n = ratingOf(metric);
    const value = snapshot?.values[metric.key]?.value;
    return n && value !== null && value !== undefined ? [{ n, metric, value }] : [];
  });
  const plainPlate = device.nameplate.filter((n) => !points.some((p) => p.n === n));

  return (
    <section className="record__body" aria-labelledby="record-title">
      <div className="record__head">
        <h2 id="record-title">{device.label}</h2>
        {status && <StateLabel state={status.state} stale={status.stale} />}
        <span className="record__type">
          {s.families[device.family]}, {device.id}
        </span>
        <span className="record__actions">
          {sceneMatchesTopology(site.scene, site.topology) && (
            <button type="button" className="button button--small" onClick={() => showOnPlant(device.id)}>
              <Crosshair size={15} aria-hidden="true" />
              {s.inspector.locate}
            </button>
          )}
          <button type="button" className="button button--small" onClick={() => operating.askAssistant(`Investigate ${device.label}`, device.id)}>
            <MessageSquareText size={15} aria-hidden="true" />
            {s.agent.ask}
          </button>
        </span>
      </div>

      <div className="record__grid">
        <div className="record__cell">
          {metrics.length > 0 && snapshot ? (
            <Trend site={site} at={snapshot.at} metrics={metrics} initial={`${device.id}:${PRIMARY[device.family]}`} rating={(m) => ratingOf(m)?.value} />
          ) : (
            <h3>{r.trend}</h3>
          )}
        </div>

        <div className="record__cell">
          <h3>{points.length ? r.operating : r.nameplate}</h3>
          <div className="op">
            {points.map(({ n, metric, value }) => (
              <div key={n.label} className="op__row">
                <span>
                  {metric.label} <span className="record__muted">/ {n.label}</span>
                </span>
                <span className="num">{r.ofNameplate(formatNumber(value, metric.decimals), formatNumber(n.value, 0), n.unit, Math.round((value / n.value) * 100))}</span>
                <span className="op__bar" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (value / n.value) * 100)}%` }} />
                </span>
              </div>
            ))}
            {plainPlate.map((n) => (
              <div key={n.label} className="op__row">
                <span>{n.label}</span>
                <span className="num">
                  {n.value} {n.unit}
                </span>
              </div>
            ))}
            {device.nameplate.length === 0 && <p className="record__muted">{s.inspector.noNameplate}</p>}
          </div>
          {device.nameplate.length > 0 && <p className="record__muted">{r.synthetic}</p>}
        </div>

        <div className="record__cell">
          <h3>{r.measurements}</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{s.inspector.metric}</th>
                <th scope="col" className="num">
                  {s.inspector.value}
                </th>
                <th scope="col">{s.inspector.quality}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const v = snapshot?.values[m.key];
                return (
                  <tr key={m.key}>
                    <th scope="row">{m.label}</th>
                    <td className="num">{formatReading(v, m) ?? s.quality.unavailable}</td>
                    <td className={`quality quality--${v?.quality ?? "unavailable"}`}>{s.quality[v?.quality ?? "unavailable"]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="record__muted">{s.inspector.qualityHint}</p>
        </div>

        <div className="record__cell">
          <h3>{r.timeline}</h3>
          {timeline.length ? (
            <ol className="timeline-list">
              {timeline.flatMap((i) => [
                <li key={`${i.id}-first`}>
                  <time className="num">{formatTime(i.firstSeen, tz)}</time>
                  <span>
                    <span className={`sev sev--${i.severity}`}>{s.issues.severity[i.severity]}</span> {r.firstSeenEvent(i.title, i.id)}
                  </span>
                </li>,
                <li key={`${i.id}-last`}>
                  <time className="num">{formatTime(i.lastSeen, tz)}</time>
                  <span>{i.status === "resolved" ? r.resolvedEvent : r.statusEvent(s.issues.status[i.status])}</span>
                </li>,
              ])}
            </ol>
          ) : (
            <p className="record__muted">{r.noTimeline(device.label)}</p>
          )}
        </div>
      </div>
      <p className="record__muted">{r.note}</p>
    </section>
  );
}
