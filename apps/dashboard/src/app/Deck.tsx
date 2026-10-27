import { Clock, Pause, Play } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { formatAgeMinutes, formatTime } from "../lib/format";
import { DAY_START, MINUTE_MS, STEP_MIN } from "../fixtures/generate";
import { RadioGroup } from "../components/RadioGroup";
import { DAY_END, operating, REPLAY_SPEEDS, useOperating, type PlaybackMode } from "./operatingContext";
import { useSite, useSnapshot } from "./site";
import { usePilotRunning } from "../features/simulation";

const TICKS = [0, 6, 12, 18, 24];

/**
 * The deck under the plant: the data source (live or replay), Run simulation, the day's
 * timeline and the one clock, with how fresh the readings are. Run simulation plays the
 * demo's source clock, and the Overview shows the plant running only while it plays; it
 * never steps an AI Pilot simulation run. There is no scenario switch here:
 * simulations choose their scenario in AI Pilot, and the demo telemetry's scenario comes
 * with the address (`?scenario=`) or a conversation's recorded context.
 */
export function Deck({ inert }: { inert?: boolean }) {
  const s = useStrings();
  const p = s.playback;
  const d = s.deck;
  const site = useSite();
  const snapshot = useSnapshot();
  const { cursor, mode, playing, speed } = useOperating((x) => x);
  const tz = site.data?.site.timezone ?? "UTC";
  const tzLabel = site.data?.site.timezoneLabel ?? "";
  const snap = snapshot.data;
  const age = formatAgeMinutes(snap?.latestSampleAt ?? null, Date.parse(snapshot.at));
  const progress = ((cursor - DAY_START) / (DAY_END - DAY_START)) * 100;
  const replay = mode === "replay";
  // An AI Pilot run keeps its own clock, so pausing here does not stop it: the replay waits.
  const pilotRunning = usePilotRunning();
  const runBlocked = replay && !playing && pilotRunning;
  const runLabel = replay ? (playing ? p.pauseReplay : p.playReplay) : playing ? p.pauseRun : p.run;

  let fresh: { text: string; stale: boolean } | null = null;
  if (snap?.connection === "disconnected" && snap.latestSampleAt) fresh = { text: d.stale(formatTime(snap.latestSampleAt, tz), age ?? 0), stale: true };
  else if (snap && snap.latestSampleAt && age) fresh = { text: d.stale(formatTime(snap.latestSampleAt, tz), age), stale: true };
  else if (snap) fresh = { text: d.current(mode === "live"), stale: false };
  else if (snapshot.error) fresh = { text: d.noReadings, stale: true };

  return (
    <footer className="deck" aria-label={d.label} inert={inert}>
      <RadioGroup<PlaybackMode>
        className="segmented--small"
        label={d.source}
        value={mode}
        onChange={(m) => operating.setMode(m)}
        // While one runs the other cannot be chosen: pause first.
        options={[
          { value: "live", label: p.live, disabled: playing && mode === "replay", title: playing && mode === "replay" ? p.pauseReplayFirst : undefined },
          {
            value: "replay",
            label: p.replay,
            disabled: (playing && mode === "live") || pilotRunning,
            title: pilotRunning ? p.pausePilotFirst : playing && mode === "live" ? p.pauseSimFirst : undefined,
          },
        ]}
      />
      {/* The one switch for the simulation, in both sources: the plant on the Overview
          runs, and the clock moves, only while it plays. */}
      <button
        type="button"
        className={`button button--small deck__run${playing ? "" : " button--primary"}`}
        title={runBlocked ? p.pausePilotFirst : runLabel}
        disabled={runBlocked}
        onClick={() => operating.setPlaying(!playing)}
      >
        {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        <span className="deck__run-label">{runLabel}</span>
      </button>
      {!playing && <span className="deck__off">{d.plantOff}</span>}
      <label className="deck__speed">
        <span className="visually-hidden">{p.speed}</span>
        <select className="select select--quiet" value={speed} title={p.speed} onChange={(e) => operating.setSpeed(Number(e.target.value))}>
          {REPLAY_SPEEDS.map((x) => (
            <option key={x} value={x}>
              {x}×
            </option>
          ))}
        </select>
      </label>
      <div className="timeline" style={{ "--progress": `${progress}%` } as React.CSSProperties}>
        <input
          type="range"
          className="timeline__range"
          aria-label={p.time}
          min={DAY_START}
          max={DAY_END}
          step={STEP_MIN * MINUTE_MS}
          value={cursor}
          aria-valuetext={`${formatTime(cursor, tz)} ${tzLabel}`}
          disabled={mode === "live"}
          onChange={(e) => {
            operating.setPlaying(false);
            operating.setCursor(Number(e.target.value));
          }}
        />
        <div className="timeline__ticks" aria-hidden="true">
          {TICKS.map((h) => (
            <span key={h}>{String(h).padStart(2, "0")}</span>
          ))}
        </div>
      </div>
      <div className="clock">
        <span className="clock__time num">
          {formatTime(snap?.at ?? snapshot.at, tz)} <span className="unit">{tzLabel}</span>
        </span>
        {fresh && (
          <span className={`clock__fresh num${fresh.stale ? " is-stale" : ""}`}>
            {fresh.stale && <Clock size={12} aria-hidden="true" />}
            {fresh.text}
          </span>
        )}
      </div>
    </footer>
  );
}
