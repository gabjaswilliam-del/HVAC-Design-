/**
 * Demo memory: synthetic records created through the real memory service's rules
 * (`scripts/export_knowledge_demo.py` writes `memoryDemo.json`; a Python test fails if it
 * is stale). Read only and never mixed with the persistent memory: recording, correcting,
 * linking and deleting need the local memory service. The reads below follow the
 * service's: filters, keyword match, the timeline, and the graph with the derived
 * OCCURRED_BEFORE order.
 */
import { ApiError, type RequestOptions } from "../lib/api/client";
import type { MemoryClient } from "../lib/api/memory";
import type {
  LinkType,
  MemoryEdge,
  MemoryFilters,
  MemoryNode,
  MemoryRecord,
  MemoryStatus,
} from "../lib/contracts/memory";
import { delay } from "./fixtureClient";
import { stem } from "./knowledgeDemo";

export interface MemorySnapshot {
  status: MemoryStatus;
  records: MemoryRecord[];
  links: { id: string; type: LinkType; source: string; target: string; createdAt: string }[];
}

const READ_ONLY = "The demo records are fixed. Recording, correcting, linking and deleting memory needs the local memory service.";
const STOP = new Set("a an and are as at be by for from has how in is it of on or the to was what when which with".split(" "));
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const newestFirst = (a: MemoryRecord, b: MemoryRecord) =>
  b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id);

export function demoMemory(snapshot: MemorySnapshot, opts: { failure?: string; latency?: number } = {}): MemoryClient {
  const empty = opts.failure === "empty";
  const records = empty ? [] : snapshot.records;
  const byId = new Map(records.map((r) => [r.id, r]));
  const links = empty ? [] : snapshot.links;

  const wait = async (o?: RequestOptions) => {
    await delay(opts.latency ?? 120, o?.signal);
    if (opts.failure === "unavailable") throw new ApiError("UNAVAILABLE", "The demo memory is set to fail (fail=memory:unavailable).", true);
  };
  const readOnly = async (o?: RequestOptions): Promise<never> => {
    await wait(o);
    throw new ApiError("PERMISSION_DENIED", READ_ONLY, false);
  };
  const missing = () => new ApiError("NOT_FOUND", "No memory record with this ID exists; it may have been deleted.", false);

  const select = (f: MemoryFilters & { offset?: number; run?: string } = {}, cap = 200) => {
    if (f.from && f.to && f.from > f.to) throw new ApiError("INVALID_REQUEST", "from must not be after to.", false);
    const terms = words(f.query ?? "")
      .filter((w) => !STOP.has(w))
      .map(stem);
    const matched = records
      .filter(
        (r) =>
          (f.includeSuperseded || r.status === "current") &&
          (!f.kinds?.length || f.kinds.includes(r.kind)) &&
          (!f.provenance?.length || f.provenance.includes(r.provenance)) &&
          (!f.equipment?.length || r.equipment.some((e) => f.equipment!.includes(e))) &&
          (!f.run || r.runId === f.run) &&
          (!f.from || r.occurredAt >= f.from) &&
          (!f.to || r.occurredAt <= f.to) &&
          (!terms.length || words(`${r.title} ${r.body}`).some((w) => terms.includes(stem(w)))),
      )
      .sort(newestFirst);
    const offset = f.offset ?? 0;
    const limit = Math.min(Math.max(f.limit ?? 50, 1), cap);
    return { rows: matched.slice(offset, offset + limit), total: matched.length, limit, offset, searched: terms.length > 0 };
  };

  /** The service's graph assembly: records, their equipment and runs, stored links,
   *  SUPERSEDES between shown versions, and OCCURRED_BEFORE per equipment (derived). */
  const assemble = (rows: MemoryRecord[]) => {
    const ids = new Set(rows.map((r) => r.id));
    const nodes: MemoryNode[] = rows.map((r) => ({
      id: r.id,
      type: r.kind,
      label: r.title,
      occurredAt: r.occurredAt,
      provenance: r.provenance,
      status: r.status,
      equipment: r.equipment,
      runId: r.runId,
    }));
    const edges: MemoryEdge[] = [];
    const anchors = new Map<string, MemoryNode>();
    for (const r of rows) {
      for (const eq of r.equipment) {
        anchors.set(`equipment:${eq}`, { id: `equipment:${eq}`, type: "equipment", label: eq });
        edges.push({ id: `rel:${r.id}:${eq}`, type: "RELATES_TO", source: r.id, target: `equipment:${eq}` });
      }
      if (r.runId) {
        anchors.set(`run:${r.runId}`, { id: `run:${r.runId}`, type: "simulation_run", label: r.runId });
        edges.push({ id: `run:${r.id}`, type: "PART_OF_RUN", source: r.id, target: `run:${r.runId}` });
      }
      if (r.supersedes && ids.has(r.supersedes)) edges.push({ id: `sup:${r.id}`, type: "SUPERSEDES", source: r.id, target: r.supersedes });
    }
    for (const l of links) if (ids.has(l.source) && ids.has(l.target)) edges.push({ id: l.id, type: l.type, source: l.source, target: l.target });
    const lanes = new Map<string, MemoryRecord[]>();
    for (const r of rows.toSorted((a, b) => -newestFirst(a, b))) {
      if (r.status !== "current") continue;
      for (const eq of r.equipment) lanes.set(eq, [...(lanes.get(eq) ?? []), r]);
    }
    for (const [eq, lane] of lanes)
      lane.slice(1).forEach((b, i) => edges.push({ id: `seq:${eq}:${lane[i].id}:${b.id}`, type: "OCCURRED_BEFORE", source: lane[i].id, target: b.id, derived: true, equipment: eq }));
    return { nodes: [...nodes, ...anchors.values()], edges };
  };

  const chain = (id: string) => {
    let r = byId.get(id);
    const seen = new Set<string>();
    while (r?.supersedes && byId.has(r.supersedes) && !seen.has(r.id)) {
      seen.add(r.id);
      r = byId.get(r.supersedes);
    }
    const versions: MemoryRecord[] = [];
    while (r && !versions.includes(r)) {
      versions.push(r);
      r = r.supersededBy ? byId.get(r.supersededBy) : undefined;
    }
    return versions;
  };

  return {
    mode: "demo",
    async status(o) {
      await wait(o);
      return empty ? { ...snapshot.status, totals: { memories: 0, current: 0, superseded: 0, links: 0, keywordRows: 0 } } : snapshot.status;
    },
    createMemory: (_d, o) => readOnly(o),
    supersedeMemory: (_m, _c, o) => readOnly(o),
    linkMemories: (_m, _l, o) => readOnly(o),
    unlinkMemories: (_m, _l, o) => readOnly(o),
    deleteMemory: (_m, o) => readOnly(o),

    async listMemories(f, o) {
      await wait(o);
      const { rows, ...rest } = select(f);
      return { memories: rows, ...rest };
    },
    async searchMemories(query, f, o) {
      await wait(o);
      const { rows, ...rest } = select({ ...f, query });
      return { memories: rows, ...rest };
    },
    async getMemoryTimeline(f, o) {
      await wait(o);
      const { rows, total } = select({ limit: 100, ...f });
      const last = new Map<string, string>();
      const entries = rows.toReversed().map((r) => {
        const previous = Object.fromEntries(r.equipment.filter((e) => last.has(e)).map((e) => [e, last.get(e)!]));
        if (r.status === "current") for (const e of r.equipment) last.set(e, r.id);
        return { ...r, previous };
      });
      return { entries: entries.toReversed(), total, window: { from: f?.from ?? null, to: f?.to ?? null } };
    },
    async getMemoryGraph(f, o) {
      await wait(o);
      const { rows, total, limit } = select({ limit: 120, ...f });
      return { ...assemble(rows), total, truncated: total > rows.length, limit, window: { from: f?.from ?? null, to: f?.to ?? null } };
    },
    async expandMemoryNode(id, q = {}, o) {
      await wait(o);
      const limit = Math.min(Math.max(q.limit ?? 40, 1), 100);
      if (id.startsWith("equipment:") || id.startsWith("run:")) {
        const key = id.slice(id.indexOf(":") + 1);
        const { rows, total } = select({ ...(id.startsWith("run:") ? { run: key } : { equipment: [key] }), includeSuperseded: q.includeSuperseded, limit });
        if (!rows.length) throw new ApiError("NOT_FOUND", "No memory records refer to this item.", false);
        return { ...assemble(rows), focus: id, total, hasMore: total > rows.length };
      }
      if (!byId.has(id)) throw missing();
      const ids = new Set([id, ...links.flatMap((l) => (l.source === id || l.target === id ? [l.source, l.target] : [])), ...chain(id).map((v) => v.id)]);
      const rows = [...ids].sort().map((x) => byId.get(x)!).slice(0, limit);
      return { ...assemble(rows), focus: id, total: ids.size, hasMore: ids.size > limit };
    },
    async inspectMemory(id, o) {
      await wait(o);
      const memory = byId.get(id);
      if (!memory) throw missing();
      return {
        memory,
        links: links
          .filter((l) => l.source === id || l.target === id)
          .map((l) => ({ id: l.id, type: l.type, direction: l.source === id ? ("out" as const) : ("in" as const), other: byId.get(l.source === id ? l.target : l.source) ?? null, createdAt: l.createdAt })),
        history: chain(id),
      };
    },
  };
}
