import { materials, paint, type OperatingState } from "./materials";
import type { Medium } from "./Pipe";

/** Motorised isolation valve drawn as a ring with a ball, centred on a pipe. */
export function RingValve({ x, y, medium, open }: { x: number; y: number; medium: Medium; open: boolean }) {
  return (
    <g className="eq-symbol" transform={`translate(${x} ${y})`}>
      <circle r={9} fill="var(--ink-scene)" stroke={`var(--${medium})`} strokeWidth={1.8} />
      <circle r={5} fill={paint(open ? "running" : "stopped", "disc")} />
      <circle cx={-1.6} cy={-1.8} r={1.4} fill="#ffffff" opacity={0.55} />
    </g>
  );
}

/**
 * Two-way control valve (bow-tie body, actuator on a stem). `vertical` rotates the
 * body for a vertical pipe; the actuator always stands upright.
 */
export function BowtieValve({
  x,
  y,
  state,
  vertical = false,
}: {
  x: number;
  y: number;
  state: OperatingState;
  vertical?: boolean;
}) {
  return (
    <g className="eq-symbol" transform={`translate(${x} ${y})`}>
      <path
        d="M-11 -7 L0 0 L-11 7 Z M11 -7 L0 0 L11 7 Z"
        transform={vertical ? "rotate(90)" : undefined}
        fill={paint(state, "face")}
        stroke="var(--ink-scene)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
      <line x1={0} y1={0} x2={vertical ? 14 : 0} y2={vertical ? 0 : -12} stroke={materials[state].dk} strokeWidth={2.2} />
      <rect
        x={vertical ? 14 : -7}
        y={vertical ? -5 : -21}
        width={vertical ? 9 : 14}
        height={vertical ? 10 : 9}
        rx={1.5}
        fill={paint(state, "cylH")}
        stroke="var(--ink-scene)"
        strokeWidth={1}
      />
    </g>
  );
}

/** In-line sensor on a pipe: a thermowell/tapping stem and a lettered head. */
export function Sensor({
  x,
  y,
  letter,
  side = "up",
}: {
  x: number;
  y: number;
  letter: "T" | "P" | "F";
  side?: "up" | "down";
}) {
  const dy = side === "up" ? -15 : 15;
  return (
    <g className="eq-symbol" transform={`translate(${x} ${y})`}>
      <line x1={0} y1={0} x2={0} y2={dy} stroke="var(--text-muted)" strokeWidth={1.4} />
      <circle cy={dy} r={7.5} fill="var(--panel)" stroke="var(--text-muted)" strokeWidth={1.2} />
      <text
        y={dy + 3.6}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill="var(--text)"
      >
        {letter}
      </text>
    </g>
  );
}

/** Tee/header junction: fills the notch left where a branch pipe meets a header. */
export function Junction({ x, y, medium }: { x: number; y: number; medium: Medium }) {
  return <circle cx={x} cy={y} r={4.6} fill={`var(--${medium})`} stroke="rgb(255 255 255 / 0.35)" strokeWidth={0.8} />;
}
