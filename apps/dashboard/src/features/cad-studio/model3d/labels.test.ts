import { describe, expect, it } from "vitest";
import { declutterLabels, leaderLine, type LabelItem } from "./labels";

const equipment = ["tower1", "tower2", "tower3", "tower4", "chiller1", "chiller2", "chiller3", "cw1", "cw2", "cw3", "cw4", "chw1", "chw2", "chw3", "chw4", "hall"];
const items: LabelItem[] = [
  ...equipment.map((id, index) => ({ id, x: 100 + (index % 4) * 160, y: 100 + Math.floor(index / 4) * 110, width: 92, height: 24, priority: 20 })),
  { id: "selected", x: 420, y: 310, width: 100, height: 24, priority: 100 },
  { id: "finding:a", x: 420, y: 310, width: 150, height: 28, priority: 200 },
  { id: "finding:b", x: 180, y: 530, width: 130, height: 28, priority: 190 },
];

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) < 90 && Math.abs(a.y - b.y) < 24;
}

describe("M3b label decluttering", () => {
  it("is deterministic and never places finding markers over one another", () => {
    const first = declutterLabels(items, 1000, 760);
    const second = declutterLabels(items, 1000, 760);
    expect(first).toEqual(second);
    expect(first["finding:a"]).not.toBeNull();
    expect(first["finding:b"]).not.toBeNull();
    expect(first.selected).not.toBeNull();
    const visible = Object.values(first).filter((placement): placement is { x: number; y: number } => placement !== null);
    for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) expect(overlaps(visible[i], visible[j])).toBe(false);
  });

  it("drops lower-priority labels before hiding selected and open-finding labels", () => {
    const placements = declutterLabels(items, 420, 440);
    expect(placements["finding:a"]).not.toBeNull();
    expect(placements["finding:b"]).not.toBeNull();
    expect(placements.selected).not.toBeNull();
    expect(Object.values(placements).some((placement) => placement === null)).toBe(true);
  });

  it("uses a short leader only when the label is displaced from its anchor", () => {
    const item: LabelItem = { id: "chiller", x: 420, y: 310, width: 100, height: 24, priority: 60 };
    expect(leaderLine(item, { x: 420, y: 250 })).toEqual([420, 310, 420, 274]);
    expect(leaderLine(item, { x: 370, y: 298 })).toBeNull();
    expect(leaderLine(item, null)).toBeNull();
  });
});
