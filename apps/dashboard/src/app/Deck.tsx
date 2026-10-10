import { Clock, Pause, Play } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { formatAgeMinutes, formatTime } from "../lib/format";
import { DAY_START, MINUTE_MS, STEP_MIN } from "../fixtures/generate";
import { RadioGroup } from "../components/RadioGroup";
import { DAY_END, operating, REPLAY_SPEEDS, useOperating, type PlaybackMode } from "./operatingContext";
import { useSite, useSnapshot } from "./site";

const TICKS = [0, 6, 12, 18, 24];

/**
 * The deck under the plant: the data source (live or replay), playback, the day's
 * timeline and the one clock, with how fresh the readings are. The playback clock is the
 * demo's source clock; it never steps a simulation. There is no scenario switch here:
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
        options={[
          { value: "live", label: p.live },
          { value: "replay", label: p.replay },
        ]}
      />
      {mode === "replay" && (
        <>
          <button
            type="button"
            className="icon-button"
            aria-label={playing ? p.pause : p.play}
            title={playing ? p.pause : p.play}
            onClick={() => operating.setPlaying(!playing)}
          >
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>
          <label className="deck__speed">
            <span className="visually-hidden">{p.speed}</span>
            <select className="select select--quiet" value={speed} onChange={(e) => operating.setSpeed(Number(e.target.value))}>
              {REPLAY_SPEEDS.map((x) => (
                <option key={x} value={x}>
                  {x}×
                </option>
              ))}
            </select>
          </label>
        </>
      )}
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
