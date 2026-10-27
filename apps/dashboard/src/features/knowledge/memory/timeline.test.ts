import { describe, expect, it } from "vitest";
import type { MemoryEdge, MemoryNode } from "../../../lib/contracts/memory";
import { demoMemory, type MemorySnapshot } from "../../../fixtures/memoryDemo";
import snapshot from "../../../fixtures/memoryDemo.json";
import { BREAK_HOURS, MIN_GAP, chainOf, linkedTo, memoryTimelineLayout, parseDays, span } from "./timeline";

const rec = (id: string, at: string, extra: Partial<MemoryNode> = {}): MemoryNode => ({ id, type: "observation", label: id, occurredAt: at, provenance: "demo", status: "current", equipment: ["chiller_plant_2"], runId: null, ...extra });

describe("the memory timeline", () => {
  it("places records in their order in time, closer moments closer, never nearer than the minimum", () => {
    const nodes = [rec("c", "2026-10-02T10:00:00Z"), rec("a", "2026-10-01T06:00:00Z"), rec("b", "2026-10-01T06:30:00Z"), rec("d", "2026-10-02T10:00:00Z", { equipment: ["cooling_towers_4"] })];
    const { records, width } = memoryTimelineLayout(nodes, []);
    expect(records.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    const x = Object.fromEntries(records.map((r) => [r.id, r.x]));
    expect(x.a).toBe(0);
    expect(x.b - x.a).toBeGreaterThanOrEqual(MIN_GAP);
    // 28 hours apart is drawn wider than half an hour, and the same moment at the same place.
    expect(x.c - x.b).toBeGreaterThan(x.b - x.a);
    expect(x.d).toBe(x.c);
    expect(width).toBe(x.c);
  });

  it("draws a long quiet stretch at a cap and marks it, instead of leaving days of space", () => {
    const nodes = [rec("a", "2026-09-01T00:00:00Z"), rec("b", "2026-09-20T00:00:00Z"), rec("c", "2026-09-30T00:00:00Z")];
    const { records, breaks, days } = memoryTimelineLayout(nodes, []);
    expect(records[1].x - records[0].x).toBe(span(BREAK_HOURS));
    expect(records[2].x - records[1].x).toBe(span(BREAK_HOURS));
    expect(breaks.map((b) => Math.round(b.hours / 24))).toEqual([19, 10]);
    // Days are marked where records are, not inside the breaks.
    expect(days.map((d) => d.day)).toEqual(["2026-09-01", "2026-09-20", "2026-09-30"]);
  });

  it("puts runs first, equipment in the order it appears, records about nothing last; stacks a superseded version under its successor", () => {
    const nodes = [
      rec("old", "2026-10-01T09:00:00Z", { status: "superseded" }),
      rec("new", "2026-10-01T09:00:00Z"),
      rec("tower", "2026-10-01T07:00:00Z", { equipment: ["cooling_towers_4", "chiller_plant_2"], runId: "RUN-1", provenance: "simulation" }),
      rec("loose", "2026-10-02T07:00:00Z", { equipment: [] }),
      { id: "equipment:chiller_plant_2", type: "equipment", label: "chiller_plant_2" } as MemoryNode,
      { id: "run:RUN-1", type: "simulation_run", label: "RUN-1" } as MemoryNode,
    ];
    const { records, lanes, runs } = memoryTimelineLayout(nodes, []);
    expect(lanes.map((l) => l.key)).toEqual(["runs", "cooling_towers_4", "chiller_plant_2", "none"]);
    const by = Object.fromEntries(records.map((r) => [r.id, r]));
    expect([by.new.row, by.old.row]).toEqual([0, 1]);
    expect(lanes.find((l) => l.key === "chiller_plant_2")!.rows).toBe(2);
    expect(by.tower.lane).toBe("cooling_towers_4");
    expect(by.tower.echoes).toEqual(["chiller_plant_2"]);
    expect(by.loose.lane).toBe("none");
    expect(runs).toEqual([{ id: "run:RUN-1", runId: "RUN-1", x0: by.tower.x, x1: by.tower.x, records: ["tower"] }]);
  });

  it("draws only stored links and versions between records shown, and follows chains through stored links only", () => {
    const nodes = [rec("a", "2026-10-01T06:00:00Z"), rec("b", "2026-10-01T07:00:00Z"), rec("c", "2026-10-01T08:00:00Z"), rec("d", "2026-10-01T09:00:00Z"), rec("v0", "2026-10-01T09:00:00Z", { status: "superseded" })];
    const edges: MemoryEdge[] = [
      { id: "1", type: "SUPPORTED_BY", source: "b", target: "a" },
      { id: "2", type: "RESOLVED_BY", source: "b", target: "c" },
      { id: "3", type: "SUPERSEDES", source: "d", target: "v0" },
      { id: "4", type: "OCCURRED_BEFORE", source: "a", target: "b", derived: true },
      { id: "5", type: "RELATES_TO", source: "a", target: "equipment:chiller_plant_2" },
      { id: "6", type: "RESULTED_IN", source: "c", target: "gone" },
    ];
    const { links } = memoryTimelineLayout(nodes, edges);
    expect(links.map((l) => l.id)).toEqual(["1", "2", "3"]);
    expect([...linkedTo("b", links)].sort()).toEqual(["a", "c"]);
    expect([...linkedTo("d", links)]).toEqual(["v0"]);
    expect([...chainOf("a", links)].sort()).toEqual(["a", "b", "c"]);
    expect([...chainOf("d", links)]).toEqual(["d"]);
  });

  it("lays out the demo records: every one in place, the stored links, the chain of the Chiller 2 fouling", async () => {
    const client = demoMemory(snapshot as MemorySnapshot, { latency: 0 });
    const graph = await client.getMemoryGraph({ includeSuperseded: true, limit: 120 });
    const t = memoryTimelineLayout(graph.nodes, graph.edges);
    expect(t.records).toHaveLength(13);
    expect(t.lanes.map((l) => l.key)).toEqual(["runs", "chiller_plant_2", "cooling_towers_4", "cooling_water_pump_4"]);
    expect(t.links.filter((l) => l.type !== "SUPERSEDES")).toHaveLength(9);
    expect(t.links.filter((l) => l.type === "SUPERSEDES").map((l) => [l.source, l.target])).toEqual([["mem_demo003", "mem_demo002"]]);
    expect(t.runs.map((r) => r.runId)).toEqual(["RUN-0002", "RUN-0003"]);
    expect(t.days.map((d) => d.day)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    // Positions only grow with time, and days fall between the records around them.
    for (const [a, b] of t.records.slice(1).map((r, i) => [t.records[i], r])) expect(b.x).toBeGreaterThanOrEqual(a.x);
    for (const d of t.days) expect(t.xAt(Date.parse(`${d.day}T00:00:00Z`))).toBe(d.x);
    expect([...chainOf("mem_demo004", t.links)].sort()).toEqual(["mem_demo001", "mem_demo003", "mem_demo004", "mem_demo007", "mem_demo009", "mem_demo011", "mem_demo013"]);
  });
});

describe("dates typed in the memory search", () => {
  it("reads a day or a range in UTC, with the year given when none is typed", () => {
    expect(parseDays("2026-09-29", 2026)).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(parseDays("29 Sep", 2026)).toEqual({ from: "2026-09-29", to: "2026-09-29" });
    expect(parseDays("Sep 29, 2025", 2026)).toEqual({ from: "2025-09-29", to: "2025-09-29" });
    expect(parseDays("28 sept to 1 oct", 2026)).toEqual({ from: "2026-09-28", to: "2026-10-01" });
    expect(parseDays("2026-09-28..2026-10-01", 2026)).toEqual({ from: "2026-09-28", to: "2026-10-01" });
    expect(parseDays("2026-09-28 – 2026-10-01", 2026)).toEqual({ from: "2026-09-28", to: "2026-10-01" });
  });

  it("refuses what is not a date, an impossible day, and a range that runs backwards", () => {
    for (const q of ["fouling", "chiller 2", "31 Sep", "2026-13-01", "1 Oct to 28 Sep", "sep", "29"]) expect(parseDays(q, 2026), q).toBeNull();
  });
});
