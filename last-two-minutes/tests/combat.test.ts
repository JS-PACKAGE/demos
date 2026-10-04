import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_ARMOR_POINT, COMBAT_DURATION, COMBAT_KILL_TIME, COMBAT_PROJECTILE_SPEED,
  COMBAT_YAW_SPEED, COMBAT_PITCH_SPEED, COMBAT_SHIPS, COMBAT_SHOTS, createCombatShots,
  sampleCombatArmor, sampleCombatGun, sampleCombatMuzzle, sampleCombatProjectile, sampleCombatShip,
} from '../src/show/combat.ts';
import { BARREL_HEIGHT, BARREL_OFFSETS, MUZZLE_Z, SHIP_TURRET_MOUNTS } from '../src/scene/ship-hardpoints.ts';

const close = (actual: number, expected: number, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

function worldFromLocal(ship: number, time: number, x: number, y: number, z: number): number[] {
  const definition = COMBAT_SHIPS[ship]!;
  const c = Math.cos(definition.yaw), s = Math.sin(definition.yaw);
  return [
    definition.origin[0] + definition.velocity[0] * time + definition.scale * (c * x + s * z),
    definition.origin[1] + definition.velocity[1] * time + definition.scale * y,
    definition.origin[2] + definition.velocity[2] * time + definition.scale * (-s * x + c * z),
  ];
}

test('independent crews overlap opposing fire rather than alternating turns', () => {
  assert.ok(COMBAT_SHOTS.some((shot, index) => index > 0
    && COMBAT_SHIPS[shot.source]!.side === COMBAT_SHIPS[COMBAT_SHOTS[index - 1]!.source]!.side));
  assert.ok(COMBAT_SHOTS.some(shot => COMBAT_SHOTS.some(other =>
    COMBAT_SHIPS[shot.source]!.side !== COMBAT_SHIPS[other.source]!.side
    && other.fireTime < shot.hitTime && other.hitTime > shot.fireTime)));
  for (let source = 0; source < COMBAT_SHIPS.length; source++) {
    const own = COMBAT_SHOTS.filter(shot => shot.source === source);
    assert.ok(own.some(shot => shot.turret === 0) && own.some(shot => shot.turret === 1));
  }
  assert.ok(COMBAT_SHOTS.some(shot => COMBAT_SHOTS.some(other =>
    other.source === shot.source && other.turret === shot.turret && other.target !== shot.target)),
    'a crew must visibly slew to reacquire another hostile ship');
});

test('seeded schedules vary cadence and targets while replaying the same battle exactly', () => {
  const first = createCombatShots(20261004), replay = createCombatShots(20261004), different = createCombatShots(20261005);
  assert.deepEqual(replay, first);
  assert.notDeepEqual(different.map(shot => [shot.fireTime, shot.target]), first.map(shot => [shot.fireTime, shot.target]));
  for (const shots of [first, different]) {
    const fatal = shots.find(shot => shot.result === 'kill')!;
    assert.ok(fatal.hitTime < COMBAT_DURATION);
    for (const shot of shots) {
      assert.notEqual(COMBAT_SHIPS[shot.source]!.side, COMBAT_SHIPS[shot.target]!.side);
      const distance = Math.hypot(...shot.start.map((coordinate, axis) => shot.end[axis]! - coordinate));
      close(distance / (shot.hitTime - shot.fireTime), COMBAT_PROJECTILE_SPEED);
      if (shot.target === fatal.target) assert.ok(shot.hitTime <= fatal.hitTime);
      if (shot.source === fatal.target) assert.ok(shot.hitTime < fatal.hitTime);
    }
  }
});

test('guns slew continuously within angular limits and settle before launching', () => {
  const gun = { yaw: 0, pitch: 0, recoil: 0 }, previous = { yaw: 0, pitch: 0, recoil: 0 };
  for (const shot of COMBAT_SHOTS) {
    assert.ok(shot.aimStart < shot.aimEnd && shot.aimEnd < shot.fireTime);
    sampleCombatGun(shot.source, shot.turret, shot.aimStart - 1e-6, previous);
    sampleCombatGun(shot.source, shot.turret, shot.aimStart, gun);
    close(gun.yaw, previous.yaw, 1e-7); close(gun.pitch, previous.pitch, 1e-7);
    sampleCombatGun(shot.source, shot.turret, (shot.aimStart + shot.aimEnd) / 2, gun);
    assert.ok(Math.abs(gun.yaw - shot.fromYaw) > 1e-6 || Math.abs(gun.pitch - shot.fromPitch) > 1e-6);
    assert.ok(Math.abs(gun.yaw - shot.aimYaw) > 1e-6 || Math.abs(gun.pitch - shot.aimPitch) > 1e-6);
    sampleCombatGun(shot.source, shot.turret, shot.aimStart, previous);
    const step = (shot.aimEnd - shot.aimStart) / 100;
    for (let tick = 1; tick <= 100; tick++) {
      sampleCombatGun(shot.source, shot.turret, shot.aimStart + tick * step, gun);
      assert.ok(Math.abs(gun.yaw - previous.yaw) / step <= COMBAT_YAW_SPEED + 1e-6);
      assert.ok(Math.abs(gun.pitch - previous.pitch) / step <= COMBAT_PITCH_SPEED + 1e-6);
      Object.assign(previous, gun);
    }
    sampleCombatGun(shot.source, shot.turret, (shot.aimEnd + shot.fireTime) / 2, gun);
    close(gun.yaw, shot.aimYaw); close(gun.pitch, shot.aimPitch);
    assert.equal(gun.recoil, 0);
  }
});

test('articulated yaw/pitch bore launches exactly at a moving physical barrel and points at intercept', () => {
  const gun = { yaw: 0, pitch: 0, recoil: 0 }, muzzle = { x: 0, y: 0, z: 0 };
  for (const shot of COMBAT_SHOTS) {
    sampleCombatGun(shot.source, shot.turret, shot.fireTime, gun);
    assert.equal(gun.recoil, 0);
    const mount = SHIP_TURRET_MOUNTS[shot.turret]!, offset = BARREL_OFFSETS[shot.barrel]!;
    const cy = Math.cos(gun.yaw), sy = Math.sin(gun.yaw), cp = Math.cos(gun.pitch), sp = Math.sin(gun.pitch);
    const expected = worldFromLocal(shot.source, shot.fireTime,
      mount[0] + cy * offset + sy * MUZZLE_Z * cp,
      mount[1] + BARREL_HEIGHT - MUZZLE_Z * sp,
      mount[2] - sy * offset + cy * MUZZLE_Z * cp);
    sampleCombatMuzzle(shot.source, shot.turret, shot.barrel, shot.fireTime, shot.end, muzzle);
    for (let axis = 0; axis < 3; axis++) close(shot.start[axis]!, expected[axis]!);
    close(muzzle.x, expected[0]!); close(muzzle.y, expected[1]!); close(muzzle.z, expected[2]!);
    const hullYaw = COMBAT_SHIPS[shot.source]!.yaw;
    const dx = -Math.sin(gun.yaw + hullYaw) * cp, dy = sp, dz = -Math.cos(gun.yaw + hullYaw) * cp;
    const distance = Math.hypot(shot.end[0] - shot.start[0], shot.end[1] - shot.start[1], shot.end[2] - shot.start[2]);
    close((shot.end[0] - shot.start[0]) / distance, dx);
    close((shot.end[1] - shot.start[1]) / distance, dy);
    close((shot.end[2] - shot.start[2]) / distance, dz);
    assert.ok(Math.cos(gun.yaw) > 0, 'never fires backwards through engines');
    sampleCombatGun(shot.source, shot.turret, shot.fireTime + .03, gun);
    assert.ok(gun.recoil > 0);
  }
});

test('intercepts contact actual moving raised armor rather than the target origin', () => {
  const armor = { x: 0, y: 0, z: 0 };
  for (const shot of COMBAT_SHOTS) {
    const expected = worldFromLocal(shot.target, shot.hitTime, ...COMBAT_ARMOR_POINT);
    shot.end.forEach((coordinate, axis) => close(coordinate, expected[axis]!));
    sampleCombatArmor(shot.target, shot.hitTime, armor);
    close(armor.x, shot.end[0]); close(armor.y, shot.end[1]); close(armor.z, shot.end[2]);
    const atLaunch = worldFromLocal(shot.target, shot.fireTime, ...COMBAT_ARMOR_POINT);
    assert.ok(Math.hypot(...atLaunch.map((coordinate, axis) => shot.end[axis]! - coordinate)) > .01);
    assert.ok(shot.start[1] > shot.end[1], 'incoming fire approaches the top armor from above');
  }
});

test('projectile phases are half-open, finite speed, and land exactly before disappearing', () => {
  const projectile = { x: 0, y: 0, z: 0, visible: false };
  for (const shot of COMBAT_SHOTS) {
    sampleCombatProjectile(shot, shot.fireTime - 1e-8, projectile);
    assert.equal(projectile.visible, false);
    sampleCombatProjectile(shot, shot.fireTime, projectile);
    assert.equal(projectile.visible, true);
    assert.deepEqual([projectile.x, projectile.y, projectile.z], shot.start);
    sampleCombatProjectile(shot, (shot.fireTime + shot.hitTime) / 2, projectile);
    assert.equal(projectile.visible, true);
    close(projectile.x, (shot.start[0] + shot.end[0]) / 2);
    close(projectile.y, (shot.start[1] + shot.end[1]) / 2);
    close(projectile.z, (shot.start[2] + shot.end[2]) / 2);
    sampleCombatProjectile(shot, shot.hitTime - 1e-8, projectile);
    assert.equal(projectile.visible, true);
    sampleCombatProjectile(shot, shot.hitTime, projectile);
    assert.equal(projectile.visible, false);
    close(projectile.x, shot.end[0]); close(projectile.y, shot.end[1]); close(projectile.z, shot.end[2]);
  }
});

test('shots clear the planet and their source hull deck', () => {
  const projectile = { x: 0, y: 0, z: 0, visible: false };
  for (const shot of COMBAT_SHOTS) {
    const source = COMBAT_SHIPS[shot.source]!;
    for (let tick = 0; tick <= 100; tick++) {
      const time = shot.fireTime + (shot.hitTime - shot.fireTime) * tick / 100;
      sampleCombatProjectile(shot, time, projectile);
      assert.ok(Math.hypot(projectile.x, projectile.y, projectile.z) > 10);
      const x = (projectile.x - source.origin[0] - source.velocity[0] * time) / source.scale;
      const z = (projectile.z - source.origin[2] - source.velocity[2] * time) / source.scale;
      const localZ = Math.sin(source.yaw) * x + Math.cos(source.yaw) * z;
      const localY = (projectile.y - source.origin[1] - source.velocity[1] * time) / source.scale;
      // Forward armor deck never exceeds .56 from the forward gun to the prow.
      if (localZ >= -5.6 && localZ <= -1.68) assert.ok(localY > .56, `${shot.id} intersects source deck`);
    }
  }
});

test('escort destruction follows only the final impact; neither dead nor in-flight escort fires survive', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, scale: 0, destroyed: false };
  sampleCombatShip(3, COMBAT_KILL_TIME - 1e-8, pose);
  assert.equal(pose.destroyed, false);
  sampleCombatShip(3, COMBAT_KILL_TIME, pose);
  assert.equal(pose.destroyed, true);
  sampleCombatShip(3, COMBAT_DURATION, pose);
  assert.equal(pose.destroyed, true);
  for (const shot of COMBAT_SHOTS) {
    sampleCombatShip(shot.source, shot.fireTime, pose);
    assert.equal(pose.destroyed, false);
    sampleCombatShip(shot.target, shot.hitTime - 1e-8, pose);
    assert.equal(pose.destroyed, false);
    if (shot.source === 3) assert.ok(shot.hitTime < COMBAT_KILL_TIME);
    if (shot.target === 3) assert.ok(shot.hitTime <= COMBAT_KILL_TIME);
  }
  for (const index of [0, 1, 2]) {
    sampleCombatShip(index, COMBAT_DURATION, pose);
    assert.equal(pose.destroyed, false);
  }
});

test('rewinding analytical hull, gun and projectile samples replays exactly', () => {
  const ship = { x: 0, y: 0, z: 0, yaw: 0, scale: 0, destroyed: false };
  const gun = { yaw: 0, pitch: 0, recoil: 0 };
  const projectile = { x: 0, y: 0, z: 0, visible: false };
  for (const shot of COMBAT_SHOTS) {
    const time = shot.fireTime + .03;
    sampleCombatShip(shot.source, time, ship);
    sampleCombatGun(shot.source, shot.turret, time, gun);
    sampleCombatProjectile(shot, time, projectile);
    const first = [{ ...ship }, { ...gun }, { ...projectile }];
    for (const otherTime of [12, 0, 8.5, 1]) {
      sampleCombatShip(shot.source, otherTime, ship);
      sampleCombatGun(shot.source, shot.turret, otherTime, gun);
      sampleCombatProjectile(shot, otherTime, projectile);
    }
    sampleCombatShip(shot.source, time, ship);
    sampleCombatGun(shot.source, shot.turret, time, gun);
    sampleCombatProjectile(shot, time, projectile);
    assert.deepEqual([ship, gun, projectile], first);
  }
});
