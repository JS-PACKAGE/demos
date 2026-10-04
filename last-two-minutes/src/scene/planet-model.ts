import { Geometry, Group, InstancedMesh, Matrix4, Mesh, NativeMaterial3D, PBRMaterial, Quaternion, Texture, Vector3 } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract.ts';
import { clamp, cross, direction, fbm, noise, normalize, smooth, terrain, terrainColor, type Point } from './planet-noise.ts';

export interface PlanetModel {
  root:Group;
  surface:Mesh;
  atmosphere:Mesh;
  cracks:Mesh[];
  fragments:Group;
  textures:Texture[];
  geometries:Geometry[];
  reset():void;
  setDamage(progress:number):void;
  setBreakup(age:number):void;
}

type Vertex = { p:Point; n:Point; uv:readonly [number,number] };
type Flight = { mesh:InstancedMesh; slot:number; direction:Point; tangent:Point; aim:readonly[number,number,number,number]; size:number; depth:number; roll:number; speed:number; spin:Point };
const TAU=Math.PI*2;

async function imageTexture(width:number,height:number,pixels:Uint8ClampedArray):Promise<Texture> {
  if(width>CONTRACT.visual.textureSize||height>CONTRACT.visual.textureSize||width*height>4194304) throw new RangeError('Planet texture exceeds visual budget');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');if(!context)throw new Error('Planet texture requires Canvas 2D');
  const image=context.createImageData(width,height);image.data.set(pixels);context.putImageData(image,0,0);
  return Texture.fromImage(canvas);
}

function triangleGeometry(triangles:Vertex[]):Geometry {
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(const vertex of triangles){positions.push(...vertex.p);normals.push(...vertex.n);uvs.push(...vertex.uv);indices.push(indices.length);}
  return new Geometry({positions,normals,uvs,indices});
}

/** The position field and every map sample share a seeded 3D field, including the longitude seam. */
async function makeSurfaceMaps():Promise<Texture[]> {
  const w=CONTRACT.visual.textureSize,h=Math.floor(w/2),length=w*h;
  const color=new Uint8ClampedArray(length*4),rough=new Uint8ClampedArray(length*4),normal=new Uint8ClampedArray(length*4),cities=new Uint8ClampedArray(length*4),heights=new Float32Array(length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,k=i*4,p=direction(x/(w-1),y/(h-1)),t=terrain(...p),rgb=terrainColor(t,p[1]);
    // The mesh carries broad relief; this map adds only unresolved erosion and grain.
    heights[i]=CONTRACT.visual.terrainHeight*t.land*(.012*(t.detail-.5)-.012*t.valley+.008*t.arid*t.dune);
    for(let c=0;c<3;c++)color[k+c]=Math.round(Math.sqrt(rgb[c])*255);
    color[k+3]=rough[k+3]=normal[k+3]=cities[k+3]=255;
    rough[k]=255;rough[k+1]=Math.round((.23+(.95-.23)*t.land+(t.detail-.5)*.045)*255);rough[k+2]=0;
  }
  // Compact coastal settlements and dim connecting corridors, never a planet-wide street grid.
  const random=seededRandom(CONTRACT.seed+319),settlements:Point[]=[];
  const stamp=(p:Point,strength:number,size:number)=>{
    const u=(Math.atan2(p[2],p[0])/TAU+1)%1,v=Math.acos(clamp(p[1],-1,1))/Math.PI;
    const cx=u*(w-1),cy=v*(h-1),stretch=1/Math.max(.25,Math.sqrt(1-p[1]*p[1]));
    for(let dy=-size;dy<=size;dy++)for(let dx=-Math.ceil(size*stretch);dx<=Math.ceil(size*stretch);dx++){
      const yy=Math.round(cy+dy);if(yy<0||yy>=h)continue;
      const xx=(Math.round(cx+dx)%w+w)%w,k=(yy*w+xx)*4,r=Math.hypot(dx/stretch,dy)/size;
      const glow=Math.exp(-r*r*3.5)*strength*(.6+.4*noise(xx*.7,yy*.7,29));
      cities[k]=Math.max(cities[k]!,glow*255);cities[k+1]=Math.max(cities[k+1]!,glow*185);cities[k+2]=Math.max(cities[k+2]!,glow*100);
    }
  };
  for(let attempt=0;attempt<1500&&settlements.length<76;attempt++){
    const y=(random()-.5)*1.5,a=random()*TAU,s=Math.sqrt(1-y*y),p:Point=[Math.cos(a)*s,y,Math.sin(a)*s],t=terrain(...p);
    if(t.land<.7||t.mountain>.12||t.uplift>.12||t.moisture<.35||t.height>CONTRACT.visual.terrainHeight*.38)continue;
    if(settlements.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2])<.033))continue;
    settlements.push(p);stamp(p,.24+random()*.36,1+Math.floor(random()*2));
    let nearest:Point|undefined,distance=.26;
    for(const q of settlements){const d=Math.hypot(p[0]-q[0],p[1]-q[1],p[2]-q[2]);if(d>.01&&d<distance){nearest=q;distance=d;}}
    if(nearest)for(let step=1;step<30;step++){
      const f=step/30,q=normalize([p[0]*(1-f)+nearest[0]*f,p[1]*(1-f)+nearest[1]*f,p[2]*(1-f)+nearest[2]*f]),land=terrain(...q);
      if(land.land>.8&&land.mountain<.14&&land.uplift<.12)stamp(q,.055,1);
    }
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,k=i*4,latitude=Math.sin(y/(h-1)*Math.PI);
    const left=heights[y*w+(x===0?w-2:x-1)]!,right=heights[y*w+(x===w-1?1:x+1)]!;
    const up=heights[Math.max(0,y-1)*w+x]!,down=heights[Math.min(h-1,y+1)*w+x]!;
    const sx=(right-left)/(TAU*CONTRACT.visual.planetRadius*Math.max(.03,latitude)*2/(w-1));
    const sy=(down-up)/(Math.PI*CONTRACT.visual.planetRadius*2/(h-1));
    const a=-sx*.68,b=-sy*.68,l=Math.hypot(a,b,1);
    normal[k]=(a/l*.5+.5)*255;normal[k+1]=(b/l*.5+.5)*255;normal[k+2]=(1/l*.5+.5)*255;
  }
  return Promise.all([imageTexture(w,h,color),imageTexture(w,h,normal),imageTexture(w,h,rough),imageTexture(w,h,cities)]);
}

/** Cloud density is a continuous spherical field, not a painted limb or latitude stripe. */
async function makeCloudMap():Promise<Texture> {
  const w=CONTRACT.visual.textureSize,h=w/2,pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=direction(x/(w-1),y/(h-1));
    let px=p[0],py=p[1];
    // Compact, differently oriented local weather systems avoid gas-giant latitude bands.
    const dx=px+.36,dy=py-.32,r=Math.hypot(dx,dy),turn=2.2*Math.exp(-r*r*24)*smooth(-.1,.55,p[2]);
    px=-.36+dx*Math.cos(turn)-dy*Math.sin(turn);py=.32+dx*Math.sin(turn)+dy*Math.cos(turn);
    const ax=px-.43,ay=py+.28,second=-1.9*Math.exp(-(ax*ax+ay*ay)*29)*smooth(-.2,.55,p[2]);
    px=.43+ax*Math.cos(second)-ay*Math.sin(second);py=-.28+ax*Math.sin(second)+ay*Math.cos(second);
    const warp=fbm(px*9+11,py*9-3,p[2]*9+7,3)-.5;
    const weather=fbm(px*5+warp*.8,py*5,p[2]*5+warp*.8,5);
    const strands=fbm(px*32+warp*2.4,py*32-7,p[2]*32+warp*2.4,4);
    const front=1-Math.abs(noise(px*13+warp*1.5,py*7+3,p[2]*11)*2-1);
    const filaments=fbm(px*113,py*113+13,p[2]*113,4);
    const coverage=smooth(.48,.64,weather),fold=smooth(.28,.74,front);
    const density=coverage*(.16+.84*fold)*smooth(.28,.68,strands);
    // Optical depth yields dense cloud cores, feathered wisps and genuinely clear gaps.
    const alpha=(1-Math.exp(-density*3.1))*smooth(.25,.63,filaments)*255;
    const k=(y*w+x)*4,tint=235+strands*20;
    pixels[k]=tint-2;pixels[k+1]=tint-1;pixels[k+2]=tint;pixels[k+3]=alpha;
  }
  return imageTexture(w,h,pixels);
}

function makeCloudShell():Geometry {
  const columns=CONTRACT.visual.terrainSegments,rows=CONTRACT.visual.terrainRings,radius=CONTRACT.visual.planetRadius+.085;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    const p=direction(x/columns,y/rows),r=radius+terrain(...p).height;positions.push(p[0]*r,p[1]*r,p[2]*r);normals.push(...p);uvs.push(x/columns,y/rows);
  }
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;
    if(y!==0)indices.push(a,b,c);if(y!==rows-1)indices.push(b,d,c);
  }
  return new Geometry({positions,normals,uvs,indices});
}

function makeGlobe():Geometry {
  const {terrainSegments:columns,terrainRings:rows,planetRadius:radius}=CONTRACT.visual;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    const u=x/columns,v=y/rows,p=direction(u,v),r=radius+terrain(...p).height;
    positions.push(p[0]*r,p[1]*r,p[2]*r);uvs.push(u,v);
    normals.push(0,0,0);
  }
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;
    if(y!==0)indices.push(a,b,c);if(y!==rows-1)indices.push(b,d,c);
  }
  // Area-weighted normals describe the actual displaced triangles, not a second analytic bump.
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
    const ab:Point=[positions[b]!-positions[a]!,positions[b+1]!-positions[a+1]!,positions[b+2]!-positions[a+2]!];
    const ac:Point=[positions[c]!-positions[a]!,positions[c+1]!-positions[a+1]!,positions[c+2]!-positions[a+2]!];
    const n=cross(ab,ac);
    for(const k of [a,b,c])for(let axis=0;axis<3;axis++)normals[k+axis]!+=n[axis]!;
  }
  for(let y=1;y<rows;y++){
    const a=y*(columns+1)*3,b=(y*(columns+1)+columns)*3;
    for(let axis=0;axis<3;axis++)normals[a+axis]=normals[b+axis]=normals[a+axis]!+normals[b+axis]!;
  }
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    const k=(y*(columns+1)+x)*3,p=y===0||y===rows?direction(x/columns,y/rows):normalize([normals[k]!,normals[k+1]!,normals[k+2]!]);
    normals[k]=p[0];normals[k+1]=p[1];normals[k+2]=p[2];
  }
  return new Geometry({positions,normals,uvs,indices});
}

/** A front shell covers the disc as well as the limb; the shader fades its optical depth. */
function makeAtmosphere():Geometry {
  const columns=CONTRACT.visual.terrainSegments,rows=CONTRACT.visual.terrainRings;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    const p=direction(x/columns,y/rows),r=CONTRACT.visual.planetRadius+.13+terrain(...p).height;
    positions.push(p[0]*r,p[1]*r,p[2]*r);normals.push(...p);uvs.push(x/columns,y/rows);
  }
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const a=y*(columns+1)+x,b=a+1,c=a+columns+1,d=c+1;
    if(y!==0)indices.push(a,b,c);if(y!==rows-1)indices.push(b,d,c);
  }
  return new Geometry({positions,normals,uvs,indices});
}

function fragmentTerrain(variant:number,u:number,v:number) {
  const p=direction(.1+variant*.143+(u-.5)*.12,.28+(variant%3)*.17+(v-.5)*.12),t=terrain(...p);
  return {...t,land:1,arid:variant===1||variant===4?.85:t.arid,moisture:variant===2?.68:t.moisture,height:Math.max(t.height,CONTRACT.visual.terrainHeight*(.07+.34*t.mountain+.25*t.uplift)),latitude:p[1]};
}

async function makeFractureMaps():Promise<Texture[]> {
  const size=Math.floor(CONTRACT.visual.textureSize/2),length=size*size,albedo=new Uint8ClampedArray(length*4),emission=new Uint8ClampedArray(length*4),normal=new Uint8ClampedArray(length*4),rough=new Uint8ClampedArray(length*4),melt=new Uint8ClampedArray(length*4),heights=new Float32Array(length);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const u=x/(size-1),v=y/(size-1),index=y*size+x,i=index*4,outer=v<.72;
    const grain=fbm(u*47+13,v*79-5,17,4),fine=noise(u*213,v*237,11);
    const bend=noise(u*9,v*7,23)*.045,layer=.5+.5*Math.sin((v+bend)*93+noise(u*31,v*11,7)*5);
    const fracture=1-Math.abs(noise(u*29+grain*.7,v*41,31)*2-1),fissure=smooth(.93,.995,fracture);
    const column=Math.min(2,Math.floor(u*3)),row=Math.min(1,Math.floor(v/.36)),variant=row*3+column;
    const t=fragmentTerrain(variant,u*3-column,v/.36-row),land=terrainColor(t,t.latitude);
    const edge=Math.exp(-Math.pow((v-.766-bend)/.009,2))*(.28+.72*noise(u*71,v*27,3));
    const veins=fissure*smooth(.82,.98,v)*(.03+.12*layer);
    const stone=(.045+grain*.09+layer*.035+fine*.02)*(1-fissure*.64);
    for(let c=0;c<3;c++)albedo[i+c]=outer?Math.sqrt(land[c])*255:Math.sqrt(stone*(c===0?1.12:c===1?1:.87))*255;
    emission[i]=(edge+veins)*255;emission[i+1]=(edge*.22+veins*.07)*255;emission[i+2]=edge*.018*255;
    heights[index]=outer?CONTRACT.visual.terrainHeight*(.012*(t.detail-.5)+.008*t.ridge-.012*t.valley)-fissure*.008:grain*.027+layer*.019-fissure*.025;
    rough[i]=255;rough[i+1]=(outer?.9:.93+fine*.06)*255;rough[i+2]=0;
    albedo[i+3]=emission[i+3]=normal[i+3]=rough[i+3]=255;
    const flow=fbm(u*9+17,v*13-8,31,4),hot=smooth(.68,.9,1-Math.abs(flow*2-1))*(.18+.82*grain);
    melt[i]=8+hot*190;melt[i+1]=6+hot*hot*76;melt[i+2]=4+hot*hot*12;melt[i+3]=255;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,left=heights[y*size+Math.max(0,x-1)]!,right=heights[y*size+Math.min(size-1,x+1)]!;
    const up=heights[Math.max(0,y-1)*size+x]!,down=heights[Math.min(size-1,y+1)*size+x]!;
    const a=(left-right)*size*.22,b=(up-down)*size*.22,l=Math.hypot(a,b,1);
    normal[i]=(a/l*.5+.5)*255;normal[i+1]=(b/l*.5+.5)*255;normal[i+2]=(1/l*.5+.5)*255;
  }
  return Promise.all([imageTexture(size,size,albedo),imageTexture(size,size,normal),imageTexture(size,size,rough),imageTexture(size,size,emission),imageTexture(size,size,melt)]);
}

function makeFragment(variant:number,random:()=>number):Geometry {
  const radius=CONTRACT.visual.planetRadius;
  const extent=Math.sqrt(4*Math.PI*radius*radius/CONTRACT.visual.fragmentCount/Math.PI)*1.18;
  const corners=9+variant%5,outline:Point[]=[],vertices:Vertex[]=[];
  const thickness=.36+random()*.98,elongation=.77+variant*.085,notch=Math.floor(random()*corners);
  for(let i=0;i<corners;i++){
    const a=(i+(random()-.5)*.38)/corners*TAU,r=extent*(i===notch?.48:.7+random()*.37);
    outline.push([Math.cos(a)*r*elongation,Math.sin(a)*r/elongation,0]);
  }
  const top=(x:number,y:number):Vertex=>{
    const z=Math.sqrt(Math.max(0,radius*radius-x*x-y*y)),u=.5+x/(extent*3.4),v=.5+y/(extent*3.4),t=fragmentTerrain(variant,u,v);
    const relief=t.height-t.valley*CONTRACT.visual.terrainHeight*.025;
    const e=.01,tx=fragmentTerrain(variant,u+e/(extent*3.4),v),ty=fragmentTerrain(variant,u,v+e/(extent*3.4));
    const dx=(tx.height-tx.valley*CONTRACT.visual.terrainHeight*.025-relief)/e,dy=(ty.height-ty.valley*CONTRACT.visual.terrainHeight*.025-relief)/e;
    return {p:[x,y,z-radius+relief],n:normalize([x/z-dx,y/z-dy,1]),uv:[(variant%3+u)/3,(Math.floor(variant/3)+v)*.36]};
  };
  const addFlat=(a:Point,b:Point,c:Point,ua:readonly[number,number],ub:readonly[number,number],uc:readonly[number,number])=>{
    const n=normalize(cross([b[0]-a[0],b[1]-a[1],b[2]-a[2]],[c[0]-a[0],c[1]-a[1],c[2]-a[2]]));
    vertices.push({p:a,n,uv:ua},{p:b,n,uv:ub},{p:c,n,uv:uc});
  };
  for(let i=0;i<corners;i++){
    const a=outline[i]!,b=outline[(i+1)%corners]!;
    // The retained spherical skin is triangulated independently from the broken sidewalls.
    const steps=4;
    for(let ring=0;ring<steps;ring++)for(let along=0;along<=ring;along++){
      const f=(ring+1)/steps,g=ring/steps;
      const at=(depth:number,t:number)=>top((a[0]*(1-t)+b[0]*t)*depth,(a[1]*(1-t)+b[1]*t)*depth);
      const va=at(f,along/(ring+1)),vb=at(f,(along+1)/(ring+1)),vc=at(g,ring===0?0:along/ring);
      vertices.push(vc,va,vb);
      if(along<ring)vertices.push(vc,vb,at(g,(along+1)/ring));
    }
  }
  // Shared contour vertices keep four irregular strata watertight around every variant.
  const perimeter=corners*4,contours:Point[][]=[];
  for(let layer=0;layer<=4;layer++){
    const contour:Point[]=[];
    for(let j=0;j<perimeter;j++){
      const edge=Math.floor(j/4),f=j%4/4,a=outline[edge]!,b=outline[(edge+1)%corners]!;
      const x=a[0]*(1-f)+b[0]*f,y=a[1]*(1-f)+b[1]*f,cap=top(x,y).p;
      const inset=layer===0?1:1-layer*(.018+variant*.008)+(random()-.5)*.16;
      const depth=layer===0?0:thickness*(layer/4+(random()-.5)*.12)*(1+.23*Math.sin(j/perimeter*TAU+variant));
      contour.push([x*inset,y*inset,cap[2]-depth]);
    }
    contours.push(contour);
  }
  for(let layer=0;layer<4;layer++)for(let j=0;j<perimeter;j++){
    const next=(j+1)%perimeter,a=contours[layer]![j]!,b=contours[layer]![next]!,c=contours[layer+1]![j]!,d=contours[layer+1]![next]!;
    const u=.03+variant*.045+j/perimeter*.65,v=.03+variant*.045+(j+1)/perimeter*.65;
    const topV=.746+layer*.057,bottomV=topV+.057;
    if((j+layer)%2===0){addFlat(a,c,b,[u,topV],[u,bottomV],[v,topV]);addFlat(b,c,d,[v,topV],[u,bottomV],[v,bottomV]);}
    else{addFlat(a,c,d,[u,topV],[u,bottomV],[v,bottomV]);addFlat(a,d,b,[u,topV],[v,bottomV],[v,topV]);}
    if(layer===3)addFlat(c,[0,0,-thickness*1.15],d,[u,.98],[.5,.95],[v,.98]);
  }
  return triangleGeometry(vertices);
}

/** Partition the existing skin, so opening a fault cannot leave an intact globe underneath. */
function makeDamagedCrust(surface:Mesh,clouds:Mesh,wallMaterial:PBRMaterial,interiorMaterial:PBRMaterial,root:Group,geometries:Geometry[],cracks:Mesh[]) {
  const radius=CONTRACT.visual.planetRadius,impact=normalize(CONTRACT.visual.damageDirection);
  const random=seededRandom(CONTRACT.seed+719),seeds:Point[]=[impact];
  for(let i=0;i<56;i++){
    const y=clamp(1-2*(i+.5)/56+(random()-.5)*.08,-.995,.995),a=i*Math.PI*(3-Math.sqrt(5))+(random()-.5)*.4,s=Math.sqrt(1-y*y);
    seeds.push([Math.cos(a)*s,y,Math.sin(a)*s]);
  }
  const basis=normalize(cross(impact,[0,1,0])),other=cross(impact,basis);
  for(let i=0;i<13;i++){
    const angle=i*2.399963+(random()-.5)*.8,distance=.08+.63*Math.pow((i+.5)/13,1.4);
    const c=Math.cos(distance),s=Math.sin(distance),a=Math.cos(angle),b=Math.sin(angle);
    seeds.push(normalize([impact[0]*c+(basis[0]*a+other[0]*b)*s,impact[1]*c+(basis[1]*a+other[1]*b)*s,impact[2]*c+(basis[2]*a+other[2]*b)*s]));
  }
  const dot=(a:Point,b:Point)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const warp=(p:Point):Point=>{
    const d=normalize(p),x=d[0]*15,y=d[1]*15,z=d[2]*15;
    return normalize([d[0]+(noise(x+7,y,z)-.5)*.1+(noise(x*3+19,y*3,z*3)-.5)*.025,d[1]+(noise(x,y+13,z)-.5)*.1+(noise(x*3,y*3+23,z*3)-.5)*.025,d[2]+(noise(x,y,z+29)-.5)*.1+(noise(x*3,y*3,z*3+31)-.5)*.025]);
  };
  const nearest=(d:Point)=>{
    let best=-Infinity,owner=0;
    for(let i=0;i<seeds.length;i++){
      const score=dot(d,seeds[i]!);
      if(score>best){best=score;owner=i;}
    }
    return owner;
  };
  const selected=seeds.map(d=>dot(d,impact)>.61),labels=seeds.map((_,i)=>selected[i]?i+1:0);
  const group=root.add(new Group()),source=surface.geometry,vertices=Array.from(source.vertices);
  const faces:number[][]=Array.from({length:seeds.length+1},()=>[]);
  const boundaries:{a:number;b:number;left:number;right:number}[]=[],edges=new Map<string,{a:number;b:number;owner:number}>();
  const point=(id:number):Point=>{const k=id*8;return [vertices[k]!,vertices[k+1]!,vertices[k+2]!];};
  const warped=Array.from({length:source.vertices.length/8},(_,i)=>warp(point(i))),owners=warped.map(nearest);
  const intersections=new Map<string,number>();
  const intersect=(a:number,b:number,sa:number,sb:number,da:number,db:number)=>{
    const key=`${Math.min(a,b)}:${Math.max(a,b)}:${Math.min(sa,sb)}:${Math.max(sa,sb)}`,cached=intersections.get(key);
    if(cached!==undefined)return cached;
    const f=da/(da-db),id=vertices.length/8,values:number[]=[];
    for(let k=0;k<8;k++)values.push(vertices[a*8+k]!+(vertices[b*8+k]!-vertices[a*8+k]!)*f);
    const n=normalize([values[3]!,values[4]!,values[5]!]);values[3]=n[0];values[4]=n[1];values[5]=n[2];
    const wa=warped[a]!,wb=warped[b]!;warped.push([wa[0]+(wb[0]-wa[0])*f,wa[1]+(wb[1]-wa[1])*f,wa[2]+(wb[2]-wa[2])*f]);
    vertices.push(...values);intersections.set(key,id);return id;
  };
  for(let i=0;i<source.indices.length;i+=3){
    const triangle=[source.indices[i]!,source.indices[i+1]!,source.indices[i+2]!],candidates=[...new Set(triangle.map(id=>owners[id]!))];
    if(candidates.length===1||candidates.every(id=>labels[id]===0)){
      faces[labels[candidates[0]!]!]!.push(...triangle);continue;
    }
    // Split triangles at the fault itself, not along the latitude/longitude grid.
    for(const owner of candidates){
      let polygon=triangle;
      for(let competitor=0;competitor<seeds.length&&polygon.length;competitor++){
        if(competitor===owner)continue;
        const a=seeds[owner]!,b=seeds[competitor]!,plane:Point=[a[0]-b[0],a[1]-b[1],a[2]-b[2]],clipped:number[]=[];
        for(let j=0;j<polygon.length;j++){
          const from=polygon[j]!,to=polygon[(j+1)%polygon.length]!,da=dot(warped[from]!,plane),db=dot(warped[to]!,plane);
          if(da>=0)clipped.push(from);
          if((da>=0)!==(db>=0))clipped.push(intersect(from,to,owner,competitor,da,db));
        }
        polygon=clipped;
      }
      for(let j=1;j+1<polygon.length;j++)faces[labels[owner]!]!.push(polygon[0]!,polygon[j]!,polygon[j+1]!);
    }
  }
  for(let id=0;id<vertices.length/8;id++){
    const p=point(id),d=normalize(p);if(dot(d,impact)<.55)continue;
    const owner=nearest(warped[id]!),seed=seeds[owner]!;
    let margin=1;
    for(let i=0;i<seeds.length;i++){
      if(i===owner)continue;
      const other=seeds[i]!,plane:Point=[seed[0]-other[0],seed[1]-other[1],seed[2]-other[2]];
      margin=Math.min(margin,Math.abs(dot(warped[id]!,plane))/Math.hypot(...plane));
    }
    const bank=1-smooth(0,.035,margin),charred=smooth(.975,.995,dot(d,impact));
    const rough=(noise(p[0]*9,p[1]*9,p[2]*9)-.5)*(.2*bank+.32*charred)-.04*bank;
    for(let axis=0;axis<3;axis++)vertices[id*8+axis]!+=d[axis]!*rough;
  }
  const canonical=(id:number)=>point(id).map(v=>Math.round(v*100000)).join(':');
  for(let owner=0;owner<faces.length;owner++){
    const ids=faces[owner]!;
    for(let i=0;i<ids.length;i+=3)for(const [from,to] of [[ids[i]!,ids[i+1]!],[ids[i+1]!,ids[i+2]!],[ids[i+2]!,ids[i]!]]){
      const ca=canonical(from!),cb=canonical(to!);if(ca===cb)continue;
      const key=ca<cb?`${ca}|${cb}`:`${cb}|${ca}`,previous=edges.get(key);
      if(previous){
        if(previous.owner!==owner)boundaries.push({a:previous.a,b:previous.b,left:previous.owner,right:owner});
        edges.delete(key);
      }else edges.set(key,{a:from!,b:to!,owner});
    }
  }
  const walls:Vertex[][]=faces.map(()=>[]),centers:Point[]=faces.map((_,i)=>{
    if(i===0)return [0,0,0];
    const seed=seeds[i-1]!;return [seed[0]*radius,seed[1]*radius,seed[2]*radius];
  });
  const local=(p:Point,owner:number):Point=>{const center=centers[owner]!;return [p[0]-center[0],p[1]-center[1],p[2]-center[2]];};
  for(const edge of boundaries)for(const owner of [edge.left,edge.right]){
    const pa=point(owner===edge.left?edge.a:edge.b),pb=point(owner===edge.left?edge.b:edge.a);
    const layers=(p:Point)=>{
      const n=normalize(p),center=centers[owner]!,toward=normalize([center[0]-p[0],center[1]-p[1],center[2]-p[2]]);
      const thickness=.65+.65*noise(p[0]*1.9,p[1]*1.9,p[2]*1.9);
      return [p,...[.28,.61,1].map(f=>{
        const inset=f*(.08+.24*noise(p[0]*4+f*9,p[1]*4,p[2]*4)),depth=thickness*f;
        return [p[0]-n[0]*depth+toward[0]*inset,p[1]-n[1]*depth+toward[1]*inset,p[2]-n[2]*depth+toward[2]*inset] as Point;
      })];
    };
    const left=layers(pa),right=layers(pb);
    const add=(a:Point,b:Point,c:Point,ua:readonly[number,number],ub:readonly[number,number],uc:readonly[number,number])=>{
      const n=normalize(cross([b[0]-a[0],b[1]-a[1],b[2]-a[2]],[c[0]-a[0],c[1]-a[1],c[2]-a[2]]));
      walls[owner]!.push({p:local(a,owner),n,uv:ua},{p:local(b,owner),n,uv:ub},{p:local(c,owner),n,uv:uc});
    };
    const u=.08+noise(pa[0]*3,pa[1]*3,pa[2]*3)*.72,w=Math.hypot(pa[0]-pb[0],pa[1]-pb[1],pa[2]-pb[2])*.08;
    // The exposed face spans the rock/strata region of the existing fracture atlas.
    for(let layer=0;layer<3;layer++){
      const a=left[layer]!,b=right[layer]!,c=left[layer+1]!,d=right[layer+1]!,v=.84+layer*.047;
      add(a,c,b,[u,v],[u,v+.047],[u+w,v]);add(b,c,d,[u+w,v],[u,v+.047],[u+w,v+.047]);
    }
    const chip=noise(pa[0]*19,pa[1]*19,pa[2]*19);
    if(chip>.61){
      const a=left[1]!,b=right[1]!,c=left[2]!,normal=normalize(cross([b[0]-a[0],b[1]-a[1],b[2]-a[2]],[c[0]-a[0],c[1]-a[1],c[2]-a[2]]));
      const tip:Point=[(a[0]+b[0]+c[0])/3+normal[0]*(.08+chip*.2),(a[1]+b[1]+c[1])/3+normal[1]*(.08+chip*.2),(a[2]+b[2]+c[2])/3+normal[2]*(.08+chip*.2)];
      add(a,tip,b,[u,.84],[u+.03,.92],[u+w,.84]);add(b,tip,c,[u+w,.84],[u+.03,.92],[u,.97]);add(c,tip,a,[u,.97],[u+.03,.92],[u,.84]);
    }
  }
  const plates:{group:Group;center:Point;drift:Point;tilt:Point;start:number}[]=[];
  const starts=new Float32Array(seeds.length),amounts=new Float32Array(seeds.length);
  for(let owner=0;owner<faces.length;owner++){
    const ids=faces[owner]!;if(!ids.length)continue;
    const center=centers[owner]!,plate=group.add(new Group());plate.position.set(...center);
    const scorched=owner>0&&dot(seeds[owner-1]!,impact)>Math.cos(.19);
    const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[],remap=new Map<number,number>();
    for(const id of ids){
      let index=remap.get(id);
      if(index===undefined){
        index=remap.size;remap.set(id,index);const k=id*8;
        positions.push(vertices[k]!-center[0],vertices[k+1]!-center[1],vertices[k+2]!-center[2]);
        normals.push(vertices[k+3]!,vertices[k+4]!,vertices[k+5]!);
        uvs.push(vertices[k+6]!,scorched?.85+vertices[k+7]!*.14:vertices[k+7]!);
      }
      indices.push(index);
    }
    if(owner>0){
      normals.fill(0);
      for(let i=0;i<indices.length;i+=3){
        const a=indices[i]!*3,b=indices[i+1]!*3,c=indices[i+2]!*3;
        const n=cross([positions[b]!-positions[a]!,positions[b+1]!-positions[a+1]!,positions[b+2]!-positions[a+2]!],[positions[c]!-positions[a]!,positions[c+1]!-positions[a+1]!,positions[c+2]!-positions[a+2]!]);
        for(const id of [a,b,c])for(let axis=0;axis<3;axis++)normals[id+axis]!+=n[axis]!;
      }
      for(let i=0;i<normals.length;i+=3){
        const n=normalize([normals[i]!,normals[i+1]!,normals[i+2]!]);normals[i]=n[0];normals[i+1]=n[1];normals[i+2]=n[2];
      }
    }
    const top=new Geometry({positions,normals,uvs,indices});geometries.push(top);
    const skin=plate.add(new Mesh({geometry:top,material:scorched?wallMaterial:surface.material}));cracks.push(skin);
    if(walls[owner]!.length){
      const side=triangleGeometry(walls[owner]!);geometries.push(side);
      cracks.push(plate.add(new Mesh({geometry:side,material:wallMaterial})));
    }
    if(owner===0)continue;
    const seed=seeds[owner-1]!,cosine=dot(seed,impact),distance=Math.acos(clamp(cosine,-1,1));
    const tangent=owner===1?normalize(cross(seed,[0,1,0])):normalize([seed[0]-impact[0]*cosine,seed[1]-impact[1]*cosine,seed[2]-impact[2]*cosine]);
    const axis=normalize(cross(seed,tangent)),sinking=distance<.19,lift=sinking?-.85-random()*.3:.12+random()*.48,spread=sinking?.025:.06+random()*.19;
    const start=sinking?0:.08+distance*.43+random()*.055,amount=sinking?.08:.025+random()*.1;
    starts[owner-1]=start;
    plates.push({group:plate,center,drift:[seed[0]*lift+tangent[0]*spread,seed[1]*lift+tangent[1]*spread,seed[2]*lift+tangent[2]*spread],tilt:[axis[0]*amount,axis[1]*amount,axis[2]*amount],start});
  }
  const floorSource=Geometry.sphere(radius-1.8,64,32),floorPositions:number[]=[],floorNormals:number[]=[],floorUvs:number[]=[];
  for(let k=0;k<floorSource.vertices.length;k+=8){
    const x=floorSource.vertices[k]!,y=floorSource.vertices[k+1]!,z=floorSource.vertices[k+2]!,r=1+.018*(noise(x*2,y*2,z*2)-.5);
    floorPositions.push(x*r,y*r,z*r);
    floorNormals.push(floorSource.vertices[k+3]!,floorSource.vertices[k+4]!,floorSource.vertices[k+5]!);
    floorUvs.push(floorSource.vertices[k+6]!,floorSource.vertices[k+7]!);
  }
  const floor=new Geometry({positions:floorPositions,normals:floorNormals,uvs:floorUvs,indices:floorSource.indices});geometries.push(floor);
  group.add(new Mesh({geometry:floor,material:interiorMaterial}));
  const cloudOwners=new Uint8Array(clouds.geometry.vertices.length/8),cloudColors=new Float32Array(cloudOwners.length*4);
  for(let i=0;i<cloudOwners.length;i++){
    const k=i*8,d=normalize([clouds.geometry.vertices[k]!,clouds.geometry.vertices[k+1]!,clouds.geometry.vertices[k+2]!]);
    const seed=nearest(warp(d));cloudOwners[i]=selected[seed]?seed+1:0;
    cloudColors.fill(1,i*4,i*4+4);
  }
  clouds.geometry.setColors(cloudColors);
  const liveCloudColors=clouds.geometry.colors!;
  let last=-1;
  return {
    group,
    update(progress:number){
      const p=clamp(progress);if(p===last)return;last=p;
      group.visible=p>0;surface.visible=p===0;
      for(const plate of plates){
        const q=smooth(plate.start,Math.min(1,plate.start+.27),p);
        const c=plate.center,d=plate.drift,t=plate.tilt;
        plate.group.position.set(c[0]+d[0]*q,c[1]+d[1]*q,c[2]+d[2]*q);
        plate.group.rotation.setFromEuler(t[0]*q,t[1]*q,t[2]*q);
      }
      for(let i=0;i<seeds.length;i++)amounts[i]=selected[i]?smooth(starts[i]!,Math.min(1,starts[i]!+.27),p):0;
      for(let i=0;i<cloudOwners.length;i++){
        const owner=cloudOwners[i]!;
        liveCloudColors[i*4+3]=owner?1-amounts[owner-1]!:1;
      }
      clouds.geometry.markUpdated();
    },
  };
}

export async function createPlanetModel():Promise<PlanetModel> {
  const {planetRadius:radius,fragmentCount,fragmentVariants}=CONTRACT.visual;
  const random=seededRandom(CONTRACT.seed),textures:Texture[]=[],geometries:Geometry[]=[];
  const root=new Group(),fragments=new Group();
  const [maps,fractureMaps,cloudMap]=await Promise.all([makeSurfaceMaps(),makeFractureMaps(),makeCloudMap()]);textures.push(...maps,...fractureMaps,cloudMap);
  const white=await imageTexture(1,1,new Uint8ClampedArray([255,255,255,255]));textures.push(white);
  const surfaceGeometry=makeGlobe();geometries.push(surfaceGeometry);
  // An opaque globe must write depth before its transparent shells; PBR defaults to BLEND.
  const surface=root.add(new Mesh({geometry:surfaceGeometry,material:new PBRMaterial({alphaMode:'OPAQUE',texture:maps[0]!,normalTexture:maps[1]!,normalScale:.9,metallicRoughnessTexture:maps[2]!,emissiveTexture:maps[3]!,emissive:[.32,.26,.2],roughness:1,metallic:0,specular:.45,textureSampler:{addressModeU:'repeat',addressModeV:'clamp-to-edge'},metallicRoughnessSampler:{addressModeU:'repeat',addressModeV:'clamp-to-edge'},normalSampler:{addressModeU:'repeat',addressModeV:'clamp-to-edge'},emissiveSampler:{addressModeU:'repeat',addressModeV:'clamp-to-edge'}})}));
  const atmosphereGeometry=makeAtmosphere();geometries.push(atmosphereGeometry);
  const atmosphereMaterial=new NativeMaterial3D({
    texture:white,transparent:true,deformationBounds:0,label:'Sunlit orbital haze',
    // Native image hooks return premultiplied RGB; the engine supplies solar illumination.
    wgsl:`fn xyzDeform(position:vec3f,normal:vec3f,uv:vec2f)->XYZVertex{return XYZVertex(position,normal);}
      fn xyzSurface(world:vec3f,normal:vec3f,uv:vec2f,texel:vec4f)->vec4f{
        let view=normalize(scene.camera.xyz-world);let mu=max(dot(normalize(normal),view),0.0);
        let depth=(.012+.18*pow(1.0-mu,3.0))*smoothstep(0.0,.18,mu);
        return vec4f(vec3f(.06,.18,.36)*depth,depth);
      }`,
    glsl:`#ifdef XYZ_VERTEX
      XYZVertex xyzDeform(vec3 position,vec3 normal,vec2 uv){return XYZVertex(position,normal);}
      #endif
      #if defined(XYZ_FRAGMENT)
      vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){
        vec3 view=normalize(cameraPosition-world);float mu=max(dot(normalize(normal),view),0.0);
        float depth=(.012+.18*pow(1.0-mu,3.0))*smoothstep(0.0,.18,mu);return vec4(vec3(.06,.18,.36)*depth,depth);
      }
      #elif defined(XYZ_SHADOW)
      vec4 xyzSurface(vec3 world,vec3 normal,vec2 uv,vec4 texel){return texel;}
      #endif`,
  });
  const atmosphere=root.add(new Mesh({geometry:atmosphereGeometry,castShadow:false,receiveShadow:false,material:atmosphereMaterial}));
  const cloudGeometry=makeCloudShell();geometries.push(cloudGeometry);
  const cloudMaterial=new PBRMaterial({
    texture:cloudMap,transparent:true,alphaMode:'BLEND',opacity:.86,roughness:1,metallic:0,specular:.08,
    textureSampler:{addressModeU:'repeat',addressModeV:'clamp-to-edge'},
  });
  const clouds=root.add(new Mesh({geometry:cloudGeometry,castShadow:false,receiveShadow:false,material:cloudMaterial}));
  root.add(fragments);fragments.visible=false;
  const fractureMaterial=new PBRMaterial({texture:fractureMaps[0]!,normalTexture:fractureMaps[1]!,normalScale:.8,metallicRoughnessTexture:fractureMaps[2]!,emissiveTexture:fractureMaps[3]!,emissive:[2.4,.95,.32],roughness:1,metallic:0,doubleSided:false});
  const variantMeshes:InstancedMesh[]=[];
  for(let i=0;i<Math.min(6,fragmentVariants);i++){
    const geometry=makeFragment(i,random);geometries.push(geometry);
    variantMeshes.push(fragments.add(new InstancedMesh({geometry,material:fractureMaterial,count:Math.floor((fragmentCount+Math.min(6,fragmentVariants)-1-i)/Math.min(6,fragmentVariants))})));
  }
  const flights:Flight[]=[],slots=variantMeshes.map(()=>0);
  for(let i=0;i<fragmentCount;i++){
    const y=clamp(1-2*(i+.5)/fragmentCount+(random()-.5)*.06,-.995,.995),a=i*Math.PI*(3-Math.sqrt(5))+(random()-.5)*.38,s=Math.sqrt(1-y*y);
    const d:Point=[Math.cos(a)*s,y,Math.sin(a)*s],t=normalize(cross(d,Math.abs(y)<.9?[0,1,0]:[1,0,0]));
    const variant=i%variantMeshes.length,mesh=variantMeshes[variant]!,slot=slots[variant]!;slots[variant]=slot+1;
    const hero=i%31===7,size=hero?1.55+random()*.48:.34+random()*random()*.92,depth=hero?.85+random()*.45:.52+random()*.65;
    const yaw=Math.atan2(d[0],d[2])*.5,pitch=-Math.asin(d[1])*.5;
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cx=Math.cos(pitch),sx=Math.sin(pitch);
    flights.push({mesh,slot,direction:d,tangent:t,aim:[cy*sx,sy*cx,-sy*sx,cy*cx],size,depth,roll:random()*TAU,speed:hero?.35+random()*.45:.55+random()*1.25,spin:[(random()-.5)*.38,(random()-.5)*.38,(random()-.5)*.38]});
    const tint=.83+random()*.26;mesh.setColorAt(slot,tint,tint*(.97+random()*.06),tint);
  }
  const matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),spin=new Quaternion(),scale=new Vector3();
  const cracks:Mesh[]=[];
  const wallMaterial=new PBRMaterial({alphaMode:'OPAQUE',texture:fractureMaps[0]!,normalTexture:fractureMaps[1]!,normalScale:1.2,metallicRoughnessTexture:fractureMaps[2]!,emissiveTexture:fractureMaps[3]!,emissive:[.18,.05,.008],roughness:1,metallic:0,specular:.12});
  const interiorMaterial=new PBRMaterial({alphaMode:'OPAQUE',texture:fractureMaps[4]!,emissiveTexture:fractureMaps[4]!,emissive:[1.1,.48,.1],roughness:.95,metallic:0,specular:.08});
  const damage=makeDamagedCrust(surface,clouds,wallMaterial,interiorMaterial,root,geometries,cracks);
  const updateFragments=(age:number)=>{
    const glow=1-smooth(2.5,9,age);
    fractureMaterial.emissive[0]=2.4*glow;fractureMaterial.emissive[1]=.95*glow;fractureMaterial.emissive[2]=.32*glow;
    for(const flight of flights){
      const d=flight.direction,t=flight.tangent,travel=age*flight.speed+age*age*.045;
      position.set(d[0]*(radius+travel)+t[0]*age*.19,d[1]*(radius+travel)+t[1]*age*.19,d[2]*(radius+travel)+t[2]*age*.19);
      // Ry * Rx aims the cap's local +Z at its spherical direction; local Rz
      // rolls the irregular outline without changing its radial orientation.
      const cz=Math.cos((flight.roll+flight.spin[2]*age)*.5),sz=Math.sin((flight.roll+flight.spin[2]*age)*.5);
      const [qx,qy,qz,qw]=flight.aim;
      rotation.set(qx*cz+qy*sz,qy*cz-qx*sz,qw*sz+qz*cz,qw*cz-qz*sz);
      if(age>0){
        spin.setFromEuler(flight.spin[0]*age,flight.spin[1]*age,0);
        const ax=rotation.x,ay=rotation.y,az=rotation.z,aw=rotation.w;
        rotation.set(aw*spin.x+ax*spin.w+ay*spin.z-az*spin.y,aw*spin.y-ax*spin.z+ay*spin.w+az*spin.x,aw*spin.z+ax*spin.y-ay*spin.x+az*spin.w,aw*spin.w-ax*spin.x-ay*spin.y-az*spin.z);
      }
      scale.set(flight.size,flight.size,flight.depth);matrix.compose(position,rotation,scale);flight.mesh.setMatrixAt(flight.slot,matrix);
    }
  };
  const setDamage=(progress:number)=>damage.update(progress);
  const reset=()=>{surface.visible=true;atmosphere.visible=true;clouds.visible=true;fragments.visible=false;setDamage(0);updateFragments(0);};
  const setBreakup=(age:number)=>{const t=Math.max(0,age);surface.visible=false;atmosphere.visible=false;clouds.visible=false;damage.group.visible=false;fragments.visible=true;updateFragments(t);};
  reset();
  return {root,surface,atmosphere,cracks,fragments,textures,geometries,reset,setDamage,setBreakup};
}
