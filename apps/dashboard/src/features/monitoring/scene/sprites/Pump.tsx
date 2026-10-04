import { materials, paint, type OperatingState } from "../materials";

const VOLUTE = { cx: 67, cy: 30, r: 14 };

/**
 * End-suction centrifugal pump on a baseplate, side elevation, 86 x 56 scene units.
 * Motor on the left, volute on the right with a vertical discharge and an axial
 * suction nozzle. `flip` mirrors it so the suction can face either header.
 */
export function PumpSprite({ state, flip = false }: { state: OperatingState; flip?: boolean }) {
  const m = materials[state];
  const p = (f: Parameters<typeof paint>[1]) => paint(state, f);
  const outline = { stroke: m.edge, strokeWidth: 0.7, strokeOpacity: 0.6 };
  const voluteBolts = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return (
      <circle
        key={i}
        cx={VOLUTE.cx + Math.cos(a) * 12.2}
        cy={VOLUTE.cy + Math.sin(a) * 12.2}
        r={0.75}
        fill={m.edge}
        opacity={0.55}
      />
    );
  });

  return (
    <g className="eq-art eq-pump" transform={flip ? "translate(86 0) scale(-1 1)" : undefined}>
      {/* Baseplate */}
      <rect x={2} y={45} width={82} height={2.6} fill={p("top")} {...outline} />
      <rect x={2} y={47.6} width={82} height={5.4} fill={p("side")} {...outline} />
      <circle cx={7} cy={50.3} r={1} fill={m.deep} />
      <circle cx={79} cy={50.3} r={1} fill={m.deep} />

      {/* Motor feet, fan cowl and finned frame */}
      <rect x={12} y={41} width={6} height={4} fill={p("side")} />
      <rect x={31} y={41} width={6} height={4} fill={p("side")} />
      <rect x={2} y={17} width={10} height={24} rx={4} fill={p("cylH")} {...outline} />
      {[21, 25, 29, 33, 37].map((y) => (
        <line key={y} x1={3.5} y1={y} x2={10} y2={y} stroke={m.deep} strokeOpacity={0.45} strokeWidth={0.9} />
      ))}
      <rect x={10} y={13} width={31} height={30} rx={3} fill={p("cylH")} {...outline} />
      {[16, 19, 22, 25, 28, 31, 34, 37, 40].map((y) => (
        <g key={y}>
          <line x1={12} y1={y} x2={39} y2={y} stroke={m.deep} strokeOpacity={0.3} strokeWidth={0.9} />
          <line x1={12} y1={y + 1} x2={39} y2={y + 1} stroke={m.hi} strokeOpacity={0.22} strokeWidth={0.6} />
        </g>
      ))}
      <rect x={38} y={15} width={4} height={26} rx={1.5} fill={m.dk} {...outline} />

      {/* Terminal box with cable gland */}
      <rect x={18} y={6.5} width={13} height={6.5} fill={p("face")} {...outline} />
      <path d="M18 6.5 L20 5 H33 L31 6.5 Z" fill={p("top")} />
      <path d="M31 6.5 L33 5 V11.5 L31 13 Z" fill={p("side")} />
      <rect x={22} y={3} width={4} height={2} fill={m.dk} />

      {/* Coupling guard; the slots slide while the shaft turns */}
      <rect x={42} y={21} width={9} height={16} rx={1} fill={p("face")} {...outline} />
      <g clipPath="url(#eq-pump-guard)">
        <g className="eq-guard-slots">
          {[18, 21, 24, 27, 30, 33, 36].map((y) => (
            <rect key={y} x={43.6} y={y} width={5.8} height={1.4} fill={m.deep} opacity={0.6} />
          ))}
        </g>
      </g>

      {/* Bearing frame and pedestal */}
      <rect x={51} y={24} width={7} height={10} fill={p("cylH")} {...outline} />
      <path d="M49 45 H60 L58 34 H51 Z" fill={p("side")} {...outline} />
      <path d="M51.6 45 H57.4 L54.5 38.6 Z" fill={m.deep} />

      {/* Volute casing */}
      <rect x={60} y={42} width={14} height={3} fill={p("side")} />
      <circle {...VOLUTE} fill={p("disc")} {...outline} />
      <circle cx={VOLUTE.cx} cy={VOLUTE.cy} r={10.4} fill="none" stroke={m.dk} strokeOpacity={0.45} strokeWidth={0.9} />
      <path d="M67 16 A14 14 0 0 1 81 30" fill="none" stroke={m.hi} strokeOpacity={0.45} strokeWidth={1.2} />
      {voluteBolts}
      <circle cx={VOLUTE.cx} cy={VOLUTE.cy} r={3.6} fill={p("top")} stroke={m.dk} strokeWidth={0.7} />
      <circle cx={VOLUTE.cx} cy={VOLUTE.cy} r={1.4} fill={m.deep} />

      {/* Discharge nozzle (top) and suction nozzle (end) */}
      <rect x={62} y={4} width={9} height={13} fill={p("cylV")} {...outline} />
      <rect x={58.5} y={1} width={16} height={3.5} rx={0.8} fill={p("top")} {...outline} />
      <circle cx={60.6} cy={2.75} r={0.7} fill={m.edge} />
      <circle cx={72.4} cy={2.75} r={0.7} fill={m.edge} />
      <rect x={79} y={25} width={5} height={12} fill={p("cylH")} {...outline} />
      <rect x={83} y={21} width={3} height={20} rx={0.8} fill={p("top")} {...outline} />
    </g>
  );
}
