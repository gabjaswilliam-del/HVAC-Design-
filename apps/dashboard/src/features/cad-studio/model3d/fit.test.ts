import { describe, expect, it } from "vitest";
import { fitPlantView } from "./fit";

const geometry = { minX: -600, maxX: 400, minY: -250, maxY: 250 };

describe("3D plant fitting", () => {
  it("centres all projected geometry, not only its equipment positions", () => {
    const fit = fitPlantView(geometry, [], 1000, 800);
    expect(fit.bounds.left + fit.bounds.right).toBeCloseTo(1000, 8);
    expect(fit.bounds.top + fit.bounds.bottom).toBeCloseTo(800, 8);
    expect(fit.bounds.left).toBeCloseTo(32, 8);
    expect(fit.bounds.right).toBeCloseTo(968, 8);
    expect(fit.bounds.top).toBeGreaterThanOrEqual(32);
    expect(fit.bounds.bottom).toBeLessThanOrEqual(768);
    expect(fit.rightOffset).toBeCloseTo(-100, 8);
    expect(fit.upOffset).toBeCloseTo(0, 8);
  });

  it("includes visible label extents and keeps their content centred with breathing room", () => {
    const labels = [
      { id: "tower", x: -580, y: 200, width: 154, height: 28, priority: 60 },
      { id: "finding", x: 340, y: -190, width: 172, height: 28, priority: 200 },
    ];
    const withoutLabels = fitPlantView(geometry, [], 1000, 800);
    const fit = fitPlantView(geometry, labels, 1000, 800);
    expect(fit.scale).toBeGreaterThan(withoutLabels.scale);
    expect(fit.bounds.left + fit.bounds.right).toBeCloseTo(1000, 8);
    expect(fit.bounds.top + fit.bounds.bottom).toBeCloseTo(800, 8);
    expect(fit.bounds.left).toBeGreaterThanOrEqual(0);
    expect(fit.bounds.right).toBeLessThanOrEqual(1000);
    expect(fit.bounds.top).toBeGreaterThanOrEqual(0);
    expect(fit.bounds.bottom).toBeLessThanOrEqual(800);
  });

  it("retains a larger outer pipe bounds when labels do not reach it", () => {
    const fit = fitPlantView({ ...geometry, minX: -1000 }, [{ id: "pump", x: -200, y: 0, width: 90, height: 26, priority: 50 }], 1000, 800);
    expect(fit.scale).toBeGreaterThanOrEqual(1400 / 936);
    expect(fit.bounds.left + fit.bounds.right).toBeCloseTo(1000, 8);
    expect(fit.bounds.left).toBeGreaterThanOrEqual(0);
    expect(fit.bounds.right).toBeLessThanOrEqual(1000);
  });
});
