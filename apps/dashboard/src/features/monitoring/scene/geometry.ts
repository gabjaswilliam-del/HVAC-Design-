/**
 * Native drawing size and pipe-connection ports of each sprite, in scene units at
 * scale 1. Port names match the topology family's port names so a scene can route a
 * pipe to `[deviceId, port]` without knowing how the artwork is drawn.
 */

export interface Point {
  x: number;
  y: number;
}

export type SpriteKind = "chiller" | "pump" | "coolingTower" | "dataHall";

interface SpriteGeometry {
  width: number;
  height: number;
  ports: Record<string, Point>;
}

export const spriteGeometry: Record<SpriteKind, SpriteGeometry> = {
  // Condenser water box on the left end, evaporator water box on the right end.
  chiller: {
    width: 180,
    height: 112,
    ports: {
      cond_in: { x: 0, y: 62 },
      cond_out: { x: 0, y: 92 },
      evap_out: { x: 180, y: 62 },
      evap_in: { x: 180, y: 92 },
    },
  },
  // Drawn motor-left, volute-right. Flip to face the suction header.
  pump: {
    width: 86,
    height: 56,
    ports: {
      suction: { x: 86, y: 31 },
      discharge: { x: 66.5, y: 0 },
    },
  },
  coolingTower: {
    width: 78,
    height: 100,
    ports: {
      water_in: { x: 37, y: 0 },
      water_out: { x: 37, y: 100 },
    },
  },
  // The lumped terminal: one aggregate data-hall load, not individual air handlers.
  dataHall: {
    width: 240,
    height: 190,
    ports: {
      water_in: { x: 0, y: 98 },
      water_out: { x: 0, y: 124 },
    },
  },
};

/** Absolute position of a sprite's port, honouring a horizontal flip. */
export function portPosition(
  kind: SpriteKind,
  port: string,
  at: Point,
  flip = false,
): Point {
  const g = spriteGeometry[kind];
  const p = g.ports[port];
  if (!p) throw new Error(`Sprite ${kind} has no port ${port}`);
  return { x: at.x + (flip ? g.width - p.x : p.x), y: at.y + p.y };
}
