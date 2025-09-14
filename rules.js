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
 *    - outsOn: ["BR","R1","R2","R3"]       // 指定誰出局（歷史相容；新案建議改在事件分支內處理）
 * - for FO:
 *    - tagUp: {"R3":1,"R2":0,"R1":0}       // 誰在補位後推進，R3:1 代表三壘回本壘得分
 *    - sacrifice: true                     // 視為 SF（高飛犧牲打）
 * - for FC:
 *    - outLead: "R3"|"R2"|"R1"             // 指定前導跑者被抓
 *
 * ✅ 新版 runner_advances 規格（僅限安打分支預處理）：
 *   from ∈ {"first","second","third"}
 *   to   ∈ {"second","third","home","out"}
 *   （不再支援 0/1/2/3/4/H/batter/BR/out:true 等舊寫法）
 *
 * @typedef {{from:"first"|"second"|"third", to:"second"|"third"|"home"|"out"}} RunnerAdvance
 * @typedef {{ts?:string, event?:string, code:EventCode, runner_advances?: RunnerAdvance[], meta?:any}} PlayEvent

 */

/** @typedef {{
 * inning:number, half:Half, outs:number, bases:Bases,
 * linescore:Linescore, batting:Side, count:{balls:number,strikes:number}
 * }} GameState */

// ------------------ 初始化狀態 ------------------
export function initialState() {
  return {
    inning: 1,
    half: "TOP",   // 上半局
    outs: 0,
    bases: { on1:false, on2:false, on3:false },
    linescore: { away:[], home:[] },
    batting: "away",
    count: { balls:0, strikes:0 }
  };
}

/* ====================== 低層工具（新版壘位 API） ====================== */

/** 內部布林壘 → 字串壘位工具 */
function hasBase(bases, k /* "first"|"second"|"third" */){
  if (k === "first")  return bases.on1;
  if (k === "second") return bases.on2;
  if (k === "third")  return bases.on3;
  return false;
}
function setBase(bases, k){
  if (k === "first")  bases.on1 = true;
  if (k === "second") bases.on2 = true;
  if (k === "third")  bases.on3 = true;
}
function clearBase(bases, k){
  if (k === "first")  bases.on1 = false;
  if (k === "second") bases.on2 = false;
  if (k === "third")  bases.on3 = false;
}

/**
 * 單一跑者進壘（使用新詞彙）
 * @param {GameState} state
 * @param {"first"|"second"|"third"} from
 * @param {"second"|"third"|"home"|"out"} to
 * @returns {number} 是否得分（0/1）— 這裡已內建記分
 */
function advanceOneNew(state, from, to){
  const b = state.bases;

  // 沒有人就不動，避免清空不存在的跑者
  if (!hasBase(b, from)) return 0;

  // 先清除起點
  clearBase(b, from);

  if (to === "out") {
    // 記一個出局；可能引發換半局
    out(state, 1);
    return 0;
  }
  if (to === "home") {
    // 直接記 1 分（此函式已負責記分）
    scoreRun(state, 1);
    return 1;
  }

  // 其他壘位落點
  setBase(b, to);
  return 0;
}

/** 單一跑者進壘（處理重疊情況，不清空起跑壘包） */
function advanceOneOverlap(state, from, to){
  const b = state.bases;

  // 沒有人就不動，避免清空不存在的跑者
  if (!hasBase(b, from)) return 0;

  if (to === "out") {
    // 記一個出局；可能引發換半局
    out(state, 1);
    return 0;
  }
  if (to === "home") {
    // 直接記 1 分（此函式已負責記分）
    scoreRun(state, 1);
    return 1;
  }

  // 其他壘位落點
  setBase(b, to);
  return 0;
}

/** 出局處理：加出局數，若滿 3 出局則切換半局 */
function out(state, n = 1) {
  state.outs += n;
  if (state.outs >= 3) {
    switchHalfInning(state);
    return true;
  }
  return false;
}

/** 記分：將 n 分加到目前打擊方、目前局數 */
function scoreRun(state, n) {
  if (n <= 0) return;
  const arr = state.linescore[state.batting];
  while (arr.length < state.inning) arr.push(0);
  arr[state.inning - 1] += n;
}

/** 歸零球數（好球/壞球） */
function resetCount(state) {
  if (!state.count) state.count = { balls: 0, strikes: 0 };
  state.count.balls = 0;
  state.count.strikes = 0;
}

// 確保當前打擊方在本局有一個格子（即使 0）
function ensureInningSlot(state){
  const arr = state.linescore[state.batting];
  while (arr.length < state.inning) arr.push(0);
}

// 換半局的所有處理
function switchHalfInning(state) {
  // 先把本半局的格子補上（若本半局沒有得分紀錄，就會補一個 0）
  ensureInningSlot(state);

  // 清空壘包 / 出局數 / 球數
  state.outs = 0;
  state.bases = { on1: false, on2: false, on3: false };
  resetCount(state);

  // 換半局
  if (state.half === "TOP") {
    state.half = "BOTTOM";
    state.batting = "home";
  } else {
    state.half = "TOP";
    state.batting = "away";
    state.inning += 1;
  }
}

/** 強迫進壘鏈（不處理打者；只擠壘上跑者） */
function forceAdvanceChain(b) {
  let runs = 0;
  if (b.on3 && b.on2 && b.on1) runs++;
  if (b.on2 && b.on1) b.on3 = true;
  if (b.on1) b.on2 = true;

  b.on1 = false; // 清空一壘，因為這裡指處理壘上跑者的情況

  return runs;
}

/** UI 觀察用：輸出 "1-2-3" 風格字串（僅顯示用；與新規格相容） */
function basesStr(b) {
  return (b.on1?'1':'-') + (b.on2?'2':'-') + (b.on3?'3':'-');
}

// -- 規則主體 -----------------------------------------------------------------
export function applyEvent(state, ev) {
  const before = { bases: basesStr(state.bases), outs: state.outs };
  const b = state.bases;
  const code = ev.code;
  const meta = ev.meta || {};                 // GO/FO/FC/DP 用得到
  const advances = Array.isArray(ev.runner_advances) ? ev.runner_advances : [];  // 一律當陣列處理（預設空陣列）
  const endIf3 = () => (state.outs >= 3) && (switchHalfInning(state), true);

  // 小工具：先處理 runner_advances（新詞彙 only）
  // from:  "first"|"second"|"third"
  // to:    "second"|"third"|"home"|"out"
  // 規則：third → second → first 的順序處理，避免覆蓋；任何一次導致第 3 個出局會立即停止。
  function applyAdvancesPre(advList) {
    if (!Array.isArray(advList) || advList.length === 0) return new Set();
  
    const order = { third: 3, second: 2, first: 1 };
    const validFrom = new Set(["first","second","third"]);
    const validTo   = new Set(["second","third","home","out"]);
  
    // 依照壘位由高到低處理
    const list = advList
      .filter(a => a && validFrom.has(a.from) && validTo.has(a.to))
      .sort((a,b) => (order[b.from] || 0) - (order[a.from] || 0));
  
    const handled = new Set(); // Set<"first"|"second"|"third">
  
    for (const a of list) {
      // 已處理過該 from 就略過（避免重複宣告）
      if (handled.has(a.from)) continue;
  
      // 進壘（advanceOneNew 會自動處理得分/出局）
      advanceOneNew(state, a.from, a.to);
      handled.add(a.from);
  
      // 若已形成三出局，立即停止（避免多餘推進）
      if (state.outs >= 3) break;
    }
  
    return handled;
  }
  // 通用 runner_advances（新詞彙 only）。回傳是否有處理到至少一筆。
  function applyRunnerAdvancesLoose(state, advList){
    if (!Array.isArray(advList) || advList.length === 0) return false;
  
    const order = { third:3, second:2, first:1 };
    const validFrom = new Set(["first","second","third"]);
    const validTo   = new Set(["second","third","home","out"]);
  
    const list = advList
      .filter(a => a && validFrom.has(a.from) && validTo.has(a.to))
      .sort((a,b) => (order[b.from]||0) - (order[a.from]||0));
  
    let touched = false;
    for (const a of list){
      // advanceOneNew 內部會自理得分/出局/第三個出局觸發換半局
      advanceOneNew(state, a.from, a.to);
      touched = true;
      if (state.outs >= 3) break; // 第三個出局就不用再推
    }
    return touched;
  }

  switch (code) {

    /* ========= 投球事件：維護計數 ========= */
    case "B": { // 壞球
      if (!state.count) state.count = { balls: 0, strikes: 0 };
      state.count.balls = Math.min(4, state.count.balls + 1);
      // ★ 新增：這球發生的盜壘／牽制成功等跑壘異動
      applyRunnerAdvancesLoose(state, advances);
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

    // 安打：先決定打者落點（但不立刻佔壘），再處理壘上跑者，最後才把打者放上去
    case "1B":
    case "2B":
    case "3B":
    case "HR": {
      if (code === "HR") {
        // 全壘打：所有人得分
        let runs = 1; // 打者本身
        if (b.on1) { runs++; b.on1 = false; }
        if (b.on2) { runs++; b.on2 = false; }
        if (b.on3) { runs++; b.on3 = false; }
        scoreRun(state, runs);
        resetCount(state);
        break;
      }
      
      // 判斷上壘是否重疊（例如二壘有人時的二壘安打）
      let overlap = (code === "3B" && b.on3) || (code === "2B" && b.on2) || (code === "1B" && b.on1);
      if (code === "3B") { b.on3 = true; }
      if (code === "2B") { b.on2 = true; }
      if (code === "1B") { b.on1 = true; }

      // 處理 runner_advances
      // applyRunnerAdvancesLoose(state, advances);
      if (Array.isArray(advances)) {
  
        const order = { third:3, second:2, first:1 };
        const validFrom = new Set(["first","second","third"]);
        const validTo   = new Set(["second","third","home","out"]);
      
        const list = advances
          .filter(a => a && validFrom.has(a.from) && validTo.has(a.to))
          .sort((a,b) => (order[b.from]||0) - (order[a.from]||0));
      
        for (const a of list){
          if (overlap && code === "3B" && a.from === "third") {
            advanceOneOverlap(state, a.from, a.to);
            overlap = false; // 只處理一次重疊
            continue;
          }
          if (overlap && code === "2B" && a.from === "second") {
            advanceOneOverlap(state, a.from, a.to);
            overlap = false; // 只處理一次重疊
            continue;
          }
          if (overlap && code === "1B" && a.from === "first") {
            advanceOneOverlap(state, a.from, a.to);
            overlap = false; // 只處理一次重疊
            continue;
          }

          advanceOneNew(state, a.from, a.to);
          if (state.outs >= 3) break; // 第三個出局就不用再推
        }
      }

      resetCount(state);
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

    // 滾地球出局（GO）：打者在一壘被刺殺；其餘跑者維持不動，除非 runner_advances 指定
    case "GO": {
      state.outs += 1;                           // 打者出局（刺殺一壘）
      if (endIf3()) { resetCount(state); break; }
    
      // 想要雙殺就用 runner_advances 明寫 {from:"first", to:"out"} 等
      applyRunnerAdvancesLoose(state, advances);
    
      resetCount(state);
      break;
    }


    // 飛球出局（FO）：打者出局；跑者原地不動，除非 runner_advances 指定（例：三壘補位回本）
    case "FO": {
      state.outs += 1;                           // 打者出局
      if (endIf3()) { resetCount(state); break; }
    
      // 只吃新詞彙 runner_advances；不再讀 meta.tagUp
      applyRunnerAdvancesLoose(state, advances);
    
      resetCount(state);                         // 打席結束
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

    // 野手選擇（FC）：預設「前導跑者出局 + 打者安全上一壘」；
    // 若 runner_advances 已明確標註 to:"out"，則完全以它為準（不再套預設）。
    case "FC": {
      const hasExplicitOut =
        Array.isArray(advances) && advances.some(a => a && a.to === "out");
    
      if (hasExplicitOut) {
        // 由 runner_advances 決定誰出局/誰推進
        applyRunnerAdvancesLoose(state, advances);
      } else {
        // 沒寫誰出局時，給一個合理預設：抓最高壘者 1 個出局
        if (b.on3) { b.on3 = false; out(state, 1); }
        else if (b.on2) { b.on2 = false; out(state, 1); }
        else if (b.on1) { b.on1 = false; out(state, 1); }
        // 仍允許非出局的推進（若你有給）
        applyRunnerAdvancesLoose(state, advances);
      }
    
      // FC：打者安全上一壘（除非當下已有人且你用 advances 另外處理）
      if (!b.on1) b.on1 = true;
    
      endIf3();
      resetCount(state);
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
      // 簡化：R3→home；R2→third（若 third 空）；R1→second（若 second 空）
      if (state.bases.on3) advanceOneNew(state, "third", "home");
      if (state.bases.on2 && !state.bases.on3) advanceOneNew(state, "second", "third");
      if (state.bases.on1 && !state.bases.on2) advanceOneNew(state, "first", "second");
      break;
    }
    
    // 其他雜項事件（不影響比賽狀態）
    case "OTHER": {
      // 預設不做任何事，不重置球數
      // 但如果 JSON 有帶 runner_advances（例如牽制、跑壘異動），就照著執行
      applyRunnerAdvancesLoose(state, advances);
      break;
    }

    // 比賽結束
    case "END": {
      // 比賽在半局中途結束，也要把本半局補 0
      ensureInningSlot(state);
      resetCount(state);
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
