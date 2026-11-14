/**
 * Analog Atlas similarity scoring. Pure ES module, no dependencies, runs in the browser and in Node.
 * It mirrors pipeline/score_core.py line for line; pipeline/70_validate.py checks they agree.
 *
 * Per comparison:  match = max(0, 1 - |earth - target| / range)
 * Per dimension:   dim score = mean of the available matches; coverage = available / total
 * Overall:         sum(w_d * dim_d) / sum(w_d) over dimensions that have data
 *
 * Usage:
 *   import { createScorer } from './score.js';
 *   const scorer = createScorer({ features, presets, caveats }, ranges);   // the config JSON files
 *   const earth  = scorer.refFromTable(earthTable, earthTable.index(53.42, -7.91));
 *   const target = scorer.refFromTable(marsTable, marsTable.index(18.38, 77.58));
 *   const result = scorer.scorePair(earth, target, 'mars', 'raw');          // overall, dims, losses ...
 *   const heat   = scorer.scoreGrid(earth, marsTable, 'mars', 'crewed');    // Float32Array over Mars cells
 *   const rank   = scorer.scoreGridReverse(target, earthTable, 'mars', 'rover');   // over Earth cells
 *
 * A "table" is { n, res, lat: Float32Array, lon: Float32Array, cols: {name: Float32Array}, text: {name: []},
 *               index(lat, lon) } as produced by features.js. A "ref" is { get(col), lat, lon }.
 */

export const DIMS = ['terrain', 'geology', 'thermal', 'water', 'dust', 'subsurface', 'habitability', 'operations'];
export const PRESET_IDS = ['raw', 'crewed', 'base', 'rover'];

const clip01 = (x) => Math.min(1, Math.max(0, x));

export function createScorer(config, ranges = {}) {
  const comparisons = config.features.comparisons;
  const presets = config.presets.presets;
  const caveats = config.caveats;
  const nC = comparisons.length;
  const minAvailable = config.features.min_available ?? 0;
  const dimIdx = {};                                   // dimension -> indexes of comparisons that count in it
  for (const d of DIMS) dimIdx[d] = comparisons.map((c, k) => (c.dimensions.includes(d) ? k : -1)).filter((k) => k >= 0);

  /** Evaluate one value spec. Missing columns give NaN. Same semantics as score_core.eval_spec. */
  function evalSpec(spec, get, lat, body) {
    const col = (name) => { const v = get(name); return v === undefined || v === null ? NaN : v; };
    const op = spec.op;
    if (op === 'skip') return NaN;
    if (op === 'const') return spec.value;
    if (op === 'abslat') return Math.abs(lat) / (spec.div ?? 1);
    let v;
    if (op === 'col') {
      v = col(spec.col);
      if (spec.fallback !== undefined && Number.isNaN(v)) v = col(spec.fallback);
    } else if (op === 'sum') {
      v = 0; for (const c of spec.cols) v += col(c);
    } else if (op === 'diff') {
      v = col(spec.cols[0]) - col(spec.cols[1]);
    } else if (op === 'oneminus') {
      v = 1 - col(spec.col) / (spec.div ?? 1);
    } else throw new Error(`unknown op ${op}`);
    if (spec.div !== undefined && (op === 'col' || op === 'sum')) v = v / spec.div;
    if (spec.times_scaled) { const [c2, lo, hi] = spec.times_scaled; v = v * clip01((col(c2) - lo) / (hi - lo)); }
    if (spec.cap !== undefined) v = Math.min(v, spec.cap);
    if (spec.log10) v = v > 0 ? Math.log10(v) : NaN;
    if (spec.scale === 'body_range') { const r = ranges[body]?.[spec.col]; v = r ? Math.min(1, v / r) : NaN; }
    return v;
  }

  /** Values of every comparison for one side at one place. */
  function evalSide(side, get, lat) {
    const out = new Float64Array(nC);
    for (let k = 0; k < nC; k++) out[k] = evalSpec(comparisons[k][side], get, lat, side);
    return out;
  }

  function matches(E, T) {
    const m = new Float64Array(nC);
    for (let k = 0; k < nC; k++) {
      const e = E[k], t = T[k];
      m[k] = Number.isNaN(e) || Number.isNaN(t) ? NaN : Math.max(0, 1 - Math.abs(e - t) / comparisons[k].range);
    }
    return m;
  }

  function weightsOf(presetId) {
    const w = presets[presetId]?.weights;
    if (!w) throw new Error(`unknown preset ${presetId}`);
    return DIMS.map((d) => w[d] ?? 0);
  }

  /** Dimension scores, coverage and overall from per-comparison matches. */
  function aggregate(m, w) {
    const dim = new Float64Array(DIMS.length), cov = new Float64Array(DIMS.length);
    let num = 0, den = 0;
    for (let j = 0; j < DIMS.length; j++) {
      const ids = dimIdx[DIMS[j]];
      let sum = 0, cnt = 0;
      for (const k of ids) if (!Number.isNaN(m[k])) { sum += m[k]; cnt++; }
      dim[j] = cnt > 0 ? sum / cnt : NaN;
      cov[j] = ids.length ? cnt / ids.length : 0;
      if (cnt > 0) { num += w[j] * dim[j]; den += w[j]; }
    }
    let nAvail = 0; for (let k = 0; k < nC; k++) if (!Number.isNaN(m[k])) nAvail++;
    return { dim, cov, overall: den > 0 && nAvail >= minAvailable ? num / den : NaN };
  }

  const fmt = (v, digits) => v.toFixed(digits);

  /** Score one Earth place against one target, with the explanation. */
  function scorePair(earth, target, body, presetId, { top = 3 } = {}) {
    const E = evalSide('earth', earth.get, earth.lat);
    const T = evalSide(body, target.get, target.lat);
    const m = matches(E, T);
    const w = weightsOf(presetId);
    const { dim, cov, overall } = aggregate(m, w);
    const avail = DIMS.map((d) => dimIdx[d].filter((k) => !Number.isNaN(m[k])).length);
    let W = 0; DIMS.forEach((d, j) => { if (avail[j] > 0) W += w[j]; });
    const losses = [], skipped = [];
    for (let k = 0; k < nC; k++) {
      const c = comparisons[k];
      if (Number.isNaN(m[k])) { skipped.push(c.id); continue; }
      let pts = 0;
      DIMS.forEach((d, j) => { if (c.dimensions.includes(d) && avail[j] > 0 && W > 0) pts += (w[j] / W) * (1 - m[k]) / avail[j] * 100; });
      const sh = c.earth_show;
      const showV = sh ? earth.get(sh.col) : undefined;
      const eTxt = sh && showV !== undefined && !Number.isNaN(showV) ? fmt(showV, sh.digits) + sh.unit : fmt(E[k], c.digits) + c.unit;
      const tTxt = c.target_show || fmt(T[k], c.digits) + c.unit;
      losses.push({ id: c.id, label: c.label, points: Math.round(pts * 100) / 100, match: Math.round(m[k] * 1000) / 1000,
        earth: eTxt, target: tTxt, text: `${c.label} is ${eTxt} here but ${tTxt} on the target.` });
    }
    losses.sort((a, b) => b.points - a.points);
    const dims = {}, coverage = {};
    DIMS.forEach((d, j) => { dims[d] = dim[j]; coverage[d] = cov[j]; });
    const matchById = {}; comparisons.forEach((c, k) => { matchById[c.id] = m[k]; });
    return { overall, dims, coverage, matches: matchById, losses: losses.slice(0, top), allLosses: losses, skipped,
      caveats: caveats[body] || [], preset: presetId };
  }

  /** Overall score of one Earth place against every cell of a Moon or Mars table. Float32Array(table.n). */
  function scoreGrid(earth, table, body, presetId) {
    const E = evalSide('earth', earth.get, earth.lat);
    const w = weightsOf(presetId);
    const out = new Float32Array(table.n);
    const cols = table.cols;
    for (let i = 0; i < table.n; i++) {
      const T = evalSide(body, (c) => cols[c]?.[i], table.lat[i]);
      out[i] = aggregate(matches(E, T), w).overall;
    }
    return out;
  }

  /** Overall score of every cell of an Earth table against one Moon or Mars target. Float32Array(table.n). */
  function scoreGridReverse(target, table, body, presetId) {
    const T = evalSide(body, target.get, target.lat);
    const w = weightsOf(presetId);
    const out = new Float32Array(table.n);
    const cols = table.cols;
    for (let i = 0; i < table.n; i++) {
      const E = evalSide('earth', (c) => cols[c]?.[i], table.lat[i]);
      out[i] = aggregate(matches(E, T), w).overall;
    }
    return out;
  }

  function refFromTable(table, i, overrides = {}) {
    return { lat: table.lat[i], lon: table.lon[i], get: (c) => (c in overrides ? overrides[c] : table.cols[c]?.[i]) };
  }

  return { presets, comparisons, dims: DIMS, caveats, evalSide, scorePair, scoreGrid, scoreGridReverse, refFromTable };
}
