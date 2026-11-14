#!/usr/bin/env python3
"""
Add the pressure_pa and water_vapour_mm columns to moon_grid.csv, so the three
grids have the same columns.

The Moon has no real atmosphere: surface pressure is about 0.0000000003 Pa
(3e-10 Pa, Apollo LACE and LADEE measurements) and there is no water vapour column.
Both are written as 0 in every cell. Nothing is downloaded.

Usage (from this folder):  python add_moon_atmo.py
"""
import csv
import os
import sys

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "moon_grid.csv")
NEW = {"pressure_pa": "0.0", "water_vapour_mm": "0"}

if not os.path.exists(PATH):
    sys.exit("moon_grid.csv not found. Run build_moon_grid.py first.")
with open(PATH, newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
    header = list(rows[0].keys())
for name in NEW:
    if name not in header:
        header.insert(header.index("source_id"), name)
for r in rows:
    r.update(NEW)
with open(PATH, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=header)
    w.writeheader()
    w.writerows(rows)
print(f"Updated {PATH}: {len(rows)} rows, columns {', '.join(NEW)} set to 0.")
