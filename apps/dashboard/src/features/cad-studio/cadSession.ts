/**
 * CAD Studio's session: the open project (the prepared sample's review or an uploaded drawing),
 * its review, its history of versions and the approved reference, what is being compared, and
 * the project list. Kept outside React, so the review survives leaving CAD Studio (its route
 * unmounts) and the page only renders it.
 *
 * Projects persist on the local project service with `cad=local` (`apps/api/local_server.py`).
 * The default demo mode uses the same rules held in this tab (`cadProjectsMemory.ts`): nothing
 * survives a reload.
 */
import { useSyncExternalStore } from "react";
import type { Device, Topology } from "../../lib/contracts";
import type { ProjectState, ProjectSummary, ProjectVersion, WorkspaceState } from "../../lib/contracts/cadProject";
import { ApiError } from "../../lib/api/client";
import { httpCadProjects, type CadProjectsClient } from "../../lib/api/cadProjects";
import { memoryCadProjects } from "../../lib/api/cadProjectsMemory";
import { demoScene, demoTopology } from "../../fixtures/demoPlant";
import { en } from "../../lib/i18n/en";
import type { Size, View } from "../monitoring/scene/panZoom";

export type Screen = "library" | "extract" | "studio" | "preview";
/** A project's three views. */
export type ProjectTab = "drawing" | "history" | "compare";
export type CompareMode = "side" | "overlay" | "diff";
/** A side of a comparison: the working review ("working") or a saved version's ID. */
export type VersionKey = string;
export const WORKING = "working";
export type CadMode = "demo" | "local";
export type Selection = { kind: "device" | "link"; id: string } | { kind: "port"; deviceId: string; port: string } | null;
export type LocateRequest = { id: string; nonce: number } | null;
export type Evidence = Device["evidence"];
export type PortFinding = Topology["unconnectedPorts"][number];
/** A project to open: the prepared sample (a new review) or a stored project. */
export type OpenTarget = { kind: "sample" } | { kind: "saved"; id: string };
/** The viewports whose pan and zoom are remembered. */
export type Place = "drawing" | "source" | "compare";

/** What CAD Studio stores: engineering drawings only, as the project service accepts them (`EXTENSIONS` in projects.py). */
export const DRAWING_EXTENSIONS = ["dwg", "dxf"] as const;
export const DRAWING_ACCEPT = DRAWING_EXTENSIONS.map((ext) => `.${ext}`).join(",");
export const isDrawing = (file: File) => (DRAWING_EXTENSIONS as readonly string[]).includes(file.name.split(".").pop()?.toLowerCase() ?? "");
/** Where an upload goes: new projects (from Projects) or new versions of the open project. */
export type UploadTarget = "projects" | "revision";

export const SAMPLE_KEY = "sample";
export const SAMPLE_FILENAME = "demo-cooling-plant-rev-a.dwg";

export interface OpenProject {
  /** The stored project's id; null for the prepared sample before its first save. */
  id: string | null;
  /** The stored id, or the sample's key. */
  key: string;
  name: string;
  /** "sample": the prepared sample's extraction, reviewable; "drawing": stored only, never parsed. */
  kind: "sample" | "drawing";
  summary: ProjectSummary | null;
  /** A drawing project's own original (its version 1). */
  original: { name: string; extension: string; sizeBytes: number; available: boolean } | null;
  /** The review as last saved (JSON): unsaved changes are measured against it. */
  savedReview: string | null;
}

export interface CadSession {
  mode: CadMode;
  screen: Screen;
  /** Steps of the prepared sample's extraction replay already shown (a replay, not parsing). */
  progress: number;
  tab: ProjectTab;
  layers: WorkspaceState["layers"];
  colourBy: WorkspaceState["colourBy"];
  /** The reviewed topology: evidence changes and connections created in review. */
  topology: Topology;
  selection: Selection;
  locate: LocateRequest;
  project: OpenProject | null;
  library: { status: "idle" | "loading" | "ready" | "unavailable"; projects: ProjectSummary[]; message: string | null };
  /** The project operation in flight; its controls wait for the service. */
  busy: "open" | "save" | "rename" | "copy" | "delete" | "upload" | "version" | "reference" | null;
  /** The last operation's failure; a save over a project changed elsewhere is a conflict. */
  failure: { message: string; conflict: boolean } | null;
  /** When this tab last saved the open project. */
  savedAt: string | null;
  /** Opening this (or closing) would discard unsaved changes: the page asks first. */
  discard: OpenTarget | "close" | { kind: "new"; name: string } | null;
  /** Drawing: the review panel (findings, properties, evidence) beside the canvas. */
  reviewOpen: boolean;
  /** Drawing: the synthetic source drawing beside the extraction. */
  sourceCompare: boolean;
  /** The open project's versions, oldest first. */
  history: { status: "idle" | "loading" | "ready" | "unavailable"; versions: ProjectVersion[] };
  /** Frozen reviews loaded so far, by version ID (null: an upload, which has no extraction). */
  reviews: Record<string, Topology | null>;
  /** Drawing: a version shown read-only instead of the working review. */
  viewing: string | null;
  /** Compare's sides (null: the defaults, the approved reference against the latest work). */
  compare: { reference: VersionKey | null; target: VersionKey | null; mode: CompareMode };
}

/** Where each 2D view was left: its pan and zoom (with the box they were measured in) and
 *  the source split. Written as they change and read when a view mounts, never rendered
 *  from, so moving the drawing re-renders nothing else. A saved project's viewport waits in
 *  `restore` for its view to mount. */
interface Placement {
  compareSplit: number;
  viewports: Partial<Record<Place, { view: View; box: Size }>>;
  /** The last locate request a viewport has applied: a remount restores its view instead. */
  locatedNonce: number;
  restore: { view: Place; cx: number; cy: number; scale: number } | null;
}

const MODE: CadMode = typeof location !== "undefined" && new URLSearchParams(location.search).get("cad") === "local" ? "local" : "demo";
const DEFAULT_LAYERS: WorkspaceState["layers"] = { cw: true, chw: true, valves: true, instruments: true, names: true };
const SAMPLE_REVIEW = JSON.stringify(demoTopology);

const freshProject = () => ({
  tab: "drawing" as ProjectTab,
  selection: null,
  locate: null,
  failure: null,
  savedAt: null,
  reviewOpen: false,
  history: { status: "idle" as const, versions: [] },
  reviews: {},
  viewing: null,
  compare: { reference: null, target: null, mode: "side" as CompareMode },
});

const initial = (mode: CadMode): CadSession => ({
  mode,
  screen: "library",
  progress: 0,
  layers: DEFAULT_LAYERS,
  colourBy: "medium",
  topology: structuredClone(demoTopology),
  project: null,
  library: { status: "idle", projects: [], message: null },
  busy: null,
  discard: null,
  sourceCompare: false,
  ...freshProject(),
});
const initialPlacement = (): Placement => ({ compareSplit: 50, viewports: {}, locatedNonce: 0, restore: null });

let state = initial(MODE);
let client: CadProjectsClient = MODE === "local" ? httpCadProjects() : memoryCadProjects();
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

/** The approved reference of the open project, if one has been chosen. */
export const referenceId = (session: CadSession) => session.project?.summary?.referenceVersionId ?? null;

/** Compare's sides with their defaults: the approved reference (else the first version) against
 *  the working review (sample-based) or the latest version that is not the reference. */
export function compareSides(session: CadSession): { reference: VersionKey | null; target: VersionKey | null } {
  const versions = session.history.versions;
  const reference = session.compare.reference ?? referenceId(session) ?? versions[0]?.id ?? null;
  const latestOther = [...versions].reverse().find((v) => v.id !== reference)?.id ?? null;
  const target = session.compare.target ?? (session.project?.kind === "sample" ? WORKING : latestOther);
  return { reference, target };
}

// Unsaved review work is lost with the tab, whichever page is showing.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (isDirty(state)) event.preventDefault();
  });
}

const withEvidence = <T extends { id: string; evidence: Evidence }>(items: T[], id: string, evidence: Evidence) =>
  items.map((item) => (item.id === id ? { ...item, evidence } : item));
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The saved workspace: the drawing view (with the source beside it or not), selection, the
 *  shown viewport and the source split. 3D camera state is no longer written. */
function snapshot(): ProjectState {
  const place: Place = state.sourceCompare ? "source" : "drawing";
  const at = cad.placement.viewports[place];
  return {
    schemaVersion: 1,
    workspace: {
      view: state.sourceCompare ? "compare" : "drawing",
      selection: state.selection,
      ...(at ? { drawing: { cx: (at.box.w / 2 - at.view.x) / at.view.k, cy: (at.box.h / 2 - at.view.y) / at.view.k, scale: at.view.k } } : {}),
      compareSplit: cad.placement.compareSplit,
      layers: state.layers,
      colourBy: state.colourBy,
    },
    review: state.project?.kind === "sample" ? { topology: state.topology } : null,
  };
}

/** The project list's copy of a project, newest first when it is new. */
function upsert(summary: ProjectSummary) {
  const projects = state.library.projects;
  const at = projects.findIndex((p) => p.id === summary.id);
  set({ library: { ...state.library, projects: at < 0 ? [summary, ...projects] : projects.map((p, i) => (i === at ? summary : p)) } });
}

/** A newer summary of the open project (a save, rename, version or reference change). */
function updateOpen(summary: ProjectSummary) {
  upsert(summary);
  if (state.project?.id === summary.id) set({ project: { ...state.project, name: summary.name, summary } });
}

/**
 * Open what the service returned: its review, view, selection and 2D viewport. Older saved
 * states are normalized here: a 3D view ("model", with its camera) reopens on the 2D drawing,
 * and "compare" (the source drawing beside the extraction) reopens with the source beside it.
 */
function apply(summary: ProjectSummary, saved: ProjectState) {
  const review = saved.review?.topology ?? null;
  const sample = summary.source.kind === "sample";
  const sourceCompare = sample && saved.workspace.view === "compare";
  set({
    ...freshProject(),
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
    sourceCompare,
    layers: saved.workspace.layers,
    colourBy: saved.workspace.colourBy,
    selection: saved.workspace.selection,
    // A saved selection comes back with the review that shows it.
    reviewOpen: !!saved.workspace.selection,
    screen: "studio",
    discard: null,
  });
  const place: Place = sourceCompare ? "source" : "drawing";
  cad.placement = { ...initialPlacement(), compareSplit: saved.workspace.compareSplit, restore: saved.workspace.drawing ? { view: place, ...saved.workspace.drawing } : null };
  void cad.loadHistory();
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
  !!state.project && (target.kind === "sample" ? state.project.key === SAMPLE_KEY : state.project.id === target.id);

export const cad = {
  current: () => state,
  placement: initialPlacement(),
  /** The project service in use; tests give their own. Without one: this tab's memory. */
  useClient(next: CadProjectsClient | null, mode: CadMode = next ? "local" : "demo") {
    client = next ?? memoryCadProjects();
    state = initial(mode);
    cad.placement = initialPlacement();
    listeners.forEach((listener) => listener());
  },
  originalUrl: (id: string) => client.originalUrl(id) || null,
  versionUrl: (versionId: string) => (state.project?.id ? client.versionOriginalUrl(state.project.id, versionId) || null : null),

  /** Read the project list. A local service that does not answer leaves the sample reviewable. */
  async loadLibrary() {
    if (state.library.status === "loading") return;
    set({ library: { ...state.library, status: "loading" } });
    try {
      set({ library: { status: "ready", projects: await client.list(), message: null } });
    } catch (e) {
      set({ library: { status: "unavailable", projects: state.library.projects, message: message(e) } });
    }
  },

  /** Open a project (the open one resumes); unsaved changes are confirmed before they are discarded. */
  request(target: OpenTarget, steps: number) {
    if (isOpen(target)) return set({ screen: target.kind === "sample" && state.progress < steps ? "extract" : "studio" });
    if (isDirty(state)) return set({ discard: target });
    void cad.openTarget(target, steps);
  },
  confirmDiscard(steps: number) {
    const target = state.discard;
    set({ discard: null });
    if (target === "close") cad.close(true);
    else if (target) {
      if (target.kind === "new") void cad.newProject(target.name, steps, true);
      else void cad.openTarget(target, steps);
    }
  },
  cancelDiscard: () => set({ discard: null }),
  async openTarget(target: OpenTarget, steps: number) {
    if (target.kind === "sample") {
      cad.placement = initialPlacement();
      return set({
        ...freshProject(),
        project: { id: null, key: SAMPLE_KEY, name: en.cad.sampleName, kind: "sample", summary: null, original: null, savedReview: SAMPLE_REVIEW },
        topology: structuredClone(demoTopology),
        sourceCompare: false,
        history: { status: "ready", versions: [] },
        screen: state.progress < steps ? "extract" : "studio",
      });
    }
    await run("open", async () => {
      const opened = await client.open(target.id);
      apply(opened.project, opened.state);
      upsert(opened.project);
    });
  },

  /** A named review of the prepared sample, saved at once. */
  async newProject(name: string, steps: number, force = false) {
    const next = name.trim().slice(0, 120);
    if (!next) return;
    if (!force && isDirty(state)) return set({ discard: { kind: "new", name: next } });
    await cad.openTarget({ kind: "sample" }, steps);
    if (state.project?.kind !== "sample") return;
    set({ project: { ...state.project!, name: next } });
    await cad.save(next);
  },

  /**
   * The one upload workflow, behind every upload control and drop: drawings only (anything else
   * is named and refused), as new projects or as new versions of the open project. A version
   * never moves the approved reference.
   */
  async upload(files: File[], into: UploadTarget) {
    const drawings = files.filter(isDrawing);
    const refused = files.filter((file) => !isDrawing(file)).map((file) => file.name);
    if (into === "revision" && state.project) {
      if (drawings.length) set({ tab: "history", viewing: null });
      for (const file of drawings) await cad.uploadRevision(file);
    } else if (drawings.length) {
      await cad.importFiles(drawings);
    }
    if (refused.length) set({ failure: { message: en.cad.onlyDrawings(refused), conflict: false } });
  },

  /** Upload drawings as new projects (stored as they are, never parsed); the first one opens. */
  async importFiles(files: File[]) {
    if (!files.length) return;
    let first: { project: ProjectSummary; state: ProjectState } | null = null;
    await run("upload", async () => {
      for (const file of files) {
        const made = await client.upload(file);
        upsert(made.project);
        first ??= made;
      }
    });
    if (!first) return;
    const made: { project: ProjectSummary; state: ProjectState } = first;
    // An upload never discards a review: with unsaved changes, opening it is confirmed first.
    if (isDirty(state)) return set({ discard: { kind: "saved", id: made.project.id } });
    apply(made.project, made.state);
  },

  /** A new revision of the open project, appended to its history. The approved reference stays. */
  async uploadRevision(file: File) {
    if (!state.project) return;
    if (!state.project.id) await cad.save();
    const id = state.project?.id;
    if (!id) return;
    await run("upload", async () => {
      const added = await client.uploadVersion(id, file);
      updateOpen(added.project);
      set({ history: { status: "ready", versions: [...state.history.versions, added.version] }, reviews: { ...state.reviews, [added.version.id]: null } });
    });
  },

  /** Save the open review: the first save of the prepared sample creates a project. */
  async save(name?: string) {
    const project = state.project;
    if (!project || project.kind !== "sample") return;
    const sent = JSON.stringify(state.topology);
    const body = { state: snapshot(), openFindings: openFindings(state.topology) };
    await run("save", async () => {
      const summary = project.id
        ? await client.save(project.id, { expectedRevision: project.summary!.revision, ...body })
        : (await client.create({ name: name ?? project.name, sceneRevision: demoScene.sceneRevision, configRevision: demoTopology.configRevision, ...body })).project;
      set({ project: { ...state.project!, id: summary.id, key: summary.id, name: summary.name, summary, savedReview: sent }, savedAt: new Date().toISOString() });
      if (!project.id) set({ history: { status: "ready", versions: [] } });
      upsert(summary);
    });
  },
  /** Save As: a new project with the review as it is now; never saved yet, it is the first save. */
  async saveAs(name: string) {
    const project = state.project;
    if (!project) return;
    if (!project.id) return cad.save(name);
    await run("copy", async () => {
      const made = await client.copy(project.id!, name, { state: snapshot(), openFindings: project.kind === "sample" ? openFindings(state.topology) : null });
      apply(made.project, made.state);
      upsert(made.project);
      set({ savedAt: new Date().toISOString() });
    });
  },
  /** Rename a project; the open one not yet saved keeps its name for its first save. */
  async rename(name: string, id = state.project?.id ?? null) {
    const project = state.project;
    if (!id) {
      if (project && !project.id) set({ project: { ...project, name } });
      return;
    }
    const summary = state.library.projects.find((p) => p.id === id) ?? project?.summary;
    if (!summary) return;
    await run("rename", async () => updateOpen(await client.rename(id, name, summary.revision)));
  },
  async duplicate(id: string, name: string) {
    await run("copy", async () => upsert((await client.copy(id, name)).project));
  },
  async remove(id: string) {
    await run("delete", async () => {
      await client.remove(id);
      set({ library: { ...state.library, projects: state.library.projects.filter((p) => p.id !== id) } });
      if (state.project?.id === id) cad.close(true);
    });
  },
  /** Back to the projects; unsaved changes are confirmed first. */
  close(force = false) {
    if (!force && isDirty(state)) return set({ discard: "close" });
    set({ project: null, screen: "library", selection: null, locate: null, failure: null, discard: null, viewing: null });
  },
  dismissFailure: () => set({ failure: null }),

  // --- History, versions and the approved reference ----------------------------------------

  async loadHistory() {
    const id = state.project?.id;
    if (!id) return;
    set({ history: { ...state.history, status: "loading" } });
    try {
      const versions = await client.versions(id);
      if (state.project?.id === id) set({ history: { status: "ready", versions } });
    } catch {
      if (state.project?.id === id) set({ history: { ...state.history, status: "unavailable" } });
    }
  },
  /** A version's frozen review (null for an upload), loaded once. */
  async loadReview(versionId: string) {
    const id = state.project?.id;
    if (!id || versionId === WORKING || versionId in state.reviews) return;
    try {
      const found = await client.version(id, versionId);
      if (state.project?.id === id) set({ reviews: { ...state.reviews, [versionId]: found.review?.topology ?? null } });
    } catch (e) {
      set({ failure: { message: message(e), conflict: false } });
    }
  },
  /** Freeze the working review as a new version (saving the project first). */
  async saveVersion(name?: string, label: string | null = null) {
    const project = state.project;
    if (!project || project.kind !== "sample") return;
    if (!project.id || isDirty(state)) await cad.save(name);
    const id = state.project?.id;
    if (!id || state.failure) return;
    const topology = structuredClone(state.topology);
    await run("version", async () => {
      const added = await client.addReviewVersion(id, { label, review: { topology }, openFindings: openFindings(topology) });
      updateOpen(added.project);
      set({ history: { status: "ready", versions: [...state.history.versions, added.version] }, reviews: { ...state.reviews, [added.version.id]: topology } });
    });
  },
  /** Choose the approved reference (or clear it). Only this changes it. */
  async setReference(versionId: string | null) {
    const project = state.project;
    if (!project?.id || !project.summary) return;
    await run("reference", async () => {
      updateOpen(await client.setReference(project.id!, versionId, project.summary!.revision));
      set({ compare: { ...state.compare, reference: null } });
    });
  },
  /** Show a version read-only on the Drawing view (null: back to the working review). */
  viewVersion(versionId: string | null) {
    set({ viewing: versionId, tab: "drawing", selection: null, locate: null });
    if (versionId) void cad.loadReview(versionId);
  },
  /** Compare a version (or the working review) against the reference. */
  compareWith(target: VersionKey) {
    set({ tab: "compare", compare: { ...state.compare, target } });
  },
  setCompare(patch: Partial<CadSession["compare"]>) {
    set({ compare: { ...state.compare, ...patch } });
  },

  // --- The extraction replay, views and review ------------------------------------------------

  /** One step of the extraction replay; past the last step the workspace opens. */
  advance(steps: number) {
    if (state.progress >= steps) set({ screen: "studio" });
    else set({ progress: state.progress + 1 });
  },
  skip(steps: number) {
    set({ progress: steps, screen: "studio" });
  },
  show: (screen: Screen) => set({ screen }),
  setTab: (tab: ProjectTab) => set({ tab }),
  /** Open or close the review; closing it ends the inspection, so reopening starts at the findings. */
  toggleReview: (open = !state.reviewOpen) => set({ reviewOpen: open, ...(open ? {} : { selection: null, locate: null }) }),
  setSourceCompare: (sourceCompare: boolean) => set({ sourceCompare }),
  setLayer: (layer: keyof WorkspaceState["layers"], value: boolean) => set({ layers: { ...state.layers, [layer]: value } }),
  setColourBy: (colourBy: WorkspaceState["colourBy"]) => set({ colourBy }),
  select: (selection: Selection) => set({ selection, ...(selection ? { reviewOpen: true } : {}) }),
  locateFinding(item: Exclude<Selection, null>, deviceId: string) {
    set({ selection: item, tab: "drawing", viewing: null, reviewOpen: true, locate: { id: deviceId, nonce: (state.locate?.nonce ?? 0) + 1 } });
  },
  /** The evidence of the selected equipment or connection. */
  setEvidence(evidence: Evidence) {
    const { selection, topology } = state;
    if (!selection || selection.kind === "port" || state.viewing) return;
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
    if (state.viewing) return;
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
