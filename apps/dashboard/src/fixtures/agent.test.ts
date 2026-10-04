import { beforeEach, describe, expect, it } from "vitest";
import { agentEvent, type AgentContext, type AgentEvent } from "../lib/contracts/agent";
import { matchIntent } from "./agentScripts";
import { createFixtureAgent, resetFixtureAgent } from "./fixtureAgent";
import { createFixtureClient } from "./fixtureClient";
import { DAY_START, MINUTE_MS } from "./generate";
import { scenarioById } from "./scenarios";

const at = (h: number, m: number) => new Date(DAY_START + (h * 60 + m) * MINUTE_MS).toISOString();
const ctx = (scenario: string, h: number, m: number, equipmentId: string | null = null): AgentContext => ({
  source: "telemetry",
  configRevision: 1,
  at: at(h, m),
  equipmentId,
  demoScenario: { id: scenario, label: scenarioById(scenario)!.label },
});

async function ask(context: AgentContext, prompt: string, opts = {}) {
  const agent = createFixtureAgent({ delayScale: 0, ...opts });
  const conv = await agent.createConversation(context);
  const events: AgentEvent[] = [];
  for await (const e of agent.sendMessage(conv.id, prompt)) events.push(agentEvent.parse(e));
  const text = events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join("");
  const toolCalls = events.filter((e) => e.type === "tool_call") as Extract<AgentEvent, { type: "tool_call" }>[];
  const results = events.filter((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }>[];
  const views = events.filter((e) => e.type === "view") as Extract<AgentEvent, { type: "view" }>[];
  return { agent, conv, events, text, toolCalls, results, views };
}

beforeEach(() => resetFixtureAgent());

describe("scripted agent harness", () => {
  it("matches prompts to the prepared investigations, preferring the longest equipment label", async () => {
    const site = await createFixtureClient("normal", { latencyMs: 0 }).getSite();
    expect(matchIntent("What needs attention right now?", site)).toEqual({ kind: "attention" });
    expect(matchIntent("Investigate CHW pump 2", site)).toEqual({ kind: "equipment", id: "chilled_water_pump_pri_2" });
    expect(matchIntent("why is cw pump 2 off", site)).toEqual({ kind: "equipment", id: "cooling_water_pump_2" });
    expect(matchIntent("Is the plant meeting cooling demand?", site)).toEqual({ kind: "shortfall" });
    expect(matchIntent("forecast for the next 6 hours", site)).toEqual({ kind: "forecast" });
    expect(matchIntent("How efficient is the plant?", site)).toEqual({ kind: "efficiency" });
    expect(matchIntent("tell me a joke", site)).toEqual({ kind: "fallback" });
  });

  it("streams a well-formed turn: start, paired tool calls and results, one end", async () => {
    const { events, toolCalls, results } = await ask(ctx("tower-fault", 15, 15), "What needs attention right now?");
    expect(events[0].type).toBe("turn_start");
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "complete" });
    expect(events.filter((e) => e.type === "turn_end")).toHaveLength(1);
    expect(toolCalls.map((c) => c.tool)).toEqual(["list_issues", "get_plant_snapshot"]);
    expect(toolCalls.every((c) => c.simulated)).toBe(true);
    expect(results.map((r) => r.callId)).toEqual(toolCalls.map((c) => c.callId));
  });

  it("reports the scenario's actual open issues and links to them", async () => {
    const { text, views } = await ask(ctx("tower-fault", 15, 15), "What needs attention right now?");
    expect(text).toContain("2 open issues");
    expect(text).toContain("Cooling tower 4 fan fault (ISS-0142)");
    const issues = views.find((v) => v.view.kind === "issues");
    expect(issues?.view.kind === "issues" && issues.view.issues.map((i) => i.id)).toEqual(["ISS-0142", "ISS-0143"]);
    expect(views.some((v) => v.view.kind === "link" && v.view.target.type === "monitoring_kpi")).toBe(true);
  });

  it("investigates a faulted item from tool data and reports the unavailable knowledge tool", async () => {
    const { text, results, views } = await ask(ctx("tower-fault", 15, 15, "cooling_towers_4"), "Investigate Cooling tower 4");
    expect(text).toContain("Cooling tower 4 is in fault");
    expect(text).toContain("fan frequency 0.0 Hz");
    expect(text).toContain("Engineering documents could not be searched");
    expect(results.find((r) => r.status === "error")?.summary).toMatch(/knowledge base is not available/);
    expect(views.map((v) => v.view.kind)).toEqual(["equipment", "chart", "issues", "link"]);
  });

  it("states unavailable readings and unconfirmed connections plainly", async () => {
    const { text } = await ask(ctx("sensor-issues", 15, 15), "Investigate CHW pump 3");
    expect(text).toContain("not reporting (no data)");
    expect(text).toContain("frequency unavailable");
    const pump4 = await ask(ctx("normal", 15, 15), "Investigate CHW pump 4");
    expect(pump4.text).toContain("Not recorded: standby pump suction connection is not recorded");
  });

  it("identifies a shortfall with the same numbers as the data", async () => {
    const snap = await createFixtureClient("pump-trip", { latencyMs: 0 }).getSnapshot({ at: at(14, 10) });
    const unmet = Math.round(snap.kpis["plant:unmet_kw"].value!);
    const { text, views } = await ask(ctx("pump-trip", 14, 12), "Is the plant meeting cooling demand?");
    expect(text).toContain(`${unmet} kWt of demand is not being met`);
    expect(text).toContain("Shortfall periods today: 14:05 UTC+8 to now");
    const chart = views.find((v) => v.view.kind === "chart");
    expect(chart?.view.kind === "chart" && chart.view.series.map((s) => s.role)).toEqual(["delivered", "observed", "capacity"]);
  });

  it("describes the forecast as a baseline, and shows nothing when it is unavailable", async () => {
    const ok = await ask(ctx("normal", 15, 15), "What cooling demand is forecast for the next 6 hours?");
    expect(ok.text).toContain("not a trained model");
    expect(ok.views.some((v) => v.view.kind === "link" && v.view.target.type === "prediction" && v.view.target.forecastId)).toBe(true);
    const none = await ask(ctx("new-site", 15, 15), "What cooling demand is forecast for the next 6 hours?");
    expect(none.text).toContain("No forecast is available (INSUFFICIENT_HISTORY)");
    expect(none.views.some((v) => v.view.kind === "chart")).toBe(false);
  });

  it("continues with partial evidence when a data tool fails", async () => {
    const { text, results, events } = await ask(ctx("pump-trip", 14, 12), "Is the plant meeting cooling demand?", { dataFailures: { history: "timeout" } });
    expect(results.find((r) => r.status === "error")?.summary).toMatch(/did not answer in time/);
    expect(text).toContain("Today's history could not be retrieved");
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "complete" });
  });

  it("answers unmatched questions honestly without calling tools", async () => {
    const { text, toolCalls } = await ask(ctx("normal", 15, 15), "tell me a joke");
    expect(toolCalls).toHaveLength(0);
    expect(text).toContain("no language model");
  });

  it("never generates operational recommendations", async () => {
    for (const [c, p] of [
      [ctx("tower-fault", 15, 15), "What needs attention right now?"],
      [ctx("tower-fault", 15, 15), "Investigate Cooling tower 4"],
      [ctx("pump-trip", 14, 12), "Is the plant meeting cooling demand?"],
      [ctx("peak", 15, 15), "How efficient is the plant right now?"],
    ] as const) {
      const { text } = await ask(c, p);
      expect(text).not.toMatch(/\b(should|recommend|suggest|I think|I believe)\b/i);
    }
  });

  it("confirms cancellation through the stream and leaves no tool running", async () => {
    const agent = createFixtureAgent({ delayScale: 0.2 });
    const conv = await agent.createConversation(ctx("tower-fault", 15, 15));
    const events: AgentEvent[] = [];
    for await (const e of agent.sendMessage(conv.id, "Investigate Cooling tower 4")) {
      events.push(e);
      if (e.type === "tool_call" && events.filter((x) => x.type === "tool_call").length === 1) {
        const start = events[0] as Extract<AgentEvent, { type: "turn_start" }>;
        await agent.cancelTurn(conv.id, start.turnId);
      }
    }
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "cancelled" });
    const stored = await agent.getConversation(conv.id);
    expect(stored.turns[0].status).toBe("cancelled");
    expect(stored.turns[0].parts.some((p) => p.type === "tool" && p.status === "running")).toBe(false);
  });

  it("reports an unavailable assistant instead of answering", async () => {
    const agent = createFixtureAgent({ delayScale: 0, unavailable: true });
    const conv = await agent.createConversation(ctx("normal", 15, 15));
    const run = async () => {
      for await (const e of agent.sendMessage(conv.id, "What needs attention right now?")) void e;
    };
    await expect(run()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("keeps three recorded demo conversations with their own scenario context", async () => {
    const list = await createFixtureAgent({ delayScale: 0 }).listConversations();
    expect(list.map((c) => c.context.demoScenario?.id)).toEqual(["tower-fault", "pump-trip", "sensor-issues"]);
    const first = await createFixtureAgent({ delayScale: 0 }).getConversation(list[0].id);
    expect(first.turns[0].status).toBe("complete");
  });
});
