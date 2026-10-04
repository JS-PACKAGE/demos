import { Scene, Geometry, Mesh, InstancedMesh, PBRMaterial, TextureMaterial, PerspectiveCamera, Vector3, type Game, type Texture, type Renderer } from 'xyz.js';
import { CONTRACT, EVENTS, seededRandom, type Vec3 } from '../show/contract.ts';
import { ShowClock } from '../show/clock.ts';
import { sampleShow, type ShowSample } from '../show/director.ts';
import { crustTile, fighterGeometry, pose, radialPose } from './geometry.ts';
import { makeTextures } from './textures.ts';
import { AnalyticParticles, type Burst } from './particles.ts';

type Flight = { angle:number; radius:number; height:number; speed:number; phase:number };
type Crack = { position:Vec3; rotation:Vec3; length:number; reveal:number };

export class ShowScene extends Scene {
  readonly clock = new ShowClock();
  private readonly lens = new PerspectiveCamera();
  private readonly aim = new Vector3();
  private readonly textures: Texture[] = [];
  private readonly geometries = new Set<Geometry>();
  private readonly flights: Flight[] = [];
  private readonly cracks: Crack[] = [];
  private readonly fragmentNormals: Vec3[] = [];
  private readonly capitals: Mesh[] = [];
  private readonly weapons: Mesh[] = [];
  private readonly flashes: Mesh[] = [];
  private readonly particleLayers: AnalyticParticles[] = [];
  private readonly kills = EVENTS.filter(event=>event.kind==='kill');
  private readonly arrivalTime = EVENTS.find(event=>event.detail==='fleet-pass')!.t;
  private readonly impactPosition = EVENTS.find(event=>event.kind==='impact')!.position;
  private renderer?: Renderer;
  private planet?: Mesh;
  private atmosphere?: Mesh;
  private fragments?: InstancedMesh;
  private fighters?: InstancedMesh;
  private crackMesh?: InstancedMesh;
  private debris?: InstancedMesh;
  private shield?: Mesh;
  private impact?: Mesh;
  private core?: Mesh;
  private shock?: Mesh;
  private lightLine?: Mesh;
  private shadow?: Mesh;
  private weaponGlow?: Mesh;
  private beam?: Mesh;
  private releaseDone = false;
  private prepared = false;

  constructor(private readonly onFrame:(sample:ShowSample)=>void) {
    super();
    this.lens.near=CONTRACT.camera.near; this.lens.far=CONTRACT.camera.far;
    this.camera3D=this.lens;
    this.ambientLight=.22;
    this.directionalLight={direction:new Vector3(-.6,.4,1).normalize(),color:[.65,.8,1],intensity:2};
    this.shadows.enabled=false;
    this.applyCamera(sampleShow(0));
  }

  override async preload(game:Game,signal:AbortSignal):Promise<void> {
    if(this.prepared) return;
    this.renderer=game.graphics;
    if(!game.graphics.capabilities.threeD||game.graphics.backend==='canvas2d') throw new Error('此瀏覽器無法演出 3D');
    const floatAttachment=game.graphics.backend==='webgpu'||game.canvas.getContext('webgl2')?.getExtension('EXT_color_buffer_float')!=null;
    const hdr=floatAttachment;
    this.postProcessing.enabled=hdr;
    this.postProcessing.toneMapping='aces';this.postProcessing.exposure=1;
    this.postProcessing.bloomStrength=hdr?.65:0;this.postProcessing.bloomThreshold=1;this.postProcessing.bloomRadius=5;
    this.postProcessing.fxaa=hdr;this.transparency='sorted';
    const maps=await makeTextures();
    this.textures.push(...Object.values(maps));
    if(signal.aborted||this.releaseDone){this.releaseResources();throw new DOMException('Aborted','AbortError');}
    const random=seededRandom(CONTRACT.seed), radius=CONTRACT.planet.radius;
    const material=(color:[number,number,number],emissive:[number,number,number]=[0,0,0],opacity=1)=>new PBRMaterial({texture:maps.white,color,emissive,roughness:.65,metallic:.25,opacity,transparent:opacity<1,doubleSided:true});
    const add=(geometry:Geometry,mat:TextureMaterial)=>{
      this.geometries.add(geometry);return this.add(new Mesh({geometry,material:mat}));
    };
    const ball=Geometry.sphere(1,48,32), box=Geometry.cube(1);this.geometries.add(ball);this.geometries.add(box);
    this.planet=add(Geometry.sphere(radius,96,64),new PBRMaterial({texture:maps.ground,emissiveTexture:maps.cities,emissive:[2.8,2.1,1.3],roughness:.93,metallic:.05}));
    this.atmosphere=add(Geometry.sphere(radius*1.008,80,48),material([.13,.38,.8],[.08,.2,.42],.065));
    this.fighters=this.add(new InstancedMesh({geometry:fighterGeometry(),material:material([.3,.42,.52],[.05,.14,.2]),count:CONTRACT.budgets.fighters}));this.geometries.add(this.fighters.geometry);
    for(let i=0;i<this.fighters.count;i++){
      this.flights.push({angle:random()*Math.PI*2,radius:12+random()*12,height:(random()-.5)*15,speed:.04+random()*.07,phase:random()*Math.PI*2});
      this.fighters.setColorAt(i,i%3===0?.55:1,i%3===0?.8:.55,i%3===0?1:.35);
    }
    for(let i=0;i<CONTRACT.budgets.capitals;i++){
      const ship=add(box,material(i===0?[.12,.14,.17]:[.2,.27,.34]));
      ship.scale.set(i===0?4.8:2.4,i===0?.7:.5,i===0?8:4.4);this.capitals.push(ship);
      for(let j=0;j<3;j++){
        const engine=ship.add(new Mesh({geometry:box,material:material([.1,.5,.9],[.2,2,4])}));engine.position.set((j-1)*.18,0,.52);engine.scale.set(.09,.4,.06);
      }
    }
    // The surface shot uses the real curved planet and a projected curved silhouette.
    this.shadow=add(crustTile(radius+.022,.8),new TextureMaterial({texture:maps.shadow,color:[0,0,0],transparent:true}));
    this.shadow.rotation.setFromEuler(-Math.PI/2,0,0);this.shadow.position.set(0,radius+.022,0);
    const weaponPosition=CONTRACT.scene.weaponPosition;
    const weapon=add(box,material([.16,.12,.17]));weapon.position.set(...weaponPosition);weapon.scale.set(4,2,9);weapon.rotation.setFromEuler(0,-.9,0);this.weapons.push(weapon);
    this.weaponGlow=add(ball,material([.2,.55,.95],[2,5,10]));this.weaponGlow.position.set(...weaponPosition);
    // Parallel mechanical rails frame the charging aperture.
    for(let i=0;i<5;i++){
      const rail=add(box,material([.28,.25,.32],[.2,.08,.04]));rail.position.set(weaponPosition[0]+(i-2)*.8,weaponPosition[1]+1.4,weaponPosition[2]+2);rail.scale.set(.18,.3,5-i*.55);this.weapons.push(rail);
    }
    this.beam=add(box,material([.45,.75,1],[6,12,20]));
    this.impact=add(ball,material([1,.4,.12],[5,1.5,.3]));this.impact.position.set(...this.impactPosition);
    this.core=add(ball,material([1,.7,.32],[12,7,3]));
    this.shock=add(ball,material([.6,.75,1],[.5,.65,1],.055));
    this.lightLine=add(box,material([.8,.6,.3],[1.3,.8,.35]));
    this.shield=add(ball,material([.12,.65,1],[.2,.7,1],.17));
    this.fragments=this.add(new InstancedMesh({geometry:crustTile(radius,Math.sqrt(4*Math.PI/CONTRACT.budgets.fragments)*.94),material:material([.13,.2,.24],[.05,.022,.01]),count:CONTRACT.budgets.fragments}));this.geometries.add(this.fragments.geometry);
    for(let i=0;i<this.fragments.count;i++){
      const y=1-2*(i+.5)/this.fragments.count,a=i*2.399963229728653,r=Math.sqrt(1-y*y);
      this.fragmentNormals.push([Math.cos(a)*r,y,Math.sin(a)*r]);
      this.fragments.setColorAt(i,.5+random()*.5,.5+random()*.5,.5+random()*.5);
    }
    const crackCount=CONTRACT.budgets.fragments;
    this.crackMesh=this.add(new InstancedMesh({geometry:box,material:material([1,.45,.16],[3,.8,.18]),count:crackCount}));
    // Branching great-circle fissures stay on the original intact sphere until release.
    for(let i=0;i<crackCount;i++){
      const branch=i%12,step=Math.floor(i/12),a=branch/12*Math.PI*2,dist=step/(crackCount/12)*2.2;
      const lon=-.48+Math.cos(a)*dist+.065*Math.sin(step*2+branch),lat=.52+Math.sin(a)*dist;
      const x=Math.sin(lon)*Math.cos(lat),y=Math.sin(lat),z=Math.cos(lon)*Math.cos(lat);
      this.cracks.push({position:[x*(radius+.025),y*(radius+.025),z*(radius+.025)],rotation:[-lat,lon,a],length:.36+random()*.4,reveal:dist/2.2});
    }
    this.debris=this.add(new InstancedMesh({geometry:box,material:material([.28,.3,.32],[.12,.04,.01]),count:CONTRACT.budgets.capitals*4}));
    const stars=this.add(new InstancedMesh({geometry:box,material:material([.5,.65,.85],[1,1.4,2]),count:CONTRACT.budgets.stars}));
    for(let i=0;i<stars.count;i++){
      const y=random()*2-1,a=random()*Math.PI*2,r=Math.sqrt(1-y*y),size=.02+random()*.035;
      stars.setMatrixAt(i,pose(Math.cos(a)*r*300,y*300,Math.sin(a)*r*300,size,size,size));
    }
    const sparks:Burst[]=[],dust:Burst[]=[];
    for(const event of EVENTS){
      const flash=add(box,material(event.kind==='shield'?[.2,.7,1]:[1,.35,.13],event.kind==='shield'?[1,3,5]:[5,1,.3]));this.flashes.push(flash);
      if(event.kind==='kill'||event.kind==='shield'||event.kind==='impact')sparks.push({t:event.t,position:event.position,count:event.kind==='impact'?180:40,spread:.5});
    }
    dust.push({t:CONTRACT.scene.breakupTime,position:[0,0,0],count:Math.floor(CONTRACT.budgets.particleCapacity*.65),spread:8});
    this.particleLayers.push(new AnalyticParticles({capacity:CONTRACT.budgets.particleCapacity,seed:CONTRACT.seed,lifetime:3.5,velocityMin:[-2,-2,-2],velocityMax:[2,2,2],gravity:[0,0,0],startColor:[1,.6,.2,1],endColor:[.4,.12,.03,0],startSize:.18,endSize:.05},sparks));
    if(CONTRACT.budgets.emitters>1)this.particleLayers.push(new AnalyticParticles({capacity:CONTRACT.budgets.particleCapacity,seed:CONTRACT.seed+1,lifetime:14,velocityMin:[-1.5,-1.1,-1.5],velocityMax:[1.5,1.1,1.5],gravity:[0,0,0],startColor:[.4,.3,.22,.11],endColor:[.14,.16,.2,.025],startSize:.8,endSize:3.2},dust));
    for(const layer of this.particleLayers)this.add(layer);
    this.apply(sampleShow(0));
    if(!game.graphics.prepareGpuParticles)throw new Error('渲染器無法預載 GPU 粒子');
    await Promise.all([game.graphics.prepareTextures(this.textures),...Array.from(this.geometries,g=>game.graphics.prepareGeometry(g)),...this.particleLayers.map(p=>game.graphics.prepareGpuParticles!(p))]);
    if(signal.aborted||this.releaseDone)throw new DOMException('Aborted','AbortError');
    this.prepared=true;
  }

  override update(delta:number):void {
    const t=this.clock.advance(delta,document.hidden);
    const sample=sampleShow(t);this.apply(sample);this.onFrame(sample);
  }

  private applyCamera(sample:ShowSample):void {
    this.lens.position.set(...sample.camera.position);this.aim.set(...sample.camera.target);
    this.lens.fov=sample.camera.fov*Math.PI/180;this.lens.lookAt(this.aim);
  }

  private apply(sample:ShowSample):void {
    this.applyCamera(sample);
    if(!this.planet||!this.fragments||!this.fighters||!this.crackMesh||!this.debris)return;
    const t=sample.t,scene=CONTRACT.scene,age=Math.max(0,t-scene.breakupTime),radius=CONTRACT.planet.radius;
    this.planet.visible=t<scene.breakupTime;this.atmosphere!.visible=t<scene.breakupTime;
    this.fragments.visible=t>=scene.breakupTime;
    this.fighters.visible=t>=this.arrivalTime;
    const surface=t>=scene.surfaceStart&&t<scene.surfaceEnd;
    this.shadow!.visible=surface;
    if(surface){
      const x=(t-scene.surfaceStart)*.45-4.5,z=-5+(t-scene.surfaceStart)*.35;
      const r=radius+.022,y=Math.sqrt(r*r-x*x-z*z),half=Math.sqrt((1+z/r)/2),denom=2*half;
      this.shadow!.position.set(x,y,z);
      this.shadow!.rotation.set(-(y/r)/denom,(x/r)/denom,0,half).normalize();
    }
    this.ambientLight=surface?.12:.22;
    this.directionalLight.intensity=surface?1.1+Math.abs(Math.sin((t-scene.surfaceStart)*.14))*1.1:2;
    this.postProcessing.exposure=.78+Math.min(sample.brightness,2)*.16;
    this.planet.rotation.setFromEuler(0,t*.006,0);this.atmosphere!.rotation.setFromEuler(0,t*.006,0);
    for(let i=0;i<this.fighters.count;i++){
      const f=this.flights[i],a=f.angle+t*f.speed,sw=age>0?Math.max(0,age-(f.radius-radius)/4):0;
      let x=Math.cos(a)*f.radius,y=f.height+Math.sin(t*.23+f.phase)*1.2,z=Math.sin(a)*f.radius;
      if(t>=scene.countdownStart&&t<scene.impactTime){const rush=Math.min(1,(t-scene.countdownStart)/22);x-=rush*8;y+=rush*3;}
      x+=Math.cos(a)*sw*3;y+=sw*.5;z+=Math.sin(a)*sw*3;
      let scale=.22*(sw>0?Math.max(.12,1-sw*.12):1),heading=-a-Math.PI/2;
      if(i===0&&t>=scene.combatStart&&t<scene.combatEnd){
        const camera=sample.camera.position,ratio=1-8/Math.hypot(...camera);
        x=camera[0]*ratio+Math.sin(t*.3)*.6;y=camera[1]*ratio-.8;z=camera[2]*ratio;
        heading=Math.atan2(x,z);scale=.55;
      }
      const death=this.kills[i-1];
      if(death&&t>death.t-5){
        x=death.position[0]+Math.max(0,death.t-t)*1.3;
        y=death.position[1];z=death.position[2]+Math.max(0,death.t-t)*.6;
        heading=1.1;scale=.4;
        // XYZ requires invertible instances; hide spent fighters beyond the far plane.
        if(t>=death.t){this.fighters.setMatrixAt(i,pose(0,0,-CONTRACT.camera.far*2,1,1,1));continue;}
      }
      this.fighters.setMatrixAt(i,pose(x,y,z,scale,scale,scale,sw*.8,heading,Math.sin(t*.2+f.phase)*.3));
    }
    for(let i=0;i<this.capitals.length;i++){
      const ship=this.capitals[i];
      ship.visible=t>=this.arrivalTime;
      if(i===0&&surface){ship.position.set((t-scene.surfaceStart)*.45-4.5,13,-5+(t-scene.surfaceStart)*.35);ship.rotation.setFromEuler(.04,Math.PI/2,.02);}
      else {const a=i*1.17+t*.015,r=18+i*1.8,push=Math.max(0,age-(r-radius)/4);ship.position.set(Math.cos(a)*(r+push*3),5+i*.75+push*.7,Math.sin(a)*(r+push*3));ship.rotation.setFromEuler(push*.16,-a,push*.25);}
    }
    if(this.fragments.visible)for(let i=0;i<this.fragments.count;i++){
      const n=this.fragmentNormals[i],travel=age*(1.05+(i%11)*.1)+age*age*.025;
      this.fragments.setMatrixAt(i,radialPose(...n,radius,travel,age*((i%7)-3)*.12));
    }
    this.crackMesh.visible=t>=scene.impactTime&&t<scene.breakupTime;
    if(this.crackMesh.visible)for(let i=0;i<this.crackMesh.count;i++){
      const c=this.cracks[i],show=sample.crack>=c.reveal;
      this.crackMesh.setMatrixAt(i,show?pose(...c.position,.025,c.length,.025,...c.rotation):pose(0,0,-CONTRACT.camera.far*2,1,1,1));
    }
    this.impact!.visible=t>=scene.impactTime&&t<scene.breakupTime;
    const wound=Math.max(.08,Math.min(.75,(t-scene.impactTime)*.12));this.impact!.scale.set(wound,wound,wound);
    this.weaponGlow!.visible=t>=scene.countdownStart&&t<scene.impactTime;
    const charge=.1+sample.weaponCharge*1.3;this.weaponGlow!.scale.set(charge,charge,charge);
    const glow=this.weaponGlow!.material as PBRMaterial;glow.emissive[0]=2+sample.weaponCharge*4;glow.emissive[1]=4+sample.weaponCharge*8;glow.emissive[2]=7+sample.weaponCharge*13;
    this.beam!.visible=t>=scene.impactTime&&t<scene.impactTime+1.5;
    const w=scene.weaponPosition,[ix,iy,iz]=this.impactPosition,dx=ix-w[0],dy=iy-w[1],dz=iz-w[2],distance=Math.hypot(dx,dy,dz);
    this.beam!.position.set((w[0]+ix)/2,(w[1]+iy)/2,(w[2]+iz)/2);this.beam!.scale.set(.22,.22,distance);this.beam!.rotation.setFromEuler(-Math.asin(dy/distance),Math.atan2(dx,dz),0);
    this.core!.visible=age>0&&t<scene.aftermathTime+3;
    const peak=Math.max(0,1-Math.abs(t-scene.peakTime)/4),coreScale=age>0?1+peak*5:0;
    this.core!.scale.set(coreScale,coreScale,coreScale);
    const core=this.core!.material as PBRMaterial;core.emissive[0]=peak*18;core.emissive[1]=peak*10;core.emissive[2]=peak*4;
    this.shock!.visible=age>0&&age<7;const shockRadius=radius+age*4;this.shock!.scale.set(shockRadius,shockRadius,shockRadius);
    this.lightLine!.visible=t>=scene.aftermathTime;this.lightLine!.scale.set(10+age*1.2,.035,.035);
    const line=this.lightLine!.material as PBRMaterial;line.emissive[0]=Math.max(.2,1.5-age*.12);line.emissive[1]=line.emissive[0]*.6;
    this.shield!.visible=false;
    for(let i=0;i<EVENTS.length;i++){
      const event=EVENTS[i],dt=t-event.t,flash=this.flashes[i];
      flash.visible=!sample.quiet&&dt>=0&&dt<.65&&event.kind!=='break';flash.position.set(...event.position);
      if(event.kind==='fire') {flash.scale.set(.025,.025,2.5);flash.rotation.setFromEuler(.2,dt*2+i,0);}
      else {const size=Math.max(.025,(1-dt/.65)*.65);flash.scale.set(size,size,size);}
      if(event.kind==='shield'&&dt>=0&&dt<1.2&&!sample.quiet){this.shield!.visible=true;this.shield!.position.set(...event.position);const size=1+dt*1.8;this.shield!.scale.set(size,size*.7,size);}
    }
    for(let i=0;i<this.debris.count;i++){
      const event=this.kills[i%this.kills.length];
      if(!event||t<event.t){this.debris.setMatrixAt(i,pose(0,0,-CONTRACT.camera.far*2,1,1,1));continue;}
      const dt=t-event.t,sw=Math.max(0,age-2),angle=i*2.4;
      this.debris.setMatrixAt(i,pose(event.position[0]+Math.cos(angle)*(dt*.18+sw*2),event.position[1]+Math.sin(angle)*dt*.12,event.position[2]+dt*.12+sw, .1,.16,.25,dt*.6+i,dt*.3,dt*.2));
    }
    for(const layer of this.particleLayers)layer.sampleTime=t;
  }

  reset():void { this.clock.reset();for(const layer of this.particleLayers)layer.sampleTime=0;this.apply(sampleShow(0)); }
  dispose():void { if(this.releaseDone)return;this.releaseDone=true;this.destroy(); }
  protected override onDestroy():void { this.releaseDone=true;this.releaseResources(); }
  private releaseResources():void {
    for(const layer of this.particleLayers)if(!layer.destroyed)layer.destroy();
    for(const geometry of this.geometries)this.renderer?.unloadGeometry(geometry);
    for(const texture of this.textures){this.renderer?.unloadTexture(texture);if(!texture.destroyed)texture.destroy();}
    this.textures.length=0;this.geometries.clear();
  }
}
