"""Write out/sites.json with the nine seed sites and PLACEHOLDER scores.

Purpose: the globe owner can wire the import today (swap SITES for this file) before the real
numbers exist. Every site carries the full schema from section 7 of BUILD_PROMPT.md, so the
real export (60_export.py) can replace this file without any front-end change.

The scores here are FAKE (a deterministic hash of the site id) and every site is flagged
"mock": true. 60_export.py overwrites this file with real values.

    python pipeline/05_mock_sites.py
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REPO = ROOT.parent
SITES_JS = REPO / "analog-atlas" / "analog-atlas" / "js" / "data" / "sites.js"
OUT = ROOT / "out" / "sites.json"

DIMS = ["geology", "terrain", "thermal", "water", "dust", "subsurface", "habitability", "operations"]
PRESETS = ["raw", "crewed", "base", "rover"]
COUNTRY = {
    "haughton-crater": "Canada", "atacama-yungay": "Chile", "rio-tinto": "Spain",
    "lonar-crater": "India", "cueva-de-los-verdes": "Spain",
}


def load_seed_sites() -> list[dict]:
    """Read the globe's SITES array by letting Node import the ES module and print it as JSON."""
    js = ("import(process.argv[1]).then(m => process.stdout.write(JSON.stringify(m.SITES)))"
          ".catch(e => { console.error(e); process.exit(1); })")
    url = SITES_JS.resolve().as_uri()
    r = subprocess.run(["node", "-e", js, url], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        sys.exit(f"could not read sites.js with node:\n{r.stderr[:500]}")
    return json.loads(r.stdout)


def fake(seed: str, key: str) -> float:
    """Deterministic pseudo-random number in 0.25..0.95 from a string, so reruns do not change."""
    h = hashlib.sha1(f"{seed}|{key}".encode()).digest()
    return round(0.25 + 0.70 * (h[0] / 255), 2)


def main() -> None:
    seeds = load_seed_sites()
    out = []
    for s in seeds:
        sid = s["id"]
        site = dict(s)                                    # keep every original field untouched
        site["mock"] = True
        site["site_type"] = "known_analog" if s["body"] == "earth" else "mission_site"
        site["country"] = COUNTRY.get(sid, "")
        site["image_url"] = ""
        site["image_credit"] = ""
        site["wikipedia_url"] = ""
        site["links"] = []
        site["programs"] = []
        site["metrics"] = {"elevation_m": {"value": None, "unit": "m"}}
        site["scores"] = {d: fake(sid, d) for d in DIMS}
        site["caveats"] = ["MOCK DATA: placeholder scores until the pipeline has run."]
        site["source_ids"] = []
        if s["body"] == "earth":
            matches = {}
            for body in s.get("targets", []):
                # one placeholder pairing per body, against the first seed target that exists
                tid = {"moon": "shackleton", "mars": "jezero"}[body]
                overall = fake(sid, tid)
                matches[tid] = {
                    "overall": overall,
                    "presets": {p: fake(sid, f"{tid}|{p}") for p in PRESETS},
                    "dims": {d: fake(sid, f"{tid}|{d}") for d in DIMS},
                    "coverage": {d: 1.0 for d in DIMS},
                    "losses": [],
                    "alternative": {},
                }
            site["matches"] = matches
        else:
            site["matches"] = {}
            site["top_cells"] = []
        out.append(site)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(REPO)}: {len(out)} sites, "
          f"{sum(1 for s in out if s['body'] == 'earth')} earth / "
          f"{sum(1 for s in out if s['body'] == 'moon')} moon / "
          f"{sum(1 for s in out if s['body'] == 'mars')} mars, all flagged mock")


if __name__ == "__main__":
    main()
