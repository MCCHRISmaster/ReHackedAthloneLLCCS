"""Small Wikipedia / Wikimedia Commons helper: page images, links and picture credits.

Wikimedia asks automated clients for a descriptive User-Agent (dl.UA has one). Responses are cached
in raw/wiki/ so reruns cost nothing.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import urllib.parse
from pathlib import Path

from dl import RAW, UA

API = "https://en.wikipedia.org/w/api.php"
CACHE = RAW / "wiki"


def api(params: dict) -> dict:
    """GET the Wikipedia API (cached on disk). Returns {} if the network fails."""
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    key = CACHE / (hashlib.sha1(q.encode()).hexdigest()[:20] + ".json")
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    r = subprocess.run(["curl", "-sL", "--retry", "5", "--retry-all-errors", "--max-time", "40", "-A", UA,
                        f"{API}?{q}"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    try:
        data = json.loads(r.stdout or "")
    except json.JSONDecodeError:
        return {}
    CACHE.mkdir(parents=True, exist_ok=True)
    key.write_text(json.dumps(data), encoding="utf-8")
    return data


def _strip_html(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def page_images(titles: list[str]) -> dict:
    """{requested title: {url, thumb_url, file, credit}} for titles that have a page image."""
    out: dict[str, dict] = {}
    titles = sorted({t for t in titles if t})
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        d = api({"action": "query", "prop": "pageimages", "piprop": "thumbnail|name", "pithumbsize": 800,
                 "redirects": 1, "titles": "|".join(chunk)}).get("query", {})
        alias = {t: t for t in chunk}
        for key in ("normalized", "redirects"):
            for m in d.get(key, []):
                for req, cur in list(alias.items()):
                    if cur == m["from"]:
                        alias[req] = m["to"]
        pages = {p["title"]: p for p in d.get("pages", [])}
        for req, final in alias.items():
            p = pages.get(final)
            if not p:
                continue
            out[req] = {"url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(final.replace(" ", "_")),
                        "thumb_url": (p.get("thumbnail") or {}).get("source", ""), "file": p.get("pageimage", "")}
    files = sorted({v["file"] for v in out.values() if v["file"]})
    credit = {}
    for i in range(0, len(files), 40):
        chunk = files[i:i + 40]
        d = api({"action": "query", "prop": "imageinfo", "iiprop": "extmetadata",
                 "titles": "|".join("File:" + f for f in chunk)}).get("query", {})
        for p in d.get("pages", []):
            ii = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
            artist = _strip_html((ii.get("Artist") or {}).get("value", "")) or "Wikimedia Commons contributor"
            lic = (ii.get("LicenseShortName") or {}).get("value", "see Commons")
            credit[p["title"].replace("File:", "", 1)] = f"{artist[:80]}, {lic}, via Wikimedia Commons"
    for v in out.values():
        v["credit"] = credit.get(v["file"].replace("_", " "), credit.get(v["file"], "Wikimedia Commons"))
    return out
