import argparse
import json
import time
from pathlib import Path

import requests

from cpbl_gamename import fetch_game_meta, build_url


def collect_month(year: int, month: int, kind: str,
                  start_sno: int, end_sno: int, delay: float):
    target_prefix = f"{year}-{month:02d}"
    games = []

    for sno in range(start_sno, end_sno + 1):
        url = build_url(year, kind, sno)
        try:
            meta = fetch_game_meta(url)
        except requests.HTTPError:
            continue
        except requests.RequestException as exc:
            print(f"[warn] sno={sno} request failed: {exc}")
            continue
        except ValueError as exc:
            print(f"[skip] sno={sno}: {exc}")
            continue

        date_str = meta["date"]
        if not date_str.startswith(str(year)):
            continue

        if date_str.startswith(target_prefix):
            games.append({
                "date": date_str,
                "KindCode": kind,
                "GameSno": sno,
                "teams": meta["teams"]
            })
            print(f"✔ {date_str} #{sno}: {meta['teams'][0]} vs {meta['teams'][1]}")
        else:
            print(f"[skip] sno={sno}: date {date_str} not in {target_prefix}")

        time.sleep(delay)

    return games


def main():
    ap = argparse.ArgumentParser(description="盲掃指定月份的 CPBL 文字轉播場次")
    ap.add_argument('--year', type=int, required=True)
    ap.add_argument('--month', type=int, required=True)
    ap.add_argument('--kind', default='A')
    ap.add_argument('--start-sno', type=int, default=1)
    ap.add_argument('--end-sno', type=int, default=500)
    ap.add_argument('--delay', type=float, default=1.2)
    ap.add_argument('--output', type=Path)
    args = ap.parse_args()

    games = collect_month(args.year, args.month, args.kind,
                          args.start_sno, args.end_sno, args.delay)
    games.sort(key=lambda g: (g["date"], g["GameSno"]))

    if args.output:
        args.output.write_text(json.dumps(games, ensure_ascii=False, indent=2),
                               encoding='utf-8')
    else:
        print(json.dumps(games, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
