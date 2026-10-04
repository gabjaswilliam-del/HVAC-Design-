import { materials, paint, type OperatingState } from "../materials";

const BLADE = "M3.5 -2 C8 -6.5 14 -8.6 17.3 -5.3 C18.4 -2 16 1.6 12 2.6 C9 3.3 6 3.1 3.5 2 Z";
const RACK_X = [92, 120, 148, 176, 204];

/**
 * The lumped terminal: one aggregate data-hall cooling load, 240 x 190 scene units.
 * Drawn as a room section with a CRAH unit, racks and raised-floor air path so the
 * load is recognisable, but it represents a single modelled terminal, not individual
 * air handlers or racks.
 */
export function DataHallSprite({ state }: { state: OperatingState }) {
  const m = materials[state];
  const p = (f: Parameters<typeof paint>[1]) => paint(state, f);
  const outline = { stroke: m.edge, strokeWidth: 0.8, strokeOpacity: 0.6 };

  return (
    <g className="eq-art eq-datahall">
      {/* Room section and raised floor */}
      <rect x={10} y={12} width={228} height={8} fill="#1b2a42" stroke="#30476b" strokeWidth={1} />
      <rect x={14} y={20} width={220} height={156} fill="#0e192b" stroke="#30476b" strokeWidth={1.2} />
      <rect x={14} y={158} width={220} height={18} fill="#0a1322" />
      <line x1={14} y1={158} x2={234} y2={158} stroke="#3a5279" strokeWidth={1.6} />
      {[40, 80, 120, 160, 200].map((x) => (
        <line key={x} x1={x} y1={159} x2={x} y2={176} stroke="#22324d" strokeWidth={1.2} />
      ))}

      {/* Supply/return stubs through the wall into the coil */}
      <rect x={0} y={94} width={24} height={8} fill="var(--chw-supply)" />
      <rect x={0} y={120} width={24} height={8} fill="var(--chw-return)" />

      {/* Air paths: cold under the floor, hot back over the racks */}
      <g className="hall-air" fill="none" strokeWidth={1.8} strokeDasharray="6 6">
        <path d="M68 167 H224" stroke="var(--chw-return)" />
        <path d="M222 44 H74 Q62 44 62 56" stroke="var(--cw-hot)" strokeOpacity={0.8} />
      </g>
      {[106, 162, 218].map((x) => (
        <path key={x} d={`M${x - 4} 156 L${x} 151 L${x + 4} 156`} fill="none" stroke="var(--chw-return)" strokeWidth={1.6} />
      ))}
      <path d="M66 52 L62 58 L58 52" fill="none" stroke="var(--cw-hot)" strokeWidth={1.6} />

      {/* Racks with server units and status LEDs */}
      {RACK_X.map((x, i) => (
        <g key={x}>
          <rect x={x} y={58} width={22} height={100} rx={1} fill="#18253a" stroke="#2f4568" strokeWidth={1} />
          <rect x={x + 2.5} y={61} width={17} height={94} fill="#0c1524" />
          {Array.from({ length: 15 }, (_, k) => {
            const y = 64 + k * 6;
            const lit = (i * 7 + k * 3) % 4 !== 0;
            return (
              <g key={k}>
                <line x1={x + 3} y1={y + 4} x2={x + 19} y2={y + 4} stroke="#22324d" strokeWidth={0.8} />
                {lit && (
                  <rect x={x + 4} y={y + 1} width={2} height={1.4} fill={(i + k) % 3 ? "#46d37e" : "#5ec8e5"} />
                )}
              </g>
            );
          })}
        </g>
      ))}

      {/* CRAH unit: cabinet, coil and fan */}
      <rect x={22} y={60} width={44} height={98} fill={p("face")} {...outline} />
      <path d="M22 60 L26 56 H70 L66 60 Z" fill={p("top")} {...outline} />
      <path d="M66 60 L70 56 V154 L66 158 Z" fill={p("side")} {...outline} />
      <rect x={28} y={68} width={32} height={44} fill={m.deep} stroke={m.edge} strokeWidth={0.8} />
      <g stroke={m.lt} strokeOpacity={0.35} strokeWidth={0.8}>
        {Array.from({ length: 9 }, (_, i) => (
          <line key={i} x1={28 + i * 4} y1={68} x2={28 + i * 4 - 8} y2={112} />
        ))}
      </g>
      <circle cx={44} cy={133} r={13} fill={p("recess")} />
      <g transform="translate(44 133) scale(0.68)">
        <g className="eq-fan">
          <circle r={18} fill="none" />
          {[0, 72, 144, 216, 288].map((a) => (
            <path key={a} d={BLADE} transform={`rotate(${a})`} fill={p("face")} stroke={m.edge} strokeWidth={0.6} />
          ))}
        </g>
        <circle r={4.5} fill={p("disc")} />
      </g>
      <circle cx={44} cy={133} r={13} fill="none" stroke={m.lt} strokeWidth={1.4} />
    </g>
  );
}
