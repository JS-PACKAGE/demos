import { CONTRACT } from './contract.ts';

export type ClockStatus = 'ready' | 'playing' | 'paused' | 'ended';

export class ShowClock {
  time = 0;
  seed: number = CONTRACT.seed;
  status: ClockStatus = 'ready';

  start(): void {
    if (this.status === 'ready') this.status = 'playing';
  }

  pause(): void {
    if (this.status === 'playing') this.status = 'paused';
  }

  resume(): void {
    if (this.status === 'paused') this.status = 'playing';
  }

  reset(): void {
    this.time = 0;
    this.seed = CONTRACT.seed;
    this.status = 'ready';
  }

  advance(delta: number, hidden = false): number {
    if (this.status !== 'playing' || hidden || !Number.isFinite(delta) || delta <= 0) return this.time;
    this.time = Math.min(CONTRACT.duration, this.time + delta);
    if (this.time === CONTRACT.duration) this.status = 'ended';
    return this.time;
  }
}
