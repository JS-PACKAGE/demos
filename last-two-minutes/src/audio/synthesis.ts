import type { OPMOperator, OPMVoice } from 'xyz.js';

export type VoiceName = 'strings' | 'horn' | 'bass' | 'ostinato' | 'timpani' | 'snare' | 'harp' | 'alarm';
export type CueName = 'shot' | 'shield' | 'impact' | 'breakup';

function operator(ratio: number, level: number, detune: number, a: number, d: number, s: number, r: number): OPMOperator {
  return { ratio, level, detune, adsr: { a, d, s, r } };
}

// Original FM orchestration. The non-integer percussion ratios are deliberately
// inharmonic; no sampled orchestra or substitute synth replaces the official DSP.
export const VOICES: Record<VoiceName, OPMVoice> = {
  strings: { version: 1, name: 'Horizon_strings', algorithm: 5, feedback: 2,
    ops: [operator(2, .34, 0, .18, .5, .72, .11), operator(1, .12, -6, .24, .6, .85, .12), operator(1, .1, 5, .28, .7, .8, .12), operator(2, .045, 2, .31, .8, .7, .1)],
    lfo: { rate: .23, amDepth: .025, pmDepth: .7 }, modIndex: 1.35 },
  horn: { version: 1, name: 'Home_horn', algorithm: 4, feedback: 3,
    ops: [operator(1, .52, 0, .045, .35, .63, .08), operator(1, .17, -2, .075, .45, .81, .1), operator(2, .31, 0, .055, .4, .45, .08), operator(1, .095, 2, .09, .55, .78, .1)],
    lfo: { rate: 4.8, amDepth: .012, pmDepth: 1.2 }, modIndex: 1.75 },
  bass: { version: 1, name: 'Orbital_contrabass', algorithm: 0, feedback: 2,
    ops: [operator(1, .28, 0, .018, .4, .35, .06), operator(2, .22, 0, .025, .5, .43, .06), operator(1, .3, 0, .03, .5, .52, .08), operator(1, .2, 0, .04, .7, .8, .1)], modIndex: 1.1 },
  ostinato: { version: 1, name: 'Flight_spiccato', algorithm: 4, feedback: 2,
    ops: [operator(2, .43, 0, .003, .1, .03, .025), operator(1, .105, -3, .006, .15, .12, .04), operator(3, .23, 0, .004, .08, .02, .025), operator(1, .065, 3, .008, .13, .09, .04)], modIndex: 1.4 },
  timpani: { version: 1, name: 'Deep_timpani', algorithm: 4, feedback: 4,
    ops: [operator(1.43, .65, 0, .001, .11, .015, .04), operator(1, .23, 0, .002, .55, .08, .1), operator(2.71, .4, 0, .001, .07, .01, .03), operator(1.01, .1, 0, .003, .32, .025, .08)], modIndex: 3.4 },
  snare: { version: 1, name: 'Fleet_snare', algorithm: 0, feedback: 7,
    ops: [operator(4.57, .9, 0, .001, .055, .01, .015), operator(3.19, .8, 0, .001, .07, .015, .02), operator(2.41, .85, 0, .001, .09, .01, .02), operator(1, .135, 0, .002, .12, .015, .035)], modIndex: 7.5 },
  harp: { version: 1, name: 'Last_city_harp', algorithm: 4, feedback: 1,
    ops: [operator(3.0008, .28, 0, .002, .38, .005, .07), operator(1, .12, 0, .004, .95, .025, .15), operator(2, .18, 0, .003, .25, .005, .06), operator(1, .065, 2, .006, .8, .02, .14)], modIndex: 1.3 },
  alarm: { version: 1, name: 'No_answer', algorithm: 4, feedback: 3,
    ops: [operator(2.03, .37, 0, .2, .3, .65, .08), operator(1, .09, -3, .25, .3, .72, .1), operator(3.01, .26, 0, .3, .3, .62, .08), operator(1, .075, 3, .3, .3, .7, .1)],
    lfo: { rate: .7, amDepth: .05, pmDepth: 2 }, modIndex: 2.2 },
};

/** Encodes original mono PCM, with a local seeded noise source, into a RIFF WAV. */
export function synthesizeCue(kind: CueName, seed: number): Blob {
  const rate = 24000;
  const duration = kind === 'shot' ? 0.22 : kind === 'shield' ? 0.55 : kind === 'impact' ? 2.3 : 3.8;
  const count = Math.ceil(duration * rate);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, count * 2, true);
  let state = seed >>> 0;
  let low = 0;
  let phase = 0;
  for (let i = 0; i < count; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const noise = (state >>> 0) / 2147483648 - 1;
    const t = i / rate;
    low += (noise - low) * (kind === 'shot' ? 0.2 : 0.035);
    const frequency = kind === 'shot' ? 150 + 1400 * Math.exp(-t * 26)
      : kind === 'shield' ? 190 + 620 * Math.exp(-t * 8)
      : kind === 'impact' ? 28 + 160 * Math.exp(-t * 12) : 22 + 65 * Math.exp(-t * 2);
    phase += 2 * Math.PI * frequency / rate;
    const envelope = Math.min(1, t / 0.003) * Math.exp(-t * (kind === 'shot' ? 22 : kind === 'shield' ? 8 : kind === 'impact' ? 2.5 : 1.3));
    const tail = Math.min(1, (duration - t) / 0.035);
    const metallic = kind === 'shield' ? Math.sin(phase * 2.71) * 0.2 : 0;
    const crack = kind === 'breakup' ? noise * Math.pow(Math.max(0, Math.sin(t * 31)), 12) * Math.exp(-t) * 0.2 : 0;
    const value = (Math.sin(phase) * 0.42 + low * 1.5 + metallic + crack) * envelope * tail;
    view.setInt16(44 + i * 2, Math.round(Math.max(-0.92, Math.min(0.92, value)) * 32767), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
