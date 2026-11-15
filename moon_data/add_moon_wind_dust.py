#!/usr/bin/env python3
"""
Add wind_ms and aerosol_tau to moon_grid.csv: both 0 everywhere, because the Moon
has no atmosphere (no wind; dust is only lofted briefly near the terminator by
electrostatic effects, far too little to dim sunlight). Same columns as the Earth
and Mars grids, so the app can compare all three.

Usage (from this folder)
  python add_moon_wind_dust.py
"""
import csv
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "moon_grid.csv")
NEW = {"wind_ms": "0", "aerosol_tau": "0"}

with open(OUT, newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
    header = list(rows[0].keys())
for col in NEW:
    if col not in header:
        header.insert(header.index("source_id"), col)
for r in rows:
    r.update(NEW)
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=header)
    w.writeheader()
    w.writerows(rows)
print(f"Updated {OUT} ({len(rows)} rows): wind_ms = 0, aerosol_tau = 0")
