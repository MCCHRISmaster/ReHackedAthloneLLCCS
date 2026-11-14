# HackAthlone 2026: Earth analogs for the Moon and Mars

NASA Space Apps 2026 challenge: *Permanent Moon Base Locations and Mars*.
The goal is to find places on Earth whose surface temperature matches areas of the Moon and Mars.

## Run the web app

Double-click **`start.bat`** (Windows), or run this from this folder:

```
node prototype/server.js . 8000
```

Then open http://localhost:8000. It goes straight to the 3D globe (Analog Atlas).

**How to use it:** on the Earth globe, click anywhere (or an analog site) to get that spot's surface temperature
from NASA POWER. Then switch to the Moon or Mars. The globe is covered in a 2° grid coloured from green (same temperature)
to red (far apart). Hover over a cell to see its temperature and match %.

## What's here

- [`analog-atlas/analog-atlas/`](analog-atlas/analog-atlas/): **Analog Atlas**, the main app: a 3D globe of Earth, the Moon and Mars with analog sites, mission briefings and the temperature-match heat map (NASA WebWorldWind). The Moon/Mars grids are in `data/moon_grid.csv` and `data/mars_grid.csv`.
- [`heatmap/`](heatmap/): **Temperature Match Grid**, which loads grid CSVs and colours every 2° cell from green (match) to red.
- [`data_templates/`](data_templates/): CSV formats for gathering data, plus the rules in `DATA_FORMAT.md`.
- [`prototype/`](prototype/): **Analog Finder**, a web app. Click a point on Earth to see heat maps of matching temperatures on the Moon and Mars. See its README for how to run it.
- [`data/`](data/): 2023 daily temperatures from NASA POWER for five known analog sites, in both CSV and JSON.
- [`load_temps.py`](load_temps.py): loads those files with pandas and prints a summary table.

Team: Liam, Charlie, Christian, Louis, Stuart.
