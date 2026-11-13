/**
 * The 3D view (the lazy 3D chunk): the engine in a focusable host; equipment names as buttons
 * (keyboard-selectable; a press that becomes a drag moves the view instead); finding badges;
 * and camera controls. Keys: +/− zoom, 0 fit, R isometric, P plan, arrows pan, Shift+arrows orbit.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { CircleAlert, Minus, Plus, RotateCcw, Scan, Square } from "lucide-react";
import { useStrings } from "../../../lib/i18n";
import { drawsInSoftware, handOverPointer } from "../../knowledge/graph/scene3d";
import type { LocateRequest } from "../cadSession";
import { createEngine, type ColourBy, type Engine, type EngineState, type FitLabel, type Layers } from "./engine";
import { declutterLabels, leaderLine, type LabelItem } from "./labels";
import type { PlantModel } from "./plantModel";
import type { ReviewState } from "../review";

export interface FindingBadge {
  id: string;
  deviceId: string;
  label: string;
  title: string;
  onLocate: () => void;
}
export interface Plant3DProps {
  model: PlantModel;
  selectedId: string | null;
  traceIds: ReadonlySet<string>;
  findingIds: ReadonlySet<string>;
  findings: FindingBadge[];
  layers: Layers;
  colourBy: ColourBy;
  reviewStates: Record<string, ReviewState>;
  preset: "isometric" | "plan";
  presetRevision: number;
  locate: LocateRequest;
  onPreset: (preset: "isometric" | "plan") => void;
  onPick: (owner: string) => void;
  onLost: () => void;
  label: string;
}

const TOP: Record<string, number> = { chiller: 101, pump: 31, coolingTower: 124, dataHall: 60 };
const PAN = 60;

export default function Plant3DCanvas({ model, selectedId, traceIds, findingIds, findings, layers, colourBy, reviewStates, preset, presetRevision, locate, onPreset, onPick, onLost, label }: Plant3DProps) {
  const copy = useStrings().cad;
  const host = useRef<HTMLDivElement>(null);
  const plates = useRef(new Map<string, HTMLElement>());
  const leaders = useRef<SVGSVGElement>(null);
  const engine = useRef<Engine | null>(null);
  const handlers = useRef({ onPick, onLost });
  handlers.current = { onPick, onLost };
  const state = useMemo<EngineState>(() => ({ selectedId, traceIds, findingIds, layers, colourBy, reviewStates }), [selectedId, traceIds, findingIds, layers, colourBy, reviewStates]);
  const latest = useRef(state);
  latest.current = state;

  const anchors = useMemo(() => {
    const equipment = model.equipment.map((e) => ({ id: e.id, kind: e.kind, at: [e.x + e.width / 2, TOP[e.kind] ?? 40, e.z + e.depth / 2] as const }));
    const longest = new Map<string, { length: number; at: readonly [number, number, number] }>();
    const headerRuns = model.runs.filter((r) => r.header && copy.headerNames[r.owner]);
    for (const run of headerRuns) {
      const [a, b] = [run.points[0], run.points.at(-1)!];
      const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if ((longest.get(run.owner)?.length ?? -1) < length) longest.set(run.owner, { length, at: [(a[0] + b[0]) / 2, a[1] + run.radius, (a[2] + b[2]) / 2] });
    }
    const findingAnchors = findings.map((finding) => {
      const equipment = model.equipment.find((candidate) => candidate.id === finding.deviceId);
      return equipment ? { id: `finding:${finding.id}`, at: [equipment.x + equipment.width / 2, TOP[equipment.kind] ?? 40, equipment.z + equipment.depth / 2] as const } : null;
    }).filter((anchor): anchor is { id: string; at: readonly [number, number, number] } => anchor !== null);
    return { equipment, headers: [...longest].map(([id, { at }]) => ({ id, at })), findings: findingAnchors };
  }, [model, findings, copy.headerNames]);

  useLayoutEffect(() => {
    const forEachLabel = (visit: (id: string, at: readonly [number, number, number], width: number, height: number, priority: number) => void) => {
      const current = latest.current;
      const add = (id: string, at: readonly [number, number, number], priority: number) => {
        const element = plates.current.get(id);
        if (!element || (!current.layers.names && !id.startsWith("finding:"))) return;
        visit(id, at, element.offsetWidth, element.offsetHeight, priority);
      };
      for (const anchor of anchors.equipment) add(anchor.id, anchor.at, current.selectedId === anchor.id ? 100 : current.findingIds.has(anchor.id) ? 90 : anchor.kind === "dataHall" ? 70 : anchor.kind === "chiller" ? 60 : anchor.kind === "pump" ? 50 : 40);
      for (const anchor of anchors.findings) add(anchor.id, anchor.at, 200);
      for (const anchor of anchors.headers) add(anchor.id, anchor.at, 10);
    };
    const fitLabels = () => {
      const labels: FitLabel[] = [];
      forEachLabel((id, at, width, height, priority) => labels.push({ id, at, width, height, priority }));
      return labels;
    };
    const layoutNow = () => {
      const started = performance.now();
      const currentEngine = engine.current;
      if (!currentEngine) return;
      const items: LabelItem[] = [];
      forEachLabel((id, at, width, height, priority) => {
        const [x, y] = currentEngine.project(at[0], at[1], at[2]);
        items.push({ id, x, y, width, height, priority });
      });
      const { w, h } = { w: host.current?.clientWidth ?? 1, h: host.current?.clientHeight ?? 1 };
      const placements = declutterLabels(items, w, h, [{ left: w - 220, top: h - 64, right: w - 8, bottom: h - 8 }]);
      for (const [id, element] of plates.current) {
        const placement = placements[id];
        element.style.visibility = placement ? "visible" : "hidden";
        if (placement) element.style.transform = `translate(${Math.round(placement.x)}px, ${Math.round(placement.y)}px)`;
      }
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const line of leaders.current?.querySelectorAll<SVGLineElement>("line") ?? []) {
        const item = byId.get(line.dataset.leader ?? "");
        const segment = item ? leaderLine(item, placements[item.id]) : null;
        line.style.visibility = segment ? "visible" : "hidden";
        if (segment) {
          for (const [index, value] of segment.entries()) line.setAttribute(["x1", "y1", "x2", "y2"][index], String(value));
        }
      }
      host.current!.dataset.labelFrame = host.current!.dataset.frames ?? "0";
      host.current!.dataset.labelMs = (performance.now() - started).toFixed(3);
    };
    const created = createEngine(host.current!, model, { pick: (owner) => handlers.current.onPick(owner), lost: () => handlers.current.onLost(), frame: layoutNow, fitLabels }, { software: drawsInSoftware(), initial: latest.current });
    engine.current = created;
    layoutNow();
    return () => {
      engine.current = null;
      created.dispose();
    };
  }, [model, anchors]);

  useEffect(() => engine.current?.update(state), [state]);
  useEffect(() => {
    if (preset === "plan") engine.current?.plan();
    else engine.current?.reset();
  }, [preset, presetRevision]);
  useEffect(() => {
    if (locate) engine.current?.focus(locate.id);
  }, [locate?.nonce]);

  const keys: Record<string, (e: Engine) => void> = {
    "+": (e) => e.zoomBy(1.25),
    "=": (e) => e.zoomBy(1.25),
    "-": (e) => e.zoomBy(0.8),
    "0": (e) => e.fit(),
    r: (e) => e.reset(),
    R: (e) => e.reset(),
    p: (e) => e.plan(),
    P: (e) => e.plan(),
    ArrowLeft: (e) => e.panBy(PAN, 0),
    ArrowRight: (e) => e.panBy(-PAN, 0),
    ArrowUp: (e) => e.panBy(0, PAN),
    ArrowDown: (e) => e.panBy(0, -PAN),
    "Shift+ArrowLeft": (e) => e.orbitBy(-15),
    "Shift+ArrowRight": (e) => e.orbitBy(15),
    "Shift+ArrowUp": (e) => e.orbitBy(0, -10),
    "Shift+ArrowDown": (e) => e.orbitBy(0, 10),
  };
  const canvas = () => host.current?.querySelector("canvas") ?? undefined;
  const choosePreset = onPreset;

  return (
    <div
      ref={host}
      className="cad-3d"
      role="application"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = event.shiftKey ? `Shift+${event.key}` : event.key;
        const act = event.target === event.currentTarget ? keys[key] : undefined;
        if (!act || !engine.current) return;
        event.preventDefault();
        act(engine.current);
        if (key === "p" || key === "P") choosePreset("plan");
        if (key === "r" || key === "R") choosePreset("isometric");
      }}
    >
      <svg ref={leaders} className="cad-3d__leaders" width="100%" height="100%" aria-hidden="true">
        {[...anchors.equipment, ...anchors.headers, ...anchors.findings].map((anchor) => <line key={anchor.id} data-leader={anchor.id} visibility="hidden" />)}
      </svg>
      <div className="cad-3d__plates">
        {model.equipment.map((equipment) => (
          <button
            key={equipment.id}
            type="button"
            data-equipment-id={equipment.id}
            ref={(element) => void (element ? plates.current.set(equipment.id, element) : plates.current.delete(equipment.id))}
            className="cad-3d__plate"
            aria-pressed={selectedId === equipment.id}
            onPointerDown={(event) => handOverPointer(event, canvas())}
            onClick={() => onPick(equipment.id)}
          >
            {copy.equipmentName(equipment.id, equipment.label)}
            {equipment.standby && <small>· {copy.standby}</small>}
          </button>
        ))}
        {[...new Set(model.runs.filter((run) => run.header && copy.headerNames[run.owner]).map((run) => run.owner))].map((bus) => {
          const medium = model.runs.find((run) => run.owner === bus)!.medium;
          return (
            <span key={bus} ref={(element) => void (element ? plates.current.set(bus, element) : plates.current.delete(bus))} className="cad-3d__plate cad-3d__plate--header">
              <i className={`cad-3d__swatch cad-3d__swatch--${medium}`} aria-hidden="true" />
              {copy.headerNames[bus]}
            </span>
          );
        })}
        {findings.map((finding) => (
          <button
            key={finding.id}
            type="button"
            ref={(element) => void (element ? plates.current.set(`finding:${finding.id}`, element) : plates.current.delete(`finding:${finding.id}`))}
            className="cad-3d__plate cad-3d__finding"
            title={finding.title}
            onClick={finding.onLocate}
          >
            <CircleAlert size={12} aria-hidden="true" />
            {finding.label}
          </button>
        ))}
      </div>
      <div className="cad-zoom" role="toolbar" aria-label={copy.zoomControls}>
        <button type="button" onClick={() => engine.current?.zoomBy(0.8)} aria-label={copy.zoomOut} title={copy.zoomOut}><Minus size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => engine.current?.zoomBy(1.25)} aria-label={copy.zoomIn} title={copy.zoomIn}><Plus size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => engine.current?.fit()} aria-label={copy.fitModel} title={copy.fitModel}><Scan size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => choosePreset("isometric")} aria-label={copy.resetView} title={copy.resetView}><RotateCcw size={14} aria-hidden="true" /></button>
        <button type="button" onClick={() => choosePreset("plan")} aria-label={copy.planView} title={copy.planView}><Square size={14} aria-hidden="true" /></button>
      </div>
    </div>
  );
}
