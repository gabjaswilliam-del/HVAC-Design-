import { materials, paint, type OperatingState } from "../materials";

/**
 * Water-cooled centrifugal chiller, side elevation, 180 x 112 scene units.
 * Condenser shell behind/above the evaporator shell, compressor and motor on top,
 * control cabinet on the left, combined water boxes at each end.
 */
export function ChillerSprite({ state }: { state: OperatingState }) {
  const m = materials[state];
  const p = (f: Parameters<typeof paint>[1]) => paint(state, f);
  const outline = { stroke: m.edge, strokeWidth: 0.8, strokeOpacity: 0.6 };
  const bolts = (x: number, y0: number, y1: number) =>
    Array.from({ length: Math.floor((y1 - y0) / 5) + 1 }, (_, i) => (
      <circle key={i} cx={x} cy={y0 + i * 5} r={0.75} fill={m.edge} opacity={0.55} />
    ));

  const lcd =
    state === "running" ? "#6dffa8" : state === "fault" ? "#ff8a8a" : state === "stopped" ? "#3d5a4b" : "none";
  const led = (on: boolean, color: string) => (on ? color : "#1c2a24");

  return (
    <g className="eq-art eq-chiller">
      {/* Skid and saddles */}
      <rect x={12} y={104} width={156} height={4} fill={p("side")} {...outline} />
      <rect x={14} y={107} width={10} height={3} fill={m.deep} />
      <rect x={156} y={107} width={10} height={3} fill={m.deep} />
      <path d="M32 104 L36 96 H50 L54 104 Z" fill={p("side")} {...outline} />
      <path d="M128 104 L132 96 H146 L150 104 Z" fill={p("side")} {...outline} />

      {/* Condenser shell (rear) */}
      <rect x={20} y={50} width={142} height={34} rx={8} fill={p("cylH")} {...outline} />
      <rect x={20} y={50} width={142} height={34} rx={8} fill={m.deep} opacity={0.22} />
      {[64, 100, 136].map((x) => (
        <line key={x} x1={x} y1={52} x2={x} y2={66} stroke={m.edge} strokeOpacity={0.3} strokeWidth={0.8} />
      ))}

      {/* Evaporator shell (front) */}
      <rect x={24} y={67} width={136} height={35} rx={9} fill={p("cylH")} {...outline} />
      {[62, 98, 134].map((x) => (
        <line key={x} x1={x} y1={68} x2={x} y2={101} stroke={m.edge} strokeOpacity={0.3} strokeWidth={0.8} />
      ))}
      <rect x={104} y={84} width={20} height={7} rx={1} fill={m.hi} opacity={0.4} />
      <line x1={107} y1={86.5} x2={121} y2={86.5} stroke={m.edge} strokeOpacity={0.4} strokeWidth={0.6} />
      <line x1={107} y1={88.6} x2={117} y2={88.6} stroke={m.edge} strokeOpacity={0.4} strokeWidth={0.6} />

      {/* Tube-sheet flanges where shells meet the water boxes */}
      <rect x={22} y={50} width={3.5} height={52} fill={p("side")} />
      <rect x={156.5} y={50} width={3.5} height={52} fill={p("side")} />
      {bolts(23.75, 53, 100)}
      {bolts(158.25, 53, 100)}

      {/* Water boxes with pass partitions */}
      <rect x={8} y={48} width={15} height={56} rx={5} fill={p("cylH")} {...outline} />
      <line x1={9} y1={77} x2={22} y2={77} stroke={m.edge} strokeOpacity={0.55} strokeWidth={1} />
      <rect x={159} y={48} width={15} height={56} rx={5} fill={p("cylH")} {...outline} />
      <line x1={160} y1={77} x2={173} y2={77} stroke={m.edge} strokeOpacity={0.55} strokeWidth={1} />

      {/* Water nozzles and flanges (ports at y 62 and 92) */}
      {[62, 92].map((y) => (
        <g key={y}>
          <rect x={2} y={y - 4.5} width={8} height={9} fill={p("cylH")} {...outline} />
          <rect x={0} y={y - 7} width={3} height={14} rx={0.8} fill={p("top")} {...outline} />
          <rect x={172} y={y - 4.5} width={6} height={9} fill={p("cylH")} {...outline} />
          <rect x={177} y={y - 7} width={3} height={14} rx={0.8} fill={p("top")} {...outline} />
        </g>
      ))}

      {/* Supports between compressor/motor and the shells */}
      <rect x={100} y={52} width={4} height={16} fill={p("side")} />
      <rect x={147} y={46} width={4} height={22} fill={p("side")} />

      {/* Suction elbow from evaporator to compressor inlet */}
      <path d="M84 52 V22 Q84 11 95 11 H104 V18" fill="none" stroke={m.dk} strokeWidth={7.5} strokeLinejoin="round" />
      <path d="M84 52 V22 Q84 11 95 11 H104 V18" fill="none" stroke={m.lt} strokeWidth={3} strokeLinejoin="round" opacity={0.85} />
      <rect x={79.5} y={46} width={9} height={3} fill={p("top")} {...outline} />

      {/* Compressor housing with inlet-vane actuator */}
      <rect x={90} y={17} width={33} height={38} rx={9} fill={p("cylH")} {...outline} />
      <rect x={90} y={17} width={3} height={38} fill={m.dk} opacity={0.7} />
      <rect x={119.5} y={17} width={3} height={38} fill={m.dk} opacity={0.7} />
      <path d="M96 17 V13 H112 V17" fill={p("face")} {...outline} />

      {/* Gear collar and hermetic motor */}
      <rect x={122} y={22} width={7} height={28} fill={p("side")} {...outline} />
      <rect x={128} y={24} width={36} height={24} rx={11} fill={p("cylH")} {...outline} />
      {[133, 137, 141, 145, 149, 153, 157].map((x) => (
        <line key={x} x1={x} y1={26} x2={x} y2={46} stroke={m.deep} strokeOpacity={0.35} strokeWidth={0.9} />
      ))}
      <rect x={137} y={18} width={13} height={6} fill={p("face")} {...outline} />

      {/* Oil/refrigerant line from the motor end to the condenser box */}
      <path d="M163 36 H168 Q172 36 172 40 V48" fill="none" stroke={m.dk} strokeWidth={4} />
      <path d="M163 36 H168 Q172 36 172 40 V48" fill="none" stroke={m.lt} strokeWidth={1.4} opacity={0.8} />

      {/* Control cabinet: front, top and side faces */}
      <rect x={26} y={8} width={46} height={58} fill={p("face")} {...outline} />
      <path d="M26 8 L32 3 H79 L72 8 Z" fill={p("top")} {...outline} />
      <path d="M72 8 L79 3 V62 L72 66 Z" fill={p("side")} {...outline} />
      <line x1={41} y1={10} x2={41} y2={64} stroke={m.edge} strokeOpacity={0.45} strokeWidth={0.8} />
      <line x1={41.9} y1={10} x2={41.9} y2={64} stroke={m.hi} strokeOpacity={0.35} strokeWidth={0.6} />
      <line x1={56} y1={10} x2={56} y2={64} stroke={m.edge} strokeOpacity={0.45} strokeWidth={0.8} />
      <line x1={56.9} y1={10} x2={56.9} y2={64} stroke={m.hi} strokeOpacity={0.35} strokeWidth={0.6} />
      <rect x={37.5} y={31} width={1.6} height={8} rx={0.8} fill={m.deep} />
      <rect x={52.5} y={31} width={1.6} height={8} rx={0.8} fill={m.deep} />
      <rect x={44} y={13} width={10} height={5} rx={0.6} fill={m.hi} opacity={0.5} />
      {[51, 54, 57, 60].map((y) => (
        <line key={y} x1={29} y1={y} x2={38} y2={y} stroke={m.deep} strokeOpacity={0.55} strokeWidth={1} />
      ))}

      {/* Controller display and indicator lamps */}
      <rect x={58.5} y={12} width={11.5} height={12} rx={0.8} fill="url(#eq-glass)" stroke={m.edge} strokeWidth={0.8} />
      {lcd !== "none" && (
        <g stroke={lcd} strokeWidth={1} strokeLinecap="round">
          <line x1={60.5} y1={15} x2={67.5} y2={15} />
          <line x1={60.5} y1={18} x2={65} y2={18} />
          <line x1={60.5} y1={21} x2={68} y2={21} />
        </g>
      )}
      <circle cx={60.5} cy={29} r={1.3} fill={led(state === "running", "#7dff9e")} />
      <circle cx={64.3} cy={29} r={1.3} fill={led(state === "stopped", "#ffd36b")} />
      <circle cx={68.1} cy={29} r={1.3} fill={led(state === "fault", "#ff5a5f")} />
      <rect x={28} y={64} width={4} height={4} fill={m.deep} />
      <rect x={66} y={64} width={4} height={4} fill={m.deep} />
    </g>
  );
}
