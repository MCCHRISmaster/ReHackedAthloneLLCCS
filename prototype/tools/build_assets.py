"""Download the base maps and build the Moon/Mars temperature grids.

Run once from the prototype folder:  python tools/build_assets.py

Outputs
  assets/earth.jpg, assets/moon.jpg, assets/mars.jpg   2048x1024 equirectangular maps
  grids/moon.json, grids/mars.json                      surface temperature grids in °C

IMPORTANT: the Moon and Mars grids are a SIMPLIFIED MODEL, not measured data.
Temperature comes from latitude (sunlight) plus brightness of the NASA mosaic as a
stand-in for albedo. To use real data, replace grids/*.json with the same layout
built from LRO Diviner (Moon) or the Mars Climate Database (Mars).

Grid layout: {"res_deg": 2, "rows": 90, "cols": 180, "mean": [...], "high": [...], "low": [...]}
Row 0 is the north edge (lat 90..88), col 0 is the west edge (lon -180..-178),
values are row-major °C rounded to 0.1.
"""
import io
import json
import subprocess
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS, GRIDS = ROOT / "assets", ROOT / "grids"
RES = 2  # degrees per grid cell
ROWS, COLS = 180 // RES, 360 // RES

GIBS_EARTH = ("https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS"
              "&REQUEST=GetMap&VERSION=1.3.0&LAYERS=BlueMarble_ShadedRelief_Bathymetry"
              "&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg")
TREK = "https://trek.nasa.gov/tiles/{body}/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.jpg"
LAYERS = {"Moon": "LRO_WAC_Mosaic_Global_303ppd_v02",
          "Mars": "Mars_Viking_MDIM21_ClrMosaic_global_232m"}


def fetch(url):
    """Download bytes with curl (uses Windows' certificate store, retries flaky
    connections); falls back to Python's urllib if curl is unavailable."""
    try:
        return subprocess.run(["curl", "-sSfL", "--retry", "6", "--retry-all-errors",
                               "--retry-delay", "1", url],
                              capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        with urllib.request.urlopen(url, timeout=60) as r:
            return r.read()


def trek_mosaic(body, z=2):
    """Stitch Trek tiles: level z has 2^(z+1) x 2^z tiles of 256 px."""
    nx, ny = 2 ** (z + 1), 2 ** z
    img = Image.new("RGB", (nx * 256, ny * 256))
    for y in range(ny):
        for x in range(nx):
            tile = fetch(TREK.format(body=body, layer=LAYERS[body], z=z, y=y, x=x))
            img.paste(Image.open(io.BytesIO(tile)).convert("RGB"), (x * 256, y * 256))
    return img


def albedo_proxy(img, lo, hi):
    """Mean brightness per grid cell, stretched to an albedo range lo..hi."""
    g = np.asarray(img.convert("L").resize((COLS, ROWS), Image.BOX), dtype=float)
    p2, p98 = np.percentile(g, [2, 98])
    return lo + (hi - lo) * np.clip((g - p2) / (p98 - p2), 0, 1)


def cell_lats():
    return 90 - RES / 2 - RES * np.arange(ROWS)  # cell-centre latitudes, north first


def moon_grid(albedo):
    """Diurnal cycle per latitude: daytime radiative balance, fixed cold night."""
    lat = np.radians(cell_lats())[:, None, None]
    h = np.radians(np.linspace(-180, 180, 361))[None, None, :]
    cos_i = np.clip(np.cos(lat) * np.cos(h), 0, None)
    t_sub = 392 * ((1 - albedo[:, :, None]) / 0.88) ** 0.25   # subsolar K
    t_night = np.maximum(95 * np.cos(lat) ** 0.25, 40)        # K
    t = np.maximum(t_sub * cos_i ** 0.25, t_night)
    return t.mean(axis=2), t.max(axis=2), t.min(axis=2)


def mars_grid(albedo):
    """Annual-average daily cycle; CO2 frost caps the low end near 148 K."""
    lat = np.radians(cell_lats())[:, None]
    shade = 40 * (0.2 - albedo)                    # darker ground runs warmer
    mean = 215 - 65 * np.sin(lat) ** 2 + shade
    swing = np.cos(lat)
    high = mean + 60 * swing
    low = mean - 40 * swing
    floor = 148
    mean, high, low = (np.maximum(a, floor) for a in (mean, high, low))
    return mean, np.maximum(high, mean), np.minimum(low, mean)


def save_grid(path, mean, high, low):
    to_c = lambda k: np.round(k - 273.15, 1).ravel().tolist()
    doc = {"res_deg": RES, "rows": ROWS, "cols": COLS, "units": "C",
           "source": "simplified model (latitude + mosaic albedo), not measured data",
           "mean": to_c(mean), "high": to_c(high), "low": to_c(low)}
    path.write_text(json.dumps(doc, separators=(",", ":")))


def main():
    ASSETS.mkdir(exist_ok=True)
    GRIDS.mkdir(exist_ok=True)
    print("Earth map (NASA GIBS Blue Marble)...")
    Image.open(io.BytesIO(fetch(GIBS_EARTH))).convert("RGB").save(ASSETS / "earth.jpg", quality=85)
    for body, model, (lo, hi), out in [("Moon", moon_grid, (0.07, 0.20), "moon"),
                                       ("Mars", mars_grid, (0.10, 0.30), "mars")]:
        print(f"{body} map (NASA Trek)...")
        img = trek_mosaic(body)
        img.save(ASSETS / f"{out}.jpg", quality=85)
        save_grid(GRIDS / f"{out}.json", *model(albedo_proxy(img, lo, hi)))
    for f in ("moon", "mars"):
        g = json.loads((GRIDS / f"{f}.json").read_text())
        print(f"{f}: mean {min(g['mean'])}..{max(g['mean'])} °C, "
              f"high up to {max(g['high'])} °C, low down to {min(g['low'])} °C")


if __name__ == "__main__":
    main()
