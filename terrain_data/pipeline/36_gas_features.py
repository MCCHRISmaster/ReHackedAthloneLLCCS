"""Gases in the air, the whole atmosphere and at the surface, for all three bodies -> out/*_gases*.csv

Separate files in the team layout (like the soil grids), merged by cell wherever they are used: the Python
scorer (score_data.py), the browser scorer (js/test_score.mjs, demo/live.html) and the globe (js/main.js).
The team grids (*_data/*_grid.csv) are only READ here: their surface pressure is the base for the partial
pressures.

Columns (same names on every body; blank = not known, never 0 for unknown):
  SURFACE AIR (what you would breathe or a rover's intake would see, 2 m above the ground)
    p_total_pa                        surface pressure (copied from the team grid / terrain features)
    co2_pct, n2_pct, o2_pct, ar_pct   volume share of each gas, percent
    pp_co2_pa, pp_n2_pa, pp_o2_pa, pp_ar_pa   partial pressure = share x surface pressure, Pa
    co_ppm, h2_ppm, he_ppm, o3_ppb, ch4_ppb    trace gases near the surface
  WHOLE ATMOSPHERE (everything overhead)
    air_column_g_cm2   mass of air overhead = pressure / gravity; the shielding against cosmic rays
    ozone_du           total ozone column in Dobson units (UV shielding)
    haze_tau           aerosol / dust optical depth at visible wavelengths
  GAS AT THE SURFACE
    co2_frost_kg_m2, co2_frost_months   seasonal CO2 ice on the ground: yearly mean, months with > 1 kg/m2
    h2o_frost_kg_m2                     seasonal water frost on the ground, yearly mean

Sources
  Mars   Mars Climate Database 6.2 web interface (no account; same server and request format as
         mars_data/build_mars_grid.py): vmr_co2, vmr_n2, vmr_ar, vmr_o2, vmr_co, vmr_h2, vmr_he, vmr_o3
         at 2 m, col_o3, dod (dust optical depth), co2ice, surf_h2o_ice. 12 seasons, weighted by length;
         ozone at 0 h and 12 h local time, the rest at 12 h. Methane: Curiosity TLS background 0.41 ppb
         (Webster et al. 2018), measured at Gale crater only.
  Earth  Well-mixed gases are the same everywhere (dry-air composition, NOAA 2025 global means for CO2 and
         CH4), so Earth's partial pressures vary through surface pressure, i.e. altitude. Ozone column (TO3)
         and aerosol optical depth (AOD_55) from NASA POWER climatology 2001-2025, downloaded for the
         10-degree boxes that hold land, with the team's downloader (earth_data/build_earth_grid.py).
  Moon   No atmosphere: a surface-bounded exosphere of about 3e-10 Pa (He, Ar-40, Ne; LADEE). Every
         gas column is 0; shares are blank (an exosphere has no meaningful "percent").

    python -I pipeline/36_gas_features.py              download what is missing (Mars, then Earth), then build
    python -I pipeline/36_gas_features.py --mars       download the Mars maps only
    python -I pipeline/36_gas_features.py --earth      download the Earth boxes only
    python -I pipeline/36_gas_features.py --earth 2/4  ...as worker 2 of 4 (run 1/4 .. 4/4 side by side)
    python -I pipeline/36_gas_features.py --build      build the CSVs from what is downloaded
"""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, _log  # noqa: E402
from grid import G1, G2, Grid, read_grid_csv, write_grid_csv  # noqa: E402

REPO = ROOT.parent
OUT = ROOT / "out"
FILES = {"moon": OUT / "moon_gases.csv", "mars": OUT / "mars_gases.csv",
         "earth1": OUT / "earth_gases_1deg.csv", "earth2": OUT / "earth_gases_2deg.csv"}
G_MS2 = {"earth": 9.807, "mars": 3.721, "moon": 1.62}
DU_KG_M2 = 2.1415e-5            # 1 Dobson unit of ozone = 2.1415e-5 kg/m2

# Earth dry air (percent by volume) and trace gases. CO2 and CH4: NOAA Global Monitoring Laboratory
# global means for 2025 (about 425 ppm and 1,935 ppb); the rest: standard dry-air composition.
EARTH_AIR = {"co2_pct": 0.0425, "n2_pct": 78.08, "o2_pct": 20.95, "ar_pct": 0.934}
EARTH_TRACE = {"co_ppm": 0.1, "h2_ppm": 0.53, "he_ppm": 5.24, "o3_ppb": 30.0, "ch4_ppb": 1935.0}
MARS_CH4_PPB = 0.41             # Curiosity TLS background (Webster et al. 2018), Gale crater only

DEC = {"p_total_pa": 1, "co2_pct": 4, "n2_pct": 3, "o2_pct": 4, "ar_pct": 3, "pp_co2_pa": 2, "pp_n2_pa": 2,
       "pp_o2_pa": 3, "pp_ar_pa": 2, "co_ppm": 1, "h2_ppm": 2, "he_ppm": 2, "o3_ppb": 1, "ch4_ppb": 2,
       "air_column_g_cm2": 2, "ozone_du": 3, "haze_tau": 3, "co2_frost_kg_m2": 1, "co2_frost_months": 0,
       "h2o_frost_kg_m2": 3}


# ================================================================== Mars (MCD web interface)

sys.path.insert(0, str(REPO / "mars_data"))
MCD_CACHE = RAW / "mcd_gases"
# MCD variable -> (local times, valid range)
MCD_VARS = {
    "vmr_co2": ([12], (0.3, 1.0)), "vmr_n2": ([12], (0.0, 0.5)), "vmr_ar": ([12], (0.0, 0.5)),   # winter-pole enrichment: N2, Ar reach 20%+
    "vmr_o2": ([12], (0.0, 0.1)), "vmr_co": ([12], (0.0, 0.1)), "vmr_h2": ([12], (0.0, 1e-3)),
    "vmr_he": ([12], (0.0, 1e-3)), "vmr_o3": ([0, 12], (0.0, 1e-4)), "col_o3": ([0, 12], (0.0, 1e-3)),
    "dod": ([12], (0.0, 20.0)), "co2ice": ([12], (0.0, 5e4)), "surf_h2o_ice": ([12], (0.0, 5e4)),
}


def mcd_cache(var, ls, lt):
    return MCD_CACHE / f"{var}_ls{ls:03d}_lt{lt:02d}.txt"


def mcd_fetch(b, var, ls, lt):
    """One global map of one MCD variable (team request format, var1 swapped). Cached in raw/mcd_gases/."""
    dest = mcd_cache(var, ls, lt)
    if dest.exists():
        return dest
    MCD_CACHE.mkdir(parents=True, exist_ok=True)
    url = b.request_url(ls, lt).replace("var1=tsurf", "var1=" + var)
    html_tmp, txt_tmp = str(MCD_CACHE / "_page.tmp"), str(MCD_CACHE / "_data.tmp")
    lo, hi = MCD_VARS[var][1]
    err = "unknown"
    for attempt in range(1, 6):
        if not b.curl_get(url, html_tmp):
            err = "server not reachable"
        else:
            m = b.HREF_TXT.search(open(html_tmp, encoding="utf-8", errors="replace").read())
            if not m:
                shutil.copyfile(html_tmp, MCD_CACHE / "_last_error.html"); err = "no data link in the page"
            elif not b.curl_get(urljoin(url, m.group(1)), txt_tmp):
                err = "data file download failed"
            else:
                try:
                    lons, lats, g = b.parse_ascii(txt_tmp)
                    flat = [v for r in g for v in r]
                    if len(lons) < 10 or min(flat) < lo or max(flat) > hi:
                        raise ValueError(f"{len(lons)} lons, values {min(flat):.3g}..{max(flat):.3g} not in {lo}..{hi}")
                except ValueError as e:
                    shutil.copyfile(txt_tmp, MCD_CACHE / "_last_error.txt"); err = f"not understood: {e}"
                else:
                    os.replace(txt_tmp, dest)
                    time.sleep(1.5)                        # "moderate use" of the MCD server
                    return dest
        print(f"    {var} Ls {ls} LT {lt}: attempt {attempt}/5 failed: {err}", flush=True)
        time.sleep(5 * attempt)
    raise RuntimeError(f"{var} Ls {ls} LT {lt}: {err}")


def mars_download() -> None:
    import build_mars_grid as b
    jobs = [(v, ls, lt) for v, (lts, _) in MCD_VARS.items() for ls in b.LS_LIST for lt in lts]
    todo = [j for j in jobs if not mcd_cache(*j).exists()]
    print(f"Mars: {len(jobs)} MCD maps, {len(todo)} to download", flush=True)
    for n, (v, ls, lt) in enumerate(todo, 1):
        print(f"  [{n}/{len(todo)}] {v} Ls {ls} LT {lt}", flush=True)
        try:
            mcd_fetch(b, v, ls, lt)
        except RuntimeError as e:
            print(f"  GAVE UP: {e}", flush=True)
    _log(f"mars gases: MCD maps in cache {sum(mcd_cache(*j).exists() for j in jobs)}/{len(jobs)}")


def mcd_field(b, var, how="mean"):
    """Season-weighted yearly mean (or count of months above 1) on the 2-degree centres; None if incomplete."""
    lts = MCD_VARS[var][0]
    total = sum(b.MONTH_SOLS)
    acc = None
    for ls, w in zip(b.LS_LIST, b.MONTH_SOLS):
        for lt in lts:
            p = mcd_cache(var, ls, lt)
            if not p.exists():
                return None
            lons, lats, g = b.parse_ascii(str(p))
            from scipy.interpolate import RegularGridInterpolator
            f = RegularGridInterpolator((np.array(lons), np.array(lats)), np.array(g), bounds_error=False, fill_value=None)
            v = f(np.column_stack([G2.lon_grid(), G2.lat_grid()]))
            part = (v > 1.0).astype(float) / len(lts) if how == "months" else v * (w / total / len(lts))
            acc = part if acc is None else acc + part
    return acc


def mars_build() -> dict:
    import build_mars_grid as b
    team = read_grid_csv(REPO / "mars_data" / "mars_grid.csv", G2)
    p = team.get("pressure_pa")
    if p is None:
        print("  Mars: mars_grid.csv has no pressure_pa column; run mars_data/build_mars_atmo.py first"); return {}
    cols = {"p_total_pa": p}
    for var, col in (("vmr_co2", "co2"), ("vmr_n2", "n2"), ("vmr_o2", "o2"), ("vmr_ar", "ar")):
        v = mcd_field(b, var)
        if v is not None:
            cols[f"{col}_pct"] = v * 100
            cols[f"pp_{col}_pa"] = v * p
    for var, col, k in (("vmr_co", "co_ppm", 1e6), ("vmr_h2", "h2_ppm", 1e6), ("vmr_he", "he_ppm", 1e6),
                        ("vmr_o3", "o3_ppb", 1e9)):
        v = mcd_field(b, var)
        if v is not None:
            cols[col] = v * k
    cols["ch4_ppb"] = np.full(G2.n, MARS_CH4_PPB)
    cols["air_column_g_cm2"] = p / G_MS2["mars"] / 10
    for var, col, k in (("col_o3", "ozone_du", 1 / DU_KG_M2), ("dod", "haze_tau", 1.0),
                        ("co2ice", "co2_frost_kg_m2", 1.0), ("surf_h2o_ice", "h2o_frost_kg_m2", 1.0)):
        v = mcd_field(b, var)
        if v is not None:
            cols[col] = np.maximum(v * k, 0)
    m = mcd_field(b, "co2ice", how="months")
    if m is not None:
        cols["co2_frost_months"] = m
    missing = [c for c in ("co2_pct", "o2_pct", "ozone_du", "haze_tau", "co2_frost_kg_m2") if c not in cols]
    if missing:
        print(f"  Mars: MCD maps incomplete, blank: {missing} (run with --mars)")
    _log(f"mars gases: pp_co2 {np.nanmin(cols.get('pp_co2_pa', [np.nan])):.0f}..{np.nanmax(cols.get('pp_co2_pa', [np.nan])):.0f} Pa, "
         f"ozone {np.nanmax(cols.get('ozone_du', [np.nan])):.2f} DU max, dust tau {np.nanmean(cols.get('haze_tau', [np.nan])):.2f} mean")
    return cols


# ================================================================== Earth (NASA POWER, land boxes)

sys.path.insert(0, str(REPO / "earth_data"))
POWER_CACHE = RAW / "power_gases"
POWER_PARAMS = {"TO3": "ozone_du", "AOD_55": "haze_tau"}


def land_boxes(size=10):
    f = read_grid_csv(OUT / "earth_features_1deg.csv", G1)
    land = np.nan_to_num(f["land_pct"]) >= 25
    lat, lon = G1.lat_grid()[land], G1.lon_grid()[land]
    return sorted({(int((la + 90) // size) * size - 90, int((lo + 180) // size) * size - 180) for la, lo in zip(lat, lon)})


def _have(param, a, b) -> bool:
    name = f"{param}_{a:g}_{a + 10:g}_{b:g}_{b + 10:g}.json"
    return POWER_CACHE.exists() and any((Path(d) / name).exists() for d, _, _ in os.walk(POWER_CACHE))


def earth_download(shard: str = "1/1") -> None:
    """shard 'k/n': this worker takes every n-th missing box, starting at k. Each worker keeps its own
    subfolder (the team downloader uses one temporary file per cache folder)."""
    import build_earth_grid as e
    k, n_sh = (int(x) for x in shard.split("/"))
    e.CACHE = str(POWER_CACHE if n_sh == 1 else POWER_CACHE / f"worker{k}")
    os.makedirs(e.CACHE, exist_ok=True)
    boxes = land_boxes()
    jobs = [(p, a, b) for a, b in boxes for p in POWER_PARAMS]
    todo = [j for j in jobs if not _have(*j)][k - 1::n_sh]
    print(f"Earth: {len(boxes)} land boxes x {len(POWER_PARAMS)} parameters, worker {shard}: {len(todo)} to download", flush=True)
    stats = {"ok": 0, "failed": 0}
    for n, (p, a, b) in enumerate(todo, 1):
        print(f"  [{n}/{len(todo)}] {p} lat {a}..{a + 10} lon {b}..{b + 10}", flush=True)
        e.download_box(p, a, a + 10, b, b + 10, 10, stats)
    _log(f"earth gases: POWER TO3/AOD_55 boxes downloaded {stats['ok']}, failed {stats['failed']}")


def earth_power_grids() -> dict:
    """{column: (1-degree array, 2-degree array)} averaged from every POWER point in the cell."""
    import build_earth_grid as e
    out = {}
    if not POWER_CACHE.exists():
        return out
    for param, col in POWER_PARAMS.items():
        lat, lon, val = [], [], []
        files = {}                                         # one file per box, whichever worker fetched it
        for d, _, names in os.walk(POWER_CACHE):
            for name in names:
                if name.startswith(param + "_") and name.endswith(".json"):
                    files.setdefault(name, os.path.join(d, name))
        for path in files.values():
            for la, lo, pp, values in e.points_from_file(path):
                if pp != param:
                    continue
                v = values.get("ANN")
                if not e.valid(v):
                    months = [float(values[m]) for m in e.MONTHS if e.valid(values.get(m))]
                    v = sum(months) / 12 if len(months) == 12 else None
                if v is not None:
                    lat.append(la); lon.append(lo); val.append(float(v))
        if not val:
            continue
        lat, lon, val = np.array(lat), (np.array(lon) + 180) % 360 - 180, np.array(val)
        grids = []
        for g in (G1, G2):
            idx = g.index(lat, lon)
            s = np.bincount(idx, weights=val, minlength=g.n); n = np.bincount(idx, minlength=g.n)
            with np.errstate(all="ignore"):
                grids.append(np.where(n > 0, s / n, np.nan))
        out[col] = tuple(grids)
        _log(f"earth gases: {param} {len(val)} POWER points, {np.nanmin(val):.3g}..{np.nanmax(val):.3g}")
    return out


def earth_build() -> tuple[dict, dict]:
    power = earth_power_grids()
    team = read_grid_csv(REPO / "earth_data" / "earth_grid.csv", G2)        # NASA POWER surface pressure
    feat1 = read_grid_csv(OUT / "earth_features_1deg.csv", G1)              # standard atmosphere from elevation
    p1 = feat1["pressure_hpa"] * 100
    res = []
    for g, p, k in ((G1, p1, 0), (G2, team.get("pressure_pa"), 1)):
        if p is None:
            res.append({}); continue
        cols = {"p_total_pa": p}
        for c, pct in EARTH_AIR.items():
            gas = c.split("_")[0]
            cols[c] = np.where(np.isnan(p), np.nan, pct)
            cols[f"pp_{gas}_pa"] = p * pct / 100
        for c, v in EARTH_TRACE.items():
            cols[c] = np.where(np.isnan(p), np.nan, v)
        cols["air_column_g_cm2"] = p / G_MS2["earth"] / 10
        for c, arrs in power.items():
            cols[c] = arrs[k]
        cols["co2_frost_kg_m2"] = np.where(np.isnan(p), np.nan, 0.0)         # CO2 never freezes out on Earth
        cols["co2_frost_months"] = np.where(np.isnan(p), np.nan, 0.0)
        res.append(cols)
    if not power:
        print("  Earth: no POWER ozone/haze downloaded yet, those columns blank (run with --earth)")
    return res[0], res[1]


# ================================================================== Moon

def moon_build() -> dict:
    zero = np.zeros(G2.n)
    cols = {"p_total_pa": zero}
    for gas in ("co2", "n2", "o2", "ar"):
        cols[f"pp_{gas}_pa"] = zero
    cols.update({"air_column_g_cm2": zero, "ozone_du": zero, "haze_tau": zero})
    return cols


# ================================================================== main

ORDER = ["p_total_pa", "co2_pct", "n2_pct", "o2_pct", "ar_pct", "pp_co2_pa", "pp_n2_pa", "pp_o2_pa", "pp_ar_pa",
         "co_ppm", "h2_ppm", "he_ppm", "o3_ppb", "ch4_ppb", "air_column_g_cm2", "ozone_du", "haze_tau",
         "co2_frost_kg_m2", "co2_frost_months", "h2o_frost_kg_m2"]


def write(path: Path, body: str, grid: Grid, cols: dict, sid: str) -> None:
    data = {k: cols[k] for k in ORDER if k in cols}
    write_grid_csv(path, body, grid, data, sid, decimals=DEC)
    print(f"  wrote {path.name} ({len(data)} columns)", flush=True)


def build() -> None:
    write(FILES["moon"], "moon", G2, moon_build(), "moon_exosphere_const")
    try:
        mars = mars_build()
        if mars:
            write(FILES["mars"], "mars", G2, mars, "mcd_v6_2_gases;curiosity_tls_ch4")
    except Exception as e:  # noqa: BLE001
        print(f"  Mars: FAILED ({e!r})"); _log(f"mars gases FAILED: {e!r}")
    e1, e2 = earth_build()
    sid = "earth_dry_air;power_to3_aod" if "ozone_du" in e2 else "earth_dry_air"
    if e1:
        write(FILES["earth1"], "earth", G1, e1, sid)
    if e2:
        write(FILES["earth2"], "earth", G2, e2, sid)


def main() -> None:
    args = set(sys.argv[1:])
    if "--mars" in args:
        mars_download(); return
    if "--earth" in args:
        shard = next((a for a in sys.argv[1:] if "/" in a and a.replace("/", "").isdigit()), "1/1")
        earth_download(shard); return
    if "--build" not in args:
        mars_download(); earth_download()
    build()


if __name__ == "__main__":
    main()
