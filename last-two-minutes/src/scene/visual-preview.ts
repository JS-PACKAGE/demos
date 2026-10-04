import { Game, Scene, Group, Mesh, Geometry, InstancedMesh, Texture, PBRMaterial, NativeMaterial3D, PerspectiveCamera, PointLight, EnvironmentMap, Vector3, GPUParticleEmitter3D, type Renderer } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract.ts';
import { createPlanetModel, type PlanetModel } from './planet-model.ts';
import { createShipModel, type ShipModel } from './ship-model.ts';
import { createCombatModel, type CombatModel } from './combat-model.ts';
import { COMBAT_SHOTS } from '../show/combat.ts';
import type { CueName } from '../audio/synthesis.ts';
import { pose } from './geometry.ts';
import { createShowAudio } from '../audio/show-audio.ts';
import { sampleShow } from '../show/director.ts';

import { createCataclysm, type Cataclysm } from './cataclysm.ts';
export type PreviewView = 'flyby' | 'wounded' | 'aftermath' | 'combat';
export interface PreviewMetrics {
  backend: string; resolution: string; samples: number; frameP50: number; frameP95: number; frameMax: number;
  cpuP95: number; cpuMax: number; gpuStatus: string; gpuMs: number | null; gpuMax: number | null;
  drawCalls: number; triangles: number; hdr: boolean;
}
export interface VisualPreview {
  select(view: PreviewView): Promise<void>;
  restart(): Promise<void>;
  enableSound(): Promise<void>;
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  metrics(): PreviewMetrics;
  dispose(): void;
}

const combatCues: readonly { t: number; kind: CueName; pan: number }[] = COMBAT_SHOTS.flatMap(shot => [
  { t: CONTRACT.scene.combatStart + shot.fireTime, kind: 'shot' as const, pan: Math.max(-1, Math.min(1, shot.start[0] / 12)) },
  { t: CONTRACT.scene.combatStart + shot.hitTime, kind: shot.result === 'shield' ? 'shield' as const
    : shot.result === 'kill' ? 'breakup' as const : 'impact' as const, pan: Math.max(-1, Math.min(1, shot.end[0] / 12)) },
]).sort((a, b) => a.t - b.t);

class RepresentativeScene extends Scene {
  private readonly lens = new PerspectiveCamera();
  private readonly aim = new Vector3();
  private readonly coreLight = new PointLight({ position: [0,0,0], color: [1,.35,.08], intensity: 0, range: 40 });
  private readonly models = new Group();
  private planet?: PlanetModel;
  private ship?: ShipModel;
  private combat?: CombatModel;
  private cataclysm?: Cataclysm;
  private readonly engineStreams: GPUParticleEmitter3D[] = [];
  private renderer?: Renderer;
  private readonly textures: Texture[] = [];
  private readonly nativeMaterials: NativeMaterial3D[] = [];
  private readonly geometries: Geometry[] = [];
  private time = 0;
  private resetting = false;
  private view: PreviewView = 'flyby';
  private readonly environmentMap: EnvironmentMap;
  hdr = false;
  get elapsed(): number { return this.time; }

  constructor(private readonly onFrame: (view: PreviewView, time: number) => void) {
    super();
    this.camera3D = this.lens;
    this.lens.near = .1; this.lens.far = 1000;
    const sun = new Vector3(...CONTRACT.visual.lightDirection).normalize();
    this.directionalLight = { direction: sun, color: [1,.92,.81], intensity: 3.1 };
    this.environmentMap = EnvironmentMap.gradient({ width: CONTRACT.visual.environmentWidth,
      zenith: [.045,.065,.105], horizon: [.15,.2,.28], ground: [.013,.018,.028],
      sun: { direction: [sun.x,sun.y,sun.z], color: [10,9.2,8.1], radius: .045 } });
    this.environment = this.environmentMap; this.environmentIntensity = .45;
    this.ambientLight = .025;
    this.shadows.enabled = true; this.shadows.cascades = 1;
    this.shadows.mapSize = CONTRACT.visual.shadowMapSize; this.shadows.extent = 38;
    this.shadows.near = .1; this.shadows.far = 150; this.shadows.bias = .00035;
    this.pointLights.push(this.coreLight);
    this.add(this.models);
  }

  override async preload(game: Game, signal: AbortSignal): Promise<void> {
    this.renderer = game.graphics;
    this.hdr = game.graphics.backend === 'webgpu' || !!game.canvas.getContext('webgl2')?.getExtension('EXT_color_buffer_float');
    this.postProcessing.enabled = this.hdr; this.postProcessing.toneMapping = 'aces';
    this.postProcessing.exposure = .86; this.postProcessing.bloomStrength = .12;
    this.postProcessing.bloomThreshold = 1.5; this.postProcessing.bloomRadius = 3;
    this.postProcessing.fxaa = this.hdr; this.transparency = 'sorted';
    const [planet, ship] = await Promise.all([createPlanetModel(), createShipModel()]);
    this.planet = planet; this.ship = ship;
    this.models.add(planet.root); this.add(ship.root);
    this.textures.push(...planet.textures,...ship.textures);
    this.geometries.push(...planet.geometries,...ship.geometries);
    const combat = await createCombatModel(ship);
    this.combat = combat; this.add(combat.root);
    for (const light of combat.lights) this.pointLights.push(light);
    this.textures.push(...combat.textures); this.geometries.push(...combat.geometries);
    this.nativeMaterials.push(...combat.nativeMaterials);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('無法建立程序光效貼圖');
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,2,2);
    const white = await Texture.fromImage(canvas); this.textures.push(white);
    const cataclysm=await createCataclysm(game.graphics,white,1.5);this.cataclysm=cataclysm;this.add(cataclysm.root);this.pointLights.push(cataclysm.light);
    this.textures.push(...cataclysm.textures);this.geometries.push(...cataclysm.geometries);this.nativeMaterials.push(...cataclysm.nativeMaterials);
    const starsGeometry = Geometry.sphere(1,6,4); this.geometries.push(starsGeometry);
    const stars = this.add(new InstancedMesh({ geometry: starsGeometry, material: new PBRMaterial({ texture: white, color: [.4,.5,.7], emissive: [.6,.8,1.2] }), count: CONTRACT.visual.stars }));
    const random = seededRandom(CONTRACT.seed);
    for (let i=0;i<stars.count;i++) {
      const y=random()*2-1, angle=random()*Math.PI*2, r=Math.sqrt(1-y*y), size=.018+random()*.025;
      stars.setMatrixAt(i,pose(Math.cos(angle)*r*180,y*180,Math.sin(angle)*r*180,size,size,size));
    }
    for(const node of planet.root.children)if(node instanceof Mesh&&node.material instanceof NativeMaterial3D)this.nativeMaterials.push(node.material);
    
    await Promise.all([game.graphics.prepareTextures(this.textures), ...this.geometries.map(geometry=>game.graphics.prepareGeometry(geometry)),...this.nativeMaterials.map(material=>game.graphics.prepareMaterial(material))]);
    await this.resetPreview('flyby');
  }

  async resetPreview(view: PreviewView): Promise<void> {
    if (!this.planet || !this.ship || !this.renderer) return;
    this.resetting = true;
    try {
      for(const stream of this.engineStreams){this.ship.root.remove(stream);stream.destroy();}
      this.engineStreams.length=0;
      if (this.cataclysm) await this.cataclysm.reset();
      if (this.destroyed) return;
      if (!this.renderer.prepareGpuParticles) throw new Error('渲染器不支援 GPU 粒子預載');
      for(let nozzle=0;view==='flyby'&&nozzle<3;nozzle++){
        const warm=nozzle===1;
        const stream=new GPUParticleEmitter3D({capacity:CONTRACT.visual.engineParticles.capacity,rate:CONTRACT.visual.engineParticles.rate,
          lifetime:CONTRACT.visual.engineParticles.lifetime,seed:CONTRACT.seed+nozzle*101,space:'world',
          velocityMin:[-.25,-.25,4.8],velocityMax:[.25,.25,7.6],gravity:[0,0,0],
          startColor:warm?[1,.62,.24,.42]:[.32,.68,1,.38],endColor:warm?[.65,.18,.04,0]:[.04,.2,.5,0],
          startSize:.16,endSize:.025});
        stream.position.set((nozzle-1)*.81,-.02,4.95);
        stream.stop();stream.pause();
        try{await this.renderer.prepareGpuParticles(stream);}catch(error){stream.destroy();throw error;}
        if(this.destroyed){stream.destroy();return;}
        this.ship.root.add(stream);this.engineStreams.push(stream);
      }
      this.view = view; this.time = 0;
      this.planet.reset();
      this.combat?.reset();
      const shot = CONTRACT.visual.views[view];
      this.lens.position.set(...shot.position); this.aim.set(...shot.target);
      this.lens.fov = shot.fov*Math.PI/180; this.lens.lookAt(this.aim);
      this.apply();
      for(const stream of this.engineStreams){stream.resume();stream.start();}
    } finally { this.resetting = false; }
  }

  override update(delta: number): void {
    if(this.resetting||document.hidden||this.time>=CONTRACT.visual.previewDuration)return;
    this.time=Math.min(CONTRACT.visual.previewDuration,this.time+delta);
    this.apply(); this.onFrame(this.view,this.time);
  }

  private apply(): void {
    if (!this.planet || !this.ship || !this.cataclysm) return;
    const t=this.time;
    this.ship.root.visible = this.view === 'flyby';
    this.models.rotation.setFromEuler(-.06,.18,0);
    this.cataclysm.update(-16); this.coreLight.intensity=0;
    if (this.combat) {
      const active = this.view === 'combat';
      this.combat.root.visible = active;
      if (active) this.combat.update(t);
      else for (const light of this.combat.lights) light.intensity = 0;
    }
    if (this.view === 'flyby') {
      const q=t/CONTRACT.visual.previewDuration;
      this.ship.root.position.set(-3.8+q*7.2,.4+Math.sin(q*Math.PI)*.6,25-q*3);
      this.ship.root.scale.set(.36,.36,.36); this.ship.root.rotation.setFromEuler(.38-q*.16,-.88-q*.46,-.08+q*.1);
    } else if (this.view === 'wounded') {
      this.planet.setDamage(Math.min(1,t/3));
      const d=CONTRACT.visual.damageDirection,r=(CONTRACT.visual.planetRadius-1.2)/Math.hypot(...d),q=this.models.rotation;
      const x=d[0]*r,y=d[1]*r,z=d[2]*r,tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
      this.coreLight.position.set(x+q.w*tx+q.y*tz-q.z*ty,y+q.w*ty+q.z*tx-q.x*tz,z+q.w*tz+q.x*ty-q.y*tx);
      this.coreLight.intensity=4.5*Math.min(1,t/3);
      this.cataclysm.update(Math.min(0,t-15));
    } else if (this.view === 'aftermath') {
      this.planet.setDamage(1);
      if (t >= CONTRACT.visual.breakupLead) {
        const age=t-CONTRACT.visual.breakupLead;
        const pull=Math.min(1,age/9);
        this.lens.position.set(0,4+pull*4,43+pull*42);this.lens.lookAt(this.aim);
        this.planet.setBreakup(age);
        this.cataclysm.update(age);
      }
    }
    if (t>=CONTRACT.visual.previewDuration) {
      this.cataclysm?.freeze();
      for(const stream of this.engineStreams){stream.stop();stream.pause();}
    }
  }

  protected override onDestroy(): void {
    this.cataclysm?.dispose();
    for(const stream of this.engineStreams)stream.destroy();
    this.combat?.dispose();
    for(const material of this.nativeMaterials)material.destroy();
    for (const geometry of this.geometries) this.renderer?.unloadGeometry(geometry);
    for (const texture of this.textures) { this.renderer?.unloadTexture(texture); if(!texture.destroyed)texture.destroy(); }
    this.environmentMap.destroy();
  }
}

export async function createVisualPreview(canvas: HTMLCanvasElement,
  onFrame: (view: PreviewView, time: number) => void, onFailure: (message: string) => void): Promise<VisualPreview> {
  if (!import.meta.env.DEV) throw new Error('美術預覽僅供本機審閱，不是正式演出入口。');
  const game = await Game.create({ canvas, renderer: 'auto', pixelRatio: 1,
    gpuTiming: { enabled: true, warmupFrames: 30, sampleInterval: 4 } });
  if (!game.graphics.capabilities.threeD || !game.graphics.capabilities.instancing) { game.destroy(); throw new Error('需要 WebGPU 或具備 3D 的 WebGL2。'); }
  let lastStamp=0, count=0, cursor=0, sampleFrames=0, view:PreviewView='flyby';
  const audio = createShowAudio(game);
  let soundEnabled = false, paused = false, audioEnded = false;
  const audioTime = (active: PreviewView, t: number): number => t + (active === 'flyby' ? 0
    : active === 'combat' ? CONTRACT.scene.combatStart
    : active === 'wounded' ? CONTRACT.scene.impactTime : CONTRACT.scene.breakupTime-CONTRACT.visual.breakupLead);
  function resumeAudio(): void {
    if(soundEnabled && !paused && !document.hidden && scene.elapsed<CONTRACT.visual.previewDuration)
      audio.resume(audioTime(view,scene.elapsed));
  }
  const intervals = new Float64Array(1200), cpu = new Float64Array(1200);
  const scene = new RepresentativeScene((active,t) => {
    // Wall time measures frame intervals only; scene animation advances exclusively by engine delta.
    const now=performance.now();
    if(lastStamp && !document.hidden && sampleFrames>30) {
      intervals[cursor]=now-lastStamp; cpu[cursor]=game.graphics.stats.cpuSubmitMs ?? 0;
      cursor=(cursor+1)%intervals.length;count=Math.min(count+1,intervals.length);
    }
    lastStamp=now; sampleFrames++; onFrame(active,t);
    if(soundEnabled) {
      if(t>=CONTRACT.visual.previewDuration) { if(!audioEnded){audio.pause();audioEnded=true;} }
      else audio.update(sampleShow(audioTime(active,t)), active === 'combat' ? combatCues : undefined);
    }
  });
  const lifetime=new AbortController();
  game.addEventListener('error',()=>{audio.pause();onFailure('渲染器或音訊執行失敗，預覽已停止。');},{signal:lifetime.signal});
  document.addEventListener('visibilitychange',()=>{lastStamp=0;if(document.hidden)audio.pause();else resumeAudio();},{signal:lifetime.signal});
  try { await Promise.all([game.setScene(scene,{signal:lifetime.signal}),audio.prepare()]);game.start(); }
  catch(error) { lifetime.abort();audio.dispose();game.destroy();throw error; }
  return {
    async select(next) {
      audio.pause();view=next;await scene.resetPreview(next);audio.reset();audioEnded=false;
      lastStamp=count=cursor=sampleFrames=0;paused=false;resumeAudio();game.resume();
    },
    async restart() {
      audio.pause();await scene.resetPreview(view);audio.reset();audioEnded=false;
      lastStamp=count=cursor=sampleFrames=0;paused=false;resumeAudio();game.resume();
    },
    async enableSound() {
      // This must be the first asynchronous operation in the click's gesture.
      const activation=audio.unlock();game.pause();
      try {
        await activation;await scene.resetPreview(view);audio.reset();soundEnabled=true;audioEnded=false;
        lastStamp=count=cursor=sampleFrames=0;paused=false;resumeAudio();
      } finally { lastStamp=0;game.resume(); }
    },
    get paused() { return paused; },
    pause() { paused=true;audio.pause();game.pause(); },
    resume() { paused=false;lastStamp=0;resumeAudio();game.resume(); },
    metrics() {
      const frame=Array.from(intervals.subarray(0,count)).sort((a,b)=>a-b), work=Array.from(cpu.subarray(0,count)).sort((a,b)=>a-b);
      const stats=game.graphics.stats;
      return { backend:game.graphics.backend, resolution:`${canvas.width} × ${canvas.height}`, samples:count,
        frameP50:frame[Math.floor((count-1)*.5)]??0,frameP95:frame[Math.floor((count-1)*.95)]??0,frameMax:frame[count-1]??0,
        cpuP95:work[Math.floor((count-1)*.95)]??0,cpuMax:work[count-1]??0,
        gpuStatus:stats.gpuTiming.status,gpuMs:stats.gpuTiming.milliseconds,gpuMax:stats.gpuTiming.maximumMilliseconds,
        drawCalls:stats.drawCalls,triangles:stats.triangles,hdr:scene.hdr };
    },
    dispose() { lifetime.abort();audio.dispose();game.destroy(); },
  };
}
