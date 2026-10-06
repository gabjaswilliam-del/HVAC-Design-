import { describe, expect, it } from "vitest";
import { centerOn, clampView, fitBeside, fitView, FLOAT_COVER, keepCenter, MAX_ZOOM, zoomAt } from "./panZoom";

const scene = { w: 1460, h: 960 };
const box = { w: 1100, h: 640 };
const toScreen = (v: { k: number; x: number; y: number }, sx: number, sy: number) => [sx * v.k + v.x, sy * v.k + v.y];

describe("pan/zoom geometry", () => {
  it("fits the whole scene inside the box, centred", () => {
    const v = fitView(scene, box);
    const [x0, y0] = toScreen(v, 0, 0);
    const [x1, y1] = toScreen(v, scene.w, scene.h);
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(box.w);
    expect(y1).toBeLessThanOrEqual(box.h);
    expect(Math.abs(x0 - (box.w - x1))).toBeLessThan(0.01);
  });

  it("keeps the point under the pointer fixed while zooming", () => {
    const v = fitView(scene, box);
    const px = 700;
    const py = 300;
    const sx = (px - v.x) / v.k;
    const sy = (py - v.y) / v.k;
    const z = zoomAt(v, 2, px, py, scene, box);
    const [qx, qy] = toScreen(z, sx, sy);
    expect(qx).toBeCloseTo(px, 6);
    expect(qy).toBeCloseTo(py, 6);
    expect(z.k).toBeCloseTo(v.k * 2, 6);
  });

  it("limits zoom and never lets the plant leave the viewport", () => {
    let v = fitView(scene, box);
    for (let i = 0; i < 40; i++) v = zoomAt(v, 1.5, 10, 10, scene, box);
    expect(v.k).toBe(MAX_ZOOM);
    const lost = clampView({ k: 1, x: 99_999, y: -99_999 }, scene, box);
    expect(lost.x).toBeLessThan(box.w);
    expect(lost.y + scene.h).toBeGreaterThan(0);
  });

  it("centres a scene point and preserves it across a resize", () => {
    const c = centerOn(400, 500, 1.5, scene, box);
    expect(toScreen(c, 400, 500)).toEqual([box.w / 2, box.h / 2]);
    const narrower = { w: 760, h: 640 };
    const kept = keepCenter(c, box, narrower, scene);
    expect(toScreen(kept, 400, 500)).toEqual([narrower.w / 2, narrower.h / 2]);
  });

  it("fits beside a floating panel when that keeps half size, else lets the panel cover", () => {
    // 1366x768 and 1280x800 windows: the plant refits beside the panel.
    for (const b of [{ w: 1258, h: 668 }, { w: 1172, h: 700 }]) {
      const v = fitBeside(scene, b);
      expect(v.beside).toBe(true);
      expect(v.k).toBeGreaterThanOrEqual(0.5);
      expect(toScreen(v, scene.w, 0)[0]).toBeLessThanOrEqual(b.w - FLOAT_COVER);
    }
    // 1024x768: too small beside the panel, so it keeps the normal fit.
    const small = { w: 916, h: 668 };
    expect(fitBeside(scene, small)).toEqual({ ...fitView(scene, small), beside: false });
  });
});
