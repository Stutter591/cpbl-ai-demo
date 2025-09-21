// app.js — 棒球事件播放器
import { initialState, applyEvent } from './rules.js';

// 可由外部覆寫的 API 根網址（開發時預設指向本機，部署時可注入 window.APP_CONFIG.apiBase）
const API_BASE = window.APP_CONFIG?.apiBase || window.__API_BASE__ || (location.hostname === '127.0.0.1' || location.hostname === 'localhost' ? 'http://127.0.0.1:7000' : `${location.protocol}//${location.host}`);

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

let teamLabels = { away: '客隊', home: '主隊' };

async function loadTeamLabels(){
  try{
    const res = await fetch(`${API_BASE}/data/schedule/games-2025-09.json`, {cache: 'no-store'});
    if(!res.ok) return;
    const list = await res.json();
    if(!Array.isArray(list) || list.length===0) return;

    const params = new URLSearchParams(window.location.search);
    const targetSno = params.get('gameSno');
    const targetDate = params.get('date');

    let match = null;
    if (targetSno) {
      match = list.find(item => String(item.GameSno) === String(targetSno));
    }
    if (!match && targetDate) {
      match = list.find(item => item.date === targetDate);
    }
    if (!match) {
      match = list[0];
    }

    if (match && Array.isArray(match.teams) && match.teams.length >= 2) {
      teamLabels = { away: match.teams[0], home: match.teams[1] };
    }
  }catch(err){
    console.warn('無法載入隊伍資訊：', err);
  }
}

async function loadGameOptions(){
  try{
    // 載入比賽排程檔案
    const response = await fetch(`${API_BASE}/data/schedule/games-2025-09.json`, {cache: 'no-store'});
    if(!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const games = await response.json();
    const gameSelect = document.getElementById('gameSelect');
    
    if(gameSelect && Array.isArray(games)) {
      // 清空現有選項
      gameSelect.innerHTML = '';
      
      // 添加預設選項
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = '預設檔案 (events.json)';
      gameSelect.appendChild(defaultOption);
      
      // 處理比賽資料並創建選項
      games.forEach(game => {
        if(game.GameSno && game.KindCode && game.teams && Array.isArray(game.teams) && game.teams.length >= 2) {
          // 由 date 取得年份，組合成 Year-KindCode-GameSno 格式 (例如: 2025-A-313)
          const year = new Date(game.date).getFullYear();
          const gameId = `${year}-${game.KindCode}-${game.GameSno}`;
          const teamsText = game.teams.join(' vs ');
          
          // 根據時間判斷比賽狀態：昨天以前（已結束）、今天（即時）、未來（尚未開始）
          const gameDate = new Date(game.date);
          const today = new Date();
          const yesterday = new Date(today);
          yesterday.setDate(today.getDate() - 1);
          
          let mode, icon, label;
          if (gameDate.toDateString() === today.toDateString()) {
            // 今天的比賽 = 即時
            mode = 'live';
            icon = '🔴';
            label = '即時';
          } else if (gameDate <= yesterday) {
            // 昨天以前的比賽 = 已結束
            mode = 'history';
            icon = '📁';
            label = '已結束';
          } else {
            // 未來的比賽 = 尚未開始
            mode = 'future';
            icon = '⏰';
            label = '尚未開始';
          }
          
          const option = document.createElement('option');
          option.value = `${mode}:${gameId}`;
          option.textContent = `${icon} ${label}：${game.date} ${teamsText} (${gameId})`;
          gameSelect.appendChild(option);
          console.log('option:', option.value, option.textContent);
        }
      });
      
      console.log(`✅ 從 games-2025-09.json 載入了 ${games.length} 場比賽，生成了 ${games.length * 2} 個選項`);
    }
  }catch(err){
    console.warn('無法載入比賽選項：', err);
    // 如果載入失敗，顯示錯誤訊息
    const gameSelect = document.getElementById('gameSelect');
    if(gameSelect) {
      gameSelect.innerHTML = '<option value="">載入失敗</option>';
    }
  }
}

async function loadEventsWithMeta(){
  const res = await fetch(`${API_BASE}/data/games/events.json`, {cache: 'no-store'});
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  let json; 
  try { 
    json = JSON.parse(text);
  } catch(e) { 
    throw new Error(`events.json 非合法 JSON：${e.message}`);
  }
  
  const lm = res.headers.get('Last-Modified');
  if (lm) { 
    setVersionText(`資料版本：${fmt.format(new Date(lm))}`); 
  } else { 
    setVersionText(`資料版本：內容雜湊 ${await sha256Short(text)}`); 
  }
  return json;
}

// 即時事件 polling 功能
let livePollHandle = null;
let currentGameId = null;
const POLL_INTERVAL_MS = 5000; // 5 秒輪詢一次

async function fetchGameEvents(gameId) {
  try {
    const response = await fetch(`${API_BASE}/get-game-events/${gameId}`, {cache: 'no-store'});
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(`載入比賽 ${gameId} 事件失敗:`, error);
    return null;
  }
}

function loadEventsIntoPlayer(events) {
  // 先停止播放和清除狀態
  pause();
  frames = []; 
  snapshotPerStep = []; 
  current = -1;
  clearError();

  // 如果沒有事件資料，顯示空白狀態
  if (!events || !Array.isArray(events) || events.length === 0) {
    console.log('沒有事件資料，清除畫面');
    const emptyState = initialState();
    
    // 清除畫面，顯示初始狀態
    renderScoreboard({away: [], home: []});
    renderBases({on1: false, on2: false, on3: false});
    renderStatus({inning: 1, half: "TOP", outs: 0, batting: "away", count: {balls: 0, strikes: 0}});
    renderNow([], -1);
    renderEventList([], -1);
    renderEventSelect([], -1);
    return;
  }

  const state = initialState();

  let prevRuns = 0;
  let lastKey = `${state.batting}:${state.inning}`;

  for (const ev of events) {
    const { before, after } = applyEvent(state, ev);

    const key = `${state.batting}:${state.inning}`;
    if (key !== lastKey) { 
      prevRuns = 0; 
      lastKey = key; 
    }

    const arr = state.linescore[state.batting] || [];
    const cur = arr[state.inning - 1] ?? 0;

    frames.push({
      // 支援新舊兩種格式，新格式只有 event/code/runner_advances
      ts: ev.ts || new Date().toISOString(),
      event: { 
        code: ev.code, 
        event: ev.event || `Event ${ev.code}`, 
        meta: ev.meta || {} 
      },
      before,
      after,
      runs: cur - prevRuns
    });
    prevRuns = cur;

    snapshotPerStep.push(takeSnapshot(state));
  }

  // 重新渲染所有元件
  renderScoreboard({away: [], home: []});
  renderBases({on1: false, on2: false, on3: false});
  renderStatus({inning: 1, half: "TOP", outs: 0, batting: "away", count: {balls: 0, strikes: 0}});
  renderNow(frames, -1);
  renderEventList(frames, -1);
  renderEventSelect(frames, -1);

  // 顯示最新狀態
  if (frames.length > 0) {
    current = frames.length - 1;
    showStep(current);
  }

  console.log(`✅ 載入了 ${frames.length} 個事件到播放器`);
}

async function startLivePolling(gameId) {
  stopLivePolling();
  currentGameId = gameId;
  
  console.log(`🔴 開始監控比賽 ${gameId} 的即時事件`);
  
  // 立即載入一次
  const gameData = await fetchGameEvents(gameId);
  if (gameData) {
    setVersionText(`資料版本：${gameData.status === 'live' ? '即時比賽' : gameData.status === 'finished' ? '已結束' : '尚未開始'} - ${gameData.game_id} (${gameData.events_count} 筆事件)`);
    loadEventsIntoPlayer(gameData.events || []);
    
    if (gameData.status === 'finished') {
      console.log(`✅ 比賽 ${gameId} 已結束，停止監控`);
      return;
    }
  } else {
    setVersionText(`比賽 ${gameId} 載入失敗`);
    showError(`無法載入比賽 ${gameId} 的資料`);
    loadEventsIntoPlayer([]); // 清除畫面
    return;
  }
  
  // 設定定期輪詢
  livePollHandle = setInterval(async () => {
    const gameData = await fetchGameEvents(gameId);
    if (gameData) {
      setVersionText(`資料版本：${gameData.status === 'live' ? '即時比賽' : gameData.status === 'finished' ? '已結束' : '尚未開始'} - ${gameData.game_id} (${gameData.events_count} 筆事件)`);
      loadEventsIntoPlayer(gameData.events || []);
      
      if (gameData.status === 'finished') {
        console.log(`✅ 比賽 ${gameId} 已結束，停止監控`);
        stopLivePolling();
      }
    }
  }, POLL_INTERVAL_MS);
}

function stopLivePolling() {
  if (livePollHandle) {
    clearInterval(livePollHandle);
    livePollHandle = null;
    console.log('⏹️ 已停止即時事件監控');
  }
}

async function loadHistoricalGame(gameId) {
  stopLivePolling();
  console.log(`📁 載入歷史比賽 ${gameId}`);
  
  const gameData = await fetchGameEvents(gameId);
  if (gameData && gameData.events) {
    setVersionText(`資料版本：歷史比賽 - ${gameData.game_id} (${gameData.events_count} 筆事件)`);
    loadEventsIntoPlayer(gameData.events);
  } else {
    setVersionText(`比賽 ${gameId} 無資料`);
    showError(`找不到比賽 ${gameId} 的資料`);
    loadEventsIntoPlayer([]); // 清除畫面
  }
}

function renderScoreboard(linescore){
  const maxInning=Math.max(linescore.away.length, linescore.home.length, 9);
  let html="<table><tr><th></th>";
  for(let i=1;i<=maxInning;i++) html+=`<th>${i}</th>`;
  html+="<th>R</th></tr>";
  // 計算總分時忽略 "X"，只計算數字
  const sum=a=>(a||[]).reduce((x,y)=>x+(typeof y === 'number' ? y : 0),0);
  const row=(team,arr=[])=>`<tr><td>${team}</td>`+[...Array(maxInning)].map((_,i)=>`<td>${arr[i]??""}</td>`).join("")+`<td>${sum(arr)}</td></tr>`;
  html+=row(teamLabels.away || '客隊',linescore.away||[]);
  html+=row(teamLabels.home || '主隊',linescore.home||[]);
  html+="</table>";
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
  const batting = state.batting === 'away' ? (teamLabels.away || '客隊')
                                           : (teamLabels.home || '主隊');
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

function scoreToText(linescore){
  if(!linescore) return "0:0";
  const sum = arr => Array.isArray(arr)
    ? arr.reduce((acc,val)=> acc + (Number(val)||0),0)
    : 0;
  const away = sum(linescore.away);
  const home = sum(linescore.home);
  return `${away}:${home}`;
}

// 事件下拉清單：只顯示數字編號，點擊展開 10 列，選擇或失焦後收起，並跳到該事件
function renderEventSelect(frames, currentIdx) {
  const sel = document.getElementById('eventSelect');
  if (!sel) return;

  // 1) 建選項：value = 0-based, 顯示 = 1-based（只放純數字）
  if (sel.options.length !== frames.length) {
    sel.innerHTML = frames.map((_, i) => `<option value="${i}">${i + 1}</option>`).join('');
  }

  // 2) 初始選取：如果還沒開始（-1），就先顯示第 1 筆，避免外觀空白
  if (frames.length > 0) {
    sel.selectedIndex =
      (currentIdx >= 0 && currentIdx < frames.length) ? currentIdx : 0;
  } else {
    sel.selectedIndex = -1;
  }

  // 3) 只綁一次互動事件（避免重複綁定）
  if (!sel._bound) {
    sel.size = 1; // 保持「關閉」外觀

    // 點一下展開為 5 列（最多5列，不足5列就顯示實際數量），讓 select 絕對定位浮在原位，不推擠排版）
    const expand = () => {
      const n = sel.options.length;
      if (n <= 1) return;
      const rows = Math.min(5, n);
      sel.size = rows;
      sel.style.setProperty('--event-select-rows', rows);
      sel.classList.add('expanded');
    };
    const ensureExpanded = (event) => {
      if (!sel.classList.contains('expanded')) {
        expand();
        // 某些瀏覽器(Touch) 會立即觸發 blur → 再 focus，延遲一個 tick 確保 size 套上
        requestAnimationFrame(() => {});
      }
    };
    sel.addEventListener('mousedown', ensureExpanded);
    sel.addEventListener('focus', ensureExpanded);
    sel.addEventListener('touchstart', ensureExpanded, { passive: true });

    // 變更：跳到該事件，然後收起
    sel.addEventListener('change', () => {
      const idx = Number(sel.value);
      if (!Number.isNaN(idx)) {
        pause();       // 停止播放，避免計時器覆蓋
        showStep(idx); // 跳到選定事件
      }
      sel.size = 1;    // 收起
      sel.style.removeProperty('--event-select-rows');
      sel.classList.remove('expanded');
      sel.blur();
    });

    // 失焦保險，確保收起
    sel.addEventListener('blur', () => { sel.size = 1; 
      sel.style.removeProperty('--event-select-rows');
      sel.classList.remove('expanded');
    });

    sel._bound = true;
  }
}
// 現在事件（中文 event）
function renderNow(frames, idx){
  const el=document.getElementById('nowEvent');
  if(!el){ return; }
  if(idx<0){ el.textContent="等待播放…"; renderCounter(-1, frames.length); return; }
  const f=frames[idx];
  const desc = f.event.event || f.event.code || '';
  el.textContent = `#${idx+1} ${desc}`.trim();
  renderCounter(idx, frames.length);
}

// 事件清單（像 timeline，但名稱避免衝突）
function renderEventList(frames, currentIdx){
  const el = document.getElementById('eventList');
  if(!el) return;

  const n = frames.length;
  if (n === 0) { el.textContent = "等待播放…"; return; }

  // 決定顯示範圍 [start, end)
  let start, end;

  if (currentIdx < 0) {
    el.textContent = "等待播放…";
    return;
  } else {
    // 以目前事件為中心：前 3、自己、後 3
    start = Math.max(0, currentIdx - 3);
    end   = Math.min(n, currentIdx + 4); // +4 因為 end 為「開區間」

    // 若接近前端或尾端，嘗試補齊到 7 筆
    if (end - start < 7) {
      if (start === 0) {
        end = Math.min(n, start + 7);
      } else if (end === n) {
        start = Math.max(0, end - 7);
      }
    }
  }

  const slice = frames.slice(start, end);

  const lines = slice.map((f, iInSlice) => {
    const realIndex = start + iInSlice;             // 真實事件序號
    const mark = (realIndex === currentIdx) ? '👉 ' : '   ';
    const desc = f.event.event || f.event.code || '';
    const snap = snapshotPerStep[realIndex];
    const scoreText = `｜目前比分 ${scoreToText(snap?.linescore)}｜`;
    return `${mark}#${realIndex+1} ${scoreText} ${desc}`.trim();
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
  const sel = document.getElementById('eventSelect');
    if (sel && sel.value !== String(idx)) {
      sel.value = String(idx);
      const opt = sel.options[sel.selectedIndex];
      if (opt) opt.scrollIntoView({ block: "nearest" });
  }
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
    await loadTeamLabels();
    await loadGameOptions();  // 動態載入比賽選項
    ensureOutDots(); 
    ensureCountDots();
    
    // 檢查 URL 參數決定載入模式
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('game');
    const mode = params.get('mode'); // 'live' | 'history'
    
    // 控制綁定
    document.getElementById('btnPlay').onclick = () => (timer ? pause() : play());
    document.getElementById('btnPrev').onclick = prev;
    document.getElementById('btnNext').onclick = next;
    
    // 比賽選擇器事件處理
    const gameSelect = document.getElementById('gameSelect');
    if (gameSelect) {
      gameSelect.onchange = async (event) => {
        const selectedValue = event.target.value;
        
        try {
          clearError();
          
          if (!selectedValue) {
            // 載入預設檔案
            console.log('📁 載入預設 events.json 檔案');
            setVersionText('載入中...');
            stopLivePolling();
            const events = await loadEventsWithMeta();
            loadEventsIntoPlayer(events.events || events);
            return;
          }
          
          const [mode, gameId] = selectedValue.split(':');
          setVersionText(`載入 ${gameId} 中...`);
          
          if (mode === 'live') {
            console.log(`🔴 切換到即時比賽監控：${gameId}`);
            await startLivePolling(gameId);
          } else if (mode === 'history') {
            console.log(`📁 切換到歷史比賽：${gameId}`);
            await loadHistoricalGame(gameId);
          } else if (mode === 'future') {
            console.log(`⏰ 尚未開始的比賽：${gameId}`);
            setVersionText(`比賽 ${gameId} 尚未開始`);
            loadEventsIntoPlayer([]); // 載入空事件列表
          }
        } catch (error) {
          console.error('切換比賽時發生錯誤：', error);
          showError(`切換比賽失敗：${error.message}`);
          setVersionText('載入失敗');
        }
      };
    }
    
    if (gameId) {
      if (mode === 'live') {
        // 啟動即時監控
        await startLivePolling(gameId);
      } else {
        // 載入歷史比賽
        await loadHistoricalGame(gameId);
      }
    } else {
      // 預設載入 events.json
      console.log('📁 載入預設 events.json 檔案');
      const events = await loadEventsWithMeta();
      loadEventsIntoPlayer(events);
    }
    
  } catch(e) {
    setVersionText('資料版本：讀取失敗');
    const el = document.getElementById('nowEvent');
    if (el) el.textContent = `❌ 載入失敗：${e.message}`;
    showError(`載入失敗：${e.message}`);
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", main);
