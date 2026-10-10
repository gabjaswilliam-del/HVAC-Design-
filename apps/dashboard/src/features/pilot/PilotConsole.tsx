import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { History, MonitorPlay, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatNumber, formatTime } from "../../lib/format";
import { isFinal, type PilotIssue, type RunDetail } from "../../lib/contracts/simulation";
import { Notice } from "../../components/Notice";
import { motion } from "../../lib/motion";
import { targetPath } from "../../app/navigation";
import { NARROW, operating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import {
  CorrectionHistory,
  RunControls,
  RunStateLabel,
  ScenarioForm,
  liveRunOf,
  simulationSession,
  useSimulation,
  type PilotView,
} from "../simulation";
import { IssueRow, PilotStatusNotice, ProposalDecision } from "./Findings";
import { LiveReadings } from "./PilotLive";
import { MonitorToggle } from "./MonitorToggle";
import { PilotStatusLabel, pilotStatusOf } from "./pilotStatus";
import "./pilot.css";

const RECENT = 3;
const ACTIVITY = 4;
/** A link here changes the main display; on a phone the sheet gives way so it shows. */
const showMain = () => {
  if (matchMedia(NARROW).matches) operating.closeWorkspace();
};

/**
 * AI Pilot: the operator console for a live simulation, in the workspace beside every
 * screen. Set up (name, scenario, start, duration, timestep, setpoint), start or start
 * paused; then the same console operates the run (resume, pause, step, stop), shows its
 * key figures and the pilot's monitoring, and holds Live, Findings (with Apply and Decline
 * for a proposal) and Corrections. When the run ends it gives a short completion result;
 * its replay opens in the main display only when asked ("View summary & replay").
 *
 * The main display is never moved by AI Pilot: it stays the operator's own while a run
 * goes on. Only these explicit controls operate the simulation. The assistant may point
 * to one (it is outlined and named here) but never presses it. Nothing reaches physical
 * equipment.
 */
export function PilotConsole({ hidden = false }: { hidden?: boolean }) {
  const s = useStrings();
  const p = s.pilot;
  const site = useSite();
  const sim = useSimulation();
  const tz = site.data?.site.timezone ?? "UTC";
  const caps = sim.caps;
  const run = sim.run && sim.run.runId === sim.runId ? sim.run : null;
  const liveRun = liveRunOf(sim.runs);
  const otherLive = liveRun && liveRun.runId !== sim.runId ? liveRun : null;
  const phase = !caps ? "loading" : sim.composing || !sim.runId ? "setup" : !run ? "loading" : isFinal(run.state) ? "finished" : "operating";

  // The phase that arrives (set up, running, ended) settles in part by part.
  const body = useRef<HTMLDivElement>(null);
  const shownPhase = useRef(phase);
  useLayoutEffect(() => {
    if (shownPhase.current === phase) return;
    shownPhase.current = phase;
    motion.arrive([...(body.current?.children ?? [])]);
  }, [phase]);

  // A run ending while it is operated here is said, wherever focus is.
  const [ended, setEnded] = useState("");
  const was = useRef(phase);
  useEffect(() => {
    if (was.current === "operating" && phase === "finished" && run) setEnded(p.endedAnnounce(p.completion[run.state === "failed" ? "failed" : "ended"], run.name, run.runId));
    was.current = phase;
  }, [phase]);

  return (
    <aside id="pilot-panel" className="pilot-console" aria-label={p.label} data-escape-ignore data-phase={phase} hidden={hidden}>
      <p className="pilot-console__scope">
        <span className="tag-chip tag-chip--notice">{p.scope}</span>
        <span className="tag-chip tag-chip--demo" title={p.mockTitle}>
          {p.mock}
        </span>
        <span className="tag-chip tag-chip--demo" title={caps?.service.engine}>
          {s.simulation.mock}
        </span>
        <span className="pilot-console__note">{p.scopeNote}</span>
      </p>
      <p className="visually-hidden" role="status">
        {ended}
      </p>

      <Pointer hidden={hidden} />
      {sim.capsError && !caps && (
        <Notice tone="critical" action={{ label: s.simulation.reconnect, onClick: simulationSession.retry }}>
          {s.simulation.unavailable} {sim.capsError.message}
        </Notice>
      )}
      {sim.lostRunId && <Notice tone="info">{s.simulation.lost(sim.lostRunId)}</Notice>}
      {sim.commandError && (
        <Notice tone="warning" action={{ label: s.simulation.dismiss, onClick: simulationSession.clearCommandError }}>
          {s.simulation.commandFailed} {sim.commandError.message}
        </Notice>
      )}
      {otherLive && phase !== "operating" && (
        <Notice tone="info" action={{ label: p.returnTo(otherLive.runId), onClick: () => simulationSession.attach(otherLive.runId) }}>
          {p.otherLive(otherLive.runId, otherLive.name)}
        </Notice>
      )}

      <div ref={body} className="pilot-console__body">
        {phase === "loading" && !sim.capsError && <div className="sim-loading skeleton" role="status" aria-label={p.connecting} />}
        {phase === "setup" && caps && site.data && (
          <>
            <ScenarioForm
              caps={caps}
              devices={site.data.topology.devices.length}
              autoFocus={sim.composing}
              onCancel={sim.composing && sim.runId ? () => simulationSession.compose(false) : undefined}
              cancelLabel={sim.runId ? p.backToRun(sim.runId) : undefined}
            />
            <RecentRuns timeZone={tz} />
          </>
        )}
        {(phase === "operating" || phase === "finished") && run && caps && site.data && (
          <>
            <RunControls
              run={run}
              caps={caps}
              timeZone={tz}
              autoFocus={sim.launched === run.runId}
              onNewRun={() => simulationSession.compose(true)}
              onRename={async (name) => Boolean(await simulationSession.rename(run.runId, name))}
            />
            {phase === "operating" ? (
              <>
                <PilotStrip />
                <LiveReadings run={run} site={site.data} timeZone={tz} />
                <ConsoleViews run={run} timeZone={tz} />
              </>
            ) : (
              <Completion run={run} />
            )}
          </>
        )}
      </div>
    </aside>
  );
}

/** The pilot's own state: monitoring, what it found, its last scan; monitoring can pause. */
function PilotStrip() {
  const p = useStrings().pilot;
  const sim = useSimulation();
  const tz = useSite().data?.site.timezone ?? "UTC";
  const pilot = sim.pilot?.runId === sim.runId ? sim.pilot : null;
  const status = pilotStatusOf(sim);
  const open = pilot?.issues.filter((i) => i.open).length ?? 0;
  const label = useRef<HTMLSpanElement>(null);
  const was = useRef(status);
  useEffect(() => {
    if (was.current !== status) motion.changed(label.current);
    was.current = status;
  }, [status]);
  return (
    <div className="pilot__bar pilot-console__strip" role="group" aria-label={p.statusLabel}>
      <span ref={label} className="pilot-console__status">
        <PilotStatusLabel status={status} />
      </span>
      {pilot && (
        <span className="pilot__muted" data-pilot-count aria-live="polite">
          {p.detected(pilot.issues.length, open)}
        </span>
      )}
      {pilot?.lastScanAt && (
        <span className="pilot__muted num">
          {p.lastScan} {formatTime(pilot.lastScanAt, tz)}, {p.scans(pilot.scans)}
        </span>
      )}
      {pilot && pilot.reasoningPending > 0 && <span className="pilot__muted">{p.reasoning(pilot.reasoningPending)}</span>}
      <MonitorToggle />
    </div>
  );
}

/** Live, Findings and Corrections of the live run: one view at a time, here only. */
function ConsoleViews({ run, timeZone }: { run: RunDetail; timeZone: string }) {
  const s = useStrings();
  const p = s.pilot;
  const site = useSite();
  const sim = useSimulation();
  const pilot = sim.pilot?.runId === run.runId ? sim.pilot : null;
  const issues = pilot?.issues ?? [];
  const open = issues.filter((i) => i.open).length;
  const view = sim.view;
  const tabs: { key: PilotView; label: string }[] = [
    { key: "live", label: p.tabs.live },
    { key: "findings", label: p.tabs.findings(open) },
    { key: "corrections", label: p.tabs.corrections },
  ];
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === view);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    simulationSession.setView(t.key);
    requestAnimationFrame(() => document.getElementById(`pilot-console-tab-${t.key}`)?.focus());
  };

  return (
    <>
      <div className="pilot-tabs pilot-console__tabs" role="tablist" aria-label={p.tabs.label} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`pilot-console-tab-${t.key}`}
            className="pilot-tabs__tab"
            aria-selected={view === t.key}
            aria-controls="pilot-console-panel"
            tabIndex={view === t.key ? 0 : -1}
            onClick={() => simulationSession.setView(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div key={view} id="pilot-console-panel" className="pilot-console__panel" role="tabpanel" aria-labelledby={`pilot-console-tab-${view}`}>
        {view === "live" && <ConsoleLive run={run} issues={issues} timeZone={timeZone} />}
        {view === "findings" && <ConsoleFindings run={run} issues={issues} timeZone={timeZone} />}
        {view === "corrections" && site.data && sim.caps && (
          <CorrectionHistory
            run={run}
            caps={sim.caps}
            devices={site.data.topology.devices}
            metrics={site.data.metrics}
            timeZone={timeZone}
            equipmentId={null}
            onIssue={(id) => simulationSession.selectIssue(id)}
            compact
          />
        )}
      </div>
    </>
  );
}

function ConsoleLive({ run, issues, timeZone }: { run: RunDetail; issues: PilotIssue[]; timeZone: string }) {
  const s = useStrings();
  const p = s.pilot;
  const sim = useSimulation();
  const pilot = sim.pilot?.runId === run.runId ? sim.pilot : null;
  const latest = [...issues.filter((i) => i.open), ...issues.filter((i) => !i.open)].slice(0, 4);
  return (
    <div className="pilot-console__section">
      <PilotStatusNotice />
      {latest.length > 0 && (
        <section aria-labelledby="pilot-console-latest">
          <h3 id="pilot-console-latest" className="pilot-console__h">
            {p.issues} <span className="pilot__muted num">{p.openIssues(issues.filter((i) => i.open).length)}</span>
          </h3>
          <IssueList issues={latest} run={run} timeZone={timeZone} />
        </section>
      )}
      {pilot && pilot.activity.length > 0 && (
        <section aria-labelledby="pilot-console-activity">
          <h3 id="pilot-console-activity" className="pilot-console__h">
            {p.activity}
          </h3>
          <ol className="pilot-panel__activity">
            {pilot.activity
              .slice(-ACTIVITY)
              .reverse()
              .map((a) => (
                <li key={a.id}>
                  <time className="num" dateTime={a.at}>
                    {formatTime(a.at, timeZone)}
                  </time>
                  <span>{a.text}</span>
                </li>
              ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/** Issue rows: choosing one opens it under its row (its investigation, evidence and any
 *  decision); rows that are new since the last render rise in once. */
function IssueList({ issues, run, timeZone }: { issues: PilotIssue[]; run: RunDetail; timeZone: string }) {
  const sim = useSimulation();
  const list = useRef<HTMLUListElement>(null);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = issues.map((i) => i.id);
    if (seen.current) motion.added(ids.filter((id) => !seen.current!.has(id)).map((id) => list.current?.querySelector(`[data-pilot-issue="${id}"]`)));
    seen.current = new Set([...(seen.current ?? []), ...ids]);
  }, [issues.map((i) => i.id).join()]);
  return (
    <ul ref={list} className="pilot-issues__list">
      {issues.map((i) => (
        <li key={i.id}>
          <IssueRow issue={i} current={sim.issueId === i.id && sim.view === "findings"} timeZone={timeZone} onSelect={() => simulationSession.selectIssue(i.id)} />
          {sim.issueId === i.id && sim.view === "findings" && <ProposalDecision issue={i} run={run} timeZone={timeZone} />}
        </li>
      ))}
    </ul>
  );
}

function ConsoleFindings({ run, issues, timeZone }: { run: RunDetail; issues: PilotIssue[]; timeZone: string }) {
  const p = useStrings().pilot;
  const sim = useSimulation();
  const open = issues.filter((i) => i.open);
  const closed = issues.filter((i) => !i.open);
  if (!issues.length) {
    return <p className="sim-empty">{sim.pilot?.monitoring ? p.noIssues : p.noIssuesOff}</p>;
  }
  return (
    <div className="pilot-console__section">
      <p className="pilot__muted">{p.findingsHint}</p>
      {open.length > 0 && (
        <section aria-labelledby="pilot-console-open">
          <h3 id="pilot-console-open" className="pilot-console__h">
            {p.openGroup}
          </h3>
          <IssueList issues={open} run={run} timeZone={timeZone} />
        </section>
      )}
      {closed.length > 0 && (
        <section aria-labelledby="pilot-console-resolved">
          <h3 id="pilot-console-resolved" className="pilot-console__h">
            {p.resolvedGroup}
          </h3>
          <IssueList issues={closed} run={run} timeZone={timeZone} />
        </section>
      )}
    </div>
  );
}

/**
 * The run has ended: a short result from what it recorded (how it ended, what the pilot
 * found, corrections applied, average COP, energy) and the way to its replay. Nothing
 * opens by itself; the summary, the plant and the charts are in the replay.
 */
function Completion({ run }: { run: RunDetail }) {
  const s = useStrings();
  const p = s.pilot;
  const sim = useSimulation();
  const summary = sim.summary?.runId === run.runId ? sim.summary : null;
  const pilot = sim.pilot?.runId === run.runId ? sim.pilot : null;
  const applied = run.corrections.filter((c) => c.applied).length;
  const findings = summary ? (summary.pilot.monitored ? String(summary.pilot.issues) : s.summary.notMonitored) : pilot ? String(pilot.issues.length) : "–";
  return (
    <section className="pilot-console__section pilot-completion" aria-labelledby="pilot-completion-title" data-completion-for={run.runId}>
      <h3 id="pilot-completion-title" className="pilot-completion__title">
        {p.completion[summary?.identity.endReason ?? (run.state === "failed" ? "failed" : "ended")]}
      </h3>
      <p className="pilot-completion__run">
        {run.name} <span className="num pilot__muted">{run.runId}</span>
      </p>
      {run.state === "failed" && run.lastError && <p className="pilot__muted">{run.lastError}</p>}
      <dl className="pilot-completion__figures">
        <div>
          <dt>{p.findingsDetected}</dt>
          <dd className="num">{findings}</dd>
        </div>
        <div>
          <dt>{p.correctionsApplied}</dt>
          <dd className="num">{applied}</dd>
        </div>
        <div>
          <dt>{s.summary.avgCop}</dt>
          <dd className="num">{run.stats.avgCop === null ? "–" : formatNumber(run.stats.avgCop, 2)}</dd>
        </div>
        <div>
          <dt>{s.summary.energy}</dt>
          <dd className="num">{formatNumber(run.stats.energyKwh, 0)} kWh</dd>
        </div>
      </dl>
      {sim.summaryError && <p className="pilot__muted">{p.summaryUnavailable} {sim.summaryError.message}</p>}
      <p className="pilot-completion__actions">
        <Link className="button button--primary" to={targetPath({ type: "simulation", runId: run.runId })} onClick={showMain}>
          <MonitorPlay size={15} aria-hidden="true" />
          {p.viewReplay}
        </Link>
      </p>
    </section>
  );
}

/** The last few runs: an ended one opens its replay; the live one is returned to here. */
function RecentRuns({ timeZone }: { timeZone: string }) {
  const s = useStrings();
  const p = s.pilot;
  const { runs } = useSimulation();
  if (!runs.length) return null;
  const row = (r: (typeof runs)[number]) => (
    <>
      <span className="sim-runs__name">{r.name}</span>
      <span className="num sim-runs__id">{r.runId}</span>
      <RunStateLabel state={r.state} />
      <span className="num sim-muted">{r.simulatedTime ? formatTime(r.simulatedTime, timeZone) : s.simulation.notStarted}</span>
    </>
  );
  return (
    <section className="pilot-console__recent" aria-labelledby="pilot-recent-title">
      <div className="pilot-console__recent-head">
        <h3 id="pilot-recent-title" className="pilot-console__h">
          {p.recent}
        </h3>
        <Link className="link" to={targetPath({ type: "simulation" })} onClick={showMain}>
          <History size={14} aria-hidden="true" /> {p.allHistory}
        </Link>
      </div>
      <ul className="sim-runs">
        {runs.slice(0, RECENT).map((r) => (
          <li key={r.runId}>
            {isFinal(r.state) ? (
              <Link className="sim-runs__row" to={targetPath({ type: "simulation", runId: r.runId })} onClick={showMain}>
                {row(r)}
              </Link>
            ) : (
              <button type="button" className="sim-runs__row" onClick={() => simulationSession.attach(r.runId)}>
                {row(r)}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A control someone pointed to (the assistant): this says whose it is to press, takes
 * focus so it is read, and outlines the control. Focus never goes to the control itself,
 * so a key press cannot operate the run.
 */
function Pointer({ hidden }: { hidden: boolean }) {
  const s = useStrings();
  const p = s.pilot;
  const sim = useSimulation();
  const note = useRef<HTMLParagraphElement>(null);
  const pointer = sim.pointer;
  const runLabel = sim.run?.runId ?? "";
  useEffect(() => {
    if (!pointer || hidden) return;
    // After the console has rendered the view that holds the control.
    const frame = requestAnimationFrame(() => {
      const panel = document.getElementById("pilot-panel");
      const control = panel?.querySelector<HTMLElement>(`[data-pilot-control="${pointer.control}"]`);
      panel?.querySelectorAll("[data-pointed]").forEach((el) => el.removeAttribute("data-pointed"));
      if (control) {
        control.setAttribute("data-pointed", "");
        control.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        motion.point(control);
      }
      note.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [pointer?.nonce, hidden]);
  useEffect(() => {
    if (!pointer) document.querySelectorAll("#pilot-panel [data-pointed]").forEach((el) => el.removeAttribute("data-pointed"));
  }, [pointer]);
  if (!pointer) return null;
  return (
    <div className="pilot-pointer">
      <p ref={note} className="pilot-pointer__text" role="status" tabIndex={-1} data-pointer={pointer.control}>
        {p.pointed[pointer.control](pointer.issueId ?? runLabel)}
      </p>
      <button type="button" className="icon-button" aria-label={p.dismissPointer} title={p.dismissPointer} onClick={simulationSession.clearPointer}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
