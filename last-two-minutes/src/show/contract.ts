export type Vec3 = readonly [number, number, number];
export interface CameraPose { position: Vec3; target: Vec3; fov: number }
export interface CameraKeyframe extends CameraPose { t: number }
export interface CameraShot { start: number; end: number; subject: 'planet' | 'combat' | 'surface' | 'weapon' | 'defenders'; frames: readonly CameraKeyframe[] }
export interface ShowEvent {
  id: string;
  t: number;
  kind: 'fire' | 'shield' | 'kill' | 'impact' | 'break';
  position: Vec3;
  pan: number;
  detail?: 'distant' | 'fleet-pass' | 'shockwave';
}

export const CONTRACT = {
  seed: 20261004,
  duration: 120,
  budgets: { fighters: 128, capitals: 6, emitters: 2, particleCapacity: 2048, shadowLights: 0, textureSize: 1024, fragments: 192, stars: 600 },
  visual: {
    planetRadius: 10, terrainSegments: 256, terrainRings: 128, terrainHeight: .45,
    textureSize: 2048, fragmentCount: 128, fragmentVariants: 6,
    dustCapacity: 1024, previewDuration: 12,
    engineParticles: { capacity: 256, rate: 180, lifetime: .8 },
    breakupLead: 1.5,
    lightDirection: [-1, .45, .45] as Vec3,
    damageDirection: [-.25, .18, .95] as Vec3,
    shadowMapSize: 2048, environmentWidth: 256, stars: 320,
    views: {
      flyby: { position: [0, 4, 34] as Vec3, target: [0, 0, 0] as Vec3, fov: 45 },
      wounded: { position: [0, 3, 28] as Vec3, target: [-.5, 1, 0] as Vec3, fov: 48 },
      aftermath: { position: [0, 7, 54] as Vec3, target: [0, 0, 0] as Vec3, fov: 45 },
      combat: { position: [0, 10, 43] as Vec3, target: [0, 0, 0] as Vec3, fov: 55 },
    },
  },
  planet: { center: [0, 0, 0] as Vec3, radius: 10 },
  camera: { near: 0.05, far: 2000, minimumTestedAspect: 9 / 16 },
  planetInFrameMaxAngle: 0.1,
  scene: {
    planetRadius: 10, impactTime: 95, breakupTime: 110, peakTime: 112, aftermathTime: 114,
    combatStart: 20, combatEnd: 50, surfaceStart: 50, surfaceEnd: 70, countdownStart: 70, countdownEnd: 95,
    weaponPosition: [-26, 13, -16] as Vec3,
  },
  beats: [
    { start: 0, end: 20, label: '建立重量' },
    { start: 20, end: 50, label: '戰火逼近' },
    { start: 50, end: 70, label: '地表危機' },
    { start: 70, end: 95, label: '無法阻止的倒數' },
    { start: 95, end: 110, label: '命中後先不崩' },
    { start: 110, end: 120, label: '崩解' },
  ],
  cameraTrack: [
    { start: 0, end: 20, subject: 'planet', frames: [
      { t: 0, position: [0, 3, 12], target: [0, 1, 0], fov: 60 },
      { t: 20, position: [0, 7, 34], target: [0, 0, 0], fov: 60 },
    ] },
    { start: 20, end: 50, subject: 'combat', frames: [
      { t: 20, position: [8, 9, 38], target: [0, 0, 0], fov: 70 },
      { t: 35, position: [-10, 8, 40], target: [0, 0, 0], fov: 70 },
      { t: 50, position: [12, 10, 38], target: [0, 0, 0], fov: 70 },
    ] },
    { start: 50, end: 70, subject: 'surface', frames: [
      { t: 50, position: [0, 10.2, 0.4], target: [0, 18, -14], fov: 65 },
      { t: 70, position: [0.6, 10.2, 0.2], target: [-4, 18, -14], fov: 65 },
    ] },
    { start: 70, end: 75, subject: 'weapon', frames: [
      { t: 70, position: [-18, 16, 4], target: [-26, 13, -16], fov: 48 },
      { t: 75, position: [-17, 16, 2], target: [-26, 13, -16], fov: 48 },
    ] },
    { start: 75, end: 80, subject: 'defenders', frames: [
      { t: 75, position: [20, 12, 28], target: [10, 11, 6], fov: 58 },
      { t: 80, position: [18, 12, 26], target: [10, 11, 6], fov: 58 },
    ] },
    { start: 80, end: 85, subject: 'planet', frames: [
      { t: 80, position: [0, 6, 44], target: [0, 0, 0], fov: 54 },
      { t: 85, position: [0, 6, 44], target: [0, 0, 0], fov: 54 },
    ] },
    { start: 85, end: 90, subject: 'weapon', frames: [
      { t: 85, position: [-16, 15, 0], target: [-26, 13, -16], fov: 44 },
      { t: 90, position: [-15, 15, -1], target: [-26, 13, -16], fov: 44 },
    ] },
    { start: 90, end: 93, subject: 'defenders', frames: [
      { t: 90, position: [18, 10, 25], target: [7, 10, 7], fov: 58 },
      { t: 93, position: [16, 10, 24], target: [7, 10, 7], fov: 58 },
    ] },
    { start: 93, end: 95, subject: 'planet', frames: [
      { t: 93, position: [0, 6, 44], target: [0, 0, 0], fov: 54 },
      { t: 95, position: [0, 6, 44], target: [0, 0, 0], fov: 54 },
    ] },
    { start: 95, end: 120, subject: 'planet', frames: [
      { t: 95, position: [12, 8, 42], target: [0, 0, 0], fov: 58 },
      { t: 104, position: [0, 12, 64], target: [0, 0, 0], fov: 58 },
      { t: 120, position: [0, 12, 64], target: [0, 0, 0], fov: 58 },
    ] },
  ] as readonly CameraShot[],
  brightness: [
    { t: 0, value: 0.75 }, { t: 20, value: 0.85 }, { t: 50, value: 1 }, { t: 70, value: 0.8 },
    { t: 95, value: 1.3 }, { t: 97, value: 0.9 }, { t: 104, value: 0.7 }, { t: 110, value: 0.7 },
    { t: 112, value: 4 }, { t: 114, value: 2.1 }, { t: 118, value: 0.8 }, { t: 120, value: 0.3 },
  ],
  mix: [
    { t: 0, value: 0.3 }, { t: 20, value: 0.65 }, { t: 70, value: 0.7 }, { t: 94.8, value: 0.7 },
    { t: 95, value: 0.018 }, { t: 104, value: 0.006 }, { t: 109.999, value: 0.006 },
    { t: 110, value: 0.85 }, { t: 114, value: 0.6 }, { t: 120, value: 0.025 },
  ],
  duck: { t0: 95, t1: 110, gain: 0.018 },
  crack: [{ t: 0, value: 0 }, { t: 95, value: 0 }, { t: 97, value: 0.15 }, { t: 104, value: 1 }, { t: 120, value: 1 }],
  breakup: [{ t: 0, value: 0 }, { t: 110, value: 0 }, { t: 114, value: 0.65 }, { t: 120, value: 1 }],
  weaponCharge: [{ t: 0, value: 0 }, { t: 70, value: 0 }, { t: 94.999, value: 1 }, { t: 95, value: 0 }, { t: 120, value: 0 }],
  quietWindows: [{ start: 80, end: 85 }, { start: 93, end: 95 }, { start: 95, end: 110 }],
} as const;

export const EVENTS: readonly ShowEvent[] = [
  { id: 'first-fire', t: 6, kind: 'fire', position: [-20, 10, -24], pan: -0.7, detail: 'distant' },
  { id: 'fleet-arrival', t: 12, kind: 'fire', position: [16, 8, 14], pan: 0.6, detail: 'fleet-pass' },
  { id: 'crossfire-a', t: 22, kind: 'fire', position: [12, 5, 16], pan: 0.65 },
  { id: 'shield-a', t: 26, kind: 'shield', position: [-12, 7, 12], pan: -0.5 },
  { id: 'crossfire-b', t: 31, kind: 'fire', position: [-15, 6, 18], pan: -0.7 },
  { id: 'wreck-a', t: 35, kind: 'kill', position: [16, 8, 8], pan: 0.7 },
  { id: 'crossfire-c', t: 41, kind: 'fire', position: [14, 9, 20], pan: 0.6 },
  { id: 'shield-b', t: 46, kind: 'shield', position: [-16, 5, 8], pan: -0.6 },
  { id: 'sky-fire-a', t: 53, kind: 'fire', position: [-8, 19, -10], pan: -0.6 },
  { id: 'sky-fire-b', t: 61, kind: 'fire', position: [10, 20, -14], pan: 0.7 },
  { id: 'sky-fire-c', t: 67, kind: 'fire', position: [-4, 18, -8], pan: -0.3 },
  { id: 'weapon-focus', t: 72, kind: 'fire', position: [-26, 13, -16], pan: -0.7 },
  { id: 'defender-one', t: 77, kind: 'kill', position: [10, 11, 6], pan: 0.4 },
  { id: 'weapon-focus-two', t: 87, kind: 'fire', position: [-26, 13, -16], pan: -0.7 },
  { id: 'defender-two', t: 91, kind: 'kill', position: [7, 10, 7], pan: 0.3 },
  { id: 'planet-impact', t: 95, kind: 'impact', position: [-5.5, 5, 6.7], pan: 0 },
  { id: 'planet-break', t: 110, kind: 'break', position: [0, 0, 0], pan: 0 },
  { id: 'shockwave', t: 112, kind: 'break', position: [0, 0, 0], pan: 0, detail: 'shockwave' },
];

/** Independent PRNG state per consumer/replay; unsigned 32-bit Mulberry32. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
