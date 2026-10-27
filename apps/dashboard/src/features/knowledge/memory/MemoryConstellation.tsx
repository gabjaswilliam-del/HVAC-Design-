/**
 * Graph Memory as a constellation in 3D (react-force-graph-3d and three.js, in a lazy chunk
 * shared with the RAG Graph's 3D view). Positions come from `constellationLayout` and are
 * fixed: nothing is simulated, and the same records sit in the same places every time.
 *
 * Time runs left to right; each equipment item is a group, named at its left; the dates sit
 * below and simulation runs are named above their records. A record is a lit sphere in its
 * kind's colour with its kind's icon, a soft glow round its edge; it grows a little with its
 * stored links. A simulation record is circled by a dashed blue ring, as on the timeline; a
 * superseded version is a faint, ghostly sphere below and behind the one that replaced it. The
 * icon, about half the sphere across, faces the camera on the sphere's near side and is drawn
 * over any link that crosses it; the rings face the camera too, so they circle the sphere and
 * never cross its icon. Stored links arc between records with an arrow towards the linked one;
 * nothing is inferred. Behind it all, a few still stars at a great distance (they turn with the
 * view) and a faint haze round each group.
 *
 * Choosing a record flies the camera to it and what it is linked to: it grows and takes a
 * laminate ring, its links light up, the chain they lead on to stays readable and the rest
 * fades. Clearing the choice (Escape, closing the panel, a click on empty space) flies back
 * to exactly where the camera was before the first choice, framing what it framed then. A new
 * choice on the way, or a resize as the panel opens, takes the camera on from where it is. A
 * press takes the camera over only once it moves the view. A click made while the camera flies
 * counts for the sphere that was under the pointer when it was pressed (by the release the
 * scene has moved on), and otherwise leaves the flight to go on: the second click of a double
 * click, or one on empty space on the way back, changes nothing.
 *
 * Pointer, like the RAG Graph: dragging moves the view, right-drag or Shift-drag turns it,
 * the wheel zooms towards the pointer, and a drag never chooses. On touch one finger moves,
 * two turn and pinch. Keyboard: one tab stop; Left and Right travel through time, Up and Down
 * across groups, Enter chooses, Escape flies back, + and − zoom, 0 fits, Shift with an arrow
 * turns. While someone is about, the spheres drift very slightly; after a while without
 * anyone, with reduced motion, or where WebGL is drawn in software (no graphics processor),
 * nothing moves and nothing is drawn. Drawn in software, the scene also goes without
 * multisampling, the spheres' edge shells and the hazes, which cost most there.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import * as THREE from "three";
import { Minus, Plus } from "lucide-react";
import { useKnowledgeStrings } from "../../../lib/i18n/knowledge";
import { motion } from "../../../lib/motion";
import { useMedia } from "../../../app/useMedia";
import { NARROW } from "../../../app/operatingContext";
import { MEMORY_KINDS, type MemoryKind } from "../../../lib/contracts/memory";
import { hudBands, type ExtraTools } from "../graph/GraphCanvas";
import { declutter, type LabelBox, type ScreenRect } from "../graph/layout";
import { MOUSE, TOUCH, along, cross, dot, drawsInSoftware, handOverPointer, len, reducedMotion, sub, touchPageXY, unit, type Camera3, type Orbit, type V3 } from "../graph/scene3d";
import { equipmentName, formatUtc } from "../shared";
import { KIND_COLOURS, KIND_ICONS } from "./kinds";
import { constellationLayout, hash01, pickAt } from "./constellation";
import { chainOf, linkedTo, type MemoryTimelineLayout, type TimelineRecord } from "./timeline";

/** The view a fit returns to: from the front, a little above and to the right. */
const FRONT = unit({ x: 0.07, y: 0.27, z: 0.96 });
const FOV = 40;
/** The camera's near plane. three.js's default, 0.1, left the depth buffer only about 4 units
 *  fine where the overview is seen (some 2,700 units away), so each icon, just in front of its
 *  sphere, fought it for depth and broke up as the spheres drifted. At 10 it is 0.04 units
 *  there; nothing is drawn nearer than 10 to the camera. */
const NEAR = 10;
/** How far in front of its sphere's centre an icon sits, in radii. */
const ICON_LEAD = 1.2;
/** The library draws while someone is about, then rests. */
const IDLE_MS = 1500;
/** The spheres' slight drift goes on this long after the last interaction. */
const ALIVE_MS = 45_000;
/** While only drifting, the scene is drawn about 30 times a second. */
const DRIFT_FRAME_MS = 33;
/** A chosen sphere's radius on screen, as a share of the height between the controls (px limits
 *  on each): never larger than the second; centred on while it can be at least the first (else
 *  framed with what it is linked to). No sphere of a group framed is larger than the first. */
const FOCUS_MIN = [0.05, 12, 26] as const;
const FOCUS_MAX = [0.11, 18, 48] as const;
const LAMINATE = "#e9ecef";
const NOTICE = "#5b93ff";
const INK = "#0e1116";
type LinkState = "lit" | "chain" | "dim" | "old" | "normal";
const LINK_COLOURS: Record<LinkState, string> = { lit: "rgba(233, 236, 239, 0.95)", chain: "rgba(214, 220, 228, 0.55)", dim: "rgba(155, 161, 168, 0.06)", old: "rgba(179, 185, 192, 0.42)", normal: "rgba(168, 182, 202, 0.4)" };
// The library draws an arrow at three times its colour's opacity: a faded link's stays faint.
const ARROW_COLOURS: Record<LinkState, string> = { ...LINK_COLOURS, dim: "rgba(155, 161, 168, 0.02)" };
/** Drawn in software, the scene goes without multisampling (half of each frame's cost there). */
const SOFTWARE_RENDERER = { antialias: false };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayName = (day: string, year: boolean) => `${+day.slice(8, 10)} ${MONTHS[+day.slice(5, 7) - 1]}${year ? ` ${day.slice(0, 4)}` : ""}`;
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

type State = "on" | "linked" | "chain" | "dim" | "normal";
interface Look {
  a: number;
  glow: number;
  scale: number;
  select: number;
}
const LOOKS: Record<State, Look> = {
  on: { a: 1, glow: 1, scale: 1.28, select: 1 },
  linked: { a: 1, glow: 0.78, scale: 1.06, select: 0 },
  chain: { a: 0.92, glow: 0.5, scale: 1, select: 0 },
  normal: { a: 1, glow: 0.42, scale: 1, select: 0 },
  dim: { a: 0.14, glow: 0.04, scale: 0.9, select: 0 },
};
/** A record's three.js parts, kept so emphasis and the drift change materials in place. */
interface Handle {
  body: THREE.Group;
  core: THREE.MeshStandardMaterial;
  shell: THREE.MeshBasicMaterial;
  halo: THREE.SpriteMaterial;
  icon: THREE.SpriteMaterial;
  iconSprite: THREE.Sprite;
  select: THREE.SpriteMaterial;
  ringMat?: THREE.SpriteMaterial;
  wire?: THREE.MeshBasicMaterial;
  r: number;
  phase: number;
  kind: MemoryKind;
  old: boolean;
  now: Look;
}
/** What the camera is framing, so a resize frames it again; "free" once someone moves it. */
type Placement = { kind: "overview" } | { kind: "focus"; ids: string[]; centre?: string } | { kind: "free" };
interface CameraState {
  pos: V3;
  look: V3;
}
/** A place for the camera, and what it frames there. */
interface Spot {
  camera: CameraState;
  placement: Placement;
}

// Shared by every record and every mount: one unit sphere (scaled per record), a soft round glow,
// and two rings that always face the camera: the chosen record's, and a simulation record's,
// dashed as on the timeline.
let kitCache: { sphere: THREE.SphereGeometry; sphereLow: THREE.SphereGeometry; glow: THREE.CanvasTexture; ring: THREE.CanvasTexture; simRing: THREE.CanvasTexture; hit: THREE.MeshBasicMaterial } | null = null;
/** A ring's radius as a share of its sprite's half-width (the circle drawn in its texture). */
const RING = 116 / 128;
/** How large a sprite must be for its ring to have this radius. */
const ringSprite = (radius: number) => (2 * radius) / RING;
function kit() {
  if (kitCache) return kitCache;
  const paint = (size: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  // Drawn at 256 px, so a ring stays crisp round a sphere seen close.
  const circle = (width: number, dashes = 0) => (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = width;
    const step = (2 * Math.PI * 116) / dashes;
    if (dashes) ctx.setLineDash([step / 2, step / 2]);
    ctx.beginPath();
    ctx.arc(128, 128, 116, 0, Math.PI * 2);
    ctx.stroke();
  };
  kitCache = {
    sphere: new THREE.SphereGeometry(1, 48, 32),
    sphereLow: new THREE.SphereGeometry(1, 16, 10),
    glow: paint(128, (ctx) => {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.22, "rgba(255,255,255,0.42)");
      g.addColorStop(0.5, "rgba(255,255,255,0.1)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }),
    ring: paint(256, circle(10)),
    simRing: paint(256, circle(7, 24)),
    // Clicks and hovers land on a sphere a little larger than the one drawn.
    hit: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
  };
  return kitCache;
}
const unpickable = (o: THREE.Object3D) => {
  o.raycast = () => {};
  return o;
};

export default function MemoryConstellation({
  layout,
  selected,
  link,
  onSelect,
  onLink,
  focus,
  goTo,
  layoutKey,
  label,
  describe,
  onFail,
  tools: extraTools,
}: {
  layout: MemoryTimelineLayout;
  /** A record, `run:…` or `equipment:…`. */
  selected: string | null;
  /** A stored link. */
  link: string | null;
  onSelect: (id: string | null) => void;
  onLink: (id: string) => void;
  /** Fly to this record again (the counter asks again, as a search does). */
  focus: { id: string; n: number } | null;
  /** Show this stretch of time (UTC milliseconds), and this group. */
  goTo: { from: number; to: number; n: number; lane?: string } | null;
  /** When this changes the whole constellation is framed again. */
  layoutKey: string;
  label: string;
  describe: (r: TimelineRecord) => string;
  /** The graphics context was lost: the caller shows the timeline instead. */
  onFail: () => void;
  tools?: ExtraTools;
}) {
  const t = useKnowledgeStrings();
  const s = t.memory.constellation;
  const g = t.graph;
  const hintId = useId();
  const fg = useRef<ForceGraphMethods | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const iconBox = useRef<HTMLDivElement>(null);
  const marks = useRef(new Map<string, HTMLElement>());
  const sizes = useRef(new Map<string, [number, number]>());
  const shown = useRef(new Set<string>());
  const screen = useRef(new Map<string, { x: number; y: number; r: number; depth: number }>());
  const handles = useRef(new Map<string, Handle>());
  const iconTex = useRef(new Map<MemoryKind, THREE.CanvasTexture>());
  const hover = useRef<string | null>(null);
  const stopTravel = useRef<() => void>(() => {});
  const travelTo = useRef<CameraState | null>(null);
  // Pointers pressed on the view, from where each went down until it comes up. One that moves
  // 4 px (as far as a drag from a name must go) takes the camera over (a click leaves a flight
  // to go on): the controls' own events say "start" for every press, and "change" for the
  // flights' own moves too, so they cannot tell. A pointer pressed elsewhere that crosses the
  // view while held (selecting the panel's text) is kept from the library, which would take it
  // for a drag of its own and lose the next click.
  const downs = useRef(new Map<number, { x: number; y: number; moved: boolean }>());
  // The last press: when and where, whether the camera was flying then, and the record that was
  // under the pointer (by the release, a flight has moved the scene on).
  const press = useRef<{ t: number; x: number; y: number; flying: boolean; target: string | null } | null>(null);
  const placement = useRef<Placement>({ kind: "overview" });
  const home = useRef<Spot | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const keyFocus = useRef<string | null>(null);
  keyFocus.current = focusId;
  const narrow = useMedia(NARROW);
  const reduced = useMemo(reducedMotion, []);
  const c = useMemo(() => constellationLayout(layout, { narrow }), [layout, narrow]);
  const byId = useMemo(() => new Map(layout.records.map((r) => [r.id, r])), [layout]);
  // `build` is handed to the library once; it reads the current layout through these.
  const live = useRef({ c, byId });
  live.current = { c, byId };
  const linkCount = useMemo(() => {
    const n = new Map<string, number>();
    for (const l of layout.links) if (l.type !== "SUPERSEDES") n.set(l.source, (n.get(l.source) ?? 0) + 1).set(l.target, (n.get(l.target) ?? 0) + 1);
    return n;
  }, [layout]);
  const compact = size.w > 0 && size.w < 480;

  // ---- what a choice concerns ------------------------------------------------------------------
  const chosen = selected && byId.has(selected) ? selected : null;
  const chosenLink = link ? layout.links.find((l) => l.id === link) : undefined;
  const run = selected?.startsWith("run:") ? layout.runs.find((r) => r.id === selected) : undefined;
  const lane = selected?.startsWith("equipment:") ? selected.slice("equipment:".length) : null;
  const direct = useMemo(() => {
    if (chosen) return linkedTo(chosen, layout.links);
    if (chosenLink) return new Set([chosenLink.source, chosenLink.target]);
    if (run) return new Set(run.records);
    if (lane) return new Set(layout.records.filter((r) => r.lane === lane || r.echoes.includes(lane)).map((r) => r.id));
    return null;
  }, [chosen, chosenLink, run, lane, layout]);
  const chain = useMemo(() => (chosen ? chainOf(chosen, layout.links) : null), [chosen, layout]);
  const stateOf = (id: string): State => (id === chosen ? "on" : direct?.has(id) ? "linked" : chain?.has(id) ? "chain" : direct ? "dim" : "normal");
  const emphasis = useRef({ chosen, direct, chain });
  emphasis.current = { chosen, direct, chain };

  // ---- the scene's objects ---------------------------------------------------------------------
  const data = useMemo(
    () => ({
      nodes: layout.records.map((r) => {
        const p = c.positions.get(r.id)!;
        return { id: r.id, x: p.x, y: p.y, z: p.z, fx: p.x, fy: p.y, fz: p.z };
      }),
      links: layout.links.map((l) => ({ id: l.id, type: l.type, source: l.source, target: l.target })),
    }),
    [layout, c],
  );
  const dispose = (h: Handle) => {
    for (const m of [h.core, h.shell, h.halo, h.icon, h.select, h.ringMat, h.wire]) m?.dispose();
  };
  const build = useCallback((o: NodeObject) => {
    const id = String(o.id);
    const { c: lay, byId: records } = live.current;
    const rec = records.get(id);
    const before = handles.current.get(id);
    if (before) dispose(before);
    const r = lay.radius.get(id) ?? lay.r;
    const kind = rec?.kind ?? "event";
    const colour = new THREE.Color(KIND_COLOURS[kind]);
    const k = kit();
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const core = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.22, roughness: 0.34, metalness: 0.16, transparent: true });
    const coreMesh = new THREE.Mesh(k.sphere, core);
    coreMesh.scale.set(r, r, r);
    // The edge glow: the back of a slightly larger sphere, added to what is behind.
    const shell = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.2, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const shellMesh = new THREE.Mesh(k.sphere, shell);
    shellMesh.scale.set(r * 1.14, r * 1.14, r * 1.14);
    // Drawn in software it is a third of each frame's cost; the halo glows on alone there.
    shellMesh.visible = !drawsInSoftware();
    const halo = new THREE.SpriteMaterial({ map: k.glow, color: colour, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false });
    const haloSprite = unpickable(new THREE.Sprite(halo)) as THREE.Sprite;
    haloSprite.scale.set(r * 4.2, r * 4.2, 1);
    const icon = new THREE.SpriteMaterial({ map: iconTex.current.get(kind) ?? null, transparent: true, depthWrite: false, opacity: 0.95 });
    const iconSprite = unpickable(new THREE.Sprite(icon)) as THREE.Sprite;
    // The icon about half the sphere across (its texture leaves a margin round the icon).
    iconSprite.scale.set(r * 1.5, r * 1.5, 1);
    // Drawn after the links and their arrows (the library draws links at 10): a link passing
    // over the sphere goes under its icon, while a sphere in front still hides it.
    iconSprite.renderOrder = 20;
    const select = new THREE.SpriteMaterial({ map: k.ring, color: new THREE.Color(LAMINATE), transparent: true, opacity: 0, depthWrite: false });
    const selectSprite = unpickable(new THREE.Sprite(select)) as THREE.Sprite;
    selectSprite.scale.set(ringSprite(r * 1.45), ringSprite(r * 1.45), 1);
    // Never drawn, still picked (the raycaster does not ask whether a thing is visible).
    const hit = new THREE.Mesh(k.sphere, k.hit);
    hit.visible = false;
    const reach = lay.reach.get(id) ?? r;
    hit.scale.set(reach, reach, reach);
    body.add(haloSprite, shellMesh, coreMesh, iconSprite, selectSprite, hit);
    const handle: Handle = { body, core, shell, halo, icon, iconSprite, select, r, phase: hash01(id, 7) * Math.PI * 2, kind, old: Boolean(rec?.superseded), now: { ...LOOKS.normal } };
    if (rec?.provenance === "simulation") {
      // Facing the camera, it circles the sphere inside the chosen record's ring and never
      // crosses the icon (a tilted ring in 3D passed in front of it).
      handle.ringMat = new THREE.SpriteMaterial({ map: k.simRing, color: new THREE.Color(NOTICE), transparent: true, opacity: 0.85, depthWrite: false });
      const ring = unpickable(new THREE.Sprite(handle.ringMat)) as THREE.Sprite;
      ring.scale.set(ringSprite(r * 1.22), ringSprite(r * 1.22), 1);
      body.add(ring);
    }
    if (rec?.superseded) {
      // A ghost: a faint core under a fine mesh.
      handle.wire = new THREE.MeshBasicMaterial({ color: colour, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false });
      const wire = new THREE.Mesh(k.sphereLow, handle.wire);
      wire.scale.set(r * 1.03, r * 1.03, r * 1.03);
      body.add(wire);
    }
    handles.current.set(id, handle);
    return group;
  }, []);
  // Records no longer shown let go of their materials.
  useEffect(() => {
    for (const [id, h] of handles.current) if (!byId.has(id)) dispose(h), handles.current.delete(id);
  }, [byId]);
  useEffect(
    () => () => {
      for (const h of handles.current.values()) dispose(h);
      handles.current.clear();
    },
    [],
  );

  // The kinds' icons, drawn from the same icons the rest of the page uses into small textures.
  useLayoutEffect(() => {
    const box = iconBox.current;
    if (!box) return;
    const made = iconTex.current;
    for (const svg of box.querySelectorAll<SVGSVGElement>("svg[data-kind]")) {
      const kind = svg.dataset.kind as MemoryKind;
      // 256 px, so an icon stays sharp on a sphere seen close (smaller sizes come from its
      // mipmaps).
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      made.set(kind, tex);
      const img = new Image();
      img.onload = () => {
        canvas.getContext("2d")?.drawImage(img, 28, 28, 200, 200);
        tex.needsUpdate = true;
        for (const h of handles.current.values()) if (h.kind === kind && h.icon.map !== tex) h.icon.map = tex;
        wake();
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
      for (const h of handles.current.values()) if (h.kind === kind) h.icon.map = tex;
    }
    return () => {
      for (const tex of made.values()) tex.dispose();
      made.clear();
    };
  }, []);

  // Links: arcs, each bowed its own way (from its ID), lit for the choice by their colour and a
  // larger arrow. Every link is a line of one width and keeps its arrow, so that a choice only
  // recolours them: the library rebuilds every link when a width changes, and an arrow when it
  // comes or goes.
  const litKey = `${selected}|${link}|${[...(direct ?? [])].join()}|${[...(chain ?? [])].join()}`;
  const linkState = (o: LinkObject): LinkState => {
    const id = String(o.id);
    const from = typeof o.source === "object" ? String(o.source.id) : String(o.source);
    const to = typeof o.target === "object" ? String(o.target.id) : String(o.target);
    if (id === link || (chosen && (from === chosen || to === chosen))) return "lit";
    if (chain?.has(from) && chain.has(to)) return "chain";
    if (direct) return "dim";
    return o.type === "SUPERSEDES" ? "old" : "normal";
  };
  const linkColor = useMemo(() => (o: LinkObject) => LINK_COLOURS[linkState(o)], [litKey]);
  const arrowColor = useMemo(() => (o: LinkObject) => ARROW_COLOURS[linkState(o)], [litKey]);
  // A version's link to the one it superseded has no arrow, unless lit.
  const arrow = useMemo(() => (o: LinkObject) => (linkState(o) === "lit" ? 10 : o.type === "SUPERSEDES" ? 0 : 5), [litKey]);
  const curvature = useMemo(() => (o: LinkObject) => 0.2 + 0.16 * hash01(String(o.id), 3), []);
  const rotation = useMemo(() => (o: LinkObject) => (hash01(String(o.id), 5) - 0.5) * 1.6, []);
  // The library ends an arrow at a sphere's surface, from this, read every frame: as large as the
  // sphere is drawn, growing with a choice or under the pointer.
  const nodeVal = useCallback((o: NodeObject) => ((live.current.c.radius.get(String(o.id)) ?? 20) * (handles.current.get(String(o.id))?.now.scale ?? 1)) ** 3, []);
  const pointerCursor = useMemo(() => (o: NodeObject | LinkObject | undefined) => !!o && (!("source" in o) || linkState(o as LinkObject) !== "dim"), [litKey]);

  // ---- drawing on demand, and the slight drift ------------------------------------------------
  // No drift with reduced motion, nor where WebGL is drawn in software: there each frame
  // costs the processor more than the drift is worth.
  const software = useMemo(drawsInSoftware, []);
  const calm = reduced || software;
  const awake = useRef(true);
  const loop = useRef(0);
  const lastInteract = useRef(0);
  const aliveUntil = useRef(0);
  const lastDrift = useRef(0);
  const lastTick = useRef(0);
  const draw = useRef(() => {});
  const wake = () => {
    const now = performance.now();
    lastInteract.current = now;
    aliveUntil.current = now + ALIVE_MS;
    if (!awake.current) {
      awake.current = true;
      fg.current?.resumeAnimation();
    }
    if (!loop.current) loop.current = requestAnimationFrame(tick);
  };
  const lookFor = (id: string, keyboard: boolean): Look => {
    const e = emphasis.current;
    const state: State = id === e.chosen ? "on" : e.direct?.has(id) ? "linked" : e.chain?.has(id) ? "chain" : e.direct ? "dim" : "normal";
    const base = LOOKS[state];
    const hovered = hover.current === id && state !== "on";
    const focused = keyboard && keyFocus.current === id;
    // Under the pointer: brighter, a little larger, and a faint ring of the choice to come.
    return { a: Math.max(base.a, hovered ? 0.7 : 0), glow: Math.min(1, base.glow + (hovered ? 0.5 : 0) + (focused ? 0.2 : 0)), scale: base.scale * (hovered ? 1.18 : 1), select: Math.max(base.select, hovered ? 0.4 : 0) };
  };
  /** Moves every record's look towards what it should be, adds the drift; true while any is
   *  still on its way. */
  const step = (now: number, drifting: boolean) => {
    const f = fg.current;
    const cam = camera();
    const dt = Math.min(now - (lastTick.current || now), 100);
    lastTick.current = now;
    const k = reduced ? 1 : 1 - Math.exp(-dt / 85);
    const keyboard = Boolean(wrap.current?.matches(":focus-visible"));
    let moving = false;
    for (const [id, h] of handles.current) {
      const goal = lookFor(id, keyboard);
      const n = h.now;
      for (const key of ["a", "glow", "scale", "select"] as const) {
        const d = goal[key] - n[key];
        if (Math.abs(d) < 0.004) n[key] = goal[key];
        else (n[key] += d * k), (moving = true);
      }
      const ghost = h.old ? 0.5 : 1;
      h.core.opacity = n.a * ghost;
      h.core.depthWrite = n.a > 0.9 && !h.old;
      h.core.emissiveIntensity = 0.1 + 0.34 * n.glow;
      h.shell.opacity = (0.04 + 0.32 * n.glow) * n.a;
      h.halo.opacity = (0.05 + 0.4 * n.glow) * n.a * ghost;
      h.icon.opacity = n.a * (h.old ? 0.6 : 0.95);
      h.select.opacity = n.select;
      // Not drawn at all while it cannot be seen (a transparent quad still costs a frame).
      h.select.visible = n.select > 0;
      if (h.ringMat) h.ringMat.opacity = 0.85 * n.a;
      if (h.wire) h.wire.opacity = 0.42 * n.a;
      h.body.scale.set(n.scale, n.scale, n.scale);
      h.body.position.y = drifting ? Math.sin(now / 1150 + h.phase) * h.r * 0.07 : 0;
      // The icon on the face of the sphere towards the camera, a fifth of the radius in front of
      // it: the icon faces the screen, not the sphere, so on a sphere towards the edge of the
      // view its far side would otherwise dip into the sphere and be cut.
      const p = live.current.c.positions.get(id);
      if (cam && p) {
        const toward = unit(sub(cam.position, p));
        h.iconSprite.position.set(toward.x * h.r * ICON_LEAD, toward.y * h.r * ICON_LEAD, toward.z * h.r * ICON_LEAD);
      }
    }
    // Far records fade into the dark a little: a depth cue.
    const scene = f?.scene();
    const tg = orbit()?.target;
    if (scene?.fog && cam && tg) {
      const d = len(sub(cam.position, tg));
      scene.fog.near = d * 0.8;
      scene.fog.far = d * 2.6;
    }
    return moving;
  };
  const tick = (now: number) => {
    loop.current = 0;
    const f = fg.current;
    if (!f) return;
    const busy = now - lastInteract.current < IDLE_MS || travelTo.current !== null;
    const drifting = !calm && !document.hidden && now < aliveUntil.current;
    // While only drifting, the looks are worked out for the frames that are drawn.
    const moving = (awake.current || busy || now - lastDrift.current >= DRIFT_FRAME_MS) && step(now, drifting);
    if ((busy || moving) && !awake.current) {
      awake.current = true;
      f.resumeAnimation();
    } else if (!busy && !moving && awake.current) {
      awake.current = false;
      f.pauseAnimation();
      draw.current();
    }
    if (awake.current) draw.current();
    else if (drifting && now - lastDrift.current >= DRIFT_FRAME_MS) {
      lastDrift.current = now;
      f.renderer().render(f.scene(), f.camera());
    }
    if (busy || moving || drifting) loop.current = requestAnimationFrame(tick);
  };

  // ---- the camera ------------------------------------------------------------------------------
  const camera = () => fg.current?.camera() as unknown as Camera3 | undefined;
  const orbit = () => fg.current?.controls() as unknown as Orbit | undefined;
  /** The camera to decide from: where it is going, else where it is. */
  const where = (): CameraState | null => {
    if (travelTo.current) return travelTo.current;
    const cam = camera();
    const tg = orbit()?.target;
    return cam && tg ? { pos: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, look: { x: tg.x, y: tg.y, z: tg.z } } : null;
  };
  const place = (to: V3, look: V3, animate: boolean, far = false) => {
    const cam = camera();
    const tg = orbit()?.target;
    if (!cam || !tg) return;
    stopTravel.current();
    const apply = (v: { x: number; y: number; z: number; lx: number; ly: number; lz: number }) => {
      fg.current?.cameraPosition({ x: v.x, y: v.y, z: v.z }, { x: v.lx, y: v.ly, z: v.lz }, 0);
      wake();
    };
    const goal = { x: to.x, y: to.y, z: to.z, lx: look.x, ly: look.y, lz: look.z };
    if (!animate) {
      travelTo.current = null;
      return apply(goal);
    }
    travelTo.current = { pos: { ...to }, look: { ...look } };
    const done = () => (travelTo.current = null);
    const stop = motion.travel({ x: cam.position.x, y: cam.position.y, z: cam.position.z, lx: tg.x, ly: tg.y, lz: tg.z }, goal, (v) => {
      apply(v);
      if (Math.abs(v.x - goal.x) + Math.abs(v.y - goal.y) + Math.abs(v.z - goal.z) + Math.abs(v.lx - goal.lx) + Math.abs(v.ly - goal.ly) + Math.abs(v.lz - goal.lz) < 0.01) done();
    }, far);
    stopTravel.current = () => {
      stop();
      done();
    };
  };
  const dirNow = () => {
    const w = where();
    return w ? sub(w.pos, w.look) : FRONT;
  };
  /**
   * Where the camera goes to show these points, looking along `dir`: centred on `centre` (or on
   * their extent across the view), just far enough back that every one, its sphere and room
   * for its name, is on screen between the controls along the top and bottom; then held
   * between `minDist` and `maxDist`.
   */
  const framing = (pts: { p: V3; r: number }[], dir: V3, centre?: V3, minDist = 0, maxDist = Infinity) => {
    const cam = camera();
    if (!cam || !pts.length || !size.w) return null;
    const d = unit(dir);
    const r0 = cross({ x: 0, y: 1, z: 0 }, d);
    const right = len(r0) > 1e-3 ? unit(r0) : { x: 1, y: 0, z: 0 };
    const up = cross(d, right);
    let mid = centre;
    if (!mid) {
      const xs = pts.map(({ p }) => dot(p, right));
      const ys = pts.map(({ p }) => dot(p, up));
      const zs = pts.reduce((sum, { p }) => sum + dot(p, d), 0) / pts.length;
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      mid = { x: right.x * cx + up.x * cy + d.x * zs, y: right.y * cx + up.y * cy + d.y * zs, z: right.z * cx + up.z * cy + d.z * zs };
    }
    const band = hudBands(wrap.current);
    const h = Math.max(size.h, 1);
    const tan = Math.tan((FOV * Math.PI) / 360);
    const tv = (tan * Math.max(h - band.top - band.bottom, h * 0.2)) / h;
    const th = tan * (size.w / h);
    let dist = 0;
    for (const { p, r } of pts) {
      const q = sub(p, mid);
      dist = Math.max(dist, dot(q, d) + (Math.abs(dot(q, right)) + r * 1.15) / th, dot(q, d) + (Math.abs(dot(q, up)) + r * 1.5) / tv);
    }
    dist = Math.min(Math.max(dist * 1.04, minDist), maxDist);
    const look = along(mid, up, ((band.top - band.bottom) / h) * dist * tan);
    return { at: along(look, d, dist), look, dist };
  };
  /** The distance at which a sphere of radius `r` is `px` pixels in radius on screen. */
  const distFor = (r: number, px: number) => (r * (Math.max(size.h, 1) / 2)) / Math.tan((FOV * Math.PI) / 360) / px;
  const pointsOf = (ids: Iterable<string>) => [...ids].flatMap((id) => (c.positions.has(id) ? [{ p: c.positions.get(id)!, r: c.radius.get(id) ?? c.r }] : []));
  /** Everything: the records, with room for the groups' names at the left and the dates below. */
  const fit = (animate: boolean, dir: V3 = FRONT) => {
    const width = c.max.x - c.min.x;
    const pts = [
      ...pointsOf(c.positions.keys()),
      ...c.lanes.map((l) => ({ p: c.laneAnchor.get(l.key)!, r: Math.max(width * 0.1, c.r * 2) })),
      ...c.days.map((d) => ({ p: d.anchor, r: c.r * 0.8 })),
    ];
    const f = framing(pts, dir);
    if (!f) return;
    placement.current = { kind: "overview" };
    place(f.at, f.look, animate, true);
  };
  /** Fly to these records, every one in view. Around one of them (`centre`): centred on it,
   *  close enough that it is plainly the one, unless what it is linked to is spread so wide
   *  that it would no longer be; then all of them framed, it among them. Several alike (a
   *  group, a run, a link's two ends, a day): all of them, none larger than a chosen record at
   *  its smallest. */
  const focusOn = (ids: string[], centre?: string, animate = true) => {
    const pts = pointsOf(ids);
    if (!pts.length) return;
    const dir = dirNow();
    const r = centre ? (c.radius.get(centre) ?? c.r) : Math.max(...pts.map((p) => p.r));
    const band = hudBands(wrap.current);
    const room = Math.max(size.h - band.top - band.bottom, 1);
    const px = ([share, lo, hi]: readonly [number, number, number]) => Math.min(Math.max(room * share, lo), hi);
    let f = framing(pts, dir, centre ? c.positions.get(centre) : undefined, distFor(r, px(centre ? FOCUS_MAX : FOCUS_MIN)));
    if (centre && f && f.dist > distFor(r, px(FOCUS_MIN))) f = framing(pts, dir, undefined, distFor(r, px(FOCUS_MAX)));
    if (!f) return;
    placement.current = { kind: "focus", ids, centre };
    place(f.at, f.look, animate);
  };
  /** Back to where the camera was before the first choice, framing what it framed then (so a
   *  resize frames that again); all of it if there was nothing before. */
  const restore = () => {
    const back = home.current;
    home.current = null;
    if (!back) return fit(true, dirNow());
    placement.current = back.placement;
    place(back.camera.pos, back.camera.look, true, true);
  };
  /** The person moved the view (a drag, the wheel, a pinch): no flight goes on, and nothing
   *  is framed again when the view resizes. */
  const took = () => {
    stopTravel.current();
    placement.current = { kind: "free" };
  };
  /** The record at this point of the view in the last frame drawn: its sphere, else the room
   *  round it that takes a click. */
  const recordAt = (x: number, y: number) =>
    pickAt([...screen.current].map(([id, s]) => ({ id, ...s, reach: (s.r * (c.reach.get(id) ?? c.r)) / (c.radius.get(id) ?? c.r) })), x, y);
  /** A click on a record, a link or nothing. One made while the camera flew counts for the
   *  record that was under the pointer when it was pressed, or for nothing: the flight goes on
   *  unless that is another record (one on the way back is not taken by what has moved under
   *  the pointer since). The second click of a double click counts for nothing. A faded link is
   *  barely there: a click on it is a click on nothing. What is already chosen, clicked again
   *  (after looking away), is flown to again. */
  const clicked = (o: NodeObject | LinkObject | null) => {
    const p = press.current;
    if (p?.flying) return void (p.target && p.target !== chosen && onSelect(p.target));
    if (o && !("source" in o)) return String(o.id) === chosen ? showChoice() : onSelect(String(o.id));
    if (o && linkState(o as LinkObject) !== "dim") return String(o.id) === link ? showChoice() : onLink(String(o.id));
    if (selected || link) onSelect(null);
  };
  const zoom = (factor: number) => {
    const w = where();
    if (!w) return;
    const d = Math.min(Math.max(len(sub(w.pos, w.look)) * factor, 40), 20000);
    placement.current = { kind: "free" };
    place(along(w.look, sub(w.pos, w.look), d), w.look, true);
  };
  /** Turn the view round its centre: left and right round the vertical, up and down over it. */
  const turn = (dx: number, dy: number) => {
    const w = where();
    if (!w) return;
    const o = sub(w.pos, w.look);
    const r = len(o);
    const theta = Math.atan2(o.x, o.z) - dx * (Math.PI / 12);
    const phi = Math.min(Math.max(Math.acos(Math.min(Math.max(o.y / r, -1), 1)) + dy * (Math.PI / 18), 0.15), Math.PI - 0.15);
    placement.current = { kind: "free" };
    place({ x: w.look.x + r * Math.sin(phi) * Math.sin(theta), y: w.look.y + r * Math.cos(phi), z: w.look.z + r * Math.sin(phi) * Math.cos(theta) }, w.look, false);
  };
  /** Show what is chosen: a record and what it is linked to, a run's or a group's records, a
   *  link's two ends. */
  const showChoice = () => {
    if (chosen) return focusOn([chosen, ...linkedTo(chosen, layout.links)], chosen);
    if (chosenLink) return focusOn([chosenLink.source, chosenLink.target]);
    if (run) return focusOn(run.records);
    if (lane) return focusOn(layout.records.filter((r) => r.lane === lane).map((r) => r.id));
  };

  // ---- names, groups, runs and dates over the canvas --------------------------------------------
  const kindRank: Record<MemoryKind, number> = { finding: 6, decision: 5, outcome: 4, correction: 3, observation: 2, event: 1 };
  draw.current = () => {
    const f = fg.current;
    const cam = camera();
    const tg = orbit()?.target;
    if (!f || !cam || !tg || !size.w) return;
    const fwd = sub(tg, cam.position);
    const fl = len(fwd);
    const focal = size.h / 2 / Math.tan((FOV * Math.PI) / 360);
    const project = (p: V3) => {
      const depth = dot(sub(p, cam.position), fwd) / fl;
      if (depth < 4) return null; // behind the camera
      const sc = f.graph2ScreenCoords(p.x, p.y, p.z);
      return { x: sc.x, y: sc.y, depth };
    };
    const at = new Map<string, { x: number; y: number; r: number; depth: number }>();
    const e = emphasis.current;
    const obstacles: ScreenRect[] = [];
    for (const rec of layout.records) {
      const sc = project(c.positions.get(rec.id)!);
      if (!sc) continue;
      const scale = handles.current.get(rec.id)?.now.scale ?? 1;
      const r = ((c.radius.get(rec.id) ?? c.r) * scale * focal) / sc.depth;
      at.set(rec.id, { x: sc.x, y: sc.y, r, depth: sc.depth });
      // No name covers a sphere big enough to matter, its own included.
      if (rec.id === e.chosen || r > 8) obstacles.push({ id: `s:${rec.id}`, x: sc.x - r, y: sc.y - r, w: 2 * r, h: 2 * r });
    }
    // Names keep clear of the controls floating over the canvas, open menus included.
    const box = wrap.current?.getBoundingClientRect();
    const hud = wrap.current?.closest("[data-hud]");
    for (const el of hud ? hud.querySelectorAll("[data-band], [data-obstacle]") : []) {
      const r = el.getBoundingClientRect();
      if (box && r.width) obstacles.push({ x: r.left - box.left - 4, y: r.top - box.top - 4, w: r.width + 8, h: r.height + 8 });
    }
    const keyboard = Boolean(wrap.current?.matches(":focus-visible"));
    const sized = (key: string) => {
      let wh = sizes.current.get(key);
      const el = marks.current.get(key);
      if (!wh && el) sizes.current.set(key, (wh = [el.offsetWidth, el.offsetHeight]));
      return wh;
    };
    const boxes: LabelBox[] = [];
    for (const rec of layout.records) {
      const sc = at.get(rec.id);
      const wh = sizes.current.has(`r:${rec.id}`) || marks.current.has(`r:${rec.id}`) ? sized(`r:${rec.id}`) : undefined;
      if (!sc || !wh) continue;
      const st = stateOf(rec.id);
      const id = rec.id;
      const priority =
        id === e.chosen ? 100
        : id === hover.current ? 92
        : id === keyFocus.current && keyboard ? 90
        : st === "linked" ? 80
        : st === "chain" ? 62
        : st === "dim" || (rec.superseded && !e.direct) ? 0
        : 20 + Math.min(linkCount.get(id) ?? 0, 5) * 3 + kindRank[rec.kind] + Math.min(sc.r, 40) / 4;
      if (!priority) continue;
      const [w, h] = wh;
      const inside = sc.x >= 0 && sc.y >= 0 && sc.x <= size.w && sc.y <= size.h;
      // The chosen record's name, and those of what it is linked to, stay in view at the edge.
      const hold = priority >= 80 || (priority >= 60 && inside);
      const fits = (x: number, y: number) => (hold ? ([Math.min(Math.max(x, 2), size.w - w - 2), Math.min(Math.max(y, 2), size.h - h - 2)] as const) : ([x, y] as const));
      const [x, y] = fits(sc.x - w / 2, sc.y + sc.r + 5);
      boxes.push({ id: `r:${id}`, x, y, w, h, priority, alt: [fits(sc.x - w / 2, sc.y - sc.r - 5 - h), fits(sc.x + sc.r + 7, sc.y - h / 2), fits(sc.x - sc.r - 7 - w, sc.y - h / 2)] });
    }
    for (const l of c.lanes) {
      const sc = project(c.laneAnchor.get(l.key)!);
      const wh = sized(`lane:${l.key}`);
      if (!sc || !wh) continue;
      const [w, h] = wh;
      // Held inside the view: a group's name is how one finds it.
      const left = Math.min(Math.max(sc.x - w, 4), size.w - w - 4);
      boxes.push({ id: `lane:${l.key}`, x: left, y: sc.y - h / 2, w, h, priority: 95, alt: [[left, sc.y - h - 6], [left, sc.y + 6]] });
    }
    for (const rn of c.runs) {
      const sc = project(rn.anchor);
      const wh = sized(`run:${rn.id}`);
      if (!sc || !wh) continue;
      const [w, h] = wh;
      boxes.push({ id: `run:${rn.id}`, x: sc.x - w / 2, y: sc.y - h, w, h, priority: 75, alt: [[sc.x - w / 2, sc.y - h - 18]] });
    }
    c.days.forEach((d, i) => {
      const sc = project(d.anchor);
      const wh = sized(`day:${d.day}`);
      if (!sc || !wh) return;
      const [w, h] = wh;
      boxes.push({ id: `day:${d.day}`, x: sc.x - w / 2, y: sc.y, w, h, priority: 50 - i / 100 });
    });
    c.quiet.forEach((q, i) => {
      const sc = project(q.anchor);
      const wh = sized(`quiet:${i}`);
      if (!sc || !wh) return;
      const [w, h] = wh;
      boxes.push({ id: `quiet:${i}`, x: sc.x - w / 2, y: sc.y, w, h, priority: 44 });
    });
    const placed = declutter(boxes, size.w, size.h, 4, obstacles);
    for (const [key, [x, y]] of placed) {
      const el = marks.current.get(key);
      if (!el) continue;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.dataset.show = "";
    }
    for (const key of shown.current) if (!placed.has(key)) delete marks.current.get(key)?.dataset.show;
    shown.current = new Set(placed.keys());
    // Where each sphere is on screen (read by the tests, and kept for the keys).
    for (const rec of layout.records) {
      const el = marks.current.get(`r:${rec.id}`);
      const sc = at.get(rec.id);
      if (!el) continue;
      if (sc) {
        el.dataset.sx = sc.x.toFixed(0);
        el.dataset.sy = sc.y.toFixed(0);
        el.dataset.sr = sc.r.toFixed(1);
      } else delete el.dataset.sx;
    }
    screen.current = at;
    const fp = keyFocus.current ? at.get(keyFocus.current) : undefined;
    if (ring.current) {
      if (fp) {
        const d = Math.max(fp.r * 2 + 12, 20);
        ring.current.style.transform = `translate(${(fp.x - d / 2).toFixed(1)}px, ${(fp.y - d / 2).toFixed(1)}px)`;
        ring.current.style.width = ring.current.style.height = `${d.toFixed(1)}px`;
        ring.current.dataset.show = "";
      } else delete ring.current.dataset.show;
    }
    if (wrap.current) {
      const r0 = (n: number) => Math.round(n);
      wrap.current.dataset.camera = `${r0(cam.position.x)},${r0(cam.position.y)},${r0(cam.position.z)}>${r0(tg.x)},${r0(tg.y)},${r0(tg.z)}`;
      wrap.current.dataset.distance = String(r0(fl));
    }
  };

  // ---- effects ---------------------------------------------------------------------------------
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Every change draws once (and the looks move to their new state).
  useEffect(() => wake());

  // The controls (as in the RAG Graph), the light, a faint haze for depth, and a lost context
  // handing over to the timeline.
  const ready = size.w > 0;
  useEffect(() => {
    const f = fg.current;
    const o = orbit();
    const canvas = f?.renderer()?.domElement;
    if (!f || !o || !canvas) return;
    const cam = camera();
    if (cam && (cam.fov !== FOV || cam.near !== NEAR)) {
      cam.fov = FOV;
      cam.near = NEAR;
      cam.updateProjectionMatrix();
    }
    o.enableDamping = !reduced;
    o.dampingFactor = 0.14;
    o.minDistance = 40;
    o.maxDistance = 20000;
    o.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    o.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
    o.screenSpacePanning = true;
    o.zoomToCursor = true;
    const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
    key.position.set(-0.55, 0.9, 0.85);
    const rim = new THREE.DirectionalLight(0x7da2ff, 1.4);
    rim.position.set(0.8, -0.15, -1);
    f.lights([new THREE.AmbientLight(0x9fb0c8, 0.75), new THREE.HemisphereLight(0xc4d2e6, 0x0a0c10, 0.6), key, rim]);
    f.scene().fog = new THREE.Fog(0x0e1116, 1000, 4000);
    const lost = (ev: Event) => (ev.preventDefault(), onFail());
    o.addEventListener("change", wake);
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      o.removeEventListener("change", wake);
      canvas.removeEventListener("webglcontextlost", lost);
    };
  }, [ready, onFail]);

  // The backdrop: still stars far away (they turn with the view), a faint haze round each group,
  // and a record's echo on the other groups it concerns. None of it takes a click.
  useEffect(() => {
    const scene = fg.current?.scene();
    if (!ready || !scene) return;
    const decor = unpickable(new THREE.Group()) as THREE.Group;
    const owned: { dispose: () => void }[] = [];
    if (!matchMedia("(prefers-contrast: more)").matches) {
      const n = 1100;
      const at = new Float32Array(n * 3);
      const radius = Math.max(c.max.x - c.min.x, 1200) * 5;
      for (let i = 0; i < n; i++) {
        const u = hash01(`star${i}`, 11) * 2 - 1;
        const a = hash01(`star${i}`, 13) * Math.PI * 2;
        const sq = Math.sqrt(1 - u * u);
        at.set([radius * sq * Math.cos(a), radius * u, radius * sq * Math.sin(a)], i * 3);
      }
      const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(at, 3));
      const mat = new THREE.PointsMaterial({ color: 0xd6e0ef, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
      decor.add(unpickable(new THREE.Points(geo, mat)));
      owned.push(geo, mat);
    }
    const k = kit();
    // The hazes are large: drawn in software they cost a sixth of each frame, so go without.
    for (const l of software ? [] : c.lanes) {
      const mat = new THREE.SpriteMaterial({ map: k.glow, color: new THREE.Color(0x5f7ea6), transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false });
      const haze = unpickable(new THREE.Sprite(mat));
      haze.position.set((l.x0 + l.x1) / 2, l.y, l.z - c.r * 2);
      haze.scale.set(l.x1 - l.x0 + c.r * 12, c.r * 8, 1);
      decor.add(haze);
      owned.push(mat);
    }
    for (const echo of c.echoes) {
      const rec = byId.get(echo.id);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(KIND_COLOURS[rec?.kind ?? "event"]), transparent: true, opacity: 0.45 });
      const dot3 = unpickable(new THREE.Mesh(k.sphereLow, mat));
      dot3.position.set(echo.at.x, echo.at.y, echo.at.z);
      dot3.scale.set(c.r * 0.32, c.r * 0.32, c.r * 0.32);
      decor.add(dot3);
      owned.push(mat);
    }
    scene.add(decor);
    wake();
    return () => {
      scene.remove(decor);
      for (const o of owned) o.dispose();
    };
  }, [ready, c, byId]);

  useEffect(
    () => () => {
      stopTravel.current();
      cancelAnimationFrame(loop.current);
      loop.current = 0;
    },
    [],
  );
  // A press is over when its pointer comes up or is cancelled, wherever that is.
  useEffect(() => {
    const up = (e: PointerEvent) => void downs.current.delete(e.pointerId);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // A new set of records, or the same laid out again for a phone or a desktop (or the first
  // size): frame it all, from the front. A choice the address already holds is then flown to
  // (below), and closing it returns here.
  const fitted = useRef("");
  const shapeKey = `${layoutKey}|${narrow}`;
  useEffect(() => {
    if (!ready || fitted.current === shapeKey) return;
    const first = fitted.current === "";
    fitted.current = shapeKey;
    home.current = null;
    if (!first && (chosen || chosenLink || run || lane)) return showChoice();
    fit(!first);
  }, [shapeKey, ready]);

  // A choice: remember where the camera was (or was going) when there was none, and fly to
  // what is chosen; no choice any more: fly back there. A choice the address held on arrival
  // has nothing before it: closing it frames everything.
  const before = useRef<string | null>(null);
  const arrived = useRef(false);
  const choiceKey = link ? `link:${link}` : selected;
  useEffect(() => {
    if (!ready) return;
    const was = before.current;
    const first = !arrived.current;
    arrived.current = true;
    before.current = choiceKey;
    if (choiceKey === was) return;
    if (!choiceKey) return restore();
    if (!was && !first && !home.current) {
      // Where the camera is going if it is flying (on its way back, say), else where it is.
      const now = where();
      home.current = now && { camera: now, placement: placement.current };
    }
    showChoice();
  }, [choiceKey, ready]);
  // The same record asked for again (search): fly to it again.
  useEffect(() => {
    if (ready && focus && focus.id === chosen) showChoice();
  }, [focus?.n]);
  // A stretch of time asked for (a day). An equipment item's is not followed here: the item is
  // chosen with it, and its group framed as the choice (from where the camera was).
  useEffect(() => {
    if (!ready || !goTo || goTo.lane) return;
    const ids = layout.records.filter((r) => r.t >= goTo.from && r.t <= goTo.to && (!goTo.lane || r.lane === goTo.lane || r.echoes.includes(goTo.lane))).map((r) => r.id);
    if (ids.length) return focusOn(ids);
    // No record then: the stretch itself, at the constellation's middle height.
    const y = (c.min.y + c.max.y) / 2;
    const ends = [layout.xAt(goTo.from), layout.xAt(goTo.to)].map((x) => ({ p: { x: c.toX(x), y, z: 0 }, r: c.r * 3 }));
    const f = framing(ends, dirNow());
    if (!f) return;
    placement.current = { kind: "free" };
    place(f.at, f.look, true);
  }, [goTo?.n]);

  // The canvas resized (the panel opened or closed, the window changed) by 8 px or more since
  // it was last framed (a slow drag of the window adds up): frame the same thing again (on the
  // way back, what the camera framed before the choice: the panel closing leaves that view as
  // it was).
  const framedAt = useRef({ w: 0, h: 0 });
  useEffect(() => {
    const was = framedAt.current;
    if (!ready) return;
    if (!was.w) return void (framedAt.current = size);
    if (Math.abs(was.w - size.w) < 8 && Math.abs(was.h - size.h) < 8) return;
    framedAt.current = size;
    const p = placement.current;
    if (p.kind === "overview") fit(true, dirNow());
    else if (p.kind === "focus") focusOn(p.ids, p.centre);
  }, [size.w, size.h]);

  // Names are measured again when what they say changes.
  useEffect(() => sizes.current.clear(), [layout, compact, chosen]);
  // A chosen record becomes the tab stop, and stays it once the choice is cleared.
  useEffect(() => {
    if (chosen) setFocusId(chosen);
  }, [chosen]);

  // ---- keyboard --------------------------------------------------------------------------------
  const current = focusId && byId.has(focusId) ? focusId : (chosen ?? layout.records.at(-1)?.id ?? null);
  const [announce, setAnnounce] = useState("");
  // A choice asked for by Enter and not shown yet (the address changes a moment later): Escape
  // straight after still clears it.
  const asked = useRef(false);
  useEffect(() => {
    asked.current = false;
  }, [selected, link]);
  const focusRecord = (id: string, bring = true) => {
    setFocusId(id);
    keyFocus.current = id;
    setAnnounce(s.focused(describe(byId.get(id)!)));
    const sc = screen.current.get(id);
    const band = hudBands(wrap.current);
    // Never over a flight: where it is going decides.
    if (bring && !travelTo.current && (!sc || sc.x < 24 || sc.y < band.top + 24 || sc.x > size.w - 24 || sc.y > size.h - band.bottom - 24)) {
      // Out of sight or under the controls: brought to the middle, without turning (keys do
      // not animate the camera).
      const w = where();
      const p = c.positions.get(id);
      if (w && p) {
        placement.current = { kind: "free" };
        place(along(p, sub(w.pos, w.look), len(sub(w.pos, w.look))), p, false);
      }
    }
    wake();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // The browser's own keys (zoom, back) stay the browser's.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    wake();
    const arrow = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as const)[e.key as "ArrowRight"];
    if (arrow && e.shiftKey) {
      e.preventDefault();
      return turn(arrow[0], arrow[1]);
    }
    const order = layout.records;
    const at = order.findIndex((r) => r.id === current);
    let next: TimelineRecord | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") next = order[at + (e.key === "ArrowRight" ? 1 : -1)];
    else if (e.key === "Home") next = order[0];
    else if (e.key === "End") next = order.at(-1);
    else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && at >= 0) {
      // Groups with records of their own (not only echoes of records elsewhere).
      const keys = c.lanes.filter((l) => order.some((r) => r.lane === l.key)).map((l) => l.key);
      const laneKey = keys[keys.indexOf(order[at].lane) + (e.key === "ArrowDown" ? 1 : -1)];
      next = order.filter((r) => r.lane === laneKey).sort((a, b) => Math.abs(a.x - order[at].x) - Math.abs(b.x - order[at].x))[0];
    } else if ((e.key === "Enter" || e.key === " ") && current) {
      e.preventDefault();
      asked.current = true;
      return onSelect(current);
    } else if (e.key === "Escape" && (selected || link || asked.current)) {
      e.preventDefault();
      asked.current = false;
      return onSelect(null);
    } else if (e.key === "+" || e.key === "=") return zoom(0.8);
    else if (e.key === "-" || e.key === "_") return zoom(1.25);
    else if (e.key === "0") return fit(true);
    else return;
    e.preventDefault();
    if (next) focusRecord(next.id);
  };

  const canvasEl = () => fg.current?.renderer()?.domElement;
  const laneName = (key: string, kind: "equipment" | "none") => (kind === "none" ? t.memory.timeline.none : equipmentName(key));
  return (
    <div className="kn-3d-frame">
      <div className="kn-3d-stage">
        <div
          ref={wrap}
          className="kn-3d mm3"
          data-lenis-prevent
          role="application"
          aria-label={label}
          aria-describedby={hintId}
          tabIndex={0}
          data-mode={chosen || chosenLink || run || lane ? "focus" : "overview"}
          data-selected={selected ?? undefined}
          data-focused={current ?? undefined}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            if (e.target !== e.currentTarget || !current) return;
            // Tabbed to: the tab stop is announced and brought into view. Focus given back as
            // a panel closes (the camera may be flying back) is only announced; a click
            // focuses the canvas too. Neither moves the camera.
            const from = e.relatedTarget instanceof Element ? e.relatedTarget : null;
            if (e.currentTarget.matches(":focus-visible")) focusRecord(current, Boolean(from && !from.closest(".kn-column")));
            else setFocusId(current);
          }}
          onPointerDown={(e) => {
            downs.current.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false });
            // The second press of a double click (or tap) chooses nothing new: what has moved
            // under it since the first, as the camera set off, is not what was meant.
            const [was, t] = [press.current, performance.now()];
            const twice = was !== null && t - was.t < 500 && Math.hypot(e.clientX - was.x, e.clientY - was.y) < (e.pointerType === "mouse" ? 6 : 30);
            const flying = travelTo.current !== null;
            const box = e.currentTarget.getBoundingClientRect();
            press.current = { t, x: e.clientX, y: e.clientY, flying, target: flying && !twice ? recordAt(e.clientX - box.left, e.clientY - box.top) : null };
            wake();
          }}
          onPointerMove={(e) => {
            // A press that moves the view 4 px takes the camera over.
            const at = downs.current.get(e.pointerId);
            if (at && !at.moved && Math.hypot(e.clientX - at.x, e.clientY - at.y) >= 4) (at.moved = true), took();
            wake();
          }}
          onPointerDownCapture={touchPageXY}
          onPointerMoveCapture={(e) => {
            touchPageXY(e);
            if (e.buttons && !downs.current.has(e.pointerId)) e.stopPropagation();
          }}
          onPointerUpCapture={touchPageXY}
          onPointerLeave={() => {
            hover.current = null;
            if (wrap.current) delete wrap.current.dataset.hover;
            wake();
          }}
          onWheel={(e) => {
            // The wheel zooms on the canvas only (not over a name).
            if (e.target === canvasEl()) took();
            wake();
          }}
          onBlur={wake}
          // The right button turns the view, here and on the names: no browser menu.
          onContextMenu={(e) => e.preventDefault()}
        >
          {ready && (
            <ForceGraph3D
              ref={fg}
              width={size.w}
              height={size.h}
              graphData={data}
              controlType="orbit"
              rendererConfig={software ? SOFTWARE_RENDERER : undefined}
              backgroundColor="rgba(0,0,0,0)"
              showNavInfo={false}
              nodeLabel=""
              linkLabel=""
              nodeRelSize={1}
              nodeVal={nodeVal}
              nodeThreeObject={build}
              nodeThreeObjectExtend={false}
              linkColor={linkColor}
              linkWidth={0}
              linkOpacity={1}
              linkCurvature={curvature}
              linkCurveRotation={rotation}
              linkDirectionalArrowLength={arrow}
              linkDirectionalArrowColor={arrowColor}
              linkDirectionalArrowRelPos={1}
              linkHoverPrecision={4}
              enableNodeDrag={false}
              showPointerCursor={pointerCursor}
              warmupTicks={0}
              cooldownTicks={0}
              onNodeHover={(o) => {
                hover.current = o ? String(o.id) : null;
                if (wrap.current) {
                  if (hover.current) wrap.current.dataset.hover = hover.current;
                  else delete wrap.current.dataset.hover;
                }
                wake();
              }}
              onNodeClick={clicked}
              onLinkClick={clicked}
              onBackgroundClick={() => clicked(null)}
            />
          )}
          <div className="kn-3d__labels" aria-hidden="true">
            {layout.records.map((r) => {
              const Icon = KIND_ICONS[r.kind];
              const on = r.id === chosen;
              return (
                <span
                  key={r.id}
                  ref={(el) => {
                    if (el) marks.current.set(`r:${r.id}`, el);
                    else marks.current.delete(`r:${r.id}`);
                  }}
                  className={`kn-3d__label mm3-label mm3-label--${stateOf(r.id)}${on ? " kn-3d__label--on" : ""}${r.superseded ? " mm3-label--old" : ""}`}
                  data-mem-id={r.id}
                  data-kind={r.kind}
                  data-lane={r.lane}
                  data-state={stateOf(r.id)}
                  data-status={r.superseded ? "superseded" : "current"}
                  data-provenance={r.provenance || undefined}
                  style={{ "--kn-c": KIND_COLOURS[r.kind] } as React.CSSProperties}
                  onClick={() => onSelect(r.id)}
                  onPointerDown={(e) => handOverPointer(e, canvasEl())}
                  onPointerEnter={() => {
                    hover.current = r.id;
                    wake();
                  }}
                  onPointerLeave={() => {
                    if (hover.current === r.id) hover.current = null;
                    wake();
                  }}
                >
                  <Icon size={13} aria-hidden="true" className="mm3-label__icon" />
                  {on ? (
                    <span className="mm3-label__card">
                      <span className="mm3-label__title">{shorten(r.title, compact ? 34 : 56)}</span>
                      <span className="mm3-label__meta">
                        {t.memory.kinds[r.kind]} · {formatUtc(r.occurredAt)}
                      </span>
                    </span>
                  ) : (
                    shorten(r.title, compact ? 22 : 30)
                  )}
                </span>
              );
            })}
            {c.lanes.map((l) => (
              <span
                key={l.key}
                ref={(el) => {
                  if (el) marks.current.set(`lane:${l.key}`, el);
                  else marks.current.delete(`lane:${l.key}`);
                }}
                className={`kn-3d__label mm3-lane${lane === l.key ? " mm3-lane--on" : ""}${l.kind === "none" ? " mm3-lane--static" : ""}`}
                data-lane-key={l.key}
                onClick={l.kind === "equipment" ? () => onSelect(lane === l.key ? null : `equipment:${l.key}`) : undefined}
                onPointerDown={(e) => handOverPointer(e, canvasEl())}
              >
                {laneName(l.key, l.kind)}
                {!compact && <span className="mm3-lane__count">{t.memory.timeline.records(l.records)}</span>}
              </span>
            ))}
            {c.runs.map((rn) => (
              <span
                key={rn.id}
                ref={(el) => {
                  if (el) marks.current.set(`run:${rn.id}`, el);
                  else marks.current.delete(`run:${rn.id}`);
                }}
                className={`kn-3d__label mm3-run${selected === rn.id ? " mm3-run--on" : ""}`}
                data-run-id={rn.id}
                title={t.memory.timeline.run(rn.runId)}
                onClick={() => onSelect(selected === rn.id ? null : rn.id)}
                onPointerDown={(e) => handOverPointer(e, canvasEl())}
              >
                {rn.runId}
              </span>
            ))}
            {c.days.map((d, i) => (
              <span
                key={d.day}
                ref={(el) => {
                  if (el) marks.current.set(`day:${d.day}`, el);
                  else marks.current.delete(`day:${d.day}`);
                }}
                className="kn-3d__label mm3-day"
                data-day={d.day}
              >
                {dayName(d.day, i === 0 || d.day.slice(0, 4) !== c.days[i - 1].day.slice(0, 4))}
              </span>
            ))}
            {c.quiet.map((q, i) => (
              <span
                key={`q${i}`}
                ref={(el) => {
                  if (el) marks.current.set(`quiet:${i}`, el);
                  else marks.current.delete(`quiet:${i}`);
                }}
                className="kn-3d__label mm3-day mm3-day--quiet"
                title={t.memory.timeline.quietTitle(Math.round(q.hours / 24))}
              >
                {`≈ ${t.memory.timeline.quiet(Math.round(q.hours / 24))}`}
              </span>
            ))}
            <div ref={ring} className="kn-3d__ring" />
          </div>
          {/* The kinds' icons, drawn into the spheres' textures. */}
          <div ref={iconBox} hidden aria-hidden="true">
            {MEMORY_KINDS.map((k) => {
              const Icon = KIND_ICONS[k];
              return <Icon key={k} data-kind={k} size={200} color={INK} strokeWidth={2.4} />;
            })}
          </div>
        </div>
        <div className="kn-canvas__tools" data-band>
          {extraTools?.before}
          <button type="button" className="icon-button" aria-label={g.zoomIn} title={g.zoomIn} onClick={() => zoom(0.8)}>
            <Plus size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label={g.zoomOut} title={g.zoomOut} onClick={() => zoom(1.25)}>
            <Minus size={15} aria-hidden="true" />
          </button>
          <button type="button" className="button button--small button--quiet" onClick={() => fit(true)}>
            {g.fit}
          </button>
          {extraTools?.after}
        </div>
      </div>
      <div id={hintId} className="kn-canvas__hint">
        <p>{s.hint}</p>
        <p>{s.keys}</p>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
