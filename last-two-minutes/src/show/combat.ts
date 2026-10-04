import { CONTRACT, seededRandom } from './contract.ts';
import type { Vec3 } from './contract.ts';
import { BARREL_HEIGHT, BARREL_OFFSETS, MUZZLE_Z, SHIP_TURRET_MOUNTS } from '../scene/ship-hardpoints.ts';

export interface CombatShip {
  readonly side: 'defender' | 'attacker';
  readonly scale: number;
  readonly origin: Vec3;
  readonly velocity: Vec3;
  readonly yaw: number;
  /** Script time at which this ship's shield collapses and hits reach the armor; omitted = never. */
  readonly shieldDown?: number;
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
  /** Contact point and outward surface normal in the target ship's local frame. */
  readonly local: Vec3;
  readonly normal: Vec3;
  readonly result: 'shield' | 'hull' | 'kill';
}
export interface CombatShipPose { x: number; y: number; z: number; yaw: number; scale: number; destroyed: boolean }
export interface CombatGunPose { yaw: number; pitch: number; recoil: number }
export interface CombatPoint { x: number; y: number; z: number }
export interface CombatProjectilePose extends CombatPoint { visible: boolean }

/** An independent, replayable battle: ships on rails plus seeded gun crews. */
export interface CombatScript {
  readonly ships: readonly CombatShip[];
  readonly shots: readonly CombatShot[];
  /** Destroyed ship index to the script time of the fatal impact. */
  readonly kills: ReadonlyMap<number, number>;
  readonly duration: number;
  /** Distant screening hulls use a fixed low-detail instanced representation, not full gun crews. */
  readonly escorts?: readonly CombatShip[];
  /** Ships glide in from `offsets` over the `duration` seconds before script time 0. */
  readonly approach?: { readonly duration: number; readonly offsets: readonly Vec3[] };
}
export interface CombatFatalShot {
  readonly source: number; readonly turret: number; readonly target: number;
  /** Earliest launch; a seeded .18 s jitter is added. Ignored when `hitAt` is set. */
  readonly earliest?: number;
  /** Exact script time of the lethal impact; the launch time is solved backwards from it. */
  readonly hitAt?: number;
  /** Regular fire stops after this time so the lethal shot has a clean beat; unnecessary with `hitAt`. */
  readonly stopAfter?: number;
}
export interface CombatScriptConfig {
  readonly seed: number;
  readonly duration: number;
  readonly ships: readonly CombatShip[];
  readonly stopAfter: number;
  readonly reload?: readonly [number, number];
  readonly firstAim?: readonly [number, number];
  readonly fatal?: readonly CombatFatalShot[];
  /** No shot may launch, fly, or land inside these script-time intervals. */
  readonly silence?: readonly (readonly [number, number])[];
  /** Non-lethal shield hits land on the shield bubble instead of the armor panel. */
  readonly bubble?: boolean;
  readonly approach?: CombatScript['approach'];
  /** Longest projectile flight the solver may resolve, in seconds. */
  readonly maxFlight?: number;
  readonly escorts?: readonly CombatShip[];
}

export const COMBAT_DURATION = 12;
export const COMBAT_PROJECTILE_SPEED = 18;
export const COMBAT_YAW_SPEED = 1.2;
export const COMBAT_PITCH_SPEED = .65;

// Centroid of the actual raised top face of forward armor band 0, panel 1.
// The .016 height is HullBuilder.panel's .08 * .2 top-face offset.
export const COMBAT_ARMOR_POINT: Vec3 = Object.freeze([.3325833333333333, .296, -3.7725]);
/** The armor panel slopes along Z; scorch and venting follow its normal. */
export const COMBAT_ARMOR_NORMAL: Vec3 = Object.freeze([0, .9957 / Math.hypot(.9957, .0926), -.0926 / Math.hypot(.9957, .0926)]);
/** Shield bubble around the hull: center and semi-axes in ship-local units. */
export const COMBAT_SHIELD_CENTER: Vec3 = Object.freeze([0, .2, -.4]);
export const COMBAT_SHIELD_RADII: Vec3 = Object.freeze([2.9, 1.7, 6.3]);

/** World position of a ship-local point at a script time. */
export function sampleCombatPoint(ships: readonly CombatShip[], ship: number, local: Vec3, time: number, out: CombatPoint): void {
  const definition = ships[ship]!;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  out.x = definition.origin[0] + definition.velocity[0] * time + definition.scale * (c * local[0] + s * local[2]);
  out.y = definition.origin[1] + definition.velocity[1] * time + definition.scale * local[1];
  out.z = definition.origin[2] + definition.velocity[2] * time + definition.scale * (-s * local[0] + c * local[2]);
}

/** Transform the moving armor attachment, rather than aiming at a hull center. */
export function sampleCombatArmor(ship: number, time: number, out: CombatPoint, ships: readonly CombatShip[] = COMBAT_SHIPS): void {
  sampleCombatPoint(ships, ship, COMBAT_ARMOR_POINT, time, out);
}

// Solve the sideways barrel offset as well as elevation: the bore, not just
// the housing's centerline, must pass through the fixed intercept endpoint.
function gunYaw(dx: number, dz: number, offset: number): number {
  return -Math.atan2(dx, -dz) + Math.asin(offset / Math.hypot(dx, dz));
}
function gunPitch(dx: number, dy: number, dz: number, offset: number): number {
  return Math.atan2(dy, Math.sqrt(dx * dx + dz * dz - offset * offset));
}

export function sampleCombatMuzzle(ship: number, turret: number, barrel: number, time: number, aim: Vec3, out: CombatPoint, ships: readonly CombatShip[] = COMBAT_SHIPS): void {
  const definition = ships[ship]!, mount = SHIP_TURRET_MOUNTS[turret]!;
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
interface Contact { readonly local: Vec3; readonly normal: Vec3 }
const ARMOR_CONTACT: Contact = Object.freeze({ local: COMBAT_ARMOR_POINT, normal: COMBAT_ARMOR_NORMAL });

/** Shooter-facing point on the shield ellipsoid, nudged by a seeded jitter. */
function bubbleContact(ships: readonly CombatShip[], source: number, target: number, time: number, jitter: Vec3): Contact {
  const shooter = ships[source]!, definition = ships[target]!;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  const wx = (shooter.origin[0] + shooter.velocity[0] * time - definition.origin[0] - definition.velocity[0] * time) / definition.scale;
  const wy = (shooter.origin[1] + shooter.velocity[1] * time - definition.origin[1] - definition.velocity[1] * time) / definition.scale;
  const wz = (shooter.origin[2] + shooter.velocity[2] * time - definition.origin[2] - definition.velocity[2] * time) / definition.scale;
  let x = c * wx - s * wz - COMBAT_SHIELD_CENTER[0], y = wy - COMBAT_SHIELD_CENTER[1], z = s * wx + c * wz - COMBAT_SHIELD_CENTER[2];
  const length = Math.hypot(x, y, z) || 1;
  x = x / length + jitter[0]; y = y / length + jitter[1]; z = z / length + jitter[2];
  const [a, b, d] = COMBAT_SHIELD_RADII;
  const k = 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / d) ** 2);
  const px = x * k, py = y * k, pz = z * k;
  const nx = px / (a * a), ny = py / (b * b), nz = pz / (d * d), n = Math.hypot(nx, ny, nz);
  return Object.freeze({
    local: Object.freeze([COMBAT_SHIELD_CENTER[0] + px, COMBAT_SHIELD_CENTER[1] + py, COMBAT_SHIELD_CENTER[2] + pz] as const),
    normal: Object.freeze([nx / n, ny / n, nz / n] as const),
  });
}

function solveShot(ships: readonly CombatShip[], id: string, source: number, target: number, turret: number, barrel: number,
  fireTime: number, result: CombatShot['result'], contact: Contact, maxFlight: number): BallisticShot {
  const endpoint: CombatPoint = { x: 0, y: 0, z: 0 }, muzzle: CombatPoint = { x: 0, y: 0, z: 0 };
  const aim: [number, number, number] = [0, 0, 0];
  let lo = 0, hi = maxFlight;
  // Source pose is fixed at launch; the contact point moves with the target throughout flight.
  for (let iteration = 0; iteration < 54; iteration++) {
    const travel = (lo + hi) / 2;
    sampleCombatPoint(ships, target, contact.local, fireTime + travel, endpoint);
    aim[0] = endpoint.x; aim[1] = endpoint.y; aim[2] = endpoint.z;
    sampleCombatMuzzle(source, turret, barrel, fireTime, aim, muzzle, ships);
    const distance = Math.hypot(endpoint.x - muzzle.x, endpoint.y - muzzle.y, endpoint.z - muzzle.z);
    if (distance > COMBAT_PROJECTILE_SPEED * travel) lo = travel; else hi = travel;
  }
  const hitTime = fireTime + (lo + hi) / 2;
  sampleCombatPoint(ships, target, contact.local, hitTime, endpoint);
  aim[0] = endpoint.x; aim[1] = endpoint.y; aim[2] = endpoint.z;
  sampleCombatMuzzle(source, turret, barrel, fireTime, aim, muzzle, ships);
  // A root pinned at the bracket edge means the target is out of range, not a hit.
  if (hi >= maxFlight - 1e-9) throw new Error(`Shot ${id} cannot reach its target within ${maxFlight}s`);
  return Object.freeze({ id, source, target, turret, barrel, fireTime, hitTime, result,
    start: Object.freeze([muzzle.x, muzzle.y, muzzle.z] as const), end: Object.freeze([...aim] as Vec3),
    local: contact.local, normal: contact.normal });
}

function sampleShotAim(ships: readonly CombatShip[], shot: BallisticShot, out: CombatGunPose): void {
  const definition = ships[shot.source]!, mount = SHIP_TURRET_MOUNTS[shot.turret]!;
  const wx = (shot.end[0] - definition.origin[0] - definition.velocity[0] * shot.fireTime) / definition.scale;
  const wz = (shot.end[2] - definition.origin[2] - definition.velocity[2] * shot.fireTime) / definition.scale;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  const dx = c * wx - s * wz - mount[0];
  const dy = (shot.end[1] - definition.origin[1] - definition.velocity[1] * shot.fireTime) / definition.scale - mount[1] - BARREL_HEIGHT;
  const dz = s * wx + c * wz - mount[2], offset = BARREL_OFFSETS[shot.barrel]!;
  out.yaw = gunYaw(dx, dz, offset); out.pitch = gunPitch(dx, dy, dz, offset);
}

/** One independent gun crew: reload, acquire, slew, settle, then fire. */
function planCrew(config: CombatScriptConfig, source: number, turret: number, dead: ReadonlyMap<number, number>): CombatShot[] {
  const { ships } = config;
  const shots: CombatShot[] = [];
  const random = seededRandom(config.seed + source * 977 + turret * 131);
  const reload = config.reload ?? [.5, 1.9], firstAim = config.firstAim ?? [.05, 1.5];
  const side = ships[source]!.side;
  const enemies = ships.flatMap((ship, index) => ship.side === side ? [] : [index]);
  const fatal = config.fatal?.find(spec => spec.source === source && spec.turret === turret);
  const silence = config.silence ?? [];
  const maxFlight = config.maxFlight ?? 2;
  const holdFire = (time: number, spread: number): number => {
    for (const [from, to] of silence) if (time < to && time + maxFlight > from) time = to + spread;
    return time;
  };
  let fromYaw = (random() - .5) * 1.1, fromPitch = (random() - .5) * .18;
  let aimStart = firstAim[0] + random() * firstAim[1], sequence = 0;
  const aim: CombatGunPose = { yaw: 0, pitch: 0, recoil: 0 };
  const plan = (target: number, earliestFire: number, isFatal = false, hitAt?: number): CombatShot => {
    const barrel = random() < .5 ? 0 : 1, settle = .18 + random() * .22;
    const minimumSlew = .55 + random() * .35;
    const jitter: Vec3 = config.bubble ? [(random() - .5) * .5, (random() - .5) * .34, (random() - .5) * .5] : [0, 0, 0];
    // Crews released from a hold-fire window must not volley in unison.
    const spread = silence.length ? random() * 1.4 : 0;
    const id = `combat-${source}-${turret}-${sequence++}`;
    const shield = ships[target]!.shieldDown ?? Infinity;
    let duration = minimumSlew, fireTime = holdFire(Math.max(earliestFire, aimStart + duration + settle), spread);
    let shot: BallisticShot;
    const solve = (): BallisticShot => {
      const result = isFatal ? 'kill' : fireTime < shield ? 'shield' : 'hull';
      const contact = config.bubble && result === 'shield' ? bubbleContact(ships, source, target, fireTime, jitter) : ARMOR_CONTACT;
      return solveShot(ships, id, source, target, turret, barrel, fireTime, result, contact, maxFlight);
    };
    // Arrival and slew duration depend on the future launch pose. Resolve
    // that dependency once, never with frame-time RNG or target snapping.
    for (let iteration = 0; iteration < 12; iteration++) {
      shot = solve();
      sampleShotAim(ships, shot, aim);
      // Quintic easing peaks at 1.875 times its average angular speed.
      duration = Math.max(minimumSlew, 1.875 * Math.abs(aim.yaw - fromYaw) / COMBAT_YAW_SPEED,
        1.875 * Math.abs(aim.pitch - fromPitch) / COMBAT_PITCH_SPEED) + .002;
      fireTime = hitAt === undefined ? holdFire(Math.max(earliestFire, aimStart + duration + settle), spread) : hitAt - (shot.hitTime - shot.fireTime);
    }
    shot = solve();
    sampleShotAim(ships, shot, aim);
    if (hitAt !== undefined && (Math.abs(shot.hitTime - hitAt) > 1e-9 || fireTime < aimStart + duration + settle - 1e-9))
      throw new Error(`Authored impact at ${hitAt}s is unreachable for crew ${source}/${turret}`);
    return Object.freeze({ ...shot, aimStart, aimEnd: aimStart + duration, fromYaw, fromPitch, aimYaw: aim.yaw, aimPitch: aim.pitch });
  };
  const stopAfter = fatal?.stopAfter ?? config.stopAfter;
  const sourceDeath = dead.get(source) ?? Infinity;
  while (enemies.length) {
    const first = Math.floor(random() * enemies.length);
    let shot: CombatShot | undefined;
    for (let offset = 0; offset < enemies.length && !shot; offset++) {
      const target = enemies[(first + offset) % enemies.length]!, death = dead.get(target) ?? Infinity;
      if (death <= aimStart + .2) continue;
      const candidate = plan(target, aimStart);
      if (candidate.hitTime < death - .02) shot = candidate;
    }
    // Leave space for an authored fatal beat and its cooling aftermath,
    // but never synchronize the independent crews into alternating turns.
    if (!shot || shot.fireTime > stopAfter || shot.hitTime > config.duration || shot.fireTime >= sourceDeath) break;
    // The lethal crew must still have time to reload, slew and settle for its authored impact.
    if (fatal?.hitAt !== undefined && shot.fireTime + reload[0] + reload[1] + 3 > fatal.hitAt - .6) break;
    shots.push(shot);
    fromYaw = shot.aimYaw; fromPitch = shot.aimPitch;
    aimStart = shot.fireTime + reload[0] + random() * reload[1];
  }
  if (fatal) shots.push(fatal.hitAt === undefined ? plan(fatal.target, fatal.earliest! + random() * .18, true) : plan(fatal.target, 0, true, fatal.hitAt));
  return shots;
}

export function createCombatScript(config: CombatScriptConfig): CombatScript {
  const fatalSpecs = config.fatal ?? [];
  // Pass 0 discovers when each authored kill lands; pass 1 plans every crew
  // knowing who is already dead, and must reproduce those same kills.
  const kills = new Map<number, number>();
  for (const spec of fatalSpecs) {
    const shots = planCrew(config, spec.source, spec.turret, kills);
    kills.set(spec.target, shots[shots.length - 1]!.hitTime);
  }
  const shots: CombatShot[] = [];
  for (let source = 0; source < config.ships.length; source++) {
    for (let turret = 0; turret < 2; turret++) shots.push(...planCrew(config, source, turret, kills));
  }
  for (const spec of fatalSpecs) {
    const lethal = shots.find(shot => shot.result === 'kill' && shot.source === spec.source && shot.turret === spec.turret);
    if (!lethal || lethal.hitTime !== kills.get(spec.target)) throw new Error(`Authored kill of ship ${spec.target} is not reproducible`);
  }
  return Object.freeze({ ships: config.ships, shots: Object.freeze(shots.sort((a, b) => a.fireTime - b.fireTime)),
    kills, duration: config.duration, approach: config.approach, escorts: config.escorts });
}

export const COMBAT_SHIPS: readonly CombatShip[] = Object.freeze(([
  { side: 'defender', scale: .43, origin: [-8, 0, 20], velocity: [.12, 0, -.1], yaw: -Math.PI / 2, shieldDown: 2.2 },
  { side: 'defender', scale: .28, origin: [-6.8, .2, 14], velocity: [.1, 0, .08], yaw: -Math.PI / 2, shieldDown: 2.2 },
  { side: 'attacker', scale: .4, origin: [8, .05, 19], velocity: [-.1, 0, -.08], yaw: Math.PI / 2, shieldDown: 2.2 },
  { side: 'attacker', scale: .27, origin: [6.8, .15, 14], velocity: [-.1, 0, .08], yaw: Math.PI / 2, shieldDown: 2.2 },
] satisfies readonly CombatShip[]).map(ship => Object.freeze({ ...ship, origin: Object.freeze(ship.origin), velocity: Object.freeze(ship.velocity) })));

const PREVIEW_CONFIG: CombatScriptConfig = {
  seed: CONTRACT.seed, duration: COMBAT_DURATION, ships: COMBAT_SHIPS, stopAfter: 6.8,
  fatal: [{ source: 1, turret: 0, target: 3, earliest: 7.75, stopAfter: 5.7 }],
};

/** Independent seeded gun crews with no shared turn order. */
export function createCombatShots(seed: number): readonly CombatShot[] {
  return createCombatScript({ ...PREVIEW_CONFIG, seed }).shots;
}

export const COMBAT_SCRIPT: CombatScript = createCombatScript(PREVIEW_CONFIG);
export const COMBAT_SHOTS = COMBAT_SCRIPT.shots;
export const COMBAT_KILL_TIME = COMBAT_SCRIPT.kills.get(3)!;

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

export function sampleCombatShip(index: number, time: number, out: CombatShipPose, script: CombatScript = COMBAT_SCRIPT, shock = 0): void {
  const ship = script.ships[index]!;
  out.x = ship.origin[0] + ship.velocity[0] * time;
  out.y = ship.origin[1] + ship.velocity[1] * time;
  out.z = ship.origin[2] + ship.velocity[2] * time;
  const approach = script.approach;
  if (approach && time < 0) {
    // Ease-out glide: the fleet decelerates onto its station without a speed pop.
    const remaining = 1 - smoothstep(Math.max(0, (time + approach.duration) / approach.duration));
    const offset = approach.offsets[index]!;
    out.x += offset[0] * remaining; out.y += offset[1] * remaining; out.z += offset[2] * remaining;
  }
  if (shock > 0) {
    // The planetary shockwave reaches each hull after a radial delay, then accelerates it outward.
    const r = Math.hypot(out.x, out.y, out.z) || 1, push = Math.max(0, shock - (r - CONTRACT.planet.radius) / 4);
    const distance = 3 * (push - 1 + Math.exp(-push));
    out.x += out.x / r * distance; out.y += out.y / r * distance + distance * .2; out.z += out.z / r * distance;
  }
  out.yaw = ship.yaw; out.scale = ship.scale;
  const death = script.kills.get(index);
  out.destroyed = death !== undefined && time >= death;
}

export function sampleCombatGun(ship: number, turret: number, time: number, out: CombatGunPose, shots: readonly CombatShot[] = COMBAT_SHOTS): void {
  let selected: CombatShot | undefined;
  for (const shot of shots) {
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
