import type { Evidence } from "../../../lib/contracts";
import type { Medium } from "../../../lib/topology";

export type { Medium };

const ARROW = "M-7 -1.7 H0 V-5 L7.5 0 L0 5 V1.7 H-7 Z";
const ARROW_FIRST = 46;
const ARROW_PITCH = 140;

interface PipeProps {
  /** Polyline in flow direction. */
  points: [number, number][];
  medium: Medium;
  /** Animate flow only when the reported state says water is moving. */
  flowing: boolean;
  /** Seconds per flow-dash cycle; lower is faster. */
  flowPeriod?: number;
  /** Unknown links are drawn as unconfirmed, without flow or direction. */
  evidence?: Evidence;
  /** Connected to the selected equipment. */
  active?: boolean;
  /** Topology link ID, exposed for tests and tooling. */
  linkId?: string;
}

/**
 * A pipe run. Drawn as a dark casing, coloured body, sheen and (when flowing) moving
 * flow dashes, with direction arrows along long segments. The casing of a later
 * pipe cuts a gap in any earlier pipe it crosses, the usual drawing convention for a
 * crossing without a connection.
 */
export function Pipe({ points, medium, flowing, flowPeriod = 1, evidence = "confirmed", active = false, linkId }: PipeProps) {
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const unknown = evidence === "unknown";

  if (unknown) {
    const [ex, ey] = points[points.length - 1];
    return (
      <g className={`pipe pipe--unknown${active ? " pipe--active" : ""}`} data-link-id={linkId}>
        <path d={d} fill="none" stroke="var(--ink-scene)" strokeWidth={9} />
        <path d={d} fill="none" stroke="var(--state-unavailable)" strokeWidth={3} strokeDasharray="7 6" />
        <circle cx={ex} cy={ey} r={8} fill="var(--panel)" stroke="var(--state-unavailable)" strokeWidth={1.2} />
        <text x={ex} y={ey + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text-muted)">
          ?
        </text>
      </g>
    );
  }

  const arrows: { x: number; y: number; angle: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    for (let at = ARROW_FIRST; at < len - 24; at += ARROW_PITCH) {
      arrows.push({ x: x0 + ((x1 - x0) * at) / len, y: y0 + ((y1 - y0) * at) / len, angle });
    }
  }

  const color = `var(--${medium})`;
  return (
    <g
      className={`pipe pipe--${medium}${flowing ? " pipe--flowing" : ""}${active ? " pipe--active" : ""}`}
      data-evidence={evidence}
      data-link-id={linkId}
    >
      {active && <path className="pipe__glow" d={d} fill="none" stroke={color} strokeWidth={17} strokeLinejoin="round" />}
      <path d={d} fill="none" stroke="var(--ink-scene)" strokeWidth={11} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={5.5} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#ffffff" strokeOpacity={0.2} strokeWidth={1.6} strokeLinejoin="round" />
      {flowing && (
        <path
          className="pipe-flow"
          d={d}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.7}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeDasharray="3 21"
          style={{ animationDuration: `${flowPeriod}s` }}
        />
      )}
      {arrows.map((a, i) => (
        <path
          key={i}
          d={ARROW}
          transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`}
          style={{ fill: `color-mix(in srgb, ${color} 30%, white)` }}
          opacity={flowing ? 0.95 : 0.4}
        />
      ))}
    </g>
  );
}
