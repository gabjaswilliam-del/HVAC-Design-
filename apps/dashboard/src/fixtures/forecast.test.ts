import { describe, expect, it } from "vitest";
import { forecastResult } from "../lib/contracts";
import { seasonalBaselineForecast, type ForecastRequest } from "./forecast";
import { DAY_START, MINUTE_MS, generate } from "./generate";
import { scenarioById } from "./scenarios";

const d = generate(scenarioById("normal")!);
const at = (h: number, m: number) => DAY_START + (h * 60 + m) * MINUTE_MS;
const req = (over: Partial<ForecastRequest> = {}): ForecastRequest => ({
  scenarioId: "normal",
  source: { kind: "telemetry" },
  configRevision: 1,
  asOf: at(15, 15),
  latestInputAt: at(15, 15),
  horizonMinutes: 360,
  stepMinutes: 15,
  ...over,
});

describe("seasonal baseline forecast fixture", () => {
  it("produces a valid grid for several horizons and steps", () => {
    for (const [h, s] of [[360, 15], [720, 60], [1440, 60]]) {
      const r = forecastResult.parse(seasonalBaselineForecast(d.demand, req({ horizonMinutes: h, stepMinutes: s })));
      expect(r.status).toBe("ready");
      expect(r.series).toHaveLength(h / s);
      expect(r.model?.mode).toBe("baseline");
      expect(r.interval?.calibration).toBe("uncalibrated");
    }
  });

  it("uses no demand after its cutoff", () => {
    const original = seasonalBaselineForecast(d.demand, req());
    const cutoffIndex = (req().asOf - d.demand.start) / (5 * MINUTE_MS);
    const tampered = { start: d.demand.start, values: d.demand.values.map((x, i) => (i > cutoffIndex ? x * 3 : x)) };
    expect(seasonalBaselineForecast(tampered, req())).toEqual(original);
  });

  it("is unavailable, with no series, when history is insufficient", () => {
    const short = { start: DAY_START - 2 * 24 * 60 * MINUTE_MS, values: d.demand.values.slice(-3 * 288) };
    const r = forecastResult.parse(seasonalBaselineForecast(short, req()));
    expect(r.status).toBe("unavailable");
    expect(r.reasonCode).toBe("INSUFFICIENT_HISTORY");
    expect(r.series).toEqual([]);
    expect(r.model).toBeNull();
  });

  it("flags stale inputs, and refuses very stale ones", () => {
    const stale = seasonalBaselineForecast(d.demand, req({ latestInputAt: at(14, 40) }));
    expect(stale.quality.freshness).toBe("stale");
    const old = seasonalBaselineForecast(d.demand, req({ latestInputAt: at(12, 0) }));
    expect(old.status).toBe("unavailable");
    expect(old.reasonCode).toBe("INPUT_STALE");
  });

  it("boundary schema rejects off-grid points and unordered intervals", () => {
    const good = seasonalBaselineForecast(d.demand, req());
    const shifted = { ...good, series: good.series.map((p, i) => (i === 3 ? { ...p, timestamp: good.asOf } : p)) };
    expect(forecastResult.safeParse(shifted).success).toBe(false);
    const flipped = { ...good, series: good.series.map((p, i) => (i === 0 ? { ...p, lowerKw: p.upperKw, upperKw: p.lowerKw } : p)) };
    expect(forecastResult.safeParse(flipped).success).toBe(false);
  });
});
