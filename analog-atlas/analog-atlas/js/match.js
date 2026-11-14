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
  temp: { label: 'TEMPERATURE', short: 'TEMP' },
  press: { label: 'PRESSURE', short: 'PRESS' },
  terrain: { label: 'TERRAIN', short: 'TERRAIN' },
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

/* ---------------- terrain (per body + scale, cached) ---------------- */
const terrainCache = new Map();
function terrainGrid(body, scale) {
  const key = `${body}|${scale}`;
  if (terrainCache.has(key)) return terrainCache.get(key);
  const g = { sim: false };
  TERRAIN_KEYS.forEach((k) => { g[k] = new Float32Array(N).fill(NaN); });
  for (let i = 0; i < N; i++) {
    const m = measure(body, latOf(i), lonOf(i), scale, { fast: true });
    TERRAIN_KEYS.forEach((k) => { if (m.values[k] != null) g[k][i] = m.values[k]; });
    if (m.simulated.slope) g.sim = true;
  }
  terrainCache.set(key, g);
  return g;
}
export function clearTerrainCache() { terrainCache.clear(); }

/** Terrain measurements at one point (full sampling) + whether they are simulated. */
export function terrainAt(body, lat, lon, scale) {
  const m = measure(body, lat, lon, scale);
  return { slope: m.values.slope, relief: m.values.relief, rocks: m.values.rocks, sim: !!m.simulated.slope };
}

function terrainScore(ref, tg, i, scale) {
  let sum = 0, n = 0;
  TERRAIN_KEYS.forEach((k) => {
    const a = ref[k], b = tg[k][i];
    if (a == null || Number.isNaN(b)) return;
    sum += clamp01(1 - Math.abs(a - b) / rangeOf(k, scale)); n++;
  });
  return n ? sum / n : NaN;
}

/* ---------------- the match ---------------- */

/**
 * ref = { body, lat, lon, mean, high, low, pressure, terrain:{slope,relief,rocks,sim} }
 * grid = loaded grid of the target body (temperature.gridFromCSV)
 * Returns per-cell Float32Arrays for each metric + overall, and the best cell.
 */
export function computeMatch(ref, grid, target, { stat, range, scale }) {
  const temp = new Float32Array(N), press = new Float32Array(N), terrain = new Float32Array(N), overall = new Float32Array(N);
  const tg = terrainGrid(target, scale);
  const terrainReal = !tg.sim && !ref.terrain.sim;
  const w = terrainReal ? WEIGHTS.real : WEIGHTS.sampleTerrain;
  const pcol = grid.columns && grid.columns.pressure_pa;
  const target0 = ref[stat];
  for (let i = 0; i < N; i++) {
    const t = grid[stat][i];
    temp[i] = Number.isNaN(t) ? NaN : clamp01(1 - Math.abs(t - target0) / range);
    press[i] = pcol ? pressScore(ref.pressure, pcol[i]) : NaN;
    terrain[i] = terrainScore(ref.terrain, tg, i, scale);
    let sum = 0, ws = 0;
    [['temp', temp[i]], ['press', press[i]], ['terrain', terrain[i]]].forEach(([k, v]) => {
      if (!Number.isNaN(v) && w[k] > 0) { sum += v * w[k]; ws += w[k]; }
    });
    overall[i] = ws ? sum / ws : NaN;
  }
  let best = bestCell(overall, target);
  if (best && best.overall <= 0.005) {
    // Nothing scores above 0%: pin the CLOSEST cell instead (smallest temperature gap),
    // so the marker still means something, and flag it as "closest", not a match.
    let bi = -1, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const t = grid[stat][i];
      if (Number.isNaN(t) || (target === 'earth' && !isLand(latOf(i), lonOf(i)))) continue;
      const d = Math.abs(t - target0);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0) best = { i: bi, lat: latOf(bi), lon: lonOf(bi), overall: overall[bi], closestOnly: true, gap: bd };
  }
  if (best) {
    const i = best.i;
    best.scores = { temp: temp[i], press: press[i], terrain: terrain[i] };
    best.values = {
      mean: grid.mean[i], high: grid.high[i], low: grid.low[i],
      pressure: pcol ? pcol[i] : NaN, slope: tg.slope[i], relief: tg.relief[i], rocks: tg.rocks[i],
    };
  }
  return { target, temp, press, terrain, overall, best, terrainSim: !terrainReal, weights: w };
}

/** Highest overall score (land only on Earth); ties broken by the best-matching 3×3 neighbourhood. */
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
