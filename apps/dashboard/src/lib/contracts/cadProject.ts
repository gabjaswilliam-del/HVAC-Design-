/**
 * CAD projects on the local project service (`/api/cad/v1`, `apps/api/local_server.py`): what
 * the Project Library lists and what a project saves. The service checks the saved state's
 * shape and size; the dashboard validates it fully here (its review is the site topology).
 */
import { z } from "zod";
import { topology } from "./site";

export const CAD_SAMPLE_ID = "water-cooled-plant";

const original = z.object({
  name: z.string(),
  extension: z.enum(["dwg", "dxf"]),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string(),
  /** False when the stored file is missing (the project still opens; the download is refused). */
  available: z.boolean(),
});

export const projectSummary = z.object({
  id: z.string().regex(/^cadp_[0-9a-f]{16}$/),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  modifiedAt: z.string(),
  lastOpenedAt: z.string(),
  revision: z.number().int().nonnegative(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("upload"), original }),
    z.object({ kind: z.literal("sample"), sampleId: z.literal(CAD_SAMPLE_ID), sceneRevision: z.number().int(), configRevision: z.number().int() }),
  ]),
  /** Null: no extraction (an uploaded drawing, which is never parsed). */
  review: z.object({ openFindings: z.number().int().nonnegative() }).nullable(),
  /** How many versions the project's history holds (a service from before versions sends none). */
  versions: z.number().int().nonnegative().default(0),
  /** The approved reference: chosen explicitly, never moved by a new version. */
  referenceVersionId: z.string().nullable().default(null),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

/** One immutable entry of a project's history: an uploaded revision or a frozen review. */
export const projectVersion = z.object({
  id: z.string().regex(/^cadv_[0-9a-f]{16}$/),
  number: z.number().int().positive(),
  createdAt: z.string(),
  label: z.string().nullable(),
  source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("upload"), original }), z.object({ kind: z.literal("review") })]),
  /** A frozen review's open findings; null for an upload, which has no extraction. */
  review: z.object({ openFindings: z.number().int().nonnegative() }).nullable(),
});
export type ProjectVersion = z.infer<typeof projectVersion>;
export const versionList = z.object({ versions: z.array(projectVersion) });
/** A version with its frozen review (null: an upload, never parsed). */
export const versionWithReview = z.object({ version: projectVersion, review: z.object({ topology }).nullable() });
export const versionAdded = z.object({ project: projectSummary, version: projectVersion });
export type VersionAdded = z.infer<typeof versionAdded>;

const selection = z
  .union([
    z.object({ kind: z.enum(["device", "link"]), id: z.string().min(1).max(200) }),
    z.object({ kind: z.literal("port"), deviceId: z.string().min(1).max(200), port: z.string().min(1).max(200) }),
  ])
  .nullable();

export const workspaceState = z.object({
  view: z.enum(["drawing", "model", "compare"]),
  selection,
  /** The 2D viewport: its centre in drawing units and its scale. */
  drawing: z.object({ cx: z.number(), cy: z.number(), scale: z.number().positive() }).optional(),
  /** Legacy: the removed 3D view's camera. Still accepted so older saved projects open; never written. */
  model: z
    .object({ target: z.tuple([z.number(), z.number(), z.number()]), azimuth: z.number(), polar: z.number().min(0).max(80), zoom: z.number().min(0.5).max(8) })
    .optional(),
  compareSplit: z.number().min(25).max(75),
  layers: z.object({ cw: z.boolean(), chw: z.boolean(), valves: z.boolean(), instruments: z.boolean(), names: z.boolean() }),
  colourBy: z.enum(["medium", "review"]),
});
export type WorkspaceState = z.infer<typeof workspaceState>;

export const projectState = z.object({
  schemaVersion: z.literal(1),
  workspace: workspaceState,
  review: z.object({ topology }).nullable(),
});
export type ProjectState = z.infer<typeof projectState>;

export const projectStatus = z.object({
  available: z.literal(true),
  schemaVersion: z.number().int(),
  limits: z.object({
    maxUploadBytes: z.number().int().positive(),
    maxStateBytes: z.number().int().positive(),
    maxNameLength: z.number().int().positive(),
    extensions: z.array(z.string()),
  }),
});
export type ProjectStatus = z.infer<typeof projectStatus>;

export const projectList = z.object({ projects: z.array(projectSummary) });
/** A project with its saved state (create, upload, open, copy). */
export const projectWithState = z.object({ project: projectSummary, state: projectState });
export type ProjectWithState = z.infer<typeof projectWithState>;
export const projectOnly = z.object({ project: projectSummary });
