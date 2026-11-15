// Scores pairs with js/score.js so pipeline/70_validate.py can compare against the Python scorer.
//   node js/test_score.mjs pairs.json   ->  prints a JSON array of results
// A pair: { earth: {lat, lon, extremophile?}, target: {lat, lon}, body: 'moon'|'mars', preset: 'raw' }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorer } from './score.js';
import { parseFeatureCSV, attachColumns } from './features.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (p) => fs.readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));

const config = {
  features: json(path.join(root, 'config/features.json')),
  presets: json(path.join(root, 'config/presets.json')),
  caveats: json(path.join(root, 'config/caveats.json')),
};
const ranges = json(path.join(root, 'out/feature_ranges.json')).body_range_p99;
const scorer = createScorer(config, ranges);

// ground and soil composition (pipeline/35_soil_features.py), merged the same way score_data.py does
// and gases (pipeline/36_gas_features.py)
const SOIL_COLS = ['fe_pct', 'k_pct', 'th_ppm', 'soc_g_kg'];
const GAS_COLS = ['pp_o2_pa', 'pp_co2_pa', 'ozone_du', 'haze_tau'];
const RAD_COLS = ['uvb_w_m2', 'uvc_w_m2', 'dose_msv_yr'];   // pipeline/37_radiation_features.py
const withExtra = (table, file, cols) => {
  const p = path.join(root, 'out', file);
  return fs.existsSync(p) ? attachColumns(table, parseFeatureCSV(read(p)), cols) : table;
};
const withSoil = (table, soil, gas, rad) => withExtra(withExtra(withExtra(table, soil, SOIL_COLS), gas, GAS_COLS), rad, RAD_COLS);
const earth = withSoil(parseFeatureCSV(read(path.join(root, 'out/earth_features_1deg.csv'))), 'earth_soil_1deg.csv', 'earth_gases_1deg.csv', 'earth_radiation_1deg.csv');
const tables = {};
for (const [body, grid] of [['moon', 'moon_data/moon_grid.csv'], ['mars', 'mars_data/mars_grid.csv']]) {
  tables[body] = withSoil(attachColumns(parseFeatureCSV(read(path.join(root, `out/${body}_features.csv`))),
    parseFeatureCSV(read(path.join(root, '..', grid)))), `${body}_soil.csv`, `${body}_gases.csv`, `${body}_radiation.csv`);
}

const pairs = json(process.argv[2]);
const out = pairs.map((p) => {
  const ei = earth.index(p.earth.lat, p.earth.lon);
  const ti = tables[p.body].index(p.target.lat, p.target.lon);
  const overrides = p.earth.extremophile !== undefined ? { extremophile_idx: p.earth.extremophile } : {};
  const r = scorer.scorePair(scorer.refFromTable(earth, ei, overrides), scorer.refFromTable(tables[p.body], ti), p.body, p.preset);
  return { overall: r.overall, dims: r.dims, coverage: r.coverage, losses: r.losses.map((l) => ({ id: l.id, points: l.points, text: l.text })), skipped: r.skipped };
});
// also time a full-grid pass: one Earth place against every Mars cell, and one Mars target against every Earth cell
const t0 = Date.now();
const heat = scorer.scoreGrid(scorer.refFromTable(earth, earth.index(53.42, -7.91)), tables.mars, 'mars', 'raw');
const t1 = Date.now();
const rev = scorer.scoreGridReverse(scorer.refFromTable(tables.mars, tables.mars.index(18.38, 77.58)), earth, 'mars', 'raw');
const t2 = Date.now();
const finite = (a) => Array.from(a).filter((x) => !Number.isNaN(x));
process.stdout.write(JSON.stringify({
  pairs: out,
  grid: { forwardMs: t1 - t0, reverseMs: t2 - t1, forwardCells: finite(heat).length, reverseCells: finite(rev).length,
          reverseBest: Math.max(...finite(rev)) },
}));
