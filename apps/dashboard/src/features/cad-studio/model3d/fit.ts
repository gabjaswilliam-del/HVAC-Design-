import { declutterLabels, type LabelItem } from "./labels";

export interface CameraBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Fit the complete projected geometry and its visible labels, then centre that content. */
export function fitPlantView(geometry: CameraBounds, labels: LabelItem[], width: number, height: number, pad = 32) {
  const availableWidth = Math.max(1, width - 2 * pad);
  const availableHeight = Math.max(1, height - 2 * pad);
  const baseScale = Math.max(0.0001, (geometry.maxX - geometry.minX) / availableWidth, (geometry.maxY - geometry.minY) / availableHeight);
  const measure = (scale: number): ScreenBounds => {
    const bounds: ScreenBounds = {
      left: width / 2 + geometry.minX / scale,
      right: width / 2 + geometry.maxX / scale,
      top: height / 2 - geometry.maxY / scale,
      bottom: height / 2 - geometry.minY / scale,
    };
    const items = labels.map((label) => ({ ...label, x: width / 2 + label.x / scale, y: height / 2 - label.y / scale }));
    const placements = declutterLabels(items, width, height, [{ left: width - 220, top: height - 64, right: width - 8, bottom: height - 8 }]);
    for (const item of items) {
      const placement = placements[item.id];
      if (!placement) continue;
      bounds.left = Math.min(bounds.left, placement.x);
      bounds.top = Math.min(bounds.top, placement.y);
      bounds.right = Math.max(bounds.right, placement.x + item.width);
      bounds.bottom = Math.max(bounds.bottom, placement.y + item.height);
    }
    return bounds;
  };

  let scale = baseScale;
  for (let iteration = 0; iteration < 4; iteration++) {
    const bounds = measure(scale);
    const next = Math.max(baseScale, scale * Math.max((bounds.right - bounds.left) / availableWidth, (bounds.bottom - bounds.top) / availableHeight));
    if (Math.abs(next - scale) < 0.0001) break;
    scale = next;
  }
  const content = measure(scale);
  const dx = (content.left + content.right) / 2 - width / 2;
  const dy = (content.top + content.bottom) / 2 - height / 2;
  return {
    scale,
    rightOffset: dx * scale,
    upOffset: -dy * scale,
    bounds: { left: content.left - dx, top: content.top - dy, right: content.right - dx, bottom: content.bottom - dy } as ScreenBounds,
  };
}
