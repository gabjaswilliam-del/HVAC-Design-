import { describe, expect, it } from "vitest";
import type { AgentRun, Turn, TurnPart } from "../../lib/contracts/agent";
import { CARD, initialFolds, layoutForest, layoutTree, mapForest, mapTree, type MapNode, type TreeLayout } from "./agentLayout";

const at = "2026-11-18T10:00:00.000Z";
const agent = (id: string, parentId: string | null): AgentRun => ({ id, parentId, name: id, status: "complete", startedAt: at, endedAt: at });
const tool = (callId: string, agentId?: string): TurnPart => ({ type: "tool", callId, tool: "get_plant_snapshot", args: {}, simulated: true, status: "ok", summary: `${callId} done`, ...(agentId ? { agentId } : {}) });
const turn = (id: string, prompt: string, agents: AgentRun[] | undefined, tools: TurnPart[]): Turn => ({ id, prompt, at, parts: tools, status: "complete", ...(agents ? { agents } : {}) });
const keys = (n: MapNode): unknown => [n.key, n.children.map(keys)];
const byKey = (l: TreeLayout, key: string) => l.placed.find((p) => p.node.key === key)!;
const centre = (l: TreeLayout, key: string) => byKey(l, key).y + CARD.h / 2;

/** Every placed child is reached by a horizontal branch ending at its left edge, at its centre. */
function expectConnected(l: TreeLayout) {
  for (const p of l.placed.filter((x) => x.parent)) {
    expect(l.edges).toContain(`M${p.x - CARD.gapX / 2} ${p.y + CARD.h / 2}H${p.x}`);
  }
}
/** Cards in one column never overlap, every segment is horizontal or vertical, all inside the map. */
function expectClean(l: TreeLayout) {
  const columns = new Map<number, number[]>();
  for (const p of l.placed) columns.set(p.x, [...(columns.get(p.x) ?? []), p.y]);
  for (const ys of columns.values()) {
    ys.sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(CARD.h);
  }
  for (const e of l.edges) expect(e).toMatch(/^M[\d.]+ [\d.]+[HV][\d.]+$/);
  for (const p of l.placed) {
    expect(p.x + CARD.w).toBeLessThanOrEqual(l.width);
    expect(p.y + CARD.h).toBeLessThanOrEqual(l.height);
  }
}

describe("agent map: a task branch", () => {
  it("is the request with its execution: the root agent's tools and subagents branch from the task card", () => {
    const t = turn("t", "Is the plant meeting cooling demand?", [agent("root", null), agent("data", "root"), agent("cmp", "root")], [tool("c1", "data"), tool("c2", "data"), tool("c3", "cmp"), tool("c4", "root")]);
    const task = mapTree(t);
    expect(task.kind === "task" && task.run?.id).toBe("root");
    expect(keys(task)).toEqual([
      "task:t",
      [
        ["agent:t:data", [["tool:t:c1", []], ["tool:t:c2", []]]],
        ["agent:t:cmp", [["tool:t:c3", []]]],
        ["tool:t:c4", []],
      ],
    ]);
  });

  it("without reported agents, its tool calls branch from the task; with several roots, the agents stay as cards", () => {
    expect(keys(mapTree(turn("old", "q", undefined, [tool("a"), tool("b")])))).toEqual(["task:old", [["tool:old:a", []], ["tool:old:b", []]]]);
    const two = mapTree(turn("t", "q", [agent("x", null), agent("y", null)], [tool("a", "x")]));
    expect(two.kind === "task" && two.run).toBeNull();
    expect(keys(two)).toEqual(["task:t", [["agent:t:x", [["tool:t:a", []]]], ["agent:t:y", []]]]);
  });

  it("keeps a call whose agent was not reported, or an agent whose parent was not, under the task, flagged", () => {
    const task = mapTree(turn("t", "q", [agent("root", null), agent("lost", "elsewhere")], [tool("c1"), tool("c2", "ghost")]));
    expect(task.children.map((c) => [c.key, c.kind === "tool" ? c.unattributed : c.kind === "agent" && c.orphan])).toEqual([
      ["agent:t:lost", true],
      ["tool:t:c1", true],
      ["tool:t:c2", true],
    ]);
  });

  it("lays out one task with several tools: one column, one spine, the task centred on it", () => {
    const l = layoutTree(mapTree(turn("t", "q", undefined, [tool("a"), tool("b"), tool("c"), tool("d")])), new Set());
    const kids = l.placed.filter((p) => p.parent === "task:t");
    expect(new Set(kids.map((k) => k.x))).toEqual(new Set([CARD.pad + CARD.w + CARD.gapX]));
    expect(centre(l, "task:t")).toBe((centre(l, "tool:t:a") + centre(l, "tool:t:d")) / 2);
    expect(l.edges).toContain(`M${CARD.pad + CARD.w + CARD.gapX / 2} ${centre(l, "tool:t:a")}V${centre(l, "tool:t:d")}`);
    expectConnected(l);
    expectClean(l);
  });

  it("branches subagents with their own spines, without flattening them", () => {
    const t = turn("t", "q", [agent("root", null), agent("data", "root"), agent("val", "root"), agent("deep", "data")], [tool("p", "data"), tool("h", "data"), tool("v", "val"), tool("z", "deep")]);
    const l = layoutTree(mapTree(t), new Set());
    expect([byKey(l, "agent:t:data").depth, byKey(l, "agent:t:deep").depth, byKey(l, "tool:t:z").depth]).toEqual([1, 2, 3]);
    expect(centre(l, "agent:t:data")).toBe((centre(l, "agent:t:deep") + centre(l, "tool:t:h")) / 2);
    expect(centre(l, "agent:t:val")).toBe(centre(l, "tool:t:v")); // a single child: one straight line
    expectConnected(l);
    expectClean(l);
  });

  it("folding a branch removes its cards and exactly its connectors", () => {
    const t = turn("t", "q", [agent("root", null), agent("data", "root"), agent("cmp", "root")], [tool("p", "data"), tool("h", "data"), tool("r", "cmp")]);
    const open = layoutTree(mapTree(t), new Set());
    const shut = layoutTree(mapTree(t), new Set(["agent:t:data"]));
    expect(shut.placed.map((p) => p.node.key)).not.toContain("tool:t:p");
    expect(byKey(shut, "agent:t:data").folded).toBe(true);
    expect(shut.edges.length).toBe(open.edges.length - 4); // its stub, spine and two branches
    expectConnected(shut);
    expectClean(shut);
  });
});

describe("agent map: a conversation", () => {
  // The owner's acceptance scenario: three requests, each its own branch, stacked in order.
  const cop = turn("t1", "Calculate Chiller 1 COP", [agent("a1", null)], [tool("x1", "a1"), tool("x2", "a1"), tool("x3", "a1")]);
  const sim = turn("t2", "Check simulation", [agent("a2", null)], [tool("y1", "a2"), tool("y2", "a2")]);
  const temps = turn("t3", "Compare temperatures", [agent("a3", null)], [tool("z1", "a3"), tool("z2", "a3"), tool("z3", "a3")]);

  it("stacks one left-to-right branch per request, never joined, each band clear of the next", () => {
    const l = layoutForest(mapForest([cop, sim, temps]), new Set());
    const tasks = ["task:t1", "task:t2", "task:t3"].map((k) => byKey(l, k));
    expect(new Set(tasks.map((t) => t.x)).size).toBe(1); // every task card on the left
    expect(tasks[0].y).toBeLessThan(tasks[1].y);
    expect(tasks[1].y).toBeLessThan(tasks[2].y);
    const band = (task: string) => {
      const ys = l.placed.filter((p) => p.task === task).map((p) => p.y);
      return [Math.min(...ys), Math.max(...ys) + CARD.h];
    };
    const [b1, b2, b3] = ["task:t1", "task:t2", "task:t3"].map(band);
    expect(b2[0] - b1[1]).toBe(CARD.taskGap);
    expect(b3[0] - b2[1]).toBe(CARD.taskGap);
    // Each task's tools branch right from it; no vertical connector crosses between tasks.
    for (const t of tasks) for (const c of l.placed.filter((p) => p.parent === t.node.key)) expect(c.x).toBeGreaterThan(t.x);
    for (const e of l.edges.filter((d) => d.includes("V"))) {
      const [, y0, y1] = e.match(/^M[\d.]+ ([\d.]+)V([\d.]+)$/)!.map(Number);
      expect([b1, b2, b3].some(([top, bottom]) => y0 >= top && y1 <= bottom)).toBe(true);
    }
    expect(l.edges).toHaveLength((2 + 3) + (2 + 2) + (2 + 3));
    expectConnected(l);
    expectClean(l);
  });

  it("adds a new request below without moving or changing the earlier branches", () => {
    const two = layoutForest(mapForest([cop, sim]), new Set());
    const three = layoutForest(mapForest([cop, sim, temps]), new Set());
    for (const p of two.placed) expect(byKey(three, p.node.key)).toMatchObject({ x: p.x, y: p.y });
    expect(two.edges.every((e) => three.edges.includes(e))).toBe(true);
  });

  it("handles deep and large conversations without overlaps or loose lines, folding deep levels of a big one", () => {
    const agents: AgentRun[] = [agent("a", null)];
    const tools: TurnPart[] = [];
    const grow = (id: string, depth: number) => {
      tools.push(tool(`${id}-t1`, id), tool(`${id}-t2`, id));
      if (depth === 5) return;
      for (let i = 0; i < 3; i++) {
        agents.push(agent(`${id}${i}`, id));
        grow(`${id}${i}`, depth + 1);
      }
    };
    grow("a", 0);
    const roots = mapForest([cop, turn("big", "Audit everything", agents, tools), temps]);
    const full = layoutForest(roots, new Set());
    expect(full.placed).toHaveLength(4 + 4 + agents.length + tools.length); // cop and temps 1+3 each; big: task (= root agent) + the rest
    expect(Math.max(...full.placed.map((p) => p.depth))).toBe(6);
    expectConnected(full);
    expectClean(full);
    const folds = initialFolds(roots);
    const opened = layoutForest(roots, folds);
    expect(Math.max(...opened.placed.map((p) => p.depth))).toBe(2);
    expect(opened.placed.filter((p) => p.folded).every((p) => p.depth === 2)).toBe(true);
    expectConnected(opened);
    expectClean(opened);
  });
});
