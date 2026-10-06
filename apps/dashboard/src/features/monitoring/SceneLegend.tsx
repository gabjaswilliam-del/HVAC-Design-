import { useStrings } from "../../lib/i18n";
import type { Medium } from "./scene/Pipe";

const MEDIA: { medium: Medium; key: "cwHot" | "cwCool" | "chwSupply" | "chwReturn" }[] = [
  { medium: "cw-hot", key: "cwHot" },
  { medium: "cw-cool", key: "cwCool" },
  { medium: "chw-supply", key: "chwSupply" },
  { medium: "chw-return", key: "chwReturn" },
];

const STATES = ["running", "stopped", "fault", "unavailable", "stale"] as const;
const TAGS = ["frequency", "power", "temperature", "hydraulic", "neutral"] as const;

export function SceneLegend() {
  const s = useStrings();
  const l = s.monitoring.legend;
  return (
    <section className="scene-legend" aria-label={l.heading}>
      <div className="scene-legend__group">
        <h2>{l.media}</h2>
        <ul>
          {MEDIA.map(({ medium, key }) => (
            <li key={medium}>
              <span className="legend-pipe" style={{ background: `var(--${medium})` }} />
              {l[key]}
            </li>
          ))}
          <li>
            <span className="legend-pipe legend-pipe--unknown" />
            {l.unknownLink}
          </li>
        </ul>
      </div>
      <div className="scene-legend__group">
        <h2>{l.states}</h2>
        <ul>
          {STATES.map((state) => (
            <li key={state}>
              <span className={`legend-state legend-state--${state}`} />
              {s.scene.states[state]}
            </li>
          ))}
        </ul>
      </div>
      <div className="scene-legend__group">
        <h2>{l.overlays}</h2>
        <ul>
          <li>
            <span className="tag tag--attention tag--sm tag--critical legend-sample">
              <span className="tag__eye" />
              ISS
            </span>
            {l.issue}
          </li>
          <li>
            <span className="key legend-sample num">
              49.2<span className="unit">Hz</span>
            </span>
            {l.key}
          </li>
        </ul>
      </div>
      <div className="scene-legend__group">
        <h2>{l.tags}</h2>
        <ul>
          {TAGS.map((kind) => (
            <li key={kind}>
              <span className="legend-tag" style={{ background: `var(--tag-${kind}-bg)`, borderColor: `var(--tag-${kind}-line)` }} />
              {l[kind]}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
