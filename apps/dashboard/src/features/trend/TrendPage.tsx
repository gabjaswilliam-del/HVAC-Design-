import { Link, useSearchParams } from "react-router";
import { PanelRight } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime, siteDayStart } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { Notice } from "../../components/Notice";
import { useDataClient } from "../../app/dataClient";
import { targetPath } from "../../app/navigation";
import { operating, useOperating } from "../../app/operatingContext";
import { useSite, useSnapshot } from "../../app/site";
import { scenarioById } from "../../fixtures/scenarios";
import { isKpiKey, TREND_KEYS } from "../monitoring/kpiDefinitions";
import "./trend.css";

const DAY = 86_400_000;

/**
 * One plant indicator across today in the main display: the workspace's answer to "show
 * me COP" and its paraphrases. Telemetry from the demo data client, the same history the
 * indicator panel reads, to the current playback time. `?metric=`; typed address
 * `{ type: "metric", key }`.
 */
export function TrendPage() {
  const s = useStrings();
  const t = s.trend;
  const site = useSite();
  const snapshot = useSnapshot();
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const [params] = useSearchParams();
  const key = params.get("metric") ?? "plant:cop";
  // Today by default, or the last N hours (1 to 24) up to the playback time.
  const hoursParam = Number(params.get("hours"));
  const hours = Number.isInteger(hoursParam) && hoursParam >= 1 && hoursParam <= 24 ? hoursParam : null;
  const info = site.data?.metrics.find((m) => m.key === key);
  const known = Boolean(info) && TREND_KEYS.includes(key);
  const tz = site.data?.site.timezone ?? "UTC";
  const at = snapshot.at;
  const dayStart = siteDayStart(Date.parse(at), tz);
  // The demo data starts at midnight: a period reaching before it starts there.
  const from = hours ? Math.max(dayStart, Date.parse(at) - hours * 3_600_000) : dayStart;
  const hist = useResource(known ? `trend:${key}:${at}:${hours ?? "day"}` : null, scenarioId, (signal) =>
    client.getHistory({ metrics: [key], from: new Date(from).toISOString(), to: at }, { signal }),
  );
  if (!site.data) return <div className="page" aria-busy="true" />;
  const others = TREND_KEYS.filter((k) => k !== key)
    .map((k) => site.data!.metrics.find((m) => m.key === k))
    .filter((m) => m !== undefined);

  if (!known || !info) {
    return (
      <div className="page trend">
        <Notice tone="info">{t.unknown(key)}</Notice>
        <OtherIndicators keys={others.map((m) => ({ key: m.key, label: m.label }))} />
      </div>
    );
  }
  const series = hist.data?.series[0];
  const values = (series?.values ?? []).filter((v): v is number => v !== null);
  const current = snapshot.data?.kpis[key] ?? snapshot.data?.values[key];
  const d = info.decimals;
  const unit = info.unit ? ` ${info.unit}` : "";
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "–" : `${formatNumber(x, d)}${unit}`);
  const first = values[0];
  const last = values.at(-1);
  return (
    <div className="page trend" data-trend={key}>
      <div className="page__head">
        <div className="sim__title-row">
          <h2 className="page__title">{info.label}</h2>
          <span className="tag-chip tag-chip--demo">{s.dataMode.demo}</span>
          <span className="tag-chip">{t.source(scenarioById(scenarioId)?.label ?? scenarioId)}</span>
        </div>
        <p className="page__sub">{t.lead}</p>
      </div>
      <dl className="trend__figures">
        <div>
          <dt>{t.now(formatTime(at, tz))}</dt>
          <dd className="num trend__hero" data-trend-current>
            {v(current?.value)}
          </dd>
          {current?.quality === "stale" && <dd className="trend__stale">{t.stale}</dd>}
        </div>
        <div>
          <dt>{hours ? t.averageLast(hours) : t.average}</dt>
          <dd className="num">{values.length ? v(values.reduce((a, b) => a + b, 0) / values.length) : "–"}</dd>
        </div>
        <div>
          <dt>{hours ? t.rangeLast(hours) : t.range}</dt>
          <dd className="num">{values.length ? `${v(Math.min(...values))} to ${v(Math.max(...values))}` : "–"}</dd>
        </div>
        <div>
          <dt>{hours ? t.changeLast(hours) : t.change}</dt>
          <dd className="num">{first !== undefined && last !== undefined ? `${last - first >= 0 ? "+" : ""}${formatNumber(last - first, d)}${unit}` : "–"}</dd>
        </div>
      </dl>
      {hist.error && (
        <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: hist.retry }}>
          {hist.error.message}
        </Notice>
      )}
      {series && (
        <div className="trend__chart">
          <TimeSeriesChart
            title={hours ? t.chartTitleLast(info.label, hours) : t.chartTitle(info.label)}
            series={[{ id: key, label: info.label, color: "var(--chart-neutral)", points: (hist.data?.times ?? []).map((time, i) => ({ t: Date.parse(time), v: series.values[i] })) }]}
            unit={info.unit}
            decimals={d}
            timeZone={tz}
            xDomain={hours ? [from, Date.parse(at)] : [dayStart, dayStart + DAY]}
            marker={{ t: Date.parse(at), label: t.nowMarker }}
            height={320}
          />
        </div>
      )}
      <p className="trend__actions">
        {isKpiKey(key) && (
          <button type="button" className="button button--small" onClick={() => operating.openKpi(key, true)}>
            <PanelRight size={14} aria-hidden="true" />
            {t.details}
          </button>
        )}
      </p>
      <OtherIndicators keys={others.map((m) => ({ key: m.key, label: m.label }))} />
    </div>
  );
}

function OtherIndicators({ keys }: { keys: { key: string; label: string }[] }) {
  const t = useStrings().trend;
  return (
    <section className="trend__others" aria-labelledby="trend-others-title">
      <h3 id="trend-others-title">{t.others}</h3>
      <ul>
        {keys.map((k) => (
          <li key={k.key}>
            <Link className="link" to={targetPath({ type: "metric", key: k.key })}>
              {k.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
