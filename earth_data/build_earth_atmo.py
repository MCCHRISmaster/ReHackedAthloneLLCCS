#!/usr/bin/env python3
"""
Add surface pressure and water vapour to earth_grid.csv, from NASA POWER
climatology (MERRA-2, 2001-2025). Needs build_earth_grid.py in the same folder
and an existing earth_grid.csv.

IMPORTANT: wait until build_earth_grid.py has finished before starting this one
(both use the same temporary file and the same NASA rate limit).

New columns
  pressure_pa       surface pressure, yearly average, Pa               (POWER "PS")
  water_vapour_mm   water vapour in the whole air column, yearly average, as mm of
                    liquid water (1 mm = 1 kg/m2)                      (POWER "TQV", or "PW")

Usage (from this folder)
  python build_earth_atmo.py               download (resumable), then update earth_grid.csv
  python build_earth_atmo.py --build-only  update earth_grid.csv from what is downloaded
"""
import argparse
import csv
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)
import build_earth_grid as e

WATER_CANDIDATES = ["TQV", "PW"]      # POWER names tried for total column water vapour
MEMO = os.path.join(e.CACHE, "water_param.txt")
TO_PA = {"kpa": 1000.0, "hpa": 100.0, "mb": 100.0, "mbar": 100.0, "pa": 1.0}
TO_MM = {"kg/m^2": 1.0, "kg/m2": 1.0, "kg m-2": 1.0, "kg m^-2": 1.0, "mm": 1.0, "cm": 10.0}


def choose_water_param():
    """Find which POWER parameter gives column water vapour (asks the server once)."""
    if os.path.exists(MEMO):
        return open(MEMO).read().strip()
    box = os.path.join(e.CACHE, "box_size.txt")
    if not os.path.exists(box):
        sys.exit("power_cache/box_size.txt not found. Run build_earth_grid.py first.")
    size = float(open(box).read())
    lat0, lon0 = -90, -180
    for name in WATER_CANDIDATES:
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
        print(f"Using POWER parameter '{name}' for water vapour.")
        return name
    sys.exit("NASA POWER refused every water-vapour parameter tried "
             f"({', '.join(WATER_CANDIDATES)}). Send me the messages above.")


def factor(param, units, table, what):
    u = (units or "").strip().lower()
    if u not in table:
        sys.exit(f"Unexpected units '{units}' for {param} ({what}). Send me this message.")
    return table[u]


def fmt(v, decimals):
    s = f"{v:.{decimals}f}"
    return s.rstrip("0").rstrip(".") if decimals > 1 else s


def add_columns(path, columns):
    """columns: {name: {(lat, lon): text}}. Adds/overwrites them, just before source_id."""
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
        header = list(rows[0].keys())
    for name in columns:
        if name not in header:
            header.insert(header.index("source_id"), name)
    for r in rows:
        key = (int(r["lat"]), int(r["lon"]))
        for name, values in columns.items():
            r[name] = values.get(key, "")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows)
    return len(rows)


def build(water):
    if not os.path.exists(e.OUT):
        sys.exit("earth_grid.csv not found. Run build_earth_grid.py first.")
    spec = {"PS": ("pressure_pa", TO_PA, "pressure", 1), water: ("water_vapour_mm", TO_MM, "water vapour", 3)}
    sums = {p: [[0.0] * 180 for _ in range(90)] for p in spec}
    counts = {p: [[0] * 180 for _ in range(90)] for p in spec}
    seen = set()
    for name in sorted(os.listdir(e.CACHE)):
        param = next((p for p in spec if name.startswith(p + "_") and name.endswith(".json")), None)
        if param is None:
            continue
        with open(os.path.join(e.CACHE, name), encoding="utf-8") as f:
            data = json.load(f)
        units = data.get("parameters", {}).get(param, {}).get("units")
        k = factor(param, units, spec[param][1], spec[param][2])
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
                vals[key] = fmt(v, dec)
                if v < lo[0]:
                    lo = (v, key)
                if v > hi[0]:
                    hi = (v, key)
        columns[col] = vals
        if vals:
            print(f"  {col}: {len(vals)} of 16200 cells filled, "
                  f"min {lo[0]:.4g} at lat {lo[1][0]}, lon {lo[1][1]}, "
                  f"max {hi[0]:.4g} at lat {hi[1][0]}, lon {hi[1][1]}")
        else:
            print(f"  {col}: nothing downloaded yet")
    n = add_columns(e.OUT, columns)
    print(f"Updated {e.OUT} ({n} rows) with columns: {', '.join(columns)}")
    print("  expected: pressure about 55,000 Pa (Tibet) to 103,000 Pa; water vapour about 0.3 mm")
    print("            (Antarctic plateau) to 60 mm (tropical oceans)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Add pressure and water vapour columns to earth_grid.csv.")
    ap.add_argument("--build-only", action="store_true", help="skip downloading")
    args = ap.parse_args()
    if args.build_only:
        if not os.path.exists(MEMO):
            sys.exit("Nothing downloaded yet. Run without --build-only first.")
        water = open(MEMO).read().strip()
    else:
        water = choose_water_param()
        e.PARAMS = ["PS", water]
        try:
            e.download_all()
        except KeyboardInterrupt:
            print("\nStopped. Updating the CSV from what was downloaded so far...")
    build(water)
