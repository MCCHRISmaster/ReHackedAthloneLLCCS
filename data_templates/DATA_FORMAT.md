# Data format guide

Put gathered data into these CSV layouts and the app can use it directly. There are three templates:

| File | Use it for |
|---|---|
| `grid_template.csv` | **Whole-planet maps** (Moon, Mars, or a global Earth grid). One row per 2° cell. |
| `sites_template.csv` | **Individual places** (known analogs, candidate analogs, mission sites). One row per site. |
| `sources_template.csv` | **Where each number came from.** One row per dataset. Every data row's `source_id` must appear here. |

⚠️ The numbers in the example rows only show the format. They are made up (except the two Earth sites, which are real NASA POWER values), so replace them all.

---

## 1. Grid files: `grid_template.csv`

Save one file per body, named `moon_grid.csv`, `mars_grid.csv` or `earth_grid.csv`.

### The grid
- **2° × 2° cells → 90 rows of latitude × 180 columns of longitude = 16,200 rows per file.**
- `lat` and `lon` are the **centre** of each cell:
  - `lat` = 89, 87, 85 … −87, −89 (90 values)
  - `lon` = −179, −177 … 177, 179 (180 values)
- Row order doesn't matter, but every cell must appear **exactly once**.

### Columns

| Column | Required | Units | Meaning |
|---|---|---|---|
| `body` | yes | – | `moon`, `mars` or `earth` (lower case) |
| `lat` | yes | degrees | Cell-centre latitude, north positive |
| `lon` | yes | degrees | Cell-centre longitude, **east positive, −180 to 180** |
| `temp_mean_c` | yes | °C | Average **surface** temperature over full day-night cycles and the whole year |
| `temp_high_c` | yes | °C | Typical daily **maximum** (yearly average of daily highs) |
| `temp_low_c` | yes | °C | Typical daily **minimum** (yearly average of daily lows) |
| `elevation_m` | optional | metres | Height above the body's reference surface |
| `slope_deg` | optional | degrees | Average slope within the cell |
| `water_ice_pct` | optional | % | Water-equivalent hydrogen or ice content, if available |
| `source_id` | yes | – | Matches a row in `sources_template.csv` |

- **Leave a cell empty if the value is unknown.** Don't write 0, −999 or NaN.
- New variables can be added as extra columns. Use lower-case names that end with their unit: `_c`, `_m`, `_deg`, `_pct`.

### Rules that keep the comparison fair
1. **Use surface (ground) temperature, not air temperature.** The Earth side uses NASA POWER `TS`, which is ground-skin temperature. The Moon has no air, and Mars air temperature behaves very differently from the ground.
2. **Use °C.** Most Moon and Mars datasets are in Kelvin: °C = K − 273.15.
3. **Longitude must be −180 to 180.** Many Mars datasets use 0–360° east: if `lon > 180`, use `lon − 360`.
4. **Use planetocentric latitude** if the dataset offers a choice (most do by default).
5. **Coarsen fine data by averaging.** Example: Diviner at 0.5° has 16 cells inside each 2° cell, so average those 16. Average highs with highs and lows with lows.
6. **Fill in coarse data by interpolating.** Example: the Mars Climate Database is about 5.6° × 3.75°, so interpolate linearly to the 2° cell centres.
7. Round to 1 decimal place. More precision is just noise.

### Where to get the temperatures

| Body | Dataset | Notes |
|---|---|---|
| Moon | LRO Diviner global surface temperature (PDS Geosciences Node) | Look for average / max / min bolometric temperature maps |
| Mars | Mars Climate Database (www-mars.lmd.jussieu.fr), free registration | Surface temperature (`tsurf`), averaged over all seasons and local times |
| Earth | NASA POWER (`TS`, `TS_MAX`, `TS_MIN`) or MERRA-2 | Only needed for the reverse search, Moon/Mars → Earth |

---

## 2. Site files: `sites_template.csv`

One row per place, in a single file (`sites.csv`) for all bodies.

| Column | Required | Meaning |
|---|---|---|
| `site_id` | yes | Short unique id, lower case with underscores, e.g. `haughton_crater` |
| `name` | yes | Display name |
| `body` | yes | `earth`, `moon` or `mars` |
| `lat`, `lon` | yes | Exact location in decimal degrees (same conventions as above, 2 decimals) |
| `site_type` | yes | `known_analog`, `candidate_analog` or `mission_site` |
| `temp_mean_c`, `temp_high_c`, `temp_low_c` | if known | Same definitions as the grid |
| `elevation_m` | if known | metres |
| `notes` | optional | One line on why the site matters. **No commas**, or wrap the text in "double quotes" |
| `source_id` | yes | Matches `sources_template.csv` |

---

## 3. Sources: `sources_template.csv`

Fill this in as you go. You need it for the submission ("which NASA data did you use?") and so anyone can repeat the processing.

| Column | Meaning |
|---|---|
| `source_id` | Short id used in the other files |
| `body` | earth / moon / mars |
| `dataset` | Full dataset name and version |
| `variables` | Which of our columns it fills, separated by `;` |
| `original_units` | Units before conversion |
| `resolution` | Original grid size |
| `url` | Download page |
| `downloaded_on` | YYYY-MM-DD |
| `processing_notes` | What you did: unit conversion, averaging, interpolation, season choice |

---

## Checking and loading a grid

From the repo root:

```
python prototype/tools/csv_to_grid.py data_templates/moon_grid.csv
```

The script checks the file: every cell present once, coordinates in range, temperatures plausible. If the file passes, it writes `prototype/grids/moon.json`, which the app loads on the next refresh. Add `--check` to validate without writing.
