/**
 * The 2D views: the synthetic source drawing, and Compare (source beside extraction) in one
 * shared pan and zoom with an accessible 25–75 % divider. Each view keeps where it was left in
 * the session's placement, so leaving CAD Studio and coming back restores it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical, Minus, Plus, Scan } from "lucide-react";
import type { SceneLayout, Topology } from "../../lib/contracts";
import { demoTopology } from "../../fixtures/demoPlant";
import { useStrings } from "../../lib/i18n";
import { PlantScene } from "../monitoring/scene/PlantScene";
import { spriteGeometry } from "../monitoring/scene/geometry";
import { SpriteDefs } from "../monitoring/scene/materials";
import { centerOn, clampView, fitView, keepCenter, zoomAt, type Size, type View } from "../monitoring/scene/panZoom";
import { cad, type LocateRequest, type Selection, type StudioView } from "./cadSession";
import { deviceIds, deviceReviewState, type ReviewState } from "./review";

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

export function SyntheticDrawing({ scene, selectedId, locate, onSelect }: {
  scene: SceneLayout;
  selectedId: string | null;
  locate: LocateRequest;
  onSelect: (id: string) => void;
}) {
  const copy = useStrings().cad;
  return (
    <CadViewport scene={scene} locate={locate} ariaLabel={copy.sourceDrawingLabel} className="cad-sheet" place="drawing">
      <DrawingLayer scene={scene} selectedId={selectedId} onSelect={onSelect} />
    </CadViewport>
  );
}

function DrawingLayer({ scene, selectedId, onSelect }: {
  scene: SceneLayout;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}) {
  return (
    <g className="cad-drawing-layer">
      <defs><pattern id="cad-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" /></pattern></defs>
      <rect width="100%" height="100%" fill="url(#cad-grid)" />
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
              if (event.key === "Enter" || event.key === " ") onSelect(id);
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

export function CompareView({ topology, scene, selection, locate, onSelect }: {
  topology: Topology;
  scene: SceneLayout;
  selection: Selection;
  locate: LocateRequest;
  onSelect: (id: string) => void;
}) {
  const copy = useStrings().cad;
  const selectedId = selection?.kind === "device" ? selection.id : selection?.kind === "port" ? selection.deviceId : null;
  const activeLink = selection?.kind === "link" ? topology.links.find((link) => link.id === selection.id) : undefined;
  const reviewStates = Object.fromEntries(
    topology.devices.map((device) => [device.id, deviceReviewState(device.id, topology)]),
  ) as Record<string, ReviewState>;
  const reviewLabels = Object.fromEntries(
    Object.entries(reviewStates).map(([id, state]) => [id, copy.reviewStates[state]]),
  );

  return (
    <CadViewport
      scene={scene}
      locate={locate}
      ariaLabel={copy.compareDrawingLabel}
      className="cad-compare-view"
      place="compare"
      secondary={(
        <>
          <rect className="cad-extraction-bg" width={scene.width} height={scene.height} />
          <SpriteDefs />
          <PlantScene
            topology={{ ...topology, devices: topology.devices.map((device) => ({ ...device, label: copy.equipmentName(device.id, device.label) })) }}
            layout={scene}
            readings={previewReadings}
            selectedId={selectedId}
            selectedLinkId={activeLink?.id}
            highlightIds={activeLink ? deviceIds(activeLink) : []}
            reviewStates={reviewStates}
            reviewLabels={reviewLabels}
            showTags={false}
            onSelect={onSelect}
          />
        </>
      )}
    >
      <DrawingLayer scene={scene} selectedId={null} />
    </CadViewport>
  );
}

function CadViewport({ scene, locate, ariaLabel, className, place, children, secondary }: {
  scene: SceneLayout;
  locate: LocateRequest;
  ariaLabel: string;
  className: string;
  /** The view this viewport shows: where it was left is kept under this key. */
  place: StudioView;
  children: ReactNode;
  secondary?: ReactNode;
}) {
  const copy = useStrings().cad;
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
  }, [secondary, updateBox]);

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
      event.preventDefault();
      stopMotion();
      const pane = secondary && event.target instanceof Element ? event.target.closest(".cad-compare-pane") : null;
      const rect = (pane ?? element).getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      setView(zoomAt(current.view, factor, event.clientX - rect.left, event.clientY - rect.top, canvas, current.box));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [scene.width, scene.height, secondary]);

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
    if (event.button !== 0 || (event.target as Element).closest(".cad-zoom, .cad-status-legend")) return;
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
  const percent = Math.round(view.k * 100);
  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  const resizeSplit = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || rect.width < 1) return;
    commitSplit(Math.max(25, Math.min(75, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div
      ref={boxRef}
      className={`cad-viewport ${className}`}
      role="group"
      tabIndex={0}
      aria-label={ariaLabel}
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
    >
      {secondary ? (
        <div className="cad-compare-panes" style={{ gridTemplateColumns: `${split}% ${100 - split}%` }}>
          <div ref={paneRef} className="cad-compare-pane cad-compare-pane--source">
            <span className="cad-compare-label">{copy.sourceSide}</span>
            <svg className="cad-review-canvas cad-review-canvas--source" role="group" aria-label={copy.sourceDrawingLabel}>
              {box && <g className={`cad-canvas-group${locating ? " is-locating" : ""}`} style={{ transform }}>{children}</g>}
            </svg>
          </div>
          <div className="cad-compare-pane cad-compare-pane--extraction">
            <span className="cad-compare-label">{copy.extractedSide}</span>
            <svg className="cad-review-canvas cad-review-canvas--extraction" role="group" aria-label={copy.editableSceneLabel}>
              {box && <g className={`cad-canvas-group${locating ? " is-locating" : ""}`} style={{ transform }}>{secondary}</g>}
            </svg>
          </div>
        </div>
      ) : (
        <svg className="cad-review-canvas cad-review-canvas--source" role="group" aria-label={copy.sourceDrawingLabel}>
          {box && <g className={`cad-canvas-group${locating ? " is-locating" : ""}`} style={{ transform }}>{children}</g>}
        </svg>
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

      <div className="cad-zoom" role="toolbar" aria-label={copy.zoomControls}>
        <button type="button" onClick={() => zoomCentre(1 / ZOOM_STEP)} aria-label={copy.zoomOut} title={copy.zoomOut}><Minus size={14} aria-hidden="true" /></button>
        <output aria-label={`${copy.zoomLevel} ${percent}%`}>{percent}%</output>
        <button type="button" onClick={() => zoomCentre(ZOOM_STEP)} aria-label={copy.zoomIn} title={copy.zoomIn}><Plus size={14} aria-hidden="true" /></button>
        <button type="button" onClick={fit} aria-label={copy.fitDrawing} title={copy.fitDrawing}><Scan size={14} aria-hidden="true" /></button>
      </div>
      {secondary && <EvidenceLegend />}
    </div>
  );
}

function EvidenceLegend() {
  const copy = useStrings().cad;
  return (
    <div className="cad-status-legend" aria-label={copy.reviewStatus}>
      {(["confirmed", "review", "conflict", "unknown"] as const).map((status) => (
        <span key={status}><i className={`is-${status}`} />{copy.reviewStates[status]}</span>
      ))}
    </div>
  );
}
