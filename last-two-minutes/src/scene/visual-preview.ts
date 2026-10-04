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

import { noise, fbm, smooth } from './planet-noise.ts';
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

function shockRing(): Geometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const segments = 192, sides = 8;
  for(let i=0;i<=segments;i++) for(let j=0;j<=sides;j++) {
    const a=i/segments*Math.PI*2,b=j/sides*Math.PI*2,c=Math.cos(a),s=Math.sin(a),w=Math.cos(b);
    const ripple=1+.008*Math.sin(a*13)+.004*Math.sin(a*29);
    positions.push(c*(ripple+.011*w),s*(ripple+.011*w),.011*Math.sin(b));
    normals.push(c*w,s*w,Math.sin(b));uvs.push(i/segments,j/sides);
    if(i<segments&&j<sides) { const k=i*(sides+1)+j;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1); }
  }
  return new Geometry({positions,normals,uvs,indices});
}

async function moltenCore(): Promise<{ geometry: Geometry; texture: Texture }> {
  const source=Geometry.sphere(1,64,48),positions:number[]=[],normals:number[]=[],uvs:number[]=[];
  for(let i=0;i<source.vertices.length;i+=8){
    const x=source.vertices[i]!,y=source.vertices[i+1]!,z=source.vertices[i+2]!;
    const r=.78+.3*noise(x*5+31,y*5-11,z*5);
    positions.push(x*r,y*r,z*r);normals.push(x,y,z);uvs.push(source.vertices[i+6]!,source.vertices[i+7]!);
  }
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const context=canvas.getContext('2d');if(!context)throw new Error('無法建立核心紋理');
  const image=context.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const a=x/canvas.width*Math.PI*2,b=y/(canvas.height-1)*Math.PI;
    const px=Math.cos(a)*Math.sin(b),py=Math.cos(b),pz=Math.sin(a)*Math.sin(b);
    const field=fbm(px*9+4,py*9-17,pz*9+8,4);
    const vein=smooth(.73,.94,1-Math.abs(field*2-1));
    const grit=noise(px*77,py*77,pz*77);
    const k=(y*canvas.width+x)*4;
    image.data[k]=24+vein*(115+grit*75);image.data[k+1]=13+vein*vein*(46+grit*45);
    image.data[k+2]=8+vein*vein*9;image.data[k+3]=255;
  }
  context.putImageData(image,0,0);
  return {geometry:new Geometry({positions,normals,uvs,indices:source.indices}),texture:await Texture.fromImage(canvas)};
}

class RepresentativeScene extends Scene {
  private readonly lens = new PerspectiveCamera();
  private readonly aim = new Vector3();
  private readonly coreLight = new PointLight({ position: [0,0,0], color: [1,.35,.08], intensity: 0, range: 40 });
  private readonly models = new Group();
  private planet?: PlanetModel;
  private ship?: ShipModel;
  private combat?: CombatModel;
  private dust?: GPUParticleEmitter3D;
  private readonly engineStreams: GPUParticleEmitter3D[] = [];
  private core?: Mesh;
  private wave?: Mesh;
  private lightLine?: Mesh;
  private renderer?: Renderer;
  private readonly textures: Texture[] = [];
  private readonly nativeMaterials: NativeMaterial3D[] = [];
  private readonly dustOrigins: Vector3[] = [];
  private readonly geometries: Geometry[] = [];
  private time = 0;
  private emitted = false;
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
    const molten=await moltenCore();this.geometries.push(molten.geometry);this.textures.push(molten.texture);
    this.core = this.add(new Mesh({ geometry: molten.geometry, material: new PBRMaterial({ texture: molten.texture, emissiveTexture: molten.texture, color: [.34,.19,.11], emissive: [2.4,1.3,.5], roughness: .94 }) }));
    const waveGeometry=shockRing();this.geometries.push(waveGeometry);
    const waveMaterial=new NativeMaterial3D({texture:white,color:[.42,.52,.61],transparent:true,deformationBounds:0,uniforms:[.14,0,0,0],
      wgsl:`fn xyzDeform(position:vec3f,normal:vec3f,uv:vec2f)->XYZVertex{return XYZVertex(position,normal);}
        fn xyzSurface(world:vec3f,normal:vec3f,uv:vec2f,texel:vec4f)->vec4f{let a=mesh.custom[0].x;return vec4f(texel.rgb*a,texel.a*a);}`,
      glsl:`#ifdef XYZ_VERTEX
        XYZVertex xyzDeform(vec3 position,vec3 normal,vec2 uv){return XYZVertex(position,normal);}
        #endif
        #if defined(XYZ_FRAGMENT) || defined(XYZ_SHADOW)
        vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){float a=xyzUniforms[0].x;return vec4(texel.rgb*a,texel.a*a);}
        #endif`});
    this.nativeMaterials.push(waveMaterial);
    this.wave = this.add(new Mesh({ geometry: waveGeometry, material: waveMaterial,castShadow:false,receiveShadow:false }));
    const lineGeometry = Geometry.sphere(1,16,8); this.geometries.push(lineGeometry);
    this.lightLine = this.add(new Mesh({ geometry: lineGeometry, material: new PBRMaterial({ texture: white, color: [.65,.48,.29], emissive: [1,.5,.18] }) }));
    this.lightLine.scale.set(7.5,.012,.012);
    const starsGeometry = Geometry.sphere(1,6,4); this.geometries.push(starsGeometry);
    const stars = this.add(new InstancedMesh({ geometry: starsGeometry, material: new PBRMaterial({ texture: white, color: [.4,.5,.7], emissive: [.6,.8,1.2] }), count: CONTRACT.visual.stars }));
    const random = seededRandom(CONTRACT.seed);
    for (let i=0;i<stars.count;i++) {
      const y=random()*2-1, angle=random()*Math.PI*2, r=Math.sqrt(1-y*y), size=.018+random()*.025;
      stars.setMatrixAt(i,pose(Math.cos(angle)*r*180,y*180,Math.sin(angle)*r*180,size,size,size));
    }
    for(const node of planet.root.children)if(node instanceof Mesh&&node.material instanceof NativeMaterial3D)this.nativeMaterials.push(node.material);
    for(let i=0;i<16;i++){
      const y=1-2*(i+.5)/16,a=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y)*CONTRACT.visual.planetRadius;
      this.dustOrigins.push(new Vector3(Math.cos(a)*r,y*CONTRACT.visual.planetRadius,Math.sin(a)*r));
    }
    await Promise.all([game.graphics.prepareTextures(this.textures), ...this.geometries.map(geometry=>game.graphics.prepareGeometry(geometry)),...this.nativeMaterials.map(material=>game.graphics.prepareMaterial(material))]);
    await this.resetPreview('flyby');
  }

  async resetPreview(view: PreviewView): Promise<void> {
    if (!this.planet || !this.ship || !this.renderer) return;
    this.resetting = true;
    try {
      if (this.dust) { this.remove(this.dust); this.dust.destroy(); }
      for(const stream of this.engineStreams){this.ship.root.remove(stream);stream.destroy();}
      this.engineStreams.length=0;
      // clear() preserves native sequence; a new prepared emitter restores seeded replay.
      const dust = new GPUParticleEmitter3D({ capacity: CONTRACT.visual.dustCapacity, rate: 0,
        seed: CONTRACT.seed, lifetime: 10, space: 'world', velocityMin: [-1.3,-1.3,-1.3], velocityMax: [1.3,1.3,1.3],
        startColor: [.23,.2,.18,.018], endColor: [.12,.14,.16,0], startSize: .7, endSize: 3.2 });
      dust.stop(); dust.pause();
      if (!this.renderer.prepareGpuParticles) throw new Error('渲染器不支援 GPU 粒子預載');
      await this.renderer.prepareGpuParticles(dust);
      if (this.destroyed) { dust.destroy(); return; }
      this.dust = this.add(dust);
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
      this.view = view; this.time = 0; this.emitted = false;
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
    if (!this.planet || !this.ship || !this.core || !this.wave || !this.lightLine) return;
    const t=this.time;
    this.ship.root.visible = this.view === 'flyby';
    this.models.rotation.setFromEuler(-.06,.18,0);
    this.core.visible=this.wave.visible=this.lightLine.visible=false; this.coreLight.intensity=0;
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
    } else if (this.view === 'aftermath') {
      this.planet.setDamage(1);
      if (t >= CONTRACT.visual.breakupLead) {
        const age=t-CONTRACT.visual.breakupLead;
        const pull=Math.min(1,age/9);
        this.lens.position.set(0,4+pull*4,43+pull*42);this.lens.lookAt(this.aim);
        this.planet.setBreakup(age);
        const peak=Math.exp(-Math.pow((age-1.5)/1.7,2));
        this.core.visible=age<5.5; const s=(1.2+peak*2.3)*(1-smooth(3,5.5,age)); this.core.scale.set(s,s,s);
        const material=this.core.material as PBRMaterial;
        material.emissive[0]=1.3+peak*3; material.emissive[1]=.8+peak*1.8; material.emissive[2]=.3+peak*.7;
        this.coreLight.position.set(0,0,0); this.coreLight.intensity=30*peak;
        this.wave.visible=age<7; const r=CONTRACT.visual.planetRadius+age*4; this.wave.scale.set(r,r,r);this.wave.rotation.setFromEuler(.55,.14,0);
        (this.wave.material as NativeMaterial3D).uniforms[0]=.14*(1-smooth(1,7,age));
        this.lightLine.visible=age>=6;
        if (!this.emitted && this.dust) {
          this.dust.resume();
          for(const origin of this.dustOrigins){this.dust.position.set(origin.x,origin.y,origin.z);this.dust.burst(CONTRACT.visual.dustCapacity/this.dustOrigins.length);}
          this.emitted=true;
        }
      }
    }
    if (t>=CONTRACT.visual.previewDuration) {
      this.dust?.pause();
      for(const stream of this.engineStreams){stream.stop();stream.pause();}
    }
  }

  protected override onDestroy(): void {
    this.dust?.destroy();
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
