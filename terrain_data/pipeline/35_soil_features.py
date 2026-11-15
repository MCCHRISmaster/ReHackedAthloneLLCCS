"""Ground and soil composition grids for all three bodies -> out/*_soil*.csv

Separate files (same team layout as *_features.csv), so a failed soil download never touches the
terrain outputs. Loaders merge them by cell: the globe (analog-atlas js/main.js), the Python scorer
(pipeline/score_data.py) and the browser scorer pages (demo/live.html).

The common basis across worlds is ELEMENT concentration in the top tens of centimetres, which is what
orbital gamma-ray spectrometers measure:

    fe_pct   iron, weight percent of the element     si_pct   silicon, weight percent
    k_pct    potassium, weight percent               th_ppm   thorium, parts per million

Sources:
  Moon   Lunar Prospector GRS elemental abundances, 2-degree product (PDS)    -> fe, si, k, th + oxides
         (the same file 10_moon_features.py reads; oxides converted to elements below)
  Mars   Mars Odyssey GRS element maps, 5-degree smoothed (Boynton et al. 2007, PDS)
                                                    -> fe, si, k, th, cl (bilinear to 2-degree centres)
  Earth  ISRIC SoilGrids 2.0, topsoil 0-5 cm, fetched from the WCS at 0.1 degree
                                                    -> clay, silt, sand, organic carbon, pH, bulk density,
                                                       coarse fragments
         plus ESTIMATED fe, si, k, th from bedrock type: GLiM lithology shares (already in
         earth_features_*.csv) x typical rock compositions (Turekian and Wedepohl 1961; Rudnick and
         Gao 2003). No global measured map of Earth soil iron or thorium exists; this is labelled.

    python -I pipeline/35_soil_features.py [--force]
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, fetch, _log  # noqa: E402
from grid import G1, G2, Grid, read_grid_csv, write_grid_csv  # noqa: E402

OUT = ROOT / "out"
FILES = {"moon": OUT / "moon_soil.csv", "mars": OUT / "mars_soil.csv",
         "earth1": OUT / "earth_soil_1deg.csv", "earth2": OUT / "earth_soil_2deg.csv"}
PDS = "https://pds-geosciences.wustl.edu"
LPGRS = f"{PDS}/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab"
ODY = f"{PDS}/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed"

# oxide weight fraction -> element weight fraction
FE_IN_FEO, SI_IN_SIO2 = 55.845 / 71.844, 28.086 / 60.084

DEC = {"fe_pct": 2, "si_pct": 1, "k_pct": 3, "th_ppm": 2, "cl_pct": 2, "feo_pct": 1, "tio2_pct": 2,
       "mgo_pct": 1, "al2o3_pct": 1, "cao_pct": 1, "sio2_pct": 1, "clay_pct": 1, "silt_pct": 1,
       "sand_pct": 1, "soc_g_kg": 1, "ph_h2o": 2, "bdod_g_cm3": 2, "cfvo_pct": 1, "chem_cover_pct": 0}


# ------------------------------------------------------------------ Moon

def moon() -> dict:
    """Lunar Prospector GRS. Pixels are 1-2 deg tall and 1.5-6 deg wide, so each 2-degree cell takes
    the pixel containing its centre (same rule as 10_moon_features.py block_lpgrs)."""
    p = fetch(LPGRS, "moon_lpgrs_high1_elem_abundance_2deg.tab")
    if p is None:
        return {}
    a = np.loadtxt(p, usecols=range(0, 16))
    # columns: 0 idx, 1-4 lat0 lat1 lon0 lon1, 5 AM, 6 NEUTRON, 7 MGO, 8 AL2O3, 9 SIO2, 10 CAO,
    #          11 TIO2, 12 FEO (weight fractions), 13 K ppm, 14 TH ppm, 15 U ppm
    names = {"mgo_pct": 7, "al2o3_pct": 8, "sio2_pct": 9, "cao_pct": 10, "tio2_pct": 11, "feo_pct": 12}
    out = {k: np.full(G2.n, np.nan) for k in list(names) + ["k_ppm", "th_ppm"]}
    lat_c, lon_c = G2.lat_grid(), G2.lon_grid()
    for row in a:
        sel = (lat_c >= row[1]) & (lat_c < row[2]) & (lon_c >= row[3]) & (lon_c < row[4])
        for k, j in names.items():
            out[k][sel] = row[j] * 100
        out["k_ppm"][sel], out["th_ppm"][sel] = row[13], row[14]
    for v in out.values():          # exactly 0 is a fit failure, not a value (1 FeO pixel, 432 K pixels)
        v[v <= 0] = np.nan
    cols = {"fe_pct": out["feo_pct"] * FE_IN_FEO, "si_pct": out["sio2_pct"] * SI_IN_SIO2,
            "k_pct": out["k_ppm"] / 1e4, "th_ppm": out["th_ppm"]}
    cols.update({k: out[k] for k in names})
    _log(f"moon soil (LP GRS): Fe {np.nanmin(cols['fe_pct']):.1f}..{np.nanmax(cols['fe_pct']):.1f} wt%, "
         f"Th {np.nanmin(cols['th_ppm']):.1f}..{np.nanmax(cols['th_ppm']):.1f} ppm, "
         f"{int(np.isnan(cols['fe_pct']).sum())} cells uncovered")
    return cols


# ------------------------------------------------------------------ Mars

def ody_element(name: str) -> np.ndarray | None:
    """One Odyssey GRS 5x5 smoothed map, bilinearly interpolated to 2-degree centres; blank where the
    product has no value (9999.999). Same method as 30_mars_features.py block_weh."""
    from scipy.interpolate import RegularGridInterpolator
    p = fetch(f"{ODY}/{name}_sr_5x5.tab", f"mars_{name}_5x5.tab", quiet=True)
    if p is None:
        return None
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
    return f(np.column_stack([G2.lat_grid(), (G2.lon_grid() + 360) % 360]))


def mars() -> dict:
    cols = {}
    for el, col in (("fe", "fe_pct"), ("si", "si_pct"), ("k", "k_pct"), ("th", "th_ppm"), ("cl", "cl_pct")):
        v = ody_element(el)
        if v is not None:
            cols[col] = v
    if cols:
        _log("mars soil (Odyssey GRS): " + ", ".join(
            f"{k} {np.nanmin(v):.2f}..{np.nanmax(v):.2f} ({int(np.isnan(v).sum())} blank)" for k, v in cols.items()))
    return cols


# ------------------------------------------------------------------ Earth: SoilGrids topsoil

SG_WCS = ("https://maps.isric.org/mapserv?map=/map/{var}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
          "&COVERAGEID={var}_0-5cm_mean&FORMAT=GEOTIFF_INT16"
          "&SUBSET=long(-180,180)&SUBSET=lat(-90,90)"
          "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
          "&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long({w}),lat({h})")
# SoilGrids variable -> (column, divisor to the column's unit). Mapped units: g/kg (texture),
# dg/kg (organic carbon), pH x 10, cg/cm3 (bulk density), cm3/dm3 (coarse fragments).
SG_VARS = {"clay": ("clay_pct", 10), "silt": ("silt_pct", 10), "sand": ("sand_pct", 10),
           "soc": ("soc_g_kg", 10), "phh2o": ("ph_h2o", 10), "bdod": ("bdod_g_cm3", 100),
           "cfvo": ("cfvo_pct", 10)}


def raster_to_grids(arr: np.ndarray, transform, grids: list[Grid]) -> list[np.ndarray]:
    """Mean of the valid pixels whose centres fall in each cell (NaN where none)."""
    h, w = arr.shape
    rows, cols = np.mgrid[0:h, 0:w]
    lon = transform.c + (cols + 0.5) * transform.a
    lat = transform.f + (rows + 0.5) * transform.e
    ok = ~np.isnan(arr)
    out = []
    for g in grids:
        idx = g.index(lat[ok], lon[ok])
        s = np.bincount(idx, weights=arr[ok], minlength=g.n)
        n = np.bincount(idx, minlength=g.n)
        with np.errstate(all="ignore"):
            out.append(np.where(n > 0, s / n, np.nan))
    return out


def soilgrids() -> tuple[dict, dict]:
    import rasterio
    c1, c2 = {}, {}
    for var, (col, div) in SG_VARS.items():
        p = None
        for w, h in ((3600, 1800), (1440, 720)):          # 0.1 deg first, 0.25 deg if the server refuses
            p = fetch(SG_WCS.format(var=var, w=w, h=h), f"soilgrids_{var}_0-5cm_{w}.tif", min_bytes=10_000, rounds=2)
            if p is not None:
                break
        if p is None:
            print(f"  SoilGrids {var}: MISSING"); continue
        with rasterio.open(p) as src:
            a = src.read(1).astype("float64")
            nod = src.nodata
            if nod is not None:
                a[a == nod] = np.nan
            a[a <= -32768] = np.nan
            # The WCS output has no nodata tag: sea, ice and bare rock come back as 0 in every layer
            # (real topsoil organic carbon is never below 10 dg/kg), so 0 means "no soil mapped".
            a[a == 0] = np.nan
            a /= div
            g1, g2 = raster_to_grids(a, src.transform, [G1, G2])
        c1[col], c2[col] = g1, g2
        _log(f"earth SoilGrids {var} 0-5 cm: {p.name}, {np.nanmin(g1):.2f}..{np.nanmax(g1):.2f}, "
             f"{int((~np.isnan(g1)).sum())} 1-degree cells")
    return c1, c2


# ------------------------------------------------------------------ Earth: element estimate from rock type

# Typical composition of each GLiM group: Fe, Si, K in weight percent of the element, Th in ppm.
# Basalt, granite, shale, sandstone, carbonate: Turekian and Wedepohl (1961, GSA Bull. 72:175), Table 2.
# Metamorphic and unconsolidated: upper continental crust, Rudnick and Gao (2003, Treatise on Geochemistry 3.01).
# Other volcanic (acid + intermediate) and plutonic: means of the nearest T&W classes. Rough by design.
ROCK_CHEM = {
    # column                     Fe     Si     K     Th
    "basic_volcanic":          (8.65, 23.0, 0.83, 4.0),
    "other_volcanic":          (4.50, 28.5, 2.00, 8.0),
    "lith_plutonic_pct":       (2.50, 32.0, 3.00, 12.0),
    "lith_metamorphic_pct":    (3.92, 31.1, 2.32, 10.5),
    "lith_siliciclastic_pct":  (2.90, 32.0, 1.90, 7.0),
    "lith_unconsolidated_pct": (3.92, 31.1, 2.32, 10.5),
    "lith_carbonate_pct":      (0.38, 2.4, 0.27, 1.7),
    "lith_evaporite_pct":      (0.10, 0.5, 0.10, 0.5),
}


def rock_chemistry(path: Path, grid: Grid) -> dict:
    f = read_grid_csv(path, grid)
    if "lith_volcanic_pct" not in f:
        return {}
    shares = {k: f[k] for k in ROCK_CHEM if k.startswith("lith_")}
    shares["basic_volcanic"] = f["lith_basic_volcanic_pct"]
    shares["other_volcanic"] = f["lith_volcanic_pct"] - f["lith_basic_volcanic_pct"]
    total = sum(np.nan_to_num(v) for v in shares.values())
    out = {"chem_cover_pct": np.where(total > 0, total, np.nan)}
    for j, col in enumerate(("fe_pct", "si_pct", "k_pct", "th_ppm")):
        s = sum(np.nan_to_num(shares[k]) * ROCK_CHEM[k][j] for k in shares)
        with np.errstate(all="ignore"):
            out[col] = np.where(total >= 20, s / total, np.nan)   # need a fifth of the cell classified
    return out


# ------------------------------------------------------------------ main

def main() -> None:
    force = "--force" in sys.argv
    if all(p.exists() for p in FILES.values()) and not force:
        print("soil outputs exist; use --force to rebuild"); return

    for label, fn, sid, path in (("Moon (Lunar Prospector GRS)", moon, "lpgrs_high1_2deg", FILES["moon"]),
                                 ("Mars (Odyssey GRS elements)", mars, "ody_grs_elem_2007", FILES["mars"])):
        try:
            cols = fn()
        except Exception as e:  # noqa: BLE001
            print(f"  {label}: FAILED ({e!r})"); _log(f"soil {label} FAILED: {e!r}"); cols = {}
        if not cols:
            print(f"  {label}: MISSING, file not written"); continue
        write_grid_csv(path, path.stem.split("_")[0], G2, cols, sid, decimals=DEC)
        print(f"  {label}: wrote {path.name} ({', '.join(cols)})", flush=True)

    try:
        sg1, sg2 = soilgrids()
    except Exception as e:  # noqa: BLE001
        print(f"  SoilGrids: FAILED ({e!r})"); _log(f"soil SoilGrids FAILED: {e!r}"); sg1, sg2 = {}, {}
    for grid, sg, feat, path in ((G1, sg1, OUT / "earth_features_1deg.csv", FILES["earth1"]),
                                 (G2, sg2, OUT / "earth_features_2deg.csv", FILES["earth2"])):
        chem = rock_chemistry(feat, grid) if feat.exists() else {}
        cols = {**chem, **sg}
        if not cols:
            print(f"  Earth: nothing to write for {path.name}"); continue
        sids = ";".join(s for s, ok in (("soilgrids_v2", sg), ("glim_chem_est", chem)) if ok)
        order = ["fe_pct", "si_pct", "k_pct", "th_ppm", "chem_cover_pct"] + [c for c, _ in SG_VARS.values()]
        write_grid_csv(path, "earth", grid, {k: cols[k] for k in order if k in cols}, sids, decimals=DEC)
        print(f"  Earth: wrote {path.name} ({len(cols)} columns)", flush=True)


if __name__ == "__main__":
    main()
