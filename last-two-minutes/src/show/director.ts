import { CONTRACT, EVENTS } from './contract.ts';
import type { CameraPose, ShowEvent, Vec3 } from './contract.ts';

export type PlanetPhase = 'intact' | 'wounded' | 'breaking' | 'aftermath';
export interface ShowSample {
  t: number;
  beat: number;
  label: string;
  phase: PlanetPhase;
  camera: CameraPose;
  brightness: number;
  gain: number;
  crack: number;
  breakup: number;
  weaponCharge: number;
  quiet: boolean;
}

function sampleCurve(track: readonly { t: number; value: number }[], t: number): number {
  for (let index = 1; index < track.length; index++) {
    const next = track[index]!;
    if (t <= next.t) {
      const previous = track[index - 1]!;
      const progress = Math.max(0, Math.min(1, (t - previous.t) / (next.t - previous.t)));
      return previous.value + (next.value - previous.value) * progress;
    }
  }
  return track[track.length - 1]!.value;
}

/** Samples absolute simulation time: no accumulated camera, geometry, or mix state. */
export function sampleShow(time: number): ShowSample {
  const t = Number.isNaN(time) ? 0 : Math.max(0, Math.min(CONTRACT.duration, time));
  const beat = Math.max(0, CONTRACT.beats.findIndex(entry => t < entry.end));
  const beatIndex = t === CONTRACT.duration ? CONTRACT.beats.length - 1 : beat;
  const shot = CONTRACT.cameraTrack.find(entry => t >= entry.start && t < entry.end) ?? CONTRACT.cameraTrack[CONTRACT.cameraTrack.length - 1]!;
  let frameIndex = shot.frames.findIndex(entry => entry.t >= t);
  if (frameIndex < 0) frameIndex = shot.frames.length - 1;
  const next = shot.frames[frameIndex]!;
  const previous = shot.frames[Math.max(0, frameIndex - 1)]!;
  const progress = next.t === previous.t ? 0 : Math.max(0, Math.min(1, (t - previous.t) / (next.t - previous.t)));
  const position: Vec3 = [
    previous.position[0] + (next.position[0] - previous.position[0]) * progress,
    previous.position[1] + (next.position[1] - previous.position[1]) * progress,
    previous.position[2] + (next.position[2] - previous.position[2]) * progress,
  ];
  const target: Vec3 = [
    previous.target[0] + (next.target[0] - previous.target[0]) * progress,
    previous.target[1] + (next.target[1] - previous.target[1]) * progress,
    previous.target[2] + (next.target[2] - previous.target[2]) * progress,
  ];
  const phase: PlanetPhase = t < CONTRACT.scene.impactTime ? 'intact' : t < CONTRACT.scene.breakupTime ? 'wounded' : t < CONTRACT.scene.aftermathTime ? 'breaking' : 'aftermath';
  const ducked = t >= CONTRACT.duck.t0 && t < CONTRACT.duck.t1;
  return {
    t,
    beat: beatIndex,
    label: CONTRACT.beats[beatIndex]!.label,
    phase,
    camera: { position, target, fov: previous.fov + (next.fov - previous.fov) * progress },
    brightness: sampleCurve(CONTRACT.brightness, t),
    // The exact release boundary restores gain; no interpolation leaks into the held silence.
    gain: ducked ? Math.min(CONTRACT.duck.gain, sampleCurve(CONTRACT.mix, t)) : sampleCurve(CONTRACT.mix, t),
    crack: sampleCurve(CONTRACT.crack, t),
    breakup: sampleCurve(CONTRACT.breakup, t),
    weaponCharge: sampleCurve(CONTRACT.weaponCharge, t),
    quiet: CONTRACT.quietWindows.some(window => t >= window.start && t < window.end),
  };
}

/** Half-open traversal delivers boundary events once even when a frame skips over them. */
export function eventsBetween(from: number, to: number): readonly ShowEvent[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  return EVENTS.filter(event => event.t > from && event.t <= to);
}
