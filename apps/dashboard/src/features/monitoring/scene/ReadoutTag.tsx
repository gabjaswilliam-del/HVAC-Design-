import { useStrings } from "../../../lib/i18n";

export type MetricKind = "frequency" | "power" | "temperature" | "hydraulic" | "neutral";
export type Quality = "good" | "stale" | "unavailable";

interface ReadoutTagProps {
  x: number;
  y: number;
  kind: MetricKind;
  value: number | null;
  unit: string;
  decimals?: number;
  /** Optional label drawn to the left, right-aligned against the box. */
  label?: string;
  /** Space between label and box, e.g. to leave room for a sensor head. */
  labelGap?: number;
  quality?: Quality;
  width?: number;
}

const HEIGHT = 22;

/**
 * Measurement tag: [label] [value box] unit. The box frame colour encodes the metric
 * kind (frequency, electrical power, temperature, pressure/flow, neutral (load %, thermal kW)). A missing value reads
 * "Unavailable", never zero; a stale value is dimmed with a clock mark.
 */
export function ReadoutTag({
  x,
  y,
  kind,
  value,
  unit,
  decimals = 1,
  label,
  labelGap = 7,
  quality = "good",
  width = 58,
}: ReadoutTagProps) {
  const s = useStrings();
  const missing = quality === "unavailable" || value === null;
  const stale = quality === "stale" && !missing;
  // "Unavailable" needs more room than a number; the unit is hidden in that case.
  const boxWidth = missing ? Math.max(width, 72) : width;

  return (
    <g className={`tag tag--${kind}${stale ? " tag--stale" : ""}${missing ? " tag--missing" : ""}`} transform={`translate(${x} ${y})`}>
      {label && (
        <text x={-labelGap} y={15.5} textAnchor="end" className="tag__label">
          {label}
        </text>
      )}
      <rect className="tag__box" width={boxWidth} height={HEIGHT} rx={2.5} />
      {missing ? (
        <text x={boxWidth / 2} y={15} textAnchor="middle" className="tag__missing">
          {s.scene.valueUnavailable}
        </text>
      ) : (
        <>
          {stale && (
            <g transform="translate(9 11)" className="tag__clock">
              <title>{s.scene.staleValue}</title>
              <circle r={4.6} fill="none" />
              <path d="M0 -2.6 V0 H2.2" fill="none" />
            </g>
          )}
          <text x={width - 6} y={16} textAnchor="end" className="tag__value num">
            {value.toFixed(decimals)}
          </text>
        </>
      )}
      {!missing && (
        <text x={width + 6} y={15.5} className="tag__unit">
          {unit}
        </text>
      )}
    </g>
  );
}
