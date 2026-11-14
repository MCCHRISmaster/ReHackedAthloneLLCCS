/**
 * Temperature matching: Earth reference temperature (NASA POWER) vs Moon/Mars
 * grid CSVs (format: data_templates/DATA_FORMAT.md in the repo root).
 * Pure data + canvas code. No WorldWind here.
 */

// Real grids from the data team (repo-root moon_data/ and mars_data/), with the
// placeholder model in data/ as a fallback when the page is served on its own.
export const GRID_FILES = {
  moon: ['../../moon_data/moon_grid.csv', 'data/moon_grid.csv'],
  mars: ['../../mars_data/mars_grid.csv', 'data/mars_grid.csv'],
  earth: ['../../earth_data/earth_grid.csv'],   // used by the reverse search (Moon/Mars -> Earth)
};
const SOURCE_NAMES = {
  nasa_power_clim: 'NASA POWER climatology',
  diviner_gcp_2017: 'LRO Diviner (measured)',
  mcd_v6_2: 'Mars Climate Database 6.2',
  model_placeholder: 'placeholder model',
};
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

export function parseCSV(text) {
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
  const sources = new Set();
  const rows = parseCSV(text);
  // every numeric column (temperatures, pressure, water vapour, ...) for the NASA DATA tab
  const skip = new Set(['body', 'lat', 'lon', 'source_id']);
  g.columns = {};
  Object.keys(rows[0] || {}).filter((c) => !skip.has(c)).forEach((c) => {
    g.columns[c] = new Float32Array(ROWS * COLS).fill(NaN);
  });
  for (const r of rows) {
    if ((r.body || '').toLowerCase() !== body) continue;
    if (r.source_id) sources.add(r.source_id);
    const row = (90 - RES / 2 - Number(r.lat)) / RES, col = (Number(r.lon) + 180 - RES / 2) / RES;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= ROWS || col < 0 || col >= COLS) continue;
    const i = row * COLS + col;
    for (const [k, s] of Object.entries(STATS)) g[k][i] = r[s.col] === '' ? NaN : Number(r[s.col]);
    for (const c in g.columns) if (r[c] !== '' && r[c] != null) g.columns[c][i] = Number(r[c]);
    cells++;
  }
  // drop columns that are empty everywhere (e.g. elevation not filled in yet)
  for (const c in g.columns) if (!g.columns[c].some((v) => !Number.isNaN(v))) delete g.columns[c];
  g.cells = cells;
  g.filled = g.mean.reduce((n, v) => n + (Number.isNaN(v) ? 0 : 1), 0);  // cells with a temperature
  g.sourceIds = [...sources];
  g.sourceLabel = g.sourceIds.map((s) => SOURCE_NAMES[s] || s).join(', ') || 'unknown source';
  g.placeholder = g.sourceIds.includes('model_placeholder');
  return g;
}

/** Load the first grid file that exists for this body. */
export async function loadGrid(body) {
  for (const path of GRID_FILES[body]) {
    const res = await fetch(path).catch(() => null);
    if (!res || !res.ok) continue;
    const g = gridFromCSV(await res.text(), body);
    if (g.cells) { g.path = path; return g; }
  }
  throw new Error(`no ${body} grid found (${GRID_FILES[body].join(' or ')})`);
}

/* ---------------- Earth reference (NASA POWER) ---------------- */

/** Ground-surface temperature climatology (2001–2025) at a point, in °C. */
export async function fetchEarthTemps(lat, lon) {
  const url = `${POWER_URL}?parameters=TS,TS_MAX,TS_MIN,PS&community=RE` +
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
  // surface pressure: POWER gives kPa
  const ps = p.PS ? (p.PS.ANN > -900 ? p.PS.ANN : avg('PS')) : NaN;
  return { mean, high: avg('TS_MAX'), low: avg('TS_MIN'), pressure: Number.isNaN(ps) ? NaN : ps * 1000 };
}

/* ---------------- Matching ---------------- */

export function cellIndex(lat, lon) {
  const row = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  const col = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / RES)));
  return row * COLS + col;
}

/** { mean, high, low } of the grid cell containing lat/lon (NaN where missing). */
export function cellTemps(grid, lat, lon) {
  const i = cellIndex(lat, lon);
  return { mean: grid.mean[i], high: grid.high[i], low: grid.low[i] };
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
  // Ties (often many cells at ~100%): choose the one whose 3×3 neighbourhood matches best,
  // so the marker lands in the middle of the strongest matching area, not an arbitrary edge cell.
  let bestHood = -1;
  for (let i = 0; i < ROWS * COLS; i++) {
    const m = matchValue(grid, i, stat, target, range);
    if (Number.isNaN(m) || m < best - 0.005) continue;
    const r = Math.floor(i / COLS), c = i % COLS;
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= ROWS) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const v = matchValue(grid, rr * COLS + ((c + dc + COLS) % COLS), stat, target, range);
        if (!Number.isNaN(v)) { sum += v; n++; }
      }
    }
    const hood = n ? sum / n : 0;
    if (hood > bestHood) { bestHood = hood; bestI = i; best = m; }
  }
  return {
    best,
    lat: 90 - (Math.floor(bestI / COLS) + 0.5) * RES,
    lon: -180 + ((bestI % COLS) + 0.5) * RES,
    temp: grid[stat][bestI],
    goodShare: area ? good / area : 0,
  };
}
