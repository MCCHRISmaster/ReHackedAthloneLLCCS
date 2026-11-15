# terrain_data: terrain, environment and similarity for Analog Atlas

This folder is the non-temperature data layer and the combined similarity score of our NASA Space Apps 2026 entry, "Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars". It answers two questions for any place: how much does this Earth place resemble a Moon or Mars place, and where on Earth should you go instead?

**The story in one paragraph.** For about twenty things you can measure (slope, roughness, rock type, rain, ice, dust, caves, temperature and more) we ask how close an Earth place is to a Moon or Mars target, then group the answers under the eight dimensions the challenge brief names. Four presets weight them for different goals: pure similarity, a crewed mission, a base, a rover. Every card also says what Earth can never copy (gravity, vacuum or thin air, radiation, the lunar night), shows the three things costing the most points, and points to a better Earth place. Athlone is on the map with real numbers, scored honestly, next to the Esker Riada at Clonmacnoise and the Burren.

## Run it

Setup once (Windows, Python 3.12):

```
C:\Users\swhit\AppData\Local\Programs\Python\Python312\python.exe -m venv terrain_data\.venv
terrain_data\.venv\Scripts\python.exe -m pip install -r terrain_data\requirements.txt
```

Rebuild everything, or one phase (every step is safe to repeat; downloads are cached in `raw/`):

```
terrain_data\.venv\Scripts\python.exe terrain_data\pipeline\run_all.py --phase all
terrain_data\.venv\Scripts\python.exe terrain_data\pipeline\run_all.py --phase score
```

Phases: `setup`, `moon`, `earth`, `mars`, `soil`, `gases`, `radiation`, `curated`, `score`, `validate`. The `radiation` phase downloads about 740 NASA POWER UV boxes (use `--earth 1/6` .. `6/6` side by side) and reads Mars surface sunlight from the team grid (from `origin/main` until this branch has that column). The `gases` phase downloads 168 Mars Climate Database maps and about 740 NASA POWER boxes (one to two hours on a slow network; resumable). The `soil` phase is small (about 20 MB, a minute) and only needs the committed `out/earth_features_*.csv`, so it runs on a fresh clone: `run_all.py --phase soil`, then `--phase score`. A fresh build downloads about 1.6 GB and spends about 45 minutes on NASA POWER temperature requests. The network at the venue drops hosts at random; `pipeline/dl.py` retries, resumes and tries mirrors.

See the results in the browser: from the repo root run `node prototype/server.js . 8000`, then open

- `http://localhost:8000/terrain_data/demo/index.html?id=athlone` (the Athlone card)
- `http://localhost:8000/analog-atlas/analog-atlas/` (the globe; it needs the changes in `HANDOFF.md` to use this data)

## What is in here

| Path | What it is |
|---|---|
| `out/sites.json` | 72 Earth sites and 60 Moon and Mars targets in the globe's schema, scores filled, with full breakdowns |
| `out/matches.json` | For each target and preset: the best 25 Earth cells, the best 10 named sites, the places you would not expect |
| `out/moon_features.csv`, `mars_features.csv` | 2-degree feature grids in the team layout |
| `out/earth_features_1deg.csv`, `earth_features_2deg.csv` | Earth feature grids (1 degree for ranking, 2 degrees for the globe) |
| `out/moon_soil.csv`, `mars_soil.csv`, `earth_soil_1deg.csv`, `earth_soil_2deg.csv` | Ground and soil composition: iron, silicon, potassium, thorium (Moon and Mars measured from orbit, Earth estimated from rock type), plus Earth topsoil from SoilGrids (organic carbon, texture, pH, density, stones). Built by `pipeline/35_soil_features.py` |
| `out/moon_gases.csv`, `mars_gases.csv`, `earth_gases_1deg.csv`, `earth_gases_2deg.csv` | Air and gases: share and partial pressure of CO2, N2, O2, Ar, trace gases, air overhead, ozone column, dust and haze, CO2 and water frost (Mars Climate Database; Earth dry air x pressure plus NASA POWER ozone and aerosol; Moon vacuum). Built by `pipeline/36_gas_features.py` |
| `out/moon_radiation.csv`, `mars_radiation.csv`, `earth_radiation_1deg.csv`, `earth_radiation_2deg.csv` | UV-A, UV-B, UV-C and cosmic-ray dose at the ground, plus days to NASA's 600 mSv career limit (Earth: NASA POWER UV, dose from altitude; Mars: Curiosity RAD and REMS with MCD sunlight; Moon: Chang'e-4 and sunlight geometry). Built by `pipeline/37_radiation_features.py` |
| `out/earth_grid_filled.csv`, `earth_grid_power_full.csv` | Complete Earth temperature grids from NASA POWER, team layout |
| `out/analog_sites.csv`, `caves.csv`, `impact_structures.csv`, `volcanoes.csv`, `irish_sites.csv`, `targets.csv` | The curated tables with Wikipedia links, picture credits |
| `out/sites.csv`, `sources.csv`, `presets.json`, `caveats.json`, `feature_ranges.json`, `targets.json` | Team-format site table, sources, scoring configuration |
| `out/images/` | 800-pixel pictures of the demo sites, saved so the venue network cannot break the demo |
| `out/validation.md` | The proof: structure, ranges, classic-analog rankings, the Athlone card, JavaScript against Python |
| `js/score.js`, `js/features.js` | The scorer for the browser (and Node), no dependencies |
| `demo/index.html` | A finished detail page for any site |
| `config/` | The comparisons and ranges, the preset weights, the cannot-match warnings |
| `pipeline/` | Every script, numbered in running order |
| `METHODS.md` `DATA_SOURCES.md` `AI_USAGE.md` `HANDOFF.md` | Method, sources and citations, the AI-usage record, how the globe uses this |
| `BUILD_PROMPT.md`, `work/log.md` | The specification this was built from, and the build log |

`raw/`, `work/` (except the log) and `.venv/` are not committed.

## Honest limits

Some features are proxies because the real product could not be reached (lunar ice, lava tubes on Mars, Earth vegetation and dust); each is labelled in the data and listed in `METHODS.md`. The curated tables were drafted by an AI and only their coordinates were checked, against Wikipedia. Earth values are averages over a cell about 110 km across. Details in `METHODS.md` and `AI_USAGE.md`.
