import { beforeEach, describe, expect, it } from "vitest";
import type { DisplayItem } from "../lib/contracts/display";
import { agentEvent, type AgentContext, type AgentEvent, type AttachmentInput, type WorkspaceAction } from "../lib/contracts/agent";
import { pilotReader, simulationReader } from "../lib/api/simulation";
import type { RunConfig } from "../lib/contracts/simulation";
import { createFixtureAgent, paceText, resetFixtureAgent, type AgentFixtureOptions } from "./fixtureAgent";
import { createSimulationService } from "./simulationService";
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

async function ask(context: AgentContext, prompt: string, opts: AgentFixtureOptions = {}, attachments: AttachmentInput[] = []) {
  const agent = createFixtureAgent({ delayScale: 0, ...opts });
  const conv = await agent.createConversation(context);
  const events: AgentEvent[] = [];
  for await (const e of agent.sendMessage(conv.id, { prompt, attachments })) events.push(agentEvent.parse(e));
  const text = events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join("");
  const toolCalls = events.filter((e) => e.type === "tool_call") as Extract<AgentEvent, { type: "tool_call" }>[];
  const results = events.filter((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }>[];
  const views = events.filter((e) => e.type === "view") as Extract<AgentEvent, { type: "view" }>[];
  const actions = (events.filter((e) => e.type === "action") as Extract<AgentEvent, { type: "action" }>[]).map((e) => e.action);
  const displays = (events.filter((e) => e.type === "display") as Extract<AgentEvent, { type: "display" }>[]).map((e) => e.item);
  return { agent, conv, events, text, toolCalls, results, views, actions, displays };
}
const message = (prompt: string) => ({ prompt, attachments: [] });

/** Several questions in one conversation: follow-ups lean on the earlier ones. */
async function converse(context: AgentContext, prompts: string[], opts: AgentFixtureOptions = {}) {
  const agent = createFixtureAgent({ delayScale: 0, ...opts });
  const conv = await agent.createConversation(context);
  const turns: { text: string; actions: WorkspaceAction[]; displays: DisplayItem[] }[] = [];
  for (const prompt of prompts) {
    const events: AgentEvent[] = [];
    for await (const e of agent.sendMessage(conv.id, message(prompt))) events.push(agentEvent.parse(e));
    turns.push({
      text: events.filter((e) => e.type === "text_delta").map((e) => (e as { text: string }).text).join(""),
      actions: (events.filter((e) => e.type === "action") as Extract<AgentEvent, { type: "action" }>[]).map((e) => e.action),
      displays: (events.filter((e) => e.type === "display") as Extract<AgentEvent, { type: "display" }>[]).map((e) => e.item),
    });
  }
  return turns;
}

beforeEach(() => resetFixtureAgent());

describe("offline agent harness", () => {
  it("says plainly that no language model is connected, or that the assistant is unavailable", async () => {
    const offline = await createFixtureAgent({ delayScale: 0 }).getCapabilities();
    expect(offline).toMatchObject({ mode: "offline_rules", model: null, connection: { state: "offline" } });
    expect(offline.connection.detail).toMatch(/No language model is connected/);
    const down = await createFixtureAgent({ delayScale: 0, unavailable: true }).getCapabilities();
    expect(down.connection.state).toBe("unavailable");
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
    expect(text).toContain("Two issues are open at 15:15 UTC+8, one of them critical.");
    expect(text).toContain("- Cooling tower 4 fan fault (ISS-0142) is critical, first seen at 13:20 UTC+8");
    const issues = views.find((v) => v.view.kind === "issues");
    expect(issues?.view.kind === "issues" && issues.view.issues.map((i) => i.id)).toEqual(["ISS-0142", "ISS-0143"]);
    expect(views.some((v) => v.view.kind === "link" && v.view.target.type === "monitoring_kpi")).toBe(true);
  });

  it("investigates a faulted item from tool data and reports the unavailable knowledge tool", async () => {
    const { text, results, views } = await ask(ctx("tower-fault", 15, 15, "cooling_towers_4"), "Investigate Cooling tower 4");
    expect(text).toContain("Cooling tower 4 is in fault");
    expect(text).toContain("| Fan frequency | 0.0 Hz |");
    expect(text).toContain("The engineering documents could not be searched");
    expect(results.find((r) => r.status === "error")?.summary).toMatch(/knowledge base is not available/);
    expect(views.map((v) => v.view.kind)).toEqual(["equipment", "issues", "link"]);
  });

  it("states unavailable readings and unconfirmed connections plainly", async () => {
    const { text } = await ask(ctx("sensor-issues", 15, 15), "Investigate CHW pump 3");
    expect(text).toContain("not reporting (no data)");
    expect(text).toContain("None of its readings (frequency, electrical power and flow) are available.");
    const pump4 = await ask(ctx("normal", 15, 15), "Investigate CHW pump 4");
    expect(pump4.text).toContain("Not recorded: standby pump suction connection is not recorded");
  });

  it("identifies a shortfall with the same numbers as the data", async () => {
    const snap = await createFixtureClient("pump-trip", { latencyMs: 0 }).getSnapshot({ at: at(14, 10) });
    const unmet = Math.round(snap.kpis["plant:unmet_kw"].value!);
    const { text, views } = await ask(ctx("pump-trip", 14, 12), "Is the plant meeting cooling demand?");
    expect(text).toContain(`${unmet} kWt of demand is not being met`);
    expect(text).toContain("The shortfall began at 14:05 UTC+8 and is still going on");
    // The day's demand and delivery go to the AI display; no other screen is opened and the
    // chat draws no chart.
    const { actions, displays, toolCalls } = await ask(ctx("pump-trip", 14, 12), "Is the plant meeting cooling demand?");
    expect(actions).toEqual([]);
    expect(displays.map((d) => d.title)).toEqual(["Cooling demand and delivery today"]);
    expect(displays[0].content.kind).toBe("line");
    expect(displays[0].source).toEqual({ kind: "assistant", conversationId: expect.any(String), demo: true });
    expect(toolCalls.find((c) => c.tool === "show_on_display")).toMatchObject({ simulated: false, args: { kind: "line" } });
    expect(views.some((v) => v.view.kind === "chart" as never)).toBe(false);
    // The trend page stays a link.
    const met = await ask(ctx("normal", 15, 15), "Is the plant meeting cooling demand?");
    expect(met.actions).toEqual([]);
    expect(met.views.some((v) => v.view.kind === "link" && v.view.target.type === "metric")).toBe(true);
  });

  it("describes the forecast as a baseline, and shows nothing when it is unavailable", async () => {
    const ok = await ask(ctx("normal", 15, 15), "What cooling demand is forecast for the next 6 hours?");
    expect(ok.text).toContain("not a trained model");
    // Observed and forecast demand go to the AI display; the prediction page is a link.
    expect(ok.actions).toEqual([]);
    expect(ok.displays).toHaveLength(1);
    const shown = ok.displays[0].content;
    expect(shown.kind === "line" && shown.series.map((x) => [x.label, Boolean(x.dashed)])).toEqual([
      ["Observed demand", false],
      ["Forecast demand", true],
    ]);
    expect(ok.views.some((v) => v.view.kind === "link" && v.view.target.type === "prediction" && v.view.target.forecastId?.startsWith("fc-normal-"))).toBe(true);
    const none = await ask(ctx("new-site", 15, 15), "What cooling demand is forecast for the next 6 hours?");
    expect(none.text).toContain("No forecast is available (INSUFFICIENT_HISTORY)");
    expect(none.displays).toEqual([]);
    expect(none.views.some((v) => v.view.kind === "link" && v.view.target.type === "prediction" && v.view.target.forecastId)).toBe(false);
  });

  it("shapes each answer to its content: short, paragraphs, a list or a table only where they help", async () => {
    const blocks = (text: string) => text.split("\n\n");
    const short = await ask(ctx("normal", 15, 15), "How efficient is the plant right now?");
    expect(blocks(short.text)).toHaveLength(1);
    expect(short.text).not.toMatch(/^- |\|/m);
    expect(short.text).toContain("Chiller 1 and Chiller 2 are the largest loads, at 90.2 kW each");
    const met = await ask(ctx("normal", 15, 15), "Is the plant meeting cooling demand?");
    expect(blocks(met.text)).toHaveLength(1);
    expect(met.text).toMatch(/^The plant is meeting cooling demand/);
    const quiet = await ask(ctx("normal", 15, 15), "What needs attention right now?");
    expect(quiet.text).toMatch(/^Nothing needs attention at 15:15 UTC\+8: no issues are open\./);
    // Several separate issues are listed; several readings side by side are tabled.
    const many = await ask(ctx("sensor-issues", 15, 15), "What needs attention right now?");
    expect(many.text.match(/^- /gm)).toHaveLength(3);
    const chiller = await ask(ctx("normal", 15, 15), "Investigate Chiller 2");
    expect(chiller.text).toContain("| Reading | Value |\n| --- | --: |\n| Load | 79 % |");
    expect(chiller.text).not.toMatch(/^- /m);
    const forecast = await ask(ctx("normal", 15, 15), "What cooling demand is forecast for the next 6 hours?");
    expect(blocks(forecast.text)).toHaveLength(2);
    expect(forecast.text).not.toMatch(/^- |\|/m);
  });

  it("continues with partial evidence when a data tool fails", async () => {
    const { text, results, events } = await ask(ctx("pump-trip", 14, 12), "Is the plant meeting cooling demand?", { dataFailures: { history: "timeout" } });
    expect(results.find((r) => r.status === "error")?.summary).toMatch(/did not answer in time/);
    expect(text).toContain("Today's history could not be retrieved");
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "complete" });
  });

  it("answers a single value or a quick check in the conversation, opening nothing", async () => {
    for (const p of ["What needs attention right now?", "Is the plant meeting cooling demand?", "How efficient is the plant right now?", "What's the COP now?", "What's the COP?"]) {
      expect((await ask(ctx("normal", 15, 15), p)).actions, p).toEqual([]);
    }
    const value = await ask(ctx("normal", 15, 15), "What's the COP now?");
    expect(value.text).toMatch(/^System COP is \d/);
    expect(value.views.some((v) => v.view.kind === "link" && v.view.target.type === "metric")).toBe(true);
  });

  it("shows what it is asked to show on the AI display, and sums it up", async () => {
    for (const p of ["Show me COP today", "how is our COP doing?", "let me see COP performance", "COP trend", "visualize the coefficient of performance"]) {
      const { actions, displays, text } = await ask(ctx("normal", 15, 15), p);
      expect(actions, p).toEqual([]);
      expect(displays.map((d) => [d.title, d.content.kind]), p).toEqual([["System COP today", "line"]]);
      expect(text, p).toMatch(/^System COP is .* Since the start of the day it has ranged from .* averaging /);
    }
    const chiller = await ask(ctx("normal", 15, 15), "open Chiller 2");
    expect(chiller.actions).toEqual([{ kind: "open", target: { type: "equipment_page", id: "chiller_plant_2" }, label: "Chiller 2 record" }]);
    expect(chiller.text).toMatch(/^Chiller 2 is running at 15:15 UTC\+8\./);
  });

  it("shows the data a question needs, without being asked to show it", async () => {
    const how = await ask(ctx("normal", 15, 15), "How has COP been today?");
    expect(how.actions).toEqual([]);
    expect(how.displays.map((d) => d.title)).toEqual(["System COP today"]);
    const what = await ask(ctx("normal", 15, 15), "What is happening with Chiller 2?");
    expect(what.text).toMatch(/^Chiller 2 is running at 15:15 UTC\+8/);
    expect(what.actions).toEqual([{ kind: "open", target: { type: "equipment_page", id: "chiller_plant_2" }, label: "Chiller 2 record" }]);
    // Asked from Chiller 2's own Details, its record is not opened over them.
    const fromDetails = await ask(ctx("normal", 15, 15, "chiller_plant_2"), "What is happening with Chiller 2?");
    expect(fromDetails.actions).toEqual([]);
    expect(fromDetails.views.some((v) => v.view.kind === "link" && v.view.target.type === "equipment_page")).toBe(true);
    const last = await ask(ctx("normal", 15, 15), "COP over the last 6 hours");
    expect(last.displays.map((d) => d.title)).toEqual(["System COP, the last 6 hours"]);
    expect(last.text).toMatch(/Over the last 6 hours it has ranged from /);
  });

  it("reads follow-ups against the conversation, and fails safely when it cannot", async () => {
    const [cop, six, power, yesterday] = await converse(ctx("normal", 15, 15), ["Show me COP today", "What about the last 6 hours?", "And power?", "How about yesterday?"]);
    expect(cop.displays.map((d) => d.title)).toEqual(["System COP today"]);
    expect(six.displays.map((d) => d.title)).toEqual(["System COP, the last 6 hours"]);
    expect(power.displays[0].title).toMatch(/power, the last 6 hours$/i);
    expect(yesterday.actions).toEqual([]);
    expect(yesterday.displays).toEqual([]);
    expect(yesterday.text).toMatch(/^The demo data holds one synthetic day, so there is nothing for yesterday/);

    const [, history] = await converse(ctx("tower-fault", 15, 15), ["What is happening with Cooling tower 4?", "Show me its history."]);
    expect(history.text).toMatch(/^Cooling tower 4 today: its fan frequency ranged from/);
    expect(history.text).toContain("Cooling tower 4 fan fault (ISS-0142, open)");
    expect(history.actions).toEqual([{ kind: "open", target: { type: "equipment_page", id: "cooling_towers_4" }, label: "Cooling tower 4 record" }]);

    const [alone] = await converse(ctx("normal", 15, 15), ["Show me its history."]);
    expect(alone.actions).toEqual([]);
    expect(alone.text).toMatch(/^I can't tell what “its” refers to here/);
  });

  it("reports faults over the period asked for", async () => {
    const day = await ask(ctx("tower-fault", 15, 15), "Was anything broken in the last 24 hours?");
    expect(day.text).toMatch(/^Two issues were detected or still present in the last 24 hours/);
    const hour = await ask(ctx("tower-fault", 15, 15), "any faults in the last hour?");
    expect(hour.text).toMatch(/in the last hour \(since 14:15 UTC\+8\)/);
    const yesterday = await ask(ctx("tower-fault", 15, 15), "anything broken yesterday?");
    expect(yesterday.toolCalls).toEqual([]);
    expect(yesterday.text).toMatch(/nothing for yesterday/);
  });

  it("names attached files it did not use, and describes the ones it was asked about", async () => {
    const csv: AttachmentInput = { name: "log.csv", type: "text/csv", size: 64, text: "time,cop,power_kw\n10:00,4.5,300\n10:15,4.7,310\n10:30,4.9,320" };
    const read = await ask(ctx("normal", 15, 15), "summarize this file", {}, [csv]);
    expect(read.toolCalls).toHaveLength(0);
    expect(read.text).toContain("log.csv (64 B): It is a table of 3 rows and 3 columns: time, cop and power_kw.");
    expect(read.text).toContain("cop from 4.50 to 4.90 (mean 4.70)");
    expect(read.text).toContain("no language model connected");
    const stored = (await read.agent.getConversation(read.conv.id)).turns[0];
    expect(stored.attachments).toEqual([{ name: "log.csv", type: "text/csv", size: 64 }]); // the text is not kept
    const other = await ask(ctx("normal", 15, 15), "Is the plant meeting cooling demand?", {}, [csv]);
    expect(other.text).toContain("log.csv was attached but not used");
    // A file alone is a question about the file.
    expect((await ask(ctx("normal", 15, 15), "", {}, [csv])).text).toContain("I read the attached file.");
  });

  it("refuses a message with neither a question nor a file, and files beyond the limits", async () => {
    const agent = createFixtureAgent({ delayScale: 0 });
    const conv = await agent.createConversation(ctx("normal", 15, 15));
    const send = async (m: unknown) => {
      for await (const e of agent.sendMessage(conv.id, m as never)) void e;
    };
    await expect(send({ prompt: "  ", attachments: [] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(send({ prompt: 3 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    const file = { name: "a.txt", type: "text/plain", size: 1, text: "a" };
    await expect(send({ prompt: "x", attachments: [file, file, file, file] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
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

  it("never applies an action after Stop: a turn cancelled before its view opens emits none", async () => {
    const agent = createFixtureAgent({ delayScale: 1 });
    const conv = await agent.createConversation(ctx("normal", 15, 15));
    const events: AgentEvent[] = [];
    let turnId = "";
    for await (const e of agent.sendMessage(conv.id, message("Show me COP today"))) {
      events.push(e);
      if (e.type === "turn_start") turnId = e.turnId;
      if (e.type === "tool_call" && events.filter((x) => x.type === "tool_call").length === 1) void agent.cancelTurn(conv.id, turnId);
    }
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "cancelled" });
    expect(events.some((e) => e.type === "action")).toBe(false);
    expect((await agent.getConversation(conv.id)).turns[0].parts.some((p) => p.type === "action")).toBe(false);
  });

  it("confirms cancellation through the stream and leaves no tool running", async () => {
    const agent = createFixtureAgent({ delayScale: 0.2 });
    const conv = await agent.createConversation(ctx("tower-fault", 15, 15));
    const events: AgentEvent[] = [];
    for await (const e of agent.sendMessage(conv.id, message("Investigate Cooling tower 4"))) {
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
      for await (const e of agent.sendMessage(conv.id, message("What needs attention right now?"))) void e;
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

describe("simulated pacing", () => {
  // A seeded generator, so the pieces are the same on every run.
  const seeded = (seed = 7) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  // A constant 0.5 gives two-word pieces and the base timings exactly.
  const even = () => 0.5;
  const text =
    "Cooling tower 4 is in fault, and one issue names it. It was first seen at 13:20.\n\nIts readings:\n\n| Reading | Value |\n| --- | --: |\n| Fan frequency | 0.0 Hz |\n\n1. First\n2. Second";

  it("streams pieces that join to exactly the answer, one to three words each, never across a line", () => {
    const pieces = paceText(text, seeded());
    expect(pieces.map((p) => p.text).join("")).toBe(text);
    for (const p of pieces) {
      expect(p.text.trim().split(/\s+/).length).toBeLessThanOrEqual(3);
      expect(p.text.trimEnd()).not.toContain("\n");
    }
  });

  it("never paces evenly", () => {
    const ms = paceText(text, seeded()).map((p) => p.ms);
    expect(new Set(ms).size).toBeGreaterThan(ms.length / 2);
  });

  it("pauses a little after a clause, more after a sentence, most after a paragraph", () => {
    const ms = (s: string) => paceText(s, even)[0].ms;
    const plain = ms("one two three");
    const clause = ms("one, two");
    const sentence = ms("one two. Three");
    const line = ms("one two\n- three");
    const paragraph = ms("one two.\n\nThree");
    expect(plain).toBeLessThan(clause);
    expect(clause).toBeLessThan(sentence);
    expect(line).toBeLessThan(paragraph);
    expect(sentence).toBeLessThan(paragraph);
    // A list number is not a sentence end.
    expect(paceText("1. First", even).map((p) => p.text)).toEqual(["1. First"]);
    expect(paceText("1. First", () => 0.1)[0]).toMatchObject({ text: "1. " });
    expect(paceText("1. First", () => 0.1)[0].ms).toBeLessThan(paceText("One. Two", () => 0.1)[0].ms);
  });
});

describe("stopping, and the assistant's boundary with simulation", () => {
  it("stops a streaming answer at once: nothing more is written and the end is confirmed promptly", async () => {
    const agent = createFixtureAgent({ delayScale: 1 }); // the full demonstration pace
    const conv = await agent.createConversation(ctx("tower-fault", 15, 15));
    const events: AgentEvent[] = [];
    let stoppedAt = 0;
    let endedAt = 0;
    let written = 0;
    for await (const e of agent.sendMessage(conv.id, message("What needs attention right now?"))) {
      events.push(e);
      if (e.type === "text_delta" && stoppedAt) written++;
      if (e.type === "turn_end") endedAt = performance.now();
      if (!stoppedAt && events.filter((x) => x.type === "text_delta").length === 3) {
        stoppedAt = performance.now();
        void agent.cancelTurn(conv.id, (events[0] as Extract<AgentEvent, { type: "turn_start" }>).turnId);
      }
    }
    expect(events.at(-1)).toMatchObject({ type: "turn_end", status: "cancelled" });
    expect(written).toBeLessThanOrEqual(1); // at most a piece already on its way
    expect(endedAt - stoppedAt).toBeLessThan(120); // not after the next scripted pause
    const stored = (await agent.getConversation(conv.id)).turns[0];
    expect(stored.status).toBe("cancelled");
  });

  it("stops during a tool step without waiting for the step's scripted pause", async () => {
    const agent = createFixtureAgent({ delayScale: 1 });
    const conv = await agent.createConversation(ctx("tower-fault", 15, 15));
    let stoppedAt = 0;
    let endedAt = 0;
    let turnId = "";
    for await (const e of agent.sendMessage(conv.id, message("Investigate Cooling tower 4"))) {
      if (e.type === "turn_start") turnId = e.turnId;
      if (e.type === "turn_end") endedAt = performance.now();
      if (e.type === "tool_call" && !stoppedAt) {
        stoppedAt = performance.now();
        void agent.cancelTurn(conv.id, turnId);
      }
    }
    expect(endedAt - stoppedAt).toBeLessThan(120); // a tool step is paced at 0.36 to 0.6 s
  });

  it("gives the assistant reading tools only, and the simulation and pilot through read-only facades (F10)", async () => {
    const caps = await createFixtureAgent({ delayScale: 0 }).getCapabilities();
    expect(caps.tools.map((t) => t.name)).toEqual([
      "get_plant_snapshot",
      "list_issues",
      "get_equipment",
      "get_history",
      "get_forecast",
      "search_knowledge",
      "list_simulation_runs",
      "get_simulation_run",
      "get_run_summary",
      "get_pilot_findings",
      "show_on_display",
    ]);
    expect(caps.tools.filter((t) => /correct|override|setpoint|release|start|stop|pause|resume|step|apply|monitor|create|command|submit/i.test(t.name))).toEqual([]);
    const { simulation, pilot } = createSimulationService({ pace: 0, storage: null });
    expect(Object.keys(simulationReader(simulation)).sort()).toEqual(["getCapabilities", "getRun", "listRuns"]);
    expect(Object.keys(pilotReader(pilot)).sort()).toEqual(["getRunSummary", "getState", "listRunSummaries"]);
  });
});

describe("the simulation and the pilot, read only", () => {
  const NORMAL: RunConfig = { scenarioId: "normal", startMinute: 12 * 60, durationHours: 1, stepMinutes: 15, chwSetpointC: 7 };
  const settle = () => new Promise((r) => setTimeout(r, 5));

  /** Two matched, monitored runs that ended, and a third still running. */
  async function history() {
    const service = createSimulationService({ pace: 0, storage: null });
    const { simulation, pilot } = service;
    for (const id of ["a", "b"]) {
      const { runId } = await simulation.createRun(NORMAL, id);
      await simulation.command(runId, "start");
      await pilot.setMonitoring(runId, true);
      for (let i = 0; i < 4; i++) await simulation.command(runId, "step");
      await settle();
    }
    const live = await simulation.createRun({ ...NORMAL, durationHours: 3 }, "c");
    await simulation.command(live.runId, "start");
    await pilot.setMonitoring(live.runId, true);
    const opts: AgentFixtureOptions = { simulation: simulationReader(simulation), pilot: pilotReader(pilot) };
    const run = (prompt: string) => ask(ctx("normal", 15, 15), prompt, opts);
    return { service, run, liveId: live.runId };
  }

  it("lists the history and opens it", async () => {
    const { run } = await history();
    for (const p of ["tell me our simulation history", "what simulations have we run?", "list the runs"]) {
      const r = await run(p);
      expect(r.actions, p).toEqual([{ kind: "open", target: { type: "simulation" }, label: "Simulation history" }]);
      expect(r.toolCalls.map((c) => c.tool)).toEqual(["list_simulation_runs"]);
      expect(r.text).toMatch(/^Three simulation runs are recorded; RUN-0003 is still active\./);
      expect(r.text).toContain("- RUN-0001, Normal operation: stopped");
    }
  });

  it("summarises an ended run from its recorded summary and opens its replay; a live one is in AI Pilot", async () => {
    const { run } = await history();
    const named = await run("open RUN-0001");
    expect(named.actions).toEqual([{ kind: "open", target: { type: "simulation", runId: "RUN-0001" }, label: "RUN-0001 summary and replay" }]);
    expect(named.text).toMatch(/^RUN-0001 \(Normal operation\) completed after 60 of 60 simulated minutes\. Average COP \d/);
    expect(named.text).toContain("The pilot found");
    const last = await run("How did the last simulation go?");
    expect(last.actions[0]).toEqual(expect.objectContaining({ target: { type: "simulation", runId: "RUN-0002" } }));
    const shown = await run("Show me the last simulation.");
    expect(shown.actions).toEqual([{ kind: "open", target: { type: "simulation", runId: "RUN-0002" }, label: "RUN-0002 summary and replay" }]);
    const missing = await run("open run 99");
    expect(missing.actions).toEqual([]);
    expect(missing.text).toBe("There is no RUN-0099 in the simulation history; the latest run is RUN-0003.");
    const live = await run("show me the current simulation");
    expect(live.actions[0]).toEqual(expect.objectContaining({ target: { type: "pilot", runId: "RUN-0003", view: "live" } }));
  });

  it("compares the latest two runs when they are matched, and says why when they are not", async () => {
    const { run, service, liveId } = await history();
    // RUN-0003 has no results yet, so the latest two with results are the matched pair.
    const latest = await run("compare the latest two simulations");
    expect(latest.actions).toEqual([{ kind: "open", target: { type: "simulation", runId: "RUN-0002", compareWith: "RUN-0001" }, label: "RUN-0002 compared with RUN-0001" }]);
    expect(latest.text).toContain("| Average COP |");
    expect(latest.text).toMatch(/RUN-0002 used [\d,]+ kWh \([\d.]+ %\) (less|more) electrical energy than RUN-0001 over the same simulated time\./);
    // Once RUN-0003 has a step, it is the latest, and it ran for a different duration.
    await service.simulation.command(liveId, "step");
    const unmatched = await run("compare the last 2 runs");
    expect(unmatched.actions).toEqual([]);
    expect(unmatched.text).toMatch(/^RUN-0003 and RUN-0002 are not matched: they differ in duration, so their results are not compared\.$/);
    expect(unmatched.views.at(-1)?.view).toMatchObject({ kind: "link", target: { type: "simulation" } });
    const named = await run("RUN-0001 vs RUN-0002");
    expect(named.actions[0]).toEqual(expect.objectContaining({ target: { type: "simulation", runId: "RUN-0001", compareWith: "RUN-0002" } }));
  });

  it("reports the pilot's findings: a live run's in AI Pilot, an ended run's issue in its replay", async () => {
    const { run, service } = await history();
    const issues = (await service.pilot.getState("RUN-0001")).issues;
    expect(issues.length).toBeGreaterThan(0);
    const findings = await run("what did the pilot find?");
    expect(findings.actions[0]).toEqual(expect.objectContaining({ target: { type: "pilot", runId: "RUN-0003", view: "findings" } }));
    const issue = await run(`inspect ${issues[0].id}`);
    expect(issue.actions).toEqual([{ kind: "open", target: { type: "simulation", runId: "RUN-0001", issueId: issues[0].id }, label: `${issues[0].id} in the RUN-0001 replay` }]);
    expect(issue.text.startsWith(`${issues[0].id}, ${issues[0].title}, is `)).toBe(true);
  });

  it("declines every request to control the simulation, a proposal or equipment, and changes nothing (F10)", async () => {
    const { run, service, liveId } = await history();
    const before = await service.simulation.getRun(liveId);
    const pilotBefore = await service.pilot.getState(liveId);
    const READ_ONLY = new Set(["list_simulation_runs", "get_simulation_run", "get_run_summary", "get_pilot_findings"]);
    for (const p of [
      "stop the simulation",
      "Can you pause RUN-0003?",
      "please start a new simulation",
      "resume",
      "step the run",
      "run the heat wave scenario",
      "pause monitoring",
      "apply PIL-0003-1",
      "apply the pilot's proposal",
      "set chiller 1 setpoint to 9",
      "raise the chilled water temperature on chiller 2",
      "release the override",
      "turn off CW pump 2",
    ]) {
      const r = await run(p);
      // It may read (to point to the right control); it never changes anything.
      expect(r.toolCalls.filter((c) => !READ_ONLY.has(c.tool)), p).toEqual([]);
      expect(r.actions.filter((a) => a.kind !== "reveal"), p).toEqual([]);
      expect(r.text, p).toMatch(/^I can't /);
    }
    const after = await service.simulation.getRun(liveId);
    expect(after.state).toBe(before.state);
    expect(after.stepsTaken).toBe(before.stepsTaken);
    expect(after.corrections).toEqual(before.corrections);
    expect((await service.pilot.getState(liveId)).monitoring).toBe(pilotBefore.monitoring);
  });

  it("points to the operator's control in AI Pilot, and only one that applies now", async () => {
    const { run } = await history();
    const stop = await run("stop the simulation");
    expect(stop.actions).toEqual([{ kind: "reveal", control: "stop", label: "Stop simulation for RUN-0003", runId: "RUN-0003" }]);
    expect(stop.text).toBe("I can't stop RUN-0003; only you can, in AI Pilot. Stop simulation is outlined there for you.");
    expect((await run("resume")).actions).toMatchObject([{ kind: "reveal", control: "resume", runId: "RUN-0003" }]);
    // RUN-0003 is paused: Pause is not offered, so nothing is pointed to.
    const pause = await run("Can you pause RUN-0003?");
    expect(pause.actions).toEqual([]);
    expect(pause.text).toContain("it is paused, so that control is not offered now");
    expect((await run("please start a new simulation")).actions).toEqual([{ kind: "reveal", control: "start", label: "Start simulation" }]);
    expect((await run("set chiller 1 setpoint to 9")).actions).toMatchObject([{ kind: "reveal", control: "corrections", runId: "RUN-0003" }]);
    // There is no equipment control anywhere: nothing to point to.
    const pump = await run("turn off CW pump 2");
    expect(pump.actions).toEqual([]);
    expect(pump.toolCalls).toEqual([]);
  });

  it("with no simulation running, says so and points to nothing but the set-up", async () => {
    const service = createSimulationService({ pace: 0, storage: null });
    const opts: AgentFixtureOptions = { simulation: simulationReader(service.simulation), pilot: pilotReader(service.pilot) };
    const stop = await ask(ctx("normal", 15, 15), "stop the simulation", opts);
    expect(stop.actions).toEqual([]);
    expect(stop.text).toMatch(/no simulation is running now/);
  });

  it("does not read questions about a run's end as control", async () => {
    const { run } = await history();
    for (const p of ["when did the simulation end?", "how did the last run end?", "why did RUN-0001 stop?"]) {
      expect((await run(p)).text, p).not.toMatch(/^I can't/);
    }
  });
});
