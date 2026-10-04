import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Maximize, Minus, Plus, Tags } from "lucide-react";
import { useStrings } from "../../../lib/i18n";
import { spriteGeometry } from "./geometry";
import { SpriteDefs } from "./materials";
import { centerOn, clampView, fitView, keepCenter, zoomAt, type Size, type View } from "./panZoom";
import { PlantScene } from "./PlantScene";

const DRAG_THRESHOLD = 4;
const STEP = 1.25;
const PAN_STEP = 60;

type PlantViewportProps = Omit<ComponentProps<typeof PlantScene>, "showTags"> & {
  /** Change `nonce` to centre the given equipment again. */
  locate?: { id: string; nonce: number } | null;
  /** Controls shown at the start of the toolbar bar (e.g. the view switch). */
  leading?: ReactNode;
};

/**
 * Interactive viewport for the plant scene: fits the whole plant on open and whenever
 * its box changes size (unless the operator has zoomed or panned since), wheel zoom
 * around the pointer, drag to pan, keyboard zoom/pan, and a toolbar with
 * Zoom out / zoom level (100%) / Zoom in / Fit to screen.
 */
export function PlantViewport({ locate, leading, ...sceneProps }: PlantViewportProps) {
  const s = useStrings();
  const t = s.monitoring.toolbar;
  const scene: Size = { w: sceneProps.layout.width, h: sceneProps.layout.height };
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [showTags, setShowTags] = useState(true);
  // True while the view is "fit to screen"; resizing then refits instead of cropping.
  const fitted = useRef(true);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ view, box, scene });
  latest.current = { view, box, scene };

  const fit = useCallback(() => {
    const b = latest.current.box;
    if (!b) return;
    fitted.current = true;
    setView(fitView(latest.current.scene, b));
  }, []);

  const apply = (next: View) => {
    fitted.current = false;
    setView(next);
  };

  // Track the available box. Opening a side panel shrinks it; refit or keep centre.
  useLayoutEffect(() => {
    const el = boxRef.current!;
    const update = (w: number, h: number) => {
      if (w < 10 || h < 10) return;
      const next = { w, h };
      const { box: prev, view: v, scene: sc } = latest.current;
      if (prev && prev.w === w && prev.h === h) return;
      latest.current.box = next;
      setBox(next);
      if (!prev || fitted.current) setView(fitView(sc, next));
      else setView(keepCenter(v, prev, next, sc));
    };
    // Measure now: on a cold page load the observer's first notification is not
    // reliably delivered, which left the schematic undrawn until something resized.
    const r = el.getBoundingClientRect();
    update(r.width, r.height);
    const ro = new ResizeObserver(([entry]) => update(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      const { box: b, view: v, scene: sc } = latest.current;
      if (!b) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      fitted.current = false;
      setView(zoomAt(v, factor, e.clientX - rect.left, e.clientY - rect.top, sc, b));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!locate || !box) return;
    const node = sceneProps.layout.nodes[locate.id];
    if (!node) return;
    const g = spriteGeometry[node.kind];
    apply(centerOn(node.x + g.width / 2, node.y + g.height / 2, Math.max(view.k, 1), scene, box));
  }, [locate?.nonce, box === null]); // a new locate request, or the box becoming measurable

  const zoomCentre = (factor: number) => box && apply(zoomAt(view, factor, box.w / 2, box.h / 2, scene, box));
  const actualSize = () => {
    if (!box) return;
    const cx = (box.w / 2 - view.x) / view.k;
    const cy = (box.h / 2 - view.y) / view.k;
    apply(centerOn(cx, cy, 1, scene, box));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !box) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!d.moved) {
      d.moved = true;
      svgRef.current!.setPointerCapture(d.id);
    }
    apply(clampView({ k: d.view.k, x: d.view.x + dx, y: d.view.y + dy }, scene, box));
  };
  const onPointerUp = () => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== svgRef.current || !box) return;
    const pan = (dx: number, dy: number) => apply(clampView({ ...view, x: view.x + dx, y: view.y + dy }, scene, box));
    const keys: Record<string, () => void> = {
      "+": () => zoomCentre(STEP),
      "=": () => zoomCentre(STEP),
      "-": () => zoomCentre(1 / STEP),
      "0": fit,
      "1": actualSize,
      ArrowLeft: () => pan(PAN_STEP, 0),
      ArrowRight: () => pan(-PAN_STEP, 0),
      ArrowUp: () => pan(0, PAN_STEP),
      ArrowDown: () => pan(0, -PAN_STEP),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };

  const percent = Math.round(view.k * 100);

  return (
    <div className="plant-viewport" data-zoom={view.k.toFixed(4)}>
      <div className="plant-viewport__bar">
      {leading}
      <div className="plant-viewport__toolbar" role="toolbar" aria-label={t.label}>
        <button type="button" className="tool-button" onClick={() => zoomCentre(1 / STEP)} aria-label={t.zoomOut} title={t.zoomOut}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="tool-button tool-button--text num" onClick={actualSize} title={t.actualSize} aria-label={`${t.zoomLevel} ${percent}%. ${t.actualSize}`}>
          {percent}%
        </button>
        <button type="button" className="tool-button" onClick={() => zoomCentre(STEP)} aria-label={t.zoomIn} title={t.zoomIn}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="tool-button tool-button--text" onClick={fit} title={t.fit}>
          <Maximize size={15} aria-hidden="true" />
          {t.fit}
        </button>
        <span className="plant-viewport__divider" />
        <button type="button" className="tool-button tool-button--text" aria-pressed={showTags} onClick={() => setShowTags((v) => !v)}>
          <Tags size={15} aria-hidden="true" />
          {t.readings}
        </button>
      </div>
      </div>
      <div ref={boxRef} className="plant-viewport__box">
        <svg
          ref={svgRef}
          className="plant-scene"
          role="group"
          tabIndex={0}
          aria-label={t.viewportLabel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={(e) => {
            if (suppressClick.current) {
              suppressClick.current = false;
              e.stopPropagation();
            }
          }}
          onKeyDown={onKeyDown}
        >
          <SpriteDefs />
          {box && (
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <PlantScene {...sceneProps} showTags={showTags} />
            </g>
          )}
        </svg>
        <p className="plant-viewport__hint">{t.hint}</p>
      </div>
    </div>
  );
}
