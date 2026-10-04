/**
 * The single forecast data path for the prediction page and the monitoring summary.
 * Results are cached by full identity (scenario/source/revision/cutoff/target/
 * horizon/step), so both placements show the same forecast ID without a second
 * request. Reading a forecast never starts inference or training.
 */
import type { ForecastResult } from "../../lib/contracts";
import { useResource, type Resource } from "../../lib/api/useResource";
import { useDataClient } from "../../app/dataClient";
import { useOperating } from "../../app/operatingContext";

const ISSUE_INTERVAL_MS = 15 * 60_000;
const cache = new Map<string, ForecastResult>();

export interface ForecastQuery {
  horizonMinutes: number;
  stepMinutes: number;
  configRevision: number;
}

export function useLatestForecast(q: ForecastQuery): Resource<ForecastResult> {
  const client = useDataClient();
  const scenarioId = useOperating((s) => s.scenarioId);
  const cursor = useOperating((s) => s.cursor);
  // Forecasts are issued on a 15-minute cadence; ask for the newest issued one.
  const issuedAt = new Date(Math.floor(cursor / ISSUE_INTERVAL_MS) * ISSUE_INTERVAL_MS).toISOString();
  const context = `${scenarioId}|telemetry|rev${q.configRevision}`;
  const key = `${context}|cooling_load_kw|${issuedAt}|h${q.horizonMinutes}|s${q.stepMinutes}`;
  return useResource(key, context, async (signal) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const result = await client.getLatestForecast(
      { at: issuedAt, horizonMinutes: q.horizonMinutes, stepMinutes: q.stepMinutes },
      { signal },
    );
    cache.set(key, result);
    return result;
  });
}
