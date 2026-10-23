import { formatNumber } from "../lib/format";
import { useStrings } from "../lib/i18n";

/**
 * One value per category as horizontal bars, each with its label and value in words, so
 * nothing is read from the bar length alone. Bars start at zero; a negative value draws
 * to the left of it. A missing value is said, not drawn.
 */
export function BarChart({ title, bars, unit, decimals = 0 }: { title: string; bars: { label: string; value: number | null }[]; unit: string; decimals?: number }) {
  const s = useStrings();
  const values = bars.map((b) => b.value).filter((v): v is number => v !== null);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const zero = (-min / span) * 100;
  return (
    <figure className="bar-chart" aria-label={title}>
      <ul className="bar-chart__rows">
        {bars.map((b, i) => {
          const v = b.value;
          const left = v === null ? zero : v < 0 ? ((v - min) / span) * 100 : zero;
          const width = v === null ? 0 : (Math.abs(v) / span) * 100;
          return (
            <li key={`${b.label}-${i}`} className="bar-chart__row">
              <span className="bar-chart__label">{b.label}</span>
              <span className="bar-chart__track" aria-hidden="true">
                {v !== null && <span className="bar-chart__bar" style={{ left: `${left}%`, width: `${width}%` }} />}
              </span>
              <span className="bar-chart__value num">{v === null ? s.quality.unavailable : `${formatNumber(v, decimals)}${unit ? ` ${unit}` : ""}`}</span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
