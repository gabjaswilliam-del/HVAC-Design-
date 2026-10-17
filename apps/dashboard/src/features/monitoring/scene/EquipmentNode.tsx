import type { CSSProperties, KeyboardEvent } from "react";
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
  /** Makes the node a keyboard-operable button that selects this equipment. */
  onSelect?: (id: string) => void;
  /** Connected to the selection: stays at full emphasis while others dim. */
  related?: boolean;
  /** Pointed out by another feature (assistant, pilot) without being selected. */
  highlighted?: boolean;
  /** Draw the name and state; off in Key mode, where they are drawn in screen space. */
  showLabel?: boolean;
  /** Draw and announce the operational/review state beside the equipment name. */
  showState?: boolean;
  /** In fault or named by an open issue: stays at full emphasis whatever is selected. */
  alarm?: boolean;
  /** CAD review status; when present it replaces the operational state label and tints the whole sprite. */
  reviewState?: "confirmed" | "review" | "conflict" | "unknown";
  reviewLabel?: string;
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
  onSelect,
  related = false,
  highlighted = false,
  showLabel = true,
  showState = true,
  alarm = false,
  reviewState,
  reviewLabel,
}: EquipmentNodeProps) {
  const s = useStrings();
  const { width, height } = spriteGeometry[kind];
  const still = state !== "running" || stale;
  const period = speedHz && speedHz > 0 ? (50 / speedHz) * 0.9 : undefined;
  const stateWord = reviewLabel ?? (stale ? s.scene.states.stale : s.scene.states[state]);
  const badge = stale ? "stale" : state === "fault" || state === "unavailable" ? state : null;

  const classes = [
    "eq-node",
    `eq-node--${state}`,
    still && "eq-node--still",
    stale && "eq-node--stale",
    selected && "eq-node--selected",
    (selected || related) && "eq-node--related",
    highlighted && "eq-node--highlighted",
    alarm && "eq-node--alarm",
    reviewState && `eq-node--review-${reviewState}`,
    onSelect && "eq-node--interactive",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      className={classes}
      transform={`translate(${x} ${y})`}
      data-equipment-id={id}
      style={period ? ({ "--fan-period": `${period}s` } as CSSProperties) : undefined}
      {...(onSelect && {
        role: "button",
        tabIndex: 0,
        "aria-label": showState ? `${label}, ${stateWord}` : label,
        "aria-pressed": selected,
        onClick: () => onSelect(id),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(id);
          }
        },
      })}
    >
      {onSelect && (
        <rect
          className="eq-node__hit"
          x={-HALO_PAD}
          y={labelAt === "above" ? -30 : -HALO_PAD}
          width={width + HALO_PAD * 2 + (labelAt === "right" ? 100 : 0)}
          height={height + HALO_PAD * 2 + (labelAt === "below" ? 22 : 0)}
        />
      )}
      {highlighted && !selected && (
        <rect
          className="eq-node__frame eq-node__frame--highlighted"
          x={-HALO_PAD - 4}
          y={-HALO_PAD - 4}
          width={width + HALO_PAD * 2 + 8}
          height={height + HALO_PAD * 2 + 8}
          rx={8}
        />
      )}
      {selected && (
        <rect
          className="eq-node__halo"
          x={-HALO_PAD}
          y={-HALO_PAD}
          width={width + HALO_PAD * 2}
          height={height + HALO_PAD * 2}
          rx={6}
        />
      )}
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
      {!showLabel ? null : labelAt === "right" ? (
        <text className="eq-node__label" x={width + 7} y={height - 20}>
          <tspan className="eq-node__name">{label}</tspan>
          {showState && <tspan className={`eq-node__state${reviewState ? ` eq-node__state--review-${reviewState}` : ` eq-node__state--${stale ? "stale" : state}`}`} x={width + 7} dy={17}>{stateWord}</tspan>}
        </text>
      ) : (
        <text
          className="eq-node__label"
          x={width / 2}
          y={labelAt === "below" ? height + 19 : -12}
          textAnchor="middle"
        >
          <tspan className="eq-node__name">{label}</tspan>
          {showState && <tspan className={`eq-node__state${reviewState ? ` eq-node__state--review-${reviewState}` : ` eq-node__state--${stale ? "stale" : state}`}`} dx={6}>{stateWord}</tspan>}
        </text>
      )}
    </g>
  );
}
