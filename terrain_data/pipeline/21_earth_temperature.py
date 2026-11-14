"""Earth surface temperature for the reverse search, complete over land.

WHY NOT MODIS: BUILD_PROMPT section 5.4 planned a MODIS land-surface-temperature fallback from
NASA NEO, but NEO no longer serves data files (every file URL returns an HTML page). So this
step fills the gap with the SAME dataset the team already uses, NASA POWER climatology
(TS = surface skin temperature, 2001-2025 normals), pulled box by box for every land box.

Method (same as earth_data/build_earth_grid.py, which this does not touch):
  - regional endpoint, 10 x 10 degree boxes that touch land, parameters TS, TS_MAX, TS_MIN
  - mean = TS ANN, high = mean of 12 monthly TS_MAX, low = mean of 12 monthly TS_MIN
  - every POWER point (0.5 x 0.625 deg) is averaged into the 1-degree and 2-degree cell it falls in
Responses are cached in raw/power/, so the script resumes where it stopped.

Outputs:
  work/power_temp_1deg.npz            1-degree arrays (used by 20_earth_features.py)
  out/earth_grid_power_full.csv       2-degree team layout, source_id nasa_power_clim
  out/earth_grid_filled.csv           teammate POWER rows where present, else the rows above

    python -I pipeline/21_earth_temperature.py            (about 40 minutes, run in background)
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
import urllib.parse
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, UA, _log  # noqa: E402
from grid import G1, G2, read_grid_csv, write_grid_csv  # noqa: E402

API = "https://power.larc.nasa.gov/api/temporal/climatology/regional"
CACHE = RAW / "power"
PARAMS = ["TS", "TS_MAX", "TS_MIN"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
PAUSE_S = 2.2          # POWER allows about 30 requests a minute
BOX = 10
WORKERS = 6            # parallel requests, all paced by one shared clock so the rate stays near 27 a minute
_lock, _last = threading.Lock(), [0.0]


def paced() -> None:
    """Block until PAUSE_S seconds have passed since any worker last started a request."""
    with _lock:
        wait = _last[0] + PAUSE_S - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()


def land_boxes() -> list[tuple[int, int, int, int]]:
    """10-degree boxes (lat0, lat1, lon0, lon1) that touch Natural Earth land."""
    import geopandas as gpd
    from shapely.geometry import box
    land = gpd.read_file(f"zip://{RAW / 'ne_50m_land.zip'}")
    boxes = []
    for lat0 in range(-90, 90, BOX):
        for lon0 in range(-180, 180, BOX):
            if land.intersects(box(lon0, lat0, lon0 + BOX, lat0 + BOX)).any():
                boxes.append((lat0, lat0 + BOX, lon0, lon0 + BOX))
    return boxes


def get(param: str, b: tuple[int, int, int, int]) -> dict | None:
    """One cached POWER regional request. Returns parsed JSON or None."""
    lat0, lat1, lon0, lon1 = b
    f = CACHE / f"{param}_{lat0}_{lat1}_{lon0}_{lon1}.json"
    if f.exists() and f.stat().st_size > 100:
        return json.loads(f.read_text(encoding="utf-8"))
    q = urllib.parse.urlencode({"latitude-min": lat0, "latitude-max": lat1,
                                "longitude-min": lon0, "longitude-max": lon1,
                                "parameters": param, "community": "RE", "format": "JSON"})
    for attempt in range(1, 6):
        paced()
        r = subprocess.run(["curl", "-sS", "-A", UA, "--max-time", "240", "--retry", "2", "--retry-all-errors",
                            "-w", "\n%{http_code}", f"{API}?{q}"], capture_output=True, text=True, timeout=300)
        body, _, code = r.stdout.rpartition("\n")
        if code.strip() == "200" and body.startswith("{"):
            CACHE.mkdir(parents=True, exist_ok=True)
            f.write_text(body, encoding="utf-8")
            return json.loads(body)
        if code.strip() == "429":
            time.sleep(60)
        elif code.strip() in ("400", "422"):
            return None                                  # box refused: caller will skip it
        else:
            time.sleep(5 * attempt)
    return None


def accumulate(data: dict, param: str, sums: dict, counts: dict) -> None:
    for ft in data.get("features", []):
        lon, lat = ft["geometry"]["coordinates"][:2]
        vals = ft["properties"]["parameter"][param]
        if param == "TS":
            v = vals.get("ANN")
        else:
            m = [vals.get(k) for k in MONTHS]
            m = [x for x in m if x is not None and x != -999]
            v = float(np.mean(m)) if len(m) == 12 else None
        if v is None or v == -999:
            continue
        for g, tag in ((G1, "1"), (G2, "2")):
            i = int(g.index(lat, lon))
            sums[(tag, param)][i] += v
            counts[(tag, param)][i] += 1


def main() -> None:
    boxes = land_boxes()
    print(f"{len(boxes)} land boxes x 3 parameters = {len(boxes) * 3} requests (cached ones are free)", flush=True)
    sums = {(t, p): np.zeros(g.n) for t, g in (("1", G1), ("2", G2)) for p in PARAMS}
    counts = {k: np.zeros(len(v)) for k, v in sums.items()}
    missing = []
    tasks = [(p, b) for b in boxes for p in PARAMS]
    with ThreadPoolExecutor(WORKERS) as pool:
        for n, ((p, b), d) in enumerate(zip(tasks, pool.map(lambda t: get(*t), tasks)), start=1):
            if d is None:
                missing.append((p, b))
            else:
                accumulate(d, p, sums, counts)
            if n % 60 == 0:
                print(f"  request {n}/{len(tasks)}", flush=True)
    print(f"done; {len(missing)} request(s) failed or were refused", flush=True)
    _log(f"POWER temperature pull: {len(boxes)} boxes, {len(missing)} failed requests")

    def mean(tag, p):
        with np.errstate(all="ignore"):
            return np.where(counts[(tag, p)] > 0, sums[(tag, p)] / counts[(tag, p)], np.nan)

    t1 = {"temp_mean_c": mean("1", "TS"), "temp_high_c": mean("1", "TS_MAX"), "temp_low_c": mean("1", "TS_MIN")}
    t2 = {"temp_mean_c": mean("2", "TS"), "temp_high_c": mean("2", "TS_MAX"), "temp_low_c": mean("2", "TS_MIN")}
    (ROOT / "work").mkdir(exist_ok=True)
    np.savez_compressed(ROOT / "work" / "power_temp_1deg.npz", **t1)
    write_grid_csv(ROOT / "out" / "earth_grid_power_full.csv", "earth", G2, t2, "nasa_power_clim")
    n_full = int((~np.isnan(t2["temp_mean_c"])).sum())

    # merged file: the teammate's POWER rows win where they have a value
    team_path = ROOT.parent / "earth_data" / "earth_grid.csv"
    merged = {k: v.copy() for k, v in t2.items()}
    n_team = 0
    if team_path.exists():
        team = read_grid_csv(team_path, G2)
        for k in merged:
            has = ~np.isnan(team[k])
            merged[k][has] = team[k][has]
        n_team = int((~np.isnan(team["temp_mean_c"])).sum())
    write_grid_csv(ROOT / "out" / "earth_grid_filled.csv", "earth", G2, merged, "nasa_power_clim")
    print(f"2-degree cells with a value: pulled {n_full}, teammate file {n_team}", flush=True)


if __name__ == "__main__":
    main()
