import { describe, expect, it } from "vitest";
import snapshotJson from "../../../fixtures/knowledgeDemo.json";
import { demoKnowledge, type KnowledgeSnapshot } from "../../../fixtures/knowledgeDemo";
import { withDocuments } from "./KnowledgeGraphView";

const kn = demoKnowledge(snapshotJson as unknown as KnowledgeSnapshot, { latency: 0 });

describe("the knowledge graph overview", () => {
  it("adds the documents a truncated overview leaves out, and nothing else", async () => {
    const overview = await kn.getKnowledgeGraph({ limit: 40 });
    const docs = (await kn.getKnowledgeGraph({ types: ["document"], limit: 300 })).nodes;
    const missing = docs.filter((d) => !overview.nodes.some((n) => n.id === d.id));
    expect(overview.truncated).toBe(true);
    expect(missing.length).toBeGreaterThan(0);
    const g = withDocuments(overview, docs);
    expect(g.added).toBe(missing.length);
    expect(g.nodes.map((n) => n.id)).toEqual([...overview.nodes, ...missing].map((n) => n.id));
    expect(g.nodes.filter((n) => n.type === "document")).toHaveLength(docs.length);
    expect(g.edges).toEqual(overview.edges);
    // Never past the 300 nodes the view holds.
    const nearlyFull = { ...overview, nodes: Array.from({ length: 299 }, (_, i) => ({ ...overview.nodes[0], id: `n${i}` })) };
    expect(withDocuments(nearlyFull, docs).added).toBe(1);
  });
});
