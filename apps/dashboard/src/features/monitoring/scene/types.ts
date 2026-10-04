import type { SpriteKind } from "./geometry";
import type { OperatingState } from "./materials";
import type { MetricKind, Quality } from "./ReadoutTag";

type XY = [number, number];

/**
 * Presentation of one site revision. Coordinates are layout only: moving anything
 * here never changes the physical topology it draws, and every pipe references a
 * topology link or bus by ID.
 */
export interface SceneLayout {
  sceneRevision: number;
  /** Must equal the topology's configRevision or the scene is not drawn. */
  configRevision: number;
  width: number;
  height: number;
  nodes: Record<string, { kind: SpriteKind; x: number; y: number; flip?: boolean; labelAt?: "below" | "above" | "right" }>;
  /** Header polylines in flow direction, drawn in object order. */
  buses: Record<string, XY[][]>;
  /** Waypoints between a link's ends; device-port ends are added automatically. */
  links: Record<string, XY[]>;
  /** Bypass valves across two buses: pipe route and valve body position. */
  bypasses: Record<string, { points: XY[]; valve: XY; vertical?: boolean }>;
  /** Isolation valves drawn as ring valves at a point on a link. */
  ringValves: Record<string, XY>;
  /** Stubs for ports the topology expects but has no recorded connection for. */
  unconnected: { device: string; port: string; points: XY[] }[];
  sensors: { at: XY; letter: "T" | "P" | "F"; side?: "up" | "down" }[];
  tags: {
    metric: string;
    at: XY;
    kind: MetricKind;
    unit: string;
    decimals?: number;
    label?: string;
    labelGap?: number;
    width?: number;
  }[];
  captions: { at: XY; text: string }[];
}

export interface EquipmentStatus {
  state: OperatingState;
  stale?: boolean;
}

export interface Reading {
  value: number | null;
  quality: Quality;
}

/** Latest equipment states and readings keyed by `deviceId` and `deviceId:metric`. */
export interface SceneReadings {
  equipment: Record<string, EquipmentStatus>;
  values: Record<string, Reading>;
}
