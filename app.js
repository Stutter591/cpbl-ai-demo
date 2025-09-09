import { initialState, applyEvent } from './rules.js';

async function loadEvents() {
  const res = await fetch('./events.json');
  return await res.json();
}

function renderScoreboard(linescore) {
  const maxInning = Math.max(linescore.away.length, linescore.home.length, 9);
  let html = "<table><tr><th></th>";
  for (let i=1;i<=maxInning;i++) html += `<th>${i}</th>`;
  html += "<th>R</th></tr>";
  const sum = arr => arr.reduce((a,b)=>a+b,0);
  const row = (team, arr) => `<tr><td>${team}</td>` +
    [...Array(maxInning)].map((_,i)=>`<td>${arr[i]||""}</td>`).join("") +
    `<td>${sum(arr)}</td></tr>`;
  html += row("Away", linescore.away);
  html += row("Home", linescore.home);
  html += "</table>";
  document.getElementById("scoreboard").innerHTML = html;
}

function renderBases(bases) {
  const b = document.getElementById("bases");
  b.innerHTML = `
    <div class="base home ${false?'active':''}"></div>
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
  const log = frames.map(f=>`${f.ts} | ${f.event.code} | before:${f.before.bases}/${f.before.outs} → after:${f.after.bases}/${f.after.outs} | runs:${f.runs}`).join("\n");
  document.getElementById("timeline").innerText = log;
}

async function main() {
  const events = await loadEvents();
  const state = initialState();
  const frames = [];
  for (const ev of events) {
    const result = applyEvent(state, ev);
    frames.push({
      ts: ev.ts, event: {code: ev.code},
      before: result.before, after: result.after,
      runs: (state.linescore[state.batting][state.inning-1]||0)
    });
  }
  renderScoreboard(state.linescore);
  renderBases(state.bases);
  renderStatus(state);
  renderTimeline(frames);
}
main();
