import { describe, expect, it } from "vitest";
import demo from "../../../fixtures/knowledgeDemo.json";
import { declutter, documentWeights, forceLayout, homeDocument, nearestInDirection, nodeRadius, planetaryLayout, SYSTEM_GAP, timeLayout, type LayoutNode, type PlanetaryLayout, type Point3 } from "./layout";

const ids = Array.from({ length: 40 }, (_, i) => `n${i}`);
const edges = ids.slice(1).map((id, i) => ({ source: ids[Math.floor(i / 3)], target: id }));

type Library = { nodes: LayoutNode[]; edges: { source: string; target: string; type: string }[] };
/** A synthetic library: four sections per document and `counts[d]` entities described by
 *  document d, every third by the next document too; degrees from the links. */
function library(counts: number[]): Library {
  const doc = (d: number) => `d${String(d % counts.length).padStart(2, "0")}`;
  const nodes: LayoutNode[] = [];
  const edges: Library["edges"] = [];
  counts.forEach((count, d) => {
    nodes.push({ id: doc(d), type: "document", documentId: doc(d), degree: 0 });
    for (let s = 0; s < 4; s++) {
      nodes.push({ id: `${doc(d)}s${s}`, type: "section", documentId: doc(d), degree: 0 });
      edges.push({ source: `${doc(d)}s${s}`, target: doc(d), type: "PART_OF" });
    }
    for (let i = 0; i < count; i++) {
      const id = `${doc(d)}e${String(i).padStart(3, "0")}`;
      nodes.push({ id, type: ["equipment", "component", "fault", "symptom"][i % 4], documentId: null, degree: 0 });
      edges.push({ source: id, target: `${doc(d)}s${i % 4}`, type: "DESCRIBED_BY" });
      if (i % 3 === 2) edges.push({ source: id, target: `${doc(d + 1)}s${i % 4}`, type: "DESCRIBED_BY" });
    }
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) byId.get(e.source)!.degree++, byId.get(e.target)!.degree++;
  return { nodes, edges };
}
/** The part of a library on screen. */
const view = (g: Library, shown: ReadonlySet<string>) => [g.nodes.filter((n) => shown.has(n.id)), g.edges.filter((e) => shown.has(e.source) && shown.has(e.target))] as const;
const dist = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** No two spheres touch, and every node is nearer its own system's centre than any other's. */
function expectSpacious(at: PlanetaryLayout, all: readonly LayoutNode[]) {
  const nodes = all.filter((n) => at.positions.has(n.id));
  const pos = (id: string) => at.positions.get(id)!;
  let touching = 0;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) if (dist(pos(nodes[i].id), pos(nodes[j].id)) < nodeRadius(nodes[i].type, nodes[i].degree) + nodeRadius(nodes[j].type, nodes[j].degree)) touching++;
  expect(touching).toBe(0);
  for (const n of nodes) {
    const own = at.systems.find((s) => s.doc === at.home.get(n.id))!;
    const nearest = at.systems.toSorted((a, b) => dist(pos(n.id), a.center) - dist(pos(n.id), b.center))[0];
    expect(nearest.doc, n.id).toBe(own.doc);
  }
}

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
    { id: "docA", type: "document", documentId: "docA", degree: 2 },
    { id: "docB", type: "document", documentId: "docB", degree: 1 },
    { id: "secA", type: "section", documentId: "docA", degree: 3 },
    { id: "secB", type: "section", documentId: "docB", degree: 2 },
    { id: "chiller", type: "equipment", documentId: null, degree: 3 },
    { id: "fouling", type: "fault", documentId: null, degree: 1 },
    { id: "tubes", type: "component", documentId: null, degree: 1 },
    { id: "alone", type: "concept", documentId: null, degree: 0 },
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

  it("lays out the same graph the same way, as planetary systems, and keeps what was on screen", () => {
    const a = planetaryLayout(nodes, edges);
    expect([...a.positions]).toEqual([...planetaryLayout(nodes, edges).positions]);
    for (const p of a.positions.values()) expect([p.x, p.y, p.z].every(Number.isFinite)).toBe(true);
    // Every node is drawn once, in one system: the document that describes it most.
    expect(a.systems.flatMap((s) => s.members).sort()).toEqual(nodes.map((n) => n.id).sort());
    expect(a.home.get("chiller")).toBe("docA");
    expect(a.home.get("alone")).toBe("");
    expect(a.shared.get("chiller")).toBe(1);
    expect(a.shared.get("fouling")).toBe(0);
    // The document is the planet at its system's centre.
    const sysA = a.systems.find((s) => s.doc === "docA")!;
    expect(a.positions.get("docA")).toEqual(sysA.center);
    // A node other documents describe too leans towards their system.
    const sysB = a.systems.find((s) => s.doc === "docB")!;
    expect(Math.sign(a.positions.get("chiller")!.x - sysA.center.x)).toBe(Math.sign(sysB.center.x - sysA.center.x));
    // Growing the graph keeps every node where it was.
    const more = [...nodes, { id: "leak", type: "fault", documentId: null, degree: 1 }];
    const after = planetaryLayout(more, [...edges, { source: "leak", target: "secB", type: "DESCRIBED_BY" }], a);
    for (const [id, p] of a.positions) expect(after.positions.get(id)).toEqual(p);
    expect(after.home.get("leak")).toBe("docB");
    expect(after.systems.find((s) => s.doc === "docB")!.members).toContain("leak");
  });

  it("separates the demo library into spacious systems, each round its own document", () => {
    const g = demo.graph;
    const at = planetaryLayout(g.nodes, g.edges);
    const pos = (id: string) => at.positions.get(id)!;
    const docs = g.nodes.filter((n) => n.type === "document");
    expect(at.systems).toHaveLength(docs.length);
    // Every node is nearer its own document than any other, and inside its system.
    for (const n of g.nodes) {
      const own = at.home.get(n.id)!;
      const nearest = docs.toSorted((a, b) => dist(pos(n.id), pos(a.id)) - dist(pos(n.id), pos(b.id)))[0];
      expect(nearest.id, n.label).toBe(own);
      const sys = at.systems.find((s) => s.doc === own)!;
      expect(dist(pos(n.id), sys.center)).toBeLessThanOrEqual(sys.radius);
    }
    // Systems keep their distance; no two spheres come near touching.
    for (const a of at.systems) for (const b of at.systems) if (a !== b) expect(dist(a.center, b.center) - a.radius - b.radius).toBeGreaterThan(SYSTEM_GAP * 0.9);
    let tightest = Infinity;
    for (const a of g.nodes)
      for (const b of g.nodes) if (a.id < b.id) tightest = Math.min(tightest, dist(pos(a.id), pos(b.id)) - nodeRadius(a.type, a.degree) - nodeRadius(b.type, b.degree));
    expect(tightest).toBeGreaterThan(8);
    // Documents are the largest spheres, supporting nodes the smallest.
    expect(nodeRadius("document", 2)).toBeGreaterThan(2 * nodeRadius("equipment", 15));
    expect(nodeRadius("section", 3)).toBeLessThan(nodeRadius("equipment", 3));
    // On a phone, two systems to a row.
    const phone = planetaryLayout(g.nodes, g.edges, null, 2);
    expect(new Set(phone.systems.map((s) => s.center.y)).size).toBe(3);
    // Sections evenly round their planet (places apart differ by one at most), in outline order.
    for (const s of at.systems) {
      const o = s.orbits.find((x) => x.kind === "sections")!;
      const held = o.held.flatMap((id, i) => (id ? [i] : []));
      const apart = held.map((i, k) => (held[(k + 1) % held.length] - i + o.slots.length) % o.slots.length || o.slots.length);
      expect(Math.max(...apart) - Math.min(...apart)).toBeLessThanOrEqual(1);
      expect(held.map((i) => o.held[i])).toEqual(held.map((i) => o.held[i]).toSorted());
    }
  });

  it("grows to the 300-node cap without moving or crowding anything, and reuses the places nodes leave", () => {
    const g = library(Array(12).fill(20));
    const order = g.nodes.toSorted((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
    const shown = new Set(order.slice(0, 150).map((n) => n.id));
    let at = planetaryLayout(...view(g, shown));
    for (let step = 0; step < 4; step++) {
      for (const n of order.slice(150 + step * 38, 188 + step * 38)) shown.add(n.id);
      const next = planetaryLayout(...view(g, shown), at);
      for (const [id, p] of at.positions) expect(next.positions.get(id)).toEqual(p);
      at = next;
    }
    expect(at.positions.size).toBe(300);
    expectSpacious(at, g.nodes);
    // Choosing nodes in turn swaps their neighbours in and out: the places they leave are
    // taken again, so the systems stop growing and never need rings in depth.
    const base = order.slice(0, 150).map((n) => n.id);
    const orbits = (l: PlanetaryLayout) => l.systems.flatMap((s) => s.orbits);
    let session = planetaryLayout(...view(g, new Set(base)));
    const counts: number[] = [];
    for (let round = 0; round < 8; round++) {
      const extra = round % 2 ? order.slice(150, 190) : order.slice(190, 230);
      session = planetaryLayout(...view(g, new Set([...base, ...extra.map((n) => n.id)])), session);
      counts.push(orbits(session).length);
    }
    expect(counts.at(-1)).toBe(counts[1]);
    expect(orbits(session).some((o) => o.depth)).toBe(false);
  });

  it("stacks rings in depth only for a system with no room left beside its neighbours", () => {
    // The sixth largest of twelve sits in the middle of a 3 x 4 grid; 150 entities arrive late.
    const g = library([20, 20, 20, 20, 20, 162, 8, 8, 8, 8, 8, 8]);
    const late = (id: string) => id.startsWith("d05e") && Number(id.slice(4)) >= 12;
    const before = planetaryLayout(...view(g, new Set(g.nodes.filter((n) => !late(n.id)).map((n) => n.id))));
    const sys = (l: PlanetaryLayout) => l.systems.find((s) => s.doc === "d05")!;
    expect(before.systems.indexOf(sys(before))).toBe(5);
    let at = before;
    const ids = new Set(before.positions.keys());
    for (const chunk of [0, 1, 2, 3]) {
      for (const n of g.nodes.filter((x) => late(x.id)).slice(chunk * 40, chunk * 40 + 40)) ids.add(n.id);
      at = planetaryLayout(...view(g, ids), at);
    }
    for (const [id, p] of before.positions) expect(at.positions.get(id)).toEqual(p);
    expect(sys(at).orbits.some((o) => o.depth)).toBe(true);
    expectSpacious(at, g.nodes);
  });

  it("puts names where they fit, most important first, trying each place in turn", () => {
    const shown = declutter(
      [
        { id: "landmark", x: 10, y: 10, w: 80, h: 18, priority: 1 },
        { id: "chosen", x: 40, y: 14, w: 80, h: 18, priority: 9 },
        { id: "clear", x: 10, y: 60, w: 80, h: 18, priority: 1 },
        { id: "outside", x: 380, y: 10, w: 80, h: 18, priority: 9 },
        // Taken below, so it goes to its second place.
        { id: "moved", x: 40, y: 20, w: 60, h: 18, priority: 5, alt: [[200, 200]] },
      ],
      400,
      300,
    );
    expect([...shown.keys()].sort()).toEqual(["chosen", "clear", "moved"]);
    expect(shown.get("moved")).toEqual([200, 200]);
    // A planet is an obstacle for every name but its own.
    const planet = { id: "doc", x: 100, y: 100, w: 60, h: 60 };
    const around = declutter(
      [
        { id: "doc", x: 110, y: 120, w: 50, h: 18, priority: 9 },
        { id: "other", x: 110, y: 120, w: 50, h: 18, priority: 1, alt: [[10, 10]] },
      ],
      400,
      300,
      3,
      [planet],
    );
    expect(around.get("doc")).toEqual([110, 120]);
    expect(around.get("other")).toEqual([10, 10]);
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
