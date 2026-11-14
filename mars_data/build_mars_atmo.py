#!/usr/bin/env python3
"""
Add surface pressure and water vapour to mars_grid.csv, from the Mars Climate
Database (MCD 6.2) web interface. Needs build_mars_grid.py in the same folder
and an existing mars_grid.csv (run build_mars_grid.py first).

New columns
  pressure_pa       surface pressure, yearly average, Pa          (MCD variable "ps")
  water_vapour_mm   water vapour in the whole air column, yearly average, expressed as
                    mm of liquid water (1 mm = 1 kg/m2 = 1000 "precipitable microns")
                    (MCD variable "col_h2ovapor")

How: 12 seasons (Ls 15..345) x 4 local times (0h, 6h, 12h, 18h) x 2 variables
= 96 small downloads kept in mcd_cache/. Seasons are weighted by their length,
then values are interpolated linearly to the 2 deg cell centres.

Usage (from this folder)
  python build_mars_atmo.py --test         one request per variable, to check the server
  python build_mars_atmo.py                download everything, then update mars_grid.csv
  python build_mars_atmo.py --build-only   update mars_grid.csv from mcd_cache/ only
"""
import argparse
import csv
import math
import os
import shutil
import sys
import time
from urllib.parse import urljoin

import build_mars_grid as b

LT_LIST = [0, 6, 12, 18]
# MCD variable -> (CSV column, valid range in MCD units, decimals)
VARS = {
    "ps": ("pressure_pa", (1.0, 3000.0), 1),
    "col_h2ovapor": ("water_vapour_mm", (0.0, 2.0), 5),
}


def cache_name(var, ls, lt):
    return os.path.join(b.CACHE, f"{var}_ls{ls:03d}_lt{lt:02d}.txt")


def check(var, lons, lats, grid):
    lo, hi = VARS[var][1]
    if len(lons) < 10 or len(lats) < 10:
        raise ValueError(f"grid too small ({len(lons)} x {len(lats)})")
    flat = [v for r in grid for v in r]
    if min(flat) < lo or max(flat) > hi:
        raise ValueError(f"values {min(flat):.3g}..{max(flat):.3g} outside the expected range {lo}..{hi}")


def fetch(var, ls, lt):
    dest = cache_name(var, ls, lt)
    if os.path.exists(dest):
        return dest
    os.makedirs(b.CACHE, exist_ok=True)
    url = b.request_url(ls, lt).replace("var1=tsurf", "var1=" + var)
    if "var1=" + var not in url:
        raise RuntimeError("could not build the request URL")
    html_tmp = os.path.join(b.CACHE, "_page.tmp")
    txt_tmp = os.path.join(b.CACHE, "_data.tmp")
    last_error = "unknown error"
    for attempt in range(1, 6):
        if not b.curl_get(url, html_tmp):
            last_error = "could not reach the MCD server"
        else:
            with open(html_tmp, encoding="utf-8", errors="replace") as f:
                html = f.read()
            m = b.HREF_TXT.search(html)
            if not m:
                shutil.copyfile(html_tmp, os.path.join(b.CACHE, "_last_error.html"))
                last_error = ("the page has no link to a data file "
                              "(saved as mcd_cache/_last_error.html)")
            elif not b.curl_get(urljoin(url, m.group(1)), txt_tmp):
                last_error = "could not download the data file"
            else:
                try:
                    check(var, *b.parse_ascii(txt_tmp))
                except ValueError as e:
                    shutil.copyfile(txt_tmp, os.path.join(b.CACHE, "_last_error.txt"))
                    last_error = f"data file not understood: {e} (saved as mcd_cache/_last_error.txt)"
                else:
                    os.replace(txt_tmp, dest)
                    return dest
        print(f"    attempt {attempt}/5 failed: {last_error}")
        time.sleep(5 * attempt)
    raise RuntimeError(last_error)


def yearly_mean(var):
    """Season-weighted yearly mean on the MCD grid. Returns (lons, lats, field)."""
    lons = lats = field = None
    total = sum(b.MONTH_SOLS)
    for ls, w in zip(b.LS_LIST, b.MONTH_SOLS):
        for lt in LT_LIST:
            lo, la, g = b.parse_ascii(cache_name(var, ls, lt))
            if field is None:
                lons, lats = lo, la
                field = [[0.0] * len(la) for _ in lo]
            k = w / total / len(LT_LIST)
            for i in range(len(lons)):
                fi, gi = field[i], g[i]
                for j in range(len(lats)):
                    fi[j] += k * gi[j]
    return lons, lats, field


def interp(lons, lats, field, lat, lon):
    i, tx = b.bracket(lons, lon)
    j, ty = b.bracket(lats, lat)
    return ((1 - tx) * (1 - ty) * field[i][j] + tx * (1 - ty) * field[i + 1][j]
            + (1 - tx) * ty * field[i][j + 1] + tx * ty * field[i + 1][j + 1])


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


def build():
    if not os.path.exists(b.OUT):
        sys.exit("mars_grid.csv not found. Run build_mars_grid.py first.")
    missing = [1 for v in VARS for ls in b.LS_LIST for lt in LT_LIST
               if not os.path.exists(cache_name(v, ls, lt))]
    if missing:
        sys.exit(f"{len(missing)} maps are missing from mcd_cache/. Run without --build-only.")
    columns = {}
    print()
    for var, (col, _, dec) in VARS.items():
        lons, lats, field = yearly_mean(var)
        vals, wsum, msum = {}, 0.0, 0.0
        best_lo, best_hi = (1e30, None), (-1e30, None)
        for lat in range(89, -90, -2):
            for lon in range(-179, 180, 2):
                v = interp(lons, lats, field, lat, lon)
                vals[(lat, lon)] = fmt(v, dec)
                cw = math.cos(math.radians(lat))
                wsum += cw
                msum += cw * v
                if v < best_lo[0]:
                    best_lo = (v, (lat, lon))
                if v > best_hi[0]:
                    best_hi = (v, (lat, lon))
        columns[col] = vals
        print(f"  {col}: global mean {msum / wsum:.4g}, "
              f"min {best_lo[0]:.4g} at lat {best_lo[1][0]}, lon {best_lo[1][1]}, "
              f"max {best_hi[0]:.4g} at lat {best_hi[1][0]}, lon {best_hi[1][1]}")
    n = add_columns(b.OUT, columns)
    print(f"Updated {b.OUT} ({n} rows) with columns: {', '.join(columns)}")
    print("  expected: pressure mean about 600 Pa, lowest on Tharsis/Olympus Mons (lon about -110 to -135),")
    print("            highest in Hellas (lat about -43, lon about 70); water vapour about 0.005 to 0.03 mm")


def main():
    ap = argparse.ArgumentParser(description="Add pressure and water vapour columns to mars_grid.csv.")
    ap.add_argument("--test", action="store_true", help="one request per variable, show what comes back")
    ap.add_argument("--build-only", action="store_true", help="skip downloads")
    ap.add_argument("--pause", type=float, default=1.0, help="seconds between requests (default 1)")
    args = ap.parse_args()

    if not args.build_only and not b.CURL:
        sys.exit("curl not found.")

    if args.test:
        for var in VARS:
            try:
                path = fetch(var, 105, 12)
            except RuntimeError as e:
                sys.exit(f"TEST FAILED for {var}: {e}")
            lons, lats, grid = b.parse_ascii(path)
            flat = [v for r in grid for v in r]
            print(f"TEST OK {var}: {len(lons)} x {len(lats)} grid, min {min(flat):.4g}, max {max(flat):.4g}")
        print("Expected: ps roughly 50 to 1200 (Pa), col_h2ovapor roughly 0 to 0.08 (kg/m2).")
        return

    if not args.build_only:
        todo = [(v, ls, lt) for v in VARS for ls in b.LS_LIST for lt in LT_LIST]
        left = sum(1 for t in todo if not os.path.exists(cache_name(*t)))
        print(f"{len(todo)} maps needed, {len(todo) - left} already downloaded, {left} to go.")
        for n, (v, ls, lt) in enumerate(todo, 1):
            if os.path.exists(cache_name(v, ls, lt)):
                continue
            t0 = time.time()
            try:
                fetch(v, ls, lt)
            except RuntimeError as e:
                sys.exit(f"\nStopped at {v} Ls {ls}, {lt}h: {e}\nRun the same command again to resume.")
            print(f"  [{n:3d}/{len(todo)}] {v:13s} Ls {ls:3d}  {lt:2d}h  ok ({time.time() - t0:.1f} s)", flush=True)
            time.sleep(args.pause)
    build()


if __name__ == "__main__":
    main()
