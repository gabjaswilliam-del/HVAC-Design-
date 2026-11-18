import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { turn as turnSchema, type AgentContext, type Turn, type TurnPart } from "../../lib/contracts/agent";
import type { SiteBundle } from "../../lib/contracts";
import { TurnView } from "./TurnView";

afterEach(cleanup);

// Only what an answer's header and its text read; the views are not part of these turns.
const site = { site: { timezone: "UTC", timezoneLabel: "UTC" }, topology: { devices: [] } } as unknown as SiteBundle;
const context = {} as AgentContext;
const LONG = "Row ".repeat(400).trim();
const tool = (callId: string, name: string, status: "running" | "ok" | "error", summary: string | null): TurnPart => ({
  type: "tool", callId, tool: name, args: { id: "chiller_1" }, simulated: true, status, summary, agentId: "root",
});
const show = (t: Turn) =>
  render(
    <MemoryRouter>
      <TurnView turn={t} site={site} context={context} />
    </MemoryRouter>,
  ).container;

describe("an answer in the conversation", () => {
  it("shows the question and the answer, never the tool calls behind it", () => {
    const t: Turn = {
      id: "t1", prompt: "What's the system COP today?", at: "2026-11-18T10:00:00.000Z", status: "complete",
      parts: [
        tool("a", "get_plant_snapshot", "ok", "Chiller 1 power 88 kW"),
        tool("b", "get_history", "error", "History service not connected"),
        tool("c", "list_issues", "ok", LONG),
        tool("d", "get_forecast", "ok", ""),
        { type: "text", text: "The current system COP is 4.7." },
        tool("e", "show_on_display", "ok", "Shown on the AI display: System COP today."),
      ],
    };
    const el = show(t);
    expect(el.textContent).toContain("What's the system COP today?");
    expect(el.querySelector(".agent-prose")!.textContent).toContain("The current system COP is 4.7.");
    // No disclosure, names, statuses, summaries or empty containers where the calls were.
    expect(el.querySelector("[data-tool], .agent-activity, .agent-tool")).toBeNull();
    for (const gone of ["Used", "get_plant_snapshot", "show_on_display", "Check plant data", "Complete", "Failed", "88 kW", "not connected", "Row Row", "Shown on the AI display"]) {
      expect(el.textContent).not.toContain(gone);
    }
    expect(el.querySelector(".agent-turn__answer")!.children).toHaveLength(2); // its header and the answer
  });

  it("keeps a quiet working line while a tool runs, and no line once the answer streams", () => {
    const running: Turn = { id: "t2", prompt: "Check simulation.", at: "2026-11-18T10:00:00.000Z", status: "running", parts: [tool("a", "list_simulation_runs", "running", null)] };
    let el = show(running);
    expect(el.querySelector(".agent-working")!.textContent).toBe("Working");
    expect(el.textContent).not.toContain("simulation runs");
    cleanup();
    el = show({ ...running, parts: [...running.parts, { type: "text", text: "Three runs" }] });
    expect(el.querySelector(".agent-working")).toBeNull();
    expect(el.querySelector(".agent-caret")).not.toBeNull();
  });

  it("renders a stored conversation's turn the same way, with its tool records kept", () => {
    const stored = turnSchema.parse({
      id: "t3", prompt: "Investigate CHW pump 3", at: "2026-11-18T09:00:00.000Z", status: "complete",
      parts: [tool("a", "get_equipment", "ok", "CHW pump 3: 42 kW"), { type: "text", text: "Pump 3 draws more power than its curve." }],
    });
    expect(stored.parts.filter((p) => p.type === "tool")).toHaveLength(1); // the record stays
    const el = show(stored);
    expect(el.textContent).toContain("Pump 3 draws more power than its curve.");
    expect(el.textContent).not.toContain("42 kW");
  });
});
