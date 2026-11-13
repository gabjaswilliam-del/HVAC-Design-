/**
 * CAD Studio's session: the open project (the prepared sample, a drawing or a saved project),
 * its review and how it is shown, and the Project Library. Kept outside React, so the review
 * survives leaving CAD Studio (its route unmounts) and the page only renders it.
 *
 * Projects persist on the local project service, selected with `cad=local`
 * (`apps/api/local_server.py`). In the default demo mode nothing is saved: the prepared sample
 * and drawings added in this tab stay in memory until the page is reloaded.
 */
import { useSyncExternalStore } from "react";
import type { Device, Topology } from "../../lib/contracts";
import type { ProjectState, ProjectSummary, WorkspaceState } from "../../lib/contracts/cadProject";
import { ApiError } from "../../lib/api/client";
import { httpCadProjects, type CadProjectsClient } from "../../lib/api/cadProjects";
import { demoScene, demoTopology } from "../../fixtures/demoPlant";
import { en } from "../../lib/i18n/en";
import type { Size, View } from "../monitoring/scene/panZoom";

export type Screen = "library" | "extract" | "studio" | "preview";
export type StudioView = "drawing" | "model" | "compare";
export type CadMode = "demo" | "local";
export type Selection = { kind: "device" | "link"; id: string } | { kind: "port"; deviceId: string; port: string } | null;
export type LocateRequest = { id: string; nonce: number } | null;
export type Evidence = Device["evidence"];
export type PortFinding = Topology["unconnectedPorts"][number];
/** A Library row to open: the prepared sample (a new review), a drawing added in this tab, or a saved project. */
export type OpenTarget = { kind: "sample" } | { kind: "drawing"; key: string } | { kind: "saved"; id: string };

export const SAMPLE_KEY = "sample";
export const SAMPLE_FILENAME = "demo-cooling-plant-rev-a.dwg";

export interface OpenProject {
  /** The saved project's id; null for work not saved yet (always, in demo mode). */
  id: string | null;
  /** The Library row it opened from: a saved id, the sample, or a drawing added in this tab. */
  key: string;
  name: string;
  /** "sample": the prepared sample's extraction, reviewable; "drawing": stored only, never parsed. */
  kind: "sample" | "drawing";
  summary: ProjectSummary | null;
  /** A drawing's original: the stored copy, or this tab's file in demo mode. */
  original: { name: string; extension: string; sizeBytes: number; available: boolean; file?: File } | null;
  /** The review as last saved (JSON): unsaved changes are measured against it. */
  savedReview: string | null;
}

export interface CadSession {
  mode: CadMode;
  screen: Screen;
  /** Steps of the prepared sample's extraction replay already shown (a replay, not parsing). */
  progress: number;
  view: StudioView;
  layers: WorkspaceState["layers"];
  colourBy: WorkspaceState["colourBy"];
  /** Explicit camera preset and its in-session request counter; camera persistence is M4. */
  preset: "isometric" | "plan";
  presetRevision: number;
  /** The reviewed topology: evidence changes and connections created in review. */
  topology: Topology;
  selection: Selection;
  locate: LocateRequest;
  project: OpenProject | null;
  /** Demo mode: drawings added in this tab, in memory only. */
  drawings: { key: string; file: File; addedAt: string }[];
  library: { status: "idle" | "loading" | "ready" | "unavailable"; projects: ProjectSummary[]; message: string | null };
  /** The project operation in flight; its controls wait for the service. */
  busy: "open" | "save" | "rename" | "copy" | "delete" | "upload" | null;
  /** The last operation's failure; a save over a project changed elsewhere is a conflict. */
  failure: { message: string; conflict: boolean } | null;
  /** When this tab last saved the open project. */
  savedAt: string | null;
  /** Opening this (or closing) would discard unsaved changes: the page asks first. */
  discard: OpenTarget | "close" | null;
  /** The Library beside an open project: null follows the width (docked when wide, closed when narrow). */
  libraryOpen: boolean | null;
}

/** Where each 2D view was left: its pan and zoom (with the box they were measured in) and
 *  Compare's divider. Written as they change and read when a view mounts, never rendered
 *  from, so moving the drawing re-renders nothing else. A saved project's viewport waits in
 *  `restore` for its view to mount. */
interface Placement {
  compareSplit: number;
  viewports: Partial<Record<StudioView, { view: View; box: Size }>>;
  /** The last locate request a viewport has applied: a remount restores its view instead. */
  locatedNonce: number;
  restore: { view: StudioView; cx: number; cy: number; scale: number } | null;
}

const MODE: CadMode = typeof location !== "undefined" && new URLSearchParams(location.search).get("cad") === "local" ? "local" : "demo";
const DEFAULT_LAYERS: WorkspaceState["layers"] = { cw: true, chw: true, valves: true, instruments: true, names: true };
const SAMPLE_REVIEW = JSON.stringify(demoTopology);

const initial = (mode: CadMode): CadSession => ({
  mode,
  screen: "library",
  progress: 0,
  view: "compare",
  layers: DEFAULT_LAYERS,
  colourBy: "medium",
  preset: "isometric",
  presetRevision: 0,
  topology: structuredClone(demoTopology),
  selection: null,
  locate: null,
  project: null,
  drawings: [],
  library: { status: mode === "local" ? "idle" : "ready", projects: [], message: null },
  busy: null,
  failure: null,
  savedAt: null,
  discard: null,
  libraryOpen: null,
});
const initialPlacement = (): Placement => ({ compareSplit: 50, viewports: {}, locatedNonce: 0, restore: null });

let state = initial(MODE);
let client: CadProjectsClient | null = MODE === "local" ? httpCadProjects() : null;
const listeners = new Set<() => void>();
function set(patch: Partial<CadSession>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export const useCadSession = () =>
  useSyncExternalStore(
    (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    () => state,
  );

/** Unsaved review work: the sample-based review differs from what was last saved. */
export const isDirty = (session: CadSession) =>
  session.project?.kind === "sample" && JSON.stringify(session.topology) !== session.project.savedReview;

/** Findings the review still has open: unknown connections and unconnected ports. */
export const openFindings = (topology: Topology) =>
  topology.links.filter((link) => link.evidence === "unknown").length + topology.unconnectedPorts.length;

// Unsaved review work is lost with the tab, whichever page is showing.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (isDirty(state)) event.preventDefault();
  });
}

const withEvidence = <T extends { id: string; evidence: Evidence }>(items: T[], id: string, evidence: Evidence) =>
  items.map((item) => (item.id === id ? { ...item, evidence } : item));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const extension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** The saved workspace: view, selection, the shown view's viewport and Compare's divider. */
function snapshot(): ProjectState {
  const at = cad.placement.viewports[state.view];
  return {
    schemaVersion: 1,
    workspace: {
      view: state.view,
      selection: state.selection,
      ...(at ? { drawing: { cx: (at.box.w / 2 - at.view.x) / at.view.k, cy: (at.box.h / 2 - at.view.y) / at.view.k, scale: at.view.k } } : {}),
      compareSplit: cad.placement.compareSplit,
      layers: state.layers,
      colourBy: state.colourBy,
    },
    review: state.project?.kind === "sample" ? { topology: state.topology } : null,
  };
}

/** The Library's copy of a project, newest first when it is new. */
function upsert(summary: ProjectSummary) {
  const projects = state.library.projects;
  const at = projects.findIndex((p) => p.id === summary.id);
  set({ library: { ...state.library, projects: at < 0 ? [summary, ...projects] : projects.map((p, i) => (i === at ? summary : p)) } });
}

/** Open what the service returned: its review, view, selection and 2D viewport. */
function apply(summary: ProjectSummary, saved: ProjectState) {
  const review = saved.review?.topology ?? null;
  const sample = summary.source.kind === "sample";
  // 3D camera persistence is M4; reopen safely on 2D until then.
  const view: StudioView = saved.workspace.view === "compare" ? "compare" : "drawing";
  set({
    project: {
      id: summary.id,
      key: summary.id,
      name: summary.name,
      kind: sample ? "sample" : "drawing",
      summary,
      original: summary.source.kind === "upload" ? { ...summary.source.original } : null,
      savedReview: review ? JSON.stringify(review) : null,
    },
    topology: review ? structuredClone(review) : structuredClone(demoTopology),
    view,
    layers: saved.workspace.layers,
    colourBy: saved.workspace.colourBy,
    preset: "isometric",
    selection: saved.workspace.selection,
    locate: null,
    screen: "studio",
    failure: null,
    savedAt: null,
    discard: null,
  });
  cad.placement = { ...initialPlacement(), compareSplit: saved.workspace.compareSplit, restore: saved.workspace.drawing ? { view, ...saved.workspace.drawing } : null };
}

async function run(busy: NonNullable<CadSession["busy"]>, work: () => Promise<void>) {
  set({ busy, failure: null });
  try {
    await work();
  } catch (e) {
    set({ failure: { message: message(e), conflict: e instanceof ApiError && e.code === "CONFLICT" } });
  } finally {
    set({ busy: null });
  }
}

const isOpen = (target: OpenTarget) =>
  !!state.project &&
  (target.kind === "sample" ? state.project.key === SAMPLE_KEY : target.kind === "drawing" ? state.project.key === target.key : state.project.id === target.id);

export const cad = {
  current: () => state,
  placement: initialPlacement(),
  /** The project service in use; tests give their own, demo mode has none. */
  useClient(next: CadProjectsClient | null, mode: CadMode = next ? "local" : "demo") {
    client = next;
    state = initial(mode);
    cad.placement = initialPlacement();
    listeners.forEach((listener) => listener());
  },
  originalUrl: (id: string) => client?.originalUrl(id) ?? null,

  /** Local mode: read the Library. A service that does not answer leaves the sample reviewable in memory. */
  async loadLibrary() {
    if (!client || state.library.status === "loading") return;
    set({ library: { ...state.library, status: "loading" } });
    try {
      set({ library: { status: "ready", projects: await client.list(), message: null } });
    } catch (e) {
      set({ library: { status: "unavailable", projects: state.library.projects, message: message(e) } });
    }
  },

  /** Open a Library row (the open one resumes); unsaved changes are confirmed before they are discarded. */
  request(target: OpenTarget, steps: number) {
    if (isOpen(target)) return set({ screen: target.kind === "sample" && state.progress < steps ? "extract" : "studio" });
    if (isDirty(state)) return set({ discard: target });
    void cad.openTarget(target, steps);
  },
  confirmDiscard(steps: number) {
    const target = state.discard;
    set({ discard: null });
    if (target === "close") cad.close(true);
    else if (target) void cad.openTarget(target, steps);
  },
  cancelDiscard: () => set({ discard: null }),
  async openTarget(target: OpenTarget, steps: number) {
    if (target.kind === "sample") {
      cad.placement = initialPlacement();
      return set({
        project: { id: null, key: SAMPLE_KEY, name: en.cad.sampleName, kind: "sample", summary: null, original: null, savedReview: SAMPLE_REVIEW },
        topology: structuredClone(demoTopology),
        view: "compare",
        selection: null,
        locate: null,
        screen: state.progress < steps ? "extract" : "studio",
        failure: null,
        savedAt: null,
      });
    }
    if (target.kind === "drawing") {
      const drawing = state.drawings.find((d) => d.key === target.key);
      if (!drawing) return;
      const { name, size } = drawing.file;
      return set({
        project: { id: null, key: drawing.key, name, kind: "drawing", summary: null, original: { name, extension: extension(name), sizeBytes: size, available: true, file: drawing.file }, savedReview: null },
        selection: null,
        locate: null,
        screen: "studio",
        failure: null,
        savedAt: null,
      });
    }
    if (!client) return;
    await run("open", async () => {
      const opened = await client!.open(target.id);
      apply(opened.project, opened.state);
      upsert(opened.project);
    });
  },

  /** Import drawings: kept in this tab (demo) or stored by the service (never parsed); the first one opens. */
  async importFiles(files: File[], steps: number) {
    if (!files.length) return;
    // An import never discards a review: with unsaved changes, opening the new drawing is confirmed first.
    if (!client) {
      const added = files.map((file, i) => ({ key: `file:${state.drawings.length + i}`, file, addedAt: new Date().toISOString() }));
      set({ drawings: [...state.drawings, ...added] });
      if (isDirty(state)) return set({ discard: { kind: "drawing", key: added[0].key } });
      return cad.openTarget({ kind: "drawing", key: added[0].key }, steps);
    }
    let first: { project: ProjectSummary; state: ProjectState } | null = null;
    await run("upload", async () => {
      for (const file of files) {
        const made = await client!.upload(file);
        upsert(made.project);
        first ??= made;
      }
    });
    if (!first) return;
    const made: { project: ProjectSummary; state: ProjectState } = first;
    if (isDirty(state)) return set({ discard: { kind: "saved", id: made.project.id } });
    apply(made.project, made.state);
  },

  /** Save the open review: the first save of the prepared sample creates a project. */
  async save(name?: string) {
    const project = state.project;
    if (!client || !project || project.kind !== "sample") return;
    const sent = JSON.stringify(state.topology);
    const body = { state: snapshot(), openFindings: openFindings(state.topology) };
    await run("save", async () => {
      const summary = project.id
        ? await client!.save(project.id, { expectedRevision: project.summary!.revision, ...body })
        : (await client!.create({ name: name ?? project.name, sceneRevision: demoScene.sceneRevision, configRevision: demoTopology.configRevision, ...body })).project;
      set({ project: { ...state.project!, id: summary.id, key: summary.id, name: summary.name, summary, savedReview: sent }, savedAt: new Date().toISOString() });
      upsert(summary);
    });
  },
  /** Save As: a new project with the review as it is now; never saved yet, it is the first save. */
  async saveAs(name: string) {
    const project = state.project;
    if (!client || !project) return;
    if (!project.id) return cad.save(name);
    await run("copy", async () => {
      const made = await client!.copy(project.id!, name, { state: snapshot(), openFindings: openFindings(state.topology) });
      apply(made.project, made.state);
      upsert(made.project);
      set({ savedAt: new Date().toISOString() });
    });
  },
  /** Rename a project; the open one not yet saved keeps its name for its first save. */
  async rename(name: string, id = state.project?.id ?? null) {
    const project = state.project;
    if (!id || !client) {
      if (project && (!id || project.id === id)) set({ project: { ...project, name } });
      return;
    }
    const summary = state.library.projects.find((p) => p.id === id) ?? project?.summary;
    if (!summary) return;
    await run("rename", async () => {
      const renamed = await client!.rename(id, name, summary.revision);
      upsert(renamed);
      if (state.project?.id === id) set({ project: { ...state.project, name: renamed.name, summary: renamed } });
    });
  },
  async duplicate(id: string, name: string) {
    if (!client) return;
    await run("copy", async () => upsert((await client!.copy(id, name)).project));
  },
  async remove(id: string) {
    if (!client) return;
    await run("delete", async () => {
      await client!.remove(id);
      set({ library: { ...state.library, projects: state.library.projects.filter((p) => p.id !== id) } });
      if (state.project?.id === id) cad.close(true);
    });
  },
  /** Back to the Library; unsaved changes are confirmed first. */
  close(force = false) {
    if (!force && isDirty(state)) return set({ discard: "close" });
    set({ project: null, screen: "library", selection: null, locate: null, failure: null, discard: null });
  },
  dismissFailure: () => set({ failure: null }),

  /** One step of the extraction replay; past the last step the workspace opens. */
  advance(steps: number) {
    if (state.progress >= steps) set({ screen: "studio" });
    else set({ progress: state.progress + 1 });
  },
  skip(steps: number) {
    set({ progress: steps, screen: "studio" });
  },
  show: (screen: Screen) => set({ screen }),
  toggleLibrary: (open: boolean) => set({ libraryOpen: open }),
  setView: (view: StudioView) => set({ view }),
  setLayer: (layer: keyof WorkspaceState["layers"], value: boolean) => set({ layers: { ...state.layers, [layer]: value } }),
  setColourBy: (colourBy: WorkspaceState["colourBy"]) => set({ colourBy }),
  setPreset: (preset: "isometric" | "plan") => set({ preset, presetRevision: state.presetRevision + 1 }),
  select: (selection: Selection) => set({ selection }),
  locateFinding(item: Exclude<Selection, null>, deviceId: string) {
    set({ selection: item, view: state.view === "model" ? "model" : "compare", locate: { id: deviceId, nonce: (state.locate?.nonce ?? 0) + 1 } });
  },
  /** The evidence of the selected equipment or connection. */
  setEvidence(evidence: Evidence) {
    const { selection, topology } = state;
    if (!selection || selection.kind === "port") return;
    set({
      topology: {
        ...topology,
        devices: selection.kind === "device" ? withEvidence(topology.devices, selection.id, evidence) : topology.devices,
        links: selection.kind === "link" ? withEvidence(topology.links, selection.id, evidence) : topology.links,
      },
    });
  },
  setDeviceEvidence(id: string, evidence: Evidence) {
    set({ topology: { ...state.topology, devices: withEvidence(state.topology.devices, id, evidence) } });
  },
  /** Connect an unconnected port from a chiller's evaporator outlet (the operator's choice in review). */
  resolvePort(port: PortFinding, sourceDeviceId: string) {
    const id = `manual_${sourceDeviceId}_${port.device}_${port.port}`;
    const { topology } = state;
    set({
      topology: {
        ...topology,
        links: [
          ...topology.links.filter((candidate) => candidate.id !== id),
          { id, from: { device: sourceDeviceId, port: "evap_out" }, to: { device: port.device, port: port.port }, medium: "chw", evidence: "confirmed", note: "operator-selected connection in CAD review" },
        ],
        unconnectedPorts: topology.unconnectedPorts.filter((candidate) => candidate.device !== port.device || candidate.port !== port.port),
      },
      selection: { kind: "link", id },
    });
  },
  /** Back to the review as last saved (the prepared sample's extraction when never saved). */
  revert() {
    const saved = state.project?.savedReview;
    set({ topology: saved ? JSON.parse(saved) : structuredClone(demoTopology), selection: null, locate: null });
  },
  /** A fresh session (tests). */
  reset() {
    cad.useClient(null);
  },
};
