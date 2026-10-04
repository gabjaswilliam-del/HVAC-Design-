import { describe, expect, it } from "vitest";
import { generate, SAMPLES, STEP_MIN, type Dataset } from "./generate";
import { scenarioById, scenarios } from "./scenarios";

const ds = (id: string) => generate(scenarioById(id)!);
const idx = (h: number, m: number) => (h * 60 + m) / STEP_MIN;
const v = (d: Dataset, key: string, i: number) => d.metrics[key].values[i]!;

describe("scenario generator", () => {
  it("is deterministic", () => {
    for (const s of scenarios) expect(JSON.stringify(generate(s))).toBe(JSON.stringify(generate(s)));
  });

  it("produces finite values or explicit nulls with matching quality", () => {
    for (const s of scenarios) {
      const d = generate(s);
      for (const [key, m] of Object.entries(d.metrics)) {
        expect(m.values).toHaveLength(SAMPLES);
        m.values.forEach((x, i) => {
          if (x === null) expect(m.quality[i], key).toBe("unavailable");
          else expect(Number.isFinite(x), key).toBe(true);
        });
      }
    }
  });

  it("keeps plant, chiller and pump numbers mutually consistent", () => {
    const d = ds("normal");
    for (let i = 0; i < SAMPLES; i++) {
      const chillerSum = [1, 2, 3].reduce((s, c) => s + v(d, `chiller_plant_${c}:cooling_kw`, i), 0);
      expect(Math.abs(chillerSum - v(d, "plant:cooling_delivered_kw", i))).toBeLessThanOrEqual(2);
      expect(v(d, "plant:cooling_demand_kw", i)).toBeGreaterThanOrEqual(v(d, "plant:cooling_delivered_kw", i));
      const cop = v(d, "plant:cooling_delivered_kw", i) / v(d, "plant:power_kw", i);
      expect(Math.abs(cop - v(d, "plant:cop", i))).toBeLessThan(0.02);
      const pumpFlow = [1, 2, 3, 4].reduce((s, p) => s + v(d, `chilled_water_pump_pri_${p}:flow_m3h`, i), 0);
      expect(Math.abs(pumpFlow - v(d, "chw_supply:flow_m3h", i))).toBeLessThanOrEqual(3);
      for (const c of [1, 2, 3]) expect(v(d, `chiller_plant_${c}:load_pct`, i)).toBeLessThanOrEqual(100);
    }
  });

  it("stages a third chiller only in the peak scenario afternoon", () => {
    expect(ds("normal").states.chiller_plant_3[idx(15, 15)]).toBe("stopped");
    expect(ds("peak").states.chiller_plant_3[idx(15, 15)]).toBe("running");
  });

  it("tower fault raises the condenser approach", () => {
    const d = ds("tower-fault");
    expect(d.states.cooling_towers_4[idx(13, 15)]).toBe("running");
    expect(d.states.cooling_towers_4[idx(13, 20)]).toBe("fault");
    expect(v(d, "plant:approach_c", idx(13, 25))).toBeGreaterThan(v(d, "plant:approach_c", idx(13, 15)) + 0.3);
  });

  it("pump trip leaves demand unmet until the standby pump restores chiller 2", () => {
    const d = ds("pump-trip");
    const during = idx(14, 10);
    expect(d.states.chilled_water_pump_pri_2[during]).toBe("fault");
    expect(d.states.chiller_plant_2[during]).toBe("stopped");
    expect(v(d, "plant:unmet_kw", during)).toBeGreaterThan(100);
    const after = idx(14, 30);
    expect(d.states.chilled_water_pump_pri_4[after]).toBe("running");
    expect(d.states.chiller_plant_2[after]).toBe("running");
    expect(v(d, "plant:unmet_kw", after)).toBe(0);
  });

  it("marks missing and stale sensors instead of inventing values", () => {
    const d = ds("sensor-issues");
    expect(d.metrics["chw_return:pressure_kpa"].values.every((x) => x === null)).toBe(true);
    const stale = d.metrics["chiller_plant_2:cond_out_temp_c"];
    expect(stale.quality[idx(15, 0)]).toBe("stale");
    expect(stale.values[idx(15, 0)]).toBe(stale.values[idx(11, 30)]);
    expect(d.states.chilled_water_pump_pri_3[idx(10, 0)]).toBe("unavailable");
  });

  it("retains last values as stale after telemetry disconnects", () => {
    const d = ds("disconnected");
    const after = idx(15, 0);
    expect(d.lastReceivedIndex).toBe(idx(14, 40));
    expect(Object.values(d.metrics).every((m) => m.quality[after] === "stale")).toBe(true);
    expect(d.stale.chiller_plant_1[after]).toBe(true);
    expect(d.stale.chiller_plant_1[idx(14, 40)]).toBe(false);
  });
});
