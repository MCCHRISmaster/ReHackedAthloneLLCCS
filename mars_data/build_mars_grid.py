#!/usr/bin/env python3
"""
Build mars_grid.csv (team template format) from the Mars Climate Database (MCD)
web interface: http://www-mars.lmd.jussieu.fr  (LMD / ESA / CNES, no account needed).

What it does
  1. Downloads global maps of SURFACE temperature (variable "tsurf", Kelvin) for
     12 seasons (solar longitude Ls = 15, 45, ... 345, the middle of each Martian
     "month") x 24 local times (0h..23h, same local time everywhere on the planet).
     That is 288 small text files, kept in mcd_cache/ so the script can be
     stopped and restarted at any time.
  2. For every MCD grid point and every season: daily mean, daily max, daily min.
  3. Averages the 12 seasons, weighted by how long each one lasts
     (Mars's orbit is eccentric, so the 12 "months" last 46 to 67 sols).
  4. Interpolates linearly to the 2 deg cell centres, converts K -> deg C,
     writes mars_grid.csv (16,200 rows).

Usage (from this folder)
  python build_mars_grid.py --test         one request only, to check the server answers
  python build_mars_grid.py                download everything, then build the CSV
  python build_mars_grid.py --build-only   rebuild the CSV from mcd_cache/ (no download)

Standard library only (uses curl for downloads).
The MCD web interface is for "moderate use": the script sends one request at a
time with a pause in between. Please do not run several copies at once.
"""
import argparse
import csv
import math
import os
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import urlencode, urljoin

BASE_URL = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "mcd_cache")
OUT = os.path.join(HERE, "mars_grid.csv")
SOURCE_ID = "mcd_v6_2"

LS_LIST = list(range(15, 360, 30))            # middle of the 12 Martian months
# length of each Martian month (30 deg of Ls) in sols; total = 668.6 sols
MONTH_SOLS = [61.2, 65.4, 66.7, 64.5, 59.7, 54.4, 49.7, 46.9, 46.1, 47.4, 50.9, 55.7]
DUST_SCENARIO = 1                              # 1 = climatology, average solar activity
HIGH_RES = 0                                   # 0 = model-resolution surface (right for 2 deg cells)
T_MIN_K, T_MAX_K = 100.0, 350.0                # anything outside is treated as a bad download

HEADER = ["body", "lat", "lon", "temp_mean_c", "temp_high_c", "temp_low_c",
          "elevation_m", "slope_deg", "water_ice_pct", "source_id"]
CURL = shutil.which("curl.exe") or shutil.which("curl")
HREF_TXT = re.compile(r"""href\s*=\s*["']?([^"'\s>]+\.txt)""", re.I)


# ---------------------------------------------------------------- download

def request_url(ls, lt):
    """URL of one global tsurf map at solar longitude ls and local time lt (hours)."""
    params = [
        ("datekeyhtml", 1), ("ls", ls), ("localtime", lt),
        ("year", 2018), ("month", 2), ("day", 3), ("hours", 11), ("minutes", 0), ("seconds", 41),
        ("julian", "2458152.9588078707"), ("martianyear", 34), ("martianmonth", 5), ("sol", 267),
        ("latitude", "all"), ("longitude", "all"), ("altitude", 2), ("zkey", 3),
        ("isfixedlt", "on"), ("dust", DUST_SCENARIO), ("hrkey", HIGH_RES),
        ("zonmean", "off"), ("averaging", "off"),
        ("var1", "tsurf"), ("var2", "none"), ("var3", "none"), ("var4", "none"),
        ("dpi", 80), ("islog", "off"), ("colorm", "jet"), ("minval", ""), ("maxval", ""),
        ("proj", "cyl"), ("plat", ""), ("plon", ""), ("trans", ""), ("iswind", "off"),
        ("latpoint", ""), ("lonpoint", ""),
    ]
    return BASE_URL + "?" + urlencode(params)


def curl_get(url, dest):
    """Download url to dest. Returns True on success."""
    res = subprocess.run([CURL, "-sS", "-L", "--retry", "8", "--retry-delay", "3",
                          "--retry-all-errors", "--connect-timeout", "30",
                          "--max-time", "300", "-o", dest, url])
    return res.returncode == 0 and os.path.exists(dest) and os.path.getsize(dest) > 0


def cache_name(ls, lt):
    return os.path.join(CACHE, f"tsurf_ls{ls:03d}_lt{lt:02d}.txt")


def fetch_map(ls, lt, keep_html=None):
    """Make sure the map for (ls, lt) is in the cache. Returns its path."""
    dest = cache_name(ls, lt)
    if os.path.exists(dest):
        return dest
    os.makedirs(CACHE, exist_ok=True)
    url = request_url(ls, lt)
    html_tmp = os.path.join(CACHE, "_page.tmp")
    txt_tmp = os.path.join(CACHE, "_data.tmp")
    last_error = "unknown error"
    for attempt in range(1, 6):
        if not curl_get(url, html_tmp):
            last_error = "could not reach the MCD server"
        else:
            with open(html_tmp, encoding="utf-8", errors="replace") as f:
                html = f.read()
            if keep_html:
                shutil.copyfile(html_tmp, keep_html)
            m = HREF_TXT.search(html)
            if not m:
                shutil.copyfile(html_tmp, os.path.join(CACHE, "_last_error.html"))
                last_error = ("the server answered, but the page has no link to a data file "
                              "(page saved as mcd_cache/_last_error.html)")
            else:
                txt_url = urljoin(url, m.group(1))
                if not curl_get(txt_url, txt_tmp):
                    last_error = f"could not download the data file {txt_url}"
                else:
                    try:
                        lons, lats, grid = parse_ascii(txt_tmp)
                        check_grid(lons, lats, grid)
                    except ValueError as e:
                        shutil.copyfile(txt_tmp, os.path.join(CACHE, "_last_error.txt"))
                        last_error = f"data file not understood: {e} (saved as mcd_cache/_last_error.txt)"
                    else:
                        os.replace(txt_tmp, dest)
                        return dest
        print(f"    attempt {attempt}/5 failed: {last_error}")
        time.sleep(5 * attempt)
    raise RuntimeError(last_error)


# ---------------------------------------------------------------- parsing

def linspace(a, b, n):
    if n == 1:
        return [float(a)]
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def parse_ascii(path):
    """
    Read one MCD web-interface text file. Layout:
        ### Column 1 is East longitude (degrees)
        ### Columns 2+ are Surface temperature (K)
        ### Line 1 is North latitude (degrees)
        ---- ||   <y values ...>
        -----------------------
        -180 ||   <values ...>
    Returns (lons, lats, grid) with grid[i_lon][i_lat] in Kelvin, both axes ascending.
    """
    xlabel = ylabel = ""
    ycoord, xcoord, rows = None, [], []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.startswith("#"):
                low = line.lower()
                if "column 1 is" in low:
                    xlabel = low.split("column 1 is", 1)[1]
                elif "line 1 is" in low:
                    ylabel = low.split("line 1 is", 1)[1]
                continue
            if "||" not in line:
                continue                      # separator line
            left, right = line.split("||", 1)
            try:
                vals = [float(v) for v in right.split()]
            except ValueError:
                raise ValueError(f"non-numeric line: {line[:60]}")
            if left.strip().startswith("--"):
                ycoord = vals
            else:
                xcoord.append(float(left))
                rows.append(vals)
    if ycoord is None or not rows:
        raise ValueError("no data table found")
    if any(len(r) != len(ycoord) for r in rows):
        raise ValueError("rows have different lengths")

    # which axis is longitude?
    if "lon" in xlabel or "lat" in ylabel:
        x_is_lon = True
    elif "lat" in xlabel or "lon" in ylabel:
        x_is_lon = False
    else:
        x_is_lon = max(abs(v) for v in ycoord) <= 90.0 < max(abs(v) for v in xcoord)

    # row labels are written as whole numbers (truncated), so rebuild the real spacing
    n = len(xcoord)
    steps = [xcoord[i + 1] - xcoord[i] for i in range(n - 1)]
    if steps and max(steps) - min(steps) > 1e-3:
        xcoord = linspace(round(xcoord[0]), round(xcoord[-1]), n)

    if x_is_lon:
        lons, lats, grid = xcoord, ycoord, rows
    else:
        lons, lats = ycoord, xcoord
        grid = [[rows[j][i] for j in range(len(xcoord))] for i in range(len(ycoord))]
    if lons[0] > lons[-1]:
        lons, grid = lons[::-1], grid[::-1]
    if lats[0] > lats[-1]:
        lats, grid = lats[::-1], [r[::-1] for r in grid]
    return lons, lats, grid


def check_grid(lons, lats, grid):
    if len(lons) < 10 or len(lats) < 10:
        raise ValueError(f"grid too small ({len(lons)} x {len(lats)}), expected a global map")
    if lons[0] > -170 or lons[-1] < 170 or lats[0] > -80 or lats[-1] < 80:
        raise ValueError(f"not a global map: lon {lons[0]}..{lons[-1]}, lat {lats[0]}..{lats[-1]}")
    flat = [v for r in grid for v in r]
    if min(flat) < T_MIN_K or max(flat) > T_MAX_K:
        raise ValueError(f"values {min(flat):.1f}..{max(flat):.1f} are not surface temperatures in K")


# ---------------------------------------------------------------- build

def bracket(axis, v):
    """Index i and weight t so that value = (1-t)*f[i] + t*f[i+1] (clamped at the ends)."""
    if v <= axis[0]:
        return 0, 0.0
    if v >= axis[-1]:
        return len(axis) - 2, 1.0
    lo, hi = 0, len(axis) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if axis[mid] <= v:
            lo = mid
        else:
            hi = mid
    return lo, (v - axis[lo]) / (axis[lo + 1] - axis[lo])


def build(lt_list):
    missing = [(ls, lt) for ls in LS_LIST for lt in lt_list if not os.path.exists(cache_name(ls, lt))]
    if missing:
        sys.exit(f"{len(missing)} of {len(LS_LIST) * len(lt_list)} maps are missing from mcd_cache/. "
                 "Run the script without --build-only to download them.")

    lons = lats = None
    total_w = sum(MONTH_SOLS)
    mean = high = low = None
    for ls, w in zip(LS_LIST, MONTH_SOLS):
        s = mx = mn = None
        for lt in lt_list:
            lo, la, g = parse_ascii(cache_name(ls, lt))
            if lons is None:
                lons, lats = lo, la
                nx, ny = len(lons), len(lats)
                mean = [[0.0] * ny for _ in range(nx)]
                high = [[0.0] * ny for _ in range(nx)]
                low = [[0.0] * ny for _ in range(nx)]
            elif len(lo) != nx or len(la) != ny:
                sys.exit(f"grid size changed in {cache_name(ls, lt)}; delete mcd_cache/ and download again.")
            if s is None:
                s = [r[:] for r in g]
                mx = [r[:] for r in g]
                mn = [r[:] for r in g]
            else:
                for i in range(nx):
                    gi, si, xi, ni = g[i], s[i], mx[i], mn[i]
                    for j in range(ny):
                        v = gi[j]
                        si[j] += v
                        if v > xi[j]:
                            xi[j] = v
                        if v < ni[j]:
                            ni[j] = v
        k = w / total_w
        for i in range(nx):
            for j in range(ny):
                mean[i][j] += k * s[i][j] / len(lt_list)
                high[i][j] += k * mx[i][j]
                low[i][j] += k * mn[i][j]

    def interp(field, lat, lon):
        i, tx = bracket(lons, lon)
        j, ty = bracket(lats, lat)
        return ((1 - tx) * (1 - ty) * field[i][j] + tx * (1 - ty) * field[i + 1][j]
                + (1 - tx) * ty * field[i][j + 1] + tx * ty * field[i + 1][j + 1])

    rows, bad = [], 0
    wsum = msum = 0.0
    hottest = (-1e9, None)
    coldest = (1e9, None)
    for lat in range(89, -90, -2):
        for lon in range(-179, 180, 2):
            m = round(interp(mean, lat, lon) - 273.15, 1)
            h = round(interp(high, lat, lon) - 273.15, 1)
            l = round(interp(low, lat, lon) - 273.15, 1)
            if not (l <= m <= h):
                bad += 1
            cw = math.cos(math.radians(lat))
            wsum += cw
            msum += cw * m
            if h > hottest[0]:
                hottest = (h, (lat, lon))
            if l < coldest[0]:
                coldest = (l, (lat, lon))
            rows.append(["mars", lat, lon, m, h, l, "", "", "", SOURCE_ID])

    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)

    print(f"\nWrote {OUT}")
    print(f"  rows: {len(rows)} (expected 16200)")
    print(f"  MCD grid used: {len(lons)} lon x {len(lats)} lat points, {len(LS_LIST)} seasons x {len(lt_list)} local times")
    print(f"  area-weighted global mean: {msum / wsum:.1f} C   (expected roughly -60 to -70 C)")
    print(f"  warmest daily high: {hottest[0]} C at lat {hottest[1][0]}, lon {hottest[1][1]}   (expected roughly -5 to +15 C)")
    print(f"  coldest daily low:  {coldest[0]} C at lat {coldest[1][0]}, lon {coldest[1][1]}   (expected roughly -125 to -135 C)")
    print(f"  cells where low <= mean <= high fails: {bad} (expected 0)")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Build mars_grid.csv from the Mars Climate Database web interface.")
    ap.add_argument("--test", action="store_true", help="send one request and show what comes back")
    ap.add_argument("--build-only", action="store_true", help="skip downloads, build the CSV from mcd_cache/")
    ap.add_argument("--lt-step", type=int, default=1, choices=[1, 2, 3],
                    help="hours between local times (default 1 = 24 maps per season)")
    ap.add_argument("--pause", type=float, default=1.0, help="seconds to wait between requests (default 1)")
    args = ap.parse_args()
    lt_list = list(range(0, 24, args.lt_step))

    if not args.build_only and not CURL:
        sys.exit("curl not found. On Windows 10/11 it is built in; otherwise install it.")

    if args.test:
        os.makedirs(CACHE, exist_ok=True)
        ls, lt = 105, 14
        print("Request:\n  " + request_url(ls, lt))
        page = os.path.join(CACHE, "_test_response.html")
        try:
            path = fetch_map(ls, lt, keep_html=page)
        except RuntimeError as e:
            sys.exit(f"TEST FAILED: {e}\nThe page the server sent (if any) is in {page}")
        lons, lats, grid = parse_ascii(path)
        flat = [v for r in grid for v in r]
        i, _ = bracket(lons, 0.0)
        j, _ = bracket(lats, 0.0)
        print(f"TEST OK. Saved {path}")
        print(f"  grid: {len(lons)} lon ({lons[0]:.2f}..{lons[-1]:.2f}) x {len(lats)} lat ({lats[0]:.2f}..{lats[-1]:.2f})")
        print(f"  surface temperature at Ls {ls}, 14h local time: min {min(flat):.1f} K, max {max(flat):.1f} K")
        print(f"  near the equator at lon 0: {grid[i][j]:.1f} K   (expected roughly 250 to 290 K)")
        return

    if not args.build_only:
        todo = [(ls, lt) for ls in LS_LIST for lt in lt_list]
        left = sum(1 for ls, lt in todo if not os.path.exists(cache_name(ls, lt)))
        print(f"{len(todo)} maps needed, {len(todo) - left} already downloaded, {left} to go.")
        for n, (ls, lt) in enumerate(todo, 1):
            if os.path.exists(cache_name(ls, lt)):
                continue
            t0 = time.time()
            try:
                fetch_map(ls, lt)
            except RuntimeError as e:
                sys.exit(f"\nStopped at Ls {ls}, {lt}h: {e}\nRun the same command again to resume.")
            print(f"  [{n:3d}/{len(todo)}] Ls {ls:3d}  {lt:2d}h  ok ({time.time() - t0:.1f} s)", flush=True)
            time.sleep(args.pause)
        for tmp in ("_page.tmp", "_data.tmp"):
            p = os.path.join(CACHE, tmp)
            if os.path.exists(p):
                try:
                    os.remove(p)
                except OSError:
                    pass

    build(lt_list)


if __name__ == "__main__":
    main()
