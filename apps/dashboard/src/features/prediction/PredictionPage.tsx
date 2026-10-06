import { useId, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Info, Pin } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatDateTime, formatNumber, formatTime } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import type { ForecastResult, SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { useForecastById, useForecastCapabilities, useLatestForecast } from "./ForecastDataController";
import { PredictionReadiness } from "./PredictionReadiness";
import "./prediction.css";

const HOUR = 3_600_000;
const LOOKBACK = { "24h": 24 * HOUR, "7d": 7 * 24 * HOUR };
const COMPARE_HOURS = [3, 6, 12];
const DELIVERED = "plant:cooling_delivered_kw";
const CAPACITY = "plant:available_capacity_kw";

export function PredictionPage() {
  const s = useStrings();
  const site = useSite();
  const [params, setParams] = useSearchParams();
  const pinnedId = params.get("forecast");

  if (site.error && !site.data) {
    return (
      <div className="page">
        <Notice tone="critical" action={{ label: s.monitoring.retry, onClick: site.retry }}>
          {s.monitoring.siteFailed} {site.error.message}
        </Notice>
      </div>
    );
  }
  if (!site.data) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 400 }} />
      </div>
    );
  }
  const unpin = () => {
    const next = new URLSearchParams(params);
    next.delete("forecast");
    setParams(next, { replace: true });
  };
  return <PredictionContent site={site.data} pinnedId={pinnedId} unpin={unpin} />;
}

function PredictionContent({ site, pinnedId, unpin }: { site: SiteBundle; pinnedId: string | null; unpin: () => void }) {
  const s = useStrings();
  const t = s.prediction;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const rev = site.topology.configRevision;
  const caps = useForecastCapabilities();
  const [horizon, setHorizon] = useState(360);
  const [step, setStep] = useState(15);
  const [lookback, setLookback] = useState<keyof typeof LOOKBACK>("24h");
  const [showDelivered, setShowDelivered] = useState(true);
  const [showCapacity, setShowCapacity] = useState(true);

  const pinned = useForecastById(pinnedId, rev);
  const latest = useLatestForecast({ horizonMinutes: horizon, stepMinutes: step, configRevision: rev });
  const active = pinnedId ? pinned : latest;
  const r = active.data;
  const shownHorizon = r?.horizonMinutes ?? horizon;
  const shownStep = r?.stepMinutes ?? step;

  const choose = (h: number, st: number) => {
    unpin();
    setHorizon(h);
    setStep(st);
  };
  const horizons = caps.data?.horizonsMinutes ?? [];
  const steps = (caps.data?.stepsMinutes ?? []).filter((x) => shownHorizon % x === 0);

  return (
    <div className="page prediction">
      <div className="page__head">
        <p className="page__notice">
          <Info size={16} aria-hidden="true" />
          {t.notice}
        </p>
      </div>

      <dl className="context-bar">
        <div>
          <dt>{t.source}</dt>
          <dd>{t.sourceValue}</dd>
        </div>
        <div>
          <dt>{t.revision}</dt>
          <dd className="num">{rev}</dd>
        </div>
        <div>
          <dt>{t.basedOn}</dt>
          <dd className="num">{r ? `${formatDateTime(r.latestInputAt ?? r.asOf, tz)} ${tzLabel}` : " "}</dd>
        </div>
        <div>
          <dt>{t.forecastId}</dt>
          <dd className="context-bar__id" data-forecast-id={r?.forecastId}>
            {r?.forecastId ?? " "}
          </dd>
        </div>
      </dl>

      {pinnedId && pinned.data && (
        <Notice tone="info" action={{ label: t.showLatest, onClick: unpin }}>
          <Pin size={14} aria-hidden="true" /> {t.pinned(`${formatTime(pinned.data.asOf, tz)} ${tzLabel}`)}
        </Notice>
      )}
      {pinnedId && pinned.error && (
        <Notice tone="warning" action={{ label: t.showLatest, onClick: unpin }}>
          {t.notFound}
        </Notice>
      )}

      <div className="prediction__controls" role="group" aria-label={t.heading}>
        <Segmented
          label={t.horizon}
          options={horizons.map((h) => ({ value: h, label: t.hours(h / 60) }))}
          value={shownHorizon}
          onChange={(h) => choose(h, h % step === 0 ? step : (caps.data?.stepsMinutes ?? [15])[0])}
        />
        <Segmented
          label={t.step}
          options={steps.map((x) => ({ value: x, label: t.minutes(x) }))}
          value={shownStep}
          onChange={(x) => choose(shownHorizon, x)}
        />
        <Segmented
          label={t.history}
          options={[
            { value: "24h", label: t.history24h },
            { value: "7d", label: t.history7d },
          ]}
          value={lookback}
          onChange={(x) => setLookback(x as keyof typeof LOOKBACK)}
        />
        <fieldset className="prediction__overlays">
          <legend>{t.overlays}</legend>
          <label>
            <input type="checkbox" checked={showDelivered} onChange={(e) => setShowDelivered(e.target.checked)} /> {t.delivered}
          </label>
          <label>
            <input type="checkbox" checked={showCapacity} onChange={(e) => setShowCapacity(e.target.checked)} /> {t.capacity}
          </label>
        </fieldset>
      </div>

      {active.error && !r && !pinnedId ? (
        <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: active.retry }}>
          {s.forecast.loadFailed} {active.error.message}
        </Notice>
      ) : !r ? (
        <div className="skeleton" style={{ height: 360 }} aria-busy="true" />
      ) : (
        <ForecastView
          site={site}
          r={r}
          lookbackMs={LOOKBACK[lookback]}
          showDelivered={showDelivered}
          showCapacity={showCapacity}
        />
      )}
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  // A generated ID: label text can contain spaces, which aria-labelledby would split.
  const labelId = useId();
  return (
    <div className="prediction__control">
      <span className="prediction__control-label" id={labelId}>
        {label}
      </span>
      <div className="segmented" role="group" aria-labelledby={labelId}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Observed demand up to the cutoff plus optional delivered/capacity history. */
function useContextHistory(site: SiteBundle, asOf: number, lookbackMs: number) {
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const from = new Date(asOf - lookbackMs).toISOString();
  const to = new Date(asOf).toISOString();
  const demand = useResource(`pdemand:${from}:${to}`, scenarioId, (signal) => client.getDemandHistory({ from, to }, { signal }));
  const plant = useResource(`pplant:${from}:${to}`, scenarioId, (signal) =>
    client.getHistory({ metrics: [DELIVERED, CAPACITY], from, to }, { signal }),
  );
  return { demand, plant, site };
}

function ForecastView({
  site,
  r,
  lookbackMs,
  showDelivered,
  showCapacity,
}: {
  site: SiteBundle;
  r: ForecastResult;
  lookbackMs: number;
  showDelivered: boolean;
  showCapacity: boolean;
}) {
  const s = useStrings();
  const t = s.prediction;
  const f = s.forecast;
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const asOf = Date.parse(r.asOf);
  const { demand, plant } = useContextHistory(site, asOf, lookbackMs);
  const plantSeries = (metric: string) => plant.data?.series.find((x) => x.metric === metric);
  const lastOf = (values: (number | null)[] | undefined) => values?.findLast((v) => v !== null) ?? null;

  const series: ChartSeries[] = [];
  const delivered = plantSeries(DELIVERED);
  if (showDelivered && delivered) {
    series.push({
      id: "delivered",
      label: t.delivered,
      color: "var(--chart-delivered)",
      width: 4,
      points: plant.data!.times.map((x, i) => ({ t: Date.parse(x), v: delivered.values[i] })),
    });
  }
  series.push({
    id: "observed",
    label: t.observed,
    color: "var(--chart-observed)",
    points: (demand.data?.times ?? []).map((x, i) => ({ t: Date.parse(x), v: demand.data!.values[i] })),
  });
  if (r.status !== "unavailable") {
    series.push({
      id: "forecast",
      label: t.predicted,
      color: "var(--chart-forecast)",
      dashed: true,
      points: r.series.map((p) => ({ t: Date.parse(p.timestamp), v: p.valueKw })),
    });
  }
  const capacity = plantSeries(CAPACITY);
  if (showCapacity && capacity) {
    // Solid: dashed lines mean forecasts, and capacity is history only.
    series.push({
      id: "capacity",
      label: t.capacity,
      color: "var(--chart-capacity)",
      width: 1.5,
      points: plant.data!.times.map((x, i) => ({ t: Date.parse(x), v: capacity.values[i] })),
    });
  }

  const figure = (label: string, value: number | null, unit: string, kpi?: string, extra?: string) => (
    <div className="figure">
      <span className="figure__label">{label}</span>
      <strong className="figure__value num">{value === null ? s.quality.unavailable : `${formatNumber(value, 0)} ${unit}`}</strong>
      {extra && <span className="figure__label">{extra}</span>}
      {kpi && (
        <Link className="link figure__link" to={`/?kpi=${kpi}`}>
          {t.details}
        </Link>
      )}
    </div>
  );

  return (
    <>
      {r.status === "unavailable" && (
        <Notice tone="warning">
          <strong>{f.unavailable}.</strong> {r.reasonCode && f.reasons[r.reasonCode]} {r.warnings.join(" ")}{" "}
          {r.reasonCode && t.nextSteps[r.reasonCode]}
        </Notice>
      )}
      {r.status !== "unavailable" && r.quality.freshness === "stale" && <Notice tone="warning">{r.warnings.slice(1).join(" ") || f.stale}</Notice>}

      <div className="prediction__main">
        <section className="panel" aria-labelledby="prediction-chart">
          <div className="panel__head">
            <h2 id="prediction-chart">{t.chartTitle}</h2>
            <span className="forecast-summary__label">{f.target}</span>
          </div>
          <div className="panel__body">
            {!demand.data ? (
              <div className="skeleton" style={{ height: 300 }} />
            ) : (
              <TimeSeriesChart
                title={t.chartTitle}
                series={series}
                band={
                  r.status !== "unavailable" && r.interval
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
                xDomain={[asOf - lookbackMs, asOf + r.horizonMinutes * 60_000]}
                marker={{ t: asOf, label: f.dataThrough }}
                height={320}
              />
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="prediction-figures">
          <div className="panel__head">
            <h2 id="prediction-figures">{t.figures}</h2>
          </div>
          <div className="panel__body figures">
            {figure(
              t.predictedPeak,
              r.summary?.peakKw ?? null,
              "kWt",
              undefined,
              r.summary ? `${t.at} ${formatTime(r.summary.peakAt, tz)} ${tzLabel}, ${f.within(r.horizonMinutes / 60)}` : undefined,
            )}
            {figure(t.observedNow, lastOf(demand.data?.values), "kWt", "plant:cooling_demand_kw")}
            {figure(t.deliveredNow, lastOf(delivered?.values), "kWt", DELIVERED)}
            {figure(t.capacityNow, lastOf(capacity?.values), "kWt", "plant:cooling_demand_kw")}
            <p className="inspector__muted">{t.capacityCaveat}</p>
          </div>
        </section>
      </div>

      <div className="prediction__lower">
        <Provenance site={site} r={r} />
        <PredictionReadiness />
      </div>
      {r.status !== "unavailable" && <EarlierComparison site={site} r={r} />}
    </>
  );
}

function Provenance({ site, r }: { site: SiteBundle; r: ForecastResult }) {
  const s = useStrings();
  const t = s.prediction;
  const tz = site.site.timezone;
  const when = (x: string | null | undefined) => (x ? `${formatDateTime(x, tz)} ${site.site.timezoneLabel}` : s.quality.unavailable);
  const rows: [string, string][] = [
    [t.forecastId, r.forecastId],
    [t.issued, when(r.asOf)],
    [t.generated, when(r.generatedAt)],
    [t.inputWindow, r.inputWindow ? `${when(r.inputWindow.start)} – ${when(r.inputWindow.end)}` : s.quality.unavailable],
    [t.latestInput, when(r.latestInputAt)],
    [t.model, r.model ? `${t.modeLabels[r.model.mode]}: ${r.model.artifactId} (${r.model.revision})` : t.notAvailable],
    [t.interval, r.interval ? t.intervalValue(r.interval.method, r.interval.calibration) : t.notAvailable],
    [t.quality, `${r.quality.freshness}, ${r.quality.coverage} coverage${r.quality.reasonCodes.length ? `, ${r.quality.reasonCodes.join(", ")}` : ""}`],
    [t.revision, String(r.configRevision)],
  ];
  return (
    <section className="panel" aria-labelledby="provenance-heading">
      <div className="panel__head">
        <h2 id="provenance-heading">{t.provenance}</h2>
      </div>
      <div className="panel__body">
        <table className="data-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td className="provenance__value">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.warnings.length > 0 && (
          <>
            <h3 className="kpi-panel__subhead">{t.warnings}</h3>
            <ul className="provenance__warnings">
              {r.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function EarlierComparison({ site, r }: { site: SiteBundle; r: ForecastResult }) {
  const s = useStrings();
  const t = s.prediction;
  const f = s.forecast;
  const tz = site.site.timezone;
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const [hours, setHours] = useState(6);
  const asOf = Date.parse(r.asOf);
  const earlier = useLatestForecast({
    horizonMinutes: r.horizonMinutes,
    stepMinutes: r.stepMinutes,
    configRevision: r.configRevision,
    at: asOf - hours * HOUR,
  });
  const e = earlier.data;
  const eAsOf = e ? Date.parse(e.asOf) : null;
  const from = eAsOf === null ? null : new Date(eAsOf - 3 * HOUR).toISOString();
  // Observed demand is only shown up to the current cutoff: no future actuals.
  const observed = useResource(from && `cmp:${from}:${r.asOf}`, scenarioId, (signal) =>
    client.getDemandHistory({ from: from!, to: r.asOf }, { signal }),
  );

  return (
    <section className="panel" aria-labelledby="compare-heading">
      <div className="panel__head">
        <h2 id="compare-heading">{t.compare}</h2>
        <Segmented
          label={t.compareWith}
          options={COMPARE_HOURS.map((h) => ({ value: h, label: t.hoursEarlier(h) }))}
          value={hours}
          onChange={setHours}
        />
      </div>
      <div className="panel__body">
        <p className="inspector__muted">{t.compareNote}</p>
        {!e || !observed.data ? (
          <div className="skeleton" style={{ height: 220 }} />
        ) : e.status === "unavailable" ? (
          <Notice tone="info">
            {f.unavailable}. {e.reasonCode && f.reasons[e.reasonCode]}
          </Notice>
        ) : (
          <TimeSeriesChart
            title={`${t.compare}: ${t.earlierForecast} ${formatTime(e.asOf, tz)}`}
            series={[
              {
                id: "observed",
                label: t.observed,
                color: "var(--chart-observed)",
                points: observed.data.times.map((x, i) => ({ t: Date.parse(x), v: observed.data!.values[i] })),
              },
              {
                id: "earlier",
                label: `${t.earlierForecast} (${formatTime(e.asOf, tz)})`,
                color: "var(--chart-forecast)",
                dashed: true,
                points: e.series.map((p) => ({ t: Date.parse(p.timestamp), v: p.valueKw })),
              },
            ]}
            band={
              e.interval
                ? {
                    label: f.spread,
                    color: "var(--chart-forecast)",
                    points: e.series.map((p) => ({ t: Date.parse(p.timestamp), lo: p.lowerKw ?? null, hi: p.upperKw ?? null })),
                  }
                : undefined
            }
            unit="kWt"
            decimals={0}
            timeZone={tz}
            xDomain={[eAsOf! - 3 * HOUR, Math.max(asOf, eAsOf! + e.horizonMinutes * 60_000)]}
            marker={{ t: eAsOf!, label: t.compareWith }}
            height={220}
          />
        )}
      </div>
    </section>
  );
}
