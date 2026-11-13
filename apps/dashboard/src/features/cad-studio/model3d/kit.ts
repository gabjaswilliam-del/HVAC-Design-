/**
 * The 3D equipment kit: each kind built from simple solids in neutral painted steel, inside its
 * 2D sprite's plan footprint and at a conventional height (never a dimension). Every part names
 * its owner (an equipment, link or header id) and one material, so the scene merges per owner and
 * material. M3a built the chiller and pump; M3b completes towers, the lumped hall and fittings.
 */
import * as THREE from "three";
import { LOW, MID, type Equipment, type Fitting, type PipeRun, type System } from "./plantModel";

export type MaterialKey =
  | "body" | "body2" | "deck" | "base" | "frame" | "dark" | "standby"
  | "cw-hot" | "cw-cool" | "chw-supply" | "chw-return" | "unknown";

/** Neutral steel in three value bands (lit body, mid trim, dark openings); hue only on the pipe media tokens. */
export const COLORS: Record<MaterialKey, number> = {
  body: 0xb4bac1,
  body2: 0xa9b0b7,
  deck: 0x959ca4,
  base: 0x737980,
  frame: 0x4a5057,
  dark: 0x2b3035,
  standby: 0x91979e,
  "cw-hot": 0xe0a630,
  "cw-cool": 0x34b89a,
  "chw-supply": 0x6c7cff,
  "chw-return": 0x5ec8e5,
  unknown: 0x8c97aa,
};
export const isPipe = (key: MaterialKey) => key.startsWith("cw") || key.startsWith("chw") || key === "unknown";

export interface Part {
  owner: string;
  material: MaterialKey;
  geometry: THREE.BufferGeometry;
  /** Drawn with thin dark feature edges (equipment); pipes are not. */
  edges: boolean;
  layer?: System | "valves" | "instruments";
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const AXIS = {
  x: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(1, 0, 0)),
  y: new THREE.Quaternion(),
  z: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0, 0, 1)),
};
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Collects one owner's parts: boxes by their corners, cylinders along an axis. */
function builder(out: Part[], owner: string) {
  const add = (material: MaterialKey, geometry: THREE.BufferGeometry, position: THREE.Vector3, quaternion: THREE.Quaternion = AXIS.y, edges = true) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(position, quaternion, ONE));
    out.push({ owner, material, geometry, edges });
  };
  return {
    add,
    box(material: MaterialKey, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
      add(material, new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)), v((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    },
    cyl(material: MaterialKey, axis: keyof typeof AXIS, x: number, y: number, z: number, r: number, length: number, segments = 24) {
      add(material, new THREE.CylinderGeometry(r, r, length, segments), v(x, y, z), AXIS[axis]);
    },
  };
}

/** A chiller, 180 × 112 in plan: evaporator low at the front and condenser high at the back, end
 *  water boxes carrying the four nozzles where the 2D ports are, compressor and motor on top. */
export function buildChiller(out: Part[], e: Equipment) {
  const b = builder(out, e.id);
  const x = (n: number) => e.x + n, z = (n: number) => e.z + n;
  b.box("base", x(12), 0, z(22), x(168), 5, z(28));
  b.box("base", x(12), 0, z(98), x(168), 5, z(104));
  for (const bx of [12, 160]) b.box("base", x(bx), 0, z(28), x(bx + 8), 5, z(98));
  for (const sx of [44, 136]) {
    b.box("frame", x(sx - 5), 5, z(66), x(sx + 5), 14, z(90));
    b.box("frame", x(sx - 4), 5, z(42), x(sx + 4), 40, z(54));
  }
  b.cyl("body", "x", x(90), 29, z(78), 19, 136, 32);
  b.cyl("body", "x", x(90), 52, z(48), 16, 136, 32);
  for (const ex of [23.5, 156.5]) {
    b.cyl("frame", "x", x(ex), 29, z(78), 21, 3, 32);
    b.cyl("frame", "x", x(ex), 52, z(48), 18, 3, 32);
  }
  b.box("body", x(8), 6, z(30), x(22), 70, z(102));
  b.box("body", x(158), 6, z(30), x(172), 70, z(102));
  for (const pz of [62, 92]) {
    for (const [nx, fx] of [[4, 1], [176, 179]]) {
      b.cyl("body", "x", x(nx), MID, z(pz), 6, 8, 16);
      b.cyl("frame", "x", x(fx), MID, z(pz), 8.5, 2, 16);
    }
  }
  for (const px of [104, 150]) b.box("frame", x(px - 4), 50, z(56), x(px + 4), 76, z(68));
  b.cyl("body2", "x", x(108), 86, z(62), 13, 28, 28);
  b.cyl("frame", "x", x(124), 86, z(62), 11, 4, 28);
  b.cyl("body2", "x", x(144), 86, z(62), 10.5, 36, 28);
  b.box("body2", x(138), 95, z(57), x(150), 101, z(67));
  b.add("body2", new THREE.TubeGeometry(new THREE.CatmullRomCurve3([v(x(80), 44, z(78)), v(x(80), 74, z(77)), v(x(84), 86, z(68)), v(x(94), 86, z(62))]), 16, 6, 12), v(0, 0, 0));
  b.box("body2", x(26), 5, z(8), x(68), 64, z(26));
  b.box("dark", x(50), 46, z(26), x(64), 58, z(26.6));
}

/** A pump, 86 × 56 in plan, mirrored as its 2D sprite: motor, coupling guard, volute with an in-line
 *  suction and a vertical discharge where the 2D ports are. A standby pump is a shade darker. */
export function buildPump(out: Part[], e: Equipment) {
  const b = builder(out, e.id);
  const X = (lx: number) => (e.flip ? e.x + 86 - lx : e.x + lx);
  const za = e.z + 31;
  const body: MaterialKey = e.standby ? "standby" : "body";
  const body2: MaterialKey = e.standby ? "standby" : "body2";
  b.box("base", X(2), 0, za - 16, X(82), 4, za + 16);
  b.cyl("frame", "x", X(85), LOW, za, 8.5, 2, 16);
  b.cyl(body, "x", X(81), LOW, za, 6, 6, 16);
  b.cyl(body, "x", X(70), LOW, za, 11, 16, 28);
  b.cyl(body, "y", X(66.5), 25, e.z + 24, 5, 8, 16);
  b.cyl("frame", "y", X(66.5), 30, e.z + 24, 7.5, 2, 16);
  b.box("base", X(54), LOW - 6, za - 6, X(62), LOW + 6, za + 6);
  b.cyl(body2, "x", X(34), LOW, za, 10, 40, 24);
  b.cyl(body2, "x", X(10), LOW, za, 9, 8, 24);
  b.box(body2, X(32), 23, za - 5, X(42), 29, za + 5);
}

/** A cooling tower: basin, louvred housing, fan deck, and a dark fan inside its stack. */
export function buildCoolingTower(out: Part[], e: Equipment) {
  const b = builder(out, e.id);
  const x = (n: number) => e.x + n, z = (n: number) => e.z + n;
  b.box("base", x(2), 0, z(2), x(76), 8, z(98));
  b.box("body", x(5), 8, z(5), x(73), 82, z(95));
  for (let y = 22; y <= 66; y += 7) b.box("dark", x(3), y, z(3), x(75), y + 2, z(97));
  for (let y = 26; y <= 66; y += 10) b.box("frame", x(4), y, z(96), x(74), y + 2, z(99));
  b.box("deck", x(2), 82, z(2), x(76), 89, z(98));
  b.cyl("frame", "y", x(39), 94, z(50), 24, 10, 32);
  b.cyl("body2", "y", x(39), 101, z(50), 21, 5, 32);
  b.cyl("dark", "y", x(39), 104, z(50), 17, 2, 32);
  b.box("dark", x(36), 103, z(33), x(42), 105, z(67));
  b.box("dark", x(22), 103, z(47), x(56), 105, z(53));
}

/** The data hall is a lumped load, not independently modelled server equipment. */
export function buildDataHall(out: Part[], e: Equipment) {
  const b = builder(out, e.id);
  const x = (n: number) => e.x + n, z = (n: number) => e.z + n;
  b.box("base", x(0), 0, z(0), x(240), 4, z(190));
  b.box("body2", x(0), 4, z(0), x(5), 60, z(190));
  b.box("body2", x(235), 4, z(0), x(240), 60, z(190));
  b.box("body2", x(0), 4, z(185), x(240), 60, z(190));
  b.box("body2", x(0), 4, z(0), x(240), 60, z(5));
  for (let row = 0; row < 5; row++) for (let col = 0; col < 6; col++) {
    b.box("dark", x(22 + col * 34), 4, z(22 + row * 30), x(42 + col * 34), 34, z(36 + row * 30));
    b.box("frame", x(23 + col * 34), 34, z(23 + row * 30), x(41 + col * 34), 36, z(35 + row * 30));
  }
}

export const BUILDERS: Partial<Record<Equipment["kind"], (out: Part[], e: Equipment) => void>> = {
  chiller: buildChiller,
  pump: buildPump,
  coolingTower: buildCoolingTower,
  dataHall: buildDataHall,
};

/** A valve or sensor at a recorded scene location; nothing is inferred about its physical operation. */
export function buildFitting(out: Part[], fitting: Fitting) {
  const b = builder(out, fitting.owner);
  const [x, y, z] = fitting.at;
  if (fitting.kind === "valve") {
    b.cyl("frame", "y", x, y + 4, z, 5, 8, 16);
    b.cyl("body2", "y", x, y + 10, z, 2, 7, 12);
    b.cyl("frame", "y", x, y + 14, z, 6, 2, 16);
  } else {
    b.cyl("frame", "y", x, y + 4, z, 3, 8, 12);
    b.cyl("body2", "y", x, y + 10, z, 4, 4, 16);
  }
  for (const part of out) if (part.owner === fitting.owner) part.layer = fitting.kind === "valve" ? "valves" : "instruments";
}

/** A pipe run: straight lengths as open cylinders, 90° bends as quarter-torus elbows; a header's
 *  ends are capped; an unknown connection is dashed. */
export function buildRun(out: Part[], run: PipeRun) {
  const points = run.points.map(([x, y, z]) => v(x, y, z));
  const r = run.radius;
  const n = points.length;
  const material = run.medium as MaterialKey;
  const add = (geometry: THREE.BufferGeometry) => out.push({ owner: run.owner, material, geometry, edges: false, layer: run.system });
  const dir: THREE.Vector3[] = [];
  const len: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const d = points[i + 1].clone().sub(points[i]);
    len.push(d.length());
    dir.push(d.normalize());
  }
  const bend = points.map((_, i) => (i === 0 || i === n - 1 ? 0 : Math.min(2 * r, len[i - 1] / (i === 1 ? 1 : 2), len[i] / (i === n - 2 ? 1 : 2))));
  const trim = (i: number) => (bend[i] >= r ? bend[i] : 0);
  const length = (a: THREE.Vector3, b: THREE.Vector3, open: boolean) => {
    const d = b.clone().sub(a);
    const l = d.length();
    if (l < 0.05) return;
    const g = new THREE.CylinderGeometry(r, r, l, r > 5 ? 16 : 12, 1, open);
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), ONE));
    add(g);
  };
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].clone().addScaledVector(dir[i], trim(i));
    const b = points[i + 1].clone().addScaledVector(dir[i], -trim(i + 1));
    if (!run.unknown) length(a, b, true);
    else for (let s = 0, l = a.distanceTo(b); s < l; s += 12) length(a.clone().addScaledVector(dir[i], s), a.clone().addScaledVector(dir[i], Math.min(s + 7, l)), false);
  }
  for (let i = 1; i < n - 1; i++) {
    const a = dir[i - 1], b = dir[i], rb = bend[i];
    if (rb < r) {
      const g = new THREE.SphereGeometry(r, 12, 8);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(points[i].x, points[i].y, points[i].z));
      add(g);
      continue;
    }
    const g = new THREE.TorusGeometry(rb, r, 10, 6, Math.PI / 2);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(b.clone().negate(), a, a.clone().cross(b)).setPosition(points[i].clone().addScaledVector(a, -rb).addScaledVector(b, rb)));
    add(g);
  }
  if (run.header) {
    for (const p of [points[0], points[n - 1]]) {
      const g = new THREE.SphereGeometry(r, 16, 10);
      g.applyMatrix4(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      add(g);
    }
  }
}
