import { Decal, Geometry, Group, InstancedMesh, Mesh, NativeMaterial3D, Object3D, PBRMaterial, PointLight, Texture } from 'xyz.js';
import { CONTRACT } from '../show/contract.ts';
import { COMBAT_SCRIPT, sampleCombatGun, sampleCombatProjectile, sampleCombatShip } from '../show/combat.ts';
import type { CombatScript } from '../show/combat.ts';
import { createShipModel } from './ship-model.ts';
import type { ShipModel } from './ship-model.ts';

type Triple = [number, number, number];
export interface CombatModel {
  root: Group;
  textures: Texture[];
  geometries: Geometry[];
  nativeMaterials: NativeMaterial3D[];
  lights: PointLight[];
  /** `shock` is seconds since the planetary shockwave began pushing ships away. */
  update(time: number, shock?: number): void;
  reset(): void;
  dispose(): void;
}

/** Faceted radial profiles supply tapered bolts, torn plates, gas lobes and impact rings. */
function radialGeometry(profile: readonly (readonly [number, number])[], segments: number, irregular = false, flatten = 1, planar = false): Geometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let r = 0; r < profile.length - 1; r++) for (let i = 0; i < segments; i++) {
    const corners: Triple[] = [];
    for (const [row, column] of [[r,i],[r,i+1],[r+1,i+1],[r+1,i]]) {
      const a = column / segments * Math.PI * 2;
      const radius = profile[row][1] * (irregular ? .76 + .24 * Math.sin(column * 2.7 + .8) : 1);
      corners.push([Math.cos(a)*radius,Math.sin(a)*radius*flatten,profile[row][0]]);
    }
    const a=corners[0],b=corners[1],c=corners[2],d=corners[3];
    let nx=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
    let ny=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    let nz=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    let length=Math.hypot(nx,ny,nz);
    // A zero-radius cap collapses the first triangle, not the second.
    if(length<1e-8){
      nx=(c[1]-a[1])*(d[2]-a[2])-(c[2]-a[2])*(d[1]-a[1]);
      ny=(c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2]);
      nz=(c[0]-a[0])*(d[1]-a[1])-(c[1]-a[1])*(d[0]-a[0]);
      length=Math.hypot(nx,ny,nz);
    }
    const start=positions.length/3;
    for(let k=0;k<4;k++){positions.push(...corners[k]);normals.push(nx/length,ny/length,nz/length);uvs.push(planar?corners[k][0]*.5+.5:k===1||k===2?1:0,planar?corners[k][1]*.5+.5:k>=2?1:0);}
    indices.push(start,start+1,start+2,start,start+2,start+3);
  }
  return new Geometry({positions,normals,uvs,indices});
}

/** Bevelled polygonal deck sections keep a blade-like side silhouette, including a blunt stern. */
function bladeGeometry(rows: readonly (readonly [number,number,number])[]): Geometry {
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  const ring=(z:number,w:number,h:number):Triple[]=>[[-w,h*.55,z],[-w*.65,h,z],[w*.65,h,z],[w,h*.55,z],[w,-h*.55,z],[w*.65,-h,z],[-w*.65,-h,z],[-w,-h*.55,z]];
  for(let r=0;r<rows.length-1;r++){
    const a=ring(...rows[r]),b=ring(...rows[r+1]);
    for(let i=0;i<8;i++){
      const corners=[a[(i+1)%8],a[i],b[i],b[(i+1)%8]],p=corners[0],q=corners[1],s=corners[2];
      let nx=(q[1]-p[1])*(s[2]-p[2])-(q[2]-p[2])*(s[1]-p[1]),ny=(q[2]-p[2])*(s[0]-p[0])-(q[0]-p[0])*(s[2]-p[2]),nz=(q[0]-p[0])*(s[1]-p[1])-(q[1]-p[1])*(s[0]-p[0]);
      const length=Math.hypot(nx,ny,nz)||1,start=positions.length/3;
      nx/=length;ny/=length;nz/=length;
      for(let k=0;k<4;k++){positions.push(...corners[k]);normals.push(nx,ny,nz);uvs.push((i+(k===1||k===2?1:0))/8,(r+(k>=2?1:0))/(rows.length-1));}
      indices.push(start,start+1,start+2,start,start+2,start+3);
    }
  }
  return new Geometry({positions,normals,uvs,indices});
}

/** A -Z profile is aimed without allocating temporary vectors or quaternions. */
function aim(mesh: Object3D, x: number, y: number, z: number): void {
  const length=Math.hypot(x,y,z)||1,dx=x/length,dy=y/length,dz=z/length;
  // Quaternion rotating -Z onto the direction. Handle the antiparallel singularity.
  if(dz>.999999) mesh.rotation.set(0,1,0,0);
  else mesh.rotation.set(dy,-dx,0,1-dz).normalize();
}

export async function createCombatModel(source: ShipModel, script: CombatScript = COMBAT_SCRIPT): Promise<CombatModel> {
  const root=new Group();
  const textures=source.textures,geometries:Geometry[]=[],nativeMaterials:NativeMaterial3D[]=[],lights:PointLight[]=[];
  const white=textures[4];
  const [cruiser,frigate]=await Promise.all([createShipModel('cruiser',textures),createShipModel('frigate',textures)]);
  geometries.push(...cruiser.geometries,...frigate.geometries);
  const ships: ShipModel[]=script.ships.map((definition,index)=>{
    const template=definition.scale>=.65?source:index%2?frigate:cruiser;
    const nodes=new Map<Object3D,Object3D>(),materials=new Map<PBRMaterial,PBRMaterial>();
    const clone=(node:Object3D):Object3D=>{
      let copy:Object3D;
      if(node instanceof Mesh && node.material instanceof PBRMaterial){
        const original=node.material;
        let material=materials.get(original);
        if(!material){
          const c=original.color,attacker=definition.side==='attacker';
          material=new PBRMaterial({texture:original.texture,color:[c[0]*(attacker?1:.84),c[1]*(attacker?.73:.97),c[2]*(attacker?.57:1)],normalTexture:original.normalTexture,normalScale:original.normalScale,metallicRoughnessTexture:original.metallicRoughnessTexture,occlusionTexture:original.occlusionTexture,occlusionStrength:original.occlusionStrength,emissiveTexture:original.emissiveTexture,emissive:[...original.emissive],roughness:original.roughness,metallic:original.metallic,alphaMode:original.alphaMode,transparent:original.transparent,opacity:original.opacity,doubleSided:original.doubleSided,textureSampler:original.textureSampler,normalSampler:original.normalSampler,metallicRoughnessSampler:original.metallicRoughnessSampler,occlusionSampler:original.occlusionSampler});
          materials.set(original,material);
        }
        copy=new Mesh({geometry:node.geometry,material,castShadow:index<4&&node.castShadow,receiveShadow:node.receiveShadow});
      } else copy=new Group();
      copy.position.copy(node.position);copy.rotation.copy(node.rotation);copy.scale.copy(node.scale);copy.visible=node.visible;
      nodes.set(node,copy);
      for(const child of node.children)copy.add(clone(child));
      return copy;
    };
    const hull=clone(template.root) as Group;root.add(hull);
    return {root:hull,textures,geometries:template.geometries,engines:template.engines.map(mesh=>nodes.get(mesh) as Mesh),turrets:template.turrets.map(t=>({root:nodes.get(t.root) as Group,barrels:nodes.get(t.barrels) as Group,muzzles:t.muzzles}))};
  });
  const boltGeometry=radialGeometry([[0,0],[.1,.065],[.3,.052],[2.1,0]],8);
  const flashGeometry=radialGeometry([[-.34,0],[-.09,.14],[0,.045],[.04,0]],9,true);
  const shieldRingGeometry=radialGeometry([[0,.86],[0,1]],48);
  const plateGeometry=radialGeometry([[-.06,0],[-.06,1],[.045,.82],[.045,0]],7,true);
  const gasGeometry=Geometry.sphere(1,24,16);
  geometries.push(boltGeometry,flashGeometry,shieldRingGeometry,plateGeometry,gasGeometry);
  const escortGeometry=bladeGeometry([[-5.6,.025,.055],[-4.2,.32,.22],[-1.5,.7,.34],[2.9,.75,.38],[4.2,.68,.32],[4.21,.025,.055]]);
  const deckGeometry=bladeGeometry([[-1.6,.12,.12],[-.9,.33,.42],[1.2,.37,.5],[2.1,.3,.34],[2.11,.03,.055]]);
  const sectionGeometry=bladeGeometry([[-1.1,.72,.31],[-.95,.93,.36],[.85,1.03,.38],[1.05,.78,.33]]);
  geometries.push(escortGeometry,deckGeometry,sectionGeometry);
  const escorts=script.escorts??[],scratch=new Object3D();
  const screens=[escortGeometry,deckGeometry].map((geometry,i)=>root.add(new InstancedMesh({
    geometry,count:Math.max(1,escorts.length),material:new PBRMaterial({texture:textures[0],normalTexture:textures[1],color:i?[.25,.3,.31]:[.53,.57,.56],roughness:.85,metallic:.42,alphaMode:'OPAQUE'}),castShadow:false,receiveShadow:true,
  })));
  const outriggers=root.add(new InstancedMesh({geometry:escortGeometry,count:Math.max(1,escorts.length*2),material:new PBRMaterial({texture:textures[0],normalTexture:textures[1],color:[.25,.29,.3],roughness:.86,metallic:.5,alphaMode:'OPAQUE'}),castShadow:false}));
  outriggers.visible=escorts.length>0;
  const exhaustGeometry=radialGeometry([[0,.035],[.17,.075],[.95,0]],8);
  geometries.push(exhaustGeometry);
  const exhaust=root.add(new InstancedMesh({geometry:exhaustGeometry,count:Math.max(1,escorts.length*3),material:new PBRMaterial({texture:white,color:[.3,.48,.58],emissive:[.28,.6,.85],roughness:1,metallic:0,alphaMode:'OPAQUE'}),castShadow:false,receiveShadow:false}));
  exhaust.visible=escorts.length>0;
  for(const screen of screens)screen.visible=escorts.length>0;
  for(let i=0;i<escorts.length;i++)for(const screen of screens){
    const attacker=escorts[i].side==='attacker';screen.setColorAt(i,attacker?1:.83,attacker?.78:1,attacker?.6:1);
  }
  const canvas=document.createElement('canvas');canvas.width=canvas.height=Math.min(256,CONTRACT.visual.textureSize);
  const ctx=canvas.getContext('2d')!,image=ctx.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
    const dx=(x+.5)/canvas.width*2-1,dy=(y+.5)/canvas.height*2-1,r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
    const edge=.77+.1*Math.sin(a*7)+.06*Math.sin(a*13),alpha=Math.max(0,Math.min(1,(edge-r)*5));
    const soot=13+Math.sin(x*1.2+y*.83)*4,k=(y*canvas.width+x)*4;
    image.data[k]=soot;image.data[k+1]=soot*.83;image.data[k+2]=soot*.72;image.data[k+3]=alpha*220;
  }
  ctx.putImageData(image,0,0);const scorchTexture=await Texture.fromImage(canvas);
  const projectileMaterials=([ [.28,.75,1],[1,.36,.12] ] as Triple[]).map(color=>new PBRMaterial({texture:white,color,emissive:[color[0]*2,color[1]*2,color[2]*2],roughness:1,metallic:0,alphaMode:'OPAQUE'}));
  const shieldLife=.55,flashLife=.1;
  // Interval-coloured slots cover concurrent flights and contacts, not the entire script.
  // Fixed assignments plus a cleared pool make arbitrary seeks independent of playback history.
  const slotEnds:number[][]=[[],[]];
  const shieldEffects=script.shots.filter(shot=>shot.result==='shield').sort((a,b)=>a.fireTime-b.fireTime).map(shot=>{
    const faction=script.ships[shot.source].side==='attacker'?1:0,ends=slotEnds[faction];
    let slot=0;
    while(slot<ends.length&&ends[slot]>shot.fireTime)slot++;
    ends[slot]=Math.max(shot.hitTime+shieldLife,shot.fireTime+flashLife);
    const dx=shot.end[0]-shot.start[0],dy=shot.end[1]-shot.start[1],dz=shot.end[2]-shot.start[2];
    return {shot,faction,slot,dx,dy,dz,speed:Math.hypot(dx,dy,dz)/(shot.hitTime-shot.fireTime)};
  });
  const shieldPools=slotEnds.map((ends,faction)=>{
    const count=Math.max(1,ends.length),material=projectileMaterials[faction];
    const projectile=root.add(new InstancedMesh({geometry:boltGeometry,count,material,castShadow:false,receiveShadow:false}));
    const flash=root.add(new InstancedMesh({geometry:flashGeometry,count,material,castShadow:false,receiveShadow:false}));
    const ripple=root.add(new InstancedMesh({geometry:shieldRingGeometry,count,material:new PBRMaterial({texture:white,color:[1,1,1],emissive:faction?[2,.72,.24]:[.56,1.5,2],roughness:1,metallic:0,alphaMode:'OPAQUE',doubleSided:true}),castShadow:false,receiveShadow:false}));
    for(let slot=0;slot<count;slot++){flash.setColorAt(slot,1,1,1);ripple.setColorAt(slot,1,1,1);}
    return {projectile,flash,ripple,count,active:false};
  });
  // Uniform alpha is explicit: TextureMaterial opacity is readonly in this engine.
  const fadingMaterial=(color:Triple,label:string,kind:number):NativeMaterial3D=>{
    const material=new NativeMaterial3D({texture:white,color,transparent:true,uniforms:[0,0,kind,0],deformationBounds:0,label,
      wgsl:`fn combatHash(p:vec3f)->f32{return fract(sin(dot(p,vec3f(127.1,311.7,74.7)))*43758.5453);}
fn combatNoise(p:vec3f)->f32{
  let i=floor(p);let f=fract(p);let u=f*f*(vec3f(3.0)-2.0*f);
  return mix(mix(mix(combatHash(i),combatHash(i+vec3f(1,0,0)),u.x),
    mix(combatHash(i+vec3f(0,1,0)),combatHash(i+vec3f(1,1,0)),u.x),u.y),
    mix(mix(combatHash(i+vec3f(0,0,1)),combatHash(i+vec3f(1,0,1)),u.x),
    mix(combatHash(i+vec3f(0,1,1)),combatHash(i+vec3f(1,1,1)),u.x),u.y),u.z);
}
fn xyzDeform(position:vec3f,normal:vec3f,uv:vec2f)->XYZVertex{return XYZVertex(position,normal);}
fn xyzSurface(world:vec3f,normal:vec3f,uv:vec2f,texel:vec4f)->vec4f{
  var a=mesh.custom[0].x*texel.a;var color=texel.rgb;
    let age=mesh.custom[0].y;
    let p=world*12.0+vec3f(age*0.6,-age*1.2,age*0.5);
    let field=combatNoise(p)*0.65+combatNoise(p*2.07+vec3f(9.3))*0.35;
    let edge=pow(abs(dot(normalize(normal),normalize(scene.camera.xyz-world))),0.8);
    a*=edge*smoothstep(0.16,0.76,field);
    if(mesh.custom[0].z<1.5){color=mix(vec3f(1.0,0.13,0.018),vec3f(4.0,1.55,0.32),field);}
  return vec4f(color*a,a);
}`,
      glsl:`float combatHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float combatNoise(vec3 p){
  vec3 i=floor(p),f=fract(p),u=f*f*(vec3(3.0)-2.0*f);
  return mix(mix(mix(combatHash(i),combatHash(i+vec3(1,0,0)),u.x),
    mix(combatHash(i+vec3(0,1,0)),combatHash(i+vec3(1,1,0)),u.x),u.y),
    mix(mix(combatHash(i+vec3(0,0,1)),combatHash(i+vec3(1,0,1)),u.x),
    mix(combatHash(i+vec3(0,1,1)),combatHash(i+vec3(1,1,1)),u.x),u.y),u.z);
}
#ifdef XYZ_VERTEX
XYZVertex xyzDeform(vec3 position,vec3 normal,vec2 uv){return XYZVertex(position,normal);}
#endif
#if defined(XYZ_FRAGMENT) || defined(XYZ_SHADOW)
vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){
  float a=xyzUniforms[0].x*texel.a;vec3 color=texel.rgb;
  #ifdef XYZ_FRAGMENT
    float age=xyzUniforms[0].y;
    vec3 p=world*12.0+vec3(age*0.6,-age*1.2,age*0.5);
    float field=combatNoise(p)*0.65+combatNoise(p*2.07+vec3(9.3))*0.35;
    float edge=pow(abs(dot(normalize(normal),normalize(cameraPosition-world))),0.8);
    a*=edge*smoothstep(0.16,0.76,field);
    if(xyzUniforms[0].z<1.5)color=mix(vec3(1.0,0.13,0.018),vec3(4.0,1.55,0.32),field);
  #endif
  return vec4(color*a,a);
}
#endif`});
    nativeMaterials.push(material);return material;
  };
  const effects=script.shots.filter(shot=>shot.result!=='shield').map((shot,index)=>{
    const faction=script.ships[shot.source].side==='attacker'?1:0;
    const projectile=root.add(new Mesh({geometry:boltGeometry,material:projectileMaterials[faction],castShadow:false,receiveShadow:false}));
    const flash=root.add(new Mesh({geometry:flashGeometry,material:projectileMaterials[faction],castShadow:false,receiveShadow:false}));
    const direction:Triple=[shot.end[0]-shot.start[0],shot.end[1]-shot.start[1],shot.end[2]-shot.start[2]];
    const defence=root.add(new Mesh({geometry:boltGeometry,material:projectileMaterials[1-faction],castShadow:false,receiveShadow:false}));
    aim(projectile,...direction);aim(flash,...direction);
    const hitPose={x:0,y:0,z:0,yaw:0,scale:1,destroyed:false};
    sampleCombatShip(shot.target,shot.hitTime,hitPose,script);
    const c=Math.cos(hitPose.yaw),s=Math.sin(hitPose.yaw);
    const local:Triple=[...shot.local];
    // Contact normals are authored in the target hull's frame (armor slope or shield bubble).
    const localNormal:Triple=[...shot.normal];
    const normal:Triple=[c*localNormal[0]+s*localNormal[2],localNormal[1],-s*localNormal[0]+c*localNormal[2]];
    const contact=root.add(new Group());
    const receiver=[...ships[shot.target].root.children].find(node=>node instanceof Mesh&&node.material instanceof PBRMaterial&&node.material.color[0]>.5&&node.material.roughness>.7) as Mesh;
    const projector=new Object3D();aim(projector,-localNormal[0],-localNormal[1],-localNormal[2]);
    const scorch=new Decal({target:receiver,material:new PBRMaterial({texture:scorchTexture,color:[1,1,1],roughness:1,metallic:.05,alphaMode:'BLEND',transparent:true}),position:[...local],rotation:projector.rotation,size:[.82,.65,.5],normalOffset:.003,cullBackfaces:false,visible:false});
    geometries.push(scorch.geometry);
    const heat=new PBRMaterial({texture:white,color:[.18,.055,.018],emissive:[1,.22,.035],roughness:.8,metallic:.35,alphaMode:'OPAQUE'});
    const breach=contact.add(new Mesh({geometry:plateGeometry,material:heat,castShadow:false}));aim(breach,...localNormal);breach.scale.set(.2,.12,.2);breach.position.set(localNormal[0]*.023,localNormal[1]*.023,localNormal[2]*.023);
    const flameMaterial=fadingMaterial([1,.43,.08],`Fuel vent ${shot.id}`,1),gasMaterial=fadingMaterial([.2,.16,.12],`Expelled gas ${shot.id}`,2);
    const flames=Array.from({length:shot.result==='kill'?7:3},(_,i)=>{
      const mesh=contact.add(new Mesh({geometry:gasGeometry,material:flameMaterial,castShadow:false,receiveShadow:false}));
      if(shot.result==='kill'){
        const angle=i*2.399963,elevation=Math.sin(i*1.7+.4),radius=Math.sqrt(1-elevation*elevation);
        aim(mesh,Math.cos(angle)*radius,elevation,Math.sin(angle)*radius);
      }else aim(mesh,...localNormal);
      return mesh;
    });
    const gas=Array.from({length:shot.result==='kill'?5:2},()=>root.add(new Mesh({geometry:gasGeometry,material:gasMaterial,castShadow:false,receiveShadow:false})));
    const fragments=Array.from({length:shot.result==='kill'?24:6},(_,i)=>{
      const a=i*2.399963+index*.7,y=Math.sin(i*1.8+index),r=Math.sqrt(1-y*y);
      const velocity:Triple=[normal[0]*(.5+i%4*.23)+Math.cos(a)*r*(.6+i%5*.28),normal[1]*(.5+i%4*.23)+y*(.6+i%5*.28),normal[2]*(.5+i%4*.23)+Math.sin(a)*r*(.6+i%5*.28)];
      const material=new PBRMaterial({texture:textures[0],color:[.39,.38,.34],normalTexture:textures[1],roughness:.68,metallic:.8,emissive:[.5,.16,.025],alphaMode:'OPAQUE'});
      const section=shot.result==='kill'&&i<5,armorFragment=shot.result==='kill'&&i<13;
      const mesh=root.add(new Mesh({geometry:section?sectionGeometry:plateGeometry,material}));
      const lx=section?0:Math.cos(a)*1.2,lz=section?-4.3+i*1.9:-3.8+(i%12)*.68;
      const origin:Triple=armorFragment?[hitPose.x+(c*lx+s*lz)*hitPose.scale,hitPose.y+(section?0:y*.4)*hitPose.scale,hitPose.z+(-s*lx+c*lz)*hitPose.scale]:[...shot.end];
      const interior=section?mesh.add(new Mesh({geometry:plateGeometry,material:new PBRMaterial({texture:textures[0],color:[.075,.09,.1],roughness:.95,metallic:.65,emissive:[.11,.018,.002],alphaMode:'OPAQUE'})})):undefined;
      if(interior){interior.position.z=-1.115;interior.scale.set(.74,.27,.13);}
      return {mesh,material,velocity,origin,section,size:section?hitPose.scale:armorFragment?.16+(i%4)*.075:.012+(i%4)*.009,phase:a,yaw:hitPose.yaw};
    });
    const light=new PointLight({intensity:0,color:[1,.36,.08],range:3,priority:2});lights.push(light);
    return {shot,projectile,flash,defence,contact,scorch,breach,heat,flames,flameMaterial,gas,gasMaterial,fragments,light,normal,local,phase:-2};
  });
  const shipPose={x:0,y:0,z:0,yaw:0,scale:1,destroyed:false},gunPose={yaw:0,pitch:0,recoil:0},projectilePose={x:0,y:0,z:0,visible:false};
  const hideEffect=(effect:typeof effects[number]):void=>{
    effect.projectile.visible=effect.flash.visible=effect.defence.visible=effect.contact.visible=effect.scorch.visible=false;
    for(const gas of effect.gas)gas.visible=false;
    for(const fragment of effect.fragments)fragment.mesh.visible=false;
    effect.light.intensity=0;
  };
  const update=(time:number,shock=0):void=>{
    for(let i=0;i<escorts.length;i++){
      const escort=escorts[i],arrival=script.approach&&time<0?1-Math.max(0,Math.min(1,(time+script.approach.duration)/script.approach.duration))**2:0;
      scratch.position.set(escort.origin[0]+escort.velocity[0]*time+(escort.side==='attacker'?44:-44)*arrival,escort.origin[1],escort.origin[2]+escort.velocity[2]*time);
      const width=i%6===0?1.2:i%3===0?.78:1,length=i%6===0?1.25:i%3===0?1.4:1;
      scratch.rotation.setFromEuler(0,escort.yaw,0);scratch.scale.set(escort.scale*width,escort.scale,escort.scale*length);
      screens[0].setMatrixAt(i,scratch.updateWorldMatrix());
      scratch.position.y+=escort.scale*.64;screens[1].setMatrixAt(i,scratch.updateWorldMatrix());
      scratch.position.y-=escort.scale*.77;scratch.scale.set(escort.scale*.29,escort.scale*.6,escort.scale*.64*length);
      for(let side=0;side<2;side++){
        const offset=(side?1:-1)*escort.scale*.9;
        scratch.position.x+=Math.cos(escort.yaw)*offset;scratch.position.z-=Math.sin(escort.yaw)*offset;
        outriggers.setMatrixAt(i*2+side,scratch.updateWorldMatrix());
        scratch.position.x-=Math.cos(escort.yaw)*offset;scratch.position.z+=Math.sin(escort.yaw)*offset;
      }
      for(let nozzle=0;nozzle<3;nozzle++){
        const offset=(nozzle-1)*escort.scale*.4;
        scratch.position.set(escort.origin[0]+escort.velocity[0]*time+(escort.side==='attacker'?44:-44)*arrival+Math.sin(escort.yaw)*4.23*escort.scale*length+Math.cos(escort.yaw)*offset,escort.origin[1]-.05*escort.scale,escort.origin[2]+escort.velocity[2]*time+Math.cos(escort.yaw)*4.23*escort.scale*length-Math.sin(escort.yaw)*offset);
        scratch.scale.set(escort.scale,escort.scale,escort.scale*(1.4+.15*Math.sin(time*7+i)));
        exhaust.setMatrixAt(i*3+nozzle,scratch.updateWorldMatrix());
      }
    }
    for(let i=0;i<ships.length;i++){
      sampleCombatShip(i,time,shipPose,script,shock);const ship=ships[i];
      const death=script.kills.get(i);
      ship.root.position.set(shipPose.x,shipPose.y,shipPose.z);ship.root.rotation.setFromEuler(0,shipPose.yaw,0);ship.root.scale.set(shipPose.scale,shipPose.scale,shipPose.scale);ship.root.visible=!shipPose.destroyed||(death!==undefined&&time-death<.12);
      for(let j=0;j<ship.turrets.length;j++){sampleCombatGun(i,j,time,gunPose,script.shots);const turret=ship.turrets[j];turret.root.rotation.setFromEuler(0,gunPose.yaw,0);turret.barrels.rotation.setFromEuler(gunPose.pitch,0,0);turret.barrels.position.z=gunPose.recoil;}
    }
    // Lighting requires invertible matrices; unused slots sit beyond the camera's far plane.
    scratch.position.set(0,0,CONTRACT.camera.far*2);scratch.rotation.set(0,0,0,1);scratch.scale.set(1,1,1);
    const hiddenMatrix=scratch.updateWorldMatrix();
    for(const pool of shieldPools){
      pool.active=false;
      for(let slot=0;slot<pool.count;slot++){
        pool.projectile.setMatrixAt(slot,hiddenMatrix);pool.flash.setMatrixAt(slot,hiddenMatrix);pool.ripple.setMatrixAt(slot,hiddenMatrix);
      }
    }
    for(const effect of shieldEffects){
      const {shot,slot}=effect,launchAge=time-shot.fireTime,age=time-shot.hitTime;
      if(launchAge<0||time>=Math.max(shot.hitTime+shieldLife,shot.fireTime+flashLife))continue;
      const pool=shieldPools[effect.faction];pool.active=true;
      sampleCombatProjectile(shot,time,projectilePose);
      if(projectilePose.visible){
        scratch.position.set(projectilePose.x,projectilePose.y,projectilePose.z);aim(scratch,effect.dx,effect.dy,effect.dz);
        scratch.scale.set(1,1,Math.max(.0001,Math.min(1,launchAge*effect.speed/2.1)));
        pool.projectile.setMatrixAt(slot,scratch.updateWorldMatrix());
      }
      if(launchAge<flashLife){
        scratch.position.set(shot.start[0],shot.start[1],shot.start[2]);aim(scratch,effect.dx,effect.dy,effect.dz);
        const expansion=(1+launchAge/flashLife*2)*Math.max(.55,script.ships[shot.source].scale);
        scratch.scale.set(expansion,expansion,expansion);
        pool.flash.setMatrixAt(slot,scratch.updateWorldMatrix());
        const brightness=1-launchAge/flashLife*.8;
        pool.flash.setColorAt(slot,brightness,brightness,brightness);
      }
      if(age>=0&&age<shieldLife){
        sampleCombatShip(shot.target,time,shipPose,script,shock);
        if(shipPose.destroyed)continue;
        const c=Math.cos(shipPose.yaw),s=Math.sin(shipPose.yaw),local=shot.local,normal=shot.normal;
        const nx=c*normal[0]+s*normal[2],ny=normal[1],nz=-s*normal[0]+c*normal[2];
        scratch.position.set(shipPose.x+(c*local[0]+s*local[2])*shipPose.scale+nx*.025,shipPose.y+local[1]*shipPose.scale+ny*.025,shipPose.z+(-s*local[0]+c*local[2])*shipPose.scale+nz*.025);
        aim(scratch,-nx,-ny,-nz);
        const radius=(.22+age*2.5)*shipPose.scale;
        scratch.scale.set(radius,radius,radius);
        pool.ripple.setMatrixAt(slot,scratch.updateWorldMatrix());
        const brightness=(1-age/shieldLife)**2;
        pool.ripple.setColorAt(slot,brightness,brightness,brightness);
      }
    }
    for(const pool of shieldPools)pool.projectile.visible=pool.flash.visible=pool.ripple.visible=pool.active;
    for(const effect of effects){
      const {shot}=effect,age=time-shot.hitTime,launchAge=time-shot.fireTime;
      // Effects outside their lifetime are hidden once and then skipped entirely.
      const settled=shot.result==='kill'&&age>12.5;
      const phase=time<shot.fireTime-.001?-1:settled?1:0;
      if(phase!==0){if(effect.phase!==phase){hideEffect(effect);effect.phase=phase;}continue;}
      effect.phase=0;
      sampleCombatProjectile(shot,time,projectilePose);effect.projectile.visible=projectilePose.visible;effect.projectile.position.set(projectilePose.x,projectilePose.y,projectilePose.z);
      // The streak trails its physical leading point, clipped during initial launch.
      const speed=Math.hypot(shot.end[0]-shot.start[0],shot.end[1]-shot.start[1],shot.end[2]-shot.start[2])/(shot.hitTime-shot.fireTime);
      const trail=Math.min(1,Math.max(0,launchAge)*speed/2.1);effect.projectile.scale.set(1,1,trail);
      effect.flash.visible=launchAge>=0&&launchAge<flashLife;effect.flash.position.set(shot.start[0],shot.start[1],shot.start[2]);const flashScale=(1+Math.max(0,launchAge)/flashLife*2)*script.ships[shot.source].scale;effect.flash.scale.set(flashScale,flashScale,flashScale);
      // A screening burst tries to intercept the incoming round; no instantaneous beam.
      const interceptAge=time-(shot.hitTime-.48),burst=interceptAge% .16;
      effect.defence.visible=interceptAge>=0&&interceptAge<.48&&burst<.075&&projectilePose.visible;
      if(effect.defence.visible){
        const target=ships[shot.target].root,p=target.position,scale=script.ships[shot.target].scale;
        const dx=projectilePose.x-p.x,dy=projectilePose.y-p.y-scale*.7,dz=projectilePose.z-p.z,length=Math.hypot(dx,dy,dz)||1;
        const travel=Math.min(length,burst*40);
        effect.defence.position.set(p.x+dx/length*travel,p.y+scale*.7+dy/length*travel,p.z+dz/length*travel);
        aim(effect.defence,dx,dy,dz);effect.defence.scale.set(.65,.65,.4);
      }
      const kill=shot.result==='kill',hit=age>=0;
      sampleCombatShip(shot.target,time,shipPose,script,shock);const c=Math.cos(shipPose.yaw),s=Math.sin(shipPose.yaw);
      const px=shipPose.x+(c*effect.local[0]+s*effect.local[2])*shipPose.scale;
      const py=shipPose.y+effect.local[1]*shipPose.scale;
      const pz=shipPose.z+(-s*effect.local[0]+c*effect.local[2])*shipPose.scale;
      effect.contact.position.set(px+effect.normal[0]*.012,py+effect.normal[1]*.012,pz+effect.normal[2]*.012);
      effect.contact.rotation.setFromEuler(0,shipPose.yaw,0);effect.contact.scale.set(shipPose.scale,shipPose.scale,shipPose.scale);
      effect.contact.visible=hit&&(kill||!shipPose.destroyed);
      let superseded=false;
      for(const other of script.shots)if(other.target===shot.target&&other.result!=='shield'&&other.hitTime>shot.hitTime&&other.hitTime<=time){superseded=true;break;}
      effect.scorch.visible=!kill&&hit&&!shipPose.destroyed&&!superseded;effect.breach.visible=!kill&&hit&&age<3.1&&!superseded;
      const secondary=kill&&age>.3&&age<1.25?.22*Math.exp(-Math.max(0,age-.3)*3)*Math.pow(Math.sin((age-.3)*15),2):0;
      const burn=hit&&(kill||!shipPose.destroyed)?Math.max(0,1-age/(kill?.75:3.1))+secondary:0;
      const flicker=.7+.19*Math.sin(age*31+shot.source)+.11*Math.sin(age*53);
      effect.heat.emissive[0]=burn*1.7*flicker;effect.heat.emissive[1]=burn*.38*flicker;effect.heat.emissive[2]=burn*.045;
      effect.flameMaterial.uniforms[0]=burn*.58*flicker;
      effect.flameMaterial.uniforms[1]=age;
      effect.gasMaterial.uniforms[1]=age;
      for(let i=0;i<effect.flames.length;i++){
        const flame=effect.flames[i],phase=i*1.618+age*4.2,pulse=.55+.45*Math.sin(phase*3);
        flame.visible=burn>0;
        const distance=kill?.18+Math.max(0,age)*(.8+i*.16):.08+i*.12+(.5+.5*Math.sin(phase))*.16;
        // Convert the vent normal to local coordinates through the already-authored patch aim.
        flame.position.copy(effect.breach.position);flame.position.x+=Math.sin(phase)*.045;flame.position.y+=Math.cos(phase*1.3)*.045;
        if(kill&&i>=5)flame.position.z+=(i===5?2.3:4.8);
        const q=flame.rotation,x=-2*(q.x*q.z+q.w*q.y),y=-2*(q.y*q.z-q.w*q.x),z=-(1-2*(q.x*q.x+q.y*q.y));
        flame.position.x+=x*distance;flame.position.y+=y*distance;flame.position.z+=z*distance;
        const expansion=kill?.2+Math.max(0,age)*2.1:burn;
        flame.scale.set((kill?.85:.24)*pulse*expansion,(kill?.7:.21)*pulse*expansion,
          (kill?.95:.9)*(1+i*(kill?.025:.1))*expansion);
        // The vent ellipsoid starts outside the breach rather than straddling the hull.
        if(!kill){flame.position.x+=x*flame.scale.z;flame.position.y+=y*flame.scale.z;flame.position.z+=z*flame.scale.z;}
      }
      const gasLife=kill?2.2:1.6;effect.gasMaterial.uniforms[0]=hit?Math.max(0,1-age/gasLife)*.09:0;
      for(let i=0;i<effect.gas.length;i++){
        const gas=effect.gas[i],a=i*2.4;
        gas.visible=hit&&age<gasLife;
        gas.position.set(shot.end[0]+effect.normal[0]*age*.6+Math.cos(a)*age*.25,shot.end[1]+effect.normal[1]*age*.6+Math.sin(a)*age*.21,shot.end[2]+effect.normal[2]*age*.6+Math.sin(a*1.4)*age*.22);
        gas.rotation.setFromEuler(a,age*.2,a*.7);const radius=(kill?.18:.055)+Math.max(0,age)*(kill?.32:.12);gas.scale.set(radius,radius*.7,radius*1.2);
      }
      for(let i=0;i<effect.fragments.length;i++){
        const fragment=effect.fragments[i],life=kill?12:1.1;
        fragment.mesh.visible=hit&&age<life;
        fragment.mesh.position.set(fragment.origin[0]+fragment.velocity[0]*age,fragment.origin[1]+fragment.velocity[1]*age,fragment.origin[2]+fragment.velocity[2]*age);
        fragment.mesh.rotation.setFromEuler(fragment.section?age*(.22+i*.07):fragment.phase+age*(.5+i%3),fragment.section?fragment.yaw+age*(.18+i*.08):age*(.8+i%4),fragment.section?age*.3:fragment.phase*.7+age*.9);
        const scale=fragment.size*(kill?1:Math.max(0,1-age/life));fragment.mesh.scale.set(scale,fragment.section?scale:scale*.6,fragment.section?scale:scale*.4);
        const glow=Math.max(0,1-age/(kill?1.8:.6)),heat=fragment.section?.11:.65;fragment.material.emissive[0]=glow*heat;fragment.material.emissive[1]=glow*heat*.19;fragment.material.emissive[2]=glow*heat*.018;
      }
      effect.light.position.set(px+effect.normal[0]*.12,py+effect.normal[1]*.12,pz+effect.normal[2]*.12);
      effect.light.intensity=burn*(kill?1.6:.48)*flicker;
    }
  };
  const reset=():void=>{update(0);for(const light of lights)light.intensity=0;};
  reset();
  // Class-specific hulls and projected decals are owned here; hero maps are borrowed.
  return {root,textures:[scorchTexture],geometries,nativeMaterials,lights,update,reset,dispose(){
    for(const light of lights)light.intensity=0;
    for(const child of root.children)root.remove(child);
  }};
}
