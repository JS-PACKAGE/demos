import { Texture } from 'xyz.js';
import { CONTRACT, seededRandom } from '../show/contract.ts';

export async function makeTextures(): Promise<{ white:Texture; ground:Texture; cities:Texture; haze:Texture; shadow:Texture }> {
  const size = CONTRACT.budgets.textureSize;
  const canvas = document.createElement('canvas'); canvas.width=size; canvas.height=size/2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法建立程序貼圖');
  const random=seededRandom(CONTRACT.seed);
  const image=ctx.createImageData(canvas.width,canvas.height);
  for(let y=0;y<canvas.height;y++) for(let x=0;x<size;x++) {
    const u=x/size*Math.PI*2,v=y/canvas.height*Math.PI;
    const land=Math.sin(u*3+Math.sin(v*7)*1.6)+.55*Math.sin(u*9-v*8)+.25*Math.sin(u*23+v*17);
    const cloud=Math.max(0,Math.sin(u*11+v*13)*Math.sin(u*7-v*19)-.45);
    const i=(y*size+x)*4, polar=Math.pow(Math.abs(Math.cos(v)),18);
    image.data[i]=Math.round(land>.25?18+cloud*35+polar*85:5+polar*75);
    image.data[i+1]=Math.round(land>.25?34+cloud*42+polar*80:17+polar*70);
    image.data[i+2]=Math.round(land>.25?41+cloud*48+polar*80:34+polar*60);
    image.data[i+3]=255;
  }
  ctx.putImageData(image,0,0); const ground=await Texture.fromImage(canvas);
  ctx.fillStyle='#000';ctx.fillRect(0,0,size,canvas.height);
  for(let i=0;i<size*9;i++) {
    const x=random()*size,y=random()*canvas.height;
    const u=x/size*Math.PI*2,v=y/canvas.height*Math.PI;
    const land=Math.sin(u*3+Math.sin(v*7)*1.6)+.55*Math.sin(u*9-v*8)+.25*Math.sin(u*23+v*17);
    if(land<.4||Math.abs(Math.cos(v))>.92) continue;
    ctx.fillStyle=random()>.82?'#dceeff':'#e9ba71';
    ctx.fillRect(x,y,random()>.95?3:1,1);
    if(i%7===0){ctx.globalAlpha=.35;ctx.fillRect(x-4,y,8,1);ctx.globalAlpha=1;}
  }
  const cities=await Texture.fromImage(canvas);
  canvas.width=64;canvas.height=64;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,64,64); const white=await Texture.fromImage(canvas);
  ctx.clearRect(0,0,64,64);
  const gradient=ctx.createRadialGradient(32,32,3,32,32,32);
  gradient.addColorStop(0,'rgba(100,175,255,.07)');gradient.addColorStop(.86,'rgba(65,150,255,.08)');gradient.addColorStop(.96,'rgba(80,170,255,.6)');gradient.addColorStop(1,'rgba(80,160,255,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);const haze=await Texture.fromImage(canvas);
  ctx.clearRect(0,0,64,64);
  const dark=ctx.createRadialGradient(32,32,8,32,32,32);dark.addColorStop(0,'rgba(0,0,0,.92)');dark.addColorStop(.7,'rgba(0,0,0,.8)');dark.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=dark;ctx.fillRect(0,0,64,64);const shadow=await Texture.fromImage(canvas);
  return {white,ground,cities,haze,shadow};
}
