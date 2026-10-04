import { Geometry, Group, Mesh, PBRMaterial, Texture, Vector3 } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract.ts';
import { BARREL_HEIGHT, BARREL_OFFSETS, MUZZLE_Z, SHIP_TURRET_MOUNTS } from './ship-hardpoints.ts';

export interface ShipModel {
  root: Group;
  textures: Texture[];
  geometries: Geometry[];
  /** Three exhaust throats followed by three plumes; mutable PBR emissive RGB controls thrust. */
  engines: Mesh[];
  turrets: { root: Group; barrels: Group; muzzles: readonly Vector3[] }[];
}

type Point = [number, number, number];
export type ShipHullClass = 'capital' | 'cruiser' | 'frigate';
type Section = [number, number, number]; // z, half-width, half-height

type Color = [number, number, number];
/** Separate face vertices preserve hard bevels, rather than smoothing across armor edges. */
class HullBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private indices: number[] = [];
  private colors: number[] = [];
  tint: Color = [1,1,1];

  face(points: Point[], hint: Point, uv?: [number, number][]): void {
    let ordered = points;
    let tex = uv;
    const normal = (p: Point[]) => {
      const a = p[0], b = p[1], c = p[2];
      const x = (b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
      const y = (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
      const z = (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      const d = Math.hypot(x,y,z) || 1;
      return [x/d,y/d,z/d] as Point;
    };
    let n = normal(ordered);
    if (n[0]*hint[0]+n[1]*hint[1]+n[2]*hint[2] < 0) {
      ordered = [...points].reverse(); tex = uv ? [...uv].reverse() : undefined; n = normal(ordered);
    }
    const start = this.positions.length/3;
    ordered.forEach((p,i) => {
      this.positions.push(...p); this.normals.push(...n);
      this.colors.push(...this.tint);
      // One ship-length atlas: opposing faces share construction logic, never a repeated four-unit tile.
      const coords = tex?.[i] ?? (Math.abs(n[1]) >= Math.max(Math.abs(n[0]),Math.abs(n[2])) ? [p[0]/5+.5,(p[2]+5.8)/12] : Math.abs(n[0]) > Math.abs(n[2]) ? [(p[2]+5.8)/12,p[1]/5+.5] : [p[0]/5+.5,p[1]/5+.5]);
      this.uvs.push(coords[0],coords[1]);
    });
    for (let i=1;i<ordered.length-1;i++) this.indices.push(start,start+i,start+i+1);
  }

  sweep(sections: Section[], center: Point = [0,0,0]): void {
    const shape = [[1,.4],[.72,1],[-.72,1],[-1,.4],[-1,-.4],[-.72,-1],[.72,-1],[1,-.4]];
    const rings = sections.map(([z,w,h]) => shape.map(([x,y]) => [center[0]+x*w,center[1]+y*h,center[2]+z] as Point));
    this.face(rings[0],[0,0,-1]); this.face(rings[rings.length-1],[0,0,1]);
    for (let r=0;r<rings.length-1;r++) for (let i=0;i<8;i++) {
      const j=(i+1)%8;
      this.face([rings[r][i],rings[r][j],rings[r+1][j],rings[r+1][i]], [shape[i][0]+shape[j][0],shape[i][1]+shape[j][1],0]);
    }
  }

  /** A chamfered arbitrary polygon plate; polygon vertices may follow a sloping deck. */
  plate(outline: Point[], thickness: number, bevel = .08): void {
    const center: Point = [0,0,0];
    for (const p of outline) for (let a=0;a<3;a++) center[a] += p[a]/outline.length;
    const lower = outline.map(p => [p[0],p[1]-thickness,p[2]] as Point);
    const upper = outline.map(p => [p[0]+(center[0]-p[0])*bevel,p[1]+thickness*.35,p[2]+(center[2]-p[2])*bevel] as Point);
    this.face(upper,[0,1,0]); this.face(lower,[0,-1,0]);
    for (let i=0;i<outline.length;i++) {
      const j=(i+1)%outline.length;
      const outward: Point = [(outline[i][0]+outline[j][0])/2-center[0],0,(outline[i][2]+outline[j][2])/2-center[2]];
      this.face([lower[i],lower[j],outline[j],outline[i]],outward);
      this.face([outline[i],outline[j],upper[j],upper[i]],[outward[0],1,outward[2]]);
    }
  }


  /** Extruded armor in any plane; bevels can join the exposed-metal batch. */
  panel(outline: Point[], axis: Point, thickness: number, bevel: number, rim: HullBuilder): void {
    const center:Point=[0,0,0];
    for(const p of outline) for(let a=0;a<3;a++) center[a]+=p[a]/outline.length;
    const back=outline.map(p=>p.map((v,a)=>v-axis[a]*thickness) as Point);
    const top=outline.map(p=>p.map((v,a)=>v+(center[a]-v)*bevel+axis[a]*thickness*.2) as Point);
    this.face(top,axis);this.face(back,axis.map(v=>-v) as Point);
    for(let i=0;i<outline.length;i++) {
      const j=(i+1)%outline.length;
      const hint=outline[i].map((v,a)=>(v+outline[j][a])*.5-center[a]) as Point;
      rim.face([back[i],back[j],outline[j],outline[i]],hint);
      rim.face([outline[i],outline[j],top[j],top[i]],hint.map((v,a)=>v+axis[a]) as Point);
    }
  }
  /** Revolved, hollow nozzle profile, with a deliberately faceted metallic collar. */
  lathe(profile: [number,number][], x: number, y: number, segments: number): void {
    for (let k=0;k<profile.length-1;k++) for (let i=0;i<segments;i++) {
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2;
      const [z0,r0]=profile[k], [z1,r1]=profile[k+1];
      const radial=z1-z0;
      const hint: Point = [Math.cos((a+b)/2)*radial,Math.sin((a+b)/2)*radial,r0-r1];
      this.face([[x+r0*Math.cos(a),y+r0*Math.sin(a),z0],[x+r0*Math.cos(b),y+r0*Math.sin(b),z0],[x+r1*Math.cos(b),y+r1*Math.sin(b),z1],[x+r1*Math.cos(a),y+r1*Math.sin(a),z1]],hint,
        [[i/segments,k/(profile.length-1)],[(i+1)/segments,k/(profile.length-1)],[(i+1)/segments,(k+1)/(profile.length-1)],[i/segments,(k+1)/(profile.length-1)]]);
    }
  }

  /** Continuous swept round pipe, with shared bends but hard-edged metal facets. */
  pipe(path: Point[], radius: number, segments = 12): void {
    const rings = path.map((p,k) => {
      const before=path[Math.max(0,k-1)],after=path[Math.min(path.length-1,k+1)];
      const tangent:Point=[after[0]-before[0],after[1]-before[1],after[2]-before[2]];
      const length=Math.hypot(...tangent);
      for(let a=0;a<3;a++) tangent[a]/=length;
      const reference:Point=Math.abs(tangent[1])>.9 ? [1,0,0] : [0,1,0];
      const u:Point=[tangent[1]*reference[2]-tangent[2]*reference[1],tangent[2]*reference[0]-tangent[0]*reference[2],tangent[0]*reference[1]-tangent[1]*reference[0]];
      const width=Math.hypot(...u);
      for(let a=0;a<3;a++) u[a]/=width;
      const v:Point=[tangent[1]*u[2]-tangent[2]*u[1],tangent[2]*u[0]-tangent[0]*u[2],tangent[0]*u[1]-tangent[1]*u[0]];
      return Array.from({length:segments},(_,i) => {
        const angle=i/segments*Math.PI*2;
        return p.map((value,a)=>value+radius*(u[a]*Math.cos(angle)+v[a]*Math.sin(angle))) as Point;
      });
    });
    this.face(rings[0],path[0].map((value,a)=>value-path[1][a]) as Point);
    this.face(rings[rings.length-1],path[path.length-1].map((value,a)=>value-path[path.length-2][a]) as Point);
    for(let k=0;k<rings.length-1;k++) for(let i=0;i<segments;i++) {
      const j=(i+1)%segments;
      const hint=rings[k][i].map((value,a)=>value-path[k][a]) as Point;
      this.face([rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]],hint);
    }
  }

  geometry(): Geometry { return new Geometry({positions:this.positions,normals:this.normals,uvs:this.uvs,indices:this.indices,colors:this.colors}); }
}

async function shipTextures(): Promise<Texture[]> {
  const bound = CONTRACT.visual.textureSize;
  if (!Number.isInteger(bound) || bound < 64 || bound > 2048) throw new Error('Ship texture bound must be 64..2048');
  const size = Math.min(1024,bound);
  const canvas=document.createElement('canvas'); canvas.width=size; canvas.height=size;
  const ctx=canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create procedural ship textures');
  const random=seededRandom(CONTRACT.seed ^ 0x51a7);
  const height=new Float32Array(size*size), panels=new Float32Array(size*size);
  const grain=new Float32Array(size*size);
  // Staggered unequal plates, with broad underlying machining variation, not pixel noise.
  const rowCount=32, rowHeight=size/rowCount;
  for (let row=0;row<rowCount;row++) {
    let left=0;
    while (left<size) {
      const right=Math.min(size,left+size*(.025+random()*.07));
      const shade=.9+random()*.09;
      for (let y=Math.floor(row*rowHeight);y<Math.min(size,Math.ceil((row+1)*rowHeight));y++) for(let x=Math.floor(left);x<right;x++) {
        const i=y*size+x;
        const seam=Math.min(x-left,right-x,y-row*rowHeight,(row+1)*rowHeight-y);
        // Recessed seams, a raised access lid and corner screws share the same physical panel grid.
        const width=right-left, localX=(x-left)/width, localY=(y-row*rowHeight)/rowHeight;
        const access=row%3===1 && width>size*.055;
        const lidEdge=access ? Math.min(Math.abs(localX-.23),Math.abs(localX-.77))*width : size;
        const lidHorizontal=access ? Math.min(Math.abs(localY-.27),Math.abs(localY-.73))*rowHeight : size;
        const lidSeam=access && ((localY>.27 && localY<.73 && lidEdge<size*.0018) || (localX>.23 && localX<.77 && lidHorizontal<size*.0018));
        const screwX=Math.min(Math.abs(x-left-size*.004),Math.abs(right-x-size*.004));
        const screwY=Math.min(Math.abs(y-row*rowHeight-size*.004),Math.abs((row+1)*rowHeight-y-size*.004));
        const screw=Math.hypot(screwX,screwY)<size*.0014;
        height[i]=lidSeam || screw ? .4 : Math.min(1,seam/(size*.0013));
        panels[i]=shade-(access && localX>.23 && localX<.77 && localY>.27 && localY<.73 ? .045 : 0);
        grain[i]=random()-.5;
      }
      left=right;
    }
  }
  const textures:Texture[]=[];
  for (let map=0;map<4;map++) {
    const image=ctx.createImageData(size,size);
    for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
      const i=y*size+x,j=i*4,h=height[i],p=panels[i];
      const streak=Math.pow(.5+.5*Math.sin(x/size*439+Math.sin(x/size*127)*4.7),22)*(.5+.5*Math.sin(y/size*19+x/size*17));
      const scorch=Math.exp(-((x/size-.49)**2/.045+(y/size-.88)**2/.013))*.17;
      const wear=Math.pow(1-h,2)*.12;
      const weather=Math.sin(x/size*43+y/size*7)*Math.sin(y/size*67)*.018+grain[i]*.014-streak*.07-scorch+wear;
      if (map===0) {
        const value=(.42+h*.58)*(p+weather);
        image.data[j]=Math.round(246*value); image.data[j+1]=Math.round(243*value); image.data[j+2]=Math.round(232*value);
      } else if(map===1) {
        const dx=(height[y*size+(x+1)%size]-height[y*size+(x+size-1)%size])*.34;
        const dy=(height[((y+1)%size)*size+x]-height[((y+size-1)%size)*size+x])*.34;
        const d=Math.hypot(dx,dy,1);
        image.data[j]=Math.round(128-dx/d*127); image.data[j+1]=Math.round(128-dy/d*127); image.data[j+2]=Math.round(128+127/d);
      } else if(map===2) {
        image.data[j]=255; image.data[j+1]=Math.round(255*(.62+(1-p)*.55+(1-h)*.25+streak*.2+scorch-wear*.6)); image.data[j+2]=Math.round(255*(.78+(1-h)*.2));
      } else {
        image.data[j]=image.data[j+1]=image.data[j+2]=Math.round(255*(.48+h*.52));
      }
      image.data[j+3]=255;
    }
    ctx.putImageData(image,0,0); textures.push(await Texture.fromImage(canvas));
  }
  canvas.width=1; canvas.height=1; ctx.fillStyle='#fff'; ctx.fillRect(0,0,1,1);
  textures.push(await Texture.fromImage(canvas));
  canvas.width=Math.min(256,bound);canvas.height=Math.min(256,bound);
  const plume=ctx.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
    const v=y/(canvas.height-1),i=(y*canvas.width+x)*4;
    const fade=Math.exp(-v*4.5)*(1-v)*(1-v);
    plume.data[i]=195+60*(1-v);plume.data[i+1]=210+45*(1-v);plume.data[i+2]=255;
    plume.data[i+3]=Math.round(155*fade);
  }
  ctx.putImageData(plume,0,0);textures.push(await Texture.fromImage(canvas));
  const throat=ctx.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
    const dx=(x+.5)/canvas.width*2-1,dy=(y+.5)/canvas.height*2-1;
    const r=Math.hypot(dx,dy),a=Math.atan2(dy,dx),i=(y*canvas.width+x)*4;
    const ducts=.4+.6*Math.pow(.5+.5*Math.cos(a*18+r*8),3);
    const rings=.55+.45*Math.pow(.5+.5*Math.cos(r*46),2);
    const value=Math.round(255*Math.max(.045,(1-r*.6)*ducts*rings));
    throat.data[i]=throat.data[i+1]=throat.data[i+2]=value;throat.data[i+3]=255;
  }
  ctx.putImageData(throat,0,0);textures.push(await Texture.fromImage(canvas));
  canvas.width=Math.min(512,bound);canvas.height=Math.min(256,bound);
  ctx.fillStyle='#d3d7cb';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#26383c';ctx.font=`700 ${Math.floor(canvas.height*.52)}px monospace`;
  ctx.fillText('LT—02',canvas.width*.06,canvas.height*.6);
  ctx.font=`600 ${Math.floor(canvas.height*.13)}px monospace`;
  ctx.fillText('PATROL / 07',canvas.width*.075,canvas.height*.84);
  ctx.fillStyle='#a46535';ctx.fillRect(canvas.width*.89,canvas.height*.16,canvas.width*.045,canvas.height*.68);
  textures.push(await Texture.fromImage(canvas));
  return textures;
}

/** Forward -Z, dorsal +Y. Solid hull spans -5.6..4.95 Z; exhaust reaches +6.3. */
export async function createShipModel(hullClass: ShipHullClass = 'capital', sharedTextures?: Texture[]): Promise<ShipModel> {
  const textures=sharedTextures ?? await shipTextures();
  const [albedo,normal,metallicRoughness,ao,white,plumeMap,throatMap,registryMap]=textures;
  const root=new Group(), geometries:Geometry[]=[], engines:Mesh[]=[];
  const sampler={addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge',minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'} as const;
  const metal=(color:Color,roughness=.8,metallic=.7) => new PBRMaterial({texture:albedo,color,normalTexture:normal,normalScale:.38,metallicRoughnessTexture:metallicRoughness,occlusionTexture:ao,occlusionStrength:.7,roughness,metallic,alphaMode:'OPAQUE',textureSampler:sampler,normalSampler:sampler,metallicRoughnessSampler:sampler,occlusionSampler:sampler});
  const armor=metal([.73,.77,.73],.87,.055), structure=metal([.16,.22,.25],.93,.72), edges=metal([.49,.57,.6],.55,.98), radiator=metal([.37,.22,.14],.82,.93);
  const windowMaterial=new PBRMaterial({texture:white,color:[.13,.27,.35],metallic:.4,roughness:.25,emissive:[.12,.3,.4],alphaMode:'OPAQUE'});
  const registryMaterial=new PBRMaterial({texture:registryMap,color:[1,1,1],metallic:.2,roughness:.8,alphaMode:'OPAQUE'});
  const add=(builder:HullBuilder,material:PBRMaterial):Mesh => {
    const geometry=builder.geometry();geometries.push(geometry);
    return root.add(new Mesh({geometry,material,castShadow:material===armor||material===structure||material===edges,receiveShadow:material.alphaMode==='OPAQUE'&&material!==windowMaterial&&material!==registryMaterial}));
  };
  const chassis=new HullBuilder(), plating=new HullBuilder(), trim=new HullBuilder(), fins=new HullBuilder(), windows=new HullBuilder(), markings=new HullBuilder();
  // The pressure hull sits below the armor: the spine channel is open geometry, not a painted seam.
  chassis.sweep([[-5.6,.035,.035],[-4.6,.4,.16],[-2.6,.93,.28],[-.5,1.52,.37],[1.8,1.64,.4],[3.7,1.38,.36],[4.5,1.17,.32]]);
  // Raised port/starboard armor leaves an actual open shadow channel along the spine.
  const bands:[number,number,number,number,number,number][]=[[-4.85,-2.7,.30,.88,.18,.38],[-2.64,-.65,.9,1.47,.39,.56],[-.58,1.48,1.5,1.63,.57,.61],[1.55,3.58,1.62,1.37,.61,.51]];
  for(const side of [-1,1]) for(const [z0,z1,w0,w1,y0,y1] of bands) {
    for(let panel=0;panel<3;panel++) {
      const t0=panel/3,t1=(panel+1)/3;
      const a=z0+(z1-z0)*t0+.025,b=z0+(z1-z0)*t1-.025;
      const wa=w0+(w1-w0)*t0,wb=w0+(w1-w0)*t1;
      const ya=y0+(y1-y0)*t0,yb=y0+(y1-y0)*t1;
      const shade=.84+((panel+(side+1)/2+Math.floor(z0+5))%3)*.075;
      plating.tint=[shade,shade*.985,Math.min(1,shade*1.015)];
      plating.panel([[side*.22,ya,a+.07],[side*wa*.7,ya,a],[side*wb*.75,yb,b-.06],[side*.25,yb,b]],[0,1,0],.08,.075,trim);
    }
    // Lower shoulder armor is sloped, thick, and offset from the primary deck.
    trim.plate([[side*w0*.72,y0-.04,z0],[side*w0*.98,y0*.35,z0+.18],[side*w1*.98,y1*.35,z1-.1],[side*w1*.73,y1-.04,z1]],.055,.055);
  }
  plating.tint=[1,1,1];
  // Raised longitudinal conduits and spaced cross-ribs remain inside the recessed channel.
  for(const side of [-1,1]) {
    fins.pipe([[side*.12,.31,-2.65],[side*.12,.44,-1.7],[side*.12,.46,.05]],.038);
    fins.pipe([[side*.12,.46,2.0],[side*.12,.44,3.6],[side*.42,.24,4.25]],.045);
  }
  for(const [start,count,y] of [[-2.35,11,.38],[2.05,9,.42]]) for(let i=0;i<count;i++) {
    const z=start+i*.17;
    trim.pipe([[-.23,y,z],[-.17,y+.075,z],[.17,y+.075,z],[.23,y,z]],.025,8);
  }
  // Keel, prow split and long recessed machinery rails are structural, not ornament cubes.
  trim.sweep([[-4.5,.09,.08],[-1.8,.16,.13],[2.8,.2,.14],[4.1,.14,.1]],[0,-.43,0]);
  for(const side of [-1,1]) {
    trim.pipe([[side*.27,.38,-2.7],[side*.29,.53,-.4],[side*.29,.53,.2]],.042);
    trim.pipe([[side*.29,.49,2.05],[side*.29,.46,3.5],[side*.48,.2,4.25]],.045);
    chassis.sweep([[1.8,.25,.24],[3.15,.43,.34],[4.65,.37,.3]],[side*.86,-.025,0]);
    plating.plate([[side*.98,.49,1.9],[side*1.44,.36,2.24],[side*1.3,.35,4.2],[side*.78,.44,3.7]],.07,.1);
  }
  // Ventral keel assemblies expose paired tanks, coolant lines and transverse mounting saddles.
  for(const side of [-1,1]) {
    chassis.pipe([[side*.57,-.39,-1.5],[side*.64,-.49,-.9],[side*.64,-.49,2.15],[side*.5,-.3,2.65]],.13,16);
    fins.pipe([[side*.84,-.26,-2.55],[side*.91,-.48,-1.4],[side*.91,-.48,2.5],[side*.77,-.18,3.7]],.047);
    for(let i=0;i<6;i++) {
      const z=-1.1+i*.53;
      trim.pipe([[side*.28,-.39,z],[side*.55,-.62,z],[side*.8,-.57,z]],.055,10);
    }
    plating.plate([[side*.23,-.46,-2.7],[side*.72,-.46,-2.36],[side*.8,-.46,-1.66],[side*.26,-.46,-1.8]],.075,.12);
    plating.plate([[side*.28,-.52,.65],[side*.81,-.52,.82],[side*.7,-.52,1.68],[side*.25,-.52,1.54]],.085,.12);
  }
  // Outboard mission sponsons: the roof, sill and bulkheads enclose empty space,
  // leaving the maintenance chambers genuinely recessed instead of painting black rectangles.
  for(const side of [-1,1]) {
    const chambers=hullClass==='frigate' ? [[-1.22,.8,1.52,1.85,.52]] : [[-2.75,-1.45,1.44,1.94,.42],[-1.22,1.3,1.74,hullClass==='cruiser'?2.36:2.16,.59]];
    for(const [z0,z1,inside,outside,roof] of chambers) {
      const axis:Point=[side,0,0], inner=side*inside, outer=side*outside;
      chassis.face([[inner,-.29,z0],[inner,roof-.1,z0],[inner,roof-.1,z1],[inner,-.29,z1]],axis);
      chassis.face([[inner,-.29,z0],[outer,-.29,z0],[outer,-.29,z1],[inner,-.29,z1]],[0,1,0]);
      for(const z of [z0,z1]) {
        chassis.face([[inner,-.29,z],[outer,-.29,z],[outer,roof,z],[inner,roof,z]],[0,0,z===z0?1:-1]);
        plating.panel([[outer,-.32,z-.055],[outer,roof-.05,z-.055],[outer,roof-.05,z+.055],[outer,-.32,z+.055]],axis,.065,.14,trim);
      }
      plating.panel([[inner-.08*side,roof,z0-.12],[outer-.1*side,roof,z0-.12],[outer,roof,z0+.12],[outer,roof,z1-.12],[outer-.1*side,roof,z1+.12],[inner-.08*side,roof,z1+.12]],[0,1,0],.075,.065,trim);
      plating.panel([[outer,-.32,z0],[outer,-.22,z0],[outer,-.22,z1],[outer,-.32,z1]],axis,.07,.1,trim);
      plating.panel([[outer,roof-.12,z0],[outer,roof,z0],[outer,roof,z1],[outer,roof-.12,z1]],axis,.075,.1,trim);
      // Door leaves park inside the bulkheads; a double guide rail and threshold show the opening.
      for(const [a,b] of [[z0+.08,z0+.31],[z1-.31,z1-.08]]) {
        plating.panel([[inner+side*.035,-.22,a],[inner+side*.035,roof-.13,a],[inner+side*.035,roof-.13,b],[inner+side*.035,-.22,b]],axis,.035,.07,trim);
        for(let i=0;i<4;i++) {
          const z=a+(b-a)*(i+.5)/4;
          trim.pipe([[inner+side*.06,-.19,z],[inner+side*.06,roof-.16,z]],.012,6);
        }
      }
      for(const y of [-.19,roof-.16]) trim.pipe([[outer-side*.07,y,z0+.1],[outer-side*.07,y,z1-.1]],.022,8);
      // Recessed service manifold, organized power looms and floor docking tracks.
      const middle=(z0+z1)*.5;
      chassis.pipe([[inner+side*.065,.03,middle-.28],[inner+side*.065,.03,middle+.28]],.105,12);
      for(let cable=0; cable<3; cable++) {
        const y=.16+cable*.045;
        fins.pipe([[inner+side*.075,y,z0+.36],[inner+side*.14,y,middle-.22],[inner+side*.14,y,middle+.22],[inner+side*.075,y,z1-.36]],.014,6);
      }
      for(const offset of [.12,.29]) trim.pipe([[inner+side*offset,-.26,z0+.12],[inner+side*offset,-.26,z1-.12]],.018,8);
      for(const z of [z0+.39,z1-.39]) {
        trim.pipe([[inner+side*.09,-.2,z],[inner+side*.09,roof-.19,z],[outer-side*.11,roof-.19,z]],.025,8);
        windows.face([[outer-side*.035,roof-.165,z-.09],[outer-side*.035,roof-.13,z-.09],[outer-side*.035,roof-.13,z+.09],[outer-side*.035,roof-.165,z+.09]],axis);
      }
      // Bolted roof access covers and straps align with the chamber below.
      for(const z of [z0+.34,z1-.34]) {
        plating.panel([[inner,roof+.025,z-.15],[outer-side*.14,roof+.025,z-.15],[outer-side*.14,roof+.025,z+.15],[inner,roof+.025,z+.15]],[0,1,0],.025,.13,trim);
        for(const x of [inner+side*.035,outer-side*.18]) for(const dz of [-.1,.1]) {
          trim.pipe([[x,roof+.024,z+dz],[x,roof+.047,z+dz]],.015,6);
        }
      }
    }
    // Transverse load-bearing shoulders feed the side chambers and aft propulsion pods.
    for(const z of [-1.36,1.43]) {
      chassis.sweep([[z-.16,.52,.15],[z,.7,.19],[z+.16,.54,.15]],[side*1.27,-.03,0]);
      plating.panel([[side*.91,.54,z-.16],[side*1.8,.37,z-.16],[side*1.96,.31,z],[side*1.8,.37,z+.16],[side*.91,.54,z+.16]],[0,1,0],.09,.09,trim);
    }
    // Forward instrument pods use a common mounting saddle, three optical heads and a loom.
    chassis.sweep([[-3.9,.075,.045],[-3.65,.21,.12],[-3.03,.23,.14],[-2.88,.12,.07]],[side*.62,.37,0]);
    plating.panel([[side*.45,.53,-3.63],[side*.78,.53,-3.61],[side*.85,.56,-3.14],[side*.44,.56,-3.09]],[0,1,0],.045,.1,trim);
    for(const offset of [-.09,0,.09]) {
      trim.lathe([[-3.77,.048],[-3.72,.063],[-3.61,.063],[-3.58,.045]],side*.62+offset,.43,12);
      windows.face([[side*.62+offset-.028,.407,-3.772],[side*.62+offset+.028,.407,-3.772],[side*.62+offset+.028,.453,-3.772],[side*.62+offset-.028,.453,-3.772]],[0,0,-1]);
    }
    fins.pipe([[side*.64,.41,-3.05],[side*.72,.42,-2.91],[side*.85,.37,-2.75]],.028,8);
  }
  // A deep tapered ventral drive keel gives the vessel a second load-bearing silhouette.
  chassis.sweep([[-3.7,.08,.08],[-2.4,.26,.18],[-.9,.34,.22],[2.4,.3,.23],[3.7,.13,.12]],[0,-.64,0]);
  plating.panel([[-.21,-.83,-2.35],[.21,-.83,-2.35],[.28,-.92,-.8],[.23,-.91,2.35],[-.23,-.91,2.35],[-.28,-.92,-.8]],[0,-1,0],.07,.08,trim);
  for(const z of [-1.9,-.8,.3,1.4]) trim.pipe([[-.35,-.56,z],[-.4,-.75,z],[-.25,-.87,z],[.25,-.87,z],[.4,-.75,z],[.35,-.56,z]],.035,8);
  // A tapered bridge, recessed panoramic glazing and an offset sensor mast.
  const bridgeHeight=hullClass==='frigate' ? .88 : hullClass==='cruiser' ? 1.16 : 1.02;
  trim.sweep([[.15,.18,.08],[.55,.44,.22],[1.68,.4,.23],[1.95,.28,.15]],[0,bridgeHeight-.26,0]);
  plating.sweep([[.48,.3,.12],[.7,.48,.19],[1.65,.43,.2],[1.88,.27,.12]],[0,bridgeHeight,0]);
  trim.sweep([[1.35,.07,.1],[1.65,.12,.4],[1.78,.08,.32]],[.2,bridgeHeight+.28,0]);
  trim.pipe([[.2,bridgeHeight+.3,1.58],[.2,bridgeHeight+.93,1.58]],.025);
  trim.pipe([[-.08,bridgeHeight+.8,1.58],[.49,bridgeHeight+.8,1.58]],.018);
  chassis.lathe([[1.28,.09],[1.38,.13],[1.46,.13],[1.48,.09]],.2,bridgeHeight+.75,24);
  windows.face([[.135,bridgeHeight+.71,1.275],[.265,bridgeHeight+.71,1.275],[.265,bridgeHeight+.79,1.275],[.135,bridgeHeight+.79,1.275]],[0,0,-1]);
  for(const side of [-1,1]) {
    for(let i=0;i<9;i++) {
      const z=.76+i*.105,x=side*(.484-(z-.7)*.053);
      windows.face([[x,bridgeHeight+.025,z],[x,bridgeHeight+.052,z],[x-side*.003,bridgeHeight+.052,z+.037],[x-side*.003,bridgeHeight+.025,z+.037]],[side,0,0]);
    }
    // Class-specific radiator span changes the far-field silhouette without moving gun mounts.
    const vaneCount=hullClass==='frigate'?4:hullClass==='cruiser'?10:7;
    for(let i=0;i<vaneCount;i++) {
      const z=1.85+i*(1.41/vaneCount),span=hullClass==='cruiser'?2.5:hullClass==='frigate'?1.78:2.02;
      fins.plate([[side*1.37,.18,z],[side*(span-.11),.12,z+.18],[side*span,.10,z+.30],[side*1.46,.16,z+.13]],.035,.035);
      trim.pipe([[side*1.47,.17,z+.09],[side*1.91,.115,z+.24]],.024,8);
    }
    // A dark recessed vent bed, spaced louvres and two headers form each aft radiator bank.
    chassis.plate([[side*.76,.48,2.14],[side*1.17,.44,2.14],[side*1.15,.43,3.47],[side*.73,.47,3.47]],.025,.03);
    for(let i=0;i<9;i++) {
      const z=2.2+i*.14;
      trim.pipe([[side*.77,.53,z],[side*1.13,.49,z+.035]],.027,8);
    }
    fins.pipe([[side*.73,.54,2.12],[side*.7,.53,3.48],[side*1.3,.25,3.7]],.043);
    fins.pipe([[side*1.2,.5,2.12],[side*1.18,.48,3.44]],.038);
    // A pressure docking collar with backing hatch and eight radial locking dogs.
    const collar:Point[]=[],cx=side*1.66,cy=-.03,cz=.03;
    for(let i=0;i<=24;i++) {const a=i/24*Math.PI*2;collar.push([cx,cy+Math.cos(a)*.19,cz+Math.sin(a)*.19]);}
    trim.pipe(collar,.025,8);
    chassis.face(collar.slice(0,24).map(p=>[p[0]-side*.028,p[1],p[2]] as Point),[side,0,0]);
    for(let i=0;i<8;i++) {
      const a=i/8*Math.PI*2;
      trim.pipe([[cx,cy+Math.cos(a)*.155,cz+Math.sin(a)*.155],[cx+side*.036,cy+Math.cos(a)*.19,cz+Math.sin(a)*.19]],.014,6);
    }
    // Fore/aft attitude-control pods contain paired recessed exhaust bells.
    for(const z of [-3.28,3.54]) for(const y of [-.19,.2]) {
      const x=side*(z<0?.87:1.31);
      chassis.sweep([[z-.13,.09,.08],[z,.13,.11],[z+.15,.08,.07]],[x,y,0]);
      for(const offset of [-.04,.04]) {
        trim.lathe([[z-.16,.037],[z-.22,.052],[z-.24,.052],[z-.24,.031],[z-.17,.023]],x+offset,y,12);
        chassis.lathe([[z-.17,.023],[z-.13,0]],x+offset,y,12);
      }
    }
    for(let i=0;i<5;i++) {
      const z=1.42+i*.095,y=bridgeHeight+.28+(i%2)*.07;
      trim.pipe([[side*.39,bridgeHeight+.17,z],[side*.62,y,z]],.008,6);
    }
    // Discrete small apertures establish scale without a luminous stripe.
    for(let i=0;i<22;i++) {
      const z=-.95+i*.092,x=side*1.65;
      windows.face([[x,-.11,z],[x,-.087,z],[x,-.087,z+.028],[x,-.11,z+.028]],[side,0,0]);
    }
    // Follow the sloping armor surface, above its inset bevel rather than buried in the plate.
    markings.face([[side*.43,.594,-.56],[side*1.04,.594,-.56],[side*1.04,.599,-.26],[side*.43,.599,-.26]],[0,1,0],side===1?[[0,1],[1,1],[1,0],[0,0]]:[[1,0],[0,0],[0,1],[1,1]]);
  }
  // Separate local batches retain the original neutral silhouette while articulating the guns.
  const turrets: ShipModel['turrets'] = [];
  const turretBody=new HullBuilder(), turretRoof=new HullBuilder(), barrelMetal=new HullBuilder(), barrelInterior=new HullBuilder();
  turretBody.sweep([[-.24,.17,.07],[0,.24,.13],[.24,.2,.09]],[0,-.15,0]);
  turretRoof.plate([[-.21,0,-.13],[-.13,0,-.31],[.13,0,-.31],[.21,0,.16],[-.19,0,.16]],.07,.12);
  for(const offset of BARREL_OFFSETS) {
    barrelMetal.lathe([[-.82,.043],[-.78,.06],[-.66,.06],[-.62,.043],[-.27,.043],[-.24,.07],[0,.07]],offset,0,12);
    barrelMetal.lathe([[-.78,.06],[MUZZLE_Z,.055],[MUZZLE_Z,.032],[-.67,.028]],offset,0,12);
    barrelInterior.lathe([[-.67,.028],[-.58,.015],[-.58,0]],offset,0,12);
  }
  const turretGeometry=[turretBody.geometry(),turretRoof.geometry(),barrelMetal.geometry(),barrelInterior.geometry()];
  geometries.push(...turretGeometry);
  for(const [x,y,z] of SHIP_TURRET_MOUNTS) {
    const housing=root.add(new Group()), barrels=housing.add(new Group());
    housing.position.set(x,y+BARREL_HEIGHT,z);
    housing.add(new Mesh({geometry:turretGeometry[0],material:edges,castShadow:true,receiveShadow:true}));
    housing.add(new Mesh({geometry:turretGeometry[1],material:armor,castShadow:true,receiveShadow:true}));
    barrels.add(new Mesh({geometry:turretGeometry[2],material:edges,castShadow:true,receiveShadow:true}));
    barrels.add(new Mesh({geometry:turretGeometry[3],material:structure,castShadow:true,receiveShadow:true}));
    turrets.push({root:housing,barrels,muzzles:BARREL_OFFSETS.map(offset=>new Vector3(offset,0,MUZZLE_Z))});
  }
  for(const side of [-1,1]) {
    const nav=new HullBuilder(),color:Color=side<0?[.38,.018,.009]:[.012,.27,.065];
    for(const z of [-2.61,1.3]) nav.pipe([[side*1.91,.32,z],[side*1.95,.32,z]],.018,12);
    add(nav,new PBRMaterial({texture:white,color,emissive:color,metallic:0,roughness:.38,alphaMode:'OPAQUE'}));
  }
  add(chassis,structure);add(plating,armor);add(fins,radiator);add(windows,windowMaterial);add(markings,registryMaterial);
  const segments=Math.min(48,Math.max(24,Math.floor(CONTRACT.visual.terrainSegments/4)));
  const nozzle=new HullBuilder();
  const throats:Mesh[]=[],plumes:Mesh[]=[];
  for(const [x,r,warm] of [[-.81,.31,0],[0,.43,1],[.81,.31,0]]) {
    nozzle.lathe([[4.25,r*.88],[4.58,r*1.2],[4.82,r*1.22],[4.95,r*1.05],[4.95,r*.82],[4.70,r*.72],[4.54,r*.67]],x,-.02,segments);
    // Separate stepped retaining rings and eight hydraulic braces articulate the propulsion collar.
    nozzle.lathe([[4.24,r*1.04],[4.30,r*1.18],[4.37,r*1.18],[4.4,r*1.02]],x,-.02,segments);
    nozzle.lathe([[4.55,r*1.18],[4.59,r*1.29],[4.66,r*1.29],[4.7,r*1.2]],x,-.02,segments);
    for(let i=0;i<8;i++) {
      const angle=i/8*Math.PI*2,dx=Math.cos(angle),dy=Math.sin(angle);
      trim.pipe([[x+dx*r*1.13,-.02+dy*r*1.13,4.32],[x+dx*r*1.32,-.02+dy*r*1.32,4.61],[x+dx*r*1.13,-.02+dy*r*1.13,4.84]],.035,8);
    }
    // The light source is visibly recessed inside the nozzle, not pasted on its outer rim.
    const disc=new HullBuilder(), ring:Point[]=[];
    for(let i=0;i<segments;i++) {const a=i/segments*Math.PI*2;ring.push([x+Math.cos(a)*r*.67,-.02+Math.sin(a)*r*.67,4.57]);}
    disc.face(ring,[0,0,1],ring.map(p=>[(p[0]-x)/(r*1.34)+.5,(p[1]+.02)/(r*1.34)+.5]));
    disc.lathe([[4.73,r*.72],[4.76,r*.74],[4.76,r*.68],[4.73,r*.67]],x,-.02,segments);
    const glow: [number,number,number]=warm ? [2.1,.82,.23] : [.25,1.05,1.9];
    const throat=add(disc,new PBRMaterial({texture:throatMap,emissiveTexture:throatMap,color:warm?[.7,.25,.07]:[.08,.36,.65],emissive:glow,roughness:.4,metallic:.1,alphaMode:'OPAQUE'}));
    throat.receiveShadow=false;throats.push(throat);
    const exhaust=new HullBuilder();
    exhaust.lathe([[4.87,r*.52],[5.18,r*.49],[5.65,r*.27],[6.3,r*.008]],x,-.02,segments);
    exhaust.lathe([[4.87,r*.2],[5.3,r*.16],[6.05,r*.075],[6.9,r*.002]],x,-.02,segments);
    plumes.push(add(exhaust,new PBRMaterial({texture:plumeMap,emissiveTexture:plumeMap,color:warm?[1,.57,.25]:[.4,.73,1],emissive:warm?[2,.8,.24]:[.3,.9,1.8],roughness:1,metallic:0,transparent:true,opacity:.46,doubleSided:true,alphaMode:'BLEND'})));
  }
  add(trim,edges);add(nozzle,edges);engines.push(...throats,...plumes);
  return {root,textures,geometries,engines,turrets};
}
