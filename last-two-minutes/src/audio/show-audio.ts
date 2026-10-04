import { AudioAsset, OPMAdapter, type AudioPlayback, type AudioPlayOptions, type Game, type OPMVoice, type PreparedAudioImpulse, type SampleAudioAsset, type SamplePlayback } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract';
import type { ShowSample } from '../show/director';
import { SCORE, CUES } from './score';
import { VOICES, type CueName } from './synthesis';

export interface ShowAudio {
  prepare(): Promise<void>;
  unlock(): Promise<void>;
  update(sample: ShowSample, cues?: typeof CUES): void;
  pause(): void;
  resume(t: number): void;
  reset(): void;
  dispose(): void;
}
interface PreparedScoreNote { asset: AudioAsset; options: AudioPlayOptions }

export function createShowAudio(game: Game): ShowAudio {
  const audio = game.audio;
  const pauseReason = 'last-two-minutes';
  const samples = new Map<CueName, SampleAudioAsset>();
  const notes: { playback: AudioPlayback; end: number }[] = [];
  const pcm: SamplePlayback[] = [];
  const assets = new Map<number, PreparedScoreNote>();
  let preparation: Promise<void> | undefined;
  let readiness: Promise<void> | undefined;
  let prepared = false;
  let enabled = false;
  let held = true;
  let disposed = false;
  let previous = -1;
  let generation = 0;
  let pendingPCM = 0;
  let failure: unknown;
  let hall: PreparedAudioImpulse | undefined;

  function stopNotes(): void {
    for (const note of notes) note.playback.stop();
    notes.length = 0;
  }

  function stopAll(): void {
    generation++;
    stopNotes();
    for (const playback of pcm) playback.stop();
    pcm.length = 0;
    // Pending play() promises hold their own generation and stop on resolution.
  }

  function playNote(index: number, t: number): void {
    const event = SCORE[index];
    if (!event || event.t + event.duration <= t || notes.length >= 8) return;
    const preparedNote = assets.get(index);
    if (!preparedNote) throw new Error('The authored audio score is not prepared.');
    // The simulation-end stop also truncates a resumed or late-admitted note.
    notes.push({ playback: preparedNote.asset.play(preparedNote.options), end: event.t + event.duration });
  }

  function playCue(kind: CueName, pan: number, offset: number): void {
    const asset = samples.get(kind);
    if (!asset || offset >= (asset.duration ?? 0)) return;
    // PCM shares the first official context but does not reserve an OPM slot.
    // Limit its independent sources to two; music stays within eight FM slots.
    for (let i = pcm.length - 1; i >= 0; i--) {
      if (pcm[i]?.state === 'ended' || pcm[i]?.state === 'stopped') pcm.splice(i, 1);
    }
    if (pendingPCM >= 2) return;
    while (pcm.length + pendingPCM >= 2) pcm.shift()?.stop();
    const token = generation;
    pendingPCM++;
    void asset.play({ channel: 'sfx', offset, volume: kind === 'shot' ? 0.32 : kind === 'shield' ? 0.45 : 0.72,
      spatial: { position: { x: pan * 8, y: 0, z: -8 }, rolloffFactor: 0, panningModel: 'equalpower' },
    }).then((playback) => {
      if (disposed || token !== generation) playback.stop();
      else pcm.push(playback);
    }).catch((error: unknown) => { if (!disposed && token === generation) failure = error; })
      .finally(() => { pendingPCM--; });
  }

  function prepare(): Promise<void> {
    if (disposed) return Promise.reject(new Error('Show audio has been disposed.'));
    if (preparation) return preparation;
    preparation = (async () => {
      await Promise.all([
        ...SCORE.map(async (event, index) => {
          const voice = VOICES[event.voice];
          const expressive: OPMVoice = {
            ...voice, ops: voice.ops.map(op => ({ ...op, level: op.level * event.velocity })) as OPMVoice['ops'],
          };
          // Author velocity before validation; retain the returned voice intact.
          // Copying a normalized voice loses the adapter's native-version identity.
          const validated = await OPMAdapter.validateVoice(expressive);
          if (disposed) return;
          const asset = new AudioAsset(audio, validated, [{ note: event.note, time: 0, duration: event.duration }], event.duration, 'music', false);
          assets.set(index, { asset, options: { channel: 'music', spatial: {
            position: { x: event.pan * 2, y: 0, z: -2 }, rolloffFactor: 0, panningModel: 'equalpower',
          } } });
        }),
        ...(['shot', 'shield', 'impact', 'breakup'] as const).map(async (kind) => {
          const url = new URL(`${import.meta.env.BASE_URL}audio/${kind}.wav`, location.href);
          const asset = await audio.loadSample(url.href);
          if (!disposed) samples.set(kind, asset);
        }),
      ]);
      if (disposed) throw new Error('Show audio was disposed during preparation.');
      prepared = true;
    })();
    return preparation;
  }

  function unlock(): Promise<void> {
    if (disposed) return Promise.reject(new Error('Show audio has been disposed.'));
    // Never await before this call: the runtime invokes us in the button's
    // gesture. Official startup loads all eight worklets before resolving.
    const nativeUnlock = audio.unlock();
    audio.resume(pauseReason);
    if (readiness) return readiness;
    readiness = (async () => {
      await nativeUnlock;
      await prepare();
      await Promise.all([...samples.values()].map((asset) => asset.decode()));
      if (disposed) throw new Error('Show audio was disposed during unlock.');
      const context = audio.opm?.context;
      if (!context) throw new Error('Official OPM context is unavailable after unlock.');
      const impulse = context.createBuffer(2, Math.round(context.sampleRate * 1.45), context.sampleRate);
      const random = seededRandom(CONTRACT.seed + 44);
      for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel); let filtered = 0;
        for (let i = 0; i < data.length; i++) {
          filtered += ((random() * 2 - 1) - filtered) * .32;
          const seconds = i / impulse.sampleRate;
          data[i] = seconds < .025 ? 0 : filtered * Math.exp(-seconds * 4.5) * (1 - i / data.length);
        }
      }
      hall = audio.prepareImpulse(impulse);
      audio.music.setEffects([
        { type: 'biquad', filter: 'highpass', frequency: 28, Q: .7 },
        { type: 'reverb', impulse: hall, wet: .16 },
        { type: 'compressor', threshold: -16, knee: 12, ratio: 2.5, attack: .02, release: .22 },
      ]);
      audio.music.volume = .55;
      audio.sfx.volume = 0.85;
      audio.master.volume = 0;
      audio.pause(pauseReason);
      enabled = true;
    })();
    return readiness;
  }

  return {
    prepare,
    unlock,
    update(sample, cues = CUES) {
      if (disposed || !enabled || !prepared || held) return;
      if (failure) { const error = failure; failure = undefined; throw error; }
      if (sample.t < previous) { stopAll(); previous = -1; }
      // Gain comes exclusively from the director, including the long near-silent
      // 104–110 hold. Native smoothing is only a de-click, not a show clock.
      audio.master.cancelAutomation();
      audio.master.automate(sample.gain, audio.currentTime + 0.01, 0.025);
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i];
        if (note && (note.end <= sample.t || note.playback.state !== 'playing')) {
          note.playback.stop(); notes.splice(i, 1);
        }
      }
      for (let i = 0; i < SCORE.length; i++) {
        const event = SCORE[i];
        if (event && event.t > previous && event.t <= sample.t) playNote(i, sample.t);
      }
      for (const event of cues) {
        if (event.t > previous && event.t <= sample.t) playCue(event.kind, event.pan, sample.t - event.t);
      }
      previous = sample.t;
      if (sample.t >= CONTRACT.duration) {
        stopAll(); held = true; audio.master.cancelAutomation(); audio.master.volume = 0; audio.pause(pauseReason);
      }
    },
    pause() {
      if (disposed) return;
      held = true;
      // Scene/clock pause alone does not pause the official audio manager.
      audio.pause(pauseReason);
      stopNotes();
    },
    resume(t) {
      if (disposed || !enabled) return;
      audio.resume(pauseReason);
      held = false;
      stopNotes();
      previous = t === 0 ? -1 : t;
      if (t > 0) {
        for (let i = 0; i < SCORE.length; i++) {
          const event = SCORE[i];
          if (event && event.t <= t && event.t + event.duration > t) playNote(i, t);
        }
      }
    },
    reset() {
      if (disposed) return;
      audio.pause(pauseReason);
      stopAll();
      held = true; previous = -1; failure = undefined;
      audio.master.cancelAutomation(); audio.master.volume = 0;
    },
    dispose() {
      if (disposed) return;
      audio.pause(pauseReason);
      disposed = true;
      stopAll();
      audio.master.cancelAutomation(); audio.master.volume = 0;
      samples.clear(); assets.clear();
      audio.music.setEffects([]); hall?.dispose();
      // Game.destroy owns the eight contexts and the manager's cache.
    },
  };
}
