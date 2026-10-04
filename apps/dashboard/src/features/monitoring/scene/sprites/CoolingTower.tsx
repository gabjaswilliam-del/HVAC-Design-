import { materials, paint, type OperatingState } from "../materials";

const FAN = { cx: 37, cy: 47, r: 19.5 };
const BLADE = "M3.5 -2 C8 -6.5 14 -8.6 17.3 -5.3 C18.4 -2 16 1.6 12 2.6 C9 3.3 6 3.1 3.5 2 Z";
const GALVANISED = "#7f8a99";

/**
 * Round counterflow (FRP) cooling tower, side elevation, 78 x 100 scene units.
 * Hot water enters at the top distributor, air is drawn through the inlet louvers by
 * the fan, cooled water leaves from the basin. The fan turns at a rate set by the
 * caller from the reported fan frequency.
 */
export function CoolingTowerSprite({ state }: { state: OperatingState }) {
  const m = materials[state];
  const p = (f: Parameters<typeof paint>[1]) => paint(state, f);
  const outline = { stroke: m.edge, strokeWidth: 0.8, strokeOpacity: 0.6 };

  return (
    <g className="eq-art eq-tower">
      {/* Inlet pipe and distributor */}
      <rect x={33} y={0} width={8} height={9} fill={p("cylV")} {...outline} />
      <rect x={31} y={7} width={12} height={2.5} rx={0.6} fill={p("top")} {...outline} />
      <rect x={25} y={9} width={24} height={5.5} rx={2} fill={p("cylV")} {...outline} />

      {/* Ladder (galvanised, independent of state) */}
      <g stroke={GALVANISED} fill="none">
        <line x1={70.5} y1={26} x2={70.5} y2={84} strokeWidth={1.1} />
        <line x1={75} y1={26} x2={75} y2={84} strokeWidth={1.1} />
        {Array.from({ length: 11 }, (_, i) => (
          <line key={i} x1={70.5} y1={30 + i * 5} x2={75} y2={30 + i * 5} strokeWidth={0.9} />
        ))}
        <line x1={67.5} y1={32} x2={70.5} y2={32} strokeWidth={0.9} />
        <line x1={67.5} y1={76} x2={70.5} y2={76} strokeWidth={0.9} />
      </g>

      {/* Shell with rounded shoulders */}
      <path
        d="M25 14 H49 C60 14 68 18 68 28 V68 H6 V28 C6 18 14 14 25 14 Z"
        fill={p("cylV")}
        {...outline}
      />
      <path d="M10 25 C12 19 18 16.5 26 16.5" fill="none" stroke={m.hi} strokeOpacity={0.55} strokeWidth={1.2} />
      <line x1={6} y1={27} x2={68} y2={27} stroke={m.edge} strokeOpacity={0.22} strokeWidth={0.8} />

      {/* Fan recess, rotating blades and fixed guard */}
      <circle cx={FAN.cx} cy={FAN.cy} r={FAN.r + 1.5} fill="none" stroke={m.deep} strokeOpacity={0.55} strokeWidth={1} />
      <circle {...FAN} fill={p("recess")} />
      <g transform={`translate(${FAN.cx} ${FAN.cy})`}>
        <g className="eq-fan">
          <circle r={18} fill="none" />
          {[0, 72, 144, 216, 288].map((a) => (
            <path key={a} d={BLADE} transform={`rotate(${a})`} fill={p("face")} stroke={m.edge} strokeWidth={0.5} />
          ))}
        </g>
        <circle r={4.5} fill={p("disc")} stroke={m.edge} strokeWidth={0.6} />
        <circle r={1.6} fill={m.deep} />
        <g fill="none" stroke={m.hi} strokeOpacity={0.2} strokeWidth={0.6}>
          <circle r={9} />
          <circle r={15} />
          {[45, 135, 225, 315].map((a) => (
            <line key={a} x1={4.5} y1={0} x2={19} y2={0} transform={`rotate(${a})`} />
          ))}
        </g>
      </g>
      <circle {...FAN} fill="none" stroke={m.lt} strokeWidth={2} />

      {/* Air-inlet louvers */}
      <rect x={6} y={66} width={62} height={16} fill={p("cylV")} {...outline} />
      <rect x={6} y={66} width={62} height={16} fill={m.deep} opacity={0.4} />
      {[69, 72.5, 76, 79.5].map((y) => (
        <g key={y}>
          <line x1={7} y1={y} x2={67} y2={y} stroke={m.deep} strokeOpacity={0.75} strokeWidth={1.4} />
          <line x1={7} y1={y + 1.1} x2={67} y2={y + 1.1} stroke={m.lt} strokeOpacity={0.35} strokeWidth={0.7} />
        </g>
      ))}

      {/* Basin, legs and outlet */}
      <rect x={4} y={80.5} width={66} height={4.5} rx={1.5} fill={p("cylH")} {...outline} />
      <rect x={22} y={85} width={3} height={8} fill={m.deep} />
      <rect x={49} y={85} width={3} height={8} fill={m.deep} />
      <rect x={8} y={85} width={4} height={10} fill={p("side")} />
      <rect x={62} y={85} width={4} height={10} fill={p("side")} />
      <rect x={6} y={94} width={8} height={2.5} fill={m.dk} />
      <rect x={60} y={94} width={8} height={2.5} fill={m.dk} />
      <rect x={33} y={85} width={8} height={15} fill={p("cylV")} {...outline} />
      <rect x={31} y={85} width={12} height={2.2} rx={0.6} fill={p("top")} {...outline} />
    </g>
  );
}
