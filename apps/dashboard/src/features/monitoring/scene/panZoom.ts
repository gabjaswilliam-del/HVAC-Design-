/**
 * Pan/zoom geometry for the plant viewport. A view maps scene units to screen pixels:
 * screen = scene * k + (x, y). Pure functions so they can be tested without a browser.
 */

export interface View {
  k: number;
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

export const MAX_ZOOM = 4;
const FIT_PADDING = 12;
/** Pixels of plant that must stay on screen so it can't be panned out of reach. */
const KEEP_VISIBLE = 80;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largest scale at which the whole scene fits the box, centred. */
export function fitView(scene: Size, box: Size): View {
  const k = Math.max(
    0.05,
    Math.min((box.w - 2 * FIT_PADDING) / scene.w, (box.h - 2 * FIT_PADDING) / scene.h),
  );
  return { k, x: (box.w - scene.w * k) / 2, y: (box.h - scene.h * k) / 2 };
}

/** Width a floating workspace panel covers at the box's right edge (panel + gap). */
export const FLOAT_COVER = 364;
/** Below this scale, fitting beside a floating panel would make the plant too small. */
export const FLOAT_MIN_ZOOM = 0.5;
/** Clear bands for the view switch (top) and the disclosure (bottom) beside a panel. */
const TOP_BAND = 48;
const BOTTOM_BAND = 88;

/**
 * Fit with a floating panel over the box's right edge. If the plant still fits beside
 * it at half size or more, it fits in the uncovered width, between the corner
 * controls; otherwise the panel covers part of a normal fit (`beside` is false).
 */
export function fitBeside(scene: Size, box: Size): View & { beside: boolean } {
  const w = box.w - FLOAT_COVER;
  const k = Math.min((w - 2 * FIT_PADDING) / scene.w, (box.h - 2 * FIT_PADDING) / scene.h);
  if (k < FLOAT_MIN_ZOOM) return { ...fitView(scene, box), beside: false };
  const ph = scene.h * k;
  const band = box.h - TOP_BAND - BOTTOM_BAND;
  const y = ph <= band ? TOP_BAND + (band - ph) / 2 : Math.max(FIT_PADDING, box.h - BOTTOM_BAND - ph);
  return { k, x: (w - scene.w * k) / 2, y, beside: true };
}

export const minZoom = (scene: Size, box: Size) => Math.min(fitView(scene, box).k * 0.5, 1);

/** Keep at least KEEP_VISIBLE px of the scene inside the box on each axis. */
export function clampView(v: View, scene: Size, box: Size): View {
  const sw = scene.w * v.k;
  const sh = scene.h * v.k;
  const keepX = Math.min(KEEP_VISIBLE, sw, box.w);
  const keepY = Math.min(KEEP_VISIBLE, sh, box.h);
  return {
    k: v.k,
    x: clamp(v.x, keepX - sw, box.w - keepX),
    y: clamp(v.y, keepY - sh, box.h - keepY),
  };
}

/** Zoom by `factor`, keeping the scene point under (px, py) fixed on screen. */
export function zoomAt(v: View, factor: number, px: number, py: number, scene: Size, box: Size): View {
  const k = clamp(v.k * factor, minZoom(scene, box), MAX_ZOOM);
  const r = k / v.k;
  return clampView({ k, x: px - (px - v.x) * r, y: py - (py - v.y) * r }, scene, box);
}

/** Centre a scene point in the box at scale k. */
export function centerOn(px: number, py: number, k: number, scene: Size, box: Size): View {
  return clampView({ k, x: box.w / 2 - px * k, y: box.h / 2 - py * k }, scene, box);
}

/** After a resize, keep the scene point that was centred still centred. */
export function keepCenter(v: View, from: Size, to: Size, scene: Size): View {
  const cx = (from.w / 2 - v.x) / v.k;
  const cy = (from.h / 2 - v.y) / v.k;
  return centerOn(cx, cy, v.k, scene, to);
}
