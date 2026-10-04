import { Geometry, Group, Mesh, NativeMaterial3D, PBRMaterial, PointLight, Texture } from 'xyz.js';
import type { ShipModel } from './ship-model.ts';

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
  face(points: Point[]): void {
    const a=points[0],b=points[1],c=points[2];
    let x=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
    let y=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    let z=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    let n=Math.hypot(x,y,z);
    if(n<1e-8){const d=points[3];x=(c[1]-a[1])*(d[2]-a[2])-(c[2]-a[2])*(d[1]-a[1]);y=(c[2]-a[2])*(d[0]-a[0])-(c[0]-a[0])*(d[2]-a[2]);z=(c[0]-a[0])*(d[1]-a[1])-(c[1]-a[1])*(d[0]-a[0]);n=Math.hypot(x,y,z);}
    if(n<1e-8)return;
    const start=this.positions.length/3;
    for(const p of points){this.positions.push(...p);this.normals.push(x/n,y/n,z/n);this.uvs.push(p[2]/3,(Math.abs(x)>Math.abs(y)?p[1]:p[0])/3);}
    for(let i=1;i<points.length-1;i++)this.indices.push(start,start+i,start+i+1);
  }
  lathe(profile:Profile,segments=32):void {
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
  geometry():Geometry{return new Geometry({positions:this.positions,normals:this.normals,uvs:this.uvs,indices:this.indices});}
}
const clamp=(v:number):number=>Math.max(0,Math.min(1,v));
function ring(z:number,r:number,w:number):Profile{return [[z-w,r],[z-w*.7,r+w*.7],[z,r+w],[z+w*.7,r+w*.7],[z+w,r],[z+w*.7,r-w*.7],[z,r-w],[z-w*.7,r-w*.7],[z-w,r]];}

export async function createWeaponModel(source:ShipModel):Promise<WeaponModel>{
  const root=new Group(),geometries:Geometry[]=[];
  const [albedo,normal,mr,ao,white]=source.textures;
  const sampler={addressModeU:'repeat',addressModeV:'repeat',minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'} as const;
  const metal=(color:Point,roughness:number,metallic:number)=>new PBRMaterial({texture:albedo,color,normalTexture:normal,normalScale:.55,metallicRoughnessTexture:mr,occlusionTexture:ao,occlusionStrength:.65,roughness,metallic,alphaMode:'OPAQUE',textureSampler:sampler,normalSampler:sampler,metallicRoughnessSampler:sampler,occlusionSampler:sampler});
  const armor=metal([.78,.84,.82],.82,.25),chassis=metal([.11,.16,.19],.8,.78),trim=metal([.52,.63,.67],.48,.92),copper=metal([.52,.26,.12],.65,.85);
  const energy=()=>new PBRMaterial({texture:white,color:[.025,.07,.08],emissive:[0,0,0],roughness:.36,metallic:.4,alphaMode:'OPAQUE'});
  const add=(work:Metalwork,material:PBRMaterial,glow=false,parent:Group=root):Mesh=>{const geometry=work.geometry();geometries.push(geometry);return parent.add(new Mesh({geometry,material,castShadow:!glow,receiveShadow:!glow}));};
  const body=new Metalwork(),plates=new Metalwork(),edges=new Metalwork(),radiators=new Metalwork(),rails=new Metalwork();
  body.lathe([[-8,0],[-8,1.3],[-7.65,1.9],[-6.9,2.05],[-3.3,2.05],[-2.6,1.25],[6.8,.76],[7.6,.92],[8,1.08],[8,.66],[7.45,.53],[-2.7,.53],[-2.7,0]],32);
  for(const z of [-7.5,-6.7,-3.5,-2.6,6.5])edges.lathe(ring(z,z< -3?2.08:1.22,.12),32);
  // Six separated armored reactor petals expose cooling trenches and load-bearing pylons.
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    plates.rail([[-7.65,2,.24,.12],[-7.1,2.45,.67,.38],[-4.35,2.45,.67,.38],[-3.65,2.05,.45,.22]],a);
    plates.rail([[-5.9,2.55,.34,.14],[-5.5,3.1,.42,.35],[-4.2,3.1,.42,.35],[-3.7,2.4,.25,.16]],a);
    edges.rail([[-4.8,2.35,.16,.17],[-2.1,1.64,.15,.16],[5.6,1.64,.1,.12],[7.9,1.15,.09,.12]],a);
    rails.rail([[-2.4,1.57,.05,.04],[5.7,1.57,.05,.04],[7.6,1.09,.035,.03]],a);
    for(let j=0;j<9;j++)radiators.rail([[-6.8+j*.29,2.17,.23,.03],[-6.67+j*.29,2.17,.23,.03]],a+Math.PI/6);
    edges.rail([[-7.85,1.5,.15,.13],[-7.3,2.7,.14,.13]],a);
  }
  add(body,chassis);add(plates,armor);add(edges,trim);add(radiators,copper);
  const railMaterial=energy();add(rails,railMaterial,true);
  const coils:PBRMaterial[]=[];
  for(let i=0;i<8;i++){
    const z=-2+i*1.08,r=1.13-i*.027;
    const mount=new Metalwork();mount.lathe(ring(z,r+.035,.18));add(mount,chassis);
    const winding=new Metalwork();winding.lathe(ring(z,r+.17,.058),48);
    const material=energy();coils.push(material);add(winding,material,true);
    const flange=new Metalwork();flange.lathe(ring(z-.24,r+.03,.055));flange.lathe(ring(z+.24,r+.03,.055));add(flange,copper);
  }
  const aperture=new Metalwork();aperture.lathe([[7.6,.88],[7.7,1.13],[7.93,1.2],[8,1.08],[8,.66],[7.83,.62],[7.6,.88]],48);add(aperture,trim);
  const inner=new Group();root.add(inner);
  const iris=new Metalwork();
  for(let i=0;i<9;i++)iris.rail([[7.76,.71,.025,.015],[7.95,.76,.11,.045],[8,.8,.08,.025]],i*Math.PI*2/9);
  add(iris,copper,false,inner);
  const coreMaterial=energy(),sphere=Geometry.sphere(1,32,20);geometries.push(sphere);
  const core=root.add(new Mesh({geometry:sphere,material:coreMaterial,castShadow:false,receiveShadow:false}));core.position.z=8;
  const lensWork=new Metalwork();lensWork.lathe(ring(7.88,.54,.04),48);const lensMaterial=energy();add(lensWork,lensMaterial,true);
  const beamWork=new Metalwork();beamWork.lathe([[0,0],[0,.36],[.015,.3],[.98,.2],[1,0]],12);
  const beamMaterial=new PBRMaterial({texture:white,color:[.2,.65,.75],emissive:[.8,3,4],roughness:1,metallic:0});
  const beam=add(beamWork,beamMaterial,true);beam.position.z=8;
  const hotWork=new Metalwork();hotWork.lathe([[0,0],[0,.12],[.02,.105],[.995,.06],[1,0]],12);
  const hotMaterial=new PBRMaterial({texture:white,color:[.85,1,1],emissive:[5,6,6],roughness:1,metallic:0});
  const hot=add(hotWork,hotMaterial,true);hot.position.z=8;
  const setEnergy=(material:PBRMaterial,k:number):void=>{material.emissive[0]=k*.24;material.emissive[1]=k*1.9;material.emissive[2]=k*2.5;};
  const update=(state:{charge:number;pulse:number;beam:number;beamLength:number}):void=>{
    const charge=clamp(state.charge),pulse=clamp(state.pulse),age=state.beam;
    const firing=age>0&&age<1.6;
    const width=firing?clamp(age/.08)*clamp((1.6-age)/.35):0;
    // Cooling is driven by beam age even if the timeline still supplies charge=1.
    const heat=age>0?Math.max(0,1-age/2.4):charge;
    for(let i=0;i<coils.length;i++){const k=clamp(heat*8-i);setEnergy(coils[i],k*(.8+heat*1.8)+pulse*2);}
    setEnergy(railMaterial,heat*heat*.85+pulse);setEnergy(lensMaterial,heat*2.5+pulse*4);
    setEnergy(coreMaterial,heat*heat*4+pulse*5+width*3);
    core.visible=heat>0||pulse>0||firing;
    const radius=.025+heat*heat*.48+pulse*.15+width*.16;core.scale.set(radius,radius,radius*.72);
    inner.rotation.setFromEuler(0,0,heat*.35+Math.sin(heat*100)*heat*heat*.012);
    beam.visible=hot.visible=firing&&state.beamLength>0;
    beam.scale.set(width,width,Math.max(.001,state.beamLength));hot.scale.copy(beam.scale);
  };
  const rest={charge:0,pulse:0,beam:0,beamLength:0};
  const reset=():void=>update(rest);reset();
  return {root,textures:[],geometries,nativeMaterials:[],lights:[],apertureDistance:8,update,reset,dispose(){reset();for(const child of [...root.children])root.remove(child);}};
}
