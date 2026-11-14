"""Go / no-go check for the terrain_data pipeline.

Checks the Python packages, the command-line tools, free disk space and whether the data
hosts answer. Prints one line per item and GO or NO-GO at the end. Safe to re-run any time.

    terrain_data/.venv/Scripts/python.exe terrain_data/pipeline/00_setup_check.py
"""
from __future__ import annotations

import importlib
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import UA  # noqa: E402

PACKAGES = ["numpy", "pandas", "scipy", "rasterio", "xarray", "netCDF4", "h5netcdf",
            "geopandas", "shapely", "pyproj", "pyogrio", "PIL", "requests", "tqdm", "matplotlib"]
TOOLS = ["curl", "node", "git"]
# host -> a small URL that should answer quickly. These are the hosts section 5 depends on.
HOSTS = {
    "pds-geosciences.wustl.edu": "https://pds-geosciences.wustl.edu/",
    "data.lroc.im-ldi.com": "https://data.lroc.im-ldi.com/",
    "astropedia.astrogeology.usgs.gov": "https://astropedia.astrogeology.usgs.gov/",
    "www.ngdc.noaa.gov": "https://www.ngdc.noaa.gov/thredds/catalog/global/ETOPO2022/catalog.html",
    "doi.pangaea.de": "https://doi.pangaea.de/10.1594/PANGAEA.788537",
    "webservices.volcano.si.edu": "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&request=GetCapabilities",
    "geodata.ucdavis.edu": "https://geodata.ucdavis.edu/climate/worldclim/2_1/base/",
    "neo.gsfc.nasa.gov": "https://neo.gsfc.nasa.gov/archive/geotiff.float/",
    "naciscdn.org": "https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip",
    "zenodo.org": "https://zenodo.org/",
    "en.wikipedia.org": "https://en.wikipedia.org/w/api.php",
    "power.larc.nasa.gov": "https://power.larc.nasa.gov/",
    "pubs.usgs.gov": "https://pubs.usgs.gov/sim/3292/",
}


def head(url: str, timeout: int = 12) -> str:
    """Return the HTTP status code (or 'reset'/'timeout') for a HEAD request."""
    try:
        r = subprocess.run(["curl", "-sIL", "-A", UA, "--max-time", str(timeout),
                            "-o", "NUL", "-w", "%{http_code}", url],
                           capture_output=True, text=True, timeout=timeout + 5)
        code = r.stdout.strip()
        return code if code and code != "000" else "reset"
    except subprocess.TimeoutExpired:
        return "timeout"


def main() -> int:
    ok = True
    print(f"python  {sys.version.split()[0]}  ({sys.executable})")
    if sys.version_info < (3, 11):
        ok = False
    for p in PACKAGES:
        try:
            m = importlib.import_module(p)
            print(f"  ok   {p:<12} {getattr(m, '__version__', '')}")
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f"  MISSING {p}: {e}")
    for t in TOOLS:
        where = shutil.which(t)
        print(f"  {'ok  ' if where else 'MISSING'} {t:<6} {where or ''}")
        ok = ok and bool(where)
    free_gb = shutil.disk_usage(HERE).free / 1e9
    print(f"disk    {free_gb:.0f} GB free" + ("" if free_gb > 20 else "  <-- low"))
    print("hosts   (HTTP status; 2xx/3xx/4xx all mean the host answers; reset means it does not)")
    down = []
    for host, url in HOSTS.items():
        code = head(url)
        flag = "ok  " if code[:1] in "234" else "DOWN"
        if flag == "DOWN":
            down.append(host)
        print(f"  {flag} {host:<34} {code}")
    print()
    if not ok:
        print("NO-GO: fix the missing items above")
        return 1
    if down:
        print(f"GO with fallbacks: {len(down)} host(s) not answering right now: {', '.join(down)}")
    else:
        print("GO: everything answers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
