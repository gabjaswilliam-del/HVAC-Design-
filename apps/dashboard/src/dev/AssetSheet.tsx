/**
 * Development-only equipment asset sheet for artwork review (served at
 * /asset-sheet.html by the dev server; not part of the production build).
 */
import type { CSSProperties, ReactNode } from "react";
import { EquipmentNode } from "../features/monitoring/scene/EquipmentNode";
import { spriteGeometry, type SpriteKind } from "../features/monitoring/scene/geometry";
import { SpriteDefs, type OperatingState } from "../features/monitoring/scene/materials";
import { ChillerSprite } from "../features/monitoring/scene/sprites/Chiller";
import { CoolingTowerSprite } from "../features/monitoring/scene/sprites/CoolingTower";
import { DataHallSprite } from "../features/monitoring/scene/sprites/DataHall";
import { PumpSprite } from "../features/monitoring/scene/sprites/Pump";
import { Pipe, type Medium } from "../features/monitoring/scene/Pipe";
import { ReadoutTag, type MetricKind } from "../features/monitoring/scene/ReadoutTag";
import { BowtieValve, Junction, RingValve, Sensor } from "../features/monitoring/scene/Symbols";
import "../features/monitoring/scene/scene.css";
import "./asset-sheet.css";

const KINDS: { kind: SpriteKind; name: string; hz?: number }[] = [
  { kind: "chiller", name: "Chiller" },
  { kind: "pump", name: "Pump", hz: 45 },
  { kind: "coolingTower", name: "Cooling tower", hz: 47 },
  { kind: "dataHall", name: "Data hall terminal" },
];

const STATES: { label: string; state: OperatingState; stale?: boolean; selected?: boolean }[] = [
  { label: "Running", state: "running" },
  { label: "Stopped", state: "stopped" },
  { label: "Fault", state: "fault" },
  { label: "Unavailable (no data)", state: "unavailable" },
  { label: "Stale (last value retained)", state: "running", stale: true },
  { label: "Selected", state: "running", selected: true },
];

/** An SVG sized to its content with padding, drawn at `scale` CSS px per scene unit. */
function Frame({ w, h, scale, pad = 14, top = 14, bottom = 30, children }: {
  w: number;
  h: number;
  scale: number;
  pad?: number;
  top?: number;
  bottom?: number;
  children: ReactNode;
}) {
  const vw = w + pad * 2;
  const vh = h + top + bottom;
  return (
    <svg
      className="sheet-frame"
      viewBox={`${-pad} ${-top} ${vw} ${vh}`}
      width={vw * scale}
      height={vh * scale}
    >
      {children}
    </svg>
  );
}

function Node({ kind, label, state, stale, selected, hz }: {
  kind: SpriteKind;
  label: string;
  state: OperatingState;
  stale?: boolean;
  selected?: boolean;
  hz?: number;
}) {
  return (
    <EquipmentNode
      id={`sheet-${kind}`}
      kind={kind}
      x={0}
      y={0}
      label={label}
      state={state}
      stale={stale}
      selected={selected}
      speedHz={state === "running" ? hz : undefined}
    />
  );
}

const MEDIA: [Medium, string][] = [
  ["cw-hot", "Condenser water to towers"],
  ["cw-cool", "Condenser water from towers"],
  ["chw-supply", "Chilled-water supply"],
  ["chw-return", "Chilled-water return"],
];

const TAG_KINDS: [MetricKind, number, string, string][] = [
  ["frequency", 47.2, "Hz", "Frequency"],
  ["power", 103.6, "kW", "Electrical power"],
  ["temperature", 7.1, "°C", "Temperature"],
  ["hydraulic", 412.6, "kPa", "Pressure / flow"],
  ["neutral", 78, "%", "Load, thermal kW"],
];

export function AssetSheet() {
  return (
    <main className="sheet">
      <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
        <SpriteDefs />
      </svg>

      <header className="sheet__head">
        <h1>Equipment asset sheet</h1>
        <p>
          Version A, Milestone 1 artwork review. Original SVG illustrations inspired by the supplied
          reference. All values shown are synthetic.
        </p>
      </header>

      <section>
        <h2>Equipment artwork</h2>
        <p className="sheet__note">Drawn detail, shown at 3× the scene's 100% zoom.</p>
        <div className="sheet__row">
          {KINDS.map(({ kind, name, hz }) => (
            <figure key={kind}>
              <Frame
                w={spriteGeometry[kind].width}
                h={spriteGeometry[kind].height}
                scale={kind === "dataHall" ? 1.8 : 3}
                bottom={10}
              >
                <g style={hz ? ({ "--fan-period": `${(50 / hz) * 0.9}s` } as CSSProperties) : undefined}>
                  {kind === "chiller" && <ChillerSprite state="running" />}
                  {kind === "pump" && <PumpSprite state="running" />}
                  {kind === "coolingTower" && <CoolingTowerSprite state="running" />}
                  {kind === "dataHall" && <DataHallSprite state="running" />}
                </g>
              </Frame>
              <figcaption>{name}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section>
        <h2>Operating and data states</h2>
        <p className="sheet__note">
          State is always named in text and, for fault, no data and stale, marked with a badge. Motion
          (fans, coupling, flow) runs only for current running equipment.
        </p>
        <div className="sheet__grid" style={{ gridTemplateColumns: `120px repeat(${STATES.length}, max-content)` }}>
          <div />
          {STATES.map((s) => (
            <div key={s.label} className="sheet__col-head">
              {s.label}
            </div>
          ))}
          {KINDS.filter((k) => k.kind !== "dataHall").map(({ kind, name, hz }) => (
            <div key={kind} className="sheet__grid-row">
              <div className="sheet__row-head">{name}</div>
              {STATES.map((s) => (
                <Frame
                  key={s.label}
                  w={spriteGeometry[kind].width}
                  h={spriteGeometry[kind].height}
                  pad={Math.max(14, (170 - spriteGeometry[kind].width) / 2)}
                  scale={1.35}
                >
                  <Node kind={kind} label={name} state={s.state} stale={s.stale} selected={s.selected} hz={hz} />
                </Frame>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Actual size in the monitoring scene</h2>
        <p className="sheet__note">
          1 scene unit = 1 CSS px at 100% zoom. On a 1440 × 900 workstation the full plant fits at about 80%.
        </p>
        <svg className="sheet-frame" viewBox="0 0 940 190" width={940} height={190}>
          <EquipmentNode id="a1" kind="coolingTower" x={60} y={20} label="Cooling tower 1" state="running" speedHz={46.8} />
          <ReadoutTag x={144} y={34} kind="frequency" value={46.8} unit="Hz" width={52} />
          <ReadoutTag x={144} y={60} kind="power" value={4.52} unit="kW" decimals={2} width={52} />
          <EquipmentNode id="a2" kind="pump" x={270} y={64} label="CW pump 1" state="running" flip speedHz={45} />
          <ReadoutTag x={364} y={66} kind="frequency" value={45} unit="Hz" width={52} />
          <ReadoutTag x={364} y={92} kind="power" value={16} unit="kW" width={52} />
          <EquipmentNode id="a3" kind="chiller" x={500} y={50} label="Chiller 1" state="running" />
          <ReadoutTag x={518} y={20} kind="neutral" value={78} unit="%" decimals={0} width={46} />
          <ReadoutTag x={594} y={20} kind="power" value={103.6} unit="kW" width={58} />
          <EquipmentNode id="a4" kind="pump" x={740} y={64} label="CHW pump 3" state="unavailable" flip />
          <ReadoutTag x={834} y={66} kind="frequency" value={null} unit="Hz" quality="unavailable" width={70} />
        </svg>
      </section>

      <section>
        <h2>Pipes, flow and symbols</h2>
        <svg className="sheet-frame" viewBox="0 0 900 330" width={900} height={330}>
          {MEDIA.map(([medium, label], i) => (
            <g key={medium}>
              <Pipe points={[[20, 30 + i * 40], [330, 30 + i * 40]]} medium={medium} flowing />
              <text x={345} y={35 + i * 40} className="sheet-svg-label">
                {label}, flowing
              </text>
            </g>
          ))}
          <Pipe points={[[20, 190], [330, 190]]} medium="chw-supply" flowing={false} />
          <text x={345} y={195} className="sheet-svg-label">
            No flow: static arrows, no motion
          </text>
          <Pipe points={[[20, 230], [200, 230]]} medium="cw-cool" flowing={false} evidence="unknown" />
          <text x={345} y={235} className="sheet-svg-label">
            Not recorded (evidence: unknown)
          </text>

          {/* Crossing without connection, and a tee with junction */}
          <Pipe points={[[620, 20], [620, 160]]} medium="cw-hot" flowing />
          <Pipe points={[[560, 90], [700, 90]]} medium="cw-cool" flowing />
          <text x={560} y={180} className="sheet-svg-label">
            Crossing (gap)
          </text>
          <Pipe points={[[760, 20], [760, 160]]} medium="chw-return" flowing />
          <Pipe points={[[760, 90], [870, 90]]} medium="chw-return" flowing />
          <Junction x={760} y={90} medium="chw-return" />
          <text x={760} y={180} className="sheet-svg-label">
            Tee (junction)
          </text>

          <Pipe points={[[560, 272], [880, 272]]} medium="cw-cool" flowing />
          <RingValve x={590} y={272} medium="cw-cool" open />
          <RingValve x={640} y={272} medium="cw-cool" open={false} />
          <BowtieValve x={700} y={272} state="stopped" />
          <Sensor x={760} y={272} letter="T" />
          <Sensor x={790} y={272} letter="P" />
          <Sensor x={820} y={272} letter="F" side="down" />
          <text x={560} y={320} className="sheet-svg-label">
            Ring valve open / closed, control valve, sensors
          </text>
        </svg>
      </section>

      <section>
        <h2>Measurement tags</h2>
        <svg className="sheet-frame" viewBox="0 0 900 120" width={900} height={120}>
          {TAG_KINDS.map(([kind, value, unit, name], i) => (
            <g key={kind}>
              <ReadoutTag x={20 + i * 175} y={20} kind={kind} value={value} unit={unit} decimals={kind === "neutral" ? 0 : 1} />
              <text x={20 + i * 175} y={62} className="sheet-svg-label">
                {name}
              </text>
            </g>
          ))}
          <ReadoutTag x={20} y={80} kind="temperature" value={35.0} unit="°C" quality="stale" />
          <text x={110} y={95} className="sheet-svg-label">
            Stale: dimmed with a clock mark
          </text>
          <ReadoutTag x={370} y={80} kind="hydraulic" value={null} unit="kPa" quality="unavailable" width={78} />
          <text x={460} y={95} className="sheet-svg-label">
            Missing: "Unavailable", never zero
          </text>
        </svg>
      </section>
    </main>
  );
}
