import { initialState, applyEvent } from './rules.js';

const tz = 'Asia/Taipei';
const fmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: tz, dateStyle: 'medium', timeStyle: 'short'
});

function setVersionText(text) {
  const el = document.getElementById('version');
  if (el) el.textContent = text;
}

async function sha256Short(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).slice(0, 4) // 4 bytes = 8 hex
    .map(b => b.toString(16).padStart(2,'0')).join('');
}

async function loadEventsWithMeta() {
  const url = './events.json';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  // 解析 JSON 內容
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`events.json 不是合法 JSON：${e.message}`); }

  // 版本資訊：Last-Modified / ETag / 內容雜湊
  const lm = res.headers.get('Last-Modified');   // e.g. "Tue, 09 Sep 2025 06:35:12 GMT"
  const etag = res.headers.get('ETag');          // e.g. "W/\"ab12cd...\""
  let versionText = '';

  if (lm) {
    const d = new Date(lm);
    versionText = `資料版本：${fmt.format(d)}`;
  } else {
    const short = await sha256Short(text);
    versionText = `資料版本：內容雜湊 ${short}`;
  }
  setVersionText(versionText);

  return json;
}

function renderScoreboard(linescore) {
  const maxInning = Math.max(linescore.away.length, linescore.home.length, 9);
  let html = "<table><tr><th></th>";
  for (let i=1;i<=maxInning;i++) html += `<th>${i}</th>`;
  html += "<th>R</th></tr>";
  const sum = arr => (arr || []).reduce((a,b)=>a+(b||0),0);
  const row = (team, arr=[]) => `<tr><td>${team}</td>` +
    [...Array(maxInning)].map((_,i)=>`<td>${arr[i] ?? ""}</td>`).join("") +
    `<td>${sum(arr)}</td></tr>`;
  html += row("Away", linescore.away || []);
  html += row("Home", linescore.home || []);
  html += "</table>";
  document.getElementById("scoreboard").innerHTML = html;
}

function renderBases(bases) {
  const b = document.getElementById("bases");
  b.innerHTML = `
    <div class="base home"></div>
    <div class="base first ${bases.on1?'active':''}"></div>
    <div class="base second ${bases.on2?'active':''}"></div>
    <div class="base third ${bases.on3?'active':''}"></div>
  `;
}

function renderStatus(state) {
  document.getElementById("status").innerText =
    `Inning: ${state.inning} ${state.half} | Outs: ${state.outs} | Batting: ${state.batting}`;
}

function renderTimeline(frames) {
  if (!frames.length) {
    document.getElementById("timeline").textContent = "（尚無事件，請確認 events.json 是否有內容）";
    return;
  }
  const log = frames.map(f=>`${f.ts || '--:--'} | ${f.event.code} | before:${f.before.bases}/${f.before.outs} → after:${f.after.bases}/${f.after.outs} | runs:${f.runs}`).join("\n");
  document.getElementById("timeline").textContent = log;
}

function showError(msg, err) {
  const el = document.getElementById('timeline');
  const detail = (err && err.stack) ? `\n${err.stack}` : (err ? `\n${err}` : '');
  el.textContent = `❌ ${msg}${detail}`;
  console.error(msg, err);
}

async function main() {
  try {
    const events = await loadEventsWithMeta();     // 讀事件 + 顯示版本號
    const state = initialState();
    const frames = [];

    let prevRuns = 0;
    for (const ev of events) {
      const { before, after } = applyEvent(state, ev);
      const arr = state.linescore[state.batting] || [];
      const cur = arr[state.inning-1] ?? 0;
      frames.push({ ts: ev.ts, event: {code: ev.code}, before, after, runs: cur - prevRuns });
      prevRuns = cur;
    }

    renderScoreboard(state.linescore);
    renderBases(state.bases);
    renderStatus(state);
    renderTimeline(frames);
  } catch (err) {
    setVersionText('資料版本：讀取失敗');
    showError("無法載入或解析 events.json", err);
  }
}

main();
