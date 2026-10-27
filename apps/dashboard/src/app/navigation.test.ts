import { describe, expect, it } from "vitest";
import { dataView, navTarget } from "../lib/contracts/agent";
import { pageOf, sectionOf, targetPath } from "./navigation";

describe("typed workspace targets", () => {
  it("map to the screen that shows them: the history, and one recorded run's replay at a finding or an item", () => {
    expect(targetPath({ type: "simulation" })).toBe("/simulation");
    expect(targetPath({ type: "simulation", runId: "RUN-0001", equipmentId: "chiller_plant_2" })).toBe("/simulation/RUN-0001?equipment=chiller_plant_2");
    expect(targetPath({ type: "simulation", runId: "RUN-0001", issueId: "PIL-0001-1" })).toBe("/simulation/RUN-0001?issue=PIL-0001-1");
    expect(targetPath({ type: "simulation", runId: "RUN-0002", compareWith: "RUN-0001" })).toBe("/simulation/RUN-0002?compare=RUN-0001");
    expect(pageOf("/simulation")).toBe("simulation");
    expect(pageOf("/simulation/RUN-0001")).toBe("replay");
    expect(pageOf("/pilot")).toBeUndefined(); // AI Pilot is in the workspace, not a screen
    expect(pageOf("/cad")).toBe("cad");
    expect(sectionOf("/cad")?.key).toBe("cad");
    expect(targetPath({ type: "equipment", id: "chiller_plant_1" })).toBe("/?equipment=chiller_plant_1&locate=1");
    expect(targetPath({ type: "monitoring_kpi", kpi: "plant:cop" })).toBe("/?kpi=plant%3Acop");
  });

  it("are validated data: no URL and no simulation command is a target", () => {
    expect(navTarget.safeParse({ type: "simulation", runId: "RUN-0001" }).success).toBe(true);
    expect(navTarget.safeParse({ type: "url", href: "https://example.com" }).success).toBe(false);
    expect(navTarget.safeParse({ type: "simulation", command: "start" }).data).toEqual({ type: "simulation" }); // unknown keys are dropped
    expect(dataView.safeParse({ kind: "link", label: "Open", target: { type: "start_simulation" } }).success).toBe(false);
  });
});
