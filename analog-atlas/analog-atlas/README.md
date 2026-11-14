# Planetary Comparator (formerly Analog Atlas) — prototype

Interactive 3D Earth globe built on **NASA WebWorldWind**
(https://github.com/NASAWorldWind/WebWorldWind), first step toward a
"mission select" style map for comparing terrestrial analog sites with the Moon and Mars.

## Run locally
WorldWind needs a web server (browsers block WebGL textures from `file://`):

    cd analog-atlas
    python3 -m http.server 8000
    # open http://localhost:8000

## Controls
Drag = spin · scroll/pinch = zoom · right-drag = tilt · click marker = briefing
Click bare ground = point probe (scores vs the other two bodies) · `V` toggles Human / Rover scale.
All three planets sit on one wheel: the current one is the globe, the others hang behind it. Click one
(or ◀ / ▶ at the bottom, `Q` / `E`, `1`–`3`) and the whole wheel turns to bring it to the front.
`D` (or the SIMPLE / DETAILED VIEW button) switches between a plain-language overview and full technical detail.
Every left-hand panel collapses from its header; sections in the right-hand panel open and close individually.
Keys: `Q`/`E` previous/next planet, `1` Earth, `2` Moon, `3` Mars, `V` probe scale, `D` detail level, `T` Tactical view, `+`/`-` zoom, `R` auto-rotate, `H` home, `Esc` close panel.
Briefings link Moon/Mars targets to their Earth analogs (and back) — click one to jump planets.

## Point probe & scoring (placeholder data)
Clicking any point on any globe measures it (`js/analysis.js`) and finds the best-matching spot on each of the
**other two bodies**: Earth → Moon & Mars, Moon → Earth & Mars, Mars → Earth & Moon. Earth matches are kept on land
(a mask built from the bundled Blue Marble). For each body the panel shows a match %, a rating (strong / partial /
weak analog) and a plain-language explanation from `js/explain.js`: which conditions line up and what that lets a
crewed EVA or rover team test there, and which don't. Measurements, the whole-body differences (gravity, air,
radiation, day length) and data notes are in collapsible sections. The minimap pins the probed point and both best
matches; click a small map to go there.

Simple view (the default for new visitors) uses everyday names ("Steepness" rather than "Slope") and keeps
tables closed; Detailed view opens them. Open/closed choices are remembered in the browser.

## Simple view globes
- **Globes use the real NASA imagery in both views.** An optional "Illustrated" look (flat map colours with
  outlines, redrawn per tile by `illustrateImagery` in `js/tactical-fx.js`; colours in `ILLUSTRATED`,
  `js/config.js`) is at the top of the Imagery list for anyone who wants it.
- **Cleaner globe:** round pins with names only on hover or selection, no scanlines, a soft glow behind
  the planet, and Earth lit on the side facing you (no night side).
- **Easier to move:** north-up with no tilt, zoom kept between 0.003 and 6 planet radii (`SIMPLE_NAV`), and
  clicking a spot gently centres it. A "How to explore" card greets first-time visitors (reopen with `?`).

- **Metrics, weights, scales and planned NASA sources** are in `js/config.js` (`METRICS`, `SCALES`).
  Human scale averages over ~500 m, Rover over ~10 km, and the two weight metrics differently.
- **Score rule:** per metric `max(0, 1 − |Δ| / range)` (same rule as the team's temperature prototype), then a weighted mean.
- **No real data is wired in yet.** With `SIMULATE_MISSING_DATA = true`, values come from a deterministic noise
  model and are labelled SIM / SIMULATED DATA. They are not results.
- **To plug in a dataset:** `registerGrid(body, metricKey, { values })` with an equirectangular grid
  (row 0 = north, col 0 = 180°W, any resolution). The team prototype's `grids/moon.json` / `mars.json`
  `high` / `low` arrays fit directly as `tempHigh` / `tempLow`.

## Layout
    index.html          page shell + HUD markup
    css/style.css       tactical HUD theme (accent colour changes per body)
    js/config.js        bodies, imagery layer catalogue, camera, colours, analog dimensions
    js/layers.js        NASA layer factories (Trek WMTS, GIBS WMS, bundled, placeholder), grid/zone overlays, online probe
    js/tactical-fx.js   Tactical-view canvas effects (stylise, contours, hatch, ring)
    js/data/sites.js    Earth analogs + Moon/Mars targets, with cross-links
    js/globe.js         GlobeView: all WorldWind code (per-body globe, layers, markers, picking, camera)
    js/ui.js            HUD rendering (planet selector, lists, imagery selector, briefing, probe panel)
    js/analysis.js      point measurement, match scoring vs the other bodies, best-match search, Earth land mask, real-data hook
    js/explain.js       plain-language "why test here" explanations built from a probe result
    js/minimap.js       minimap panel (camera view box, sites, probe + best-match pins)
    js/space.js         planet wheel behind the globe + wheel-spin switch animation
    js/planet-art.js    rotating 3-D background globes (NASA imagery on a lit sphere), CSS fallback spheres, flat minimap maps
    js/main.js          app state + wiring
    lib/worldwind.min.js  WebWorldWind bundled from source (commit 5ffe2df, v0.11.0)
    lib/images/         Blue Marble, night lights, star field (from the WorldWind repo)
    tools/build-worldwind.js  rebuilds lib/worldwind.min.js from a WebWorldWind checkout

## Imagery (all NASA)
| Body  | Layers | Service |
|-------|--------|---------|
| Earth | Blue Marble + relief (500 m), Blue Marble NG (500 m), Landsat WELD (30 m), ASTER GDEM relief (~30 m) | NASA GIBS WMS |
| Moon  | LRO WAC mosaic (~100 m), LOLA colour relief, LOLA hillshade | NASA Moon Trek WMTS |
| Mars  | Viking MDIM 2.1 colour (232 m), MGS MOLA colour relief, MGS MOC atlas | NASA Mars Trek WMTS |

`ONLINE_MODE = 'auto'` probes Trek at start-up. If NASA's servers can't be reached
(no internet, or inside the sandboxed claude.ai preview) it falls back to the bundled
Blue Marble for Earth and a placeholder sphere for the Moon/Mars.

Zoom depth per Trek layer is capped at the levels the server actually returns
(checked Nov 2026); see comments in `js/config.js`.

## Tactical view (`T`)
A stylised mission-map mode built from the same NASA data:
- **Imagery** is greyscaled, posterised and tinted to the body's accent colour (`stylizeImagery`).
- **Contour lines** are traced per tile from NASA elevation data (`contourTile`): LOLA DEM (Moon),
  ASTER GDEM elevation index (Earth) and MOLA colour elevation (Mars, using its colour bands).
- **Sector grid**, **hatched target zones** and a **pulsing selection ring** are drawn on the surface.
- A CSS scan sweep and heavier scanlines sit on top.

Tune it per body in `BODIES.<id>.tactical` in `js/config.js` (bands, brightness ceiling, edge strength,
contour count). The effects live in `js/tactical-fx.js`; tiles are transformed once as they load and
cached separately from the real-colour tiles, so switching views is instant after the first pass.
Overlay strengths (grid, zone rings and hatching) shared by the globe and the background planets are in
`TACTICAL_FX` at the top of `js/tactical-fx.js`.

The 3-D background planets (and the stand-in during a switch) always mirror their globe: each shows the
imagery layer picked for that body in the Imagery panel, and the Tactical styling (stylised imagery,
contours, grid) while Tactical is on.

## Adding a layer
Add an entry to a body's `layers` array in `js/config.js`:
- Trek: `{ id, label, source: 'trek', body: 'Moon'|'Mars', layer: '<Trek id>', ext: 'jpg'|'png', levels, note }`
  (find ids in Trek's apidoc / WMTSCapabilities.xml; test the deepest level actually loads)
- GIBS: `{ id, label, source: 'gibs', layer: '<GIBS layer name>', format: 'image/jpeg', levels, note }`

## Next steps (suggested)
1. Terrain: real elevation (exaggerated) from LOLA / MOLA / SRTM DEMs.
2. Data pipeline: compute per-dimension similarity scores and write them into `scores`.
3. Split-screen "compare" view: Earth analog beside its linked target.
4. Load sites from JSON/GeoJSON.

## Licence
WebWorldWind is © NASA, Apache License 2.0. Imagery: NASA GIBS, NASA Moon/Mars Trek (JPL/SSERVI), NASA Blue Marble.
