/**
 * An open project: the header (name, Drawing | History | Compare, actions) over the chosen
 * view. Drawing gives the canvas the whole area; the review (findings, properties, evidence)
 * opens beside it only when something is selected or Review is chosen.
 */
import { useEffect, useMemo } from "react";
import { CircleAlert, Columns2, ListChecks, Undo2, X } from "lucide-react";
import { demoScene } from "../../fixtures/demoPlant";
import type { Topology } from "../../lib/contracts";
import { useStrings } from "../../lib/i18n";
import { cad, openFindings, useCadSession, type Selection } from "./cadSession";
import { CompareView } from "./CompareView";
import { SourceCompareView, SyntheticDrawing } from "./Drawing2D";
import { DrawingToolbar } from "./DrawingToolbar";
import { FileSheet, type DrawingFile } from "./FileSheet";
import { HistoryView, versionTitle } from "./HistoryView";
import { InspectorPanel } from "./InspectorPanel";
import { Toolbar } from "./Toolbar";
import { DropOverlay, useDropUpload } from "./Uploader";

/** Everything the selection's recorded paths reach; an unknown connection reaches its own ends only. */
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

/** Equipment with an open finding: never dimmed by a selection. */
export function findingIdsOf(topology: Topology) {
  const ids = new Set<string>();
  for (const link of topology.links) {
    if (link.evidence !== "unknown") continue;
    for (const end of [link.from, link.to]) if ("device" in end) ids.add(end.device);
  }
  for (const port of topology.unconnectedPorts) ids.add(port.device);
  return ids;
}

export function Workbench() {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, tab, failure, busy } = session;
  const drop = useDropUpload("revision");
  if (!project) return null;

  return (
    <section className="cad-wb" aria-labelledby="cad-project-name" {...drop.handlers}>
      <Toolbar />
      {failure && (
        <div className="cad-notice" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{failure.conflict ? copy.conflict : failure.message}</span>
          {failure.conflict && (
            <button type="button" className="cad-text-button" disabled={!!busy} onClick={() => void cad.saveAs(copy.copyName(project.name))}>
              {copy.saveCopy}
            </button>
          )}
          <button type="button" className="cad-icon-button" aria-label={copy.dismiss} title={copy.dismiss} onClick={cad.dismissFailure}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <div id="cad-tabpanel" className="cad-wb__body" role="tabpanel" aria-labelledby={`cad-tab-${tab}`} data-tab={tab}>
        {tab === "drawing" && <DrawingView />}
        {tab === "history" && <HistoryView />}
        {tab === "compare" && <CompareView />}
      </div>
      {drop.dropping && <DropOverlay label={copy.dropRevision} />}
    </section>
  );
}

/** The drawing: the working review (or a saved version, read-only), or an uploaded file. */
function DrawingView() {
  const copy = useStrings().cad;
  const session = useCadSession();
  const { project, topology, selection, locate, viewing, reviews, history, reviewOpen, sourceCompare } = session;
  const version = viewing ? history.versions.find((v) => v.id === viewing) : undefined;
  const shown = viewing ? reviews[viewing] : topology;
  const traceIds = useMemo(() => (shown ? traceFor(selection, shown) : new Set<string>()), [selection, shown]);
  const findingIds = useMemo(() => (shown ? findingIdsOf(shown) : new Set<string>()), [shown]);
  useEffect(() => {
    if (viewing) void cad.loadReview(viewing);
  }, [viewing]);
  if (!project) return null;

  const back = viewing && (
    <span className="cad-banner">
      <span>{copy.readOnlyVersion(version ? versionTitle(version, copy) : copy.savedReview)}</span>
      <button type="button" className="cad-text-button" onClick={() => cad.viewVersion(null)}><Undo2 size={14} aria-hidden="true" />{copy.backToWorking}</button>
    </span>
  );

  // An uploaded drawing (the project's, or a version viewed from History) is a file, never parsed.
  const upload = version?.source.kind === "upload" ? version : null;
  const latestUpload = [...history.versions].reverse().find((v) => v.source.kind === "upload");
  if (upload || project.kind === "drawing") {
    const source = upload ?? latestUpload;
    const file: DrawingFile | null = source && source.source.kind === "upload"
      ? { ...source.source.original, addedAt: source.createdAt, url: source.source.original.available ? cad.versionUrl(source.id) : null }
      : project.original ? { ...project.original, addedAt: project.summary?.createdAt, url: project.id && project.original.available ? cad.originalUrl(project.id) : null } : null;
    return (
      <div className="cad-drawing">
        {file && <FileSheet file={file} caption={(viewing || source) && <span className="cad-file__version">{source ? versionTitle(source, copy) : null}{back}</span>} />}
      </div>
    );
  }

  if (!shown) return <div className="cad-empty-state" role="status">{copy.loadingVersion}</div>;
  const open = openFindings(shown);
  const toolbar = (
    <DrawingToolbar
      layers={session.layers}
      colourBy={session.colourBy}
      onLayer={cad.setLayer}
      onColour={cad.setColourBy}
      banner={back}
      actions={
        <>
          {!viewing && (
            <button type="button" className="cad-chip-button" aria-pressed={sourceCompare} onClick={() => cad.setSourceCompare(!sourceCompare)} aria-label={copy.sourceBeside} title={copy.sourceBeside}>
              <Columns2 size={15} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="cad-chip-button cad-chip-button--label" aria-pressed={reviewOpen} onClick={() => cad.toggleReview()} title={copy.review}>
            <ListChecks size={15} aria-hidden="true" />
            <span>{copy.review}</span>
            {open > 0 && <span className="cad-count num" aria-label={copy.openFindingsCount(open)}>{open}</span>}
          </button>
        </>
      }
    />
  );
  const canvas = {
    scene: demoScene,
    topology: shown,
    selection,
    locate,
    onSelect: (id: string) => cad.select({ kind: "device", id }),
    onSelectLink: (id: string) => cad.select({ kind: "link", id }),
    layers: session.layers,
    colourBy: session.colourBy,
    traceIds,
    findingIds,
    toolbar,
  };
  return (
    <div className="cad-drawing" data-review={reviewOpen ? "open" : "closed"}>
      <div className="cad-drawing__canvas">
        {sourceCompare && !viewing ? <SourceCompareView {...canvas} /> : <SyntheticDrawing key={viewing ?? "working"} {...canvas} />}
      </div>
      {reviewOpen && <InspectorPanel topology={shown} readOnly={!!viewing} onClose={() => cad.toggleReview(false)} />}
    </div>
  );
}
