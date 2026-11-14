/**
 * Location-match HUD (whiteboard layout):
 *   top centre   LOCATION MATCH bar: overall % for each other world
 *   left         compare chips + minimap cards of the OTHER worlds (heat map + best pin)
 *   bottom left  ADVANCED options
 *   right        match card for one target world (◁ ▷), simple scores, Here vs There,
 *                rover and human development sections
 * Pure DOM; main.js passes in state + results from match.js.
 */
import { BODIES } from './config.js';
import { mapHTML, mapXY } from './planet-art.js';
import { MATCH_METRICS, renderScoreCanvas } from './match.js';
import { matchColor } from './temperature.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const name = (b) => ({ earth: 'Earth', moon: 'Moon', mars: 'Mars' }[b] || b);
const pct = (v) => (v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);
const fmtC = (v) => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(1)}°C`);
const fmtLat = (v) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? 'E' : 'W'}`;
export function fmtP(v) {
  if (v == null || Number.isNaN(v)) return '—';
  if (v < 0.5) return '0 Pa (vacuum)';
  return v >= 1000 ? `${(v / 1000).toFixed(1)} kPa` : `${Math.round(v)} Pa`;
}
const STAT_LABEL = { mean: 'AVG', high: 'HIGH', low: 'LOW' };
const scoreClass = (v) => (Number.isNaN(v) ? '' : v >= 0.75 ? 'good' : v >= 0.4 ? 'mid' : 'poor');

/* ---------------- top centre ---------------- */

export function renderMatchBar(m, { onPick }) {
  const el = $('match-bar');
  if (!m.ref && !m.loading) {
    el.innerHTML = '<span class="mb-title">LOCATION MATCH</span><span class="mb-hint">Click any location to compare worlds</span>';
    return;
  }
  const chips = m.targets.map((t) => {
    const r = m.results[t];
    const v = r && r.best ? r.best.overall : NaN;
    return `<button class="mb-chip ${scoreClass(v)}" data-target="${t}" title="Open the ${name(t)} match">
        <span class="mb-body">${BODIES[t].label}</span><span class="mb-pct">${m.loading ? '…' : pct(v)}</span></button>`;
  }).join('');
  el.innerHTML = `<span class="mb-title">LOCATION MATCH</span>${chips}`;
  el.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.target)));
}

/* ---------------- left column ---------------- */

/**
 * m = { current, ref, loading, error, metric, results, online, refBody, gridsReady }
 * h = { onMetric(key), onPickMap(body), onClear() }
 */
export function renderLeft(m, h) {
  const el = $('match-left');
  let refHtml;
  if (m.loading) refHtml = '<div class="ml-hint">Fetching temperature and pressure from NASA POWER…</div>';
  else if (m.error) refHtml = `<div class="ml-hint err">${esc(m.error)}</div>`;
  else if (!m.ref) refHtml = '<div class="ml-hint">Click anywhere on the globe (or a site marker) to pick a location. The other worlds light up with how well they match it.</div>';
  else {
    const r = m.ref;
    refHtml = `<div class="ml-ref">
        <div class="ml-ref-kicker">${BODIES[r.body].label} · YOUR LOCATION</div>
        <div class="ml-ref-name">${esc(r.label)}</div>
        <div class="ml-ref-sub">${fmtLat(r.lat)} · ${fmtLon(r.lon)}</div>
        <div class="ml-ref-vals"><span>${STAT_LABEL[m.stat]} <b>${fmtC(r[m.stat])}</b></span><span>PRESS <b>${fmtP(r.pressure)}</b></span></div>
        <button class="ml-clear" aria-label="Clear location" title="Clear location">✕</button>
      </div>`;
  }
  const chips = Object.entries(MATCH_METRICS).map(([k, d]) =>
    `<button class="chip" data-metric="${k}" aria-pressed="${k === m.metric}">${d.label}</button>`).join('');

  const others = Object.keys(BODIES).filter((b) => BODIES[b].enabled && b !== m.current);
  const cards = others.map((b) => {
    const isRef = m.ref && m.ref.body === b;
    const r = m.results[b];
    let scores = '', pin = '';
    if (isRef) {
      const p = mapXY(m.ref.lat, m.ref.lon);
      pin = `<span class="mm2-pin ref" style="left:${p.x * 100}%;top:${p.y * 100}%"></span>`;
      scores = '<div class="mm2-note">Your location is on this world</div>';
    } else if (r && r.best) {
      const p = mapXY(r.best.lat, r.best.lon);
      pin = `<span class="mm2-pin best" style="left:${p.x * 100}%;top:${p.y * 100}%"></span>`;
      scores = `<div class="mm2-scores">${Object.entries(MATCH_METRICS).map(([k, d]) => {
        const v = r.best.scores[k], sim = k === 'terrain' && r.terrainSim;
        return `<div class="mm2-score ${k === m.metric ? 'on' : ''} ${scoreClass(v)}"><span>${d.short}${sim ? '<i class="sim">SAMPLE</i>' : ''}</span><b>${pct(v)}</b></div>`;
      }).join('')}</div>`;
    } else {
      scores = `<div class="mm2-note">${m.ref ? 'No data' : 'Pick a location to see matches'}</div>`;
    }
    const overall = !isRef && r && r.best ? `<span class="mm2-pct ${scoreClass(r.best.overall)}">${pct(r.best.overall)}</span>` : '';
    return `<div class="mm2-card" data-body="${b}">
        <div class="mm2-head"><span>${BODIES[b].label}</span>${overall}</div>
        <button class="mm2-map" data-body="${b}" title="Go to ${name(b)}${!isRef && r && r.best ? ' best match' : ''}">
          ${mapHTML(BODIES[b], m.online)}<span class="mm2-heat" data-heat="${b}"></span>${pin}
        </button>
        ${scores}
      </div>`;
  }).join('');

  el.innerHTML = `${refHtml}
    <div class="ml-chips" role="group" aria-label="Match shown on maps">${chips}</div>
    <div class="mm2-list">${cards}</div>`;

  // heat overlays (small canvases, one pixel per cell, scaled by CSS)
  others.forEach((b) => {
    const r = m.results[b], slot = el.querySelector(`[data-heat="${b}"]`);
    if (slot && r && !(m.ref && m.ref.body === b)) slot.appendChild(renderScoreCanvas(r[m.metric], { px: 1, gridLines: false }));
  });
  el.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => h.onMetric(b.dataset.metric)));
  el.querySelectorAll('.mm2-map').forEach((b) => b.addEventListener('click', () => h.onPickMap(b.dataset.body)));
  el.querySelector('.ml-clear')?.addEventListener('click', h.onClear);
}

/* ---------------- bottom-left advanced ---------------- */

/** m = { stat, range, opacity, gridLines, scale, ref }; h = { onStat, onRange, onOpacity, onGridLines, onScale, onProbe } */
export function renderAdvanced(m, h) {
  const el = $('adv-body');
  el.innerHTML = `
    <div class="adv-row"><span class="adv-lbl">TEMPERATURE</span>
      <div class="adv-chips">${['mean', 'high', 'low'].map((k) => `<button class="chip" data-stat="${k}" aria-pressed="${k === m.stat}">${STAT_LABEL[k]}</button>`).join('')}</div></div>
    <label class="adv-row"><span class="adv-lbl">0% AT ±<b id="adv-range-val">${m.range}</b>°C</span>
      <input type="range" id="adv-range" min="5" max="200" step="5" value="${m.range}"></label>
    <div class="adv-row"><span class="adv-lbl">MISSION</span>
      <div class="adv-chips">${[['human', 'HUMAN'], ['rover', 'ROVER']].map(([k, l]) => `<button class="chip" data-scale="${k}" aria-pressed="${k === m.scale}">${l}</button>`).join('')}</div></div>
    <label class="adv-row"><span class="adv-lbl">HEAT MAP</span>
      <input type="range" id="adv-opacity" min="10" max="100" value="${Math.round(m.opacity * 100)}"></label>
    <div class="adv-row"><span class="adv-lbl">CELLS</span>
      <button class="chip" id="adv-grid" aria-pressed="${m.gridLines}">2° GRID LINES</button></div>
    <div class="adv-row"><span class="adv-lbl">DETAIL</span>
      <button class="chip" id="adv-probe" ${m.ref ? '' : 'disabled'}>MULTI-METRIC PROBE (SAMPLE)</button></div>
    <p class="adv-note">Overall match = ${m.weightsText}. Pressure is compared on a log scale (0% at 1000× apart).</p>`;
  el.querySelectorAll('[data-stat]').forEach((b) => b.addEventListener('click', () => h.onStat(b.dataset.stat)));
  el.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => h.onScale(b.dataset.scale)));
  const range = el.querySelector('#adv-range');
  range.addEventListener('input', () => { $('adv-range-val').textContent = range.value; h.onRange(Number(range.value)); });
  const op = el.querySelector('#adv-opacity');
  op.addEventListener('input', () => h.onOpacity(Number(op.value) / 100));
  el.querySelector('#adv-grid').addEventListener('click', () => h.onGridLines(!m.gridLines));
  el.querySelector('#adv-probe').addEventListener('click', h.onProbe);
}

/* ---------------- right panel ---------------- */

function adviceFor(ref, r, stat) {
  const b = r.best, v = b.values, s = b.scores, there = name(r.target), here = name(ref.body);
  const tHere = ref[stat], tThere = v[stat];
  const diff = tThere - tHere;
  const swingHere = ref.high - ref.low, swingThere = v.high - v.low;
  const rover = [], human = [];
  rover.push(s.temp >= 0.75
    ? `Temperatures are close (${fmtC(tHere)} here vs ${fmtC(tThere)} there): good for testing batteries, heaters and electronics.`
    : `It is ${Math.abs(diff).toFixed(0)}°C ${diff < 0 ? 'colder' : 'hotter'} there, so field tests here would ${diff < 0 ? 'under-test cold survival' : 'under-test heat rejection'}. Back them up with chamber tests.`);
  if (!Number.isNaN(swingHere) && !Number.isNaN(swingThere)) {
    rover.push(Math.abs(swingThere - swingHere) <= 15
      ? `Similar day–night swing (${swingHere.toFixed(0)}°C vs ${swingThere.toFixed(0)}°C): realistic thermal cycling for joints, seals and wheels.`
      : `Day–night swing is ${swingThere.toFixed(0)}°C there vs ${swingHere.toFixed(0)}°C here. ${swingThere > swingHere ? 'Expect harsher thermal cycling than this site can give.' : 'This site cycles harder than the target.'}`);
  }
  rover.push(`Terrain match ${pct(s.terrain)}${r.terrainSim ? ' (sample data until real slope data is loaded)' : ''}: slope ${v.slope != null && !Number.isNaN(v.slope) ? v.slope.toFixed(1) + '°' : '—'} at the target.`);

  human.push(s.temp >= 0.75
    ? `Crews would face similar surface temperatures (${fmtC(tThere)}), so spacesuit heating and cooling can be rehearsed realistically here.`
    : `Surface temperature there (${fmtC(tThere)}) is far from here (${fmtC(tHere)}). Suits and habitats need extra thermal margin beyond what this site tests.`);
  const pHere = ref.pressure, pThere = v.pressure;
  if (!Number.isNaN(pHere) && !Number.isNaN(pThere)) {
    human.push(pThere < 0.5 || pHere < 0.5
      ? `${pThere < 0.5 ? there : here} has no air (vacuum). Full pressure suits are essential, and no ${here === 'Earth' ? 'Earth site' : 'site here'} can rehearse that.`
      : `Air pressure: ${fmtP(pHere)} here vs ${fmtP(pThere)} there (${pct(s.press)} match on a log scale).${Math.max(pHere, pThere) / Math.min(pHere, pThere) > 10 ? ' Too thin to breathe or to cool by air: pressurised suits needed.' : ''}`);
  }
  human.push(b.overall >= 0.6
    ? `A strong overall analog: a good candidate to shortlist for crewed EVA rehearsals and base-site training.`
    : `A partial analog: useful for specific tests, not full mission rehearsals.`);
  return { rover, human };
}

const METRIC_ICON = { temp: '🌡️', press: '⏲️', terrain: '⛰️' };
const METRIC_NAME = { temp: 'Temperature', press: 'Pressure', terrain: 'Terrain' };
const SOURCE = {
  temp: { earth: 'NASA POWER (MERRA-2), ground-surface temperature 2001–2025', moon: 'LRO Diviner, measured surface temperature 2009–2015', mars: 'Mars Climate Database 6.2, surface temperature (climate model)' },
  press: { earth: 'NASA POWER surface pressure (PS)', moon: 'No atmosphere (≈3×10⁻¹⁰ Pa), treated as 0', mars: 'Mars Climate Database 6.2, surface pressure' },
};
let openMetric = null;   // which metric's details are shown (kept while switching worlds)

export const getOpenMetric = () => openMetric;
export function setOpenMetric(k) { openMetric = k; }

/**
 * Right-edge rail: 🌡️ ⏲️ ⛰️ always visible. Grey until a location is picked, then
 * coloured red→green with the % for the world shown in the match panel.
 * r = result for the active target (or null); onMetric(key) when tapped.
 */
export function renderRail(r, { onMetric }) {
  const box = $('rail-metrics');
  if (!box) return;
  box.innerHTML = Object.keys(METRIC_ICON).map((k) => {
    const s = r && r.best ? r.best.scores[k] : NaN;
    const sim = k === 'terrain' && r && r.terrainSim;
    const has = !Number.isNaN(s);
    return `<button class="rail-metric ${has ? 'scored' : ''} ${openMetric === k ? 'open' : ''}" data-metric="${k}"
        aria-pressed="${openMetric === k}" title="${METRIC_NAME[k]} match${has ? `: ${pct(s)}${r ? ` vs ${name(r.target)}` : ''}` : ' (pick a location first)'}${sim ? ' (sample data)' : ''}"
        style="--tint:${tint(s, 0.25)};--edge:${tint(s, 0.95)}">
        <span class="rail-icon" aria-hidden="true">${METRIC_ICON[k]}</span>
        <span class="rail-pct" style="${has ? `color:${tint(s, 1)}` : ''}">${has ? pct(s) : '—'}</span>
        <span class="rail-name">${{ temp: 'TEMP', press: 'PRESS', terrain: 'TERRAIN' }[k]}${sim ? '*' : ''}</span>
      </button>`;
  }).join('');
  box.querySelectorAll('.rail-metric').forEach((b) => b.addEventListener('click', () => onMetric(b.dataset.metric)));
}

/** rgba() tint for a 0..1 score on the red→green ramp. */
function tint(s, a) {
  if (Number.isNaN(s)) return `rgba(255,255,255,${a * 0.4})`;
  const [r, g, b] = matchColor(s);
  return `rgba(${r},${g},${b},${a})`;
}

function metricDetail(k, ref, r, stat) {
  const b = r.best, v = b.values, s = b.scores[k], here = name(ref.body), there = name(r.target);
  const row = (l, a, c) => `<tr><td>${l}</td><td class="num">${a}</td><td class="num">${c}</td></tr>`;
  const head = `<thead><tr><th></th><th class="num">${here} (here)</th><th class="num">${there} (match)</th></tr></thead>`;
  if (k === 'temp') {
    const d = v[stat] - ref[stat];
    return `<table class="metric-table">${head}<tbody>
        ${row('Average', fmtC(ref.mean), fmtC(v.mean))}${row('Daily high', fmtC(ref.high), fmtC(v.high))}${row('Daily low', fmtC(ref.low), fmtC(v.low))}
        ${row('Day–night swing', fmtC(ref.high - ref.low), fmtC(v.high - v.low))}</tbody></table>
      <p class="md-text">Comparing <b>${STAT_LABEL[stat]}</b>: ${there} is ${Math.abs(d).toFixed(1)}°C ${d < 0 ? 'colder' : 'warmer'}.
        Score = 100% − difference ÷ range (set in Advanced options) → <b>${pct(s)}</b>.</p>
      <p class="md-src">${here}: ${esc(SOURCE.temp[ref.body])}<br>${there}: ${esc(SOURCE.temp[r.target])}</p>`;
  }
  if (k === 'press') {
    const a = ref.pressure, c = v.pressure;
    const ratio = a > 0.5 && c > 0.5 ? (Math.max(a, c) / Math.min(a, c)) : null;
    return `<table class="metric-table">${head}<tbody>${row('Surface pressure', fmtP(a), fmtP(c))}</tbody></table>
      <p class="md-text">${ratio ? `Pressure differs by about <b>${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio).toLocaleString()}×</b>.` : `${a < 0.5 ? here : there} is a vacuum, so there is nothing to match.`}
        Compared on a log scale (0% at 1000× apart) → <b>${pct(s)}</b>. Pressure matters for suits, habitats, dust and heat loss.</p>
      <p class="md-src">${here}: ${esc(SOURCE.press[ref.body])}<br>${there}: ${esc(SOURCE.press[r.target])}</p>`;
  }
  const t = ref.terrain, f = (x, u, d = 1) => (x == null || Number.isNaN(x) ? '—' : `${x.toFixed(d)}${u}`);
  return `<table class="metric-table">${head}<tbody>
      ${row('Slope', f(t.slope, '°'), f(v.slope, '°'))}${row('Local relief', f(t.relief, ' m', 0), f(v.relief, ' m', 0))}${row('Rock cover', f(t.rocks, '%', 0), f(v.rocks, '%', 0))}</tbody></table>
    <p class="md-text">Average of slope, relief and rock-cover similarity → <b>${pct(s)}</b>. Steep, rocky ground stresses wheels and boots alike.</p>
    ${r.terrainSim ? '<p class="md-warn">SAMPLE DATA: these terrain numbers are simulated placeholders until real slope data (LOLA / MOLA / NASADEM) is added to the grids. Not counted in the overall match.</p>' : ''}`;
}

/**
 * m = { ref, targets, active, result, stat, isSite }
 * h = { onTarget(id), onGo(), onClose(), onBriefing() }
 */
export function renderMatchPanel(m, h) {
  const el = $('site-detail');
  const r = m.result;
  if (!m.ref || !r || !r.best) {
    el.innerHTML = `<div class="mp-head"><span></span><div class="mp-title"><div class="mp-kicker">LOCATION MATCH</div><div class="mp-body">—</div></div><span></span>
        <button class="brief-close" aria-label="Close match panel">✕</button></div>
      <div class="brief-body"><p class="ml-hint">${m.loading ? 'Fetching data for your location…' : 'Click anywhere on a globe to pick a location. This panel then shows how well the best spots on the other worlds match it.'}</p></div>`;
    el.querySelector('.brief-close').addEventListener('click', h.onClose);
    el.classList.remove('hidden');
    return;
  }
  const b = r.best, ref = m.ref;
  const idx = m.targets.indexOf(m.active);
  const prev = m.targets[(idx - 1 + m.targets.length) % m.targets.length];
  const next = m.targets[(idx + 1) % m.targets.length];
  const details = Object.keys(METRIC_ICON).map((k) =>
    `<div class="mt-detail ${openMetric === k ? '' : 'hidden'}" data-detail="${k}" style="--edge:${tint(b.scores[k], 0.9)}">
       <h4>${METRIC_ICON[k]} ${METRIC_NAME[k].toUpperCase()}</h4>${metricDetail(k, ref, r, m.stat)}</div>`).join('');
  const adv = adviceFor(ref, r, m.stat);
  const list = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

  el.innerHTML = `
    <div class="mp-head">
      ${m.targets.length > 1 ? `<button class="mp-nav" data-go="${prev}" aria-label="Previous world">◁</button>` : '<span></span>'}
      <div class="mp-title"><div class="mp-kicker">${b.closestOnly ? 'CLOSEST SPOT ON' : 'BEST MATCH ON'}</div><div class="mp-body">${BODIES[r.target].label}</div></div>
      ${m.targets.length > 1 ? `<button class="mp-nav" data-go="${next}" aria-label="Next world">▷</button>` : '<span></span>'}
      <button class="brief-close" aria-label="Close match panel">✕</button>
    </div>
    <div class="brief-body">
      <div class="mp-big" style="--c:${tint(b.overall, 1)}"><b>${pct(b.overall)}</b><span>${b.closestOnly ? 'NO MATCH' : 'MATCH!'}</span></div>
      <div class="mp-where">${b.closestOnly ? `Nothing on ${name(r.target)} is within range. Closest spot is ${Math.round(b.gap)}°C apart:` : ''}
        ${fmtLat(b.lat)} · ${fmtLon(b.lon)} vs ${esc(ref.label)} (${name(ref.body)})</div>
      ${openMetric ? '' : `<p class="hint-line mt-hint">Tap ${Object.values(METRIC_ICON).join(' ')} on the right edge for temperature, pressure or terrain details</p>`}
      ${details}
      <button class="mini-btn wide mp-go">GO TO THIS SPOT ON ${BODIES[r.target].label} ▸</button>
      <div class="mp-section rover"><h4>🚙 ROVER DEVELOPMENT</h4>${list(adv.rover)}</div>
      <div class="mp-section human"><h4>🧑‍🚀 HUMAN DEVELOPMENT</h4>${list(adv.human)}</div>
      ${m.isSite ? '<button class="mini-btn wide mp-brief">SITE BRIEFING ▸</button>' : ''}
    </div>`;
  el.querySelectorAll('[data-go]').forEach((btn) => btn.addEventListener('click', () => h.onTarget(btn.dataset.go)));
  el.querySelector('.brief-close').addEventListener('click', h.onClose);
  el.querySelector('.mp-go').addEventListener('click', h.onGo);
  el.querySelector('.mp-brief')?.addEventListener('click', h.onBriefing);
  el.classList.remove('hidden');
}
