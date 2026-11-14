"""
Build earth_grid.csv (team template format) from NASA POWER climatology.

    python build_earth_grid.py               # download (resumable) + build CSV
    python build_earth_grid.py --build-only  # build CSV from what is downloaded so far

What it does
- Downloads NASA POWER climatology (TS, TS_MAX, TS_MIN) with the *regional*
  endpoint, box by box, on POWER's native 0.5 x 0.625 deg grid.
- Saves every response in power_cache/, so if it crashes or you stop it
  (Ctrl+C), running it again picks up where it left off.
- Averages all POWER points falling inside each 2 x 2 deg cell, then writes
  earth_grid.csv with the 16,200 rows the template asks for:
    temp_mean_c = TS annual value
    temp_high_c = mean of the 12 monthly TS_MAX
    temp_low_c  = mean of the 12 monthly TS_MIN

No extra packages needed (standard library only). Python 3.8+.
"""

import argparse
import csv
import json
import math
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://power.larc.nasa.gov/api/temporal/climatology/regional"
PARAMS = ["TS", "TS_MAX", "TS_MIN"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
FILL = -999.0
CACHE = "power_cache"
OUT = "earth_grid.csv"
SOURCE_ID = "nasa_power_clim"
PAUSE_S = 2.2          # POWER climatology allows about 30 requests / minute
START_BOX_DEG = 10     # box size tried first; halved automatically if refused
MIN_BOX_DEG = 2.5

HEADER = ["body", "lat", "lon", "temp_mean_c", "temp_high_c", "temp_low_c",
          "elevation_m", "slope_deg", "water_ice_pct", "source_id"]


# ---------------------------------------------------------------- download

def cache_path(param, lat0, lat1, lon0, lon1):
    return os.path.join(CACHE, f"{param}_{lat0:g}_{lat1:g}_{lon0:g}_{lon1:g}.json")


def fetch(param, lat0, lat1, lon0, lon1, tries=5):
    """Return (status, data). status: 'ok', 'too_big' or 'failed'."""
    q = urllib.parse.urlencode({
        "latitude-min": lat0, "latitude-max": lat1,
        "longitude-min": lon0, "longitude-max": lon1,
        "parameters": param, "community": "RE", "format": "JSON",
    })
    url = f"{API}?{q}"
    if CURL:
        return fetch_curl(url, tries)
    for attempt in range(1, tries + 1):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                return "ok", json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if e.code in (400, 422):          # request refused: box probably too big
                return "too_big", body
            if e.code == 429:                 # rate limited: wait longer
                time.sleep(60)
                continue
            print(f"    HTTP {e.code} (try {attempt}/{tries}): {body}")
        except Exception as e:                # network reset, timeout, ...
            print(f"    {type(e).__name__} (try {attempt}/{tries}): {e}")
        time.sleep(5 * attempt)
    return "failed", None


CURL = shutil.which("curl.exe") or shutil.which("curl")


def fetch_curl(url, tries):
    """Same as fetch(), using curl: more robust on networks that reset
    Python's HTTPS connections."""
    tmp = os.path.join(CACHE, "_download.tmp")
    for attempt in range(1, tries + 1):
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
            res = subprocess.run(
                [CURL, "-sS", "--retry", "3", "--retry-all-errors", "--max-time", "180",
                 "-o", tmp, "-w", "%{http_code}", url],
                capture_output=True, text=True)
            code = res.stdout.strip()[-3:]
            body = open(tmp, encoding="utf-8", errors="replace").read() \
                if os.path.exists(tmp) else ""
            if code == "200":
                return "ok", json.loads(body)
            if code in ("400", "422"):
                return "too_big", body[:300]
            if code == "429":
                time.sleep(60)
                continue
            print(f"    curl HTTP {code or '-'} (try {attempt}/{tries}): "
                  f"{(res.stderr or body)[:200].strip()}")
        except Exception as e:
            print(f"    {type(e).__name__} (try {attempt}/{tries}): {e}")
        time.sleep(5 * attempt)
    return "failed", None


def download_box(param, lat0, lat1, lon0, lon1, size, stats):
    path = cache_path(param, lat0, lat1, lon0, lon1)
    if os.path.exists(path):
        return
    status, data = fetch(param, lat0, lat1, lon0, lon1)
    time.sleep(PAUSE_S)
    if status == "ok":
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
        stats["ok"] += 1
        return
    if status == "too_big" and size / 2 >= MIN_BOX_DEG:
        half = size / 2
        print(f"    box refused at {size:g} deg, splitting into {half:g} deg boxes")
        for a in frange(lat0, lat1, half):
            for b in frange(lon0, lon1, half):
                download_box(param, a, min(a + half, lat1), b, min(b + half, lon1), half, stats)
        return
    print(f"    GAVE UP on {param} lat {lat0}..{lat1} lon {lon0}..{lon1}: {data}")
    stats["failed"] += 1


def frange(start, stop, step):
    x = start
    while x < stop - 1e-9:
        yield x
        x += step


def find_box_size():
    """Ask POWER once for the largest box it accepts, and remember it."""
    memo = os.path.join(CACHE, "box_size.txt")
    if os.path.exists(memo):
        return float(open(memo).read())
    # sizes that tile the globe exactly, largest first
    for size in (10, 9, 6, 5, 4.5, 4, 3, 2.5, 2):
        lat0, lon0 = -90, -180
        print(f"Testing a {size:g} deg box...")
        status, data = fetch(PARAMS[0], lat0, lat0 + size, lon0, lon0 + size)
        time.sleep(PAUSE_S)
        if status == "ok":
            with open(cache_path(PARAMS[0], lat0, lat0 + size, lon0, lon0 + size),
                      "w", encoding="utf-8") as f:
                json.dump(data, f)
            break
        if status == "too_big":
            print(f"  refused ({str(data)[:120]})")
            continue
        sys.exit(f"Could not get data from NASA POWER: {data}\n"
                 "Check your internet connection and try again.")
    else:
        sys.exit("NASA POWER refused every box size; send me the messages above.")
    n_req = int(180 / size) * int(360 / size) * len(PARAMS)
    print(f"About {n_req} requests, roughly {n_req * (PAUSE_S + 1) / 3600:.1f} h "
          "at POWER's rate limit.")
    with open(memo, "w") as f:
        f.write(str(size))
    print(f"Using {size:g} deg boxes.")
    return size


def download_all():
    os.makedirs(CACHE, exist_ok=True)
    size = find_box_size()
    boxes = [(a, a + size, b, b + size)
             for a in frange(-90, 90, size) for b in frange(-180, 180, size)]
    total = len(boxes) * len(PARAMS)
    stats = {"ok": 0, "failed": 0}
    n = 0
    t0 = time.time()
    # box by box (all 3 parameters each), so a partial run gives complete cells
    for (lat0, lat1, lon0, lon1) in boxes:
        for param in PARAMS:
            n += 1
            if not os.path.exists(cache_path(param, lat0, lat1, lon0, lon1)):
                el = time.time() - t0
                print(f"[{n}/{total}] {param} lat {lat0:g}..{lat1:g} lon {lon0:g}..{lon1:g}"
                      f"  ({el/60:.0f} min elapsed)")
            download_box(param, lat0, lat1, lon0, lon1, size, stats)
    print(f"\nDownload finished: {stats['ok']} new boxes, {stats['failed']} failed.")
    if stats["failed"]:
        print("Run the script again to retry the failed boxes.")


# ---------------------------------------------------------------- build

def points_from_file(path):
    """Yield (lat, lon, param, monthly_dict) from one POWER GeoJSON response."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    feats = data.get("features") if isinstance(data, dict) else None
    if feats is None:
        return
    for ft in feats:
        lon, lat = ft["geometry"]["coordinates"][:2]
        for param, values in ft["properties"]["parameter"].items():
            yield float(lat), float(lon), param, values


def valid(v):
    return v is not None and not (isinstance(v, float) and math.isnan(v)) and v > FILL + 1


def point_value(param, values):
    """Single number per POWER point, following the template definitions."""
    if param == "TS":
        v = values.get("ANN")
        if valid(v):
            return float(v)
    months = [values.get(m) for m in MONTHS]
    months = [float(m) for m in months if valid(m)]
    return sum(months) / len(months) if len(months) == 12 else None


def cell_index(lat, lon):
    i = min(int((90 - lat) // 2), 89)      # row 0 = north edge
    lon = ((lon + 180) % 360) - 180          # wrap to [-180, 180)
    j = min(int((lon + 180) // 2), 179)
    return max(i, 0), j


def build():
    sums = {p: [[0.0] * 180 for _ in range(90)] for p in PARAMS}
    counts = {p: [[0] * 180 for _ in range(90)] for p in PARAMS}
    seen = set()
    files = sorted(f for f in os.listdir(CACHE)
                   if f.endswith(".json")) if os.path.isdir(CACHE) else []
    for name in files:
        for lat, lon, param, values in points_from_file(os.path.join(CACHE, name)):
            if param not in PARAMS:
                continue
            key = (param, round(lat, 4), round(lon, 4))
            if key in seen:            # boxes share edges: count each point once
                continue
            seen.add(key)
            v = point_value(param, values)
            if v is None:
                continue
            i, j = cell_index(lat, lon)
            sums[param][i][j] += v
            counts[param][i][j] += 1

    def cell(param, i, j):
        c = counts[param][i][j]
        return round(sums[param][i][j] / c, 1) if c else None

    rows, filled, bad_order = [], 0, 0
    for i in range(90):
        lat = 89 - 2 * i
        for j in range(180):
            lon = -179 + 2 * j
            mean, high, low = cell("TS", i, j), cell("TS_MAX", i, j), cell("TS_MIN", i, j)
            if None not in (mean, high, low):
                filled += 1
                if not (low <= mean <= high):
                    bad_order += 1
            fmt = lambda x: "" if x is None else f"{x:.1f}"
            rows.append(["earth", lat, lon, fmt(mean), fmt(high), fmt(low),
                         "", "", "", SOURCE_ID])

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)

    vals = [float(r[3]) for r in rows if r[3]]
    print(f"\nWrote {OUT}: {len(rows)} rows, {filled} complete cells "
          f"({100 * filled / len(rows):.1f}%).")
    if vals:
        print(f"temp_mean_c range: {min(vals):.1f} to {max(vals):.1f} C")
    if bad_order:
        print(f"WARNING: {bad_order} cells where low <= mean <= high is not true")
    if filled < len(rows):
        print("Some cells are empty: run without --build-only to finish downloading.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-only", action="store_true",
                    help="skip downloading, build the CSV from power_cache/")
    args = ap.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    if not args.build_only:
        try:
            download_all()
        except KeyboardInterrupt:
            print("\nStopped. Building the CSV from what was downloaded so far...")
    build()
    sys.exit(0)
