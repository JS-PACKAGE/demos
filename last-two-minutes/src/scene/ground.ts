import { Geometry, Group, InstancedMesh, Matrix4, Mesh, PBRMaterial, Quaternion, Texture, Vector3 } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract.ts';
import { clamp, cross, fbm, hash, noise, normalize, smooth, terrain } from './planet-noise.ts';
import type { Point } from './planet-noise.ts';

/** Local relief is reserved for the standing-camera cap; orbital relief remains planet-scale. */
export function groundHeight(x:number,y:number,z:number):number {
  const warp=(noise(x*13+11,z*13,7)-.5)*.025;
  const across=z+warp+.012*Math.sin(x*19);
  const ridged=Math.pow(1-Math.abs(fbm(x*13+19,z*17,13,4)*2-1),3.5);
  const near=Math.exp(-Math.pow((across-.015)/.047,2));
  const far=Math.exp(-Math.pow((across+.14)/.08,2));
  const valley=smooth(.02,.045,Math.abs(x-.015-.02*Math.sin(z*11)));
  const hills=(fbm(x*49,z*57,31,3)-.3)*.012;
  return terrain(x,y,z).height+(near*.3+far*.75)*(.22+.78*ridged)*(.25+.75*valley)+Math.max(0,hills);
}

export async function createGroundLandscape() {
  const root=new Group(),geometries:Geometry[]=[],textures:Texture[]=[],cols=384,rows=256;
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[],heights:number[]=[],slopes:number[]=[];
  const point=(x:number,z:number):Point=>{const y=Math.sqrt(Math.max(.01,1-x*x-z*z)),r=CONTRACT.visual.planetRadius+groundHeight(x,y,z);return [x*r,y*r,z*r];};
  for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
    const u=i/cols,v=j/rows,x=(u-.5)*1.1,z=.3-v*.95,e=.001,p=point(x,z),a=point(x-e,z),b=point(x+e,z),c=point(x,z-e),d=point(x,z+e);
    const n=normalize(cross([d[0]-c[0],d[1]-c[1],d[2]-c[2]],[b[0]-a[0],b[1]-a[1],b[2]-a[2]]));
    const radial=normalize(p),slope=1-(n[0]*radial[0]+n[1]*radial[1]+n[2]*radial[2]);
    positions.push(...p);normals.push(...n);uvs.push(u,v);heights.push(Math.hypot(...p)-CONTRACT.visual.planetRadius);slopes.push(slope);
  }
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;indices.push(a,b,c,b,d,c);}
  const geometry=new Geometry({positions,normals,uvs,indices});geometries.push(geometry);
  const w=CONTRACT.visual.textureSize,h=w/2,albedo=new Uint8ClampedArray(w*h*4),normal=new Uint8ClampedArray(w*h*4),rough=new Uint8ClampedArray(w*h*4);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const u=i/(w-1),v=j/(h-1),x=(u-.5)*1.1,z=.3-v*.95,gx=u*cols,gz=v*rows,ix=Math.min(cols-1,Math.floor(gx)),iz=Math.min(rows-1,Math.floor(gz)),f=gx-ix,g=gz-iz;
    const sample=(values:number[])=>{const a=iz*(cols+1)+ix;return (values[a]!*(1-f)+values[a+1]!*f)*(1-g)+(values[a+cols+1]!*(1-f)+values[a+cols+2]!*f)*g;};
    const elevation=sample(heights),slope=sample(slopes),grain=noise(x*287,z*311,7),fine=hash(i,j,29),strata=.5+.5*Math.sin(elevation*360+noise(x*39,z*47,17)*4);
    const snow=smooth(.035,.16,elevation+noise(x*37,z*43,11)*.065)*(1-smooth(.035,.22,slope));
    const snowDrift=smooth(.57,.72,noise(x*71,z*63,5))*(1-smooth(.018,.07,elevation))*.9;
    const ice=clamp(snow+snowDrift),stone=(.05+grain*.12+strata*.028+(fine-.5)*.032)*(.55+noise(x*59,z*73,17)),k=(j*w+i)*4,haze=smooth(.04,-.32,z)*.35;
    for(let c=0;c<3;c++){const rock=stone*(c===0?1.12:c===1?1.02:.94),white=(.62+grain*.12)*(c===2?1.04:1),base=rock*(1-ice)+white*ice;albedo[k+c]=Math.sqrt(base*(1-haze)+[.27,.36,.47][c]!*haze)*255;}
    const dx=(noise((x+.00025)*287,z*311,7)-noise((x-.00025)*287,z*311,7))*1.6+(fine-.5)*.28;
    const dz=(noise(x*287,(z+.00025)*311,7)-noise(x*287,(z-.00025)*311,7))*1.6+(hash(i+1,j,29)-.5)*.28,l=Math.hypot(dx,dz,1);
    normal[k]=(-dx/l*.5+.5)*255;normal[k+1]=(dz/l*.5+.5)*255;normal[k+2]=(1/l*.5+.5)*255;
    rough[k]=255;rough[k+1]=(ice?.78+grain*.12:.92+fine*.06)*255;rough[k+2]=0;albedo[k+3]=normal[k+3]=rough[k+3]=255;
  }
  for(const pixels of [albedo,normal,rough]){const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Ground textures require Canvas2D');const image=ctx.createImageData(w,h);image.data.set(pixels);ctx.putImageData(image,0,0);textures.push(await Texture.fromImage(canvas));}
  const sampler={minFilter:'linear',magFilter:'linear',mipmapFilter:'linear'} as const;
  const material=new PBRMaterial({alphaMode:'OPAQUE',texture:textures[0]!,normalTexture:textures[1]!,metallicRoughnessTexture:textures[2]!,normalScale:.75,roughness:1,metallic:0,specular:.28,textureCoordinates:{normal:{scale:[32,32]}},textureSampler:sampler,normalSampler:{...sampler,addressModeU:'repeat',addressModeV:'repeat'},metallicRoughnessSampler:sampler});
  root.add(new Mesh({geometry,material}));
  const rockSource=Geometry.sphere(1,9,6),rp:number[]=[],rn:number[]=[],ru:number[]=[];
  for(let k=0;k<rockSource.vertices.length;k+=8){const x=rockSource.vertices[k]!,y=rockSource.vertices[k+1]!,z=rockSource.vertices[k+2]!,r=.78+noise(x*3+7,y*3,z*3)*.43;rp.push(x*r,y*r,z*r);rn.push(x,y,z);ru.push(.05+rockSource.vertices[k+6]!*.12,.07+rockSource.vertices[k+7]!*.12);}
  const rockGeometry=new Geometry({positions:rp,normals:rn,uvs:ru,indices:rockSource.indices});geometries.push(rockGeometry);
  const rocks=root.add(new InstancedMesh({geometry:rockGeometry,material,count:720})),random=seededRandom(CONTRACT.seed+1927),matrix=new Matrix4(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3();
  for(let i=0;i<rocks.count;i++){
    const close=i<570,x=close?-.065+random()*.17:-.4+random()*.8,z=close?.035+random()*.087:-.23+random()*.34,p=point(x,z),size=close?.0007+Math.pow(random(),3)*.006:.003+random()*.018;
    position.set(...p);rotation.setFromEuler(random()*3,random()*6,random()*3);scale.set(size*(.65+random()),size*(.38+random()*.55),size*(.6+random()));matrix.compose(position,rotation,scale);rocks.setMatrixAt(i,matrix);const tint=.7+random()*.35;rocks.setColorAt(i,tint,tint,tint);
  }
  root.visible=false;
  return {root,geometries,textures};
}
