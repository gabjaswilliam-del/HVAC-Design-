/**
 * The agent map of a conversation: one left-to-right branch per user request (task), stacked
 * top to bottom in the order they were asked, never joined to each other.
 *
 * Within a task, the hierarchy is the harness's own: the turn's root agent (parentId null) is
 * the task's execution, so it is the task card itself (its status, time and tokens); the tool
 * calls it made and the subagents it started branch to the right; each subagent's own tools
 * and subagents branch from it (`agentId`, `parentId`). When a turn reports no root agent, or
 * several, its agents stay as cards of their own under the task. A call or agent whose parent
 * was not reported stays under the task, flagged. Nothing is placed by name or display order.
 *
 * Layout: every card has one size; a column per depth; leaves stack top to bottom in tree
 * order and a parent is centred on its first and last child. An open parent draws a stub to a
 * spine half a column gap to its right, the spine spans its children's centres, and each child
 * gets a branch from the spine to its left edge. Subtrees take disjoint vertical bands, so no
 * two cards overlap. A folded node is laid out as a leaf: its descendants and their connectors
 * are not drawn. Tasks are separated by a wider gap.
 */
import type { AgentRun, Turn, TurnPart } from "../../lib/contracts/agent";
import { agentTree, type AgentNode } from "./agentTree";

export type ToolPart = Extract<TurnPart, { type: "tool" }>;
export type MapStatus = "queued" | "running" | "complete" | "cancelled" | "error";

interface Base {
  key: string;
  status: MapStatus;
  children: MapNode[];
}
export type MapNode =
  /** `run`: the turn's root agent, shown as the task's execution; absent when not reported. */
  | (Base & { kind: "task"; turn: Turn; index: number; run: AgentRun | null })
  | (Base & { kind: "agent"; run: AgentRun; orphan: boolean })
  /** `unattributed`: the harness reported agents but not which one made this call. */
  | (Base & { kind: "tool"; part: ToolPart; unattributed: boolean });

const TOOL_STATUS = { running: "running", ok: "complete", error: "error" } as const;

/** One user request and its execution, as a task branch. `index` is its place in the conversation. */
export function mapTree(turn: Turn, index = 0): MapNode {
  const ns = turn.id;
  const agents = turn.agents ?? [];
  const known = new Set(agents.map((a) => a.id));
  const byAgent = new Map<string, ToolPart[]>();
  const loose: ToolPart[] = [];
  for (const p of turn.parts) {
    if (p.type !== "tool") continue;
    if (p.agentId && known.has(p.agentId)) byAgent.set(p.agentId, [...(byAgent.get(p.agentId) ?? []), p]);
    else loose.push(p);
  }
  const tool = (part: ToolPart, unattributed: boolean): MapNode => ({ kind: "tool", key: `tool:${ns}:${part.callId}`, part, unattributed, status: TOOL_STATUS[part.status], children: [] });
  const below = (n: AgentNode): MapNode[] => [...n.children.map(agent), ...(byAgent.get(n.run.id) ?? []).map((t) => tool(t, false))];
  const agent = (n: AgentNode): MapNode => ({ kind: "agent", key: `agent:${ns}:${n.run.id}`, run: n.run, orphan: n.orphan, status: n.run.status, children: below(n) });

  const roots = agentTree(agents);
  const executions = roots.filter((r) => !r.orphan);
  const root = executions.length === 1 ? executions[0] : null;
  const children = root
    ? [...below(root), ...roots.filter((r) => r !== root).map(agent)]
    : roots.map(agent);
  return {
    kind: "task",
    key: `task:${ns}`,
    turn,
    index,
    run: root?.run ?? null,
    status: root?.run.status ?? (turn.status === "running" ? "running" : turn.status),
    children: [...children, ...loose.map((t) => tool(t, agents.length > 0))],
  };
}

/** Every request of the conversation, oldest first. */
export const mapForest = (turns: readonly Turn[]) => turns.map((t, i) => mapTree(t, i));

export const countBelow = (n: MapNode): number => n.children.reduce((s, c) => s + 1 + countBelow(c), 0);

export const CARD = { w: 252, h: 62, gapX: 64, gapY: 14, taskGap: 40, pad: 28 } as const;

export interface Placed {
  node: MapNode;
  x: number;
  y: number;
  depth: number;
  parent: string | null;
  /** The task branch it belongs to. */
  task: string;
  /** Has children (open or folded). */
  branch: boolean;
  folded: boolean;
}
export interface TreeLayout {
  /** In tree (pre-)order, task by task, so keyboard order follows the map. */
  placed: Placed[];
  /** SVG path data, horizontal and vertical segments only. */
  edges: string[];
  width: number;
  height: number;
}

export function layoutForest(roots: readonly MapNode[], folded: ReadonlySet<string>): TreeLayout {
  const { w, h, gapX, gapY, taskGap, pad } = CARD;
  const placed: Placed[] = [];
  const edges: string[] = [];
  let cursor = pad;
  let deepest = 0;
  const visit = (node: MapNode, depth: number, parent: string | null, task: string): number => {
    deepest = Math.max(deepest, depth);
    const x = pad + depth * (w + gapX);
    const closed = folded.has(node.key);
    const at = placed.push({ node, x, y: 0, depth, parent, task, branch: node.children.length > 0, folded: closed && node.children.length > 0 }) - 1;
    let cy: number;
    if (!node.children.length || closed) {
      cy = cursor + h / 2;
      cursor += h + gapY;
    } else {
      const centres = node.children.map((child) => visit(child, depth + 1, node.key, task));
      const first = centres[0];
      const last = centres[centres.length - 1];
      cy = (first + last) / 2;
      const spine = x + w + gapX / 2;
      edges.push(`M${x + w} ${cy}H${spine}`);
      if (last > first) edges.push(`M${spine} ${first}V${last}`);
      for (const c of centres) edges.push(`M${spine} ${c}H${x + w + gapX}`);
    }
    placed[at].y = cy - h / 2;
    return cy;
  };
  roots.forEach((root, i) => {
    if (i) cursor += taskGap - gapY;
    visit(root, 0, null, root.key);
  });
  return { placed, edges, width: pad * 2 + (deepest + 1) * w + deepest * gapX, height: Math.max(cursor - gapY + pad, pad * 2) };
}

/** A single task branch (used by tests and anything that shows one execution). */
export const layoutTree = (root: MapNode, folded: ReadonlySet<string>) => layoutForest([root], folded);

/** Above this many nodes, the map opens with each task's first two columns of steps in view
 *  and every deeper branch folded. */
export const FOLD_ABOVE = 60;
export function initialFolds(roots: readonly MapNode[]): Set<string> {
  const out = new Set<string>();
  if (roots.reduce((s, r) => s + 1 + countBelow(r), 0) <= FOLD_ABOVE) return out;
  const walk = (n: MapNode, depth: number) => {
    if (depth >= 2 && n.children.length) out.add(n.key);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));
  return out;
}
