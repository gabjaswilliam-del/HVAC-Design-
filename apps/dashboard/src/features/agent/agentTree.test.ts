import { describe, expect, it } from "vitest";
import { applyEvent, type AgentRun, type Turn } from "../../lib/contracts/agent";
import { agentTree, durationMs, formatDuration } from "./agentTree";

const run = (id: string, parentId: string | null, extra: Partial<AgentRun> = {}): AgentRun => ({
  id, parentId, name: id, status: "complete", startedAt: "2026-11-18T10:00:00.000Z", endedAt: "2026-11-18T10:00:02.500Z", ...extra,
});

describe("agent tree", () => {
  it("nests agents by their reported parent only, keeping start order", () => {
    const [root] = agentTree([run("root", null), run("a", "root"), run("b", "root"), run("a1", "a"), run("a2", "a")]);
    expect(root.run.id).toBe("root");
    expect(root.children.map((c) => c.run.id)).toEqual(["a", "b"]);
    expect(root.children[0].children.map((c) => c.run.id)).toEqual(["a1", "a2"]);
    expect(root.descendants).toBe(4);
  });

  it("puts an agent with an unreported parent, or in a cycle, at the top level and marks it", () => {
    const roots = agentTree([run("root", null), run("lost", "elsewhere"), run("x", "y"), run("y", "x")]);
    expect(roots.map((r) => [r.run.id, r.orphan])).toEqual([["root", false], ["lost", true], ["x", true]]);
    expect(roots[2].children.map((c) => c.run.id)).toEqual(["y"]);
  });

  it("measures time only from reported times", () => {
    expect(durationMs(run("a", null), 0)).toBe(2500);
    expect(durationMs(run("a", null, { status: "running", endedAt: undefined }), Date.parse("2026-11-18T10:00:04Z"))).toBe(4000);
    expect(durationMs(run("a", null, { status: "cancelled", endedAt: undefined }), Date.now())).toBeNull();
    expect([formatDuration(420), formatDuration(2500), formatDuration(75_000)]).toEqual(["420 ms", "2.5 s", "1 min 15 s"]);
  });

  it("builds the agents of a turn from streamed events, live", () => {
    let t: Turn = { id: "t", prompt: "q", at: "2026-11-18T10:00:00.000Z", parts: [], status: "running" };
    t = applyEvent(t, { type: "agent_start", agentId: "root", parentId: null, name: "AI Assistant", task: "q", at: "2026-11-18T10:00:00.000Z" });
    t = applyEvent(t, { type: "agent_start", agentId: "sub", parentId: "root", name: "Researcher", at: "2026-11-18T10:00:01.000Z" });
    t = applyEvent(t, { type: "tool_call", callId: "c", tool: "get_snapshot", args: {}, simulated: true, agentId: "sub" });
    t = applyEvent(t, { type: "agent_usage", agentId: "sub", usage: { input: 120, output: 40 } });
    expect(t.agents?.find((a) => a.id === "sub")).toMatchObject({ status: "running", usage: { input: 120, output: 40 } });
    expect(t.parts[0]).toMatchObject({ type: "tool", agentId: "sub" });
    t = applyEvent(t, { type: "agent_end", agentId: "sub", status: "error", at: "2026-11-18T10:00:03.000Z", error: "Timed out" });
    expect(t.agents?.find((a) => a.id === "sub")).toMatchObject({ status: "error", endedAt: "2026-11-18T10:00:03.000Z", error: "Timed out", usage: { input: 120 } });
    // The harness ends the turn without ending the root: it takes the turn's outcome, with no end time.
    t = applyEvent(t, { type: "turn_end", status: "cancelled" });
    expect(t.agents?.find((a) => a.id === "root")).toMatchObject({ status: "cancelled" });
    expect(t.agents?.find((a) => a.id === "root")?.endedAt).toBeUndefined();
  });
});
