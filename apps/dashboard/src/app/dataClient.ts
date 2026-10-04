/**
 * Composition: picks the DataClient for the current context. In the explicit demo
 * mode that is the fixture adapter for the selected scenario. No other mode exists
 * yet, and nothing ever falls back to fixtures.
 */
import type { DataClient } from "../lib/api/client";
import { createFixtureClient, parseFailures } from "../fixtures/fixtureClient";
import { useOperating } from "./operatingContext";

const failures = parseFailures(
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get("fail"),
);
const clients = new Map<string, DataClient>();

export function useDataClient(): DataClient {
  const scenarioId = useOperating((s) => s.scenarioId);
  if (!clients.has(scenarioId)) clients.set(scenarioId, createFixtureClient(scenarioId, { failures }));
  return clients.get(scenarioId)!;
}
