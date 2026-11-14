# Handoff to the globe owner

Everything below is a text patch for files in `analog-atlas/analog-atlas/`. Nothing here has been applied; those files belong to the globe owner. Every path is written for a page served at `http://localhost:8000/analog-atlas/analog-atlas/` with `node prototype/server.js . 8000` run from the repo root.

## What you get

| File | Use |
|---|---|
| `terrain_data/out/sites.json` | 72 Earth sites and 60 Moon and Mars targets in your `SITES` schema, every score bar filled (eight keys) |
| `terrain_data/demo/index.html` | A finished full-detail page for any site: `.../terrain_data/demo/index.html?id=athlone` |
| `terrain_data/js/score.js`, `features.js` | Live scoring in the browser for any Earth place against any Moon or Mars place |
| `terrain_data/out/earth_grid_filled.csv` | A complete Earth temperature grid in your grid layout (see step 2) |
| `terrain_data/out/earth_features_2deg.csv` | Earth features at 2 degrees, same layout as your grids |

## Step 1. Show the eighth bar (one line)

`js/config.js`, in `ANALOG_DIMENSIONS`, add after the habitability line:

```js
  { key: 'operations',  label: 'Operations' },
```

Every site in `sites.json` carries eight score keys. Without this line the globe shows seven bars and ignores the eighth.

## Step 2. Earth temperatures for the reverse search (two lines)

`js/temperature.js`. This branch has no `earth` entry in `GRID_FILES`; the `reverse` branch adds one. Use `terrain_data/out/earth_grid_filled.csv` as the second entry:

```js
export const GRID_FILES = {
  moon: ['../../moon_data/moon_grid.csv', 'data/moon_grid.csv'],
  mars: ['../../mars_data/mars_grid.csv', 'data/mars_grid.csv'],
  earth: ['../../earth_data/earth_grid.csv', '../../terrain_data/out/earth_grid_filled.csv'],
};
const SOURCE_NAMES = {
  diviner_gcp_2017: 'LRO Diviner (measured)',
  mcd_v6_2: 'Mars Climate Database 6.2',
  nasa_power_clim: 'NASA POWER climatology',
  model_placeholder: 'placeholder model',
};
```

The build prompt planned a MODIS temperature fallback; NASA's NEO service no longer serves the data, so `earth_grid_filled.csv` uses NASA POWER, the same source and method as the team's file, completed for every land cell. If your file loader takes the first file that works, put the filled file first instead.

The file has a value in all 16,200 cells and passes `prototype/tools/csv_to_grid.py --check`. Over the sea the value is POWER's sea-surface skin temperature, so mask oceans with `land_pct` from `terrain_data/out/earth_features_2deg.csv` (blank there where a cell has no land) if you only want land in the heat map.

## Step 3. Use `sites.json` instead of `sites.js`

`js/main.js`, replace line 5:

```js
import { SITES } from './data/sites.js';
```

with a top-level `await` (works in ES modules):

```js
const SITES = await (await fetch('../../terrain_data/out/sites.json')).json();
```

`showBriefing()` reads `id, name, region, lat, lon, body, environment, summary, strengths, limits, targets, analogs, scores, datasets`, and all of them are present. Extra fields are ignored. Seed ids are kept (`haughton-crater`, `atacama-yungay`, `rio-tinto`, `lonar-crater`, `cueva-de-los-verdes`, `shackleton`, `marius-hills-pit`, `meridiani-planum`, `jezero`), so links keep working.

The file is about 4 MB. Each entry also has: `site_type, country, image_url, image_credit, image_local, wikipedia_url, links, programs, metrics, matches, caveats, source_ids`, and for targets `top_cells, top_by_preset, top_sites_by_preset, surprise_cells`.

## Step 4. Link to the full-detail page (the side-page wish)

The briefing popup is small. `terrain_data/demo/index.html?id=<site id>` renders the whole card: picture with credit, similarity for each preset against any target, the eight bars, the three biggest losses in plain sentences, "cut your losses, go here instead", the cannot-match warnings, the full metrics and links. To open it beside the globe, add inside `showBriefing()` next to the close button, or as a link in `brief-body`:

```js
<a class="jump" href="../../terrain_data/demo/index.html?id=${encodeURIComponent(site.id)}" target="detail">Full detail ▸</a>
```

Opened with `target="detail"` it reuses one tab, so a presenter can park it on a second screen. It can also be embedded in an `<iframe>` in a right-hand panel.

## Step 5. Live scoring from a click

`score.js` is a pure ES module. This is the shortest working use, from the temperature panel's code:

```js
import { createScorer } from '../../../terrain_data/js/score.js';
import { parseFeatureCSV, attachColumns } from '../../../terrain_data/js/features.js';

const T = '../../terrain_data/';
const get = async (p) => (await fetch(T + p)).text();
const [features, presets, caveats, ranges] = await Promise.all(
  ['config/features.json', 'config/presets.json', 'config/caveats.json', 'out/feature_ranges.json'].map(async (p) => JSON.parse(await get(p))));
const scorer = createScorer({ features, presets, caveats }, ranges.body_range_p99);

const earth = parseFeatureCSV(await get('out/earth_features_1deg.csv'));            // 11 MB: load once, lazily
const mars = attachColumns(parseFeatureCSV(await get('out/mars_features.csv')),
                           parseFeatureCSV(await (await fetch('../../mars_data/mars_grid.csv')).text()));

// Earth click -> one score per Mars cell, ready to colour like your temperature canvas
const ref = scorer.refFromTable(earth, earth.index(lat, lon));
const values = scorer.scoreGrid(ref, mars, 'mars', 'raw');            // Float32Array(16200), 0..1, NaN = no data
// Mars or Moon click -> one score per Earth cell
const rank = scorer.scoreGridReverse(scorer.refFromTable(mars, mars.index(lat, lon)), earth, 'mars', 'crewed');
// Explanation for one pair: overall, dims, coverage, losses, skipped, caveats
const card = scorer.scorePair(ref, scorer.refFromTable(mars, mars.index(18.38, 77.58)), 'mars', 'raw');
```

Presets are `raw`, `crewed`, `base`, `rover`. The score grid is the same shape as your temperature match grid, so the existing canvas renderer can colour it: write `values[i]` where it now writes `matchValue(...)`. A full pass takes about 60 to 210 ms. The Earth 1-degree file is 11 MB; `earth_features_2deg.csv` (2.7 MB) is enough if you only need to drape a 2-degree grid.

Cells over the sea have no Earth features, and cells with fewer than 10 usable comparisons return `NaN`; draw both as transparent.

## Optional, only if there is time

- Show `site.image_local` (resolves to `terrain_data/out/images/<id>.jpg`, with `image_credit` underneath) in the hover card. Pictures exist for the demo sites only; other rows have `image_url` pointing to Wikimedia.
- Draw the `surprise_cells` of a target (best Earth cells at least 300 km from any known analog site) as a layer.
- A preset switcher (raw, crewed, base, rover) that re-colours the score canvas.
- `out/caves.csv`, `out/volcanoes.csv`, `out/impact_structures.csv` as marker layers.
- Overlay images (not built).
