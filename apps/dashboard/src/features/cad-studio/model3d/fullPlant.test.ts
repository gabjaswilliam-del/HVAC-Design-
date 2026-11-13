import { describe, expect, it } from "vitest";
import { demoScene, demoTopology } from "../../../fixtures/demoPlant";
import { linkMedium } from "../../../lib/topology";
import { traceFor } from "../Workbench";
import { BUILDERS, buildFitting, type Part } from "./kit";
import { nozzle, plantModel } from "./plantModel";

const model = plantModel(demoTopology, demoScene);

describe("complete M3b plant", () => {
  it("maps every prepared device, connection, bypass, valve and sensor without invented entities", () => {
    expect(model.equipment).toHaveLength(16);
    expect(new Set(model.equipment.map((equipment) => equipment.id)).size).toBe(16);
    expect(model.runs.filter((run) => !run.header)).toHaveLength(31);
    expect(new Set(model.runs.filter((run) => run.header).map((run) => run.owner)).size).toBe(6);
    expect(model.fittings).toHaveLength(20);
    expect(model.fittings.filter((fitting) => fitting.kind === "valve")).toHaveLength(13);
    expect(model.fittings.filter((fitting) => fitting.kind === "sensor")).toHaveLength(7);
    expect(model.equipment.filter((equipment) => equipment.standby).map((equipment) => equipment.id)).toEqual([
      "cooling_water_pump_4",
      "chilled_water_pump_pri_4",
    ]);
  });

  it("connects every branch to the recorded device nozzles and preserves media and uncertainty", () => {
    for (const link of demoTopology.links) {
      const run = model.runs.find((candidate) => candidate.owner === link.id)!;
      expect(run.system).toBe(link.medium);
      expect(run.medium).toBe(link.evidence === "unknown" ? "unknown" : linkMedium(link));
      expect(run.unknown).toBe(link.evidence === "unknown");
      expect(run.points.length).toBeGreaterThanOrEqual(2);
      if ("device" in link.from) expect(run.points[0]).toEqual(nozzle(demoScene, link.from.device, link.from.port).p);
      if ("device" in link.to) expect(run.points.at(-1)).toEqual(nozzle(demoScene, link.to.device, link.to.port).p);
      expect(run.points.every((point) => point.every(Number.isFinite))).toBe(true);
    }
    expect(model.runs.filter((run) => run.unknown).map((run) => run.owner)).toEqual(["cooling_water_pump_4_cw_supply"]);
  });

  it("builds finite geometry for every equipment type and fitting with stable owners", () => {
    for (const equipment of model.equipment) {
      const build = BUILDERS[equipment.kind]!;
      const parts: Part[] = [];
      build(parts, equipment);
      expect(parts.length).toBeGreaterThan(2);
      expect(parts.every((part) => part.owner === equipment.id)).toBe(true);
      for (const part of parts) {
        part.geometry.computeBoundingBox();
        const bounds = part.geometry.boundingBox!;
        expect([bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)).toBe(true);
        part.geometry.dispose();
      }
    }
    for (const fitting of model.fittings) {
      const parts: Part[] = [];
      buildFitting(parts, fitting);
      expect(parts.length).toBeGreaterThan(0);
      const layer = fitting.kind === "valve" ? "valves" : "instruments";
      expect(parts.every((part) => part.owner === fitting.owner && part.layer === layer)).toBe(true);
      for (const part of parts) part.geometry.dispose();
    }
  });

  it("traces selected equipment through its recorded links and preserves unknown connections", () => {
    const ids = traceFor({ kind: "device", id: "chiller_plant_2" }, demoTopology);
    expect(ids).toContain("chiller_plant_2");
    expect(ids).toContain("chiller_plant_2_chilled_water_pump_pri_2");
    expect(ids).toContain("chilled_water_pump_pri_2_chw_supply");
    expect(ids).toContain("chw_return_chiller_plant_2");
    expect(ids).toContain("chw_supply");
    expect(ids).toContain("chw_return");
    expect(ids).not.toContain("cooling_water_pump_4_cw_supply");
    const unknown = traceFor({ kind: "device", id: "chilled_water_pump_pri_4" }, demoTopology);
    expect(unknown).toContain("chilled_water_pump_pri_4_chw_supply");
    expect(unknown).toContain("chilled_water_pump_pri_4");
    expect(traceFor({ kind: "link", id: "cooling_water_pump_4_cw_supply" }, demoTopology)).toEqual(new Set([
      "cooling_water_pump_4_cw_supply",
      "cooling_water_pump_4",
      "cw_supply",
    ]));
  });
});
