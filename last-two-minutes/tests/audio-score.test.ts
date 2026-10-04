import test from 'node:test';
import assert from 'node:assert/strict';
import { SCORE, type ScoreNote } from '../src/audio/score.ts';
import { VOICES } from '../src/audio/synthesis.ts';
import { CONTRACT } from '../src/show/contract.ts';

const audibleEnd = (note: ScoreNote) =>
  note.t + note.duration + Math.max(...VOICES[note.voice].ops.map(operator => operator.adsr.r));

test('score fits eight native OPM slots even while envelopes release', () => {
  const edges = SCORE.flatMap(note => [[note.t, 1], [audibleEnd(note), -1]] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0;
  for (const [time, change] of edges) {
    active += change;
    assert.ok(active <= 8, `voice stealing at ${time}s: ${active} active notes`);
  }
  assert.equal(active, 0);
});

test('release tails do not spill into quiet planet shots or the post-impact silence', () => {
  const quiet = CONTRACT.cameraTrack.filter(shot => shot.subject === 'planet' &&
    shot.start >= CONTRACT.scene.countdownStart && shot.end <= CONTRACT.scene.impactTime)
    .map(shot => [shot.start, shot.end] as const);
  quiet.push([CONTRACT.scene.impactTime + 3, CONTRACT.scene.breakupTime]);
  for (const [start, end] of quiet) for (const note of SCORE) {
    assert.ok(audibleEnd(note) <= start || note.t >= end,
      `${note.voice} at ${note.t}s spills into ${start}–${end}s`);
  }
});
