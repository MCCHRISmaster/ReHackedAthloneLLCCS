"""Phase 1: Moon feature grid at 2 degrees -> out/moon_features.csv

Sources (see BUILD_PROMPT.md section 5.2):
  - LRO LOLA gridded DEM, 16 pixels/degree (PDS)        -> elevation, relief, roughness, slope
  - Robbins 2018/2019 lunar crater database (USGS)       -> crater density (5 km and 20 km and larger)
  - Lunar Prospector GRS 2-degree element maps (PDS)     -> FeO, TiO2, Th, mare index
  - LROC Lunar Pit Atlas CSV                             -> pit count, nearest pit, lava-tube potential
  - geometry proxies (labelled)                          -> illumination, water/ice index

Temperature is NOT produced here; score time reads moon_data/moon_grid.csv.
Every block is wrapped so a failed source leaves its columns blank instead of stopping the run.

    python -I pipeline/10_moon_features.py [--force]
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, fetch, _log  # noqa: E402
from grid import (G2, block_reduce, roll_to_180, density_per_100k_km2,  # noqa: E402
                  nearest_point, write_grid_csv, RADIUS_KM)

OUT = ROOT / "out" / "moon_features.csv"
PDS = "https://pds-geosciences.wustl.edu"
LOLA = f"{PDS}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img"
LPGRS = f"{PDS}/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab"
PITS = ("https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/SHAPEFILE/"
        "LUNAR_PIT_LOCATIONS/LUNAR_PIT_LOCATIONS.CSV")
ROBBINS = ("https://astropedia.astrogeology.usgs.gov/download/Moon/Research/Craters/"
           "lunar_crater_database_robbins_2018.zip")


def slope_with_stride(dem: np.ndarray, px_km: float, lats: np.ndarray) -> np.ndarray:
    """Slope in degrees from a lat/lon DEM (metres).

    East-west pixels shrink toward the poles; a one-pixel difference there is noise. So each
    row uses a stride of k = ceil(1/cos(lat)) pixels (capped at 64) to keep the east-west
    baseline near one pixel width of true distance. Baseline is about 1.9 km at the equator.
    """
    rows, cols = dem.shape
    dy = px_km * 1000.0
    gy = np.gradient(dem, axis=0) / dy
    gx = np.zeros_like(dem)
    k_row = np.minimum(64, np.ceil(1.0 / np.maximum(np.cos(np.radians(lats)), 1e-6))).astype(int)
    for k in np.unique(k_row):
        sel = np.where(k_row == k)[0]
        seg = dem[sel]
        diff = (np.roll(seg, -k, axis=1) - np.roll(seg, k, axis=1)) / (2 * k)
        dx = dy * np.maximum(np.cos(np.radians(lats[sel])), 1e-6)[:, None]
        gx[sel] = diff / dx
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def block_dem() -> dict:
    """LOLA DEM -> elevation, relief, roughness, slope per 2-degree cell."""
    p = fetch(LOLA, "moon_ldem_16.img")
    if p is None:
        return {}
    dem = np.fromfile(p, dtype="<i2").reshape(2880, 5760).astype(np.float32) * 0.5   # metres
    dem = roll_to_180(dem)                                  # 0..360 -> -180..180
    lats = 90 - (np.arange(2880) + 0.5) / 16
    px_km = 2 * np.pi * RADIUS_KM["moon"] / 360 / 16
    slope = slope_with_stride(dem, px_km, lats).astype(np.float32)
    f = 32                                                  # 16 px/deg * 2 deg
    out = {
        "elevation_m": block_reduce(dem, f, "mean").ravel(),
        "relief_m": (block_reduce(dem, f, "max") - block_reduce(dem, f, "min")).ravel(),
        "roughness_m": block_reduce(dem, f, "std").ravel(),
        "slope_mean_deg": block_reduce(slope, f, "mean").ravel(),
    }
    _log(f"moon DEM: elevation {out['elevation_m'].min():.0f}..{out['elevation_m'].max():.0f} m, "
         f"slope mean {np.nanmean(out['slope_mean_deg']):.1f} deg")
    return out


def block_craters() -> dict:
    """Robbins crater counts per 100,000 km2 for D>=5 km and D>=20 km."""
    import pandas as pd
    p = fetch(ROBBINS, "moon_robbins_2018.zip", rounds=3)
    if p is None:
        return {}
    with zipfile.ZipFile(p) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        df = pd.read_csv(z.open(name), usecols=["LAT_CIRC_IMG", "LON_CIRC_IMG", "DIAM_CIRC_IMG"])
    lon = ((df.LON_CIRC_IMG.to_numpy() + 180) % 360) - 180
    lat = df.LAT_CIRC_IMG.to_numpy()
    d = df.DIAM_CIRC_IMG.to_numpy()
    out = {}
    for km, col in ((5, "crater_density_5km_n"), (20, "crater_density_20km_n")):
        m = d >= km
        out[col] = density_per_100k_km2(G2, lat[m], lon[m], "moon")
    _log(f"moon craters: {len(df)} rows from Robbins; {int((d >= 20).sum())} with D>=20 km")
    return out


def block_lpgrs() -> dict:
    """Lunar Prospector oxides and thorium. Pixels are 1-2 deg tall and 1.5-6 deg wide, so each
    2-degree cell takes the pixel containing its centre (the data are coarser than the grid)."""
    p = fetch(LPGRS, "moon_lpgrs_high1_elem_abundance_2deg.tab")
    if p is None:
        return {}
    a = np.loadtxt(p, usecols=range(0, 16))
    # columns: 0 idx, 1-4 lat0 lat1 lon0 lon1, 5 AM, 6 NEUTRON, 7 MGO, 8 AL2O3, 9 SIO2, 10 CAO,
    #          11 TIO2, 12 FEO (weight fractions), 13 K ppm, 14 TH ppm, 15 U ppm
    feo = np.full(G2.n, np.nan)
    tio2 = np.full(G2.n, np.nan)
    th = np.full(G2.n, np.nan)
    lat_c, lon_c = G2.lat_grid(), G2.lon_grid()
    for row in a:
        sel = (lat_c >= row[1]) & (lat_c < row[2]) & (lon_c >= row[3]) & (lon_c < row[4])
        feo[sel], tio2[sel], th[sel] = row[12] * 100, row[11] * 100, row[14]
    n_missing = int(np.isnan(feo).sum())
    _log(f"moon LP GRS: {len(a)} pixels painted onto 2-deg cells; {n_missing} cells uncovered; "
         f"FeO {np.nanmin(feo):.1f}..{np.nanmax(feo):.1f} wt%")
    return {"feo_pct": feo, "tio2_pct": tio2, "th_ppm": th}


def block_pits() -> dict:
    """LROC pit atlas, collapse pits only. 257 of 278 entries are impact-melt pits, which are
    not lava-tube skylights, so pit_n counts the 21 mare and highland pits. mare_pit_n counts
    mare pits alone and feeds lavatube_idx. The CSV is Latin-1, not UTF-8."""
    import pandas as pd
    p = fetch(PITS, "moon_pits.csv")
    if p is None:
        return {}
    df = pd.read_csv(p, usecols=["Latitude", "Longitude_180", "Terrain"], encoding="latin-1")
    df = df.dropna(subset=["Latitude", "Longitude_180"])
    keep = df[df.Terrain.isin(["Mare", "Highland"])]
    mare = df[df.Terrain == "Mare"]
    lat, lon = keep.Latitude.to_numpy(float), keep.Longitude_180.to_numpy(float)
    dist, _ = nearest_point(G2, lat, lon, "moon")
    counts = np.bincount(G2.index(lat, lon), minlength=G2.n).astype(float)
    mare_counts = np.bincount(G2.index(mare.Latitude.to_numpy(float), mare.Longitude_180.to_numpy(float)),
                              minlength=G2.n).astype(float)
    _log(f"moon pits: {len(df)} entries, {len(keep)} mare/highland collapse pits kept "
         f"({len(mare)} mare); impact-melt pits dropped")
    return {"pit_n": counts, "pit_nearest_km": dist, "mare_pit_n": mare_counts}


def main() -> None:
    force = "--force" in sys.argv
    if OUT.exists() and not force:
        print(f"{OUT.name} exists; use --force to rebuild")
        return
    cols: dict[str, np.ndarray] = {}
    sources = []
    skip = {"craters"} if "--skip-craters" in sys.argv else set()
    for label, fn, sid in (("terrain", block_dem, "lola_gdr_ldem16"),
                           ("craters", block_craters, "robbins_moon_2018"),
                           ("chemistry", block_lpgrs, "lpgrs_high1_2deg"),
                           ("pits", block_pits, "lroc_pit_atlas")):
        if label in skip:
            print(f"  {label}: skipped by flag")
            continue
        try:
            got = fn()
        except Exception as e:  # noqa: BLE001
            print(f"  {label}: FAILED ({e!r}); columns left blank")
            _log(f"moon {label} FAILED: {e!r}")
            got = {}
        if got:
            cols.update(got)
            sources.append(sid)
            print(f"  {label}: ok ({', '.join(got)})")
        else:
            print(f"  {label}: MISSING, columns left blank")

    # ---- derived columns (labelled proxies where they are proxies)
    lat = G2.lat_grid()
    if "feo_pct" in cols:
        cols["mare_idx"] = np.clip((cols["feo_pct"] - 8.0) / (15.0 - 8.0), 0, 1)   # 1 at >=15 wt%, 0 at <=8
    # geometric sunlight proxy: highest Sun elevation over a lunar year, scaled 0..1 over 0..90 deg
    cols["illum_idx"] = np.clip((90 - np.abs(lat) - 1.54) / 90, 0, 1)
    # water/ice proxy from latitude only (PSR shapefiles and neutron maps not used): 0 equatorward
    # of 70 degrees, 1 at the pole. A PROXY for polar cold traps, not a measurement.
    cols["water_idx"] = np.clip((np.abs(lat) - 70) / 18, 0, 1)
    if "mare_pit_n" in cols:
        mare = cols.get("mare_idx", np.zeros(G2.n))
        cols["lavatube_idx"] = 0.5 * np.nan_to_num(mare) + 0.5 * np.clip(cols["mare_pit_n"] / 2, 0, 1)
    sources.append("moon_geometry_proxy")

    order = ["elevation_m", "relief_m", "roughness_m", "slope_mean_deg",
             "crater_density_5km_n", "crater_density_20km_n", "feo_pct", "tio2_pct", "th_ppm",
             "mare_idx", "pit_n", "pit_nearest_km", "mare_pit_n", "lavatube_idx", "illum_idx", "water_idx"]
    data = {k: cols[k] for k in order if k in cols}
    dec = {"mare_idx": 3, "lavatube_idx": 3, "illum_idx": 3, "water_idx": 3, "pit_n": 0, "mare_pit_n": 0,
           "crater_density_5km_n": 2, "crater_density_20km_n": 2, "tio2_pct": 2, "th_ppm": 2}
    write_grid_csv(OUT, "moon", G2, data, ";".join(sources), decimals=dec)
    print(f"wrote {OUT.relative_to(ROOT.parent)}: {G2.n} rows, columns {list(data)}")


if __name__ == "__main__":
    main()
