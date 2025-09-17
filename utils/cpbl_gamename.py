import re, json, argparse, requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "Mozilla/5.0 (cpbl-one-minimal)"}

# 支援「YYYY/MM/DD A隊 VS B隊」或「YYYY/MM/DD A隊 - B隊」等常見格式
PATTERNS = [
    re.compile(r"(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}).{0,50}?([\u4e00-\u9fa5A-Za-z0-9\-7ELEVEn．.\s]+?)\s*V[\.S．]*\s*([\u4e00-\u9fa5A-Za-z0-9\-7ELEVEn．.\s]+)"),
    re.compile(r"(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}).{0,50}?([\u4e00-\u9fa5A-Za-z0-9\-7ELEVEn．.\s]+?)\s*-\s*([\u4e00-\u9fa5A-Za-z0-9\-7ELEVEn．.\s]+)")
]

def norm_date(s: str) -> str | None:
    parts = re.split(r"[\/\-]", s.strip())
    if len(parts) != 3: return None
    y, m, d = (int(x) for x in parts)
    return f"{y:04d}-{m:02d}-{d:02d}"

def clean_team(s: str) -> str:
    # 去掉全形空白、重複空白與點號變體
    return re.sub(r"[．.]", "", re.sub(r"\s+"," ", s.replace("\u3000"," "))).strip()

def parse_text(text: str):
    for rx in PATTERNS:
        m = rx.search(text)
        if m:
            date_raw, left, right = m.groups()
            return norm_date(date_raw), clean_team(left), clean_team(right)
    return None, None, None

def build_url(year: int, kind: str, sno: int) -> str:
    return f"https://www.cpbl.com.tw/box/live?year={year}&KindCode={kind}&gameSno={sno}"

def main():
    ap = argparse.ArgumentParser(description="CPBL 單場：只抓日期與兩隊名稱（不判斷主客）")
    ap.add_argument("--url", help="完整網址（與 year/kind/sno 擇一）")
    ap.add_argument("--year", type=int, help="例如 2025")
    ap.add_argument("--kind", help="例如 A")
    ap.add_argument("--sno", type=int, help="例如 351")
    args = ap.parse_args()

    if args.url:
        url = args.url
    elif args.year and args.kind and args.sno:
        url = build_url(args.year, args.kind, args.sno)
    else:
        ap.error("請提供 --url 或同時提供 --year --kind --sno")

    # 下載頁面（後端請求，無 CORS 問題）
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "lxml")

    # 先試 <title>，失敗再用整頁文字做備援
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    date_iso, team_left, team_right = parse_text(title)
    if not date_iso:
        date_iso, team_left, team_right = parse_text(soup.get_text(" ", strip=True))

    if not date_iso or not team_left or not team_right:
        raise SystemExit("解析失敗：可能該場不存在或頁面版型變動。")

    # 「left/right」僅代表標題左右順序，不代表主客
    out = {
        "date": date_iso,
        "teams": [team_left, team_right]
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
