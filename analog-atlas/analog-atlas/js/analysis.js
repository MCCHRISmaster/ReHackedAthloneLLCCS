/**
 * Point analysis: measure a location on any body and score how well it
 * matches the Moon and Mars.
 *
 * DATA STATUS: placeholders. No real dataset is wired in yet. Each metric in
 * config.js → METRICS lists the NASA product planned for it. To plug one in,
 * call registerGrid(body, metricKey, grid) with an equirectangular grid:
 *
 *   { values: number[][] }   row 0 = north edge, col 0 = 180°W, any resolution
 *                            (null / NaN cells fall back to the simulation)
 *
 * That is the same layout as the team prototype's temperature grids, so e.g.
 * prototype/grids/moon.json `high` can go straight in as registerGrid('moon',
 * 'tempHigh', { values: json.high }).
 *
 * Until then, with SIMULATE_MISSING_DATA on, values come from a deterministic
 * noise model with roughly plausible ranges per body. Results built on it are
 * flagged `simulated` and the UI marks them "SIM". They mean nothing yet.
 */
/* global WorldWind */
import { BODIES, METRICS, SCALES, SIMULATE_MISSING_DATA, MATCH_SEARCH_STEP_DEG } from './config.js';

/** A probe on one body is compared with every other body. */
export const targetsFor = (bodyId) => Object.values(BODIES).filter((b) => b.enabled && b.id !== bodyId).map((b) => b.id);

/* ------------------------------ Earth land mask ------------------------------ */
// Best matches on Earth must be on land. Built once from the bundled Blue Marble
// (topo + bathymetry: oceans are blue). Replace with a real land/sea grid later.
let landMask = null; // { w, h, data: Uint8Array } 1 = land

export function loadLandMask() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = 360, h = 180;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      const data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const r = px[i * 4], gr = px[i * 4 + 1], b = px[i * 4 + 2];
        const ocean = b > r * 1.25 && b > gr * 0.9 && r < 120;
        data[i] = ocean ? 0 : 1;
      }
      landMask = { w, h, data };
      matchCache.forEach((_, k) => { if (k.startsWith('earth|')) matchCache.delete(k); });
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = WorldWind.configuration.baseUrl + 'images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg';
  });
}

export function isLand(lat, lon) {
  if (!landMask) return true;
  const { w, h, data } = landMask;
  const x = Math.min(w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * w)));
  const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
  return data[y * w + x] === 1;
}

/* ---------------------------- real-data hook ---------------------------- */
const grids = {}; // bodyId -> metricKey -> { values, rows, cols }

export function registerGrid(bodyId, key, grid) {
  const values = grid.values;
  (grids[bodyId] ||= {})[key] = { values, rows: values.length, cols: values[0].length };
  matchCache.clear();
}

function sampleGrid(g, lat, lon) {
  const r = Math.min(g.rows - 1, Math.max(0, Math.floor(((90 - lat) / 180) * g.rows)));
  const c = ((Math.floor(((lon + 180) / 360) * g.cols) % g.cols) + g.cols) % g.cols;
  const v = g.values[r][c];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ------------------------- simulation (placeholder) ------------------------- */
function hash(ix, iy, iz, seed) {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** 3-D value noise on the unit sphere (no seam at the date line), 0..1. */
function vnoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const h = (a, b, c) => hash(ix + a, iy + b, iz + c, seed);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}
function fbm(p, freq, seed, octaves = 3) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(p[0] * freq, p[1] * freq, p[2] * freq, seed + o * 101);
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}
const seedOf = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) | 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Per-body placeholder fields. c.n(freq) = smooth regional noise 0..1,
 * c.d() = fine detail noise (~0.15° features, averages out at rover scale).
 */
const SIM = {
  earth: {
    tempHigh: (c) => -18 + 52 * c.cosLat + 16 * (c.n(3) - 0.5) + 4 * (c.d() - 0.5),
    tempLow:  (c) => -45 + 55 * c.cosLat + 14 * (c.n(3) - 0.5),
    slope:    (c) => 16 * c.n(6) ** 2 + 8 * c.d(),
    rocks:    (c) => clamp(30 * c.n(7) * (0.4 + c.d()), 0, 60),
    fines:    (c) => clamp(70 * c.n(4) + 15 * (c.d() - 0.5), 0, 100),
    albedo:   (c) => 0.12 + 0.25 * c.n(4) + 0.4 * Math.max(0, Math.abs(c.lat) - 60) / 30,
    water:    (c) => 32 * c.n(3) ** 1.5,
  },
  moon: {
    tempHigh: (c) => -70 + 190 * Math.sqrt(c.cosLat) + 20 * (c.n(5) - 0.5),
    tempLow:  (c) => -185 + 25 * c.cosLat + 14 * (c.n(5) - 0.5),
    slope:    (c) => 4 + 22 * c.n(5) ** 2 + 8 * c.d(),
    rocks:    (c) => clamp(12 * c.n(8) ** 2 * (0.3 + 1.4 * c.d()), 0, 40),
    fines:    (c) => clamp(80 + 15 * (c.n(4) - 0.5) - 10 * c.d(), 0, 100),
    albedo:   (c) => 0.07 + 0.12 * c.n(3),
    water:    (c) => (Math.abs(c.lat) > 75 ? ((Math.abs(c.lat) - 75) / 15) * 6 * c.n(8) : 0.05 * c.n(8)),
  },
  mars: {
    tempHigh: (c) => -95 + 112 * c.cosLat ** 0.6 + 14 * (c.n(4) - 0.5),
    tempLow:  (c) => Math.max(-125, -135 + 55 * c.cosLat + 12 * (c.n(4) - 0.5)),
    slope:    (c) => 14 * c.n(5) ** 2 + 7 * c.d(),
    rocks:    (c) => clamp(22 * c.n(6) * (0.4 + c.d()), 0, 50),
    fines:    (c) => clamp(65 + 30 * (c.n(4) - 0.5) - 10 * c.d(), 0, 100),
    albedo:   (c) => 0.12 + 0.18 * c.n(3),
    water:    (c) => (Math.abs(c.lat) > 50 ? ((Math.abs(c.lat) - 50) / 40) * 35 * c.n(4) + 2 : 4 * c.n(4)),
  },
};

function simulate(bodyId, key, lat, lon) {
  const f = SIM[bodyId] && SIM[bodyId][key];
  if (!f) return null;
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  const p = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const seed = seedOf(bodyId + key);
  return f({
    lat, lon, cosLat: Math.cos(la),
    n: (freq) => fbm(p, freq, seed),
    d: () => fbm(p, 380, seed ^ 0x5bd1e995, 2),
  });
}

/* ------------------------------ measurement ------------------------------ */
/** Sample points: centre + a ring at 60 % of the scale radius. */
function samplePoints(bodyId, lat, lon, scaleId) {
  const rDeg = ((SCALES[scaleId].radiusM / BODIES[bodyId].radiusM) * 180) / Math.PI * 0.6;
  const pts = [[lat, lon]];
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    pts.push([clamp(lat + rDeg * Math.sin(a), -90, 90), lon + (rDeg * Math.cos(a)) / cos]);
  }
  return pts;
}

/**
 * Measure all metrics around a point at a scale.
 * Returns { values: {key: number|null}, simulated: {key: bool} }.
 */
export function measure(bodyId, lat, lon, scaleId, { fast = false } = {}) {
  const pts = fast ? [[lat, lon]] : samplePoints(bodyId, lat, lon, scaleId);
  const values = {}, simulated = {};
  METRICS.forEach((m) => {
    if (m.key === 'relief') return; // derived below
    const g = grids[bodyId] && grids[bodyId][m.key];
    let sum = 0, n = 0, sim = false;
    pts.forEach(([a, b]) => {
      let v = g ? sampleGrid(g, a, b) : null;
      if (v === null && SIMULATE_MISSING_DATA) { v = simulate(bodyId, m.key, a, b); sim = true; }
      if (v !== null) { sum += v; n++; }
    });
    values[m.key] = n ? sum / n : null;
    simulated[m.key] = sim;
  });
  // Relief across the operating area: grows with slope and with the scale radius.
  const g = grids[bodyId] && grids[bodyId].relief;
  const real = g ? sampleGrid(g, lat, lon) : null;
  values.relief = real ?? (values.slope === null ? null
    : Math.tan((values.slope * Math.PI) / 180) * SCALES[scaleId].radiusM * 0.35);
  simulated.relief = real === null;
  return { values, simulated };
}

/* ------------------------------- scoring ------------------------------- */
const rangeOf = (m, scaleId) => (typeof m.range === 'object' ? m.range[scaleId] : m.range);

/** Weighted similarity of two measurements. score and parts are 0..1. */
export function compare(a, b, scaleId) {
  let sum = 0, wsum = 0;
  const parts = {};
  METRICS.forEach((m) => {
    const x = a[m.key], y = b[m.key];
    if (x == null || y == null) { parts[m.key] = null; return; }
    const s = Math.max(0, 1 - Math.abs(x - y) / rangeOf(m, scaleId));
    const w = m.weight[scaleId] ?? 1;
    parts[m.key] = s; sum += s * w; wsum += w;
  });
  return { score: wsum ? sum / wsum : 0, parts };
}

const matchCache = new Map(); // `${body}|${scale}` -> [{lat, lon, values}]

function candidates(bodyId, scaleId) {
  const k = `${bodyId}|${scaleId}`;
  if (matchCache.has(k)) return matchCache.get(k);
  const step = MATCH_SEARCH_STEP_DEG, list = [];
  for (let lat = -90 + step / 2; lat < 90; lat += step) {
    for (let lon = -180 + step / 2; lon < 180; lon += step) {
      if (bodyId === 'earth' && !isLand(lat, lon)) continue;
      // centre sample only: the coarse grid is far wider than either scale's radius
      list.push({ lat, lon, values: measure(bodyId, lat, lon, scaleId, { fast: true }).values });
    }
  }
  matchCache.set(k, list);
  return list;
}

/** Build the search grids during idle time so the first probe is instant. */
export function warmUp() {
  const jobs = [];
  Object.keys(SCALES).forEach((s) => Object.keys(BODIES).forEach((t) => jobs.push([t, s])));
  const next = () => {
    const j = jobs.shift();
    if (!j) return;
    candidates(j[0], j[1]);
    (window.requestIdleCallback || setTimeout)(next);
  };
  (window.requestIdleCallback || setTimeout)(next);
}

/** Best-matching location on a target body for a measurement. */
export function bestMatch(values, targetId, scaleId) {
  let best = null;
  candidates(targetId, scaleId).forEach((c) => {
    const r = compare(values, c.values, scaleId);
    if (!best || r.score > best.score) best = { lat: c.lat, lon: c.lon, values: c.values, ...r };
  });
  return best;
}

/**
 * Full analysis of a probe point, compared with every other body.
 * → { body, lat, lon, scale, values, simulated, anySimulated, onLand,
 *     matches: { [otherBodyId]: { lat, lon, score, parts, values } } }
 */
export function analysePoint(bodyId, lat, lon, scaleId) {
  const here = measure(bodyId, lat, lon, scaleId);
  const matches = {};
  targetsFor(bodyId).forEach((t) => { matches[t] = bestMatch(here.values, t, scaleId); });
  return {
    body: bodyId, lat, lon, scale: scaleId, ...here, matches,
    onLand: bodyId !== 'earth' || isLand(lat, lon),
    anySimulated: Object.values(here.simulated).some(Boolean),
  };
}
