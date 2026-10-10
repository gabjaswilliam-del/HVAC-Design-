import { useEffect, useId, useState, type ReactNode } from "react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import { matchedRuns, type RunDetail } from "../../lib/contracts/simulation";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { simulationClient, useDataClient } from "../../app/dataClient";
import { MINUTE_MS } from "../../fixtures/generate";
import { useSimulation } from "./simulationSession";

/**
 * A run's results as distinct metrics: system COP, demand with removed cooling, unmet
 * demand, power and energy, with the replayed moment (`at`) marked. The x axis spans the
 * whole configured run. A failed run's results end at its last valid observation. Another
 * run can be overlaid only when it is matched.
 */
export function ResultsView({ run, timeZone, compareWith, at }: { run: RunDetail; timeZone: string; compareWith?: string | null; at?: string }) {
  const s = useStrings().simulation;
  const id = useId();
  const { runs } = useSimulation();
  // A typed target (`compareWith`) can preselect the comparison; it applies only when matched.
  const [compareId, setCompareId] = useState(compareWith ?? "");
  useEffect(() => {
    if (compareWith) setCompareId(compareWith);
  }, [compareWith]);
  const candidates = runs.filter((r) => matchedRuns(run, r));
  const chosen = candidates.some((r) => r.runId === compareId) ? compareId : "";
  // Refetched as this run steps, so a compared run that is still running keeps up.
  const other = useResource(chosen ? `compare:${chosen}:${run.results.times.length}` : null, "simulation-compare", (signal) =>
    simulationClient.getRun(chosen, { signal }),
  ).data;
  const cmp = other && other.runId === chosen ? other : null;

  const r = run.results;
  const t = r.times.map((x) => Date.parse(x));
  const start = t[0];
  const domain: [number, number] | undefined = start === undefined ? undefined : [start, start + run.stepsTotal * run.config.stepMinutes * MINUTE_MS];
  const line = (sid: string, label: string, times: string[], values: (number | null)[], color = "var(--chart-neutral)", width?: number): ChartSeries => ({
    id: sid,
    label,
    color,
    width,
    points: values.map((v, i) => ({ t: Date.parse(times[i]), v })),
  });
  const compared = (sid: string, values: (number | null)[]) =>
    cmp ? [line(`cmp-${sid}`, s.comparedLabel(cmp.runId), cmp.results.times, values, "var(--chart-capacity)", 1.5)] : [];
  const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
  const cop = nums(r.cop);
  const unmet = nums(r.unmetKw);
  const chart = { timeZone, xDomain: domain, height: 140, marker: at ? { t: Date.parse(at), label: formatTime(at, timeZone) } : undefined };

  return (
    <section className="sim-section sim-results" aria-labelledby="sim-results-title">
      <div className="sim-section__head">
        <h2 id="sim-results-title">{s.results}</h2>
        <span className="tag-chip tag-chip--notice">{s.resultsSource(run.runId)}</span>
      </div>
      {!t.length ? (
        <p className="sim-empty">{s.noResults}</p>
      ) : (
        <>
          <dl className="sim-summary">
            <div>
              <dt>{s.energy}</dt>
              <dd className="num">{formatNumber(r.energyKwh.at(-1) ?? 0, 0)} kWh</dd>
            </div>
            <div>
              <dt>{s.avgCop}</dt>
              <dd className="num">{cop.length ? formatNumber(cop.reduce((a, b) => a + b, 0) / cop.length, 2) : "–"}</dd>
            </div>
            <div>
              <dt>{s.peakUnmet}</dt>
              <dd className="num">{formatNumber(Math.max(0, ...unmet), 0)} kWt</dd>
            </div>
          </dl>
          {run.state === "failed" && run.simulatedTime && <p className="sim-retained-note">{s.resultsEnd(formatTime(run.simulatedTime, timeZone))}</p>}

          <div className="sim-compare">
            <div className="sim-field">
              <label htmlFor={`${id}-compare`}>{s.compareWith}</label>
              <select
                id={`${id}-compare`}
                className="select"
                value={chosen}
                disabled={!candidates.length}
                aria-describedby={`${id}-compare-note`}
                onChange={(e) => setCompareId(e.target.value)}
              >
                <option value="">{s.compareNone}</option>
                {candidates.map((c) => (
                  <option key={c.runId} value={c.runId}>
                    {s.compareOption(c.runId, s.state[c.state])}
                  </option>
                ))}
              </select>
            </div>
            <p id={`${id}-compare-note`} className="sim-muted">
              {cmp ? <Comparison run={run} other={cmp} timeZone={timeZone} /> : candidates.length ? s.compareHint(run.configRevision) : s.compareNoneMatched}
            </p>
          </div>

          <div className="sim-charts">
            <Chart title={s.copChart}>
              <TimeSeriesChart title={s.copChart} series={[...compared("cop", cmp?.results.cop ?? []), line("cop", s.thisRun(run.runId), r.times, r.cop)]} unit="" decimals={2} {...chart} />
            </Chart>
            <Chart title={s.coolingChart}>
              {/* Removed cooling is drawn first and wider, so it stays visible where it equals demand. */}
              <TimeSeriesChart
                title={s.coolingChart}
                series={[line("removed", s.removed, r.times, r.removedKw, "var(--chart-delivered)", 4), line("demand", s.demand, r.times, r.demandKw, "var(--chart-observed)")]}
                unit="kWt"
                decimals={0}
                yMin={0}
                {...chart}
              />
            </Chart>
            <Chart title={s.unmetChart}>
              <TimeSeriesChart title={s.unmetChart} series={[line("unmet", s.unmetChart, r.times, r.unmetKw)]} unit="kWt" decimals={0} yMin={0} {...chart} />
            </Chart>
            <Chart title={s.powerChart}>
              <TimeSeriesChart
                title={s.powerChart}
                series={[...compared("power", cmp?.results.powerKw ?? []), line("power", s.thisRun(run.runId), r.times, r.powerKw)]}
                unit="kW"
                decimals={0}
                yMin={0}
                {...chart}
              />
            </Chart>
            <Chart title={s.energyChart}>
              <TimeSeriesChart
                title={s.energyChart}
                series={[...compared("energy", cmp?.results.energyKwh ?? []), line("energy", s.thisRun(run.runId), r.times, r.energyKwh)]}
                unit="kWh"
                decimals={0}
                yMin={0}
                {...chart}
              />
            </Chart>
          </div>
        </>
      )}
      <ForecastSupport />
    </section>
  );
}

/** One chart with its visible name; the chart itself carries the same name for assistive technology. */
export function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sim-chart">
      <h3 aria-hidden="true">{title}</h3>
      {children}
    </div>
  );
}

/** Energy over the span both runs cover, and what differs between them. */
function Comparison({ run, other, timeZone }: { run: RunDetail; other: RunDetail; timeZone: string }) {
  const s = useStrings().simulation;
  const n = Math.min(run.results.times.length, other.results.times.length);
  if (n < 2) return <>{s.compareTooShort}</>;
  const a = run.results.energyKwh[n - 1] ?? 0;
  const b = other.results.energyKwh[n - 1] ?? 0;
  const pct = b ? ((a - b) / b) * 100 : 0;
  const applied = (x: RunDetail) => x.corrections.filter((c) => c.status === "applied").length;
  return (
    <>
      {s.compareResult(
        `${formatTime(run.results.times[0], timeZone)} to ${formatTime(run.results.times[n - 1], timeZone)}`,
        run.runId,
        formatNumber(a, 0),
        other.runId,
        formatNumber(b, 0),
        `${pct > 0 ? "+" : ""}${formatNumber(pct, 1)} %`,
      )}{" "}
      {s.compareDiff(run.config.chwSetpointC, other.config.chwSetpointC, applied(run), applied(other))}
    </>
  );
}

/** The forecast panel would read source=simulation; the forecasting service says whether it can. */
function ForecastSupport() {
  const s = useStrings().simulation;
  const client = useDataClient();
  const caps = useResource("forecast-capabilities", "simulation", (signal) => client.getForecastCapabilities({ signal }));
  const sources = caps.data?.sources ?? [];
  // ponytail: when a forecasting service supports simulation sources, draw the prediction
  // feature's forecast panel here with source=simulation, this run's ID and its cutoff.
  const text = !caps.data
    ? caps.error?.message ?? s.forecastLoading
    : sources.includes("simulation")
      ? s.forecastNotShown
      : s.forecastUnsupported(sources.join(", "));
  return (
    <div className="sim-forecast">
      <h3>{s.forecast}</h3>
      <p>{text}</p>
    </div>
  );
}
