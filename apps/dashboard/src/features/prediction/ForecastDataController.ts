/**
 * The single forecast data path for the prediction page, the monitoring summary and
 * comparisons. Results are cached by full identity (scenario/source/revision/cutoff/
 * target/horizon/step) and by forecast ID, so every placement shows the same result
 * without a second request. Reading a forecast never starts inference or training.
 */
import type { ForecastCapabilities, ForecastResult } from "../../lib/contracts";
import { useResource, type Resource } from "../../lib/api/useResource";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";

export const ISSUE_INTERVAL_MS = 15 * 60_000;
const byKey = new Map<string, ForecastResult>();
const byId = new Map<string, ForecastResult>();

export interface ForecastQuery {
  horizonMinutes: number;
  stepMinutes: number;
  configRevision: number;
  /** Ask for the forecast issued at or before this time instead of the playback time. */
  at?: number;
}

const remember = (key: string, r: ForecastResult) => {
  byKey.set(key, r);
  byId.set(r.forecastId, r);
  return r;
};

export function useLatestForecast(q: ForecastQuery): Resource<ForecastResult> {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const cursor = useOperating((s) => s.cursor);
  // Forecasts are issued on a 15-minute cadence; ask for the newest issued one.
  const issuedAt = new Date(Math.floor((q.at ?? cursor) / ISSUE_INTERVAL_MS) * ISSUE_INTERVAL_MS).toISOString();
  const context = `${scenarioId}|telemetry|rev${q.configRevision}`;
  const key = `${context}|cooling_load_kw|${issuedAt}|h${q.horizonMinutes}|s${q.stepMinutes}`;
  return useResource(key, context, async (signal) => {
    const hit = byKey.get(key);
    if (hit) return hit;
    const r = await client.getLatestForecast(
      { at: issuedAt, horizonMinutes: q.horizonMinutes, stepMinutes: q.stepMinutes },
      { signal },
    );
    return remember(key, r);
  });
}

/** One specific forecast, e.g. the one a "View forecast" link pointed at. */
export function useForecastById(forecastId: string | null, configRevision: number): Resource<ForecastResult> {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const context = `${scenarioId}|telemetry|rev${configRevision}`;
  return useResource(forecastId && `id:${forecastId}`, context, async (signal) => {
    const hit = byId.get(forecastId!);
    if (hit) return hit;
    const r = await client.getForecastById(forecastId!, { signal });
    byId.set(r.forecastId, r);
    return r;
  });
}

export function useForecastCapabilities(): Resource<ForecastCapabilities> {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  return useResource("capabilities", scenarioId, (signal) => client.getForecastCapabilities({ signal }));
}
