/**
 * Site topology as the dashboard receives it. Mirrors the semantics of the topology
 * family in PR #2 (`water_cooled_chiller_plant_v1`): devices, headers (buses), one
 * lumped terminal, and explicit links that each carry evidence. Draft frontend shape;
 * the canonical wire schema is still to be agreed with the API owner.
 */

export type Evidence = "confirmed" | "drawing" | "inferred" | "unknown";
export type Medium = "cw" | "chw";

export type DeviceFamily =
  | "chiller_plant"
  | "chilled_water_pump_pri"
  | "cooling_water_pump"
  | "cooling_towers"
  | "terminal";

export interface Device {
  id: string;
  family: DeviceFamily;
  label: string;
  evidence: Evidence;
  role?: "standby";
}

export interface Bus {
  id: string;
  medium: Medium;
}

/** A link end is a device port or a bus. */
export type LinkEnd = { device: string; port: string } | { bus: string };

export interface Link {
  id: string;
  from: LinkEnd;
  to: LinkEnd;
  medium: Medium;
  evidence: Evidence;
  note?: string;
}

export interface Valve {
  id: string;
  /** Bypass valves sit across two buses; isolation valves sit at a device port. */
  across?: [string, string];
  at?: { device: string; port: string };
  evidence: Evidence;
}

export interface Topology {
  schemaVersion: 1;
  /** Site configuration revision this topology belongs to. */
  configRevision: number;
  family: "water_cooled_chiller_plant_v1";
  devices: Device[];
  buses: Bus[];
  links: Link[];
  valves: Valve[];
  /** Ports the family expects but for which no connection is recorded. */
  unconnectedPorts: { device: string; port: string; note: string }[];
}
