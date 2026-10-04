import { Geometry, Group, Mesh, NativeMaterial3D, Object3D, PBRMaterial, PointLight, Texture } from 'xyz.js';
import { COMBAT_SCRIPT, sampleCombatGun, sampleCombatProjectile, sampleCombatShip, type CombatScript } from '../show/combat.ts';
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
function radialGeometry(profile: readonly (readonly [number, number])[], segments: number, irregular = false): Geometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let r = 0; r < profile.length - 1; r++) for (let i = 0; i < segments; i++) {
    const corners: Triple[] = [];
    for (const [row, column] of [[r,i],[r,i+1],[r+1,i+1],[r+1,i]]) {
      const a = column / segments * Math.PI * 2;
      const radius = profile[row][1] * (irregular ? .76 + .24 * Math.sin(column * 2.7 + .8) : 1);
      corners.push([Math.cos(a)*radius,Math.sin(a)*radius,profile[row][0]]);
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
    for(let k=0;k<4;k++){positions.push(...corners[k]);normals.push(nx/length,ny/length,nz/length);uvs.push(k===1||k===2?1:0,k>=2?1:0);}
    indices.push(start,start+1,start+2,start,start+2,start+3);
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
  const ships: ShipModel[]=script.ships.map((definition)=>{
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
        copy=new Mesh({geometry:node.geometry,material,castShadow:node.castShadow,receiveShadow:node.receiveShadow});
      } else copy=new Group();
      copy.position.copy(node.position);copy.rotation.copy(node.rotation);copy.scale.copy(node.scale);copy.visible=node.visible;
      nodes.set(node,copy);
      for(const child of node.children)copy.add(clone(child));
      return copy;
    };
    const hull=clone(source.root) as Group;root.add(hull);
    return {root:hull,textures,geometries:source.geometries,engines:source.engines.map(mesh=>nodes.get(mesh) as Mesh),turrets:source.turrets.map(t=>({root:nodes.get(t.root) as Group,barrels:nodes.get(t.barrels) as Group,muzzles:t.muzzles}))};
  });
  const boltGeometry=radialGeometry([[0,0],[.1,.045],[.25,.035],[1.1,0]],8);
  const flashGeometry=radialGeometry([[-.32,0],[-.09,.13],[0,.04],[.08,0]],9,true);
  const rippleGeometry=radialGeometry([[-.32,.55],[-.24,.72],[-.13,.87],[0,1]],40);
  const plateGeometry=radialGeometry([[-.06,0],[-.06,1],[.045,.82],[.045,0]],7,true);
  const gasGeometry=Geometry.sphere(1,24,16);
  geometries.push(boltGeometry,flashGeometry,rippleGeometry,plateGeometry,gasGeometry);
  const projectileMaterials=([ [.28,.75,1],[1,.36,.12] ] as Triple[]).map(color=>new PBRMaterial({texture:white,color,emissive:[color[0]*2,color[1]*2,color[2]*2],roughness:1,metallic:0,alphaMode:'OPAQUE'}));
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
  if(mesh.custom[0].z>0.5){
    let age=mesh.custom[0].y;
    let p=world*12.0+vec3f(age*0.6,-age*1.2,age*0.5);
    let field=combatNoise(p)*0.65+combatNoise(p*2.07+vec3f(9.3))*0.35;
    let edge=pow(abs(dot(normalize(normal),normalize(scene.camera.xyz-world))),0.8);
    a*=edge*smoothstep(0.16,0.76,field);
    if(mesh.custom[0].z<1.5){color=mix(vec3f(1.0,0.13,0.018),vec3f(4.0,1.55,0.32),field);}
  }else{color*=2.5;}
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
  if(xyzUniforms[0].z>0.5){
    float age=xyzUniforms[0].y;
    vec3 p=world*12.0+vec3(age*0.6,-age*1.2,age*0.5);
    float field=combatNoise(p)*0.65+combatNoise(p*2.07+vec3(9.3))*0.35;
    float edge=pow(abs(dot(normalize(normal),normalize(cameraPosition-world))),0.8);
    a*=edge*smoothstep(0.16,0.76,field);
    if(xyzUniforms[0].z<1.5)color=mix(vec3(1.0,0.13,0.018),vec3(4.0,1.55,0.32),field);
  }else{color*=2.5;}
  #endif
  return vec4(color*a,a);
}
#endif`});
    nativeMaterials.push(material);return material;
  };
  const effects=script.shots.map((shot,index)=>{
    const faction=script.ships[shot.source].side==='attacker'?1:0;
    const projectile=root.add(new Mesh({geometry:boltGeometry,material:projectileMaterials[faction],castShadow:false,receiveShadow:false}));
    const flash=root.add(new Mesh({geometry:flashGeometry,material:projectileMaterials[faction],castShadow:false,receiveShadow:false}));
    const direction:Triple=[shot.end[0]-shot.start[0],shot.end[1]-shot.start[1],shot.end[2]-shot.start[2]];
    aim(projectile,...direction);aim(flash,...direction);
    const hitPose={x:0,y:0,z:0,yaw:0,scale:1,destroyed:false};
    sampleCombatShip(shot.target,shot.hitTime,hitPose,script);
    const c=Math.cos(hitPose.yaw),s=Math.sin(hitPose.yaw);
    const local:Triple=[...shot.local];
    // Contact normals are authored in the target hull's frame (armor slope or shield bubble).
    const localNormal:Triple=[...shot.normal];
    const normal:Triple=[c*localNormal[0]+s*localNormal[2],localNormal[1],-s*localNormal[0]+c*localNormal[2]];
    const contact=root.add(new Group());
    const rippleMaterial=fadingMaterial(faction===1?[.3,.7,1]:[.6,.5,1],`Shield ripple ${shot.id}`,0);
    const ripple=contact.add(new Mesh({geometry:rippleGeometry,material:rippleMaterial,castShadow:false,receiveShadow:false}));aim(ripple,...localNormal);
    const scorch=contact.add(new Mesh({geometry:plateGeometry,material:new PBRMaterial({texture:white,color:[.035,.025,.021],roughness:1,metallic:.2,alphaMode:'OPAQUE'}),castShadow:false}));aim(scorch,...localNormal);scorch.scale.set(.42,.3,.12);
    const heat=new PBRMaterial({texture:white,color:[.18,.055,.018],emissive:[1,.22,.035],roughness:.8,metallic:.35,alphaMode:'OPAQUE'});
    const breach=contact.add(new Mesh({geometry:plateGeometry,material:heat,castShadow:false}));aim(breach,...localNormal);breach.scale.set(.2,.12,.2);breach.position.set(localNormal[0]*.023,localNormal[1]*.023,localNormal[2]*.023);
    const flameMaterial=fadingMaterial([1,.43,.08],`Fuel vent ${shot.id}`,1),gasMaterial=fadingMaterial([.2,.16,.12],`Expelled gas ${shot.id}`,2);
    const flames=Array.from({length:shot.result==='kill'?12:5},(_,i)=>{
      const mesh=contact.add(new Mesh({geometry:gasGeometry,material:flameMaterial,castShadow:false,receiveShadow:false}));
      if(shot.result==='kill'){
        const angle=i*2.399963,elevation=Math.sin(i*1.7+.4),radius=Math.sqrt(1-elevation*elevation);
        aim(mesh,Math.cos(angle)*radius,elevation,Math.sin(angle)*radius);
      }else aim(mesh,...localNormal);
      return mesh;
    });
    const gas=Array.from({length:shot.result==='kill'?9:4},()=>root.add(new Mesh({geometry:gasGeometry,material:gasMaterial,castShadow:false,receiveShadow:false})));
    const fragments=Array.from({length:shot.result==='kill'?32:8},(_,i)=>{
      const a=i*2.399963+index*.7,y=Math.sin(i*1.8+index),r=Math.sqrt(1-y*y);
      const velocity:Triple=[normal[0]*(.5+i%4*.23)+Math.cos(a)*r*(.6+i%5*.28),normal[1]*(.5+i%4*.23)+y*(.6+i%5*.28),normal[2]*(.5+i%4*.23)+Math.sin(a)*r*(.6+i%5*.28)];
      const material=new PBRMaterial({texture:textures[0],color:[.39,.38,.34],normalTexture:textures[1],roughness:.68,metallic:.8,emissive:[.5,.16,.025],alphaMode:'OPAQUE'});
      const mesh=root.add(new Mesh({geometry:plateGeometry,material}));
      const armorFragment=shot.result==='kill'&&i<12;
      const lx=Math.cos(a)*1.2,lz=-3.8+(i%12)*.68;
      const origin:Triple=armorFragment?[hitPose.x+(c*lx+s*lz)*hitPose.scale,hitPose.y+y*.4*hitPose.scale,hitPose.z+(-s*lx+c*lz)*hitPose.scale]:[...shot.end];
      return {mesh,material,velocity,origin,size:armorFragment?.16+(i%4)*.075:.012+(i%4)*.009,phase:a};
    });
    const light=new PointLight({intensity:0,color:shot.result==='shield'?[.28,.6,1]:[1,.36,.08],range:3,priority:2});lights.push(light);
    return {shot,projectile,flash,contact,ripple,rippleMaterial,scorch,breach,heat,flames,flameMaterial,gas,gasMaterial,fragments,light,normal,local,phase:-2};
  });
  const shipPose={x:0,y:0,z:0,yaw:0,scale:1,destroyed:false},gunPose={yaw:0,pitch:0,recoil:0},projectilePose={x:0,y:0,z:0,visible:false};
  const hideEffect=(effect:typeof effects[number]):void=>{
    effect.projectile.visible=effect.flash.visible=effect.contact.visible=false;
    for(const gas of effect.gas)gas.visible=false;
    for(const fragment of effect.fragments)fragment.mesh.visible=false;
    effect.light.intensity=0;
  };
  const update=(time:number,shock=0):void=>{
    for(let i=0;i<ships.length;i++){
      sampleCombatShip(i,time,shipPose,script,shock);const ship=ships[i];
      ship.root.position.set(shipPose.x,shipPose.y,shipPose.z);ship.root.rotation.setFromEuler(0,shipPose.yaw,0);ship.root.scale.set(shipPose.scale,shipPose.scale,shipPose.scale);ship.root.visible=!shipPose.destroyed;
      for(let j=0;j<ship.turrets.length;j++){sampleCombatGun(i,j,time,gunPose,script.shots);const turret=ship.turrets[j];turret.root.rotation.setFromEuler(0,gunPose.yaw,0);turret.barrels.rotation.setFromEuler(gunPose.pitch,0,0);turret.barrels.position.z=gunPose.recoil;}
    }
    for(const effect of effects){
      const {shot}=effect,age=time-shot.hitTime,launchAge=time-shot.fireTime;
      // Effects outside their lifetime are hidden once and then skipped entirely.
      const settled=(shot.result==='shield'&&age>1)||(shot.result==='kill'&&age>12.5);
      const phase=time<shot.fireTime-.001?-1:settled?1:0;
      if(phase!==0){if(effect.phase!==phase){hideEffect(effect);effect.phase=phase;}continue;}
      effect.phase=0;
      sampleCombatProjectile(shot,time,projectilePose);effect.projectile.visible=projectilePose.visible;effect.projectile.position.set(projectilePose.x,projectilePose.y,projectilePose.z);
      // The streak trails its physical leading point, clipped during initial launch.
      const trail=Math.min(1,Math.max(0,launchAge)*18);effect.projectile.scale.set(1,1,trail);
      effect.flash.visible=launchAge>=0&&launchAge<.085;effect.flash.position.set(shot.start[0],shot.start[1],shot.start[2]);const flashScale=Math.max(0,1-launchAge/.085);effect.flash.scale.set(flashScale,flashScale,flashScale);
      const shield=shot.result==='shield',kill=shot.result==='kill',hit=age>=0;
      sampleCombatShip(shot.target,time,shipPose,script,shock);const c=Math.cos(shipPose.yaw),s=Math.sin(shipPose.yaw);
      const px=shipPose.x+(c*effect.local[0]+s*effect.local[2])*shipPose.scale;
      const py=shipPose.y+effect.local[1]*shipPose.scale;
      const pz=shipPose.z+(-s*effect.local[0]+c*effect.local[2])*shipPose.scale;
      effect.contact.position.set(px+effect.normal[0]*.012,py+effect.normal[1]*.012,pz+effect.normal[2]*.012);
      effect.contact.rotation.setFromEuler(0,shipPose.yaw,0);effect.contact.scale.set(shipPose.scale,shipPose.scale,shipPose.scale);
      effect.contact.visible=hit&&(kill||!shipPose.destroyed);effect.ripple.visible=shield&&age<.7;effect.rippleMaterial.uniforms[0]=shield&&hit?Math.max(0,1-age/.7)*.7:0;
      const rippleScale=.45+Math.max(0,age)*2;effect.ripple.scale.set(rippleScale,rippleScale,rippleScale);
      effect.scorch.visible=!shield&&!kill&&hit;effect.breach.visible=!shield&&!kill&&hit;
      const burn=hit&&!shield&&(kill||!shipPose.destroyed)?Math.max(0,1-age/(kill?.75:3.1)):0;
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
        const q=flame.rotation,x=-2*(q.x*q.z+q.w*q.y),y=-2*(q.y*q.z-q.w*q.x),z=-(1-2*(q.x*q.x+q.y*q.y));
        flame.position.x+=x*distance;flame.position.y+=y*distance;flame.position.z+=z*distance;
        const expansion=kill?.3+Math.max(0,age)*3.2:burn;
        flame.scale.set((kill?1.2:.38)*pulse*expansion,(kill?.95:.29)*pulse*expansion,
          (kill?1.25:1.4)*(1+i*(kill?.025:.15))*expansion);
        // The vent ellipsoid starts outside the breach rather than straddling the hull.
        if(!kill){flame.position.x+=x*flame.scale.z;flame.position.y+=y*flame.scale.z;flame.position.z+=z*flame.scale.z;}
      }
      const gasLife=kill?2.2:1.6;effect.gasMaterial.uniforms[0]=hit&&!shield?Math.max(0,1-age/gasLife)*.09:0;
      for(let i=0;i<effect.gas.length;i++){
        const gas=effect.gas[i],a=i*2.4;
        gas.visible=hit&&!shield&&age<gasLife;
        gas.position.set(shot.end[0]+effect.normal[0]*age*.6+Math.cos(a)*age*.25,shot.end[1]+effect.normal[1]*age*.6+Math.sin(a)*age*.21,shot.end[2]+effect.normal[2]*age*.6+Math.sin(a*1.4)*age*.22);
        gas.rotation.setFromEuler(a,age*.2,a*.7);const radius=(kill?.18:.055)+Math.max(0,age)*(kill?.32:.12);gas.scale.set(radius,radius*.7,radius*1.2);
      }
      for(let i=0;i<effect.fragments.length;i++){
        const fragment=effect.fragments[i],life=kill?12:1.1;
        fragment.mesh.visible=hit&&!shield&&age<life;
        fragment.mesh.position.set(fragment.origin[0]+fragment.velocity[0]*age,fragment.origin[1]+fragment.velocity[1]*age,fragment.origin[2]+fragment.velocity[2]*age);
        fragment.mesh.rotation.setFromEuler(fragment.phase+age*(.5+i%3),age*(.8+i%4),fragment.phase*.7+age*.9);
        const scale=fragment.size*(kill?1:Math.max(0,1-age/life));fragment.mesh.scale.set(scale,scale*.6,scale*.4);
        const glow=Math.max(0,1-age/(kill?1.8:.6));fragment.material.emissive[0]=glow*.9;fragment.material.emissive[1]=glow*.24;fragment.material.emissive[2]=glow*.025;
      }
      effect.light.position.set(px+effect.normal[0]*.12,py+effect.normal[1]*.12,pz+effect.normal[2]*.12);
      effect.light.intensity=burn*(kill?1.6:.48)*flicker;
      if(shield)effect.light.intensity=hit&&age<.65?Math.pow(1-age/.65,2)*.7:0;
    }
  };
  const reset=():void=>{update(0);for(const light of lights)light.intensity=0;};
  reset();
  // Only the five effect geometries and native materials are new; all hull resources are borrowed.
  return {root,textures:[],geometries,nativeMaterials,lights,update,reset,dispose(){
    for(const light of lights)light.intensity=0;
    for(const child of root.children)root.remove(child);
  }};
}
