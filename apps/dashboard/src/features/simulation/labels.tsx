import { CircleCheck, CircleDashed, CircleStop, CircleSlash, CircleX, Clock, Pause, Play, Replace, TimerOff, TriangleAlert, type LucideIcon } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { Correction, RunState } from "../../lib/contracts/simulation";

// State as an icon and a word; colour is secondary (DESIGN.md). A failed run or a
// rejected correction is caution, never the alarm red.
const RUN: Record<RunState, LucideIcon> = { created: CircleDashed, running: Play, paused: Pause, stopped: CircleStop, failed: TriangleAlert };

export function RunStateLabel({ state }: { state: RunState }) {
  const s = useStrings().simulation;
  const Icon = RUN[state];
  return (
    <span className={`state-label sim-state sim-state--${state}`} data-run-state={state}>
      <Icon size={14} aria-hidden="true" />
      {s.state[state]}
    </span>
  );
}

/** A loading placeholder that says what is loading: a polite status with real text (a
 *  label on a plain div is not read out). */
export function Loading({ label }: { label: string }) {
  return (
    <div className="sim-loading skeleton" role="status">
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

const CORRECTION: Record<Correction["status"] | "proposed", LucideIcon> = {
  proposed: CircleDashed,
  queued: Clock,
  rejected: CircleX,
  superseded: Replace,
  expired: TimerOff,
  applied: CircleCheck,
};

export function CorrectionStatusLabel({ status }: { status: Correction["status"] | "proposed" }) {
  const s = useStrings().simulation;
  const Icon = CORRECTION[status] ?? CircleSlash;
  return (
    <span className={`state-label cor-state cor-state--${status}`} data-correction-status={status}>
      <Icon size={14} aria-hidden="true" />
      {s.status[status]}
    </span>
  );
}

/** What became of a correction: the gate's reason for a rejection, or what the plant did
 *  about an applied one (measured after the step that took it). */
export function OutcomeText({ c, runEnded }: { c: Correction; runEnded: boolean }) {
  const s = useStrings().simulation;
  if (c.status !== "applied") return c.rejection ? <span className="cor-reason">{c.rejection.reason}</span> : null;
  if (!c.outcome) return <span className="cor-muted">{runEnded ? s.outcomeNotMeasured : s.outcomePending}</span>;
  const o = c.outcome;
  return (
    <span className={o.reached ? "cor-outcome" : "cor-outcome cor-outcome--short"} data-outcome={o.reached ? "reached" : "short"}>
      {o.note}
    </span>
  );
}
