/**
 * Agent harness boundary: conversations, a streamed turn of events, typed data views and
 * typed workspace actions. A local-LLM harness and the offline demo produce the same
 * events, so the UI does not change when the demo is replaced. Views and actions carry
 * typed navigation targets; model output never supplies HTML, scripts, components or
 * arbitrary URLs. Charts are not drawn in the conversation: a view or action opens them
 * in the main display.
 */
import { z } from "zod";
import { isoTime } from "./common";

const severity = z.enum(["info", "warning", "critical"]);

/**
 * Where a view may send the operator: a typed address of a screen in the workspace,
 * mapped to a route by the app (`targetPath`), never a raw URL. The simulation and pilot
 * targets only open a run, equipment on it or a pilot issue for reading (F10): no
 * target, tool or event lets the assistant start, pause, stop or correct a simulation.
 */
export const navTarget = z.discriminatedUnion("type", [
  z.object({ type: z.literal("monitoring_kpi"), kpi: z.string() }),
  z.object({ type: z.literal("equipment"), id: z.string() }),
  z.object({ type: z.literal("prediction"), forecastId: z.string().optional() }),
  z.object({ type: z.literal("equipment_page"), id: z.string().optional() }),
  /** Simulation history, or one recorded run's replay: optionally at one of its findings or
   *  items, or compared with a matched run. */
  z.object({
    type: z.literal("simulation"),
    runId: z.string().optional(),
    issueId: z.string().optional(),
    equipmentId: z.string().optional(),
    compareWith: z.string().optional(),
  }),
  /** AI Pilot, in the workspace: the run it operates, its findings or one issue. The main
   *  display stays where it is. */
  z.object({
    type: z.literal("pilot"),
    runId: z.string().optional(),
    issueId: z.string().optional(),
    view: z.enum(["live", "summary", "findings", "corrections"]).optional(),
  }),
  /** One plant indicator's trend in the main display (telemetry): today, or the last hours. */
  z.object({ type: z.literal("metric"), key: z.string(), hours: z.number().int().min(1).max(24).optional() }),
]);
export type NavTarget = z.infer<typeof navTarget>;

export const dataView = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("equipment"), title: z.string(), ids: z.array(z.string()) }),
  z.object({
    kind: z.literal("issues"),
    title: z.string(),
    issues: z.array(z.object({ id: z.string(), title: z.string(), severity, status: z.string(), equipmentIds: z.array(z.string()) })),
  }),
  z.object({ kind: z.literal("link"), label: z.string(), target: navTarget }),
]);
export type DataView = z.infer<typeof dataView>;

/**
 * A change the assistant asks the workspace to make. `open`: show a typed view (applied by
 * the app through `targetPath`). `reveal`: point to one of the operator's AI Pilot controls,
 * which the app outlines and names, and never presses or focuses (F10: only the operator
 * operates a simulation). Both are validated like every event; model output never names a
 * component, a URL or a command.
 */
export const pilotControl = z.enum(["start", "pause", "resume", "step", "stop", "monitoring", "apply", "corrections"]);
export const workspaceAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), target: navTarget, label: z.string() }),
  z.object({ kind: z.literal("reveal"), control: pilotControl, runId: z.string().optional(), issueId: z.string().optional(), label: z.string() }),
]);
export type WorkspaceAction = z.infer<typeof workspaceAction>;

/** A file sent with a question: what it is, and its text, which the assistant reads. */
export const attachmentMeta = z.object({ name: z.string().min(1), type: z.string(), size: z.number().int().nonnegative() });
export type AttachmentMeta = z.infer<typeof attachmentMeta>;
export const attachmentInput = attachmentMeta.extend({ text: z.string() });
export type AttachmentInput = z.infer<typeof attachmentInput>;

/** One assistant turn's input. Typed text, a transcription and attachments all arrive
 *  here, so every input takes the same path through the assistant. */
export const agentMessage = z.object({ prompt: z.string(), attachments: z.array(attachmentInput) });
export type AgentMessage = z.infer<typeof agentMessage>;

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
  z.object({ type: z.literal("action"), action: workspaceAction }),
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
  z.object({ type: z.literal("action"), action: workspaceAction }),
]);
export type TurnPart = z.infer<typeof turnPart>;

export const turn = z.object({
  id: z.string(),
  prompt: z.string(),
  /** Files sent with the question (their text is not kept in the stored turn). */
  attachments: z.array(attachmentMeta).optional(),
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
  /**
   * How requests are understood. `offline_rules`: no language model; rules in this browser
   * read the request into a typed intent. `local_llm`: the local model harness (not part of
   * this build). `scripted_demo`: the M5 prepared conversations only.
   */
  mode: z.enum(["scripted_demo", "offline_rules", "local_llm"]),
  /** Whether a language model is connected, said plainly; `unavailable` when the service fails. */
  connection: z.object({ state: z.enum(["connected", "offline", "unavailable"]), detail: z.string() }),
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
    case "action":
      return { ...t, parts: [...t.parts, { type: "action", action: e.action }] };
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
