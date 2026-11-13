// Analog Finder prototype: pick a point on Earth, compare its surface temperature
// to Moon and Mars temperature grids, and draw a match-percentage heat map.

const POWER_URL = "https://power.larc.nasa.gov/api/temporal/climatology/point";

// Heat map colour ramp (0% -> 100%): transparent, then purple, magenta, orange, pale yellow.
const RAMP = [
  [0.0, [0, 0, 4, 0]],
  [0.25, [59, 15, 112, 140]],
  [0.5, [182, 54, 121, 190]],
  [0.75, [251, 136, 97, 225]],
  [1.0, [252, 253, 191, 245]],
];

const state = {
  earth: null,          // { lat, lon, mean, high, low }
  mode: "mean",         // which Earth value to compare
  scale: 40,            // °C difference that counts as 0% match
  opacity: 0.85,
  images: {},
  grids: {},
  match: {},            // body -> Float32Array of match fractions
};

const $ = (id) => document.getElementById(id);
const fmtC = (v) => (v == null || Number.isNaN(v) ? "–" : `${v.toFixed(1)} °C`);
const fmtLat = (lat) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon) => `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Mouse position on a 2:1 equirectangular canvas -> lat/lon.
function eventToLatLon(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  const x = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 0.999999);
  const y = Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 0.999999);
  return { lat: 90 - y * 180, lon: x * 360 - 180 };
}

function gridIndex(grid, lat, lon) {
  const row = Math.min(grid.rows - 1, Math.floor((90 - lat) / grid.res_deg));
  const col = Math.min(grid.cols - 1, Math.floor((lon + 180) / grid.res_deg));
  return row * grid.cols + col;
}

function rampColor(t) {
  for (let i = 1; i < RAMP.length; i++) {
    const [t1, c1] = RAMP[i];
    if (t <= t1) {
      const [t0, c0] = RAMP[i - 1];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, k) => v + (c1[k] - v) * f);
    }
  }
  return RAMP[RAMP.length - 1][1];
}

// ---------- Earth ----------

function drawEarth(hover) {
  const c = $("earth-map");
  const ctx = c.getContext("2d");
  ctx.drawImage(state.images.earth, 0, 0, c.width, c.height);
  const toXY = (p) => [((p.lon + 180) / 360) * c.width, ((90 - p.lat) / 180) * c.height];

  if (hover) {
    const [x, y] = toXY(hover);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, c.height);
    ctx.moveTo(0, y); ctx.lineTo(c.width, y);
    ctx.stroke();
  }
  if (state.earth) {
    const [x, y] = toXY(state.earth);
    ctx.fillStyle = "#fb8861";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

async function fetchEarthTemps(lat, lon) {
  const url = `${POWER_URL}?parameters=TS,TS_MAX,TS_MIN&community=RE` +
    `&latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&format=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA POWER returned ${res.status}`);
  const p = (await res.json()).properties.parameter;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const avg = (param) => {
    const vals = months.map((m) => p[param][m]).filter((v) => v != null && v > -900);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
  };
  const mean = p.TS.ANN > -900 ? p.TS.ANN : avg("TS");
  return { mean, high: avg("TS_MAX"), low: avg("TS_MIN") };
}

async function selectPoint(lat, lon) {
  const status = $("status");
  status.className = "status";
  status.textContent = "Fetching temperature from NASA POWER…";
  $("sel-coord").textContent = `${fmtLat(lat)}, ${fmtLon(lon)}`;
  try {
    const t = await fetchEarthTemps(lat, lon);
    if (Number.isNaN(t.mean)) throw new Error("No data for this point");
    state.earth = { lat, lon, ...t };
    $("t-mean").textContent = fmtC(t.mean);
    $("t-high").textContent = fmtC(t.high);
    $("t-low").textContent = fmtC(t.low);
    status.textContent = "Ground-surface temperature, 2001–2025 average";
    drawEarth();
    recompute();
  } catch (err) {
    status.className = "status err";
    status.textContent = `Couldn't get data: ${err.message}`;
  }
}

// ---------- Moon / Mars ----------

// Match fraction per grid cell: 1 when equal, 0 at `scale` °C difference or more.
// Each body is compared to the same statistic (average to average, high to high).
function computeMatch(grid) {
  const target = state.earth[state.mode];
  const vals = grid[state.mode];
  const out = new Float32Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    out[i] = Math.max(0, 1 - Math.abs(vals[i] - target) / state.scale);
  }
  return out;
}

function drawBody(body) {
  const c = $(`${body}-map`);
  const ctx = c.getContext("2d");
  ctx.globalAlpha = 1;
  ctx.drawImage(state.images[body], 0, 0, c.width, c.height);
  const match = state.match[body];
  if (!match) return;

  const g = state.grids[body];
  const off = document.createElement("canvas");
  off.width = g.cols;
  off.height = g.rows;
  const octx = off.getContext("2d");
  const img = octx.createImageData(g.cols, g.rows);
  for (let i = 0; i < match.length; i++) {
    const [r, gr, b, a] = rampColor(match[i]);
    img.data.set([r, gr, b, a], i * 4);
  }
  octx.putImageData(img, 0, 0);
  ctx.globalAlpha = state.opacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, 0, 0, c.width, c.height);
  ctx.globalAlpha = 1;
}

function summarize(body) {
  const g = state.grids[body];
  const match = state.match[body];
  let best = -1, bestI = 0, area = 0, areaGood = 0;
  for (let i = 0; i < match.length; i++) {
    const row = Math.floor(i / g.cols);
    const lat = 90 - (row + 0.5) * g.res_deg;
    const w = Math.cos((lat * Math.PI) / 180);    // cells shrink toward the poles
    area += w;
    if (match[i] >= 0.75) areaGood += w;
    if (match[i] > best) { best = match[i]; bestI = i; }
  }
  const row = Math.floor(bestI / g.cols), col = bestI % g.cols;
  const lat = 90 - (row + 0.5) * g.res_deg, lon = -180 + (col + 0.5) * g.res_deg;
  const label = { mean: "average", high: "daily high", low: "daily low" }[state.mode];
  $(`${body}-stats`).innerHTML = best <= 0
    ? `No area within ${state.scale} °C of Earth's ${label}. Try a wider match range or another statistic.`
    : `Best match <b>${Math.round(best * 100)}%</b> near ${fmtLat(lat)}, ${fmtLon(lon)} ` +
      `(${fmtC(g[state.mode][bestI])}). <b>${((areaGood / area) * 100).toFixed(1)}%</b> of the surface is a ≥75% match.`;
}

function recompute() {
  if (!state.earth) return;
  for (const body of ["moon", "mars"]) {
    state.match[body] = computeMatch(state.grids[body]);
    drawBody(body);
    summarize(body);
  }
}

function hoverBody(body, ev) {
  const g = state.grids[body];
  const { lat, lon } = eventToLatLon($(`${body}-map`), ev);
  const i = gridIndex(g, lat, lon);
  const label = { mean: "avg", high: "high", low: "low" }[state.mode];
  let text = `${fmtLat(lat)}, ${fmtLon(lon)} · ${label} ${fmtC(g[state.mode][i])}`;
  if (state.match[body]) text += ` · ${Math.round(state.match[body][i] * 100)}% match`;
  $(`${body}-hover`).textContent = text;
}

// ---------- Wiring ----------

function wire() {
  const earth = $("earth-map");
  earth.addEventListener("mousemove", (ev) => {
    const p = eventToLatLon(earth, ev);
    $("earth-hover").textContent = `${fmtLat(p.lat)}, ${fmtLon(p.lon)} · click to compare`;
    drawEarth(p);
  });
  earth.addEventListener("mouseleave", () => drawEarth());
  earth.addEventListener("click", (ev) => {
    const p = eventToLatLon(earth, ev);
    selectPoint(p.lat, p.lon);
  });

  for (const body of ["moon", "mars"]) {
    const c = $(`${body}-map`);
    c.addEventListener("mousemove", (ev) => hoverBody(body, ev));
    c.addEventListener("mouseleave", () => ($(`${body}-hover`).textContent = ""));
  }

  $("mode").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    state.mode = btn.dataset.mode;
    document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b === btn));
    recompute();
  });
  $("scale").addEventListener("input", (ev) => {
    state.scale = Number(ev.target.value);
    $("scale-val").textContent = state.scale;
    recompute();
  });
  $("opacity").addEventListener("input", (ev) => {
    state.opacity = Number(ev.target.value) / 100;
    if (state.earth) ["moon", "mars"].forEach(drawBody);
  });
}

async function init() {
  try {
    const [earth, moon, mars, moonGrid, marsGrid] = await Promise.all([
      loadImage("assets/earth.jpg"),
      loadImage("assets/moon.jpg"),
      loadImage("assets/mars.jpg"),
      fetch("grids/moon.json").then((r) => r.json()),
      fetch("grids/mars.json").then((r) => r.json()),
    ]);
    state.images = { earth, moon, mars };
    state.grids = { moon: moonGrid, mars: marsGrid };
  } catch (err) {
    $("status").className = "status err";
    $("status").textContent =
      "Couldn't load maps or grids. Start the local server (node server.js) and open http://localhost:8000, then reload.";
    console.error(err);
    return;
  }
  drawEarth();
  drawBody("moon");
  drawBody("mars");
  wire();
}

init();
