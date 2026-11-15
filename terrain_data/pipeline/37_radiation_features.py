"""UV light and ionising-radiation dose at the ground, for all three bodies -> out/*_radiation*.csv

Separate files in the team layout (like the soil and gas grids), merged by cell wherever they are used.

Columns (same names on every body; all are 24-hour, year-round averages):
    uva_w_m2, uvb_w_m2, uvc_w_m2   UV-A (315-400 nm), UV-B (280-315 nm), UV-C (200-280 nm) reaching the ground, W/m2
    dose_msv_yr, dose_msv_day      ionising-radiation dose equivalent at the ground from cosmic rays (GCR; solar storms
                                   come on top, see METHODS.md), millisievert per year / per day
    career_days                    days, unshielded, to reach NASA's 600 mSv career limit (NASA-STD-3001, 2022)

Sources and assumptions (all stated again in METHODS.md):
  Earth  UV-A and UV-B: NASA POWER climatology ALLSKY_SFC_UVA / ALLSKY_SFC_UVB (2001-2025), land boxes, same
         downloader as the gas step. UV-C: 0, Earth's ozone and oxygen absorb all of it.
         Dose: cosmic rays only (not radon or rocks, which are not space radiation), from elevation with the
         altitude relations of Bouville and Lowder (1988) as summarised by UNSCEAR (2000): directly ionising part
         240 uSv/yr at sea level x [0.205 exp(-1.649 z) + 0.795 exp(0.4528 z)], neutrons 60 uSv/yr at sea level x
         exp(1.04 z) below 2 km and 2 exp(0.698 z) above (z in km). Sea level total 300 uSv/yr, which matches the
         301 uSv/yr minimum of the European cosmic-dose map (Cinelli et al. 2017). Latitude is ignored, as in that
         map; near the geomagnetic equator high plateaus get less than this.
  Mars   UV: ESTIMATE. Surface sunlight (team grid solar_w_m2, Mars Climate Database, dust included) x 8 percent
         UV (the share of 200-400 nm in sunlight above any atmosphere), split 80 / 15 / 5 percent UV-A / B / C as
         Curiosity's REMS measured at Gale over five Mars years (Viudez-Moreiras et al. 2025). Upper estimate:
         dust removes UV a little more than visible light.
         Dose: Curiosity RAD at Gale, 0.67 mSv/day under ~20 g/cm2 of air (Hassler et al. 2014), scaled by the air
         overhead (pressure / gravity) with an ASSUMED e-folding of 60 g/cm2: thinner air on high volcanoes, more
         shielding in deep basins.
  Moon   UV: no atmosphere, so sunlight at the ground (calculated from latitude, as add_moon_solar.py) x the same
         8 percent, split 75 / 19 / 6 percent (the top-of-atmosphere solar spectrum).
         Dose: Chang'e-4 LND, 1.369 mSv/day on the far-side surface in 2019 (Zhang et al. 2020); the same
         everywhere on the open surface (cosmic rays do not care about latitude without a magnetic field).

    python -I pipeline/37_radiation_features.py              download what is missing, then build
    python -I pipeline/37_radiation_features.py --earth 2/6  download Earth UV as worker 2 of 6
    python -I pipeline/37_radiation_features.py --build      build from what is downloaded
"""
from __future__ import annotations

import importlib.util
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import RAW, ROOT, _log  # noqa: E402
from grid import G1, G2, Grid, read_grid_csv, write_grid_csv  # noqa: E402

REPO = ROOT.parent
OUT = ROOT / "out"
FILES = {"moon": OUT / "moon_radiation.csv", "mars": OUT / "mars_radiation.csv",
         "earth1": OUT / "earth_radiation_1deg.csv", "earth2": OUT / "earth_radiation_2deg.csv"}

UV_SHARE = 0.08                                    # 200-400 nm share of sunlight above any atmosphere
SPLIT_MARS = (0.80, 0.15, 0.05)                    # UV-A, UV-B, UV-C at Gale (REMS, Viudez-Moreiras et al. 2025)
SPLIT_SPACE = (0.75, 0.19, 0.06)                   # top-of-atmosphere solar spectrum
KWH_DAY_TO_W = 1000 / 24                           # POWER kWh/m2/day -> W/m2, 24-hour mean
CAREER_MSV = 600.0                                 # NASA-STD-3001 (2022) career effective-dose limit
MARS_RAD_MSV_DAY, MARS_RAD_COLUMN, MARS_EFOLD = 0.67, 20.0, 60.0
MOON_LND_MSV_DAY = 1.369
G_MARS = 3.721

DEC = {"uva_w_m2": 2, "uvb_w_m2": 3, "uvc_w_m2": 3, "dose_msv_yr": 3, "dose_msv_day": 4, "career_days": 0}
ORDER = list(DEC)


def gas_module():
    """Reuse the NASA POWER land-box downloader of 36_gas_features.py with UV parameters and its own cache."""
    spec = importlib.util.spec_from_file_location("gas36", HERE / "36_gas_features.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    mod.POWER_PARAMS = {"ALLSKY_SFC_UVA": "uva_w_m2", "ALLSKY_SFC_UVB": "uvb_w_m2"}
    mod.POWER_CACHE = RAW / "power_uv"
    return mod


def team_column(body: str, col: str) -> tuple[np.ndarray | None, str]:
    """A column of the team grid; if this branch's copy lacks it, the copy on origin/main (read-only, via git)."""
    path = REPO / f"{body}_data" / f"{body}_grid.csv"
    d = read_grid_csv(path, G2)
    if col in d:
        return d[col], str(path.relative_to(REPO))
    tmp = RAW / f"main_{body}_grid.csv"
    try:
        txt = subprocess.run(["git", "-C", str(REPO), "show", f"origin/main:{body}_data/{body}_grid.csv"],
                             capture_output=True, text=True, check=True, encoding="utf-8").stdout
        RAW.mkdir(parents=True, exist_ok=True)
        tmp.write_text(txt, encoding="utf-8")
        d = read_grid_csv(tmp, G2)
        if col in d:
            return d[col], f"origin/main:{body}_data/{body}_grid.csv"
    except Exception as e:  # noqa: BLE001
        print(f"  could not read {col} from origin/main: {e!r}")
    return None, ""


def insolation_moon(lat_deg: np.ndarray) -> np.ndarray:
    """Year- and day-averaged sunlight on flat ground (same formula as moon_data/add_moon_solar.py)."""
    S, eps = 1361.0, math.radians(1.54)
    out = np.zeros_like(lat_deg, dtype=float)
    for k in range(360):
        dec = math.asin(math.sin(eps) * math.sin(2 * math.pi * k / 360))
        phi = np.radians(lat_deg)
        x = np.clip(-np.tan(phi) * math.tan(dec), -1, 1)
        h0 = np.arccos(x)
        out += S / math.pi * (h0 * np.sin(phi) * math.sin(dec) + np.cos(phi) * math.cos(dec) * np.sin(h0))
    return out / 360


def uv_split(sun: np.ndarray, split) -> dict:
    uv = sun * UV_SHARE
    return {"uva_w_m2": uv * split[0], "uvb_w_m2": uv * split[1], "uvc_w_m2": uv * split[2]}


def dose_cols(msv_day: np.ndarray) -> dict:
    with np.errstate(all="ignore"):
        return {"dose_msv_yr": msv_day * 365.25, "dose_msv_day": msv_day, "career_days": CAREER_MSV / msv_day}


def earth_cosmic_msv_yr(elev_m: np.ndarray) -> np.ndarray:
    z = np.maximum(np.nan_to_num(elev_m, nan=np.nan), 0) / 1000.0
    ion = 240.0 * (0.205 * np.exp(-1.649 * z) + 0.795 * np.exp(0.4528 * z))
    neu = 60.0 * np.where(z < 2, np.exp(1.04 * z), 2.0 * np.exp(0.698 * z))
    return (ion + neu) / 1000.0


def build() -> None:
    # ---- Moon
    sun = insolation_moon(G2.lat_grid())
    cols = {**uv_split(sun, SPLIT_SPACE), **dose_cols(np.full(G2.n, MOON_LND_MSV_DAY))}
    write_grid_csv(FILES["moon"], "moon", G2, {k: cols[k] for k in ORDER}, "moon_uv_geometry;change4_lnd", decimals=DEC)
    print(f"  wrote {FILES['moon'].name}")
    # ---- Mars
    sun, where = team_column("mars", "solar_w_m2")
    p, _ = team_column("mars", "pressure_pa")
    if sun is None or p is None:
        print("  Mars: no solar_w_m2 / pressure_pa in the team grid, nothing written")
    else:
        col = p / G_MARS / 10                                   # g/cm2 of air overhead
        msv = MARS_RAD_MSV_DAY * np.exp(-(col - MARS_RAD_COLUMN) / MARS_EFOLD)
        cols = {**uv_split(sun, SPLIT_MARS), **dose_cols(msv)}
        write_grid_csv(FILES["mars"], "mars", G2, {k: cols[k] for k in ORDER}, "mars_uv_rems_est;curiosity_rad", decimals=DEC)
        print(f"  wrote {FILES['mars'].name} (sunlight from {where})")
        _log(f"mars radiation: UV-B {np.nanmin(cols['uvb_w_m2']):.2f}..{np.nanmax(cols['uvb_w_m2']):.2f} W/m2, "
             f"dose {np.nanmin(msv):.2f}..{np.nanmax(msv):.2f} mSv/day; sunlight from {where}")
    # ---- Earth
    power = gas_module().earth_power_grids()
    for grid, feat, path, k in ((G1, OUT / "earth_features_1deg.csv", FILES["earth1"], 0),
                                (G2, OUT / "earth_features_2deg.csv", FILES["earth2"], 1)):
        f = read_grid_csv(feat, grid)
        msv_yr = earth_cosmic_msv_yr(f["elev_mean_m"])
        cols = dose_cols(msv_yr / 365.25)
        for c, arrs in power.items():
            cols[c] = arrs[k] * KWH_DAY_TO_W
        cols["uvc_w_m2"] = np.where(np.isnan(msv_yr) & np.isnan(cols.get("uvb_w_m2", msv_yr)), np.nan, 0.0)
        sid = "earth_cosmic_altitude" + (";power_uv" if power else "")
        write_grid_csv(path, "earth", grid, {c: cols[c] for c in ORDER if c in cols}, sid, decimals=DEC)
        print(f"  wrote {path.name} ({len([c for c in ORDER if c in cols])} columns)")
    if not power:
        print("  Earth: no POWER UV downloaded yet, UV-A / UV-B blank (run with --earth)")


def main() -> None:
    args = sys.argv[1:]
    if "--earth" in args:
        shard = next((a for a in args if "/" in a and a.replace("/", "").isdigit()), "1/1")
        gas_module().earth_download(shard); return
    if "--build" not in args:
        gas_module().earth_download()
    build()


if __name__ == "__main__":
    main()
