import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Pause, Pencil, Play, Plus, SkipForward, Square, StepForward, X } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { RunCommand, RunStatus, SimulationCapabilities } from "../../lib/contracts/simulation";
import { RunStateLabel } from "./labels";
import { session, useSimulation } from "./simulationSession";

type Control = RunCommand | "startPaused";
/** The operator control each button is (what the assistant may point to). */
const CONTROL_NAME: Record<Control, string> = { start: "start", startPaused: "start", play: "resume", pause: "pause", step: "step", stop: "stop" };

/** "1:25" from minutes. */
export const hm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * The run band, held at the top while its view scrolls: the Simulation label, the run's
 * name and ID, scenario, configuration revision, simulated time (and how far into the
 * run), and the controls. Which controls exist comes from the run's state as the service
 * reports it; a click sends a service operation and its button waits for the answer.
 * Only AI Pilot operates a run; read-only (a recorded run's replay) the band shows the
 * identity and `aside` instead. `onRename` offers renaming in AI Pilot.
 */
export function RunControls({
  run,
  caps,
  timeZone,
  autoFocus = false,
  readOnly = false,
  aside,
  onNewRun,
  onRename,
}: {
  run: RunStatus;
  caps?: SimulationCapabilities;
  timeZone: string;
  /** Focus the first control on mount (the run was just started or returned to). */
  autoFocus?: boolean;
  readOnly?: boolean;
  aside?: ReactNode;
  onNewRun?: () => void;
  onRename?: (name: string) => Promise<boolean>;
}) {
  const s = useStrings().simulation;
  const busy = useSimulation().busy;
  const st = run.state;
  const group = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [renaming, setRenaming] = useState(false);
  // A command can replace the button that was pressed (Pause becomes Resume, Stop becomes
  // New simulation). Once the service has answered, focus that was lost with it moves to
  // the first control; focus the operator has moved elsewhere is left alone.
  const refocus = useRef(autoFocus);
  useEffect(() => {
    if (!refocus.current || busy) return;
    refocus.current = false;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost) group.current?.querySelector<HTMLElement>("button")?.focus();
  }, [st, busy]);

  const button = (control: Control, label: string, Icon: typeof Play, primary = false) => (
    <button
      key={control}
      type="button"
      className={`button${primary ? " button--primary" : ""}`}
      aria-disabled={Boolean(busy) || undefined}
      aria-busy={busy === control || undefined}
      data-pilot-control={CONTROL_NAME[control]}
      onClick={() => {
        if (busy) return;
        refocus.current = true;
        if (control === "start" || control === "startPaused") void session.start(run.runId, control === "start");
        else void session.command(run.runId, control);
      }}
    >
      <Icon size={15} aria-hidden="true" />
      {busy === control ? s.busy[control] : label}
    </button>
  );

  const controls = readOnly
    ? []
    : st === "created"
      ? [button("start", s.start, Play, true), button("startPaused", s.startPaused, StepForward)]
      : st === "paused"
        ? [button("play", s.resume, Play, true), caps?.controls.step && button("step", s.step, SkipForward), button("stop", s.stop, Square)]
        : st === "running"
          ? [button("pause", s.pause, Pause, true), button("stop", s.stop, Square)]
          : onNewRun
            ? [
                // Raised, not laminate: once a run has ended, its replay is the primary step.
                <button key="new" type="button" className="button" onClick={onNewRun}>
                  <Plus size={15} aria-hidden="true" />
                  {s.newRun}
                </button>,
              ]
            : [];
  const planned = Math.round(run.config.durationHours * 60);

  return (
    <section className="sim-run" aria-labelledby={titleId} data-run={run.runId}>
      <div className="sim-run__identity">
        <span className="tag-chip tag-chip--notice">{s.label}</span>
        {renaming && onRename ? (
          <RenameForm name={run.name} runId={run.runId} onRename={onRename} onDone={() => setRenaming(false)} />
        ) : (
          <h2 id={titleId} className="sim-run__title">
            <span className="sim-run__name" data-run-name>
              {run.name}
            </span>{" "}
            <span className="sim-run__id num">{run.runId}</span>
          </h2>
        )}
        <RunStateLabel state={st} />
        {onRename && !renaming && (
          <button type="button" className="icon-button sim-run__rename" aria-label={s.rename(run.runId)} title={s.rename(run.runId)} onClick={() => setRenaming(true)}>
            <Pencil size={14} aria-hidden="true" />
          </button>
        )}
        <dl className="sim-run__facts">
          <div>
            <dt>{s.scenario}</dt>
            <dd>{run.scenario.label}</dd>
          </div>
          <div>
            <dt>{s.revision}</dt>
            <dd className="num">{run.configRevision}</dd>
          </div>
          <div>
            <dt>{s.simTime}</dt>
            <dd className="num" data-sim-time>
              {run.simulatedTime ? formatTime(run.simulatedTime, timeZone) : s.notStarted}
            </dd>
          </div>
          <div>
            <dt>{s.elapsed}</dt>
            <dd className="num" data-elapsed>
              {s.elapsedValue(hm(run.stats.simulatedMinutes), hm(planned))}
            </dd>
          </div>
        </dl>
        <progress className="sim-run__progress" max={run.stepsTotal} value={run.stepsTaken} aria-label={s.progress} aria-valuetext={s.progressValue(run.stepsTaken, run.stepsTotal, run.config.stepMinutes)} />
      </div>
      {/* A read-only record has links here, not controls. */}
      <div ref={group} className="sim-run__controls" role={readOnly ? undefined : "group"} aria-label={readOnly ? undefined : s.controls}>
        {controls}
        {aside}
      </div>
    </section>
  );
}

/** Rename in place: Enter saves, Escape keeps the name; a name is 1 to 60 characters. */
function RenameForm({ name, runId, onRename, onDone }: { name: string; runId: string; onRename: (name: string) => Promise<boolean>; onDone: () => void }) {
  const s = useStrings().simulation;
  const id = useId();
  const [value, setValue] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  const invalid = value.trim().length === 0 || value.trim().length > 60;
  useEffect(() => {
    input.current?.select();
  }, []);
  const save = async () => {
    if (invalid) return;
    if (value.trim() === name || (await onRename(value.trim()))) onDone();
  };
  return (
    <form
      className="sim-rename"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor={`${id}-name`} className="visually-hidden">
        {s.runName(runId)}
      </label>
      <input
        ref={input}
        id={`${id}-name`}
        className="select"
        value={value}
        maxLength={60}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <span id={`${id}-hint`} className={invalid ? "sim-field__error sim-rename__hint" : "visually-hidden"}>
        {s.nameHint}
      </span>
      <button type="submit" className="icon-button" aria-label={s.saveName} title={s.saveName} aria-disabled={invalid || undefined}>
        <Check size={15} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" aria-label={s.cancelRename} title={s.cancelRename} onClick={onDone}>
        <X size={15} aria-hidden="true" />
      </button>
    </form>
  );
}
