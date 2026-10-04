import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT, EVENTS, seededRandom } from '../src/show/contract.ts';
import { ShowClock } from '../src/show/clock.ts';
import { sampleShow, eventsBetween } from '../src/show/director.ts';
import type { CameraPose, Vec3 } from '../src/show/contract.ts';

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
};

// Sphere against all perspective frustum planes, not just its center angle.
function planetInsideFrustum(camera: CameraPose, aspect: number): boolean {
  const forward = unit(subtract(camera.target, camera.position));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const center = subtract(CONTRACT.planet.center, camera.position);
  const depth = dot(center, forward);
  const vertical = camera.fov * Math.PI / 360;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const radius = CONTRACT.planet.radius;
  return depth - radius >= CONTRACT.camera.near && depth + radius <= CONTRACT.camera.far &&
    depth * Math.sin(horizontal) - Math.abs(dot(center, right)) * Math.cos(horizontal) >= radius &&
    depth * Math.sin(vertical) - Math.abs(dot(center, up)) * Math.cos(vertical) >= radius;
}

test('six hard boundaries exactly partition the 120-second show', () => {
  assert.equal(CONTRACT.duration, 120);
  assert.deepEqual(CONTRACT.beats.map(beat => [beat.start, beat.end]), [[0, 20], [20, 50], [50, 70], [70, 95], [95, 110], [110, 120]]);
  for (let beat = 0; beat < 6; beat++) {
    const entry = CONTRACT.beats[beat]!;
    assert.equal(sampleShow(entry.start).beat, beat);
    assert.equal(sampleShow(entry.end - 0.000001).beat, beat);
  }
  assert.equal(sampleShow(120).beat, 5);
  assert.deepEqual(sampleShow(-1), sampleShow(0));
  assert.deepEqual(sampleShow(121), sampleShow(120));
});

test('topology stays whole until 110, then breaks and settles', () => {
  for (let tick = 0; tick < 11000; tick++) {
    const sample = sampleShow(tick / 100);
    assert.equal(sample.phase, tick < 9500 ? 'intact' : 'wounded');
    assert.equal(sample.breakup, 0);
  }
  assert.equal(sampleShow(110).phase, 'breaking');
  assert.equal(sampleShow(113.999).phase, 'breaking');
  assert.equal(sampleShow(114).phase, 'aftermath');
  assert.equal(sampleShow(120).phase, 'aftermath');
  assert.ok(sampleShow(104).crack > sampleShow(95).crack);
  assert.ok(sampleShow(120).breakup > 0);
});

test('combat planet sphere fits both landscape and portrait frustums', () => {
  for (let tick = 2000; tick < 5000; tick++) {
    const camera = sampleShow(tick / 100).camera;
    const forward = unit(subtract(camera.target, camera.position));
    const towardPlanet = unit(subtract(CONTRACT.planet.center, camera.position));
    assert.ok(Math.acos(Math.min(1, dot(forward, towardPlanet))) <= CONTRACT.planetInFrameMaxAngle);
    for (const aspect of [16 / 9, 1, 9 / 16]) {
      assert.ok(planetInsideFrustum(camera, aspect), `planet clipped at ${tick / 100}s, aspect ${aspect}`);
    }
  }
});

test('opening fills the view and surface/countdown transitions are hard cuts', () => {
  assert.ok(Math.hypot(...sampleShow(0).camera.position) < 14);
  assert.ok(Math.hypot(...sampleShow(19.999).camera.position) > 30);
  const surface = sampleShow(50).camera;
  assert.ok(Math.hypot(...surface.position) > CONTRACT.planet.radius);
  assert.ok(Math.hypot(...surface.position) < CONTRACT.planet.radius + 1);
  assert.ok(surface.target[1] > surface.position[1]);
  for (const cut of [20, 50, 70, 75, 80, 85, 90, 93, 95]) {
    assert.ok(Math.hypot(...subtract(sampleShow(cut).camera.position, sampleShow(cut - 0.000001).camera.position)) > 1, `not a hard cut at ${cut}`);
  }
  for (const t of [80, 81, 82, 83, 84.999, 93, 94.999]) {
    assert.equal(sampleShow(t).quiet, true);
    assert.equal(EVENTS.filter(event => event.t >= 80 && event.t < 85 || event.t >= 93 && event.t < 95).length, 0);
  }
});

test('brightness peaks in release, fades before ending, and wounded interval ducks', () => {
  let peak = { t: 0, value: -Infinity };
  for (let tick = 0; tick <= 12000; tick++) {
    const sample = sampleShow(tick / 100);
    assert.ok(Number.isFinite(sample.brightness));
    assert.ok(sample.gain >= 0 && sample.gain <= 1);
    if (sample.brightness > peak.value) peak = { t: sample.t, value: sample.brightness };
    if (sample.t >= 95 && sample.t < 110) assert.ok(sample.gain <= 0.02);
  }
  assert.ok(peak.t >= 110 && peak.t <= 114 && peak.t < 118);
  assert.ok(sampleShow(120).brightness < peak.value);
  assert.ok(sampleShow(120).brightness < sampleShow(114).brightness);
  assert.ok(sampleShow(109).t > sampleShow(104).t);
  assert.ok(sampleShow(110 - 1e-8).gain <= 0.02);
  assert.ok(sampleShow(110).gain > 0.02);
});

test('seeded random and samples replay identically without shared mutable state', () => {
  assert.equal(CONTRACT.seed, 20261004);
  const a = seededRandom(CONTRACT.seed);
  const b = seededRandom(CONTRACT.seed);
  const different = seededRandom(CONTRACT.seed + 1);
  const sequence = Array.from({ length: 100 }, () => a());
  assert.deepEqual(sequence, Array.from({ length: 100 }, () => b()));
  assert.notDeepEqual(sequence, Array.from({ length: 100 }, () => different()));
  assert.ok(sequence.every(value => value >= 0 && value < 1));
  const first = sampleShow(84);
  sampleShow(120);
  assert.deepEqual(sampleShow(84), first);
});

test('event intervals deliver once, including a skipped-frame impact and release', () => {
  assert.ok(EVENTS.length > 0);
  assert.ok(EVENTS.every((event, i) => event.t >= 0 && event.t <= 120 && (i === 0 || event.t >= EVENTS[i - 1]!.t)));
  assert.equal(new Set(EVENTS.map(event => event.id)).size, EVENTS.length);
  for (const event of EVENTS.filter(event => event.kind === 'kill')) {
    assert.ok(Math.hypot(...subtract(event.position, CONTRACT.planet.center)) > CONTRACT.planet.radius, `${event.id} hidden inside planet`);
    if (event.t >= 70 && event.t < 95) assert.deepEqual(sampleShow(event.t).camera.target, event.position);
  }
  assert.ok(EVENTS.some(event => event.kind === 'impact' && event.t === 95));
  assert.ok(EVENTS.some(event => event.kind === 'break' && event.t === 110));
  assert.ok(EVENTS.some(event => event.detail === 'shockwave' && event.t >= 110 && event.t <= 114));
  assert.deepEqual([...eventsBetween(0, 95), ...eventsBetween(95, 120)], eventsBetween(0, 120));
  assert.deepEqual(eventsBetween(95, 95), []);
  assert.deepEqual(eventsBetween(100, 90), []);
  assert.ok(eventsBetween(94, 111).some(event => event.kind === 'impact'));
  assert.ok(eventsBetween(94, 111).some(event => event.kind === 'break'));
});

test('clock only advances simulation frames; pause and hidden frames never catch up', () => {
  const clock = new ShowClock();
  assert.equal(clock.status, 'ready');
  assert.equal(clock.advance(10), 0);
  clock.start();
  assert.equal(clock.advance(1), 1);
  assert.equal(clock.advance(50, true), 1);
  assert.equal(clock.advance(0.25), 1.25);
  clock.pause();
  assert.equal(clock.status, 'paused');
  assert.equal(clock.advance(50), 1.25);
  clock.resume();
  assert.equal(clock.advance(0.25), 1.5);
  for (const delta of [-1, NaN, Infinity]) assert.equal(clock.advance(delta), 1.5);
  assert.equal(clock.advance(1000), 120);
  assert.equal(clock.status, 'ended');
  clock.start();
  clock.resume();
  assert.equal(clock.advance(1), 120);
  clock.seed = CONTRACT.seed + 1;
  clock.reset();
  assert.equal(clock.status, 'ready');
  assert.equal(clock.time, 0);
  assert.equal(clock.seed, CONTRACT.seed);
  assert.equal(clock.advance(50), 0);
  clock.start();
  assert.equal(clock.advance(1), 1);
  assert.deepEqual(sampleShow(clock.time), sampleShow(1));
});
