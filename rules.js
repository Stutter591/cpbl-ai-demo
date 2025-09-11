// rules.js — Baseball rules engine (CPBL/MLB compatible, browser-ready ES module)

/** @typedef {"TOP"|"BOTTOM"} Half */
/** @typedef {{on1:boolean,on2:boolean,on3:boolean}} Bases */
/** @typedef {{away:number[],home:number[]}} Linescore */
/** @typedef {"away"|"home"} Side */

/**
 * 標準事件碼（建議從 ASR/NLP 正規化成這些）
 * - GO: 滾地球出局 (默認：打者在一壘出局；可 meta.doublePlay 觸發 DP)
 * - FO: 飛球出局 (默認：跑者不動；可 meta.tagUp 指定帶跑得分/推進)
 * - FC: 野手選擇 (通常前導跑者出局、打者上到一壘)
 * - DP/TP: 雙殺/三殺
 * 其餘請見下方 switch
 * @typedef {
 *  "1B"|"2B"|"3B"|"HR"|"BB"|"IBB"|"HBP"|
 *  "K"|"GO"|"FO"|"IF"|"SF"|"SAC"|"FC"|
 *  "DP"|"TP"|
 *  "SB2"|"SB3"|"SBH"|"CS2"|"CS3"|"PO1"|"PO2"|"PO3"|
 *  "WP"|"PB"|"BK"|
 *  "B"|"S"|"F"
 * } EventCode
 */

/**
 * PlayEvent.meta（可選）可提供細節，讓規則更精準
 * - for GO:
 *    - doublePlay: true|{order:["2","1"]}  // 例如 6-4-3，先封二再一
 *    - outsOn: ["BR","R1","R2","R3"]       // 指定誰出局（打者BR、壘上跑者 R1/R2/R3）
 * - for FO:
 *    - tagUp: {"R3":1,"R2":0,"R1":0}       // 誰在補位後推進，R3:1 代表三壘回本壘得分
 *    - sacrifice: true                     // 視為 SF（高飛犧牲打），會自動判定 R3 得分
 * - for FC:
 *    - outLead: "R3"|"R2"|"R1"             // 指定前導跑者被抓
 *    - batterSafeBase: 1                   // 打者上壘壘位（默認 1）
 * - for BB/HBP:
 *    - rbi: number                         // 少見但允許指定是否記分（默認按強迫進壘推斷）
 * @typedef {Object} Meta
 * @typedef {{from: 0|1|2|3, to: 1|2|3|4|"H"}} RunnerAdvance  // from=0 代表打者
 * @typedef {{ts?:string, event?:string, code:EventCode, runner_advances?: RunnerAdvance[], meta?:any}} PlayEvent
 */

/** @typedef {{ts?:string,raw?:string,code:EventCode,meta?:any}} PlayEvent */

/** @typedef {{
 * inning:number, half:Half, outs:number, bases:Bases,
 * linescore:Linescore, batting:Side, count:{balls:number,strikes:number}
 * }} GameState */

export function initialState() {
  return {
    inning: 1,
    half: "TOP",
    outs: 0,
    bases: { on1:false, on2:false, on3:false },
    linescore: { away:[], home:[] },
    batting: "away",
    count: { balls: 0, strikes: 0 }   // ✅ 新增：球數
  };
}

function scoreRun(state, n) {
  if (n <= 0) return;
  const arr = state.linescore[state.batting];
  while (arr.length < state.inning) arr.push(0);
  arr[state.inning - 1] += n;
}

function resetCount(state) {
  if (!state.count) state.count = { balls: 0, strikes: 0 };
  state.count.balls = 0;
  state.count.strikes = 0;
}

function switchHalfInning(state) {
  state.outs = 0;
  state.bases = { on1:false, on2:false, on3:false };
  resetCount(state); // ✅ 換半局清空球數
  if (state.half === "TOP") { state.half = "BOTTOM"; state.batting = "home"; }
  else { state.half = "TOP"; state.batting = "away"; state.inning += 1; }
}

function basesStr(b) {
  return (b.on1?'1':'-') + (b.on2?'2':'-') + (b.on3?'3':'-');
}

// -- 低層工具 -----------------------------------------------------------------
function out(state, n=1) {
  state.outs += n;
  if (state.outs >= 3) { switchHalfInning(state); return true; }
  return false;
}

// 按強迫進壘鏈移動，回傳此過程產生的得分
function forceAdvanceChain(b) {
  let runs = 0;
  // 滿壘且打者/一壘被擠 → 擠回 1 分
  if (b.on1 && b.on2 && b.on3) runs++;
  // 從後往前推
  if (b.on2 && b.on1) { b.on3 = true; b.on2 = false; }
  if (b.on1) { b.on2 = true; b.on1 = false; }
  // 由呼叫者決定打者是否佔 1 壘
  return runs;
}

// 進壘：把 fromBase 移到 toBase（1/2/3/H），回傳是否得分
function advanceOne(b, fromBase, toBase) {
  // 清 from
  if (fromBase === 1) b.on1 = false;
  else if (fromBase === 2) b.on2 = false;
  else if (fromBase === 3) b.on3 = false;
  // 設 to
  if (toBase === 'H') return 1; // 得分
  if (toBase === 1) b.on1 = true;
  if (toBase === 2) b.on2 = true;
  if (toBase === 3) b.on3 = true;
  return 0;
}

// 安打進壘（簡化常規）
function applyHit(state, kind) {
  const b = state.bases;
  let runs = 0;

  if (kind === "1B") {
    if (b.on3) runs += advanceOne(b, 3, 'H');
    if (b.on2) advanceOne(b, 2, 3);
    if (b.on1) advanceOne(b, 1, 2);
    b.on1 = true; // batter to 1st
  }
  else if (kind === "2B") {
    if (b.on3) runs += advanceOne(b, 3, 'H');
    if (b.on2) runs += advanceOne(b, 2, 'H');
    if (b.on1) { advanceOne(b, 1, 3); }
    b.on2 = true; b.on1 = false;
  }
  else if (kind === "3B") {
    if (b.on3) runs += advanceOne(b, 3, 'H');
    if (b.on2) runs += advanceOne(b, 2, 'H');
    if (b.on1) runs += advanceOne(b, 1, 'H');
    b.on1=b.on2=false; b.on3=true;
  }
  else if (kind === "HR") {
    runs += (b.on1?1:0) + (b.on2?1:0) + (b.on3?1:0) + 1;
    b.on1=b.on2=b.on3=false;
  }

  if (runs) scoreRun(state, runs);
}

// -- 規則主體 -----------------------------------------------------------------
export function applyEvent(state, ev) {
  const before = { bases: basesStr(state.bases), outs: state.outs };
  const b = state.bases;
  const code = ev.code;
  const meta = ev.meta || {};                 // GO/FO/FC/DP 用得到
  const advances = ev.runner_advances || [];  // 一律當陣列處理
  const endIf3 = () => (state.outs >= 3) && (switchHalfInning(state), true);

  // 小工具：先處理 runner_advances（from/to；to=4 表本壘；支援 from=0=打者）
  function applyAdvancesPre(advList) {
    if (!advList || !Array.isArray(advList) || advList.length === 0) return new Set();
    // 先從 3,2,1,0 的順序推，避免覆蓋
    const list = advList.slice().sort((a,b)=>((b?.from ?? 0) - (a?.from ?? 0)));
    let runs = 0;
    const handledFrom = new Set();
    for (const adv of list) {
      if (!adv || typeof adv.to === 'undefined') continue;
      const from = (typeof adv.from === 'number') ? adv.from : 0;  // 0=BR
      const toBase = (adv.to === 4) ? 'H' : adv.to;
      runs += advanceOne(b, from, toBase);
      handledFrom.add(from);
    }
    if (runs) scoreRun(state, runs);
    return handledFrom; // 回傳已經由 advances 處理過的 from 壘位集合
  }

  switch (code) {

    /* ========= 投球事件：維護計數 ========= */
    case "B": { // 壞球
      if (!state.count) state.count = { balls: 0, strikes: 0 };
      state.count.balls = Math.min(4, state.count.balls + 1);
      if (state.count.balls >= 4) {
        const forced = forceAdvanceChain(b);
        scoreRun(state, forced);
        b.on1 = true;            // 打者上一壘
        resetCount(state);       // 打席結束
      }
      break;
    }

    case "S": { // 好球
      if (!state.count) state.count = { balls: 0, strikes: 0 };
      state.count.strikes = Math.min(3, state.count.strikes + 1);
      if (state.count.strikes >= 3) {
        out(state, 1);           // 三振出局
        resetCount(state);       // 打席結束
      }
      break;
    }

    case "F": { // 界外：兩好後不再增加
      if (!state.count) state.count = { balls: 0, strikes: 0 };
      if (state.count.strikes < 2) {
        state.count.strikes += 1;
      }
      break; // 不結束打席
    }

    /* ========= 打席/比賽事件 ========= */

    // 安打類（若帶 advances：先依 advances 執行，之後再對「未指定者」套用預設推進）
    case "1B":
    case "2B":
    case "3B":
    case "HR": {
      const beforeBases = JSON.parse(JSON.stringify(b)); // 事件發生前的壘包快照
      const step = (code === "1B" ? 1 : code === "2B" ? 2 : code === "3B" ? 3 : 4);

      // 1) 先處理 runner_advances（優先）
      const handledFrom = applyAdvancesPre(advances);

      // 2) 對「未在 advances 指定」的跑者，依照 before 狀態套用預設推進
      let addRuns = 0;

      // 依 3→2→1 順序避免覆蓋
      if (beforeBases.on3 && !handledFrom.has(3)) {
        const dest = 3 + step;
        addRuns += advanceOne(b, 3, dest >= 4 ? 'H' : dest);
      }
      if (beforeBases.on2 && !handledFrom.has(2)) {
        const dest = 2 + step;
        addRuns += advanceOne(b, 2, dest >= 4 ? 'H' : dest);
      }
      if (beforeBases.on1 && !handledFrom.has(1)) {
        const dest = 1 + step;
        addRuns += advanceOne(b, 1, dest >= 4 ? 'H' : dest);
      }

      // 打者（BR: from=0）若未由 advances 指定，依預設上壘/回本
      if (!handledFrom.has(0)) {
        if (step >= 4) addRuns += advanceOne(b, 0, 'H');
        else addRuns += advanceOne(b, 0, step);
      }

      if (addRuns) scoreRun(state, addRuns);

      resetCount(state); // 打席結束
      break;
    }

    // 四壞 / 故四 / 觸身
    case "BB":
    case "IBB":
    case "HBP": {
      const forced = forceAdvanceChain(b);
      scoreRun(state, forced);
      b.on1 = true;                      // 打者佔一壘
      resetCount(state);                 // 打席結束
      break;
    }

    // 三振
    case "K": {
      out(state, 1);
      resetCount(state);                 // 打席結束
      break;
    }

    // 滾地球出局（GO）
    case "GO": {
      if (meta.doublePlay && state.outs <= 1 && (b.on1 || meta.outsOn?.includes("R1"))) {
        if (b.on1) { b.on1 = false; }
        state.outs += 2;
        let runs = 0;
        if (b.on3 && b.on2) { runs += advanceOne(b, 3, 'H'); }
        if (endIf3()) { resetCount(state); break; }
        if (runs) scoreRun(state, runs);
      } else {
        state.outs += 1;
        if (endIf3()) { resetCount(state); break; }
        const forced = forceAdvanceChain(b);
        scoreRun(state, forced);
      }
      resetCount(state);                 // 打席結束
      break;
    }

    // 飛球出局（FO）
    case "FO": {
      state.outs += 1;
      if (endIf3()) { resetCount(state); break; }
      const tag = meta.tagUp || {};
      let runs = 0;
      if (tag.R3 && b.on3) runs += advanceOne(b, 3, tag.R3 >= 1 ? 'H' : 3);
      if (tag.R2 && b.on2) advanceOne(b, 2, tag.R2 >= 1 ? 3 : 2);
      if (tag.R1 && b.on1) advanceOne(b, 1, tag.R1 >= 1 ? 2 : 1);
      if (runs) scoreRun(state, runs);
      resetCount(state);                 // 打席結束
      break;
    }

    // 內野飛球必死（IF）
    case "IF": {
      state.outs += 1;
      endIf3();
      resetCount(state);                 // 打席結束
      break;
    }

    // 高飛犧牲打（SF）
    case "SF": {
      state.outs += 1;
      if (state.outs < 3 && b.on3) {
        scoreRun(state, 1);
        b.on3 = false;
      }
      endIf3();
      resetCount(state);                 // 打席結束
      break;
    }

    // 犧牲觸擊（SAC）
    case "SAC": {
      state.outs += 1;
      if (!endIf3()) {
        const forced = forceAdvanceChain(b);
        scoreRun(state, forced);
      }
      resetCount(state);                 // 打席結束
      break;
    }

    // 野手選擇（FC）
    case "FC": {
      let outLead = meta.outLead; // "R3"/"R2"/"R1"
      if (!outLead) outLead = b.on3 ? "R3" : (b.on2 ? "R2" : (b.on1 ? "R1" : null));

      if (outLead === "R3" && b.on3) b.on3 = false;
      else if (outLead === "R2" && b.on2) b.on2 = false;
      else if (outLead === "R1" && b.on1) b.on1 = false;

      if (!b.on1) b.on1 = true; // 打者上一壘（簡化）
      state.outs += 1;
      endIf3();
      resetCount(state);                 // 打席結束
      break;
    }

    // 雙殺 / 三殺
    case "DP": {
      if (state.outs <= 1) {
        if (meta && Array.isArray(meta.outsOn)) {
          for (const who of meta.outsOn.slice(0,2)) {
            if (who === "R1" && b.on1) b.on1 = false;
            if (who === "R2" && b.on2) b.on2 = false;
            if (who === "R3" && b.on3) b.on3 = false;
          }
          state.outs += 2;
        } else {
          if (b.on1) b.on1 = false;
          state.outs += 2;
        }
      } else {
        state.outs += 1;
      }
      endIf3();
      resetCount(state);                 // 打席結束
      break;
    }

    case "TP": {
      state.outs += 3;
      switchHalfInning(state);           // 內含 resetCount
      break;
    }

    // 盜壘 / 阻殺 / 牽制（不結束打席）
    case "SB2": { if (b.on1 && !b.on2) { b.on1=false; b.on2=true; } break; }
    case "SB3": { if (b.on2 && !b.on3) { b.on2=false; b.on3=true; } break; }
    case "SBH": { if (b.on3) { b.on3=false; scoreRun(state,1); } break; }
    case "CS2": { if (b.on2) { b.on2=false; out(state,1); } break; }
    case "CS3": { if (b.on3) { b.on3=false; out(state,1); } break; }
    case "PO1": { if (b.on1) { b.on1=false; out(state,1); } break; }
    case "PO2": { if (b.on2) { b.on2=false; out(state,1); } break; }
    case "PO3": { if (b.on3) { b.on3=false; out(state,1); } break; }

    // 暴投/捕逸/投手犯規（不結束打席）
    case "WP":
    case "PB":
    case "BK": {
      let runs = 0;
      if (b.on3) runs += advanceOne(b, 3, 'H');
      if (b.on2 && !b.on3) advanceOne(b, 2, 3);
      if (b.on1 && !b.on2) advanceOne(b, 1, 2);
      if (runs) scoreRun(state, runs);
      break;
    }

    default: break;
  }

  return {
    before,
    after: { bases: basesStr(state.bases), outs: state.outs },
    state
  };
}

// ----------------------------------- Tests ----------------------------------
export function runSelfTests() {
  const T = (name, fn) => {
    const s = initialState();
    const res = fn(s);
    const ok = res.pass;
    console.log((ok?"✅":"❌"), name, ok? "":"=> "+res.msg);
  };

  // utilities
  const clone = (s)=>JSON.parse(JSON.stringify(s));

  T("1) 1B from empty -> 1--", (s)=>{
    applyEvent(s,{code:"1B"});
    return {pass: s.bases.on1 && !s.bases.on2 && !s.bases.on3, msg: JSON.stringify(s)};
  });

  T("2) 1B with R3 -> score + keep 1-- (R2 from R1, R3 scores)", (s)=>{
    s.bases.on3=true;
    applyEvent(s,{code:"1B"});
    return {pass: s.linescore.away[0]===1 && s.bases.on1 && !s.bases.on3, msg: JSON.stringify(s)};
  });

  T("3) 2B with R1 -> R1 to 3B, batter to 2B", (s)=>{
    s.bases.on1=true;
    applyEvent(s,{code:"2B"});
    return {pass: s.bases.on2 && s.bases.on3 && !s.bases.on1, msg: JSON.stringify(s)};
  });

  T("4) HR with 123 -> +4, bases empty", (s)=>{
    s.bases={on1:true,on2:true,on3:true};
    applyEvent(s,{code:"HR"});
    return {pass: s.linescore.away[0]===4 && !s.bases.on1 && !s.bases.on2 && !s.bases.on3, msg: JSON.stringify(s)};
  });

  T("5) BB with 123 -> +1 score, still 123 (batter to 1st)", (s)=>{
    s.bases={on1:true,on2:true,on3:true};
    applyEvent(s,{code:"BB"});
    return {pass: s.linescore.away[0]===1 && s.bases.on1 && s.bases.on2 && s.bases.on3, msg: JSON.stringify(s)};
  });

  T("6) GO default (batter out), force only", (s)=>{
    s.bases={on1:true,on2:false,on3:false};
    applyEvent(s,{code:"GO"}); // batter out, R1 forced to 2B
    return {pass: s.outs===1 && !s.bases.on1 && s.bases.on2, msg: JSON.stringify(s)};
  });

  T("7) GO doublePlay with R1 -> DP (R1 out + BR out), 2 outs", (s)=>{
    s.bases={on1:true,on2:false,on3:false};
    applyEvent(s,{code:"GO",meta:{doublePlay:true}});
    return {pass: s.outs===2 && !s.bases.on1 && !s.bases.on2, msg: JSON.stringify(s)};
  });

  T("8) FO default, runners hold", (s)=>{
    s.bases={on1:true,on2:true,on3:true};
    applyEvent(s,{code:"FO"});
    return {pass: s.outs===1 && s.bases.on1 && s.bases.on2 && s.bases.on3, msg: JSON.stringify(s)};
  });

  T("9) FO with tagUp R3 -> +1 score", (s)=>{
    s.bases={on3:true};
    applyEvent(s,{code:"FO",meta:{tagUp:{R3:1}}});
    return {pass: s.outs===1 && !s.bases.on3 && s.linescore.away[0]===1, msg: JSON.stringify(s)};
  });

  T("10) SF -> out + R3 scores", (s)=>{
    s.bases={on3:true};
    applyEvent(s,{code:"SF"});
    return {pass: s.outs===1 && !s.bases.on3 && s.linescore.away[0]===1, msg: JSON.stringify(s)};
  });

  T("11) SAC -> out + force adv", (s)=>{
    s.bases={on1:true,on2:true,on3:false};
    applyEvent(s,{code:"SAC"});
    return {pass: s.outs===1 && s.bases.on1===false && s.bases.on2===true && s.bases.on3===true, msg: JSON.stringify(s)};
  });

  T("12) FC lead R2 out, BR safe @1", (s)=>{
    s.bases={on1:false,on2:true,on3:false};
    applyEvent(s,{code:"FC",meta:{outLead:"R2"}});
    return {pass: s.outs===1 && s.bases.on1===true && s.bases.on2===false, msg: JSON.stringify(s)};
  });

  T("13) DP default: R1 + BR out", (s)=>{
    s.bases={on1:true,on2:true,on3:false};
    applyEvent(s,{code:"DP"});
    return {pass: s.outs===2 && !s.bases.on1 && s.bases.on2, msg: JSON.stringify(s)};
  });

  T("14) WP with R3 -> +1", (s)=>{
    s.bases={on3:true};
    applyEvent(s,{code:"WP"});
    return {pass: s.linescore.away[0]===1 && !s.bases.on3, msg: JSON.stringify(s)};
  });

  T("15) SB2 from R1", (s)=>{
    s.bases={on1:true};
    applyEvent(s,{code:"SB2"});
    return {pass: !s.bases.on1 && s.bases.on2, msg: JSON.stringify(s)};
  });

  T("16) CS3 from R3", (s)=>{
    s.bases={on3:true};
    applyEvent(s,{code:"CS3"});
    return {pass: s.outs===1 && !s.bases.on3, msg: JSON.stringify(s)};
  });

  T("17) Three outs switch half", (s)=>{
    applyEvent(s,{code:"K"});
    applyEvent(s,{code:"K"});
    applyEvent(s,{code:"K"});
    return {pass: s.half==="BOTTOM" && s.outs===0 && !s.bases.on1, msg: JSON.stringify(s)};
  });

  // 新增：球數行為驗證
  T("18) Balls → BB auto walk & reset count", (s)=>{
    applyEvent(s,{code:"B"});
    applyEvent(s,{code:"B"});
    applyEvent(s,{code:"B"});
    applyEvent(s,{code:"B"}); // 觸發保送
    return {pass: s.bases.on1===true && s.count.balls===0 && s.count.strikes===0, msg: JSON.stringify(s)};
  });

  T("19) Strikes → K & reset count", (s)=>{
    applyEvent(s,{code:"S"});
    applyEvent(s,{code:"S"});
    applyEvent(s,{code:"S"}); // 三振
    return {pass: s.outs===1 && s.count.balls===0 && s.count.strikes===0, msg: JSON.stringify(s)};
  });
}
