/**
 * Deterministic graph layouts: the same graph always lands in the same place, so a
 * reader's sense of where things are survives a reload. No randomness, no animation
 * loop: positions are computed once per graph.
 *
 * - `forceLayout` for the knowledge graph (no natural axis): a fixed number of
 *   Fruchterman-Reingold steps from hash-seeded starts. Nodes kept from the previous
 *   view stay exactly where they were and only new ones settle around them, so
 *   expanding a node never reshuffles the picture.
 * - `timeLayout` for the memory graph: records in order of occurrence left to right (one
 *   step per distinct time, so events close in time do not collide; day markers show where
 *   each day begins), one lane per equipment item, simulation runs above, superseded
 *   versions under their successor.
 * - `clusterLayout3d` for the knowledge graph in 3D: the same forces in three dimensions,
 *   plus a pull towards each node's documents (`documentWeights`), so every document's
 *   sections and the entities it describes gather round it and an entity several documents
 *   describe sits between them.
 * - `declutter`: which screen labels fit without covering one that matters more.
 *
 * ponytail: O(n²) per step, fine for the 300-node cap; Barnes-Hut beyond that.
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

export interface TimedNode {
  id: string;
  type: string;
  occurredAt?: string;
  equipment?: readonly string[];
  runId?: string | null;
  status?: string;
}

export const LANE = 96;
const STEP = 130;

/**
 * Occurrence order left to right; lanes by the first equipment item a record is about
 * (records about nothing share a last lane); simulation runs in a lane above at their first
 * record's place; anchors (the equipment) at the lane's start. Records at one place on one
 * lane are staggered vertically so none overlap.
 */
export function timeLayout(nodes: readonly TimedNode[]): {
  positions: Map<string, Point>;
  lanes: { key: string; y: number }[];
  days: { x: number; day: string }[];
  width: number;
} {
  const records = nodes.filter((n) => n.occurredAt);
  const times = [...new Set(records.map((n) => n.occurredAt!))].sort();
  const xOf = (t: string) => 160 + times.indexOf(t) * STEP;
  const days: { x: number; day: string }[] = [];
  for (const t of times) if (days.at(-1)?.day !== t.slice(0, 10)) days.push({ x: xOf(t) - STEP / 2, day: t.slice(0, 10) });
  const laneKeys: string[] = [];
  const hasRuns = records.some((r) => r.runId);
  if (hasRuns) laneKeys.push("runs");
  for (const r of records.toSorted((a, b) => a.occurredAt!.localeCompare(b.occurredAt!) || a.id.localeCompare(b.id))) {
    const key = r.equipment?.[0] ?? "none";
    if (!laneKeys.includes(key)) laneKeys.push(key);
  }
  for (const n of nodes) if (n.type === "equipment" && !laneKeys.includes(n.id.slice("equipment:".length))) laneKeys.push(n.id.slice("equipment:".length));
  const laneY = new Map(laneKeys.map((key, i) => [key, i * LANE]));
  const positions = new Map<string, Point>();
  const placed: { lane: string; x: number; y: number }[] = [];
  const free = (lane: string, x: number, y: number) => {
    // Step away from neighbours on the same lane: +22, -22, +44 …
    for (let i = 0; i < 12; i++) {
      const dy = (i % 2 ? -1 : 1) * Math.ceil(i / 2) * 22;
      if (!placed.some((p) => p.lane === lane && Math.abs(p.x - x) < 70 && Math.abs(p.y - (y + dy)) < 20)) return y + dy;
    }
    return y;
  };
  const ordered = records.toSorted((a, b) => (a.status === "superseded" ? 1 : 0) - (b.status === "superseded" ? 1 : 0) || a.occurredAt!.localeCompare(b.occurredAt!) || a.id.localeCompare(b.id));
  for (const r of ordered) {
    const lane = r.equipment?.[0] ?? "none";
    const x = xOf(r.occurredAt!);
    const base = laneY.get(lane)! + (r.status === "superseded" ? 30 : 0);
    const y = free(lane, x, base);
    placed.push({ lane, x, y });
    positions.set(r.id, { x: Math.round(x), y });
  }
  for (const n of nodes) {
    if (n.type === "equipment") positions.set(n.id, { x: 40, y: laneY.get(n.id.slice("equipment:".length)) ?? 0 });
    if (n.type === "simulation_run") {
      const first = records.filter((r) => `run:${r.runId}` === n.id).map((r) => r.occurredAt!).sort()[0];
      const x = first ? xOf(first) : 160;
      positions.set(n.id, { x: Math.round(x), y: free("runs", x, laneY.get("runs") ?? 0) });
      placed.push({ lane: "runs", x, y: positions.get(n.id)!.y });
    }
  }
  return { positions, lanes: laneKeys.map((key) => ({ key, y: laneY.get(key)! })), days, width: 160 + Math.max(times.length - 1, 0) * STEP + 80 };
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

/**
 * Deterministic 3D positions clustered by document. The documents' anchors sit on a ring
 * facing the default camera, wider than tall for landscape displays and alternately a
 * little nearer and farther, so no cluster hides another before the reader turns the view;
 * each node is pulled towards the weighted average of its documents' anchors. Kept nodes
 * stay put, as in `forceLayout`.
 */
export function clusterLayout3d(
  nodes: readonly ClusterNode[],
  edges: readonly { source: string; target: string; type: string }[],
  previous: ReadonlyMap<string, Point3> = new Map(),
): Map<string, Point3> {
  const n = nodes.length;
  const out = new Map<string, Point3>();
  if (!n) return out;
  const ids = nodes.map((x) => x.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = edges.map((e) => [index.get(e.source), index.get(e.target)] as const).filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);
  const weights = documentWeights(nodes, edges);
  const docs = [...new Set([...weights.values()].flatMap((m) => [...m.keys()]))].sort();
  // A link inside a document's cluster pulls fully; one between clusters only lightly, or
  // its pull (which grows with length) would drag each cluster into the middle.
  const home = ids.map((id) => homeDocument(weights.get(id)));
  const strength = links.map(([a, b]) => (home[a] === home[b] ? 1 : 0.25));
  const k = 34; // the ideal edge length
  const ring = docs.length > 1 ? Math.max(140, (k * Math.sqrt(n) * 2.1) / Math.sqrt(docs.length) + 16 * docs.length) : 0;
  const anchor = new Map(
    docs.map((doc, i) => {
      const a = (i / docs.length) * Math.PI * 2 - Math.PI / 2;
      return [doc, { x: Math.cos(a) * ring * 1.35, y: Math.sin(a) * ring * 0.72, z: (i % 2 ? 1 : -1) * ring * 0.22 }];
    }),
  );
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const tz = new Float64Array(n);
  // Documents and their sections hold to their anchor; entities follow what describes them.
  const pull = Float64Array.from(nodes, (node) => (node.documentId ? 2 : 0.9));
  nodes.forEach((node, i) => {
    const w = weights.get(node.id);
    if (!w) return;
    let total = 0;
    for (const [doc, v] of w) {
      const p = anchor.get(doc)!;
      tx[i] += p.x * v;
      ty[i] += p.y * v;
      tz[i] += p.z * v;
      total += v;
    }
    tx[i] /= total;
    ty[i] /= total;
    tz[i] /= total;
  });
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  const kept = new Uint8Array(n);
  ids.forEach((id, i) => {
    const p = previous.get(id);
    if (p) {
      xs[i] = p.x;
      ys[i] = p.y;
      zs[i] = p.z;
      kept[i] = 1;
      return;
    }
    // A point on a sphere round the node's target, from its ID.
    const u = hash01(id) * 2 - 1;
    const t = hash01(`${id}t`) * Math.PI * 2;
    const r = k * (0.8 + hash01(`${id}r`) * 1.6);
    const s = Math.sqrt(1 - u * u);
    xs[i] = tx[i] + Math.cos(t) * s * r;
    ys[i] = ty[i] + Math.sin(t) * s * r;
    zs[i] = tz[i] + u * r;
  });
  const warm = previous.size > 0;
  const steps = warm ? 120 : 260;
  let temp = warm ? k * 0.8 : k * 3;
  const cool = temp / steps;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const dz = new Float64Array(n);
  for (let step = 0; step < steps; step++) {
    dx.fill(0);
    dy.fill(0);
    dz.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = xs[i] - xs[j];
        let ey = ys[i] - ys[j];
        let ez = zs[i] - zs[j];
        let d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < 0.01) {
          ex = 0.1 * (hash01(ids[i] + ids[j]) - 0.5);
          ey = 0.1;
          ez = 0.05;
          d2 = 0.02;
        }
        // Repulsion fades with distance, so far clusters do not push each other apart.
        const f = (k * k) / d2 / (1 + d2 / (k * k * 36));
        dx[i] += ex * f;
        dy[i] += ey * f;
        dz[i] += ez * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
        dz[j] -= ez * f;
      }
    }
    for (let l = 0; l < links.length; l++) {
      const [a, b] = links[l];
      const ex = xs[a] - xs[b];
      const ey = ys[a] - ys[b];
      const ez = zs[a] - zs[b];
      const f = (Math.sqrt(ex * ex + ey * ey + ez * ez) / k) * strength[l];
      dx[a] -= ex * f;
      dy[a] -= ey * f;
      dz[a] -= ez * f;
      dx[b] += ex * f;
      dy[b] += ey * f;
      dz[b] += ez * f;
    }
    for (let i = 0; i < n; i++) {
      if (kept[i]) continue; // pinned: the reader's bearings stay put
      dx[i] += (tx[i] - xs[i]) * pull[i];
      dy[i] += (ty[i] - ys[i]) * pull[i];
      dz[i] += (tz[i] - zs[i]) * pull[i];
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i] + dz[i] * dz[i]) || 1;
      const move = Math.min(d, temp);
      xs[i] += (dx[i] / d) * move;
      ys[i] += (dy[i] / d) * move;
      zs[i] += (dz[i] / d) * move;
    }
    temp = Math.max(temp - cool, k * 0.02);
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  ids.forEach((id, i) => out.set(id, { x: round(xs[i]), y: round(ys[i]), z: round(zs[i]) }));
  return out;
}

export interface LabelBox {
  id: string;
  /** The box's top-left corner and size, in screen pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher first: the chosen node, then what it relates to, then landmarks. */
  priority: number;
}

/**
 * The labels that fit: most important first, each kept only if it is inside the view and
 * clear of every label already kept, so names never print over each other.
 */
export function declutter(boxes: readonly LabelBox[], width: number, height: number, gap = 3): Set<string> {
  const kept: LabelBox[] = [];
  const order = boxes.map((b, i) => [b, i] as const).sort(([a, i], [b, j]) => b.priority - a.priority || i - j);
  for (const [b] of order) {
    if (b.x < 0 || b.y < 0 || b.x + b.w > width || b.y + b.h > height) continue;
    if (kept.some((o) => b.x < o.x + o.w + gap && o.x < b.x + b.w + gap && b.y < o.y + o.h + gap && o.y < b.y + b.h + gap)) continue;
    kept.push(b);
  }
  return new Set(kept.map((b) => b.id));
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
