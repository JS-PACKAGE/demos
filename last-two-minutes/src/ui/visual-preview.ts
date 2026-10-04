import { createVisualPreview, type VisualPreview, type PreviewView } from '../scene/visual-preview.ts';
import './visual-preview.css';

const root=document.querySelector<HTMLElement>('#preview')!;
const canvas=document.querySelector<HTMLCanvasElement>('#scene')!;
const loading=document.querySelector<HTMLElement>('#loading')!;
const failure=document.querySelector<HTMLElement>('#failure')!;
const restart=document.querySelector<HTMLButtonElement>('#restart')!;
const music=document.querySelector<HTMLButtonElement>('#music')!;
const pause=document.querySelector<HTMLButtonElement>('#pause')!;
const soundNote=document.querySelector<HTMLElement>('#sound-note')!;
let soundEnabled=false;
const progress=document.querySelector<HTMLProgressElement>('#time')!;
const clock=document.querySelector<HTMLOutputElement>('#clock')!;
const metrics=document.querySelector<HTMLOutputElement>('#metrics')!;
const shotName=document.querySelector<HTMLElement>('#shot-name')!;
const shotDetail=document.querySelector<HTMLElement>('#shot-detail')!;
const links=[...document.querySelectorAll<HTMLAnchorElement>('nav a')];
const descriptions:Record<PreviewView,[string,string]>={
  flyby:['艦船掠過星球','前景裝甲、艦橋與引擎；中景曲面地形與薄大氣；背景星域。'],
  wounded:['命中後，板塊錯位與塌陷','曲面地殼逐塊翹起、錯位；命中坑塌陷，裂隙露出厚岩層與深處熱光。'],
  aftermath:['曲面地殼翻開，然後暗下來','不規則厚殼與破裂剖面；核心釋放、震波、塵埃與遠近殘骸。'],
  combat:['戰艦交火：護盾、燃燒與擊毀','炮口瞄準移動艦船；實際彈道、局部護盾、裝甲破口燃燒與冷卻中的爆炸殘骸。'],
};
let runtime:VisualPreview|undefined;
let busy=false, lastTick=-1, lastMetric=-1, idle:number|undefined;
function desiredView():PreviewView {
  const hash=location.hash.slice(1);return hash==='wounded'||hash==='aftermath'||hash==='combat'?hash:'flyby';
}
function showControls():void {
  root.dataset.controls='true';clearTimeout(idle);
  if(root.dataset.ready==='true') idle=setTimeout(()=>{
    if(!document.activeElement?.closest('nav,button,details')) root.dataset.controls='false';
  },3000);
}
window.addEventListener('pointermove',showControls,{passive:true});
window.addEventListener('pointerdown',showControls,{passive:true});
window.addEventListener('keydown',showControls);document.addEventListener('focusin',showControls);
function fail(message:string):void { failure.textContent=message;failure.hidden=false;loading.hidden=true;restart.disabled=music.disabled=pause.disabled=true; }
function showMetrics():void {
  if(!runtime) return;
  const m=runtime.metrics();
  metrics.dataset.measurement=JSON.stringify(m);
  metrics.textContent=`${m.backend} · ${m.resolution} · HDR ${m.hdr?'開':'關'} · ${m.samples} 幀樣本\n`+
    `幀間隔 p50 ${m.frameP50.toFixed(2)} / p95 ${m.frameP95.toFixed(2)} / peak ${m.frameMax.toFixed(2)} ms\n`+
    `CPU 提交 p95 ${m.cpuP95.toFixed(2)} / peak ${m.cpuMax.toFixed(2)} ms\n`+
    `GPU ${m.gpuStatus} · 最近 ${m.gpuMs?.toFixed(2)??'未量得'} / 本次執行 peak ${m.gpuMax?.toFixed(2)??'未量得'} ms\n`+
    `主 pass ${m.drawCalls} draws · ${m.triangles.toLocaleString()} triangles`;
}
function frame(view:PreviewView,time:number):void {
  const tick=Math.floor(time*10);
  if(tick!==lastTick){lastTick=tick;progress.value=time;clock.textContent=`${time.toFixed(1)} / 12.0 秒`;}
  const second=Math.floor(time);
  if(second!==lastMetric){lastMetric=second;showMetrics();}
  if(time>=12 && root.dataset.ended!=='true'){root.dataset.ended='true';pause.disabled=true;showControls();showMetrics();}
  root.dataset.view=view;
}
async function select(replay=false):Promise<void> {
  if(!runtime||busy) return;
  busy=true;restart.disabled=true;root.dataset.ended='false';lastTick=lastMetric=-1;
  try {
    const view=desiredView();
    if(replay) await runtime.restart();else await runtime.select(view);
    root.dataset.view=view;
    shotName.textContent=descriptions[view][0];shotDetail.textContent=descriptions[view][1];
    for(const link of links) link.setAttribute('aria-current',String(link.dataset.view===view));
    showControls();
  } catch(error){fail(error instanceof Error?error.message:String(error));}
  finally {busy=false;restart.disabled=pause.disabled=!failure.hidden;music.disabled=soundEnabled||!failure.hidden;pause.textContent='暫停';if(failure.hidden&&root.dataset.view!==desiredView())void select();}
}
window.addEventListener('hashchange',()=>{void select();});
restart.addEventListener('click',()=>{void select(true);});
music.addEventListener('click',async()=>{
  if(!runtime||busy)return;
  busy=true;music.disabled=restart.disabled=pause.disabled=true;
  try {
    await runtime.enableSound();soundEnabled=true;
    music.textContent='配樂已開';soundNote.textContent='即時 OPM FM 配樂';
    root.dataset.ended='false';lastTick=lastMetric=-1;showControls();
  }catch(error){soundNote.textContent=`配樂未能開啟：${error instanceof Error?error.message:String(error)}`;}
  finally {busy=false;music.disabled=soundEnabled;restart.disabled=pause.disabled=!failure.hidden;if(failure.hidden&&root.dataset.view!==desiredView())void select();}
});
pause.addEventListener('click',()=>{
  if(!runtime||busy)return;
  if(runtime.paused){runtime.resume();pause.textContent='暫停';}
  else{runtime.pause();pause.textContent='繼續';}
  showControls();
});
window.addEventListener('pagehide',()=>{clearTimeout(idle);runtime?.dispose();runtime=undefined;});
async function boot():Promise<void> {
  try {
    runtime=await createVisualPreview(canvas,frame,fail);
    await select();
    if(failure.hidden){loading.hidden=true;root.dataset.ready='true';showControls();showMetrics();}
  }catch(error){fail(error instanceof Error?error.message:String(error));}
}
void boot();
