/**
 * CAD projects held in this tab: the demo mode's project service. It keeps the local service's
 * rules (`src/hvac_agent/cad/projects.py`) so both modes behave alike: a drawing is stored as
 * it is and never parsed (checked by its extension only), an upload is the project's version 1,
 * versions are immutable, and the approved reference changes only by an explicit, revision-
 * checked choice. Everything is lost when the tab is reloaded.
 */
import type { Topology } from "../contracts";
import type { ProjectState, ProjectSummary, ProjectVersion } from "../contracts/cadProject";
import { CAD_SAMPLE_ID } from "../contracts/cadProject";
import { ApiError } from "./client";
import type { CadProjectsClient } from "./cadProjects";

interface StoredVersion {
  version: ProjectVersion;
  review: { topology: Topology } | null;
  file: File | null;
}
interface Stored {
  summary: ProjectSummary;
  state: ProjectState;
  file: File | null;
  versions: StoredVersion[];
}

const EXTENSIONS = ["dwg", "dxf"];
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
const clone = <T,>(value: T): T => structuredClone(value);

async function sha256(file: File) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `unhashed-${hex()}`; // no SubtleCrypto (an insecure context): files still compare as different
  }
}

function checked(file: File) {
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!EXTENSIONS.includes(extension)) throw new ApiError("INVALID_REQUEST", "Only DWG and DXF drawings (.dwg, .dxf) can be uploaded.", false);
  if (!file.size) throw new ApiError("INVALID_REQUEST", "The file is empty.", false);
  return { extension, stem: file.name.slice(0, dot).trim().slice(0, 120) || file.name };
}

const defaultState = (): ProjectState => ({
  schemaVersion: 1,
  workspace: { view: "drawing", selection: null, compareSplit: 50, layers: { cw: true, chw: true, valves: true, instruments: true, names: true }, colourBy: "medium" },
  review: null,
});

export function memoryCadProjects(now: () => string = () => new Date().toISOString()): CadProjectsClient {
  const projects = new Map<string, Stored>();
  const urls = new Map<string, string>();
  const find = (id: string) => {
    const project = projects.get(id);
    if (!project) throw new ApiError("NOT_FOUND", "There is no CAD project with this ID.", false);
    return project;
  };
  const findVersion = (id: string, versionId: string) => {
    const version = find(id).versions.find((v) => v.version.id === versionId);
    if (!version) throw new ApiError("NOT_FOUND", "There is no version with this ID in the project.", false);
    return version;
  };
  const conflict = (project: Stored, revision: number) => {
    if (project.summary.revision !== revision) {
      throw new ApiError("CONFLICT", `This project changed elsewhere (it is at revision ${project.summary.revision}, not ${revision}). Reopen it to continue from the saved version.`, false, { project: clone(project.summary) });
    }
  };
  const summary = (p: Stored): ProjectSummary => clone({ ...p.summary, versions: p.versions.length });
  const fileUrl = (key: string, file: File | null) => {
    if (!file || typeof URL.createObjectURL !== "function") return "";
    if (!urls.has(key)) urls.set(key, URL.createObjectURL(file));
    return urls.get(key)!;
  };
  const uploadVersion = async (file: File, number: number): Promise<StoredVersion> => {
    const { extension } = checked(file);
    return {
      version: {
        id: `cadv_${hex()}`, number, createdAt: now(), label: null,
        source: { kind: "upload", original: { name: file.name, extension: extension as "dwg" | "dxf", sizeBytes: file.size, sha256: await sha256(file), available: true } },
        review: null,
      },
      review: null,
      file,
    };
  };
  const make = (name: string, source: ProjectSummary["source"], state: ProjectState, openFindings: number | null, file: File | null, versions: StoredVersion[]): Stored => {
    const at = now();
    const stored: Stored = {
      summary: { id: `cadp_${hex()}`, name, createdAt: at, modifiedAt: at, lastOpenedAt: at, revision: 1, source, review: openFindings === null ? null : { openFindings }, versions: versions.length, referenceVersionId: null },
      state: clone(state),
      file,
      versions,
    };
    projects.set(stored.summary.id, stored);
    return stored;
  };
  const added = (project: Stored, version: StoredVersion) => {
    project.versions.push(version);
    project.summary.modifiedAt = now();
    return { project: summary(project), version: clone(version.version) };
  };

  const client: CadProjectsClient = {
    status: async () => ({ available: true, schemaVersion: 1, limits: { maxUploadBytes: 64 * 1024 * 1024, maxStateBytes: 1024 * 1024, maxNameLength: 120, extensions: EXTENSIONS } }),
    list: async () =>
      [...projects.values()]
        .sort((a, b) => b.summary.lastOpenedAt.localeCompare(a.summary.lastOpenedAt) || b.summary.modifiedAt.localeCompare(a.summary.modifiedAt))
        .map(summary),
    create: async ({ name, sceneRevision, configRevision, state, openFindings }) => {
      const made = make(name.trim(), { kind: "sample", sampleId: CAD_SAMPLE_ID, sceneRevision, configRevision }, state, openFindings, null, []);
      return { project: summary(made), state: clone(made.state) };
    },
    upload: async (file) => {
      const { stem } = checked(file);
      const first = await uploadVersion(file, 1);
      if (first.version.source.kind !== "upload") throw new Error("unreachable");
      const made = make(stem, { kind: "upload", original: first.version.source.original }, defaultState(), null, file, [first]);
      return { project: summary(made), state: clone(made.state) };
    },
    open: async (id) => {
      const project = find(id);
      project.summary.lastOpenedAt = now();
      return { project: summary(project), state: clone(project.state) };
    },
    save: async (id, { expectedRevision, state, openFindings }) => {
      const project = find(id);
      conflict(project, expectedRevision);
      Object.assign(project.summary, { revision: project.summary.revision + 1, modifiedAt: now(), review: openFindings === null ? null : { openFindings } });
      project.state = clone(state);
      return summary(project);
    },
    rename: async (id, name, expectedRevision) => {
      const project = find(id);
      conflict(project, expectedRevision);
      Object.assign(project.summary, { name: name.trim(), revision: project.summary.revision + 1, modifiedAt: now() });
      return summary(project);
    },
    copy: async (id, name, saved) => {
      const source = find(id);
      const versions = source.versions.map((v) => ({ ...v, version: { ...clone(v.version), id: `cadv_${hex()}` } }));
      const made = make(name.trim(), clone(source.summary.source), saved?.state ?? source.state, saved ? saved.openFindings : source.summary.review?.openFindings ?? null, source.file, versions);
      const reference = source.versions.find((v) => v.version.id === source.summary.referenceVersionId);
      made.summary.referenceVersionId = reference ? versions.find((v) => v.version.number === reference.version.number)!.version.id : null;
      return { project: summary(made), state: clone(made.state) };
    },
    remove: async (id) => {
      find(id);
      projects.delete(id);
    },
    originalUrl: (id) => fileUrl(id, projects.get(id)?.file ?? null),
    versions: async (id) => find(id).versions.map((v) => clone(v.version)),
    version: async (id, versionId) => {
      const found = findVersion(id, versionId);
      return { version: clone(found.version), review: found.review ? clone(found.review) : null };
    },
    uploadVersion: async (id, file) => {
      const project = find(id);
      return added(project, await uploadVersion(file, project.versions.length + 1));
    },
    addReviewVersion: async (id, { label, review, openFindings }) => {
      const project = find(id);
      const number = project.versions.length + 1;
      return added(project, { version: { id: `cadv_${hex()}`, number, createdAt: now(), label, source: { kind: "review" }, review: { openFindings } }, review: clone(review), file: null });
    },
    setReference: async (id, versionId, expectedRevision) => {
      const project = find(id);
      conflict(project, expectedRevision);
      if (versionId !== null) findVersion(id, versionId);
      Object.assign(project.summary, { referenceVersionId: versionId, revision: project.summary.revision + 1, modifiedAt: now() });
      return summary(project);
    },
    versionOriginalUrl: (id, versionId) => {
      const version = projects.get(id)?.versions.find((v) => v.version.id === versionId);
      return fileUrl(versionId, version?.file ?? null);
    },
  };
  return client;
}
