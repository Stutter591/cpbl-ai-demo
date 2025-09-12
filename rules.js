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

/** 強迫進壘鏈（不處理打者；只擠壘上跑者） */
function forceAdvanceChain(b) {
  let runs = 0;
  if (b.on1 && b.on2 && b.on3) runs++;  // 滿壘擠回 1 分
  if (b.on2 && b.on1) { b.on3 = true; b.on2 = false; }
  if (b.on1) { b.on2 = true; b.on1 = false; }
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
      // 事件發生前的壘包快照（避免被後續位移影響判斷）
      const beforeBases = { on1: b.on1, on2: b.on2, on3: b.on3 };
    
      // 1) 先處理 runner_advances（只吃新詞彙 first/second/third → second/third/home/out）
      const handled = applyAdvancesPre(advances);
    
      // 2) 對「未在 runner_advances 指定」的跑者，依照【事件發生前】的壘上狀態套用預設推進
      if (code === "1B") {
        if (beforeBases.on3 && !handled.has("third"))  advanceOneNew(state, "third",  "home");
        if (beforeBases.on2 && !handled.has("second")) advanceOneNew(state, "second", "third");
        if (beforeBases.on1 && !handled.has("first"))  advanceOneNew(state, "first",  "second");
        // 打者一壘安打 → 直接佔一壘（不透過 runner_advances，也不呼叫 advanceOneNew）
        b.on1 = true;
    
      } else if (code === "2B") {
        if (beforeBases.on3 && !handled.has("third"))  advanceOneNew(state, "third",  "home");
        if (beforeBases.on2 && !handled.has("second")) advanceOneNew(state, "second", "home");
        if (beforeBases.on1 && !handled.has("first"))  advanceOneNew(state, "first",  "third");
        // 打者二壘安打 → 直接佔二壘
        b.on1 = false; b.on2 = true;
    
      } else if (code === "3B") {
        if (beforeBases.on3 && !handled.has("third"))  advanceOneNew(state, "third",  "home");
        if (beforeBases.on2 && !handled.has("second")) advanceOneNew(state, "second", "home");
        if (beforeBases.on1 && !handled.has("first"))  advanceOneNew(state, "first",  "home");
        // 打者三壘安打 → 直接佔三壘
        b.on1 = false; b.on2 = false; b.on3 = true;
    
      } else if (code === "HR") {
        // 沒被指定的壘上跑者都回本
        if (beforeBases.on1 && !handled.has("first"))  advanceOneNew(state, "first",  "home");
        if (beforeBases.on2 && !handled.has("second")) advanceOneNew(state, "second", "home");
        if (beforeBases.on3 && !handled.has("third"))  advanceOneNew(state, "third",  "home");
        // 打者本壘打：+1 分（打者不透過 runner_advances；直接加分並清空壘）
        scoreRun(state, 1);
        b.on1 = b.on2 = b.on3 = false;
      }
    
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
        if (b.on3 && b.on2) {
          advanceOneNew(state, "third", "home"); // 三壘跑回本壘得分
        }
        if (endIf3()) { resetCount(state); break; }
      } else {
        state.outs += 1;
        if (endIf3()) { resetCount(state); break; }
        const forced = forceAdvanceChain(b);
        scoreRun(state, forced);
      }
      resetCount(state); // 打席結束
      break;
    }


    // 飛球出局（FO）
    case "FO": {
      state.outs += 1;
      if (endIf3()) { resetCount(state); break; }
      const tag = meta.tagUp || {};
      if (tag.R3 && b.on3) {
        if (tag.R3 >= 1) advanceOneNew(state, "third", "home");
        else advanceOneNew(state, "third", "third");
      }
      if (tag.R2 && b.on2) {
        if (tag.R2 >= 1) advanceOneNew(state, "second", "third");
        else advanceOneNew(state, "second", "second");
      }
      if (tag.R1 && b.on1) {
        if (tag.R1 >= 1) advanceOneNew(state, "first", "second");
        else advanceOneNew(state, "first", "first");
      }
      resetCount(state); // 打席結束
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
      // 簡化：R3→home；R2→third（若 third 空）；R1→second（若 second 空）
      if (state.bases.on3) advanceOneNew(state, "third", "home");
      if (state.bases.on2 && !state.bases.on3) advanceOneNew(state, "second", "third");
      if (state.bases.on1 && !state.bases.on2) advanceOneNew(state, "first", "second");
      break;
    }
    
      // 其他雜項事件（不影響比賽狀態）
    case "OTHER": {
      resetCount(state);  // 或者什麼都不做
      break;
    }

    // 比賽結束
    case "END": {
      // 可以標記一下，但基本上就是不再推進狀態
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
