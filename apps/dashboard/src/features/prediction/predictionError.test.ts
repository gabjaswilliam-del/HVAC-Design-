import { describe, expect, it } from "vitest";
import type { ForecastResult } from "../../lib/contracts";
import { createFixtureClient } from "../../fixtures/fixtureClient";
import { DAY_START, MINUTE_MS } from "../../fixtures/generate";
import { errorSoFar, predictedPeak } from "./predictionError";

const T0 = Date.UTC(2026, 0, 1);
const at = (min: number) => new Date(T0 + min * MINUTE_MS).toISOString();

function forecast(values: (number | null)[]): ForecastResult {
  return {
    schemaVersion: 1,
    forecastId: "fc",
    status: "ready",
    source: { kind: "telemetry" },
    configRevision: 1,
    target: "cooling_load_kw",
    unit: "kW",
    asOf: at(0),
    generatedAt: at(0),
    inputWindow: null,
    latestInputAt: at(0),
    horizonMinutes: values.length * 15,
    stepMinutes: 15,
    model: null,
    quality: { freshness: "fresh", coverage: "complete", reasonCodes: [], staleAfterMinutes: 30 },
    series: values.map((v, i) => ({ timestamp: at((i + 1) * 15), valueKw: v, quality: "good" })),
    warnings: [],
  };
}

describe("error of a prediction against the actual load logged so far", () => {
  it("compares only prediction points that have been logged, up to the clock", () => {
    const f = forecast([110, 190, 300, 400]);
    // Actual on a 5-minute grid; the clock is at 30 minutes, so 45 and 60 are not logged yet.
    const times = [0, 5, 10, 15, 20, 25, 30, 35].map(at);
    const values = [100, 100, 100, 100, 150, 180, 200, 999];
    const e = errorSoFar(f, { times, values }, T0 + 30 * MINUTE_MS);
    expect(e.logged).toBe(2);
    expect(e.total).toBe(4);
    expect(e.maeKw).toBeCloseTo((10 + 10) / 2);
    expect(e.mapePct).toBeCloseTo(((10 / 100 + 10 / 200) / 2) * 100);
  });

  it("has no error before the first point is logged, and skips gaps", () => {
    const f = forecast([110, null, 300]);
    expect(errorSoFar(f, undefined, T0 + 60 * MINUTE_MS)).toEqual({ logged: 0, total: 2, maeKw: null, mapePct: null });
    const e = errorSoFar(f, { times: [at(15), at(45)], values: [null, 330] }, T0 + 60 * MINUTE_MS);
    expect(e.logged).toBe(1);
    expect(e.maeKw).toBe(30);
  });

  it("finds the predicted peak", () => {
    expect(predictedPeak(forecast([110, 400, null, 300]))).toEqual({ kw: 400, at: at(30) });
    expect(predictedPeak(forecast([null]))).toBeNull();
  });

  it("logs every prediction point on the demo data as the clock passes it", async () => {
    const c = createFixtureClient("normal", { latencyMs: 0 });
    const noon = DAY_START + 12 * 60 * MINUTE_MS;
    const f = await c.getLatestForecast({ at: new Date(noon).toISOString(), horizonMinutes: 360, stepMinutes: 15 });
    const clock = noon + 3 * 60 * MINUTE_MS;
    const actual = await c.getDemandHistory({ from: f.asOf, to: new Date(clock).toISOString() });
    const e = errorSoFar(f, actual, clock);
    expect(e.total).toBe(24);
    expect(e.logged).toBe(12);
    expect(e.maeKw).toBeGreaterThanOrEqual(0);
  });
});
