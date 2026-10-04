import { Geometry, GPUParticleEmitter3D, Group, Mesh, NativeMaterial3D, PBRMaterial, PointLight, Texture, Vector3, type Renderer } from 'xyz.js';
import { CONTRACT } from '../show/contract.ts';
import { noise, fbm, smooth } from './planet-noise.ts';

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

export interface Cataclysm {
  root: Group;
  light: PointLight;
  textures: Texture[];
  geometries: Geometry[];
  nativeMaterials: NativeMaterial3D[];
  /** Seconds since planetary release began; negative hides everything. */
  update(age: number): void;
  /** Hides the effects and installs a freshly prepared seeded dust emitter. */
  reset(): Promise<void>;
  /** Stops further emission and holds the dust. */
  freeze(): void;
  dispose(): void;
}

/** Molten core, expanding shock ring, horizon light line and seeded dust cloud. */
export async function createCataclysm(renderer: Renderer, white: Texture, peakAge: number): Promise<Cataclysm> {
  const root=new Group(),textures:Texture[]=[],geometries:Geometry[]=[],nativeMaterials:NativeMaterial3D[]=[];
  const light=new PointLight({position:[0,0,0],color:[1,.35,.08],intensity:0,range:40});
  const molten=await moltenCore();geometries.push(molten.geometry);textures.push(molten.texture);
  const core=root.add(new Mesh({geometry:molten.geometry,material:new PBRMaterial({texture:molten.texture,emissiveTexture:molten.texture,color:[.34,.19,.11],emissive:[2.4,1.3,.5],roughness:.94})}));
  const waveGeometry=shockRing();geometries.push(waveGeometry);
  const waveMaterial=new NativeMaterial3D({texture:white,color:[.42,.52,.61],transparent:true,deformationBounds:0,uniforms:[.14,0,0,0],
    wgsl:`fn xyzDeform(position:vec3f,normal:vec3f,uv:vec2f)->XYZVertex{return XYZVertex(position,normal);}
      fn xyzSurface(world:vec3f,normal:vec3f,uv:vec2f,texel:vec4f)->vec4f{let a=mesh.custom[0].x;return vec4f(texel.rgb*a,texel.a*a);}`,
    glsl:`#ifdef XYZ_VERTEX
      XYZVertex xyzDeform(vec3 position,vec3 normal,vec2 uv){return XYZVertex(position,normal);}
      #endif
      #if defined(XYZ_FRAGMENT) || defined(XYZ_SHADOW)
      vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){float a=xyzUniforms[0].x;return vec4(texel.rgb*a,texel.a*a);}
      #endif`});
  nativeMaterials.push(waveMaterial);
  const wave=root.add(new Mesh({geometry:waveGeometry,material:waveMaterial,castShadow:false,receiveShadow:false}));
  const lineGeometry=Geometry.sphere(1,16,8);geometries.push(lineGeometry);
  const lightLine=root.add(new Mesh({geometry:lineGeometry,material:new PBRMaterial({texture:white,color:[.65,.48,.29],emissive:[1,.5,.18]})}));
  lightLine.scale.set(7.5,.012,.012);
  const origins:Vector3[]=[];
  for(let i=0;i<16;i++){
    const y=1-2*(i+.5)/16,a=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y)*CONTRACT.visual.planetRadius;
    origins.push(new Vector3(Math.cos(a)*r,y*CONTRACT.visual.planetRadius,Math.sin(a)*r));
  }
  let dust:GPUParticleEmitter3D|undefined,emitted=false,destroyed=false;
  const hide=()=>{core.visible=wave.visible=lightLine.visible=false;light.intensity=0;};
  hide();
  const update=(age:number):void=>{
    if(age<0){hide();return;}
    const peak=Math.exp(-Math.pow((age-peakAge)/1.7,2));
    core.visible=age<5.5;const s=(1.2+peak*2.3)*(1-smooth(3,5.5,age));core.scale.set(s,s,s);
    const material=core.material as PBRMaterial;
    material.emissive[0]=1.3+peak*3;material.emissive[1]=.8+peak*1.8;material.emissive[2]=.3+peak*.7;
    light.intensity=30*peak;
    wave.visible=age<7;const r=CONTRACT.visual.planetRadius+age*4;wave.scale.set(r,r,r);wave.rotation.setFromEuler(.55,.14,0);
    waveMaterial.uniforms[0]=.14*(1-smooth(1,7,age));
    lightLine.visible=age>=6;
    if(!emitted&&dust){
      dust.resume();
      for(const origin of origins){dust.position.set(origin.x,origin.y,origin.z);dust.burst(CONTRACT.visual.dustCapacity/origins.length);}
      emitted=true;
    }
  };
  const install=async():Promise<void>=>{
    // clear() preserves native sequence; a new prepared emitter restores seeded replay.
    if(dust){root.remove(dust);dust.destroy();dust=undefined;}
    const next=new GPUParticleEmitter3D({capacity:CONTRACT.visual.dustCapacity,rate:0,
      seed:CONTRACT.seed,lifetime:10,space:'world',velocityMin:[-1.3,-1.3,-1.3],velocityMax:[1.3,1.3,1.3],
      startColor:[.23,.2,.18,.018],endColor:[.12,.14,.16,0],startSize:.7,endSize:3.2});
    next.stop();next.pause();
    if(!renderer.prepareGpuParticles)throw new Error('渲染器不支援 GPU 粒子預載');
    await renderer.prepareGpuParticles(next);
    if(destroyed){next.destroy();return;}
    dust=root.add(next);emitted=false;
  };
  await install();
  return {root,light,textures,geometries,nativeMaterials,update,
    async reset(){hide();await install();},
    freeze(){dust?.pause();},
    dispose(){destroyed=true;dust?.destroy();dust=undefined;light.intensity=0;}};
}
