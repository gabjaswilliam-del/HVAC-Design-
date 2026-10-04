/**
 * Cooling-load forecast result, following the proposed result in
 * docs/ui-data-contracts.md. Target is future site-wide required cooling load in
 * thermal kW. The grid rules are enforced at the boundary, not by the charts.
 */
import { z } from "zod";
import { isoTime, quality, source } from "./common";

const MINUTE = 60_000;

const point = z.object({
  timestamp: isoTime,
  valueKw: z.number().finite().nullable(),
  lowerKw: z.number().finite().nullable().optional(),
  upperKw: z.number().finite().nullable().optional(),
  quality,
});

export const forecastResult = z
  .object({
    schemaVersion: z.literal(1),
    forecastId: z.string().min(1),
    status: z.enum(["ready", "partial", "unavailable"]),
    source,
    configRevision: z.number().int().positive(),
    target: z.literal("cooling_load_kw"),
    unit: z.literal("kW"),
    asOf: isoTime,
    generatedAt: isoTime,
    inputWindow: z.object({ start: isoTime, end: isoTime }).nullable(),
    latestInputAt: isoTime.nullable(),
    horizonMinutes: z.number().int().positive(),
    stepMinutes: z.number().int().positive(),
    model: z
      .object({
        artifactId: z.string(),
        revision: z.string(),
        mode: z.enum(["site_adapted", "pretrained", "baseline"]),
      })
      .nullable(),
    quality: z.object({
      freshness: z.enum(["fresh", "stale"]),
      coverage: z.enum(["complete", "partial", "none"]),
      reasonCodes: z.array(z.string()),
      staleAfterMinutes: z.number().int().positive(),
    }),
    series: z.array(point),
    interval: z
      .object({
        coverage: z.number().min(0).max(1).nullable(),
        method: z.string(),
        calibration: z.enum(["calibrated", "uncalibrated"]),
      })
      .optional(),
    summary: z.object({ peakKw: z.number().finite(), peakAt: isoTime, partial: z.boolean() }).optional(),
    warnings: z.array(z.string()),
    reasonCode: z
      .enum(["MODEL_UNAVAILABLE", "INSUFFICIENT_HISTORY", "INPUT_STALE", "CONFIG_MISMATCH", "SOURCE_UNSUPPORTED"])
      .optional(),
  })
  .superRefine((r, ctx) => {
    if (r.stepMinutes > r.horizonMinutes || r.horizonMinutes % r.stepMinutes !== 0) {
      ctx.addIssue({ code: "custom", message: "step must divide horizon" });
    }
    if (r.status === "unavailable") {
      if (r.series.length) ctx.addIssue({ code: "custom", message: "unavailable result must not carry a series" });
      if (!r.reasonCode) ctx.addIssue({ code: "custom", message: "unavailable result needs a reason code" });
      return;
    }
    // Grid: as_of + step ... as_of + horizon, strictly increasing, no nowcast at as_of.
    const asOf = Date.parse(r.asOf);
    const expected = r.horizonMinutes / r.stepMinutes;
    if (r.series.length !== expected) {
      ctx.addIssue({ code: "custom", message: `expected ${expected} points, got ${r.series.length}` });
    }
    r.series.forEach((p, i) => {
      if (Date.parse(p.timestamp) !== asOf + (i + 1) * r.stepMinutes * MINUTE) {
        ctx.addIssue({ code: "custom", message: `point ${i} is off the forecast grid` });
      }
      const { lowerKw: lo, upperKw: hi, valueKw: v } = p;
      if (v !== null && lo != null && hi != null && !(lo <= v && v <= hi)) {
        ctx.addIssue({ code: "custom", message: `point ${i} interval is not ordered` });
      }
    });
  });
export type ForecastResult = z.infer<typeof forecastResult>;

/** Observed demand for the same target and context, labeled separately. */
export const demandHistory = z.object({
  schemaVersion: z.literal(1),
  target: z.literal("cooling_load_kw"),
  unit: z.literal("kW"),
  times: z.array(isoTime),
  values: z.array(z.number().finite().nullable()),
});
export type DemandHistory = z.infer<typeof demandHistory>;
