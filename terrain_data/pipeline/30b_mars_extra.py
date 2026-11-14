"""Extra Mars blocks for 30_mars_features.py: geologic unit fractions and a lava-tube potential proxy.

Geology: USGS SIM 3292 (Tanaka et al. 2014) global geologic map shapefile, 44 unit codes. Each unit
description names its group (volcanic, highland, lowland, impact, transition, polar, basin, apron);
the share of each 2-degree cell covered by each group is rasterised at 0.1 degree and block-averaged.

Lava tubes: the Mars cave catalog (Cushing 2015) could not be downloaded (the USGS Astropedia host
resets every request), so lavatube_idx is a PROXY: 0.6 x share of volcanic terrain (Amazonian or
Hesperian volcanic groups) + 0.4 x closeness to the big Tharsis and Olympus volcanoes where
skylight candidates have been reported (Cushing 2007, 2012). It is labelled as a proxy in METHODS.md.
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, _log  # noqa: E402
from grid import G2, block_reduce, haversine_km, proximity_index, roll_to_180  # noqa: E402

GROUPS = {"volcanic": "volcanic", "highland": "highland", "lowland": "lowland", "impact": "impact",
          "transition": "transition", "polar": "polar", "basin": "basin", "apron": "apron"}
# volcanoes with reported skylight / cave-entrance candidates (approximate summit positions)
SKYLIGHT_VOLCANOES = {"Arsia Mons": (-8.3, -120.1), "Pavonis Mons": (0.8, -113.4), "Ascraeus Mons": (11.8, -104.5),
                      "Olympus Mons": (18.65, -133.8), "Alba Mons": (40.5, -109.6)}


def geology() -> dict:
    z = RAW / "mars_sim3292_database.zip"
    if not z.exists():
        return {}
    d = RAW / "mars_sim"
    shp = d / "SIM3292_MarsGlobalGeologicGIS_20M/SIM3292_Shapefiles/SIM3292_Global_Geology.shp"
    if not shp.exists():
        with zipfile.ZipFile(z) as zf:
            zf.extractall(d, [i for i in zf.namelist() if "SIM3292_Shapefiles/SIM3292_Global_Geology" in i])
    import geopandas as gpd
    from rasterio import features
    from rasterio.transform import from_origin
    gdf = gpd.read_file(shp)
    minx, maxx = gdf.total_bounds[0], gdf.total_bounds[2]
    wrapped = maxx > 180.5                              # longitudes stored 0..360
    x0 = 0.0 if wrapped else -180.0
    tr = from_origin(x0, 90, 0.1, 0.1)
    low = gdf.UnitDesc.str.lower()
    out = {}
    for key, word in GROUPS.items():
        sel = gdf[low.str.contains(word)]
        if not len(sel):
            continue
        m = features.rasterize(((g, 1) for g in sel.geometry), out_shape=(1800, 3600), transform=tr,
                               fill=0, dtype="uint8").astype("float32")
        if wrapped:
            m = roll_to_180(m)
        out[f"geo_{key}_pct"] = block_reduce(m, 20, "mean").ravel() * 100
    tot = sum(out.values())
    _log(f"mars geology: {len(gdf)} polygons, {len(out)} groups; mean coverage {np.nanmean(tot):.0f}% of cells")
    return out


def lavatube(cols: dict) -> dict:
    if "geo_volcanic_pct" not in cols:
        return {}
    pts = np.array(list(SKYLIGHT_VOLCANOES.values()))
    d = haversine_km(G2.lat_grid()[:, None], G2.lon_grid()[:, None], pts[None, :, 0], pts[None, :, 1], "mars")
    prox = proximity_index(d.min(axis=1), 300, 1500)
    return {"lavatube_idx": np.clip(0.6 * cols["geo_volcanic_pct"] / 100 + 0.4 * prox, 0, 1)}


def run(cols: dict):
    try:
        g = geology()
    except Exception as e:  # noqa: BLE001
        print(f"  geology FAILED: {e!r}")
        g = {}
    cols.update(g)
    yield "geology (USGS SIM 3292)", "usgs_sim3292", g
    yield "lava-tube proxy", "mars_lavatube_proxy", lavatube(cols)
