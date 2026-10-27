import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  FileUp,
  GripVertical,
  LoaderCircle,
  Minus,
  Plus,
  RotateCcw,
  Scan,
  Upload,
  X,
} from "lucide-react";
import type { Device, Link, SceneLayout, Topology } from "../../lib/contracts";
import { demoScene, demoTopology } from "../../fixtures/demoPlant";
import { useStrings } from "../../lib/i18n";
import { PlantScene } from "../monitoring/scene/PlantScene";
import { PlantViewport } from "../monitoring/scene/PlantViewport";
import { spriteGeometry } from "../monitoring/scene/geometry";
import { SpriteDefs } from "../monitoring/scene/materials";
import {
  centerOn,
  clampView,
  fitView,
  keepCenter,
  zoomAt,
  type Size,
  type View,
} from "../monitoring/scene/panZoom";
import "../monitoring/monitoring.css";
import "./cadStudio.css";

type Screen = "import" | "extract" | "studio" | "preview";
type StudioView = "drawing" | "compare";
type PortFinding = Topology["unconnectedPorts"][number];
type Selection =
  | { kind: "device" | "link"; id: string }
  | { kind: "port"; deviceId: string; port: string }
  | null;
type LocateRequest = { id: string; nonce: number } | null;
type Evidence = Device["evidence"];
type ReviewState = "confirmed" | "review" | "conflict" | "unknown";

const DRAG_THRESHOLD = 4;
const ZOOM_STEP = 1.25;
const PAN_STEP = 60;
const clone = <T,>(value: T): T => structuredClone(value);
const previewReadings = {
  equipment: Object.fromEntries(
    demoTopology.devices.map((device) => [device.id, { state: "stopped" as const, sampleTime: null }]),
  ),
  values: {},
};

export function CadStudioPage() {
  const copy = useStrings().cad;
  const [screen, setScreen] = useState<Screen>("import");
  const [progress, setProgress] = useState(0);
  const [view, setView] = useState<StudioView>("compare");
  const [topology, setTopology] = useState<Topology>(() => clone(demoTopology));
  const [selection, setSelection] = useState<Selection>(null);
  const [locate, setLocate] = useState<LocateRequest>(null);

  const dirty = JSON.stringify(topology) !== JSON.stringify(demoTopology);

  useEffect(() => {
    if (screen !== "extract") return;
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= copy.extraction.length) {
          window.clearInterval(timer);
          window.setTimeout(() => setScreen("studio"), 250);
          return current;
        }
        return current + 1;
      });
    }, 420);
    return () => window.clearInterval(timer);
  }, [copy.extraction.length, screen]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reset = () => {
    setTopology(clone(demoTopology));
    setSelection(null);
    setLocate(null);
  };

  const locateFinding = (item: Exclude<Selection, null>, deviceId: string) => {
    setSelection(item);
    setView("compare");
    setLocate((current) => ({ id: deviceId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const changeEvidence = (evidence: Evidence) => {
    if (!selection || selection.kind === "port") return;
    setTopology((current) => ({
      ...current,
      devices:
        selection.kind === "device"
          ? current.devices.map((item) => (item.id === selection.id ? { ...item, evidence } : item))
          : current.devices,
      links:
        selection.kind === "link"
          ? current.links.map((item) => (item.id === selection.id ? { ...item, evidence } : item))
          : current.links,
    }));
  };

  const resolvePort = (port: PortFinding, sourceDeviceId: string) => {
    const id = `manual_${sourceDeviceId}_${port.device}_${port.port}`;
    const link: Link = {
      id,
      from: { device: sourceDeviceId, port: "evap_out" },
      to: { device: port.device, port: port.port },
      medium: "chw",
      evidence: "confirmed",
      note: "operator-selected connection in CAD review",
    };
    setTopology((current) => ({
      ...current,
      links: [...current.links.filter((candidate) => candidate.id !== id), link],
      unconnectedPorts: current.unconnectedPorts.filter(
        (candidate) => candidate.device !== port.device || candidate.port !== port.port,
      ),
    }));
    setSelection({ kind: "link", id });
  };

  if (screen === "import") return <DrawingUpload onOpenSample={() => setScreen("extract")} />;
  if (screen === "extract") return <ExtractionProgress progress={progress} onSkip={() => setScreen("studio")} />;
  if (screen === "preview") {
    return (
      <DraftPreview
        topology={topology}
        onBack={() => setScreen("studio")}
        onDeviceEvidence={(id, evidence) => setTopology((current) => ({
          ...current,
          devices: current.devices.map((device) => device.id === id ? { ...device, evidence } : device),
        }))}
      />
    );
  }

  const selectedDeviceId = selection?.kind === "device"
    ? selection.id
    : selection?.kind === "port"
      ? selection.deviceId
      : undefined;
  const selectedDevice = selectedDeviceId
    ? topology.devices.find((item) => item.id === selectedDeviceId)
    : undefined;
  const selectedLink = selection?.kind === "link"
    ? topology.links.find((item) => item.id === selection.id)
    : undefined;
  const selectedPort = selection?.kind === "port"
    ? topology.unconnectedPorts.find((item) => item.device === selection.deviceId && item.port === selection.port)
    : undefined;
  const unresolved = topology.links.filter((link) => link.evidence === "unknown").length
    + topology.unconnectedPorts.length;

  return (
    <section className="cad-page" aria-labelledby="cad-title">
      <header className="cad-head">
        <div className="cad-head__identity">
          <div className="cad-title-row">
            <h2 id="cad-title">{copy.title}</h2>
            <span className="tag-chip">{copy.syntheticSample}</span>
            {dirty && <span className="cad-dirty">{copy.unsaved}</span>}
          </div>
          <p>demo-cooling-plant-rev-a.dwg</p>
        </div>
        <div className="cad-head__actions">
          <nav className="cad-view-switch" aria-label={copy.viewLabel}>
            {(["drawing", "compare"] as StudioView[]).map((item) => (
              <button key={item} type="button" aria-pressed={view === item} onClick={() => setView(item)}>
                {copy.steps[item]}
              </button>
            ))}
          </nav>
          <button type="button" className="button button--small cad-preview-button" onClick={() => setScreen("preview")}>
            {copy.previewOverview} <ArrowRight size={15} aria-hidden="true" />
          </button>
          {dirty && (
            <button type="button" className="button button--small" onClick={reset}>
              <RotateCcw size={15} aria-hidden="true" /> {copy.reset}
            </button>
          )}
        </div>
      </header>

      <div className="cad-workspace">
        <main className="cad-canvas">
          {view === "drawing" ? (
            <SyntheticDrawing
              scene={demoScene}
              selectedId={selection?.kind === "device" ? selection.id : selection?.kind === "port" ? selection.deviceId : null}
              locate={locate}
              onSelect={(id) => setSelection({ kind: "device", id })}
            />
          ) : (
            <CompareView
              topology={topology}
              scene={demoScene}
              selection={selection}
              locate={locate}
              onSelect={(id) => setSelection({ kind: "device", id })}
            />
          )}
        </main>

        <section className="cad-findings" aria-label={copy.findings}>
          <div className="cad-section-title">
            <span>{copy.findings}</span>
            <span className="tag-chip tag-chip--planned">{unresolved}</span>
          </div>
          {topology.links.filter((link) => link.evidence === "unknown").map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => locateFinding({ kind: "link", id: link.id }, firstDeviceId(link) ?? "")}
            >
              <span><CircleAlert size={15} aria-hidden="true" /> {copy.unknownConnection}</span>
              <small>{link.id}</small>
            </button>
          ))}
          {topology.unconnectedPorts.map((port) => (
            <button
              key={`${port.device}-${port.port}`}
              type="button"
              onClick={() => locateFinding({ kind: "port", deviceId: port.device, port: port.port }, port.device)}
            >
              <span><CircleAlert size={15} aria-hidden="true" /> {copy.unconnectedPort} · {port.port}</span>
              <small>{port.device}:{port.port}</small>
            </button>
          ))}
        </section>

        {selection && (
          <aside className="cad-inspector" aria-label={copy.inspectorLabel}>
            <Inspector
              device={selectedDevice}
              link={selectedLink}
              port={selectedPort}
              topology={topology}
              onClose={() => setSelection(null)}
              onEvidence={changeEvidence}
              onResolvePort={resolvePort}
            />
          </aside>
        )}
      </div>
    </section>
  );
}

function DrawingUpload({ onOpenSample }: { onOpenSample: () => void }) {
  const copy = useStrings().cad;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const choose = (next?: File) => next && setFile(next);

  return (
    <section className="cad-entry cad-entry--upload" aria-labelledby="cad-title">
      <span className="tag-chip">{copy.syntheticSample}</span>
      <h2 id="cad-title">{copy.title}</h2>
      <p>{copy.entryLead}</p>
      <button
        type="button"
        className="cad-dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          choose(event.dataTransfer.files[0]);
        }}
      >
        <span className="cad-entry__mark"><Upload size={25} aria-hidden="true" /></span>
        <strong>{copy.dropDrawing}</strong>
        <small>{copy.chooseFile}</small>
      </button>
      <input ref={inputRef} className="cad-file-input" type="file" onChange={(event) => choose(event.target.files?.[0])} />
      {file && (
        <div className="cad-file-status" role="status">
          <FileUp size={17} aria-hidden="true" />
          <span><strong>{file.name}</strong><small>{formatBytes(file.size)} · {copy.parserUnavailable}</small></span>
        </div>
      )}
      <div className="cad-entry__divider"><span>{copy.orTrySample}</span></div>
      <button type="button" className="cad-sample" onClick={onOpenSample}>
        <span><strong>{copy.sampleName}</strong><small>demo-cooling-plant-rev-a.dwg</small></span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <small>{copy.noParser}</small>
    </section>
  );
}

function ExtractionProgress({ progress, onSkip }: { progress: number; onSkip: () => void }) {
  const copy = useStrings().cad;
  return (
    <section className="cad-entry cad-entry--progress" aria-labelledby="extract-title">
      <span className="tag-chip">{copy.demoExtraction}</span>
      <h2 id="extract-title">{copy.preparing}</h2>
      <ol className="cad-progress">
        {copy.extraction.map((label, index) => (
          <li key={label} className={index < progress ? "is-done" : index === progress ? "is-running" : ""}>
            {index < progress ? <Check size={16} aria-hidden="true" /> : <LoaderCircle size={16} aria-hidden="true" />}
            {label}
          </li>
        ))}
      </ol>
      <button type="button" className="button" onClick={onSkip}>{copy.skip}</button>
    </section>
  );
}

function SyntheticDrawing({ scene, selectedId, locate, onSelect }: {
  scene: SceneLayout;
  selectedId: string | null;
  locate: LocateRequest;
  onSelect: (id: string) => void;
}) {
  const copy = useStrings().cad;
  return (
    <CadViewport scene={scene} locate={locate} ariaLabel={copy.sourceDrawingLabel} className="cad-sheet">
      <DrawingLayer scene={scene} selectedId={selectedId} onSelect={onSelect} />
    </CadViewport>
  );
}

function DrawingLayer({ scene, selectedId, onSelect }: {
  scene: SceneLayout;
  selectedId: string | null;
  onSelect?: (id: string) => void;
}) {
  const copy = useStrings().cad;
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
      <text className="cad-watermark" x="730" y="900" textAnchor="middle">{copy.sourceDrawingWatermark}</text>
    </g>
  );
}

function CompareView({ topology, scene, selection, locate, onSelect }: {
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

function CadViewport({ scene, locate, ariaLabel, className, children, secondary }: {
  scene: SceneLayout;
  locate: LocateRequest;
  ariaLabel: string;
  className: string;
  children: ReactNode;
  secondary?: ReactNode;
}) {
  const copy = useStrings().cad;
  const boxRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);
  const [box, setBox] = useState<Size | null>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
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
    setView((current) => previous ? keepCenter(current, previous, next, canvas) : fitView(canvas, next));
  }, [scene.width, scene.height]);

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
    if (!locate || !box) return;
    const node = scene.nodes[locate.id];
    if (!node) return;
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
    setSplit(Math.max(25, Math.min(75, ((clientX - rect.left) / rect.width) * 100)));
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
              ArrowLeft: () => setSplit((current) => Math.max(25, current - 5)),
              ArrowRight: () => setSplit((current) => Math.min(75, current + 5)),
              Home: () => setSplit(25),
              End: () => setSplit(75),
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

function DraftPreview({ topology, onBack, onDeviceEvidence }: { topology: Topology; onBack: () => void; onDeviceEvidence: (id: string, value: Evidence) => void }) {
  const copy = useStrings().cad;
  const [selection, setSelection] = useState<Selection>(null);
  const selectedDevice = selection?.kind === "device" ? topology.devices.find((item) => item.id === selection.id) : undefined;
  return (
    <section className="cad-preview" aria-labelledby="cad-preview-title">
      <header className="cad-preview__head">
        <div>
          <span className="tag-chip tag-chip--notice">{copy.draftPreview}</span>
          <h2 id="cad-preview-title">{copy.previewTitle}</h2>
        </div>
        <button type="button" className="button button--small" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> {copy.backToReview}</button>
      </header>
      <div className="cad-preview__stage">
        <PlantViewport
          topology={{ ...topology, devices: topology.devices.map((device) => ({ ...device, label: copy.equipmentName(device.id, device.label) })) }}
          layout={demoScene}
          readings={previewReadings}
          metrics={[]}
          issues={[]}
          selectedId={selectedDevice?.id ?? null}
          onSelect={(id) => setSelection({ kind: "device", id })}
          onOpenIssue={() => undefined}
          float={Boolean(selection)}
          onDismiss={() => setSelection(null)}
          note={{ tag: copy.draftPreview, text: copy.notCommissioned }}
          designPreview
        />
        {selectedDevice && (
          <aside className="cad-inspector cad-inspector--preview" aria-label={copy.inspectorLabel}>
            <Inspector device={selectedDevice} topology={topology} showDirectEvidence onClose={() => setSelection(null)} onEvidence={(value) => onDeviceEvidence(selectedDevice.id, value)} />
          </aside>
        )}
      </div>
    </section>
  );
}

function Inspector({ device, link, port, topology, showDirectEvidence = false, onClose, onEvidence, onResolvePort }: {
  device?: Device;
  link?: Link;
  port?: PortFinding;
  topology: Topology;
  showDirectEvidence?: boolean;
  onClose: () => void;
  onEvidence: (value: Evidence) => void;
  onResolvePort?: (port: PortFinding, sourceDeviceId: string) => void;
}) {
  const copy = useStrings().cad;
  if (port && device && onResolvePort) {
    return <PortFindingInspector port={port} device={device} topology={topology} onClose={onClose} onResolve={onResolvePort} />;
  }
  const item = device ?? link;
  if (!item) return <div className="cad-empty">{copy.selectObject}</div>;
  const connections = device ? topology.links.filter((candidate) => linkHasDevice(candidate, device.id)) : [];
  const unconnectedPorts = device ? topology.unconnectedPorts.filter((port) => port.device === device.id) : [];
  const effectiveStatus = evidenceReviewState(item.evidence);
  const statusLabel = showDirectEvidence ? copy.evidenceValues[item.evidence] : copy.reviewStates[effectiveStatus];
  return (
    <div className={`cad-inspector__body${link ? " cad-inspector__body--link" : ""}`} key={item.id}>
      <div className="cad-inspector__top">
        <div className="cad-section-title"><span>{device ? copy.equipment : copy.connection}</span><span className={`cad-evidence cad-evidence--${showDirectEvidence ? evidenceReviewState(item.evidence) : effectiveStatus}`}>{statusLabel}</span></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={copy.closeInspector}><X size={17} aria-hidden="true" /></button>
      </div>
      <h3>{device ? copy.equipmentName(device.id, device.label) : link?.id}</h3>
      {device && <code>{item.id}</code>}
      {link && <dl><dt>{copy.from}</dt><dd>{endDisplayLabel(link.from, topology, copy.equipmentName)}</dd><dt>{copy.to}</dt><dd>{endDisplayLabel(link.to, topology, copy.equipmentName)}</dd><dt>{copy.medium}</dt><dd>{copy.mediumName(link.medium)}</dd></dl>}
      <label className="cad-field">{device ? copy.equipmentEvidence : copy.evidence}<select value={item.evidence} onChange={(event) => onEvidence(event.target.value as Evidence)}><option value="confirmed">{copy.evidenceValues.confirmed}</option><option value="drawing">{copy.evidenceValues.drawing}</option><option value="inferred">{copy.evidenceValues.inferred}</option><option value="unknown">{copy.evidenceValues.unknown}</option></select></label>
      {link?.note && <p className="cad-note">{copy.linkNote(link.note)}</p>}
      {device && <div className="cad-connection-summary"><span className="cad-connection-summary__line" aria-hidden="true" /><span>{copy.connectionsHighlighted(connections.length)}</span>{unconnectedPorts.length > 0 && <strong>{copy.unresolvedPorts(unconnectedPorts.length)}</strong>}</div>}
    </div>
  );
}

function PortFindingInspector({ port, device, topology, onClose, onResolve }: {
  port: PortFinding;
  device: Device;
  topology: Topology;
  onClose: () => void;
  onResolve: (port: PortFinding, sourceDeviceId: string) => void;
}) {
  const copy = useStrings().cad;
  const candidates = topology.devices.filter((candidate) => candidate.family === "chiller_plant");
  const [sourceDeviceId, setSourceDeviceId] = useState(candidates[0]?.id ?? "");
  return (
    <div className="cad-inspector__body cad-inspector__body--port" key={`${port.device}:${port.port}`}>
      <div className="cad-inspector__top">
        <div className="cad-section-title"><span>{copy.port}</span><span className="cad-evidence cad-evidence--unknown">{copy.reviewStates.unknown}</span></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={copy.closeInspector}><X size={17} aria-hidden="true" /></button>
      </div>
      <h3>{copy.equipmentName(device.id, device.label)} · {port.port}</h3>
      <code>{port.device}:{port.port}</code>
      <p className="cad-note">{copy.portNote(port.note)}</p>
      <label className="cad-field">
        {copy.connectFrom}
        <select value={sourceDeviceId} onChange={(event) => setSourceDeviceId(event.target.value)}>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>{copy.equipmentName(candidate.id, candidate.label)} · evap_out</option>
          ))}
        </select>
      </label>
      <button type="button" className="button cad-resolve-button" disabled={!sourceDeviceId} onClick={() => onResolve(port, sourceDeviceId)}>
        {copy.createConnection}
      </button>
    </div>
  );
}

function evidenceReviewState(evidence: Evidence): ReviewState {
  if (evidence === "confirmed") return "confirmed";
  if (evidence === "unknown") return "unknown";
  return "review";
}

function deviceReviewState(deviceId: string, topology: Topology): ReviewState {
  const device = topology.devices.find((candidate) => candidate.id === deviceId);
  const states = [device ? evidenceReviewState(device.evidence) : "unknown", ...topology.links.filter((link) => linkHasDevice(link, deviceId)).map((link) => evidenceReviewState(link.evidence))] as ReviewState[];
  if (topology.unconnectedPorts.some((port) => port.device === deviceId)) states.push("unknown");
  const priority: Record<ReviewState, number> = { confirmed: 0, review: 1, unknown: 2, conflict: 3 };
  return states.reduce((worst, state) => priority[state] > priority[worst] ? state : worst, "confirmed");
}

function linkHasDevice(link: Link, deviceId: string) {
  return ("device" in link.from && link.from.device === deviceId) || ("device" in link.to && link.to.device === deviceId);
}

function firstDeviceId(link?: Link) {
  if (!link) return null;
  if ("device" in link.from) return link.from.device;
  if ("device" in link.to) return link.to.device;
  return null;
}

function deviceIds(link: Link) {
  return [link.from, link.to].flatMap((end) => "device" in end ? [end.device] : []);
}

function endDisplayLabel(end: Link["from"], topology: Topology, equipmentName: (id: string, label: string) => string) {
  if (!("device" in end)) {
    const bus = topology.buses.find((candidate) => candidate.id === end.bus);
    return bus ? equipmentName(bus.id, bus.label) : end.bus;
  }
  const device = topology.devices.find((candidate) => candidate.id === end.device);
  return `${device ? equipmentName(device.id, device.label) : end.device}:${end.port}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
