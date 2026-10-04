import type { CSSProperties } from "react";
import { useStrings } from "../../../lib/i18n";
import { spriteGeometry, type SpriteKind } from "./geometry";
import type { OperatingState } from "./materials";
import { ChillerSprite } from "./sprites/Chiller";
import { CoolingTowerSprite } from "./sprites/CoolingTower";
import { DataHallSprite } from "./sprites/DataHall";
import { PumpSprite } from "./sprites/Pump";

interface EquipmentNodeProps {
  id: string;
  kind: SpriteKind;
  x: number;
  y: number;
  label: string;
  state: OperatingState;
  /** Last reported state is retained but no longer current: motion freezes. */
  stale?: boolean;
  selected?: boolean;
  flip?: boolean;
  /** Fan/motor frequency; sets animation speed for running equipment. */
  speedHz?: number;
  /** Label position relative to the sprite. "right" stacks name and state beside it. */
  labelAt?: "below" | "above" | "right";
}

const HALO_PAD = 7;

/**
 * Places one equipment sprite in the scene by stable equipment ID and adds the parts
 * every machine shares: state class, selection halo, fault/unavailable/stale badge and
 * a text label that names the state in words as well as colour.
 */
export function EquipmentNode({
  id,
  kind,
  x,
  y,
  label,
  state,
  stale = false,
  selected = false,
  flip = false,
  speedHz,
  labelAt = "below",
}: EquipmentNodeProps) {
  const s = useStrings();
  const { width, height } = spriteGeometry[kind];
  const still = state !== "running" || stale;
  const period = speedHz && speedHz > 0 ? (50 / speedHz) * 0.9 : undefined;
  const stateWord = stale ? s.scene.states.stale : s.scene.states[state];
  const badge = stale ? "stale" : state === "fault" || state === "unavailable" ? state : null;

  const classes = [
    "eq-node",
    `eq-node--${state}`,
    still && "eq-node--still",
    stale && "eq-node--stale",
    selected && "eq-node--selected",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={classes}
      transform={`translate(${x} ${y})`}
      data-equipment-id={id}
      style={period ? ({ "--fan-period": `${period}s` } as CSSProperties) : undefined}
    >
      {(selected || state === "fault" || state === "unavailable") && (
        <rect
          className={`eq-node__frame eq-node__frame--${selected ? "selected" : state}`}
          x={-HALO_PAD}
          y={-HALO_PAD}
          width={width + HALO_PAD * 2}
          height={height + HALO_PAD * 2}
          rx={6}
        />
      )}
      <g className="eq-node__art">
        {kind === "chiller" && <ChillerSprite state={state} />}
        {kind === "pump" && <PumpSprite state={state} flip={flip} />}
        {kind === "coolingTower" && <CoolingTowerSprite state={state} />}
        {kind === "dataHall" && <DataHallSprite state={state} />}
      </g>
      {badge && (
        <g className={`eq-badge eq-badge--${badge}`} transform={`translate(${width + 2} ${-2})`}>
          <circle r={8.5} />
          {badge === "stale" ? (
            <path d="M0 -4.5 V0 H3.5" fill="none" strokeWidth={1.6} />
          ) : (
            <text y={4.3} textAnchor="middle">
              {badge === "fault" ? "!" : "?"}
            </text>
          )}
        </g>
      )}
      {labelAt === "right" ? (
        <text className="eq-node__label" x={width + 7} y={height - 20}>
          <tspan className="eq-node__name">{label}</tspan>
          <tspan className={`eq-node__state eq-node__state--${stale ? "stale" : state}`} x={width + 7} dy={17}>
            {stateWord}
          </tspan>
        </text>
      ) : (
        <text
          className="eq-node__label"
          x={width / 2}
          y={labelAt === "below" ? height + 19 : -12}
          textAnchor="middle"
        >
          <tspan className="eq-node__name">{label}</tspan>
          <tspan className={`eq-node__state eq-node__state--${stale ? "stale" : state}`} dx={6}>
            {stateWord}
          </tspan>
        </text>
      )}
    </g>
  );
}
