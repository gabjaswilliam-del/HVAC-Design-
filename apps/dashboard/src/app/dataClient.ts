/**
 * Composition: picks the DataClient for the current context. In the explicit demo
 * mode that is the fixture adapter for the selected scenario. No other mode exists
 * yet, and nothing ever falls back to fixtures.
 */
import type { DataClient } from "../lib/api/client";
import type { AgentClient } from "../lib/api/agent";
import { createFixtureAgent } from "../fixtures/fixtureAgent";
import { createFixtureClient, parseFailures } from "../fixtures/fixtureClient";
import { useOperating } from "./operatingContext";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const failures = parseFailures(params.get("fail"));
const clients = new Map<string, DataClient>();

export function useDataClient(): DataClient {
  const scenarioId = useOperating((s) => s.scenarioId);
  if (!clients.has(scenarioId)) clients.set(scenarioId, createFixtureClient(scenarioId, { failures }));
  return clients.get(scenarioId)!;
}

// ponytail: one scripted demo harness for the session; a local-LLM client replaces it.
const agent = createFixtureAgent({
  // agentSpeed=fast is for tests: same events, a small fraction of the demonstration pace.
  delayScale: params.get("agentSpeed") === "fast" ? 0.04 : 1,
  unavailable: (failures as Record<string, string> | undefined)?.agent === "unavailable",
  dataFailures: failures,
});

export const useAgentClient = (): AgentClient => agent;
/** The same harness for code outside components (the conversation session). */
export const agentClient: AgentClient = agent;
