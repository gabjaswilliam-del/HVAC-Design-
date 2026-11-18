import { describe, expect, it } from "vitest";
import { demoTopology } from "../../fixtures/demoPlant";
import type { Topology } from "../../lib/contracts";
import { changeMarks, diffTopologies } from "./diff";

const copy = (): Topology => structuredClone(demoTopology);

describe("diffTopologies", () => {
  it("finds nothing between a topology and itself", () => {
    const diff = diffTopologies(demoTopology, copy());
    expect(diff.total).toBe(0);
    expect(changeMarks(diff).size).toBe(0);
  });

  it("reports added, removed and changed connections, equipment evidence and ports", () => {
    const reference = copy();
    const target = copy();
    const unknown = target.links.find((link) => link.evidence === "unknown")!;
    unknown.evidence = "confirmed";
    const removed = target.links.splice(target.links.findIndex((link) => link.evidence === "confirmed"), 1)[0];
    const port = target.unconnectedPorts.shift()!;
    target.links.push({ id: "manual_x", from: { device: "chiller_plant_2", port: "evap_out" }, to: { device: port.device, port: port.port }, medium: "chw", evidence: "confirmed" });
    target.devices[0] = { ...target.devices[0], evidence: target.devices[0].evidence === "unknown" ? "confirmed" : "unknown" };

    const diff = diffTopologies(reference, target);
    expect(diff.links.added.map((link) => link.id)).toEqual(["manual_x"]);
    expect(diff.links.removed.map((link) => link.id)).toEqual([removed.id]);
    expect(diff.links.changed).toEqual([{ before: reference.links.find((link) => link.id === unknown.id), after: unknown, fields: ["evidence"] }]);
    expect(diff.devices.changed.map(({ after }) => after.id)).toEqual([target.devices[0].id]);
    expect(diff.ports).toEqual({ resolved: [port], opened: [] });
    expect(diff.total).toBe(5);

    const marks = changeMarks(diff);
    expect(marks.get("manual_x")).toBe("added");
    expect(marks.get(removed.id)).toBe("removed");
    expect(marks.get(unknown.id)).toBe("changed");
    expect(marks.get(`${port.device}:${port.port}`)).toBe("changed");
  });

  it("is directional: swapping the sides swaps added and removed", () => {
    const target = copy();
    const port = target.unconnectedPorts.shift()!;
    const forward = diffTopologies(demoTopology, target);
    const backward = diffTopologies(target, demoTopology);
    expect(forward.ports.resolved).toEqual([port]);
    expect(backward.ports.opened).toEqual([port]);
  });
});
