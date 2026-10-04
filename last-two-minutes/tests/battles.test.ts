import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT, EVENTS } from '../src/show/contract.ts';
import { sampleShow } from '../src/show/director.ts';
import { BATTLES, DEFENDER_BATTLE, FLEET_BATTLE, SKY_BATTLE, battleVisible } from '../src/show/battles.ts';
import { COMBAT_SHIELD_CENTER, COMBAT_SHIELD_RADII, createCombatScript, sampleCombatPoint, sampleCombatShip, type CombatPoint } from '../src/show/combat.ts';
import { CUES } from '../src/audio/score.ts';

const planetQuiet = CONTRACT.quietWindows.filter(window => window.end <= CONTRACT.scene.impactTime);
const pose = { x: 0, y: 0, z: 0, yaw: 0, scale: 1, destroyed: false };

test('authored kills land on their director events, at the dying ship', () => {
  const kills = EVENTS.filter(event => event.kind === 'kill');
  assert.equal(kills.length, 3);
  for (const event of kills) {
    const battle = BATTLES.find(entry => [...entry.script.kills.values()].some(time => Math.abs(entry.start + time - event.t) < 1e-6));
    assert.ok(battle, `${event.id} has no lethal shot`);
    const [ship] = [...battle.script.kills].find(([, time]) => Math.abs(battle.start + time - event.t) < 1e-6)!;
    sampleCombatShip(ship, event.t - battle.start, pose, battle.script);
    assert.ok(Math.hypot(pose.x - event.position[0], pose.y - event.position[1], pose.z - event.position[2]) < .02, `${event.id} is not at its ship`);
  }
  // The two defender kills are also the camera subjects.
  assert.deepEqual(sampleShow(77).camera.target, EVENTS.find(event => event.id === 'defender-one')!.position);
  assert.deepEqual(sampleShow(91).camera.target, EVENTS.find(event => event.id === 'defender-two')!.position);
});

test('nothing fires, flies or lands while the director holds the planet shots quiet, or while dead', () => {
  for (const battle of BATTLES) {
    for (const shot of battle.script.shots) {
      const fire = battle.start + shot.fireTime, hit = battle.start + shot.hitTime;
      for (const window of planetQuiet) assert.ok(hit <= window.start || fire >= window.end, `${shot.id} crosses ${window.start}-${window.end}`);
      const sourceDeath = battle.script.kills.get(shot.source), targetDeath = battle.script.kills.get(shot.target);
      assert.ok(sourceDeath === undefined || shot.fireTime < sourceDeath, `${shot.id} fired by a dead ship`);
      assert.ok(targetDeath === undefined || shot.hitTime <= targetDeath + 1e-9, `${shot.id} hits a wreck`);
      assert.ok(shot.hitTime <= battle.script.duration);
    }
  }
  // 95-110 is the ducked wound hold, where the impact itself is the one authored sound.
  for (const cue of CUES) for (const window of planetQuiet) assert.ok(cue.t < window.start || cue.t >= window.end, `cue ${cue.t} is inside a quiet window`);
});

test('every gunfire cue lands while its ships are on screen, and kills sound as breakups', () => {
  for (const battle of BATTLES) {
    for (const shot of battle.script.shots) {
      for (const [time, kind] of [[battle.start + shot.fireTime, 'shot'], [battle.start + shot.hitTime, shot.result === 'shield' ? 'shield' : shot.result === 'kill' ? 'breakup' : 'impact']] as const) {
        assert.ok(battleVisible(battle, time), `${shot.id} ${kind} is off screen`);
        assert.ok(CUES.some(cue => cue.t === time && cue.kind === kind), `${shot.id} ${kind} has no cue`);
      }
    }
  }
});

test('only one skirmish is staged at a time during the ground shot', () => {
  for (const t of [50, 59.9, 69.99]) assert.deepEqual(BATTLES.filter(battle => battleVisible(battle, t)), [SKY_BATTLE]);
  assert.deepEqual(BATTLES.filter(battle => battleVisible(battle, 30)), [FLEET_BATTLE]);
  assert.deepEqual(BATTLES.filter(battle => battleVisible(battle, 100)), [FLEET_BATTLE, DEFENDER_BATTLE]);
});

test('shield impacts sit on the shield bubble in front of the target hull and shots stay clear of the planet', () => {
  const point: CombatPoint = { x: 0, y: 0, z: 0 };
  for (const battle of BATTLES) {
    for (const shot of battle.script.shots) {
      sampleCombatPoint(battle.script.ships, shot.target, shot.local, shot.hitTime, point);
      assert.ok(Math.hypot(point.x - shot.end[0], point.y - shot.end[1], point.z - shot.end[2]) < 1e-9, `${shot.id} misses its contact point`);
      assert.ok(Math.abs(Math.hypot(...shot.normal) - 1) < 1e-9);
      if (shot.result === 'shield') {
        const [a, b, c] = COMBAT_SHIELD_RADII;
        const x = (shot.local[0] - COMBAT_SHIELD_CENTER[0]) / a, y = (shot.local[1] - COMBAT_SHIELD_CENTER[1]) / b, z = (shot.local[2] - COMBAT_SHIELD_CENTER[2]) / c;
        assert.ok(Math.abs(x * x + y * y + z * z - 1) < 1e-9, `${shot.id} is not on the bubble`);
      }
      // Closest approach of the segment to the planet centre.
      const d = [shot.end[0] - shot.start[0], shot.end[1] - shot.start[1], shot.end[2] - shot.start[2]] as const;
      const s = Math.max(0, Math.min(1, -(shot.start[0] * d[0] + shot.start[1] * d[1] + shot.start[2] * d[2]) / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2])));
      assert.ok(Math.hypot(shot.start[0] + d[0] * s, shot.start[1] + d[1] * s, shot.start[2] + d[2] * s) > CONTRACT.planet.radius, `${shot.id} passes through the planet`);
    }
  }
});

test('crews are seeded: the same script replays exactly and a different seed differs', () => {
  const again = createCombatScript({ seed: CONTRACT.seed, duration: 30, stopAfter: 29.2, bubble: true, reload: [1.2, 3.4], ships: FLEET_BATTLE.script.ships,
    fatal: [{ source: 1, turret: 0, target: 3, hitAt: 15 }], approach: FLEET_BATTLE.script.approach });
  assert.deepEqual(again.shots, FLEET_BATTLE.script.shots);
  const other = createCombatScript({ seed: CONTRACT.seed + 1, duration: 30, stopAfter: 29.2, bubble: true, reload: [1.2, 3.4], ships: FLEET_BATTLE.script.ships,
    fatal: [{ source: 1, turret: 0, target: 3, hitAt: 15 }] });
  assert.notDeepEqual(other.shots.map(shot => shot.fireTime), FLEET_BATTLE.script.shots.map(shot => shot.fireTime));
  assert.ok(other.kills.get(3) === 15 || Math.abs(other.kills.get(3)! - 15) < 1e-9, 'authored kill stays exact under any seed');
});

test('the fleet glides in and comes to rest at its battle stations without a position pop', () => {
  for (let ship = 0; ship < FLEET_BATTLE.script.ships.length; ship++) {
    const a = { ...pose }, b = { ...pose }, c = { ...pose };
    sampleCombatShip(ship, -1e-6, a, FLEET_BATTLE.script); sampleCombatShip(ship, 0, b, FLEET_BATTLE.script);
    sampleCombatShip(ship, -FLEET_BATTLE.script.approach!.duration, c, FLEET_BATTLE.script);
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-4, 'ship pops at its station');
    assert.ok(Math.abs(c.x - b.x) > 30, 'ship starts off the screen edge');
  }
});
