"""Download every Earth source in the background, cycling until each succeeds.

The network drops hosts at random, so this keeps going through the list in passes (each file
tries all its mirrors, resumes partial downloads, then waits and tries again) for up to
--minutes minutes. Files already finished are skipped. Progress goes to work/earth_dl.out and
work/log.md. Run in the background:

    python -I pipeline/20a_download_earth.py --minutes 90
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from dl import fetch, _log  # noqa: E402

NGDC = "https://www.ngdc.noaa.gov"
WC = "wc2.1_10m_{v}.zip"
JOBS: list[tuple[str, list[str]]] = [
    # (cached file name, ordered mirror list)
    ("ne_50m_land.zip", ["https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip"]),
    ("ne_50m_admin_0_countries.zip", ["https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"]),
    ("ne_10m_admin_1_states_provinces.zip", ["https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"]),
    ("gvp_holocene_volcanoes.json", [
        "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature"
        "&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=json"]),
    ("glim_05deg.tab", ["https://doi.pangaea.de/10.1594/PANGAEA.788537?format=textfile"]),
    ("etopo2022_60s_surface.nc", [
        f"{NGDC}/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc",
        f"{NGDC}/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc"]),
] + [
    (f"wc2.1_10m_{v}.zip", [
        f"https://geodata.ucdavis.edu/climate/worldclim/2_1/base/{WC.format(v=v)}",
        f"https://biogeo.ucdavis.edu/data/worldclim/v2.1/base/{WC.format(v=v)}"])
    for v in ("prec", "tavg", "tmin", "tmax", "wind", "srad", "vapr")
]


def main() -> None:
    minutes = 90
    if "--minutes" in sys.argv:
        minutes = int(sys.argv[sys.argv.index("--minutes") + 1])
    deadline = time.time() + minutes * 60
    pending = list(JOBS)
    passes = 0
    while pending and time.time() < deadline:
        passes += 1
        print(f"=== pass {passes}: {len(pending)} file(s) pending", flush=True)
        still = []
        for name, urls in pending:
            got = fetch(urls, name, rounds=1, timeout=1500, quiet=True)
            print(f"  {'ok     ' if got else 'PENDING'} {name}", flush=True)
            if not got:
                still.append((name, urls))
        pending = still
        if pending:
            time.sleep(45)
    left = [n for n, _ in pending]
    print("DONE" if not left else f"GAVE UP on: {left}", flush=True)
    _log("earth downloader finished" + (f"; still missing: {left}" if left else "; all files present"))


if __name__ == "__main__":
    main()
