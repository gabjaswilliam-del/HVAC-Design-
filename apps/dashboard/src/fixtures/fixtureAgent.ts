/**
 * SCRIPTED demo implementation of the AgentClient. No language model: prompts are
 * matched to pre-written investigations (agentScripts.ts) whose simulated tools read
 * the synthetic scenario data. It streams the same event types a local-LLM harness
 * would, confirms cancellation through the stream, and keeps conversations in memory
 * for this browser session. Each conversation always runs against the scenario and
 * time it was recorded with, never silently against the current one.
 */
import { ApiError, type RequestOptions } from "../lib/api/client";
import type { AgentClient } from "../lib/api/agent";
import {
  applyEvent,
  type AgentCapabilities,
  type AgentContext,
  type AgentEvent,
  type Conversation,
  type DataView,
} from "../lib/contracts/agent";
import type { SiteBundle } from "../lib/contracts";
import { TOOL_INFO, tools, type ToolEnv, type ToolName } from "./agentTools";
import { runScript, SUGGESTED_PROMPTS, type ScriptHost } from "./agentScripts";
import { createFixtureClient, type FixtureOptions } from "./fixtureClient";
import { DAY_START, MINUTE_MS } from "./generate";
import { scenarioById } from "./scenarios";

export interface AgentFixtureOptions {
  /** Multiplies the simulated pacing; 0 runs instantly (used for seeding and tests). */
  delayScale?: number;
  unavailable?: boolean;
  /** Failures injected into the data the simulated tools read. */
  dataFailures?: FixtureOptions["failures"];
}

class Cancelled extends Error {}

const store = new Map<string, Conversation>();
const cancelled = new Set<string>();
let seeded: Promise<void> | null = null;
let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Simulated pacing in ms at delayScale 1, varied each time so it never feels mechanical. */
const TOOL_MS: Record<ToolName, number> = {
  list_issues: 380,
  get_equipment: 360,
  get_plant_snapshot: 460,
  get_history: 600,
  get_forecast: 560,
  search_knowledge: 520,
};
const vary = (ms: number, random = Math.random) => ms * (0.75 + random() * 0.5);

/**
 * Answer text cut the way a model streams it: pieces of one to three words, each followed
 * by a varied pause that lengthens after a clause, a sentence and a line, so the answer
 * reads as composed rather than typed. Joined, the pieces are exactly the text.
 */
export function paceText(text: string, random = Math.random) {
  const words = text.split(/(?<=\s)(?=\S)/);
  const pieces: { text: string; ms: number }[] = [];
  for (let i = 0; i < words.length; ) {
    const size = random() < 0.4 ? 1 : random() < 0.8 ? 2 : 3;
    let piece = "";
    let n = 0;
    while (n < size && i < words.length) {
      const w = words[i++];
      piece += w;
      n++;
      // Punctuation and line ends close a piece; a list number ("1. ") does not.
      if (w.includes("\n") || (/[.,:;!?]\s*$/.test(w) && !/^\d+\.\s*$/.test(w))) break;
    }
    const end = piece.trimEnd();
    const pause = piece.includes("\n")
      ? /^[-*|\d]/.test(words[i] ?? "")
        ? 90 // the next list item or table row follows sooner than a paragraph
        : 220
      : /[.!?]$/.test(end) && !/^\d+\.$/.test(end)
        ? 140
        : /[:;]$/.test(end)
          ? 90
          : end.endsWith(",")
            ? 45
            : 0;
    pieces.push({ text: piece, ms: Math.round(vary(30 + 10 * n, random) + vary(pause, random)) });
  }
  return pieces;
}

const envCache = new Map<string, Promise<ToolEnv>>();
function envFor(context: AgentContext, opts: AgentFixtureOptions): Promise<ToolEnv> {
  const scenarioId = context.demoScenario?.id ?? "normal";
  const key = `${scenarioId}|${JSON.stringify(opts.dataFailures ?? {})}`;
  if (!envCache.has(key)) {
    const client = createFixtureClient(scenarioId, { latencyMs: 0, failures: opts.dataFailures });
    envCache.set(key, client.getSite().then((site: SiteBundle) => ({ client, site })));
  }
  return envCache.get(key)!;
}

/** Run one scripted turn, emitting events to `emit`. Resolves when the turn has ended. */
async function runTurn(conv: Conversation, prompt: string, opts: AgentFixtureOptions, emit: (e: AgentEvent) => void) {
  const scale = opts.delayScale ?? 1;
  const turnId = nextId("turn");
  conv.turns.push({ id: turnId, prompt, at: conv.context.at, parts: [], status: "running" });
  const record = (e: AgentEvent) => {
    const i = conv.turns.findIndex((t) => t.id === turnId);
    conv.turns[i] = applyEvent(conv.turns[i], e);
    emit(e);
  };
  const check = () => {
    if (cancelled.has(turnId)) throw new Cancelled();
  };
  record({ type: "turn_start", turnId, prompt, at: conv.context.at });
  try {
    const env = await envFor(conv.context, opts);
    await sleep(vary(300) * scale); // a moment before the first step
    const host: ScriptHost = {
      env,
      context: conv.context,
      async tool(name: ToolName, args: Record<string, string | number>) {
        check();
        const callId = nextId("call");
        record({ type: "tool_call", callId, tool: name, args, simulated: true });
        await sleep(vary(TOOL_MS[name]) * scale);
        check();
        let value: unknown = null;
        try {
          const out = await (tools[name] as (env: ToolEnv, a: unknown) => Promise<{ value: unknown; summary: string }>)(env, args);
          record({ type: "tool_result", callId, status: "ok", summary: out.summary });
          value = out.value;
        } catch (e) {
          record({ type: "tool_result", callId, status: "error", summary: e instanceof Error ? e.message : String(e) });
        }
        await sleep(vary(90) * scale);
        return value as never;
      },
      async say(text: string) {
        // A short pause, then the answer in token-like pieces at a calm, varied pace.
        await sleep(vary(460) * scale);
        for (const piece of paceText(text)) {
          check();
          record({ type: "text_delta", text: piece.text });
          await sleep(piece.ms * scale);
        }
      },
      view(view: DataView) {
        check();
        record({ type: "view", view });
      },
    };
    await runScript(host, prompt);
    check();
    record({ type: "turn_end", status: "complete" });
  } catch (e) {
    if (e instanceof Cancelled) record({ type: "turn_end", status: "cancelled" });
    else record({ type: "turn_end", status: "error", error: { code: "SCRIPT_FAILED", message: e instanceof Error ? e.message : String(e) } });
  } finally {
    cancelled.delete(turnId);
  }
}

function contextFor(scenarioId: string, hh: number, mm: number, equipmentId: string | null = null): AgentContext {
  const def = scenarioById(scenarioId)!;
  return {
    source: "telemetry",
    configRevision: 1,
    at: new Date(DAY_START + (hh * 60 + mm) * MINUTE_MS).toISOString(),
    equipmentId,
    demoScenario: { id: def.id, label: def.label },
  };
}

/** Three recorded demo conversations, produced by the same scripts at fixed contexts. */
function seed(opts: AgentFixtureOptions) {
  seeded ??= (async () => {
    const recordings: [AgentContext, string][] = [
      [contextFor("sensor-issues", 15, 15, "chilled_water_pump_pri_3"), "Investigate CHW pump 3"],
      [contextFor("pump-trip", 14, 12), "Is the plant meeting cooling demand?"],
      [contextFor("tower-fault", 15, 15), "What needs attention right now?"],
    ];
    const now = Date.now();
    for (const [i, [context, prompt]] of recordings.entries()) {
      const conv: Conversation = { id: `demo-${i + 1}`, title: prompt, createdAt: new Date(now - (3 - i) * 3_600_000).toISOString(), context, turns: [] };
      store.set(conv.id, conv);
      await runTurn(conv, prompt, { ...opts, delayScale: 0, dataFailures: undefined }, () => {});
    }
  })();
  return seeded;
}

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function createFixtureAgent(opts: AgentFixtureOptions = {}): AgentClient {
  const latency = 120 * (opts.delayScale ?? 1);
  const ready = async (o?: RequestOptions) => {
    if (o?.signal?.aborted) throw new ApiError("ABORTED", "Request cancelled", false);
    await seed(opts);
    await sleep(latency);
    if (o?.signal?.aborted) throw new ApiError("ABORTED", "Request cancelled", false);
  };

  return {
    async getCapabilities(o) {
      await ready(o);
      const caps: AgentCapabilities = {
        mode: "scripted_demo",
        model: null,
        tools: TOOL_INFO.map((t) => ({ ...t, available: t.name !== "search_knowledge", simulated: true })),
        suggestedPrompts: SUGGESTED_PROMPTS,
      };
      return caps;
    },
    async listConversations(o) {
      await ready(o);
      return [...store.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, context: c.context, turnCount: c.turns.length }));
    },
    async getConversation(id, o) {
      await ready(o);
      const c = store.get(id);
      if (!c) throw new ApiError("NOT_FOUND", `No conversation ${id}.`, false);
      return copy(c);
    },
    async createConversation(context, o) {
      await ready(o);
      const c: Conversation = { id: nextId("conv"), title: "New conversation", createdAt: new Date().toISOString(), context, turns: [] };
      store.set(c.id, c);
      return copy(c);
    },
    sendMessage(conversationId, prompt) {
      return {
        async *[Symbol.asyncIterator]() {
          await ready();
          if (opts.unavailable) throw new ApiError("UNAVAILABLE", "The assistant service is not available.", true);
          const conv = store.get(conversationId);
          if (!conv) throw new ApiError("NOT_FOUND", `No conversation ${conversationId}.`, false);
          if (conv.turns.length === 0) conv.title = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
          const queue: AgentEvent[] = [];
          let wake: (() => void) | null = null;
          let done = false;
          const finished = runTurn(conv, prompt, opts, (e) => {
            queue.push(e);
            if (e.type === "turn_end") done = true;
            wake?.();
          });
          while (!done || queue.length) {
            if (!queue.length) await new Promise<void>((r) => (wake = r));
            wake = null;
            while (queue.length) yield queue.shift()!;
          }
          await finished;
        },
      };
    },
    async cancelTurn(_conversationId, turnId) {
      cancelled.add(turnId);
      await sleep(60 * (opts.delayScale ?? 1));
    },
  };
}

/** For tests: forget conversations created in this module. */
export function resetFixtureAgent() {
  store.clear();
  cancelled.clear();
  seeded = null;
  envCache.clear();
}
