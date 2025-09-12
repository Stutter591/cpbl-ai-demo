// app.js — 包事件清單（無 timeline 命名衝突），每列含流水號 + event 中文
import { initialState, applyEvent } from './rules.js';

const tz = 'Asia/Taipei';
const fmt = new Intl.DateTimeFormat('zh-TW', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });

function setVersionText(text){ const el=document.getElementById('version'); if(el) el.textContent=text; }
async function sha256Short(text){ const enc=new TextEncoder().encode(text); const buf=await crypto.subtle.digest('SHA-256',enc); return Array.from(new Uint8Array(buf)).slice(0,4).map(b=>b.toString(16).padStart(2,'0')).join(''); }

// 報錯更新catch
function showError(msg){
  const box = document.getElementById('errorBox');
  if (box) box.textContent = `❌ ${msg}`;
}
function clearError(){
  const box = document.getElementById('errorBox');
  if (box) box.textContent = '';
}

async function loadEventsWithMeta(){
  const url='./events.json';
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text=await res.text();
  let json; try{ json=JSON.parse(text);}catch(e){ throw new Error(`events.json 非合法 JSON：${e.message}`);}
  const lm=res.headers.get('Last-Modified');
  if(lm){ setVersionText(`資料版本：${fmt.format(new Date(lm))}`); }
  else { setVersionText(`資料版本：內容雜湊 ${await sha256Short(text)}`); }
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
  const on1 = bases.on1 ? 'on' : '';
  const on2 = bases.on2 ? 'on' : '';
  const on3 = bases.on3 ? 'on' : '';
  document.getElementById('bases').innerHTML = `
   <svg id="diamond" viewBox="0 0 260 260" aria-label="壘包菱形">
     <path class="diamond-line" d="M130,24 L236,130 L130,236 L24,130 Z"/>
     <rect x="118" y="24" width="24" height="24" transform="rotate(45 130 36)" class="base-node ${on2}" />
     <rect x="212" y="118" width="24" height="24" transform="rotate(45 224 130)" class="base-node ${on1}" />
     <rect x="24" y="118" width="24" height="24" transform="rotate(45 36 130)" class="base-node ${on3}" />
   </svg>`;
}

// dots
function ensureOutDots() {
  const dots = document.querySelector('.outs .dots');
  if (dots && (!document.getElementById('out1') || !document.getElementById('out2'))) {
    dots.innerHTML = '<i id="out1"></i><i id="out2"></i>';
  }
}
function ensureCountDots(){
  const balls = document.querySelector('.dots-balls');
  if (balls && !document.getElementById('b1')) {
    balls.innerHTML = '<i id="b1"></i><i id="b2"></i><i id="b3"></i><i id="b4"></i>';
  }
  const strikes = document.querySelector('.dots-strikes');
  if (strikes && !document.getElementById('s1')) {
    strikes.innerHTML = '<i id="s1"></i><i id="s2"></i><i id="s3"></i>';
  }
}

function renderStatus(state){
  const half = state.half === 'TOP' ? '上' : '下';
  const batting = state.batting === 'away' ? 'Away' : 'Home';
  const pillInning = document.getElementById("pillInning");
  const pillBat = document.getElementById("pillBat");
  if (pillInning) pillInning.textContent = `${state.inning}${half}`;
  if (pillBat) pillBat.textContent = batting;

  ensureOutDots(); ensureCountDots();

  const balls = Math.max(0, Math.min(4, state.count?.balls ?? 0));
  ['b1','b2','b3','b4'].forEach((id, idx)=>{
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', balls >= idx+1);
  });
  const strikes = Math.max(0, Math.min(3, state.count?.strikes ?? 0));
  ['s1','s2','s3'].forEach((id, idx)=>{
    const el = document.getElementById(id);
    if (el) el.classList.toggle('on', strikes >= idx+1);
  });
  const o1 = document.getElementById('out1'), o2 = document.getElementById('out2');
  if (o1 && o2) { o1.classList.toggle('on', state.outs >= 1); o2.classList.toggle('on', state.outs >= 2); }
}

// helper: bases string already in frames; show advances hint
function formatAdvances(ev) {
  const adv = ev?.runner_advances;
  if (!Array.isArray(adv) || adv.length === 0) return "";
  const zh = { first:"一壘", second:"二壘", third:"三壘", home:"本壘", out:"出局" };
  return " [" + adv.map(a => `${zh[a.from]||a.from}→${zh[a.to]||a.to}`).join(", ") + "]";
}

// 現在事件（中文 event）
function renderNow(frames, idx){
  const el=document.getElementById('nowEvent');
  if(!el){ return; }
  if(idx<0){ el.textContent="等待播放…"; renderCounter(-1, frames.length); return; }
  const f=frames[idx];
  const advTxt = formatAdvances(f.event);
  const desc = f.event.event || f.event.code;
  el.textContent=`#${idx+1} ${f.ts||'--:--'}  ${desc}  ${f.before.bases}/${f.before.outs} → ${f.after.bases}/${f.after.outs}${advTxt}`;
  renderCounter(idx, frames.length);
}

// 事件清單（像 timeline，但名稱避免衝突）
function renderEventList(frames, currentIdx){
  const el = document.getElementById('eventList');
  if(!el) return;

  if (frames.length === 0) {
    el.textContent = "";
    return;
  }

  // 計算顯示視窗：最多 10 筆，優先顯示「以目前事件為結尾」的視窗
  let end = (currentIdx >= 0) ? Math.min(frames.length, currentIdx + 1) : Math.min(frames.length, 10);
  let start = Math.max(0, end - 10);

  const slice = frames.slice(start, end);

  const lines = slice.map((f, iInSlice) => {
    const realIndex = start + iInSlice;             // 真實事件序號
    const mark = (realIndex === currentIdx) ? '👉 ' : '   ';
    const desc = f.event.event || f.event.code;
    const advTxt = formatAdvances(f.event);
    return `${mark}#${realIndex+1} ${f.ts||'--:--'}  ${desc}  ${f.before.bases}/${f.before.outs} → ${f.after.bases}/${f.after.outs}${advTxt} | runs:${f.runs}`;
  });

  el.textContent = lines.join("\n");
}

function renderCounter(idx,total){
  const el=document.getElementById('evtCounter');
  if(!el) return;
  el.textContent = `事件：${Math.max(0,idx+1)} / ${total}`;
}

/* 播放器狀態 */
let frames=[], current=-1, timer=null;
let snapshotPerStep=[];

function takeSnapshot(state){
  return JSON.parse(JSON.stringify({
    bases: state.bases,
    outs: state.outs,
    linescore: state.linescore,
    inning: state.inning,
    half: state.half,
    batting: state.batting,
    count: state.count
  }));
}

function showStep(idx){
  if(idx<0 || idx>=frames.length) return;
  current=idx;
  const snap=snapshotPerStep[idx];
  renderScoreboard(snap.linescore);
  renderBases(snap.bases);
  renderStatus(snap);
  renderNow(frames, idx);
  renderEventList(frames, idx);
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
    clearError();  // 呼叫報錯警告
    ensureOutDots(); ensureCountDots();
    const events=await loadEventsWithMeta();

    const state=initialState();
    frames=[]; snapshotPerStep=[]; current=-1;

    let prevRuns=0;
    let lastKey = `${state.batting}:${state.inning}`;

    for(const ev of events){
      const { before, after } = applyEvent(state, ev);

      const key = `${state.batting}:${state.inning}`;
      if (key !== lastKey) { prevRuns = 0; lastKey = key; }

      const arr=state.linescore[state.batting]||[];
      const cur=arr[state.inning-1] ?? 0;

      frames.push({
        ts: ev.ts,
        event: { code: ev.code, event: ev.event, meta: ev.meta },
        before,
        after,
        runs: cur - prevRuns
      });
      prevRuns=cur;

      snapshotPerStep.push( takeSnapshot(state) );
    }

    // 初始畫面
    renderScoreboard({away:[],home:[]});
    renderBases({on1:false,on2:false,on3:false});
    renderStatus({inning:1,half:"TOP",outs:0,batting:"away",count:{balls:0,strikes:0}});
    renderNow(frames, -1);
    renderEventList(frames, -1);

    // 控制綁定
    document.getElementById('btnPlay').onclick=()=> (timer? pause(): play());
    document.getElementById('btnPrev').onclick=prev;
    document.getElementById('btnNext').onclick=next;
  }catch(e){
    setVersionText('資料版本：讀取失敗');
    const el = document.getElementById('nowEvent');
    if (el) el.textContent=`❌ 載入或解析 events.json 失敗：${e.message}`;
    showError(`載入或解析 events.json 失敗：${e.message}`); //報錯Json格式錯誤
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", main);
