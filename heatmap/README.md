# Temperature Match Grid

A basic 2D heat map built from CSV input. Each 2° cell of the Moon and Mars is coloured by how close
its temperature is to an Earth temperature: **green = 100% match, red = 0%**, grey = no data.

## Run

From the repo root:

```
node prototype/server.js . 8001
```

Open http://localhost:8001/heatmap/. The page loads `samples/*_grid_sample.csv` and the Earth sites
from `data_templates/sites_template.csv` automatically.

You can also double-click `index.html` without a server. Samples won't auto-load that way, but you can load
CSVs with the "Load CSV" buttons or by dragging a file onto a map.

## Input

- **Grid CSVs:** the format in `data_templates/DATA_FORMAT.md` (columns `body, lat, lon, temp_mean_c,
  temp_high_c, temp_low_c`, 2° cell centres). Partial files work, and missing cells show grey.
- **Sites CSV** (optional): `sites_template.csv` format. Earth rows fill the site dropdown.

## Match formula

`match = max(0, 1 − |T_cell − T_earth| / range)`. `range` is the slider value (40 °C by default).
The "≥ 75%" figure is weighted by cell area, because cells near the poles are smaller.

⚠️ The sample grids are the placeholder model from `prototype/`, not measured data.
Replace them with real Diviner / Mars Climate Database grids in the same format.
