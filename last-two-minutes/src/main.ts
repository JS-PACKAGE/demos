import { createRuntime, type ShowRuntime } from './scene/runtime.ts';
import { createFilm } from './ui/film.ts';
import type { ShowSample } from './show/director.ts';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#show')!;
const intro = document.querySelector<HTMLElement>('#intro')!;
const status = document.querySelector<HTMLElement>('#status')!;
const backend = document.querySelector<HTMLElement>('#backend')!;
const time = document.querySelector<HTMLElement>('#time')!;
const beat = document.querySelector<HTMLElement>('#beat')!;
const sound = document.querySelector<HTMLElement>('#sound')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const end = document.querySelector<HTMLElement>('#end')!;
const failure = document.querySelector<HTMLElement>('#failure')!;
const unsupported = document.querySelector<HTMLElement>('#unsupported')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const silent = document.querySelector<HTMLButtonElement>('#silent')!;
const pause = document.querySelector<HTMLButtonElement>('#pause')!;
const resume = document.querySelector<HTMLButtonElement>('#resume')!;
const replay = document.querySelector<HTMLButtonElement>('#replay')!;
const chapters = [...document.querySelectorAll<HTMLElement>('.chapters li')];
const film = createFilm(canvas.parentElement!, canvas);
film.update(0);
let runtime: ShowRuntime | undefined;
let busy = false;
let muted = false;
let lastState = '';
let lastSecond = -1;
let hideControls: number | undefined;
function revealControls(): void {
  document.body.dataset.controls = 'true';
  clearTimeout(hideControls);
  if (runtime?.state === 'playing') hideControls = setTimeout(() => {
    if (!document.activeElement?.closest('.transport')) document.body.dataset.controls = 'false';
  }, 2500);
}
window.addEventListener('pointermove', revealControls, { passive: true });
window.addEventListener('pointerdown', revealControls, { passive: true });
window.addEventListener('keydown', revealControls);
document.addEventListener('focusin', revealControls);

function showFailure(message: string): void {
  intro.hidden = true;
  unsupported.hidden = false;
  failure.textContent = message;
  status.textContent = '演出未能開始';
  pause.hidden = resume.hidden = replay.hidden = true;
}

function refreshControls(): void {
  const state = runtime?.state ?? 'loading';
  pause.hidden = state !== 'playing';
  resume.hidden = state !== 'paused';
  replay.hidden = !['playing', 'paused', 'ended'].includes(state);
  end.hidden = state !== 'ended';
  if (lastState !== state) {
    lastState = state;
    document.body.dataset.playing = String(state === 'playing');
    revealControls();
    status.textContent = state === 'ended' ? '演出結束，時間停在此刻。'
      : state === 'paused' ? '已暫停，畫面與聲音同步停住。'
      : state === 'playing' ? '演出中 · 鏡頭由時間軸控制'
      : '準備完成。選擇開始或無聲播放。';
  }
}

function frame(sample: ShowSample): void {
  const second = Math.floor(sample.t);
  if (second !== lastSecond) {
    lastSecond = second;
    time.textContent = `${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`;
  }
  film.update(sample.t);
  progress.value = sample.t;
  beat.textContent = `${String(sample.beat + 1).padStart(2, '0')} / ${sample.label}`;
  for (let i = 0; i < chapters.length; i++) chapters[i]!.classList.toggle('active', i === sample.beat);
  refreshControls();
}

async function begin(withoutSound: boolean): Promise<void> {
  if (!runtime || busy) return;
  busy = true;
  start.disabled = silent.disabled = true;
  status.textContent = withoutSound ? '正在開始無聲演出…' : '正在解鎖與準備音訊…';
  try {
    // Do not await any work before this call: it owns the user gesture.
    await runtime.start(withoutSound);
    muted = withoutSound;
    sound.textContent = muted ? '無聲播放' : '有聲演出';
    intro.hidden = true;
    refreshControls();
  } catch (error) {
    status.textContent = `音訊未能解鎖：${error instanceof Error ? error.message : String(error)}。可選擇無聲播放。`;
  } finally {
    busy = false;
    start.disabled = silent.disabled = false;
  }
}

start.addEventListener('click', () => { void begin(false); });
silent.addEventListener('click', () => { void begin(true); });
pause.addEventListener('click', () => { runtime?.pause(); refreshControls(); });
resume.addEventListener('click', () => { runtime?.resume(); refreshControls(); });
replay.addEventListener('click', () => { runtime?.replay(); lastSecond = -1; refreshControls(); });
document.addEventListener('visibilitychange', () => {
  if (runtime?.state === 'playing') status.textContent = document.hidden ? '分頁隱藏，模擬時間與聲音停止。' : '演出中 · 鏡頭由時間軸控制';
});
window.addEventListener('pagehide', () => { clearTimeout(hideControls); runtime?.dispose(); runtime = undefined; });
window.addEventListener('pageshow', (event) => { if (event.persisted) void boot(); });

async function boot(): Promise<void> {
  intro.hidden = false;
  unsupported.hidden = true;
  start.disabled = silent.disabled = true;
  lastSecond = -1;
  lastState = '';
  try {
    runtime = await createRuntime(canvas, frame, showFailure);
    backend.textContent = `${runtime.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'} · 即時渲染`;
    start.disabled = silent.disabled = false;
    refreshControls();
  } catch (error) {
    backend.textContent = '無可用演出後端';
    showFailure(error instanceof Error ? error.message : String(error));
  }
}

void boot();
