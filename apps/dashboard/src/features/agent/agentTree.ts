/**
 * The agents of one turn as a tree, from the harness's own `parentId` links only. An agent
 * whose parent was not reported in this turn (or that sits in a cycle) is shown at the top
 * level and marked, never attached by guesswork.
 */
import type { AgentRun } from "../../lib/contracts/agent";

export interface AgentNode {
  run: AgentRun;
  children: AgentNode[];
  /** Its parent is named but was not reported in this turn. */
  orphan: boolean;
  /** Agents below it, at any depth. */
  descendants: number;
}

export function agentTree(agents: readonly AgentRun[]): AgentNode[] {
  const ids = new Set(agents.map((a) => a.id));
  const byParent = new Map<string | null, AgentRun[]>();
  for (const a of agents) {
    const key = a.parentId !== null && ids.has(a.parentId) && a.parentId !== a.id ? a.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), a]);
  }
  const seen = new Set<string>();
  const build = (run: AgentRun): AgentNode => {
    seen.add(run.id);
    const children = (byParent.get(run.id) ?? []).filter((c) => !seen.has(c.id)).map(build);
    return { run, children, orphan: run.parentId !== null && !ids.has(run.parentId), descendants: children.reduce((n, c) => n + 1 + c.descendants, 0) };
  };
  const roots = (byParent.get(null) ?? []).map(build);
  // Agents only reachable through a cycle: shown at the top level rather than dropped.
  for (const a of agents) if (!seen.has(a.id)) roots.push({ ...build(a), orphan: true });
  return roots;
}

/** Subagents (every agent but the turn's root) running and waiting now; ended ones are not counted. */
export function activeSubagents(agents: readonly AgentRun[] | undefined) {
  let running = 0;
  let queued = 0;
  for (const a of agents ?? []) {
    if (a.parentId === null) continue;
    if (a.status === "running") running++;
    else if (a.status === "queued") queued++;
  }
  return { running, queued };
}

/** The execution the composer's map shows: the conversation's latest turn that reported agents. */
export const mapTurn = <T extends { agents?: readonly AgentRun[] }>(turns: readonly T[]) => turns.findLast((t) => !!t.agents?.length) ?? null;

/** Wall-clock run time of an agent or a tool call: to its end, or to `now` while running; null
 *  when its start or end was not reported or it has not started (queued). */
export function durationMs(run: { status: string; startedAt?: string; endedAt?: string }, now: number): number | null {
  if (!run.startedAt) return null;
  const start = Date.parse(run.startedAt);
  if (run.endedAt) return Math.max(0, Date.parse(run.endedAt) - start);
  return run.status === "running" ? Math.max(0, now - start) : null;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${Math.round(s % 60)} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
