/**
 * Loads the feature CSVs written by the pipeline into typed arrays, in the same style as
 * analog-atlas/analog-atlas/js/temperature.js (index = row * cols + col, row 0 = north edge).
 *
 *   const moon = parseFeatureCSV(await (await fetch('.../moon_features.csv')).text());
 *   attachColumns(moon, parseFeatureCSV(await (await fetch('../../moon_data/moon_grid.csv')).text()));  // temperatures
 *   moon.index(-89.9, 0);          // cell index for a place
 */

const TEXT_COLUMNS = new Set(['body', 'source_id', 'country', 'admin_region', 'volcano_nearest_type',
  'crater_nearest_name', 'cave_nearest_type']);

function splitLine(line) {
  if (!line.includes('"')) return line.split(',');
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** CSV text -> table. Numeric columns become Float32Array (blank -> NaN); known text columns stay arrays of strings. */
export function parseFeatureCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length);
  const head = splitLine(lines[0]);
  const n = lines.length - 1;
  const res = n === 16200 ? 2 : n === 64800 ? 1 : 180 / Math.sqrt(n / 2);
  const rows = Math.round(180 / res), cols = Math.round(360 / res);
  const table = { n, res, rows, cols, lat: new Float32Array(n), lon: new Float32Array(n), cols: {}, text: {}, sourceIds: new Set() };
  const iLat = head.indexOf('lat'), iLon = head.indexOf('lon');
  const num = {};
  head.forEach((h, j) => {
    if (h === 'lat' || h === 'lon') return;
    if (TEXT_COLUMNS.has(h)) table.text[h] = new Array(n).fill('');
    else { table.cols[h] = new Float32Array(n).fill(NaN); num[h] = j; }
  });
  const iSrc = head.indexOf('source_id');
  const order = new Int32Array(n);                       // row of the CSV that lands at each grid index
  for (let r = 0; r < n; r++) {
    const f = splitLine(lines[r + 1]);
    const la = Number(f[iLat]), lo = Number(f[iLon]);
    const row = Math.min(rows - 1, Math.max(0, Math.floor((90 - la) / res)));
    const col = Math.min(cols - 1, Math.max(0, Math.floor((lo + 180) / res)));
    const i = row * cols + col;
    order[r] = i;
    table.lat[i] = la; table.lon[i] = lo;
    for (const h in num) { const s = f[num[h]]; table.cols[h][i] = s === '' || s === undefined ? NaN : Number(s); }
    for (const h in table.text) table.text[h][i] = f[head.indexOf(h)] ?? '';
    if (iSrc >= 0 && f[iSrc]) f[iSrc].split(';').forEach((s) => table.sourceIds.add(s));
  }
  table.index = (la, lo) => {
    const row = Math.min(rows - 1, Math.max(0, Math.floor((90 - la) / res)));
    const col = Math.min(cols - 1, Math.max(0, Math.floor((lo + 180) / res)));
    return row * cols + col;
  };
  return table;
}

/** Copy numeric columns of `other` (same grid) into `table`, e.g. temperatures from moon_data/moon_grid.csv. */
export function attachColumns(table, other, names = ['temp_mean_c', 'temp_high_c', 'temp_low_c']) {
  if (other.n !== table.n) throw new Error(`grid size differs: ${other.n} vs ${table.n}`);
  for (const h of names) if (other.cols[h]) table.cols[h] = other.cols[h];
  other.sourceIds.forEach((s) => table.sourceIds.add(s));
  return table;
}
