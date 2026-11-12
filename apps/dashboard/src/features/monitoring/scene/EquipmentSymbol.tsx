import { spriteGeometry, type SpriteKind } from "./geometry";

const stems: Record<SpriteKind, string> = {
  chiller: "M0 62H12V36H36M180 62H169V36H151M0 92H35M180 92H151",
  coolingTower: "M37 0V11M37 88V100",
  pump: "M86 31H72M66.5 0V6",
  dataHall: "M0 98H22V84H39M0 124H39",
};

// Converted from diagrams.net P&ID and Rack stencils. See overview-equipment/credits.txt.
const artwork = {
  chiller: (
    <g transform="translate(24 9) scale(.84)">
      <path className="equipment-symbol__body" d="M149 12.5A5 13 0 1 1 149 52.5H19A5 13 0 1 1 19 12.5Z" />
      <path className="equipment-symbol__body" d="M149 72.5A5 13 0 1 1 149 112.5H19A5 13 0 1 1 19 72.5Z" />
      <path d="M4 79.5H13M4 105.5H13M4 69.5V89.5M0 69.5V89.5M4 95.5V115.5M0 95.5V115.5M139 12.5V4M129 4H149M129 0H149M29 12.5V4M19 4H39M19 0H39" />
      <path className="equipment-symbol__body" d="M34 52.5H44V72.5H34ZM119 52.5H129V72.5H119Z" />
    </g>
  ),
  coolingTower: (
    <g transform="translate(5 11) scale(.64)">
      <path className="equipment-symbol__body" d="M0 120V100L25 0H75L100 100V120Z" />
      <path d="M100 100H0M14 45H50V55M40 55L50 45L60 55M58 12.5L64 31M42 12.5L36 31" />
      <circle cx={50} cy={25} r={15} />
    </g>
  ),
  pump: (
    <g transform="translate(73 6) scale(-.65 .62)">
      <path className="equipment-symbol__body" d="M12 64L0 77H60L48 64" />
      <path className="equipment-symbol__body" d="M25 69.4A30 30 0 0 1 0 40V0H20V11.55A30 30 0 1 1 35 69.4" />
      <path d="M25 48.6A10 10 0 1 1 35 48.6" />
    </g>
  ),
  dataHall: (
    <g transform="translate(39 31)">
      {[0, 37, 74, 111].map((y) => (
        <g key={y} transform={`translate(0 ${y})`}>
          <rect className="equipment-symbol__body" width={161.85} height={30.6} />
          <path d="M8.83 1V10.59A4.7 4.7 0 0 1 8.83 20.04V29.6M152.65 1V10.59A4.7 4.7 0 0 0 152.65 20.04V29.6" />
          <circle cx={80.82} cy={15.3} r={4.16} />
          <path className="equipment-symbol__detail" d="M17.83 2.5h56v10.65h-56zM88.82 2.5h56v10.65h-56zM17.83 17.3h56v10.65h-56zM88.82 17.3h56v10.65h-56z" />
        </g>
      ))}
    </g>
  ),
} satisfies Record<SpriteKind, React.ReactNode>;

export function EquipmentSymbol({ kind, running, flip }: {
  kind: SpriteKind;
  running: boolean;
  flip: boolean;
}) {
  const { width, ports } = spriteGeometry[kind];
  return (
    <g className="equipment-symbol" aria-hidden="true">
      <defs>
        <linearGradient id="eq-body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fdfefb" />
          <stop offset="1" stopColor="#e6eee7" />
        </linearGradient>
      </defs>
      <g transform={flip ? `translate(${width} 0) scale(-1 1)` : undefined}>
        <path d={stems[kind]} />
        {artwork[kind]}
        {Object.entries(ports).map(([port, { x, y }]) => (
          <circle key={port} cx={x} cy={y} r={3} className="equipment-symbol__port" />
        ))}
      </g>
      {running && <circle className="equipment-symbol__running" cx={width - 6} cy={6} r={4} />}
    </g>
  );
}
