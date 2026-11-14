#!/usr/bin/env python3
"""
Add solar energy at the surface to earth_grid.csv, from NASA POWER climatology
(CERES SYN1deg, all-sky, 2001 onwards). Needs build_earth_grid.py and
build_earth_atmo.py in the same folder and an existing earth_grid.csv.

Do not run it at the same time as another build_earth_*.py script (same NASA
rate limit).

New column
  solar_w_m2   sunlight reaching a flat surface, clouds included, averaged over
               the whole year and over day and night, W/m2   (POWER "ALLSKY_SFC_SW_DWN")
               Same unit as the Mars and Moon columns, so the three can be compared.
               To get kWh/m2/day (the solar-panel unit): multiply by 0.024.

Usage (from this folder)
  python build_earth_solar.py               download (resumable), then update earth_grid.csv
  python build_earth_solar.py --build-only  update earth_grid.csv from what is downloaded
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)
import build_earth_grid as e
import build_earth_atmo as atmo

PARAM = "ALLSKY_SFC_SW_DWN"
COLUMN = "solar_w_m2"
# POWER units for this parameter depend on the "community"; all converted to W/m2
TO_W_M2 = {"kw-hr/m^2/day": 1000 / 24, "kwh/m^2/day": 1000 / 24, "kw-hr/m2/day": 1000 / 24,
           "mj/m^2/day": 1e6 / 86400, "mj/m2/day": 1e6 / 86400,
           "w/m^2": 1.0, "w/m2": 1.0}


def build():
    if not os.path.exists(e.OUT):
        sys.exit("earth_grid.csv not found. Run build_earth_grid.py first.")
    sums = [[0.0] * 180 for _ in range(90)]
    counts = [[0] * 180 for _ in range(90)]
    seen = set()
    files = 0
    for name in sorted(os.listdir(e.CACHE)):
        if not (name.startswith(PARAM + "_") and name.endswith(".json")):
            continue
        files += 1
        with open(os.path.join(e.CACHE, name), encoding="utf-8") as f:
            data = json.load(f)
        units = data.get("parameters", {}).get(PARAM, {}).get("units")
        k = atmo.factor(PARAM, units, TO_W_M2, "solar energy")
        for ft in data.get("features", []):
            lon, lat = ft["geometry"]["coordinates"][:2]
            values = ft["properties"]["parameter"].get(PARAM)
            if values is None:
                continue
            key = (round(lat, 4), round(lon, 4))
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
            sums[i][j] += float(v) * k
            counts[i][j] += 1

    vals, lo, hi = {}, (1e30, None), (-1e30, None)
    for i in range(90):
        for j in range(180):
            if not counts[i][j]:
                continue
            v = sums[i][j] / counts[i][j]
            key = (89 - 2 * i, -179 + 2 * j)
            vals[key] = f"{v:.1f}"
            if v < lo[0]:
                lo = (v, key)
            if v > hi[0]:
                hi = (v, key)
    print(f"\n  {files} of 648 boxes downloaded")
    if not vals:
        print(f"  {COLUMN}: nothing downloaded yet")
        return
    print(f"  {COLUMN}: {len(vals)} of 16200 cells filled, "
          f"min {lo[0]:.1f} at lat {lo[1][0]}, lon {lo[1][1]}, "
          f"max {hi[0]:.1f} at lat {hi[1][0]}, lon {hi[1][1]}")
    n = atmo.add_columns(e.OUT, {COLUMN: vals})
    print(f"Updated {e.OUT} ({n} rows) with column {COLUMN}")
    print("  expected: about 70-130 W/m2 near the poles, about 110 W/m2 in Ireland,")
    print("            about 250-300 W/m2 in the Sahara / Atacama")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Add a solar energy column to earth_grid.csv.")
    ap.add_argument("--build-only", action="store_true", help="skip downloading")
    args = ap.parse_args()
    if not args.build_only:
        e.PARAMS = [PARAM]
        try:
            e.download_all()
        except KeyboardInterrupt:
            print("\nStopped. Updating the CSV from what was downloaded so far...")
    build()
