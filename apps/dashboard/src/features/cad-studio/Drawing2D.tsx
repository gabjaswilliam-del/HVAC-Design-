/**
 * The 2D drawing: the reviewed plant on an engineering sheet, the synthetic source drawing beside
 * it, and the comparison canvases (two synchronized panes, or one with layers). Every canvas
 * shares one viewport: wheel and keyboard zoom, drag to pan, Fit, and an accessible 25–75 %
 * divider between panes. Each view keeps where it was left in the session's placement, so
 * leaving CAD Studio and coming back restores it.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import type { Link, LinkEnd, SceneLayout, Topology } from "../../lib/contracts";
import type { WorkspaceState } from "../../lib/contracts/cadProject";
import { demoTopology } from "../../fixtures/demoPlant";
import { useStrings } from "../../lib/i18n";
import { PlantScene } from "../monitoring/scene/PlantScene";
import { portPosition, spriteGeometry } from "../monitoring/scene/geometry";
import { SpriteDefs } from "../monitoring/scene/materials";
import { centerOn, clampView, fitView, keepCenter, zoomAt, type Size, type View } from "../monitoring/scene/panZoom";
import { cad, type LocateRequest, type Place, type Selection } from "./cadSession";
import type { ChangeKind } from "./diff";
import { deviceIds, deviceReviewState, evidenceReviewState, type ReviewState } from "./review";
import { ViewportContext, type DrawingTool } from "./ViewportContext";

const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.25;
const PAN_STEP = 60;

/** The extraction has no telemetry: every item reads as stopped, with no sample time. */
export const previewReadings = {
  equipment: Object.fromEntries(
    demoTopology.devices.map((device) => [device.id, { state: "stopped" as const, sampleTime: null }]),
  ),
  values: {},
};

export interface SceneProps {
  topology: Topology;
  selection: Selection;
  onSelect?: (id: string) => void;
  onSelectLink?: (id: string) => void;
  layers: WorkspaceState["layers"];
  colourBy: WorkspaceState["colourBy"];
  traceIds?: ReadonlySet<string>;
  findingIds?: ReadonlySet<string>;
}

/** The sheet: paper with a fine and a coarse grid (outlines only). */
export function TechnicalGrid({ scene }: { scene: SceneLayout }) {
  const id = `cad-grid-${useId().replace(/:/g, "")}`;
  return (
    <g className="cad-grid" aria-hidden="true">
      <rect width={scene.width} height={scene.height} className="cad-grid__paper" />
      <defs>
        <pattern id={`${id}-minor`} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" className="cad-grid__minor" /></pattern>
        <pattern id={`${id}-major`} width="200" height="200" patternUnits="userSpaceOnUse"><path d="M 200 0 L 0 0 0 200" fill="none" className="cad-grid__major" /></pattern>
      </defs>
      <rect width={scene.width} height={scene.height} fill={`url(#${id}-minor)`} />
      <rect width={scene.width} height={scene.height} fill={`url(#${id}-major)`} />
    </g>
  );
}

/** The reviewed plant, drawn by the shared plant artwork without telemetry. */
export function EngineeringScene({ topology, selection, onSelect, onSelectLink, layers, colourBy, traceIds, findingIds, scene, grid = true }: SceneProps & { scene: SceneLayout; grid?: boolean }) {
  const copy = useStrings().cad;
  const selectedId = selection?.kind === "device" ? selection.id : selection?.kind === "port" ? selection.deviceId : null;
  const activeLink = selection?.kind === "link" ? topology.links.find((link) => link.id === selection.id) : undefined;
  const reviewStates = colourBy === "review" ? Object.fromEntries(topology.devices.map((device) => [device.id, deviceReviewState(device.id, topology)])) as Record<string, ReviewState> : undefined;
  const reviewLabels = reviewStates ? Object.fromEntries(Object.entries(reviewStates).map(([id, state]) => [id, copy.reviewStates[state]])) : undefined;
  const reviewLinkStates = colourBy === "review" ? Object.fromEntries(topology.links.map((link) => [link.id, evidenceReviewState(link.evidence)])) : undefined;
  return (
    <>
      <SpriteDefs />
      {grid && <TechnicalGrid scene={scene} />}
      <PlantScene
        topology={{ ...topology, devices: topology.devices.map((device) => ({ ...device, label: copy.equipmentName(device.id, device.label) })) }}
        layout={scene}
        readings={previewReadings}
        selectedId={selectedId}
        selectedLinkId={activeLink?.id}
        highlightIds={activeLink ? deviceIds(activeLink) : []}
        reviewStates={reviewStates}
        reviewLabels={reviewLabels}
        reviewLinkStates={reviewLinkStates}
        traceIds={traceIds}
        findingIds={findingIds}
        layers={layers}
        heavyHeaders
        showTags={false}
        showStates={colourBy === "review"}
        onSelect={onSelect}
        onSelectLink={onSelectLink}
        pipeLabel={(link) => `${copy.connection}: ${link.id}`}
      />
    </>
  );
}

/** The synthetic source drawing: the sheet's outlines, as a drafter would have drawn them. */
function SourceLayer({ scene, selectedId, onSelect }: { scene: SceneLayout; selectedId: string | null; onSelect?: (id: string) => void }) {
  return (
    <g className="cad-drawing-layer">
      <TechnicalGrid scene={scene} />
      {Object.entries(scene.buses).flatMap(([id, groups]) => groups.map((points, index) => (
        <polyline key={`${id}-${index}`} points={points.map((point) => point.join(",")).join(" ")} />
      )))}
      {Object.entries(scene.nodes).map(([id, node]) => {
        const geometry = spriteGeometry[node.kind];
        const label = demoTopology.devices.find((device) => device.id === id)?.label ?? id;
        return (
          <g
            key={id}
            className={`cad-source-node${selectedId === id ? " is-selected" : ""}`}
            transform={`translate(${node.x} ${node.y})`}
            role={onSelect ? "button" : undefined}
            aria-label={onSelect ? label : undefined}
            tabIndex={onSelect ? 0 : undefined}
            onClick={onSelect ? () => onSelect(id) : undefined}
            onKeyDown={onSelect ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(id);
              }
            } : undefined}
          >
            <rect width={geometry.width} height={geometry.height} />
            <text x="8" y="22">{id.toUpperCase()}</text>
          </g>
        );
      })}
    </g>
  );
}

/** The reviewed drawing on its own: the Drawing view's canvas. */
export function SyntheticDrawing({ scene, locate, toolbar, ...props }: SceneProps & { scene: SceneLayout; locate: LocateRequest; toolbar?: ReactNode }) {
  const copy = useStrings().cad;
  return (
    <CadViewport scene={scene} locate={locate} ariaLabel={copy.editableSceneLabel} className="cad-sheet" place="drawing" toolbar={toolbar}>
      <EngineeringScene {...props} scene={scene} />
    </CadViewport>
  );
}

/** The synthetic source drawing beside the extraction, in one pan and zoom. */
export function SourceCompareView({ scene, locate, toolbar, ...props }: SceneProps & { scene: SceneLayout; locate: LocateRequest; toolbar?: ReactNode }) {
  const copy = useStrings().cad;
  const selectedId = props.selection?.kind === "device" ? props.selection.id : props.selection?.kind === "port" ? props.selection.deviceId : null;
  return (
    <CadViewport
      scene={scene}
      locate={locate}
      ariaLabel={copy.compareDrawingLabel}
      className="cad-sheet"
      place="source"
      toolbar={toolbar}
      paneLabels={[copy.sourceSide, copy.extractedSide]}
      paneNames={[copy.sourceDrawingLabel, copy.editableSceneLabel]}
      secondary={<EngineeringScene {...props} scene={scene} />}
    >
      <SourceLayer scene={scene} selectedId={selectedId} onSelect={props.onSelect} />
    </CadViewport>
  );
}

type XY = [number, number];
const endPoint = (end: LinkEnd, scene: SceneLayout): XY | null => {
  if (!("device" in end)) return null;
  const node = scene.nodes[end.device];
  if (!node) return null;
  const p = portPosition(node.kind, end.port, node, node.flip);
  return [p.x, p.y];
};
/** A connection's path on the sheet, as the plant artwork draws it. */
export function linkPoints(link: Link, scene: SceneLayout): XY[] {
  const start = endPoint(link.from, scene);
  const end = endPoint(link.to, scene);
  return [...(start ? [start] : []), ...(scene.links[link.id] ?? []), ...(end ? [end] : [])];
}
const pointsAttr = (points: XY[]) => points.map((p) => p.join(",")).join(" ");
const midpoint = (points: XY[]): XY => {
  if (points.length < 2) return points[0] ?? [0, 0];
  const a = points[Math.floor((points.length - 1) / 2)], b = points[Math.floor((points.length - 1) / 2) + 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
};

/**
 * What changed, drawn over a scene: connections as coloured runs (a removed one dashed, at
 * the reference's place), equipment as an outline, and ports as rings. Each change carries a
 * revision triangle, so the marks never rely on colour alone.
 */
export function DiffLayer({ scene, links, devices, ports, show = ["added", "removed", "changed"] }: {
  scene: SceneLayout;
  links: { link: Link; kind: ChangeKind }[];
  devices: { id: string; kind: ChangeKind }[];
  ports: { device: string; port: string; kind: ChangeKind }[];
  show?: ChangeKind[];
}) {
  const visible = (kind: ChangeKind) => show.includes(kind);
  const delta = ([x, y]: XY, kind: ChangeKind, key: string) => (
    <g key={`d-${key}`} className={`cad-diff__delta cad-diff--${kind}`} transform={`translate(${x} ${y - 44})`}>
      <path d="M 0 -22 L 24 18 L -24 18 Z" />
      <text y="12" textAnchor="middle">{kind === "added" ? "+" : kind === "removed" ? "−" : "~"}</text>
    </g>
  );
  return (
    <g className="cad-diff" aria-hidden="true">
      {links.filter(({ kind }) => visible(kind)).map(({ link, kind }) => {
        const points = linkPoints(link, scene);
        if (points.length < 2) return null;
        return (
          <g key={link.id} className={`cad-diff__link cad-diff--${kind}`} data-diff={kind} data-link-id={link.id}>
            <polyline className="cad-diff__halo" points={pointsAttr(points)} />
            <polyline className="cad-diff__run" points={pointsAttr(points)} />
            {delta(midpoint(points), kind, link.id)}
          </g>
        );
      })}
      {devices.filter(({ kind }) => visible(kind)).map(({ id, kind }) => {
        const node = scene.nodes[id];
        if (!node) return null;
        const g = spriteGeometry[node.kind];
        return (
          <g key={id} className={`cad-diff__device cad-diff--${kind}`} data-diff={kind} data-device-id={id}>
            <rect x={node.x - 10} y={node.y - 10} width={g.width + 20} height={g.height + 20} rx={8} />
            {delta([node.x + g.width + 4, node.y + 18], kind, id)}
          </g>
        );
      })}
      {ports.filter(({ kind }) => visible(kind)).map(({ device, port, kind }) => {
        const at = endPoint({ device, port }, scene);
        if (!at) return null;
        return (
          <g key={`${device}:${port}`} className={`cad-diff__port cad-diff--${kind}`} data-diff={kind}>
            <circle cx={at[0]} cy={at[1]} r={22} />
            {delta(at, kind, `${device}:${port}`)}
          </g>
        );
      })}
    </g>
  );
}

export function CadViewport({ scene, locate, ariaLabel, className, place, children, secondary, toolbar, paneLabels, paneNames }: {
  scene: SceneLayout;
  locate: LocateRequest;
  ariaLabel: string;
  className: string;
  /** The view this viewport shows: where it was left is kept under this key. */
  place: Place;
  children: ReactNode;
  /** A second pane beside the first, in the same pan and zoom. */
  secondary?: ReactNode;
  toolbar?: ReactNode;
  /** The panes' visible labels and accessible names. */
  paneLabels?: [ReactNode, ReactNode];
  paneNames?: [string, string];
}) {
  const copy = useStrings().cad;
  const [tool, setTool] = useState<DrawingTool>("select");
  const [spacePan, setSpacePan] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(() => cad.placement.compareSplit);
  const [box, setBox] = useState<Size | null>(null);
  const saved = useRef(cad.placement.viewports[place]);
  const [view, setView] = useState<View>(() => saved.current?.view ?? { k: 1, x: 0, y: 0 });
  const [locating, setLocating] = useState(false);
  const latest = useRef({ box, view });
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const locateTimer = useRef<number | null>(null);
  const splitDrag = useRef<number | null>(null);
  latest.current = { box, view };
  const canvas = { w: scene.width, h: scene.height };

  const updateBox = useCallback((width: number, height: number) => {
    if (width < 10 || height < 10) return;
    const next = { w: width, h: height };
    const previous = latest.current.box;
    if (previous && previous.w === width && previous.h === height) return;
    setBox(next);
    // First measure: a saved project's viewport, else where this view was left (re-centred for
    // a changed size), else fitted.
    const back = saved.current;
    const restore = cad.placement.restore?.view === place ? cad.placement.restore : null;
    if (restore) cad.placement.restore = null;
    setView((current) =>
      previous ? keepCenter(current, previous, next, canvas)
        : restore ? centerOn(restore.cx, restore.cy, restore.scale, canvas, next)
          : back ? keepCenter(back.view, back.box, next, canvas)
            : fitView(canvas, next));
  }, [scene.width, scene.height]);

  // Where this view is, kept as it moves (a save reads it; a remount returns to it).
  useEffect(() => {
    if (box) cad.placement.viewports[place] = { view, box };
  }, [place, view, box]);

  const commitSplit = (next: number) => {
    cad.placement.compareSplit = next;
    setSplit(next);
  };

  useLayoutEffect(() => {
    const element = secondary ? paneRef.current! : boxRef.current!;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      updateBox(rect.width || scene.width, rect.height || scene.height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => updateBox(entry.contentRect.width, entry.contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [!!secondary, updateBox]);

  const stopMotion = () => {
    setLocating(false);
    if (locateTimer.current !== null) window.clearTimeout(locateTimer.current);
  };

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const current = latest.current;
      if (!current.box) return;
      if (event.target instanceof Element && event.target.closest(".cad-float")) return;
      event.preventDefault();
      stopMotion();
      const pane = secondary && event.target instanceof Element ? event.target.closest(".cad-compare-pane") : null;
      const rect = (pane ?? element).getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      setView(zoomAt(current.view, factor, event.clientX - rect.left, event.clientY - rect.top, canvas, current.box));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [scene.width, scene.height, !!secondary]);

  useEffect(() => {
    // A request already applied (before this view was left) does not move a restored view again.
    if (!locate || !box || locate.nonce === cad.placement.locatedNonce) return;
    const node = scene.nodes[locate.id];
    if (!node) return;
    cad.placement.locatedNonce = locate.nonce;
    const geometry = spriteGeometry[node.kind];
    const fitted = fitView(canvas, box).k;
    const scale = Math.max(view.k, Math.min(1.25, fitted * 1.9));
    setLocating(true);
    setView(centerOn(node.x + geometry.width / 2, node.y + geometry.height / 2, scale, canvas, box));
    if (locateTimer.current !== null) window.clearTimeout(locateTimer.current);
    locateTimer.current = window.setTimeout(() => setLocating(false), 300);
  }, [locate?.nonce, box === null]);

  const apply = (next: View) => {
    stopMotion();
    setView(next);
  };
  const zoomCentre = (factor: number) => box && apply(zoomAt(view, factor, box.w / 2, box.h / 2, canvas, box));
  const fit = () => box && apply(fitView(canvas, box));

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".cad-float")) return;
    const wantsPan = event.button === 1 || (event.button === 0 && (tool === "pan" || spacePan || event.pointerType === "touch"));
    if (!wantsPan) return;
    event.preventDefault();
    suppressClick.current = false;
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false, id: event.pointerId };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || !box) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!current.moved) {
      current.moved = true;
      event.currentTarget.setPointerCapture(current.id);
    }
    apply(clampView({ k: current.view.k, x: current.view.x + dx, y: current.view.y + dy }, canvas, box));
  };
  const onPointerUp = () => {
    if (drag.current?.moved) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    drag.current = null;
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !box) return;
    if (event.key === " ") {
      event.preventDefault();
      setSpacePan(true);
      return;
    }
    const pan = (dx: number, dy: number) => apply(clampView({ ...view, x: view.x + dx, y: view.y + dy }, canvas, box));
    const actions: Record<string, () => void> = {
      "+": () => zoomCentre(ZOOM_STEP), "=": () => zoomCentre(ZOOM_STEP), "-": () => zoomCentre(1 / ZOOM_STEP), "0": fit,
      ArrowLeft: () => pan(PAN_STEP, 0), ArrowRight: () => pan(-PAN_STEP, 0), ArrowUp: () => pan(0, PAN_STEP), ArrowDown: () => pan(0, -PAN_STEP),
    };
    if (actions[event.key]) {
      event.preventDefault();
      actions[event.key]();
    }
  };
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  const group = (content: ReactNode) => box && <g className={`cad-canvas-group${locating ? " is-locating" : ""}`} style={{ transform }}>{content}</g>;
  const resizeSplit = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1) return;
    commitSplit(Math.max(25, Math.min(75, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <ViewportContext.Provider value={{ zoomLevel: view.k, zoomIn: () => zoomCentre(ZOOM_STEP), zoomOut: () => zoomCentre(1 / ZOOM_STEP), fit, tool, setTool }}>
      <div
        ref={boxRef}
        className={`cad-viewport ${className}`}
        role="group"
        tabIndex={0}
        aria-label={ariaLabel}
        data-tool={tool}
        data-space-pan={spacePan ? "true" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            event.stopPropagation();
          }
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => { if (event.key === " ") setSpacePan(false); }}
        onBlur={() => setSpacePan(false)}
      >
        <div className="cad-viewport__stage">
          {secondary ? (
            <div className="cad-compare-panes" style={{ gridTemplateColumns: `${split}% ${100 - split}%` }}>
              <div ref={paneRef} className="cad-compare-pane cad-compare-pane--a">
                {paneLabels && <span className="cad-compare-label">{paneLabels[0]}</span>}
                <svg className="cad-review-canvas cad-review-canvas--a" role="group" aria-label={paneNames?.[0]}>{group(children)}</svg>
              </div>
              <div className="cad-compare-pane cad-compare-pane--b">
                {paneLabels && <span className="cad-compare-label">{paneLabels[1]}</span>}
                <svg className="cad-review-canvas cad-review-canvas--b" role="group" aria-label={paneNames?.[1]}>{group(secondary)}</svg>
              </div>
            </div>
          ) : (
            <svg className="cad-review-canvas">{group(children)}</svg>
          )}

          {secondary && (
            <div
              className="cad-compare-splitter"
              role="separator"
              aria-label={copy.resizeComparison}
              aria-orientation="vertical"
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={Math.round(split)}
              tabIndex={0}
              style={{ left: `${split}%` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                splitDrag.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (splitDrag.current === event.pointerId) resizeSplit(event.clientX);
              }}
              onPointerUp={(event) => {
                if (splitDrag.current === event.pointerId) splitDrag.current = null;
              }}
              onPointerCancel={() => { splitDrag.current = null; }}
              onKeyDown={(event) => {
                const actions: Record<string, () => void> = {
                  ArrowLeft: () => commitSplit(Math.max(25, split - 5)),
                  ArrowRight: () => commitSplit(Math.min(75, split + 5)),
                  Home: () => commitSplit(25),
                  End: () => commitSplit(75),
                };
                if (actions[event.key]) {
                  event.preventDefault();
                  event.stopPropagation();
                  actions[event.key]();
                }
              }}
            >
              <span aria-hidden="true"><GripVertical size={14} /></span>
            </div>
          )}
        </div>
        {toolbar}
      </div>
    </ViewportContext.Provider>
  );
}
