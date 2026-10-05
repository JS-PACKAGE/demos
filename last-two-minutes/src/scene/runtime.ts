import { Game } from 'xyz.js';
import { ShowScene } from './show-scene.ts';
import { createShowAudio } from '../audio/show-audio.ts';
import type { ShowSample } from '../show/director.ts';

export interface ShowRuntime {
  readonly backend: string;
  readonly state: string;
  readonly time: number;
  start(silent: boolean): Promise<void>;
  pause(): void;
  resume(): void;
  replay(): void;
  dispose(): void;
}

export async function createRuntime(
  canvas: HTMLCanvasElement,
  onFrame: (sample: ShowSample) => void,
  onError: (message: string) => void,
  onProgress: (completed: number, total: number, label: string) => void,
): Promise<ShowRuntime> {
  if (!window.isSecureContext || location.protocol === 'file:')
    throw new Error('請以 HTTPS 或 http://127.0.0.1 開啟演出。');
  const total = ShowScene.preparationSteps + 3;
  let completed = 0;
  const report = async (label: string): Promise<void> => {
    onProgress(++completed, total, label);
    // Give the browser a task boundary to paint before the next CPU-heavy model.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  };
  onProgress(0, total, '初始化渲染引擎…');
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const game = await Game.create({ canvas, renderer: 'auto', pixelRatio: Math.min(devicePixelRatio, 1.5), maxDeltaTime: 0.05 });
  if (game.graphics.backend === 'canvas2d' || !game.graphics.capabilities.threeD || !game.graphics.capabilities.instancing) {
    game.destroy();
    throw new Error('此瀏覽器無法演出。需要 WebGPU 或具備 3D 的 WebGL2。');
  }
  await report('渲染引擎已就緒');
  const lifetime = new AbortController();
  const audio = createShowAudio(game);
  let silent = true;
  let disposed = false;
  const scene = new ShowScene((sample) => {
    if (!silent && scene.clock.status === 'playing') audio.update(sample);
    if (scene.clock.status === 'ended') audio.pause();
    onFrame(sample);
  }, report);
  // Review aid, stripped from production builds: hold the show on an exact frame.
  if (import.meta.env.DEV) Object.assign(window, { lastTwoMinutes: { hold(t: number) { scene.clock.time = t; scene.clock.status = 'paused'; }, scene, game } });
  const fail = (): void => {
    scene.clock.pause();
    audio.pause();
    onError('演出已停止：圖形或音訊執行失敗。請重新開啟頁面。');
  };
  game.addEventListener('error', fail, { signal: lifetime.signal });
  try {
    await Promise.all([game.setScene(scene, { signal: lifetime.signal }), audio.prepare().then(() => report('音訊資源已就緒'))]);
    game.start();
    await report('準備完成，可以開始演出');
  } catch (error) {
    lifetime.abort();
    audio.dispose();
    scene.dispose();
    game.destroy();
    throw error;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
    else if (!silent && scene.clock.status === 'playing') audio.resume(scene.clock.time);
  }, { signal: lifetime.signal });
  return {
    backend: game.graphics.backend,
    get state() { return scene.clock.status; },
    get time() { return scene.clock.time; },
    async start(withoutSound) {
      if (disposed || scene.clock.status !== 'ready') return;
      // unlock is invoked synchronously in the click's user-activation stack.
      if (!withoutSound) await audio.unlock();
      silent = withoutSound;
      scene.clock.start();
      if (!silent) audio.resume(scene.clock.time);
    },
    pause() {
      scene.clock.pause();
      audio.pause();
      game.pause();
    },
    resume() {
      scene.clock.resume();
      if (!silent && !document.hidden) audio.resume(scene.clock.time);
      game.resume();
    },
    replay() {
      audio.reset();
      scene.reset();
      scene.clock.start();
      if (!silent && !document.hidden) audio.resume(0);
      game.resume();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      audio.dispose();
      scene.dispose();
      game.destroy();
    },
  };
}
