# Analog Finder (prototype)

Click a point on Earth. The app fetches its ground-surface temperature from NASA POWER,
then shades the Moon and Mars maps by how close their temperature is (100% = same, 0% = far apart).

## Run

```
cd space-apps-analogs/prototype
node server.js
```

Open http://localhost:8000. (Python's `http.server` drops downloads at random on this
machine, so the prototype ships its own small Node server.)

## Files

| Path | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The app (plain HTML/JS, no build step) |
| `server.js` | Local static file server |
| `assets/*.jpg` | Base maps: NASA GIBS Blue Marble, Moon Trek LRO WAC, Mars Trek Viking MDIM 2.1 |
| `grids/moon.json`, `grids/mars.json` | Temperature grids, 2° cells, °C, with `mean` / `high` / `low` |
| `tools/build_assets.py` | Re-downloads the maps and rebuilds the grids |

## How the match is calculated

`match = max(0, 1 - |T_body - T_earth| / range)`. `range` is the "0% match" slider, 40 °C by default.
The Earth average is compared with the body average, the daily high with the daily high, and the low with the low.

## Known limitations

- **The Moon and Mars grids are a simplified model, not measured data.** They come from sunlight
  by latitude plus mosaic brightness as a stand-in for albedo. Next step: rebuild `grids/*.json`
  in the same layout from LRO Diviner (Moon) and the Mars Climate Database (Mars).
- Earth values are 2001–2025 climatology for a cell about 50 km across, not a live reading.
- Comparing averages often finds no match: Earth's average temperatures are warmer than
  almost anywhere on the Moon or Mars. Daily highs and lows overlap much more.
