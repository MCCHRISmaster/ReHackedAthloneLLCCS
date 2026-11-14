/**
 * NASA DATA tab: a browser for every dataset the project uses.
 *   OVERVIEW  - sources.csv (team's dataset register) + NASA POWER site files + live API
 *   EARTH / MOON / MARS - the 2° grid as a colour map (any variable), stats, notes, download
 *   IMAGERY   - the NASA imagery layers the globe streams
 * Pure DOM + canvas; reads grids already loaded by main.js (state.temp.grids).
 */
import { BODIES } from './config.js';
import { parseCSV } from './temperature.js';

const ROWS = 90, COLS = 180, RES = 2;
const SOURCES_URL = '../../sources.csv';
const SITE_FILES = [
  ['Atacama (Yungay), Chile', 'atacama_yungay'],
  ['McMurdo Dry Valleys, Antarctica', 'dry_valleys'],
  ['Haughton Crater, Canada', 'haughton_crater'],
  ['Death Valley, USA', 'death_valley'],
  ['Lut Desert, Iran', 'lut_desert'],
];
const COLUMN_INFO = {
  temp_mean_c: { label: 'Average surface temperature', unit: '°C', digits: 1 },
  temp_high_c: { label: 'Typical daily high', unit: '°C', digits: 1 },
  temp_low_c: { label: 'Typical daily low', unit: '°C', digits: 1 },
  pressure_pa: { label: 'Surface pressure', unit: 'Pa', digits: 0 },
  water_vapour_mm: { label: 'Water vapour column', unit: 'mm', digits: 3 },
  elevation_m: { label: 'Elevation', unit: 'm', digits: 0 },
  slope_deg: { label: 'Slope', unit: '°', digits: 1 },
  water_ice_pct: { label: 'Water ice', unit: '%', digits: 1 },
};
// cold -> hot (blue to red), used for every variable
const RAMP = ['#313695', '#4575b4', '#74add1', '#abd9e9', '#fee090', '#fdae61', '#f46d43', '#d73027']
  .map((h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)));

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const info = (c) => COLUMN_INFO[c] || { label: c, unit: '', digits: 2 };
const fmt = (c, v) => (v == null || Number.isNaN(v) ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: info(c).digits, minimumFractionDigits: info(c).digits })}${info(c).unit ? ' ' + info(c).unit : ''}`);
const fmtLat = (v) => `${Math.abs(v).toFixed(0)}° ${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(0)}° ${v >= 0 ? 'E' : 'W'}`;

let getGrids = () => ({});
let sources = null;          // rows of sources.csv
let tab = 'overview';
const varChoice = { earth: 'temp_mean_c', moon: 'temp_mean_c', mars: 'temp_mean_c' };

export function initDataTab({ grids }) {
  getGrids = grids;
  $('data-close').addEventListener('click', () => closeDataTab());
  const go = (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) { tab = b.dataset.tab; render(); }
  };
  $('data-tabs').addEventListener('click', go);
  $('data-body').addEventListener('click', go);   // the world cards on the overview
  fetch(SOURCES_URL).then((r) => (r.ok ? r.text() : '')).then((t) => {
    sources = t ? parseCSV(t) : [];
    if (isOpen()) render();
  }).catch(() => { sources = []; });
}

export const isOpen = () => !$('data-panel').classList.contains('hidden');
export function openDataTab(which) {
  if (which) tab = which;
  $('data-panel').classList.remove('hidden');
  $('btn-data').setAttribute('aria-pressed', 'true');
  render();
}
export function closeDataTab() {
  $('data-panel').classList.add('hidden');
  $('btn-data').setAttribute('aria-pressed', 'false');
}
export function toggleDataTab(which) { if (isOpen()) closeDataTab(); else openDataTab(which); }

/* ---------------- rendering ---------------- */

function render() {
  const tabs = [['overview', 'OVERVIEW'], ['earth', 'EARTH'], ['moon', 'MOON'], ['mars', 'MARS'], ['imagery', 'IMAGERY']];
  $('data-tabs').innerHTML = tabs.map(([id, label]) =>
    `<button class="data-tab" data-tab="${id}" aria-selected="${id === tab}">${label}</button>`).join('');
  const body = $('data-body');
  if (tab === 'overview') body.innerHTML = overviewHtml();
  else if (tab === 'imagery') body.innerHTML = imageryHtml();
  else renderBody(body, tab);
}

function sourceRow(id) { return (sources || []).find((s) => s.source_id === id); }

function overviewHtml() {
  const grids = getGrids();
  const rows = (sources || []).map((s) => `<tr>
      <td><span class="data-body-tag ${esc(s.body)}">${esc(s.body.toUpperCase())}</span></td>
      <td><b>${esc(s.dataset)}</b><div class="data-sub">${esc(s.processing_notes)}</div></td>
      <td>${esc(s.resolution)}</td>
      <td>${esc(s.variables.split(';').map((v) => info(v).label).join(', '))}</td>
      <td>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">source ▸</a>` : '—'}<div class="data-sub">${esc(s.downloaded_on)}</div></td>
    </tr>`).join('');
  const gridCards = ['earth', 'moon', 'mars'].map((b) => {
    const g = grids[b];
    return `<button class="data-card" data-tab="${b}">
      <span class="data-card-body">${BODIES[b].label}</span>
      <span class="data-card-main">${g ? `${g.filled.toLocaleString()} / 16,200` : 'not loaded'}</span>
      <span class="data-sub">${g ? `${esc(g.sourceLabel)} · ${Object.keys(g.columns || {}).length} variables` : ''}</span></button>`;
  }).join('');
  const siteRows = SITE_FILES.map(([name, f]) => `<tr><td>${esc(name)}</td>
      <td><a href="../../data/${f}_2023.csv" download>CSV</a> · <a href="../../data/${f}_2023.json" download>JSON</a></td></tr>`).join('');
  return `
    <p class="data-lead">Every dataset behind the temperature matching. Grids are 2° × 2° cells (16,200 per world).</p>
    <div class="data-cards">${gridCards}</div>
    <h4>DATASET REGISTER <span class="data-sub">from sources.csv</span></h4>
    ${sources == null ? '<p class="data-sub">Loading…</p>' : sources.length ? `<table class="data-table">
      <thead><tr><th>World</th><th>Dataset · processing</th><th>Resolution</th><th>Variables</th><th>Link</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<p class="data-sub">sources.csv not found.</p>'}
    <h4>LIVE API</h4>
    <p class="data-sub">Clicking Earth asks the <a href="https://power.larc.nasa.gov/docs/" target="_blank" rel="noopener">NASA POWER climatology API</a>
      for that exact point (TS, TS_MAX, TS_MIN, 2001–2025). If it can't be reached, the Earth grid cell is used instead.</p>
    <h4>ANALOG SITE TIME SERIES <span class="data-sub">NASA POWER daily, 2023 (T2M, T2M_MAX, T2M_MIN, TS)</span></h4>
    <table class="data-table small"><tbody>${siteRows}</tbody></table>`;
}

function imageryHtml() {
  return ['earth', 'moon', 'mars'].map((b) => {
    const body = BODIES[b];
    const rows = body.layers.map((l) => `<tr><td><b>${esc(l.label)}</b></td><td>${esc(l.note || '')}</td>
        <td>${l.source === 'trek' ? `NASA ${body.label === 'MOON' ? 'Moon' : 'Mars'} Trek` : l.source === 'gibs' ? 'NASA GIBS' : esc(l.source)}</td></tr>`).join('');
    const c = body.tactical && body.tactical.contours;
    return `<h4>${body.label}</h4><table class="data-table"><thead><tr><th>Layer</th><th>Description</th><th>Service</th></tr></thead>
      <tbody>${rows}${c ? `<tr><td><b>Contours (Tactical view)</b></td><td>${esc(c.note || c.layer)}</td><td>${c.source === 'trek' ? 'NASA Trek' : 'NASA GIBS'}</td></tr>` : ''}</tbody></table>`;
  }).join('');
}

function stats(arr) {
  let min = Infinity, max = -Infinity, sum = 0, n = 0;
  for (const v of arr) if (!Number.isNaN(v)) { if (v < min) min = v; if (v > max) max = v; sum += v; n++; }
  return n ? { min, max, mean: sum / n, n } : null;
}

function renderBody(el, b) {
  const g = getGrids()[b];
  if (!g) { el.innerHTML = `<p class="data-sub">The ${BODIES[b].label} grid isn't loaded.</p>`; return; }
  const cols = Object.keys(g.columns);
  if (!cols.includes(varChoice[b])) varChoice[b] = cols[0];
  const v = varChoice[b];
  const src = sourceRow(g.sourceIds[0]);
  const statRows = cols.map((c) => {
    const s = stats(g.columns[c]);
    return `<tr class="${c === v ? 'on' : ''}"><td>${esc(info(c).label)} <span class="data-sub">${esc(c)}</span></td>
      <td class="num">${s ? fmt(c, s.min) : '—'}</td><td class="num">${s ? fmt(c, s.mean) : '—'}</td><td class="num">${s ? fmt(c, s.max) : '—'}</td>
      <td class="num">${s ? s.n.toLocaleString() : 0}</td></tr>`;
  }).join('');
  el.innerHTML = `
    <div class="data-head-row">
      <div><div class="data-kicker">${BODIES[b].label} · 2° GRID</div>
        <div class="data-title">${esc(src ? src.dataset : g.sourceLabel)}</div></div>
      <a class="mini-btn" href="${esc(g.path)}" download>DOWNLOAD CSV</a>
    </div>
    <div class="data-chips">${cols.map((c) => `<button class="chip" data-var="${c}" aria-pressed="${c === v}">${esc(info(c).label)}</button>`).join('')}</div>
    <div class="data-map-wrap">
      <canvas id="data-map" width="${COLS * 4}" height="${ROWS * 4}"></canvas>
      <div class="data-legend"><span id="data-min"></span><div class="data-ramp"></div><span id="data-max"></span></div>
      <div class="data-readout" id="data-readout">Hover the map to read values</div>
    </div>
    <h4>ALL VARIABLES</h4>
    <table class="data-table"><thead><tr><th>Variable</th><th class="num">Min</th><th class="num">Average</th><th class="num">Max</th><th class="num">Cells</th></tr></thead>
      <tbody>${statRows}</tbody></table>
    ${src ? `<h4>HOW IT WAS MADE</h4><p class="data-sub">${esc(src.processing_notes)}</p>
      <p class="data-sub">Original units: ${esc(src.original_units)} · native resolution ${esc(src.resolution)} ·
      downloaded ${esc(src.downloaded_on)} · <a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.url)}</a></p>` : ''}`;
  el.querySelectorAll('[data-var]').forEach((btn) => btn.addEventListener('click', () => { varChoice[b] = btn.dataset.var; renderBody(el, b); }));
  drawMap(g, v);
}

function drawMap(g, c) {
  const canvas = $('data-map'), ctx = canvas.getContext('2d');
  const arr = g.columns[c], s = stats(arr);
  const px = canvas.width / COLS;
  ctx.fillStyle = '#0b0d11';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const span = s && s.max > s.min ? s.max - s.min : 1;
  for (let i = 0; i < ROWS * COLS; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) continue;
    const t = s.max > s.min ? (v - s.min) / span : 0.5;
    const k = Math.min(RAMP.length - 2, Math.floor(t * (RAMP.length - 1)));
    const f = t * (RAMP.length - 1) - k;
    const [r, gr, bl] = RAMP[k].map((x, j) => Math.round(x + (RAMP[k + 1][j] - x) * f));
    ctx.fillStyle = `rgb(${r},${gr},${bl})`;
    ctx.fillRect((i % COLS) * px, Math.floor(i / COLS) * px, px, px);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) { const x = ((lon + 180) / 360) * canvas.width + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
  for (let lat = -90; lat <= 90; lat += 30) { const y = ((90 - lat) / 180) * canvas.height + 0.5; ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
  ctx.stroke();
  $('data-min').textContent = s ? fmt(c, s.min) : '—';
  $('data-max').textContent = s ? fmt(c, s.max) : '—';
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const col = Math.min(COLS - 1, Math.floor(((e.clientX - r.left) / r.width) * COLS));
    const row = Math.min(ROWS - 1, Math.floor(((e.clientY - r.top) / r.height) * ROWS));
    const lat = 90 - (row + 0.5) * RES, lon = -180 + (col + 0.5) * RES;
    $('data-readout').textContent = `${fmtLat(lat)}, ${fmtLon(lon)} · ${info(c).label}: ${fmt(c, arr[row * COLS + col])}`;
  };
  canvas.onmouseleave = () => { $('data-readout').textContent = 'Hover the map to read values'; };
}
