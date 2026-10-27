/**
 * Graph Memory's constellation: where each record sits in 3D, worked out from the timeline's
 * layout (`timeline.ts`), so the same records always sit in the same places. Nothing is
 * simulated and nothing is random: small offsets come from a hash of each record's ID.
 *
 * - Time runs left to right on the timeline's elastic axis (quiet stretches shortened).
 * - Each equipment item is a group of its own: the groups spread down the view, far enough
 *   apart that the whole is shaped like a display rather than a strip, and at different
 *   depths, so the constellation has a front and a back.
 * - Within a group, each record sits as near the group's line as it can without covering an
 *   earlier one as seen from the front (never across time), and never past the middle between
 *   its group and the next; one off the line also steps in or out of the view, and one away
 *   from the others sits a little in front of or behind the line. In a burst with no room
 *   left, a record stands behind what it covers: seen from the front it may overlap, but no
 *   two spheres ever meet.
 * - A version superseded at the same moment as its successor sits just under it where there
 *   is room, and a little behind.
 * - A sphere's size grows a little with its stored links (a fact of the record, not a
 *   judgement of its importance); a superseded version is smaller.
 */
import type { V3 } from "../graph/scene3d";
import type { MemoryTimelineLayout } from "./timeline";

export interface ConstellationLane {
  key: string;
  kind: "equipment" | "none";
  y: number;
  z: number;
  /** The time its records span. */
  x0: number;
  x1: number;
  /** Its records, echoes included (as the timeline counts them). */
  records: number;
}
export interface ConstellationLayout {
  positions: Map<string, V3>;
  radius: Map<string, number>;
  /** How far from its centre a record takes a click or a touch. */
  reach: Map<string, number>;
  lanes: ConstellationLane[];
  /** Where each lane's name goes: before the first record of all, at its height. */
  laneAnchor: Map<string, V3>;
  runs: { id: string; runId: string; anchor: V3 }[];
  /** Where each day's date goes, and each shortened quiet stretch: below the constellation. */
  days: { day: string; anchor: V3 }[];
  quiet: { hours: number; anchor: V3 }[];
  /** A record about several items, marked on their groups too. */
  echoes: { id: string; lane: string; at: V3 }[];
  min: V3;
  max: V3;
  /** The base sphere radius. */
  r: number;
  /** Where a moment on the timeline's axis falls across the constellation. */
  toX: (timelineX: number) => number;
}

/** A display's shape: wide (a desktop) or narrow (a phone, near square). */
export interface Shape {
  narrow: boolean;
}

/** A sphere where it was drawn on screen: its centre, its radius, the radius round it that takes
 *  a click (`reach`), and how far it is from the camera. */
export interface DrawnSphere {
  id: string;
  x: number;
  y: number;
  r: number;
  reach: number;
  depth: number;
}

/** The record a press at (x, y) is for: the nearest sphere drawn under it; else the nearest whose
 *  click area is under it (a nearer record's area can reach over a sphere seen from close by);
 *  else none. */
export function pickAt(spheres: Iterable<DrawnSphere>, x: number, y: number) {
  let found: string | null = null;
  let best = { drawn: false, depth: Infinity };
  for (const s of spheres) {
    const d = Math.hypot(s.x - x, s.y - y);
    if (d > Math.max(s.r, s.reach)) continue;
    const drawn = d <= s.r;
    if ((drawn && !best.drawn) || (drawn === best.drawn && s.depth < best.depth)) (found = s.id), (best = { drawn, depth: s.depth });
  }
  return found;
}

/** A number in [0, 1) from an ID (FNV-1a): the same ID, the same offset, every time. */
export function hash01(id: string, salt = 0) {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export function constellationLayout(layout: MemoryTimelineLayout, shape: Shape): ConstellationLayout {
  // World units: on a phone time is drawn closer together and spheres larger for it, so a
  // record stays big enough to touch when the whole is in view.
  const kx = shape.narrow ? 0.36 : 0.8;
  const r = 40;
  const aspect = shape.narrow ? 1.05 : 0.6;
  const mid = layout.width / 2;
  const X = (x: number) => (x - mid) * kx;
  const width = Math.max(layout.width * kx, 6 * r);

  const groups = layout.lanes.filter((l) => l.kind !== "runs");
  const n = Math.max(groups.length, 1);
  // The groups span about `aspect` of the width, at least far enough apart for a column of
  // close records (further on a phone, where time is drawn closer together and bursts need the
  // height), and not so far apart that one group is lost from the next.
  const spacing = n > 1 ? Math.min(Math.max((width * aspect) / (n - 1), (shape.narrow ? 10 : 7.5) * r), 22 * r) : 0;
  const depth = spacing * 0.32;
  const lanes: ConstellationLane[] = groups.map((l, i) => {
    const xs = layout.records.filter((rec) => rec.lane === l.key).map((rec) => X(rec.x));
    return {
      key: l.key,
      kind: l.kind === "none" ? "none" : "equipment",
      y: ((n - 1) / 2 - i) * spacing,
      z: n > 1 ? depth * Math.cos(i * 2.4) : 0,
      x0: xs.length ? Math.min(...xs) : 0,
      x1: xs.length ? Math.max(...xs) : 0,
      records: l.records,
    };
  });
  const laneOf = new Map(lanes.map((l) => [l.key, l]));

  // How many links each record has (stored links only, not supersession).
  const links = new Map<string, number>();
  for (const l of layout.links) {
    if (l.type === "SUPERSEDES") continue;
    links.set(l.source, (links.get(l.source) ?? 0) + 1);
    links.set(l.target, (links.get(l.target) ?? 0) + 1);
  }

  const positions = new Map<string, V3>();
  const radius = new Map<string, number>();
  // How far from its group's line a record may sit: never past the middle between its group
  // and the next, with room for the largest sphere, so it always reads as its group's; further
  // on the outer side of the first and last groups, where there is no other.
  const room = n > 1 ? Math.max(spacing / 2 - 1.5 * r, 1.2 * r) : 6 * r;
  const gap = 0.6 * r;
  for (const [i, lane] of lanes.entries()) {
    const [up, below] = [i === 0 ? 6 * r : room, i === lanes.length - 1 ? 6 * r : room];
    // In time order, each record goes as near its line as it can without covering one already
    // placed, as seen from the front (and a little apart): on the line, else just above or
    // below what is in the way, nearest first (up first; down first for a superseded version
    // or a record at the same moment as another, as the timeline stacks them), stepping in or
    // out of the view as it goes. A record at the same moment as another also sits a little
    // behind it. Where a burst leaves no room, a record takes the clearest height and stands
    // behind whatever it covers, far enough that no two spheres meet.
    const placed: { x: number; y: number; z: number; r: number }[] = [];
    for (const rec of layout.records.filter((o) => o.lane === lane.key).sort((a, b) => a.x - b.x || a.row - b.row)) {
      const x = X(rec.x);
      const rr = rec.superseded ? 0.72 * r : r * (1 + 0.1 * Math.min(links.get(rec.id) ?? 0, 5));
      const blocked = placed.flatMap((p) => {
        const reach = p.r + rr + gap;
        const dx = Math.abs(p.x - x);
        if (dx >= reach) return [];
        const h = Math.sqrt(reach * reach - dx * dx);
        return [[p.y - lane.y - h, p.y - lane.y + h] as const];
      });
      const free = (dy: number) => dy <= up && dy >= -below && blocked.every(([lo, hi]) => dy <= lo || dy >= hi);
      const down = rec.superseded || rec.row > 0;
      // A record at the same moment as another goes just under it if it can, as on the timeline.
      const above = rec.row > 0 ? placed.filter((p) => p.x === x).at(-1) : undefined;
      const under = above ? above.y - lane.y - above.r - rr - gap : NaN;
      let dy = free(under) ? under : [0, ...blocked.flat()].sort((a, b) => Math.abs(a) - Math.abs(b) || (down ? a - b : b - a)).find(free);
      if (dy === undefined) {
        const clear = (d: number) => Math.min(...placed.map((p) => Math.hypot(p.x - x, p.y - lane.y - d) - p.r - rr));
        let best = -Infinity;
        for (let d = -below; d <= up + 1e-9; d += 0.25 * r) if (clear(d) > best + 1e-9) (best = clear(d)), (dy = d);
      }
      dy ??= 0;
      let z = above ? above.z - 1.2 * r : lane.z + (hash01(rec.id) - 0.5) * 1.1 * r - (dy / (2.15 * r)) * 0.9 * r;
      for (const p of placed) {
        const need = p.r + rr + gap;
        const d = Math.hypot(p.x - x, p.y - lane.y - dy);
        if (d < need) z = Math.min(z, p.z - Math.sqrt(need * need - d * d));
      }
      positions.set(rec.id, { x, y: lane.y + dy, z });
      radius.set(rec.id, rr);
      placed.push({ x, y: lane.y + dy, z, r: rr });
    }
  }

  const ps = [...positions.entries()];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const [id, p] of ps) {
    const rr = radius.get(id) ?? r;
    min.x = Math.min(min.x, p.x - rr);
    min.y = Math.min(min.y, p.y - rr);
    min.z = Math.min(min.z, p.z - rr);
    max.x = Math.max(max.x, p.x + rr);
    max.y = Math.max(max.y, p.y + rr);
    max.z = Math.max(max.z, p.z + rr);
  }
  if (!ps.length) {
    Object.assign(min, { x: -r, y: -r, z: -r });
    Object.assign(max, { x: r, y: r, z: r });
  }
  // A click or a touch is taken a little beyond the sphere (more so on a phone), but never
  // over another record's sphere as seen from the front: every sphere can be pointed at.
  const reach = new Map<string, number>();
  for (const [id, p] of ps) {
    const own = radius.get(id) ?? r;
    let most = own * (shape.narrow ? 2.1 : 1.5);
    for (const [other, q] of ps) if (other !== id) most = Math.min(most, Math.hypot(p.x - q.x, p.y - q.y) - (radius.get(other) ?? r));
    reach.set(id, Math.max(own, most));
  }
  const zMid = (min.z + max.z) / 2;

  const laneAnchor = new Map(lanes.map((l) => [l.key, { x: min.x - 1.2 * r, y: l.y, z: l.z }]));
  const runs = layout.runs.map((run) => {
    const at = run.records.flatMap((id) => (positions.has(id) ? [positions.get(id)!] : []));
    const ax = at.length ? at.reduce((s, p) => s + p.x, 0) / at.length : X((run.x0 + run.x1) / 2);
    const ay = at.length ? Math.max(...at.map((p) => p.y)) : max.y;
    const az = at.length ? at.reduce((s, p) => s + p.z, 0) / at.length : zMid;
    return { id: run.id, runId: run.runId, anchor: { x: ax, y: ay + 2.4 * r, z: az } };
  });
  const below = min.y - 1.4 * r;
  const days = layout.days.map((d) => ({ day: d.day, anchor: { x: X(d.x), y: below, z: zMid } }));
  const quiet = layout.breaks.map((b) => ({ hours: b.hours, anchor: { x: X(b.x), y: below, z: zMid } }));
  const echoes = layout.records.flatMap((rec) =>
    rec.echoes.flatMap((eq) => {
      const lane = laneOf.get(eq);
      const p = positions.get(rec.id);
      return lane && p ? [{ id: rec.id, lane: eq, at: { x: p.x, y: lane.y, z: lane.z } }] : [];
    }),
  );
  return { positions, radius, reach, lanes, laneAnchor, runs, days, quiet, echoes, min, max, r, toX: X };
}
