import { Geometry, Group, Mesh, PBRMaterial, PointLight, Texture } from 'xyz.js';
import type { NativeMaterial3D } from 'xyz.js';
import type { ShipModel } from './ship-model.ts';
import { CONTRACT } from '../show/contract.ts';

type Point = [number, number, number];
type Profile = readonly (readonly [number, number])[];
export interface WeaponModel {
  /** Local +Z fires; centre at origin. Structure spans Z -8..8, X/Y ±3.45. */
  root: Group;
  textures: Texture[];
  geometries: Geometry[];
  nativeMaterials: NativeMaterial3D[];
  lights: PointLight[];
  /** Positive distance along local +Z to the emitter. */
  apertureDistance: number;
  update(state: { charge: number; pulse: number; beam: number; beamLength: number }): void;
  reset(): void;
  dispose(): void;
}

/** Hard face normals and world-scale UVs keep the machining crisp at close range. */
class Metalwork {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  face(points: Point[],uv?:readonly Point[]): void {
    const a=points[0],b=points[1],c=points[2];
    let x=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
    let y=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    let z=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    let n=Math.hypot(x,y,z);
    if(n<1e-8){const d=points[3];x=(c[1]-a[1])*(d[2]-a[2])-(c[2]-a[2])*(d[1]-a[1]);y=(c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2]);z=(c[0]-a[0])*(d[1]-a[1])-(c[1]-a[1])*(d[0]-a[0]);n=Math.hypot(x,y,z);}
    if(n<1e-8)return;
    const start=this.positions.length/3;
    for(let i=0;i<points.length;i++){const p=points[i];this.positions.push(...p);this.normals.push(x/n,y/n,z/n);this.uvs.push(...(uv?[uv[i][0],uv[i][1]]:[p[2]/3,(Math.abs(x)>Math.abs(y)?p[1]:p[0])/3]));}
    for(let i=1;i<points.length-1;i++)this.indices.push(start,start+i,start+i+1);
  }
  lathe(profile:Profile,segments=64):void {
    for(let r=0;r<profile.length-1;r++)for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
      const [z0,r0]=profile[r],[z1,r1]=profile[r+1];
      this.face([[r0*Math.cos(a),r0*Math.sin(a),z0],[r0*Math.cos(b),r0*Math.sin(b),z0],[r1*Math.cos(b),r1*Math.sin(b),z1],[r1*Math.cos(a),r1*Math.sin(a),z1]]);
    }
  }
  /** Chamfered octagonal section, offset radially then rotated about the barrel. */
  rail(sections:readonly (readonly [number,number,number,number])[],angle:number):void {
    const shape=[[1,.4],[.72,1],[-.72,1],[-1,.4],[-1,-.4],[-.72,-1],[.72,-1],[1,-.4]];
    const co=Math.cos(angle),si=Math.sin(angle);
    const rings=sections.map(([z,r,w,h])=>shape.map(([x,y])=>[(r+y*h)*co+x*w*si,(r+y*h)*si-x*w*co,z] as Point));
    this.face([...rings[0]].reverse());this.face(rings[rings.length-1]);
    for(let r=0;r<rings.length-1;r++)for(let i=0;i<8;i++){const j=(i+1)%8;this.face([rings[r][i],rings[r][j],rings[r+1][j],rings[r+1][i]]);}
  }
  rod(a:Point,b:Point,r:number,segments=8):void {
    const d:Point=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],n=Math.hypot(...d);if(n<1e-6)return;
    const v:Point=Math.abs(d[2]/n)<.9?[-d[1],d[0],0]:[0,-d[2],d[1]],vn=Math.hypot(...v);
    for(let j=0;j<3;j++)v[j]/=vn;
    const w:Point=[(d[1]*v[2]-d[2]*v[1])/n,(d[2]*v[0]-d[0]*v[2])/n,(d[0]*v[1]-d[1]*v[0])/n];
    const p=(o:Point,t:number):Point=>[o[0]+r*(v[0]*Math.cos(t)+w[0]*Math.sin(t)),o[1]+r*(v[1]*Math.cos(t)+w[1]*Math.sin(t)),o[2]+r*(v[2]*Math.cos(t)+w[2]*Math.sin(t))];
    for(let i=0;i<segments;i++){const t=i/segments*Math.PI*2,u=(i+1)/segments*Math.PI*2;this.face([p(a,t),p(a,u),p(b,u),p(b,t)]);}
  }
  vessel(z:number,r:number,radius:number,length:number,angle:number):void {
    const work=new Metalwork();work.lathe([[z-length/2,0],[z-length/2,radius*.65],[z-length*.42,radius],[z+length*.42,radius],[z+length/2,radius*.65],[z+length/2,0]],radius>.25?64:16);
    const base=this.positions.length/3,co=Math.cos(angle),si=Math.sin(angle);
    for(let i=0;i<work.positions.length;i+=3){this.positions.push(work.positions[i]+r*co,work.positions[i+1]+r*si,work.positions[i+2]);this.normals.push(work.normals[i],work.normals[i+1],work.normals[i+2]);}
    this.uvs.push(...work.uvs);for(const i of work.indices)this.indices.push(base+i);
  }
  geometry():Geometry{return new Geometry({positions:this.positions,normals:this.normals,uvs:this.uvs,indices:this.indices});}
}
const clamp=(v:number):number=>Math.max(0,Math.min(1,v));
function ring(z:number,r:number,w:number):Profile{return [[z-w,r],[z-w*.7,r+w*.7],[z,r+w],[z+w*.7,r+w*.7],[z+w,r],[z+w*.7,r-w*.7],[z,r-w],[z-w*.7,r-w*.7],[z-w,r]];}
async function machineTextures():Promise<Texture[]>{
  if(CONTRACT.visual.textureSize<1024)throw new RangeError('Weapon texture exceeds visual budget');
  const canvases=Array.from({length:5},()=>{const c=document.createElement('canvas');c.width=c.height=1024;return c;});
  const [color,normal,mr,ao,label]=canvases.map(c=>c.getContext('2d')!);
  color.fillStyle='#a2a6a1';color.fillRect(0,0,1024,1024);normal.fillStyle='#8080ff';normal.fillRect(0,0,1024,1024);
  mr.fillStyle='#007ddc';mr.fillRect(0,0,1024,1024);ao.fillStyle='#ffffff';ao.fillRect(0,0,1024,1024);
  // Unequal vessel panels, welding runs and fine streaks, rather than ship-sized tiles.
  for(let y=0;y<1024;y++){const k=Math.sin(y*91.71)*Math.sin(y*13.43);color.fillStyle=`rgba(30,23,14,${.015+Math.abs(k)*.025})`;color.fillRect(0,y,1024,1);}
  for(const x of [7,317,743,1017]){
    color.fillStyle='#59605d';color.fillRect(x,0,3,1024);normal.fillStyle='#a880ec';normal.fillRect(x-2,0,3,1024);normal.fillStyle='#6080ec';normal.fillRect(x+1,0,3,1024);
    ao.fillStyle='#9b9b9b';ao.fillRect(x-2,0,7,1024);mr.fillStyle='#00b89b';mr.fillRect(x-4,0,10,1024);
    for(let y=12;y<1024;y+=19){color.fillStyle='#b3b3a6';color.fillRect(x-1,y,5,3);}
  }
  for(let i=0;i<220;i++){
    const x=(i*173.71)%1024,y=(i*317.39)%1024,w=2+i%9,l=24+i%131;
    const stain=color.createLinearGradient(x,y,x,y+l);stain.addColorStop(0,'rgba(54,27,12,.48)');stain.addColorStop(1,'rgba(46,32,19,0)');
    color.fillStyle=stain;color.fillRect(x,y,w,l);mr.fillStyle='#00d575';mr.fillRect(x,y,w,l);
  }
  for(let y=35;y<1024;y+=173){
    color.fillStyle='#414744';color.fillRect(0,y,1024,4);ao.fillStyle='#878787';ao.fillRect(0,y-2,1024,8);
    normal.fillStyle='#808be8';normal.fillRect(0,y-2,1024,3);normal.fillStyle='#806ae8';normal.fillRect(0,y+2,1024,3);
    for(let x=22;x<1024;x+=47){color.fillStyle='#383e3b';color.beginPath();color.arc(x,y+11,3,0,Math.PI*2);color.fill();color.fillStyle='#c4c7b9';color.fillRect(x-2,y+8,2,2);}
  }
  const scorch=color.createRadialGradient(810,480,30,810,480,360);scorch.addColorStop(0,'rgba(27,21,17,.6)');scorch.addColorStop(.5,'rgba(104,58,22,.2)');scorch.addColorStop(1,'rgba(55,31,17,0)');color.fillStyle=scorch;color.fillRect(0,0,1024,1024);
  label.fillStyle='#242b2c';label.fillRect(0,0,1024,1024);label.fillStyle='#c9a34d';label.fillRect(0,780,1024,244);
  label.fillStyle='#202323';for(let x=-300;x<1300;x+=110){label.beginPath();label.moveTo(x,780);label.lineTo(x+70,780);label.lineTo(x+310,1024);label.lineTo(x+240,1024);label.fill();}
  label.fillStyle='#d3d5c6';label.font='600 130px monospace';label.fillText('AXIAL / 09',65,195);
  label.font='52px monospace';label.fillText('MASS DRIVER',70,290);label.fillText('VACUUM : 0.0001 Pa',70,385);
  label.fillStyle='#b5a575';label.font='44px monospace';label.fillText('CAUTION - INDUCTION',70,530);
  label.fillStyle='#ddd9c1';for(let i=0;i<80;i++)label.fillRect(70+i*10,610,i%3===0?5:2,70);
  return Promise.all(canvases.map(c=>Texture.fromImage(c)));
}

export async function createWeaponModel(source:ShipModel):Promise<WeaponModel>{
  const root=new Group(),geometries:Geometry[]=[];
  const textures=await machineTextures(),[albedo,normal,mr,ao,markings]=textures,white=source.textures[4];
  const sampler={addressModeU:'repeat',addressModeV:'repeat',minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'} as const;
  const metal=(color:Point,roughness:number,metallic:number)=>new PBRMaterial({texture:albedo,color,normalTexture:normal,normalScale:.55,metallicRoughnessTexture:mr,occlusionTexture:ao,occlusionStrength:.65,roughness,metallic,alphaMode:'OPAQUE',textureSampler:sampler,normalSampler:sampler,metallicRoughnessSampler:sampler,occlusionSampler:sampler});
  const armor=metal([.8,.84,.81],.72,.55),chassis=metal([.26,.3,.32],.64,.8),trim=metal([.57,.63,.64],.44,.92),copper=metal([.48,.25,.13],.58,.85);
  const energy=()=>new PBRMaterial({texture:white,color:[.025,.07,.08],emissive:[0,0,0],roughness:.36,metallic:.4,alphaMode:'OPAQUE'});
  const add=(work:Metalwork,material:PBRMaterial,glow=false,parent:Group=root):Mesh=>{const geometry=work.geometry();geometries.push(geometry);return parent.add(new Mesh({geometry,material,castShadow:!glow,receiveShadow:!glow}));};
  const body=new Metalwork(),plates=new Metalwork(),edges=new Metalwork(),radiators=new Metalwork(),rails=new Metalwork();
  body.lathe([[-8,0],[-8,1.3],[-7.65,1.9],[-6.9,2.05],[-3.3,2.05],[-2.6,1.25],[6.8,.76],[7.6,.92],[8,1.08],[8,.66],[7.45,.53],[-2.7,.53],[-2.7,0]],96);
  for(const z of [-7.5,-6.7,-3.5,-2.6,6.5])edges.lathe(ring(z,z< -3?2.08:1.22,.12),64);
  // Six separated armored reactor petals expose cooling trenches and load-bearing pylons.
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    plates.vessel(-5.5,2.6,.57,3.8,a);
    plates.vessel(-4.85,3.04,.32,1.7,a);
    for(let j=0;j<5;j++){
      const z=-7+j*.61;
      plates.rail([[z,2.95,.36,.035],[z+.055,3.04,.42,.055],[z+.49,3.04,.42,.055],[z+.55,2.95,.36,.035]],a);
      edges.rail([[z+.12,3.105,.28,.006],[z+.4,3.105,.28,.006]],a);
    }
    edges.rail([[-4.8,2.35,.16,.17],[-2.1,1.64,.15,.16],[5.6,1.64,.1,.12],[7.9,1.15,.09,.12]],a);
    rails.rail([[-2.4,1.57,.05,.04],[5.7,1.57,.05,.04],[7.6,1.09,.035,.03]],a);
    for(let j=0;j<9;j++)radiators.rail([[-6.8+j*.29,2.17,.23,.03],[-6.67+j*.29,2.17,.23,.03]],a+Math.PI/6);
    edges.rail([[-7.85,1.5,.15,.13],[-7.3,2.7,.14,.13]],a);
  }
  add(body,chassis);add(plates,armor);add(edges,trim);add(radiators,copper);
  const lattice=new Metalwork(),pipes=new Metalwork(),banks=new Metalwork(),seams=new Metalwork(),access=new Metalwork(),decals=new Metalwork(),scorched=new Metalwork();
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,co=Math.cos(a),si=Math.sin(a);
    const p=(r:number,t:number,z:number):Point=>[r*co+t*si,r*si-t*co,z];
    // Open Warren trusses carry the barrel; the walkway and rails are deliberately human-scale.
    for(let j=0;j<12;j++){
      const z=-3+j*.79;lattice.rod(p(1.7,-.12,z),p(1.7,.12,z+.79),.025);
      lattice.rod(p(1.7,.12,z),p(1.7,-.12,z+.79),.025);
      access.rod(p(1.84,-.15,z),p(1.84,.15,z),.012);
    }
    for(const t of [-.15,.15]){
      access.rod(p(1.85,t,-2.8),p(1.85,t,6.1),.018);
      access.rod(p(2.02,t,-2.8),p(2.02,t,6.1),.01);
      for(let z=-2.8;z<6.1;z+=.63)access.rod(p(1.85,t,z),p(2.02,t,z),.009);
    }
    for(let j=0;j<18;j++){
      const z=-7.05+j*.18;access.rod(p(2.86,-.075,z),p(2.86,.075,z),.008);
    }
    for(const t of [-.08,.08])access.rod(p(2.86,t,-7.05),p(2.86,t,-3.9),.012);
    for(let j=0;j<7;j++){
      const z=-6.7+j*.42;banks.vessel(z,2.92,.11,.3,a+.11);
      pipes.rod(p(2.85,.5,z),p(2.85,.5,z+.28),.04,12);
      pipes.rod(p(2.85,.5,z),p(2.95,.25,z),.024);
    }
    pipes.rod(p(2.18,.65,-7.3),p(2.18,.65,-3.55),.065,12);
    pipes.rod(p(1.48,.25,-3.4),p(1.48,.25,6.7),.045,12);
    for(const z of [-7.15,-6.2,-5.25,-4.3])seams.rail([[z,2.835,.61,.007],[z+.022,2.835,.61,.007]],a);
    for(let j=0;j<8;j++){
      const z=-2+j*1.08,r=1.36-j*.027;
      for(let k=0;k<3;k++)banks.vessel(z,r+.12,.035,.14,a+(k-1)*.08);
    }
    // Recessed access hatch, hinges and a non-emissive printed safety placard.
    access.rail([[-5.3,3.15,.14,.008],[-4.99,3.15,.14,.008]],a);
    for(const z of [-5.27,-5.05])access.rod(p(3.17,.15,z),p(3.17,.15,z+.055),.015);
    decals.face([p(3.17,-.27,-6.38),p(3.17,.27,-6.38),p(3.17,.27,-6.95),p(3.17,-.27,-6.95)],[[0,0,0],[1,0,0],[1,1,0],[0,1,0]]);
    scorched.rail([[6.1,1.665,.105,.013],[6.8,1.665,.105,.013],[7.7,1.24,.095,.013]],a);
  }
  for(let j=0;j<8;j++)for(let k=0;k<4;k++)seams.lathe(ring(-2+j*1.08-.14+k*.095,1.36-j*.027,.012),64);
  for(const z of [6.85,7.05,7.25,7.45])seams.lathe(ring(z,.86+(z-6.85)*.25,.025),96);
  // Two docked vacuum tenders, rounded pressure cabins and thin solar/handling outriggers.
  for(const a of [.36,3.5]){
    banks.vessel(-6.1,3.05,.105,.46,a);
    const co=Math.cos(a),si=Math.sin(a);
    for(const side of [-1,1]){const p:Point=[3.05*co+side*.16*si,3.05*si-side*.16*co,-6.1];access.rod([3.05*co,3.05*si,-6.1],p,.012);access.rod([p[0],p[1],-6.28],[p[0],p[1],-5.92],.025);}
  }
  add(lattice,chassis);add(pipes,copper);add(banks,trim);add(seams,trim);add(access,chassis);
  add(scorched,metal([.24,.17,.13],.88,.65));
  add(decals,new PBRMaterial({texture:markings,roughness:.88,metallic:.2,alphaMode:'OPAQUE'}));
  const railMaterial=energy();add(rails,railMaterial,true);
  const coils:PBRMaterial[]=[];
  for(let i=0;i<8;i++){
    const z=-2+i*1.08,r=1.13-i*.027;
    const mount=new Metalwork();mount.lathe(ring(z,r+.035,.18));add(mount,chassis);
    const winding=new Metalwork();winding.lathe(ring(z,r+.17,.058),48);
    const material=energy();coils.push(material);add(winding,material,true);
    const flange=new Metalwork();flange.lathe(ring(z-.24,r+.03,.055));flange.lathe(ring(z+.24,r+.03,.055));add(flange,copper);
  }
  const aperture=new Metalwork();aperture.lathe([[7.35,.86],[7.6,1.02],[7.82,1.19],[8,1.08],[8,.72],[7.91,.69],[7.91,.61],[7.68,.58],[7.4,.56],[7.35,.86]],96);add(aperture,trim);
  const bore=new Metalwork(),focus=new Metalwork();
  bore.lathe([[6.5,.44],[7.6,.55],[7.9,.6],[7.9,.63],[6.5,.49],[6.5,.44]],96);
  for(let j=0;j<5;j++)focus.lathe(ring(6.75+j*.23,.49+j*.023,.027),96);
  add(bore,chassis);add(focus,copper);
  const inner=new Group();root.add(inner);
  const iris=new Metalwork();
  for(let i=0;i<9;i++)iris.rail([[7.76,.71,.025,.015],[7.95,.76,.11,.045],[8,.8,.08,.025]],i*Math.PI*2/9);
  add(iris,copper,false,inner);
  const coreMaterial=energy(),sphere=Geometry.sphere(1,32,20);geometries.push(sphere);
  const core=root.add(new Mesh({geometry:sphere,material:coreMaterial,castShadow:false,receiveShadow:false}));core.position.z=8;
  const lensWork=new Metalwork();lensWork.lathe(ring(7.88,.54,.04),48);const lensMaterial=energy();add(lensWork,lensMaterial,true);
  const beamWork=new Metalwork();beamWork.lathe([[0,0],[0,.26],[.008,.31],[.025,.22],[.3,.19],[.7,.23],[.98,.17],[1,0]],48);
  const beamMaterial=new PBRMaterial({texture:white,color:[.2,.65,.75],emissive:[.8,3,4],roughness:1,metallic:0});
  const beam=add(beamWork,beamMaterial,true);beam.position.z=8;
  const hotWork=new Metalwork();hotWork.lathe([[0,0],[0,.1],[.02,.095],[.995,.055],[1,0]],32);
  const hotMaterial=new PBRMaterial({texture:white,color:[.85,1,1],emissive:[5,6,6],roughness:1,metallic:0});
  const hot=add(hotWork,hotMaterial,true);hot.position.z=8;
  const sheathWork=new Metalwork();
  for(let i=0;i<5;i++)for(let j=0;j<40;j++){
    const p=(k:number):Point=>{const t=k/40,a=i*Math.PI*2/5+t*20,r=.32+Math.sin(t*43+i)*.045;return [Math.cos(a)*r,Math.sin(a)*r,t];};
    sheathWork.rod(p(j),p(j+1),.003,5);
  }
  const sheath=add(sheathWork,new PBRMaterial({texture:white,color:[.06,.16,.19],emissive:[.1,.65,.9],roughness:1,metallic:0,alphaMode:'OPAQUE'}),true);sheath.position.z=8;
  const spill=new PointLight({position:[0,0,0],color:[.22,.65,1],intensity:0,range:4});
  const lights=[spill];
  const setEnergy=(material:PBRMaterial,k:number):void=>{material.emissive[0]=k*.24;material.emissive[1]=k*1.9;material.emissive[2]=k*2.5;};
  const update=(state:{charge:number;pulse:number;beam:number;beamLength:number}):void=>{
    const charge=clamp(state.charge),pulse=clamp(state.pulse),age=state.beam;
    const firing=age>0&&age<1.6;
    const width=firing?clamp(age/.08)*clamp((1.6-age)/.35):0;
    // Cooling is driven by beam age even if the timeline still supplies charge=1.
    const heat=age>0?Math.max(0,1-age/2.4):charge;
    for(let i=0;i<coils.length;i++){const k=clamp(heat*8-i);setEnergy(coils[i],k*(.2+heat*.55)+pulse*.3);}
    setEnergy(railMaterial,heat*heat*.2+pulse*.15);setEnergy(lensMaterial,heat*.8+pulse);
    setEnergy(coreMaterial,heat*heat*1.1+pulse+width*3);
    core.visible=heat>0||pulse>0||firing;
    const radius=.025+heat*heat*.2+pulse*.065+width*.16;core.scale.set(radius,radius,radius*.38);
    inner.rotation.setFromEuler(0,0,heat*.35+Math.sin(heat*100)*heat*heat*.012);
    beam.visible=hot.visible=sheath.visible=firing&&state.beamLength>0;
    beam.scale.set(width,width,Math.max(.001,state.beamLength));hot.scale.copy(beam.scale);sheath.scale.copy(beam.scale);
    sheath.rotation.setFromEuler(0,0,age*2.3);
    const q=root.rotation,z=4.6;
    spill.position.set(root.position.x+2*(q.x*q.z+q.w*q.y)*z,root.position.y+2*(q.y*q.z-q.w*q.x)*z,root.position.z+(1-2*(q.x*q.x+q.y*q.y))*z);
    spill.intensity=heat*heat*.65+pulse*.25+width*2.1;
  };
  const rest={charge:0,pulse:0,beam:0,beamLength:0};
  const reset=():void=>update(rest);reset();
  return {root,textures,geometries,nativeMaterials:[],lights,apertureDistance:8,update,reset,dispose(){reset();for(const child of [...root.children])root.remove(child);}};
}
