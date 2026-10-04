/**
 * Deterministic SYNTHETIC scenario generator for the demo plant.
 *
 * FIXTURE ARITHMETIC, NOT PHYSICS. The relations below only keep the numbers on every
 * screen mutually plausible (load = sum of chiller outputs, chilled-water flow from
 * load and ΔT, condenser heat = load × (1 + 1/COP), staging within the 3 × 700 kW
 * rating). They are not PHYVAC, are not calibrated and say nothing about any site.
 */
import type { MetricInfo, OperatingState, Quality } from "../lib/contracts";
import { demoTopology } from "./demoPlant";
import type { ScenarioDef } from "./scenarios";

export const SITE = { name: "Synthetic demo plant", timezone: "Asia/Shanghai", timezoneLabel: "UTC+8" };
export const STEP_MIN = 5;
export const SAMPLES = 288;
export const HISTORY_DAYS = 7;
export const MINUTE_MS = 60_000;
/** 2026-09-28 00:00 at the site (UTC+8). */
export const DAY_START = Date.UTC(2026, 8, 27, 16, 0, 0);
export const sampleTime = (i: number) => DAY_START + i * STEP_MIN * MINUTE_MS;

const CHILLER_KW = 700;
const TOWER_REJECT_KW = 1160;
const KW_PER_M3H_K = 1.163; // water: 1 m³/h × 1 K ≈ 1.163 kW

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth deterministic noise in [-1, 1] over a continuous sample index. */
function smoothNoise(seed: number) {
  const rnd = mulberry32(seed);
  const waves = Array.from({ length: 4 }, () => ({ f: 0.02 + rnd() * 0.25, p: rnd() * Math.PI * 2, a: 0.3 + rnd() * 0.3 }));
  const total = waves.reduce((s, w) => s + w.a, 0);
  return (x: number) => waves.reduce((s, w) => s + w.a * Math.sin(w.f * x + w.p), 0) / total;
}

/** Weather and demand for day offset `d` (0 = demo day, negative = history), sample `i`. */
export function drivers(def: ScenarioDef) {
  const nWb = smoothNoise(def.seed * 7 + 1);
  const nDem = smoothNoise(def.seed * 7 + 2);
  // Day-to-day variation, blended over the first 3 hours of each day so there is no
  // step at midnight. After 03:00 a day uses its own value unchanged.
  const BLEND = (3 * 60) / STEP_MIN;
  const daily = (f: (d: number) => number, d: number, i: number) =>
    i >= BLEND ? f(d) : f(d - 1) + (f(d) - f(d - 1)) * (i / BLEND);
  const wbDay = (d: number) => 0.8 * Math.sin(2.1 * d);
  const itDay = (d: number) => 0.025 * Math.sin(1.7 * d);
  const wetBulb = (d: number, i: number) => {
    const h = (i * STEP_MIN) / 60;
    return 25.6 + def.wetBulbOffset + daily(wbDay, d, i) + 2.4 * Math.sin((2 * Math.PI * (h - 9)) / 24) + 0.25 * nWb(d * SAMPLES + i);
  };
  const demand = (d: number, i: number) => {
    const h = (i * STEP_MIN) / 60;
    const it = def.itBase * (1 + daily(itDay, d, i)) * (1 + 0.07 * Math.sin((2 * Math.PI * (h - 10)) / 24));
    return it + def.weatherGain * (wetBulb(d, i) - 22) + 0.015 * def.itBase * nDem(d * SAMPLES + i);
  };
  return { wetBulb, demand };
}

export interface MetricSeries {
  values: (number | null)[];
  quality: Quality[];
  /** Sample index whose value a stale reading repeats. */
  staleSince?: number;
}

export interface Dataset {
  def: ScenarioDef;
  states: Record<string, OperatingState[]>;
  /** Equipment whose last state is retained but not current (per sample). */
  stale: Record<string, boolean[]>;
  metrics: Record<string, MetricSeries>;
  /** Index of the last sample received before telemetry disconnected. */
  lastReceivedIndex: number | null;
  /** Required demand (kWt) for HISTORY_DAYS before the demo day and the demo day. */
  demand: { start: number; values: number[] };
}

const n4 = [1, 2, 3, 4];
const n3 = [1, 2, 3];

export function generate(def: ScenarioDef): Dataset {
  const { wetBulb, demand } = drivers(def);
  const nCop = smoothNoise(def.seed * 7 + 3);
  const nT = smoothNoise(def.seed * 7 + 4);
  const metrics: Record<string, MetricSeries> = {};
  const states: Record<string, OperatingState[]> = {};
  const put = (key: string, i: number, v: number | null, decimals = 2) => {
    const m = (metrics[key] ??= { values: new Array(SAMPLES).fill(null), quality: new Array(SAMPLES).fill("good") });
    m.values[i] = v === null ? null : round(v, decimals);
  };
  const setState = (id: string, i: number, s: OperatingState) => {
    (states[id] ??= new Array(SAMPLES).fill("stopped"))[i] = s;
  };

  let staged = 0;
  let up = 0;
  let down = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const minute = i * STEP_MIN;
    const wb = wetBulb(0, i);
    const dem = demand(0, i);

    // Chiller staging with hysteresis: up above 82 % of running capacity, down below 70 %.
    if (staged === 0) staged = clamp(Math.ceil(dem / (0.82 * CHILLER_KW)), 1, 3);
    up = dem > 0.82 * staged * CHILLER_KW && staged < 3 ? up + 1 : 0;
    down = staged > 1 && dem < 0.7 * (staged - 1) * CHILLER_KW ? down + 1 : 0;
    if (up >= 2) (staged++, (up = 0));
    if (down >= 6) (staged--, (down = 0));

    let running = n3.slice(0, staged);
    const chwPumpOf: Record<number, number> = { 1: 1, 2: 2, 3: 3 };
    const pt = def.pumpTrip;
    const pumpTripped = !!pt && minute >= pt.at;
    if (pt && pumpTripped) {
      if (minute < pt.restartAt) running = running.filter((c) => c !== 2);
      chwPumpOf[2] = 4;
    }
    const standbyRunning = !!pt && minute >= pt.standbyAt && staged >= 2;

    const delivered = Math.min(dem, running.length * CHILLER_KW);
    const unmet = dem - delivered;
    const shortfall = unmet / dem;

    const towerFaulted = def.towerFaultAt !== undefined && minute >= def.towerFaultAt;
    const available = n4.filter((t) => !(towerFaulted && t === 4));
    const towersOn = available.slice(0, clamp(running.length + 1, 1, available.length));

    // Condenser side: iterate COP <-> tower outlet temperature a few times.
    const qEach = running.length ? delivered / running.length : 0;
    const lf = qEach / CHILLER_KW;
    let cwIn = wb + 3.5;
    let cop = 6;
    let loading = 0;
    for (let k = 0; k < 3; k++) {
      cop = 6.4 - 3 * (lf - 0.8) ** 2 - 0.13 * (cwIn - 29.5) + 0.05 * nCop(i);
      const qRej = running.length * qEach * (1 + 1 / cop);
      loading = qRej / (towersOn.length * TOWER_REJECT_KW);
      cwIn = wb + 2 + 5.5 * loading ** 1.3;
    }
    const towerHz = clamp(28 + 40 * loading, 25, 50);
    const chillerKw = qEach / cop;

    // Chilled-water side.
    const chwHz = clamp(34 + 16 * lf, 30, 50);
    const chwFlowEach = (110 * chwHz) / 50;
    const flow = running.length * chwFlowEach;
    const supply = 7 + 0.2 * (lf - 0.75) + 0.04 * nT(i) + 6 * shortfall;
    const ret = supply + (flow > 0 ? delivered / (flow * KW_PER_M3H_K) : 0) + 3 * shortfall;
    const cwHz = 45 + 0.2 * nT(i + 40);
    const cwFlowEach = (139.5 * cwHz) / 45;
    const condRise = (qEach * (1 + 1 / cop)) / (cwFlowEach * KW_PER_M3H_K);

    let plantKw = 0;
    for (const c of n3) {
      const id = `chiller_plant_${c}`;
      const on = running.includes(c);
      setState(id, i, on ? "running" : "stopped");
      put(`${id}:load_pct`, i, on ? lf * 100 : 0, 0);
      put(`${id}:cooling_kw`, i, on ? qEach : 0, 0);
      put(`${id}:power_kw`, i, on ? chillerKw : 0.4, 1);
      plantKw += on ? chillerKw : 0.4;
      put(`${id}:cond_in_temp_c`, i, on ? cwIn : cwIn - 0.6, 1);
      put(`${id}:cond_out_temp_c`, i, on ? cwIn + condRise : cwIn - 0.5, 1);
      put(`${id}:evap_out_temp_c`, i, on ? supply + 0.05 * (c - 2) : 13.6 + 0.3 * nT(i + c * 9), 1);
      put(`${id}:evap_in_temp_c`, i, on ? ret : 13.7 + 0.3 * nT(i + c * 9), 1);

      const cwp = `cooling_water_pump_${c}`;
      setState(cwp, i, on ? "running" : "stopped");
      put(`${cwp}:frequency_hz`, i, on ? cwHz : 0, 1);
      put(`${cwp}:power_kw`, i, on ? 22 * (cwHz / 50) ** 3 * 0.9 : 0, 1);
      put(`${cwp}:flow_m3h`, i, on ? cwFlowEach : 0, 0);
      plantKw += on ? 22 * (cwHz / 50) ** 3 * 0.9 : 0;
    }
    setState("cooling_water_pump_4", i, "stopped");
    put("cooling_water_pump_4:frequency_hz", i, 0, 1);
    put("cooling_water_pump_4:power_kw", i, 0, 1);
    put("cooling_water_pump_4:flow_m3h", i, 0, 0);

    for (const p of n4) {
      const id = `chilled_water_pump_pri_${p}`;
      const servedChiller = Object.entries(chwPumpOf).find(([, pump]) => pump === p)?.[0];
      let on = servedChiller !== undefined && running.includes(Number(servedChiller));
      let hz = chwHz;
      if (p === 4 && standbyRunning) (on = true), (hz = running.includes(2) ? chwHz : 35);
      const state: OperatingState = p === 2 && pumpTripped ? "fault" : on ? "running" : "stopped";
      setState(id, i, state);
      put(`${id}:frequency_hz`, i, state === "running" ? hz : 0, 1);
      const kw = state === "running" ? 15 * (hz / 50) ** 3 * 0.92 : 0;
      put(`${id}:power_kw`, i, kw, 1);
      put(`${id}:flow_m3h`, i, state === "running" ? (110 * hz) / 50 : 0, 0);
      plantKw += kw;
    }

    for (const t of n4) {
      const id = `cooling_towers_${t}`;
      const on = towersOn.includes(t);
      setState(id, i, towerFaulted && t === 4 ? "fault" : on ? "running" : "stopped");
      put(`${id}:frequency_hz`, i, on ? towerHz : 0, 1);
      put(`${id}:power_kw`, i, on ? 5.5 * (towerHz / 50) ** 3 : 0, 2);
      put(`${id}:water_out_temp_c`, i, on ? cwIn : wb + 1.5, 1);
      plantKw += on ? 5.5 * (towerHz / 50) ** 3 : 0;
    }

    setState("terminal", i, "running");
    put("terminal:cooling_demand_kw", i, dem, 0);
    put("terminal:cooling_delivered_kw", i, delivered, 0);

    put("cw_supply:temp_c", i, cwIn, 1);
    put("cw_return:temp_c", i, running.length ? cwIn + condRise : cwIn, 1);
    put("chw_supply:temp_c", i, supply, 1);
    put("chw_supply:pressure_kpa", i, 300 + 0.0045 * flow ** 2, 1);
    put("chw_supply:flow_m3h", i, flow, 1);
    put("chw_return:temp_c", i, ret, 1);
    put("chw_return:pressure_kpa", i, 170 + 0.0012 * flow ** 2, 1);

    put("plant:cooling_demand_kw", i, dem, 0);
    put("plant:cooling_delivered_kw", i, delivered, 0);
    put("plant:unmet_kw", i, unmet, 0);
    // Rated capacity of the chillers actually running (nameplate x count), not installed capacity.
    put("plant:available_capacity_kw", i, running.length * CHILLER_KW, 0);
    put("plant:power_kw", i, plantKw, 1);
    put("plant:cop", i, delivered / plantKw, 2);
    put("plant:chw_delta_t_c", i, ret - supply, 2);
    put("plant:approach_c", i, cwIn - wb, 2);
    put("weather:wet_bulb_c", i, wb, 1);
  }

  const stale: Record<string, boolean[]> = {};
  const freeze = (key: string, from: number) => {
    const m = metrics[key];
    for (let i = from + 1; i < SAMPLES; i++) (m.values[i] = m.values[from]), (m.quality[i] = "stale");
    m.staleSince = from;
  };
  const blank = (key: string, from: number) => {
    for (let i = from; i < SAMPLES; i++) (metrics[key].values[i] = null), (metrics[key].quality[i] = "unavailable");
  };

  if (def.sensorIssues) {
    blank("chw_return:pressure_kpa", 0);
    freeze("chiller_plant_2:cond_out_temp_c", (11 * 60 + 30) / STEP_MIN);
    const from = (9 * 60) / STEP_MIN;
    for (let i = from; i < SAMPLES; i++) states.chilled_water_pump_pri_3[i] = "unavailable";
    for (const m of ["frequency_hz", "power_kw", "flow_m3h"]) blank(`chilled_water_pump_pri_3:${m}`, from);
  }

  let lastReceivedIndex: number | null = null;
  if (def.disconnectAt !== undefined) {
    lastReceivedIndex = def.disconnectAt / STEP_MIN;
    for (const key of Object.keys(metrics)) freeze(key, lastReceivedIndex);
    for (const id of Object.keys(states)) {
      stale[id] = states[id].map((_, i) => i > lastReceivedIndex!);
      for (let i = lastReceivedIndex + 1; i < SAMPLES; i++) states[id][i] = states[id][lastReceivedIndex];
    }
  }

  const historyDays = def.historyDays ?? HISTORY_DAYS;
  const values: number[] = [];
  for (let d = -historyDays; d <= 0; d++) for (let i = 0; i < SAMPLES; i++) values.push(round(demand(d, i), 1));

  return {
    def,
    states,
    stale,
    metrics,
    lastReceivedIndex,
    demand: { start: DAY_START - historyDays * SAMPLES * STEP_MIN * MINUTE_MS, values },
  };
}

const DEVICE_METRICS: Record<string, [string, string, string, number][]> = {
  chiller_plant: [
    ["load_pct", "Load", "%", 0],
    ["cooling_kw", "Cooling output", "kWt", 0],
    ["power_kw", "Electrical power", "kW", 1],
    ["cond_in_temp_c", "Condenser water in", "°C", 1],
    ["cond_out_temp_c", "Condenser water out", "°C", 1],
    ["evap_out_temp_c", "Chilled water out", "°C", 1],
    ["evap_in_temp_c", "Chilled water in", "°C", 1],
  ],
  cooling_water_pump: [
    ["frequency_hz", "Frequency", "Hz", 1],
    ["power_kw", "Electrical power", "kW", 1],
    ["flow_m3h", "Flow", "m³/h", 0],
  ],
  chilled_water_pump_pri: [
    ["frequency_hz", "Frequency", "Hz", 1],
    ["power_kw", "Electrical power", "kW", 1],
    ["flow_m3h", "Flow", "m³/h", 0],
  ],
  cooling_towers: [
    ["frequency_hz", "Fan frequency", "Hz", 1],
    ["power_kw", "Fan power", "kW", 2],
    ["water_out_temp_c", "Water out", "°C", 1],
  ],
  terminal: [
    ["cooling_demand_kw", "Cooling demand", "kWt", 0],
    ["cooling_delivered_kw", "Cooling delivered", "kWt", 0],
  ],
};

/** Metric catalogue: labels, units (kWt = thermal, kW = electrical) and precision. */
export const metricCatalog: MetricInfo[] = [
  ...demoTopology.devices.flatMap((d) =>
    (DEVICE_METRICS[d.family] ?? []).map(([m, label, unit, decimals]) => ({ key: `${d.id}:${m}`, label, unit, decimals })),
  ),
  { key: "cw_supply:temp_c", label: "CW supply temperature", unit: "°C", decimals: 1 },
  { key: "cw_return:temp_c", label: "CW return temperature", unit: "°C", decimals: 1 },
  { key: "chw_supply:temp_c", label: "CHW supply temperature", unit: "°C", decimals: 1 },
  { key: "chw_supply:pressure_kpa", label: "CHW supply pressure", unit: "kPa", decimals: 1 },
  { key: "chw_supply:flow_m3h", label: "CHW supply flow", unit: "m³/h", decimals: 1 },
  { key: "chw_return:temp_c", label: "CHW return temperature", unit: "°C", decimals: 1 },
  { key: "chw_return:pressure_kpa", label: "CHW return pressure", unit: "kPa", decimals: 1 },
  { key: "plant:cooling_demand_kw", label: "Cooling demand", unit: "kWt", decimals: 0 },
  { key: "plant:cooling_delivered_kw", label: "Cooling delivered", unit: "kWt", decimals: 0 },
  { key: "plant:unmet_kw", label: "Unmet demand", unit: "kWt", decimals: 0 },
  { key: "plant:available_capacity_kw", label: "Running chiller capacity", unit: "kWt", decimals: 0 },
  { key: "plant:power_kw", label: "Plant electrical power", unit: "kW", decimals: 1 },
  { key: "plant:cop", label: "System COP", unit: "", decimals: 2 },
  { key: "plant:chw_delta_t_c", label: "CHW ΔT", unit: "°C", decimals: 1 },
  { key: "plant:approach_c", label: "Condenser approach", unit: "°C", decimals: 1 },
  { key: "weather:wet_bulb_c", label: "Wet bulb", unit: "°C", decimals: 1 },
];

/** Index of the sample at or before `atMs`, clamped to the demo day. */
export const sampleIndexAt = (atMs: number) => clamp(Math.floor((atMs - DAY_START) / (STEP_MIN * MINUTE_MS)), 0, SAMPLES - 1);
