"""Phase 2: Earth feature grids -> out/earth_features_1deg.csv and out/earth_features_2deg.csv

1-degree rows (64,800) for ranking; 2-degree rows (16,200) in the team layout for the globe.
Sources (BUILD_PROMPT section 5.1) and what happens when one is missing:
  ETOPO 2022 60-arcsec elevation  -> terrain columns            (blank if missing)
  Natural Earth land / countries  -> land_pct, country, county  (land_pct falls back to elevation >= 0)
  GLiM lithology 0.5 deg          -> lith_* columns             (blank if missing)
  GVP Holocene volcanoes          -> volcano_* columns          (blank if missing)
  WorldClim 2.1 10 arcmin         -> climate columns            (blank if missing)
  curated caves / impact tables   -> cave_*, crater_* columns
  NASA POWER climatology          -> temp_* columns (work/power_temp_1deg.npz from 21_earth_temperature.py)
  derived indices                 -> labelled proxies where NEO products would have been used

NEO (NASA Earth Observations) no longer serves data files, so NDVI, aerosol and snow are NOT used;
barren_pct and dust_idx are climate PROXIES and say so in METHODS.md.

    python -I pipeline/20_earth_features.py [--force]
"""
from __future__ import annotations

import csv
import json
import math
import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, _log  # noqa: E402
from grid import (G1, G2, RADIUS_KM, block_reduce, haversine_km, nearest_point,  # noqa: E402
                  proximity_index, slope_stride_deg, write_grid_csv)

OUT1 = ROOT / "out" / "earth_features_1deg.csv"
OUT2 = ROOT / "out" / "earth_features_2deg.csv"
WORK = ROOT / "work"
CURATED = ROOT / "curated"
PX_PER_DEG = 60                      # ETOPO 60 arc-second


# ------------------------------------------------------------------ land mask and terrain

def land_mask_1min() -> np.ndarray | None:
    """Boolean land mask at ETOPO resolution (10800 x 21600, north first) from Natural Earth."""
    p = RAW / "ne_50m_land.zip"
    if not p.exists():
        return None
    import geopandas as gpd
    from rasterio import features
    from rasterio.transform import from_origin
    land = gpd.read_file(f"zip://{p}")
    tr = from_origin(-180, 90, 1 / PX_PER_DEG, 1 / PX_PER_DEG)
    m = features.rasterize(((g, 1) for g in land.geometry), out_shape=(180 * PX_PER_DEG, 360 * PX_PER_DEG),
                           transform=tr, fill=0, dtype="uint8")
    return m.astype(bool)


def block_terrain() -> dict:
    """Elevation, relief, roughness, slope and land_pct per 1-degree cell, cached in work/."""
    cache = WORK / "earth_dem_1deg.npz"
    if cache.exists():
        return dict(np.load(cache))
    p = RAW / "etopo2022_60s_surface.nc"
    if not p.exists():
        return {}
    import netCDF4
    z = netCDF4.Dataset(p)["z"][:].astype("float32")[::-1]       # south-first -> north-first
    mask = land_mask_1min()
    if mask is None:
        mask = z >= 0                                              # fallback: elevation above sea level
        _log("earth terrain: Natural Earth land missing, used elevation >= 0 as the land mask")
    lats = 90 - (np.arange(z.shape[0]) + 0.5) / PX_PER_DEG
    px_km = 2 * math.pi * RADIUS_KM["earth"] / 360 / PX_PER_DEG
    slope = slope_stride_deg(z, px_km, lats).astype("float32")
    zl = np.where(mask, z, np.nan).astype("float32")
    sl = np.where(mask, slope, np.nan).astype("float32")
    del slope, z
    f = PX_PER_DEG
    out = {
        "land_pct": block_reduce(mask.astype("float32"), f, "mean").ravel() * 100,
        "elev_mean_m": block_reduce(zl, f, "mean").ravel(),
        "elev_min_m": block_reduce(zl, f, "min").ravel(),
        "elev_max_m": block_reduce(zl, f, "max").ravel(),
        "roughness_m": block_reduce(zl, f, "std").ravel(),
        "slope_mean_deg": block_reduce(sl, f, "mean").ravel(),
    }
    out["relief_m"] = out["elev_max_m"] - out["elev_min_m"]
    WORK.mkdir(exist_ok=True)
    np.savez_compressed(cache, **out)
    _log(f"earth terrain: ETOPO 2022 60s processed; land share {np.nanmean(out['land_pct']):.1f}%")
    return out


# ------------------------------------------------------------------ climate (WorldClim)

def worldclim(var: str, how: str) -> np.ndarray | None:
    """Annual value of a WorldClim 10-arcmin variable on the 1-degree grid (sum or mean of 12 months)."""
    z = RAW / f"wc2.1_10m_{var}.zip"
    if not z.exists():
        return None
    import rasterio
    dest = RAW / "worldclim" / var
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(z) as zf:
        names = sorted(n for n in zf.namelist() if n.lower().endswith(".tif"))
        zf.extractall(dest, names)
    stack = []
    for n in names:
        with rasterio.open(dest / n) as src:
            a = src.read(1).astype("float32")
            if src.nodata is not None:
                a[a == src.nodata] = np.nan
            a[a < -1e30] = np.nan
            stack.append(a)
    arr = np.nanmean(stack, axis=0) if how == "mean" else np.nansum(stack, axis=0) * np.where(
        np.isnan(stack[0]), np.nan, 1.0)
    return block_reduce(arr, arr.shape[0] // 180, "mean").ravel()


# ------------------------------------------------------------------ GLiM lithology

GLIM_CLASSES = ["su", "ss", "sm", "py", "sc", "ev", "mt", "pa", "pi", "pb", "va", "vb", "vi", "ig", "wb", "nd"]


def glim() -> dict:
    """GLiM 0.5-degree grid (Hartmann and Moosdorf 2012, PANGAEA 788537) -> 1-degree lithology percentages.

    The download is a zip holding glim_wgs84_0point5deg.txt.asc (an ESRI ASCII raster, one dominant
    first-level class code per 0.5-degree cell) and Classnames.txt (code -> class letters). Each
    1-degree value is the share of its valid 0.5-degree cells in that class, so values move in steps
    of 25 percent. Cells with no class (ocean) are left out of the share.
    """
    zp = RAW / "glim_05deg.tab"
    if not zp.exists():
        return {}
    d = RAW / "glim"
    if not (d / "glim_wgs84_0point5deg.txt.asc").exists():
        d.mkdir(exist_ok=True)
        with zipfile.ZipFile(zp) as z:
            z.extractall(d)
    hdr = {}
    with open(d / "glim_wgs84_0point5deg.txt.asc", encoding="utf-8") as fh:
        for _ in range(6):
            k, v = fh.readline().split()
            hdr[k.lower()] = float(v)
    arr = np.loadtxt(d / "glim_wgs84_0point5deg.txt.asc", skiprows=6, dtype="float32")
    arr[arr == hdr.get("nodata_value", -9999)] = 0
    if arr.shape != (360, 720):
        raise ValueError(f"unexpected GLiM grid shape {arr.shape}")
    code = {}
    with open(d / "Classnames.txt", encoding="utf-8") as fh:
        for row in csv.reader(fh, delimiter=";"):
            if row and row[0].isdigit():
                code[int(float(row[1]))] = row[3].strip('"')
    valid = block_reduce((arr > 0).astype("float32"), 2, "mean").ravel()
    def share(*classes):
        m = np.isin(arr, [c for c, n in code.items() if n in classes]).astype("float32")
        with np.errstate(all="ignore"):
            return np.where(valid > 0, block_reduce(m, 2, "mean").ravel() / valid * 100, np.nan)
    out = {
        "lith_volcanic_pct": share("va", "vb", "vi"), "lith_basic_volcanic_pct": share("vb"),
        "lith_carbonate_pct": share("sc"), "lith_evaporite_pct": share("ev"), "lith_unconsolidated_pct": share("su"),
        "lith_siliciclastic_pct": share("ss", "sm"), "lith_plutonic_pct": share("pa", "pi", "pb"),
        "lith_metamorphic_pct": share("mt"), "lith_ice_pct": share("ig"),
    }
    _log(f"earth GLiM: 0.5 deg grid, {len(code)} classes, {int((valid > 0).sum())} 1-degree cells covered")
    return out


# ------------------------------------------------------------------ point sets: volcanoes, caves, craters

def volcanoes() -> dict:
    p = RAW / "gvp_holocene_volcanoes.json"
    if not p.exists():
        return {}
    feats = json.loads(p.read_text(encoding="utf-8"))["features"]
    rows = []
    for f in feats:
        pr, (lon, lat) = f["properties"], f["geometry"]["coordinates"][:2]
        rows.append((pr.get("Volcano_Name") or pr.get("volcano_name") or "", pr.get("Primary_Volcano_Type") or "",
                     pr.get("Country") or "", lat, lon, pr.get("Elevation") or pr.get("Elevation_m") or ""))
    with open(ROOT / "out" / "volcanoes.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["name", "type", "country", "lat", "lon", "elevation_m", "source_id"])
        for r in rows:
            w.writerow([r[0], r[1], r[2], f"{r[3]:.3f}", f"{r[4]:.3f}", r[5], "gvp_votw"])
    lat = np.array([r[3] for r in rows], float)
    lon = np.array([r[4] for r in rows], float)
    dist, idx = nearest_point(G1, lat, lon, "earth")
    n = np.bincount(G1.index(lat, lon), minlength=G1.n).astype(float)
    types = np.array([r[1] for r in rows], dtype=object)
    _log(f"earth volcanoes: {len(rows)} Holocene volcanoes from GVP")
    return {"volcano_n": n, "volcano_nearest_km": dist, "volcano_nearest_type": types[idx],
            "volcano_prox_idx": proximity_index(dist, 50, 500)}, (lat, lon)


def read_curated(name: str) -> list[dict]:
    with open(CURATED / name, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def nearest_table(rows: list[dict], tag: str, name_col="name", extra: dict | None = None) -> dict:
    lat = np.array([float(r["lat"]) for r in rows])
    lon = np.array([float(r["lon"]) for r in rows])
    dist, idx = nearest_point(G1, lat, lon, "earth")
    out = {f"{tag}_nearest_km": dist}
    for col, key in (extra or {}).items():
        vals = np.array([r.get(key, "") for r in rows], dtype=object)
        out[col] = vals[idx]
    out[f"{tag}_nearest_name"] = np.array([r[name_col] for r in rows], dtype=object)[idx]
    return out


def caves_and_craters() -> dict:
    out = {}
    caves = read_curated("caves.csv")
    c = nearest_table(caves, "cave", extra={"cave_nearest_type": "cave_type", "cave_nearest_length_m": "length_m"})
    clat = np.array([float(r["lat"]) for r in caves])
    clon = np.array([float(r["lon"]) for r in caves])
    d = haversine_km(G1.lat_grid()[:, None], G1.lon_grid()[:, None], clat[None, :], clon[None, :])
    c["cave_nearest_length_m"] = np.array([float(x) if x else np.nan for x in c["cave_nearest_length_m"]])
    c["cave_n_100km"] = (d <= 100).sum(axis=1).astype(float)
    tube = np.array([r["cave_type"] == "lava_tube" for r in caves])
    c["_tube_km"] = d[:, tube].min(axis=1)
    out.update(c)
    out.pop("cave_nearest_name", None)
    craters = read_curated("impact_structures.csv")
    k = nearest_table(craters, "crater", extra={"crater_nearest_diam_km": "diameter_km"})
    k["crater_nearest_diam_km"] = np.array([float(x) if x else np.nan for x in k["crater_nearest_diam_km"]])
    k["crater_prox_idx"] = proximity_index(k["crater_nearest_km"], 25, 250)
    out.update(k)
    return out


# ------------------------------------------------------------------ names (country, county)

def names(land_pct: np.ndarray) -> dict:
    p = RAW / "ne_50m_admin_0_countries.zip"
    country = np.full(G1.n, "", dtype=object)
    county = np.full(G1.n, "", dtype=object)
    if not p.exists():
        return {"country": country, "admin_region": county}
    import geopandas as gpd
    sel = np.where(land_pct >= 25)[0]
    pts = gpd.GeoDataFrame({"i": sel}, geometry=gpd.points_from_xy(G1.lon_grid()[sel], G1.lat_grid()[sel]),
                           crs="EPSG:4326")
    adm0 = gpd.read_file(f"zip://{p}")
    name_col = "NAME" if "NAME" in adm0.columns else "ADMIN"
    j = gpd.sjoin(pts, adm0[[name_col, "geometry"]], how="left", predicate="within")
    j = j[~j.index.duplicated()]
    country[j["i"].to_numpy()] = j[name_col].fillna("").to_numpy()
    miss = np.where(country[sel] == "")[0]
    if len(miss):                                                # coastal centres in the sea: nearest country
        near = gpd.sjoin_nearest(pts.iloc[miss].to_crs(3857), adm0[[name_col, "geometry"]].to_crs(3857),
                                 how="left", max_distance=300_000)
        near = near[~near.index.duplicated()]
        country[near["i"].to_numpy()] = near[name_col].fillna("").to_numpy()
    p1 = RAW / "ne_10m_admin_1_states_provinces.zip"
    if p1.exists():
        adm1 = gpd.read_file(f"zip://{p1}")
        ir = pts[country[sel] == "Ireland"]
        if len(ir):
            nm = "name" if "name" in adm1.columns else adm1.columns[0]
            j1 = gpd.sjoin(ir, adm1[[nm, "geometry"]], how="left", predicate="within")
            j1 = j1[~j1.index.duplicated()]
            county[j1["i"].to_numpy()] = j1[nm].fillna("").to_numpy()
    return {"country": country, "admin_region": county}


# ------------------------------------------------------------------ aggregation to 2 degrees

def to_2deg(arr: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Land-area-weighted mean of the four 1-degree cells in each 2-degree cell (NaN-aware)."""
    a = arr.reshape(180, 360)
    ww = w.reshape(180, 360)
    a4 = a.reshape(90, 2, 180, 2).transpose(0, 2, 1, 3).reshape(90, 180, 4)
    w4 = ww.reshape(90, 2, 180, 2).transpose(0, 2, 1, 3).reshape(90, 180, 4)
    ok = ~np.isnan(a4)
    wt = np.where(ok, w4, 0.0)
    with np.errstate(all="ignore"):
        m = np.nansum(np.where(ok, a4, 0.0) * wt, axis=2) / wt.sum(axis=2)
    return m.ravel()


def text_to_2deg(arr: np.ndarray, w: np.ndarray) -> np.ndarray:
    a4 = arr.reshape(180, 360).reshape(90, 2, 180, 2).transpose(0, 2, 1, 3).reshape(90, 180, 4)
    w4 = w.reshape(180, 360).reshape(90, 2, 180, 2).transpose(0, 2, 1, 3).reshape(90, 180, 4)
    best = w4.argmax(axis=2)
    out = np.take_along_axis(a4, best[..., None], axis=2)[..., 0]
    return np.where(w4.max(axis=2) > 0, out, "").ravel()


# ------------------------------------------------------------------ main

def main() -> None:
    if OUT1.exists() and OUT2.exists() and "--force" not in sys.argv:
        print("outputs exist; use --force to rebuild")
        return
    cols: dict[str, np.ndarray] = {}
    sources = []
    notes = []

    def add(label, got, sid):
        if got:
            cols.update(got)
            sources.append(sid)
            print(f"  {label}: ok ({len(got)} columns)", flush=True)
        else:
            notes.append(label)
            print(f"  {label}: MISSING, columns left blank", flush=True)

    terr = block_terrain()
    add("terrain (ETOPO 2022)", terr, "etopo2022")
    land_pct = terr.get("land_pct", np.full(G1.n, np.nan))
    if not terr:
        print("  no DEM: land_pct unavailable, nothing can be written"); return
    try:
        add("lithology (GLiM)", glim(), "glim_v1")
    except Exception as e:  # noqa: BLE001
        print(f"  lithology: FAILED {e!r}"); notes.append("glim")
    try:
        v = volcanoes()
        if v:
            add("volcanoes (GVP)", v[0], "gvp_votw")
        else:
            notes.append("volcanoes")
    except Exception as e:  # noqa: BLE001
        print(f"  volcanoes: FAILED {e!r}"); notes.append("volcanoes")
    cc = caves_and_craters()
    tube_km = cc.pop("_tube_km")
    add("caves and craters (curated)", cc, "curated_caves;curated_impacts")
    try:
        wc = {}
        for name, var, how in (("precip_mm_yr", "prec", "sum"), ("vapr_kpa", "vapr", "mean"), ("wind_ms", "wind", "mean"),
                               ("srad_kj_m2_day", "srad", "mean"), ("tavg_c", "tavg", "mean"),
                               ("tmin_c", "tmin", "mean"), ("tmax_c", "tmax", "mean")):
            a = worldclim(var, how)
            if a is not None:
                wc[name] = a
        if "tmax_c" in wc and "tmin_c" in wc:
            wc["diurnal_range_c"] = wc["tmax_c"] - wc["tmin_c"]
        add("climate (WorldClim 2.1)", wc, "worldclim_2_1")
    except Exception as e:  # noqa: BLE001
        print(f"  climate: FAILED {e!r}"); notes.append("worldclim")
    tp = WORK / "power_temp_1deg.npz"
    if tp.exists():
        add("temperature (NASA POWER)", dict(np.load(tp)), "nasa_power_clim")
    else:
        notes.append("temperature (run 21_earth_temperature.py)")
    nm = names(land_pct)
    cols.update(nm)
    sources.append("natural_earth")

    # ---- derived indices (proxies are labelled in METHODS.md)
    nan = np.full(G1.n, np.nan)
    precip = cols.get("precip_mm_yr", nan)
    tavg = cols.get("tavg_c", nan)
    wind = cols.get("wind_ms", nan)
    cols["aridity_idx"] = 1 - np.minimum(1, precip / 1000)
    cols["barren_pct"] = np.clip((250 - precip) / 250, 0, 1) * 100               # PROXY for NDVI < 0.1 share
    cols["dust_idx"] = cols["barren_pct"] / 100 * (0.5 + 0.5 * np.clip(wind / 6, 0, 1))   # PROXY for aerosol dust
    perm = np.where(tavg <= -6, 1.0, np.where(tavg < -2, 0.5, np.where(tavg < 0, 0.25, 0.0)))
    cols["permafrost_idx"] = np.where(np.isnan(tavg), np.nan, perm)              # climate PROXY
    ice = cols.get("lith_ice_pct", nan) / 100
    cols["ice_idx"] = np.fmax(np.nan_to_num(ice, nan=-1), np.nan_to_num(cols["permafrost_idx"], nan=-1))
    cols["ice_idx"] = np.where(cols["ice_idx"] < 0, np.nan, cols["ice_idx"])
    cols["karst_idx"] = (cols.get("lith_carbonate_pct", nan) + cols.get("lith_evaporite_pct", nan)) / 100
    if "volcano_nearest_km" in cols:
        prox = np.fmax(proximity_index(cols["volcano_nearest_km"], 50, 300), proximity_index(tube_km, 50, 300))
    else:
        prox = proximity_index(tube_km, 50, 300)
    cols["lavatube_idx"] = cols.get("lith_basic_volcanic_pct", nan) / 100 * prox
    cols["pressure_hpa"] = 1013.25 * (1 - 2.25577e-5 * cols["elev_mean_m"]) ** 5.2559
    cols["solar_idx"] = np.minimum(1, cols.get("srad_kj_m2_day", nan) / 30000)
    sources.append("earth_climate_proxy")

    order = ["land_pct", "country", "admin_region", "elev_mean_m", "elev_min_m", "elev_max_m", "relief_m",
             "roughness_m", "slope_mean_deg", "lith_volcanic_pct", "lith_basic_volcanic_pct", "lith_carbonate_pct",
             "lith_evaporite_pct", "lith_unconsolidated_pct", "lith_siliciclastic_pct", "lith_plutonic_pct",
             "lith_metamorphic_pct", "lith_ice_pct", "volcano_n", "volcano_nearest_km", "volcano_nearest_type",
             "volcano_prox_idx", "crater_nearest_km", "crater_nearest_diam_km", "crater_nearest_name", "crater_prox_idx",
             "precip_mm_yr", "vapr_kpa", "wind_ms", "srad_kj_m2_day", "tavg_c", "tmin_c", "tmax_c", "diurnal_range_c",
             "aridity_idx", "barren_pct", "dust_idx", "permafrost_idx", "ice_idx", "karst_idx", "cave_n_100km",
             "cave_nearest_km", "cave_nearest_type", "cave_nearest_length_m", "lavatube_idx", "pressure_hpa",
             "solar_idx", "temp_mean_c", "temp_high_c", "temp_low_c"]
    text = {"country", "admin_region", "volcano_nearest_type", "crater_nearest_name", "cave_nearest_type"}
    land = land_pct >= 25
    # island and coast cells with 1 to 25 percent land: kept out of the ranking CSV (BUILD_PROMPT 4) but saved
    # for looking up named sites such as Tenerife or Lanzarote, which would otherwise have no features
    some = np.nan_to_num(land_pct, nan=0) >= 1
    np.savez_compressed(WORK / "earth_features_all.npz",
                        **{k: np.where(some, a.astype(float), np.nan) for k, a in cols.items()
                           if isinstance(a, np.ndarray) and a.dtype.kind == "f" and k != "land_pct"})
    data = {}
    for k in order:
        a = cols.get(k)
        if a is None:
            continue
        if k == "land_pct":
            data[k] = land_pct
        elif k in text:
            data[k] = np.where(land, a, "")
        else:
            data[k] = np.where(land, a, np.nan)
    dec = {"cave_nearest_length_m": 0, "volcano_n": 0, "cave_n_100km": 0, "elev_mean_m": 1, "precip_mm_yr": 0,
           "srad_kj_m2_day": 0, "pressure_hpa": 1, "land_pct": 1}
    for k in order:
        if k.endswith("_idx"):
            dec[k] = 3
    for k in ("vapr_kpa", "wind_ms", "slope_mean_deg"):
        dec[k] = 2
    sid = np.where(land, ";".join(dict.fromkeys(sources)), "")
    write_grid_csv(OUT1, "earth", G1, data, list(sid), decimals=dec, text_columns=text)
    print(f"wrote {OUT1.name}: {G1.n} rows, {int(land.sum())} land rows, {len(data)} feature columns", flush=True)

    # ---- 2-degree aggregate in the team layout
    area = G1.area_km2("earth")
    w = np.where(land, land_pct / 100 * area, 0.0)
    d2, t2 = {}, {}
    for k, a in data.items():
        if k == "land_pct":
            continue
        if k in text:
            if k == "country":
                t2[k] = text_to_2deg(a, w)
            continue
        d2[k] = to_2deg(a.astype(float), w)
    d2["land_pct"] = to_2deg(np.where(land, land_pct, np.nan), area)
    d2.update(t2)
    for k in ("volcano_n", "cave_n_100km"):
        if k in d2:
            d2[k] = np.round(d2[k], 1)
    sid2 = np.where(~np.isnan(d2["elev_mean_m"]), ";".join(dict.fromkeys(sources)), "")
    write_grid_csv(OUT2, "earth", G2, d2, list(sid2), decimals=dec, text_columns={"country"})
    print(f"wrote {OUT2.name}: {G2.n} rows, {int((~np.isnan(d2['elev_mean_m'])).sum())} with land", flush=True)
    _log(f"earth features built; sources {sources}; missing {notes}")
    if notes:
        print("MISSING:", notes)


if __name__ == "__main__":
    main()
