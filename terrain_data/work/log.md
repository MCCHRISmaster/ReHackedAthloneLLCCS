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
- 2026-11-14 15:45 downloaded moon_ldem_16.lbl (0.0 MB) from https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.lbl
- 2026-11-14 15:46 downloaded moon_ldem_16.img (33.2 MB) from https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img
- 2026-11-14 15:47 downloaded moon_lpgrs_high1_elem_abundance_2deg.tab (9.9 MB) from https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab
- 2026-11-14 15:47 downloaded moon_lpgrs_high1_elem_abundance_2deg.lbl (0.0 MB) from https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.lbl
- 2026-11-14 15:47 downloaded moon_lpgrs_elem_abundance.fmt (0.0 MB) from https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_elem_abundance.fmt
- 2026-11-14 15:47 downloaded moon_pits.csv (0.2 MB) from https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/SHAPEFILE/LUNAR_PIT_LOCATIONS/LUNAR_PIT_LOCATIONS.CSV
- 2026-11-14 15:49 moon DEM: elevation -7617..8305 m, slope mean 4.9 deg
- 2026-11-14 15:57 moon DEM: elevation -7617..8305 m, slope mean 4.9 deg
- 2026-11-14 15:57 moon LP GRS: 11306 pixels painted onto 2-deg cells; 0 cells uncovered; FeO 0.0..30.7 wt%
- 2026-11-14 15:57 moon pits: 278 pits; 63 cells hold at least one
- 2026-11-14 15:57 moon DEM: elevation -7617..8305 m, slope mean 4.9 deg
- 2026-11-14 15:57 moon LP GRS: 11306 pixels painted onto 2-deg cells; 0 cells uncovered; FeO 0.0..30.7 wt%
- 2026-11-14 15:57 moon pits: 278 entries, 21 mare/highland collapse pits kept (16 mare); impact-melt pits dropped
- 2026-11-14 15:58 FAILED to download moon_robbins_2018.zip after 3 rounds over 1 mirror(s): https://astropedia.astrogeology.usgs.gov/download/Moon/Research/Craters/lunar_crater_database_robbins_2018.zip
- 2026-11-14 16:00 coordinate check against Wikipedia: {'no_wikipedia_coords': 16, 'CHECK': 8, 'ok': 11}

## Phase 1: Moon (2026-11-14 ~16:15) DONE except crater counts
- out/moon_features.csv: 16,200 rows. Columns: elevation_m, relief_m, roughness_m, slope_mean_deg (LOLA ldem_16, 33 MB, baseline ~1.9 km, east-west stride grows toward the poles),
  feo_pct, tio2_pct, th_ppm (Lunar Prospector GRS 2-deg, pixels 1-2 deg x 1.5-6 deg so coarser than the grid; high1 FeO reaches 30 wt% which is noisy but mare_idx saturates at 15),
  mare_idx (FeO 8..15 wt%), pit_n / pit_nearest_km / mare_pit_n (LROC pit atlas: only 21 of 278 are mare/highland collapse pits, 257 are impact-melt pits and are dropped),
  lavatube_idx = 0.5*mare_idx + 0.5*clip(mare_pit_n/2), illum_idx (geometric proxy), water_idx (LATITUDE PROXY: 0 below 70 deg, 1 at pole; PSR shapefiles not found).
- NOT DONE: crater_density_*_n (Robbins). astropedia.astrogeology.usgs.gov resets every request. Queued for a hotspot batch with Mars Robbins, Mars cave catalog, WorldClim. Rerun: `python -I pipeline/10_moon_features.py --force`.
- NOT FOUND (shortcuts): LROC PSR shapefiles (archive is a JS page, no listing), LOLA polar illumination (folder 404), LP hydrogen (skipped, cut-list item). Artemis III region centres: USGS ScienceBase gave 403, so centres are approximate (coord_status=approximate).
- curated/targets_moon.csv: 34 Moon targets (Artemis III regions as group "artemis-iii", Apollo, Luna, Chang'e, pits, science regions). 41_verify_coords.py checks them against Wikipedia (work/coord_check.csv): 11 ok, 8 within ~1 deg, 16 have no Wikipedia point.
- Host status at 16:10: answering now = pds-geosciences, ngdc.noaa.gov, doi.pangaea.de, naciscdn.org, neo.gsfc.nasa.gov, wikipedia, volcano.si.edu. Still resetting = astropedia.astrogeology.usgs.gov, geodata.ucdavis.edu. zenodo 403 to bare UA.
