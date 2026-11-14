# terrain_data build log

Resume note for a new session: read BUILD_PROMPT.md first, then this log. Branch `terrain-data`; never touch `main`.
Run Python as `terrain_data/.venv/Scripts/python.exe`. Model was switched to Sonnet 5.5 at the operator's request (usage limit).

## Phase 0: setup (2026-11-14 ~16:00) DONE
- venv at terrain_data/.venv; packages pinned in requirements.txt (numpy 2.5.4, pandas 3.1.1, rasterio 1.5.2, geopandas 1.2.0, scipy 1.18.1 ...).
- pipeline/dl.py (curl retries + resume + mirrors + cache in raw/), pipeline/grid.py (cell maths, self-test passes), pipeline/00_setup_check.py.
- config/features.json (draft ranges from section 6.1), presets.json, caveats.json.
- pipeline/05_mock_sites.py -> out/sites.json: nine seed sites, FAKE scores, every site flagged "mock": true. Real export (60_export.py) will overwrite it.
- Host probe at 15:5x: answering = data.lroc.im-ldi.com, webservices.volcano.si.edu, neo.gsfc.nasa.gov, en.wikipedia.org, power.larc.nasa.gov, pubs.usgs.gov.
  Reset on HEAD probe = pds-geosciences.wustl.edu, astropedia.astrogeology.usgs.gov, www.ngdc.noaa.gov, doi.pangaea.de, geodata.ucdavis.edu, naciscdn.org, zenodo.org.
  A HEAD reset does not prove a download will fail; retry with dl.py before using a fallback. Phase 1 (Moon) needs pds-geosciences first.

## Downloads (appended automatically by dl.py below)
