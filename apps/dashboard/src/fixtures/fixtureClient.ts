/**
 * Demo fixture adapter for the DataClient interface. Serves the SYNTHETIC scenario
 * data with realistic latency, cancellation, wire round-tripping and boundary
 * validation, plus explicit failure injection for error-state demonstrations. It is
 * only used when the demo data mode is selected; it is never a fallback for a failed
 * real backend.
 */
import { ApiError, validate, type DataClient, type RequestOptions } from "../lib/api/client";
import {
  demandHistory,
  forecastCapabilities,
  forecastResult,
  history,
  issueList,
  siteBundle,
  snapshot,
  type Issue,
  type Quality,
  type Reading,
} from "../lib/contracts";
import { demoScene, demoTopology } from "./demoPlant";
import { DAY_MS, HORIZONS, MIN_HISTORY_DAYS, parseForecastId, seasonalBaselineForecast, STEPS } from "./forecast";
import {
  DAY_START,
  MINUTE_MS,
  SITE,
  STEP_MIN,
  generate,
  metricCatalog,
  sampleIndexAt,
  sampleTime,
  type Dataset,
} from "./generate";
import { scenarioById, type ScenarioDef } from "./scenarios";

export type FixtureOp = "site" | "snapshot" | "history" | "issues" | "forecast" | "demand" | "capabilities";
export type FailureKind = "timeout" | "unavailable" | "denied" | "malformed";

export interface FixtureOptions {
  latencyMs?: number;
  failures?: Partial<Record<FixtureOp, FailureKind>>;
}

const iso = (ms: number) => new Date(ms).toISOString();
const SOURCE = { kind: "telemetry" as const };
const datasets = new Map<string, Dataset>();
const dataset = (def: ScenarioDef) => {
  if (!datasets.has(def.id)) datasets.set(def.id, generate(def));
  return datasets.get(def.id)!;
};

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const aborted = () => reject(new ApiError("ABORTED", "Request cancelled", false));
    if (signal?.aborted) return aborted();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), aborted()), { once: true });
  });
}

const FAILURES: Record<FailureKind, () => ApiError> = {
  timeout: () => new ApiError("TIMEOUT", "The local API did not answer in time.", true),
  unavailable: () => new ApiError("UNAVAILABLE", "The local service is not available.", true),
  denied: () => new ApiError("PERMISSION_DENIED", "Your account is not allowed to read this data.", false),
  malformed: () => new ApiError("MALFORMED_RESPONSE", "malformed", false),
};

export function createFixtureClient(scenarioId: string, options: FixtureOptions = {}): DataClient {
  const def = scenarioById(scenarioId);
  if (!def) throw new Error(`Unknown demo scenario ${scenarioId}`);
  const ds = dataset(def);
  const latency = options.latencyMs ?? 160;

  async function serve<T>(op: FixtureOp, o: RequestOptions | undefined, schema: Parameters<typeof validate<T>>[0], build: () => unknown): Promise<T> {
    await delay(latency, o?.signal);
    const failure = options.failures?.[op];
    // A malformed payload goes through validation like any other response.
    if (failure && failure !== "malformed") throw FAILURES[failure]();
    const wire = JSON.parse(JSON.stringify(failure === "malformed" ? { schemaVersion: 99 } : build()));
    return validate(schema, wire, op);
  }

  const readingAt = (key: string, i: number): Reading => {
    const m = ds.metrics[key];
    const quality: Quality = m.quality[i];
    const sampledAt = quality === "stale" ? m.staleSince! : i;
    return { value: m.values[i], quality, sampleTime: quality === "unavailable" ? null : iso(sampleTime(sampledAt)) };
  };
  const lastReceived = (i: number) => (ds.lastReceivedIndex !== null && i > ds.lastReceivedIndex ? ds.lastReceivedIndex : i);
  const forecastAt = (asOf: number, horizonMinutes: number, stepMinutes: number) =>
    seasonalBaselineForecast(
      { start: ds.demand.start, values: ds.demand.values },
      {
        scenarioId: def.id,
        source: SOURCE,
        configRevision: demoTopology.configRevision,
        asOf,
        latestInputAt: Math.min(asOf, sampleTime(lastReceived(sampleIndexAt(asOf)))),
        horizonMinutes,
        stepMinutes,
      },
    );

  return {
    mode: "demo",

    getSite: (o) =>
      serve("site", o, siteBundle, () => ({
        site: SITE,
        topology: demoTopology,
        scene: def.sceneMismatch ? { ...demoScene, sceneRevision: 2, configRevision: 2 } : demoScene,
        metrics: metricCatalog,
      })),

    getSnapshot: ({ at }, o) =>
      serve("snapshot", o, snapshot, () => {
        const atMs = Date.parse(at);
        const i = sampleIndexAt(atMs);
        const recv = lastReceived(i);
        const entries = Object.keys(ds.metrics).map((k) => [k, readingAt(k, i)] as const);
        return {
          schemaVersion: 1,
          source: SOURCE,
          configRevision: demoTopology.configRevision,
          at,
          latestSampleAt: atMs < DAY_START ? null : iso(sampleTime(recv)),
          connection: recv < i ? "disconnected" : "connected",
          equipment: Object.fromEntries(
            Object.entries(ds.states).map(([id, s]) => [
              id,
              {
                state: s[i],
                stale: ds.stale[id]?.[i] || undefined,
                sampleTime: s[i] === "unavailable" ? null : iso(sampleTime(recv)),
              },
            ]),
          ),
          values: Object.fromEntries(entries.filter(([k]) => !/^(plant|weather):/.test(k))),
          kpis: Object.fromEntries(entries.filter(([k]) => /^(plant|weather):/.test(k))),
        };
      }),

    getHistory: ({ metrics, from, to }, o) =>
      serve("history", o, history, () => {
        const a = sampleIndexAt(Date.parse(from));
        const b = sampleIndexAt(Date.parse(to));
        const times = Array.from({ length: b - a + 1 }, (_, k) => iso(sampleTime(a + k)));
        return {
          schemaVersion: 1,
          configRevision: demoTopology.configRevision,
          from,
          to,
          times,
          series: metrics
            .filter((m) => ds.metrics[m])
            .map((m) => ({
              metric: m,
              unit: metricCatalog.find((c) => c.key === m)?.unit ?? "",
              values: ds.metrics[m].values.slice(a, b + 1),
              quality: ds.metrics[m].quality.slice(a, b + 1),
            })),
        };
      }),

    getIssues: ({ at }, o) =>
      serve("issues", o, issueList, () => {
        const minute = (Date.parse(at) - DAY_START) / MINUTE_MS;
        const issues: Issue[] = def.issues
          .filter((x) => x.firstSeen <= minute)
          .map((x) => {
            const resolved = x.resolvedAt !== undefined && x.resolvedAt <= minute;
            const last = resolved ? x.resolvedAt! : Math.floor(minute / STEP_MIN) * STEP_MIN;
            return {
              id: x.id,
              title: x.title,
              severity: x.severity,
              status: resolved ? "resolved" : x.openStatus,
              equipmentIds: x.equipmentIds,
              firstSeen: iso(DAY_START + x.firstSeen * MINUTE_MS),
              lastSeen: iso(DAY_START + last * MINUTE_MS),
              summary: x.summary,
              evidence: x.evidence,
            };
          });
        return { schemaVersion: 1, at, issues };
      }),

    getLatestForecast: ({ at, horizonMinutes, stepMinutes }, o) =>
      serve("forecast", o, forecastResult, () => {
        // Forecasts are issued every 15 minutes; return the newest at or before `at`.
        const asOf = Math.floor(Date.parse(at) / (15 * MINUTE_MS)) * (15 * MINUTE_MS);
        return forecastAt(asOf, horizonMinutes, stepMinutes);
      }),

    getForecastById: (forecastId, o) =>
      serve("forecast", o, forecastResult, () => {
        const id = parseForecastId(forecastId);
        if (!id || id.scenarioId !== def.id || !HORIZONS.includes(id.horizonMinutes) || !STEPS.includes(id.stepMinutes)) {
          throw new ApiError("NOT_FOUND", `No forecast with ID ${forecastId} exists for this site and source.`, false);
        }
        return forecastAt(id.asOf, id.horizonMinutes, id.stepMinutes);
      }),

    getForecastCapabilities: (o) =>
      serve("capabilities", o, forecastCapabilities, () => ({
        schemaVersion: 1,
        target: "cooling_load_kw",
        sources: ["telemetry"],
        horizonsMinutes: HORIZONS,
        stepsMinutes: STEPS,
        modes: [
          { mode: "site_adapted", available: false, artifactId: null, reason: "No site adaptation has been run in this demo installation." },
          { mode: "pretrained", available: false, artifactId: null, reason: "No pretrained forecasting model artifact is installed." },
          { mode: "baseline", available: true, artifactId: "demo-seasonal-profile-baseline", reason: null },
        ],
        historyDaysAvailable: Math.floor((DAY_START - ds.demand.start) / DAY_MS),
        minHistoryDays: MIN_HISTORY_DAYS,
      })),

    getDemandHistory: ({ from, to }, o) =>
      serve("demand", o, demandHistory, () => {
        const step = STEP_MIN * MINUTE_MS;
        const a = Math.max(0, Math.ceil((Date.parse(from) - ds.demand.start) / step));
        const b = Math.min(ds.demand.values.length - 1, Math.floor((Date.parse(to) - ds.demand.start) / step));
        const cutoff = ds.lastReceivedIndex === null ? Infinity : sampleTime(ds.lastReceivedIndex);
        const times: string[] = [];
        const values: (number | null)[] = [];
        for (let k = a; k <= b; k++) {
          const ms = ds.demand.start + k * step;
          times.push(iso(ms));
          values.push(ms > cutoff ? null : ds.demand.values[k]);
        }
        return { schemaVersion: 1, target: "cooling_load_kw", unit: "kW", times, values };
      }),
  };
}

/** Parse `?fail=snapshot:timeout,forecast:unavailable` for error-state demonstrations. */
export function parseFailures(param: string | null): FixtureOptions["failures"] {
  if (!param) return undefined;
  return Object.fromEntries(param.split(",").map((pair) => pair.split(":")).filter(([op, kind]) => op && kind));
}
