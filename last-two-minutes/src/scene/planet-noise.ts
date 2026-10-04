import { CONTRACT, seededRandom } from '../show/contract.ts';

export type Point = readonly [number, number, number];
export const clamp = (v:number, lo=0, hi=1):number => Math.max(lo,Math.min(hi,v));
export const smooth = (a:number,b:number,v:number):number => { const t=clamp((v-a)/(b-a)); return t*t*(3-2*t); };
export function hash(x:number,y:number,z:number):number {
  let h=Math.imul(x|0,374761393)^Math.imul(y|0,668265263)^Math.imul(z|0,2147483647)^CONTRACT.seed;
  h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;
}
export function noise(x:number,y:number,z:number):number {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  let fx=x-ix,fy=y-iy,fz=z-iz;fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);fz=fz*fz*(3-2*fz);
  const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
  return mix(mix(mix(hash(ix,iy,iz),hash(ix+1,iy,iz),fx),mix(hash(ix,iy+1,iz),hash(ix+1,iy+1,iz),fx),fy),mix(mix(hash(ix,iy,iz+1),hash(ix+1,iy,iz+1),fx),mix(hash(ix,iy+1,iz+1),hash(ix+1,iy+1,iz+1),fx),fy),fz);
}
export function fbm(x:number,y:number,z:number,octaves=5):number {
  let sum=0,weight=.5,total=0;
  for(let i=0;i<octaves;i++){sum+=noise(x,y,z)*weight;total+=weight;weight*=.48;x=x*2.03+7.13;y=y*2.03-3.71;z=z*2.03+1.93;}
  return sum/total;
}
// Spherical plates share both sides of a boundary; domain warping prevents straight Voronoi scars.
const plateRandom=seededRandom(CONTRACT.seed+761);
const plates=Array.from({length:20},(_,i)=>{
  const y=1-2*(i+.5)/20,a=i*Math.PI*(3-Math.sqrt(5))+(plateRandom()-.5)*.28,s=Math.sqrt(1-y*y);
  return {x:Math.cos(a)*s,y,z:Math.sin(a)*s,elevation:.18+plateRandom()*.72};
});
export type Terrain = { land:number; mountain:number; height:number; uplift:number; moisture:number; detail:number; ridge:number; valley:number; arid:number; dune:number };
export function terrain(x:number,y:number,z:number):Terrain {
  const wx=noise(x*3+19,y*3-7,z*3+5)-.5,wy=noise(x*3-11,y*3+21,z*3-3)-.5,wz=noise(x*3+5,y*3-17,z*3+31)-.5;
  const px=x+wx*.19,py=y+wy*.19,pz=z+wz*.19;
  let first=-Infinity,second=-Infinity,nearest=0,neighbor=0;
  for(let i=0;i<plates.length;i++){
    const plate=plates[i]!,score=px*plate.x+py*plate.y+pz*plate.z;
    if(score>first){second=first;neighbor=nearest;first=score;nearest=i;}
    else if(score>second){second=score;neighbor=i;}
  }
  const gap=first-second,blend=.5*(1-smooth(0,.035,gap));
  const plateau=plates[nearest]!.elevation*(1-blend)+plates[neighbor]!.elevation*blend;
  const boundary=1-smooth(.008,.06,gap);
  const convergence=smooth(.24,.78,hash(Math.min(nearest,neighbor),Math.max(nearest,neighbor),41));
  const continents=fbm(x*1.85+wx*.7,y*1.85+wy*.7,z*1.85+wz*.7,5);
  const coast=continents+(fbm(px*19+7,py*19-3,pz*19+11,4)-.5)*.075+(noise(px*67,py*67,pz*67)-.5)*.017;
  const land=smooth(.465,.482,coast);
  // Anisotropic coordinates form connected, folded ranges rather than isolated noise peaks.
  const along=px*.72+pz*.69,across=px*-.56+py*.57+pz*.58;
  const fold=noise(along*7+19,py*5-23,pz*5+7)-.5;
  const belt=Math.pow(1-Math.abs(noise(across*6+fold*.85,along*1.7+13,py*2.1)*2-1),3);
  const ridge=Math.pow(1-Math.abs(Math.sin(across*63+fold*12+noise(along*21,py*13,pz*13)*3)),2);
  const tributary=Math.pow(1-Math.abs(noise(along*47+across*9,py*39+19,pz*29)*2-1),3);
  const mountain=smooth(.493,.562,continents)*belt*(.27+.73*ridge)*(.67+.33*tributary);
  const uplift=boundary*convergence*(.38+.62*ridge)*(.72+.28*tributary);
  const valley=Math.pow(1-Math.abs(noise(px*31+fold,py*39,pz*31+7)*2-1),9);
  const detail=fbm(px*109,py*109,pz*109,3);
  const latitude=Math.abs(y),rain=fbm(px*6+3,py*6+15,pz*6-9,4);
  const moisture=clamp(rain+.1*Math.exp(-latitude*latitude*22)-.075*Math.exp(-Math.pow((latitude-.42)/.16,2))-mountain*.17+(noise(px*43,py*43,pz*43)-.5)*.055);
  const arid=smooth(.49,.68,1-moisture)*(1-smooth(.56,.78,latitude));
  const dune=.5+.5*Math.sin((px*.83+pz*.55)*183+noise(px*19,py*17,pz*19)*15);
  const shelf=smooth(.47,.525,coast);
  const height=CONTRACT.visual.terrainHeight*land*clamp(.025+shelf*(.055+.13*plateau+.5*mountain+.55*uplift-.06*valley)+.01*detail+arid*.005*dune);
  return {land,mountain,height,uplift,moisture,detail,ridge,valley,arid,dune};
}
export function terrainColor(t:Terrain,latitude:number):[number,number,number] {
  const latitudeAbs=Math.abs(latitude),shelf=Math.pow(1-Math.abs(t.land*2-1),2);
  const depth=.85+t.detail*.3;
  const water:[number,number,number]=[(.003+shelf*.013)*depth,(.014+shelf*.075)*depth,(.033+shelf*.083)*depth];
  const grass=smooth(.34,.62,t.moisture),rock=smooth(.18,.56,t.mountain+t.uplift*.58);
  const snow=smooth(.77,.98,latitudeAbs*latitudeAbs+t.height/CONTRACT.visual.terrainHeight*.36+(t.detail-.5)*.09);
  const vegetation=(.62+t.detail*.74)*(1-t.valley*.2);
  let r=(.108-grass*.079)*vegetation,g=(.111-grass*.048)*vegetation,b=(.062-grass*.039)*vegetation;
  const sand=.73+t.dune*.07+t.detail*.32;
  r=r*(1-t.arid)+.195*sand*t.arid;g=g*(1-t.arid)+.159*sand*t.arid;b=b*(1-t.arid)+.101*sand*t.arid;
  const strata=.63+t.ridge*.13+t.detail*.42;
  r=r*(1-rock)+.169*strata*rock;g=g*(1-rock)+.16*strata*rock;b=b*(1-rock)+.137*strata*rock;
  const beach=(1-smooth(.62,.86,t.land))*smooth(.47,.68,t.land)*(1-snow)*.42;
  r=r*(1-beach)+.245*beach;g=g*(1-beach)+.222*beach;b=b*(1-beach)+.161*beach;
  const ice=.68+t.detail*.17-t.valley*.06;
  r=r*(1-snow)+ice*snow;g=g*(1-snow)+(ice+.017)*snow;b=b*(1-snow)+(ice+.027)*snow;
  const shore=smooth(.33,.85,t.land);
  return [water[0]*(1-shore)+r*shore,water[1]*(1-shore)+g*shore,water[2]*(1-shore)+b*shore];
}
export function direction(u:number,v:number):Point { const a=(u%1)*Math.PI*2,b=v*Math.PI,s=v===0||v===1?0:Math.sin(b);return [Math.cos(a)*s,Math.cos(b),Math.sin(a)*s]; }
export function normalize(p:Point):Point {const l=Math.hypot(...p);return [p[0]/l,p[1]/l,p[2]/l];}
export function cross(a:Point,b:Point):Point {return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
