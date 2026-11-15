/**
 * Location-match HUD:
 *   top centre   LOCATION MATCH bar: overall (combo) % per other world + go-to buttons
 *   left         minimap cards of the OTHER worlds (heat map of the chosen symbol + best pin)
 *   bottom left  ADVANCED options
 *   right rail   🎛️ combo · 🌡️ temperature · ⛰️ terrain · ☀️ sun & wind · 🪨 ground & soil · ▦ data grid
 *   right panel  details for the chosen symbol, rover and human development
 * Pure DOM; main.js passes in state + results from match.js.
 */
import { BODIES } from './config.js';
import { mapHTML, mapXY } from './planet-art.js';
import {
  MATCH_METRICS, renderScoreCanvas, VARIABLES, VARIABLE_SOURCES, BODY_CONSTANTS,
  cellIndex, SOLAR_RANGE, WIND_RANGE, PRESS_DECADES, SOIL_FEATURES, GAS_FEATURES, featureAt,
} from './match.js';
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

/** rgba() tint for a 0..1 score on the red→green ramp. */
function tint(s, a) {
  if (s == null || Number.isNaN(s)) return `rgba(255,255,255,${a * 0.4})`;
  const [r, g, b] = matchColor(s);
  return `rgba(${r},${g},${b},${a})`;
}

/* ---------------- symbols ---------------- */
export const RAIL = [
  { key: 'combo', icon: '🎛️', name: 'Combo', short: 'COMBO' },
  { key: 'temp', icon: '🌡️', name: 'Temperature', short: 'TEMP' },
  { key: 'terrain', icon: '⛰️', name: 'Terrain', short: 'TERRAIN' },
  { key: 'sunwind', icon: '☀️', name: 'Sun & wind', short: 'SUN·WIND' },
  { key: 'soil', icon: '🪨', name: 'Ground & soil', short: 'SOIL' },
  { key: 'air', icon: '🫧', name: 'Air & gases', short: 'AIR' },
  { key: 'grid', icon: '▦', name: 'Data grid', short: 'DATA' },
];
const RAIL_BY = Object.fromEntries(RAIL.map((r) => [r.key, r]));
export const HEAT_KEYS = ['combo', 'temp', 'terrain', 'sunwind', 'soil', 'air'];
const WEIGHT_PARTS = [
  { key: 'temp', label: '🌡️ Temperature' },
  { key: 'press', label: '⏲️ Pressure' },
  { key: 'terrain', label: '⛰️ Terrain' },
  { key: 'sunwind', label: '☀️ Sun & wind' },
  { key: 'soil', label: '🪨 Ground & soil' },
  { key: 'air', label: '🫧 Air & gases' },
];

let openView = null;   // which symbol's details the right panel shows
export const getOpenMetric = () => openView;
export function setOpenMetric(k) { openView = k; }

/* ---------------- top centre ---------------- */

export function renderMatchBar(m, { onPick, onGoRef, onGoBest }) {
  const el = $('match-bar');
  if (!m.ref && !m.loading) {
    el.innerHTML = '<span class="mb-title">LOCATION MATCH</span><span class="mb-hint">Click any location to compare worlds</span>';
    return;
  }
  const chips = m.targets.map((t) => {
    const r = m.results[t];
    const v = r && r.best ? r.best.overall : NaN;
    return `<button class="mb-chip ${scoreClass(v)} ${t === m.active ? 'active' : ''}" data-target="${t}" title="Open the ${name(t)} match">
        <span class="mb-body">${BODIES[t].label}</span><span class="mb-pct">${m.loading ? '…' : pct(v)}</span></button>`;
  }).join('');
  el.innerHTML = `<span class="mb-title">LOCATION MATCH</span>${chips}
    <span class="mb-sep"></span>
    <button class="mb-go" id="mb-go-ref" title="Fly to your chosen location" ${m.ref ? '' : 'disabled'}>📍 MY LOCATION</button>
    <button class="mb-go" id="mb-go-best" title="Fly to the best match on ${m.active ? name(m.active) : 'the selected world'}" ${m.ref ? '' : 'disabled'}>🎯 BEST MATCH</button>`;
  el.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.target)));
  el.querySelector('#mb-go-ref').addEventListener('click', onGoRef);
  el.querySelector('#mb-go-best').addEventListener('click', onGoBest);
}

/* ---------------- left column ---------------- */

/**
 * m = { current, ref, loading, error, metric, results, online, stat }
 * h = { onPickMap(body), onClear() }
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
  const sym = RAIL_BY[m.metric];
  const showing = `<div class="ml-showing">Maps show: <b>${sym.icon} ${sym.name.toUpperCase()}</b> <span>(change with the symbols on the right)</span></div>`;

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
      scores = `<div class="mm2-scores">${HEAT_KEYS.filter((k) => k !== 'combo').map((k) => {
        const v = r.best.scores[k];
        return `<div class="mm2-score ${k === m.metric ? 'on' : ''} ${scoreClass(v)}"><span>${RAIL_BY[k].icon} ${RAIL_BY[k].short}</span><b>${pct(v)}</b></div>`;
      }).join('')}</div>`;
    } else {
      scores = `<div class="mm2-note">${m.ref ? 'No data' : 'Pick a location to see matches'}</div>`;
    }
    const v = !isRef && r && r.best ? r.best.scores[m.metric] : NaN;
    const head = !isRef && r && r.best ? `<span class="mm2-pct ${scoreClass(v)}">${pct(v)}</span>` : '';
    return `<div class="mm2-card" data-body="${b}">
        <div class="mm2-head"><span>${BODIES[b].label}</span>${head}</div>
        <button class="mm2-map" data-body="${b}" title="Go to ${name(b)}${!isRef && r && r.best ? ' best match' : ''}">
          ${mapHTML(BODIES[b], m.online)}<span class="mm2-heat" data-heat="${b}"></span>${pin}
        </button>
        ${scores}
      </div>`;
  }).join('');

  el.innerHTML = `${refHtml}${m.ref ? showing : ''}<div class="mm2-list">${cards}</div>`;
  others.forEach((b) => {
    const r = m.results[b], slot = el.querySelector(`[data-heat="${b}"]`);
    if (slot && r && !(m.ref && m.ref.body === b)) slot.appendChild(renderScoreCanvas(r[m.metric], { px: 1, gridLines: false }));
  });
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
    <p class="adv-note">Combo weights are set with the sliders under 🎛️ on the right. Pressure is compared on a log scale (0% at 1000× apart).</p>`;
  el.querySelectorAll('[data-stat]').forEach((b) => b.addEventListener('click', () => h.onStat(b.dataset.stat)));
  el.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => h.onScale(b.dataset.scale)));
  const range = el.querySelector('#adv-range');
  range.addEventListener('input', () => { $('adv-range-val').textContent = range.value; h.onRange(Number(range.value)); });
  const op = el.querySelector('#adv-opacity');
  op.addEventListener('input', () => h.onOpacity(Number(op.value) / 100));
  el.querySelector('#adv-grid').addEventListener('click', () => h.onGridLines(!m.gridLines));
  el.querySelector('#adv-probe').addEventListener('click', h.onProbe);
}

/* ---------------- right rail ---------------- */

/** r = result for the active target (or null); heat = symbol currently drawn; onMetric(key). */
export function renderRail(r, { onMetric, heat }) {
  const box = $('rail-metrics');
  if (!box) return;
  box.innerHTML = RAIL.map((s) => {
    const k = s.key, isGrid = k === 'grid';
    const v = !isGrid && r && r.best ? r.best.scores[k] : NaN;
    const has = !Number.isNaN(v);
    const on = openView === k || (!isGrid && heat === k);
    return `<button class="rail-metric ${has ? 'scored' : ''} ${on ? 'open' : ''} ${isGrid ? 'grid' : ''}" data-metric="${k}"
        aria-pressed="${on}" title="${s.name}${isGrid ? ': all variables and body constants' : `${has ? `: ${pct(v)}${r ? ` vs ${name(r.target)}` : ''}` : ' (pick a location first)'}`}"
        style="--tint:${tint(v, 0.25)};--edge:${tint(v, 0.95)}">
        <span class="rail-icon" aria-hidden="true">${s.icon}</span>
        <span class="rail-pct" style="${has ? `color:${tint(v, 1)}` : ''}">${isGrid ? '' : has ? pct(v) : '—'}</span>
        <span class="rail-name">${s.short}</span>
      </button>`;
  }).join('');
  box.querySelectorAll('.rail-metric').forEach((b) => b.addEventListener('click', () => onMetric(b.dataset.metric)));
}

/* ---------------- right panel ---------------- */

const SOURCE = {
  temp: { earth: 'NASA POWER (MERRA-2), ground-surface temperature 2001–2025', moon: 'LRO Diviner, measured surface temperature 2009–2015', mars: 'Mars Climate Database 6.2, surface temperature (climate model)' },
  press: { earth: 'NASA POWER surface pressure (PS)', moon: 'No atmosphere (≈3×10⁻¹⁰ Pa), treated as 0', mars: 'Mars Climate Database 6.2, surface pressure' },
};
const TERRAIN_SOURCE = {
  earth: 'NOAA ETOPO 2022 elevation (slope, roughness, relief) + proximity to known impact structures (team-compiled list; diameters unverified)',
  moon: 'NASA LRO LOLA elevation (LDEM_16) + USGS Robbins lunar crater database',
  mars: 'NASA MGS MOLA elevation (MEGDR) + USGS Robbins & Hynek Mars crater database',
};
const SUN_SOURCE = {
  earth: 'WorldClim 2.1 surface solar radiation and wind speed (1970–2000 normals)',
  moon: 'Solar energy calculated from latitude (no air); no wind (vacuum)',
  mars: 'Solar energy calculated from latitude × 0.65 for typical dust; wind not in our data yet',
};
const SOIL_SOURCE = {
  earth: 'Fe, K, Th ESTIMATED from bedrock type (GLiM lithology × typical rock chemistry, Turekian & Wedepohl 1961); organic carbon from ISRIC SoilGrids 2.0 topsoil (0–5 cm)',
  moon: 'Lunar Prospector gamma-ray spectrometer, measured from orbit (top ~30 cm); organic carbon 0',
  mars: 'Mars Odyssey gamma-ray spectrometer, measured from orbit (top ~30 cm, 5° maps); organic carbon ≈0',
};
const GAS_SOURCE = {
  earth: 'Dry-air composition (N₂ 78%, O₂ 21%, Ar 0.9%, CO₂ 425 ppm, NOAA 2025) × NASA POWER surface pressure; NASA POWER ozone column (TO3) and aerosol optical depth (AOD_55), 2001–2025',
  moon: 'Vacuum: a surface-bounded exosphere of ~3×10⁻¹⁰ Pa (LADEE), so every gas is 0',
  mars: 'Mars Climate Database 6.2: gas shares 2 m above the ground, ozone column and dust optical depth, yearly averages',
};

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
  const tr = v.terrain || {};
  rover.push(`Terrain match ${pct(s.terrain)}: slope ${tr.slope != null && !Number.isNaN(tr.slope) ? tr.slope.toFixed(1) + '°' : '—'} there vs ${ref.terrain && !Number.isNaN(ref.terrain.slope) ? ref.terrain.slope.toFixed(1) + '°' : '—'} here. ${s.terrain >= 0.75 ? 'Good ground for mobility, navigation and wheel-wear tests.' : 'Expect different mobility challenges than this site can rehearse.'}`);
  const sa = ref.soil || {}, st = v.soil || {};
  if (!Number.isNaN(s.soil) && !Number.isNaN(sa.iron ?? NaN) && !Number.isNaN(st.iron ?? NaN)) {
    const d = st.iron - sa.iron;
    rover.push(`Ground chemistry match ${pct(s.soil)}: ${st.iron.toFixed(1)}% iron there vs ${sa.iron.toFixed(1)}% here. ${Math.abs(d) <= 2 ? 'Close enough to calibrate spectrometers and test regolith-processing kit on.' : d > 0 ? 'The ground there is richer in iron than anything here: dust will be darker and more magnetic.' : 'The ground there is poorer in iron than here.'}`);
  }
  if (!Number.isNaN(v.solar) && !Number.isNaN(ref.solar)) {
    rover.push(`Sunlight: ${Math.round(ref.solar)} W/m² here vs ${Math.round(v.solar)} W/m² there. ${Math.abs(v.solar - ref.solar) < 50 ? 'Solar panel and battery tests carry over well.' : v.solar > ref.solar ? 'More sun there: panels will over-perform compared with tests here.' : 'Less sun there: size panels and batteries with margin.'}`);
  }

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
    ? 'A strong overall analog: a good candidate to shortlist for crewed EVA rehearsals and base-site training.'
    : 'A partial analog: useful for specific tests, not full mission rehearsals.');
  return { rover, human, base: baseFor(ref, r) };
}

/**
 * 🏗️ Future base: what a permanent base at the matched Moon/Mars spot must provide for itself, from that spot's
 * data, and what this Earth place can (or cannot) rehearse. Only for Moon/Mars targets.
 * The things Earth can never match (breathable air, UV and radiation shielding) are the base's job, which is why
 * they are down-weighted in the AIR score rather than counted against every Earth place.
 */
function baseFor(ref, r) {
  if (r.target === 'earth') return [];
  const v = r.best.values, gt = v.gas || {}, ga = ref.gas || {}, s = r.best.scores;
  const there = name(r.target), moon = r.target === 'moon';
  const ok = (x) => x != null && !Number.isNaN(x);
  const out = [];
  // oxygen
  out.push(moon
    ? 'Oxygen: none in the air. The base makes all of it from regolith, which is about 45% oxygen by mass (e.g. molten-regolith electrolysis or ilmenite reduction). No Earth site can rehearse breathing it in; this site can only test the plant.'
    : `Oxygen: only ${ok(gt.o2) ? gt.o2.toFixed(1) : '~1'} Pa in the air. The base makes oxygen from the CO₂ atmosphere, as Perseverance's MOXIE did (122 g, 2021 to 2023), and recycles it.`);
  // CO2
  if (!moon && ok(gt.co2)) {
    out.push(`Carbon dioxide: ${Math.round(gt.co2)} Pa, about ${ok(ga.co2) && ga.co2 > 0 ? Math.round(gt.co2 / ga.co2) : 13}× ${name(ref.body)}'s. It is a resource: feedstock for oxygen and, with hydrogen from ice, methane rocket fuel for the return trip.`);
  } else if (moon) {
    out.push('Carbon: none in the air, so carbon for life support, plastics and plants is brought from Earth and recycled.');
  }
  // UV and radiation shielding
  const col = featureAt(r.target, 'air_column_g_cm2', r.best.i);
  out.push(moon
    ? 'UV and radiation: no air overhead at all (Earth has ~1,000 g/cm²). Habitats are buried or bermed with regolith, and windows, visors and greenhouses filter UV.'
    : `UV and radiation: ${ok(col) ? col.toFixed(0) : '~16'} g/cm² of air overhead (Earth ~1,000) and ${ok(gt.ozone) ? gt.ozone.toFixed(gt.ozone < 1 ? 2 : 1) : '<1'} Dobson units of ozone (Earth ~300). Cover habitats with regolith; UV-blocking windows, visors and greenhouse panels.`);
  // dust: the part Earth CAN rehearse
  if (moon) {
    out.push(`Dust: no air, so no haze${ok(ga.haze) ? ` (here: optical depth ${ga.haze.toFixed(2)})` : ''}, but sharp, electrically charged regolith clings to everything. Airlocks, suit seals and dust removal are the main test; an Earth desert only approximates it.`);
  } else if (ok(gt.haze) && ok(ga.haze)) {
    const close = Math.abs(gt.haze - ga.haze) <= 0.2;
    out.push(`Dust and haze: optical depth ${gt.haze.toFixed(2)} there vs ${ga.haze.toFixed(2)} here (${pct(s.air)} air match). ${close
      ? 'Close: a good place to test filters, seals, airlocks and solar-panel cleaning before going.'
      : gt.haze > ga.haze ? 'Dustier there: filters, seals and panel cleaning need more margin than this site shows.' : 'Clearer there: this site over-tests dust handling.'}`);
  }
  // frost and ice
  const frost = featureAt(r.target, 'co2_frost_months', r.best.i);
  if (!moon && ok(frost) && frost >= 0.5) {
    out.push(`Seasonal CO₂ frost there ${Math.round(frost)} months a year: frost loads on solar panels, radiators and landing pads; the frost cycle also changes local air pressure.`);
  }
  out.push(`Pressure: the base must hold its own breathable atmosphere (Earth-like ~70 to 100 kPa) against ${moon ? 'vacuum' : `${fmtP(v.pressure)} outside`}.`);
  return out;
}

const row3 = (l, a, c) => `<tr><td>${l}</td><td class="num">${a}</td><td class="num">${c}</td></tr>`;

function comboDetail(ref, r, weights) {
  const b = r.best;
  const total = WEIGHT_PARTS.reduce((s, p) => s + (r.weights[p.key] > 0 ? weights[p.key] : 0), 0) || 1;
  const rows = WEIGHT_PARTS.map((p) => {
    const s = b.scores[p.key], counted = r.weights[p.key] > 0 && !Number.isNaN(s);
    return `<div class="cw-row">
        <div class="cw-top"><span>${p.label}</span><b style="color:${tint(s, 1)}">${pct(s)}</b></div>
        <input type="range" min="0" max="100" step="5" value="${weights[p.key]}" data-weight="${p.key}" aria-label="${p.label} weight">
        <div class="cw-share"><span data-share="${p.key}">${counted ? Math.round((weights[p.key] / total) * 100) : 0}% of combo</span>${Number.isNaN(s) ? ' · no data here' : ''}</div>
      </div>`;
  }).join('');
  return `<p class="md-text">The combo mixes every measurement. Drag the sliders to decide what matters most for your mission; the heat maps, pins and % update when you let go.</p>
    <div class="cw-list">${rows}</div>
    <button class="mini-btn cw-reset">RESET WEIGHTS</button>`;
}

function metricDetail(k, ref, r, stat) {
  const b = r.best, v = b.values, s = b.scores[k], here = name(ref.body), there = name(r.target);
  const head = `<thead><tr><th></th><th class="num">${here} (here)</th><th class="num">${there} (match)</th></tr></thead>`;
  if (k === 'temp') {
    const d = v[stat] - ref[stat];
    return `<table class="metric-table">${head}<tbody>
        ${row3('Average', fmtC(ref.mean), fmtC(v.mean))}${row3('Daily high', fmtC(ref.high), fmtC(v.high))}${row3('Daily low', fmtC(ref.low), fmtC(v.low))}
        ${row3('Day–night swing', fmtC(ref.high - ref.low), fmtC(v.high - v.low))}${row3('Surface pressure', fmtP(ref.pressure), fmtP(v.pressure))}</tbody></table>
      <p class="md-text">Comparing <b>${STAT_LABEL[stat]}</b>: ${there} is ${Math.abs(d).toFixed(1)}°C ${d < 0 ? 'colder' : 'warmer'}.
        Score = 100% − difference ÷ range (Advanced options) → <b>${pct(s)}</b>. Pressure match (log scale, 0% at ${10 ** PRESS_DECADES}× apart): <b>${pct(b.scores.press)}</b>.</p>
      <p class="md-src">${here}: ${esc(SOURCE.temp[ref.body])}<br>${there}: ${esc(SOURCE.temp[r.target])}</p>`;
  }
  if (k === 'sunwind') {
    const w = (x) => (x == null || Number.isNaN(x) ? '—' : `${x.toFixed(1)} m/s`);
    const sol = (x) => (x == null || Number.isNaN(x) ? '—' : `${Math.round(x)} W/m²`);
    return `<table class="metric-table">${head}<tbody>
        ${row3('Solar energy (yearly avg.)', sol(ref.solar), sol(v.solar))}${row3('Wind speed', ref.body === 'moon' ? '0 (no air)' : ref.body === 'mars' ? 'not in data' : w(ref.wind), r.target === 'moon' ? '0 (no air)' : r.target === 'mars' ? 'not in data' : w(v.wind))}</tbody></table>
      <p class="md-text">Average of solar (0% at ${SOLAR_RANGE} W/m² apart) and wind (0% at ${WIND_RANGE} m/s apart) similarity, using whichever is available → <b>${pct(s)}</b>. Sun sets power and heating; wind drives dust, erosion and lander loads.</p>
      <p class="md-src">${here}: ${esc(SUN_SOURCE[ref.body])}<br>${there}: ${esc(SUN_SOURCE[r.target])}</p>`;
  }
  if (k === 'soil') {
    const a = ref.soil || {}, t = v.soil || {};
    const f = (x, kk) => (x == null || Number.isNaN(x) ? '—' : `${x.toFixed(kk.digits)}${kk.unit}`);
    return `<table class="metric-table">${head}<tbody>
        ${SOIL_FEATURES.map((kk) => row3(kk.label, f(a[kk.key], kk), f(t[kk.key], kk))).join('')}</tbody></table>
      <p class="md-text">Average similarity of iron, potassium, thorium and organic carbon (0% at ${SOIL_FEATURES.map((kk) => `${kk.range}${kk.unit}`).join(', ')} apart) → <b>${pct(s)}</b>.
        Chemistry decides what a rover's instruments see and what a base could mine; organic carbon is what makes Earth soil alive, and the Moon and Mars have essentially none.</p>
      <p class="md-src">${here}: ${esc(SOIL_SOURCE[ref.body])}<br>${there}: ${esc(SOIL_SOURCE[r.target])}</p>`;
  }
  if (k === 'air') {
    const a = ref.gas || {}, t = v.gas || {};
    const f = (x, kk) => {
      if (x == null || Number.isNaN(x)) return '—';
      if (kk.unit === ' Pa' && x >= 1000) return `${(x / 1000).toFixed(1)} kPa`;
      return `${x.toFixed(x > 0 && x < 1 && kk.digits === 0 ? 2 : kk.digits)}${kk.unit}`;
    };
    const wTxt = (w) => (w === 1 ? 'full' : w === 0.25 ? '¼' : String(w));
    const head4 = `<thead><tr><th></th><th class="num">${here} (here)</th><th class="num">${there} (match)</th><th class="num">counts</th></tr></thead>`;
    return `<table class="metric-table">${head4}<tbody>
        ${GAS_FEATURES.map((kk) => `<tr><td>${kk.label}</td><td class="num">${f(a[kk.key], kk)}</td><td class="num">${f(t[kk.key], kk)}</td><td class="num">${wTxt(kk.weight)}</td></tr>`).join('')}</tbody></table>
      <p class="md-text">Weighted similarity of the oxygen and carbon dioxide where you stand, the ozone overhead and the dust in the air → <b>${pct(s)}</b>.
        Gases are compared on a log scale (0% at ${10 ** 3}× apart for O₂ and CO₂), because they span from Earth's 21 kPa of oxygen to the Moon's vacuum.</p>
      <p class="md-warn"><b>Assumption:</b> oxygen, CO₂ and ozone count only ¼ as much as dust &amp; haze. No Earth place can ever truly match them:
        everywhere on Earth has about 21 kPa of oxygen, 40 Pa of CO₂ and 300 Dobson units of ozone, while ${r.target === 'moon' ? 'the Moon has none' : 'Mars has ~1 Pa of oxygen, ~13× Earth’s CO₂ and almost no ozone'}.
        Scoring them in full would only lower every Earth place by the same amount. Instead they are treated as things a future ${name(r.target)} base must provide for itself (see 🏗️ below).
        Dust &amp; haze counts in full because Earth places really differ on it, from clear polar air to Saharan dust.</p>
      <p class="md-src">${here}: ${esc(GAS_SOURCE[ref.body])}<br>${there}: ${esc(GAS_SOURCE[r.target])}</p>`;
  }
  // terrain
  const t = ref.terrain, keys = b.terrainKeys || [];
  const f = (x, kk) => (x == null || Number.isNaN(x) ? '—' : `${x.toFixed(kk.digits)}${kk.unit}`);
  const names = keys.map((kk) => kk.label.replace(/ \(0–1\)/, '').toLowerCase());
  return `<table class="metric-table">${head}<tbody>
      ${keys.map((kk) => row3(kk.label, f(t[kk.key], kk), f(v.terrain[kk.key], kk))).join('')}</tbody></table>
    <p class="md-text">Average similarity of ${names.join(', ')} → <b>${pct(s)}</b>. Steep, rough, cratered ground stresses wheels and boots alike.</p>
    ${r.terrainSim ? '<p class="md-warn">SAMPLE DATA: the terrain files could not be loaded, so these numbers are simulated and not counted in the combo.</p>'
      : `<p class="md-src">${here}: ${esc(TERRAIN_SOURCE[ref.body])}<br>${there}: ${esc(TERRAIN_SOURCE[r.target])}</p>`}`;
}

/** ▦ data grid: every variable here vs at the best match, then the whole-body constants. */
function gridView(ref, r, grids) {
  const here = name(ref.body), there = name(r.target);
  const gi = cellIndex(ref.lat, ref.lon), ti = r.best.i;
  const gH = grids[ref.body], gT = grids[r.target];
  const cell = (body, i, g, vdef) => {
    const x = g ? vdef.get(body, i, g) : { text: '—' };
    const missing = Number.isNaN(x.v) || x.v == null;
    return `<td class="num ${missing ? 'na' : ''}">${esc(x.text)}</td>`;
  };
  let group = '';
  const rows = VARIABLES.map((vd) => {
    const g = vd.group !== group ? `<tr class="dg-group"><td colspan="3">${esc((group = vd.group).toUpperCase())}</td></tr>` : '';
    return `${g}<tr><td>${esc(vd.label)}</td>${cell(ref.body, gi, gH, vd)}${cell(r.target, ti, gT, vd)}</tr>`;
  }).join('');
  const consts = BODY_CONSTANTS.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.earth)}</td><td>${esc(c.moon)}</td><td>${esc(c.mars)}</td></tr>`).join('');
  return `<h4>BODY VARIABLES <span class="dg-sub">change from place to place</span></h4>
    <table class="metric-table data-grid"><thead><tr><th></th><th class="num">${here} (here)</th><th class="num">${there} (best match)</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="md-src">${here}: ${esc(VARIABLE_SOURCES[ref.body])}<br>${there}: ${esc(VARIABLE_SOURCES[r.target])}</p>
    <h4>BODY CONSTANTS <span class="dg-sub">the same everywhere on each world</span></h4>
    <table class="metric-table data-grid consts"><thead><tr><th></th><th>Earth</th><th>Moon</th><th>Mars</th></tr></thead><tbody>${consts}</tbody></table>
    <p class="md-src">No Earth site can reproduce these. They are why every analog breaks down somewhere.</p>`;
}

/**
 * m = { ref, loading, targets, active, result, stat, isSite, weights, grids }
 * h = { onTarget(id), onGo(), onClose(), onBriefing(), onWeights(w), onResetWeights() }
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
  const view = openView || 'combo';
  const idx = m.targets.indexOf(m.active);
  const prev = m.targets[(idx - 1 + m.targets.length) % m.targets.length];
  const next = m.targets[(idx + 1) % m.targets.length];
  const sym = RAIL_BY[view];
  const body = view === 'grid' ? gridView(ref, r, m.grids)
    : view === 'combo' ? comboDetail(ref, r, m.weights) : metricDetail(view, ref, r, m.stat);
  const adv = adviceFor(ref, r, m.stat);
  const list = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const viewScore = view === 'grid' ? NaN : b.scores[view];

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
      <button class="mini-btn wide mp-go">🎯 GO TO THIS SPOT ON ${BODIES[r.target].label} ▸</button>
      <div class="mt-detail" style="--edge:${tint(viewScore, 0.9)}">
        <h4>${sym.icon} ${sym.name.toUpperCase()}${view === 'grid' ? '' : ` <span class="mt-score" style="color:${tint(viewScore, 1)}">${pct(viewScore)}</span>`}</h4>${body}
      </div>
      <div class="mp-section rover"><h4>🚙 ROVER DEVELOPMENT</h4>${list(adv.rover)}</div>
      <div class="mp-section human"><h4>🧑‍🚀 HUMAN DEVELOPMENT</h4>${list(adv.human)}</div>
      ${adv.base.length ? `<div class="mp-section base"><h4>🏗️ FUTURE ${BODIES[r.target].label} BASE</h4>
        <p class="md-text">What a permanent base at this spot must provide for itself, and what ${/^Selected point/.test(ref.label) ? 'your chosen spot' : esc(ref.label)} can rehearse.</p>${list(adv.base)}</div>` : ''}
      ${m.isSite ? '<button class="mini-btn wide mp-brief">SITE BRIEFING ▸</button>' : ''}
    </div>`;
  el.querySelectorAll('[data-go]').forEach((btn) => btn.addEventListener('click', () => h.onTarget(btn.dataset.go)));
  el.querySelector('.brief-close').addEventListener('click', h.onClose);
  el.querySelector('.mp-go').addEventListener('click', h.onGo);
  el.querySelector('.mp-brief')?.addEventListener('click', h.onBriefing);
  // combo sliders: live share text while dragging, recompute on release
  const sliders = [...el.querySelectorAll('[data-weight]')];
  const readWeights = () => Object.fromEntries(sliders.map((s) => [s.dataset.weight, Number(s.value)]));
  sliders.forEach((s) => {
    s.addEventListener('input', () => {
      const w = readWeights(), tot = Object.entries(w).reduce((a, [k, x]) => a + (r.weights[k] > 0 || k === 'terrain' ? x : 0), 0) || 1;
      Object.entries(w).forEach(([k, x]) => { const sp = el.querySelector(`[data-share="${k}"]`); if (sp) sp.textContent = `${Math.round((x / tot) * 100)}% of combo`; });
    });
    s.addEventListener('change', () => h.onWeights(readWeights()));
  });
  el.querySelector('.cw-reset')?.addEventListener('click', h.onResetWeights);
  el.classList.remove('hidden');
}
