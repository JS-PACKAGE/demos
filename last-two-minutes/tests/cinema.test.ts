import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT } from '../src/show/contract.ts';
import { sampleShow } from '../src/show/director.ts';
import { cinematicCamera } from '../src/scene/cinema.ts';
import { gradeAt } from '../src/ui/film.ts';
import type { Vec3 } from '../src/show/contract.ts';

const grounded = (t: number) => t >= CONTRACT.scene.surfaceStart && t < CONTRACT.scene.surfaceEnd;
const camera = (t: number) => { const { camera: pose } = sampleShow(t); return cinematicCamera(t, pose.position, pose.target, pose.fov, grounded(t)); };

test('the cinematic camera is finite and reproducible at every moment of the show', () => {
  for (let tick = 0; tick <= 2400; tick++) {
    const t = tick / 20, a = camera(t), b = camera(t);
    for (const value of [...a.position, ...a.target, a.fov, a.roll]) assert.ok(Number.isFinite(value), `non-finite pose at ${t}s`);
    assert.deepEqual(a, b, `pose is not a pure function of time at ${t}s`);
    assert.ok(a.fov > 0 && a.fov < 120, `fov ${a.fov} out of range at ${t}s`);
    assert.ok(Math.abs(a.roll) < 4 * Math.PI / 180, `roll ${a.roll} too large at ${t}s`);
  }
});

test('the ground camera keeps its eye on the terrain', () => {
  for (let t = CONTRACT.scene.surfaceStart; t < CONTRACT.scene.surfaceEnd; t += .25) {
    const authored = sampleShow(t).camera;
    assert.deepEqual(camera(t).position, authored.position);
  }
});

test('lens compression keeps the framing of the subject plane', () => {
  // Shots without a dolly: the angular half-width of a subject at the target must not change.
  for (const t of [0, CONTRACT.scene.impactTime]) {
    const authored = sampleShow(t).camera, shot = camera(t);
    const distance = (eye: Vec3, target: Vec3) => Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]);
    const before = distance(authored.position, authored.target) * Math.tan(authored.fov * Math.PI / 360);
    const after = distance(shot.position, shot.target) * Math.tan(shot.fov * Math.PI / 360);
    assert.ok(Math.abs(after - before) / before < 1e-9, `framing changed at ${t}s`);
    assert.ok(distance(shot.position, shot.target) > distance(authored.position, authored.target), `no pull-back at ${t}s`);
  }
});

test('the grade is bounded and moves smoothly between acts', () => {
  let previous = gradeAt(0);
  for (let tick = 1; tick <= 7200; tick++) {
    const g = gradeAt(tick / 60);
    for (const value of [...g.tint, g.cast, g.vignette, g.grain, g.contrast, g.saturation]) assert.ok(Number.isFinite(value));
    assert.ok(g.saturation > 0 && g.saturation <= 1.2 && g.contrast >= 1 && g.contrast <= 1.3 && g.vignette >= 0 && g.vignette <= 1);
    // Eased cross-fade: no act boundary may snap a channel by more than a few percent in one frame.
    assert.ok(Math.abs(g.saturation - previous.saturation) < .03 && Math.abs(g.cast - previous.cast) < .01, `grade jumped at ${tick / 60}s`);
    previous = g;
  }
});
