"""Phase 3: Mars feature grid at 2 degrees -> out/mars_features.csv

Sources (BUILD_PROMPT section 5.3) and the stand-ins used where a product could not be reached:
  MGS MOLA 16 px/deg topography (PDS)            -> elevation, relief, roughness, slope, pressure estimate
  Robbins and Hynek 2012 crater DB (USGS API)    -> crater density 5 km+ and 20 km+
  MGS TES night thermal inertia, 20 px/deg (PDS) -> thermal_inertia_tiu, dust_cover_idx (proxy from TI)
  Odyssey GRS water-equivalent hydrogen, 5 deg   -> weh_pct (interpolated to 2 deg), water_idx
  Mars cave candidate catalog (Cushing 2015)     -> cave_candidate_n, cave_nearest_km  (if reachable)
  USGS SIM 3292 geologic units (Tanaka 2014)     -> geo_*_pct                           (if reachable)
Temperature is NOT produced here; score time reads mars_data/mars_grid.csv.

    python -I pipeline/30_mars_features.py [--force]
"""
from __future__ import annotations

import csv
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, fetch, _log  # noqa: E402
from grid import (G2, RADIUS_KM, block_reduce, density_per_100k_km2, nearest_point,  # noqa: E402
                  roll_to_180, slope_stride_deg, write_grid_csv)

OUT = ROOT / "out" / "mars_features.csv"
PDS = "https://pds-geosciences.wustl.edu"
API = "https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items"


def block_dem() -> dict:
    """MOLA megt: big-endian int16 metres above the areoid, 0..360 E, north first."""
    p = fetch(f"{PDS}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img", "mars_megt16.img", quiet=True)
    if p is None:
        return {}
    dem = np.fromfile(p, dtype=">i2").reshape(2880, 5760).astype("float32")
    dem = roll_to_180(dem)
    lats = 90 - (np.arange(2880) + 0.5) / 16
    px_km = 2 * math.pi * RADIUS_KM["mars"] / 360 / 16
    slope = slope_stride_deg(dem, px_km, lats).astype("float32")
    f = 32
    out = {"elevation_m": block_reduce(dem, f, "mean").ravel(),
           "relief_m": (block_reduce(dem, f, "max") - block_reduce(dem, f, "min")).ravel(),
           "roughness_m": block_reduce(dem, f, "std").ravel(),
           "slope_mean_deg": block_reduce(slope, f, "mean").ravel()}
    out["pressure_pa"] = 610.0 * np.exp(-out["elevation_m"] / 11100.0)           # ESTIMATE from elevation
    _log(f"mars DEM: elevation {out['elevation_m'].min():.0f}..{out['elevation_m'].max():.0f} m, "
         f"slope mean {np.nanmean(out['slope_mean_deg']):.1f} deg")
    return out


def block_craters() -> dict:
    """Robbins and Hynek via the USGS pygeoapi, largest first, pages of 20,000 until diameters fall below 5 km."""
    lat, lon, diam = [], [], []
    for page in range(0, 12):
        p = fetch(f"{API}?f=json&limit=20000&offset={page * 20000}&sortby=-diamkm", f"mars_robbins_p{page}.json",
                  rounds=3, timeout=300, quiet=True)
        if p is None:
            break
        feats = json.loads(p.read_text(encoding="utf-8"))["features"]
        if not feats:
            break
        for f in feats:
            pr = f["properties"]
            lat.append(pr["lat"]); lon.append(pr["lon_e"]); diam.append(pr["diamkm"])
        if feats[-1]["properties"]["diamkm"] < 5:
            break
    if not diam:
        return {}
    lat, lon, diam = np.array(lat, float), (np.array(lon, float) + 180) % 360 - 180, np.array(diam, float)
    out = {}
    for km, col in ((5, "crater_density_5km_n"), (20, "crater_density_20km_n")):
        m = diam >= km
        out[col] = density_per_100k_km2(G2, lat[m], lon[m], "mars")
    _log(f"mars craters: {len(diam)} craters >= {diam.min():.1f} km fetched from the USGS API")
    return out


def block_thermal_inertia() -> dict:
    """TES night TI (Putzig and Mellon 2007): 16-bit big-endian, 7200 x 3600, -180..180, north first."""
    p = fetch(f"{PDS}/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.img", "mars_ti_night_real.img", quiet=True)
    if p is None:
        return {}
    ti = np.fromfile(p, dtype=">i2").reshape(3600, 7200).astype("float32")
    ti[ti <= 0] = np.nan                                            # 0 and negatives are fill values
    cell = block_reduce(ti, 40, "mean").ravel()
    dust = np.clip((350 - cell) / 250, 0, 1)                        # 1 at TI <= 100, 0 at TI >= 350: PROXY
    _log(f"mars TES TI: {np.nanmin(cell):.0f}..{np.nanmax(cell):.0f}, {int(np.isnan(cell).sum())} cells blank")
    return {"thermal_inertia_tiu": cell, "dust_cover_idx": dust}


def block_weh() -> dict:
    """Odyssey GRS water-equivalent hydrogen, 5-degree smoothed, bilinearly interpolated to 2-degree centres.

    The table has 36 latitude rows (-87.5..87.5) x 72 longitude columns (2.5..357.5 E). Rows where the
    product has no value (9999.999, mostly poleward of about 60 degrees where CO2 frost hides the
    signal) stay BLANK in weh_pct; nothing is extrapolated. water_idx is then
        max( weh_pct / 30 capped at 1 , latitude proxy )
    where the proxy is 0 equatorward of 40 degrees and 1 poleward of 60 degrees (a stand-in for ice
    stability, NOT a measurement), so the polar ice that Odyssey did see is not scored as dry.
    """
    from scipy.interpolate import RegularGridInterpolator
    p = fetch(f"{PDS}/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.tab", "mars_h2o_5x5.tab", quiet=True)
    if p is None:
        return {}
    rows = [l.split() for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    lat = np.array([float(r[0]) for r in rows]); lon = np.array([float(r[1]) for r in rows])
    val = np.array([float(r[2]) for r in rows])
    val[val > 9000] = np.nan
    la, lo = np.unique(lat), np.unique(lon)
    grid = np.full((len(la), len(lo)), np.nan)
    grid[np.searchsorted(la, lat), np.searchsorted(lo, lon)] = val
    wrap = np.concatenate([grid[:, -1:], grid, grid[:, :1]], axis=1)
    lo_w = np.concatenate([[lo[-1] - 360], lo, [lo[0] + 360]])
    f = RegularGridInterpolator((la, lo_w), wrap, bounds_error=False, fill_value=np.nan)
    lat2, lon2 = G2.lat_grid(), (G2.lon_grid() + 360) % 360
    weh = f(np.column_stack([lat2, lon2]))
    proxy = np.clip((np.abs(lat2) - 40) / 20, 0, 1)
    idx = np.fmax(np.nan_to_num(np.clip(weh / 30.0, 0, 1), nan=0.0), proxy)
    _log(f"mars GRS WEH: {np.nanmin(weh):.1f}..{np.nanmax(weh):.1f} wt% where valid, "
         f"{int(np.isnan(weh).sum())} cells blank (polar), water_idx uses the latitude proxy there")
    return {"weh_pct": weh, "water_idx": idx}


def main() -> None:
    if OUT.exists() and "--force" not in sys.argv:
        print(f"{OUT.name} exists; use --force to rebuild"); return
    cols: dict[str, np.ndarray] = {}
    sources = []
    blocks = [("terrain (MOLA)", block_dem, "mola_megdr16"), ("craters (Robbins)", block_craters, "robbins_mars_2012"),
              ("thermal inertia (TES)", block_thermal_inertia, "tes_ti_2007"), ("hydrogen (Odyssey GRS)", block_weh, "ody_grs_h2o")]
    extra = HERE / "30b_mars_extra.py"
    for label, fn, sid in blocks:
        try:
            got = fn()
        except Exception as e:  # noqa: BLE001
            print(f"  {label}: FAILED ({e!r})"); _log(f"mars {label} FAILED: {e!r}"); got = {}
        if got:
            cols.update(got); sources.append(sid); print(f"  {label}: ok ({', '.join(got)})", flush=True)
        else:
            print(f"  {label}: MISSING, columns left blank", flush=True)
    if extra.exists():                                              # caves and geologic units, added separately
        import importlib.util
        spec = importlib.util.spec_from_file_location("mars_extra", extra)
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        for label, sid, got in mod.run(cols):
            if got:
                cols.update(got); sources.append(sid); print(f"  {label}: ok ({', '.join(got)})", flush=True)
            else:
                print(f"  {label}: MISSING, columns left blank", flush=True)
    lat = G2.lat_grid()
    cols["illum_idx"] = np.clip((90 - np.abs(lat)) / 90, 0, 1)      # annual-mean noon Sun elevation proxy
    sources.append("mars_geometry_proxy")
    order = ["elevation_m", "relief_m", "roughness_m", "slope_mean_deg", "pressure_pa", "crater_density_5km_n",
             "crater_density_20km_n", "thermal_inertia_tiu", "dust_cover_idx", "weh_pct", "water_idx", "cave_candidate_n",
             "cave_nearest_km", "geo_volcanic_pct", "geo_impact_pct", "geo_highland_pct", "geo_lowland_pct",
             "geo_polar_pct", "geo_transition_pct", "geo_basin_pct", "geo_apron_pct", "lavatube_idx", "illum_idx"]
    data = {k: cols[k] for k in order if k in cols}
    dec = {"dust_cover_idx": 3, "water_idx": 3, "lavatube_idx": 3, "illum_idx": 3, "pressure_pa": 1, "cave_candidate_n": 0,
           "thermal_inertia_tiu": 0, "crater_density_5km_n": 2, "crater_density_20km_n": 2, "weh_pct": 2}
    write_grid_csv(OUT, "mars", G2, data, ";".join(sources), decimals=dec)
    print(f"wrote {OUT.name}: {G2.n} rows, columns {list(data)}")


if __name__ == "__main__":
    main()
