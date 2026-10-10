import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import { useResource } from "../../lib/api/useResource";
import type { SiteBundle } from "../../lib/contracts";
import { heldAt, isFinal, type PilotIssue, type RunDetail } from "../../lib/contracts/simulation";
import { Notice } from "../../components/Notice";
import { motion } from "../../lib/motion";
import { pilotClient, simulationClient, simulationPace } from "../../app/dataClient";
import { targetPath } from "../../app/navigation";
import { showInPilot } from "../../app/openTarget";
import { useSite } from "../../app/site";
import { CorrectionHistory, Loading, ResultsView, RunControls, RunSummaryView, SimulatedPlant, SimulationTimeline, useSimulation } from "../simulation";
import { Findings } from "./Findings";
import "./pilot.css";

/**
 * Simulation: the replay of one recorded run (`/simulation/RUN-0001`), the one view of a
 * run that has ended, whether it is opened from AI Pilot ("View summary & replay"),
 * Simulation history or the assistant. Its identity and scenario as recorded (read only),
 * the pilot's run summary, the simulated plant at any recorded step (a scrubber over the
 * run), the results with that moment marked and a matched comparison, the corrections and
 * events, and the pilot's findings with their evidence. Everything is read from the run's
 * record; nothing here operates a run. A run that is still live is operated in AI Pilot
 * and replays here once it has ended.
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
  const { run, pilot, summary, live } = useRecordedRun(runId);
  const r = run.data;
  const ended = Boolean(r && isFinal(r.state));
  const issues = pilot.data?.issues ?? [];

  // The step shown: the run's last, until the operator scrubs back.
  const last = Math.max(0, (r?.results.times.length ?? 1) - 1);
  const [step, setStep] = useState<number | null>(null);
  const shownStep = Math.min(step ?? last, last);

  // An address names a finding or an item: it is chosen and brought into view.
  const issueParam = params.get("issue");
  const equipmentParam = params.get("equipment");
  const [issueId, setIssueId] = useState(issueParam);
  const findingsRef = useRef<HTMLDivElement>(null);
  const plantRef = useRef<HTMLDivElement>(null);
  const findingsShown = Boolean(pilot.data);
  useEffect(() => {
    if (!issueParam) return;
    setIssueId(issueParam);
    findingsRef.current?.scrollIntoView({ block: "start" });
  }, [issueParam, findingsShown]);
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
              {summary.data ? (
                <RunSummaryView summary={summary.data} timeZone={tz} />
              ) : summary.error ? (
                <Notice tone="warning">
                  {p.summaryUnavailable} {summary.error.message}
                </Notice>
              ) : (
                <Loading label={p.summaryLoading} />
              )}
              {r.state === "failed" && r.lastError && (
                <Notice tone="warning">
                  <strong>{v.failed}</strong> {r.lastError}
                </Notice>
              )}
              <div className="sim__layout">
                <div className="sim__main" ref={plantRef}>
                  <PlantReplay run={r} site={site.data} issues={issues} timeZone={tz} step={shownStep} onStep={setStep} />
                  <ResultsView run={r} timeZone={tz} compareWith={params.get("compare")} at={r.results.times[shownStep]} />
                </div>
                <div className="sim__side">
                  {caps && <CorrectionHistory run={r} caps={caps} devices={site.data.topology.devices} metrics={site.data.metrics} timeZone={tz} equipmentId={equipmentParam} readOnly />}
                  <SimulationTimeline events={r.events} timeZone={tz} />
                </div>
              </div>
              <div ref={findingsRef} className="replay__findings">
                {pilot.data ? (
                  <Findings run={r} issues={issues} issueId={issueId} onSelect={setIssueId} latestScan={pilot.data.lastScanAt} monitoring={pilot.data.monitoring} timeZone={tz} />
                ) : pilot.error ? (
                  <Notice tone="warning">
                    {p.findingsUnavailable} {pilot.error.message}
                  </Notice>
                ) : (
                  <Loading label={p.findingsLoading} />
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One run read from the service: kept current while it is still live (it runs in AI
 *  Pilot); its pilot's findings and summary once it has ended. */
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
  const summary = useResource(ended ? `replay-summary:${runId}` : null, `replay-summary:${runId}`, (signal) => pilotClient.getRunSummary(runId, { signal }));
  return { run, pilot, summary, live };
}

/**
 * The simulated plant at one recorded step, with a scrubber over the run's steps: the
 * observation the run recorded then, what it held then and the pilot's issues seen by
 * then. The last step is the run's own final observation.
 */
function PlantReplay({ run, site, issues, timeZone, step, onStep }: { run: RunDetail; site: SiteBundle; issues: PilotIssue[]; timeZone: string; step: number; onStep: (step: number) => void }) {
  const s = useStrings().simulation;
  const id = useId();
  const times = run.results.times;
  const last = times.length - 1;
  const latest = step === last;
  const observation = useResource(latest || last < 0 ? null : `observation:${run.runId}:${step}`, `observation:${run.runId}`, (signal) => simulationClient.getObservation(run.runId, step, { signal }));
  const frame = latest ? run.frame : (observation.data ?? run.frame);
  const held = useMemo(() => heldAt(run.corrections, step), [run.corrections, step]);
  const at = times[step] ? Date.parse(times[step]) : null;
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
    <SimulatedPlant run={run} frame={frame} held={held} site={site} timeZone={timeZone} issues={seen}>
      <div className="replay-scrubber" style={{ "--progress": `${last ? (step / last) * 100 : 100}%` } as CSSProperties}>
        <label htmlFor={id}>{s.replayLabel}</label>
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
          onChange={(e) => onStep(Number(e.target.value))}
        />
        <output htmlFor={id} className="num replay-scrubber__at" aria-hidden="true">
          {s.replayValue(formatTime(times[step], timeZone), step, last)}
        </output>
      </div>
      {observation.error && <Notice tone="warning">{observation.error.message}</Notice>}
    </SimulatedPlant>
  );
}
