import argparse
import json
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

from cpbl_gamename import HEADERS, fetch_game_meta, build_url
from time import sleep


def build_schedule_url(year: int, month: int, kind: str) -> str:
    return f"https://www.cpbl.com.tw/schedule/index?year={year}&month={month:02d}&kindCode={kind}"


def collect_game_keys(schedule_html: str, base_url: str, fallback_year: int, fallback_kind: str):
    soup = BeautifulSoup(schedule_html, "lxml")
    keys = set()

    for a in soup.select('a[href*="/box/"]'):
        href = a.get('href')
        if not href:
            continue
        full = urljoin(base_url, href)
        parsed = urlparse(full)
        qs = parse_qs(parsed.query)
        qs_lower = {k.lower(): v for k, v in qs.items()}

        sno = qs_lower.get('gamesno', [None])[0]
        if not sno:
            continue
        try:
            sno_int = int(sno)
        except (TypeError, ValueError):
            continue

        year = qs_lower.get('year', [str(fallback_year)])[0]
        kind = qs_lower.get('kindcode', [fallback_kind])[0]
        keys.add((int(year), kind.upper(), sno_int))

    return sorted(keys)


def fetch_month(year: int, month: int, kind: str):
    schedule_url = build_schedule_url(year, month, kind)
    print(f"Fetching schedule: {schedule_url}")
    resp = requests.get(schedule_url, headers=HEADERS, timeout=20)
    print(f"schedule status: {resp.status_code}")
    resp.raise_for_status()

    keys = collect_game_keys(resp.text, schedule_url, year, kind)
    print(f"found {len(keys)} game links")

    games = []
    for y, k, sno in keys:
        url = build_url(y, k, sno)
        print(f"  -> fetch game {y}-{k}-{sno}: {url}")
        sleep(1.2)
        meta = fetch_game_meta(url)
        games.append({
            "year": y,
            "date": meta["date"],
            "KindCode": k,
            "GameSno": sno,
            "teams": meta["teams"]
        })

    return games


def main():
    ap = argparse.ArgumentParser(description="抓取指定月份 CPBL 文字轉播比賽資訊")
    ap.add_argument('--year', type=int, required=True, help='例如 2025')
    ap.add_argument('--month', type=int, required=True, help='1-12')
    ap.add_argument('--kind', default='A', help='預設一軍例行賽 A')
    ap.add_argument('--output', type=Path, help='輸出 JSON 檔路徑；未指定則印出結果')
    args = ap.parse_args()

    games = fetch_month(args.year, args.month, args.kind)

    if args.output:
        args.output.write_text(json.dumps(games, ensure_ascii=False, indent=2), encoding='utf-8')
    else:
        print(json.dumps(games, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
