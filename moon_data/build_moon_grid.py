"""
Build moon_grid.csv (team template format) from LRO Diviner measurements.

    python build_moon_grid.py                # download + process, keep raw files
    python build_moon_grid.py --delete-raw   # delete each 156 MB raw file once processed
    python build_moon_grid.py --build-only   # only rebuild the CSV from processed bands

Data: Diviner Global Cumulative Product (GCP), Williams et al. 2017, Icarus 283.
All Diviner nadir observations from July 2009 to April 2015, binned at 0.5 deg
and 0.25 h of lunar local time. 18 files (10 deg latitude bands), ~156 MB each.
Column used: tbol (bolometric brightness temperature, K). Missing = -9999.

Method, per 2 x 2 deg cell:
  1. average tbol of the 16 small 0.5 deg bins inside the cell, separately for
     each of the 96 local-time slots -> one temperature curve over a lunar day
  2. fill missing time slots by linear interpolation around the day
  3. mean = average of the curve, high = its maximum, low = its minimum
  4. K -> C, round to 1 decimal

Progress is saved per band in moon_bands/, so the script can be stopped and
restarted at any time. Standard library only (uses curl for downloads).
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import time

BANDS = [(lat, lat + 10) for lat in range(-90, 90, 10)]
URL_BASES = [
    "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/",
    "https://pds-geosciences.wustl.edu/lro/lro-l-dlre-4-rdr-v1/lrodlr_1001/data/gcp/",
]
RAW = "moon_raw"
BANDS_DIR = "moon_bands"
OUT = "moon_grid.csv"
SOURCE_ID = "diviner_gcp_2017"
MISSING = -9999
N_LT = 96                       # 0.25 h local-time slots per lunar day
MIN_SLOTS = 24                  # need data for >= 1/4 of the day, else leave cell empty
HEADER = ["body", "lat", "lon", "temp_mean_c", "temp_high_c", "temp_low_c",
          "elevation_m", "slope_deg", "water_ice_pct", "source_id"]
CURL = shutil.which("curl.exe") or shutil.which("curl")
NUM = re.compile(r"[-+]?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?")


def band_name(lat0, lat1):
    tag = lambda v: f"{abs(v):02d}{'N' if v >= 0 else 'S'}"
    return f"GLOBAL_CUMUL_AVG_CYL_{tag(lat0)}{tag(lat1)}_002"


# ---------------------------------------------------------------- download

def download(name):
    """Download <name>.TAB into moon_raw/, resuming if interrupted."""
    os.makedirs(RAW, exist_ok=True)
    dest = os.path.join(RAW, name + ".TAB")
    done_flag = dest + ".complete"
    if os.path.exists(done_flag):
        return dest
    if not CURL:
        sys.exit("curl not found. On Windows 10/11 it is built in; otherwise install it.")
    # the 0 deg edge may be written 00N or 00S depending on the band: try both
    names = [name]
    for a, b in (("00N", "00S"), ("00S", "00N")):
        if a in name:
            names.append(name.replace(a, b))
    candidates = [base + fn for base in URL_BASES for n in names
                  for fn in (n + ".TAB", n.lower() + ".tab")]
    for attempt in range(1, 6):
        for url in candidates:
            # check the URL exists before downloading
            head = subprocess.run([CURL, "-sS", "-L", "-r", "0-0", "-o", os.devnull,
                                   "-w", "%{http_code}", "--max-time", "60", url],
                                  capture_output=True, text=True)
            if head.stdout.strip()[-3:] not in ("200", "206"):
                continue
            print(f"  downloading {url}")
            res = subprocess.run([CURL, "-L", "-C", "-", "--retry", "10",
                                  "--retry-all-errors", "--retry-delay", "5",
                                  "-o", dest, "--progress-bar", url])
            if res.returncode == 0 and os.path.getsize(dest) > 1_000_000:
                open(done_flag, "w").close()
                return dest
            print(f"  download interrupted (curl code {res.returncode}), resuming...")
            break
        else:
            print(f"  could not find {name} on the server (try {attempt}/5)")
        time.sleep(10 * attempt)
    sys.exit(f"Giving up on {name}. Check your connection and run the script again: "
             "it resumes where it stopped.")


# ---------------------------------------------------------------- process

def process_band(lat0, lat1, path):
    """Reduce one raw band file to per-cell daily curves -> mean/high/low (K)."""
    rows = list(range(int((90 - lat1) // 2), int((90 - lat0) // 2)))   # 5 cell rows
    sums = {(i, j): [0.0] * N_LT for i in rows for j in range(180)}
    cnts = {(i, j): [0] * N_LT for i in rows for j in range(180)}
    n_lines = n_used = 0
    with open(path, encoding="ascii", errors="replace") as f:
        for line in f:
            vals = NUM.findall(line)
            if len(vals) < 11:
                continue                      # header or blank line
            n_lines += 1
            lon, lat, ltim, tbol = float(vals[0]), float(vals[1]), float(vals[2]), float(vals[10])
            if tbol <= MISSING + 1 or tbol <= 0:
                continue
            i = min(max(int((90 - lat) // 2), 0), 89)
            lon = ((lon + 180) % 360) - 180
            j = min(int((lon + 180) // 2), 179)
            k = min(max(int(ltim * 4), 0), N_LT - 1)
            if (i, j) not in sums:
                continue
            sums[(i, j)][k] += tbol
            cnts[(i, j)][k] += 1
            n_used += 1

    result = {}
    for key in sums:
        curve = [s / c if c else None for s, c in zip(sums[key], cnts[key])]
        have = [k for k, v in enumerate(curve) if v is not None]
        if len(have) < MIN_SLOTS:
            result[f"{key[0]},{key[1]}"] = None
            continue
        filled = fill_circular(curve, have)
        result[f"{key[0]},{key[1]}"] = [sum(filled) / N_LT, max(filled), min(filled)]
    print(f"  {n_lines:,} lines read, {n_used:,} valid measurements used")
    return result


def fill_circular(curve, have):
    """Linear interpolation of missing slots, wrapping around the lunar day."""
    out = list(curve)
    for idx, k in enumerate(have):
        nxt = have[(idx + 1) % len(have)]
        gap = (nxt - k) % N_LT or N_LT
        for step in range(1, gap):
            w = step / gap
            out[(k + step) % N_LT] = (1 - w) * curve[k] + w * curve[nxt]
    return out


# ---------------------------------------------------------------- build

def build():
    cells = {}
    done = 0
    for lat0, lat1 in BANDS:
        p = os.path.join(BANDS_DIR, band_name(lat0, lat1) + ".json")
        if os.path.exists(p):
            done += 1
            with open(p) as f:
                cells.update(json.load(f))
    fmt = lambda k: f"{k - 273.15:.1f}"
    rows, filled, bad = [], 0, 0
    for i in range(90):
        for j in range(180):
            v = cells.get(f"{i},{j}")
            if v:
                filled += 1
                mean, high, low = v
                if not (low <= mean <= high):
                    bad += 1
                rows.append(["moon", 89 - 2 * i, -179 + 2 * j, fmt(mean), fmt(high), fmt(low),
                             "", "", "", SOURCE_ID])
            else:
                rows.append(["moon", 89 - 2 * i, -179 + 2 * j, "", "", "", "", "", "", SOURCE_ID])
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(HEADER)
        w.writerows(rows)
    print(f"\nWrote {OUT}: {len(rows)} rows, {filled} complete cells, "
          f"{done}/18 latitude bands processed.")
    if bad:
        print(f"WARNING: {bad} cells where low <= mean <= high is not true")
    eq = [r for r in rows if r[1] in (1, -1) and r[3]]
    if eq:
        hi = sum(float(r[4]) for r in eq) / len(eq)
        lo = sum(float(r[5]) for r in eq) / len(eq)
        print(f"Check: equator average high {hi:.0f} C ({hi + 273.15:.0f} K), "
              f"low {lo:.0f} C ({lo + 273.15:.0f} K). "
              "Published: ~387-397 K at noon, ~95 K before sunrise.")


# ---------------------------------------------------------------- main

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delete-raw", action="store_true",
                    help="delete each raw file once processed (saves ~2.8 GB)")
    ap.add_argument("--build-only", action="store_true",
                    help="only rebuild moon_grid.csv from processed bands")
    a = ap.parse_args()
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(BANDS_DIR, exist_ok=True)

    if not a.build_only:
        try:
            for n, (lat0, lat1) in enumerate(BANDS, 1):
                name = band_name(lat0, lat1)
                out = os.path.join(BANDS_DIR, name + ".json")
                if os.path.exists(out):
                    continue
                print(f"\n[{n}/18] latitude {lat0} to {lat1}")
                path = download(name)
                print("  processing...")
                with open(out + ".tmp", "w") as f:
                    json.dump(process_band(lat0, lat1, path), f)
                os.replace(out + ".tmp", out)
                if a.delete_raw:
                    os.remove(path)
                    os.remove(path + ".complete")
        except KeyboardInterrupt:
            print("\nStopped. Progress is saved; run again to continue.")
    build()
