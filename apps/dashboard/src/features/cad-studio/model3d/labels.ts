export interface LabelItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
}
export interface LabelPlacement {
  x: number;
  y: number;
}
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const intersects = (a: Rect, b: Rect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Deterministic screen-space labels: important items choose first; later items move or wait. */
export function declutterLabels(items: LabelItem[], width: number, height: number, reserved: Rect[] = []): Record<string, LabelPlacement | null> {
  const occupied: Rect[] = [...reserved];
  const result: Record<string, LabelPlacement | null> = {};
  for (const item of [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))) {
    const w = Math.max(24, item.width), h = Math.max(16, item.height);
    const candidates = [
      { x: item.x - w / 2, y: item.y - h - 6 },
      { x: item.x - w / 2, y: item.y + 6 },
      { x: item.x + 8, y: item.y - h / 2 },
      { x: item.x - w - 8, y: item.y - h / 2 },
      { x: item.x - w / 2, y: item.y - h - 22 },
      { x: item.x - w / 2, y: item.y + 22 },
    ];
    let chosen: LabelPlacement | null = null;
    for (const candidate of candidates) {
      const x = clamp(candidate.x, 6, Math.max(6, width - w - 6));
      const y = clamp(candidate.y, 6, Math.max(6, height - h - 6));
      const rect = { left: x - 2, top: y - 2, right: x + w + 2, bottom: y + h + 2 };
      if (occupied.some((other) => intersects(rect, other))) continue;
      chosen = { x, y };
      occupied.push(rect);
      break;
    }
    result[item.id] = chosen;
  }
  return result;
}

/** A short screen-space leader to the nearest label edge, omitted when the anchor is inside it. */
export function leaderLine(item: LabelItem, placement: LabelPlacement | null): [number, number, number, number] | null {
  if (!placement) return null;
  const x = clamp(item.x, placement.x, placement.x + item.width);
  const y = clamp(item.y, placement.y, placement.y + item.height);
  return Math.hypot(item.x - x, item.y - y) < 5 ? null : [item.x, item.y, x, y];
}
