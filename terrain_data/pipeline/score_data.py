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


def merge_soil(tbl: dict, path: Path, grid) -> None:
    """Add the soil grid's columns (35_soil_features.py) to a feature table. Missing file = no soil comparisons."""
    if not path.exists():
        return
    soil = tbl.setdefault("_soil_cols", set())
    for k, v in read_grid_csv(path, grid).items():
        if k not in tbl and k not in ("body", "source_id", "_grid"):
            tbl[k] = v
            soil.add(k)


def previous_island_values(earth: dict, sites: list[dict], sidx: np.ndarray) -> dict:
    """Stand-in for work/earth_features_all.npz (an uncommitted cache) on a machine without it.

    For island sites (own cell under 25 percent land), reuse the per-site feature values that the last full
    build exported to out/sites.json, which ARE those cells' own values. Without this, a rescore on a fresh
    clone silently moves Timanfaya, Teide, Vulcano and friends to a mainland cell up to 250 km away.
    Soil columns are left to the soil grids. Returns {site id: {column: value}}.
    """
    p = OUT / "sites.json"
    if not p.exists():
        return {}
    prev = {s["id"]: s for s in json.loads(p.read_text(encoding="utf-8"))}
    out = {}
    for i, s in enumerate(sites):
        e = prev.get(s["id"])
        if (e and not earth["land"][sidx[i]] and e.get("metrics", {}).get("elev_mean_m")
                and not (e.get("data_cell") or {}).get("borrowed_km")):
            out[s["id"]] = {k: m["value"] for k, m in e["metrics"].items()}
    return out


def load_all() -> dict:
    # ---- Earth 1 degree: features, then temperatures from the POWER pull if the CSV has none yet
    earth = table(OUT / "earth_features_1deg.csv", G1)
    merge_soil(earth, OUT / "earth_soil_1deg.csv", G1)
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
    merge_soil(moon, OUT / "moon_soil.csv", G2)
    merge_soil(mars, OUT / "mars_soil.csv", G2)
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
    prev = {} if allcols else previous_island_values(earth, sites, sidx)
    borrowed = {}
    for i in range(len(sites)):
        if not earth["land"][sidx[i]] and not has_own(sidx[i]) and sites[i]["id"] not in prev:
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
        elif not earth["land"][g] and sites[i]["id"] in prev:
            pv = prev[sites[i]["id"]]
            for k in cols:
                if k not in earth.get("_soil_cols", ()):
                    cols[k][i] = pv.get(k, np.nan)
    caves = [r for r in read_rows(OUT / "caves.csv") if r["cave_type"] == "lava_tube"]
    for i, s in enumerate(sites):
        if s.get("lith_override") == "basic_volcanic":
            for k in ("lith_carbonate_pct", "lith_evaporite_pct", "lith_unconsolidated_pct", "lith_siliciclastic_pct",
                      "lith_plutonic_pct", "lith_metamorphic_pct", "lith_ice_pct", "karst_idx"):
                cols[k][i] = 0.0
            cols["lith_volcanic_pct"][i] = cols["lith_basic_volcanic_pct"][i] = 100.0
            # element estimate follows the rock type: basalt row of ROCK_CHEM in 35_soil_features.py
            for k, v in (("fe_pct", 8.65), ("si_pct", 23.0), ("k_pct", 0.83), ("th_ppm", 4.0)):
                if k in cols:
                    cols[k][i] = v
            tube_km = min(float(haversine_km(lat[i], lon[i], float(c["lat"]), float(c["lon"]))) for c in caves)
            near = min(cols["volcano_nearest_km"][i], tube_km)
            cols["lavatube_idx"][i] = float(proximity_index(np.array([near]), 50, 300)[0])
    cols["extremophile_idx"] = np.array([1.0 if s.get("flags") else np.nan for s in sites])
    return cols, sidx, borrowed
