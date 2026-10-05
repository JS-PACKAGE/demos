import { CONTRACT, EVENTS, type Vec3 } from '../show/contract.ts';

/**
 * Cinematic camera work. Everything here is a pure function of absolute show time,
 * so seeking, rewinding and replay reproduce the identical frame.
 */

const RAD = Math.PI / 180;
const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------
// Lens: long focal lengths flatten perspective and stack the planet behind the ships. Each shot is
// pulled back along its own line of sight by `pullback` while the field of view narrows by the same
// factor, so the subject plane keeps its authored framing and only the perspective compresses.
// `push` is a slow dolly toward the subject across the shot, the cheapest way to make a held frame breathe.
// Keyed by the shot's start time in CONTRACT.cameraTrack.
// ---------------------------------------------------------------------------------------------
const LENS: Readonly<Record<number, { pullback: number; push: number }>> = {
  0: { pullback: 1.2, push: 0 }, 20: { pullback: 1.2, push: .1 },
  70: { pullback: 1.2, push: .12 }, 75: { pullback: 1.2, push: .1 }, 80: { pullback: 1.3, push: .1 },
  85: { pullback: 1.2, push: .12 }, 90: { pullback: 1.2, push: .08 }, 93: { pullback: 1.3, push: .08 },
  95: { pullback: 1.25, push: 0 },
};
// The ground camera stands on the terrain: it crops instead of retreating.
const SURFACE_FOV_SCALE = .8;

/**
 * Handheld base amplitude (degrees of pan/tilt) by subject. Orbital cameras on a long lens are steady;
 * the camera standing on the ground wobbles with the tremors.
 */
function sway(t: number): number {
  const { surfaceStart, surfaceEnd, countdownStart, impactTime, breakupTime } = CONTRACT.scene;
  if (t < 20) return .05;
  if (t < surfaceStart) return .08;
  if (t < surfaceEnd) return .12 + .08 * smooth((t - surfaceStart) / (surfaceEnd - surfaceStart));
  if (t < countdownStart + .01) return .1;
  if (t < impactTime) return .1 + .04 * smooth((t - countdownStart) / (impactTime - countdownStart));
  if (t < breakupTime) return .12 + .18 * smooth((t - impactTime) / (breakupTime - impactTime));
  return .1;
}

/** Hits that physically shake the camera: [time, peak degrees, decay seconds, frequency Hz]. */
const IMPULSES: readonly (readonly [number, number, number, number])[] = [
  ...EVENTS.filter(event => event.kind === 'fire').map(event => [event.t, .22, .55, 11] as const),
  ...EVENTS.filter(event => event.kind === 'kill').map(event => [event.t, .12, .4, 13] as const),
  [CONTRACT.scene.impactTime, 1.15, 1.3, 9],
  [CONTRACT.scene.breakupTime, 1.9, 2.2, 7],
  [CONTRACT.scene.peakTime, 1.5, 2.6, 6],
];

/** Sum of incommensurate sines: smooth, bounded, deterministic. */
const wobble = (t: number, a: number, b: number, c: number): number =>
  (Math.sin(t * a + 1.7) + Math.sin(t * b + 4.1) * .6 + Math.sin(t * c + 2.3) * .35) / 1.95;

export interface CinematicCamera { position: Vec3; target: Vec3; fov: number; roll: number }

/**
 * Re-lenses and shakes an authored pose. `grounded` shots stand on the terrain, so they crop instead of
 * pulling back (moving would put the eye underground).
 */
export function cinematicCamera(t: number, position: Vec3, target: Vec3, fov: number, grounded: boolean): CinematicCamera {
  const shot = CONTRACT.cameraTrack.find(entry => t >= entry.start && t < entry.end) ?? CONTRACT.cameraTrack[CONTRACT.cameraTrack.length - 1]!;
  const lens = LENS[shot.start] ?? { pullback: 1, push: 0 };
  const pullback = grounded ? 1 : lens.pullback;
  const half = Math.tan(fov * RAD / 2) * (grounded ? SURFACE_FOV_SCALE : 1 / pullback);
  const outFov = 2 * Math.atan(half) / RAD;
  const distance = grounded ? 1 : pullback * (1 - lens.push * smooth((t - shot.start) / (shot.end - shot.start)));
  const [px, py, pz] = grounded ? position : [target[0] + (position[0] - target[0]) * distance,
    target[1] + (position[1] - target[1]) * distance, target[2] + (position[2] - target[2]) * distance] as Vec3;

  const amplitude = sway(t);
  let pan = wobble(t, 1.31, 2.77, 5.3) * amplitude, tilt = wobble(t + 17, 1.07, 3.1, 6.1) * amplitude * .8, roll = wobble(t + 41, .83, 1.9, 4.3) * amplitude * .5;
  // The quake builds while the wound is open, then the planet lets go.
  const rumble = smooth((t - CONTRACT.scene.impactTime) / 12) * (1 - smooth((t - CONTRACT.scene.breakupTime) / 1.5)) * .22;
  pan += wobble(t, 17, 23.3, 31) * rumble; tilt += wobble(t + 5, 19, 27, 33) * rumble; roll += wobble(t + 9, 13, 21, 29) * rumble * .6;
  for (const [at, peak, decay, hz] of IMPULSES) {
    const age = t - at;
    if (age < 0 || age > decay * 6) continue;
    const energy = peak * Math.exp(-age / decay) * Math.min(1, age / .04);
    pan += Math.sin(age * hz * 2 * Math.PI) * energy;
    tilt += Math.sin(age * hz * 2 * Math.PI * 1.31 + 1.3) * energy * .8;
    roll += Math.sin(age * hz * 2 * Math.PI * .73 + .6) * energy * .5;
  }

  // Pan/tilt as a rotation of the view direction about the eye, in the camera's own basis.
  let fx = target[0] - px, fy = target[1] - py, fz = target[2] - pz;
  const length = Math.hypot(fx, fy, fz) || 1; fx /= length; fy /= length; fz /= length;
  // right = forward x world-up = (-fz, 0, fx); looking straight up or down falls back to +X.
  let rx = -fz, rz = fx;
  const rl = Math.hypot(rx, rz); if (rl < 1e-4) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  const p = Math.tan(pan * RAD), q = Math.tan(tilt * RAD), reach = length / Math.hypot(1, p, q);
  const tx = px + (fx + rx * p + ux * q) * reach, ty = py + (fy + uy * q) * reach, tz = pz + (fz + rz * p + uz * q) * reach;
  return { position: [px, py, pz], target: [tx, ty, tz], fov: outFov, roll: roll * RAD };
}
