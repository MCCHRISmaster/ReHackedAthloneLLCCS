"""Loads every table the scorer needs into numpy column dictionaries.

Used by 50_score.py, 60_export.py and 70_validate.py so they all see identical inputs.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from grid import G1, G2, haversine_km, proximity_index, read_grid_csv  # noqa: E402

ROOT = HERE.parent
REPO = ROOT.parent
OUT = ROOT / "out"


def read_rows(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def table(path: Path, grid) -> dict:
    d = read_grid_csv(path, grid)
    d["lat"] = grid.lat_grid()
    d["lon"] = grid.lon_grid()
    d["n"] = grid.n
    return d


def load_all() -> dict:
    # ---- Earth 1 degree: features, then temperatures from the POWER pull if the CSV has none yet
    earth = table(OUT / "earth_features_1deg.csv", G1)
    if "temp_mean_c" not in earth:
        p = ROOT / "work" / "power_temp_1deg.npz"
        if p.exists():
            z = np.load(p)
            for k in z.files:
                earth[k] = z[k]
    earth["land"] = np.nan_to_num(earth["land_pct"], nan=0) >= 25
    # ---- Moon and Mars: features plus the team's temperature grids, unchanged
    moon = table(OUT / "moon_features.csv", G2)
    mars = table(OUT / "mars_features.csv", G2)
    for body, tbl, path in (("moon", moon, REPO / "moon_data" / "moon_grid.csv"), ("mars", mars, REPO / "mars_data" / "mars_grid.csv")):
        t = read_grid_csv(path, G2)
        for k in ("temp_mean_c", "temp_high_c", "temp_low_c"):
            tbl[k] = t[k]
    ranges = {b: {"crater_density_5km_n": float(np.nanpercentile(t["crater_density_5km_n"], 99))}
              for b, t in (("moon", moon), ("mars", mars)) if "crater_density_5km_n" in t}
    # ---- named places
    sites = read_rows(OUT / "analog_sites.csv") + read_rows(OUT / "irish_sites.csv")
    targets = read_rows(OUT / "targets.csv")
    return {"earth": earth, "moon": moon, "mars": mars, "ranges": ranges, "sites": sites, "targets": targets}


def cols_at(tbl: dict, idx: np.ndarray) -> dict:
    """Column dictionary restricted to the given cell indexes (numeric columns only)."""
    return {k: v[idx] for k, v in tbl.items() if isinstance(v, np.ndarray) and v.shape == (tbl["n"],) and v.dtype.kind == "f"}


def site_columns(data: dict) -> tuple[dict, np.ndarray, dict]:
    """Feature columns for every named Earth site, one value per site: (columns, 1-degree cell index per site, borrowed).

    - normal sites read their own 1-degree cell;
    - sites in cells with 1 to 25 percent land (islands) read work/earth_features_all.npz;
    - a site with no data of its own borrows the nearest land cell within 250 km (listed in `borrowed`);
    - sites with lith_override = basic_volcanic (tiny basalt islands with no GLiM class) get basaltic lithology set explicitly;
    - extremophile_idx is 1 for sites flagged acidic, hypersaline, hydrothermal or hyperarid in the curated table.
    """
    earth, sites = data["earth"], data["sites"]
    L = np.where(earth["land"])[0]
    lat = np.array([float(s["lat"]) for s in sites]); lon = np.array([float(s["lon"]) for s in sites])
    sidx = G1.index(lat, lon)
    p = ROOT / "work" / "earth_features_all.npz"
    allcols = dict(np.load(p)) if p.exists() else {}
    has_own = lambda g: bool(allcols) and not np.isnan(allcols["elev_mean_m"][g])
    borrowed = {}
    for i in range(len(sites)):
        if not earth["land"][sidx[i]] and not has_own(sidx[i]):
            d = haversine_km(lat[i], lon[i], earth["lat"][L], earth["lon"][L])
            k = int(np.argmin(d))
            if d[k] <= 250:
                borrowed[i] = (int(L[k]), int(round(float(d[k]))))
                sidx[i] = L[k]
    cols = cols_at(earth, sidx)
    for i in range(len(sites)):
        g = int(sidx[i])
        if not earth["land"][g] and has_own(g):
            for k in cols:
                if k in allcols:
                    cols[k][i] = allcols[k][g]
    caves = [r for r in read_rows(OUT / "caves.csv") if r["cave_type"] == "lava_tube"]
    for i, s in enumerate(sites):
        if s.get("lith_override") == "basic_volcanic":
            for k in ("lith_carbonate_pct", "lith_evaporite_pct", "lith_unconsolidated_pct", "lith_siliciclastic_pct",
                      "lith_plutonic_pct", "lith_metamorphic_pct", "lith_ice_pct", "karst_idx"):
                cols[k][i] = 0.0
            cols["lith_volcanic_pct"][i] = cols["lith_basic_volcanic_pct"][i] = 100.0
            tube_km = min(float(haversine_km(lat[i], lon[i], float(c["lat"]), float(c["lon"]))) for c in caves)
            near = min(cols["volcano_nearest_km"][i], tube_km)
            cols["lavatube_idx"][i] = float(proximity_index(np.array([near]), 50, 300)[0])
    cols["extremophile_idx"] = np.array([1.0 if s.get("flags") else np.nan for s in sites])
    return cols, sidx, borrowed
