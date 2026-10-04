import { CONTRACT, type Vec3 } from './contract.ts';
import { createCombatScript, type CombatScript, type CombatShip } from './combat.ts';

/** A combat script placed on the 120-second show clock. */
export interface Battle {
  readonly name: 'fleet' | 'sky' | 'defenders';
  /** Show time of script time 0. */
  readonly start: number;
  readonly script: CombatScript;
  /** Show-time intervals during which the ships are on screen. */
  readonly visible: readonly (readonly [number, number])[];
}

const ship = (side: CombatShip['side'], scale: number, origin: Vec3, velocity: Vec3, shieldDown?: number): CombatShip =>
  Object.freeze({ side, scale, origin: Object.freeze(origin), velocity: Object.freeze(velocity),
    yaw: side === 'defender' ? -Math.PI / 2 : Math.PI / 2, shieldDown });

const { combatStart, combatEnd, surfaceStart, surfaceEnd, countdownStart, impactTime } = CONTRACT.scene;
const FLEET_ARRIVAL = 12;

/** 20-50 s: the fleets reach station, trade fire, and one escort dies at 35 s. */
export const FLEET_BATTLE: Battle = {
  name: 'fleet', start: combatStart,
  visible: [[FLEET_ARRIVAL, surfaceStart], [countdownStart, CONTRACT.duration]],
  script: createCombatScript({
    seed: CONTRACT.seed, duration: combatEnd - combatStart, stopAfter: 29.2, bubble: true,
    reload: [1.2, 3.4],
    ships: [
      ship('defender', .73, [-12, 0, 21], [-.12, 0, -.02]),
      ship('defender', .48, [-10, .2, 13], [-.1, 0, .04]),
      ship('attacker', .68, [12, .05, 20], [.12, 0, -.02], 22),
      ship('attacker', .46, [10, .15, 13], [.1, 0, .04], 11),
    ],
    fatal: [{ source: 1, turret: 0, target: 3, hitAt: 35 - combatStart }],
    approach: { duration: combatStart - FLEET_ARRIVAL, offsets: [[-44, 2, -4], [-38, -1, 6], [44, 3, -6], [38, -2, 8]] },
  }),
};

/** 50-70 s: a slow skirmish above the ground camera, with a capital sliding overhead. */
export const SKY_BATTLE: Battle = {
  name: 'sky', start: surfaceStart, visible: [[surfaceStart, surfaceEnd]],
  script: createCombatScript({
    seed: CONTRACT.seed + 5000, duration: surfaceEnd - surfaceStart, stopAfter: 18.5, bubble: true, maxFlight: 4,
    reload: [3, 3.5], firstAim: [.5, 5],
    ships: [
      ship('defender', .95, [-22, 15.5, -13], [2.2, 0, -.05]),
      ship('attacker', .55, [18, 24, -30], [-.25, .05, .1]),
      ship('attacker', .45, [-4, 28, -44], [.2, 0, .1]),
    ],
  }),
};

/** 70-95 s: the last two defenders die while the planet killer charges. Fire is held while the camera is elsewhere. */
const DEFENDER_SILENCE: readonly (readonly [number, number])[] = [[0, 5], [10, 20], [23, 25]];
export const DEFENDER_BATTLE: Battle = {
  name: 'defenders', start: countdownStart, visible: [[countdownStart, CONTRACT.duration]],
  script: createCombatScript({
    seed: CONTRACT.seed + 9000, duration: impactTime - countdownStart, stopAfter: 22.5, bubble: true,
    reload: [.5, 1.1], firstAim: [.2, 1.5], silence: DEFENDER_SILENCE,
    ships: [
      ship('defender', .5, [10 - .06 * 7, 11, 6 + .05 * 7], [.06, 0, -.05], 4),
      ship('defender', .42, [3 - .05 * 21, 9.5, 11 + .03 * 21], [.05, 0, -.03], 14),
      ship('attacker', .45, [24, 13, 12], [-.04, 0, .02]),
      ship('attacker', .4, [22, 8, 18], [-.03, 0, -.02]),
    ],
    fatal: [
      { source: 2, turret: 0, target: 0, hitAt: 77 - countdownStart },
      { source: 3, turret: 1, target: 1, hitAt: 91 - countdownStart },
    ],
  }),
};

export const BATTLES: readonly Battle[] = [FLEET_BATTLE, SKY_BATTLE, DEFENDER_BATTLE];

export const battleVisible = (battle: Battle, time: number): boolean =>
  battle.visible.some(([from, to]) => time >= from && time < to);
