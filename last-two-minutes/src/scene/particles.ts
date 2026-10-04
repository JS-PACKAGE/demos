import { GPUParticleEmitter3D, type GPUParticleEmitter3DOptions } from 'xyz.js';
import { pose } from './geometry.ts';
import type { Vec3 } from '../show/contract.ts';

export type Burst = { t: number; position: Vec3; count: number; spread: number };

/** XYZ's native shader ABI: birth, sequence, two reserved words, affine matrix.
 * Commands are immutable. Sampling the shader clock makes pause/replay independent
 * of frame partitioning (engine clear() intentionally preserves its command clock).
 */
export class AnalyticParticles extends GPUParticleEmitter3D {
  private readonly scheduled: Float32Array;
  private readonly scheduledCount: number;
  sampleTime = 0;
  constructor(options: GPUParticleEmitter3DOptions, bursts: readonly Burst[]) {
    super({ ...options, rate: 0, space: 'world' });
    this.stop();
    this.scheduled = new Float32Array(options.capacity * 20);
    const words = new Uint32Array(this.scheduled.buffer);
    let count = 0;
    for (const burst of bursts) for (let i=0;i<burst.count && count<options.capacity;i++) {
      const offset = count * 20, a = i * 2.399963229728653, r = burst.spread * Math.sqrt((i+.5)/burst.count);
      this.scheduled[offset] = burst.t;
      words[offset+1] = count;
      this.scheduled.set(pose(burst.position[0]+Math.cos(a)*r,burst.position[1]+Math.sin(a)*r,burst.position[2],1,1,1).elements,offset+4);
      count++;
    }
    this.scheduledCount = count;
  }
  override get commandData(): Float32Array { return this.scheduled; }
  override get activeCount(): number { return this.scheduledCount; }
  override get commandHead(): number { return 0; }
  override get commandVersion(): number { return 1; }
  override get shaderTime(): number { return this.sampleTime; }
  override get time(): number { return this.sampleTime; }
  override updateSimulation(_delta: number): void { /* sampled by ShowClock, never integrated */ }
  override clear(): void { this.sampleTime = 0; super.clear(); }
}
