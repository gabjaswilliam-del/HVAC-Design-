import { describe, expect, it } from "vitest";
import type { MemoryNode } from "../../../lib/contracts/memory";
import { demoMemory, type MemorySnapshot } from "../../../fixtures/memoryDemo";
import snapshot from "../../../fixtures/memoryDemo.json";
import { constellationLayout, hash01, pickAt, type ConstellationLayout } from "./constellation";
import { memoryTimelineLayout, type MemoryTimelineLayout } from "./timeline";

const rec = (id: string, at: string, extra: Partial<MemoryNode> = {}): MemoryNode => ({ id, type: "observation", label: id, occurredAt: at, provenance: "demo", status: "current", equipment: ["chiller_plant_2"], runId: null, ...extra });
const demo = async () => {
  const client = demoMemory(snapshot as MemorySnapshot, { latency: 0 });
  const graph = await client.getMemoryGraph({ includeSuperseded: true, limit: 120 });
  return memoryTimelineLayout(graph.nodes, graph.edges);
};
/** Pairs of spheres that overlap, in space or as seen from the front (along z). */
const overlaps = (c: ConstellationLayout, t: MemoryTimelineLayout, front: boolean) => {
  const ids = t.records.map((r) => r.id);
  const hits: string[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = [c.positions.get(ids[i])!, c.positions.get(ids[j])!];
      const d = front ? Math.hypot(a.x - b.x, a.y - b.y) : Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < c.radius.get(ids[i])! + c.radius.get(ids[j])!) hits.push(`${ids[i]}~${ids[j]}`);
    }
  return hits;
};

describe("the memory constellation", () => {
  it("places the demo records the same way every time: time across, equipment in groups spread to the display's shape", async () => {
    const t = await demo();
    for (const narrow of [false, true]) {
      const c = constellationLayout(t, { narrow });
      const again = constellationLayout(t, { narrow });
      expect([...again.positions]).toEqual([...c.positions]);
      expect(c.positions.size).toBe(13);
      // Later records lie further right.
      for (const [a, b] of t.records.slice(1).map((r, i) => [t.records[i], r])) expect(c.positions.get(b.id)!.x).toBeGreaterThanOrEqual(c.positions.get(a.id)!.x);
      // One group per equipment item, top to bottom in the timeline's order, at different depths.
      expect(c.lanes.map((l) => l.key)).toEqual(["chiller_plant_2", "cooling_towers_4", "cooling_water_pump_4"]);
      expect(c.lanes.map((l) => l.y)).toEqual([...c.lanes.map((l) => l.y)].sort((a, b) => b - a));
      expect(new Set(c.lanes.map((l) => Math.round(l.z))).size).toBe(3);
      for (const r of t.records) expect(Math.abs(c.positions.get(r.id)!.y - c.lanes.find((l) => l.key === r.lane)!.y)).toBeLessThan(c.r * 5);
      // The whole is shaped like a display, not a strip.
      const ratio = (c.max.y - c.min.y) / (c.max.x - c.min.x);
      expect(ratio, narrow ? "narrow" : "wide").toBeGreaterThan(narrow ? 0.8 : 0.45);
      expect(overlaps(c, t, false)).toEqual([]);
      expect(overlaps(c, t, true)).toEqual([]);
      // Each takes clicks a little beyond its sphere, never over another's (from the front).
      for (const a of t.records) {
        const [p, reach] = [c.positions.get(a.id)!, c.reach.get(a.id)!];
        expect(reach).toBeGreaterThanOrEqual(c.radius.get(a.id)!);
        for (const b of t.records) {
          const q = c.positions.get(b.id)!;
          if (a !== b) expect(Math.hypot(p.x - q.x, p.y - q.y), `${a.id} over ${b.id}`).toBeGreaterThanOrEqual(reach + c.radius.get(b.id)! - 1e-9);
        }
      }
    }
  });

  it("sizes by stored links, never by kind; a superseded version is smaller and sits behind the one that replaced it", async () => {
    const t = await demo();
    const c = constellationLayout(t, { narrow: false });
    // The fouling finding has four stored links; the cooling tower's observation one.
    expect(c.radius.get("mem_demo004")!).toBeGreaterThan(c.radius.get("mem_demo015")!);
    expect(c.radius.get("mem_demo002")!).toBeLessThan(c.r);
    const [now, old] = [c.positions.get("mem_demo003")!, c.positions.get("mem_demo002")!];
    expect(old.x).toBe(now.x);
    expect(old.y).toBeLessThan(now.y);
    expect(old.z).toBeLessThan(now.z);
  });

  it("puts each group's name before the first record, a run's name above its records, and the dates below everything", async () => {
    const t = await demo();
    const c = constellationLayout(t, { narrow: false });
    const xs = [...c.positions.values()].map((p) => p.x);
    for (const l of c.lanes) expect(c.laneAnchor.get(l.key)!.x).toBeLessThan(Math.min(...xs));
    for (const run of c.runs) {
      const run0 = t.runs.find((r) => r.id === run.id)!;
      for (const id of run0.records) expect(run.anchor.y).toBeGreaterThan(c.positions.get(id)!.y);
    }
    expect(c.days.map((d) => d.day)).toEqual(t.days.map((d) => d.day));
    for (const d of c.days) expect(d.anchor.y).toBeLessThan(c.min.y);
  });

  it("stacks records at one moment below one another, each clear of the one above", () => {
    // Two current records and a superseded version at the same moment, on one line.
    const at = "2026-10-01T09:00:00Z";
    const nodes = [rec("a", at), rec("b", at), rec("c", at, { status: "superseded" }), rec("d", "2026-10-01T12:00:00Z")];
    const t = memoryTimelineLayout(nodes, []);
    expect(t.records.map((r) => r.row)).toEqual([0, 1, 2, 0]);
    for (const narrow of [false, true]) {
      const c = constellationLayout(t, { narrow });
      const [a, b, old] = ["a", "b", "c"].map((id) => c.positions.get(id)!);
      expect(b.x).toBe(a.x);
      expect(old.x).toBe(a.x);
      expect(b.y).toBeLessThan(a.y);
      expect(old.y).toBeLessThan(b.y);
      expect(old.z).toBeLessThan(b.z);
      expect(overlaps(c, t, true), narrow ? "narrow" : "wide").toEqual([]);
      expect(overlaps(c, t, false), narrow ? "narrow" : "wide").toEqual([]);
    }
  });

  it("keeps a burst of records in its own group, however long, none hiding another", () => {
    const at = (day: number, hour: number) => `2026-10-${String(1 + day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`;
    const on = (eq: string) => ({ equipment: [eq] });
    for (const [name, nodes] of [
      // An afternoon's session: a tower record, then four chiller records an hour apart.
      ["four hourly", [rec("t0", at(0, 8), on("tower")), ...[9, 10, 11, 12].map((h, i) => rec(`c${i}`, at(0, h), on("chiller")))]],
      // Eight hourly records on the chiller between the tower's and the pump's.
      ["eight hourly", [rec("t0", at(0, 6), on("tower")), rec("t1", at(0, 7), on("tower")), rec("p0", at(0, 7), on("pump")), rec("p1", at(0, 8), on("pump")), ...Array.from({ length: 8 }, (_, i) => rec(`c${i}`, at(0, 9 + i), on("chiller")))]],
      // One a day for eight days (close together on a phone).
      ["eight daily", [rec("t0", at(1, 12), on("tower")), rec("t1", at(5, 12), on("tower")), rec("p0", at(2, 15), on("pump")), rec("p1", at(6, 15), on("pump")), ...Array.from({ length: 8 }, (_, i) => rec(`c${i}`, at(i, 9), on("chiller")))]],
      // Hourly records, two at one moment, beside another group's record at that moment.
      ["dense", [...[0, 1, 2, 3, 4].map((h) => rec(`a${h}`, at(0, 9 + h), on("chiller"))), rec("a4b", at(0, 13), on("chiller")), rec("b4", at(0, 13), on("tower"))]],
    ] as const) {
      const t = memoryTimelineLayout(nodes, []);
      for (const narrow of [false, true]) {
        const c = constellationLayout(t, { narrow });
        const shape = `${name}, ${narrow ? "narrow" : "wide"}`;
        for (const r of t.records) {
          const y = c.positions.get(r.id)!.y;
          const nearest = c.lanes.reduce((a, l) => (Math.abs(l.y - y) < Math.abs(a.y - y) ? l : a));
          expect(nearest.key, `${shape}: ${r.id} reads as its own group's`).toBe(r.lane);
        }
        expect(overlaps(c, t, true), shape).toEqual([]);
        expect(overlaps(c, t, false), shape).toEqual([]);
      }
    }
  });

  it("never lets two spheres meet, and keeps every record in its own group, in crowded sets", () => {
    // 300 sets drawn from a fixed seed: 2-5 groups, 4-17 records within a week (minutes apart
    // at the closest), about one link each, some versions superseded at their moment.
    let seed = 777;
    const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
    const start = Date.parse("2026-10-01T08:00:00Z");
    for (let set = 0; set < 300; set++) {
      const groups = 2 + Math.floor(random() * 4);
      const count = 4 + Math.floor(random() * 14);
      const span = [120, 480, 1440, 4320, 10080][Math.floor(random() * 5)];
      const used = new Set<number>();
      const nodes: MemoryNode[] = [];
      for (let i = 0; i < count; i++) {
        let t;
        do t = start + Math.floor(random() * span) * 60_000;
        while (used.has(t));
        used.add(t);
        const equipment = [`eq${Math.floor(random() * groups)}`];
        nodes.push(rec(`r${i}`, new Date(t).toISOString(), { equipment }));
        if (random() < 0.2) nodes.push(rec(`s${i}`, new Date(t).toISOString(), { equipment, status: "superseded" }));
      }
      const current = nodes.filter((m) => m.status === "current");
      const links = Array.from({ length: count }, (_, k) => [current[Math.floor(random() * current.length)], current[Math.floor(random() * current.length)], k] as const)
        .filter(([a, b]) => a !== b)
        .map(([a, b, k]) => ({ id: `l${k}`, type: "SUPPORTED_BY" as const, source: a.id, target: b.id }));
      const t = memoryTimelineLayout(nodes, links);
      for (const narrow of [false, true]) {
        const c = constellationLayout(t, { narrow });
        const shape = `set ${set}, ${narrow ? "narrow" : "wide"}`;
        expect(overlaps(c, t, false), shape).toEqual([]);
        for (const r of t.records) {
          const y = c.positions.get(r.id)!.y;
          const nearest = c.lanes.reduce((a, l) => (Math.abs(l.y - y) < Math.abs(a.y - y) ? l : a));
          expect(nearest.key, `${shape}: ${r.id}`).toBe(r.lane);
        }
      }
    }
  });

  it("sizes a record by its stored links wherever it sits, stacked at one moment included", () => {
    const at = "2026-10-01T09:00:00Z";
    const nodes = [rec("p", at), rec("q", at), rec("x1", "2026-10-01T11:00:00Z"), rec("x2", "2026-10-01T12:00:00Z")];
    const links = [
      { id: "l1", type: "SUPPORTED_BY", source: "q", target: "x1" },
      { id: "l2", type: "SUPPORTED_BY", source: "q", target: "x2" },
    ] as const;
    const t = memoryTimelineLayout(nodes, links);
    expect(t.records.find((r) => r.id === "q")!.row).toBe(1);
    const c = constellationLayout(t, { narrow: false });
    expect(c.radius.get("q")!).toBeGreaterThan(c.radius.get("x1")!);
    expect(c.radius.get("x1")!).toBeGreaterThan(c.radius.get("p")!);
  });

  it("keeps records a minute apart from hiding one another, stepping up and down in turn", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => rec(`r${i}`, `2026-10-01T09:0${i}:00Z`));
    const t = memoryTimelineLayout(nodes, []);
    for (const narrow of [false, true]) {
      const c = constellationLayout(t, { narrow });
      expect(overlaps(c, t, true), narrow ? "narrow" : "wide").toEqual([]);
      // Still in time order across the view.
      const xs = t.records.map((r) => c.positions.get(r.id)!.x);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
    }
  });

  it("has a place for an empty set, a single record and a record about no equipment", () => {
    const empty = constellationLayout(memoryTimelineLayout([], []), { narrow: false });
    expect(empty.positions.size).toBe(0);
    for (const v of [empty.min.x, empty.max.x, empty.min.y, empty.max.y]) expect(Number.isFinite(v)).toBe(true);
    const one = constellationLayout(memoryTimelineLayout([rec("solo", "2026-10-01T09:00:00Z", { equipment: [] })], []), { narrow: true });
    expect(one.lanes.map((l) => l.kind)).toEqual(["none"]);
    const p = one.positions.get("solo")!;
    for (const v of [p.x, p.y, p.z]) expect(Number.isFinite(v)).toBe(true);
  });

  it("derives its small offsets from the record's ID alone", () => {
    expect(hash01("mem_demo004")).toBe(hash01("mem_demo004"));
    expect(hash01("mem_demo004")).not.toBe(hash01("mem_demo003"));
    for (const id of ["a", "mem_demo001", "x".repeat(40)]) expect(hash01(id)).toBeGreaterThanOrEqual(0), expect(hash01(id)).toBeLessThan(1);
  });

  it("takes a press for the sphere drawn under it before a nearer record's wider click area", () => {
    // Seen from close by, a nearer record's click area reaches over a sphere behind it.
    const spheres = [
      { id: "chosen", x: 100, y: 100, r: 40, reach: 40, depth: 600 },
      { id: "nearer", x: 160, y: 100, r: 15, reach: 45, depth: 500 },
    ];
    expect(pickAt(spheres, 130, 100), "on the chosen sphere, in the other's area").toBe("chosen");
    expect(pickAt(spheres, 150, 100), "on both spheres: the nearer").toBe("nearer");
    expect(pickAt(spheres, 160, 130), "in a click area only").toBe("nearer");
    expect(pickAt(spheres, 100, 200), "on nothing").toBeNull();
    expect(pickAt([], 0, 0)).toBeNull();
  });
});
