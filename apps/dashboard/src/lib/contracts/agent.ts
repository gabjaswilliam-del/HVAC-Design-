/**
 * Agent harness boundary: conversations, a streamed turn of events, and typed data
 * views. A local-LLM harness and the scripted demo produce the same events, so the UI
 * does not change when the scripted demo is replaced. Views are typed presentation
 * payloads with typed navigation targets; model output never supplies HTML, scripts or
 * arbitrary URLs.
 */
import { z } from "zod";
import { isoTime } from "./common";

const severity = z.enum(["info", "warning", "critical"]);

/** Where a view may send the operator. Mapped to routes by the UI, never a raw URL. */
export const navTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("monitoring_kpi"), kpi: z.string() }),
  z.object({ type: z.literal("equipment"), id: z.string() }),
  z.object({ type: z.literal("prediction"), forecastId: z.string().optional() }),
  z.object({ type: z.literal("equipment_page"), id: z.string().optional() }),
]);
export type NavTarget = z.infer<typeof navTarget>;

const chartSeries = z.object({
  id: z.string(),
  label: z.string(),
  role: z.enum(["observed", "forecast", "delivered", "capacity"]),
  times: z.array(isoTime),
  values: z.array(z.number().finite().nullable()),
});

export const dataView = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equipment"), title: z.string(), ids: z.array(z.string()) }),
  z.object({
    kind: z.literal("issues"),
    title: z.string(),
    issues: z.array(z.object({ id: z.string(), title: z.string(), severity, status: z.string(), equipmentIds: z.array(z.string()) })),
  }),
  z.object({
    kind: z.literal("chart"),
    title: z.string(),
    unit: z.string(),
    decimals: z.number().int(),
    series: z.array(chartSeries),
    band: z.object({ label: z.string(), times: z.array(isoTime), lo: z.array(z.number().nullable()), hi: z.array(z.number().nullable()) }).optional(),
    cutoff: isoTime.optional(),
  }),
  z.object({ kind: z.literal("link"), label: z.string(), target: navTarget }),
]);
export type DataView = z.infer<typeof dataView>;

export const agentContext = z.object({
  source: z.literal("telemetry"),
  configRevision: z.number().int().positive(),
  /** Observation time the question refers to. */
  at: isoTime,
  equipmentId: z.string().nullable(),
  /** Demo only: the synthetic scenario the conversation was recorded against. */
  demoScenario: z.object({ id: z.string(), label: z.string() }).optional(),
});
export type AgentContext = z.infer<typeof agentContext>;

const toolArgs = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const agentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("turn_start"), turnId: z.string(), prompt: z.string(), at: isoTime }),
  z.object({ type: z.literal("text_delta"), text: z.string() }),
  z.object({ type: z.literal("tool_call"), callId: z.string(), tool: z.string(), args: toolArgs, simulated: z.boolean() }),
  z.object({
    type: z.literal("tool_result"),
    callId: z.string(),
    status: z.enum(["ok", "error"]),
    summary: z.string(),
  }),
  z.object({ type: z.literal("view"), view: dataView }),
  z.object({
    type: z.literal("turn_end"),
    status: z.enum(["complete", "cancelled", "error"]),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  }),
]);
export type AgentEvent = z.infer<typeof agentEvent>;

/** A finished or in-progress turn as stored by the harness. */
export const turnPart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    callId: z.string(),
    tool: z.string(),
    args: toolArgs,
    simulated: z.boolean(),
    status: z.enum(["running", "ok", "error"]),
    summary: z.string().nullable(),
  }),
  z.object({ type: z.literal("view"), view: dataView }),
]);
export type TurnPart = z.infer<typeof turnPart>;

export const turn = z.object({
  id: z.string(),
  prompt: z.string(),
  at: isoTime,
  parts: z.array(turnPart),
  status: z.enum(["running", "complete", "cancelled", "error"]),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type Turn = z.infer<typeof turn>;

export const conversation = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: isoTime,
  context: agentContext,
  turns: z.array(turn),
});
export type Conversation = z.infer<typeof conversation>;

export const conversationSummary = conversation.pick({ id: true, title: true, createdAt: true, context: true }).extend({
  turnCount: z.number().int(),
});
export type ConversationSummary = z.infer<typeof conversationSummary>;

export const agentCapabilities = z.object({
  /** `scripted_demo` today; a local model harness would report `local_llm`. */
  mode: z.enum(["scripted_demo", "local_llm"]),
  model: z.object({ id: z.string(), revision: z.string() }).nullable(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), available: z.boolean(), simulated: z.boolean() })),
  suggestedPrompts: z.array(z.string()),
});
export type AgentCapabilities = z.infer<typeof agentCapabilities>;

/** Apply one streamed event to a turn. Shared by the harness store and the UI. */
export function applyEvent(t: Turn, e: AgentEvent): Turn {
  switch (e.type) {
    case "turn_start":
      return t;
    case "text_delta": {
      const last = t.parts.at(-1);
      if (last?.type === "text") return { ...t, parts: [...t.parts.slice(0, -1), { type: "text", text: last.text + e.text }] };
      return { ...t, parts: [...t.parts, { type: "text", text: e.text }] };
    }
    case "tool_call":
      return { ...t, parts: [...t.parts, { type: "tool", callId: e.callId, tool: e.tool, args: e.args, simulated: e.simulated, status: "running", summary: null }] };
    case "tool_result":
      return {
        ...t,
        parts: t.parts.map((p) => (p.type === "tool" && p.callId === e.callId ? { ...p, status: e.status, summary: e.summary } : p)),
      };
    case "view":
      return { ...t, parts: [...t.parts, { type: "view", view: e.view }] };
    case "turn_end":
      return {
        ...t,
        status: e.status,
        error: e.error,
        // A cancelled or failed turn leaves no tool shown as still running.
        parts: t.parts.map((p) => (p.type === "tool" && p.status === "running" ? { ...p, status: "error", summary: e.status === "cancelled" ? "Cancelled" : "Not completed" } : p)),
      };
  }
}
