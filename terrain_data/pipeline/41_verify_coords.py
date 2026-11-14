"""Compare curated coordinates with Wikipedia's coordinates for the same page.

Reads every curated/*.csv that has columns id, lat, lon, wikipedia_title (and body or a
filename that says which world). Asks the Wikipedia API for each page's primary coordinates and
writes work/coord_check.csv with the difference in km. Nothing is edited automatically; a person
or the next step decides which value to keep. Flags differences above 25 km (Earth sites are
often areas, not points, so small differences are normal).

    python -I pipeline/41_verify_coords.py [curated/targets_moon.csv ...]
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import UA, ROOT, _log  # noqa: E402
from grid import haversine_km  # noqa: E402

API = "https://en.wikipedia.org/w/api.php"
GLOBE = {"earth": "earth", "moon": "moon", "mars": "mars"}


def wiki_coords(titles: list[str]) -> dict[str, tuple[str, float, float]]:
    """{requested title: (globe, lat, lon)} for the titles that have primary coordinates."""
    out = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        q = urllib.parse.urlencode({"action": "query", "prop": "coordinates", "colimit": "max",
                                    "coprimary": "primary", "redirects": 1, "format": "json",
                                    "titles": "|".join(chunk)})
        r = subprocess.run(["curl", "-sL", "--retry", "5", "--retry-all-errors", "--max-time", "40",
                            "-A", UA, f"{API}?{q}"], capture_output=True, text=True, timeout=120)
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError:
            continue
        q = data.get("query", {})
        alias = {}                                   # final title -> requested title
        for t in chunk:
            alias[t] = t
        for key in ("normalized", "redirects"):
            for m in q.get(key, []):
                for req, cur in list(alias.items()):
                    if cur == m["from"]:
                        alias[req] = m["to"]
        by_title = {p.get("title"): p for p in q.get("pages", {}).values()}
        for req, final in alias.items():
            page = by_title.get(final)
            if page and page.get("coordinates"):
                c = page["coordinates"][0]
                out[req] = (c.get("globe", "earth"), c["lat"], c["lon"])
    return out


def main() -> None:
    files = [Path(a) for a in sys.argv[1:]] or sorted((ROOT / "curated").glob("*.csv"))
    rows_out = []
    for f in files:
        with open(f, newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.DictReader(fh))
        if not rows or "wikipedia_title" not in rows[0]:
            continue
        titles = sorted({r["wikipedia_title"] for r in rows if r.get("wikipedia_title")})
        got = wiki_coords(titles)
        for r in rows:
            t = r.get("wikipedia_title", "")
            body = r.get("body") or ("moon" if "moon" in f.name else "mars" if "mars" in f.name else "earth")
            if not t or t not in got:
                rows_out.append([f.name, r["id"], body, r["lat"], r["lon"], t, "", "", "", "no_wikipedia_coords"])
                continue
            globe, wlat, wlon = got[t]
            if globe != GLOBE.get(body, body):
                rows_out.append([f.name, r["id"], body, r["lat"], r["lon"], t, wlat, wlon, "", f"wrong_globe:{globe}"])
                continue
            d = float(haversine_km(float(r["lat"]), float(r["lon"]), wlat, wlon, body))
            scale = {"earth": 1.0, "moon": 1737.4 / 6371, "mars": 3389.5 / 6371}[body]
            flag = "ok" if d <= 25 * scale else "CHECK"
            rows_out.append([f.name, r["id"], body, r["lat"], r["lon"], t, f"{wlat:.3f}", f"{wlon:.3f}", f"{d:.1f}", flag])
    out = ROOT / "work" / "coord_check.csv"
    out.parent.mkdir(exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "id", "body", "lat", "lon", "wikipedia_title", "wiki_lat", "wiki_lon", "diff_km", "status"])
        w.writerows(rows_out)
    n = {}
    for r in rows_out:
        n[r[-1].split(":")[0]] = n.get(r[-1].split(":")[0], 0) + 1
    print("coordinate check:", n)
    for r in rows_out:
        if r[-1] not in ("ok", "no_wikipedia_coords"):
            print(f"  {r[1]:<28} mine ({r[3]}, {r[4]})  wiki ({r[6]}, {r[7]})  {r[8]} km  {r[9]}")
    _log(f"coordinate check against Wikipedia: {n}")


if __name__ == "__main__":
    main()
