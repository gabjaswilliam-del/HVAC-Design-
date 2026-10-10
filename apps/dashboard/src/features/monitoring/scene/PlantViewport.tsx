import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { Map as MapIcon, Minus, Plus, Scan } from "lucide-react";
import { useStrings } from "../../../lib/i18n";
import type { Issue, MetricInfo } from "../../../lib/contracts";
import { RadioGroup } from "../../../components/RadioGroup";
import { useEscapeLayer } from "../../../components/escape";
import { KEY_BELOW, operating, useOperating, type ReadMode } from "../../../app/operatingContext";
import { SceneLegend } from "../SceneLegend";
import { spriteGeometry } from "./geometry";
import { SpriteDefs } from "./materials";
import { centerOn, clampView, fitBeside, fitView, FLOAT_COVER, keepCenter, zoomAt, type Size, type View } from "./panZoom";
import { PlantScene } from "./PlantScene";
import { IssueTags, KeyLayer } from "./StageOverlay";

const DRAG_THRESHOLD = 4;
const STEP = 1.25;
const PAN_STEP = 60;
const HINT_MS = 4000;

type Effective = Exclude<ReadMode, "auto">;

type PlantViewportProps = Omit<ComponentProps<typeof PlantScene>, "showTags" | "showLabels"> & {
  metrics: MetricInfo[];
  /** Open issues, most severe first; each hangs from its first affected item. */
  issues: Issue[];
  /** Change `nonce` to centre the given equipment again. */
  locate?: { id: string; nonce: number } | null;
  /** A floating workspace panel covers the box's right edge. */
  float: boolean;
  /** Clicking empty drawing dismisses a floating panel. */
  onDismiss?: () => void;
  onOpenIssue: (issue: Issue) => void;
  /** The provenance note in the bottom-left corner; the synthetic-plant note by default. */
  note?: { tag: string; text: string; title?: string };
  /** The drawing sits in a scrolling page: the wheel scrolls the page, and Ctrl or Cmd
   *  with the wheel (or a pinch) zooms. The Overview's drawing zooms on any wheel. */
  inPage?: boolean;
};

/**
 * The plant drawing on its display. It fits the whole plant on open and whenever its
 * box changes (unless the operator has zoomed or panned since), beside a floating
 * panel when the plant can stay at half size or more. Wheel zoom around the pointer,
 * drag to pan, keyboard zoom and pan. Two corners carry the drawing controls and the
 * disclosure; readings switch to key readings below 80% zoom unless chosen otherwise.
 */
export function PlantViewport({ locate, float, onDismiss, onOpenIssue, metrics, issues, note, inPage = false, ...sceneProps }: PlantViewportProps) {
  const s = useStrings();
  const t = s.monitoring.toolbar;
  const legendId = useId();
  const readingsId = useId();
  const [legend, setLegend] = useState(false);
  const scene: Size = { w: sceneProps.layout.width, h: sceneProps.layout.height };
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [reach, setReach] = useState<string[]>([]);
  const readMode = useOperating((x) => x.readMode);
  const fitRequest = useOperating((x) => x.fitRequest);
  // While "fitted", a resize or a floating panel refits; after the operator zooms or
  // pans the view is theirs. Auto-panned views (selection kept clear of a panel) refit.
  const fitted = useRef(true);
  const autoPanned = useRef(false);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ view, box, scene, float, inPage });
  latest.current = { view, box, scene, float, inPage };

  const fitFor = (sc: Size, b: Size, f: boolean): View => (f ? fitBeside(sc, b) : fitView(sc, b));
  const limitOf = (b: Size | null, f: boolean) => (b ? (f ? b.w - FLOAT_COVER : b.w) : 0);

  /** Record a new box size: refit while fitted, otherwise keep the centre. */
  const updateBox = useCallback((w: number, h: number) => {
    if (w < 10 || h < 10) return;
    const next = { w, h };
    const { box: prev, view: v, scene: sc, float: f } = latest.current;
    if (prev && prev.w === w && prev.h === h) return;
    latest.current.box = next;
    setBox(next);
    if (!prev || fitted.current || autoPanned.current) setView(fitFor(sc, next, f));
    else setView(keepCenter(v, prev, next, sc));
  }, []);

  /** The box size now. Resize notifications can arrive late, so operator actions measure. */
  const measure = useCallback(() => {
    const el = boxRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      updateBox(r.width, r.height);
    }
    return latest.current.box;
  }, [updateBox]);

  const fit = useCallback(() => {
    const b = measure();
    if (!b) return;
    fitted.current = true;
    autoPanned.current = false;
    setView(fitFor(latest.current.scene, b, latest.current.float));
  }, [measure]);

  const apply = (next: View) => {
    fitted.current = false;
    autoPanned.current = false;
    setView(next);
  };

  // Track the available box; measure at once (a cold load may skip the first notification).
  useLayoutEffect(() => {
    const el = boxRef.current!;
    measure();
    const ro = new ResizeObserver(([entry]) => updateBox(entry.contentRect.width, entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, updateBox]);

  // A floating panel opening or closing makes or takes back room, if the view is fitted.
  const firstFloat = useRef(true);
  useEffect(() => {
    if (firstFloat.current) {
      firstFloat.current = false;
      return;
    }
    if (fitted.current || autoPanned.current) fit();
  }, [float]);

  useEffect(() => {
    if (fitRequest) fit();
  }, [fitRequest]);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      const { box: b, view: v, scene: sc, inPage: page } = latest.current;
      if (!b || (page && !e.ctrlKey && !e.metaKey)) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      fitted.current = false;
      autoPanned.current = false;
      setView(zoomAt(v, factor, e.clientX - rect.left, e.clientY - rect.top, sc, b));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const nodeRect = (id: string, v: View) => {
    const node = sceneProps.layout.nodes[id];
    if (!node) return null;
    const g = spriteGeometry[node.kind];
    return { x0: v.x + node.x * v.k, y0: v.y + node.y * v.k, x1: v.x + (node.x + g.width) * v.k, y1: v.y + (node.y + g.height) * v.k, cx: node.x + g.width / 2, cy: node.y + g.height / 2 };
  };

  // Locate: centre the item in the uncovered width. The zoom stays when the item is
  // already in view; otherwise it zooms in enough to read it.
  useEffect(() => {
    const b = measure();
    if (!locate || !b) return;
    const r = nodeRect(locate.id, view);
    if (!r) return;
    const limit = limitOf(b, float);
    const visible = r.x0 >= 0 && r.y0 >= 0 && r.x1 <= limit && r.y1 <= b.h;
    const k = visible ? view.k : Math.max(view.k, Math.min(1, fitFor(scene, b, float).k * 1.6));
    apply(clampView({ k, x: limit / 2 - r.cx * k, y: b.h / 2 - r.cy * k }, scene, b));
  }, [locate?.nonce, box === null]); // a new locate request, or the box becoming measurable

  // Under a floating panel that covers the drawing, the selection pans into view.
  const selectedId = sceneProps.selectedId;
  useEffect(() => {
    if (!float || !selectedId || !box) return;
    const r = nodeRect(selectedId, view);
    const limit = limitOf(box, true) - 24;
    if (!r || r.x1 <= limit) return;
    setView(clampView({ ...view, x: view.x - (r.x1 - limit + 40) }, scene, box));
    fitted.current = false;
    autoPanned.current = true;
  }, [selectedId, float, box?.w]);

  // Readings: Auto shows key readings below 80% zoom; the drawing publishes what it shows.
  const effective: Effective = readMode === "auto" ? (view.k < KEY_BELOW ? "key" : "all") : readMode;
  const screenNames = effective === "key" || (effective === "off" && view.k < KEY_BELOW);
  useEffect(() => operating.setReadEffective(effective), [effective]);
  const [hint, setHint] = useState({ text: "", on: false });
  const lastEffective = useRef<Effective | null>(null);
  useEffect(() => {
    // Only once the box is measured: the first fit is not a change of mode.
    if (!box) return;
    const prev = lastEffective.current;
    lastEffective.current = effective;
    if (readMode !== "auto" || prev === null || prev === effective || legend) return;
    setHint({ text: effective === "key" ? t.hintKey : t.hintAll, on: true });
    const off = setTimeout(() => setHint((h) => ({ ...h, on: false })), HINT_MS);
    const clear = setTimeout(() => setHint({ text: "", on: false }), HINT_MS + 260);
    return () => {
      clearTimeout(off);
      clearTimeout(clear);
    };
  }, [effective, box === null]);

  useEscapeLayer(legend, () => setLegend(false));

  const zoomCentre = (factor: number) => {
    const b = measure();
    if (b) apply(zoomAt(view, factor, b.w / 2, b.h / 2, scene, b));
  };
  const actualSize = () => {
    const b = measure();
    if (!b) return;
    apply(centerOn((b.w / 2 - view.x) / view.k, (b.h / 2 - view.y) / view.k, 1, scene, b));
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
  const limit = limitOf(box, float);
  const highlightIds = reach.length ? [...(sceneProps.highlightIds ?? []), ...reach] : sceneProps.highlightIds;

  return (
    <div className="plant-view" data-zoom={view.k.toFixed(4)} data-read={effective}>
      <div ref={boxRef} className="plant-view__box">
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
          onClick={(e) => {
            if (!(e.target as Element).closest(".eq-node, .tag-wrap--selectable")) onDismiss?.();
          }}
          onKeyDown={onKeyDown}
        >
          <SpriteDefs />
          {box && (
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <PlantScene
                {...sceneProps}
                highlightIds={highlightIds}
                alarmIds={issues.flatMap((i) => i.equipmentIds)}
                showTags={effective === "all"}
                showLabels={!screenNames}
              />
            </g>
          )}
        </svg>
        {box && (
          <div className="plant-view__overlay">
            {screenNames && (
              <KeyLayer
                topology={sceneProps.topology}
                layout={sceneProps.layout}
                readings={sceneProps.readings}
                metrics={metrics}
                view={view}
                limit={limit}
                values={effective === "key"}
              />
            )}
            <IssueTags topology={sceneProps.topology} layout={sceneProps.layout} view={view} limit={limit} issues={issues} onOpen={onOpenIssue} onReach={setReach} />
          </div>
        )}
      </div>

      <p className="stage-note" title={note?.title ?? s.monitoring.syntheticTitle}>
        <span className={note ? "tag-chip tag-chip--notice" : "tag-chip"}>{note?.tag ?? s.monitoring.synthetic}</span>
        <span className="stage-note__text">{note?.text ?? s.monitoring.syntheticNote}</span>
      </p>

      <div className="stage-controls" role="toolbar" aria-label={t.label}>
        <div className="stage-controls__row">
          <span className="stage-controls__label" id={readingsId}>
            {t.readings}
          </span>
          <button
            type="button"
            className="chip-toggle"
            aria-pressed={readMode === "auto"}
            title={t.autoTitle}
            onClick={() => operating.setReadMode(readMode === "auto" ? effective : "auto")}
          >
            {t.auto}
          </button>
          <RadioGroup<Effective>
            className="segmented--small"
            labelledBy={readingsId}
            value={effective}
            onChange={(m) => operating.setReadMode(m)}
            options={(["key", "all", "off"] as const).map((m) => ({ value: m, label: t.modes[m] }))}
          />
        </div>
        <div className="stage-controls__row">
          <span className="zoom">
            <button type="button" className="icon-button" onClick={() => zoomCentre(1 / STEP)} aria-label={t.zoomOut} title={t.zoomOut}>
              <Minus size={16} aria-hidden="true" />
            </button>
            <output className="zoom__value num" aria-label={`${t.zoomLevel} ${percent}%`}>
              {percent}%
            </output>
            <button type="button" className="icon-button" onClick={() => zoomCentre(STEP)} aria-label={t.zoomIn} title={t.zoomIn}>
              <Plus size={16} aria-hidden="true" />
            </button>
          </span>
          <button type="button" className="tool-button tool-button--text" onClick={fit} aria-label={t.fit} title={`${t.fit} (F)`}>
            <Scan size={15} aria-hidden="true" />
            {t.fitShort}
          </button>
          <button
            type="button"
            className="tool-button tool-button--text"
            aria-expanded={legend}
            aria-controls={legendId}
            onClick={() => {
              setLegend((v) => !v);
              setHint({ text: "", on: false });
            }}
          >
            <MapIcon size={15} aria-hidden="true" />
            {s.monitoring.legend.heading}
          </button>
        </div>
      </div>
      <p className={`readmode-hint${hint.on ? " is-on" : ""}`} aria-live="polite">
        {hint.text}
      </p>
      <div id={legendId} className="legend" hidden={!legend}>
        {legend && <SceneLegend />}
      </div>
    </div>
  );
}
