/**
 * Location match engine: how well every 2° cell on another world matches a
 * reference point, for three measurements, plus an overall score.
 *
 *   temperature  real  (NASA POWER / LRO Diviner / Mars Climate Database grids)
 *   pressure     real  (same grids, pressure_pa). Compared on a LOG scale:
 *                      Earth ~100,000 Pa, Mars ~600 Pa, Moon 0. A linear scale
 *                      would make every cross-world pressure match 0%.
 *   terrain      SAMPLE until the grids' slope_deg column is filled: uses the
 *                      teammate's analysis.measure() (simulated slope, relief, rocks)
 *                      and is left out of the overall score while simulated.
 */
import { measure, isLand } from './analysis.js';
import { METRICS } from './config.js';
import { matchColor } from './temperature.js';

const ROWS = 90, COLS = 180, RES = 2, N = ROWS * COLS;
export const PRESS_DECADES = 3;   // 0% match at a 1000× pressure difference
export const WEIGHTS = { real: { temp: 0.5, press: 0.25, terrain: 0.25 }, sampleTerrain: { temp: 0.65, press: 0.35, terrain: 0 } };
export const MATCH_METRICS = {
  combo: { label: 'COMBO', short: 'COMBO' },
  temp: { label: 'TEMPERATURE', short: 'TEMP' },
  terrain: { label: 'TERRAIN', short: 'TERRAIN' },
  sunwind: { label: 'SUN & WIND', short: 'SUN/WIND' },
  soil: { label: 'GROUND & SOIL', short: 'SOIL' },
  air: { label: 'AIR & GASES', short: 'AIR' },
  rad: { label: 'UV & RADIATION', short: 'RAD' },
};

const latOf = (i) => 90 - (Math.floor(i / COLS) + 0.5) * RES;
const lonOf = (i) => -180 + ((i % COLS) + 0.5) * RES;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const metricDef = (k) => METRICS.find((m) => m.key === k);
const rangeOf = (k, scale) => { const r = metricDef(k).range; return typeof r === 'object' ? r[scale] : r; };
const TERRAIN_KEYS = ['slope', 'relief', 'rocks'];

export function pressScore(a, b) {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return clamp01(1 - Math.abs(Math.log10(a + 1) - Math.log10(b + 1)) / PRESS_DECADES);
}

/* ---------------- terrain ----------------
 * REAL: the terrain-data team's 2° feature grids (terrain_data/out/*_features*.csv):
 *   Earth: NOAA ETOPO 2022 slope, roughness, relief + impact-structure proximity
 *   Moon:  NASA LRO LOLA + USGS Robbins craters     Mars: NASA MGS MOLA + USGS Robbins & Hynek craters
 * Ranges and the cratering rule follow terrain_data/config/features.json, so this
 * terrain score agrees with their scorer. FALLBACK (files missing): simulated values.
 */
export const TERRAIN_FEATURES = [
  { key: 'slope', label: 'Slope', range: 6, unit: '°', digits: 1 },
  { key: 'roughness', label: 'Roughness', range: 400, unit: ' m', digits: 0 },
  { key: 'relief', label: 'Relief', range: 2500, unit: ' m', digits: 0 },
  { key: 'crater', label: 'Cratering (0–1)', range: 0.6, unit: '', digits: 2 },
];
export const TERRAIN_FILES = {
  earth: '../../terrain_data/out/earth_features_2deg.csv',
  moon: '../../terrain_data/out/moon_features.csv',
  mars: '../../terrain_data/out/mars_features.csv',
};
export const TERRAIN_RANGES_FILE = '../../terrain_data/out/feature_ranges.json';
const realTerrain = {};   // body -> { slope, roughness, relief, crater: Float32Array }

/** Load one body's feature CSV (rows are parsed objects from temperature.parseCSV). */
export function registerTerrain(body, rows, ranges) {
  const g = {};
  TERRAIN_FEATURES.forEach((f) => { g[f.key] = new Float32Array(N).fill(NaN); });
  const p99 = ranges && ranges.body_range_p99 && ranges.body_range_p99[body] && ranges.body_range_p99[body].crater_density_5km_n;
  const num = (v) => (v === '' || v == null ? NaN : Number(v));
  for (const r of rows) {
    const i = cellIndex(Number(r.lat), Number(r.lon));
    g.slope[i] = num(r.slope_mean_deg);
    g.roughness[i] = num(r.roughness_m);
    g.relief[i] = num(r.relief_m);
    g.crater[i] = body === 'earth' ? num(r.crater_prox_idx)
      : (p99 ? Math.min(1, num(r.crater_density_5km_n) / p99) : NaN);
  }
  realTerrain[body] = g;
  storeFeatures(body, rows);
  terrainCache.clear();
}
export const hasRealTerrain = (body) => !!realTerrain[body];

const terrainCache = new Map();
function terrainGrid(body, scale) {
  if (realTerrain[body]) return { ...realTerrain[body], sim: false, keys: TERRAIN_FEATURES };
  const key = `${body}|${scale}`;
  if (terrainCache.has(key)) return terrainCache.get(key);
  const g = { sim: false, keys: SIM_FEATURES(scale) };
  TERRAIN_KEYS.forEach((k) => { g[k] = new Float32Array(N).fill(NaN); });
  for (let i = 0; i < N; i++) {
    const m = measure(body, latOf(i), lonOf(i), scale, { fast: true });
    TERRAIN_KEYS.forEach((k) => { if (m.values[k] != null) g[k][i] = m.values[k]; });
    if (m.simulated.slope) g.sim = true;
  }
  terrainCache.set(key, g);
  return g;
}
const SIM_FEATURES = (scale) => [
  { key: 'slope', label: 'Slope', range: rangeOf('slope', scale), unit: '°', digits: 1 },
  { key: 'relief', label: 'Local relief', range: rangeOf('relief', scale), unit: ' m', digits: 0 },
  { key: 'rocks', label: 'Rock cover', range: rangeOf('rocks', scale), unit: '%', digits: 0 },
];
export function clearTerrainCache() { terrainCache.clear(); }

/** Terrain at one point: real grid cell when loaded, else the simulation. */
export function terrainAt(body, lat, lon, scale) {
  const g = realTerrain[body];
  if (g) {
    const i = cellIndex(lat, lon), t = { sim: false };
    TERRAIN_FEATURES.forEach((f) => { t[f.key] = g[f.key][i]; });
    return t;
  }
  const m = measure(body, lat, lon, scale);
  return { slope: m.values.slope, relief: m.values.relief, rocks: m.values.rocks, sim: !!m.simulated.slope };
}

function terrainScore(ref, tg, i) {
  let sum = 0, n = 0;
  tg.keys.forEach((f) => {
    const a = ref[f.key], b = tg[f.key][i];
    if (a == null || Number.isNaN(a) || Number.isNaN(b)) return;
    sum += clamp01(1 - Math.abs(a - b) / f.range); n++;
  });
  return n >= 2 ? sum / n : NaN;   // need at least two terrain measurements to call it a match
}

/* ---------------- all feature columns (for sun & wind + the data grid) ---------------- */
const features = {};   // body -> { column: Float32Array(N) }
export const featureAt = (body, col, i) => {
  const a = features[body] && features[body][col];
  return a ? a[i] : NaN;
};
function storeFeatures(body, rows) {
  const f = features[body] || {};   // merge: the soil file adds columns to the terrain file's
  const cols = Object.keys(rows[0] || {}).filter((c) => !['body', 'lat', 'lon', 'source_id'].includes(c));
  cols.forEach((c) => { f[c] = new Float32Array(N).fill(NaN); });
  for (const r of rows) {
    const i = cellIndex(Number(r.lat), Number(r.lon));
    cols.forEach((c) => { if (r[c] !== '' && r[c] != null) { const v = Number(r[c]); if (!Number.isNaN(v)) f[c][i] = v; } });
  }
  features[body] = f;
}

/* ---------------- solar energy at the surface (W/m², yearly average) ----------------
 * Earth: WorldClim 2.1 surface solar radiation (kJ/m²/day ÷ 86.4), land only.
 * Moon:  computed from latitude (no air: surface = top of atmosphere), S = 1361 W/m², tilt 1.5°.
 * Mars:  computed from latitude, S = 589 W/m², tilt 25.2°, × 0.65 for typical dust (estimate).
 */
const SOLAR = { moon: { S: 1361, tilt: 1.54, trans: 1 }, mars: { S: 589, tilt: 25.19, trans: 0.65 } };
const insolCache = new Map();
function insolationLat(body, latDeg) {
  const key = `${body}|${latDeg}`;
  if (insolCache.has(key)) return insolCache.get(key);
  const { S, tilt, trans } = SOLAR[body];
  const phi = (latDeg * Math.PI) / 180, eps = (tilt * Math.PI) / 180;
  let sum = 0;
  const n = 360;
  for (let k = 0; k < n; k++) {
    const dec = Math.asin(Math.sin(eps) * Math.sin((2 * Math.PI * k) / n));
    const x = -Math.tan(phi) * Math.tan(dec);
    const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
    sum += (S / Math.PI) * (h0 * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(h0));
  }
  const v = (sum / n) * trans;
  insolCache.set(key, v);
  return v;
}
/**
 * Team grid columns (csv_data_collection) are preferred when present:
 *   solar_w_m2  Earth: NASA POWER CERES all-sky surface sunlight · Mars: MCD surface solar flux · Moon: geometry
 *   wind_ms     Mars: MCD 2 m wind · Moon: 0          aerosol_tau  Mars: MCD dust optical depth · Moon: 0
 */
const GRID_COLS = ['solar_w_m2', 'wind_ms', 'aerosol_tau'];
export function registerGridColumns(body, grid) {
  if (!grid || !grid.columns) return;
  const f = (features[body] ||= {});
  GRID_COLS.forEach((c) => { if (grid.columns[c]) f[`g_${c}`] = grid.columns[c]; });
}
export const hasGridCol = (body, c) => !!(features[body] && features[body][`g_${c}`]);
export function solarAt(body, i) {
  const g = featureAt(body, 'g_solar_w_m2', i);
  if (!Number.isNaN(g)) return g;
  if (body === 'earth') { const s = featureAt('earth', 'srad_kj_m2_day', i); return Number.isNaN(s) ? NaN : s / 86.4; }
  return SOLAR[body] ? insolationLat(body, latOf(i)) : NaN;
}
export function windAt(body, i) {
  const g = featureAt(body, 'g_wind_ms', i);
  if (!Number.isNaN(g)) return g;
  if (body === 'earth') return featureAt('earth', 'wind_ms', i);
  return body === 'moon' ? 0 : NaN;
}
/** Dust in the air as optical depth: Earth NASA POWER AOD (haze_tau), Mars MCD dust optical depth, Moon 0. */
export function dustTauAt(body, i) {
  if (body === 'moon') return 0;
  if (body === 'mars') return featureAt('mars', 'g_aerosol_tau', i);
  return featureAt('earth', 'haze_tau', i);
}export const SOLAR_RANGE = 150;   // W/m² apart = 0%
export const WIND_RANGE = 8;      // m/s apart = 0%

function sunwindScore(refS, refW, body, i) {
  let sum = 0, n = 0;
  const s = solarAt(body, i);
  if (!Number.isNaN(refS) && !Number.isNaN(s)) { sum += clamp01(1 - Math.abs(refS - s) / SOLAR_RANGE); n++; }
  const w = windAt(body, i);
  if (!Number.isNaN(refW) && !Number.isNaN(w)) { sum += clamp01(1 - Math.abs(refW - w) / WIND_RANGE); n++; }
  return n ? sum / n : NaN;
}

/* ---------------- ground & soil composition ----------------
 * The terrain-data soil grids (terrain_data/out/*_soil*.csv, pipeline/35_soil_features.py):
 *   Moon:  Lunar Prospector gamma-ray spectrometer (Fe, Si, K, Th), measured from orbit
 *   Mars:  Mars Odyssey gamma-ray spectrometer (Fe, Si, K, Th, Cl), measured from orbit
 *   Earth: ISRIC SoilGrids 2.0 topsoil (organic carbon, texture, pH, density) + Fe/Si/K/Th
 *          ESTIMATED from bedrock type (GLiM lithology x typical rock composition)
 * Ranges follow terrain_data/config/features.json (iron, potassium, thorium, organic).
 */
export const SOIL_FILES = {
  earth: '../../terrain_data/out/earth_soil_2deg.csv',
  moon: '../../terrain_data/out/moon_soil.csv',
  mars: '../../terrain_data/out/mars_soil.csv',
};
export const SOIL_FEATURES = [
  { key: 'iron', label: 'Iron (Fe)', range: 8, unit: ' %', digits: 1 },
  { key: 'potassium', label: 'Potassium (K)', range: 2, unit: ' %', digits: 2 },
  { key: 'thorium', label: 'Thorium (Th)', range: 8, unit: ' ppm', digits: 1 },
  { key: 'organic', label: 'Organic carbon', range: 15, unit: ' g/kg', digits: 0 },
];
const soilLoaded = {};
export function registerSoil(body, rows) { storeFeatures(body, rows); soilLoaded[body] = true; }
export const hasSoil = (body) => !!soilLoaded[body];

/** Soil values at one cell; organic carbon is 0 on the Moon and Mars (sterile regolith), capped at 30 g/kg on Earth. */
export function soilAt(body, i) {
  const soc = featureAt(body, 'soc_g_kg', i);
  return {
    iron: featureAt(body, 'fe_pct', i),
    potassium: featureAt(body, 'k_pct', i),
    thorium: featureAt(body, 'th_ppm', i),
    organic: body === 'earth' ? (Number.isNaN(soc) ? NaN : Math.min(soc, 30)) : (soilLoaded[body] ? 0 : NaN),
  };
}

function soilScore(ref, body, i) {
  if (!ref) return NaN;
  const t = soilAt(body, i);
  let sum = 0, n = 0;
  SOIL_FEATURES.forEach((f) => {
    const a = ref[f.key], b = t[f.key];
    if (a == null || Number.isNaN(a) || Number.isNaN(b)) return;
    sum += clamp01(1 - Math.abs(a - b) / f.range); n++;
  });
  return n >= 2 ? sum / n : NaN;
}

/* ---------------- air & gases ----------------
 * The terrain-data gas grids (terrain_data/out/*_gases*.csv, pipeline/36_gas_features.py):
 *   Mars:  Mars Climate Database 6.2 (gas shares at 2 m, ozone column, dust optical depth, CO2 and water frost)
 *   Earth: dry-air composition x NASA POWER surface pressure; NASA POWER ozone (TO3) and aerosol (AOD_55)
 *   Moon:  vacuum (exosphere ~3×10⁻¹⁰ Pa), every gas 0
 * Gas amounts span 0 .. 100,000 Pa, so they are compared on log10(1 + value), like pressure.
 * Ranges follow terrain_data/config/features.json (o2_air, co2_air, ozone, haze).
 */
export const GAS_FILES = {
  earth: '../../terrain_data/out/earth_gases_2deg.csv',
  moon: '../../terrain_data/out/moon_gases.csv',
  mars: '../../terrain_data/out/mars_gases.csv',
};
// weight: share in the AIR score. Oxygen, CO2 and ozone can never be truly matched by any Earth place
// (Earth always has ~21 kPa O2, ~40 Pa CO2, ~300 DU ozone), so they count a quarter; dust & haze, which Earth
// places really differ on, counts in full. Same weights as terrain_data/config/features.json.
export const GAS_FEATURES = [
  { key: 'o2', col: 'pp_o2_pa', label: 'Oxygen (partial pressure)', range: 3, log: true, unit: ' Pa', digits: 1, weight: 0.25 },
  { key: 'co2', col: 'pp_co2_pa', label: 'Carbon dioxide (partial pressure)', range: 3, log: true, unit: ' Pa', digits: 0, weight: 0.25 },
  { key: 'ozone', col: 'ozone_du', label: 'Ozone overhead (UV shield)', range: 2.5, log: true, unit: ' DU', digits: 1, weight: 0.25 },
  { key: 'haze', col: 'haze_tau', label: 'Dust & haze (optical depth)', range: 1, log: false, unit: '', digits: 2, weight: 1 },
];
const gasLoaded = {};
export function registerGas(body, rows) { storeFeatures(body, rows); gasLoaded[body] = true; }
export const hasGas = (body) => !!gasLoaded[body];
export const gasAt = (body, i) => Object.fromEntries(GAS_FEATURES.map((f) => [f.key, featureAt(body, f.col, i)]));
const log1p10 = (v) => (v >= 0 ? Math.log10(1 + v) : NaN);

function gasScore(ref, body, i) {
  if (!ref) return NaN;
  let sum = 0, ws = 0, n = 0;
  GAS_FEATURES.forEach((f) => {
    let a = ref[f.key], b = featureAt(body, f.col, i);
    if (a == null || Number.isNaN(a) || Number.isNaN(b)) return;
    if (f.log) { a = log1p10(a); b = log1p10(b); }
    sum += f.weight * clamp01(1 - Math.abs(a - b) / f.range); ws += f.weight; n++;
  });
  return n >= 2 ? sum / ws : NaN;
}

/* ---------------- UV & radiation ----------------
 * The terrain-data radiation grids (terrain_data/out/*_radiation*.csv, pipeline/37_radiation_features.py):
 *   Earth: NASA POWER UV-A / UV-B; UV-C 0 (ozone); cosmic-ray dose from elevation (UNSCEAR / Bouville & Lowder)
 *   Mars:  UV estimated from MCD surface sunlight and Curiosity REMS's UV split; dose = Curiosity RAD scaled by air overhead
 *   Moon:  UV from sunlight geometry (no air); dose = Chang'e-4 LND, 1.37 mSv/day everywhere
 * weight: UV-B counts in full (Earth places differ a lot on it: high deserts get within ~3× of Mars); UV-C and
 * the dose count a quarter because no Earth place can ever match them. Same as terrain_data/config/features.json.
 */
export const RAD_FILES = {
  earth: '../../terrain_data/out/earth_radiation_2deg.csv',
  moon: '../../terrain_data/out/moon_radiation.csv',
  mars: '../../terrain_data/out/mars_radiation.csv',
};
export const RAD_FEATURES = [
  { key: 'uvb', col: 'uvb_w_m2', label: 'UV-B at the ground', range: 1.5, scale: 'log10', unit: ' W/m²', digits: 2, weight: 1 },
  { key: 'uvc', col: 'uvc_w_m2', label: 'UV-C at the ground (germicidal)', range: 3, scale: 'log1p_milli', unit: ' W/m²', digits: 2, weight: 0.25 },
  { key: 'dose', col: 'dose_msv_yr', label: 'Cosmic-ray dose', range: 3, scale: 'log10', unit: ' mSv/yr', digits: 1, weight: 0.25 },
];
export const CAREER_LIMIT_MSV = 600;   // NASA-STD-3001 (2022) career effective-dose limit
const radLoaded = {};
export function registerRad(body, rows) { storeFeatures(body, rows); radLoaded[body] = true; }
export const radAt = (body, i) => Object.fromEntries(RAD_FEATURES.map((f) => [f.key, featureAt(body, f.col, i)]));
const radTransform = (f, v) => (f.scale === 'log10' ? (v > 0 ? Math.log10(v) : NaN) : v >= 0 ? Math.log10(1 + 1000 * v) : NaN);

function radScore(ref, body, i) {
  if (!ref) return NaN;
  let sum = 0, ws = 0, n = 0;
  RAD_FEATURES.forEach((f) => {
    const a = radTransform(f, ref[f.key]), b = radTransform(f, featureAt(body, f.col, i));
    if (Number.isNaN(a) || Number.isNaN(b)) return;
    sum += f.weight * clamp01(1 - Math.abs(a - b) / f.range); ws += f.weight; n++;
  });
  return n >= 2 ? sum / ws : NaN;
}

/** Extra reference values (sun & wind, soil, gases, UV & radiation) for a clicked point. */
export function refExtras(body, lat, lon) {
  const i = cellIndex(lat, lon);
  return { solar: solarAt(body, i), wind: windAt(body, i), soil: soilAt(body, i), gas: gasAt(body, i), rad: radAt(body, i) };
}

/* ---------------- the match ---------------- */

/**
 * Mission presets for the combo sliders (Advanced options → MISSION).
 *  HUMAN: crews live inside the thermal and pressure environment (suits, habitats, life support),
 *         radiation dose limits how long they can stay (NASA career limit), air composition matters
 *         for suits, dust and UV, sunlight gives power and warmth; terrain and soil chemistry matter
 *         less for short walking EVAs.
 *  ROVER: machines don't breathe, so air pressure and gases barely matter; terrain decides whether it
 *         can drive at all and soil sets traction and wheel wear; sun and wind drive solar power,
 *         dust on panels and wind loads; temperature matters for batteries; electronics can be
 *         radiation-hardened, so radiation counts a little.
 */
export const WEIGHT_PRESETS = {
  human: { temp: 25, press: 20, terrain: 10, sunwind: 10, soil: 5, air: 15, rad: 15 },
  rover: { temp: 15, press: 5, terrain: 35, sunwind: 20, soil: 15, air: 5, rad: 5 },
};
export const PRESET_WHY = {
  human: ['Temperature, high: suits and habitats live in this heat and cold', 'Pressure, high: air pressure decides life support and suit design',
    'Radiation, medium: dose limits how long crews can stay (NASA career limit)',
    'Air, medium: oxygen, CO₂, ozone and dust affect suits and UV exposure', 'Sun & wind, medium: sunlight for power and warmth',
    'Terrain and soil, low: crews walk short distances; soil chemistry matters later (building, resources)'],
  rover: ['Terrain, high: slopes, roughness and craters decide where it can drive', 'Sun & wind, medium: solar power, dust on panels, wind loads',
    'Soil, medium: sets traction and wheel wear', 'Temperature, medium: batteries and electronics, helped by heaters',
    'Pressure, air and radiation, low: machines do not breathe, and electronics can be radiation-hardened'],
};
export const DEFAULT_WEIGHTS = WEIGHT_PRESETS.human;

/**
 * ref = { body, lat, lon, mean, high, low, pressure, solar, wind, terrain:{...,sim} }
 * grid = loaded temperature grid of the target body
 * weights = combo slider weights (any scale; normalised over what is available per cell)
 * Returns per-cell Float32Arrays: temp, press, terrain, sunwind, combo (= overall), and the best cell.
 */
export function computeMatch(ref, grid, target, { stat, range, scale, weights = DEFAULT_WEIGHTS }) {
  const temp = new Float32Array(N), press = new Float32Array(N), terrain = new Float32Array(N);
  const sunwind = new Float32Array(N), soil = new Float32Array(N), air = new Float32Array(N), rad = new Float32Array(N);
  const combo = new Float32Array(N);
  const tg = terrainGrid(target, scale);
  const terrainReal = !tg.sim && !ref.terrain.sim;
  const w = { ...weights, terrain: terrainReal ? weights.terrain : 0 };   // sample terrain never counts
  const pcol = grid.columns && grid.columns.pressure_pa;
  const target0 = ref[stat];
  for (let i = 0; i < N; i++) {
    const t = grid[stat][i];
    temp[i] = Number.isNaN(t) ? NaN : clamp01(1 - Math.abs(t - target0) / range);
    press[i] = pcol ? pressScore(ref.pressure, pcol[i]) : NaN;
    terrain[i] = terrainScore(ref.terrain, tg, i);
    sunwind[i] = sunwindScore(ref.solar, ref.wind, target, i);
    soil[i] = soilScore(ref.soil, target, i);
    air[i] = gasScore(ref.gas, target, i);
    rad[i] = radScore(ref.rad, target, i);
    let sum = 0, ws = 0;
    [['temp', temp[i]], ['press', press[i]], ['terrain', terrain[i]], ['sunwind', sunwind[i]], ['soil', soil[i]], ['air', air[i]], ['rad', rad[i]]].forEach(([k, v]) => {
      if (!Number.isNaN(v) && w[k] > 0) { sum += v * w[k]; ws += w[k]; }
    });
    combo[i] = ws ? sum / ws : NaN;
  }
  let best = bestCell(combo, target);
  if (best && best.overall <= 0.005) {
    // Nothing scores above 0%: pin the CLOSEST cell instead (smallest temperature gap)
    let bi = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const t = grid[stat][i];
      if (Number.isNaN(t) || (target === 'earth' && !isLand(latOf(i), lonOf(i)))) continue;
      const d = Math.abs(t - target0);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) best = { i: bi, lat: latOf(bi), lon: lonOf(bi), overall: combo[bi], closestOnly: true, gap: bd };
  }
  const res = { target, temp, press, terrain, sunwind, soil, air, rad, combo, overall: combo, best, terrainSim: !terrainReal, weights: w, grid, tg };
  if (best) fillBest(res, best);
  return res;
}

/* ---------------- night lights (Earth remoteness) from the bundled NASA Black Marble image ---------------- */
let nightLights = null;   // Float32Array(N), 0 = dark .. 1 = brightest city lights
export function loadNightLights(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = COLS * 2; c.height = ROWS * 2;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      const raw = new Float32Array(N);
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const k = (y * c.width + x) * 4;
          // city lights are warm (yellow/white-orange); ice is neutral white, sea is blue
          const lit = Math.max(0, (px[k] + px[k + 1]) / 2 - px[k + 2]);
          raw[Math.floor(y / 2) * COLS + Math.floor(x / 2)] += lit / 4;
        }
      }
      let max = 0;
      raw.forEach((v) => { if (v > max) max = v; });
      nightLights = raw.map((v) => (max ? Math.min(1, (v / max) * 3) : 0));
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/* ---------------- body variables for the data grid (table rows 1-19) ---------------- */
const NA = (text) => ({ v: NaN, text });
const fx = (v, d, u) => (Number.isNaN(v) ? null : { v, text: `${v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })}${u}` });
const swingOf = (g, i) => g.high[i] - g.low[i];

/** Rows: { id, label, group, get(body, i, grid) -> {v, text} } */
export const VARIABLES = [
  { id: 'temp_mean', group: 'Climate', label: 'Average surface temperature', get: (b, i, g) => fx(g.mean[i], 1, ' °C') || NA('—') },
  { id: 'temp_high', group: 'Climate', label: 'Daily high', get: (b, i, g) => fx(g.high[i], 1, ' °C') || NA('—') },
  { id: 'temp_low', group: 'Climate', label: 'Daily low', get: (b, i, g) => fx(g.low[i], 1, ' °C') || NA('—') },
  { id: 'swing', group: 'Climate', label: 'Day–night swing', get: (b, i, g) => fx(swingOf(g, i), 1, ' °C') || NA('—') },
  { id: 'pressure', group: 'Atmosphere', label: 'Surface pressure', get: (b, i, g) => {
    const p = g.columns && g.columns.pressure_pa ? g.columns.pressure_pa[i] : NaN;
    if (Number.isNaN(p)) return NA('—');
    return p < 0.5 ? { v: 0, text: '0 Pa (vacuum)' } : fx(p >= 1000 ? p / 1000 : p, p >= 1000 ? 1 : 0, p >= 1000 ? ' kPa' : ' Pa');
  } },
  { id: 'vapour', group: 'Atmosphere', label: 'Water vapour (column)', get: (b, i, g) => {
    const w = g.columns && g.columns.water_vapour_mm ? g.columns.water_vapour_mm[i] : NaN;
    if (b === 'moon') return { v: 0, text: '0 (no air)' };
    return fx(w, b === 'mars' ? 3 : 1, ' mm') || NA('—');
  } },
  { id: 'cloud', group: 'Atmosphere', label: 'Cloud cover', get: (b) => (b === 'moon' ? NA('none (no air)') : NA('not in our data yet')) },
  // ---- air & gases (terrain_data/out/*_gases*.csv)
  { id: 'gasmix', group: 'Air at the surface', label: 'Main gases (share of the air)', get: (b, i) => {
    if (b === 'moon') return NA('vacuum: thin exosphere of He, Ar, Ne (LADEE)');
    const s = (col, l, d) => { const v = featureAt(b, col, i); return Number.isNaN(v) ? null : `${l} ${v.toFixed(d)}%`; };
    const parts = b === 'mars' ? [s('co2_pct', 'CO₂', 1), s('n2_pct', 'N₂', 1), s('ar_pct', 'Ar', 1), s('o2_pct', 'O₂', 2)]
      : [s('n2_pct', 'N₂', 0), s('o2_pct', 'O₂', 0), s('ar_pct', 'Ar', 1), s('co2_pct', 'CO₂', 2)];
    const txt = parts.filter(Boolean).join(' · ');
    return txt ? { v: 1, text: txt } : NA('—');
  } },
  ...[['pp_o2_pa', 'Oxygen (O₂) pressure'], ['pp_co2_pa', 'Carbon dioxide (CO₂) pressure'], ['pp_n2_pa', 'Nitrogen (N₂) pressure'], ['pp_ar_pa', 'Argon (Ar) pressure']]
    .map(([col, label]) => ({ id: col, group: 'Air at the surface', label, get: (b, i) => {
      if (b === 'moon') return { v: 0, text: '0 (vacuum)' };
      const p = featureAt(b, col, i);
      if (Number.isNaN(p)) return NA('—');
      return { v: p, text: p >= 1000 ? `${(p / 1000).toFixed(1)} kPa` : p >= 10 ? `${Math.round(p)} Pa` : `${p.toFixed(2)} Pa` };
    } })),
  { id: 'ch4', group: 'Air at the surface', label: 'Methane (CH₄)', get: (b, i) => (b === 'earth' ? (fx(featureAt('earth', 'ch4_ppb', i), 0, ' ppb (global mean)') || NA('—'))
    : b === 'mars' ? (fx(featureAt('mars', 'ch4_ppb', i), 2, ' ppb (Gale crater only, Curiosity)') || NA('—')) : NA('none')) },
  { id: 'co', group: 'Air at the surface', label: 'Carbon monoxide (CO)', get: (b, i) => (b === 'moon' ? NA('none')
    : fx(featureAt(b, 'co_ppm', i), b === 'mars' ? 0 : 1, b === 'earth' ? ' ppm (typical)' : ' ppm') || NA('—')) },
  { id: 'h2he', group: 'Air at the surface', label: 'Hydrogen · helium', get: (b, i) => {
    if (b === 'moon') return NA('He and H₂ in the exosphere (trace)');
    const h = featureAt(b, 'h2_ppm', i), he = featureAt(b, 'he_ppm', i);
    return Number.isNaN(h) ? NA('—') : { v: h, text: `H₂ ${h.toFixed(h < 1 ? 2 : 0)} · He ${Number.isNaN(he) ? '—' : he.toFixed(1)} ppm` };
  } },
  { id: 'o3surf', group: 'Air at the surface', label: 'Ozone at ground level', get: (b, i) => (b === 'moon' ? NA('none')
    : fx(featureAt(b, 'o3_ppb', i), 1, b === 'earth' ? ' ppb (typical)' : ' ppb') || NA('—')) },
  { id: 'aircol', group: 'Whole atmosphere', label: 'Air overhead (radiation shield)', get: (b, i) => (b === 'moon' ? { v: 0, text: '0 (no shielding)' }
    : fx(featureAt(b, 'air_column_g_cm2', i), b === 'mars' ? 1 : 0, ' g/cm²') || NA('—')) },
  { id: 'ozonecol', group: 'Whole atmosphere', label: 'Ozone column (UV shield)', get: (b, i) => (b === 'moon' ? { v: 0, text: '0 (no UV shield)' }
    : fx(featureAt(b, 'ozone_du', i), b === 'mars' ? 2 : 0, ' Dobson units') || NA(b === 'earth' ? 'sea (land only)' : '—')) },
  { id: 'haze', group: 'Whole atmosphere', label: 'Dust & haze (optical depth)', get: (b, i) => (b === 'moon' ? { v: 0, text: '0 (no air)' }
    : fx(featureAt(b, 'haze_tau', i), 2, b === 'mars' ? ' (dust)' : ' (aerosol)') || NA(b === 'earth' ? 'sea (land only)' : '—')) },
  { id: 'co2frost', group: 'Gas at the surface', label: 'CO₂ frost on the ground', get: (b, i) => {
    if (b === 'earth') return { v: 0, text: 'never (too warm for CO₂ to freeze)' };
    if (b === 'moon') return NA('possible in the coldest polar traps, not mapped');
    const m = featureAt('mars', 'co2_frost_months', i), kg = featureAt('mars', 'co2_frost_kg_m2', i);
    if (Number.isNaN(m)) return NA('—');
    return m < 0.5 ? { v: 0, text: 'none' } : { v: m, text: `${Math.round(m)} of 12 months (avg ${kg.toFixed(0)} kg/m²)` };
  } },
  { id: 'h2ofrost', group: 'Gas at the surface', label: 'Water frost on the ground', get: (b, i) => (b === 'mars'
    ? (fx(featureAt('mars', 'h2o_frost_kg_m2', i), 2, ' kg/m² (yearly avg.)') || NA('—'))
    : b === 'moon' ? NA('ice in polar cold traps (see Water)') : NA('snow and ice: see Water')) },
  { id: 'soilgas', group: 'Gas at the surface', label: 'Gas held in the soil', get: (b) => NA(b === 'moon'
    ? 'solar-wind He (incl. helium-3), H, Ne (Apollo samples)' : b === 'mars' ? 'CO₂ and water stuck to grains; perchlorates release O₂'
      : 'soil air: N₂, O₂ and CO₂ from roots and microbes') },
  // ---- UV & radiation (terrain_data/out/*_radiation*.csv); all 24-hour, year-round averages
  ...[['uva_w_m2', 'UV-A (315–400 nm)'], ['uvb_w_m2', 'UV-B (280–315 nm)'], ['uvc_w_m2', 'UV-C (200–280 nm, germicidal)']]
    .map(([col, label]) => ({ id: col, group: 'UV & radiation', label, get: (b, i) => {
      if (b === 'earth' && col === 'uvc_w_m2') return { v: 0, text: '0 (absorbed by ozone)' };
      const v = featureAt(b, col, i);
      if (Number.isNaN(v)) return NA(b === 'earth' ? 'sea (land only)' : '—');
      return { v, text: `${v.toFixed(v < 1 ? 2 : 1)} W/m²${b === 'mars' ? ' (est.)' : ''}` };
    } })),
  { id: 'dose', group: 'UV & radiation', label: 'Cosmic-ray dose at the ground', get: (b, i) => {
    const y = featureAt(b, 'dose_msv_yr', i);
    if (Number.isNaN(y)) return NA(b === 'earth' ? 'sea (land only)' : '—');
    return { v: y, text: b === 'earth' ? `${y.toFixed(2)} mSv/yr (est. from altitude)` : `${(y / 365.25).toFixed(2)} mSv/day = ${Math.round(y)} mSv/yr` };
  } },
  { id: 'career', group: 'UV & radiation', label: `Days to NASA's ${CAREER_LIMIT_MSV} mSv career limit, unshielded`, get: (b, i) => {
    const d = featureAt(b, 'career_days', i);
    if (Number.isNaN(d)) return NA('—');
    return { v: d, text: d > 3650 ? `~${Math.round(d / 365.25)} years` : `~${Math.round(d)} days` };
  } },
  { id: 'storms', group: 'UV & radiation', label: 'Solar storms (particle events)', get: (b) => NA(b === 'earth'
    ? 'blocked by the magnetic field and air' : b === 'moon' ? 'no shelter: a big event can give a dangerous dose in hours' : 'thin air helps a little; a storm shelter is still needed') },
  { id: 'solar', group: 'Sun & wind', label: 'Solar energy at surface', get: (b, i) => {
    const v = solarAt(b, i);
    if (Number.isNaN(v)) return NA(b === 'earth' ? 'sea (land only)' : '—');
    const src = hasGridCol(b, 'solar_w_m2') ? (b === 'earth' ? '' : b === 'mars' ? ' (MCD)' : ' (calc.)') : (b === 'earth' ? '' : ' (calc.)');
    return { v, text: `${Math.round(v)} W/m²${src}` };
  } },
  { id: 'wind', group: 'Sun & wind', label: 'Wind speed', get: (b, i) => (b === 'moon' ? { v: 0, text: '0 (no air)' }
    : fx(windAt(b, i), 1, b === 'mars' ? ' m/s (MCD)' : ' m/s') || NA(b === 'mars' ? 'not in our data yet' : 'sea (land only)')) },
  { id: 'dust', group: 'Sun & wind', label: 'Dust in the air (optical depth)', get: (b, i) => (b === 'moon' ? { v: 0, text: '0 (no air)' }
    : fx(dustTauAt(b, i), 2, b === 'mars' ? ' τ (MCD)' : ' τ (POWER AOD)') || NA('—')) },
  { id: 'precip', group: 'Water', label: 'Precipitation', get: (b, i) => (b === 'earth' ? (fx(featureAt('earth', 'precip_mm_yr', i), 0, ' mm/yr') || NA('sea (land only)')) : { v: 0, text: '0 (no rain)' }) },
  { id: 'soil', group: 'Water', label: 'Soil wetness', get: (b) => (b === 'earth' ? NA('not in our data yet') : { v: 0, text: '≈0 (dry)' }) },
  { id: 'ice', group: 'Water', label: 'Water ice / hydrogen', get: (b, i) => {
    if (b === 'earth') return NA('not applicable');
    if (b === 'mars') { const h = featureAt('mars', 'weh_pct', i); return Number.isNaN(h) ? (fx(featureAt('mars', 'water_idx', i), 2, ' (index)') || NA('—')) : fx(h, 1, ' % water-equiv. H'); }
    const w = fx(featureAt('moon', 'water_idx', i), 2, ' (index, est.)');
    return w || NA('—');
  } },
  { id: 'elevation', group: 'Terrain', label: 'Elevation', get: (b, i) => fx(featureAt(b, b === 'earth' ? 'elev_mean_m' : 'elevation_m', i), 0, ' m') || NA(b === 'earth' ? 'sea (land only)' : '—') },
  { id: 'slope', group: 'Terrain', label: 'Slope', get: (b, i) => fx(featureAt(b, 'slope_mean_deg', i), 1, '°') || NA(b === 'earth' ? 'sea (land only)' : '—') },
  { id: 'roughness', group: 'Terrain', label: 'Roughness', get: (b, i) => fx(featureAt(b, 'roughness_m', i), 0, ' m') || NA('—') },
  { id: 'relief', group: 'Terrain', label: 'Relief', get: (b, i) => fx(featureAt(b, 'relief_m', i), 0, ' m') || NA('—') },
  { id: 'inertia', group: 'Terrain', label: 'Thermal inertia (dust ↔ rock)', get: (b, i) => (b === 'mars' ? (fx(featureAt('mars', 'thermal_inertia_tiu', i), 0, ' TIU') || NA('—'))
    : b === 'moon' ? NA('not in our data yet') : NA('not applicable')) },
  { id: 'rocks', group: 'Terrain', label: 'Rock abundance', get: (b) => (b === 'earth' ? NA('not applicable') : NA('not in our data yet')) },
  ...[['fe_pct', 'Iron (Fe)', 1, ' %'], ['si_pct', 'Silicon (Si)', 1, ' %'], ['k_pct', 'Potassium (K)', 2, ' %'], ['th_ppm', 'Thorium (Th)', 1, ' ppm']]
    .map(([col, label, d, u]) => ({ id: col, group: 'Ground & soil', label, get: (b, i) => {
      const x = fx(featureAt(b, col, i), d, u);
      if (!x) return NA(b === 'earth' ? 'sea / no rock class' : 'not mapped here');
      return b === 'earth' ? { v: x.v, text: `${x.text} (est. from rock type)` } : x;
    } })),
  { id: 'cl', group: 'Ground & soil', label: 'Chlorine (salts)', get: (b, i) => (b === 'mars' ? (fx(featureAt('mars', 'cl_pct', i), 2, ' %') || NA('not mapped here'))
    : b === 'moon' ? NA('not measured (very low)') : NA('not in our data yet')) },
  { id: 'soc', group: 'Ground & soil', label: 'Organic carbon', get: (b, i) => (b === 'earth' ? (fx(featureAt('earth', 'soc_g_kg', i), 1, ' g/kg') || NA('sea / no soil'))
    : b === 'moon' ? { v: 0, text: '0 (sterile regolith)' } : { v: 0, text: '≈0 (traces only, Curiosity SAM)' }) },
  { id: 'texture', group: 'Ground & soil', label: 'Clay · silt · sand', get: (b, i) => {
    if (b === 'moon') return NA('fine regolith, no clay (Apollo samples)');
    if (b === 'mars') return NA('dust + sand, not mapped');
    const c = featureAt('earth', 'clay_pct', i), s = featureAt('earth', 'silt_pct', i), a = featureAt('earth', 'sand_pct', i);
    return Number.isNaN(c) ? NA('sea / no soil') : { v: c, text: `${Math.round(c)} · ${Math.round(s)} · ${Math.round(a)} %` };
  } },
  { id: 'stones', group: 'Ground & soil', label: 'Stones (coarse fragments)', get: (b, i) => (b === 'earth' ? (fx(featureAt('earth', 'cfvo_pct', i), 0, ' % by volume') || NA('sea / no soil')) : NA('not mapped')) },
  { id: 'bdod', group: 'Ground & soil', label: 'Bulk density', get: (b, i) => (b === 'earth' ? (fx(featureAt('earth', 'bdod_g_cm3', i), 2, ' g/cm³') || NA('sea / no soil'))
    : b === 'moon' ? NA('≈1.5 g/cm³ (Apollo cores, not mapped)') : NA('not mapped')) },
  { id: 'ph', group: 'Ground & soil', label: 'Soil pH', get: (b, i) => (b === 'earth' ? (fx(featureAt('earth', 'ph_h2o', i), 1, '') || NA('sea / no soil'))
    : b === 'mars' ? NA('7.7 at the Phoenix site only') : NA('not applicable (no water)')) },
  { id: 'earthvis', group: 'Operations', label: 'Earth visible (radio contact)', get: (b, i) => {
    if (b !== 'moon') return NA('not applicable');
    const lon = Math.abs(lonOf(i));
    return lon <= 82 ? { v: 1, text: 'Always (near side)' } : lon <= 98 ? { v: 0.5, text: 'Sometimes (libration zone)' } : { v: 0, text: 'Never (far side): needs a relay' };
  } },
  { id: 'lights', group: 'Operations', label: 'Night lights (remoteness)', get: (b, i) => {
    if (b !== 'earth') return NA('not applicable');
    if (!nightLights) return NA('loading…');
    const v = nightLights[i];
    return { v, text: v < 0.05 ? 'Dark (remote)' : v < 0.3 ? `Dim (${v.toFixed(2)})` : `Bright (${v.toFixed(2)})` };
  } },
];

/* ---------------- per-variable match (grid buttons) ----------------
 * NUM: one comparable number per cell (same units on every world).
 * CMP: how two values are compared -> 0..1 similarity.
 *   range: 1 − |a − b| / range        log: 1 − |log10(a+eps) − log10(b+eps)| / decades
 * Variables missing here have no counterpart on the other worlds (no % possible).
 */
const col = (g, c, i) => (g && g.columns && g.columns[c] ? g.columns[c][i] : NaN);
const NUM = {
  temp_mean: (b, i, g) => g.mean[i],
  temp_high: (b, i, g) => g.high[i],
  temp_low: (b, i, g) => g.low[i],
  swing: (b, i, g) => g.high[i] - g.low[i],
  pressure: (b, i, g) => col(g, 'pressure_pa', i),
  vapour: (b, i, g) => (b === 'moon' ? 0 : col(g, 'water_vapour_mm', i)),
  solar: (b, i) => solarAt(b, i),
  wind: (b, i) => windAt(b, i),
  dust: (b, i) => dustTauAt(b, i),
  precip: (b, i) => (b === 'earth' ? featureAt('earth', 'precip_mm_yr', i) : 0),
  ice: (b, i) => (b === 'earth' ? NaN : featureAt(b, 'water_idx', i)),
  elevation: (b, i) => featureAt(b, b === 'earth' ? 'elev_mean_m' : 'elevation_m', i),
  slope: (b, i) => featureAt(b, 'slope_mean_deg', i),
  roughness: (b, i) => featureAt(b, 'roughness_m', i),
  relief: (b, i) => featureAt(b, 'relief_m', i),
};
export const VAR_CMP = {
  temp_mean: { range: 'temp', how: '100% − difference ÷ temperature range (Advanced options)' },
  temp_high: { range: 'temp', how: '100% − difference ÷ temperature range (Advanced options)' },
  temp_low: { range: 'temp', how: '100% − difference ÷ temperature range (Advanced options)' },
  swing: { range: 40, how: '0% at 40 °C apart' },
  pressure: { log: 3, eps: 1, how: 'log scale, 0% at 1000× apart' },
  vapour: { log: 3, eps: 0.001, how: 'log scale, 0% at 1000× apart' },
  solar: { range: 150, how: '0% at 150 W/m² apart' },
  wind: { range: 8, how: '0% at 8 m/s apart' },
  dust: { range: 0.5, how: 'optical depth, 0% at 0.5 apart' },
  precip: { range: 500, how: '0% at 500 mm/yr apart' },
  ice: { range: 0.6, how: 'water index, 0% at 0.6 apart' },
  elevation: { range: 3000, how: '0% at 3000 m apart' },
  slope: { range: 6, how: '0% at 6° apart' },
  roughness: { range: 400, how: '0% at 400 m apart' },
  relief: { range: 2500, how: '0% at 2500 m apart' },
};
// gas, UV and radiation columns from the terrain-data team (all three worlds share these columns)
[['pp_o2_pa'], ['pp_co2_pa'], ['pp_n2_pa'], ['pp_ar_pa'], ['ozonecol', 'ozone_du'], ['aircol', 'air_column_g_cm2'],
  ['haze', 'haze_tau'], ['uva_w_m2'], ['uvb_w_m2'], ['uvc_w_m2'], ['dose', 'dose_msv_yr'],
  ['fe_pct'], ['si_pct'], ['k_pct'], ['th_ppm']].forEach(([id, colName = id]) => {
  NUM[id] = (b, i) => featureAt(b, colName, i);
});
Object.assign(VAR_CMP, {
  pp_o2_pa: { log: 3, eps: 1, how: 'log scale, 0% at 1000× apart' },
  pp_co2_pa: { log: 3, eps: 1, how: 'log scale, 0% at 1000× apart' },
  pp_n2_pa: { log: 3, eps: 1, how: 'log scale, 0% at 1000× apart' },
  pp_ar_pa: { log: 3, eps: 1, how: 'log scale, 0% at 1000× apart' },
  ozonecol: { log: 2.5, eps: 1, how: 'log scale, 0% at ~300× apart' },
  aircol: { log: 3, eps: 0.001, how: 'log scale, 0% at 1000× apart' },
  haze: { range: 1, how: 'optical depth, 0% at 1 apart' },
  uva_w_m2: { range: 6, how: '0% at 6 W/m² apart' },
  uvb_w_m2: { log: 1.5, eps: 0.001, how: 'log scale, 0% at ~30× apart' },
  uvc_w_m2: { log: 3, eps: 0.001, how: 'log scale, 0% at 1000× apart' },
  dose: { log: 3, eps: 0.01, how: 'log scale, 0% at 1000× apart' },
  fe_pct: { range: 8, how: '0% at 8 % apart' },
  si_pct: { range: 8, how: '0% at 8 % apart' },
  k_pct: { range: 2, how: '0% at 2 % apart' },
  th_ppm: { range: 8, how: '0% at 8 ppm apart' },
});
export const varValue = (id, body, i, grid) => (NUM[id] && grid ? NUM[id](body, i, grid) : NaN);

/**
 * Similarity of one variable between the reference cell and every target cell.
 * Returns { scores: Float32Array, refValue } or null when the two worlds can't be compared.
 */
export function variableScores(id, refBody, refI, refGrid, target, grid, tempRange) {
  const cmp = VAR_CMP[id];
  if (!cmp || !NUM[id] || !grid || !refGrid) return null;
  const a = NUM[id](refBody, refI, refGrid);
  if (a == null || Number.isNaN(a)) return null;
  const range = cmp.range === 'temp' ? tempRange : cmp.range;
  const out = new Float32Array(N);
  let any = false;
  for (let i = 0; i < N; i++) {
    const b = NUM[id](target, i, grid);
    if (b == null || Number.isNaN(b)) { out[i] = NaN; continue; }
    any = true;
    out[i] = cmp.log
      ? clamp01(1 - Math.abs(Math.log10(a + cmp.eps) - Math.log10(b + cmp.eps)) / cmp.log)
      : clamp01(1 - Math.abs(a - b) / range);
  }
  return any ? { scores: out, refValue: a } : null;
}

export const VARIABLE_SOURCES = {
  earth: 'NASA POWER (temperature, pressure, water vapour) · WorldClim 2.1 (solar, wind, rain) · NOAA ETOPO 2022 (terrain) · dry-air gas mix × surface pressure · NASA POWER ozone & aerosol · NASA POWER UV-A/UV-B · cosmic dose from altitude (UNSCEAR) · ISRIC SoilGrids 2.0 (topsoil) · GLiM rock types × typical rock chemistry (estimated Fe, Si, K, Th) · NASA Black Marble (night lights)',
  moon: 'LRO Diviner (temperature) · vacuum: gases 0 (LADEE exosphere ~3×10⁻¹⁰ Pa) · Chang’e-4 LND (dose) · UV from sunlight geometry · LRO LOLA (terrain) · Lunar Prospector gamma-ray spectrometer (Fe, Si, K, Th) · solar & Earth visibility calculated from position · ice index is a latitude-based estimate',
  mars: 'Mars Climate Database 6.2 (temperature, pressure, vapour, gases, ozone, dust, frost) · Curiosity TLS (methane) · Curiosity RAD (dose) and REMS (UV split, est.) · MGS MOLA (terrain) · MGS TES (thermal inertia, dust) · Mars Odyssey gamma-ray spectrometer (hydrogen, Fe, Si, K, Th, Cl) · solar calculated',
};

/** Whole-body constants (no single place can change these). */
export const BODY_CONSTANTS = [
  { label: 'Gravity', earth: '1 g (9.8 m/s²)', moon: '0.17 g', mars: '0.38 g' },
  { label: 'Atmosphere', earth: 'Thick N₂/O₂, breathable', moon: 'None (vacuum)', mars: 'Thin CO₂ (~0.6% of Earth)' },
  { label: 'Day length', earth: '24 h', moon: '29.5 Earth days', mars: '24 h 40 min' },
  { label: 'Solar wind at the surface', earth: 'Blocked by the magnetic field', moon: 'Hits the ground directly', mars: 'No global magnetic field; thin air gives little protection' },
  { label: 'Magnetic field', earth: 'Strong, global', moon: 'None (weak local patches)', mars: 'None global (crustal patches)' },
  { label: 'Radiation dose (surface, approx.)', earth: '~0.007 mSv/day', moon: '~1.4 mSv/day (Chang’e-4)', mars: '~0.7 mSv/day (Curiosity RAD)' },
  { label: 'Sunlight strength (top of air)', earth: '1361 W/m²', moon: '1361 W/m²', mars: '~590 W/m²' },
  { label: 'Escape velocity', earth: '11.2 km/s', moon: '2.4 km/s', mars: '5.0 km/s' },
];

/** Highest overall score (land only on Earth); ties broken by the best-matching 3×3 neighbourhood. */
/** Attach every metric's score and the measured values at the best cell. */
function fillBest(res, best) {
  const i = best.i, g = res.grid, tg = res.tg, pcol = g.columns && g.columns.pressure_pa;
  best.scores = { temp: res.temp[i], press: res.press[i], terrain: res.terrain[i], sunwind: res.sunwind[i],
    soil: res.soil ? res.soil[i] : NaN, air: res.air ? res.air[i] : NaN, rad: res.rad ? res.rad[i] : NaN, combo: res.combo[i] };
  best.values = {
    mean: g.mean[i], high: g.high[i], low: g.low[i],
    pressure: pcol ? pcol[i] : NaN,
    solar: solarAt(res.target, i), wind: windAt(res.target, i),
    slope: tg.slope ? tg.slope[i] : NaN,
    terrain: Object.fromEntries(tg.keys.map((f) => [f.key, tg[f.key][i]])),
    soil: soilAt(res.target, i),
    gas: gasAt(res.target, i),
    rad: radAt(res.target, i),
  };
  best.terrainKeys = tg.keys;
  return best;
}

/** Best cell for ANY 0..1 array of a match result (a symbol or one grid variable); overall = that array's score. */
export function bestOf(res, arr) {
  if (!res || !arr) return null;
  const b = bestCell(arr, res.target);
  return b ? fillBest(res, { ...b, overall: arr[b.i] }) : null;
}

function bestCell(arr, target) {
  const ok = (i) => !Number.isNaN(arr[i]) && (target !== 'earth' || isLand(latOf(i), lonOf(i)));
  let max = -1;
  for (let i = 0; i < N; i++) if (ok(i) && arr[i] > max) max = arr[i];
  if (max < 0) return null;
  let bestI = -1, bestHood = -1;
  for (let i = 0; i < N; i++) {
    if (!ok(i) || arr[i] < max - 0.005) continue;
    const r = Math.floor(i / COLS), c = i % COLS;
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= ROWS) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const v = arr[rr * COLS + ((c + dc + COLS) % COLS)];
        if (!Number.isNaN(v)) { sum += v; n++; }
      }
    }
    if (n && sum / n > bestHood) { bestHood = sum / n; bestI = i; }
  }
  return { i: bestI, lat: latOf(bestI), lon: lonOf(bestI), overall: arr[bestI] };
}

/** Equirectangular green→red image of a 0..1 array (transparent where NaN). */
export function renderScoreCanvas(arr, { px = 10, gridLines = true } = {}) {
  const c = document.createElement('canvas');
  c.width = COLS * px; c.height = ROWS * px;
  const g = c.getContext('2d');
  for (let i = 0; i < N; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) continue;
    const [r, gr, b] = matchColor(v);
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect((i % COLS) * px, Math.floor(i / COLS) * px, px, px);
  }
  if (gridLines && px >= 4) {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= COLS; x++) { g.moveTo(x * px + 0.5, 0); g.lineTo(x * px + 0.5, c.height); }
    for (let y = 0; y <= ROWS; y++) { g.moveTo(0, y * px + 0.5); g.lineTo(c.width, y * px + 0.5); }
    g.stroke();
  }
  return c;
}

export const cellIndex = (lat, lon) =>
  Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / RES))) * COLS
  + Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / RES)));
