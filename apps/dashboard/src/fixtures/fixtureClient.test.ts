import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api/client";
import { createFixtureClient } from "./fixtureClient";
import { DAY_START, MINUTE_MS } from "./generate";
import { scenarios } from "./scenarios";

const at = (h: number, m: number) => new Date(DAY_START + (h * 60 + m) * MINUTE_MS).toISOString();

describe("fixture client", () => {
  it("serves boundary-valid data for every scenario", async () => {
    for (const s of scenarios) {
      const c = createFixtureClient(s.id, { latencyMs: 0 });
      const site = await c.getSite();
      expect(site.topology.devices).toHaveLength(16);
      const snap = await c.getSnapshot({ at: at(15, 15) });
      expect(Object.keys(snap.equipment)).toHaveLength(16);
      await c.getHistory({ metrics: ["plant:cop", "chiller_plant_1:power_kw"], from: at(0, 0), to: at(15, 15) });
      await c.getIssues({ at: at(15, 15) });
      await c.getLatestForecast({ at: at(15, 15), horizonMinutes: 360, stepMinutes: 15 });
      await c.getDemandHistory({ from: at(-24 * 7, 0), to: at(15, 15) });
    }
  });

  it("returns the latest forecast issued at or before the requested time", async () => {
    const c = createFixtureClient("normal", { latencyMs: 0 });
    const f = await c.getLatestForecast({ at: at(15, 22), horizonMinutes: 360, stepMinutes: 15 });
    expect(f.asOf).toBe(at(15, 15));
  });

  it("cancels on abort", async () => {
    const c = createFixtureClient("normal", { latencyMs: 50 });
    const controller = new AbortController();
    const p = c.getSnapshot({ at: at(15, 15) }, { signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("injects failures and rejects malformed payloads at the boundary", async () => {
    const c = createFixtureClient("normal", { latencyMs: 0, failures: { snapshot: "timeout", issues: "malformed" } });
    await expect(c.getSnapshot({ at: at(15, 15) })).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
    const err = await c.getIssues({ at: at(15, 15) }).catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("MALFORMED_RESPONSE");
  });

  it("reports disconnection and retains stale values instead of zeros", async () => {
    const c = createFixtureClient("disconnected", { latencyMs: 0 });
    const snap = await c.getSnapshot({ at: at(15, 15) });
    expect(snap.connection).toBe("disconnected");
    expect(snap.latestSampleAt).toBe(at(14, 40));
    expect(snap.values["chiller_plant_1:power_kw"].quality).toBe("stale");
    expect(snap.equipment.chiller_plant_1.stale).toBe(true);
    const demand = await c.getDemandHistory({ from: at(14, 0), to: at(15, 15) });
    expect(demand.values.at(-1)).toBeNull();
  });

  it("only lists issues already detected, and resolves them on time", async () => {
    const c = createFixtureClient("pump-trip", { latencyMs: 0 });
    expect((await c.getIssues({ at: at(14, 0) })).issues).toHaveLength(0);
    const during = await c.getIssues({ at: at(14, 12) });
    expect(during.issues.find((i) => i.id === "ISS-0151")?.status).toBe("investigating");
    const after = await c.getIssues({ at: at(14, 40) });
    expect(after.issues.find((i) => i.id === "ISS-0151")?.status).toBe("resolved");
  });
});
