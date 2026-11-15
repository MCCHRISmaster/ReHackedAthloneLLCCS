#!/usr/bin/env python3
"""
Add wind speed and dust optical depth to mars_grid.csv, from the Mars Climate
Database (MCD 6.2) web interface. Needs build_mars_grid.py, build_mars_atmo.py
and build_mars_solar.py in the same folder and an existing mars_grid.csv.

Do not run it at the same time as another build_mars_*.py script (same server,
same temporary files).

New columns
  wind_ms       wind speed 2 m above the ground, yearly average, m/s
                (MCD "u" = west-east and "v" = south-north wind, speed = sqrt(u2 + v2)).
                Same height as the Earth column (POWER WS2M).
  aerosol_tau   dust optical depth (visible light): how much the dust dims sunlight.
                No unit; same meaning as the Earth column.     (MCD "dod", visible dust column optical depth)

How
  wind: 12 seasons x 8 local times (every 3 h) x 2 components = 192 maps.
        Speed is computed for each map, then averaged (seasons weighted by length).
        Note: the MCD gives the AVERAGE wind for each season and hour, so day-to-day
        gusts cancel out; real average speeds are somewhat higher.
  dust (dod): 12 seasons x 2 local times (0 h, 12 h) = 24 maps; dust barely changes within a day.
  Then bilinear interpolation to the 2 deg cell centres.

Usage (from this folder)
  python build_mars_wind_dust.py --test         one request per variable, to check the server
  python build_mars_wind_dust.py                download everything, then update mars_grid.csv
  python build_mars_wind_dust.py --build-only   update mars_grid.csv from mcd_cache/ only
"""
import argparse
import math
import os
import sys
import time

import build_mars_grid as b
import build_mars_atmo as atmo
import build_mars_solar as sol

WIND_LT = list(range(0, 24, 3))
DUST_LT = [0, 12]
VALID = {"u": (-150.0, 150.0), "v": (-150.0, 150.0), "dod": (0.0, 15.0)}


def cache_name(var, ls, lt):
    return os.path.join(b.CACHE, f"{var}_ls{ls:03d}_lt{lt:02d}.txt")


def jobs():
    out = []
    for ls in b.LS_LIST:
        for lt in WIND_LT:
            out += [("u", ls, lt), ("v", ls, lt)]
        for lt in DUST_LT:
            out.append(("dod", ls, lt))
    return out


def fetch(var, ls, lt, tries=5):
    """Same downloader as build_mars_solar.py, with this variable's valid range."""
    sol.VALID = VALID[var]
    sol_name = sol.cache_name
    sol.cache_name = cache_name
    try:
        return sol.fetch(var, ls, lt, tries=tries)
    finally:
        sol.cache_name = sol_name


def season_mean(fn, lts):
    """fn(ls, lt) -> (lons, lats, grid). Season-weighted mean over all ls and the given lts."""
    lons = lats = field = None
    total = sum(b.MONTH_SOLS)
    for ls, w in zip(b.LS_LIST, b.MONTH_SOLS):
        for lt in lts:
            lo, la, g = fn(ls, lt)
            if field is None:
                lons, lats = lo, la
                field = [[0.0] * len(la) for _ in lo]
            k = w / total / len(lts)
            for i in range(len(lons)):
                fi, gi = field[i], g[i]
                for j in range(len(lats)):
                    fi[j] += k * gi[j]
    return lons, lats, field


def speed_map(ls, lt):
    lo, la, u = b.parse_ascii(cache_name("u", ls, lt))
    lo2, la2, v = b.parse_ascii(cache_name("v", ls, lt))
    if len(lo) != len(lo2) or len(la) != len(la2):
        sys.exit(f"u and v maps have different grids at Ls {ls}, {lt}h. Delete both and run again.")
    return lo, la, [[math.hypot(u[i][j], v[i][j]) for j in range(len(la))] for i in range(len(lo))]


def tau_map(ls, lt):
    return b.parse_ascii(cache_name("dod", ls, lt))


def build():
    if not os.path.exists(b.OUT):
        sys.exit("mars_grid.csv not found. Run build_mars_grid.py first.")
    missing = [j for j in jobs() if not os.path.exists(cache_name(*j))]
    if missing:
        sys.exit(f"{len(missing)} maps are missing from mcd_cache/. Run without --build-only.")
    columns = {}
    print()
    for col, fn, lts, dec in (("wind_ms", speed_map, WIND_LT, 2), ("aerosol_tau", tau_map, DUST_LT, 3)):
        lons, lats, field = season_mean(fn, lts)
        vals, wsum, msum = {}, 0.0, 0.0
        lo, hi = (1e30, None), (-1e30, None)
        for lat in range(89, -90, -2):
            for lon in range(-179, 180, 2):
                v = max(atmo.interp(lons, lats, field, lat, lon), 0.0)
                vals[(lat, lon)] = f"{v:.{dec}f}"
                cw = math.cos(math.radians(lat))
                wsum += cw
                msum += cw * v
                if v < lo[0]:
                    lo = (v, (lat, lon))
                if v > hi[0]:
                    hi = (v, (lat, lon))
        columns[col] = vals
        print(f"  {col}: global mean {msum / wsum:.3g}, "
              f"min {lo[0]:.3g} at lat {lo[1][0]}, lon {lo[1][1]}, "
              f"max {hi[0]:.3g} at lat {hi[1][0]}, lon {hi[1][1]}")
    n = atmo.add_columns(b.OUT, columns)
    print(f"Updated {b.OUT} ({n} rows) with columns: {', '.join(columns)}")
    print("  expected (rough): wind a few m/s (stronger on slopes of big volcanoes and near the polar caps),")
    print("            aerosol_tau about 0.2-1 (highest in the south / dusty season, lower on high volcanoes)")


def main():
    ap = argparse.ArgumentParser(description="Add wind speed and dust optical depth to mars_grid.csv.")
    ap.add_argument("--test", action="store_true", help="one request per variable, show what comes back")
    ap.add_argument("--build-only", action="store_true", help="skip downloads")
    ap.add_argument("--pause", type=float, default=1.0, help="seconds between requests (default 1)")
    args = ap.parse_args()

    if not args.build_only and not b.CURL:
        sys.exit("curl not found.")
    if args.test:
        for var in ("u", "v", "dod"):
            try:
                path = fetch(var, 105, 12, tries=2)
            except RuntimeError as err:
                sys.exit(f"TEST FAILED for {var}: {err}\nSend me mcd_cache/_last_error.html (or .txt).")
            lons, lats, grid = b.parse_ascii(path)
            flat = [x for r in grid for x in r]
            print(f"TEST OK {var}: {len(lons)} x {len(lats)} grid, min {min(flat):.4g}, max {max(flat):.4g}")
        print("Expected: u and v roughly -20..+20 m/s near the surface, dod roughly 0.1..2.")
        return
    if not args.build_only:
        todo = jobs()
        left = sum(1 for j in todo if not os.path.exists(cache_name(*j)))
        print(f"{len(todo)} maps needed, {len(todo) - left} already downloaded, {left} to go.")
        for n, (var, ls, lt) in enumerate(todo, 1):
            if os.path.exists(cache_name(var, ls, lt)):
                continue
            t0 = time.time()
            try:
                fetch(var, ls, lt)
            except RuntimeError as err:
                sys.exit(f"\nStopped at {var} Ls {ls}, {lt}h: {err}\nRun the same command again to resume.")
            print(f"  [{n:3d}/{len(todo)}] {var:3s} Ls {ls:3d}  {lt:2d}h  ok ({time.time() - t0:.1f} s)", flush=True)
            time.sleep(args.pause)
    build()


if __name__ == "__main__":
    main()
