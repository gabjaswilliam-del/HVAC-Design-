import { describe, expect, it } from "vitest";
import { demoScene, demoTopology } from "../../../fixtures/demoPlant";
import { BUILDERS, buildChiller, buildPump, type Part } from "./kit";
import { clean, M3A_EQUIPMENT, plantModel } from "./plantModel";

const model = plantModel(demoTopology, demoScene, M3A_EQUIPMENT);

describe("M3a plant model", () => {
  it("maps only the selected chiller and chilled-water pump from topology and scene layout", () => {
    expect(model.equipment.map((equipment) => equipment.id)).toEqual([...M3A_EQUIPMENT]);
    for (const equipment of model.equipment) {
      const node = demoScene.nodes[equipment.id];
      expect(equipment).toMatchObject({ kind: node.kind, x: node.x, z: node.y, flip: !!node.flip });
      expect(BUILDERS[equipment.kind]).toBeTypeOf("function");
    }
  });

  it("keeps only their four branch connections and the three relevant header segments", () => {
    expect(model.runs.filter((run) => !run.header).map((run) => run.owner)).toEqual([
      "chiller_plant_1_cw_return",
      "chiller_plant_1_chilled_water_pump_pri_1",
      "chilled_water_pump_pri_1_chw_supply",
      "chw_return_chiller_plant_1",
    ]);
    expect(model.runs.filter((run) => run.header).map((run) => run.owner).sort()).toEqual(["chw_return", "chw_supply", "cw_return"]);
    expect(model.runs.every((run) => run.medium.startsWith("chw-") || run.medium.startsWith("cw-"))).toBe(true);
    for (const run of model.runs) {
      expect(run.points.length).toBeGreaterThanOrEqual(2);
      expect(run.points.every((point) => point.every(Number.isFinite))).toBe(true);
    }
  });

  it("routes the pump discharge vertically before following the header level", () => {
    const run = model.runs.find((candidate) => candidate.owner === "chilled_water_pump_pri_1_chw_supply")!;
    expect(run.points[0][1]).toBe(31);
    expect(run.points[1]).toEqual([run.points[0][0], 58, run.points[0][2]]);
    expect(run.points.at(-1)).toEqual([1080, 58, 317]);
  });

  it("removes repeated and straight-through points without dropping the endpoints", () => {
    expect(clean([[0, 0, 0], [0, 0, 0], [10, 0, 0], [20, 0, 0], [20, 10, 0]])).toEqual([[0, 0, 0], [20, 0, 0], [20, 10, 0]]);
    expect(clean([[0, 0, 0], [10, 0, 0], [20, 0, 0]])).toEqual([[0, 0, 0], [20, 0, 0]]);
  });

  it("builds finite, bounded chiller and pump geometry without a renderer", () => {
    for (const [build, equipment] of [[buildChiller, model.equipment[0]], [buildPump, model.equipment[1]]] as const) {
      const parts: Part[] = [];
      build(parts, equipment);
      expect(parts.length).toBeGreaterThan(8);
      expect(parts.every((part) => part.owner === equipment.id && part.edges)).toBe(true);
      for (const part of parts) {
        part.geometry.computeBoundingBox();
        const bounds = part.geometry.boundingBox!;
        expect([bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)).toBe(true);
        part.geometry.dispose();
      }
    }
  });
});
