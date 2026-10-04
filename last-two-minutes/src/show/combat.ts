import type { Vec3 } from './contract.ts';
import { BARREL_HEIGHT, BARREL_OFFSETS, MUZZLE_Z, SHIP_TURRET_MOUNTS } from '../scene/ship-hardpoints.ts';

export interface CombatShip {
  readonly side: 'defender' | 'attacker';
  readonly scale: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
}
export interface CombatShot {
  readonly id: string;
  readonly source: number;
  readonly target: number;
  readonly turret: number;
  readonly barrel: number;
  readonly fireTime: number;
  readonly hitTime: number;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly result: 'shield' | 'hull' | 'kill';
}
export interface CombatShipPose { x: number; y: number; z: number; yaw: number; scale: number; destroyed: boolean }
export interface CombatGunPose { yaw: number; pitch: number; recoil: number }
export interface CombatPoint { x: number; y: number; z: number }
export interface CombatProjectilePose extends CombatPoint { visible: boolean }

export const COMBAT_DURATION = 12;
export const COMBAT_PROJECTILE_SPEED = 18;
export const COMBAT_SHIPS: readonly CombatShip[] = Object.freeze(([
  { side: 'defender', scale: .43, origin: [-8, 0, 20], velocity: [.12, 0, -.1], yaw: -Math.PI / 2 },
  { side: 'defender', scale: .28, origin: [-6.8, .2, 14], velocity: [.1, 0, .08], yaw: -Math.PI / 2 },
  { side: 'attacker', scale: .4, origin: [8, .05, 19], velocity: [-.1, 0, -.08], yaw: Math.PI / 2 },
  { side: 'attacker', scale: .27, origin: [6.8, .15, 14], velocity: [-.1, 0, .08], yaw: Math.PI / 2 },
] satisfies readonly CombatShip[]).map(ship => Object.freeze({ ...ship, origin: Object.freeze(ship.origin), velocity: Object.freeze(ship.velocity) })));

// Centroid of the actual raised top face of forward armor band 0, panel 1.
// The .016 height is HullBuilder.panel's .08 * .2 top-face offset.
export const COMBAT_ARMOR_POINT: Vec3 = Object.freeze([.3325833333333333, .296, -3.7725]);

/** Transform the moving armor attachment, rather than aiming at a hull center. */
export function sampleCombatArmor(ship: number, time: number, out: CombatPoint): void {
  const definition = COMBAT_SHIPS[ship]!;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  out.x = definition.origin[0] + definition.velocity[0] * time + definition.scale * (c * COMBAT_ARMOR_POINT[0] + s * COMBAT_ARMOR_POINT[2]);
  out.y = definition.origin[1] + definition.velocity[1] * time + definition.scale * COMBAT_ARMOR_POINT[1];
  out.z = definition.origin[2] + definition.velocity[2] * time + definition.scale * (-s * COMBAT_ARMOR_POINT[0] + c * COMBAT_ARMOR_POINT[2]);
}

// Solve the sideways barrel offset as well as elevation: the bore, not just
// the housing's centerline, must pass through the fixed intercept endpoint.
function gunYaw(dx: number, dz: number, offset: number): number {
  return -Math.atan2(dx, -dz) + Math.asin(offset / Math.hypot(dx, dz));
}
function gunPitch(dx: number, dy: number, dz: number, offset: number): number {
  return Math.atan2(dy, Math.sqrt(dx * dx + dz * dz - offset * offset));
}

export function sampleCombatMuzzle(ship: number, turret: number, barrel: number, time: number, aim: Vec3, out: CombatPoint): void {
  const definition = COMBAT_SHIPS[ship]!, mount = SHIP_TURRET_MOUNTS[turret]!;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw), scale = definition.scale;
  const ox = definition.origin[0] + definition.velocity[0] * time;
  const oy = definition.origin[1] + definition.velocity[1] * time;
  const oz = definition.origin[2] + definition.velocity[2] * time;
  const wx = (aim[0] - ox) / scale, wz = (aim[2] - oz) / scale;
  const dx = c * wx - s * wz - mount[0];
  const dy = (aim[1] - oy) / scale - mount[1] - BARREL_HEIGHT;
  const dz = s * wx + c * wz - mount[2];
  const offset = BARREL_OFFSETS[barrel]!;
  const yaw = gunYaw(dx, dz, offset), pitch = gunPitch(dx, dy, dz, offset);
  const localY = -MUZZLE_Z * Math.sin(pitch);
  const localZ = MUZZLE_Z * Math.cos(pitch);
  const x = mount[0] + Math.cos(yaw) * offset + Math.sin(yaw) * localZ;
  const y = mount[1] + BARREL_HEIGHT + localY;
  const z = mount[2] - Math.sin(yaw) * offset + Math.cos(yaw) * localZ;
  out.x = ox + scale * (c * x + s * z);
  out.y = oy + scale * y;
  out.z = oz + scale * (-s * x + c * z);
}

function solveShot(id: string, source: number, target: number, turret: number, barrel: number, fireTime: number, result: CombatShot['result']): CombatShot {
  const endpoint: CombatPoint = { x: 0, y: 0, z: 0 }, muzzle: CombatPoint = { x: 0, y: 0, z: 0 };
  const aim: [number, number, number] = [0, 0, 0];
  let lo = 0, hi = 2;
  // Source pose is fixed at launch; target armor moves throughout flight.
  for (let iteration = 0; iteration < 54; iteration++) {
    const travel = (lo + hi) / 2;
    sampleCombatArmor(target, fireTime + travel, endpoint);
    aim[0] = endpoint.x; aim[1] = endpoint.y; aim[2] = endpoint.z;
    sampleCombatMuzzle(source, turret, barrel, fireTime, aim, muzzle);
    const distance = Math.hypot(endpoint.x - muzzle.x, endpoint.y - muzzle.y, endpoint.z - muzzle.z);
    if (distance > COMBAT_PROJECTILE_SPEED * travel) lo = travel; else hi = travel;
  }
  const hitTime = fireTime + (lo + hi) / 2;
  sampleCombatArmor(target, hitTime, endpoint);
  aim[0] = endpoint.x; aim[1] = endpoint.y; aim[2] = endpoint.z;
  sampleCombatMuzzle(source, turret, barrel, fireTime, aim, muzzle);
  return Object.freeze({ id, source, target, turret, barrel, fireTime, hitTime, result,
    start: Object.freeze([muzzle.x, muzzle.y, muzzle.z] as const), end: Object.freeze([...aim] as Vec3) });
}

// Alternating readable exchanges. Escort 3 burns for several seconds before
// its final arrival at ~8.5s; no escort shot remains in flight at destruction.
const volleys: readonly (readonly [number, number, number, CombatShot['result']])[] = [
  [.35, 0, 2, 'shield'], [1.2, 2, 0, 'shield'],
  [2.05, 1, 3, 'shield'], [2.95, 3, 1, 'shield'],
  [3.85, 0, 2, 'hull'], [4.7, 1, 3, 'hull'],
  [5.55, 2, 0, 'hull'], [6.35, 3, 1, 'hull'],
  [7.05, 1, 3, 'hull'], [7.8, 1, 3, 'kill'],
];
export const COMBAT_SHOTS: readonly CombatShot[] = Object.freeze(volleys.flatMap(([time, source, target, result], volley) => {
  // Final volley: one preceding breach and exactly one fatal arrival.
  return [0, 1].map(barrel => solveShot(`combat-${volley}-${barrel}`, source, target, 0, barrel, time + barrel * .1,
    result === 'kill' && barrel === 0 ? 'hull' : result));
}));
export const COMBAT_KILL_TIME = COMBAT_SHOTS.find(shot => shot.result === 'kill')!.hitTime;

export function sampleCombatShip(index: number, time: number, out: CombatShipPose): void {
  const ship = COMBAT_SHIPS[index]!;
  out.x = ship.origin[0] + ship.velocity[0] * time;
  out.y = ship.origin[1] + ship.velocity[1] * time;
  out.z = ship.origin[2] + ship.velocity[2] * time;
  out.yaw = ship.yaw; out.scale = ship.scale;
  out.destroyed = index === 3 && time >= COMBAT_KILL_TIME;
}

export function sampleCombatGun(ship: number, turret: number, time: number, out: CombatGunPose): void {
  let selected: CombatShot | undefined;
  for (const shot of COMBAT_SHOTS) {
    if (shot.source !== ship || shot.turret !== turret) continue;
    if (!selected || shot.fireTime <= time) selected = shot;
    if (shot.fireTime > time) break;
  }
  out.yaw = 0; out.pitch = 0; out.recoil = 0;
  if (!selected) return;
  const definition = COMBAT_SHIPS[ship]!, mount = SHIP_TURRET_MOUNTS[turret]!;
  const wx = (selected.end[0] - definition.origin[0] - definition.velocity[0] * time) / definition.scale;
  const wz = (selected.end[2] - definition.origin[2] - definition.velocity[2] * time) / definition.scale;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  const dx = c * wx - s * wz - mount[0];
  const dy = (selected.end[1] - definition.origin[1] - definition.velocity[1] * time) / definition.scale - mount[1] - BARREL_HEIGHT;
  const dz = s * wx + c * wz - mount[2], offset = BARREL_OFFSETS[selected.barrel]!;
  out.yaw = gunYaw(dx, dz, offset); out.pitch = gunPitch(dx, dy, dz, offset);
  const age = time - selected.fireTime;
  if (age > 0 && age < .28) out.recoil = .13 * Math.sin(Math.PI * age / .28) * (1 - age / .28);
}

export function sampleCombatProjectile(shot: CombatShot, time: number, out: CombatProjectilePose): void {
  const phase = Math.max(0, Math.min(1, (time - shot.fireTime) / (shot.hitTime - shot.fireTime)));
  out.x = shot.start[0] + (shot.end[0] - shot.start[0]) * phase;
  out.y = shot.start[1] + (shot.end[1] - shot.start[1]) * phase;
  out.z = shot.start[2] + (shot.end[2] - shot.start[2]) * phase;
  out.visible = time >= shot.fireTime && time < shot.hitTime;
}
