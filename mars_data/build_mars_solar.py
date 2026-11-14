#!/usr/bin/env python3
"""
Add solar energy at the surface to mars_grid.csv, from the Mars Climate
Database (MCD 6.2) web interface. Needs build_mars_grid.py and
build_mars_atmo.py in the same folder and an existing mars_grid.csv.

New column
  solar_w_m2   sunlight reaching the surface (dust and clouds included), averaged
               over the whole Martian year and over day and night, W/m2
               (MCD "solar flux to surface"). Same unit as earth_grid.csv.

How: 12 seasons (Ls 15..345) x 12 local times (every 2 h, same local time over
the whole planet) = 144 small downloads kept in mcd_cache/. Seasons are weighted
by their length, then values are interpolated linearly to the 2 deg cell centres.
Sunlight is zero at night, so the day/night average needs many local times
(4 would underestimate it by about 20 %).

Usage (from this folder)
  python build_mars_solar.py --test         one request, to find the MCD variable name
  python build_mars_solar.py                download everything, then update mars_grid.csv
  python build_mars_solar.py --build-only   update mars_grid.csv from mcd_cache/ only
"""
import argparse
import math
import os
import shutil
import sys
import time
from urllib.parse import urljoin

import build_mars_grid as b
import build_mars_atmo as atmo

LT_LIST = list(range(0, 24, 2))
CANDIDATES = ["fluxsurf_sw", "fluxsurf_dn_sw"]   # MCD names tried for "solar flux to surface"
MEMO = os.path.join(b.CACHE, "solar_var.txt")
COLUMN = "solar_w_m2"
VALID = (0.0, 800.0)                             # W/m2; anything outside = bad download


def cache_name(var, ls, lt):
    return os.path.join(b.CACHE, f"{var}_ls{ls:03d}_lt{lt:02d}.txt")


def check(lons, lats, grid):
    if len(lons) < 10 or len(lats) < 10:
        raise ValueError(f"grid too small ({len(lons)} x {len(lats)})")
    flat = [v for r in grid for v in r]
    if min(flat) < VALID[0] or max(flat) > VALID[1]:
        raise ValueError(f"values {min(flat):.3g}..{max(flat):.3g} outside {VALID[0]}..{VALID[1]} W/m2")


def fetch(var, ls, lt, tries=5):
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
    for attempt in range(1, tries + 1):
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
                    check(*b.parse_ascii(txt_tmp))
                except ValueError as e:
                    shutil.copyfile(txt_tmp, os.path.join(b.CACHE, "_last_error.txt"))
                    last_error = f"data file not understood: {e} (saved as mcd_cache/_last_error.txt)"
                else:
                    os.replace(txt_tmp, dest)
                    return dest
        print(f"    attempt {attempt}/{tries} failed: {last_error}")
        if attempt < tries:
            time.sleep(5 * attempt)
    raise RuntimeError(last_error)


def choose_var():
    """Find the MCD name of 'solar flux to surface' (one request, at noon)."""
    if os.path.exists(MEMO):
        return open(MEMO).read().strip()
    for var in CANDIDATES:
        print(f"Trying MCD variable '{var}' (Ls 105, 12h)...")
        try:
            path = fetch(var, 105, 12, tries=2)
        except RuntimeError as e:
            print(f"  not accepted: {e}")
            continue
        lons, lats, grid = b.parse_ascii(path)
        flat = [v for r in grid for v in r]
        print(f"  OK: {len(lons)} x {len(lats)} grid, min {min(flat):.4g}, max {max(flat):.4g} W/m2")
        print("  expected at noon: about 0 near the winter (south) pole, up to about 400-600 W/m2")
        with open(MEMO, "w") as f:
            f.write(var)
        return var
    sys.exit("The MCD refused every name tried "
             f"({', '.join(CANDIDATES)}). Send me mcd_cache/_last_error.html.")


def yearly_mean(var):
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


def build(var):
    if not os.path.exists(b.OUT):
        sys.exit("mars_grid.csv not found. Run build_mars_grid.py first.")
    missing = [1 for ls in b.LS_LIST for lt in LT_LIST if not os.path.exists(cache_name(var, ls, lt))]
    if missing:
        sys.exit(f"{len(missing)} maps are missing from mcd_cache/. Run without --build-only.")
    lons, lats, field = yearly_mean(var)
    vals, wsum, msum = {}, 0.0, 0.0
    lo, hi = (1e30, None), (-1e30, None)
    for lat in range(89, -90, -2):
        for lon in range(-179, 180, 2):
            v = max(atmo.interp(lons, lats, field, lat, lon), 0.0)
            vals[(lat, lon)] = f"{v:.1f}"
            cw = math.cos(math.radians(lat))
            wsum += cw
            msum += cw * v
            if v < lo[0]:
                lo = (v, (lat, lon))
            if v > hi[0]:
                hi = (v, (lat, lon))
    print(f"\n  {COLUMN}: global mean {msum / wsum:.1f}, "
          f"min {lo[0]:.1f} at lat {lo[1][0]}, lon {lo[1][1]}, "
          f"max {hi[0]:.1f} at lat {hi[1][0]}, lon {hi[1][1]}")
    n = atmo.add_columns(b.OUT, {COLUMN: vals})
    print(f"Updated {b.OUT} ({n} rows) with column {COLUMN}")
    print("  expected (rough): global mean about 80-120 W/m2, lowest near the poles,")
    print("            highest in the tropics / southern mid-latitudes")


def main():
    ap = argparse.ArgumentParser(description="Add a solar energy column to mars_grid.csv.")
    ap.add_argument("--test", action="store_true", help="find the MCD variable name with one request")
    ap.add_argument("--build-only", action="store_true", help="skip downloads")
    ap.add_argument("--pause", type=float, default=1.0, help="seconds between requests (default 1)")
    args = ap.parse_args()

    if not args.build_only and not b.CURL:
        sys.exit("curl not found.")
    if args.build_only:
        if not os.path.exists(MEMO):
            sys.exit("Nothing downloaded yet. Run with --test first.")
        build(open(MEMO).read().strip())
        return
    var = choose_var()
    if args.test:
        return
    todo = [(ls, lt) for ls in b.LS_LIST for lt in LT_LIST]
    left = sum(1 for t in todo if not os.path.exists(cache_name(var, *t)))
    print(f"{len(todo)} maps needed, {len(todo) - left} already downloaded, {left} to go.")
    for n, (ls, lt) in enumerate(todo, 1):
        if os.path.exists(cache_name(var, ls, lt)):
            continue
        t0 = time.time()
        try:
            fetch(var, ls, lt)
        except RuntimeError as e:
            sys.exit(f"\nStopped at Ls {ls}, {lt}h: {e}\nRun the same command again to resume.")
        print(f"  [{n:3d}/{len(todo)}] Ls {ls:3d}  {lt:2d}h  ok ({time.time() - t0:.1f} s)", flush=True)
        time.sleep(args.pause)
    build(var)


if __name__ == "__main__":
    main()
