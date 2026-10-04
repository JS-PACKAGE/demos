import { CONTRACT, seededRandom, type Vec3 } from './contract.ts';
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
  readonly aimStart: number;
  readonly aimEnd: number;
  readonly fromYaw: number;
  readonly fromPitch: number;
  readonly aimYaw: number;
  readonly aimPitch: number;
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
export const COMBAT_YAW_SPEED = 1.2;
export const COMBAT_PITCH_SPEED = .65;
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

type BallisticShot = Omit<CombatShot, 'aimStart' | 'aimEnd' | 'fromYaw' | 'fromPitch' | 'aimYaw' | 'aimPitch'>;

function solveShot(id: string, source: number, target: number, turret: number, barrel: number, fireTime: number, result: CombatShot['result']): BallisticShot {
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

function sampleShotAim(shot: BallisticShot, out: CombatGunPose): void {
  const definition = COMBAT_SHIPS[shot.source]!, mount = SHIP_TURRET_MOUNTS[shot.turret]!;
  const wx = (shot.end[0] - definition.origin[0] - definition.velocity[0] * shot.fireTime) / definition.scale;
  const wz = (shot.end[2] - definition.origin[2] - definition.velocity[2] * shot.fireTime) / definition.scale;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  const dx = c * wx - s * wz - mount[0];
  const dy = (shot.end[1] - definition.origin[1] - definition.velocity[1] * shot.fireTime) / definition.scale - mount[1] - BARREL_HEIGHT;
  const dz = s * wx + c * wz - mount[2], offset = BARREL_OFFSETS[shot.barrel]!;
  out.yaw = gunYaw(dx, dz, offset); out.pitch = gunPitch(dx, dy, dz, offset);
}

/** Independent seeded gun crews: reload, acquire, slew, settle, then fire. */
export function createCombatShots(seed: number): readonly CombatShot[] {
  const shots: CombatShot[] = [];
  for (let source = 0; source < COMBAT_SHIPS.length; source++) {
    for (let turret = 0; turret < 2; turret++) {
      const random = seededRandom(seed + source * 977 + turret * 131);
      let fromYaw = (random() - .5) * 1.1, fromPitch = (random() - .5) * .18;
      let aimStart = .05 + random() * 1.5, sequence = 0;
      const aim: CombatGunPose = { yaw: 0, pitch: 0, recoil: 0 };
      const plan = (target: number, earliestFire: number, fatal = false): CombatShot => {
        const barrel = random() < .5 ? 0 : 1, settle = .18 + random() * .22;
        const minimumSlew = .55 + random() * .35;
        const id = `combat-${source}-${turret}-${sequence++}`;
        let duration = minimumSlew, fireTime = Math.max(earliestFire, aimStart + duration + settle);
        let shot: BallisticShot;
        // Arrival and slew duration depend on the future launch pose. Resolve
        // that dependency once, never with frame-time RNG or target snapping.
        for (let iteration = 0; iteration < 12; iteration++) {
          shot = solveShot(id, source, target, turret, barrel, fireTime, fatal ? 'kill' : fireTime < 2.2 ? 'shield' : 'hull');
          sampleShotAim(shot, aim);
          // Quintic easing peaks at 1.875 times its average angular speed.
          duration = Math.max(minimumSlew, 1.875 * Math.abs(aim.yaw - fromYaw) / COMBAT_YAW_SPEED,
            1.875 * Math.abs(aim.pitch - fromPitch) / COMBAT_PITCH_SPEED) + .002;
          fireTime = Math.max(earliestFire, aimStart + duration + settle);
        }
        shot = solveShot(id, source, target, turret, barrel, fireTime, fatal ? 'kill' : fireTime < 2.2 ? 'shield' : 'hull');
        sampleShotAim(shot, aim);
        return Object.freeze({ ...shot, aimStart, aimEnd: aimStart + duration, fromYaw, fromPitch, aimYaw: aim.yaw, aimPitch: aim.pitch });
      };
      while (true) {
        const target = source < 2 ? 2 + Math.floor(random() * 2) : Math.floor(random() * 2);
        const shot = plan(target, aimStart);
        // Leave space for the authored fatal beat and its cooling aftermath,
        // but never synchronize the independent crews into alternating turns.
        if (shot.fireTime > (source === 1 && turret === 0 ? 5.7 : 6.8)) break;
        shots.push(shot);
        fromYaw = shot.aimYaw; fromPitch = shot.aimPitch;
        aimStart = shot.fireTime + .5 + random() * 1.9;
      }
      if (source === 1 && turret === 0) shots.push(plan(3, 7.75 + random() * .18, true));
    }
  }
  return Object.freeze(shots.sort((a, b) => a.fireTime - b.fireTime));
}

export const COMBAT_SHOTS = createCombatShots(CONTRACT.seed);
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
    if (!selected) selected = shot;
    if (shot.aimStart > time) break;
    selected = shot;
  }
  out.yaw = 0; out.pitch = 0; out.recoil = 0;
  if (!selected) return;
  const phase = Math.max(0, Math.min(1, (time - selected.aimStart) / (selected.aimEnd - selected.aimStart)));
  const blend = phase * phase * phase * (phase * (phase * 6 - 15) + 10);
  out.yaw = selected.fromYaw + (selected.aimYaw - selected.fromYaw) * blend;
  out.pitch = selected.fromPitch + (selected.aimPitch - selected.fromPitch) * blend;
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
