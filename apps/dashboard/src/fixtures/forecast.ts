/**
 * SYNTHETIC forecast fixture: a seasonal-profile baseline computed only from demand
 * observed at or before the cutoff. It is labeled as a baseline, never as the
 * pretrained or site-adapted model, and carries no accuracy claim. Its interval is an
 * uncalibrated spread, not a prediction interval with known coverage.
 */
import type { ForecastResult, Source } from "../lib/contracts";
import { MINUTE_MS, SAMPLES, STEP_MIN } from "./generate";

export interface DemandSeries {
  /** Epoch ms of values[0]; samples every STEP_MIN minutes. */
  start: number;
  values: (number | null)[];
}

export interface ForecastRequest {
  scenarioId: string;
  source: Source;
  configRevision: number;
  asOf: number;
  /** Newest sample actually received (older than asOf when telemetry stalled). */
  latestInputAt: number;
  horizonMinutes: number;
  stepMinutes: number;
}

const DAY_MS = SAMPLES * STEP_MIN * MINUTE_MS;
const MIN_HISTORY_DAYS = 3;
const STALE_AFTER_MIN = 30;
const UNAVAILABLE_AFTER_MIN = 120;
const iso = (ms: number) => new Date(ms).toISOString();

export function seasonalBaselineForecast(demand: DemandSeries, req: ForecastRequest): ForecastResult {
  const { asOf, horizonMinutes, stepMinutes } = req;
  const forecastId = `fc-${req.scenarioId}-${iso(asOf)}-h${horizonMinutes}-s${stepMinutes}`;
  const cutoff = Math.min(asOf, req.latestInputAt);
  // Only values at or before the cutoff are visible to this function.
  const at = (ms: number) => {
    if (ms > cutoff) return null;
    const i = Math.round((ms - demand.start) / (STEP_MIN * MINUTE_MS));
    return i >= 0 && i < demand.values.length ? demand.values[i] : null;
  };

  const base = {
    schemaVersion: 1 as const,
    forecastId,
    source: req.source,
    configRevision: req.configRevision,
    target: "cooling_load_kw" as const,
    unit: "kW" as const,
    asOf: iso(asOf),
    generatedAt: iso(asOf + 40_000),
    horizonMinutes,
    stepMinutes,
    latestInputAt: iso(req.latestInputAt),
  };

  const historyDays = Math.floor((cutoff - demand.start) / DAY_MS);
  const inputAgeMin = (asOf - req.latestInputAt) / MINUTE_MS;
  const unavailable = (reasonCode: "INSUFFICIENT_HISTORY" | "INPUT_STALE", warning: string): ForecastResult => ({
    ...base,
    status: "unavailable",
    inputWindow: null,
    model: null,
    quality: { freshness: inputAgeMin > STALE_AFTER_MIN ? "stale" : "fresh", coverage: "none", reasonCodes: [reasonCode], staleAfterMinutes: STALE_AFTER_MIN },
    series: [],
    warnings: [warning],
    reasonCode,
  });
  if (historyDays < MIN_HISTORY_DAYS) {
    return unavailable("INSUFFICIENT_HISTORY", `Needs at least ${MIN_HISTORY_DAYS} days of demand history; ${Math.max(historyDays, 0)} available.`);
  }
  if (inputAgeMin > UNAVAILABLE_AFTER_MIN) {
    return unavailable("INPUT_STALE", `Newest demand sample is ${Math.round(inputAgeMin)} minutes old.`);
  }

  // Typical demand at a time of day: mean of the same time on up to 7 earlier days.
  const profile = (ms: number) => {
    const past = [1, 2, 3, 4, 5, 6, 7].map((k) => at(ms - k * DAY_MS)).filter((v): v is number => v !== null);
    return past.length ? past.reduce((a, b) => a + b, 0) / past.length : null;
  };
  // Level correction from the last hour of observations, fading over ~6 hours.
  const recent = Array.from({ length: 12 }, (_, k) => cutoff - k * STEP_MIN * MINUTE_MS);
  const ratios = recent.map((ms) => [at(ms), profile(ms)]).filter(([v, p]) => v !== null && p !== null) as [number, number][];
  const level = ratios.length ? ratios.reduce((s, [v, p]) => s + v / p, 0) / ratios.length : 1;

  const series = Array.from({ length: horizonMinutes / stepMinutes }, (_, k) => {
    const ms = asOf + (k + 1) * stepMinutes * MINUTE_MS;
    const p = profile(ms);
    if (p === null) return { timestamp: iso(ms), valueKw: null, quality: "unavailable" as const };
    const hours = (ms - cutoff) / 3_600_000;
    const value = p * (1 + (level - 1) * Math.exp(-hours / 6));
    const spread = value * (0.02 + 0.012 * Math.sqrt(hours));
    return {
      timestamp: iso(ms),
      valueKw: Math.round(value),
      lowerKw: Math.round(value - spread),
      upperKw: Math.round(value + spread),
      quality: "good" as const,
    };
  });

  const valid = series.filter((p) => p.valueKw !== null);
  const peak = valid.reduce((a, b) => (b.valueKw! > a.valueKw! ? b : a), valid[0]);
  const stale = inputAgeMin > STALE_AFTER_MIN;
  const partial = valid.length < series.length;
  return {
    ...base,
    status: partial ? "partial" : "ready",
    inputWindow: { start: iso(demand.start), end: iso(cutoff) },
    model: { artifactId: "demo-seasonal-profile-baseline", revision: "fixture-1", mode: "baseline" },
    quality: {
      freshness: stale ? "stale" : "fresh",
      coverage: partial ? "partial" : "complete",
      reasonCodes: stale ? ["INPUT_STALE"] : [],
      staleAfterMinutes: STALE_AFTER_MIN,
    },
    series,
    interval: { coverage: null, method: "Fixed widening spread (demo fixture)", calibration: "uncalibrated" },
    summary: peak ? { peakKw: peak.valueKw!, peakAt: peak.timestamp, partial } : undefined,
    warnings: [
      "Demo fixture: seasonal-profile baseline on synthetic demand. Not a trained model; no accuracy is claimed.",
      ...(stale ? [`Inputs end ${Math.round(inputAgeMin)} minutes before the cutoff.`] : []),
    ],
  };
}
