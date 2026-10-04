/**
 * What each plant indicator's details panel shows. Pure data over the site bundle:
 * which reported readings are its inputs and context, which nameplate values are its
 * design references, and which equipment it relates to. Nothing here computes values.
 */
import type { DeviceFamily, Issue, SiteBundle } from "../../lib/contracts";

export const ISSUES_KPI = "issues";

export const KPI_KEYS = [
  "plant:cooling_demand_kw",
  "plant:cooling_delivered_kw",
  "plant:power_kw",
  "plant:cop",
  "chw_supply:temp_c",
  "plant:chw_delta_t_c",
  "plant:approach_c",
  "weather:wet_bulb_c",
] as const;

/** Questions the assistant can answer about an indicator (scripted demo coverage). */
export const KPI_QUESTIONS: Record<string, string> = {
  issues: "What needs attention right now?",
  "plant:cooling_demand_kw": "Is the plant meeting cooling demand?",
  "plant:cooling_delivered_kw": "Is the plant meeting cooling demand?",
  "plant:cop": "How efficient is the plant right now?",
  "plant:power_kw": "How efficient is the plant right now?",
};

export const isKpiKey = (k: string | null): k is string => k === ISSUES_KPI || (KPI_KEYS as readonly string[]).includes(k ?? "");

export interface EquipmentRef {
  id: string;
  /** Reading shown beside the equipment, e.g. its power for the power breakdown. */
  metric?: string;
}

export interface KpiDef {
  /** Reported inputs of the indicator's definition. */
  inputs: string[];
  /** Further current readings that give context. */
  measurements: string[];
  references: { family: DeviceFamily; labels: string[] }[];
  /** History series; the first is the indicator itself unless `comparison`. */
  trend: string[];
  comparison?: boolean;
  breakdown?: boolean;
  equipment: (site: SiteBundle) => EquipmentRef[];
}

const ofFamily = (site: SiteBundle, family: DeviceFamily, metric?: string): EquipmentRef[] =>
  site.topology.devices.filter((d) => d.family === family).map((d) => ({ id: d.id, metric: metric && `${d.id}:${metric}` }));

const COMPARISON = ["plant:cooling_demand_kw", "plant:cooling_delivered_kw", "plant:available_capacity_kw"];

export const KPI_DEFS: Record<string, KpiDef> = {
  "plant:cooling_demand_kw": {
    inputs: [],
    measurements: ["plant:cooling_demand_kw", "plant:cooling_delivered_kw", "plant:unmet_kw", "plant:available_capacity_kw"],
    references: [{ family: "chiller_plant", labels: ["Cooling capacity"] }],
    trend: COMPARISON,
    comparison: true,
    equipment: (site) => [{ id: "terminal", metric: "terminal:cooling_demand_kw" }, ...ofFamily(site, "chiller_plant", "cooling_kw")],
  },
  "plant:cooling_delivered_kw": {
    inputs: ["chiller_plant_1:cooling_kw", "chiller_plant_2:cooling_kw", "chiller_plant_3:cooling_kw"],
    measurements: ["plant:cooling_demand_kw", "plant:cooling_delivered_kw", "plant:unmet_kw", "plant:available_capacity_kw"],
    references: [{ family: "chiller_plant", labels: ["Cooling capacity"] }],
    trend: COMPARISON,
    comparison: true,
    equipment: (site) => ofFamily(site, "chiller_plant", "cooling_kw"),
  },
  "plant:power_kw": {
    inputs: [],
    measurements: ["plant:power_kw", "plant:cop"],
    references: [],
    trend: ["plant:power_kw"],
    breakdown: true,
    equipment: (site) =>
      site.topology.devices
        .filter((d) => site.metrics.some((m) => m.key === `${d.id}:power_kw`))
        .map((d) => ({ id: d.id, metric: `${d.id}:power_kw` })),
  },
  "plant:cop": {
    inputs: ["plant:cooling_delivered_kw", "plant:power_kw"],
    measurements: [],
    references: [],
    trend: ["plant:cop"],
    equipment: (site) => ofFamily(site, "chiller_plant", "load_pct"),
  },
  "chw_supply:temp_c": {
    inputs: [],
    measurements: ["chw_supply:temp_c", "chw_supply:flow_m3h", "chw_supply:pressure_kpa"],
    references: [{ family: "chiller_plant", labels: ["Design CHW supply"] }],
    trend: ["chw_supply:temp_c"],
    equipment: (site) => ofFamily(site, "chiller_plant", "evap_out_temp_c"),
  },
  "plant:chw_delta_t_c": {
    inputs: ["chw_return:temp_c", "chw_supply:temp_c"],
    measurements: ["chw_supply:flow_m3h"],
    references: [{ family: "chiller_plant", labels: ["Design CHW supply", "Design CHW return"] }],
    trend: ["plant:chw_delta_t_c"],
    equipment: (site) => ofFamily(site, "chilled_water_pump_pri", "flow_m3h"),
  },
  "plant:approach_c": {
    inputs: ["cw_supply:temp_c", "weather:wet_bulb_c"],
    measurements: [],
    references: [{ family: "cooling_towers", labels: ["Design wet bulb"] }],
    trend: ["plant:approach_c"],
    equipment: (site) => ofFamily(site, "cooling_towers", "frequency_hz"),
  },
  "weather:wet_bulb_c": {
    inputs: [],
    measurements: ["weather:wet_bulb_c", "plant:approach_c"],
    references: [{ family: "cooling_towers", labels: ["Design wet bulb"] }],
    trend: ["weather:wet_bulb_c"],
    equipment: (site) => ofFamily(site, "cooling_towers", "frequency_hz"),
  },
};

/** Equipment to highlight on the plant while an indicator's details are open. */
export function kpiEquipment(key: string, site: SiteBundle, issues: Issue[]): string[] {
  if (key === ISSUES_KPI) return [...new Set(issues.filter((i) => i.status !== "resolved").flatMap((i) => i.equipmentIds))];
  return KPI_DEFS[key]?.equipment(site).map((e) => e.id) ?? [];
}
