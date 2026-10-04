/**
 * SYNTHETIC demo scenarios. Each is one deterministic demo day for the demo plant in
 * demoPlant.ts. Event times are site-local minutes after midnight.
 */

export type ScenarioId =
  | "normal"
  | "peak"
  | "tower-fault"
  | "pump-trip"
  | "sensor-issues"
  | "disconnected"
  | "scene-mismatch"
  | "new-site";

export interface ScenarioDef {
  id: ScenarioId;
  label: string;
  description: string;
  seed: number;
  /** IT-driven base cooling demand (kWt). */
  itBase: number;
  /** Additional demand per °C of wet bulb above 22 °C (kWt/°C). */
  weatherGain: number;
  wetBulbOffset: number;
  /** Initial playback time, site-local minutes after midnight. */
  defaultMinute: number;
  towerFaultAt?: number;
  /** CHW pump 2 trips; chiller 2 loses flow; standby pump 4 starts; chiller 2 restarts. */
  pumpTrip?: { at: number; standbyAt: number; restartAt: number };
  sensorIssues?: boolean;
  disconnectAt?: number;
  /** Scene drawn for a newer configuration revision than the topology. */
  sceneMismatch?: boolean;
  /** Days of demand history before the demo day (default 7). */
  historyDays?: number;
  issues: ScenarioIssue[];
}

export interface ScenarioIssue {
  id: string;
  title: string;
  severity: "info" | "warning" | "critical";
  equipmentIds: string[];
  /** Site-local minutes. */
  firstSeen: number;
  resolvedAt?: number;
  /** Status while open; becomes "resolved" at resolvedAt. */
  openStatus: "detected" | "investigating" | "correction_proposed" | "monitoring";
  summary: string;
  evidence: string[];
}

const hm = (h: number, m: number) => h * 60 + m;

export const scenarios: ScenarioDef[] = [
  {
    id: "normal",
    label: "Normal operation",
    description: "Two chillers carry a typical data-hall load all day.",
    seed: 11,
    itBase: 840,
    weatherGain: 35,
    wetBulbOffset: 0,
    defaultMinute: hm(15, 15),
    issues: [],
  },
  {
    id: "peak",
    label: "Afternoon peak",
    description: "Higher IT load stages a third chiller in the afternoon.",
    seed: 23,
    itBase: 1150,
    weatherGain: 50,
    wetBulbOffset: 0.6,
    defaultMinute: hm(15, 15),
    issues: [
      {
        id: "ISS-0207",
        title: "Chilled-water ΔT below design",
        severity: "warning",
        equipmentIds: ["chiller_plant_1", "chiller_plant_2", "chiller_plant_3"],
        firstSeen: hm(13, 40),
        openStatus: "monitoring",
        summary: "Return-minus-supply temperature is below the 5 °C design while three chillers run at part load.",
        evidence: ["plant:chw_delta_t_c", "chw_supply:flow_m3h"],
      },
    ],
  },
  {
    id: "tower-fault",
    label: "Cooling tower 4 fan fault",
    description: "Tower 4 trips during the afternoon peak; condenser approach rises.",
    seed: 37,
    itBase: 1150,
    weatherGain: 50,
    wetBulbOffset: 0.8,
    defaultMinute: hm(15, 15),
    towerFaultAt: hm(13, 20),
    issues: [
      {
        id: "ISS-0142",
        title: "Cooling tower 4 fan fault",
        severity: "critical",
        equipmentIds: ["cooling_towers_4"],
        firstSeen: hm(13, 20),
        openStatus: "investigating",
        summary: "Fan stopped with a fault while the plant needs four towers; three towers now reject all condenser heat.",
        evidence: ["cooling_towers_4:frequency_hz", "cooling_towers_4:power_kw"],
      },
      {
        id: "ISS-0143",
        title: "Condenser approach above expected",
        severity: "warning",
        equipmentIds: ["cooling_towers_1", "cooling_towers_2", "cooling_towers_3", "chiller_plant_1"],
        firstSeen: hm(13, 45),
        openStatus: "detected",
        summary: "Tower outlet is further above wet bulb than before the fault; chiller efficiency is falling.",
        evidence: ["plant:approach_c", "cw_supply:temp_c", "plant:cop"],
      },
    ],
  },
  {
    id: "pump-trip",
    label: "CHW pump 2 trip",
    description: "Chilled-water pump 2 trips; the standby pump starts and chiller 2 restarts.",
    seed: 41,
    itBase: 840,
    weatherGain: 35,
    wetBulbOffset: 0.2,
    defaultMinute: hm(14, 12),
    pumpTrip: { at: hm(14, 5), standbyAt: hm(14, 15), restartAt: hm(14, 20) },
    issues: [
      {
        id: "ISS-0151",
        title: "CHW pump 2 tripped",
        severity: "critical",
        equipmentIds: ["chilled_water_pump_pri_2", "chiller_plant_2"],
        firstSeen: hm(14, 5),
        resolvedAt: hm(14, 35),
        openStatus: "investigating",
        summary: "Pump 2 stopped with a fault; chiller 2 lost evaporator flow and stopped.",
        evidence: ["chilled_water_pump_pri_2:frequency_hz", "chiller_plant_2:load_pct"],
      },
      {
        id: "ISS-0152",
        title: "Chilled-water supply temperature high",
        severity: "warning",
        equipmentIds: ["chiller_plant_1"],
        firstSeen: hm(14, 10),
        resolvedAt: hm(14, 35),
        openStatus: "detected",
        summary: "One chiller cannot meet demand; supply temperature is above setpoint and demand is partly unmet.",
        evidence: ["chw_supply:temp_c", "plant:unmet_kw"],
      },
      {
        id: "ISS-0153",
        title: "Standby CHW pump 4 running; suction connection not recorded",
        severity: "info",
        equipmentIds: ["chilled_water_pump_pri_4"],
        firstSeen: hm(14, 15),
        openStatus: "monitoring",
        summary: "The standby pump restored flow to chiller 2. Its suction connection is unknown in the site topology; confirm it during commissioning.",
        evidence: ["chilled_water_pump_pri_4:flow_m3h"],
      },
    ],
  },
  {
    id: "sensor-issues",
    label: "Missing and stale sensors",
    description: "One sensor is unavailable, one value is stale and one pump stopped reporting.",
    seed: 53,
    itBase: 840,
    weatherGain: 35,
    wetBulbOffset: 0,
    defaultMinute: hm(15, 15),
    sensorIssues: true,
    issues: [
      {
        id: "ISS-0161",
        title: "CHW return header pressure unavailable",
        severity: "warning",
        equipmentIds: [],
        firstSeen: hm(0, 0),
        openStatus: "detected",
        summary: "No value has been received from the return-header pressure point today.",
        evidence: ["chw_return:pressure_kpa"],
      },
      {
        id: "ISS-0162",
        title: "No telemetry from CHW pump 3",
        severity: "warning",
        equipmentIds: ["chilled_water_pump_pri_3"],
        firstSeen: hm(9, 0),
        openStatus: "detected",
        summary: "The pump's state and readings stopped arriving; its actual state is unknown.",
        evidence: ["chilled_water_pump_pri_3:frequency_hz"],
      },
      {
        id: "ISS-0163",
        title: "Chiller 2 condenser outlet temperature stale",
        severity: "warning",
        equipmentIds: ["chiller_plant_2"],
        firstSeen: hm(11, 30),
        openStatus: "detected",
        summary: "The value has not changed since 11:30 while neighbouring readings move.",
        evidence: ["chiller_plant_2:cond_out_temp_c"],
      },
    ],
  },
  {
    id: "disconnected",
    label: "Telemetry disconnected",
    description: "The telemetry connection drops at 14:40; the last values are retained.",
    seed: 61,
    itBase: 840,
    weatherGain: 35,
    wetBulbOffset: 0,
    defaultMinute: hm(15, 15),
    disconnectAt: hm(14, 40),
    issues: [
      {
        id: "ISS-0171",
        title: "Telemetry connection lost",
        severity: "critical",
        equipmentIds: [],
        firstSeen: hm(14, 45),
        openStatus: "detected",
        summary: "No samples received after 14:40. Equipment state since then is unknown; the plant has not necessarily stopped.",
        evidence: [],
      },
    ],
  },
  {
    id: "scene-mismatch",
    label: "Scene revision mismatch",
    description: "The scene was drawn for configuration revision 2, but the site runs revision 1.",
    seed: 71,
    itBase: 840,
    weatherGain: 35,
    wetBulbOffset: 0,
    defaultMinute: hm(15, 15),
    sceneMismatch: true,
    issues: [],
  },
];

// Appended so existing scenario order (and defaults) are unchanged.
scenarios.push({
  id: "new-site",
  label: "New site, little history",
  description: "Recently commissioned: only one day of demand history before today.",
  seed: 83,
  itBase: 840,
  weatherGain: 35,
  wetBulbOffset: 0,
  defaultMinute: hm(15, 15),
  historyDays: 1,
  issues: [],
});

export const scenarioById = (id: string) => scenarios.find((s) => s.id === id);
