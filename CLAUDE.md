# Project notes (for teammates and their Claude)

Team: Liam, Charlie, Christian. Repo: https://github.com/MCCHRISmaster/HackAthlone2026LiamCharlieChristian (branch `main`).

## The challenge
NASA Space Apps 2026: **"Permanent Moon Base Locations and Mars."** Use open NASA and other space-agency data
to find and describe Earth places that are good stand-ins ("analogs") for candidate Moon-base and Mars
landing sites, and present the result as a map, visualization or tool. The brief stresses these points:
- look beyond visual similarity
- explain what matches **and where the analogy breaks down** (gravity, vacuum, radiation)
- look beyond well-known sites like Atacama, Antarctica, Iceland and Hawaii
- combine several datasets
- "surprise us"

## What exists so far

### `prototype/`: Analog Finder web app (working)
- Plain HTML/JS: `index.html`, `app.js`, `style.css`. No build step and no dependencies.
- Run with `node prototype/server.js`, then open http://localhost:8000.
  - Don't use `python -m http.server`: on Christian's Windows machine it cut downloads off at random.
- **Earth map:** hover shows coordinates. Clicking calls the **NASA POWER climatology API** from the browser.
  - CORS is allowed, so no backend is needed.
  - It requests `TS`, `TS_MAX`, `TS_MIN`: ground-surface temperature averaged over 2001–2025.
  - Average = `TS.ANN`. High and low = mean of the 12 monthly `TS_MAX` / `TS_MIN` values.
- **Moon and Mars maps:** heat-map overlay of the match %, `max(0, 1 - |ΔT| / range)`.
  - `range` is a slider, 40 °C by default.
  - A mode switch compares average to average, daily high to high, or low to low.
  - Hovering shows the temperature and match % at that spot.
  - Summary under each map: best-match location and % of the surface that is a ≥75% match (weighted by cell area).
- **Base maps** (`prototype/assets/`, 2048×1024 equirectangular):
  - Earth: NASA GIBS Blue Marble
  - Moon: Moon Trek LRO WAC mosaic
  - Mars: Mars Trek Viking MDIM 2.1
- **Temperature grids** (`prototype/grids/moon.json`, `mars.json`):
  - 2° cells, 90 rows × 180 cols, row 0 = north edge, col 0 = 180°W, °C
  - keys `mean`, `high`, `low`
- `prototype/tools/build_assets.py` re-downloads the maps and rebuilds the grids. It uses curl with retries, because Python's TLS connections got reset on that network.

### ⚠️ Biggest weakness: the Moon and Mars grids are a SIMPLIFIED MODEL, not measured data
- **Moon:** sunlight by latitude over a day, with a night-side floor, plus mosaic brightness as a rough albedo.
- **Mars:** latitude formula with a CO₂-frost floor (148 K), plus albedo from brightness.
- The app shows a banner saying so.
- **Top priority:** rebuild both files in the same JSON layout from real data:
  - Moon: **LRO Diviner** global temperature maps (PDS Geosciences Node)
  - Mars: **Mars Climate Database** (needs free registration) or NASA Ames Mars climate model output
- The app needs no other changes when the files are replaced.

### `data/` and `load_temps.py`
- 2023 daily NASA POWER temperatures (`T2M`, `T2M_MAX`, `T2M_MIN`, `TS`) as CSV and JSON for:
  - Atacama (Yungay)
  - McMurdo Dry Valleys
  - Haughton Crater
  - Death Valley
  - Lut Desert (the less-studied site)
- CSV and JSON hold identical values. CSV is easier to work with: smaller, and loads straight into pandas once you skip the text header. JSON is GeoJSON, which is handy for web maps.
- `python load_temps.py` checks that CSV and JSON match and prints a summary table.

## Findings so far
- Comparing **averages** rarely matches anything. Earth's average temperatures are warmer than almost all of the Moon and Mars. For example, Haughton Crater's −15 °C average has no Moon match and a 3% best match on Mars.
- **Daily highs and lows overlap much more.** Haughton's +1.8 °C daily high matches about 38% of Mars (an equatorial band) and bands around 75° latitude on the Moon.
- This contrast is a good "where the analogy breaks down" story for the pitch.

## Plan and ideas, in priority order
1. **Host on GitHub Pages:** the app is static and works as-is, so judges get a live link.
2. **Real Moon and Mars data** to replace the modelled grids (see above).
3. **"Temperature fingerprint":** match on average, daily swing, seasonal range, record low and share of days below freezing, and show which parts match and which don't.
4. **Reverse search:** click a Moon or Mars site and get a ranked list of matching Earth places.
   - Add presets for the Artemis III south-pole regions, Jezero, Gale, and the proposed human landing sites with buried ice.
   - Needs a precomputed global Earth grid (MERRA-2 or MODIS surface temperature), not one POWER request per click.
5. **Panel per match** covering what can't match: gravity, vacuum or thin air, radiation, pressure.
6. **Check numbers against published values:** Curiosity REMS at Gale, published Diviner values, real readings from analog sites.
7. **Demo video and polish:** a 30-second story, a one-line pitch, and a list of every NASA dataset used.

## More variables discussed (beyond temperature)
Suggested additions for the hackathon: **terrain**, **water/ice**, and a **life-detection score**.

| Variable | Earth | Moon | Mars |
|---|---|---|---|
| Terrain: slope, roughness, elevation (easiest next step) | NASADEM / SRTM | LRO LOLA | MGS MOLA |
| Water / ice | Permafrost maps, SMAP soil moisture | LRO, M3, permanently shadowed craters | Odyssey hydrogen, SWIM ice maps |
| Minerals (water-formed clays, sulfates, salts) | NASA EMIT, ASTER | Moon Mineralogy Mapper (M3) | CRISM / OMEGA |
| Sunlight (power for a Moon base) | POWER solar radiation | LOLA illumination maps | Mars Climate Database |
| Thermal inertia (sand vs bedrock) | MODIS day/night | Diviner rock abundance | TES / THEMIS |
| Dust, wind, dryness, UV | MERRA-2, POWER | Not applicable / CRaTER | MCD, Curiosity RAD |
| Craters, caves, lava tubes | Earth Impact DB, volcano DBs | Robbins craters, LROC pits | Robbins craters, USGS cave catalogue |

- **"Signs of life":** no life is known on the Moon or Mars, so frame it as habitability. Two options:
  - **Life-detection test sites:** very dry places with almost no vegetation (MODIS NDVI) and high UV.
  - **Biosignature preservation:** hot-spring silica, salt flats and clays, which resemble Columbia Hills, Mars's chloride deposits and the Jezero delta.
- **App design for many variables:**
  - score each variable 0–100%
  - user-adjustable weights
  - a radar-chart "analogy profile" per match
  - mission presets: Moon base, rover testing, life detection
  - variables that can't be matched shown greyed out

## Notes for whoever runs this on Windows
- Fetching spaceappschallenge.org failed with certificate errors on Christian's network. That network also drops some HTTPS connections at random, so use retries.
- Paths in the repo are relative. Run `server.js` and `load_temps.py` from anywhere.
