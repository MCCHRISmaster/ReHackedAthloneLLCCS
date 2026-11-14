#!/usr/bin/env python3
"""
Add solar energy at the surface to moon_grid.csv. No download: the Moon has no
atmosphere, so the sunlight reaching the ground follows from geometry alone.

New column
  solar_w_m2   sunlight reaching a flat surface, averaged over a full year and over
               day and night (the lunar day lasts ~29.5 Earth days), W/m2.
               Same unit as earth_grid.csv and mars_grid.csv.

How: solar constant 1361 W/m2 (the Moon is at ~1 AU), lunar spin axis tilted 1.54 deg
to the ecliptic. For each latitude, the standard daily-mean insolation formula
  Q = S/pi * (H0 sin(lat) sin(dec) + cos(lat) cos(dec) sin(H0)),  cos(H0) = -tan(lat) tan(dec)
is averaged over the year (declination swings between -1.54 and +1.54 deg).

Limits (say so in the pitch): smooth sphere, no topography. Near the poles real
values depend on local relief (crater rims lit up to ~90 % of the time, crater floors
in permanent shadow); the LOLA polar illumination maps would capture that.

Usage (from this folder)
  python add_moon_solar.py
"""
import csv
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "moon_grid.csv")
S = 1361.0                 # W/m2
TILT = math.radians(1.54)
COLUMN = "solar_w_m2"


def daily_mean(lat_rad, dec):
    x = -math.tan(lat_rad) * math.tan(dec)
    h0 = math.pi if x <= -1 else 0.0 if x >= 1 else math.acos(x)
    return S / math.pi * (h0 * math.sin(lat_rad) * math.sin(dec)
                          + math.cos(lat_rad) * math.cos(dec) * math.sin(h0))


def yearly_mean(lat_deg, steps=360):
    lat = math.radians(lat_deg)
    tot = 0.0
    for k in range(steps):
        dec = math.asin(math.sin(TILT) * math.sin(2 * math.pi * (k + 0.5) / steps))
        tot += daily_mean(lat, dec)
    return tot / steps


def main():
    with open(OUT, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
        header = list(rows[0].keys())
    if COLUMN not in header:
        header.insert(header.index("source_id"), COLUMN)
    by_lat = {lat: yearly_mean(lat) for lat in range(89, -90, -2)}
    for r in rows:
        r[COLUMN] = f"{by_lat[int(r['lat'])]:.1f}"
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(rows)
    print(f"Updated {OUT} ({len(rows)} rows) with column {COLUMN}")
    for lat in (1, 31, 61, 81, 89):
        print(f"  lat {lat:2d}: {by_lat[lat]:.1f} W/m2")
    print("  expected: about 433 W/m2 at the equator (1361/pi), falling with latitude, ~10-15 at the poles")


if __name__ == "__main__":
    main()
