import type { Vec3 } from '../show/contract.ts';

/** Forward -Z, dorsal +Y; housing and barrel share the raised yaw/pitch pivot. */
export const SHIP_TURRET_MOUNTS: readonly Vec3[] = Object.freeze([
  Object.freeze([-.69, .59, -1.68] as const),
  Object.freeze([.69, .59, -1.68] as const),
  Object.freeze([-.91, .63, .73] as const),
  Object.freeze([.91, .63, .73] as const),
]);
export const BARREL_OFFSETS = Object.freeze([-.085, .085] as const);
export const BARREL_HEIGHT = .24;
export const MUZZLE_Z = -.84;
