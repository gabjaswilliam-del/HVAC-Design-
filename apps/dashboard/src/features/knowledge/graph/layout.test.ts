import { describe, expect, it } from "vitest";
import demo from "../../../fixtures/knowledgeDemo.json";
import { clusterLayout3d, declutter, documentWeights, forceLayout, homeDocument, nearestInDirection, timeLayout } from "./layout";

const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
const edges = ids.slice(1).map((id, i) => ({ source: ids[Math.floor(i / 3)], target: id }));

describe("graph layouts", () => {
  it("place the same graph in the same place every time", () => {
    const a = forceLayout(ids, edges);
    const b = forceLayout(ids, edges);
    expect([...a]).toEqual([...b]);
    for (const p of a.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it("keep nodes on screen where they were when the graph grows", () => {
    const before = forceLayout(ids.slice(0, 30), edges.filter((e) => ids.slice(0, 30).includes(e.target)));
    const after = forceLayout(ids, edges, before);
    for (const [id, p] of before) expect(after.get(id)).toEqual(p);
    // The new ones land near what they connect to, not on top of it.
    for (const id of ids.slice(30)) {
      const p = after.get(id)!;
      const near = Math.min(...[...before.values()].map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
      expect(near).toBeGreaterThan(5);
    }
  });

  it("put memory in time order, one lane per equipment item, corrections under their successor", () => {
    const nodes = [
      { id: "a", type: "event", occurredAt: "2026-10-01T06:00:00Z", equipment: ["chiller_plant_2"] },
      { id: "b", type: "finding", occurredAt: "2026-10-01T09:00:00Z", equipment: ["chiller_plant_2"] },
      { id: "b0", type: "observation", occurredAt: "2026-10-01T09:00:00Z", equipment: ["chiller_plant_2"], status: "superseded" },
      { id: "c", type: "outcome", occurredAt: "2026-10-02T10:00:00Z", equipment: ["cooling_towers_4"], runId: "RUN-1" },
      { id: "equipment:chiller_plant_2", type: "equipment" },
      { id: "run:RUN-1", type: "simulation_run" },
    ];
    const { positions, lanes, days } = timeLayout(nodes);
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("b")!.x).toBeLessThan(positions.get("c")!.x);
    expect(positions.get("b0")!.y).toBeGreaterThan(positions.get("b")!.y);
    expect(lanes.map((l) => l.key)).toEqual(["runs", "chiller_plant_2", "cooling_towers_4"]);
    expect(positions.get("run:RUN-1")!.y).toBeLessThan(positions.get("a")!.y);
    expect(days.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02"]);
  });
});

describe("the 3D knowledge graph", () => {
  const nodes = [
    { id: "docA", type: "document", documentId: "docA" },
    { id: "docB", type: "document", documentId: "docB" },
    { id: "secA", type: "section", documentId: "docA" },
    { id: "secB", type: "section", documentId: "docB" },
    { id: "chiller", type: "equipment", documentId: null },
    { id: "fouling", type: "fault", documentId: null },
    { id: "tubes", type: "component", documentId: null },
    { id: "alone", type: "concept", documentId: null },
  ];
  const edges = [
    { source: "secA", target: "docA", type: "PART_OF" },
    { source: "secB", target: "docB", type: "PART_OF" },
    { source: "chiller", target: "secA", type: "DESCRIBED_BY" },
    { source: "chiller", target: "secB", type: "DESCRIBED_BY" },
    { source: "fouling", target: "secA", type: "DESCRIBED_BY" },
    { source: "tubes", target: "chiller", type: "PART_OF" },
  ];

  it("gives each node to the documents that describe it", () => {
    const w = documentWeights(nodes, edges);
    expect(homeDocument(w.get("secB"))).toBe("docB");
    expect(homeDocument(w.get("fouling"))).toBe("docA");
    // Described by both: it belongs to both, and the tie goes to the first by ID.
    expect([...w.get("chiller")!]).toEqual([
      ["docA", 1],
      ["docB", 1],
    ]);
    expect(homeDocument(w.get("chiller"))).toBe("docA");
    // A part named only with its equipment takes the equipment's documents.
    expect([...w.get("tubes")!.keys()].sort()).toEqual(["docA", "docB"]);
    expect(w.has("alone")).toBe(false);
  });

  it("lays out the same graph the same way, and keeps what was on screen", () => {
    const a = clusterLayout3d(nodes, edges);
    expect([...a]).toEqual([...clusterLayout3d(nodes, edges)]);
    for (const p of a.values()) expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
    const more = [...nodes, { id: "leak", type: "fault", documentId: null }];
    const after = clusterLayout3d(more, [...edges, { source: "leak", target: "secB", type: "DESCRIBED_BY" }], a);
    for (const [id, p] of a) expect(after.get(id)).toEqual(p);
  });

  it("gathers each document's sections round it in the demo library", () => {
    const g = demo.graph;
    const at = clusterLayout3d(g.nodes, g.edges);
    const docs = g.nodes.filter((n) => n.type === "document");
    const dist = (a: string, b: string) => Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y, at.get(a)!.z - at.get(b)!.z);
    const sections = g.nodes.filter((n) => n.type === "section" && docs.some((d) => d.id === n.documentId));
    let home = 0;
    for (const s of sections) {
      const nearest = docs.toSorted((a, b) => dist(s.id, a.id) - dist(s.id, b.id))[0];
      if (nearest.id === s.documentId) home++;
    }
    expect(home / sections.length).toBeGreaterThan(0.9);
  });

  it("shows only the labels that fit, most important first", () => {
    const shown = declutter(
      [
        { id: "landmark", x: 10, y: 10, w: 80, h: 18, priority: 1 },
        { id: "chosen", x: 40, y: 14, w: 80, h: 18, priority: 9 },
        { id: "clear", x: 10, y: 60, w: 80, h: 18, priority: 1 },
        { id: "outside", x: 380, y: 10, w: 80, h: 18, priority: 9 },
      ],
      400,
      300,
    );
    expect([...shown].sort()).toEqual(["chosen", "clear"]);
  });

  it("moves the keyboard to the nearest node in the arrow's direction", () => {
    const pts = [
      { id: "a", x: 100, y: 100 },
      { id: "right", x: 160, y: 110 },
      { id: "far right", x: 300, y: 100 },
      { id: "below", x: 100, y: 180 },
    ];
    expect(nearestInDirection(pts[0], pts, [1, 0])?.id).toBe("right");
    expect(nearestInDirection(pts[0], pts, [0, 1])?.id).toBe("below");
    expect(nearestInDirection(pts[0], pts, [-1, 0])).toBeUndefined();
  });
});
