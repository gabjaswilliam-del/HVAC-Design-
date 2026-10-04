/**
 * SYNTHETIC DEMONSTRATION PLANT. Not a customer site, not derived from the reference
 * screenshot's site, and not assembled or simulated by PHYVAC.
 *
 * The topology follows the documented `water_cooled_chiller_plant_v1` family and the
 * evidence conventions of PR #2's sanitized example: pump-to-chiller pairings are
 * positional and therefore `inferred`, the standby condenser-water pump's discharge is
 * `unknown`, and the standby chilled-water pump's suction is not recorded. Counts
 * (3 chillers, 4 towers, 4 + 4 pumps) are a demonstration choice the family permits.
 */
import type { Device, Link, SceneLayout, Topology } from "../lib/contracts";

type Valve = Topology["valves"][number];

const n4 = [1, 2, 3, 4];
const n3 = [1, 2, 3];
const tower = (i: number) => `cooling_towers_${i}`;
const chiller = (i: number) => `chiller_plant_${i}`;
const cwp = (i: number) => `cooling_water_pump_${i}`;
const chwp = (i: number) => `chilled_water_pump_pri_${i}`;

// Synthetic nameplate/design values, rounded; consistent with PR #2's sanitized example.
const NAMEPLATE = {
  tower: [
    { label: "Design heat rejection", value: 1160, unit: "kWt" },
    { label: "Design water flow", value: 200, unit: "m³/h" },
    { label: "Design wet bulb", value: 28, unit: "°C" },
    { label: "Fan motor", value: 5.5, unit: "kW" },
  ],
  chiller: [
    { label: "Cooling capacity", value: 700, unit: "kWt" },
    { label: "Design CHW supply", value: 7, unit: "°C" },
    { label: "Design CHW return", value: 12, unit: "°C" },
    { label: "Design CHW flow", value: 120, unit: "m³/h" },
    { label: "Design CW flow", value: 150, unit: "m³/h" },
  ],
  cwPump: [
    { label: "Rated flow", value: 155, unit: "m³/h" },
    { label: "Motor", value: 22, unit: "kW" },
  ],
  chwPump: [
    { label: "Rated flow", value: 110, unit: "m³/h" },
    { label: "Motor", value: 15, unit: "kW" },
  ],
};

const devices: Device[] = [
  ...n4.map((i): Device => ({ id: tower(i), family: "cooling_towers", label: `Cooling tower ${i}`, evidence: "confirmed", nameplate: NAMEPLATE.tower })),
  ...n3.map((i): Device => ({ id: chiller(i), family: "chiller_plant", label: `Chiller ${i}`, evidence: "confirmed", nameplate: NAMEPLATE.chiller })),
  ...n4.map(
    (i): Device => ({
      id: cwp(i),
      family: "cooling_water_pump",
      label: `CW pump ${i}`,
      evidence: "confirmed",
      nameplate: NAMEPLATE.cwPump,
      ...(i === 4 ? { role: "standby" as const } : {}),
    }),
  ),
  ...n4.map(
    (i): Device => ({
      id: chwp(i),
      family: "chilled_water_pump_pri",
      label: `CHW pump ${i}`,
      evidence: "confirmed",
      nameplate: NAMEPLATE.chwPump,
      ...(i === 4 ? { role: "standby" as const } : {}),
    }),
  ),
  { id: "terminal", family: "terminal", label: "Data hall", evidence: "confirmed", nameplate: [] },
];

const port = (device: string, p: string) => ({ device, port: p });
const bus = (id: string) => ({ bus: id });

const links: Link[] = [
  // Condenser loop
  ...n4.map((i): Link => ({ id: `${tower(i)}_out`, from: port(tower(i), "water_out"), to: bus("cw_supply"), medium: "cw", evidence: "confirmed" })),
  ...n4.map((i): Link => ({ id: `cw_return_${tower(i)}`, from: bus("cw_return"), to: port(tower(i), "water_in"), medium: "cw", evidence: "confirmed" })),
  ...n4.map((i): Link => ({ id: `cw_supply_${cwp(i)}`, from: bus("cw_supply"), to: port(cwp(i), "suction"), medium: "cw", evidence: "confirmed" })),
  ...n3.map(
    (i): Link => ({
      id: `${cwp(i)}_${chiller(i)}`,
      from: port(cwp(i), "discharge"),
      to: port(chiller(i), "cond_in"),
      medium: "cw",
      evidence: "inferred",
      note: "positional pairing; headered arrangement not ruled out",
    }),
  ),
  {
    id: `${cwp(4)}_cw_supply`,
    from: port(cwp(4), "discharge"),
    to: bus("cw_supply"),
    medium: "cw",
    evidence: "unknown",
    note: "standby pump; which chiller it backs is not recorded",
  },
  ...n3.map((i): Link => ({ id: `${chiller(i)}_cw_return`, from: port(chiller(i), "cond_out"), to: bus("cw_return"), medium: "cw", evidence: "confirmed" })),

  // Chilled-water loop
  ...n3.map((i): Link => ({ id: `${chiller(i)}_${chwp(i)}`, from: port(chiller(i), "evap_out"), to: port(chwp(i), "suction"), medium: "chw", evidence: "inferred" })),
  ...n4.map((i): Link => ({ id: `${chwp(i)}_chw_supply`, from: port(chwp(i), "discharge"), to: bus("chw_supply"), medium: "chw", evidence: "confirmed" })),
  { id: "chw_supply_terminal", from: bus("chw_supply"), to: port("terminal", "water_in"), medium: "chw", evidence: "confirmed" },
  { id: "terminal_chw_return", from: port("terminal", "water_out"), to: bus("chw_return"), medium: "chw", evidence: "confirmed" },
  ...n3.map((i): Link => ({ id: `chw_return_${chiller(i)}`, from: bus("chw_return"), to: port(chiller(i), "evap_in"), medium: "chw", evidence: "confirmed" })),
];

const valves: Valve[] = [
  { id: "cw_bypass", across: ["cw_return", "cw_supply"], evidence: "confirmed" },
  { id: "chw_bypass", across: ["chw_supply", "chw_return"], evidence: "confirmed" },
  { id: "terminal_valve", at: port("terminal", "water_in"), evidence: "confirmed" },
  ...n3.flatMap((i): Valve[] => [
    { id: `${chiller(i)}_chw`, at: port(chiller(i), "evap_out"), evidence: "drawing" },
    { id: `${chiller(i)}_cw`, at: port(chiller(i), "cond_in"), evidence: "drawing" },
  ]),
  ...n4.map((i): Valve => ({ id: `${tower(i)}_cw`, at: port(tower(i), "water_in"), evidence: "drawing" })),
];

export const demoTopology: Topology = {
  schemaVersion: 1,
  configRevision: 1,
  family: "water_cooled_chiller_plant_v1",
  devices,
  buses: [
    { id: "cw_supply", medium: "cw", label: "Condenser-water supply header" },
    { id: "cw_return", medium: "cw", label: "Condenser-water return header" },
    { id: "chw_supply", medium: "chw", label: "Chilled-water supply header" },
    { id: "chw_return", medium: "chw", label: "Chilled-water return header" },
  ],
  links,
  valves,
  unconnectedPorts: [{ device: chwp(4), port: "suction", note: "standby pump suction connection is not recorded" }],
};

// ---------------------------------------------------------------------------------
// Presentation: scene layout for configRevision 1.
// ---------------------------------------------------------------------------------

const TOWER_X = [80, 262, 472, 662];
const TOWER_Y = 82;
const towerInX = (i: number) => TOWER_X[i - 1] + 37;
const CHILLER_X = 560;
const CHILLER_Y = [300, 480, 660];
const condIn = (i: number) => CHILLER_Y[i - 1] + 62;
const condOut = (i: number) => CHILLER_Y[i - 1] + 92;
const CWP_X = 250;
const CWP_TOP = [384, 564, 744, 864];
const CHWP_X = 880;
const CHWP_TOP = [331, 511, 691, 811];
const TERMINAL = { x: 1180, y: 60 };

const CW_SUPPLY_Y = 228;
const CW_RETURN_Y = 40;
const CW_SUPPLY_RISER = 190;
const CW_RETURN_RISER = 458;
const CHW_RETURN_RISER = 820;
const CHW_SUPPLY_RISER = 1080;

type XY = [number, number];
const record = <T,>(entries: [string, T][]) => Object.fromEntries(entries) as Record<string, T>;

export const demoScene: SceneLayout = {
  sceneRevision: 1,
  configRevision: 1,
  width: 1460,
  height: 960,
  nodes: {
    ...record(n4.map((i) => [tower(i), { kind: "coolingTower" as const, x: TOWER_X[i - 1], y: TOWER_Y, labelAt: "right" as const }])),
    ...record(n3.map((i) => [chiller(i), { kind: "chiller" as const, x: CHILLER_X, y: CHILLER_Y[i - 1] }])),
    ...record(n4.map((i) => [cwp(i), { kind: "pump" as const, x: CWP_X, y: CWP_TOP[i - 1], flip: true }])),
    ...record(n4.map((i) => [chwp(i), { kind: "pump" as const, x: CHWP_X, y: CHWP_TOP[i - 1], flip: true }])),
    terminal: { kind: "dataHall", x: TERMINAL.x, y: TERMINAL.y },
  },
  buses: {
    cw_supply: [
      [[60, CW_SUPPLY_Y], [CW_SUPPLY_RISER, CW_SUPPLY_Y]],
      [[towerInX(4), CW_SUPPLY_Y], [CW_SUPPLY_RISER, CW_SUPPLY_Y]],
      [[CW_SUPPLY_RISER, CW_SUPPLY_Y], [CW_SUPPLY_RISER, CWP_TOP[3] + 31]],
    ],
    cw_return: [
      [[CW_RETURN_RISER, condOut(3)], [CW_RETURN_RISER, CW_RETURN_Y]],
      [[CW_RETURN_RISER, CW_RETURN_Y], [60, CW_RETURN_Y]],
      [[CW_RETURN_RISER, CW_RETURN_Y], [towerInX(4), CW_RETURN_Y]],
    ],
    chw_supply: [[[CHW_SUPPLY_RISER, CHWP_TOP[3] - 14], [CHW_SUPPLY_RISER, TERMINAL.y + 98]]],
    chw_return: [[[1120, TERMINAL.y + 124], [CHW_RETURN_RISER, TERMINAL.y + 124], [CHW_RETURN_RISER, condOut(3)]]],
  },
  links: {
    ...record(n4.map((i): [string, XY[]] => [`${tower(i)}_out`, [[towerInX(i), CW_SUPPLY_Y]]])),
    ...record(n4.map((i): [string, XY[]] => [`cw_return_${tower(i)}`, [[towerInX(i), CW_RETURN_Y]]])),
    ...record(n4.map((i): [string, XY[]] => [`cw_supply_${cwp(i)}`, [[CW_SUPPLY_RISER, CWP_TOP[i - 1] + 31]]])),
    ...record(n3.map((i): [string, XY[]] => [`${cwp(i)}_${chiller(i)}`, [[CWP_X + 19.5, condIn(i)]]])),
    [`${cwp(4)}_cw_supply`]: [[CWP_X + 19.5, CWP_TOP[3] - 26]],
    ...record(n3.map((i): [string, XY[]] => [`${chiller(i)}_cw_return`, [[CW_RETURN_RISER, condOut(i)]]])),
    ...record(n3.map((i): [string, XY[]] => [`${chiller(i)}_${chwp(i)}`, []])),
    ...record(
      n4.map((i): [string, XY[]] => [
        `${chwp(i)}_chw_supply`,
        [
          [CHWP_X + 19.5, CHWP_TOP[i - 1] - 14],
          [CHW_SUPPLY_RISER, CHWP_TOP[i - 1] - 14],
        ],
      ]),
    ),
    chw_supply_terminal: [[CHW_SUPPLY_RISER, TERMINAL.y + 98]],
    terminal_chw_return: [[1120, TERMINAL.y + 124]],
    ...record(n3.map((i): [string, XY[]] => [`chw_return_${chiller(i)}`, [[CHW_RETURN_RISER, condOut(i)]]])),
  },
  bypasses: {
    cw_bypass: { points: [[60, CW_RETURN_Y], [60, CW_SUPPLY_Y]], valve: [60, 134], vertical: true },
    chw_bypass: {
      points: [[CHW_SUPPLY_RISER, 270], [1020, 270], [1020, TERMINAL.y + 124]],
      valve: [1020, 227],
      vertical: true,
    },
  },
  ringValves: {
    ...record(n4.map((i): [string, XY] => [`${tower(i)}_cw`, [towerInX(i), 61]])),
    ...record(n3.map((i): [string, XY] => [`${chiller(i)}_cw`, [546, condIn(i)]])),
    ...record(n3.map((i): [string, XY] => [`${chiller(i)}_chw`, [754, condIn(i)]])),
    terminal_valve: [1166, TERMINAL.y + 98],
  },
  unconnected: [{ device: chwp(4), port: "suction", points: [[CHWP_X, CHWP_TOP[3] + 31], [846, CHWP_TOP[3] + 31]] }],
  sensors: [
    { at: [360, CW_SUPPLY_Y], letter: "T", side: "down" },
    { at: [600, CW_RETURN_Y], letter: "T", side: "up" },
    { at: [1100, TERMINAL.y + 98], letter: "T", side: "up" },
    { at: [1122, TERMINAL.y + 98], letter: "P", side: "up" },
    { at: [1144, TERMINAL.y + 98], letter: "F", side: "up" },
    { at: [1166, TERMINAL.y + 124], letter: "T", side: "down" },
    { at: [1144, TERMINAL.y + 124], letter: "P", side: "down" },
  ],
  tags: [
    ...n4.flatMap((i) => [
      { metric: `${tower(i)}:frequency_hz`, at: [TOWER_X[i - 1] + 84, 96] as XY, kind: "frequency" as const, unit: "Hz", width: 52 },
      { metric: `${tower(i)}:power_kw`, at: [TOWER_X[i - 1] + 84, 122] as XY, kind: "power" as const, unit: "kW", decimals: 2, width: 52 },
    ]),
    ...n4.flatMap((i) => [
      { metric: `${cwp(i)}:frequency_hz`, at: [344, CWP_TOP[i - 1] + 2] as XY, kind: "frequency" as const, unit: "Hz", width: 52 },
      { metric: `${cwp(i)}:power_kw`, at: [344, CWP_TOP[i - 1] + 28] as XY, kind: "power" as const, unit: "kW", width: 52 },
    ]),
    ...n4.flatMap((i) => [
      { metric: `${chwp(i)}:frequency_hz`, at: [974, CHWP_TOP[i - 1] + 2] as XY, kind: "frequency" as const, unit: "Hz", width: 52 },
      { metric: `${chwp(i)}:power_kw`, at: [974, CHWP_TOP[i - 1] + 28] as XY, kind: "power" as const, unit: "kW", width: 52 },
    ]),
    ...n3.flatMap((i) => [
      { metric: `${chiller(i)}:load_pct`, at: [578, CHILLER_Y[i - 1] - 30] as XY, kind: "neutral" as const, unit: "%", decimals: 0, width: 46 },
      { metric: `${chiller(i)}:power_kw`, at: [654, CHILLER_Y[i - 1] - 30] as XY, kind: "power" as const, unit: "kW", width: 58 },
      { metric: `${chiller(i)}:cond_in_temp_c`, at: [466, condIn(i) - 34] as XY, kind: "temperature" as const, unit: "°C", width: 46 },
      { metric: `${chiller(i)}:cond_out_temp_c`, at: [466, condOut(i) + 8] as XY, kind: "temperature" as const, unit: "°C", width: 46 },
      { metric: `${chiller(i)}:evap_out_temp_c`, at: [748, condIn(i) - 34] as XY, kind: "temperature" as const, unit: "°C", width: 44 },
      { metric: `${chiller(i)}:evap_in_temp_c`, at: [748, condOut(i) + 8] as XY, kind: "temperature" as const, unit: "°C", width: 44 },
    ]),
    { metric: "cw_supply:temp_c", at: [376, 236], kind: "temperature", unit: "°C", label: "CW supply", labelGap: 28, width: 50 },
    { metric: "cw_return:temp_c", at: [616, 12], kind: "temperature", unit: "°C", label: "CW return", labelGap: 28, width: 50 },
    { metric: "terminal:cooling_demand_kw", at: [1300, 284], kind: "neutral", unit: "kWt", decimals: 0, label: "Cooling demand", width: 64 },
    { metric: "chw_supply:temp_c", at: [1300, 362], kind: "temperature", unit: "°C", label: "Temperature", width: 64 },
    { metric: "chw_supply:pressure_kpa", at: [1300, 390], kind: "hydraulic", unit: "kPa", label: "Pressure", width: 64 },
    { metric: "chw_supply:flow_m3h", at: [1300, 418], kind: "hydraulic", unit: "m³/h", label: "Flow", width: 64 },
    { metric: "chw_return:temp_c", at: [1300, 476], kind: "temperature", unit: "°C", label: "Temperature", width: 64 },
    { metric: "chw_return:pressure_kpa", at: [1300, 504], kind: "hydraulic", unit: "kPa", label: "Pressure", width: 64 },
  ],
  captions: [
    { at: [1180, 346], text: "Chilled-water supply header" },
    { at: [1180, 460], text: "Chilled-water return header" },
  ],
};
