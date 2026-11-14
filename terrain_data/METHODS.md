# Methods

How the non-temperature data layer and the combined similarity score were built, in plain terms, including every proxy, shortcut and limit. The temperature grids for the Moon and Mars come from teammates and are used unchanged.

## 1. The idea in one paragraph

Pick an Earth place and a Moon or Mars place. For about twenty measurable things (slope, roughness, rock type, rainfall, ice, temperature and so on) work out how close the two values are, on a scale from 0 (nothing alike) to 1 (identical). Average those matches inside each of the eight dimensions the challenge brief names, then combine the eight dimension scores with weights that depend on what the user wants (a crewed mission, a base, a rover). Gravity, vacuum or thin air, radiation and the two-week lunar night are never scored. They are fixed warnings on every card, because no Earth site can reproduce them.

## 2. Grids

| Body | File | Cells | Notes |
|---|---|---|---|
| Moon | `out/moon_features.csv` | 16,200 at 2 degrees | team layout: row 0 is the north edge, longitudes -180 to 180, cell centres at odd degrees |
| Mars | `out/mars_features.csv` | 16,200 at 2 degrees | same layout |
| Earth ranking | `out/earth_features_1deg.csv` | 64,800 at 1 degree | only cells with at least 25 percent land carry values (22,513 cells) |
| Earth globe | `out/earth_features_2deg.csv` | 16,200 at 2 degrees | land-area-weighted mean of the four 1-degree cells; blank if none has land |

Coarsening is by block averaging. Nothing finer than its source is ever invented; two products are coarser than the grid and say so below (Lunar Prospector chemistry and the Odyssey hydrogen map). Extra columns follow the team rule of a unit suffix. Index columns (`_idx`, 0 to 1) are written to three decimals instead of one, because one decimal would make them move in steps of 0.1.

Point sets (volcanoes, caves, craters, pits) are counted per cell by their centre point, and nearest distances are great-circle distances from the cell centre, so a cell can be a long way from a point that sits at its edge.

## 3. Features by body

### Moon (2 degrees)

| Columns | Source and method | Dimension |
|---|---|---|
| `elevation_m`, `relief_m`, `roughness_m`, `slope_mean_deg` | LRO LOLA gridded DEM at 16 pixels per degree (1.9 km). Mean, max minus min, and standard deviation of height over each cell. Slope by central differences; in each row the east-west step widens as `1/cos(latitude)` (capped at 64 pixels) so polar slopes are not noise. Slope baseline is 1.9 km, a regional slope, not a boulder slope. | terrain, operations |
| `crater_density_5km_n`, `crater_density_20km_n` | Robbins 2018 lunar crater database, craters 5 km and larger, and 20 km and larger, per 100,000 km2. The 20 km column is mostly zero in a 2-degree cell and is not used in scoring. | terrain |
| `feo_pct`, `tio2_pct`, `th_ppm` | Lunar Prospector gamma-ray spectrometer, 2-degree product. Its pixels are 1 to 2 degrees tall and 1.5 to 6 degrees wide, so each cell takes the pixel that holds its centre and the data are coarser than the grid. The "high-resolution" product is noisy: iron oxide reaches 31 weight percent in places where real maxima are near 22. | geology |
| `mare_idx` | 0 at 8 weight percent FeO or less, 1 at 15 or more, linear between. A proxy for basalt plains (maria). | geology, subsurface |
| `pit_n`, `pit_nearest_km`, `mare_pit_n` | LROC Lunar Pit Atlas. Only mare and highland collapse pits are used: 21 of the 278 entries. The other 257 are impact-melt pits, which are not lava-tube skylights. | subsurface |
| `lavatube_idx` | 0.5 x `mare_idx` + 0.5 x min(1, mare pits in the cell / 2). A proxy. | subsurface |
| `illum_idx` | **Proxy.** (90 - abs(latitude) - 1.54) / 90, clipped to 0 to 1: how high the Sun can climb. Real polar illumination maps were not used. | thermal, operations |
| `water_idx` | **Proxy.** 0 below 70 degrees latitude, 1 at the pole, linear between. It stands in for permanently shadowed cold traps. The LROC shadowed-region shapefiles could not be listed (the archive page is JavaScript only) and the LOLA polar illumination folder does not exist. Lunar Prospector neutron hydrogen was skipped. | water |
| temperatures | not produced here; read from `moon_data/moon_grid.csv` (LRO Diviner) | thermal |

### Mars (2 degrees)

| Columns | Source and method | Dimension |
|---|---|---|
| `elevation_m`, `relief_m`, `roughness_m`, `slope_mean_deg` | MGS MOLA topography at 16 pixels per degree (3.7 km), processed as for the Moon. | terrain, operations |
| `pressure_pa` | **Estimate**: 610 x exp(-elevation / 11,100 m). Not measured. | operations |
| `crater_density_5km_n`, `crater_density_20km_n` | Robbins and Hynek 2012, fetched through the USGS data API (largest first, 5 km and larger). | terrain |
| `thermal_inertia_tiu` | MGS TES nighttime thermal inertia (Putzig and Mellon 2007), cell mean. High means rock, low means dust. | geology, dust |
| `dust_cover_idx` | **Proxy** from thermal inertia: 1 at 100 or less, 0 at 350 or more. | dust |
| `weh_pct` | Mars Odyssey GRS water-equivalent hydrogen, 5-degree smoothed map, bilinearly interpolated. Poleward of about 60 degrees the product has no value; those cells stay blank. | water |
| `water_idx` | max(`weh_pct` / 30 capped at 1, latitude proxy), where the proxy is 0 below 40 degrees and 1 above 60. The proxy keeps polar ice from being scored as dry. | water |
| `geo_*_pct` | USGS SIM 3292 (Tanaka 2014). The 44 unit codes are grouped into volcanic, highland, lowland, impact, transition, polar, basin and apron by the word in each unit description. Polygons are rasterised at 0.1 degree and averaged to 2 degrees; each cell's groups sum to 100. | geology |
| `lavatube_idx` | **Proxy**: 0.6 x volcanic share + 0.4 x closeness (1 within 300 km, 0 beyond 1,500 km) to Arsia, Pavonis, Ascraeus, Olympus and Alba Mons, where skylight candidates have been reported. The USGS Mars cave catalog could not be downloaded. | subsurface |
| `illum_idx` | **Proxy**: (90 - abs(latitude)) / 90. | thermal, operations |
| temperatures | not produced here; read from `mars_data/mars_grid.csv` (Mars Climate Database) | thermal |

Not built: Mars dust-storm counts (MDAD), TES albedo, and the Mars cave catalog.

### Earth (1 degree)

| Columns | Source and method | Dimension |
|---|---|---|
| `land_pct`, `country`, `admin_region` | Natural Earth 1:50m land (rasterised at 1 arc-minute) and country polygons; county names for Ireland from the 1:10m admin-1 layer. Country is taken at the cell centre, or the nearest country within 300 km if the centre is in the sea. | metadata |
| `elev_mean_m`, `elev_min_m`, `elev_max_m`, `relief_m`, `roughness_m`, `slope_mean_deg` | NOAA ETOPO 2022 surface elevation at 60 arc-seconds (1.85 km), land pixels only. Slope as for the Moon, baseline 1.85 km. | terrain, operations |
| `lith_*_pct`, `karst_idx` | GLiM global lithology (Hartmann and Moosdorf 2012), 0.5-degree grid with one dominant first-level class per cell. A 1-degree value is the share of its four sub-cells in each class, so values move in steps of 25 percent. Volcanic = va+vb+vi, basic volcanic = vb, carbonate = sc, evaporite = ev, unconsolidated = su, siliciclastic = ss+sm, plutonic = pa+pi+pb, metamorphic = mt, ice = ig. `karst_idx` = (carbonate + evaporite) / 100. | geology, subsurface, water |
| `volcano_n`, `volcano_nearest_km`, `volcano_nearest_type`, `volcano_prox_idx` | Smithsonian Global Volcanism Program, Holocene volcanoes. Proximity is 1 within 50 km and 0 beyond 500 km. | geology |
| `crater_nearest_*`, `crater_prox_idx`, `cave_*` | The curated impact-structure and cave tables (about 75 and 50 rows). They are samples, not censuses: "nearest cave" means the nearest one on our list. Crater proximity is 1 within 25 km and 0 beyond 250 km. | terrain, subsurface |
| `precip_mm_yr`, `vapr_kpa`, `wind_ms`, `srad_kj_m2_day`, `tavg_c`, `tmin_c`, `tmax_c`, `diurnal_range_c` | WorldClim 2.1 climate normals 1970 to 2000 at 10 arc-minutes, annual sum (rain) or mean of 12 months, block-averaged to 1 degree. Air temperatures, not ground temperatures. | thermal, dust, operations |
| `aridity_idx` | 1 - min(1, precipitation / 1000). A simple dryness index, not the UNEP aridity index. | habitability, dust |
| `barren_pct` | **Proxy** for the share of ground with almost no plants: clip((250 - precipitation) / 250, 0, 1) x 100. | habitability |
| `dust_idx` | **Proxy**: `barren_pct`/100 x (0.5 + 0.5 x min(1, wind / 6)). | dust |
| `permafrost_idx` | **Proxy** from air temperature: 1 below -6 C, 0.5 below -2, 0.25 below 0, else 0. | water |
| `ice_idx` | max(ice share of lithology, `permafrost_idx`). | water |
| `lavatube_idx` | basic volcanic share x max(closeness to a Holocene volcano, closeness to a listed lava tube), each 1 within 50 km and 0 beyond 300 km. | subsurface |
| `pressure_hpa` | 1013.25 x (1 - 2.25577e-5 x elevation)^5.2559. | operations |
| `solar_idx` | `srad_kj_m2_day` / 30,000, capped at 1. Earth sunlight is measured surface radiation; Moon and Mars use the geometric proxy above, so this comparison is the roughest in the list. | thermal |
| `temp_mean_c`, `temp_high_c`, `temp_low_c` | NASA POWER climatology (surface skin temperature, 2001 to 2025), the same product and method as the team's `earth_grid.csv`, completed over every land box. | thermal |

**Why the plan changed.** The build prompt called for NASA NEO products (vegetation, aerosol, snow, MODIS land temperature). NEO no longer serves data files: every data address returns a web page instead. The vegetation, dust and snow features became the climate proxies above, and the MODIS temperature fallback became a full NASA POWER pull. Anyone who restores a real NDVI or aerosol product should replace `barren_pct` and `dust_idx` first.

## 4. The score

For each comparison `f`, with Earth value `e` and target value `t` already in comparable units:

```
match_f = max(0, 1 - |e - t| / range_f)
```

If either side has no value, the comparison is skipped. The fixed ranges, the way each body's value is built, and each comparison's dimensions are in `config/features.json` (21 comparisons). A comparison can count toward more than one dimension (slope counts for terrain and operations; dryness for habitability and dust).

- **Dimension score** = mean of the available matches in that dimension. **Coverage** = available / total in that dimension.
- **Overall** = sum(weight x dimension score) / sum(weight), over dimensions that have data. It is shown on 0 to 100 and needs at least 10 of the 21 comparisons to have data, otherwise it is shown as unavailable.
- **Presets** (`config/presets.json`): raw similarity (equal weights), crewed mission, base construction, rover landing. The weights are a human decision recorded in the build prompt.
- **Losses**: each comparison's lost points are `(weight_d / W) x (1 - match) / n_d x 100`, summed over its dimensions, where `W` is the weight of the dimensions with data. Overall plus all lost points is exactly 100. The top three become the plain sentences on the card.
- **Alternatives** ("cut your losses"): the best-scoring Earth 1-degree land cell for the same target and preset, in the same country, within 1,000 km, and worldwide.
- **Where the value comes from for each body** is one line per comparison in `features.json`. Constants (for example the Moon is dry, dusty, windless and barren) are the "absence value": Earth's own value is then the penalty. Tuning of ranges and constants is listed at the end of this file.

Named Earth sites are scored at the 1-degree cell that holds them. A site in a cell with 1 to 25 percent land (islands) uses that cell's own values from `work/earth_features_all.npz`. If a site still has no data it would borrow the nearest land cell within 250 km (none needed it in the final run). Three tiny basalt islands (Timanfaya, the Corona lava tube, Vulcano) have no GLiM class, so their rock type is set to basaltic by hand, marked `lith_override` in the curated table. Sites flagged acidic, hypersaline, hydrothermal or hyperarid get an extremophile value of 1.

`pipeline/score_core.py` and `js/score.js` implement the same rules. `pipeline/70_validate.py` runs both on ten pairs; they agree to better than one part in ten million.

## 5. Cannot be matched (never scored)

Gravity (Moon one sixth, Mars 38 percent of Earth), vacuum or very thin air, radiation, and the two-week lunar night. They are written once per body in `config/caveats.json` and shown on every card.

## 6. Limits in plain words

- Earth values are averages over a 1-degree cell, about 110 km by 70 km at Ireland's latitude. A site is a point inside a much bigger cell, so a small feature (a crater, a single cave) is smoothed away.
- The Moon and Mars have fewer measured quantities than Earth has, so some dimensions rest on proxies, labelled above. The honest weak points are lunar water and illumination, Mars lava tubes, and Earth vegetation and dust.
- The curated tables (analog sites, caves, impact structures, targets) were drafted by an AI and only their coordinates were checked, against Wikipedia (`validation.md`, section 7). Diameters, ages, lengths and programme descriptions are unchecked. The nine Artemis III region centres are approximate.
- Scores are similarity of conditions, not a recommendation to build anywhere.

## 7. Shortcuts and substitutions (everything not as the build prompt planned)

| Planned | What happened |
|---|---|
| NEO vegetation, aerosol, snow | NEO no longer serves data. Climate proxies instead. |
| MODIS land-surface-temperature fallback | Replaced by a full NASA POWER pull. |
| LROC permanently shadowed regions | Not reachable. Latitude proxy for lunar water. |
| LOLA polar illumination | Folder does not exist. Geometric proxy. |
| Lunar Prospector hydrogen | Skipped (cut-list item). |
| Mars cave catalog | USGS Astropedia host unreachable. Latitude and volcano proxy for lava tubes. |
| Mars dust storms, TES albedo | Skipped. |
| USGS Artemis III region centres | ScienceBase refused access. Approximate centres, marked `approximate`. |
| Robbins Moon crater file | The planned address was down; the same file came from another USGS host. |
| WorldClim | The main host reset; the mirror `biogeo.ucdavis.edu` worked. |
| ESA CAVES cave in Sardinia | The prompt named "Sa Grutta"; the entry uses the Su Bentu cave system with coordinates still to be confirmed. |
| GLiM "fractions per class" | The download holds one dominant class per 0.5-degree cell; shares are quarters. |
| Crater column for scoring | `crater_density_5km_n` is used instead of the 20 km column. |
