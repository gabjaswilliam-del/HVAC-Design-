import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import type { SiteBundle } from "../../lib/contracts";
import { heldAt, isFinal, matchedRuns, type PilotIssue, type RunDetail } from "../../lib/contracts/simulation";
import { Notice } from "../../components/Notice";
import { TimeSeriesChart, type ChartSeries } from "../../components/TimeSeriesChart";
import { motion } from "../../lib/motion";
import { pilotClient, simulationClient, simulationPace, useDataClient } from "../../app/dataClient";
import { targetPath } from "../../app/navigation";
import { showInPilot } from "../../app/openTarget";
import { useSite } from "../../app/site";
import { MINUTE_MS } from "../../fixtures/generate";
import { CorrectionHistory, Loading, RunControls, SimulatedPlant, SimulationTimeline, issueColor, useSimulation } from "../simulation";
import { Findings } from "./Findings";
import "./pilot.css";

/**
 * Simulation: the replay of one recorded run (`/simulation/RUN-0001`), the one view of a
 * run that has ended, whether it is opened from AI Pilot ("View summary & replay"),
 * Simulation history or the assistant. Charts carry the data: the simulated plant at any
 * recorded step (a scrubber over the run, with auto-play) and, beside it, the results —
 * the values at that step, the whole-run figures and every metric's course with the
 * moment marked, the newest matched run overlaid automatically. An issue's address
 * (`?issue=`) locates it: its equipment is highlighted on the plant, its span is marked
 * on the scrubber and the charts, and that span plays itself. Text is folded away: the
 * corrections record, the events timeline and the findings collapse; the pilot's
 * condensed summary, its unresolved issues and their advice live in AI Pilot. Everything
 * is read from the run's record; nothing here operates a run. A run that is still live is
 * operated in AI Pilot and replays here once it has ended.
 * Typed address: `{ type: "simulation", runId, issueId, equipmentId, compareWith }`.
 */
export function SimulationView() {
  const { runId = "" } = useParams();
  // Another run is another replay: its own step, finding and arrival, never the last one's.
  return <RunReplay key={runId} runId={runId} />;
}

function RunReplay({ runId }: { runId: string }) {
  const s = useStrings();
  const v = s.simulation;
  const p = s.pilot;
  const [params] = useSearchParams();
  const site = useSite();
  const { caps } = useSimulation();
  const tz = site.data?.site.timezone ?? "UTC";
  const { run, pilot, live } = useRecordedRun(runId);
  const r = run.data;
  const ended = Boolean(r && isFinal(r.state));
  const issues = pilot.data?.issues ?? [];

  // The step shown: the run's last, until the operator scrubs back.
  const last = Math.max(0, (r?.results.times.length ?? 1) - 1);
  const [step, setStep] = useState<number | null>(null);
  const shownStep = Math.min(step ?? last, last);

  // An address names a finding or an item: the item is brought into view; the finding is
  // located — its equipment highlighted on the plant, its span marked on the scrubber and
  // the trends, and that span played once.
  const issueParam = params.get("issue");
  const equipmentParam = params.get("equipment");
  const [issueId, setIssueId] = useState(issueParam);
  const plantRef = useRef<HTMLDivElement>(null);
  const issue = issues.find((i) => i.id === issueParam) ?? null;
  // Every open issue's first-to-last sighting as recorded steps (and simulated times), each
  // in the issue's own colour; the located one is strong. A resolved issue joins when it
  // is the located one, so its period still shows.
  const spans = useMemo(() => {
    if (!r || r.results.times.length < 2) return [];
    const ts = r.results.times.map((x) => Date.parse(x));
    const stepAt = (iso: string) => {
      const t = Date.parse(iso);
      let best = 0;
      ts.forEach((x, i) => {
        if (Math.abs(x - t) < Math.abs(ts[best] - t)) best = i;
      });
      return best;
    };
    return issues
      .filter((i) => i.open || i.id === issueParam)
      .map((i) => {
        const fromStep = stepAt(i.firstSeen);
        const toStep = Math.max(fromStep, stepAt(i.lastSeen));
        // Seen at (nearly) every step: present throughout; a filled band would just paint
        // the whole chart, so it is drawn as an outline and said in words instead.
        const throughout = toStep - fromStep >= 0.9 * (ts.length - 1);
        return { id: i.id, fromStep, toStep, from: ts[fromStep], to: ts[toStep], color: issueColor(i.id, issues), strong: i.id === issueParam, throughout };
      });
  }, [issues, r, issueParam]);
  const segment = spans.find((x) => x.strong) ?? null;
  const [playNonce, setPlayNonce] = useState(0);
  const located = useRef("");
  useEffect(() => {
    if (!issueParam) return;
    setIssueId(issueParam);
    if (!issue || !ended || located.current === issueParam) return;
    located.current = issueParam;
    plantRef.current?.scrollIntoView({ block: "start" });
    setPlayNonce((n) => n + 1);
  }, [issueParam, issue, ended]);
  useEffect(() => {
    if (equipmentParam) plantRef.current?.scrollIntoView({ block: "nearest" });
  }, [equipmentParam, ended]);

  // The recorded run settles in once, when it is first shown.
  const content = useRef<HTMLDivElement>(null);
  const arrived = useRef(false);
  useLayoutEffect(() => {
    if (arrived.current || !ended) return;
    arrived.current = true;
    motion.arrive([...(content.current?.children ?? [])].slice(0, 4));
  }, [ended]);

  const back = (
    <Link className="link history__back" to={targetPath({ type: "simulation" })}>
      <ArrowLeft size={14} aria-hidden="true" /> {s.history.allRuns}
    </Link>
  );

  return (
    <div className="page sim replay" aria-busy={(!r && !run.error) || undefined}>
      <div className="page__head">
        <div className="sim__title-row">
          <h2 className="page__title">{v.replayTitle}</h2>
          <span className="tag-chip tag-chip--notice" data-provenance="recorded">
            {v.recorded}
          </span>
          <span className="tag-chip tag-chip--demo" title={caps?.service.engine}>
            {v.mock}
          </span>
          <span className="tag-chip tag-chip--demo" title={p.mockTitle}>
            {p.mock}
          </span>
        </div>
        <p className="page__sub">{v.replayLead}</p>
      </div>
      {back}
      {run.error && !r ? (
        <Notice tone={run.error.code === "NOT_FOUND" ? "info" : "warning"} action={run.error.code === "NOT_FOUND" ? undefined : { label: v.reconnect, onClick: run.retry }}>
          {run.error.code === "NOT_FOUND" ? s.history.unknown(runId) : run.error.message}
        </Notice>
      ) : !r || !site.data ? (
        <Loading label={v.loadingRun(runId)} />
      ) : (
        <>
          <RunControls run={r} timeZone={tz} readOnly />
          {live ? (
            <Notice tone="info" action={{ label: p.openPilot, onClick: () => showInPilot({ type: "pilot", runId: r.runId }) }}>
              {v.liveInPilot(r.runId)}
            </Notice>
          ) : (
            <div ref={content} className="replay__content">
              {r.state === "failed" && r.lastError && (
                <Notice tone="warning">
                  <strong>{v.failed}</strong> {r.lastError}
                </Notice>
              )}
              <div className="sim__layout">
                <div className="sim__main" ref={plantRef}>
                  <PlantReplay
                    run={r}
                    site={site.data}
                    issues={issues}
                    timeZone={tz}
                    step={shownStep}
                    onStep={setStep}
                    highlightIds={issue?.equipmentIds}
                    highlightColor={issue ? issueColor(issue.id, issues) : undefined}
                    spans={spans}
                    segment={segment}
                    playNonce={playNonce}
                  />
                </div>
                <div className="sim__side">
                  <ReplayResults
                    run={r}
                    timeZone={tz}
                    step={shownStep}
                    spans={spans}
                    located={issue ? { id: issue.id, color: issueColor(issue.id, issues), throughout: segment?.throughout ?? false } : null}
                    compareWith={params.get("compare")}
                  />
                  {caps && (
                    <details className="replay-fold">
                      <summary>{v.corrections}</summary>
                      <CorrectionHistory run={r} caps={caps} devices={site.data.topology.devices} metrics={site.data.metrics} timeZone={tz} equipmentId={equipmentParam} readOnly bare />
                    </details>
                  )}
                  <details className="replay-fold">
                    <summary>{v.timeline}</summary>
                    <SimulationTimeline events={r.events} timeZone={tz} bare />
                  </details>
                </div>
              </div>
              <details className="replay-fold replay__findings">
                <summary>{p.issues}</summary>
                {pilot.data ? (
                  <Findings run={r} issues={issues} issueId={issueId} onSelect={setIssueId} latestScan={pilot.data.lastScanAt} monitoring={pilot.data.monitoring} timeZone={tz} />
                ) : pilot.error ? (
                  <Notice tone="warning">
                    {p.findingsUnavailable} {pilot.error.message}
                  </Notice>
                ) : (
                  <Loading label={p.findingsLoading} />
                )}
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One run read from the service: kept current while it is still live (it runs in AI
 *  Pilot); its pilot's findings once it has ended. */
function useRecordedRun(runId: string) {
  const [tick, setTick] = useState(0);
  const run = useResource(`replay-run:${runId}:${tick}`, `replay:${runId}`, (signal) => simulationClient.getRun(runId, { signal }));
  const live = Boolean(run.data && !isFinal(run.data.state));
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => setTick((x) => x + 1), 1000 * simulationPace);
    return () => clearTimeout(t);
  }, [live, tick]);
  const ended = Boolean(run.data && isFinal(run.data.state));
  const pilot = useResource(ended ? `replay-pilot:${runId}` : null, `replay-pilot:${runId}`, (signal) => pilotClient.getState(runId, { signal }));
  return { run, pilot, live };
}

/**
 * The simulated plant at one recorded step, with a scrubber over the run's steps: the
 * observation the run recorded then, what it held then and the pilot's issues seen by
 * then. The last step is the run's own final observation. The play button runs the replay
 * through on its own, from the start when it is pressed at the end; scrubbing by hand
 * pauses it. Every open issue's span is marked on the scrubber in its own colour
 * (`spans`); a located issue (`segment`, played when `playNonce` changes) is emphasised,
 * its equipment highlighted in its colour, and just its steps are played.
 */
function PlantReplay({
  run,
  site,
  issues,
  timeZone,
  step,
  onStep,
  highlightIds,
  highlightColor,
  spans = [],
  segment = null,
  playNonce = 0,
}: {
  run: RunDetail;
  site: SiteBundle;
  issues: PilotIssue[];
  timeZone: string;
  step: number;
  onStep: (step: number) => void;
  highlightIds?: string[];
  highlightColor?: string;
  spans?: { id: string; fromStep: number; toStep: number; color: string; strong: boolean }[];
  segment?: { fromStep: number; toStep: number } | null;
  playNonce?: number;
}) {
  const s = useStrings().simulation;
  const id = useId();
  const times = run.results.times;
  const last = times.length - 1;
  const latest = step === last;
  const observation = useResource(latest || last < 0 ? null : `observation:${run.runId}:${step}`, `observation:${run.runId}`, (signal) => simulationClient.getObservation(run.runId, step, { signal }));
  const frame = latest ? run.frame : (observation.data ?? run.frame);
  const held = useMemo(() => heldAt(run.corrections, step), [run.corrections, step]);
  const at = times[step] ? Date.parse(times[step]) : null;
  // Auto-play: one recorded step at a time until `playTo` (a located issue's last step) or
  // the run's last, then it stops by itself.
  const [playing, setPlaying] = useState(false);
  const [playTo, setPlayTo] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    const end = playTo ?? last;
    if (step >= end) {
      setPlaying(false);
      setPlayTo(null);
      return;
    }
    const t = setTimeout(() => onStep(step + 1), 500);
    return () => clearTimeout(t);
  }, [playing, step, last, playTo, onStep]);
  // Pressed at the end, play starts again from the first step — the whole run.
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      setPlayTo(null);
    } else {
      setPlayTo(null);
      if (step >= last) onStep(0);
      setPlaying(true);
    }
  };
  const scrub = (next: number) => {
    setPlaying(false);
    setPlayTo(null);
    onStep(next);
  };
  // A located issue plays its own span once, from its first sighting to its last.
  const played = useRef(0);
  useEffect(() => {
    if (!segment || !playNonce || played.current === playNonce || last < 1) return;
    played.current = playNonce;
    setPlaying(false);
    onStep(Math.min(segment.fromStep, last));
    setPlayTo(Math.min(segment.toStep, last));
    setPlaying(true);
  }, [playNonce, segment, last, onStep]);
  // ponytail: an issue's stage is not recorded per step; one resolved later shows as monitored.
  const seen = useMemo(
    () =>
      at === null
        ? []
        : issues
            .filter((i) => Date.parse(i.firstSeen) <= at && (!i.resolution || Date.parse(i.resolution.at) > at))
            .map((i) => (i.resolution ? { ...i, open: true, stage: "outcome" as const } : i)),
    [issues, at],
  );
  if (last < 0) return <p className="sim-empty">{s.noFrame}</p>;
  return (
    <SimulatedPlant run={run} frame={frame} held={held} site={site} timeZone={timeZone} issues={seen} highlightIds={highlightIds} highlightColor={highlightColor}>
      <div className="replay-scrubber" style={{ "--progress": `${last ? (step / last) * 100 : 100}%` } as CSSProperties}>
        <button
          type="button"
          className="icon-button replay-scrubber__play"
          aria-label={playing ? s.pauseReplay : s.playReplay}
          aria-pressed={playing}
          title={playing ? s.pauseReplay : s.playReplay}
          disabled={last === 0}
          onClick={togglePlay}
        >
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <label htmlFor={id}>{s.replayLabel}</label>
        <span className="replay-scrubber__track">
          <input
            id={id}
            type="range"
            className="timeline__range replay-scrubber__range"
            min={0}
            max={last}
            step={1}
            value={step}
            disabled={last === 0}
            aria-valuetext={s.replayValue(formatTime(times[step], timeZone), step, last)}
            onChange={(e) => scrub(Number(e.target.value))}
          />
          {spans.map((sp) => (
            <span
              key={sp.id}
              className={`replay-scrubber__span${sp.strong ? " replay-scrubber__span--strong" : ""}`}
              aria-hidden="true"
              style={{ "--from": sp.fromStep / last, "--to": sp.toStep / last, background: sp.color } as CSSProperties}
            />
          ))}
        </span>
        <output htmlFor={id} className="num replay-scrubber__at" aria-hidden="true">
          {s.replayValue(formatTime(times[step], timeZone), step, last)}
        </output>
      </div>
      {observation.error && <Notice tone="warning">{observation.error.message}</Notice>}
    </SimulatedPlant>
  );
}

/** One chart with its visible name; the chart itself carries the same name for assistive technology. */
function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sim-chart">
      <h3 aria-hidden="true">{title}</h3>
      {children}
    </div>
  );
}

/**
 * The run's results beside the plant — the one chart section of the replay: the values at
 * the replayed step, the whole-run figures, and each metric's course over the run with the
 * moment marked and a crosshair reading any point. Every open issue's span
 * (simulated-time epoch ms) is shaded in the issue's own colour, the located one
 * emphasised and named beside the heading. The newest matched run is overlaid
 * automatically; the operator can pick another or none. A failed run's results end at its
 * last valid observation.
 */
function ReplayResults({
  run,
  timeZone,
  step,
  spans = [],
  located = null,
  compareWith,
}: {
  run: RunDetail;
  timeZone: string;
  step: number;
  spans?: { id: string; from: number; to: number; color: string; strong: boolean; throughout: boolean }[];
  located?: { id: string; color: string; throughout: boolean } | null;
  compareWith?: string | null;
}) {
  const s = useStrings();
  const v = s.simulation;
  const names = s.pilotLive.names;
  const id = useId();
  const { runs } = useSimulation();
  // A typed target (`compareWith`) can preselect the comparison; it applies only when
  // matched. `null` is "not chosen yet": the newest matched run is overlaid automatically;
  // choosing "No comparison" stores "", which is honored.
  const [pickedId, setPickedId] = useState<string | null>(compareWith ?? null);
  useEffect(() => {
    if (compareWith) setPickedId(compareWith);
  }, [compareWith]);
  const candidates = runs.filter((x) => matchedRuns(run, x));
  const chosen = pickedId === null ? (candidates[0]?.runId ?? "") : candidates.some((x) => x.runId === pickedId) ? pickedId : "";
  // Refetched as this run steps, so a compared run that is still running keeps up.
  const other = useResource(chosen ? `compare:${chosen}:${run.results.times.length}` : null, "simulation-compare", (signal) =>
    simulationClient.getRun(chosen, { signal }),
  ).data;
  const cmp = other && other.runId === chosen ? other : null;

  const r = run.results;
  if (!r.times.length)
    return (
      <section className="sim-section sim-results" aria-labelledby="sim-results-title">
        <div className="sim-section__head">
          <h2 id="sim-results-title">{v.results}</h2>
          <span className="tag-chip tag-chip--notice">{v.resultsSource(run.runId)}</span>
        </div>
        <p className="sim-empty">{v.noResults}</p>
        <ForecastSupport />
      </section>
    );
  const at = r.times[step] ?? r.times.at(-1)!;
  const start = Date.parse(r.times[0]);
  const domain: [number, number] = [start, start + run.stepsTotal * run.config.stepMinutes * MINUTE_MS];
  const marker = { t: Date.parse(at), label: formatTime(at, timeZone) };
  const line = (sid: string, label: string, values: (number | null)[], color = "var(--chart-neutral)", width?: number): ChartSeries => ({
    id: sid,
    label,
    color,
    width,
    points: values.map((x, i) => ({ t: Date.parse(r.times[i]), v: x })),
  });
  const cmpLine = (sid: string, values: (number | null)[]): ChartSeries => ({
    id: `cmp-${sid}`,
    label: v.comparedLabel(cmp!.runId),
    color: "var(--chart-capacity)",
    width: 1.5,
    points: values.map((x, i) => ({ t: Date.parse(cmp!.results.times[i]), v: x })),
  });
  const compared = (sid: string, values: (number | null)[]) => (cmp ? [cmpLine(sid, values)] : []);
  const now = (xs: (number | null)[], d: number, unit = "") => {
    const x = xs[step];
    return x === null || x === undefined ? s.quality.unavailable : `${formatNumber(x, d)}${unit ? ` ${unit}` : ""}`;
  };
  const chart = { timeZone, xDomain: domain, marker, height: 110, highlights: spans.length ? spans : undefined };
  return (
    <section className="sim-section sim-results" aria-labelledby="sim-results-title">
      <div className="sim-section__head">
        <h2 id="sim-results-title">{v.results}</h2>
        <span className="tag-chip num">{formatTime(at, timeZone)}</span>
        {located && (
          <span className="tag-chip sim-results__located" style={{ borderColor: located.color, color: located.color }} data-located-issue={located.id}>
            {v.locating(located.id, located.throughout)}
          </span>
        )}
        <span className="tag-chip tag-chip--notice">{v.resultsSource(run.runId)}</span>
      </div>
      <dl className="sim-summary sim-results__now">
        <div>
          <dt>{names["plant:cop"]}</dt>
          <dd className="num">{now(r.cop, 2)}</dd>
        </div>
        <div>
          <dt>{names["plant:cooling_demand_kw"]}</dt>
          <dd className="num">{now(r.demandKw, 0, "kWt")}</dd>
        </div>
        <div>
          <dt>{names["plant:unmet_kw"]}</dt>
          <dd className="num">{now(r.unmetKw, 0, "kWt")}</dd>
        </div>
        <div>
          <dt>{names["plant:power_kw"]}</dt>
          <dd className="num">{now(r.powerKw, 0, "kW")}</dd>
        </div>
      </dl>
      <dl className="sim-summary sim-results__total">
        <div>
          <dt>{v.energy}</dt>
          <dd className="num">{formatNumber(run.stats.energyKwh, 0)} kWh</dd>
        </div>
        <div>
          <dt>{v.avgCop}</dt>
          <dd className="num">{run.stats.avgCop === null ? "–" : formatNumber(run.stats.avgCop, 2)}</dd>
        </div>
        <div>
          <dt>{v.peakUnmet}</dt>
          <dd className="num">{formatNumber(run.stats.peakUnmetKw, 0)} kWt</dd>
        </div>
      </dl>
      {run.state === "failed" && run.simulatedTime && <p className="sim-retained-note">{v.resultsEnd(formatTime(run.simulatedTime, timeZone))}</p>}
      <div className="sim-compare">
        <div className="sim-field">
          <label htmlFor={`${id}-compare`}>{v.compareWith}</label>
          <select
            id={`${id}-compare`}
            className="select"
            value={chosen}
            disabled={!candidates.length}
            aria-describedby={`${id}-compare-note`}
            onChange={(e) => setPickedId(e.target.value)}
          >
            <option value="">{v.compareNone}</option>
            {candidates.map((c) => (
              <option key={c.runId} value={c.runId}>
                {v.compareOption(c.runId, v.state[c.state])}
              </option>
            ))}
          </select>
        </div>
        <p id={`${id}-compare-note`} className="sim-muted">
          {cmp ? <Comparison run={run} other={cmp} timeZone={timeZone} /> : candidates.length ? v.compareHint(run.configRevision) : v.compareNoneMatched}
        </p>
      </div>
      <Chart title={v.copChart}>
        <TimeSeriesChart title={v.copChart} series={[...compared("cop", cmp?.results.cop ?? []), line("cop", v.thisRun(run.runId), r.cop)]} unit="" decimals={2} {...chart} />
      </Chart>
      <Chart title={v.coolingChart}>
        {/* Removed cooling is drawn first and wider, so it stays visible where it equals demand. */}
        <TimeSeriesChart
          title={v.coolingChart}
          series={[line("removed", v.removed, r.removedKw, "var(--chart-delivered)", 4), line("demand", v.demand, r.demandKw, "var(--chart-observed)")]}
          unit="kWt"
          decimals={0}
          yMin={0}
          {...chart}
        />
      </Chart>
      <Chart title={v.unmetChart}>
        <TimeSeriesChart title={v.unmetChart} series={[...compared("unmet", cmp?.results.unmetKw ?? []), line("unmet", v.unmetChart, r.unmetKw)]} unit="kWt" decimals={0} yMin={0} {...chart} />
      </Chart>
      <Chart title={v.powerChart}>
        <TimeSeriesChart title={v.powerChart} series={[...compared("power", cmp?.results.powerKw ?? []), line("power", v.thisRun(run.runId), r.powerKw)]} unit="kW" decimals={0} yMin={0} {...chart} />
      </Chart>
      <Chart title={v.energyChart}>
        <TimeSeriesChart title={v.energyChart} series={[...compared("energy", cmp?.results.energyKwh ?? []), line("energy", v.thisRun(run.runId), r.energyKwh)]} unit="kWh" decimals={0} yMin={0} {...chart} />
      </Chart>
      <ForecastSupport />
    </section>
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
