"""
Surface temperature at one place on Earth, from NASA POWER (2001-2025 climatology).

    python get_point.py --lat 75.38 --lon -89.68
    python get_point.py --lat 75.38 --lon -89.68 --name "Haughton Crater" --save

--lat   latitude in decimal degrees, north positive (-90 to 90)
--lon   longitude in decimal degrees, east positive (-180 to 180)
--name  optional display name
--save  append the result to sites.csv (team template format)

Same definitions as earth_grid.csv:
    mean = TS annual value
    high = mean of the 12 monthly TS_MAX
    low  = mean of the 12 monthly TS_MIN
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
import urllib.parse
import urllib.request

API = "https://power.larc.nasa.gov/api/temporal/climatology/point"
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
          "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
SITES = "sites.csv"
SITES_HEADER = ["site_id", "name", "body", "lat", "lon", "site_type",
                "temp_mean_c", "temp_high_c", "temp_low_c", "elevation_m",
                "notes", "source_id"]
CURL = shutil.which("curl.exe") or shutil.which("curl")


def download(url, tries=5):
    for attempt in range(1, tries + 1):
        try:
            if CURL:
                res = subprocess.run(
                    [CURL, "-sS", "--retry", "3", "--retry-all-errors",
                     "--max-time", "60", url],
                    capture_output=True, text=True, encoding="utf-8")
                if res.returncode == 0 and res.stdout.strip():
                    return json.loads(res.stdout)
                print(f"  try {attempt}/{tries} failed: {res.stderr.strip()[:150]}")
            else:
                with urllib.request.urlopen(url, timeout=60) as r:
                    return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            print(f"  try {attempt}/{tries} failed: {e}")
        time.sleep(3 * attempt)
    sys.exit("Could not reach NASA POWER. Check your connection and try again.")


def ok(v):
    return v is not None and v > -998


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--name", default="")
    ap.add_argument("--save", action="store_true")
    a = ap.parse_args()

    if not (-90 <= a.lat <= 90) or not (-180 <= a.lon <= 180):
        sys.exit("lat must be -90..90 and lon -180..180 (lon: east positive).")

    q = urllib.parse.urlencode({
        "parameters": "TS,TS_MAX,TS_MIN", "community": "RE",
        "latitude": a.lat, "longitude": a.lon, "format": "JSON"})
    data = download(f"{API}?{q}")

    try:
        p = data["properties"]["parameter"]
        elev = data["geometry"]["coordinates"][2]
    except (KeyError, TypeError, IndexError):
        sys.exit(f"Unexpected answer from NASA POWER: {str(data)[:300]}")

    mean = p["TS"].get("ANN")
    highs = [p["TS_MAX"].get(m) for m in MONTHS]
    lows = [p["TS_MIN"].get(m) for m in MONTHS]
    high = sum(highs) / 12 if all(ok(v) for v in highs) else None
    low = sum(lows) / 12 if all(ok(v) for v in lows) else None
    mean = mean if ok(mean) else None
    f = lambda v: "n/a" if v is None else f"{v:.1f} C"

    label = a.name or f"{a.lat}, {a.lon}"
    print(f"\n{label}  (lat {a.lat}, lon {a.lon})")
    print(f"  average surface temperature : {f(mean)}")
    print(f"  typical daily high          : {f(high)}")
    print(f"  typical daily low           : {f(low)}")
    print("  source: NASA POWER climatology 2001-2025 (MERRA-2), ground skin temperature")

    if a.save:
        site_id = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "site"
        new = not os.path.exists(SITES)
        with open(SITES, "a", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            if new:
                w.writerow(SITES_HEADER)
            r1 = lambda v: "" if v is None else f"{v:.1f}"
            w.writerow([site_id, a.name or label, "earth", f"{a.lat:.2f}", f"{a.lon:.2f}",
                        # elevation left empty: POWER's value is the ~50 km model
                        # cell average, not the site's real height
                        "candidate_analog", r1(mean), r1(high), r1(low),
                        "", "", "nasa_power_clim"])
        print(f"  saved to {SITES} as '{site_id}' (site_type = candidate_analog, edit if needed)")


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    main()
