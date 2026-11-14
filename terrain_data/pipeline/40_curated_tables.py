"""Merge and enrich the hand-written tables in curated/ -> out/*.csv

Adds wikipedia_url, image_url, image_credit and a combined further_reading list to every row, and
downloads 800 px copies of the pictures for the demo sites into out/images/<id>.jpg so the venue
network cannot break the presentation.

  curated/analog_sites.csv      -> out/analog_sites.csv
  curated/caves.csv             -> out/caves.csv
  curated/impact_structures.csv -> out/impact_structures.csv
  curated/irish_sites.csv       -> out/irish_sites.csv
  curated/targets_moon.csv + targets_mars.csv -> out/targets.csv

    python -I pipeline/40_curated_tables.py
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import ROOT, fetch, _log  # noqa: E402
from wiki import page_images  # noqa: E402

CURATED, OUT = ROOT / "curated", ROOT / "out"
# Earth sites shown in the demo; their pictures are saved locally as well as linked
PRIMARY_EARTH = {"athlone", "clonmacnoise-esker-riada", "burren-poulnabrone", "haughton-crater", "atacama-yungay",
                 "rio-tinto", "lonar-crater", "cueva-de-los-verdes", "mauna-kea", "craters-of-the-moon",
                 "kilbourne-hole", "askja", "lava-beds", "mdrs-hanksville"}


def read(name: str) -> list[dict]:
    p = CURATED / name
    if not p.exists():
        return []
    with open(p, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def write(name: str, rows: list[dict], first: list[str]) -> None:
    if not rows:
        return
    cols = first + [c for r in rows for c in r if c not in first]
    cols = list(dict.fromkeys(cols))
    OUT.mkdir(exist_ok=True)
    with open(OUT / name, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        for r in rows:
            w.writerow({c: r.get(c, "") for c in cols})


def enrich(rows: list[dict]) -> int:
    info = page_images([r.get("wikipedia_title", "") for r in rows])
    got = 0
    for r in rows:
        m = info.get(r.get("wikipedia_title", ""), {})
        r["wikipedia_url"] = m.get("url", "")
        r["image_url"] = m.get("thumb_url", "")
        r["image_credit"] = m.get("credit", "") if m.get("thumb_url") else ""
        links = [l for l in (r.get("further_reading", "").split(";") + [r["wikipedia_url"]]) if l]
        r["further_reading"] = ";".join(dict.fromkeys(links))
        got += bool(r["image_url"])
    return got


def main() -> None:
    tables = {
        "analog_sites.csv": read("analog_sites.csv"), "caves.csv": read("caves.csv"),
        "impact_structures.csv": read("impact_structures.csv"), "irish_sites.csv": read("irish_sites.csv"),
        "targets.csv": read("targets_moon.csv") + read("targets_mars.csv"),
    }
    first = ["id", "name", "body", "country_or_region", "lat", "lon", "wikipedia_title", "wikipedia_url",
             "image_url", "image_credit", "further_reading", "source_id"]
    saved = 0
    for name, rows in tables.items():
        if not rows:
            print(f"  {name}: no curated source yet, skipped")
            continue
        n = enrich(rows)
        write(name, rows, first)
        print(f"  {name}: {len(rows)} rows, {n} with a Wikipedia picture", flush=True)
        for r in rows:
            primary = (r["id"] in PRIMARY_EARTH) or r.get("primary_demo") == "1"
            if primary and r["image_url"]:
                p = fetch(r["image_url"], f"img_{r['id']}.jpg", rounds=2, timeout=120, quiet=True)
                if p:
                    (OUT / "images").mkdir(exist_ok=True)
                    (OUT / "images" / f"{r['id']}.jpg").write_bytes(p.read_bytes())
                    saved += 1
    print(f"images saved to out/images: {saved}")
    _log(f"curated tables enriched; {saved} demo images saved locally")


if __name__ == "__main__":
    main()
