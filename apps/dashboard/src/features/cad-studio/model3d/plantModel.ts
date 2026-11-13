/**
 * The prepared sample in 3D, as numbers: where each item of equipment stands and where every
 * pipe runs, from the sample's topology and its 2D schematic layout. The schematic has positions
 * only (no dimensions, elevations or scale), so heights are a convention for each kind of
 * equipment and pipe level, never shown as dimensions. Pure (no WebGL), so it is unit-tested.
 */
import type { Link, LinkEnd, SceneLayout, Topology } from "../../../lib/contracts";
import { BUS_MEDIUM, linkMedium, type Medium } from "../../../lib/topology";
import { portPosition, spriteGeometry, type SpriteKind } from "../../monitoring/scene/geometry";

export type V3 = readonly [number, number, number];
export type System = "cw" | "chw";

/** Pipe levels: pump axes and tower basin outlets, chiller and hall nozzles, tower inlets. */
export const LOW = 14;
export const MID = 44;
export const HIGH = 80;
/** Each header keeps one level; the two returns never meet (they run at the top, on different paths. */
export const BUS_LEVEL: Record<string, number> = { cw_supply: LOW, cw_return: HIGH, chw_supply: 58, chw_return: HIGH };
export const HEADER_RADIUS = 7;
export const BRANCH_RADIUS = 4.5;

export interface Equipment {
  id: string;
  kind: SpriteKind;
  /** The sprite's plan rectangle: x and z from the schematic, its width and depth. */
  x: number;
  z: number;
  width: number;
  depth: number;
  flip: boolean;
  standby: boolean;
  label: string;
}
export interface PipeRun {
  /** A link's id, or a header's (bus) id. */
  owner: string;
  system: System;
  medium: Medium | "unknown";
  points: V3[];
  radius: number;
  header: boolean;
  /** A connection whose far end is not recorded: drawn dashed, its end open. */
  unknown: boolean;
}
export interface Fitting {
  owner: string;
  kind: "valve" | "sensor";
  system: System;
  at: V3;
}
export interface PlantModel {
  equipment: Equipment[];
  runs: PipeRun[];
  fittings: Fitting[];
}

const along = (a: V3, dir: V3, k: number): V3 => [a[0] + dir[0] * k, a[1] + dir[1] * k, a[2] + dir[2] * k];
const same = (a: V3, b: V3) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[2] - b[2]) < 0.01;

/** A nozzle's flange face: the 2D port's plan position at its kind's height, and the way it faces. */
export function nozzle(layout: SceneLayout, device: string, port: string): { p: V3; dir: V3 } {
  const node = layout.nodes[device];
  const at = portPosition(node.kind, port, node, node.flip);
  if (node.kind === "pump") return port === "suction" ? { p: [at.x, LOW, at.y], dir: [node.flip ? -1 : 1, 0, 0] } : { p: [at.x, 31, node.y + 24], dir: [0, 1, 0] };
  if (node.kind === "coolingTower") return port === "water_in" ? { p: [at.x, HIGH, at.y], dir: [0, 0, -1] } : { p: [at.x, LOW, at.y], dir: [0, 0, 1] };
  return { p: [at.x, MID, at.y], dir: [node.kind === "chiller" && port.startsWith("evap") ? 1 : -1, 0, 0] };
}

/** Repeated points and straight-through corners removed: what is left are the bends. */
export function clean(points: V3[]): V3[] {
  const unique = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
  return unique.filter((p, i) => {
    if (i === 0 || i === unique.length - 1) return true;
    const a = unique[i - 1], b = unique[i + 1];
    const u = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], v = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return Math.hypot(...cross) > 1e-6 * (Math.hypot(...u) * Math.hypot(...v) || 1);
  });
}

/** A link's run: up or out from each nozzle to one level, then along the link's 2D waypoints at that level. */
export function linkRun(link: Link, layout: SceneLayout): PipeRun {
  const unknown = link.evidence === "unknown";
  const mid = layout.links[link.id] ?? [];
  const end = (e: LinkEnd, xz: readonly [number, number] | undefined) =>
    "bus" in e ? { bus: true, p: [xz![0], BUS_LEVEL[e.bus], xz![1]] as V3, dir: [0, 0, 0] as V3 } : { bus: false, ...nozzle(layout, e.device, e.port) };
  const a = end(link.from, mid[0]);
  const b = end(link.to, mid.at(-1));
  const inner = mid.slice("bus" in link.from ? 1 : 0, "bus" in link.to ? -1 : mid.length);
  // One level per run: above a vertical (pump) discharge, at a header's level, or the higher nozzle.
  const vertical = [a, b].find((e) => e.dir[1] > 0);
  const other = vertical === a ? b : a;
  const level = vertical ? Math.max(vertical.p[1] + 12, other.p[1]) : a.bus || b.bus ? (a.bus ? b : a).p[1] : Math.max(a.p[1], b.p[1]);
  if (unknown) b.p = [b.p[0], level, b.p[2]]; // the recorded end stops short of its header: it hangs open at the run's level
  const seq = (e: typeof a): V3[] => {
    if (e.p[1] === level) return [e.p];
    if (e.bus || e.dir[1] > 0) return [e.p, [e.p[0], level, e.p[2]]];
    const out = along(e.p, e.dir, 16);
    return [e.p, out, [out[0], level, out[2]]];
  };
  const points = clean([...seq(a), ...inner.map(([x, z]) => [x, level, z] as V3), ...seq(b).reverse()]);
  return { owner: link.id, system: link.medium, medium: unknown ? "unknown" : linkMedium(link), points, radius: BRANCH_RADIUS, header: false, unknown };
}

export const M3A_EQUIPMENT = ["chiller_plant_1", "chilled_water_pump_pri_1"] as const;

/** Where a link meets a header: the bus and the tee point on it. */
function tees(link: Link, layout: SceneLayout): { bus: string; at: readonly [number, number] }[] {
  const mid = layout.links[link.id] ?? [];
  const result: { bus: string; at: readonly [number, number] }[] = [];
  if ("bus" in link.from && mid[0]) result.push({ bus: link.from.bus, at: [mid[0][0], mid[0][1]] });
  const last = mid.at(-1);
  if ("bus" in link.to && last) result.push({ bus: link.to.bus, at: [last[0], last[1]] });
  return result;
}

/** Each header's straight runs: whole, or (with tees) only the stretches within `margin` of them. */
export function headerRuns(layout: SceneLayout, only?: { bus: string; at: readonly [number, number] }[], margin = 140): PipeRun[] {
  const runs: PipeRun[] = [];
  for (const [bus, lines] of Object.entries(layout.buses)) {
    const level = BUS_LEVEL[bus];
    const system: System = bus.startsWith("chw") ? "chw" : "cw";
    const run = (points: V3[]) => runs.push({ owner: bus, system, medium: BUS_MEDIUM[bus], points, radius: HEADER_RADIUS, header: true, unknown: false });
    if (!only) {
      for (const line of lines) run(clean(line.map(([x, z]) => [x, level, z] as V3)));
      continue;
    }
    const mine = only.filter((t) => t.bus === bus);
    if (!mine.length) continue;
    for (const line of lines) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        const length = Math.hypot(bx - ax, bz - az);
        if (length < 1) continue;
        const spans: [number, number][] = [];
        for (const { at } of mine) {
          const t = ((at[0] - ax) * (bx - ax) + (at[1] - az) * (bz - az)) / length;
          const off = Math.abs((at[0] - ax) * (bz - az) - (at[1] - az) * (bx - ax)) / length;
          if (t >= -1 && t <= length + 1 && off < 1) spans.push([Math.max(0, t - margin), Math.min(length, t + margin)]);
        }
        spans.sort((p, q) => p[0] - q[0]);
        const merged: [number, number][] = [];
        for (const s of spans) {
          const last = merged.at(-1);
          if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
          else merged.push([...s]);
        }
        for (const [from, to] of merged) {
          const point = (t: number): V3 => [ax + ((bx - ax) * t) / length, level, az + ((bz - az) * t) / length];
          if (to - from > 1) run([point(from), point(to)]);
        }
      }
    }
  }
  return runs;
}

/** Bypass geometry comes from the scene, not from an inferred new connection. */
function bypassRuns(layout: SceneLayout): PipeRun[] {
  return Object.entries(layout.bypasses).map(([owner, bypass]) => {
    const across = owner === "cw_bypass" ? ["cw_return", "cw_supply"] : ["chw_supply", "chw_return"];
    return {
      owner,
      system: owner.startsWith("chw") ? "chw" : "cw",
      medium: BUS_MEDIUM[across[0]],
      points: clean(bypass.points.map(([x, z]) => [x, BUS_LEVEL[across[0]], z] as V3)),
      radius: HEADER_RADIUS,
      header: true,
      unknown: false,
    };
  });
}

/** The closest recorded bus supplies the fitting's system and schematic height. */
function nearestBus(layout: SceneLayout, x: number, z: number) {
  let best = { bus: "chw_supply", distance: Number.POSITIVE_INFINITY };
  for (const [bus, lines] of Object.entries(layout.buses)) {
    for (const line of lines) for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const length = Math.hypot(bx - ax, bz - az) || 1;
      const t = Math.max(0, Math.min(length, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / length));
      const distance = Math.hypot(x - (ax + ((bx - ax) * t) / length), z - (az + ((bz - az) * t) / length));
      if (distance < best.distance) best = { bus, distance };
    }
  }
  return best.bus;
}

function fittings(topology: Topology, layout: SceneLayout): Fitting[] {
  const valves: Fitting[] = [];
  for (const valve of topology.valves) {
    const recorded = layout.ringValves[valve.id];
    if (valve.at && recorded) {
      const bus = nearestBus(layout, recorded[0], recorded[1]);
      valves.push({ owner: valve.id, kind: "valve", system: (bus.startsWith("chw") ? "chw" : "cw") as System, at: [recorded[0], BUS_LEVEL[bus], recorded[1]] });
    } else if (valve.across && layout.bypasses[valve.id]) {
      const at = layout.bypasses[valve.id].valve;
      const bus = valve.across[0];
      valves.push({ owner: valve.id, kind: "valve", system: (bus.startsWith("chw") ? "chw" : "cw") as System, at: [at[0], BUS_LEVEL[bus], at[1]] });
    }
  }
  const sensors = layout.sensors.map((sensor, index) => {
    const bus = nearestBus(layout, sensor.at[0], sensor.at[1]);
    return { owner: `sensor_${index}_${sensor.letter}`, kind: "sensor" as const, system: (bus.startsWith("chw") ? "chw" : "cw") as System, at: [sensor.at[0], BUS_LEVEL[bus], sensor.at[1]] as V3 };
  });
  return [...valves, ...sensors];
}

/** The complete plant, or a limited equipment slice with only their links and headers. */
export function plantModel(topology: Topology, layout: SceneLayout, include?: readonly string[]): PlantModel {
  const keep = include ? new Set(include) : null;
  const devices = topology.devices.filter((d) => layout.nodes[d.id] && (!keep || keep.has(d.id)));
  const equipment = devices.map((d): Equipment => {
    const node = layout.nodes[d.id];
    const g = spriteGeometry[node.kind];
    return { id: d.id, kind: node.kind, x: node.x, z: node.y, width: g.width, depth: g.height, flip: !!node.flip, standby: d.role === "standby", label: d.label };
  });
  const links = topology.links.filter((l) => [l.from, l.to].every((e) => "bus" in e || !keep || keep.has(e.device)));
  return {
    equipment,
    runs: [...headerRuns(layout, keep ? links.flatMap((l) => tees(l, layout)) : undefined), ...links.map((l) => linkRun(l, layout)), ...(keep ? [] : bypassRuns(layout))],
    fittings: keep ? [] : fittings(topology, layout),
  };
}
