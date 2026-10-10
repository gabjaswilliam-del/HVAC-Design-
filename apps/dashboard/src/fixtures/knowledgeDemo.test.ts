import { describe, expect, it } from "vitest";
import snapshotJson from "./knowledgeDemo.json";
import memoryJson from "./memoryDemo.json";
import { demoKnowledge, snippet, type KnowledgeSnapshot } from "./knowledgeDemo";
import { demoMemory, type MemorySnapshot } from "./memoryDemo";
import {
  documentDetail,
  documentList,
  edgeDetail,
  knowledgeGraph,
  knowledgeStatus,
  nodeDetail,
  passage,
  searchResult,
} from "../lib/contracts/knowledge";
import { memoryDetail, memoryGraph, memoryList, memoryNeighbourhood, memoryStatus, memoryTimeline } from "../lib/contracts/memory";
import { ApiError } from "../lib/api/client";

const snapshot = snapshotJson as unknown as KnowledgeSnapshot;
const kn = demoKnowledge(snapshot, { latency: 0 });
const mem = demoMemory(memoryJson as unknown as MemorySnapshot, { latency: 0 });

describe("demo knowledge library", () => {
  it("answers in the service's contract", async () => {
    knowledgeStatus.parse(await kn.status());
    const list = documentList.parse(await kn.listDocuments());
    expect(list.documents).toHaveLength(7);
    for (const d of list.documents) documentDetail.parse(await kn.getDocument(d.id));
    const graph = knowledgeGraph.parse(await kn.getKnowledgeGraph());
    for (const n of graph.nodes.slice(0, 20)) nodeDetail.parse(await kn.expandKnowledgeNode(n.id));
    for (const e of graph.edges.slice(0, 20)) edgeDetail.parse(await kn.inspectEvidence(e.id));
    for (const c of Object.keys(snapshot.chunks).slice(0, 5)) passage.parse(await kn.getPassage(c));
  });

  it("says the library is fixed: no management in the demo", async () => {
    for (const call of [() => kn.ingestDocument({ name: "a.md", contentBase64: "IyBh", kind: "manual" }), () => kn.reindexDocument("x"), () => kn.deleteDocument("x")]) {
      await expect(call()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });

  it("finds grounded passages for the example questions", async () => {
    const cop = searchResult.parse(await kn.searchKnowledge({ query: "What are the common causes of low chiller COP?" }));
    expect(cop.results[0].sectionPath).toBe("Demo chiller maintenance guide › Common causes of low COP");
    expect(cop.methods.graph.seeds.map((s) => s.id)).toContain("ent_symptom_low_cop");
    expect(cop.answer.available).toBe(false);
    for (const r of cop.results) expect(r.text).toBe(snapshot.chunks[r.chunkId].text);

    const towers = searchResult.parse(await kn.searchKnowledge({ query: "Which documents discuss cooling tower performance?" }));
    expect(towers.documents[0].title).toBe("Demo cooling tower performance notes");

    const procedures = searchResult.parse(await kn.searchKnowledge({ query: "What maintenance procedures relate to Chiller 2?" }));
    expect(procedures.results[0].documentTitle).toBe("Demo site procedure: Chiller 2 condenser tube cleaning");
    expect(procedures.results[0].procedure).toBe(true);

    expect((await kn.searchKnowledge({ query: "zeppelin" })).results).toEqual([]);
    await expect(kn.searchKnowledge({ query: "the of and" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("bounds the graph and filters it by type", async () => {
    const small = await kn.getKnowledgeGraph({ limit: 10 });
    expect(small.nodes).toHaveLength(10);
    expect(small.truncated).toBe(true);
    const ids = new Set(small.nodes.map((n) => n.id));
    for (const e of small.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
    const faults = await kn.getKnowledgeGraph({ types: ["fault", "symptom"], edgeTypes: ["ASSOCIATED_WITH"] });
    expect(new Set(faults.nodes.map((n) => n.type))).toEqual(new Set(["fault", "symptom"]));
    expect(new Set(faults.edges.map((e) => e.type))).toEqual(new Set(["ASSOCIATED_WITH"]));
    const node = await kn.expandKnowledgeNode("ent_equipment_chiller_plant_2", { limit: 3 });
    expect(node.neighbours.edges).toHaveLength(3);
    expect(node.neighbours.hasMore).toBe(true);
  });

  it("quotes every relationship's evidence from its passage", async () => {
    for (const e of snapshot.graph.edges.filter((x) => x.type === "ASSOCIATED_WITH")) {
      const detail = await kn.inspectEvidence(e.id);
      for (const item of detail.evidence.items) {
        const s = item.snippet!;
        expect(snapshot.chunks[item.chunkId!].text).toContain(s.text.slice(s.highlight[0], s.highlight[1]));
        expect(item.rule).toBe("cause-wording");
      }
    }
    expect(snippet("one two three four", 4, 7, 2)).toEqual({ text: "two", highlight: [0, 3], before: true, after: true });
    expect(snippet("one two three four", 4, 7, 7)).toEqual({ text: "one two three", highlight: [4, 7], before: false, after: true });
  });

  it("reports a failing or empty demo as such", async () => {
    const down = demoKnowledge(snapshot, { latency: 0, failure: "unavailable" });
    await expect(down.listDocuments()).rejects.toBeInstanceOf(ApiError);
    const empty = demoKnowledge(snapshot, { latency: 0, failure: "empty" });
    expect((await empty.listDocuments()).documents).toEqual([]);
    expect((await empty.getKnowledgeGraph()).nodes).toEqual([]);
  });
});

describe("demo memory", () => {
  it("answers in the service's contract", async () => {
    memoryStatus.parse(await mem.status());
    const list = memoryList.parse(await mem.listMemories({ includeSuperseded: true, limit: 200 }));
    expect(list.total).toBe(13);
    for (const m of list.memories) memoryDetail.parse(await mem.inspectMemory(m.id));
    memoryTimeline.parse(await mem.getMemoryTimeline());
    memoryGraph.parse(await mem.getMemoryGraph());
    memoryNeighbourhood.parse(await mem.expandMemoryNode("equipment:chiller_plant_2"));
  });

  it("keeps the persistent store's provenance rules and refuses writes", async () => {
    const status = await mem.status();
    expect(status.storage.persistent).toBe(false);
    expect(status.provenance.filter((p) => !p.allowed).map((p) => p.id).sort()).toEqual(["demo", "verified_operational_source"]);
    await expect(mem.createMemory({ kind: "event", title: "x", provenance: "user_entered", occurredAt: "2026-10-01T00:00:00Z" })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(mem.deleteMemory("mem_demo001")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("answers the temporal questions", async () => {
    // The last recorded issue involving Chiller 2.
    const last = await mem.listMemories({ equipment: ["chiller_plant_2"], kinds: ["event", "finding"], limit: 1 });
    expect(last.memories[0].title).toBe("Condenser tube fouling likely on Chiller 2");
    // Which correction was applied after the finding.
    const finding = await mem.inspectMemory(last.memories[0].id);
    const resolved = finding.links.filter((l) => l.type === "RESOLVED_BY" && l.direction === "out").map((l) => l.other!);
    expect(resolved.map((r) => r.kind).sort()).toEqual(["correction", "decision"]);
    for (const r of resolved) expect(r.occurredAt > finding.memory.occurredAt).toBe(true);
    // How the recorded state changed: the timeline, each entry after the previous one on its equipment.
    const timeline = await mem.getMemoryTimeline({ equipment: ["chiller_plant_2"] });
    const [newest, ...older] = timeline.entries;
    expect(newest.previous.chiller_plant_2).toBe(older[0].id);
  });

  it("keeps corrections as history and derives the order in the graph", async () => {
    const all = await mem.listMemories({ includeSuperseded: true, limit: 200 });
    const old = all.memories.find((m) => m.status === "superseded")!;
    const detail = await mem.inspectMemory(old.id);
    expect(detail.history.map((h) => h.status)).toEqual(["superseded", "current"]);
    expect(detail.history[1].correctionReason).toBeTruthy();
    expect((await mem.listMemories({ limit: 200 })).total).toBe(12);
    const graph = await mem.getMemoryGraph({ includeSuperseded: true });
    expect(graph.edges.some((e) => e.type === "SUPERSEDES" && e.target === old.id)).toBe(true);
    const order = graph.edges.filter((e) => e.type === "OCCURRED_BEFORE");
    expect(order.length).toBeGreaterThan(0);
    expect(order.every((e) => e.derived)).toBe(true);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    for (const e of order) expect(byId.get(e.source)!.occurredAt! <= byId.get(e.target)!.occurredAt!).toBe(true);
  });

  it("filters by words, kind and time window", async () => {
    expect((await mem.searchMemories("fan vibration")).memories.map((m) => m.title)).toContain("Cooling tower 4 fan vibration rising");
    expect((await mem.listMemories({ provenance: ["simulation"] })).total).toBe(2);
    expect((await mem.listMemories({ from: "2026-10-03T00:00:00Z" })).memories.every((m) => m.occurredAt >= "2026-10-03")).toBe(true);
    await expect(mem.listMemories({ from: "2026-10-03T00:00:00Z", to: "2026-10-01T00:00:00Z" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
