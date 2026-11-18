import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyEvent, type AgentEvent, type Turn } from "../../lib/contracts/agent";
import { AgentMapButton } from "./AgentMap";
import { mapTurn } from "./agentTree";

afterEach(cleanup);

// Multi-agent turns as a harness that delegates would stream them. Test data only: the demo
// harness reports a single agent.
const T0 = Date.parse("2026-11-18T10:00:00.000Z");
const iso = (s: number) => new Date(T0 + s * 1000).toISOString();
const base: Turn = { id: "t1", prompt: "Why is CHW pump 3 drawing more power?", at: iso(0), parts: [], status: "running" };
const stream = (events: AgentEvent[], from: Turn = base) => events.reduce(applyEvent, from);
const nested: AgentEvent[] = [
  { type: "agent_start", agentId: "root", parentId: null, name: "AI Assistant", task: "Why is CHW pump 3 drawing more power?", at: iso(0) },
  { type: "agent_start", agentId: "data", parentId: "root", name: "Telemetry analyst", task: "Pull pump 3 power and flow", at: iso(1) },
  { type: "agent_start", agentId: "docs", parentId: "root", name: "Manual researcher", at: iso(1) },
  { type: "agent_start", agentId: "curve", parentId: "data", name: "Curve checker", at: iso(2) },
  { type: "tool_call", callId: "c1", tool: "get_equipment", args: { id: "pump_3" }, simulated: true, agentId: "data" },
  { type: "tool_result", callId: "c1", status: "ok", summary: "ok" },
  { type: "agent_end", agentId: "curve", status: "complete", at: iso(4), usage: { input: 1200, output: 300 } },
  { type: "agent_end", agentId: "docs", status: "error", at: iso(3), error: "Knowledge search unavailable" },
];
const second = (id: string, prompt: string): Turn =>
  stream(
    [
      { type: "agent_start", agentId: `${id}-root`, parentId: null, name: "AI Assistant", task: prompt, at: iso(10) },
      { type: "tool_call", callId: `${id}-c`, tool: "list_simulation_runs", args: {}, simulated: true, agentId: `${id}-root` },
      { type: "tool_result", callId: `${id}-c`, status: "ok", summary: "3 runs" },
      { type: "agent_end", agentId: `${id}-root`, status: "complete", at: iso(12) },
      { type: "turn_end", status: "complete" },
    ],
    { id, prompt, at: iso(10), parts: [], status: "running" },
  );

const button = () => screen.getByRole("button", { name: /^Agent map/ });
const open = (turns: Turn[]) => {
  const view = render(<AgentMapButton turns={turns} title="Pump power" />);
  fireEvent.click(button());
  return { view, dialog: screen.getByRole("dialog", { name: "Agent map" }) };
};
const node = (dialog: HTMLElement, key: string) => dialog.querySelector<HTMLElement>(`.agent-map__card[data-node-key="${key}"]`)!;
const card = (dialog: HTMLElement, name: string) => within(dialog).getByText(name, { selector: ".agent-map__name" }).closest("button")!;
const details = (dialog: HTMLElement) => within(dialog).getByRole("complementary", { name: "Agent details" });

describe("agent map in the composer", () => {
  it("is offered once the conversation has a request", () => {
    expect(render(<AgentMapButton turns={[]} />).container.innerHTML).toBe("");
    cleanup();
    render(<AgentMapButton turns={[base]} />);
    expect(button()).toBeTruthy();
  });

  it("counts the current execution's subagents running now: never the root, never ended ones; green only while they run", () => {
    // Root running and one subagent running ("data"); "curve" completed and "docs" failed.
    const view = render(<AgentMapButton turns={[stream(nested)]} />);
    expect(button().getAttribute("aria-label")).toBe("Agent map, 1 subagent running");
    expect(button().dataset.state).toBe("running");
    expect(button().querySelector(".agent-map-button__count")!.textContent).toBe("1");

    // A queued subagent waits: counted apart, a hollow dot, no green.
    const queued = stream([{ type: "agent_end", agentId: "data", status: "complete", at: iso(5) }, { type: "agent_start", agentId: "later", parentId: "root", name: "Report writer", at: iso(5), status: "queued" }], stream(nested));
    view.rerender(<AgentMapButton turns={[queued]} />);
    expect(button().getAttribute("aria-label")).toBe("Agent map, 0 subagents running, 1 queued");
    expect(button().dataset.state).toBe("queued");

    // It starts, then finishes: the count follows, and the dot goes with the last one.
    const started = stream([{ type: "agent_status", agentId: "later", status: "running", at: iso(7) }], queued);
    view.rerender(<AgentMapButton turns={[started]} />);
    expect(button().dataset.state).toBe("running");
    const done = stream([{ type: "agent_end", agentId: "later", status: "complete", at: iso(9) }], started);
    view.rerender(<AgentMapButton turns={[done]} />);
    expect(button().getAttribute("aria-label")).toBe("Agent map, 0 subagents running");
    expect(button().dataset.state).toBe("idle");
    expect(button().querySelector(".agent-map-button__dot")).toBeNull();
    // Its run time counts from when it started running, not from when it was queued.
    expect(done.agents!.find((a) => a.id === "later")).toMatchObject({ startedAt: iso(7), endedAt: iso(9) });
    // An earlier request's agents never count: only the current execution's.
    view.rerender(<AgentMapButton turns={[stream(nested), second("t2", "Check simulation")]} />);
    expect(button().dataset.state).toBe("idle");
  });

  it("takes the conversation's latest execution with agents as the current one", () => {
    const older = { ...stream(nested), id: "old", status: "complete" as const };
    const plain: Turn = { ...base, id: "plain" };
    const latest = { ...stream(nested.slice(0, 1)), id: "new" };
    expect(mapTurn([older, latest, plain])?.id).toBe("new");
    expect(mapTurn([plain])).toBeNull();
  });

  it("draws the request as the task card with its execution's subagents and tools branching to the right", () => {
    const { dialog } = open([stream(nested)]);
    const parentOf = (key: string) => node(dialog, key).dataset.parentKey;
    // The root agent is the task's execution: no separate "AI Assistant" card.
    expect(node(dialog, "task:t1").textContent).toContain("Why is CHW pump 3 drawing more power?");
    expect(dialog.querySelector('[data-node-key="agent:t1:root"]')).toBeNull();
    expect([parentOf("agent:t1:data"), parentOf("agent:t1:docs")]).toEqual(["task:t1", "task:t1"]);
    expect(parentOf("agent:t1:curve")).toBe("agent:t1:data");
    expect(parentOf("tool:t1:c1")).toBe("agent:t1:data"); // under the agent that called it
    const left = (key: string) => parseFloat(node(dialog, key).style.left);
    expect(left("task:t1")).toBeLessThan(left("agent:t1:data"));
    expect(left("agent:t1:data")).toBeLessThan(left("tool:t1:c1"));
    expect(left("agent:t1:curve")).toBe(left("tool:t1:c1"));
    const paths = () => dialog.querySelectorAll(".agent-map__edges path").length;
    expect(paths()).toBe(8); // task: stub, spine, 2 branches; data: the same
    expect(within(dialog).getByText("1 subagent running")).toBeTruthy();
    expect(card(dialog, "Curve checker").textContent).toMatch(/1[.,]5K tokens/); // the viewer's locale
    expect(card(dialog, "Manual researcher").textContent).not.toMatch(/tokens/);

    fireEvent.click(within(dialog).getByRole("button", { name: "Hide the steps under Telemetry analyst" }));
    expect(within(dialog).queryByText("Curve checker")).toBeNull();
    expect(paths()).toBe(4);
    fireEvent.click(within(dialog).getByRole("button", { name: "Show 2 steps under Telemetry analyst" }));
    expect(paths()).toBe(8);
  });

  it("shows details for the task, an agent and a tool call", () => {
    const { dialog } = open([stream(nested)]);
    // The latest request is selected first.
    expect(details(dialog).textContent).toContain("Task 1");
    expect(details(dialog).textContent).toContain("Executed byAI Assistant");
    fireEvent.click(card(dialog, "Manual researcher"));
    expect(details(dialog).textContent).toContain("Failed");
    expect(details(dialog).textContent).toContain("Knowledge search unavailable");
    expect(details(dialog).textContent).toContain("Input tokensNot reported");
    fireEvent.click(within(details(dialog)).getByRole("button", { name: "Why is CHW pump 3 drawing more power?" })); // started by: the task
    expect(details(dialog).textContent).toContain("Task 1");
    fireEvent.click(node(dialog, "tool:t1:c1"));
    expect(details(dialog).textContent).toContain("get_equipment");
    fireEvent.click(within(details(dialog)).getByRole("button", { name: "Telemetry analyst" })); // called by
    expect(details(dialog).textContent).toContain("Pull pump 3 power and flow");
  });

  it("holds each tool call's result, error and reported times (the conversation no longer shows them)", () => {
    const t = stream([
      { type: "agent_start", agentId: "r", parentId: null, name: "AI Assistant", at: iso(0) },
      { type: "tool_call", callId: "ok", tool: "show_on_display", args: { title: "System COP today" }, simulated: false, agentId: "r", at: iso(1) },
      { type: "tool_result", callId: "ok", status: "ok", summary: "Shown on the AI display: System COP today.", at: iso(1.5) },
      { type: "tool_call", callId: "bad", tool: "get_history", args: {}, simulated: true, agentId: "r", at: iso(2) },
      { type: "tool_result", callId: "bad", status: "error", summary: "History service not connected", at: iso(5) },
      { type: "tool_call", callId: "old", tool: "list_issues", args: {}, simulated: true, agentId: "r" }, // times not reported
      { type: "tool_result", callId: "old", status: "ok", summary: "" },
    ], { ...base, prompt: "What's the system COP today?" });
    const { dialog } = open([t]);
    const shown = node(dialog, "tool:t1:ok");
    expect(shown.textContent).toContain("Show on the AI display");
    expect(shown.textContent).toContain("500 ms");
    fireEvent.click(shown);
    expect(details(dialog).textContent).toContain("show_on_display");
    expect(details(dialog).textContent).toContain("ResultShown on the AI display: System COP today.");
    expect(details(dialog).textContent).toContain("Duration500 ms");
    fireEvent.click(node(dialog, "tool:t1:bad"));
    expect(details(dialog).textContent).toContain("Failed");
    expect(details(dialog).textContent).toContain("ErrorHistory service not connected");
    expect(details(dialog).textContent).toContain("Duration3.0 s");
    fireEvent.click(node(dialog, "tool:t1:old"));
    expect(details(dialog).textContent).toContain("DurationNot reported");
  });

  it("keeps every request of the conversation: a new one adds a branch below, the earlier one unchanged", () => {
    const first = stream([...nested, { type: "turn_end", status: "complete" }]);
    const { view, dialog } = open([first]);
    const before = node(dialog, "task:t1").getAttribute("style");
    view.rerender(<AgentMapButton turns={[first, second("t2", "Check simulation")]} />);
    expect(within(dialog).getByText("2 tasks")).toBeTruthy();
    expect(node(dialog, "task:t1").getAttribute("style")).toBe(before);
    expect(node(dialog, "agent:t1:curve")).toBeTruthy();
    const top = (key: string) => parseFloat(node(dialog, key).style.top);
    expect(top("task:t2")).toBeGreaterThan(top("agent:t1:curve"));
    expect(node(dialog, "tool:t2:t2-c").dataset.parentKey).toBe("task:t2");
    expect(node(dialog, "task:t2").textContent).toContain("1 tool");
  });

  it("follows the running request live while open", () => {
    const first = stream(nested.slice(0, 2));
    const { view, dialog } = open([first]);
    expect(within(dialog).getByText("1 subagent running")).toBeTruthy();
    const later = stream([...nested.slice(2), { type: "agent_usage", agentId: "data", usage: { input: 500, output: 20 } }, { type: "agent_end", agentId: "data", status: "complete", at: iso(5) }], first);
    view.rerender(<AgentMapButton turns={[later]} />);
    expect(within(dialog).getByText("Manual researcher")).toBeTruthy();
    expect(card(dialog, "Telemetry analyst").dataset.status).toBe("complete");
    expect(card(dialog, "Telemetry analyst").textContent).toContain("520 tokens");
    expect(within(dialog).queryByText(/subagents? running/)).toBeNull();
  });

  it("closes with its button and with Escape, focus back on the composer's button", () => {
    open([stream(nested)]);
    fireEvent.click(screen.getByRole("button", { name: "Close agent map" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button());
    fireEvent.click(button());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button());
  });
});
