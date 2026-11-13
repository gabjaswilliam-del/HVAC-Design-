/**
 * The local CAD project service (`/api/cad/v1`, `apps/api/local_server.py`): JSON through the
 * shared local transport, the drawing upload as its raw bytes (never base64), and the
 * original's download as a plain same-origin link. Selected with `cad=local`; nothing falls
 * back to fixtures.
 */
import { z } from "zod";
import { ApiError, validate, type ErrorCode } from "./client";
import { localService } from "./local";
import {
  CAD_SAMPLE_ID,
  projectList,
  projectOnly,
  projectState,
  projectStatus,
  projectSummary,
  projectWithState,
  type ProjectState,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectWithState,
} from "../contracts/cadProject";

export const CAD_API = "/api/cad/v1";

export interface CadProjectsClient {
  status(): Promise<ProjectStatus>;
  list(): Promise<ProjectSummary[]>;
  /** A new project from the prepared sample, with the state the dashboard reviewed. */
  create(body: { name: string; sceneRevision: number; configRevision: number; state: ProjectState; openFindings: number | null }): Promise<ProjectWithState>;
  /** A new project from a drawing: stored as it is, never parsed. */
  upload(file: File): Promise<ProjectWithState>;
  /** The project and its saved state; records when it was opened. */
  open(id: string): Promise<ProjectWithState>;
  /** Saves over `expectedRevision`; a project changed elsewhere is a CONFLICT. */
  save(id: string, body: { expectedRevision: number; state: ProjectState; openFindings: number | null }): Promise<ProjectSummary>;
  rename(id: string, name: string, expectedRevision: number): Promise<ProjectSummary>;
  /** Save As (with the unsaved state and its open findings) or Duplicate (the saved state). */
  copy(id: string, name: string, saved?: { state: ProjectState; openFindings: number | null }): Promise<ProjectWithState>;
  remove(id: string): Promise<void>;
  originalUrl(id: string): string;
}

const copied = z.object({ project: projectSummary, state: projectState.optional() });
const deleted = z.object({ deleted: z.string() });
const CODES: Record<string, ErrorCode> = { NOT_FOUND: "NOT_FOUND", CONFLICT: "CONFLICT", PERMISSION_DENIED: "PERMISSION_DENIED", UNAVAILABLE: "UNAVAILABLE" };

export function httpCadProjects(fetchImpl: typeof fetch = (...a) => fetch(...a)): CadProjectsClient {
  const call = localService(CAD_API, "CAD project", fetchImpl);
  const client: CadProjectsClient = {
    status: () => call(projectStatus, "/status"),
    list: async () => (await call(projectList, "/projects")).projects,
    create: (body) => call(projectWithState, "/projects", { method: "POST", body: { ...body, sampleId: CAD_SAMPLE_ID } }),
    upload: (file) => upload(fetchImpl, file),
    open: (id) => call(projectWithState, `/projects/${id}/open`, { method: "POST", body: {} }),
    save: async (id, body) => (await call(projectOnly, `/projects/${id}`, { method: "PUT", body })).project,
    rename: async (id, name, expectedRevision) => (await call(projectOnly, `/projects/${id}/rename`, { method: "POST", body: { name, expectedRevision } })).project,
    copy: async (id, name, saved) => {
      const made = await call(copied, `/projects/${id}/copy`, { method: "POST", body: saved ? { name, ...saved } : { name } });
      return made.state ? { project: made.project, state: made.state } : client.open(made.project.id);
    },
    remove: async (id) => void (await call(deleted, `/projects/${id}`, { method: "DELETE" })),
    originalUrl: (id) => `${CAD_API}/projects/${id}/original`,
  };
  return client;
}

async function upload(fetchImpl: typeof fetch, file: File): Promise<ProjectWithState> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetchImpl(`${CAD_API}/projects/upload?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      // The service accepts writes only with this header, which a cross-site page cannot set.
      headers: { Accept: "application/json", "X-HVAC-Client": "dashboard", "Content-Type": "application/octet-stream" },
      body: file,
    });
    if (!(response.headers.get("content-type") ?? "").includes("json")) {
      throw new ApiError("UNAVAILABLE", `No local CAD project service answered at ${CAD_API} (HTTP ${response.status}).`, true);
    }
    body = await response.json();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError("UNAVAILABLE", "The local CAD project service could not be reached.", true);
  }
  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: unknown; retryable?: unknown; details?: Record<string, unknown> } } | null)?.error;
    const code = CODES[err?.code ?? ""] ?? (response.status < 500 ? "INVALID_REQUEST" : "UNAVAILABLE");
    throw new ApiError(code, typeof err?.message === "string" ? err.message : `The CAD project service answered ${response.status}.`, err?.retryable === true, err?.details);
  }
  return validate(projectWithState, body, "CAD project");
}
