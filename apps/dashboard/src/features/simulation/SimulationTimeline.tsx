import { useStrings } from "../../lib/i18n";
import { formatTime } from "../../lib/format";
import type { RunEvent } from "../../lib/contracts/simulation";

/** What happened in the run, newest first, at simulated time: lifecycle, corrections, failures. */
export function SimulationTimeline({ events, timeZone }: { events: RunEvent[]; timeZone: string }) {
  const s = useStrings().simulation;
  return (
    <section className="sim-section" aria-labelledby="sim-timeline-title">
      <div className="sim-section__head">
        <h2 id="sim-timeline-title">{s.timeline}</h2>
      </div>
      {events.length ? (
        <ol className="sim-timeline" aria-label={s.timelineLabel} tabIndex={0}>
          {[...events].reverse().map((e) => (
            <li key={e.id} className={`sim-timeline__item sim-timeline__item--${e.kind}`} data-event-kind={e.kind}>
              <time className="num" dateTime={e.at}>
                {formatTime(e.at, timeZone)}
              </time>
              <span className="sim-timeline__kind">{s.eventKinds[e.kind]}</span>
              <span className="sim-timeline__text">{e.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="sim-empty">{s.noEvents}</p>
      )}
    </section>
  );
}
