# ⚾ 智慧本壘板 (cpbl-ai-demo)

一個將中華職棒（CPBL）文字轉播資料轉成互動記分板的前端示範。透過 `events.json` 描述每個打席事件，搭配 `rules.js` 的規則引擎模擬壘包、分數、球數，並以 `app.js` 把狀態即時渲染到頁面。

## ✨ 功能亮點
- **互動記分板**：支援播放、暫停、指定事件跳轉，並顯示攻擊方、壘包、球數、出局數。
- **事件即時更新**：將最新事件提示放在醒目的「目前事件」卡片，下方提供歷史列表與文字比分。
- **隊名載入**：前端會從 `utils/games-2025-09.json` 推斷客隊/主隊名稱（URL 可帶 `?gameSno=` 或 `?date=` 指定場次）。
- **自動化抓取工具**：透過 utils 目錄下的 Python 腳本從官方文字轉播或賽程頁抓 meta 資料。

## 📁 專案結構
```plaintext
cpbl-ai-demo
├── index.html              # 單頁應用入口
├── app.js                  # 前端主程式：載入 events、更新 UI、控制播放
├── rules.js                # 棒球規則引擎（壘包、出局、分數等運算）
├── styles.css              # 深色主題樣式、控制列、目前事件等視覺
├── events.json             # 單場事件資料，可由 ASR 或其他來源替換
├── utils/                  # CPBL 相關工具腳本與輸出
│   ├── cpbl_gamename.py            # 擷取單場（gameSno）隊名、日期
│   ├── cpbl_gamename_month.py      # 從賽程頁讀取有公開連結的整月 meta（現階段保留備用）
│   ├── cpbl_gamename_month_range.py# 盲掃 gameSno 範圍，找出指定月份的所有場次
│   └── games-2025-09.json          # 範例 meta 輸出，供前端載入隊名
└── baseballtext/            # 測試文字資料或語料
```

## 🛠 環境需求
- 現代瀏覽器（Chrome / Edge / Safari 等）以及靜態檔案伺服器，例如 `npx serve` 或 Python `http.server`.
- Python 3.9 以上（建議 3.11+，避免系統內建 LibreSSL 導致 urllib3 警告），並安裝 `requests`, `beautifulsoup4`, `lxml`.
- 選用：Node.js 18+（若想用 npm 套件啟動本地伺服器）。

## 🚀 快速開始
1. 將 `events.json` 換成目標比賽的事件列表（格式：`[{ event, code, runner_advances }]`）。
2. 若要顯示正確主客隊：
   - 使用 `utils/cpbl_gamename_month_range.py` 產生整月 meta：
     ```bash
     cd utils
     python3 cpbl_gamename_month_range.py \
       --year 2025 --month 9 --kind A \
       --start-sno 301 --end-sno 360 \
       --delay 5 \
       --output games-2025-09.json
     ```
   - 或以 `--url` 單場抓取，再手動加入 `games-YYYY-MM.json`。
3. 在瀏覽器開啟 `index.html`（建議啟動靜態伺服器避免 CORS）：
   ```bash
   npx serve .
   # 或 python3 -m http.server 8000
   ```
4. 進入頁面後即可播放事件流程，URL 若加上 `?gameSno=302` 或 `?date=2025-09-02`，會自動對應到 `games-2025-09.json` 的隊名。

## 🧰 工具腳本說明
| 腳本 | 功能 | 典型用法 |
| --- | --- | --- |
| `cpbl_gamename.py` | 根據官方文字轉播頁抓取單場日期與隊名 | `python3 cpbl_gamename.py --url "https://www.cpbl.com.tw/box/live?..."` |
| `cpbl_gamename_month_range.py` | 依指定範圍掃描 `gameSno`，找出落在指定月份的所有場次 | `python3 cpbl_gamename_month_range.py --year 2025 --month 9 --start-sno 301 --end-sno 360 --output games-2025-09.json` |
| `cpbl_gamename_month.py` | 從賽程頁擷取整月連結（當官方已放出 `box/live` 連結時適用） | `python3 cpbl_gamename_month.py --year 2024 --month 9 --kind A --output games.json` |

> **注意**：Python 工具依賴 `requests`, `beautifulsoup4`, `lxml`：
> `python3 -m pip install requests beautifulsoup4 lxml`

## 🔧 前端調整要點
- `app.js` 會在 `main()` 開始前呼叫 `loadTeamLabels()`，從 `utils/games-*.json` 取得 `teams` 陣列（格式：`[客隊, 主隊]`），用於記分板列標題與攻擊方顯示。
- 若無法取得 meta，預設顯示「客隊」/「主隊」，功能仍可運作。
- 「目前事件」與「事件回顧」顯示內容已精簡為事件描述與比分；樣式段落集中在 `styles.css`。

## 🧪 測試 / 佈署
- 將 `events.json` 換成目標比賽後，建議手動對照官方文字轉播，確認 `runner_advances` 是否正確影響壘包/分數。
- 若要整合語音辨識或自動生成 `events.json`，需確保輸出符合現有格式，否則 `rules.js` 無法正確解析。
