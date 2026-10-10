/**
 * Composition: picks the DataClient for the current context. In the explicit demo
 * mode that is the fixture adapter for the selected scenario. No other mode exists
 * yet, and nothing ever falls back to fixtures.
 */
import type { DataClient } from "../lib/api/client";
import type { AgentClient } from "../lib/api/agent";
import { createFixtureAgent } from "../fixtures/fixtureAgent";
import { createFixtureClient, parseFailures } from "../fixtures/fixtureClient";
import { pilotReader, simulationReader, type PilotClient, type SimulationClient } from "../lib/api/simulation";
import { httpTranscription, notConnected, type TranscriptionClient } from "../lib/api/speech";
import { createSimulationService } from "../fixtures/simulationService";
import type { KnowledgeClient } from "../lib/api/knowledge";
import type { MemoryClient } from "../lib/api/memory";
import type { KnowledgeSnapshot } from "../fixtures/knowledgeDemo";
import type { MemorySnapshot } from "../fixtures/memoryDemo";
import { useOperating } from "./operatingContext";

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const failures = parseFailures(params.get("fail"));
const clients = new Map<string, DataClient>();

export function useDataClient(): DataClient {
  const scenarioId = useOperating((s) => s.scenarioId);
  if (!clients.has(scenarioId)) clients.set(scenarioId, createFixtureClient(scenarioId, { failures }));
  return clients.get(scenarioId)!;
}

// ponytail: one mock simulation service for the session; the local API's simulation and
// pilot clients replace it. simSpeed=fast is for tests: the same lifecycle at 10% of the pace.
const raw = Object.fromEntries((params.get("fail") ?? "").split(",").map((pair) => pair.split(":")));
export const simulationPace = params.get("simSpeed") === "fast" ? 0.1 : 1;
const sim = createSimulationService({ pace: simulationPace, failures: { simulation: raw.simulation, pilot: raw.pilot } });
export const simulationClient: SimulationClient = sim.simulation;
export const pilotClient: PilotClient = sim.pilot;

// ponytail: one offline demo harness for the session (no language model); a local-LLM
// client replaces it. It reads the simulation and pilot through read-only facades (F10).
const agent = createFixtureAgent({
  // agentSpeed=fast is for tests: same events, a small fraction of the demonstration pace.
  delayScale: params.get("agentSpeed") === "fast" ? 0.04 : 1,
  unavailable: (failures as Record<string, string> | undefined)?.agent === "unavailable",
  dataFailures: failures,
  simulation: simulationReader(sim.simulation),
  pilot: pilotReader(sim.pilot),
});

export const useAgentClient = (): AgentClient => agent;
/** The same harness for code outside components (the conversation session). */
export const agentClient: AgentClient = agent;

// ponytail: no speech-to-text service exists in this build, so voice input reports "not
// connected" and never opens the microphone. `stt=local` points the boundary at the
// same-origin, OpenAI-compatible path a local service would serve (tests mock it).
export const transcription: TranscriptionClient =
  params.get("stt") === "local" ? httpTranscription("/api/stt/v1") : notConnected("No speech-to-text service is connected in this build.");

// The Knowledge workspace (Graph RAG and Graph Memory) and its clients load with it, in their
// own chunks. By default the fixed demo library and records, read only. `knowledge=local`
// selects the local knowledge and memory services instead (`apps/api/local_server.py`,
// which the dev server proxies), persistent and fully managed. The two never fall back
// to each other.
export const knowledgeMode: "demo" | "local" = params.get("knowledge") === "local" ? "local" : "demo";
let knowledgeClients: Promise<{ knowledge: KnowledgeClient; memory: MemoryClient }> | undefined;
export function loadKnowledgeClients() {
  knowledgeClients ??=
    knowledgeMode === "local"
      ? Promise.all([import("../lib/api/knowledge"), import("../lib/api/memory")]).then(([k, m]) => ({ knowledge: k.httpKnowledge(), memory: m.httpMemory() }))
      : Promise.all([
          import("../fixtures/knowledgeDemo"),
          import("../fixtures/knowledgeDemo.json"),
          import("../fixtures/memoryDemo"),
          import("../fixtures/memoryDemo.json"),
        ]).then(([k, kSnapshot, m, mSnapshot]) => ({
          knowledge: k.demoKnowledge(kSnapshot.default as unknown as KnowledgeSnapshot, { failure: raw.knowledge }),
          memory: m.demoMemory(mSnapshot.default as unknown as MemorySnapshot, { failure: raw.memory }),
        }));
  return knowledgeClients;
}
