import { describe, expect, it } from "vitest";
import { clampTarget, orbitOffset } from "./camera";

const initial = { x: -5000, y: 2887, z: 2887 };

describe("M3b camera constraints", () => {
  it("supports a complete 360-degree horizontal orbit without changing elevation or zoom", () => {
    let current = initial;
    for (let i = 0; i < 24; i++) current = orbitOffset(current, 15);
    expect(Math.abs(current.x - initial.x)).toBeLessThan(1e-6);
    expect(Math.abs(current.y - initial.y)).toBeLessThan(1e-6);
    expect(Math.abs(current.z - initial.z)).toBeLessThan(1e-6);
  });

  it("clamps elevation to the approved floor-safe range", () => {
    const lower = orbitOffset(initial, 0, 100);
    expect(lower.y / Math.hypot(lower.x, lower.y, lower.z)).toBeCloseTo(Math.cos((80 * Math.PI) / 180), 6);
    const higher = orbitOffset(initial, 0, -100);
    expect(higher.y).toBeGreaterThanOrEqual(0);
    expect(higher.y / Math.hypot(higher.x, higher.y, higher.z)).toBeCloseTo(1, 6);
  });

  it("keeps the camera target within a bounded region around the plant", () => {
    expect(clampTarget({ x: 99999, y: 0, z: -99999 }, { x: 600, y: 0, z: 400 }, 1000, 800)).toEqual({ x: 1400, y: 0, z: -240 });
    expect(clampTarget({ x: 620, y: 0, z: 410 }, { x: 600, y: 0, z: 400 }, 1000, 800)).toEqual({ x: 620, y: 0, z: 410 });
    expect(clampTarget({ x: 620, y: 99999, z: 410 }, { x: 600, y: 30, z: 400 }, 1000, 800).y).toBe(270);
    expect(clampTarget({ x: 620, y: -99999, z: 410 }, { x: 600, y: 30, z: 400 }, 1000, 800).y).toBe(-210);
  });
});
