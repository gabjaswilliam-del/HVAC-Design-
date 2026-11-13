export interface Xyz {
  x: number;
  y: number;
  z: number;
}

export function orbitOffset(offset: Xyz, azimuthDegrees: number, polarDegrees = 0, maxPolarDegrees = 80): Xyz {
  const radius = Math.hypot(offset.x, offset.y, offset.z);
  const theta = Math.atan2(offset.x, offset.z) + (azimuthDegrees * Math.PI) / 180;
  const phi = Math.max(0, Math.min((maxPolarDegrees * Math.PI) / 180, Math.acos(offset.y / radius) + (polarDegrees * Math.PI) / 180));
  return {
    x: radius * Math.sin(phi) * Math.sin(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.cos(theta),
  };
}

export function clampTarget(target: Xyz, center: Xyz, spanX: number, spanZ: number): Xyz {
  const limitX = Math.max(240, spanX * 0.8);
  const limitZ = Math.max(240, spanZ * 0.8);
  return {
    x: Math.max(center.x - limitX, Math.min(center.x + limitX, target.x)),
    y: Math.max(center.y - 240, Math.min(center.y + 240, target.y)),
    z: Math.max(center.z - limitZ, Math.min(center.z + limitZ, target.z)),
  };
}
