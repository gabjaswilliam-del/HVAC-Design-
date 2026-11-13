/**
 * The workbench around an open project: toolbar, the Project Library (docked from 1366 px of
 * CAD area; narrower it starts closed and opens as a column that narrows the canvas, never over
 * the drawing), the drawing canvas and the Engineering Inspector. Laid out by the CAD area's
 * own width, not the window's.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { demoScene } from "../../fixtures/demoPlant";
import type { Topology } from "../../lib/contracts";
import { useStrings } from "../../lib/i18n";
import { cad, useCadSession, type Selection } from "./cadSession";
import { CompareView, SyntheticDrawing } from "./Drawing2D";
import { FileSheet } from "./FileSheet";
import { InspectorPanel } from "./InspectorPanel";
import { Plant3D, canDrawWebGL2 } from "./model3d/Plant3D";
import type { FindingBadge } from "./model3d/Plant3DCanvas";
import { plantModel } from "./model3d/plantModel";
import { ProjectLibrary } from "./ProjectLibrary";
import { deviceReviewState, evidenceReviewState, firstDeviceId } from "./review";
import { Toolbar } from "./Toolbar";

/** Widths of the CAD area: the Library docks from WIDE; below PHONE it is its own page. */
export const WIDE = 1366;
export const PHONE = 640;

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function traceFor(selection: Selection, topology: Topology) {
  const ids = new Set<string>();
  if (!selection) return ids;
  type Node = { kind: "device" | "bus" | "link"; id: string; medium?: Topology["links"][number]["medium"] };
  const linksAt = new Map<string, Topology["links"]>();
  for (const link of topology.links) {
    for (const end of [link.from, link.to]) {
      const key = "device" in end ? `device:${end.device}` : `bus:${end.bus}`;
      linksAt.set(key, [...(linksAt.get(key) ?? []), link]);
    }
  }
  const start: Node = selection.kind === "link"
    ? { kind: "link", id: selection.id }
    : { kind: "device", id: selection.kind === "port" ? selection.deviceId : selection.id };
  const visited = new Set<string>();
  const queue: Node[] = [start];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    const key = `${node.kind}:${node.id}:${node.medium ?? "selected"}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (node.kind !== "link") ids.add(node.id);
    const links = node.kind === "link"
      ? topology.links.filter((link) => link.id === node.id)
      : (linksAt.get(`${node.kind}:${node.id}`) ?? []).filter((link) =>
        (!node.medium || link.medium === node.medium) && (!node.medium || link.evidence !== "unknown"),
      );
    for (const link of links) {
      ids.add(link.id);
      for (const end of [link.from, link.to]) {
        const kind = "device" in end ? "device" : "bus";
        const id = "device" in end ? end.device : end.bus;
        ids.add(id);
        // The selected item joins its circuits; other equipment does not. An unknown
        // link exposes its recorded endpoints but cannot establish a path beyond them.
        if (link.evidence !== "unknown") queue.push({ kind, id, medium: link.medium });
      }
    }
  }
  for (const valve of topology.valves) {
    if (valve.across?.every((bus) => ids.has(bus))) ids.add(valve.id);
  }
  return ids;
}

export function Workbench({ steps }: { steps: number }) {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, view, topology, selection, locate, failure, busy } = session;
  const root = useRef<HTMLElement>(null);
  const width = useWidth(root);
  const phone = width > 0 && width < PHONE;
  const wide = width >= WIDE;
  const libraryShown = !phone && (session.libraryOpen ?? wide);
  const [modelFailure, setModelFailure] = useState<string | null>(null);
  const model = useMemo(() => plantModel(topology, demoScene), [topology]);
  const traceIds = useMemo(() => traceFor(selection, topology), [selection, topology]);
  const findingIds = useMemo(() => {
    const ids = new Set<string>();
    const unknownLinks = topology.links.filter((candidate) => candidate.evidence === "unknown");
    for (const link of unknownLinks) {
      ids.add(link.id);
      for (const end of [link.from, link.to]) if ("device" in end) ids.add(end.device);
    }
    for (const port of topology.unconnectedPorts) ids.add(port.device);
    return ids;
  }, [topology]);
  const findings = useMemo<FindingBadge[]>(() => {
    const unknown = topology.links.filter((link) => link.evidence === "unknown").map((link) => {
      const deviceId = firstDeviceId(link)!;
      const device = topology.devices.find((candidate) => candidate.id === deviceId)!;
      return { id: link.id, deviceId, label: copy.unknownConnection, title: `${copy.unknownConnection}: ${copy.equipmentName(device.id, device.label)}`, onLocate: () => cad.locateFinding({ kind: "link", id: link.id }, deviceId) };
    });
    const ports = topology.unconnectedPorts.map((port) => {
      const device = topology.devices.find((candidate) => candidate.id === port.device)!;
      return { id: `port:${port.device}:${port.port}`, deviceId: port.device, label: copy.unconnectedPort, title: `${copy.unconnectedPort}: ${copy.equipmentName(device.id, device.label)} ${copy.portNames[port.port] ?? port.port}`, onLocate: () => cad.locateFinding({ kind: "port", deviceId: port.device, port: port.port }, port.device) };
    });
    return [...unknown, ...ports];
  }, [topology, copy]);
  const reviewStates = useMemo(() => Object.fromEntries([
    ...topology.devices.map((device) => [device.id, deviceReviewState(device.id, topology)]),
    ...topology.links.map((link) => [link.id, evidenceReviewState(link.evidence)]),
  ]), [topology]);
  useEffect(() => setModelFailure(null), [view]);
  if (!project) return null;
  const selectedId = selection?.kind === "device" ? selection.id : selection?.kind === "port" ? selection.deviceId : null;
  const selectedOwner = selection?.kind === "device" || selection?.kind === "link" ? selection.id : selectedId;
  const selectDevice = (id: string) => cad.select({ kind: "device", id });
  const selectOwner = (owner: string) => {
    if (topology.devices.some((device) => device.id === owner)) cad.select({ kind: "device", id: owner });
    else if (topology.links.some((link) => link.id === owner)) cad.select({ kind: "link", id: owner });
  };
  const unavailable = view === "model" ? modelFailure ?? (canDrawWebGL2() ? null : copy.webglUnavailable) : null;

  return (
    <section ref={root} className="cad-wb" data-size={phone ? "phone" : wide ? "wide" : "medium"} data-library={libraryShown ? "open" : "closed"} aria-labelledby="cad-project-name">
      <Toolbar
        libraryShown={libraryShown}
        columnToggle={!phone}
        onProjects={() => (phone ? cad.show("library") : cad.toggleLibrary(!libraryShown))}
      />
      {failure && (
        <div className="cad-notice" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{failure.conflict ? copy.conflict : failure.message}</span>
          {failure.conflict && (
            <button type="button" className="tool-button tool-button--text" disabled={!!busy} onClick={() => void cad.saveAs(copy.copyName(project.name))}>
              {copy.saveCopy}
            </button>
          )}
          <button type="button" className="icon-button" aria-label={copy.dismiss} title={copy.dismiss} onClick={cad.dismissFailure}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="cad-wb__body">
        {libraryShown && <ProjectLibrary variant="column" steps={steps} />}
        <div className="cad-wb__canvas">
          {project.kind === "drawing" ? (
            <FileSheet />
          ) : view === "model" ? (
            unavailable ? (
              <div className="cad-3d-fallback">
                <div className="cad-3d-fallback__note" role="status">{unavailable}</div>
                <SyntheticDrawing scene={demoScene} selectedId={selectedId} locate={locate} onSelect={selectDevice} />
              </div>
            ) : (
              <Plant3D
                model={model}
                selectedId={selectedOwner}
                traceIds={traceIds}
                findingIds={findingIds}
                findings={findings}
                layers={session.layers}
                colourBy={session.colourBy}
                reviewStates={reviewStates}
                preset={session.preset}
                presetRevision={session.presetRevision}
                locate={locate}
                onPreset={cad.setPreset}
                onPick={selectOwner}
                onLost={() => setModelFailure(copy.modelFailed)}
                label={copy.model3dLabel}
              />
            )
          ) : view === "drawing" ? (
            <SyntheticDrawing scene={demoScene} selectedId={selectedId} locate={locate} onSelect={selectDevice} />
          ) : (
            <CompareView topology={topology} scene={demoScene} selection={selection} locate={locate} onSelect={selectDevice} />
          )}
        </div>
        {project.kind === "sample" && <InspectorPanel />}
      </div>
    </section>
  );
}
