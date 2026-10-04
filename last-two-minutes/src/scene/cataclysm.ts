import { Geometry, Group, InstancedMesh, Mesh, NativeMaterial3D, PBRMaterial, PointLight, Texture } from 'xyz.js';
import type { Renderer } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract.ts';
import { noise, fbm, smooth } from './planet-noise.ts';
import { pose } from './geometry.ts';

function rock(segments:number,rings:number,seed:number,relief:number):Geometry {
  const source=Geometry.sphere(1,segments,rings),positions:number[]=[],normals:number[]=[],uvs:number[]=[];
  for(let i=0;i<source.vertices.length;i+=8){
    const x=source.vertices[i]!,y=source.vertices[i+1]!,z=source.vertices[i+2]!;
    const r=1+relief*(fbm(x*4+seed,y*4,z*4,3)-.5);
    positions.push(x*r,y*r,z*r);normals.push(x,y,z);uvs.push(source.vertices[i+6]!,source.vertices[i+7]!);
  }
  return new Geometry({positions,normals,uvs,indices:source.indices});
}

async function crustTexture():Promise<Texture> {
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const context=canvas.getContext('2d');if(!context)throw new Error('無法建立核心紋理');
  const image=context.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const a=x/canvas.width*Math.PI*2,b=y/(canvas.height-1)*Math.PI;
    const px=Math.cos(a)*Math.sin(b),py=Math.cos(b),pz=Math.sin(a)*Math.sin(b);
    const field=fbm(px*13+4,py*13-17,pz*13+8,4),vein=Math.pow(1-Math.abs(field*2-1),8);
    const grit=noise(px*95,py*95,pz*95),k=(y*canvas.width+x)*4;
    image.data[k]=12+grit*19+vein*235;image.data[k+1]=10+grit*14+vein*163;
    image.data[k+2]=9+grit*11+vein*77;image.data[k+3]=255;
  }
  context.putImageData(image,0,0);return Texture.fromImage(canvas);
}

async function dustTexture():Promise<Texture> {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const context=canvas.getContext('2d');if(!context)throw new Error('無法建立塵氣紋理');
  const image=context.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const a=x/canvas.width*Math.PI*2,b=y/(canvas.height-1)*Math.PI,s=Math.sin(b);
    const density=fbm(Math.cos(a)*s*7+31,Math.cos(b)*7-12,Math.sin(a)*s*7+13,5),k=(y*canvas.width+x)*4;
    image.data[k]=image.data[k+1]=image.data[k+2]=255;
    image.data[k+3]=255*smooth(.2,.72,density);
  }
  context.putImageData(image,0,0);return Texture.fromImage(canvas);
}

/** Alpha-blended density skins with approximate inverse-square interior illumination. */
function gas(texture:Texture,tint:[number,number,number],seed:number):NativeMaterial3D {
  return new NativeMaterial3D({texture,color:tint,transparent:true,deformationBounds:0,uniforms:[0,seed,0,0],
    wgsl:`fn xyzDeform(position:vec3f,normal:vec3f,uv:vec2f)->XYZVertex{return XYZVertex(position,normal);}
      fn xyzSurface(world:vec3f,normal:vec3f,uv:vec2f,texel:vec4f)->vec4f{
        let p=uv*vec2f(9.0,7.0);let s=mesh.custom[0].y;
        let n=texel.a*(0.8+0.2*sin(p.x+s+2.0*sin(p.y*0.7)));
        let mu=max(dot(normalize(normal),normalize(scene.camera.xyz-world)),0.0);
        let density=mix(mu,exp(-mu*mu*80.0),mesh.custom[0].z)*smoothstep(0.0,0.13,mu);
        let a=mesh.custom[0].x*smoothstep(0.17,0.72,n)*pow(sin(uv.y*3.14159265),2.0)*density;
        let heat=mesh.custom[0].w/(1.0+dot(world,world)*0.018);
        return vec4f((texel.rgb+heat*vec3f(1.0,0.32,0.045))*a,texel.a*a);}`,
    glsl:`#ifdef XYZ_VERTEX
      XYZVertex xyzDeform(vec3 position,vec3 normal,vec2 uv){return XYZVertex(position,normal);}
      #endif
      #if defined(XYZ_FRAGMENT)
      vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){
        vec2 p=uv*vec2(9.0,7.0);float s=xyzUniforms[0].y;
        float n=texel.a*(0.8+0.2*sin(p.x+s+2.0*sin(p.y*0.7)));
        float mu=max(dot(normalize(normal),normalize(cameraPosition-world)),0.0);
        float density=mix(mu,exp(-mu*mu*80.0),xyzUniforms[0].z)*smoothstep(0.0,0.13,mu);
        float a=xyzUniforms[0].x*smoothstep(0.17,0.72,n)*pow(sin(uv.y*3.14159265),2.0)*density;
        float heat=xyzUniforms[0].w/(1.0+dot(world,world)*0.018);
        return vec4((texel.rgb+heat*vec3(1.0,0.32,0.045))*a,texel.a*a);}
      #elif defined(XYZ_SHADOW)
      vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){return vec4(0.0);}
      #endif`});
}

export interface Cataclysm {
  root:Group;light:PointLight;textures:Texture[];geometries:Geometry[];nativeMaterials:NativeMaterial3D[];
  /** Release-relative age; impact begins at -15. Ages below -15 hide all effects. */
  update(age:number):void;
  reset():Promise<void>;
  freeze():void;
  dispose():void;
}

/** Analytic trajectories permit exact seeks and replay without native particle clocks. */
export async function createCataclysm(_renderer:Renderer,white:Texture,peakAge:number):Promise<Cataclysm> {
  const root=new Group(),textures:Texture[]=[],geometries:Geometry[]=[],nativeMaterials:NativeMaterial3D[]=[];
  const light=new PointLight({position:[0,0,0],color:[1,.35,.08],intensity:0,range:40});
  const texture=await crustTexture(),gasTexture=await dustTexture();textures.push(texture,gasTexture);
  const coreGeometry=rock(64,40,31,.24),rockGeometry=rock(10,6,71,.75),shellGeometry=rock(32,20,17,.15),frontGeometry=rock(64,40,17,.025);
  geometries.push(coreGeometry,rockGeometry,shellGeometry,frontGeometry);
  const coreMaterial=new PBRMaterial({texture,emissiveTexture:texture,color:[.21,.19,.17],emissive:[1,.3,.04],roughness:.96,alphaMode:'OPAQUE'});
  const core=root.add(new Mesh({geometry:coreGeometry,material:coreMaterial,castShadow:false}));
  const random=seededRandom(CONTRACT.seed+739),dummy=new Group();dummy.rotation.setFromEuler(-.06,.18,0);
  const direction=CONTRACT.visual.damageDirection,dn=Math.hypot(...direction),q=dummy.rotation;
  const x=direction[0]/dn,y=direction[1]/dn,z=direction[2]/dn,tx=2*(q.y*z-q.z*y),ty=2*(q.z*x-q.x*z),tz=2*(q.x*y-q.y*x);
  const nx=x+q.w*tx+q.y*tz-q.z*ty,ny=y+q.w*ty+q.z*tx-q.x*tz,nz=z+q.w*tz+q.x*ty-q.y*tx;
  const al=Math.hypot(nz,nx),ax=nz/al,az=-nx/al,bx=ny*az,by=nz*ax-nx*az,bz=-ny*ax;
  const ejecta=Array.from({length:192},()=>({delay:random()*2.8,v:1.1+random()*3.2,u:(random()-.5)*1.6,w:(random()-.5)*1.6,size:.035+Math.pow(random(),3)*.3,spin:random()*5}));
  const debris=Array.from({length:288},(_,i)=>{const dy=1-2*(i+.5)/288,a=i*2.39996323,r=Math.sqrt(1-dy*dy);return {x:Math.cos(a)*r,y:dy,z:Math.sin(a)*r,v:.45+random()*1.7,size:.04+Math.pow(random(),3)*.48,spin:random()*4,drift:random()-.5};});
  const makeBatch=()=>{const material=new PBRMaterial({texture,emissiveTexture:texture,color:[.35,.31,.27],emissive:[0,0,0],roughness:.98,alphaMode:'OPAQUE'});return {material,mesh:root.add(new InstancedMesh({geometry:rockGeometry,material,count:96,castShadow:false}))};};
  const spatter=[makeBatch(),makeBatch()],stones=[makeBatch(),makeBatch(),makeBatch()];
  const clouds=Array.from({length:6},(_,i)=>{const material=gas(gasTexture,[.37,.34,.31],(i*2+.5)*2.7);nativeMaterials.push(material);return {material,mesh:root.add(new Mesh({geometry:shellGeometry,material,castShadow:false,receiveShadow:false}))};});
  const plume=Array.from({length:8},(_,i)=>{const material=gas(gasTexture,[.55,.47,.36],i*3.1);nativeMaterials.push(material);return {material,mesh:root.add(new Mesh({geometry:shellGeometry,material,castShadow:false,receiveShadow:false}))};});
  const frontMaterial=gas(white,[.34,.38,.4],12);frontMaterial.uniforms[2]=1;nativeMaterials.push(frontMaterial);
  const front=root.add(new Mesh({geometry:frontGeometry,material:frontMaterial,castShadow:false,receiveShadow:false}));
  let destroyed=false;
  const hide=()=>{root.visible=false;light.intensity=0;};hide();
  const cooling=(m:PBRMaterial,t:number,weight=1)=>{const age=Math.max(0,t),heat=weight*Math.exp(-age*.46);m.emissive[0]=heat*4.2;m.emissive[1]=heat*Math.exp(-age*.55)*3.1;m.emissive[2]=heat*Math.exp(-age*1.05)*1.7;};
  const update=(age:number):void=>{
    if(destroyed||age<CONTRACT.scene.impactTime-CONTRACT.scene.breakupTime){hide();return;}
    root.visible=true;const impact=age+CONTRACT.scene.breakupTime-CONTRACT.scene.impactTime;
    for(let b=0;b<spatter.length;b++){
      const batch=spatter[b]!;batch.mesh.visible=impact<10;cooling(batch.material,Math.max(0,impact-1)+b*.6);
      if(!batch.mesh.visible)continue;
      for(let j=0;j<96;j++){const e=ejecta[b*96+j]!,t=Math.max(0,impact-e.delay),along=e.v*t-.15*t*t;
        const active=impact>=e.delay&&t<7,s=active?e.size:.01;
        batch.mesh.setMatrixAt(j,pose(nx*(10+along)+ax*e.u*t+bx*e.w*t,ny*(10+along)+by*e.w*t,nz*(10+along)+az*e.u*t+bz*e.w*t,s,s*.7,s*1.3,e.spin*t,e.spin*.7*t,e.spin*.4*t));}
    }
    for(let i=0;i<plume.length;i++){
      const p=plume[i]!,travel=impact*.9-i*.32,present=travel>0&&impact<11;
      p.mesh.visible=present;const distance=10+Math.max(0,travel),width=.3+Math.max(0,travel)*.27;
      p.mesh.position.set(nx*distance,ny*distance,nz*distance);p.mesh.scale.set(width,width*1.15,width);
      p.material.uniforms[0]=.42*Math.exp(-impact*.2)*(1-smooth(6,11,impact));p.material.uniforms[3]=5*Math.exp(-impact*.8);
    }
    core.visible=age>=0&&age<9;const cs=(7.3+smooth(0,peakAge,age)*.6)*(1-smooth(4,9,age));core.scale.set(cs,cs*.97,cs);cooling(coreMaterial,Math.max(0,age-.25),2.4);
    light.position.set(age<0?nx*9:0,age<0?ny*9:0,age<0?nz*9:0);light.intensity=age<0?12*Math.exp(-impact*.6):28*Math.exp(-age*.65);
    for(let b=0;b<stones.length;b++){
      const batch=stones[b]!;batch.mesh.visible=age>=0;cooling(batch.material,age*(b===2 ? .55 : 1)+b*.5,b===2 ? .5 : .9);
      if(!batch.mesh.visible)continue;
      for(let j=0;j<96;j++){const e=debris[b*96+j]!,t=Math.max(0,age),r=5.5+e.v*t;
        const splinter=j%5===0,wedge=j%5===1;
        batch.mesh.setMatrixAt(j,pose(e.x*r+e.drift*t*.3,e.y*r,e.z*r,e.size*(splinter ? .3 : 1),e.size*(wedge ? .9 : .65),e.size*(splinter?3:1.25),e.spin*t*.2,e.spin*t*.3,e.spin*t*.1));}
    }
    for(let i=0;i<clouds.length;i++){
      const c=clouds[i]!,layer=i*2+.5;c.mesh.visible=age>=0;const r=6.8+layer*.42+Math.max(0,age)*(.72+layer*.025);
      c.mesh.scale.set(r,r*(.86+layer*.018),r);c.mesh.rotation.setFromEuler(layer*.47,layer*.83,layer*.21);
      c.material.uniforms[0]=.163*smooth(0,.4,age)*(1-smooth(5,12,age));c.material.uniforms[3]=6*Math.exp(-Math.max(0,age)*.65);
    }
    const waveAge=age-(CONTRACT.scene.peakTime-CONTRACT.scene.breakupTime);front.visible=waveAge>=0&&waveAge<5;
    const radius=10+Math.max(0,waveAge)*4;front.scale.set(radius,radius,radius);frontMaterial.uniforms[0]=.12*(1-smooth(0,5,waveAge));
  };
  return {root,light,textures,geometries,nativeMaterials,update,async reset(){hide();},freeze(){/* Analytic state only advances through update(). */},dispose(){destroyed=true;hide();}};
}
