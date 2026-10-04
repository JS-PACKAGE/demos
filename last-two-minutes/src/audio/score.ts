import { CONTRACT, EVENTS } from '../show/contract.ts';
import { BATTLES } from '../show/battles.ts';
import type { CueName, VoiceName } from './synthesis.ts';

export interface ScoreNote {
  t: number; duration: number; note: number; voice: VoiceName; velocity: number; pan: number;
}
interface ScoreCue { t: number; kind: CueName; pan: number }

function compose(): readonly ScoreNote[] {
  const score: ScoreNote[]=[];
  const {combatStart,combatEnd,surfaceStart,surfaceEnd,countdownStart,impactTime,breakupTime,aftermathTime}=CONTRACT.scene;
  function note(t:number,duration:number,pitch:number,voice:VoiceName,velocity=.7,pan=0):void {
    const end=Math.min(t+duration,CONTRACT.duration);
    if(t>=0&&end>t)score.push({t,duration:end-t,note:pitch,voice,velocity,pan});
  }
  function harmony(t:number,length:number,root:number,tones:readonly number[],weight:number):void {
    note(t,length*.83,root,'bass',weight*.85,-.08);
    for(let i=0;i<tones.length;i++)note(t+.025*i,length*.87-.025*i,tones[i]!,'strings',weight*(.64-i*.08),[-.55,.12,.55][i]!);
  }
  // Original eight-note "home" motif: a fifth opens out, then a falling answer
  // reaches upward again. The same contour returns with different orchestration.
  const theme=[64,71,67,66,64,62,69,71] as const;
  const phraseOffsets=[0,.75,1,1.5,1.75,2,2.75,3.5] as const;
  const phraseLengths=[.66,.2,.43,.2,.2,.66,.65,.42] as const;
  const roots=[40,36,45,47,36,47] as const;
  const voicings=[[55,59,66],[55,59,64],[55,60,64],[57,59,66],[55,60,67],[54,59,63]] as const;
  const openingBar=(combatStart/6),openingBeat=openingBar/4;
  for(let bar=0;bar<6;bar++) {
    const t=bar*openingBar;
    harmony(t,openingBar,roots[bar]!,voicings[bar]!,bar<2?.62:.78);
    if(bar%2===0)note(t+openingBeat,openingBeat*.55,76+(bar===4?3:0),'harp',.4,.4);
    if(bar===0||bar===4)note(t,.46,28,'timpani',.65);
  }
  for(let phrase=0;phrase<3;phrase++)for(let i=0;i<theme.length;i++) {
    const start=phrase*openingBar*2+phraseOffsets[i]!*openingBeat;
    note(start+openingBeat,Math.min(phraseLengths[i]!*openingBeat,combatStart-start-openingBeat-.08),theme[i]!,'horn',.72+i*.025,.05);
  }

  // Fifteen 120-BPM bars: voiced strings, independent bass, moving inner
  // ostinato, horn theme and alternating timpani/snare. Never a looped drone.
  const battleRoots=[40,36,45,47,40,43,36,47,40,36,45,47,36,45,47] as const;
  const battleVoicings=[[55,59,64],[55,60,64],[57,60,64],[54,59,63]] as const;
  const battleBar=(combatEnd-combatStart)/15,beat=battleBar/4;
  for(let bar=0;bar<15;bar++) {
    const t=combatStart+bar*battleBar,root=battleRoots[bar]!;
    const chord=root===36?battleVoicings[1]:root===45?battleVoicings[2]:root===47?battleVoicings[3]:battleVoicings[0];
    harmony(t,battleBar,root,chord,.79+bar*.009);
    const inner=[chord[0],chord[1],chord[2],chord[1],chord[0],chord[2],chord[1],chord[2]];
    for(let i=0;i<8;i++)note(t+i*beat/2,beat*.32,inner[i]!+12,'ostinato',i%2===0?.55:.36,i%2===0?-.38:.38);
    note(t,.24,root-12,'timpani',.8);
    note(t+beat*2,.2,root-5,'timpani',.58);
    note(t+beat,.1,50,'snare',.47,-.18);note(t+beat*3,.12,50,'snare',bar%4===3?.68:.47,.18);
  }
  for(let phrase=0;phrase<8;phrase++)for(let i=0;i<theme.length;i++) {
    const t=combatStart+phrase*battleBar*2+phraseOffsets[i]!*beat*2;
    if(t<combatEnd-.1)note(t,Math.min(phraseLengths[i]!*beat*2,combatEnd-t-.06),theme[i]!+(phrase>=4?12:0),'horn',.82,.08);
  }

  // Surface cuts leave the rhythmic machinery behind. The theme is answered
  // by high plucked metal over slow, dark harmony rather than another bass loop.
  const surfaceRoots=[45,46,41,40,47],surfaceChords=[[57,60,64],[58,62,65],[56,60,65],[55,59,66],[54,59,63]];
  const surfaceBar=(surfaceEnd-surfaceStart)/5;
  for(let bar=0;bar<5;bar++) {
    const t=surfaceStart+bar*surfaceBar;harmony(t,surfaceBar,surfaceRoots[bar]!,surfaceChords[bar]!,.55);
    note(t+surfaceBar*.22,surfaceBar*.47,[76,74,71,69,66][bar]!,'harp',.48,bar%2===0?-.38:.38);
  }

  // Weapon inserts accelerate; quiet planet shots contain no music events.
  for(const shot of CONTRACT.cameraTrack) {
    if(shot.start<countdownStart||shot.end>impactTime||shot.subject==='planet')continue;
    const length=shot.end-shot.start,root=shot.start<85?35:34;
    harmony(shot.start,length,root,[53,59,63],.63);
    const subdivision=shot.start<85?.4:.25;
    for(let t=shot.start+.15,i=0;t<shot.end-.18;t+=subdivision,i++) {
      note(t,.11,[59,63,66,69][i%4]!,'ostinato',.45+(t-countdownStart)/100,i%2===0?-.45:.45);
    }
    note(shot.start+.2,Math.min(2,length-.4),root+24,'alarm',.34);
    note(shot.start,.35,root-12,'timpani',.7);
  }
  // Impact is a pressure loss, not a victory cadence. Beyond its short residual
  // bass, the wounded 95–110 span is left to the director's near-silent ambience.
  note(impactTime,2.6,23,'bass',.38);
  note(breakupTime,1.7,28,'timpani',.85);
  harmony(breakupTime,aftermathTime-breakupTime,28,[52,58,63],.52);
  note(breakupTime+.5,1.3,64,'horn',.52);
  for(let i=0;i<4;i++)note(aftermathTime+i*1.5,Math.min(1.1,CONTRACT.duration-aftermathTime-i*1.5),[76,71,67,66][i]!,'harp',.28-i*.035,-.35+i*.23);
  return score.sort((a,b)=>a.t-b.t);
}

export const SCORE=compose();
const pan = (x: number): number => Math.max(-1, Math.min(1, x / 12));
/** Ordinary gunfire is sounded from the battle scripts, so each cue matches a visible muzzle or impact. */
const BATTLE_CUES: readonly ScoreCue[] = BATTLES.flatMap(battle => battle.script.shots.flatMap((shot): ScoreCue[] => [
  { t: battle.start + shot.fireTime, kind: 'shot', pan: pan(shot.start[0]) },
  { t: battle.start + shot.hitTime, kind: shot.result === 'shield' ? 'shield' : shot.result === 'kill' ? 'breakup' : 'impact', pan: pan(shot.end[0]) },
]));
export const CUES: readonly ScoreCue[] = [
  // Authored kills are sounded by the lethal shot above; the remaining events are single director marks.
  ...EVENTS.filter(event => event.kind !== 'kill').map((event): ScoreCue => ({
    t: event.t, kind: event.kind === 'fire' ? 'shot' : event.kind === 'impact' ? 'impact' : event.kind === 'break' ? 'breakup' : 'shield', pan: event.pan,
  })),
  ...BATTLE_CUES,
].sort((a, b) => a.t - b.t);
