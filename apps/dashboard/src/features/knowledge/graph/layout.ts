/**
 * Deterministic graph layouts: the same graph always lands in the same place, so a
 * reader's sense of where things are survives a reload. No randomness, no animation
 * loop: positions are computed once per graph.
 *
 * - `forceLayout` for the knowledge graph (no natural axis): a fixed number of
 *   Fruchterman-Reingold steps from hash-seeded starts. Nodes kept from the previous
 *   view stay exactly where they were and only new ones settle around them, so
 *   expanding a node never reshuffles the picture.
 * - `planetaryLayout` for the knowledge graph in 3D: one planetary system per document
 *   (`documentWeights` says which), the document at the centre and what it describes on
 *   orbits round it, systems apart in rows. Placed, not simulated.
 * - `declutter`: where screen names fit without covering one that matters more.
 *
 * ponytail: `forceLayout` is O(n²) per step, fine for the 300-node cap; Barnes-Hut beyond
 * that. `planetaryLayout` is linear apart from choosing orbit places (O(n x places²) at
 * worst, under 30 ms for 300 nodes).
 */

export interface Point {
  x: number;
  y: number;
}

/** FNV-1a: a stable number in [0, 1) for an ID. */
export function hash01(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

export function forceLayout(
  ids: readonly string[],
  edges: readonly { source: string; target: string }[],
  previous: ReadonlyMap<string, Point> = new Map(),
): Map<string, Point> {
  const n = ids.length;
  const out = new Map<string, Point>();
  if (!n) return out;
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = edges.map((e) => [index.get(e.source), index.get(e.target)] as const).filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);
  const size = Math.max(320, Math.sqrt(n) * 120);
  const k = (0.9 * size) / Math.sqrt(n);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const kept = new Uint8Array(n);
  const neighbours: number[][] = ids.map(() => []);
  for (const [a, b] of links) neighbours[a].push(b), neighbours[b].push(a);
  ids.forEach((id, i) => {
    const p = previous.get(id);
    if (p) {
      xs[i] = p.x;
      ys[i] = p.y;
      kept[i] = 1;
    }
  });
  ids.forEach((id, i) => {
    if (kept[i]) return;
    const anchor = neighbours[i].find((j) => kept[j]);
    const a = hash01(id) * Math.PI * 2;
    const r = anchor !== undefined ? k * (0.6 + hash01(`${id}r`) * 0.6) : size * (0.15 + 0.35 * hash01(`${id}r`));
    xs[i] = (anchor !== undefined ? xs[anchor] : 0) + Math.cos(a) * r;
    ys[i] = (anchor !== undefined ? ys[anchor] : 0) + Math.sin(a) * r;
  });
  const warm = previous.size > 0;
  const steps = warm ? 120 : 300;
  let t = warm ? k * 0.6 : size * 0.12;
  const cool = t / steps;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let step = 0; step < steps; step++) {
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = xs[i] - xs[j];
        let ey = ys[i] - ys[j];
        let d2 = ex * ex + ey * ey;
        if (d2 < 0.01) {
          ex = 0.1 * (hash01(ids[i] + ids[j]) - 0.5);
          ey = 0.1;
          d2 = 0.02;
        }
        const f = (k * k) / d2;
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const [a, b] of links) {
      const ex = xs[a] - xs[b];
      const ey = ys[a] - ys[b];
      const d = Math.sqrt(ex * ex + ey * ey) || 0.01;
      const f = d / k;
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
    }
    for (let i = 0; i < n; i++) {
      // A gentle pull to the centre keeps separate clusters on screen.
      dx[i] -= xs[i] * 0.02;
      dy[i] -= ys[i] * 0.02;
      if (kept[i]) continue; // pinned: the reader's bearings stay put
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const move = Math.min(d, t);
      xs[i] += (dx[i] / d) * move;
      ys[i] += (dy[i] / d) * move;
    }
    t = Math.max(t - cool, k * 0.01);
  }
  ids.forEach((id, i) => out.set(id, { x: Math.round(xs[i] * 10) / 10, y: Math.round(ys[i] * 10) / 10 }));
  return out;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface ClusterNode {
  id: string;
  type: string;
  /** The document a document or section belongs to; null for entities. */
  documentId: string | null;
}

/**
 * How much each node belongs to each document: a document and its sections wholly to it;
 * an entity by the sections that describe it (and a document that documents it), so one
 * described in two documents belongs to both. An entity with neither takes its
 * neighbours' documents; one with no document anywhere near has none (it sits in the
 * middle).
 */
export function documentWeights(nodes: readonly ClusterNode[], edges: readonly { source: string; target: string; type: string }[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const weights = new Map<string, Map<string, number>>();
  const add = (id: string, doc: string, w: number) => {
    const m = weights.get(id) ?? new Map<string, number>();
    m.set(doc, (m.get(doc) ?? 0) + w);
    weights.set(id, m);
  };
  for (const n of nodes) if (n.documentId) add(n.id, n.documentId, 1);
  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b) continue;
    if (e.type === "DESCRIBED_BY" && b.type === "section" && b.documentId && !a.documentId) add(a.id, b.documentId, 1);
    if (e.type === "DOCUMENTS" && a.type === "document" && !b.documentId) add(b.id, a.id, 1);
  }
  const orphans = new Set(nodes.filter((n) => !weights.has(n.id)).map((n) => n.id));
  for (const id of orphans) {
    for (const e of edges) {
      const other = e.source === id ? e.target : e.target === id ? e.source : null;
      const w = other && !orphans.has(other) ? weights.get(other) : undefined;
      if (!w) continue;
      const total = [...w.values()].reduce((s, v) => s + v, 0);
      for (const [doc, v] of w) add(id, doc, v / total);
    }
  }
  return weights;
}

/** The document a node belongs to most (ties: the first by ID), or null. */
export function homeDocument(weights: ReadonlyMap<string, number> | undefined) {
  let best: string | null = null;
  let top = 0;
  for (const [doc, w] of [...(weights ?? [])].sort(([a], [b]) => a.localeCompare(b))) if (w > top) (top = w), (best = doc);
  return best;
}

/** A document's sphere: the planet at the centre of its system. */
export const PLANET = 30;

/**
 * A node's size in the 3D view (its sphere's radius, in scene units). Documents are the
 * planets; sections, the documents' structure, stay small; entities grow with their
 * connections. The layout spaces its orbits by these sizes, so no two spheres touch.
 */
export function nodeRadius(type: string, degree: number) {
  if (type === "document") return PLANET;
  if (type === "section") return 6 + Math.min(degree, 12) * 0.2;
  return 7.5 + Math.min(degree, 12) * 0.55;
}

export interface LayoutNode extends ClusterNode {
  degree: number;
}

/** One orbit of a system, and the node at each of its places (growing the graph fills the
 *  free ones; a node that leaves the view frees its place). */
export interface SystemOrbit {
  kind: "sections" | "major" | "minor" | "outer";
  radius: number;
  /** Distance between neighbouring places along the orbit. */
  spacing: number;
  /** Skip the arc below the planet, where its name goes. */
  channel: boolean;
  /** Tilt round the horizontal and the vertical axis, in radians. */
  tilt: readonly [number, number];
  /** Offset in depth: rings stacked in front of or behind a system that has no room left
   *  beside its neighbours. */
  depth: number;
  /** The places, as angles (an outer orbit keeps only those with room), and the node at each. */
  slots: number[];
  held: (string | null)[];
}

export interface PlanetSystem {
  /** The document at the centre (it may not be in view yet), or "" for nodes that no
   *  document in view describes. */
  doc: string;
  center: Point3;
  /** How far its orbits reach across the view, plus room for the largest node. */
  radius: number;
  members: string[];
  orbits: SystemOrbit[];
}

export interface PlanetaryLayout {
  positions: Map<string, Point3>;
  systems: PlanetSystem[];
  /** Each node's system: the document that describes it most (ties: the first by ID). */
  home: Map<string, string>;
  /** How many other documents in view also describe a node (0 for most). */
  shared: Map<string, number>;
}

/** Empty space between two systems' outer orbits. */
export const SYSTEM_GAP = 130;
/** Degrees kept free straight below a planet on its inner orbits, where its name goes. */
const CHANNEL = 20;
/** How strongly a shared node turns towards the other documents that describe it. */
const BRIDGE = 1.5;
const TAU = Math.PI * 2;
const USABLE = 1 - (2 * CHANNEL) / 360;
const rad = (deg: number) => (deg * Math.PI) / 180;
const angDist = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** An angle on an orbit (u in [0, 1)), clockwise from the top, skipping the channel. */
function orbitAngle(u: number, channel: boolean) {
  if (!channel) return Math.PI / 2 - u * TAU;
  let a = 90 - u * (360 - 2 * CHANNEL);
  if (a <= -90 + CHANNEL) a -= 2 * CHANNEL;
  return rad(a);
}

/** An orbit with `count` places evenly round it (at least as many as fit at `spacing`). */
function orbitOf(kind: SystemOrbit["kind"], count: number, radius: number, spacing: number, channel: boolean, tilt: readonly [number, number], depth = 0): SystemOrbit {
  const n = Math.max(count, Math.floor((TAU * radius * (channel ? USABLE : 1)) / spacing));
  const slots = Array.from({ length: n }, (_, i) => orbitAngle((i + 0.5) / n, channel));
  return { kind, radius, spacing, channel, tilt, depth, slots, held: slots.map(() => null) };
}

function orbitPoint(c: Point3, o: SystemOrbit, angle: number, id: string): Point3 {
  // A little depth off the orbit's plane, so a system reads as a body, not a disc.
  const lift = (hash01(`${id}z`) - 0.5) * 18;
  let x = o.radius * Math.cos(angle);
  let y = o.radius * Math.sin(angle);
  let z = lift;
  const [ax, ay] = o.tilt;
  [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
  [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
  return { x: round1(c.x + x), y: round1(c.y + y), z: round1(c.z + z + o.depth) };
}

/** The free place nearest an angle (ties: the first). */
function nearestFree(o: SystemOrbit, a: number) {
  let best = -1;
  let bestD = Infinity;
  o.slots.forEach((s, i) => {
    const d = o.held[i] === null ? angDist(s, a) : Infinity;
    if (d < bestD) (bestD = d), (best = i);
  });
  return best;
}

/** The free place farthest from every taken one, so nodes with nothing to lean towards
 *  fill the gaps evenly instead of bunching. */
function widestFree(o: SystemOrbit) {
  let best = -1;
  let bestD = -1;
  o.slots.forEach((s, i) => {
    if (o.held[i] !== null) return;
    let d = Math.PI;
    o.slots.forEach((t, j) => {
      if (o.held[j] !== null) d = Math.min(d, angDist(s, t));
    });
    if (d > bestD + 1e-9) (bestD = d), (best = i);
  });
  return best;
}

/**
 * The knowledge graph in 3D as planetary systems, one per document, deterministic and
 * still (no simulation).
 *
 * - Each node belongs to one system: the document that describes it most
 *   (`documentWeights`), so nothing is drawn twice.
 * - The document is the planet at the centre; its place is kept even while the document
 *   itself is not in view. Its sections circle closest, evenly, in outline order; the
 *   important entities (four or more connections, or described in other documents too) on
 *   the middle orbit; the rest on the outer orbit. Orbits are tilted differently, so a
 *   system keeps its shape when the view turns, and are wide enough that neighbours on
 *   them never touch.
 * - An entity takes the free place on its orbit nearest the sections and entities it
 *   relates to; one other documents also describe leans towards those documents' systems,
 *   so the links between systems stay short and on the side where they lead. One with
 *   nothing to lean towards fills the widest gap.
 * - Systems, largest first, fill rows (three on a landscape screen, `columns` on a phone)
 *   with `SYSTEM_GAP` between their outer orbits, alternately a little nearer and farther.
 *
 * With `previous` (the same graph, grown by expanding a node), every node already shown
 * keeps its place, and a place a node leaves is free again. New ones take free places on
 * their system's orbits, their own kind's first; then a new outer orbit, all round where
 * the neighbouring systems leave room and only on the open side where they do not (half
 * the gap to every other system stays empty, and each place is nearer its own planet than
 * any other); then a ring stacked in front of or behind the system, clear of what is
 * already there. A document new to the view starts a system to the right.
 */
export function planetaryLayout(
  nodes: readonly LayoutNode[],
  edges: readonly { source: string; target: string; type: string }[],
  previous: PlanetaryLayout | null = null,
  columns?: number,
): PlanetaryLayout {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const weights = documentWeights(nodes, edges);
  const home = new Map<string, string>();
  const shared = new Map<string, number>();
  for (const n of nodes) {
    const w = weights.get(n.id);
    home.set(n.id, previous?.home.get(n.id) ?? homeDocument(w) ?? "");
    shared.set(n.id, n.documentId ? 0 : Math.max((w?.size ?? 0) - 1, 0));
  }
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target || !byId.has(e.source) || !byId.has(e.target)) continue;
    (neighbours.get(e.source) ?? neighbours.set(e.source, []).get(e.source)!).push(e.target);
    (neighbours.get(e.target) ?? neighbours.set(e.target, []).get(e.target)!).push(e.source);
  }
  const groups = new Map<string, string[]>();
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    const h = home.get(n.id)!;
    (groups.get(h) ?? groups.set(h, []).get(h)!).push(n.id);
  }
  const degree = (id: string) => byId.get(id)!.degree;
  const byImportance = (a: string, b: string) => degree(b) - degree(a) || a.localeCompare(b);
  const type = (id: string) => byId.get(id)!.type;
  const kindOf = (id: string): SystemOrbit["kind"] => (type(id) === "section" ? "sections" : degree(id) >= 4 || shared.get(id)! > 0 ? "major" : "minor");
  const flat = (a: Point3, b: Point3) => Math.hypot(a.x - b.x, a.y - b.y);

  /** The angle a node leans towards on its system: the places of what it relates to there
   *  and, for a node other documents also describe, the direction of their systems. */
  const lean = (id: string, center: Point3, angleOf: (other: string) => number | undefined, centers: ReadonlyMap<string, Point3>, own: string) => {
    let sx = 0;
    let sy = 0;
    for (const o of neighbours.get(id) ?? []) {
      const a = angleOf(o);
      if (a !== undefined) (sx += Math.cos(a)), (sy += Math.sin(a));
    }
    if (shared.get(id)) {
      let bx = 0;
      let by = 0;
      for (const [doc, w] of weights.get(id) ?? []) {
        const oc = doc !== own ? centers.get(doc) : undefined;
        if (!oc) continue;
        const d = flat(oc, center) || 1;
        bx += ((oc.x - center.x) / d) * w;
        by += ((oc.y - center.y) / d) * w;
      }
      const l = Math.hypot(bx, by);
      if (l) (sx += (bx / l) * BRIDGE), (sy += (by / l) * BRIDGE);
    }
    return sx || sy ? Math.atan2(sy, sx) : null;
  };

  /** A system's orbits for these nodes, before it is placed (they set its size). */
  const plan = (doc: string, ids: string[], index: number) => {
    const anchored = doc !== "";
    const s = index % 2 ? 1 : -1;
    const orbits: { orbit: SystemOrbit; ids: string[]; fixed: boolean }[] = [];
    let r = anchored ? PLANET : 0;
    const ring = (kind: SystemOrbit["kind"], list: string[], gap: number, spacing: number, channel: boolean, fixed: boolean, tilt: readonly [number, number]) => {
      if (!list.length) return;
      const radius = Math.max(r + gap, (list.length * spacing) / (TAU * (channel ? USABLE : 1)));
      orbits.push({ orbit: orbitOf(kind, list.length, radius, spacing, channel, tilt), ids: list, fixed });
      r = radius;
    };
    const members = ids.filter((id) => id !== doc);
    ring("sections", members.filter((id) => kindOf(id) === "sections"), 36, 34, anchored, true, [rad(20 * s), rad(8)]);
    ring("major", members.filter((id) => kindOf(id) === "major"), 46, 42, anchored, false, [rad(-14 * s), rad(-10)]);
    ring("minor", members.filter((id) => kindOf(id) === "minor"), 40, 30, false, false, [rad(9 * s), rad(14)]);
    return { doc, ids, orbits, radius: r + 22 };
  };

  /** Places a planned system at its centre. */
  const settle = (p: ReturnType<typeof plan>, c: Point3, centers: ReadonlyMap<string, Point3>, positions: Map<string, Point3>): PlanetSystem => {
    if (p.ids.includes(p.doc)) positions.set(p.doc, { ...c });
    const angle = new Map<string, number>();
    for (const { orbit: o, ids, fixed } of p.orbits) {
      if (fixed) {
        // Evenly round the planet, in outline order.
        ids.forEach((id, k) => {
          const i = Math.floor((k * o.slots.length) / ids.length);
          o.held[i] = id;
          angle.set(id, o.slots[i]);
        });
      } else {
        const later: string[] = [];
        const chosen = new Map<string, number>();
        for (const id of ids.toSorted(byImportance)) {
          const a = lean(id, c, (o) => angle.get(o), centers, p.doc);
          if (a === null) later.push(id);
          else {
            const i = nearestFree(o, a);
            o.held[i] = id;
            chosen.set(id, o.slots[i]);
          }
        }
        for (const id of later) {
          const i = widestFree(o);
          o.held[i] = id;
          chosen.set(id, o.slots[i]);
        }
        for (const [id, a] of chosen) angle.set(id, a);
      }
      for (const id of ids) positions.set(id, orbitPoint(c, o, angle.get(id)!, id));
    }
    return { doc: p.doc, center: c, radius: round1(p.radius), members: p.ids, orbits: p.orbits.map((x) => x.orbit) };
  };

  if (previous) {
    // Growing: what is shown stays put.
    const positions = new Map<string, Point3>();
    const fresh = new Map<string, string[]>();
    for (const n of nodes) {
      const p = previous.positions.get(n.id);
      if (p) positions.set(n.id, p);
      else (fresh.get(home.get(n.id)!) ?? fresh.set(home.get(n.id)!, []).get(home.get(n.id)!)!).push(n.id);
    }
    if (positions.size) {
      // Places held by nodes no longer shown are free again.
      const systems = new Map(previous.systems.map((s) => [s.doc, { ...s, orbits: s.orbits.map((o) => ({ ...o, held: o.held.map((id) => (id !== null && positions.has(id) ? id : null)) })) }]));
      const centers = new Map([...systems].map(([doc, s]) => [doc, s.center]));
      const free = (o: SystemOrbit) => o.held.includes(null);
      const planar = (sys: PlanetSystem) => Math.max(PLANET, ...sys.orbits.filter((o) => !o.depth).map((o) => o.radius));
      /** A new orbit outside the others, keeping the places that leave half the gap to every
       *  other system empty and are nearer this planet than any other: all round when the
       *  neighbours leave room, only the open side when they do not; null when none does. */
      const outward = (sys: PlanetSystem) => {
        const o = orbitOf("outer", 0, planar(sys) + 40, 30, false, [0, 0]);
        const others = [...systems.values()].filter((t) => t !== sys);
        o.slots = o.slots.filter((a) => {
          const x = sys.center.x + o.radius * Math.cos(a);
          const y = sys.center.y + o.radius * Math.sin(a);
          return others.every((t) => Math.hypot(x - t.center.x, y - t.center.y) >= Math.max(t.radius + SYSTEM_GAP / 2, o.radius) + 22);
        });
        if (!o.slots.length) return null;
        o.held = o.slots.map(() => null);
        sys.orbits.push(o);
        sys.radius = round1(Math.max(sys.radius, o.radius + 22));
        return o;
      };
      /** With no room beside the neighbours, a ring in front of the system, then one behind,
       *  each clear of the deepest node already on that side, and as wide as the widest orbit
       *  that goes all the way round (one cut short by the neighbours would reach them). */
      const stacked = (sys: PlanetSystem) => {
        const side = sys.orbits.filter((o) => o.depth).length % 2 ? -1 : 1;
        const deepest = Math.max(0, ...sys.members.flatMap((id) => (positions.has(id) ? [side * (positions.get(id)!.z - sys.center.z)] : [])));
        const round = sys.orbits.filter((o) => !o.depth && o.slots.length >= Math.floor((TAU * o.radius * (o.channel ? USABLE : 1)) / o.spacing));
        const o = orbitOf("outer", 0, Math.max(PLANET, ...round.map((x) => x.radius)), 30, false, [0, 0], side * round1(deepest + 50));
        sys.orbits.push(o);
        return o;
      };
      for (const [doc, ids] of [...fresh].sort(([a], [b]) => a.localeCompare(b))) {
        const sys = systems.get(doc);
        if (!sys) {
          // A document new to the view: its own system, to the right of everything.
          const p = plan(doc, ids, systems.size);
          const right = Math.max(...[...systems.values()].map((s) => s.center.x + s.radius));
          const c = { x: round1(right + SYSTEM_GAP + p.radius), y: 0, z: 0 };
          centers.set(doc, c);
          systems.set(doc, settle(p, c, centers, positions));
          continue;
        }
        const c = sys.center;
        if (ids.includes(doc)) positions.set(doc, { ...c });
        sys.members = [...sys.members, ...ids];
        // Where it relates to in its own system (and, shared, towards the other documents).
        const angleOf = (other: string) => {
          const q = home.get(other) === doc ? positions.get(other) : undefined;
          return q && Math.atan2(q.y - c.y, q.x - c.x);
        };
        for (const id of ids.filter((x) => x !== doc).toSorted(byImportance)) {
          const kind = kindOf(id);
          // Its own orbit; another of its role (entities stay off the document's outline while
          // there is room outside); a new orbit outside; any place; a ring in depth.
          const o =
            sys.orbits.find((x) => x.kind === kind && free(x)) ??
            sys.orbits.find((x) => !x.depth && (x.kind === "sections") === (kind === "sections") && free(x)) ??
            outward(sys) ??
            sys.orbits.find(free) ??
            stacked(sys);
          const a = lean(id, c, angleOf, centers, doc);
          const i = a === null ? widestFree(o) : nearestFree(o, a);
          o.held[i] = id;
          positions.set(id, orbitPoint(c, o, o.slots[i], id));
        }
      }
      const members = new Map<string, string[]>();
      for (const id of [...groups.values()].flat().sort()) (members.get(home.get(id)!) ?? members.set(home.get(id)!, []).get(home.get(id)!)!).push(id);
      return {
        positions,
        systems: [...systems.values()].filter((s) => members.has(s.doc)).map((s) => ({ ...s, members: members.get(s.doc)! })),
        home,
        shared,
      };
    }
  }

  // A fresh layout. Orbits first (they set each system's size), largest system first.
  const docs = [...groups.keys()].sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0) || groups.get(b)!.length - groups.get(a)!.length || a.localeCompare(b));
  const plans = docs.map((doc, i) => plan(doc, groups.get(doc)!, i));
  // Systems in rows, the whole centred on the origin.
  const k = plans.length;
  const cols = columns ?? Math.ceil(k / Math.max(1, Math.round(Math.sqrt(k / 1.6))));
  const centers = new Map<string, Point3>();
  let top = 0;
  for (let start = 0, row = 0; start < k; start += cols, row++) {
    const line = plans.slice(start, start + cols);
    const height = 2 * Math.max(...line.map((p) => p.radius));
    let x = -(line.reduce((w, p) => w + 2 * p.radius, 0) + SYSTEM_GAP * (line.length - 1)) / 2;
    line.forEach((p, j) => {
      x += p.radius;
      centers.set(p.doc, { x: round1(x), y: top - height / 2, z: ((row * cols + j) % 2 ? 1 : -1) * 26 });
      x += p.radius + SYSTEM_GAP;
    });
    top -= height + SYSTEM_GAP;
  }
  const lift = (-top - SYSTEM_GAP) / 2;
  for (const c of centers.values()) c.y = round1(c.y + lift);
  const positions = new Map<string, Point3>();
  const systems = plans.map((p) => settle(p, centers.get(p.doc)!, centers, positions));
  return { positions, systems, home, shared };
}

export interface LabelBox {
  id: string;
  /** The preferred top-left corner and the size, in screen pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher first: the chosen node, then what it relates to, then landmarks. */
  priority: number;
  /** Other top-left corners to try, in order, when the preferred place is taken. */
  alt?: readonly (readonly [number, number])[];
}

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The node it belongs to (its own name may overlap it). */
  id?: string;
}

/**
 * Where the names go: most important first, each at the first of its places that is
 * inside the view, clear of every name already placed and of the obstacles (large
 * spheres), so names never print over each other or over a planet. Names that fit
 * nowhere are left out.
 */
export function declutter(boxes: readonly LabelBox[], width: number, height: number, gap = 3, obstacles: readonly ScreenRect[] = []): Map<string, [number, number]> {
  const kept: (ScreenRect & { id: string })[] = [];
  const out = new Map<string, [number, number]>();
  const clear = (x: number, y: number, w: number, h: number, id: string) =>
    x >= 0 &&
    y >= 0 &&
    x + w <= width &&
    y + h <= height &&
    !kept.some((o) => x < o.x + o.w + gap && o.x < x + w + gap && y < o.y + o.h + gap && o.y < y + h + gap) &&
    !obstacles.some((o) => o.id !== id && x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
  const order = boxes.map((b, i) => [b, i] as const).sort(([a, i], [b, j]) => b.priority - a.priority || i - j);
  for (const [b] of order) {
    const place = [[b.x, b.y] as const, ...(b.alt ?? [])].find(([x, y]) => clear(x, y, b.w, b.h, b.id));
    if (!place) continue;
    kept.push({ id: b.id, x: place[0], y: place[1], w: b.w, h: b.h });
    out.set(b.id, [place[0], place[1]]);
  }
  return out;
}

/** The nearest point in an arrow key's direction on screen (keyboard travel). */
export function nearestInDirection<T extends { id: string; x: number; y: number }>(from: T, points: readonly T[], dir: readonly [number, number]): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const p of points) {
    if (p.id === from.id) continue;
    const vx = p.x - from.x;
    const vy = p.y - from.y;
    const along = vx * dir[0] + vy * dir[1];
    if (along <= 0) continue;
    const across = Math.abs(vx * dir[1] - vy * dir[0]);
    if (across > along * 1.8) continue;
    const score = along + across * 2;
    if (score < bestScore) (bestScore = score), (best = p);
  }
  return best;
}
