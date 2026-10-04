import { Link } from "react-router";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import type { SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { TimeSeriesChart } from "../../components/TimeSeriesChart";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";
import { useLatestForecast } from "./ForecastDataController";
import "./prediction.css";

const HORIZON = 360;
const STEP = 15;
const LOOKBACK_MS = 6 * 3_600_000;

/**
 * Compact site-wide cooling-demand forecast for the monitoring screen. Uses the same
 * ForecastDataController result as the full prediction page.
 */
export function CoolingForecastSummary({ site }: { site: SiteBundle }) {
  const s = useStrings();
  const f = s.forecast;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const forecast = useLatestForecast({ horizonMinutes: HORIZON, stepMinutes: STEP, configRevision: site.topology.configRevision });
  const r = forecast.data;
  const asOf = r ? Date.parse(r.asOf) : null;
  const observed = useResource(asOf === null ? null : `demand:${asOf}`, scenarioId, (signal) =>
    client.getDemandHistory({ from: new Date(asOf! - LOOKBACK_MS).toISOString(), to: new Date(asOf!).toISOString() }, { signal }),
  );

  let body;
  if (forecast.error && !r) {
    body = (
      <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: forecast.retry }}>
        {f.loadFailed} {forecast.error.message}
      </Notice>
    );
  } else if (!r) {
    body = <div className="skeleton" style={{ height: 190 }} aria-busy="true" />;
  } else if (r.status === "unavailable") {
    body = (
      <Notice tone="warning">
        <strong>{f.unavailable}.</strong> {r.reasonCode && f.reasons[r.reasonCode]} {r.warnings.join(" ")}
      </Notice>
    );
  } else {
    const hours = r.horizonMinutes / 60;
    body = (
      <>
        <div className="forecast-summary__facts">
          {r.summary && (
            <div>
              <span className="forecast-summary__label">{f.peak}</span>
              <strong className="num forecast-summary__peak">
                {formatNumber(r.summary.peakKw, 0)} kWt
              </strong>
              <span className="forecast-summary__label">
                {formatTime(r.summary.peakAt, tz)} {tzLabel}, {f.within(hours)}
              </span>
            </div>
          )}
          <div>
            <span className="forecast-summary__label">{f.dataThrough}</span>
            <strong className="num">
              {formatTime(r.latestInputAt ?? r.asOf, tz)} {tzLabel}
            </strong>
            {r.quality.freshness === "stale" && <span className="forecast-summary__stale">{f.stale}</span>}
          </div>
          <div>
            <span className="forecast-summary__label">{f.model}</span>
            <span>{r.model?.mode === "baseline" ? f.baselineLabel : r.model?.artifactId}</span>
          </div>
        </div>
        <TimeSeriesChart
          title={`${f.summaryHeading}, ${f.target}`}
          series={[
            {
              id: "observed",
              label: f.observed,
              color: "var(--chart-observed)",
              points: (observed.data?.times ?? []).map((t, i) => ({ t: Date.parse(t), v: observed.data!.values[i] })),
            },
            {
              id: "forecast",
              label: f.forecast,
              color: "var(--chart-forecast)",
              dashed: true,
              points: r.series.map((p) => ({ t: Date.parse(p.timestamp), v: p.valueKw })),
            },
          ]}
          band={
            r.interval
              ? {
                  label: f.spread,
                  color: "var(--chart-forecast)",
                  points: r.series.map((p) => ({ t: Date.parse(p.timestamp), lo: p.lowerKw ?? null, hi: p.upperKw ?? null })),
                }
              : undefined
          }
          unit="kWt"
          decimals={0}
          timeZone={tz}
          xDomain={[asOf! - LOOKBACK_MS, asOf! + r.horizonMinutes * 60_000]}
          marker={{ t: asOf!, label: f.dataThrough }}
          height={170}
        />
      </>
    );
  }

  return (
    <section className="panel forecast-summary" aria-labelledby="forecast-summary-heading" data-forecast-id={r?.forecastId}>
      <div className="panel__head">
        <div>
          <h2 id="forecast-summary-heading">{f.summaryHeading}</h2>
          <p className="forecast-summary__label">{f.target}</p>
        </div>
        {r && r.status !== "unavailable" && (
          <Link className="link" to={`/prediction?forecast=${encodeURIComponent(r.forecastId)}`}>
            {f.view}
          </Link>
        )}
      </div>
      <div className="panel__body">{body}</div>
    </section>
  );
}
