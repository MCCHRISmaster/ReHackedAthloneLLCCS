# Analog Atlas — prototype

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
Keys: `1` Earth, `2` Moon, `3` Mars, `T` Tactical view, `+`/`-` zoom, `R` auto-rotate, `H` home, `Esc` close briefing.
Briefings link Moon/Mars targets to their Earth analogs (and back) — click one to jump planets.

## Layout
    index.html          page shell + HUD markup
    css/style.css       tactical HUD theme (accent colour changes per body)
    js/config.js        bodies, imagery layer catalogue, camera, colours, analog dimensions
    js/layers.js        NASA layer factories (Trek WMTS, GIBS WMS, bundled, placeholder), grid/zone overlays, online probe
    js/tactical-fx.js   Tactical-view canvas effects (stylise, contours, hatch, ring)
    js/data/sites.js    Earth analogs + Moon/Mars targets, with cross-links
    js/globe.js         GlobeView: all WorldWind code (per-body globe, layers, markers, picking, camera)
    js/ui.js            HUD rendering (tabs, lists, imagery selector, briefing)
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
