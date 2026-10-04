import { Pause, Play } from "lucide-react";
import { useStrings } from "../lib/i18n";
import { formatDateTime, formatTime } from "../lib/format";
import { DAY_START, MINUTE_MS, STEP_MIN } from "../fixtures/generate";
import { DAY_END, operating, REPLAY_SPEEDS, useOperating } from "./operatingContext";

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

/** Live/replay control for the demo source clock. Never steps a simulation. */
export function PlaybackBar({ timeZone, timezoneLabel }: { timeZone: string; timezoneLabel: string }) {
  const s = useStrings();
  const p = s.playback;
  const { cursor, mode, playing, speed } = useOperating((x) => x);

  return (
    <section className="playback" aria-label={p.label}>
      <div className="segmented" role="group" aria-label={p.label}>
        <button type="button" aria-pressed={mode === "live"} onClick={() => operating.setMode("live")}>
          {p.live}
        </button>
        <button type="button" aria-pressed={mode === "replay"} onClick={() => operating.setMode("replay")}>
          {p.replay}
        </button>
      </div>
      {mode === "replay" && (
        <>
          <button
            type="button"
            className="tool-button"
            aria-label={playing ? p.pause : p.play}
            title={playing ? p.pause : p.play}
            onClick={() => operating.setPlaying(!playing)}
          >
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>
          <label className="playback__speed">
            <span className="visually-hidden">{p.speed}</span>
            <select className="select" value={speed} onChange={(e) => operating.setSpeed(Number(e.target.value))}>
              {REPLAY_SPEEDS.map((x) => (
                <option key={x} value={x}>
                  {x}×
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <div className="playback__track">
        <input
          type="range"
          className="playback__range"
          aria-label={p.time}
          min={DAY_START}
          max={DAY_END}
          step={STEP_MIN * MINUTE_MS}
          value={cursor}
          aria-valuetext={`${formatTime(cursor, timeZone)} ${timezoneLabel}`}
          disabled={mode === "live"}
          onChange={(e) => {
            operating.setPlaying(false);
            operating.setCursor(Number(e.target.value));
          }}
        />
        <div className="playback__ticks" aria-hidden="true">
          {HOURS.map((h) => (
            <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>
      <div className="playback__now num">
        <span className="playback__source">{mode === "live" ? p.sourceLive : p.sourceReplay}</span>
        <strong>
          {formatDateTime(cursor, timeZone)} ({timezoneLabel})
        </strong>
      </div>
    </section>
  );
}
