/**
 * Site topology and scene manifest. Topology mirrors the semantics of the topology
 * family in PR #2 (`water_cooled_chiller_plant_v1`): devices, headers (buses), one
 * lumped terminal, and explicit links that each carry evidence. The scene manifest is
 * presentation only and references topology by ID.
 */
import { z } from "zod";
import { evidence } from "./common";

const medium = z.enum(["cw", "chw"]);

export const deviceFamily = z.enum([
  "chiller_plant",
  "chilled_water_pump_pri",
  "cooling_water_pump",
  "cooling_towers",
  "terminal",
]);
export type DeviceFamily = z.infer<typeof deviceFamily>;

const portRef = z.object({ device: z.string(), port: z.string() });
const linkEnd = z.union([portRef, z.object({ bus: z.string() })]);
export type LinkEnd = z.infer<typeof linkEnd>;

export const device = z.object({
  id: z.string().min(1),
  family: deviceFamily,
  label: z.string().min(1),
  evidence,
  role: z.literal("standby").optional(),
  /** Nameplate/design data: manufacturer values, never fitted or observed values. */
  nameplate: z.array(z.object({ label: z.string(), value: z.number(), unit: z.string() })).default([]),
});
export type Device = z.infer<typeof device>;

export const link = z.object({
  id: z.string().min(1),
  from: linkEnd,
  to: linkEnd,
  medium,
  evidence,
  note: z.string().optional(),
});
export type Link = z.infer<typeof link>;

export const topology = z.object({
  schemaVersion: z.literal(1),
  /** Site configuration revision this topology belongs to. */
  configRevision: z.number().int().positive(),
  family: z.literal("water_cooled_chiller_plant_v1"),
  devices: z.array(device),
  buses: z.array(z.object({ id: z.string(), medium, label: z.string() })),
  links: z.array(link),
  valves: z.array(
    z.object({
      id: z.string(),
      across: z.tuple([z.string(), z.string()]).optional(),
      at: portRef.optional(),
      evidence,
    }),
  ),
  /** Ports the family expects but for which no connection is recorded. */
  unconnectedPorts: z.array(portRef.extend({ note: z.string() })),
});
export type Topology = z.infer<typeof topology>;

const xy = z.tuple([z.number(), z.number()]);
export const metricKind = z.enum(["frequency", "power", "temperature", "hydraulic", "neutral"]);
export type MetricKind = z.infer<typeof metricKind>;
export const spriteKind = z.enum(["chiller", "pump", "coolingTower", "dataHall"]);

export const sceneLayout = z.object({
  sceneRevision: z.number().int().positive(),
  /** Must equal the topology's configRevision or the scene is not drawn. */
  configRevision: z.number().int().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  nodes: z.record(
    z.string(),
    z.object({
      kind: spriteKind,
      x: z.number(),
      y: z.number(),
      flip: z.boolean().optional(),
      labelAt: z.enum(["below", "above", "right"]).optional(),
    }),
  ),
  /** Header polylines in flow direction, drawn in object order. */
  buses: z.record(z.string(), z.array(z.array(xy))),
  /** Waypoints between a link's ends; device-port ends are added automatically. */
  links: z.record(z.string(), z.array(xy)),
  bypasses: z.record(z.string(), z.object({ points: z.array(xy), valve: xy, vertical: z.boolean().optional() })),
  ringValves: z.record(z.string(), xy),
  unconnected: z.array(z.object({ device: z.string(), port: z.string(), points: z.array(xy) })),
  sensors: z.array(z.object({ at: xy, letter: z.enum(["T", "P", "F"]), side: z.enum(["up", "down"]).optional() })),
  tags: z.array(
    z.object({
      metric: z.string(),
      at: xy,
      kind: metricKind,
      unit: z.string(),
      decimals: z.number().int().optional(),
      label: z.string().optional(),
      labelGap: z.number().optional(),
      width: z.number().optional(),
    }),
  ),
  captions: z.array(z.object({ at: xy, text: z.string() })),
  /** Header readings shown in Key mode (below 80% zoom) and where each sits, beside its
   *  header. Optional: without them Key mode shows equipment readings only. */
  keyHeaders: z
    .array(z.object({ metric: z.string(), label: z.string(), at: xy, align: z.enum(["start", "end"]).optional() }))
    .optional(),
});
export type SceneLayout = z.infer<typeof sceneLayout>;

export const metricInfo = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
  decimals: z.number().int(),
});
export type MetricInfo = z.infer<typeof metricInfo>;

/** Everything needed to draw and label one installed site. One site, no selector. */
export const siteBundle = z.object({
  site: z.object({ name: z.string(), timezone: z.string(), timezoneLabel: z.string() }),
  topology,
  scene: sceneLayout,
  /** Metric catalogue keyed by `device:metric`, for labels, units and formatting. */
  metrics: z.array(metricInfo),
});
export type SiteBundle = z.infer<typeof siteBundle>;

