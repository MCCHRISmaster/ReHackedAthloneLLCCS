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
| `temp_mean_c`, `temp_high_c`, `temp_low_c` | NASA POWER climatology (surface skin temperature, 2001 to 2025), the same product and method as the team's `earth_grid.csv`, completed over every 10-degree box, ocean included, so the 2-degree grid has no blank cell and passes the team checker. Over the sea the value is the sea-surface skin temperature; scoring only uses land cells. | thermal |

### Ground and soil composition (all bodies, `out/*_soil*.csv`)

Built by `pipeline/35_soil_features.py` (`run_all.py --phase soil`) into separate files, so a failed soil download never touches the terrain outputs. Every loader merges them by cell: `score_data.py` (Python scorer), `js/test_score.mjs` and `demo/live.html` (browser scorer), and the globe (`analog-atlas/.../js/main.js`). The common basis is **element concentration in the top tens of centimetres**, which is what orbital gamma-ray spectrometers see.

| Columns | Source and method | Dimension |
|---|---|---|
| Moon `fe_pct`, `si_pct`, `k_pct`, `th_ppm` (+ `mgo_pct`, `al2o3_pct`, `sio2_pct`, `cao_pct`, `tio2_pct`, `feo_pct`) | The same Lunar Prospector 2-degree product as above, all columns kept. Oxides converted to elements: Fe = 0.777 x FeO, Si = 0.467 x SiO2, K wt% = K ppm / 10,000. Exactly 0 is a fit failure (1 FeO pixel, 432 K pixels) and is left blank. | geology |
| Mars `fe_pct`, `si_pct`, `k_pct`, `th_ppm`, `cl_pct` | Mars Odyssey GRS element maps (Boynton et al. 2007), 5-degree smoothed, bilinearly interpolated to 2-degree centres as for hydrogen. Fe, Si and Cl cover about 55 percent of cells (mid-latitudes), K and Th about 98 percent. | geology |
| Earth `clay_pct`, `silt_pct`, `sand_pct`, `soc_g_kg`, `ph_h2o`, `bdod_g_cm3`, `cfvo_pct` | ISRIC SoilGrids 2.0, topsoil 0 to 5 cm mean, fetched from the WCS resampled to 0.1 degree, averaged into 1 and 2-degree cells. The WCS output has no nodata tag, so 0 means sea, ice or rock (real topsoil carbon never goes below 1 g/kg). | habitability (organic carbon), display |
| Earth `fe_pct`, `si_pct`, `k_pct`, `th_ppm`, `chem_cover_pct` | **Estimate, not a measurement.** No global map of Earth soil iron or thorium exists. Each cell's GLiM rock-type shares are multiplied by a typical composition per type (`ROCK_CHEM` in the script: basalt, granite, shale, sandstone and carbonate from Turekian and Wedepohl 1961, metamorphic and unconsolidated from Rudnick and Gao's upper crust). Blank when less than 20 percent of the cell has a rock class. The three `lith_override` basalt islands get the basalt row. | geology |

Four comparisons use them (`config/features.json`): **iron** (range 8 wt%), **potassium** (2 wt%) and **thorium** (8 ppm) under geology, and **organic carbon** (15 g/kg, Earth capped at 30; Moon and Mars are the absence value 0) under habitability. The globe shows them as the 🪨 Ground & soil symbol, with the extra columns in the data grid.

What this shows: Mars soil is 11 to 19 percent iron, while the most iron-rich common rock on Earth (basalt) is about 8.7 percent, so no Earth place matches Mars on iron. Lunar highlands (about 3 to 4 percent iron, low potassium) match anorthosite and granite country well, and lunar mare matches basalt. Limits: the Earth values come from bedrock, not soil; ore bodies such as Río Tinto's iron-rich rocks are far smaller than a 1-degree cell; a layered mafic intrusion such as Stillwater counts as "plutonic" and gets granite-like chemistry.

### Air, atmosphere and gases at the surface (all bodies, `out/*_gases*.csv`)

Built by `pipeline/36_gas_features.py` (`run_all.py --phase gases`; `--mars` and `--earth` download separately and can run side by side) into separate files merged by cell, like the soil grids. The team grids (`*_data/*_grid.csv`) are only read: their `pressure_pa` is the base for the partial pressures.

| Group | Columns | Earth | Mars | Moon |
|---|---|---|---|---|
| Surface air | `co2_pct`, `n2_pct`, `o2_pct`, `ar_pct`; `pp_*_pa` = share x pressure | Dry-air constants x surface pressure (NASA POWER at 2 degrees; standard atmosphere from elevation at 1 degree), so only altitude changes them | MCD shares 2 m above the ground, 12 seasons weighted by length | 0 (vacuum) |
| Trace gases (display) | `co_ppm`, `h2_ppm`, `he_ppm`, `o3_ppb`, `ch4_ppb` | Typical / global-mean constants | MCD; methane is Curiosity's 0.41 ppb at Gale, a constant | blank |
| Whole atmosphere | `air_column_g_cm2` = pressure / gravity; `ozone_du`; `haze_tau` | POWER `TO3`, `AOD_55` (land boxes only) | MCD `col_o3` (1 Dobson unit = 2.1415e-5 kg/m2), `dod` | 0 |
| Gas at the surface | `co2_frost_kg_m2`, `co2_frost_months` (months above 1 kg/m2), `h2o_frost_kg_m2` | CO2 frost 0 | MCD `co2ice`, `surf_h2o_ice` | not mapped (notes in the globe) |

Four comparisons use them, on log10(1 + value) so the Moon's vacuum still has a value (`log1p` in `features.json`, implemented in both scorers): **oxygen in the air** (habitability, range 3 decades), **carbon dioxide in the air** (operations, 3 decades), **ozone overhead** (habitability, 2.5 decades) and, on a linear scale, **dust and haze** (dust, optical depth range 1). Nitrogen, argon, the air column, trace gases and frost are shown in the globe's data grid but not scored: the air column largely repeats the pressure comparison, and radiation is a "never scored" caveat.

**Assumption: what can never be matched counts a quarter.** Oxygen, carbon dioxide and ozone carry `"weight": 0.25` in `features.json` (each comparison's share inside its dimension; every other comparison has weight 1). The reason is written next to each one (`weight_why`). No Earth place can ever truly match them: everywhere on Earth has about 21 kPa of oxygen (about 11 kPa on the highest plateaus), about 40 Pa of CO2 and about 300 Dobson units of ozone. Mars has about 1 Pa of oxygen, about 13 times Earth's CO2 and under 1 Dobson unit of ozone, and the Moon has none of the three. In full weight they would only lower every Earth place by almost the same amount and push real differences (terrain, dust, temperature) out of the score. They are not dropped either, because they are exactly where every analog breaks down. They are stated three times: in the caveats on every card (`caveats.json`), in the globe's Air panel ("counts ¼") and in the globe's **🏗️ Future base** section.

**Thinking of the future base.** The gas gaps are reframed as what a permanent base at the matched spot must provide for itself:
- **Oxygen.** On the Moon it is made from regolith, which is about 45 percent oxygen by mass. On Mars it is made from the CO2 air, as MOXIE showed.
- **Carbon dioxide.** On Mars it is a resource: oxygen, plus methane fuel with hydrogen from ice. On the Moon, carbon has to be brought from Earth and recycled.
- **UV and radiation shielding.** Regolith cover, and UV-blocking windows, visors and greenhouses.
- **Habitat pressure.** The base holds its own breathable atmosphere against vacuum or the thin Martian air.

Next to each gap is what the Earth place can still rehearse. The one gas factor Earth places really differ on, dust and haze, keeps full weight. The scored numbers stay similarity, not suitability; the base section is written from the target's data with fixed rules (`baseFor` in `analog-atlas/.../js/matchui.js`).

What this shows: Mars's air is 95 percent CO2 at about 600 Pa, so its CO2 pressure is about 13 times Earth's while its oxygen (about 1 Pa) and ozone (under 1 Dobson unit, against about 300) are close to the Moon's zero. Oxygen and ozone therefore score near 0 for every Earth place, which is why they count a quarter. Dust and haze is the gas comparison that separates Earth places: the Sahara and Arabia (optical depth 0.4 to 0.8) sit close to Mars's dusty air, while the Antarctic plateau and Arctic (under 0.05) sit close to the Moon. Mars's winter poles show the CO2 cycle: up to a third of the CO2 freezes onto the ground, so nitrogen and argon there rise to over 20 percent of the air.

**Why the plan changed.** The build prompt called for NASA NEO products (vegetation, aerosol, snow, MODIS land temperature). NEO no longer serves data files: every data address returns a web page instead. The vegetation, dust and snow features became the climate proxies above, and the MODIS temperature fallback became a full NASA POWER pull. Anyone who restores a real NDVI or aerosol product should replace `barren_pct` and `dust_idx` first.

## 4. The score

For each comparison `f`, with Earth value `e` and target value `t` already in comparable units:

```
match_f = max(0, 1 - |e - t| / range_f)
```

If either side has no value, the comparison is skipped. The fixed ranges, the way each body's value is built, and each comparison's dimensions are in `config/features.json` (30 comparisons, 4 from the soil grids and 4 from the gas grids). A comparison can count toward more than one dimension (slope counts for terrain and operations; dryness for habitability and dust).

- **Dimension score** = mean of the available matches in that dimension. **Coverage** = available / total in that dimension.
- **Overall** = sum(weight x dimension score) / sum(weight), over dimensions that have data. It is shown on 0 to 100 and needs at least 10 of the 30 comparisons to have data, otherwise it is shown as unavailable.
- **Presets** (`config/presets.json`): raw similarity (equal weights), crewed mission, base construction, rover landing. The weights are a human decision recorded in the build prompt.
- **Losses**: each comparison's lost points are `(weight_d / W) x (1 - match) / n_d x 100`, summed over its dimensions, where `W` is the weight of the dimensions with data. Overall plus all lost points is exactly 100. The top three become the plain sentences on the card.
- **Alternatives** ("cut your losses"): the best-scoring Earth 1-degree land cell for the same target and preset, in the same country, within 1,000 km, and worldwide.
- **Where the value comes from for each body** is one line per comparison in `features.json`. Constants (for example the Moon is dry, dusty, windless and barren) are the "absence value": Earth's own value is then the penalty. Tuning of ranges and constants is listed at the end of this file.

Named Earth sites are scored at the 1-degree cell that holds them. A site in a cell with 1 to 25 percent land (islands) uses that cell's own values from `work/earth_features_all.npz`. That file is a cache that is not committed; on a machine without it, the scorer reuses those sites' values from the last exported `out/sites.json` (which are the same cell values), so a rescore on a fresh clone gives the same island numbers. If a site still has no data it would borrow the nearest land cell within 250 km (none needed it in the final run). Three tiny basalt islands (Timanfaya, the Corona lava tube, Vulcano) have no GLiM class, so their rock type is set to basaltic by hand, marked `lith_override` in the curated table. Sites flagged acidic, hypersaline, hydrothermal or hyperarid get an extremophile value of 1.

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

## 8. Tuning log

Starting values were the ones in the build prompt (section 6.1). The prompt allows tuning a range when a classic analog ranks badly; every change is listed here with its reason.

| Change | Before | After | Why |
|---|---|---|---|
| Range of the "volcanic activity" comparison | 0.7 | 1.0 | An Earth place next to an active volcano (Hawaii, Iceland) scored zero against the Moon's flat 0.3. Being near an active volcano says something about activity, not about whether the ground is similar, so the penalty was softened. Mauna Kea's geology rank against Apollo 17 moved from 27th to 22nd of 72. |
| Minimum data for an overall score | none | 10 of 21 comparisons | A site with one comparison scored 88 (Vulcano, whose cell had no data). Overall is now unavailable below 10 usable comparisons. |
| Crater column for Moon and Mars | 20 km | 5 km | Few 20 km craters fall in a 2-degree cell, so that column is mostly zero. |

Nothing else was tuned. The pre-tuning configuration is saved in `work/features_before_tuning.json` (not committed).

## 9. What validation showed (read this before answering questions)

Twelve classic analog-versus-target pairs were ranked among all 72 named Earth sites (`out/validation.md`, section 3). The honest summary:

- **Good:** Haughton Crater and the Flashline station rank 1st and 2nd of 72 against the Phoenix polar landing site. Lava Beds ranks 1st for subsurface similarity to the Marius Hills pit. The Lofoten anorthosites rank 3rd, and Stillwater 8th, for highland geology against Apollo 16. Yungay ranks 4th for dust against Meridiani Planum.
- **Middling:** The Corona lava tube ranks 11th for subsurface against the Marius Hills pit, and Kilbourne Hole 12th for crewed training against Apollo 16.
- **Poor, with reasons:** Hawaiian basalt sites rank about 22nd for geology against Apollo 17, because Apollo 17 is a mix of mare basalt and highland massifs and the Lunar Prospector data smear it into a middling mare index. Rio Tinto ranks mid-table (34th) for habitability against Meridiani because the habitability dimension also rewards dryness and bare ground, which a wet river lacks; its extreme-life match is 100 percent. Haughton ranks 39th for Deuteronilus Mensae mainly because the Mars ice index there is a latitude proxy that gives only 0.2 at 44 degrees north, although the region is known to be ice-rich (water match 0), and its terrain match is only 45 percent. SP Crater ranks low against Apollo 16 because it is a basalt cone and Apollo 16 is highland (geology match 16 percent).

Across all 72 sites and all targets, the median overall score (raw preset) is about 43 against Moon targets and about 49 against Mars targets, and the thermal dimension is the weakest: its median match is 0.08 against Moon targets and 0.17 against Mars targets, and 90 percent of pairs are below 0.17 and 0.23. Terrain, geology, subsurface and water carry the totals.

**Read the scores as rankings, not percentages.** Many comparisons are matches because both places lack something (no ice, no vegetation, no wind on the Moon), and the Moon's constants for dust, wind and dryness are the same for every Earth place. A score of 57 means "better than most of the list", not "57 percent like Mars". The pitch is the ranking and the breakdown: the analogy breaks down in temperature, gravity, atmosphere and radiation long before it breaks down in terrain and rock.
