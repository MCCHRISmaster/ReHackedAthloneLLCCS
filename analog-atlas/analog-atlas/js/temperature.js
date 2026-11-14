/**
 * Temperature matching: Earth reference temperature (NASA POWER) vs Moon/Mars
 * grid CSVs (format: data_templates/DATA_FORMAT.md in the repo root).
 * Pure data + canvas code. No WorldWind here.
 */

export const GRID_FILES = { moon: 'data/moon_grid.csv', mars: 'data/mars_grid.csv' };
export const STATS = {
  mean: { col: 'temp_mean_c', label: 'AVG' },
  high: { col: 'temp_high_c', label: 'HIGH' },
  low: { col: 'temp_low_c', label: 'LOW' },
};
const RES = 2, ROWS = 90, COLS = 180;
const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

// 0% red -> orange -> yellow -> light green -> 100% green
const RAMP = [[0, [215, 48, 39]], [0.25, [252, 141, 89]], [0.5, [254, 224, 139]],
              [0.75, [145, 207, 96]], [1, [26, 152, 80]]];

export function matchColor(t) {
  for (let k = 1; k < RAMP.length; k++) {
    if (t <= RAMP[k][0]) {
      const [t0, c0] = RAMP[k - 1], [t1, c1] = RAMP[k];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/* ---------------- CSV grids ---------------- */

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const header = rows.shift().map((h) => h.trim().replace(/^﻿/, ''));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** CSV text -> { mean, high, low: Float32Array(16200) with NaN for missing, cells } */
export function gridFromCSV(text, body) {
  const g = { mean: new Float32Array(ROWS * COLS).fill(NaN) };
  g.high = g.mean.slice(); g.low = g.mean.slice();
  let cells = 0;
  for (const r of parseCSV(text)) {
    if ((r.body || '').toLowerCase() !== body) continue;
    const row = (90 - RES / 2 - Number(r.lat)) / RES, col = (Number(r.lon) + 180 - RES / 2) / RES;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
    const i = row * COLS + col;
    for (const [k, s] of Object.entries(STATS)) g[k][i] = r[s.col] === '' ? NaN : Number(r[s.col]);
    cells++;
  }
  g.cells = cells;
  return g;
}

export async function loadGrid(body) {
  const res = await fetch(GRID_FILES[body]);
  if (!res.ok) throw new Error(`${GRID_FILES[body]}: HTTP ${res.status}`);
  return gridFromCSV(await res.text(), body);
}

/* ---------------- Earth reference (NASA POWER) ---------------- */

/** Ground-surface temperature climatology (2001–2025) at a point, in °C. */
export async function fetchEarthTemps(lat, lon) {
  const url = `${POWER_URL}?parameters=TS,TS_MAX,TS_MIN&community=RE` +
    `&latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&format=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA POWER returned ${res.status}`);
  const p = (await res.json()).properties.parameter;
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const avg = (k) => {
    const v = months.map((m) => p[k][m]).filter((x) => x != null && x > -900);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
  };
  const mean = p.TS.ANN > -900 ? p.TS.ANN : avg('TS');
  if (Number.isNaN(mean)) throw new Error('no data for this point');
  return { mean, high: avg('TS_MAX'), low: avg('TS_MIN') };
}

/* ---------------- Matching ---------------- */

export function cellIndex(lat, lon) {
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / RES)));
  return row * COLS + col;
}

/** Match fraction 0..1 (NaN if no data): 1 at equal temperature, 0 at `range` °C apart. */
export function matchValue(grid, i, stat, target, range) {
  const t = grid[stat][i];
  return Number.isNaN(t) ? NaN : Math.max(0, 1 - Math.abs(t - target) / range);
}

/**
 * Equirectangular match image for draping on the globe: one block per 2° cell,
 * optional dark cell borders. Returns a fresh canvas each call (WorldWind caches
 * textures per image source, so a new object forces a refresh).
 */
export function renderMatchCanvas(grid, stat, target, range, { gridLines = true, px = 10 } = {}) {
  const c = document.createElement('canvas');
  c.width = COLS * px; c.height = ROWS * px;
  const g = c.getContext('2d');
  for (let i = 0; i < ROWS * COLS; i++) {
    const m = matchValue(grid, i, stat, target, range);
    if (Number.isNaN(m)) continue;              // no data: leave transparent
    const [r, gr, b] = matchColor(m);
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect((i % COLS) * px, Math.floor(i / COLS) * px, px, px);
  }
  if (gridLines) {
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= COLS; x++) { g.moveTo(x * px + 0.5, 0); g.lineTo(x * px + 0.5, c.height); }
    for (let y = 0; y <= ROWS; y++) { g.moveTo(0, y * px + 0.5); g.lineTo(c.width, y * px + 0.5); }
    g.stroke();
  }
  return c;
}

/** Best cell and share of surface (area-weighted) at >= 75% match. */
export function summarize(grid, stat, target, range) {
  let best = -1, bestI = -1, area = 0, good = 0;
  for (let i = 0; i < ROWS * COLS; i++) {
    const m = matchValue(grid, i, stat, target, range);
    if (Number.isNaN(m)) continue;
    const lat = 90 - (Math.floor(i / COLS) + 0.5) * RES;
    const w = Math.cos((lat * Math.PI) / 180);
    area += w;
    if (m >= 0.75) good += w;
    if (m > best) { best = m; bestI = i; }
  }
  if (bestI < 0) return null;
  return {
    best,
    lat: 90 - (Math.floor(bestI / COLS) + 0.5) * RES,
    lon: -180 + ((bestI % COLS) + 0.5) * RES,
    temp: grid[stat][bestI],
    goodShare: area ? good / area : 0,
  };
}
