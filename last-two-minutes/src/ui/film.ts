import { CONTRACT, seededRandom } from '../show/contract.ts';

/**
 * Film treatment laid over the 3D canvas by the browser compositor: 2:1 matte, vignette, a per-act colour
 * cast, contrast/saturation and 24 fps grain. It is deliberately outside the engine: the engine's full-frame
 * 3D effect path re-renders the scene through an extra target, which roughly doubled measured GPU time and
 * dropped frames in the heaviest scenes. Everything here is a pure function of show time.
 */

interface Grade {
  /** Soft-light colour cast, 0..255 per channel, and its strength. */
  tint: readonly [number, number, number]; cast: number;
  vignette: number; grain: number; contrast: number; saturation: number;
}

/** One grade per act, held for the act and eased over the last `EASE` seconds into the next. */
const ACTS: readonly { start: number; grade: Grade }[] = [
  // Awe: cold, clean light, the planet as the only warm thing.
  { start: 0, grade: { tint: [70, 112, 172], cast: .22, vignette: .5, grain: .15, contrast: 1.06, saturation: 1.05 } },
  // Fighting: hot, contrasty, slightly crushed.
  { start: 20, grade: { tint: [255, 150, 72], cast: .2, vignette: .58, grain: .17, contrast: 1.1, saturation: 1 } },
  // Ground: bled out, steel blue, a witness's palette.
  { start: 50, grade: { tint: [92, 122, 162], cast: .28, vignette: .62, grain: .19, contrast: 1.08, saturation: .84 } },
  // Countdown: amber creeping in as the weapon charges.
  { start: 70, grade: { tint: [255, 142, 62], cast: .26, vignette: .62, grain: .19, contrast: 1.12, saturation: .92 } },
  // The wound: furnace light.
  { start: 95, grade: { tint: [255, 112, 42], cast: .3, vignette: .66, grain: .21, contrast: 1.14, saturation: 1 } },
  { start: 110, grade: { tint: [255, 122, 52], cast: .32, vignette: .68, grain: .22, contrast: 1.18, saturation: 1 } },
  // Aftermath: the colour drains.
  { start: 114, grade: { tint: [112, 142, 192], cast: .26, vignette: .72, grain: .22, contrast: 1.1, saturation: .66 } },
  { start: 120, grade: { tint: [112, 142, 192], cast: .26, vignette: .78, grain: .24, contrast: 1.08, saturation: .42 } },
];
const EASE = 2.5;

const smooth = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, k: number): number => a + (b - a) * k;

export function gradeAt(t: number): Grade {
  let index = 0;
  while (index + 1 < ACTS.length && t >= ACTS[index + 1]!.start) index++;
  const a = ACTS[index]!, b = ACTS[Math.min(index + 1, ACTS.length - 1)]!;
  const k = a === b ? 0 : smooth((t - (b.start - EASE)) / EASE);
  const x = a.grade, y = b.grade;
  return {
    tint: [mix(x.tint[0], y.tint[0], k), mix(x.tint[1], y.tint[1], k), mix(x.tint[2], y.tint[2], k)],
    cast: mix(x.cast, y.cast, k), vignette: mix(x.vignette, y.vignette, k), grain: mix(x.grain, y.grain, k),
    contrast: mix(x.contrast, y.contrast, k), saturation: mix(x.saturation, y.saturation, k),
  };
}

export interface Film { update(t: number): void; dispose(): void }

const GRAIN_SIZE = [640, 360] as const;

/** Mounts the film layers over `canvas`; they share its 16:9 box so the matte is exact at any window size. */
export function createFilm(host: HTMLElement, canvas: HTMLCanvasElement): Film {
  const frame = document.createElement('div');
  frame.className = 'film-frame'; frame.setAttribute('aria-hidden', 'true');
  const layer = (tag: 'div' | 'canvas', className: string): HTMLElement => {
    const element = document.createElement(tag); element.className = `film ${className}`; frame.append(element); return element;
  };
  const tint = layer('div', 'film-tint'), vignette = layer('div', 'film-vignette'), grain = layer('canvas', 'film-grain') as HTMLCanvasElement;
  layer('div', 'film-bar film-bar-top'); layer('div', 'film-bar film-bar-bottom');
  host.insertBefore(frame, canvas.nextSibling);

  // One tile of seeded noise; moving it every frame at 24 fps reads as grain without redrawing.
  grain.width = GRAIN_SIZE[0]; grain.height = GRAIN_SIZE[1];
  const context = grain.getContext('2d');
  if (context) {
    const random = seededRandom(CONTRACT.seed ^ 0x9e3779b9), image = context.createImageData(grain.width, grain.height);
    for (let i = 0; i < image.data.length; i += 4) {
      // Gaussian-ish: the mean of three uniforms keeps most grains near mid-grey.
      const v = (random() + random() + random()) / 3 * 255;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let filter = '', tick = -1;
  return {
    update(t) {
      const g = gradeAt(t);
      tint.style.background = `rgb(${g.tint[0].toFixed(0)} ${g.tint[1].toFixed(0)} ${g.tint[2].toFixed(0)})`;
      tint.style.opacity = g.cast.toFixed(3);
      vignette.style.opacity = g.vignette.toFixed(3);
      grain.style.opacity = g.grain.toFixed(3);
      const next = `contrast(${g.contrast.toFixed(3)}) saturate(${g.saturation.toFixed(3)})`;
      if (next !== filter) { canvas.style.filter = next; filter = next; }
      const step = still.matches ? 0 : Math.floor(t * 24);
      if (step !== tick) {
        tick = step;
        // A cheap integer hash decides the jitter, so a given frame always carries the same grain.
        const h = Math.imul(step ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
        grain.style.transform = `translate(${((h % 100) / 100 - .5) * 6}%, ${(((h >>> 8) % 100) / 100 - .5) * 6}%)`;
      }
    },
    dispose() { frame.remove(); canvas.style.filter = ''; },
  };
}
