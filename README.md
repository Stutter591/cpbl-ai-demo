# cpbl-ai-demo
棒球賽事語音紀錄demo

# 📂 專案檔案結構
```plaintext
cpbl-ai-demo / (repo root)
├── index.html                         ← 預設首頁
├── app.js                             ← 前端邏輯：fetch events.json → rules.js → render    
├── rules.js                           ← 棒球規則引擎 (已是完整版)
├── styles.css                         ← UI 美化
├── events.json                        ← 測試用比賽事件資料 (可以替換 ASR/PROMPT 輸出)    
├── utils/                             ← 工具模組目錄
│   ├── cpbl_gamename.py               ← CPBL 賽程名稱工具(單場)
│   ├── cpbl_gamename_month.py         ← CPBL 賽程名稱工具(整月份) --暫無使用
│   └── cpbl_gamename_month_range.py   ← CPBL 賽程名稱工具(整月份依照GameSno掃)
└── baseballtext/                      ← 測試機料集
```
