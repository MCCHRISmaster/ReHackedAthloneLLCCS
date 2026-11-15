#!/usr/bin/env python3
"""
Add wind speed and aerosol (dust/haze) optical depth to earth_grid.csv, from NASA
POWER climatology (MERRA-2). Needs build_earth_grid.py and build_earth_atmo.py in
the same folder and an existing earth_grid.csv.

Do not run it at the same time as another build_earth_*.py script (same NASA
rate limit and temporary file).

New columns
  wind_ms       wind speed 2 m above the ground, yearly average, m/s      (POWER "WS2M")
                2 m is the height used for the Mars column too.
  aerosol_tau   aerosol optical depth: how much the air dims sunlight because of
                dust, sea salt, smoke and pollution. No unit; 0 = perfectly clear,
                1 = only ~37 % of direct sunlight gets through.        (POWER aerosol optical depth)
                The POWER parameter name is found automatically (asked once). If POWER
                refuses every name tried, the script still does the wind column.

Usage (from this folder)
  python build_earth_wind_dust.py               download (resumable), then update earth_grid.csv
  python build_earth_wind_dust.py --build-only  update earth_grid.csv from what is downloaded
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)
import build_earth_grid as e
import build_earth_atmo as atmo

WIND = "WS2M"
AOD_CANDIDATES = ["AOD_55", "AOD_55_ADJ", "AOD_84"]
MEMO = os.path.join(e.CACHE, "aod_param.txt")      # chosen name, or "none"
TO_MS = {"m/s": 1.0, "m s-1": 1.0, "m/sec": 1.0}
NO_UNIT = {"": 1.0, "dimensionless": 1.0, "unitless": 1.0, "1": 1.0, "-": 1.0, "none": 1.0, "na": 1.0, "n/a": 1.0}


def choose_aod_param():
    if os.path.exists(MEMO):
        return open(MEMO).read().strip()
    size = float(open(os.path.join(e.CACHE, "box_size.txt")).read())
    lat0, lon0 = 10, 0                     # a box with plenty of Saharan dust
    for name in AOD_CANDIDATES:
        path = e.cache_path(name, lat0, lat0 + size, lon0, lon0 + size)
        if not os.path.exists(path):
            print(f"Asking NASA POWER for '{name}'...")
            status, data = e.fetch(name, lat0, lat0 + size, lon0, lon0 + size)
            time.sleep(e.PAUSE_S)
            if status == "too_big":
                print(f"  refused: {str(data)[:200]}")
                continue
            if status != "ok":
                sys.exit("Could not reach NASA POWER. Check the connection and run again.")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f)
        with open(MEMO, "w") as f:
            f.write(name)
        print(f"Using POWER parameter '{name}' for aerosol optical depth.")
        return name
    print("NASA POWER refused every aerosol name tried "
          f"({', '.join(AOD_CANDIDATES)}): doing the wind column only.")
    with open(MEMO, "w") as f:
        f.write("none")
    return "none"


def build(aod):
    if not os.path.exists(e.OUT):
        sys.exit("earth_grid.csv not found. Run build_earth_grid.py first.")
    spec = {WIND: ("wind_ms", TO_MS, "wind speed", 2)}
    if aod != "none":
        spec[aod] = ("aerosol_tau", NO_UNIT, "aerosol optical depth", 3)
    sums = {p: [[0.0] * 180 for _ in range(90)] for p in spec}
    counts = {p: [[0] * 180 for _ in range(90)] for p in spec}
    seen = set()
    files = {p: 0 for p in spec}
    for name in sorted(os.listdir(e.CACHE)):
        param = next((p for p in spec if name.startswith(p + "_") and name.endswith(".json")
                      and not (p == "AOD_55" and name.startswith("AOD_55_ADJ"))), None)
        if param is None:
            continue
        files[param] += 1
        with open(os.path.join(e.CACHE, name), encoding="utf-8") as f:
            data = json.load(f)
        units = data.get("parameters", {}).get(param, {}).get("units")
        k = atmo.factor(param, units, spec[param][1], spec[param][2])
        for ft in data.get("features", []):
            lon, lat = ft["geometry"]["coordinates"][:2]
            values = ft["properties"]["parameter"].get(param)
            if values is None:
                continue
            key = (param, round(lat, 4), round(lon, 4))
            if key in seen:
                continue
            seen.add(key)
            v = values.get("ANN")
            if not e.valid(v):
                months = [values.get(m) for m in e.MONTHS]
                months = [float(m) for m in months if e.valid(m)]
                if len(months) != 12:
                    continue
                v = sum(months) / 12
            i, j = e.cell_index(float(lat), float(lon))
            sums[param][i][j] += float(v) * k
            counts[param][i][j] += 1

    columns = {}
    print()
    for param, (col, _, _, dec) in spec.items():
        vals, lo, hi = {}, (1e30, None), (-1e30, None)
        for i in range(90):
            for j in range(180):
                c = counts[param][i][j]
                if not c:
                    continue
                v = sums[param][i][j] / c
                key = (89 - 2 * i, -179 + 2 * j)
                vals[key] = f"{v:.{dec}f}"
                if v < lo[0]:
                    lo = (v, key)
                if v > hi[0]:
                    hi = (v, key)
        columns[col] = vals
        if vals:
            print(f"  {col} ({param}, {files[param]} of 648 boxes): {len(vals)} of 16200 cells filled, "
                  f"min {lo[0]:.4g} at lat {lo[1][0]}, lon {lo[1][1]}, "
                  f"max {hi[0]:.4g} at lat {hi[1][0]}, lon {hi[1][1]}")
        else:
            print(f"  {col}: nothing downloaded yet")
    columns = {c: v for c, v in columns.items() if v}
    if not columns:
        return
    n = atmo.add_columns(e.OUT, columns)
    print(f"Updated {e.OUT} ({n} rows) with columns: {', '.join(columns)}")
    print("  expected: wind about 1-2 m/s in forests / tropics to 8-10 m/s over stormy oceans,")
    print("            aerosol_tau about 0.02-0.05 (Antarctica, open ocean) to 0.5-0.8 (Sahara, India, eastern China)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Add wind speed and aerosol optical depth to earth_grid.csv.")
    ap.add_argument("--build-only", action="store_true", help="skip downloading")
    args = ap.parse_args()
    if args.build_only:
        aod = open(MEMO).read().strip() if os.path.exists(MEMO) else "none"
    else:
        if not os.path.exists(os.path.join(e.CACHE, "box_size.txt")):
            sys.exit("power_cache/box_size.txt not found. Run build_earth_grid.py first.")
        aod = choose_aod_param()
        e.PARAMS = [WIND] + ([aod] if aod != "none" else [])
        try:
            e.download_all()
        except KeyboardInterrupt:
            print("\nStopped. Updating the CSV from what was downloaded so far...")
    build(aod)
