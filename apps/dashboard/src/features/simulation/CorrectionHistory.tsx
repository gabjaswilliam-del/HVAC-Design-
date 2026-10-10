import { useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { Send, Undo2 } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { Device, MetricInfo } from "../../lib/contracts";
import { isFinal, type Correction, type RunDetail, type SimulationCapabilities } from "../../lib/contracts/simulation";
import { targetPath } from "../../app/navigation";
import { CorrectionStatusLabel, OutcomeText } from "./labels";
import { session, useSimulation } from "./simulationSession";

interface Props {
  run: RunDetail;
  caps: SimulationCapabilities;
  devices: Device[];
  metrics: MetricInfo[];
  timeZone: string;
  /** Equipment chosen on the simulated plant; the form offers its first point. */
  equipmentId: string | null;
  /** A recorded run's replay: the record only, no form and no release. */
  readOnly?: boolean;
  /** In the AI Pilot console: its own heading level and a narrow layout. */
  compact?: boolean;
  /** In AI Pilot, a pilot correction's issue is chosen there; elsewhere it is a link to the replay's finding. */
  onIssue?: (issueId: string) => void;
}

/**
 * Corrections to the simulated plant: a form that shows the target run and the allowed
 * range, the held manual overrides with explicit release, and the ledger of everything
 * submitted. A successful submission is "queued", never "applied": the run's gate and
 * its next step decide, and the outcome is measured after that.
 */
export function CorrectionHistory({ run, caps, devices, metrics, timeZone, equipmentId, readOnly = false, compact = false, onIssue }: Props) {
  const s = useStrings().simulation;
  const name = (id: string) => devices.find((d) => d.id === id)?.label ?? id;
  const busy = useSimulation().busy;
  const id = useId();
  const points = caps.points;
  const [point, setPoint] = useState(points[0].point);
  const [value, setValue] = useState("");
  const [tried, setTried] = useState(false);
  const [answer, setAnswer] = useState<Correction | null>(null);
  const p = points.find((x) => x.point === point)!;
  const heldNow = run.overrides.find((o) => o.point === point);
  const reading = run.frame?.values[p.readingKey]?.value ?? null;
  const readingLabel = metrics.find((m) => m.key === p.readingKey)?.label ?? p.readingKey;
  // Under baseline control a chiller holds the run's configured setpoint; a tower fan is
  // set by the controller, so only its reading is known.
  const baseline = p.metric === "chilled_water_temp_set" ? `${run.config.chwSetpointC} ${p.unit}` : null;
  const ended = isFinal(run.state);
  const Sub = compact ? "h4" : "h3";

  // Choosing equipment on the plant offers its first point.
  useEffect(() => {
    const first = points.find((x) => x.equipmentId === equipmentId);
    if (first) setPoint(first.point);
  }, [equipmentId]);

  const n = Number(value);
  const invalid = value.trim() === "" || !Number.isFinite(n) || n < p.min || n > p.max;
  const inactive = run.state === "created" ? s.inactive.created : ended ? s.inactive.ended : null;
  const showError = invalid && (tried || value.trim() !== "");

  const submit = async () => {
    setTried(true);
    // The basis is the newest observation shown: the gate rejects it if the run has moved on.
    if (invalid || inactive || busy || !run.simulatedTime) return;
    const c = await session.submit(run.runId, { kind: "set", point, value: n, basedOn: run.simulatedTime, origin: { kind: "operator" } });
    if (c) {
      setAnswer(c);
      setTried(false);
    }
  };
  const release = async (target: string) => {
    if (inactive || busy || !run.simulatedTime) return;
    const c = await session.submit(run.runId, { kind: "release", point: target, value: null, basedOn: run.simulatedTime, origin: { kind: "operator" } });
    if (c) setAnswer(c);
  };

  return (
    <section className={compact ? "sim-section sim-section--compact" : "sim-section"} aria-labelledby={`${id}-title`}>
      <div className="sim-section__head">
        {compact ? <h3 id={`${id}-title`}>{s.corrections}</h3> : <h2 id={`${id}-title`}>{s.corrections}</h2>}
      </div>
      <p className="sim-muted">{readOnly ? s.correctionsRecord : s.correctionsNote}</p>
      {!readOnly && (
        <form
          className="sim-correct"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="sim-field">
            <label htmlFor={`${id}-point`}>{s.target}</label>
            <select id={`${id}-point`} className="select" value={point} aria-describedby={`${id}-now`} onChange={(e) => setPoint(e.target.value)}>
              {points.map((x) => (
                <option key={x.point} value={x.point}>
                  {s.targetOption(name(x.equipmentId), x.label, x.unit)}
                </option>
              ))}
            </select>
            <small id={`${id}-now`}>
              {heldNow
                ? s.nowHeld(`${heldNow.value} ${p.unit}`, formatTime(heldNow.since, timeZone), heldNow.correctionId)
                : s.nowBaseline(baseline, reading === null ? null : `${readingLabel.toLowerCase()} ${reading} ${p.unit}`)}
            </small>
          </div>
          <div className="sim-field">
            <label htmlFor={`${id}-value`}>{s.value(p.unit)}</label>
            <input
              id={`${id}-value`}
              className="select num"
              type="number"
              inputMode="decimal"
              min={p.min}
              max={p.max}
              step={p.step}
              value={value}
              aria-invalid={showError || undefined}
              aria-describedby={`${id}-hint`}
              onChange={(e) => setValue(e.target.value)}
            />
            <small id={`${id}-hint`} className={showError ? "sim-field__error" : undefined}>
              {showError ? s.valueError(p.min, p.max, p.unit) : s.allowedHint(p.min, p.max, p.unit, run.runId)}
            </small>
          </div>
          <div className="sim-correct__actions">
            <button
              type="submit"
              className="button"
              aria-disabled={Boolean(inactive) || Boolean(busy) || undefined}
              aria-busy={busy === `correct:${point}` || undefined}
              data-pilot-control="corrections"
            >
              <Send size={14} aria-hidden="true" />
              {busy === `correct:${point}` ? s.submitting : s.submit(run.runId)}
            </button>
            {inactive && <span className="sim-muted">{inactive}</span>}
          </div>
          <p className="sim-answer" role="status">
            {answer &&
              (answer.status === "rejected" ? (
                <span className="sim-answer--rejected">{s.answer.rejected(answer.id, answer.rejection?.reason ?? "")}</span>
              ) : (
                s.answer.queued(answer.id)
              ))}
          </p>
        </form>
      )}

      <Sub className="sim-subhead">{s.overrides}</Sub>
      {run.overrides.length ? (
        <ul className="sim-overrides">
          {run.overrides.map((o) => (
            <li key={o.point} data-override={o.point}>
              <span className="sim-overrides__what">
                <b>{name(o.equipmentId)}</b> {o.label.toLowerCase()}
              </span>
              <span className="num sim-overrides__value">
                {o.value} {o.unit}
              </span>
              <span className="sim-muted num">{s.heldBy(o.correctionId, formatTime(o.since, timeZone))}</span>
              {caps.controls.release && !readOnly && (
                <button
                  type="button"
                  className="button button--small"
                  aria-disabled={Boolean(inactive) || Boolean(busy) || undefined}
                  aria-label={s.releaseLabel(name(o.equipmentId), o.label)}
                  onClick={() => void release(o.point)}
                >
                  <Undo2 size={14} aria-hidden="true" />
                  {s.release}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sim-empty">{s.noOverrides}</p>
      )}

      <Sub className="sim-subhead">{s.history}</Sub>
      {run.corrections.length ? (
        <ol className="sim-ledger" aria-label={s.historyLabel}>
          {[...run.corrections].reverse().map((c) => (
            <li key={c.id} data-correction={c.id}>
              <div className="sim-ledger__head">
                <span className="num sim-ledger__id">{c.id}</span>
                <CorrectionStatusLabel status={c.status} />
                <span className="sim-ledger__origin">
                  {c.origin.kind === "pilot" ? (
                    onIssue ? (
                      <button type="button" className="text-button" data-issue-link={c.origin.issueId} onClick={(e) => onIssue(e.currentTarget.dataset.issueLink!)}>
                        {s.origin.pilot}, {c.origin.issueId}
                      </button>
                    ) : (
                      <Link className="link" to={targetPath({ type: "simulation", runId: c.runId, issueId: c.origin.issueId })}>
                        {s.origin.pilot}, {c.origin.issueId}
                      </Link>
                    )
                  ) : (
                    s.origin.operator
                  )}
                </span>
              </div>
              <p className="sim-ledger__what">
                {name(c.equipmentId)}, {c.label.toLowerCase()}: <b className="num">{c.kind === "release" ? s.releaseValue : `${c.value} ${c.unit}`}</b>
              </p>
              <p className="sim-ledger__meta num">
                {s.ledgerMeta(c.point, `${c.allowed[0]} to ${c.allowed[1]} ${c.unit}`, c.runId, formatTime(c.submittedAt, timeZone))}
                {c.applied && `. ${s.appliedAt(c.applied.step, formatTime(c.applied.at, timeZone))}`}
              </p>
              <p className="sim-ledger__outcome">
                <OutcomeText c={c} runEnded={ended} />
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sim-empty">{s.noHistory}</p>
      )}
    </section>
  );
}
