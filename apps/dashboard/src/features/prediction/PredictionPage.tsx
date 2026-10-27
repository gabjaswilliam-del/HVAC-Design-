import { useEffect, useId, useState } from "react";
import { useSearchParams } from "react-router";
import { BrainCircuit, Info, Pin, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime } from "../../lib/format";
import { ApiError } from "../../lib/api/client";
import { useResource } from "../../lib/api/useResource";
import type { ForecastResult, SiteBundle } from "../../lib/contracts";
import { Notice } from "../../components/Notice";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { useForecastById, useForecastCapabilities } from "./ForecastDataController";
import { errorSoFar, predictedPeak } from "./predictionError";
import { prediction, usePrediction } from "./predictionStore";
import "./prediction.css";

const MINUTE = 60_000;
/** Actual values are logged on the source's 5-minute grid. */
const LOG_STEP = 5 * MINUTE;
/** How long the predicted curve takes to draw in. */
const DRAW_MS = 900;
const iso = (ms: number) => new Date(ms).toISOString();
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Predictions already drawn in this tab: coming back to the page shows them at once. */
const drawn = new Set<string>();

/**
 * Cooling prediction (the Prediction tab): an empty chart and Predict. Predict forecasts the cooling
 * load from the moment the playback clock shows and draws the predicted curve. The plant is
 * then played from the deck below, the same clock the Overview runs on, and the actual
 * cooling load is logged onto the chart as time passes, with the error so far. AI Pilot is
 * started from the workspace, not here.
 */
export function PredictionPage() {
  const s = useStrings();
  const site = useSite();
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
  return <PredictionContent site={site.data} />;
}

function PredictionContent({ site }: { site: SiteBundle }) {
  const s = useStrings();
  const t = s.prediction;
  const f = s.forecast;
  const id = useId();
  const tz = site.site.timezone;
  const tzLabel = site.site.timezoneLabel;
  const client = useDataClient();
  const caps = useForecastCapabilities();
  const { scenarioId, cursor, mode, playing, speed } = useOperating((x) => x);
  const [params, setParams] = useSearchParams();
  const linkedId = params.get("forecast");
  const linked = useForecastById(linkedId, site.topology.configRevision);
  const saved = usePrediction();
  const current = saved && saved.scenarioId === scenarioId ? saved : null;
  const r = current?.forecast ?? null;
  const [horizon, setHorizon] = useState(r?.horizonMinutes ?? 360);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // A forecast link (the top bar's outlook, an assistant answer) opens that forecast.
  useEffect(() => {
    if (linked.data && linked.data.forecastId !== r?.forecastId) prediction.set({ scenarioId, forecast: linked.data, linked: true });
  }, [linked.data]);

  const unlink = () => {
    if (!linkedId) return;
    const next = new URLSearchParams(params);
    next.delete("forecast");
    setParams(next, { replace: true });
  };
  const horizons = caps.data?.horizonsMinutes ?? [];
  const predict = async () => {
    if (busy) return;
    const steps = [...(caps.data?.stepsMinutes ?? [15])].sort((a, b) => a - b);
    setBusy(true);
    setError(null);
    try {
      const forecast = await client.getLatestForecast({ at: iso(cursor), horizonMinutes: horizon, stepMinutes: steps.find((x) => horizon % x === 0) ?? steps[0] });
      unlink();
      prediction.set({ scenarioId, forecast, linked: false });
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("UNAVAILABLE", String(e), true));
    } finally {
      setBusy(false);
    }
  };
  const clear = () => {
    unlink();
    prediction.clear();
  };

  return (
    <div className="page prediction">
      <div className="page__head">
        <p className="page__notice">
          <Info size={16} aria-hidden="true" />
          {t.notice}
        </p>
      </div>

      {current?.linked && (
        <Notice tone="info" action={{ label: t.clear, onClick: clear }}>
          <Pin size={14} aria-hidden="true" /> {t.pinned(`${formatTime(current.forecast.asOf, tz)} ${tzLabel}`)}
        </Notice>
      )}
      {linkedId && linked.error && <Notice tone="warning">{t.notFound}</Notice>}
      {error && (
        <Notice tone="warning" action={{ label: s.monitoring.retry, onClick: () => void predict() }}>
          {f.loadFailed} {error.message}
        </Notice>
      )}

      <section className="panel" aria-labelledby={`${id}-title`}>
        <div className="panel__head prediction__head">
          <h2 id={`${id}-title`}>{t.chartTitle}</h2>
          <div className="prediction__actions">
            {horizons.length > 1 && (
              <div className="prediction__horizon">
                <span className="prediction__label" id={`${id}-horizon`}>
                  {t.horizon}
                </span>
                <div className="segmented segmented--small" role="group" aria-labelledby={`${id}-horizon`}>
                  {horizons.map((h) => (
                    <button key={h} type="button" aria-pressed={h === horizon} onClick={() => setHorizon(h)}>
                      {t.hours(h / 60)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button type="button" className="button button--primary" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => void predict()}>
              <BrainCircuit size={15} aria-hidden="true" />
              {busy ? t.predicting : r ? t.predictAgain : t.predict}
            </button>
            {r && (
              <button type="button" className="button button--quiet" onClick={clear}>
                <X size={14} aria-hidden="true" />
                {t.clear}
              </button>
            )}
          </div>
        </div>
        <div className="panel__body prediction__body">
          {r ? (
            <PredictionChart r={r} site={site} />
          ) : (
            <>
              <TimeSeriesChart
                title={t.chartTitle}
                series={[]}
                unit="kWt"
                decimals={0}
                timeZone={tz}
                xDomain={[cursor, cursor + horizon * MINUTE]}
                height={320}
              />
              <p className="prediction__status" role="status">
                {t.emptyHint(`${formatTime(cursor, tz)} ${tzLabel}`)}
              </p>
            </>
          )}
        </div>
      </section>
      {r && <Status r={r} tz={tz} tzLabel={tzLabel} cursor={cursor} replay={mode === "replay"} playing={playing} speed={speed} />}
    </div>
  );
}

/** The predicted curve, drawn in once, and the actual cooling load logged up to the clock. */
function PredictionChart({ r, site }: { r: ForecastResult; site: SiteBundle }) {
  const s = useStrings();
  const t = s.prediction;
  const f = s.forecast;
  const tz = site.site.timezone;
  const client = useDataClient();
  const scenarioId = useOperating((x) => x.scenarioId);
  const cursor = useOperating((x) => x.cursor);
  const start = Date.parse(r.asOf);
  const end = start + r.horizonMinutes * MINUTE;
  const upTo = Math.min(cursor, end);

  // Draw the predicted curve in from the left, the first time it is shown.
  const n = r.series.length;
  const [shown, setShown] = useState(() => (drawn.has(r.forecastId) || reducedMotion() ? n : 0));
  useEffect(() => {
    if (drawn.has(r.forecastId) || reducedMotion()) {
      setShown(n);
      return;
    }
    setShown(0);
    const t0 = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const k = Math.min(n, Math.ceil(((now - t0) / DRAW_MS) * n));
      setShown(k);
      // Marked once fully drawn: an interrupted drawing starts again next time.
      if (k < n) frame = requestAnimationFrame(step);
      else drawn.add(r.forecastId);
    });
    return () => cancelAnimationFrame(frame);
  }, [r.forecastId]);

  // Logged on the 5-minute grid as the clock passes it; earlier points stay while the next load.
  const step = Math.floor(upTo / LOG_STEP);
  const actual = useResource(upTo > start ? `actual:${r.forecastId}:${step}` : null, `actual:${scenarioId}`, (signal) =>
    client.getDemandHistory({ from: r.asOf, to: iso(step * LOG_STEP) }, { signal }),
  );
  const logged = (actual.data?.times ?? [])
    .map((x, i) => ({ t: Date.parse(x), v: actual.data!.values[i] }))
    .filter((p) => p.t >= start && p.t <= upTo);

  if (r.status === "unavailable") {
    return (
      <Notice tone="warning">
        <strong>{f.unavailable}.</strong> {r.reasonCode && f.reasons[r.reasonCode]} {r.warnings.join(" ")} {r.reasonCode && t.nextSteps[r.reasonCode]}
      </Notice>
    );
  }
  const drawnPoints = r.series.slice(0, shown);
  const series: ChartSeries[] = [
    { id: "predicted", label: t.predicted, color: "var(--chart-forecast)", dashed: true, points: drawnPoints.map((p) => ({ t: Date.parse(p.timestamp), v: p.valueKw })) },
    { id: "actual", label: t.actual, color: "var(--chart-observed)", points: logged },
  ];
  const peak = predictedPeak(r);
  const err = errorSoFar(r, actual.data, upTo);

  return (
    <>
      <TimeSeriesChart
        title={t.chartTitle}
        series={series}
        band={
          r.interval
            ? { label: f.spread, color: "var(--chart-forecast)", points: drawnPoints.map((p) => ({ t: Date.parse(p.timestamp), lo: p.lowerKw ?? null, hi: p.upperKw ?? null })) }
            : undefined
        }
        unit="kWt"
        decimals={0}
        timeZone={tz}
        xDomain={[start, end]}
        // While the clock is inside the window, "Now" shows how far the actual line has come.
        marker={cursor > start && cursor < end ? { t: cursor, label: t.now } : { t: start, label: t.madeAt }}
        height={320}
      />
      <dl className="prediction__figures" data-prediction="figures">
        <Figure label={t.predictedPeak} value={peak ? `${formatNumber(peak.kw, 0)} kWt` : "–"} note={peak ? t.at(formatTime(peak.at, tz)) : undefined} />
        <Figure label={t.logged} value={t.loggedValue(err.logged, err.total)} />
        <Figure label={t.mae} value={err.maeKw === null ? "–" : `${formatNumber(err.maeKw, 0)} kWt`} />
        <Figure label={t.mape} value={err.mapePct === null ? "–" : `${formatNumber(err.mapePct, 1)} %`} />
        <Figure label={t.method} value={r.model ? t.methodValue(r.model.artifactId) : "–"} note={t.methodNote} small />
      </dl>
    </>
  );
}

function Figure({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  return (
    <div className="prediction__figure">
      <dt>{label}</dt>
      <dd className={`num${small ? " prediction__figure--small" : ""}`}>{value}</dd>
      {note && <dd className="prediction__figure-note">{note}</dd>}
    </div>
  );
}

/** What the clock is doing for the logging: play from the deck below, playing, or done. */
function Status({
  r,
  tz,
  tzLabel,
  cursor,
  replay,
  playing,
  speed,
}: {
  r: ForecastResult;
  tz: string;
  tzLabel: string;
  cursor: number;
  replay: boolean;
  playing: boolean;
  speed: number;
}) {
  const t = useStrings().prediction;
  const start = Date.parse(r.asOf);
  const end = start + r.horizonMinutes * MINUTE;
  const now = `${formatTime(cursor, tz)} ${tzLabel}`;
  const text =
    cursor < start
      ? t.before(`${formatTime(start, tz)} ${tzLabel}`)
      : cursor >= end
        ? t.passed
        : !playing
          ? t.playHint(replay)
          : t.playing(speed, now);
  return (
    <p className="prediction__status" role="status" data-prediction="status">
      {text}
    </p>
  );
}
