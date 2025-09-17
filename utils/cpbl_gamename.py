import re, json, argparse, requests
from typing import Optional, Tuple
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
}

# 備援：從整頁文字中解析「YYYY/MM/DD A隊 VS B隊」或「YYYY/MM/DD A隊 - B隊」
PATTERNS = [
    re.compile(r"(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}).{0,80}?([\u4e00-\u9fa5A-Za-z0-9\-\u30007ELEVEn＆&．.\s]+?)\s*V[\.S．]*\s*([\u4e00-\u9fa5A-Za-z0-9\-\u30007ELEVEn＆&．.\s]+)"),
    re.compile(r"(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}).{0,80}?([\u4e00-\u9fa5A-Za-z0-9\-\u30007ELEVEn＆&．.\s]+?)\s*-\s*([\u4e00-\u9fa5A-Za-z0-9\-\u30007ELEVEn＆&．.\s]+)")
]

def norm_date(s: str) -> Optional[str]:
    parts = re.split(r"[\/\-]", s.strip())
    if len(parts) != 3: return None
    y, m, d = (int(x) for x in parts)
    return f"{y:04d}-{m:02d}-{d:02d}"

def clean_team(s: str) -> str:
    # 去掉全形空白、重複空白與點號變體
    return re.sub(r"[．.]", "", re.sub(r"\s+"," ", s.replace("\u3000"," "))).strip()

VS_SPLIT = re.compile(r"\s+V[\.]?S[\.．]?\s+", re.IGNORECASE)

def parse_breadcrumb(soup: BeautifulSoup) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    for a in soup.select('#Breadcrumbs li a'):
        text = a.get_text(" ", strip=True)
        if not text:
            continue
        if 'VS' not in text.upper() and 'ＶＳ' not in text:
            continue

        m = re.match(r"(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(.*)", text)
        if not m:
            continue
        date_raw, rest = m.groups()
        parts = VS_SPLIT.split(rest, maxsplit=1)
        if len(parts) != 2:
            continue
        left, right = parts
        return norm_date(date_raw), clean_team(left), clean_team(right)

    return None, None, None

def parse_text(text: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    for rx in PATTERNS:
        m = rx.search(text)
        if m:
            date_raw, left, right = m.groups()
            return norm_date(date_raw), clean_team(left), clean_team(right)
    return None, None, None

def build_url(year: int, kind: str, sno: int) -> str:
    return f"https://www.cpbl.com.tw/box/live?year={year}&KindCode={kind}&gameSno={sno}"

def fetch_game_meta(url: str) -> dict:
    # 下載頁面（後端請求，無 CORS 問題）
    r = requests.get(url, headers=HEADERS, timeout=20)
    r.raise_for_status()

    soup = BeautifulSoup(r.text, "lxml")

    # 先直接從麵包屑的賽事標題抓取
    date_iso, team_left, team_right = parse_breadcrumb(soup)
    if not date_iso:
        # 退而求其次使用 <title>（或整頁文字）
        title = soup.title.get_text(" ", strip=True) if soup.title else ""
        date_iso, team_left, team_right = parse_text(title)
    if not date_iso:
        date_iso, team_left, team_right = parse_text(soup.get_text(" ", strip=True))

    if not date_iso or not team_left or not team_right:
        raise ValueError("解析失敗：可能該場不存在或頁面版型變動。")

    # 「left/right」僅代表標題左右順序，不代表主客
    return {
        "date": date_iso,
        "teams": [team_left, team_right]
    }


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

    try:
        out = fetch_game_meta(url)
    except ValueError as exc:
        raise SystemExit(str(exc))
    print(json.dumps(out, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
