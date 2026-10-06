import { describe, expect, it } from "vitest";
import type { History } from "../../lib/contracts";
import { shortfallPeriods } from "../../lib/plant";

const history = (values: (number | null)[]): History => ({
  schemaVersion: 1,
  configRevision: 1,
  from: "2026-09-28T06:00:00.000Z",
  to: "2026-09-28T06:30:00.000Z",
  times: values.map((_, i) => new Date(Date.UTC(2026, 8, 28, 6, i * 5)).toISOString()),
  series: [{ metric: "plant:unmet_kw", unit: "kWt", values, quality: values.map((v) => (v === null ? "unavailable" : "good")) }],
});

describe("shortfall periods", () => {
  it("groups consecutive unmet samples, keeps the peak and marks a running period ongoing", () => {
    const p = shortfallPeriods(history([0, 120, 300, 0, null, 50, 80]));
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ peak: 300, ongoing: false, from: "2026-09-28T06:05:00.000Z", to: "2026-09-28T06:10:00.000Z" });
    expect(p[1]).toMatchObject({ peak: 80, ongoing: true });
  });

  it("treats missing values as a gap, never as a shortfall", () => {
    expect(shortfallPeriods(history([null, null, 0]))).toEqual([]);
    expect(shortfallPeriods(undefined)).toEqual([]);
  });
});

describe("indicator inputs", () => {
  it("cooling delivered reads the site's own chillers, however many there are", async () => {
    const { kpiInputs } = await import("./kpiDefinitions");
    const site = {
      topology: {
        devices: [
          { id: "ch_a", family: "chiller_plant" },
          { id: "ch_b", family: "chiller_plant" },
          { id: "pump_1", family: "cooling_water_pump" },
        ],
      },
    } as unknown as import("../../lib/contracts").SiteBundle;
    expect(kpiInputs("plant:cooling_delivered_kw", site)).toEqual(["ch_a:cooling_kw", "ch_b:cooling_kw"]);
    expect(kpiInputs("plant:cop", site)).toEqual(["plant:cooling_delivered_kw", "plant:power_kw"]);
  });
});
