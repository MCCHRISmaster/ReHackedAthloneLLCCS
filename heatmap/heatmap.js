// Temperature Match Grid: reads grid CSVs (data_templates/DATA_FORMAT.md) and colours
// each 2° cell by how close its temperature is to an Earth temperature.

const RES = 2, ROWS = 90, COLS = 180;
const CELL = 6;                                   // canvas px per cell
const M = { left: 44, top: 10, right: 14, bottom: 28 };
const W = M.left + COLS * CELL + M.right, H = M.top + ROWS * CELL + M.bottom;
const STAT_COL = { mean: "temp_mean_c", high: "temp_high_c", low: "temp_low_c" };
const BODIES = ["moon", "mars"];

// 0% red -> orange -> yellow -> light green -> 100% green
const RAMP = [[0, [215, 48, 39]], [0.25, [252, 141, 89]], [0.5, [254, 224, 139]],
              [0.75, [145, 207, 96]], [1, [26, 152, 80]]];

const state = {
  stat: "mean", earthTemp: -15.3, range: 40, opacity: 1, photo: false, lines: true,
  grids: {},   // body -> { mean, high, low: Float32Array (NaN = missing), name }
  photos: {},  // body -> HTMLImageElement
  sites: [],
};

const $ = (id) => document.getElementById(id);
const fmtLat = (v) => `${Math.abs(v)}° ${v >= 0 ? "N" : "S"}`;
const fmtLon = (v) => `${Math.abs(v)}° ${v >= 0 ? "E" : "W"}`;

// ---------- CSV ----------

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  const header = rows.shift().map((h) => h.trim().replace(/^﻿/, ""));
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function gridFromCSV(text, expectBody, name) {
  const rows = parseCSV(text);
  const need = ["body", "lat", "lon", ...Object.values(STAT_COL)];
  const missingCols = need.filter((c) => !(c in (rows[0] || {})));
  if (missingCols.length) throw new Error(`missing columns: ${missingCols.join(", ")}`);

  const g = { name, mean: new Float32Array(ROWS * COLS).fill(NaN) };
  g.high = g.mean.slice(); g.low = g.mean.slice();
  let placed = 0, skipped = 0, otherBody = 0;
  for (const r of rows) {
    if (r.body.toLowerCase() !== expectBody) { otherBody++; continue; }
    const lat = Number(r.lat), lon = Number(r.lon);
    const row = (90 - RES / 2 - lat) / RES, col = (lon + 180 - RES / 2) / RES;
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= ROWS || col < 0 || col >= COLS) {
      skipped++; continue;
    }
    const i = row * COLS + col;
    for (const [k, c] of Object.entries(STAT_COL)) g[k][i] = r[c] === "" ? NaN : Number(r[c]);
    placed++;
  }
  if (!placed) throw new Error(otherBody ? `no rows with body = ${expectBody}` : "no valid grid rows");
  g.note = `${placed.toLocaleString()} of ${(ROWS * COLS).toLocaleString()} cells loaded` +
    (skipped ? `, ${skipped} rows skipped (not a 2° cell centre)` : "") +
    (otherBody ? `, ${otherBody} rows for another body ignored` : "");
  return g;
}

// ---------- Matching and drawing ----------

function matchAt(g, i) {
  const t = g[state.stat][i];
  return Number.isNaN(t) ? NaN : Math.max(0, 1 - Math.abs(t - state.earthTemp) / state.range);
}

function color(t) {
  for (let k = 1; k < RAMP.length; k++) {
    if (t <= RAMP[k][0]) {
      const [t0, c0] = RAMP[k - 1], [t1, c1] = RAMP[k];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function draw(body) {
  const c = $(`${body}-canvas`), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0b0d11";
  ctx.fillRect(M.left, M.top, COLS * CELL, ROWS * CELL);
  if (state.photo && state.photos[body]) ctx.drawImage(state.photos[body], M.left, M.top, COLS * CELL, ROWS * CELL);

  const g = state.grids[body];
  if (g) {
    ctx.globalAlpha = state.opacity;
    for (let i = 0; i < ROWS * COLS; i++) {
      const m = matchAt(g, i);
      const x = M.left + (i % COLS) * CELL, y = M.top + Math.floor(i / COLS) * CELL;
      if (Number.isNaN(m)) {
        if (state.photo) continue;           // let the photo show through missing cells
        ctx.fillStyle = "#3a3f4b";
      } else {
        const [r, gr, b] = color(m);
        ctx.fillStyle = `rgb(${r},${gr},${b})`;
      }
      ctx.fillRect(x, y, CELL, CELL);
    }
    ctx.globalAlpha = 1;
  }

  // Cell grid lines every 2°, stronger lines + labels every 30°
  ctx.lineWidth = 1;
  if (state.lines) {
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    for (let col = 0; col <= COLS; col++) { const x = M.left + col * CELL + 0.5; ctx.moveTo(x, M.top); ctx.lineTo(x, M.top + ROWS * CELL); }
    for (let row = 0; row <= ROWS; row++) { const y = M.top + row * CELL + 0.5; ctx.moveTo(M.left, y); ctx.lineTo(M.left + COLS * CELL, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.fillStyle = "#9097a6";
  ctx.font = "12px system-ui, sans-serif";
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = M.left + ((lon + 180) / 360) * COLS * CELL + 0.5;
    ctx.moveTo(x, M.top); ctx.lineTo(x, M.top + ROWS * CELL);
    ctx.textAlign = "center"; ctx.fillText(lon === 0 ? "0°" : fmtLon(lon), x, H - 10);
  }
  for (let lat = 90; lat >= -90; lat -= 30) {
    const y = M.top + ((90 - lat) / 180) * ROWS * CELL + 0.5;
    ctx.moveTo(M.left, y); ctx.lineTo(M.left + COLS * CELL, y);
    ctx.textAlign = "right"; ctx.fillText(lat === 0 ? "0°" : fmtLat(lat), M.left - 6, y + 4);
  }
  ctx.stroke();
  summarize(body);
}

function summarize(body) {
  const g = state.grids[body], out = $(`${body}-stats`);
  if (!g) { out.textContent = "No data loaded."; return; }
  let best = -1, bestI = -1, area = 0, good = 0;
  for (let i = 0; i < ROWS * COLS; i++) {
    const m = matchAt(g, i);
    if (Number.isNaN(m)) continue;
    const lat = 90 - (Math.floor(i / COLS) + 0.5) * RES;
    const w = Math.cos((lat * Math.PI) / 180);    // cells near the poles cover less area
    area += w;
    if (m >= 0.75) good += w;
    if (m > best) { best = m; bestI = i; }
  }
  if (bestI < 0) { out.textContent = "No temperatures for this statistic."; return; }
  if (best <= 0) {
    out.textContent = `No cell within ${state.range} °C of ${state.earthTemp} °C. Widen the range or compare highs/lows.`;
    return;
  }
  const lat = 90 - (Math.floor(bestI / COLS) + 0.5) * RES, lon = -180 + ((bestI % COLS) + 0.5) * RES;
  out.innerHTML = `Best <b>${Math.round(best * 100)}%</b> at ${fmtLat(lat)}, ${fmtLon(lon)} ` +
    `(${g[state.stat][bestI].toFixed(1)} °C) · <b>${((good / area) * 100).toFixed(1)}%</b> of surface ≥ 75%`;
}

function redraw() { BODIES.forEach(draw); }

function hover(body, ev) {
  const c = $(`${body}-canvas`), r = c.getBoundingClientRect();
  const x = ((ev.clientX - r.left) / r.width) * W - M.left, y = ((ev.clientY - r.top) / r.height) * H - M.top;
  const col = Math.floor(x / CELL), row = Math.floor(y / CELL);
  const out = $(`${body}-readout`), g = state.grids[body];
  if (!g || col < 0 || col >= COLS || row < 0 || row >= ROWS) { out.textContent = ""; return; }
  const i = row * COLS + col, t = g[state.stat][i], m = matchAt(g, i);
  const lat = 90 - (row + 0.5) * RES, lon = -180 + (col + 0.5) * RES;
  out.textContent = `${fmtLat(lat)}, ${fmtLon(lon)} · ` +
    (Number.isNaN(t) ? "no data" : `${t.toFixed(1)} °C · ${Math.round(m * 100)}% match`);
}

// ---------- Loading ----------

async function loadGridText(body, text, name) {
  const info = $(`${body}-info`);
  try {
    state.grids[body] = gridFromCSV(text, body, name);
    info.className = "info";
    info.textContent = `${name}: ${state.grids[body].note}`;
  } catch (err) {
    info.className = "info err";
    info.textContent = `${name}: ${err.message}`;
  }
  draw(body);
}

function loadSites(text) {
  state.sites = parseCSV(text).filter((s) => (s.body || "").toLowerCase() === "earth");
  const sel = $("site");
  sel.length = 1;
  for (const s of state.sites) sel.add(new Option(`${s.name} (${s.lat}, ${s.lon})`, s.site_id));
}

function applySite() {
  const s = state.sites.find((x) => x.site_id === $("site").value);
  if (!s) return;
  const v = s[STAT_COL[state.stat]];
  if (v !== "" && v != null) { state.earthTemp = Number(v); $("earth-temp").value = v; }
}

function readFile(input, cb) {
  input.addEventListener("change", () => {
    const f = input.files[0];
    if (f) f.text().then((t) => cb(t, f.name));
  });
}

function wire() {
  $("site").addEventListener("change", () => { applySite(); redraw(); });
  $("stat").addEventListener("change", (e) => { state.stat = e.target.value; applySite(); redraw(); });
  $("earth-temp").addEventListener("input", (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) { state.earthTemp = v; $("site").value = ""; redraw(); }
  });
  $("range").addEventListener("input", (e) => { state.range = Number(e.target.value); $("range-val").textContent = state.range; redraw(); });
  $("opacity").addEventListener("input", (e) => { state.opacity = Number(e.target.value) / 100; redraw(); });
  $("photo").addEventListener("change", (e) => { state.photo = e.target.checked; redraw(); });
  $("lines").addEventListener("change", (e) => { state.lines = e.target.checked; redraw(); });
  readFile($("sites-file"), (t) => { loadSites(t); applySite(); redraw(); });

  for (const body of BODIES) {
    const c = $(`${body}-canvas`), card = c.closest(".card");
    c.width = W; c.height = H;
    c.addEventListener("mousemove", (ev) => hover(body, ev));
    c.addEventListener("mouseleave", () => ($(`${body}-readout`).textContent = ""));
    readFile($(`${body}-file`), (t, n) => loadGridText(body, t, n));
    // Drag a CSV onto a map to load it
    card.addEventListener("dragover", (ev) => { ev.preventDefault(); card.classList.add("drop"); });
    card.addEventListener("dragleave", () => card.classList.remove("drop"));
    card.addEventListener("drop", (ev) => {
      ev.preventDefault(); card.classList.remove("drop");
      const f = ev.dataTransfer.files[0];
      if (f) f.text().then((t) => loadGridText(body, t, f.name));
    });
    const img = new Image();
    img.onload = () => { state.photos[body] = img; if (state.photo) draw(body); };
    img.src = `../prototype/assets/${body}.jpg`;
  }
}

async function init() {
  wire();
  redraw();
  // Load the sample files automatically when served over http (file:// blocks fetch).
  try {
    const t = await (await fetch("../data_templates/sites_template.csv")).text();
    loadSites(t);
    $("site").value = "haughton_crater";
    applySite();
  } catch { /* use the custom temperature */ }
  for (const body of BODIES) {
    const name = `samples/${body}_grid_sample.csv`;
    try {
      const res = await fetch(name);
      if (!res.ok) throw new Error(res.status);
      await loadGridText(body, await res.text(), name);
    } catch {
      $(`${body}-info`).textContent = "Choose a CSV file or drag one onto this map.";
    }
  }
}

init();
