import { CONTRACT, seededRandom } from './contract.ts';
import type { Vec3 } from './contract.ts';
import { createCombatScript } from './combat.ts';
import type { CombatScript, CombatShip } from './combat.ts';

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

/** Fixed world-space formations: depth and hull size both contribute to apparent scale.
 * Screening ships remain on their distant LOD throughout a shot, avoiding threshold pops. */
function screeningFleet(seed: number, count: number, sky = false, defenders = false): readonly CombatShip[] {
  const random=seededRandom(seed);
  return Object.freeze(Array.from({length:count},(_,i)=>{
    const side=i%2?'attacker':'defender',direction=side==='attacker'?1:-1;
    const lane=Math.floor(i/2),rank=lane%5,column=Math.floor(lane/5);
    const scale=(lane%9===0 ? .4 : .15+random()*.12)*(sky?1.25:1);
    const origin:Vec3=sky
      ? [direction*(8+column*8+rank*1.7),16+column*2.5+random(),-24-rank*11-column*2]
      : defenders
        ? [direction*(7+column*5+rank*2),9+column*2.4+random(),-7+rank*6-column*1.8]
        : [direction*(11+column*4+rank*1.8),-2+column*2.2+random()*.8,20-rank*7-column*1.5];
    const velocity:Vec3=[direction*(sky ? .12 : .035),0,-.012];
    return Object.freeze({...ship(side,scale,origin,velocity),yaw:-Math.atan2(velocity[0],-velocity[2])});
  }));
}

// Staggered depth rows keep the crossfire in front of the planet, with room
// between hulls for each pair of independently tracking turrets.
const FLEET_SHIPS: readonly CombatShip[] = Object.freeze([
  ship('defender', .73, [-12, 0, 21], [-.12, 0, -.02]),
  ship('defender', .48, [-10, .2, 13], [-.1, 0, .04]),
  ship('attacker', .68, [12, .05, 20], [.12, 0, -.02], 22),
  ship('attacker', .46, [10, .15, 13], [.1, 0, .04], 11),
  ...([-1, 1] as const).flatMap(direction => {
    const side = direction < 0 ? 'defender' : 'attacker';
    return [
      ship(side, .46, [direction * 18, -2, 16], [direction * .05, 0, .01]),
      ship(side, .42, [direction * 10.5, 5, 18], [direction * .04, 0, -.01]),
      ship(side, .52, [direction * 18, 2, 23], [direction * .04, 0, .01]),
      ship(side, .44, [direction * 10.5, -2, 25], [direction * .05, 0, -.01]),
      ship(side, .48, [direction * 18, 5, 28], [direction * .03, 0, .01]),
      ship(side, .4, [direction * 10.5, 3, 29], [direction * .04, 0, -.01]),
      ship(side, .5, [direction * 18, -1, 32], [direction * .03, 0, 0]),
      ship(side, .43, [direction * 10.5, 5, 32], [direction * .04, 0, 0]),
    ];
  }),
]);

const FLEET_APPROACH: readonly Vec3[] = Object.freeze([
  [-44, 2, -4], [-38, -1, 6], [44, 3, -6], [38, -2, 8],
  ...FLEET_SHIPS.slice(4).map((definition, index): Vec3 => [
    (definition.side === 'defender' ? -1 : 1) * (38 + index % 4 * 3),
    index % 3 - 1,
    index % 2 ? 6 : -4,
  ]),
]);

/** 20-50 s: the fleets reach station, trade fire, and one escort dies at 35 s. */
export const FLEET_BATTLE: Battle = {
  name: 'fleet', start: combatStart,
  visible: [[FLEET_ARRIVAL, surfaceStart], [countdownStart, CONTRACT.duration]],
  script: createCombatScript({
    seed: CONTRACT.seed, duration: combatEnd - combatStart, stopAfter: 29.2, bubble: true, maxFlight: 4,
    reload: [.35, .85], firstAim: [.05, 1.5],
    escorts: screeningFleet(CONTRACT.seed+101,56),
    ships: FLEET_SHIPS,
    fatal: [{ source: 1, turret: 0, target: 3, hitAt: 35 - combatStart }],
    approach: { duration: combatStart - FLEET_ARRIVAL, offsets: FLEET_APPROACH },
  }),
};

/** 50-70 s: a slow skirmish above the ground camera, with a capital sliding overhead. */
export const SKY_BATTLE: Battle = {
  name: 'sky', start: surfaceStart, visible: [[surfaceStart, surfaceEnd]],
  script: createCombatScript({
    seed: CONTRACT.seed + 5000, duration: surfaceEnd - surfaceStart, stopAfter: 18.5, bubble: true, maxFlight: 4,
    reload: [1.8, 2.2], firstAim: [.5, 3],
    escorts: screeningFleet(CONTRACT.seed+5101,42,true),
    ships: [
      ship('defender', .95, [-22, 15.5, -13], [2.2, 0, -.05],2),
      ship('attacker', .55, [18, 24, -30], [-.25, .05, .1],4),
      ship('attacker', .45, [-4, 28, -44], [.2, 0, .1],6),
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
    escorts: screeningFleet(CONTRACT.seed+9101,48,false,true),
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
