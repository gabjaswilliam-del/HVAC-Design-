import { useEffect, useId, useRef, useState } from "react";
import { Play, StepForward } from "lucide-react";
import { useStrings } from "../../lib/i18n";
import type { SimulationCapabilities } from "../../lib/contracts/simulation";
import { session, useSimulation } from "./simulationSession";

const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** The scenario day's last sample: a run must end by then. */
const LAST_MINUTE = 23 * 60 + 55;
const newNonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * AI Pilot's launch form: a new simulation configured only from what the service
 * advertises (scenarios, durations, timesteps, setpoint range), with the topology it uses
 * and the model's known limits. Starting it also has the pilot monitor it. The request
 * ID is the same for every submission of one configuration until a run is created, so a
 * repeated click or a retry can never create a second run, while a changed configuration
 * is a new request.
 */
export function ScenarioForm({
  caps,
  devices,
  autoFocus,
  onCancel,
  cancelLabel,
}: {
  caps: SimulationCapabilities;
  devices: number;
  autoFocus: boolean;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const s = useStrings().simulation;
  const f = s.form;
  const id = useId();
  const busy = useSimulation().busy;
  const first = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [scenarioId, setScenarioId] = useState(caps.scenarios[0].id);
  const [start, setStart] = useState(toHHMM(caps.scenarios[0].defaultStartMinute));
  const [hours, setHours] = useState(caps.durationsHours[1] ?? caps.durationsHours[0]);
  const [step, setStep] = useState(caps.stepsMinutes[0]);
  const [chw, setChw] = useState(String(caps.chwSetpoint.default));
  const [nonce, setNonce] = useState(newNonce);
  const [touched, setTouched] = useState(false);
  const scenario = caps.scenarios.find((x) => x.id === scenarioId)!;

  useEffect(() => {
    if (autoFocus) first.current?.focus();
  }, []);

  const [hh, mm] = start.split(":").map(Number);
  const startMinute = hh * 60 + mm;
  const endMinute = startMinute + hours * 60;
  const chwValue = Number(chw);
  const startError = !/^\d{2}:\d{2}$/.test(start) || mm % 5 !== 0 ? f.startStep : endMinute > LAST_MINUTE ? f.endsLate(toHHMM(endMinute % 1440)) : null;
  const chwError =
    chw.trim() === "" || !Number.isFinite(chwValue) || chwValue < caps.chwSetpoint.min || chwValue > caps.chwSetpoint.max
      ? f.outOfRange(caps.chwSetpoint.min, caps.chwSetpoint.max)
      : null;
  const nameError = name.trim().length > 60 ? f.nameTooLong : null;
  const invalid = Boolean(startError || chwError || nameError);

  const submit = async (paused: boolean) => {
    setTouched(true);
    if (invalid || busy) return;
    const config = { scenarioId, startMinute, durationHours: hours, stepMinutes: step, chwSetpointC: chwValue };
    const label = name.trim() || undefined;
    const started = await session.launch(config, `${nonce}:${label ?? ""}:${scenarioId}:${startMinute}:${hours}:${step}:${chwValue}`, paused, label);
    if (started) {
      setNonce(newNonce());
      setName("");
    }
  };

  return (
    <form
      className="sim-form"
      aria-labelledby={`${id}-title`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <h2 id={`${id}-title`}>{f.heading}</h2>
      <div className="sim-form__grid">
        <div className="sim-field sim-field--wide">
          <label htmlFor={`${id}-name`}>{f.name}</label>
          <input
            ref={first}
            id={`${id}-name`}
            className="select"
            value={name}
            maxLength={80}
            placeholder={f.namePlaceholder}
            aria-invalid={Boolean(nameError) || undefined}
            aria-describedby={`${id}-name-note`}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
          <small id={`${id}-name-note`} className={nameError ? "sim-field__error" : undefined}>
            {nameError ?? f.nameHint}
          </small>
        </div>
        <div className="sim-field sim-field--wide">
          <label htmlFor={`${id}-scenario`}>{f.scenario}</label>
          <select
            id={`${id}-scenario`}
            className="select"
            value={scenarioId}
            aria-describedby={`${id}-scenario-note`}
            onChange={(e) => {
              const next = caps.scenarios.find((x) => x.id === e.target.value)!;
              setScenarioId(next.id);
              setStart(toHHMM(next.defaultStartMinute));
            }}
          >
            {caps.scenarios.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <small id={`${id}-scenario-note`}>{scenario.description}</small>
        </div>
        <div className="sim-field">
          <label htmlFor={`${id}-start`}>{f.startTime}</label>
          <input
            id={`${id}-start`}
            className="select num"
            type="time"
            step={300}
            value={start}
            aria-invalid={(touched && Boolean(startError)) || undefined}
            aria-describedby={touched && startError ? `${id}-start-error` : undefined}
            onChange={(e) => setStart(e.target.value)}
          />
          {touched && startError && (
            <small id={`${id}-start-error`} className="sim-field__error">
              {startError}
            </small>
          )}
        </div>
        <div className="sim-field">
          <label htmlFor={`${id}-hours`}>{f.duration}</label>
          <select id={`${id}-hours`} className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {caps.durationsHours.map((h) => (
              <option key={h} value={h}>
                {f.hours(h)}
              </option>
            ))}
          </select>
        </div>
        <div className="sim-field">
          <label htmlFor={`${id}-step`}>{f.step}</label>
          <select id={`${id}-step`} className="select" value={step} onChange={(e) => setStep(Number(e.target.value))}>
            {caps.stepsMinutes.map((m) => (
              <option key={m} value={m}>
                {f.minutes(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="sim-field">
          <label htmlFor={`${id}-chw`}>{f.chw}</label>
          <input
            id={`${id}-chw`}
            className="select num"
            type="number"
            inputMode="decimal"
            min={caps.chwSetpoint.min}
            max={caps.chwSetpoint.max}
            step={0.1}
            value={chw}
            aria-invalid={(touched && Boolean(chwError)) || undefined}
            aria-describedby={`${id}-chw-note`}
            onChange={(e) => setChw(e.target.value)}
          />
          <small id={`${id}-chw-note`} className={touched && chwError ? "sim-field__error" : undefined}>
            {touched && chwError ? chwError : f.chwHint(caps.chwSetpoint.min, caps.chwSetpoint.max)}
          </small>
        </div>
      </div>
      <p className="sim-form__meta">{f.topology(caps.topologyFamily, caps.configRevision, devices)}</p>
      <details className="sim-form__limits">
        <summary>{f.limits}</summary>
        <ul>
          {caps.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </details>
      <p className="sim-form__meta">{f.monitorNote}</p>
      <div className="sim-form__actions">
        <button type="submit" className="button button--primary" aria-disabled={Boolean(busy) || undefined} aria-busy={busy === "launch" || undefined} data-pilot-control="start">
          <Play size={15} aria-hidden="true" />
          {busy === "launch" ? f.starting : f.start}
        </button>
        <button type="button" className="button" aria-disabled={Boolean(busy) || undefined} aria-busy={busy === "launchPaused" || undefined} onClick={() => void submit(true)}>
          <StepForward size={15} aria-hidden="true" />
          {busy === "launchPaused" ? f.starting : f.startPaused}
        </button>
        {onCancel && (
          <button type="button" className="button button--quiet" onClick={onCancel}>
            {cancelLabel ?? f.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
