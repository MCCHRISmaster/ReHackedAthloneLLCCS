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
- 2026-11-14 16:04 downloaded ne_50m_land.zip (0.5 MB) from https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip
- 2026-11-14 16:04 downloaded ne_50m_admin_0_countries.zip (0.8 MB) from https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip
- 2026-11-14 16:04 downloaded ne_10m_admin_1_states_provinces.zip (14.9 MB) from https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip
- 2026-11-14 16:04 downloaded gvp_holocene_volcanoes.json (2.4 MB) from https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=json
- 2026-11-14 16:05 FAILED to download glim_05deg.tab after 1 rounds over 1 mirror(s): https://doi.pangaea.de/10.1594/PANGAEA.788537?format=textfile
- 2026-11-14 16:08 coordinate check against Wikipedia: {'no_wikipedia_coords': 32, 'CHECK': 17, 'ok': 150}
- 2026-11-14 16:10 downloaded etopo2022_60s_surface.nc (478.3 MB) from https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc
- 2026-11-14 16:10 downloaded wc2.1_10m_prec.zip (7.3 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_prec.zip
- 2026-11-14 16:10 downloaded wc2.1_10m_tavg.zip (37.4 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_tavg.zip
- 2026-11-14 16:10 downloaded wc2.1_10m_tmin.zip (37.6 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_tmin.zip
- 2026-11-14 16:10 downloaded wc2.1_10m_tmax.zip (37.4 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_tmax.zip
- 2026-11-14 16:10 downloaded wc2.1_10m_wind.zip (27.9 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_wind.zip
- 2026-11-14 16:10 downloaded wc2.1_10m_srad.zip (16.2 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_srad.zip
- 2026-11-14 16:11 downloaded wc2.1_10m_vapr.zip (27.2 MB) from https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_vapr.zip
- 2026-11-14 16:12 downloaded glim_05deg.tab (0.0 MB) from https://doi.pangaea.de/10.1594/PANGAEA.788537?format=textfile
- 2026-11-14 16:12 earth downloader finished; all files present
- 2026-11-14 16:14 earth terrain: ETOPO 2022 60s processed; land share 33.1%
- 2026-11-14 16:14 earth volcanoes: 1214 Holocene volcanoes from GVP
- 2026-11-14 16:14 earth GLiM: 0.5 deg grid, 16 classes, 23369 1-degree cells covered
- 2026-11-14 16:14 earth volcanoes: 1214 Holocene volcanoes from GVP
- 2026-11-14 16:14 earth features built; sources ['etopo2022', 'glim_v1', 'gvp_votw', 'curated_caves;curated_impacts', 'worldclim_2_1', 'natural_earth', 'earth_climate_proxy']; missing ['temperature (run 21_earth_temperature.py)']
- 2026-11-14 16:18 downloaded img_kilbourne-hole.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Kilbourne_and_Hunts_Holes_and_White_Sands.jpg/960px-Kilbourne_and_Hunts_Holes_and_White_Sands.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:18 downloaded img_craters-of-the-moon.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a3/CratersDrone1.jpg/960px-CratersDrone1.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:18 downloaded img_lava-beds.jpg (0.3 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6f/Lava_Beds_Cave_collapse_trench.jpg/960px-Lava_Beds_Cave_collapse_trench.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:18 downloaded img_mauna-kea.jpg (0.1 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8d/Mauna_Kea_from_the_ocean.jpg/960px-Mauna_Kea_from_the_ocean.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:18 downloaded img_mdrs-hanksville.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/4/49/Mars_Desert_Research_Station_2020.jpg/960px-Mars_Desert_Research_Station_2020.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:18 downloaded img_askja.jpg (0.1 MB) from https://upload.wikimedia.org/wikipedia/commons/e/e6/Askja.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled
- 2026-11-14 16:18 downloaded img_cueva-de-los-verdes.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/0/08/Har%C3%ADa_-_MNLC_-_LZ-1_-_Jameos_del_Agua_12_ies.jpg/960px-Har%C3%ADa_-_MNLC_-_LZ-1_-_Jameos_del_Agua_12_ies.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:18 downloaded img_atacama-yungay.jpg (0.5 MB) from https://upload.wikimedia.org/wikipedia/commons/7/7f/Atacama.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled
- 2026-11-14 16:18 downloaded img_lonar-crater.jpg (0.1 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/8/82/Lonar_Crater%2C_Panorama.jpg/960px-Lonar_Crater%2C_Panorama.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:19 downloaded img_athlone.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/8/87/Athlone_-_SS_Peter_and_Paul%27s_Church_-_20210809155932.jpg/960px-Athlone_-_SS_Peter_and_Paul%27s_Church_-_20210809155932.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:19 downloaded img_clonmacnoise-esker-riada.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d1/Clonmacnoise_6.jpg/960px-Clonmacnoise_6.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:19 downloaded img_apollo-16.jpg (0.3 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b3/John_W._Young_on_the_Moon.jpg/960px-John_W._Young_on_the_Moon.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:19 downloaded img_apollo-17.jpg (0.3 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ac/Eugene_Cernan_at_the_LM%2C_Apollo_17%2C_AS17-134-20378.jpg/960px-Eugene_Cernan_at_the_LM%2C_Apollo_17%2C_AS17-134-20378.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:19 downloaded img_marius-hills-pit.jpg (0.6 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6c/Marius_Hills_%28LROC-WAC_Nearside_mosaic%29.png/960px-Marius_Hills_%28LROC-WAC_Nearside_mosaic%29.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:19 downloaded img_mare-tranquillitatis-pit.jpg (0.0 MB) from https://upload.wikimedia.org/wikipedia/commons/f/fa/Mare_Tranquillitatis.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled
- 2026-11-14 16:19 curated tables enriched; 15 demo images saved locally
- 2026-11-14 16:23 downloaded moon_robbins_2018.dat (96.2 MB) from https://astrogeology.usgs.gov/ckan/dataset/f89f5478-b69a-486c-b9b5-30d7b0c5ad2b/resource/c4f25cc2-4f8a-4207-a845-5e176da3ac5a/download/lunar_crater_database_robbins_2018
- 2026-11-14 16:24 moon DEM: elevation -7617..8305 m, slope mean 4.9 deg
- 2026-11-14 16:24 moon craters: 1296796 rows from Robbins; 6973 with D>=20 km
- 2026-11-14 16:24 moon LP GRS: 11306 pixels painted onto 2-deg cells; 0 cells uncovered; FeO 0.0..30.7 wt%
- 2026-11-14 16:24 moon pits: 278 entries, 21 mare/highland collapse pits kept (16 mare); impact-melt pits dropped
- 2026-11-14 16:25 downloaded mars_megt16.img (33.2 MB) from https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img
- 2026-11-14 16:25 downloaded mars_megt16.lbl (0.0 MB) from https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.lbl
- 2026-11-14 16:25 downloaded mars_ti_night.img (25.9 MB) from https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_msk_night_2007.img
- 2026-11-14 16:25 downloaded mars_ti_night.lbl (0.0 MB) from https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_msk_night_2007.lbl
- 2026-11-14 16:25 downloaded mars_h2o_5x5.tab (0.2 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.tab
- 2026-11-14 16:25 downloaded mars_h2o_5x5.lbl (0.0 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/h2o_sr_5x5.lbl
- 2026-11-14 16:26 downloaded mars_ti_night_real.img (51.8 MB) from https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.img
- 2026-11-14 16:26 downloaded mars_ti_night_real.lbl (0.0 MB) from https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/mgst_9001/data/global_ti_night_2007.lbl
- 2026-11-14 16:27 mars DEM: elevation -7390..18822 m, slope mean 1.0 deg
- 2026-11-14 16:27 downloaded mars_robbins_p0.json (9.2 MB) from https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items?f=json&limit=20000&offset=0&sortby=-diamkm
- 2026-11-14 16:29 FAILED to download mars_robbins_p1.json after 3 rounds over 1 mirror(s): https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items?f=json&limit=20000&offset=20000&sortby=-diamkm
- 2026-11-14 16:29 mars craters: 20000 craters >= 12.1 km fetched from the USGS API
- 2026-11-14 16:29 mars TES TI: 22..4433, 360 cells blank
- 2026-11-14 16:29 mars GRS WEH: 1.7..7.4 wt%, polar rows filled from nearest valid row
- 2026-11-14 16:30 mars DEM: elevation -7390..18822 m, slope mean 1.0 deg
- 2026-11-14 16:31 downloaded mars_robbins_p1.json (9.2 MB) from https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items?f=json&limit=20000&offset=20000&sortby=-diamkm
- 2026-11-14 16:31 downloaded mars_robbins_p2.json (9.2 MB) from https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items?f=json&limit=20000&offset=40000&sortby=-diamkm
- 2026-11-14 16:31 mars craters: 60000 craters >= 3.9 km fetched from the USGS API
- 2026-11-14 16:31 mars TES TI: 22..4433, 360 cells blank
- 2026-11-14 16:31 mars GRS WEH: 1.7..7.4 wt% where valid, 7326 cells blank (polar), water_idx uses the latitude proxy there
- 2026-11-14 16:33 downloaded mars_sim3292_database.zip (808.9 MB) from https://pubs.usgs.gov/sim/3292/downloads/sim3292_database.zip
- 2026-11-14 16:35 mars DEM: elevation -7390..18822 m, slope mean 1.0 deg
- 2026-11-14 16:35 mars craters: 60000 craters >= 3.9 km fetched from the USGS API
- 2026-11-14 16:35 mars TES TI: 22..4433, 360 cells blank
- 2026-11-14 16:35 mars GRS WEH: 1.7..7.4 wt% where valid, 7326 cells blank (polar), water_idx uses the latitude proxy there
- 2026-11-14 16:36 mars geology: 1311 polygons, 8 groups; mean coverage 100% of cells
- 2026-11-14 16:36 coordinate check against Wikipedia: {'ok': 6, 'CHECK': 17, 'no_wikipedia_coords': 2}
- 2026-11-14 16:36 downloaded img_jezero.jpg (1.0 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/Perseverance%27s_First_Full-Color_Look_at_Mars.png/960px-Perseverance%27s_First_Full-Color_Look_at_Mars.png?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:36 downloaded img_gale.jpg (0.1 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5b/Curiosity_Cradled_by_Gale_Crater.jpg/960px-Curiosity_Cradled_by_Gale_Crater.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:36 downloaded img_meridiani-planum.jpg (0.1 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Sol322B.Smooth.Sheet.bedforms.close.to.heat.shield.crp.jpg/960px-Sol322B.Smooth.Sheet.bedforms.close.to.heat.shield.crp.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:37 downloaded img_oxia-planum.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8f/Oxia_Planum_near_Coogoon_Vallis_by_HiRise.jpg/960px-Oxia_Planum_near_Coogoon_Vallis_by_HiRise.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:37 downloaded img_phoenix-green-valley.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6a/Phoenix_landing.jpg/960px-Phoenix_landing.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:37 downloaded img_arcadia-planitia-ice.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cd/Arcadia_Planitia_-_topography_map.jpg/960px-Arcadia_Planitia_-_topography_map.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:37 downloaded img_deuteronilus-mensae.jpg (0.2 MB) from https://thumb.wikimedia.org/wikipedia/commons/thumb/7/71/Mapdeuteronilus.jpg/960px-Mapdeuteronilus.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail
- 2026-11-14 16:37 downloaded img_hebrus-valles.jpg (0.0 MB) from https://upload.wikimedia.org/wikipedia/commons/e/e2/Hebrus_Valles.JPG?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled
- 2026-11-14 16:37 downloaded img_arsia-mons-skylights.jpg (0.1 MB) from https://upload.wikimedia.org/wikipedia/commons/b/bf/Arsia_Mons_PIA02804.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled
- 2026-11-14 16:37 curated tables enriched; 24 demo images saved locally

## Phase 1b: Moon crater counts DONE (16:35)
- Robbins 2018 bundle (96 MB) came from astrogeology.usgs.gov/ckan (astropedia host stays down). crater_density_5km_n and _20km_n now filled. 20 km counts are quantised at 2-degree cells (median 0); scoring uses the 5 km column.

## Phase 2: Earth (2026-11-14 ~16:20-16:45) DONE except temperatures
- Sources downloaded: ETOPO 2022 60 s (478 MB, ngdc), GLiM 0.5 deg (zip with ASCII grid, 38 KB, PANGAEA, arrived on the downloader's 2nd pass), GVP Holocene volcanoes (2.4 MB), Natural Earth land/admin0/admin1, WorldClim 2.1 10 min (7 zips, biogeo.ucdavis.edu mirror worked when geodata.ucdavis.edu did not).
- NEO is gone: neo.gsfc.nasa.gov returns an HTML page for every data URL. So NO NDVI, aerosol, snow, MODIS LST. Stand-ins (labelled PROXY): barren_pct = clip((250 - precip)/250) x 100; dust_idx = barren x (0.5 + 0.5 clip(wind/6)); permafrost_idx from tavg thresholds (spec fallback); ice_idx = max(lith_ice, permafrost).
- GLiM is one dominant class per 0.5-degree cell, so lith_*_pct move in steps of 25 percent per 1-degree cell.
- out/earth_features_1deg.csv (11.5 MB, 22,513 land rows, 47 feature columns) and earth_features_2deg.csv (6,207 land cells). 2-degree = land-area-weighted mean of the four 1-degree cells.
- Temperature: replaced the MODIS fallback with a full NASA POWER pull (same dataset as the team, 440 land boxes x 3 parameters, cache in raw/power, parallel 6 workers). Writes out/earth_grid_power_full.csv and out/earth_grid_filled.csv, then re-run 20_earth_features.py --force to add temp_* columns.
- curated/: analog_sites (69 rows), caves (51), impact_structures (76), irish_sites (3) written from my own knowledge; 41_verify_coords.py checked them against Wikipedia: 150 of 199 within 25 km, 17 within 100 km (regions), 2 fixed (Mistastin latitude, Galapagos title). 40_curated_tables.py adds Wikipedia URL/picture/credit; 24 demo pictures saved to out/images (3.5 MB).
- Cave table is a curated sample of 51 caves, so cave_nearest_* describe nearness to a listed cave, not to all caves. Sardinia ESA CAVES entry (Su Bentu-Sa Oche) has unconfirmed coordinates; the prompt called it "Sa Grutta".

## Phase 3: Mars (2026-11-14 ~16:50) DONE except cave catalog
- out/mars_features.csv: MOLA megt16 (note: file is megt90n000eb.img, not fb), Robbins crater DB through the USGS pygeoapi (sorted by diameter, 20k per page, 5 km+), TES night thermal inertia (global_ti_night_2007.img; dust_cover_idx proxy), Odyssey GRS 5x5 H2O (valid only equatorward of ~60 deg; poles left blank in weh_pct; water_idx = max(scaled weh, latitude proxy)), SIM 3292 geology shapefile (809 MB zip, 8 unit groups, every cell sums to 100 percent), lavatube_idx PROXY (0.6 volcanic share + 0.4 closeness to Tharsis/Olympus skylight volcanoes).
- NOT DONE: Mars cave catalog (astropedia host down; astrogeology.usgs.gov/search/map/mars_cave_catalog resets). Mars dust storms (MDAD, cut-list item). TES albedo.
- curated/targets_mars.csv: 25 Mars targets; out/targets.csv has 60 rows (35 Moon + 25 Mars).
- 2026-11-14 16:43 curated tables enriched; 24 demo images saved locally
- 2026-11-14 16:48 earth GLiM: 0.5 deg grid, 16 classes, 23369 1-degree cells covered
- 2026-11-14 16:48 earth volcanoes: 1214 Holocene volcanoes from GVP
- 2026-11-14 16:49 earth features built; sources ['etopo2022', 'glim_v1', 'gvp_votw', 'curated_caves;curated_impacts', 'worldclim_2_1', 'natural_earth', 'earth_climate_proxy']; missing ['temperature (run 21_earth_temperature.py)']
- 2026-11-14 16:50 curated tables enriched; 24 demo images saved locally

## Phase 4: scoring and export (2026-11-14 ~16:50)
- config/features.json: 21 comparisons, min_available 10. config/presets.json: raw/crewed/base/rover (human weights). config/caveats.json.
- pipeline/score_core.py (Python) and js/score.js (browser/Node) implement the same rules; js/test_score.mjs runs pairs for 70_validate.py. Agreement is better than 1e-7 on ten pairs. Full-grid pass in Node: ~60 ms (Earth place vs all Mars cells), ~210 ms (Mars target vs all Earth cells).
- 50_score.py -> out/matches.json (4 MB): per target and preset top 25 cells, top 10 sites, surprise list; per site x target overall, 4 presets, raw dims, coverage; losses and alternatives for each site's 5 best targets per body plus the demo targets.
- Fixes found by checking: Vulcano scored 88 from a single comparison (added min_available), island sites had no features (earth_features_all.npz holds 1-25 percent land cells for site lookups), Lanzarote and Vulcano have no GLiM class (curated lith_override = basic_volcanic for timanfaya, cueva-de-los-verdes, vulcano), Shackleton id renamed from shackleton-crater to match the globe's seed id.
- 60_export.py -> out/sites.json (132 entries, 4 MB), targets.json, sites.csv, sources.csv, presets.json, caveats.json.
- 70_validate.py -> out/validation.md. Hard checks pass.
- Documents written: README, METHODS, DATA_SOURCES, AI_USAGE, HANDOFF. demo/index.html is a full detail page: http://localhost:8000/terrain_data/demo/index.html?id=athlone
- Pending when this was written: NASA POWER temperature pull (cache raw/power, 1320 requests). When it finishes: 20_earth_features.py --force, 50_score.py, 60_export.py, 70_validate.py, then review the rankings in validation.md section 3 and tune ranges if the classics rank badly (record every change in METHODS.md).
- 2026-11-14 17:09 POWER temperature pull: 440 boxes, 1 failed requests
- 2026-11-14 17:10 POWER temperature pull: 440 boxes, 0 failed requests
- 2026-11-14 17:10 earth GLiM: 0.5 deg grid, 16 classes, 23369 1-degree cells covered
- 2026-11-14 17:10 earth volcanoes: 1214 Holocene volcanoes from GVP
- 2026-11-14 17:10 earth features built; sources ['etopo2022', 'glim_v1', 'gvp_votw', 'curated_caves;curated_impacts', 'worldclim_2_1', 'nasa_power_clim', 'natural_earth', 'earth_climate_proxy']; missing []
- 2026-11-14 17:37 POWER temperature pull: 648 boxes, 0 failed requests
- 2026-11-14 17:38 earth GLiM: 0.5 deg grid, 16 classes, 23369 1-degree cells covered
- 2026-11-14 17:38 earth volcanoes: 1214 Holocene volcanoes from GVP
- 2026-11-14 17:38 earth features built; sources ['etopo2022', 'glim_v1', 'gvp_votw', 'curated_caves;curated_impacts', 'worldclim_2_1', 'nasa_power_clim', 'natural_earth', 'earth_climate_proxy']; missing []

## Final run (2026-11-14 ~17:50) DONE
- NASA POWER pull completed for all 648 boxes (ocean included): out/earth_grid_power_full.csv and out/earth_grid_filled.csv have a value in all 16,200 cells and pass prototype/tools/csv_to_grid.py --check. 1 request failed in the land pull (30-40N, 90-100E, Qaidam) and was retried successfully.
- 20_earth_features.py --force (50 feature columns incl. temp_*), 50_score.py, 60_export.py, 70_validate.py: all hard checks PASS (structure, sources, team checker x4, JS vs Python on 10 pairs, Athlone card).
- Tuning: volcanic range 0.7 -> 1.0 (METHODS.md section 8). Findings of the classic-analog table in METHODS.md section 9.
- Athlone: 44 raw vs Jezero, 19 vs Shackleton; biggest loss is rainfall (1,058 mm a year vs bone dry). All 132 sites.json entries carry eight score keys.
- NOT DONE, needs the operator: wiring sites.json and the eighth bar into the globe (teammate files; text patch in HANDOFF.md), pushing the branch, opening a pull request.
- Detail pages: http://localhost:8000/terrain_data/demo/index.html?id=athlone and .../demo/live.html (server: node prototype/server.js . 8000 from the repo root).
- 2026-11-14 23:19 downloaded moon_lpgrs_high1_elem_abundance_2deg.tab (9.9 MB) from https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/lpgrs_high1_elem_abundance_2deg.tab
- 2026-11-14 23:19 moon soil (LP GRS): Fe 0.0..23.9 wt%, Th 0.0..11.6 ppm, 0 cells uncovered
- 2026-11-14 23:19 downloaded mars_fe_5x5.tab (0.2 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/fe_sr_5x5.tab
- 2026-11-14 23:19 downloaded mars_si_5x5.tab (0.2 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/si_sr_5x5.tab
- 2026-11-14 23:19 downloaded mars_k_5x5.tab (0.2 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/k_sr_5x5.tab
- 2026-11-14 23:19 downloaded mars_th_5x5.tab (0.2 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/th_sr_5x5.tab
- 2026-11-14 23:19 downloaded mars_cl_5x5.tab (0.2 MB) from https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/odgm_xxxx/data/smoothed/cl_sr_5x5.tab
- 2026-11-14 23:19 mars soil (Odyssey GRS): fe_pct 10.89..19.17 (7326 blank), si_pct 18.15..22.05 (7326 blank), k_pct 0.07..0.56 (360 blank), th_ppm 0.17..0.94 (360 blank), cl_pct 0.22..0.79 (7326 blank)
- 2026-11-14 23:19 downloaded soilgrids_clay_0-5cm_3600.tif (2.2 MB) from https://maps.isric.org/mapserv?map=/map/clay.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=clay_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:19 earth SoilGrids clay 0-5 cm: soilgrids_clay_0-5cm_3600.tif, 2.87..56.45, 18072 1-degree cells
- 2026-11-14 23:19 downloaded soilgrids_silt_0-5cm_3600.tif (2.3 MB) from https://maps.isric.org/mapserv?map=/map/silt.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=silt_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:19 earth SoilGrids silt 0-5 cm: soilgrids_silt_0-5cm_3600.tif, 4.49..67.81, 18072 1-degree cells
- 2026-11-14 23:19 downloaded soilgrids_sand_0-5cm_3600.tif (2.4 MB) from https://maps.isric.org/mapserv?map=/map/sand.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=sand_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:19 earth SoilGrids sand 0-5 cm: soilgrids_sand_0-5cm_3600.tif, 3.63..91.96, 18072 1-degree cells
- 2026-11-14 23:19 downloaded soilgrids_soc_0-5cm_3600.tif (2.7 MB) from https://maps.isric.org/mapserv?map=/map/soc.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=soc_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:19 earth SoilGrids soc 0-5 cm: soilgrids_soc_0-5cm_3600.tif, 0.00..365.67, 50040 1-degree cells
- 2026-11-14 23:19 downloaded soilgrids_phh2o_0-5cm_3600.tif (1.1 MB) from https://maps.isric.org/mapserv?map=/map/phh2o.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=phh2o_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:19 earth SoilGrids phh2o 0-5 cm: soilgrids_phh2o_0-5cm_3600.tif, 3.85..8.90, 18068 1-degree cells
- 2026-11-14 23:20 downloaded soilgrids_bdod_0-5cm_3600.tif (1.5 MB) from https://maps.isric.org/mapserv?map=/map/bdod.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=bdod_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:20 earth SoilGrids bdod 0-5 cm: soilgrids_bdod_0-5cm_3600.tif, 0.34..1.66, 18019 1-degree cells
- 2026-11-14 23:20 downloaded soilgrids_cfvo_0-5cm_3600.tif (2.2 MB) from https://maps.isric.org/mapserv?map=/map/cfvo.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=cfvo_0-5cm_mean&FORMAT=GEOTIFF_INT16&SUBSET=long(-180,180)&SUBSET=lat(-90,90)&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long(3600),lat(1800)
- 2026-11-14 23:20 earth SoilGrids cfvo 0-5 cm: soilgrids_cfvo_0-5cm_3600.tif, 0.26..39.22, 18069 1-degree cells
- 2026-11-14 23:20 moon soil (LP GRS): Fe 0.0..23.9 wt%, Th 0.0..11.6 ppm, 0 cells uncovered
- 2026-11-14 23:20 mars soil (Odyssey GRS): fe_pct 10.89..19.17 (7326 blank), si_pct 18.15..22.05 (7326 blank), k_pct 0.07..0.56 (360 blank), th_ppm 0.17..0.94 (360 blank), cl_pct 0.22..0.79 (7326 blank)
- 2026-11-14 23:21 earth SoilGrids clay 0-5 cm: soilgrids_clay_0-5cm_3600.tif, 2.87..56.45, 18072 1-degree cells
- 2026-11-14 23:21 earth SoilGrids silt 0-5 cm: soilgrids_silt_0-5cm_3600.tif, 4.49..67.81, 18072 1-degree cells
- 2026-11-14 23:21 earth SoilGrids sand 0-5 cm: soilgrids_sand_0-5cm_3600.tif, 3.63..91.96, 18072 1-degree cells
- 2026-11-14 23:21 earth SoilGrids soc 0-5 cm: soilgrids_soc_0-5cm_3600.tif, 1.48..380.10, 18019 1-degree cells
- 2026-11-14 23:21 earth SoilGrids phh2o 0-5 cm: soilgrids_phh2o_0-5cm_3600.tif, 3.85..8.90, 18068 1-degree cells
- 2026-11-14 23:21 earth SoilGrids bdod 0-5 cm: soilgrids_bdod_0-5cm_3600.tif, 0.34..1.66, 18019 1-degree cells
- 2026-11-14 23:21 earth SoilGrids cfvo 0-5 cm: soilgrids_cfvo_0-5cm_3600.tif, 0.26..39.22, 18069 1-degree cells
- 2026-11-14 23:21 moon soil (LP GRS): Fe 0.2..23.9 wt%, Th 0.0..11.6 ppm, 1 cells uncovered
- 2026-11-14 23:21 mars soil (Odyssey GRS): fe_pct 10.89..19.17 (7326 blank), si_pct 18.15..22.05 (7326 blank), k_pct 0.07..0.56 (360 blank), th_ppm 0.17..0.94 (360 blank), cl_pct 0.22..0.79 (7326 blank)
- 2026-11-14 23:21 earth SoilGrids clay 0-5 cm: soilgrids_clay_0-5cm_3600.tif, 2.87..56.45, 18072 1-degree cells
- 2026-11-14 23:21 earth SoilGrids silt 0-5 cm: soilgrids_silt_0-5cm_3600.tif, 4.49..67.81, 18072 1-degree cells
- 2026-11-14 23:21 earth SoilGrids sand 0-5 cm: soilgrids_sand_0-5cm_3600.tif, 3.63..91.96, 18072 1-degree cells
- 2026-11-14 23:21 earth SoilGrids soc 0-5 cm: soilgrids_soc_0-5cm_3600.tif, 1.48..380.10, 18019 1-degree cells
- 2026-11-14 23:21 earth SoilGrids phh2o 0-5 cm: soilgrids_phh2o_0-5cm_3600.tif, 3.85..8.90, 18068 1-degree cells
- 2026-11-14 23:21 earth SoilGrids bdod 0-5 cm: soilgrids_bdod_0-5cm_3600.tif, 0.34..1.66, 18019 1-degree cells
- 2026-11-14 23:21 earth SoilGrids cfvo 0-5 cm: soilgrids_cfvo_0-5cm_3600.tif, 0.26..39.22, 18069 1-degree cells
- 2026-11-15 00:04 mars gases: pp_co2 nan..nan Pa, ozone nan DU max, dust tau nan mean
- 2026-11-15 00:04 earth gases: TO3 3213 POWER points, 249..270
- 2026-11-15 00:04 earth gases: AOD_55 900 POWER points, 0..0
- 2026-11-15 00:20 mars gases: pp_co2 231..1067 Pa, ozone nan DU max, dust tau nan mean
- 2026-11-15 00:21 earth gases: TO3 98668 POWER points, 242..382
- 2026-11-15 00:21 earth gases: AOD_55 30500 POWER points, 0..1.05
- 2026-11-15 00:23 earth gases: POWER TO3/AOD_55 boxes downloaded 160, failed 0
- 2026-11-15 00:23 earth gases: POWER TO3/AOD_55 boxes downloaded 160, failed 0
