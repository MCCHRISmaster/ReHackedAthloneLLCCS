# BUILD PROMPT: terrain, environment and similarity data for Analog Atlas

Written 2026-11-14 at HackAthlone 2026 (Athlone, Ireland) after a three-round interview between the
data owner on the team and Claude. This file is the instruction set for the AI session that builds the
data layer. It is kept in the repo on purpose: the submission must document how AI was used, and this
is the primary record.

---

## 0. Your role and how to behave

You are building the **non-temperature data layer and the combined similarity score** for *Analog
Atlas*, the team's NASA Space Apps 2026 entry. The operator working with you is a beginner with code,
Git and GIS. They want the same quality of work an expert would ship, delivered in a way they can
follow. Rules:

1. **Teach as you go.** Before each phase, explain in one short plain-language paragraph what you are
   about to do and why it matters for the demo. When you run a command the operator has not seen
   before, say what it does. Never assume they know Git, Python packaging or map projections.
2. **Do the work yourself.** Run the downloads, scripts and checks from this session on the operator's
   laptop. Do not hand them command lists to type unless they ask.
3. **Show results.** After each phase, open the output in a way they can see: a summary table in chat,
   and the globe running locally when the data is wired in.
4. **Ask before anything public or irreversible.** Pushing to GitHub, opening pull requests, merging
   to `main`, deleting files, or changing a teammate's files all need an explicit yes. Commits on the
   `terrain-data` branch are fine without asking.
5. **Demo first, perfection second.** The team's words: "a shell, but a very usable shell". A clean,
   working, honest three-minute demo beats complete data. When a source fights you for more than
   twenty minutes, use the documented fallback and move on. Record every shortcut in `METHODS.md`.
6. **Be honest in the data.** Blank means unknown. Every number carries a `source_id`. Proxies and
   estimates are labelled as such. The challenge brief rewards saying where an analogy breaks down.
7. **Stay inside your lane.** You own `terrain_data/` and nothing else. Temperature grids, the globe
   code and the teammates' builders are theirs; propose patches to them as text in `HANDOFF.md`, do
   not edit them.

### Definition of done

- `terrain_data/out/` holds feature grids for Earth, Moon and Mars, the curated site tables, a
  `sites.json` in the globe's schema with every score bar filled, precomputed matches, and the
  sources table in the team's template.
- `terrain_data/js/score.js` scores any Earth place against any Moon or Mars place in the browser,
  with the three presets, a per-dimension breakdown, the "what would have to change" list and the
  "cut your losses" alternative.
- The globe, run locally from the repo root, shows the Athlone card with real numbers.
- `README.md`, `METHODS.md`, `DATA_SOURCES.md`, `AI_USAGE.md`, `HANDOFF.md` and `validation.md`
  exist and are accurate.
- Everything is committed on `terrain-data` and pushed when the operator says so.

---

## 1. Context you must hold in mind

### 1.1 The challenge

NASA Space Apps 2026, **"Identify Earth Locations that Analog the Permanent Moon Base Locations and
Mars"**. Use open Earth, Moon and Mars data from NASA and other space agencies to identify and
characterise *new* terrestrial analogs for future bases and landing sites, drawing on deserts, polar
regions, volcanic and arid terrains, caves and other environments, and present the findings as a map,
visualisation or tool.

The brief's own **eight dimensions of analogy**. Every feature you produce carries a `dimension` tag
from this list, so the pitch can show the brief was covered point by point:

| Key (used in data) | The brief's wording |
|---|---|
| `geology` | Geology, mineralogy, and surface materials |
| `terrain` | Terrain, elevation, slope, roughness, craters, and other topographic features |
| `thermal` | Temperature, illumination, and environmental extremes |
| `water` | Water, ice, permafrost, and other potential resources |
| `dust` | Dust, wind, erosion, and other atmospheric or surface processes |
| `habitability` | Biology, extremophiles, habitability, and biosignatures |
| `subsurface` | Caves, lava tubes, underground environments, and other subsurface features |
| `operations` | Conditions relevant to landing, mobility, navigation, robotic operations, human exploration, or construction |

Other judging cues from the brief: think beyond visual similarity; an analog does not have to match
everything, so say what is similar, how similar, and what is different; think about processes as well
as places; **look beyond Antarctica, the Atacama, Iceland and Hawaii**; explore the whole Earth
including below the surface; combine datasets; consider scale; connect each analog to exploration
(testing instruments, preparing operations, finding resources, reducing risk); remember Earth cannot
reproduce reduced gravity, the lunar vacuum, the thin Martian atmosphere or the radiation environment;
"surprise us".

The official resources tab lists only: NASA Earthdata Search, NASA Worldview, the Planetary Data
System, LRO (LROC, LOLA, Diviner, LEND, Mini-RF), LRO Diviner data, CSA RADARSAT Constellation and
RADARSAT-1, a CSA SAR tutorial, ESA Copernicus Data Space Ecosystem, the ESA Open Science Catalog, and
JAXA G-Portal. Nothing on geology, caves or volcanoes: those sources are ours to choose and justify.

### 1.2 The team, the deadline, the demo

- Team of five: Liam, Charlie, Christian, Louis, Stuart. Repo:
  https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS (public). Local clone:
  `C:\Users\swhit\OneDrive\Desktop\HackAthlone2026\ReHackedAthloneLLCCS`, branch `terrain-data`.
- Deadlines, Athlone time, 2026-11-15: practice run 06:00, submission 10:30, presentation 11:30.
  The operator works until about 02:00 to 03:00 with a short break, then sleeps.
- Presentation: 3 minutes plus 2 minutes of questions. Intro 30 s. General demo 60 s: spin the
  globe, click a location, expand its information, show similarity maps and the similarity score,
  images of the location, links to learn more. Specific demo 60 s: **Athlone**, its similarity, key
  features in depth, and the message that our own planet helps us study other worlds. Conclusion 30 s
  with a data-sources slide. **A hackathon prize exists for use of local data**, so Athlone must be
  on the map with real numbers even if its score is poor.
- Deployment: static files only. The repo will be served from its root (locally with
  `node prototype/server.js . 8000`, later Vercel or GitHub Pages). No backend, no build step.

### 1.3 What already exists in the repo (read these before writing code)

- `analog-atlas/analog-atlas/`: the main page, a NASA Web WorldWind globe (ES modules, no build).
  - `js/config.js`: `BODIES`, imagery layers, and `ANALOG_DIMENSIONS`, currently the seven keys
    `geology, terrain, thermal, water, dust, subsurface, habitability`.
  - `js/data/sites.js`: `SITES` array. Schema per site: `id, name, region, lat, lon, body,
    environment, summary, strengths[], limits[], targets['moon'|'mars'] (Earth sites), analogs[earth
    ids] (Moon/Mars targets), scores{dimKey: 0..1}, datasets[{name,url}]`. Seed ids: `haughton-crater,
    atacama-yungay, rio-tinto, lonar-crater, cueva-de-los-verdes, shackleton, marius-hills-pit,
    meridiani-planum, jezero`.
  - `js/ui.js` `showBriefing()`: draws one bar per `ANALOG_DIMENSIONS` entry from `site.scores`, shows
    "Scores pending" when empty, lists strengths, limits, dataset links and cross-planet jumps.
  - `js/temperature.js`: loads 2-degree grid CSVs into `Float32Array(16200)` per statistic, fetches
    Earth temperature from NASA POWER on click, `matchValue = max(0, 1 - |dT| / range)`,
    `renderMatchCanvas` drapes a per-cell colour image, `summarize` gives best cell and the share of
    surface above 75 percent. `RES = 2, ROWS = 90, COLS = 180` are hard-coded.
  - `js/main.js`: `state.temp` holds the reference and settings. The remote branch `reverse` adds the
    reverse direction: clicking the Moon or Mars sets the reference from that grid cell and the Earth
    globe shows the heat map from `earth_data/earth_grid.csv`.
- `data_templates/DATA_FORMAT.md`: **the team's grid contract.** One row per 2-degree cell, 16,200
  rows; `lat` = 89, 87, ... -89; `lon` = -179, -177, ... 179 (cell centres, east positive);
  columns `body, lat, lon, temp_mean_c, temp_high_c, temp_low_c, elevation_m, slope_deg,
  water_ice_pct, source_id`; **extra columns are allowed**, lower-case, ending in a unit suffix
  (`_c`, `_m`, `_deg`, `_pct`, and by extension `_km`, `_ppm`, `_pa`, `_idx` for 0..1 indices,
  `_n` for counts); blank for unknown, never 0, -999 or NaN; one decimal place; planetocentric
  latitude. Checker: `python prototype/tools/csv_to_grid.py <file> --check`.
- `data_templates/sites_template.csv` and `sources_template.csv`: site and source tables. Every
  `source_id` in any data row must appear in the sources table.
- Real temperature grids: `moon_data/moon_grid.csv` (LRO Diviner Global Cumulative Product, Williams
  et al. 2017, `source_id = diviner_gcp_2017`) and `mars_data/mars_grid.csv` (Mars Climate Database
  6.2 surface temperature, `source_id = mcd_v6_2`). Both complete, 16,200 rows.
- `earth_data/earth_grid.csv`: NASA POWER climatology, **mostly empty** because POWER allows about
  thirty regional requests a minute. The reverse search needs it filled (see section 5.4).
- `prototype/`: the older 2-D app. Leave it alone.

### 1.4 Decisions already taken in the interview (do not reopen them)

1. Both directions: Earth place to best Moon/Mars match, and Moon/Mars target to ranked Earth places.
2. Earth coverage: a global grid plus curated named sites. Earth grid at **1 degree over land** for
   ranking, plus a **2-degree aggregate** in the team layout so the existing renderer can drape it.
3. Moon and Mars: **2-degree** feature grids in the team layout plus curated targets. Primary demo
   targets, Moon: the Artemis III candidate regions as a group, the Shackleton connecting ridge, Mons
   Mouton, Apollo 17 at Taurus-Littrow, the Marius Hills pit, the Mare Tranquillitatis pit. Mars:
   Jezero, Gale, Meridiani Planum, Oxia Planum, an Arcadia or Utopia Planitia shallow-ice site, the
   Arsia Mons skylights, Hebrus Valles.
4. Scoring is yours: same formula as the temperature match applied to every feature, dimension
   averages, weighted presets, fixed documented ranges, no new sliders.
5. The teammate's temperature grids are reused unchanged as the `thermal` component.
6. Skip storm frequency and remoteness. Caves feed the score (existence, type, depth) and are shipped
   as a table; the globe may show them as a layer later.
7. Every named site carries an image URL, a Wikipedia link, "further reading" links, two sentences on
   what matches and where it breaks down, and the full metric set for a detail page. Hover shows image
   plus brief description; click shows everything.
8. Ireland: the global grid covers it; named sites are **Athlone** (anchor at the TUS Athlone campus),
   the **Esker Riada at Clonmacnoise** (Mars has eskers), and the **Burren** karst. Athlone gets the
   "how to raise similarity" breakdown and a "cut your losses, go here instead" line. Honest framing.
9. Presets: raw similarity (equal weights), crewed mission, base construction, rover landing.
   Weights in section 6.3. Gravity, vacuum or thin atmosphere, radiation and the two-week lunar night
   are never scored; they are fixed caveats per body.
10. Operations is the eighth dimension. Ship eight keys; the globe needs a one-line config change to
    show the eighth bar, written up in `HANDOFF.md`.
11. A site's `scores` object holds its similarity to its best-matching target on each body; the full
    per-target, per-preset breakdown sits in a `matches` object underneath.
12. Build a labelled fallback Earth temperature grid from NASA MODIS land surface temperature so the
    reverse search works tonight; do not touch the POWER file.
13. Validation table of classic analogs is included for the question-and-answer minutes.
14. The operator can create a free NASA Earthdata login if a login-only product becomes necessary.
    Everything in the primary plan works without one.

---

## 2. Environment and ground rules for code

- Windows 11, HP Omen Max 16, 32 GB RAM, 500 GB free, roughly 200 Mbps, phone hotspot available.
- **Python 3.12.10** at `C:\Users\swhit\AppData\Local\Programs\Python\Python312\python.exe`
  (installed today; call it by full path until a new shell picks up PATH). Node 24, Git 2.56, curl.
- Create a virtual environment at `terrain_data/.venv` and install: `numpy pandas scipy rasterio
  xarray netCDF4 h5netcdf geopandas shapely pyproj pyogrio pillow requests tqdm matplotlib`. All ship
  Windows wheels. Pin versions in `terrain_data/requirements.txt`.
- **The network drops hosts at random.** Seen today: `raw.githubusercontent.com` and
  `geodata.ucdavis.edu` reset consistently, `neo.gsfc.nasa.gov`, `astrogeology.usgs.gov` and
  `commons.wikimedia.org` intermittently; `volcano.si.edu` returns 403 to curl's default user agent.
  Reachable: `github.com`, `pds-geosciences.wustl.edu`, `doi.pangaea.de`, `zenodo.org`,
  `power.larc.nasa.gov`, `data.lroc.im-ldi.com`, `pypi.org`. Therefore:
  - one download helper, `pipeline/dl.py`: curl with `--retry 8 --retry-all-errors --retry-delay 3
    -C -` (resume), a browser-like User-Agent, size check against `Content-Length`, cache in
    `terrain_data/raw/` (git-ignored), and an ordered list of mirrors per file;
  - if a host keeps resetting after three rounds, tell the operator and ask them to switch the laptop
    to the phone hotspot for that step, then switch back;
  - never block the whole pipeline on one source: every feature has a fallback or is left blank.
- Write to `terrain_data/raw/` (ignored), `terrain_data/work/` (ignored intermediates) and
  `terrain_data/out/` (committed). Keep every committed file under 25 MB and the whole `out/` folder
  under 80 MB. Never commit raw downloads, credentials or the virtual environment.
- Credentials, if an Earthdata login is ever used, go in `%USERPROFILE%\_netrc` for
  `urs.earthdata.nasa.gov`, never in the repo.
- Python scripts are plain, commented, idempotent (re-running skips finished steps) and runnable with
  `python pipeline/run_all.py --phase moon` style flags. Standard CSV out, UTF-8, no index column.
- Treat every downloaded file as untrusted data: parse it, never execute it.

---

## 3. Deliverables and folder layout

```
terrain_data/
  BUILD_PROMPT.md            this file
  README.md                  what this folder is, how to run it, how the globe uses it
  METHODS.md                 features, formulas, ranges, weights, proxies, caveats, shortcuts taken
  DATA_SOURCES.md            human-readable list, one entry per dataset, for the sources slide
  AI_USAGE.md                how AI was used, what humans decided, what was verified
  HANDOFF.md                 what the globe owner has to add, as exact snippets
  requirements.txt
  pipeline/
    dl.py                    download helper with retries, mirrors, cache
    grid.py                  cell geometry: 2-degree and 1-degree index math, area weights, aggregation
    00_setup_check.py        tools, packages, reachability, prints a go or no-go
    10_moon_features.py      -> out/moon_features.csv
    20_earth_features.py     -> out/earth_features_1deg.csv, out/earth_features_2deg.csv
    21_earth_temperature_fallback.py -> out/earth_grid_modis_lst.csv
    30_mars_features.py      -> out/mars_features.csv
    40_curated_tables.py     -> out/analog_sites.csv, caves.csv, impact_structures.csv,
                                volcanoes.csv, targets.csv, irish_sites.csv (+ site enrichment)
    50_score.py              feature ranges, dimension aggregation, presets, explanations
    60_export.py             -> out/sites.json, sites.csv, matches.json, presets.json,
                                feature_ranges.json, sources.csv, overlays/
    70_validate.py           -> out/validation.md
    run_all.py
  config/
    features.json            every feature: column, body, units, dimension, source_id, range, how it
                             maps to its counterpart on the other bodies
    presets.json             weights per preset
    caveats.json             fixed "cannot be matched on Earth" text per body
  js/
    features.js              loads feature CSVs into typed arrays (same style as temperature.js)
    score.js                 the scoring module, pure ES module, reads config JSON, no dependencies
  out/                       committed outputs (see above), plus validation.md
  raw/  work/  .venv/        git-ignored
```

---

## 4. Grid conventions

- **Moon and Mars (2 degrees):** exactly the team layout. 16,200 rows, every cell once, `body`,
  `lat`, `lon` as odd integers, blank for unknown, one decimal, `source_id` per row. If one row draws
  on several sources, `source_id` lists them separated by `;` and each appears in `sources.csv`.
- **Earth (1 degree):** `earth_features_1deg.csv`, 64,800 rows, `lat` = 89.5 ... -89.5, `lon` =
  -179.5 ... 179.5, with a `land_pct` column from Natural Earth 50 m land polygons. Rows with
  `land_pct` below 25 keep only `body, lat, lon, land_pct`. Antarctica and Greenland count as land.
- **Earth (2 degrees):** `earth_features_2deg.csv`, the team layout, each value the land-area-weighted
  mean of its four 1-degree cells, blank if none has land.
- Aggregation rules: means for continuous values, fractions for classes, counts per 100,000 square
  kilometres for point sets (use the cell's true area, which shrinks toward the poles), standard
  deviation within the cell for roughness. Coarsen fine rasters by block-averaging; never upsample a
  coarser product without saying so in `METHODS.md`.
- Index math lives in `pipeline/grid.py` and mirrors `temperature.js`: row = (90 - lat) / res,
  col = (lon + 180) / res, index = row * cols + col.

---

## 5. Features, body by body

For each feature: the column, its unit, the source with the download location, native resolution,
how it is aggregated, and the dimension tag. Where a URL could not be verified today it says
**verify**: open the parent directory first and pick the matching file. If a source fails after the
retry rules in section 2, use the fallback in the same row.

### 5.1 Earth

| Column | Unit | Source, native resolution, processing | Dimension |
|---|---|---|---|
| `elev_mean_m`, `elev_min_m`, `elev_max_m`, `relief_m` (max minus min), `roughness_m` (std) | m | NOAA **ETOPO 2022** 60 arc-second ice-surface NetCDF, single file, about 450 MB: `https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc` (**verify**; browse `https://www.ngdc.noaa.gov/thredds/catalog/global/ETOPO2022/catalog.html`). Fallback 1: USGS **GMTED2010** 30 arc-second mean, `https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn30_grd.zip` (**verify**). Fallback 2: GMTED 7.5 arc-second tiles under `.../Global_tiles_GMTED/075darcsec/mea/` for Ireland only. | terrain |
| `slope_mean_deg` | deg | Gradient of the same DEM at its native cell (about 1.8 km at 60 arc-seconds), mean per cell. State the baseline in `METHODS.md`; it is a regional slope, not a boulder-scale one. | terrain, operations |
| `lith_volcanic_pct`, `lith_basic_volcanic_pct`, `lith_carbonate_pct`, `lith_evaporite_pct`, `lith_unconsolidated_pct`, `lith_siliciclastic_pct`, `lith_plutonic_pct`, `lith_metamorphic_pct`, `lith_ice_pct` | % | **GLiM** Global Lithological Map gridded to 0.5 degrees, Hartmann and Moosdorf 2012, PANGAEA `https://doi.pangaea.de/10.1594/PANGAEA.788537` (tab-delimited download, one row per cell with the fraction of each first-level class: `su, ss, sm, py, sc, ev, mt, pa, pi, pb, va, vb, vi, ig, wb, nd, xx`). volcanic = va+vb+vi, basic volcanic = vb, carbonate = sc, evaporite = ev, unconsolidated = su, siliciclastic = ss+sm, plutonic = pa+pi+pb, metamorphic = mt, ice = ig. Block-average to 1 degree. Always cite the paper. | geology, subsurface, water |
| `volcano_n`, `volcano_nearest_km`, `volcano_nearest_type` | count, km, text | **Smithsonian Global Volcanism Program** Holocene volcanoes via WFS GeoJSON: `https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=json` (send a browser User-Agent). Cite GVP, Volcanoes of the World v5.3.x with its DOI from `https://volcano.si.edu/database/webservices.cfm`. Fallback: the Holocene list page export, or a hand-curated table of the 150 best-known volcanoes if the host stays down. Also save the full point table as `out/volcanoes.csv`. | geology, dust |
| `crater_nearest_km`, `crater_nearest_diam_km`, `crater_nearest_name` | km, km, text | Curated `impact_structures.csv` (section 5.5). | terrain, geology |
| `precip_mm_yr`, `vapr_kpa`, `wind_ms`, `srad_kj_m2_day`, `tavg_c`, `tmin_c`, `tmax_c`, `diurnal_range_c` (tmax minus tmin) | as named | **WorldClim 2.1** 10 arc-minute 1970 to 2000 normals: `https://geodata.ucdavis.edu/climate/worldclim/2_1/base/wc2.1_10m_{prec,vapr,wind,srad,tavg,tmin,tmax}.zip`, 12 monthly GeoTIFFs each. Annual sum for precipitation, annual means for the rest. The host reset today: try the mirror `https://biogeo.ucdavis.edu/data/worldclim/v2.1/base/` (**verify**), then the hotspot. Fallback for humidity, wind and radiation if WorldClim is unreachable: NASA POWER regional climatology for `RH2M, WS2M, ALLSKY_SFC_SW_DWN, PRECTOTCORR` using the teammate's box-download approach (slow; run it in the background and accept partial coverage). | thermal, dust, habitability, operations |
| `aridity_idx` | 0..1 | Computed: 1 minus min(1, precip_mm_yr / 1000). Document it as a simple dryness index, not the UNEP aridity index. If time allows swap in the Global Aridity Index v3 (Zomer et al. 2022, figshare). | habitability, dust |
| `ndvi_mean`, `barren_pct` (share of 0.1-degree pixels with NDVI below 0.1) | idx, % | **NASA NEO** MODIS vegetation index, monthly float GeoTIFF at 0.1 degree: `https://neo.gsfc.nasa.gov/archive/geotiff.float/MOD_NDVI_M/MOD_NDVI_M_2024-MM-01.FLOAT.TIFF` for twelve months (**verify** dataset id and dates by listing `https://neo.gsfc.nasa.gov/archive/geotiff.float/`). Annual mean, then aggregate. | habitability, geology |
| `aod_mean` | idx | NEO MODIS aerosol optical depth monthly, dataset `MODAL2_M_AER_OD` (**verify** id), twelve months, mean. `dust_idx` = aod_mean scaled by barren_pct / 100, as a dust-activity proxy; say so. Fallback: MERRA-2 dust surface mass (needs Earthdata login) or leave `aod_mean` blank. | dust |
| `snow_cover_pct` | % | NEO MODIS snow cover monthly `MOD10C1_M_SNOW` (**verify** id), twelve-month mean. | water, thermal |
| `permafrost_idx` | 0..1 | Primary: Obu et al. 2019 permafrost probability, PANGAEA `https://doi.pangaea.de/10.1594/PANGAEA.888600` (Northern Hemisphere GeoTIFF; large, about 1 GB; only if bandwidth holds). Fallback used by default under time pressure: climate proxy from `tavg_c`: 1 if below -6, 0.5 if below -2, 0.25 if below 0, else 0. Label the proxy. | water |
| `ice_idx` | 0..1 | Combined: max(lith_ice_pct / 100, snow_cover_pct / 100 adjusted, permafrost_idx). Documented formula. | water |
| `karst_idx` | 0..1 | (lith_carbonate_pct + lith_evaporite_pct) / 100. | subsurface |
| `cave_n_100km`, `cave_nearest_km`, `cave_nearest_type`, `cave_nearest_length_m` | count, km, text, m | Curated `caves.csv` (section 5.5). | subsurface |
| `lavatube_idx` | 0..1 | lith_basic_volcanic_pct / 100 scaled by proximity to a Holocene volcano or a known lava tube (1 within 50 km, fading to 0 at 300 km). | subsurface |
| `pressure_hpa` | hPa | From `elev_mean_m` with the standard atmosphere: 1013.25 × (1 - 2.25577e-5 × h)^5.2559. | operations |
| `solar_idx` | 0..1 | `srad_kj_m2_day` divided by 30,000, capped at 1. | operations, thermal |
| `temp_mean_c`, `temp_high_c`, `temp_low_c` | C | For 1-degree ranking rows: the MODIS land surface temperature fallback (section 5.4). Keep the team's exact column names and set `source_id = modis_lst_clim`. | thermal |
| `country`, `admin_region` | text | Natural Earth 50 m admin-0 (`https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip`) for the country; the 10 m admin-1 file for Irish counties only. Used for the "best alternative in the same country" line. | none (metadata) |
| `land_pct` | % | Natural Earth 50 m land (`https://naciscdn.org/naturalearth/50m/physical/ne_50m_land.zip`). | none (mask) |

### 5.2 Moon (2 degrees)

| Column | Unit | Source, processing | Dimension |
|---|---|---|---|
| `elevation_m`, `relief_m`, `roughness_m`, `slope_mean_deg` | m, deg | **LRO LOLA** gridded DEM 16 pixels per degree (about 1.9 km): `https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img` with `ldem_16.lbl` (int16, scale 0.5 m, 5760 × 2880). Slope from the gradient at native resolution; state the baseline. Elevation relative to the 1737.4 km sphere. | terrain, operations |
| `crater_density_5km_n`, `crater_density_20km_n` (per 100,000 km²) | count | **Robbins 2019** lunar crater database: `https://astropedia.astrogeology.usgs.gov/download/Moon/Research/Craters/lunar_crater_database_robbins_2018.zip` (about 93 MB; **verify** extension). Use `LAT_CIRC_IMG, LON_CIRC_IMG, DIAM_CIRC_IMG`. | terrain |
| `feo_pct`, `tio2_pct`, `th_ppm` | wt %, wt %, ppm | **Lunar Prospector GRS** 2-degree element abundance maps, PDS dataset LP-L-GRS-5-ELEM-ABUNDANCE-V1.0: browse `https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/lp_9001/data/` and take the 2-degree products for iron oxide, titanium oxide and thorium (format in the `.lbl` and the dataset catalog). Cite Prettyman et al. 2006. The 2-degree bins are finer than the 5-degree instrument footprint; say so. | geology |
| `mare_idx` | 0..1 | 1 where `feo_pct` ≥ 15, 0 where ≤ 8, linear between. Cross-check against the USGS Unified Geologic Map of the Moon (`https://astropedia.astrogeology.usgs.gov/download/Moon/Geology/Unified_Geologic_Map_of_the_Moon_GIS_v2.zip`, **verify**) if time allows, producing `mare_unit_pct`. | geology, subsurface |
| `h_ppm` | ppm | **Lunar Prospector neutron spectrometer** hydrogen maps (Feldman et al.): browse `https://pds-geosciences.wustl.edu/missions/lunarp/reduced.html` for the 2-degree hydrogen product (**verify** dataset id). Fallback: leave blank and let `water_idx` rest on `psr_pct` and latitude. | water |
| `psr_pct` | % | **LROC permanently shadowed region** shapefiles from `https://data.lroc.im-ldi.com/` (search the RDR list for PSR; the LOLA-derived set covers both poles). Area fraction per cell. Fallback: the LOLA polar illumination products under `lrolol_1xxx/data/lola_gdr/polar/illumination/`. | water, thermal, operations |
| `illum_idx` | 0..1 | Proxy from geometry: max solar elevation = 90 - abs(lat) - 1.54 degrees, scaled 0..1 over 0..90, times (1 - psr_pct / 100). Replace with LOLA average illumination near the poles if the polar products download cleanly. | thermal, operations |
| `pit_n`, `pit_nearest_km` | count, km | **LROC Lunar Pit Atlas** locations: `https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_LUNAR_PIT_LOCATIONS` (CSV offered on the page; Wagner and Robinson). | subsurface |
| `temp_mean_c`, `temp_high_c`, `temp_low_c` | C | Not produced here. Read from `moon_data/moon_grid.csv` at score time. | thermal |

### 5.3 Mars (2 degrees)

| Column | Unit | Source, processing | Dimension |
|---|---|---|---|
| `elevation_m`, `relief_m`, `roughness_m`, `slope_mean_deg` | m, deg | **MGS MOLA MEGDR** 16 pixels per degree: `https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000fb.img` with `megt90n000fb.lbl` (int16 metres above the areoid, 5760 × 2880, longitudes 0 to 360: shift to -180..180). | terrain, operations |
| `pressure_pa` | Pa | Estimate 610 × exp(-elevation_m / 11,100). Label as an estimate; the MCD gives real values if someone wants them later. | operations |
| `crater_density_5km_n`, `crater_density_20km_n` | count | **Robbins and Hynek 2012** Mars crater database: `https://astropedia.astrogeology.usgs.gov/download/Mars/Research/Craters/RobbinsCraterDatabase_20120821.zip` (**verify**), or page through `https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items?f=json`. | terrain |
| `thermal_inertia_tiu` | J m⁻² K⁻¹ s⁻½ | **MGS TES** thermal inertia, Putzig and Mellon 2007, 20 pixels per degree nighttime map: browse `https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/` `DATA/` for the 2007 nighttime product and its label. Cell mean. High values mean rock and bedrock, low values mean dust. | geology, dust, operations |
| `albedo_idx` | 0..1 | TES albedo map (8 pixels per degree) from the same node if present; otherwise derive a dust-cover proxy from thermal inertia alone and say so. | dust |
| `dust_cover_idx` | 0..1 | Ruff and Christensen 2002 Dust Cover Index if downloadable from ASU `https://www.mars.asu.edu/data/` (**verify**); fallback: 1 where thermal inertia ≤ 100, 0 where ≥ 350, linear between. | dust |
| `geo_volcanic_pct`, `geo_impact_pct`, `geo_highland_pct`, `geo_lowland_pct`, `geo_polar_pct`, `geo_transition_pct`, `geo_basin_pct`, `geo_apron_pct` | % | **USGS SIM 3292**, Tanaka et al. 2014, global geologic map GIS: `https://pubs.usgs.gov/sim/3292/` (GIS database download) or the Astropedia copy (**verify**). Area fraction of each unit group per cell. | geology, subsurface |
| `weh_pct` | wt % | **Mars Odyssey GRS** water-equivalent hydrogen, 5-degree smoothed maps: browse `https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/` for the H₂O product; interpolate to 2-degree centres and say so. Fallback: latitude proxy, 1 poleward of 60 degrees, 0 equatorward of 40, linear between, labelled `weh_proxy`. | water |
| `dust_storm_n` (storm instances per 100,000 km² over the catalogue years) | count | **Mars Dust Activity Database**, Battalio and Wang 2021, Zenodo `https://zenodo.org/record/7480334` (tar files per Mars year with CSVs per storm instance; use centroid lat/lon). | dust |
| `cave_candidate_n`, `cave_nearest_km` | count, km | **Mars Global Cave Candidate Catalog**, Cushing 2015, `https://astropedia.astrogeology.usgs.gov/download/Mars/MarsCaveCatalog/mars_cave_catalog.zip` (1.8 MB, tabular, with priority ratings; keep priority 1 and 2 for the count, all for the nearest). | subsurface |
| `temp_mean_c`, `temp_high_c`, `temp_low_c` | C | Not produced here. Read from `mars_data/mars_grid.csv` at score time. | thermal |

### 5.4 Earth temperature fallback (reverse search unblocker)

`out/earth_grid_modis_lst.csv`, team layout, 16,200 rows, `source_id = modis_lst_clim`. Source:
NEO MODIS land surface temperature climatology, day and night, monthly float GeoTIFFs
(`MOD_LSTD_CLIM_M`, `MOD_LSTN_CLIM_M`, **verify** ids). `temp_high_c` = mean of the twelve daytime
months, `temp_low_c` = mean of the twelve nighttime months, `temp_mean_c` = their average. Ocean
blank. Write in `METHODS.md` that MODIS overpasses at about 10:30 and 22:30 local time, so these are
not true daily extremes and run a few degrees inside them, and that the teammate's POWER grid is the
preferred source wherever it has values. Also write `out/earth_grid_filled.csv`: the POWER row where
POWER has a value, the MODIS row otherwise, with the row's own `source_id`. `HANDOFF.md` tells the
globe owner to add `'../../terrain_data/out/earth_grid_filled.csv'` as the second entry of
`GRID_FILES.earth` and `modis_lst_clim` to `SOURCE_NAMES`.

### 5.5 Curated tables (knowledge work, then verification)

Write these from your own knowledge first, then verify coordinates for every item used in the demo
and every item within 300 km of Ireland against the IAU Gazetteer, Wikipedia or the agency page, and
record the check in `validation.md`. Columns common to all: `id` (lower-case, hyphens), `name`,
`country_or_region`, `lat`, `lon`, `wikipedia_title`, `further_reading` (semicolon-separated URLs),
`source_id`.

**`analog_sites.csv`, about sixty rows.** Extra columns: `agency_or_program`, `programs`,
`analog_for` (moon, mars, both), `environment`, `strong_dimensions`, `weak_dimensions`, `years`,
`what_was_tested`. Must include at least: Haughton Crater and the Haughton-Mars Project on Devon
Island; the Flashline station; Axel Heiberg Island's perennial springs; the McMurdo Dry Valleys;
Mount Erebus; Lake Untersee; Svalbard (AMASE); Pavilion Lake; Kilbourne Hole and the Potrillo
volcanic field; SP Crater, Cinder Lake and Merriam Crater in the San Francisco Volcanic Field
(Apollo training, Desert RATS, JETT, and the JSC-1A simulant quarry); Black Point lava flow; Meteor
Crater; Craters of the Moon (FINESSE, BASALT, Apollo); Lava Beds National Monument (BRAILLE); Lunar
Crater volcanic field; Mauna Kea with Puʻu Nene (JSC Mars-1 source, PISCES), Mauna Loa (HI-SEAS),
Kīlauea and the Kaʻū Desert; the Mojave Desert at Saddleback Basalt (Mojave Mars Simulant) and
Zzyzx; Death Valley; White Sands gypsum dunes; the Utah Mars Desert Research Station at Hanksville;
the San Rafael Swell; Bonneville Salt Flats; Stillwater Complex, Montana (NU-LHT anorthosite
simulant); Duluth Complex (MLS-1); Sudbury; Mistastin; Shawmere anorthosite; Askja, Holuhraun and
Lambahraun in Iceland (Apollo training, FELDSPAR, SAND-E); the Ries crater; Bletterbach; Lanzarote's
Timanfaya and the Corona lava tube (ESA PANGAEA); Teide; Etna (ARCHES); Vulcano; Río Tinto (MARTE);
the Tabernas Desert; Lofoten anorthosites; the Greenland anorthosite quarry at Naajat; Boulby mine
(MINAR); Dhofar, Oman (AMADEE-18); Makhtesh Ramon (AMADEE-20); Armash, Armenia (AMADEE-24); the
Erfoud region, Morocco (Ibn Battuta Centre, ExoMars rover tests); the Danakil Depression; the Namib;
the Atacama at Yungay and Salar Grande (ARADS); Salar de Uyuni; Laguna Negra and Ojos del Salado;
Pali Aike; Lonar crater; Ladakh (Tso Kar, Puga); the Qaidam Basin and the Lenghu Mars camp; the
Pilbara; Lake Tyrrell; Cuatro Ciénegas; Yellowstone's silica springs; the Alaska Fox permafrost
tunnel; Kamchatka.

**`caves.csv`, about fifty rows.** Extra columns: `cave_type` (lava_tube, karst, ice, sulfidic, salt,
mine, fumarolic_ice, glacier), `host_rock`, `length_m`, `depth_m`, `analog_use`. Must include:
Kazumura and Thurston (Hawaii); Lava Beds' Catacombs and Valentine; Ape Cave; El Malpais; Craters of
the Moon's Indian Tunnel; Cueva del Viento and the Corona tube with Cueva de los Verdes (Canaries);
Manjanggul (Jeju); Undara (Queensland); Raufarhólshellir, Surtshellir, Víðgelmir and Lofthellir
(Iceland); Gruta das Torres (Azores); Umm Jirsan (Saudi Arabia); Leviathan Cave (Kenya); Mount Suswa
(Kenya); Galápagos tubes on Santa Cruz; La Réunion tubes; Etna's Grotta del Gelo and Grotta dei Tre
Livelli; Rangitoto and the Wiri tube (New Zealand); Postojna and Škocjan (Slovenia, where ESA CAVES
also trains in Sardinia's Sa Grutta: include it); Mammoth Cave; Carlsbad and Lechuguilla (sulfuric
acid caves); Frasassi; Cueva de Villa Luz (sulfidic); Movile Cave (chemosynthetic ecosystem); Son
Doong; Naica's crystal cave; Eisriesenwelt and Dachstein ice caves; Scărișoara ice cave; Kungur ice
cave; the Mount Erebus fumarolic ice caves; Boulby mine; SNOLAB at Creighton mine; the Alaska Fox
permafrost tunnel; and Ireland's Aillwee, Doolin, Pollnagollum, Mitchelstown, Dunmore, Crag and
Marble Arch caves.

**`impact_structures.csv`, about sixty rows.** Extra columns: `diameter_km`, `age_ma`, `target_rock`
(crystalline, sedimentary, basalt, mixed), `exposure` (exposed, buried, eroded), `analog_use`. Include
the large and the well-exposed ones (Vredefort, Sudbury, Chicxulub, Popigai, Manicouagan, Acraman,
Morokweng, Kara, Beaverhead, Tookoonooka, Charlevoix, Siljan, Karakul, Montagnais, Araguainha,
Mjølnir, Puchezh-Katunki, Saint Martin, Woodleigh, Carswell, Clearwater West and East, Manson,
Slate Islands, Keurusselkä, Yarrabubba, Shoemaker, Gosses Bluff, Mistastin, Haughton, Ries,
Steinheim, Rochechouart, Boltysh, Lonar, Bosumtwi, Wolfe Creek, Barringer/Meteor Crater, Odessa,
Henbury, Kaali, Roter Kamm, Tswaing, Pingualuit, Lappajärvi, Dellen, Gardnos, Zhamanshin, El'gygytgyn,
Chesapeake Bay, Wetumpka, Decaturville, Serpent Mound, Upheaval Dome, Sierra Madera, Middlesboro,
Wells Creek, Kentland, Glover Bluff, Rock Elm, Brent, Holleford, Wanapitei, Nicholson, Pilot,
Gow, Deep Bay, Lac à l'Eau Claire, Ouarkziz, Tin Bider, Talemzane, Aorounga, Gweni-Fada, Amguid,
Tenoumer, Aouelloul, Kamil). Cite the Earth Impact Database (PASSC) as the reference list.

**`volcanoes.csv`:** the GVP export, no curation.

**`irish_sites.csv`:** Athlone (TUS Athlone campus, about 53.42 N, 7.91 W; verify), Clonmacnoise on
the Esker Riada (about 53.33 N, 7.99 W), the Burren at Poulnabrone (about 53.05 N, 9.14 W). Enrich
each with the 1-degree cell's features, GLiM lithology, nearest cave and volcano, and a paragraph on
the real planetary connection: eskers as Mars esker analogs (Dorsa Argentea and Argyre eskers), karst
as a subsurface and dissolution-process analog, glacial landforms and bog chemistry as process
analogs, and the honest weak points (humid, vegetated, low relief, mild). Keep claims verifiable; do
not invent NASA involvement in Ireland.

**`targets.csv` (Moon and Mars named targets).** Extra columns: `target_type` (artemis_region,
human_landing_site, rover_site, lander_site, pit_or_cave, resource_region, science_region),
`mission_or_program`, `why_it_matters`, `primary_demo` (1 for the demo set in decision 3).

- Moon: the nine Artemis III regions from NASA's October 2024 update (Peak near Cabeus B, Haworth,
  Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2,
  Slater Plain), with centre coordinates from the USGS data release "Down-selected Artemis III
  candidate landing site navigational grids" (`https://www.usgs.gov/data/down-selected-artemis-iii-candidate-landing-site-navigational-grids`)
  or NASA's region maps; also note the 2022 thirteen-region list. Plus Shackleton crater and its
  connecting ridge, Apollo 11, 12, 14, 15, 16, 17, Luna 16, 20, 24, Chang'e 3, 4, 5, 6, the Marius
  Hills, Mare Tranquillitatis and Mare Ingenii pits, the Aristarchus plateau, the Gruithuisen domes,
  Reiner Gamma, Schrödinger basin, Rima Bode pyroclastics, Compton-Belkovich, Ina.
- Mars: Jezero, Gale, Meridiani Planum, Gusev, Oxia Planum (Rosalind Franklin), Elysium Planitia
  (InSight), Utopia Planitia (Viking 2, Zhurong), Chryse (Viking 1), Ares Vallis (Pathfinder),
  Phoenix's Green Valley, Arcadia Planitia shallow ice, Deuteronilus and Protonilus Mensae, Mawrth
  Vallis, Eberswalde, Holden, Nili Fossae, Columbia Hills, Hebrus Valles, the Arsia Mons skylights,
  Noctis Landing, Erebus Montes, Phlegra Montes, Melas Chasma, Hellas rim sites. Use the 2015 First
  Landing Site/Exploration Zone workshop list (NTRS 20160001040, Bussey and Hoffman 2016) for the
  human exploration zones.

**Site enrichment (for every named site on all bodies):** `image_url` (Wikipedia page image via
`https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=800&titles=...&format=json`,
with a descriptive User-Agent as Wikimedia asks; NASA image URL where you know one),
`image_credit`, `wikipedia_url`, `further_reading`, `summary` (one or two sentences you write),
`strengths` and `limits` (short phrases you write, three to five each), `caveats` (from
`caveats.json`). For the dozen primary demo sites also download the image into
`out/images/<id>.jpg` at 800 px for the venue network, with credit in `DATA_SOURCES.md`.

---

## 6. Scoring specification

### 6.1 Per-feature match

For a feature `f` with Earth value `e` and target value `t`, both already in comparable units:

```
match_f = max(0, 1 - |e - t| / range_f)
```

the same shape as the team's temperature match. `range_f` is a fixed number per feature in
`config/features.json`, chosen so that a difference nobody would call "similar" scores zero. Starting
values, to tune during validation:

| Comparison | Earth value | Moon value | Mars value | range |
|---|---|---|---|---|
| slope | `slope_mean_deg` | `slope_mean_deg` | `slope_mean_deg` | 6 deg |
| roughness | `roughness_m` | `roughness_m` | `roughness_m` | 400 m |
| relief | `relief_m` | `relief_m` | `relief_m` | 2,500 m |
| cratering | crater proximity index: 1 within 25 km of an impact structure, 0 beyond 250 km | `crater_density_20km_n` scaled 0..1 over the Moon's own range | same for Mars | 0.6 |
| basaltic ground | `lith_basic_volcanic_pct / 100` | `mare_idx` | `geo_volcanic_pct / 100` scaled by thermal-inertia rockiness | 0.6 |
| crystalline highlands | `(lith_plutonic_pct + lith_metamorphic_pct) / 100` | `1 - mare_idx` | `geo_highland_pct / 100` | 0.6 |
| volcanic activity | volcano proximity index: 1 within 50 km, 0 beyond 500 km | 0.3 flat (ancient volcanism) | `geo_volcanic_pct / 100` | 0.7 |
| mean temperature | `temp_mean_c` | `temp_mean_c` | `temp_mean_c` | 40 C |
| daily high | `temp_high_c` | `temp_high_c` | `temp_high_c` | 40 C |
| daily low | `temp_low_c` | `temp_low_c` | `temp_low_c` | 40 C |
| daily swing | high minus low | high minus low | high minus low | 40 C |
| sunlight | `solar_idx` | `illum_idx` | `illum_idx` from latitude | 0.5 |
| ice availability | `ice_idx` | `water_idx` = max(psr_pct / 100, scaled h_ppm) | `water_idx` = scaled weh_pct | 0.6 |
| dryness | `aridity_idx` | 1 | 1 | 0.6 |
| dust activity | `dust_idx` | 1 (fine regolith everywhere) | `dust_cover_idx` blended with `dust_storm_n` scaled | 0.6 |
| wind and erosion | `wind_ms / 10` capped | 0 | 0.5 flat (aeolian but thin air) | 0.7 |
| karst and voids | `karst_idx` | 0 | 0.1 flat | 0.8 |
| lava-tube potential | `lavatube_idx` | `pit_n` scaled and `mare_idx` | `cave_candidate_n` scaled and `geo_volcanic_pct` | 0.6 |
| barrenness | `barren_pct / 100` | 1 | 1 | 0.5 |
| extremophile setting | 1 if the site or cell is flagged acidic, hypersaline, hydrothermal or hyperarid in the curated tables, else `aridity_idx` | 1 | 1 | 0.7 |
| surface pressure (log) | log10(`pressure_hpa`) | not comparable: skip | log10(`pressure_pa` / 100) | 2.5 decades |
| latitude for solar power | abs(lat) / 90 | abs(lat) / 90 | abs(lat) / 90 | 0.4 |
| landing elevation | not used on Earth | not used | Mars only, operations bonus: 1 below -2,000 m, 0 above +2,000 m | n/a |

Where a body has no counterpart (humidity, rain, vegetation, storms on the Moon) the target value is
the absence value, so the Earth value itself is the penalty. Where neither side has data the feature
is skipped and the dimension's `coverage` drops.

### 6.2 Dimension and overall scores

- `dim_score` = mean of the available `match_f` in that dimension, on 0..1. `coverage` = share of
  the dimension's features that had data on both sides.
- `overall` = Σ weight_d × dim_score_d / Σ weight_d, over dimensions with coverage above 0.
- Report on 0..100, rounded; keep the 0..1 values in JSON for the bars.

### 6.3 Presets

| Dimension | Raw similarity | Crewed mission | Base construction | Rover landing |
|---|---|---|---|---|
| terrain | 12.5 | 20 | 20 | 30 |
| geology | 12.5 | 15 | 15 | 10 |
| thermal | 12.5 | 20 | 15 | 15 |
| water | 12.5 | 5 | 15 | 5 |
| dust | 12.5 | 10 | 10 | 15 |
| subsurface | 12.5 | 5 | 15 | 0 |
| habitability | 12.5 | 5 | 0 | 5 |
| operations | 12.5 | 20 | 10 | 20 |

Preset ids: `raw`, `crewed`, `base`, `rover`. The front end shows "just similarities" as `raw`.

### 6.4 Explain and redirect

For any Earth place against any target and preset, return:

- `losses`: every feature's lost points, `weight_d / n_features_d × (1 - match_f) × 100`, sorted;
  expose the top three with a plain sentence each: "Precipitation is 1,050 mm a year; a strong analog
  would be under 250 mm", "Slope averages 1.2 degrees; the target averages 4.8".
- `coverage` per dimension and the list of skipped features.
- `caveats`: the fixed cannot-match text for the body.
- `alternative`: the best-scoring Earth place for the same target and preset (a) within the same
  country, (b) within 1,000 km, and (c) worldwide, each as `{id or cell, name, score, distance_km}`.
  This is the "cut your losses" line for the Athlone minute.

### 6.5 What runs where

- Python (`50_score.py`) precomputes: for every named target × preset the top 25 Earth 1-degree
  cells and top 10 named Earth sites; for every named Earth site × body its best target and full
  breakdown; `matches.json` holds all of it (keep under 10 MB; trim decimals).
- JavaScript (`js/score.js`) computes the same numbers live in the browser from the feature CSVs and
  the two config JSON files, so a click anywhere works: `scoreGrid(earthRef, bodyFeatures, body,
  preset) -> Float32Array` drapeable with the existing canvas renderer, `scoreGridReverse(targetRef,
  earthFeatures2deg, preset)`, `scorePair(...)` with the explain output, and `presets`. Python and
  JavaScript must agree to within rounding on the validation set; `70_validate.py` runs the JS module
  with Node on ten pairs to prove it.

---

## 7. `sites.json` and the other exports

`out/sites.json` is an array in the globe's exact schema (section 1.3) so it can replace `SITES`
with one import change, with these additions per site: `site_type`, `country`, `image_url`,
`image_credit`, `wikipedia_url`, `links[]`, `programs[]`, `metrics{}` (every feature with value and
unit), `scores{}` (eight keys, 0..1, similarity to the best target on the site's primary body),
`matches{targetId: {overall, presets{raw, crewed, base, rover}, dims{}, coverage{}, losses[],
alternative{}}}`, `caveats[]`, `source_ids[]`. Moon and Mars targets get `analogs` filled with the
top three named Earth sites under the `raw` preset and a `top_cells` list of the best 1-degree cells.
Also export `out/sites.csv` in the team template, `out/targets.json`, `out/presets.json`,
`out/feature_ranges.json`, `out/caveats.json`, and `out/sources.csv` in the team template with one
row per dataset: id, body, dataset and version, variables filled, original units, resolution, URL,
download date, processing notes.

Optional, only after everything above is done: `out/overlays/earth_<feature>.png`, 2048 × 1024
equirectangular PNGs with a legend PNG each, for elevation, aridity, barrenness, lithology class,
dust and ice, for a WorldWind `SurfaceImage` layer.

A shortcut for visuals only: NOAA's **Science On a Sphere** catalog
(`https://sos.noaa.gov/catalog/datasets/`) offers hundreds of equirectangular 4096 × 2048 images
and animations of Earth, the Moon and Mars (topography, land cover, aerosols, lightning, sea ice,
night lights, planetary mosaics), most of them NASA or NOAA products. They drape straight onto the
globe with no processing, so they are good overlay candidates for the demo. They are **not** inputs
for scoring: the measurements are baked into a colour palette and cannot be read back reliably. Check
each dataset page for its credit line and any third-party permission note before using it.

---

## 8. Validation (`70_validate.py` writes `out/validation.md`)

1. Structure: 16,200 rows per 2-degree file, every cell once, no `NaN` text, blanks only, one
   decimal, every `source_id` present in `sources.csv`, team checker passes on the temperature files
   (unchanged) and on `earth_grid_modis_lst.csv`.
2. Ranges: elevation, slope, fractions, counts within physical limits; a histogram line per feature.
3. Sanity rankings, each as a short table with rank and score: Haughton Crater and Devon Island
   against the Phoenix site and Deuteronilus Mensae (polar Mars); Mauna Kea's Puʻu Nene and Kīlauea
   against Apollo 17 and the Marius Hills (lunar mare); Yungay against Jezero and Meridiani (arid,
   dusty Mars); Lanzarote's Corona tube and Lava Beds against the Marius Hills pit (subsurface); Río
   Tinto against Meridiani (habitability); Kilbourne Hole and SP Crater against Apollo 16 and 17
   (crewed training); Stillwater and Lofoten anorthosites against Apollo 16 highlands (geology). The
   classics should sit in the top few percent of their dimension; where they do not, tune a range
   and record the change.
4. The surprise list: for each primary demo target, the top five 1-degree cells that are not within
   300 km of any curated analog site, with country names. This is the "beyond Atacama and Hawaii"
   evidence for the pitch.
5. The Athlone card: scores per preset against the Moon and Mars primary targets, the top three
   losses in plain sentences, and the three alternatives. Also Clonmacnoise and the Burren.
6. Python versus JavaScript agreement on ten pairs.

---

## 9. Documentation and the AI-usage record

- `README.md`: what the folder is, how to set up and run (`run_all.py`), what each output is for,
  how the globe consumes it, the one-paragraph story for the pitch.
- `METHODS.md`: every feature, formula, range, weight, proxy, interpolation and shortcut; the
  cannot-match caveats; limitations in plain words.
- `DATA_SOURCES.md`: one paragraph per dataset with agency, mission, version, licence, URL, date,
  and the exact citation the provider asks for (GLiM, GVP, Robbins, Putzig and Mellon, Williams,
  Battalio and Wang, Cushing, Tanaka, Fortezzo, Prettyman, Feldman, Natural Earth, WorldClim, NEO,
  ETOPO). This feeds the data-sources slide.
- `AI_USAGE.md`: that this layer was designed through a structured interview between the data owner
  and Claude (this prompt is the record), that Claude wrote the pipeline and the first drafts of the
  curated tables and site texts, which numbers and coordinates humans checked and how, which
  decisions were human (sections 1.4 and 6.3), and a sentence on limits: AI-drafted site texts can
  contain errors, so demo items were verified against the sources listed.
- `HANDOFF.md`: exact snippets for the globe owner: the `operations` entry for `ANALOG_DIMENSIONS`,
  the `GRID_FILES.earth` fallback path and `SOURCE_NAMES` entry, how to import `sites.json` in place
  of `sites.js`, how to call `score.js` from the temperature panel's render path, the suggestion that
  the detail view opens as a side page rather than a popup (the operator's wish), and a list of what
  is optional.

---

## 10. Order of work and the clock (Athlone time, 2026-11-14 to 15)

| Window | Phase | Must exist at the end |
|---|---|---|
| now to 16:30 | 0, setup | venv, packages, `dl.py`, `grid.py`, `00_setup_check.py` green, `config/*.json` drafts, a **mock `sites.json`** with the nine seed sites carrying fake scores so the globe owner can wire the import today, first commit |
| 16:30 to 19:00 | 1, Moon | `moon_features.csv`, Moon half of `targets.csv`, commit |
| 19:00 to 22:00 | 2, Earth | DEM, GLiM, WorldClim or fallback, NEO, GVP, Natural Earth; `earth_features_1deg.csv`, `earth_features_2deg.csv`, `earth_grid_modis_lst.csv`, `earth_grid_filled.csv`; curated tables including Irish sites; commit |
| 22:00 to 00:00 | 3, Mars | `mars_features.csv`, Mars half of `targets.csv`, commit |
| 00:00 to 01:30 | 4, scoring | `features.json` ranges, `50_score.py`, `score.js`, `sites.json` with real scores, `matches.json`, Athlone card printed in chat, commit |
| 01:30 to 02:30 | 5, prove and document | `validation.md`, `METHODS.md`, `DATA_SOURCES.md`, `AI_USAGE.md`, `HANDOFF.md`, `README.md`; globe running locally with the data; push with the operator's yes |
| after sleep, before 06:00 | 6, integration | help the globe owner wire scores and the Athlone card; fixes from the practice run |

Take a ten-minute break around 21:00 and again around 00:00; say so when it is time.

**If behind schedule, cut in this order:** overlays; Mars geology units and MDAD (keep the
thermal-inertia dust proxy and the cave catalog); Earth permafrost product (keep the climate proxy);
Lunar Prospector hydrogen (keep PSR and latitude); the impact-structure table beyond the forty
largest; WorldClim humidity and wind (keep precipitation); the lunar geologic map cross-check. Never
cut: Moon and Mars terrain, Earth terrain and lithology, the curated analog sites, the Irish sites,
scoring with presets, `sites.json`, validation, the documents.

---

## 11. Working agreement with the operator

- Start each phase with the plain-language paragraph, finish it with a three-line summary and the
  commit hash.
- Keep a running `terrain_data/work/log.md` of what was downloaded, from where, how big, and any
  fallback used; `DATA_SOURCES.md` is generated from it at the end.
- Show the globe locally after phase 4: `node prototype/server.js . 8000` from the repo root, open
  `http://localhost:8000/analog-atlas/analog-atlas/`, and walk the operator through clicking Athlone.
- Git, explained once in plain terms, then done for them: `git status` to see changes, `git add` to
  stage, `git commit -m` to save a labelled snapshot, `git push -u origin terrain-data` to publish the
  branch, a pull request so teammates can review before it reaches `main`. Pushing and the pull
  request need a yes each time. Never force-push, never rewrite history, never touch `main`
  directly.
- Publishing: the repo is already public. "Open source" means adding a licence the team agrees on
  (suggest MIT for code and note that data keep their providers' licences). Raise it with the team,
  do not add it unilaterally.
- When the operator asks "why" or "what does that mean", answer in two sentences first, details
  after, and keep building.
