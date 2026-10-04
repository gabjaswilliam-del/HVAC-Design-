/** Latest readings, history and issues. Missing is null + quality, never zero. */
import { z } from "zod";
import { isoTime, operatingState, quality, source } from "./common";

export const reading = z.object({
  value: z.number().finite().nullable(),
  quality,
  sampleTime: isoTime.nullable(),
});
export type Reading = z.infer<typeof reading>;

export const equipmentStatus = z.object({
  state: operatingState,
  /** Last reported state retained after its data stopped being current. */
  stale: z.boolean().optional(),
  sampleTime: isoTime.nullable(),
});
export type EquipmentStatus = z.infer<typeof equipmentStatus>;

export const snapshot = z.object({
  schemaVersion: z.literal(1),
  source,
  configRevision: z.number().int().positive(),
  /** Requested observation time (source clock). */
  at: isoTime,
  /** Newest sample actually received at or before `at`. */
  latestSampleAt: isoTime.nullable(),
  connection: z.enum(["connected", "disconnected"]),
  equipment: z.record(z.string(), equipmentStatus),
  values: z.record(z.string(), reading),
  /** Plant-level indicators keyed like readings (e.g. `plant:cop`). */
  kpis: z.record(z.string(), reading),
});
export type Snapshot = z.infer<typeof snapshot>;

export const history = z.object({
  schemaVersion: z.literal(1),
  configRevision: z.number().int().positive(),
  from: isoTime,
  to: isoTime,
  times: z.array(isoTime),
  series: z.array(
    z.object({
      metric: z.string(),
      unit: z.string(),
      values: z.array(z.number().finite().nullable()),
      quality: z.array(quality),
    }),
  ),
});
export type History = z.infer<typeof history>;

export const issueSeverity = z.enum(["info", "warning", "critical"]);
export const issueStatus = z.enum(["detected", "investigating", "correction_proposed", "monitoring", "resolved"]);

export const issue = z.object({
  id: z.string(),
  title: z.string(),
  severity: issueSeverity,
  status: issueStatus,
  equipmentIds: z.array(z.string()),
  firstSeen: isoTime,
  lastSeen: isoTime,
  summary: z.string(),
  /** Metric keys whose readings support the issue. */
  evidence: z.array(z.string()),
});
export type Issue = z.infer<typeof issue>;

export const issueList = z.object({
  schemaVersion: z.literal(1),
  at: isoTime,
  issues: z.array(issue),
});
export type IssueList = z.infer<typeof issueList>;
