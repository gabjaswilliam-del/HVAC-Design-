/**
 * How a prediction compares with the actual cooling load logged so far: every prediction
 * point that has an actual value at the same time, and the error over those points. Pure,
 * so it is tested on its own.
 */
import type { DemandHistory, ForecastResult } from "../../lib/contracts";

export interface ErrorSoFar {
  /** Prediction points with an actual value logged at the same time. */
  logged: number;
  /** Prediction points with a value. */
  total: number;
  /** Mean absolute error over the logged points, kWt; null before the first. */
  maeKw: number | null;
  /** Mean absolute percentage error over logged points whose actual value is above zero. */
  mapePct: number | null;
}

export function errorSoFar(forecast: ForecastResult, actual: Pick<DemandHistory, "times" | "values"> | undefined, upTo: number): ErrorSoFar {
  const seen = new Map<number, number>();
  actual?.times.forEach((t, i) => {
    const v = actual.values[i];
    const ms = Date.parse(t);
    if (v !== null && ms <= upTo) seen.set(ms, v);
  });
  const points = forecast.series.filter((p) => p.valueKw !== null);
  const pairs = points.filter((p) => seen.has(Date.parse(p.timestamp))).map((p) => ({ v: p.valueKw!, a: seen.get(Date.parse(p.timestamp))! }));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  return {
    logged: pairs.length,
    total: points.length,
    maeKw: mean(pairs.map((p) => Math.abs(p.v - p.a))),
    mapePct: mean(pairs.filter((p) => p.a > 0).map((p) => (Math.abs(p.v - p.a) / p.a) * 100)),
  };
}

/** The highest predicted point, or null when the prediction has no values. */
export function predictedPeak(forecast: ForecastResult): { kw: number; at: string } | null {
  return forecast.series.reduce<{ kw: number; at: string } | null>((b, p) => (p.valueKw !== null && (!b || p.valueKw > b.kw) ? { kw: p.valueKw, at: p.timestamp } : b), null);
}
