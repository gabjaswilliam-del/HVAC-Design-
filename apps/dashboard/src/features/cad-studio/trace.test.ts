import { describe, expect, it } from "vitest";
import { demoTopology } from "../../fixtures/demoPlant";
import { findingIdsOf, traceFor } from "./Workbench";

// Kept from the removed 3D model's tests (model3d/fullPlant.test.ts): the 2D drawing uses the same trace.
describe("trace on the drawing", () => {
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

  it("marks equipment with an open finding, which a selection never dims", () => {
    const ids = findingIdsOf(demoTopology);
    for (const port of demoTopology.unconnectedPorts) expect(ids).toContain(port.device);
    expect(traceFor(null, demoTopology).size).toBe(0);
  });
});
