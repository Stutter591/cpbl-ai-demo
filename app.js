import { initialState, applyEvent } from './rules.js';

const tz = 'Asia/Taipei';
const fmt = new Intl.DateTimeFormat('zh-TW', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });

function setVersionText(text){ const el=document.getElementById('version'); if(el) el.textContent=text; }
async function sha256Short(text){ const enc=new TextEncoder().encode(text); const buf=await crypto.subtle.digest('SHA-256',enc); return Array.from(new Uint8Array(buf)).slice(0,4).map(b=>b.toString(16).padStart(2,'0')).join(''); }

async function loadEventsWithMeta(){
  const url='./events.json';
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text=await res.text();
  let json; try{ json=JSON.parse(text);}catch(e){ throw new Error(`events.json 非合法 JSON：${e.message}`);}
  const lm=res.headers.get('Last-Modified');
  if(lm){ setVersionText(`資料版本：${fmt.format(new Date(lm))}`); }
  else{ setVersionText(`資料版本：內容雜湊 ${await sha256Short(text)}`); }
  return json;
}

function renderScoreboard(linescore){
  const maxInning=Math.max(linescore.away.length, linescore.home.length, 9);
  let html="<table><tr><th></th>";
  for(let i=1;i<=maxInning;i++) html+=`<th>${i}</th>`;
  html+="<th>R</th></tr>";
  const sum=a=>(a||[]).reduce((x,y)=>x+(y||0),0);
  const row=(team,arr=[])=>`<tr><td>${team}</td>`+[...Array(maxInning)].map((_,i)=>`<td>${arr[i]??""}</td>`).join("")+`<td>${sum(arr)}</td></tr>`;
  html+=row("Away",linescore.away||[]); html+=row("Home",linescore.home||[]); html+="</table>";
  document.getElementById("scoreboard").innerHTML=html;
}
 function renderBases(bases){
  // 以 260x260 畫布、菱形四角：上(130,24) 右(236,130) 下(130,236) 左(24,130)
  // 壘位：二壘=上端附近、一壘=右端附近、三壘=左端附近
   const on1 = bases.on1 ? 'on' : '';
   const on2 = bases.on2 ? 'on' : '';
   const on3 = bases.on3 ? 'on' : '';
   document.getElementById('bases').innerHTML = `
   <svg id="diamond" viewBox="0 0 260 260" aria-label="壘包菱形">
      <!-- 外框菱形 -->
      <path class="diamond-line" d="M130,24 L236,130 L130,236 L24,130 Z"/>
      <!-- 二壘 -->
      <rect x="118" y="36" width="24" height="24" transform="rotate(45 130 48)" class="base-node ${on2}" />
      <!-- 一壘 -->
      <rect x="212" y="118" width="24" height="24" transform="rotate(45 224 130)" class="base-node ${on1}" />
      <!-- 三壘 -->
      <rect x="36" y="118" width="24" height="24" transform="rotate(45 48 130)" class="base-node ${on3}" />
   </svg>`;
}
function renderStatus(state){
  document.getElementById("pillInning").textContent = `${state.inning}${state.half==='TOP'?'上':'下'}`;
  document.getElementById("pillOuts").textContent = state.outs;
  document.getElementById("pillBat").textContent = state.batting === 'away' ? 'Away' : 'Home';
}
function renderTimeline(frames, idx){
  const log=frames.map((f,i)=>`${i===idx?'👉 ':''}${f.ts||'--:--'} | ${f.event.code} | ${f.before.bases}/${f.before.outs} → ${f.after.bases}/${f.after.outs} | runs:${f.runs}`).join("\n");
  document.getElementById("timeline").textContent=log;
}
function renderNow(frames, idx){
  const el=document.getElementById('nowEvent');
  if(!el) return;
  if(idx<0){ el.textContent="等待播放…"; return; }
  const f=frames[idx]; el.textContent=`#${idx+1} ${f.ts||'--:--'} ${f.event.code}  ${f.before.bases}/${f.before.outs}→${f.after.bases}/${f.after.outs}`;
}

/* 播放器狀態 */
let frames=[], current=-1, timer=null;
let snapshotPerStep=[]; // 每步的 state 快照（用於回放渲染）
function takeSnapshot(state){
  return JSON.parse(JSON.stringify({ bases:state.bases, outs:state.outs, linescore:state.linescore, inning:state.inning, half:state.half, batting:state.batting }));
}

function showStep(idx){
  if(idx<0 || idx>=frames.length) return;
  current=idx;
  const snap=snapshotPerStep[idx]; // 該步完成後的狀態
  renderScoreboard(snap.linescore);
  renderBases(snap.bases);
  renderStatus(snap);
  renderTimeline(frames, idx);
  renderNow(frames, idx);
}

function play(){
  if(timer || frames.length===0) return;
  const speedSel=document.getElementById('speed'); 
  const interval= Number(speedSel?.value || 800);
  timer=setInterval(()=>{
    if(current>=frames.length-1){ pause(); return; }
    showStep(current+1);
  }, interval);
}
function pause(){ if(timer){ clearInterval(timer); timer=null; } }
function prev(){ pause(); if(current>0) showStep(current-1); }
function next(){ pause(); if(current<frames.length-1) showStep(current+1); }

async function main(){
  try{
    const events=await loadEventsWithMeta();
    // 先跑一遍建立 frames 與每步快照
    const state=initialState();
    frames=[]; snapshotPerStep=[]; current=-1;
    let prevRuns=0;
    for(const ev of events){
      const { before, after } = applyEvent(state, ev);
      const arr=state.linescore[state.batting]||[];
      const cur=arr[state.inning-1] ?? 0;
      frames.push({ ts:ev.ts, event:{code:ev.code}, before, after, runs: cur - prevRuns });
      prevRuns=cur;
      snapshotPerStep.push( takeSnapshot(state) );
    }

    // 初始畫面（未播放）
    renderScoreboard({away:[],home:[]});
    renderBases({on1:false,on2:false,on3:false});
    renderStatus({inning:1,half:"TOP",outs:0,batting:"away"});
    renderTimeline(frames, -1);
    renderNow(frames, -1);

    // 綁定控制
    document.getElementById('btnPlay').onclick=()=> (timer? pause(): play());
    document.getElementById('btnPrev').onclick=prev;
    document.getElementById('btnNext').onclick=next;
  }catch(e){
    setVersionText('資料版本：讀取失敗');
    document.getElementById('timeline').textContent=`❌ 載入或解析 events.json 失敗：${e.message}`;
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", main);
