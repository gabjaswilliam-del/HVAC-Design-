import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Link } from "react-router";
import { Ban, CircleAlert, Crosshair, Send } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { Device } from "../../lib/contracts";
import { isFinal, type PilotIssue, type RunDetail } from "../../lib/contracts/simulation";
import { Notice } from "../../components/Notice";
import { motion } from "../../lib/motion";
import { targetPath } from "../../app/navigation";
import { operating } from "../../app/operatingContext";
import { useSite } from "../../app/site";
import { CorrectionStatusLabel, OutcomeText, simulationSession, useSimulation } from "../simulation";
import { pilotStatusOf } from "./pilotStatus";

const STAGES = ["detection", "investigation", "proposal", "application", "outcome", "resolution"] as const;

/**
 * The pilot's findings on a recorded run, in its replay: the issue list (open, then
 * resolved) and the chosen issue's lifecycle, investigation, evidence, proposal and
 * outcomes. Read only: decisions were the operator's, in AI Pilot, while the run was live.
 */
export function Findings({
  run,
  issues,
  issueId,
  onSelect,
  latestScan,
  monitoring,
  timeZone,
}: {
  run: RunDetail;
  issues: PilotIssue[];
  issueId: string | null;
  onSelect: (id: string) => void;
  latestScan: string | null;
  monitoring: boolean;
  timeZone: string;
}) {
  const p = useStrings().pilot;
  const site = useSite();
  const open = issues.filter((i) => i.open);
  const closed = issues.filter((i) => !i.open);
  const issue = issues.find((i) => i.id === issueId);
  return (
    <div className="pilot__layout">
      <nav className="pilot-issues" aria-label={p.issues}>
        <h2 className="pilot__h">
          {p.issues} <span className="pilot__muted num">{p.openIssues(open.length)}</span>
        </h2>
        {issues.length === 0 && <p className="sim-empty">{monitoring || isFinal(run.state) ? p.noIssues : p.noIssuesOff}</p>}
        {[
          [p.openGroup, open],
          [p.resolvedGroup, closed],
        ].map(([title, list]) =>
          (list as PilotIssue[]).length ? (
            <div key={title as string}>
              <h3 className="pilot__group">{title as string}</h3>
              <ul className="pilot-issues__list">
                {(list as PilotIssue[]).map((i) => (
                  <li key={i.id}>
                    <IssueRow issue={i} onSelect={() => onSelect(i.id)} current={i.id === issueId} timeZone={timeZone} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </nav>
      <div className="pilot-detail">
        {issue ? (
          <IssueDetail key={issue.id} issue={issue} run={run} devices={site.data?.topology.devices ?? []} timeZone={timeZone} latestScan={latestScan} />
        ) : (
          <p className="sim-empty">{issueId ? p.unknownIssue(issueId) : p.selectIssue}</p>
        )}
      </div>
    </div>
  );
}

/** One issue in a list: severity, title, lifecycle stage and assessment; choosing it shows
 *  it beside or under the list. */
export function IssueRow({ issue, onSelect, current = false, timeZone }: { issue: PilotIssue; onSelect: () => void; current?: boolean; timeZone: string }) {
  const s = useStrings();
  const p = s.pilot;
  const content = (
    <>
      <span className="pilot-row__main">
        <span className={`sev sev--${issue.severity}`}>
          {s.issues.severity[issue.severity]}, {issue.id}
        </span>
        <span className="pilot-row__title">{issue.title}</span>
      </span>
      <span className="pilot-row__meta">
        <span className="pilot-stage-word">{p.stages[issue.stage]}</span>
        <span>{p.assessmentShort[issue.assessment]}</span>
        {issue.reasoning.pending && <span className="pilot-row__thinking">{p.status.investigating}</span>}
        {issue.declinedAt && <span>{p.declinedShort}</span>}
        <span className="num">{formatTime(issue.lastSeen, timeZone)}</span>
      </span>
    </>
  );
  return (
    <button type="button" className="pilot-row" data-pilot-issue={issue.id} data-stage={issue.stage} aria-pressed={current} onClick={onSelect}>
      {content}
    </button>
  );
}

/** Whether a proposal can be decided now and, if not, why: one rule for every view. */
export function decisionOf(issue: PilotIssue, run: RunDetail) {
  const corrections = issue.correctionIds.map((id) => run.corrections.find((c) => c.id === id)).filter((c) => c !== undefined);
  const latest = corrections.at(-1);
  const blocked = issue.declinedAt
    ? "declined"
    : !issue.open
      ? "resolved"
      : isFinal(run.state)
        ? "ended"
        : latest?.status === "queued"
          ? "queued"
          : issue.stage === "application" || issue.stage === "outcome"
            ? "applied"
            : issue.stage !== "proposal"
              ? "investigating"
              : null;
  const proposal = issue.proposal;
  const stale = proposal && !blocked && run.simulatedTime && Date.parse(run.simulatedTime) - Date.parse(proposal.basedOn) > run.config.stepMinutes * 60_000 ? run.simulatedTime : null;
  return { corrections, latest, blocked, stale };
}

/**
 * A finding in AI Pilot, under its row: the pilot's investigation and newest evidence and,
 * for a proposal, what it would change on which run, then Apply (through the run's
 * correction gate) or Decline. Both are explicit operator actions on the simulation only;
 * neither is reachable from the assistant. The whole record is in the run's replay.
 */
export function ProposalDecision({ issue, run, timeZone }: { issue: PilotIssue; run: RunDetail; timeZone: string }) {
  const s = useStrings();
  const p = s.pilot;
  const site = useSite();
  const busy = useSimulation().busy;
  const name = (id: string) => site.data?.topology.devices.find((d) => d.id === id)?.label ?? id;
  const t = (x: string) => formatTime(x, timeZone);
  const { corrections, blocked, stale } = decisionOf(issue, run);
  const proposal = issue.proposal;
  const block = useRef<HTMLDivElement>(null);
  useEffect(() => motion.arrive([block.current]), []);
  return (
    <div ref={block} className="pilot-decision" data-decision-for={issue.id}>
      <p className="pilot-decision__stage">
        <b>{p.stages[issue.stage]}</b> · {p.assessmentShort[issue.assessment]}
        {issue.reasoning.pending && ` · ${p.status.investigating}`}
      </p>
      {issue.reasoning.summary && <p className="pilot-decision__why">{issue.reasoning.summary}</p>}
      {proposal ? (
        <>
          <p className="pilot-decision__what">
            {p.proposalLine(name(proposal.equipmentId), proposal.label.toLowerCase(), `${proposal.value} ${proposal.unit}`, `${proposal.allowed[0]} to ${proposal.allowed[1]} ${proposal.unit}`, run.runId)}
          </p>
          <p className="pilot__muted">{proposal.rationale}</p>
          {stale && (
            <p className="pilot-stale">
              <CircleAlert size={14} aria-hidden="true" /> {p.staleProposal(t(stale))}
            </p>
          )}
          {issue.declinedAt ? (
            <p className="pilot-decision__done">{p.declinedAt(t(issue.declinedAt))}</p>
          ) : (
            <div className="pilot-proposal__actions">
              <button
                type="button"
                className="button button--primary button--small"
                aria-disabled={Boolean(blocked) || Boolean(busy) || undefined}
                aria-busy={busy === `apply:${issue.id}` || undefined}
                aria-describedby={`decide-note-${issue.id}`}
                data-pilot-control="apply"
                onClick={() => {
                  if (blocked || busy) return;
                  void simulationSession.submit(run.runId, { kind: "set", point: proposal.point, value: proposal.value, basedOn: proposal.basedOn, origin: proposal.origin });
                }}
              >
                <Send size={14} aria-hidden="true" />
                {busy === `apply:${issue.id}` ? p.applying : p.apply(run.runId)}
              </button>
              <button
                type="button"
                className="button button--small"
                aria-disabled={Boolean(blocked) || Boolean(busy) || undefined}
                aria-busy={busy === `decline:${issue.id}` || undefined}
                aria-describedby={`decide-note-${issue.id}`}
                data-pilot-control="decline"
                onClick={() => {
                  if (blocked || busy) return;
                  void simulationSession.decline(run.runId, issue.id);
                }}
              >
                <Ban size={14} aria-hidden="true" />
                {busy === `decline:${issue.id}` ? p.declining : p.decline}
              </button>
            </div>
          )}
          {blocked && blocked !== "declined" && <p className="pilot__muted">{p.applyBlocked[blocked]}</p>}
          <p id={`decide-note-${issue.id}`} className="pilot__muted pilot-decision__note">
            {p.decideNote}
          </p>
        </>
      ) : issue.advisory ? (
        <p className="pilot-advisory">
          <b>{p.advisory}.</b> {issue.advisory}
        </p>
      ) : null}
      {corrections.length > 0 && (
        <ul className="pilot-outcomes">
          {corrections.map((c) => (
            <li key={c.id} data-correction={c.id}>
              <span className="num">{c.id}</span>
              <CorrectionStatusLabel status={c.status} />
              <OutcomeText c={c} runEnded={isFinal(run.state)} />
            </li>
          ))}
        </ul>
      )}
      {issue.evidence.length > 0 && (
        <>
          <h4 className="pilot-decision__h">{p.latestEvidence}</h4>
          <ol className="pilot-decision__evidence">
            {issue.evidence.slice(-EVIDENCE).map((e) => (
              <li key={e.id} className={e.status === "error" ? "is-error" : undefined}>
                <time className="num" dateTime={e.at}>
                  {t(e.at)}
                </time>{" "}
                <span className="pilot-decision__kind">
                  {p.evidenceKinds[e.kind]}
                  {e.status === "error" && `, ${p.toolFailed}`}
                </span>{" "}
                {e.text}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** The newest evidence shown under a finding in AI Pilot. */
const EVIDENCE = 3;

export function PilotStatusNotice() {
  const s = useStrings();
  const p = s.pilot;
  const sim = useSimulation();
  const status = pilotStatusOf(sim);
  const run = sim.run && sim.run.runId === sim.runId ? sim.run : null;
  const tz = useSite().data?.site.timezone ?? "UTC";
  if (status === "no_backend") return <Notice tone="info">{sim.caps?.pilot.reason ?? sim.capsError?.message ?? p.noBackend}</Notice>;
  if (status === "no_run")
    return (
      <Notice tone="info" action={{ label: p.startInPilot, onClick: () => operating.openWorkspace("pilot") }}>
        {p.noRun}
      </Notice>
    );
  if (status === "disconnected")
    return (
      <Notice tone="warning" action={{ label: s.simulation.reconnect, onClick: simulationSession.retry }}>
        {run?.simulatedTime ? p.disconnected(formatTime(run.simulatedTime, tz)) : p.disconnectedNoRun}
      </Notice>
    );
  if (status === "ended" && run) return <Notice tone="info">{p.ended(run.runId, run.state)}</Notice>;
  if (status === "waiting" && run) return <p className="pilot__muted pilot__note">{p.pausedNote(run.runId)}</p>;
  return null;
}

export function IssueDetail({ issue, run, devices, timeZone, latestScan }: { issue: PilotIssue; run: RunDetail; devices: Device[]; timeZone: string; latestScan: string | null }) {
  const s = useStrings();
  const p = s.pilot;
  const t = (x: string) => formatTime(x, timeZone);
  const name = (id: string) => devices.find((d) => d.id === id)?.label ?? id;
  const evidenceRef = useRef<EvidenceHandle>(null);
  // Whether the proposal can still be decided, and what became of it: one rule with AI Pilot.
  const { corrections, latest, blocked, stale } = decisionOf(issue, run);
  const proposal = issue.proposal;
  const current = STAGES.indexOf(issue.stage);

  return (
    <article className="pilot-issue" aria-labelledby="pilot-issue-title" data-pilot-detail={issue.id}>
      <header className="pilot-issue__head">
        <span className={`sev sev--${issue.severity}`}>
          {s.issues.severity[issue.severity]}, {issue.id}
        </span>
        <h2 id="pilot-issue-title" className="pilot-issue__title">
          {issue.title}
        </h2>
        <p className="pilot-issue__assessment">{p.assessment[issue.assessment]}</p>
      </header>

      <ol className="pilot-stages" aria-label={p.lifecycle}>
        {STAGES.map((stage, i) => (
          <li key={stage} className={i < current ? "is-done" : i === current ? "is-current" : undefined} aria-current={i === current ? "step" : undefined}>
            <span className="pilot-stages__mark" aria-hidden="true" />
            {p.stages[stage]}
            {i < current && <span className="visually-hidden">, {p.stageDone}</span>}
          </li>
        ))}
      </ol>

      <dl className="pilot-facts">
        <div>
          <dt>{p.equipment}</dt>
          <dd>
            {issue.equipmentIds.map((id) => (
              <Link key={id} className="link pilot-equip" to={targetPath({ type: "simulation", runId: run.runId, issueId: issue.id, equipmentId: id })} aria-label={p.showInSimulation(name(id))}>
                <Crosshair size={13} aria-hidden="true" />
                {name(id)}
              </Link>
            ))}
          </dd>
        </div>
        <div>
          <dt>{p.source}</dt>
          <dd className="num">{p.sourceValue(issue.runId)}</dd>
        </div>
        <div>
          <dt>{p.firstSeen}</dt>
          <dd className="num">{t(issue.firstSeen)}</dd>
        </div>
        <div>
          <dt>{p.lastSeen}</dt>
          <dd className="num">{t(issue.lastSeen)}</dd>
        </div>
        <div>
          <dt>{p.detections}</dt>
          <dd className="num">{p.detectionsValue(issue.detections)}</dd>
        </div>
        <div>
          <dt>{p.freshness}</dt>
          <dd>{latestScan === issue.lastSeen ? p.fresh : p.notSeen(t(issue.lastSeen))}</dd>
        </div>
      </dl>

      <section className="pilot-block" aria-labelledby="pilot-inv-title">
        <h3 id="pilot-inv-title">{p.investigation}</h3>
        {issue.reasoning.pending && (
          <p className="pilot-working" role="status">
            <span className="agent-working__meter" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {p.reasoningPending}
          </p>
        )}
        {issue.reasoning.summary && <p>{issue.reasoning.summary}</p>}
        {issue.reasoning.uncertainty && (
          <p className="pilot__muted">
            <b>{p.uncertainty}:</b> {issue.reasoning.uncertainty}
          </p>
        )}
        {issue.advisory && (
          <p className="pilot-advisory">
            <b>{p.advisory}.</b> {issue.advisory}
          </p>
        )}
      </section>

      {proposal && (
        <section className="pilot-block pilot-proposal" aria-labelledby="pilot-prop-title">
          <h3 id="pilot-prop-title">
            {p.proposal} <CorrectionStatusLabel status={issue.stage === "proposal" || !latest ? "proposed" : latest.status} />
          </h3>
          <dl className="pilot-facts">
            <div>
              <dt>{p.targetRun}</dt>
              <dd className="num">{run.runId}</dd>
            </div>
            <div>
              <dt>{p.equipment}</dt>
              <dd>{name(proposal.equipmentId)}</dd>
            </div>
            <div>
              <dt>{p.point}</dt>
              <dd>{proposal.label}</dd>
            </div>
            <div>
              <dt>{p.requested}</dt>
              <dd className="num">
                {proposal.value} {proposal.unit}
              </dd>
            </div>
            <div>
              <dt>{p.allowed}</dt>
              <dd className="num">
                {proposal.allowed[0]} to {proposal.allowed[1]} {proposal.unit}
              </dd>
            </div>
            <div>
              <dt>{p.basedOn}</dt>
              <dd className="num">{p.basedOnValue(t(proposal.basedOn))}</dd>
            </div>
          </dl>
          <p>
            <b>{p.rationale}:</b> {proposal.rationale}
          </p>
          {stale && (
            <p className="pilot-stale">
              <CircleAlert size={14} aria-hidden="true" /> {p.staleProposal(t(stale))}
            </p>
          )}
          <div className="pilot-proposal__actions">
            {issue.declinedAt ? (
              <span className="pilot-decision__done">{p.declinedAt(t(issue.declinedAt))}</span>
            ) : (
              blocked && <span className="pilot__muted">{p.applyBlocked[blocked]}</span>
            )}
          </div>
          <p className="pilot__muted">{p.applyNote}</p>
        </section>
      )}

      <section className="pilot-block" aria-labelledby="pilot-out-title">
        <h3 id="pilot-out-title">{p.outcome}</h3>
        {corrections.length ? (
          <ul className="pilot-outcomes">
            {corrections.map((c) => (
              <li key={c.id} data-correction={c.id}>
                <span className="num">{c.id}</span>
                <CorrectionStatusLabel status={c.status} />
                <span className="num">
                  {c.kind === "release" ? s.simulation.releaseValue : `${c.value} ${c.unit}`}
                </span>
                <OutcomeText c={c} runEnded={isFinal(run.state)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="sim-empty">{p.noOutcome}</p>
        )}
      </section>

      <EvidenceTimeline ref={evidenceRef} issue={issue} timeZone={timeZone} />

      {issue.resolution && (
        <section className="pilot-block" aria-labelledby="pilot-res-title">
          <h3 id="pilot-res-title">{p.resolution}</h3>
          <p>{issue.resolution.summary}</p>
          <p className="pilot-res-links">
            {p.resolutionEvidence}{" "}
            {issue.resolution.evidenceIds.map((id) => {
              const n = issue.evidence.findIndex((e) => e.id === id) + 1;
              return (
                <button key={id} type="button" className="text-button" onClick={() => evidenceRef.current?.focus(id)} data-evidence-link={id}>
                  {p.evidenceLink(n)}
                </button>
              );
            })}
          </p>
        </section>
      )}
    </article>
  );
}

interface EvidenceHandle {
  focus: (id: string) => void;
}

/** Evidence in the order it was recorded, with its simulated timestamps kept. One tab
 *  stop; up and down arrows, Home and End move between entries. */
function EvidenceTimeline({ issue, timeZone, ref }: { issue: PilotIssue; timeZone: string; ref: Ref<EvidenceHandle> }) {
  const p = useStrings().pilot;
  const [active, setActive] = useState(0);
  const list = useRef<HTMLOListElement>(null);
  const n = issue.evidence.length;
  const focusAt = (i: number) => {
    setActive(i);
    list.current?.querySelectorAll<HTMLElement>("li")[i]?.focus();
  };
  useImperativeHandle(ref, () => ({ focus: (id) => focusAt(Math.max(0, issue.evidence.findIndex((e) => e.id === id))) }));
  const onKey = (e: KeyboardEvent) => {
    const next = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    focusAt(Math.min(n - 1, Math.max(0, next)));
  };
  return (
    <section className="pilot-block" aria-labelledby="pilot-ev-title">
      <h3 id="pilot-ev-title">{p.evidence}</h3>
      <p className="visually-hidden" id="pilot-ev-hint">
        {p.evidenceHint}
      </p>
      <ol ref={list} className="pilot-evidence" aria-labelledby="pilot-ev-title" aria-describedby="pilot-ev-hint" onKeyDown={onKey}>
        {issue.evidence.map((e, i) => (
          <li
            key={e.id}
            id={`ev-${e.id}`}
            tabIndex={i === Math.min(active, n - 1) ? 0 : -1}
            className={`pilot-evidence__item${e.status === "error" ? " is-error" : ""}`}
            data-evidence-kind={e.kind}
            data-evidence-status={e.status}
            onFocus={() => setActive(i)}
          >
            <time className="num" dateTime={e.at}>
              {formatTime(e.at, timeZone)}
            </time>
            <span className="pilot-evidence__kind">
              {i + 1}. {p.evidenceKinds[e.kind]}
              {e.status === "error" && <span className="pilot-evidence__failed">, {p.toolFailed}</span>}
            </span>
            <span className="pilot-evidence__text">{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
