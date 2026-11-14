/**
 * HUD rendering: planet selector, site list, imagery selector, briefing and
 * probe panels, readouts. Pure DOM — knows nothing about WorldWind.
 */
import { BODIES, ANALOG_DIMENSIONS, TARGET_COLORS, METRICS, SCALES, BODY_FACTS } from './config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function siteColor(site) {
  if (site.body !== 'earth') return TARGET_COLORS.target;
  return site.targets.length > 1 ? TARGET_COLORS.both : TARGET_COLORS[site.targets[0]];
}

export function setStatus(text, state = '') {
  $('status-text').textContent = text;
  $('status').className = 'status ' + state;
}

/* ------------------------------------------------------------------------ *
 *  Planet selector (bottom centre)
 *
 *  The planets themselves now live in the space backdrop (js/space.js): the
 *  current one is the globe, the others hang in the background. This control
 *  just names the current body and steps between them. Rapid clicks only
 *  change the label; the globe switches once you stop (settleMs).
 * ------------------------------------------------------------------------ */
const SELECTOR = { settleMs: 320 };
let selector = null;

function buildSelector() {
  const root = $('planet-select');
  const bodies = Object.values(BODIES).filter((b) => b.enabled);
  root.innerHTML = `
    <button class="ps-arrow prev" aria-label="Previous planet (Q)">◀</button>
    <div class="ps-label" aria-live="polite">
      <span class="ps-kicker"></span><span class="ps-name"></span>
      <span class="ps-pips">${bodies.map((b) => `<i data-body="${b.id}"></i>`).join('')}</span>
    </div>
    <button class="ps-arrow next" aria-label="Next planet (E)">▶</button>`;
  const s = selector = { root, bodies, index: 0, timer: null, onSelect: null };

  s.show = (i) => {
    s.index = ((i % bodies.length) + bodies.length) % bodies.length;
    const b = bodies[s.index];
    root.querySelector('.ps-kicker').textContent = `TARGET BODY ${String(s.index + 1).padStart(2, '0')} / ${String(bodies.length).padStart(2, '0')}`;
    root.querySelector('.ps-name').textContent = b.label;
    root.dataset.body = b.id;
    root.querySelectorAll('.ps-pips i').forEach((p) => p.classList.toggle('on', p.dataset.body === b.id));
  };
  s.step = (dir) => {
    s.show(s.index + dir);
    clearTimeout(s.timer);
    s.timer = setTimeout(() => s.onSelect && s.onSelect(bodies[s.index].id), SELECTOR.settleMs);
  };
  root.querySelector('.prev').addEventListener('click', () => s.step(-1));
  root.querySelector('.next').addEventListener('click', () => s.step(1));
  return s;
}

/** Planet selector. Call on every body change; onSelect(id) fires after the user settles on a body. */
export function renderBodyTabs(activeId, onSelect) {
  if (!selector) buildSelector();
  selector.onSelect = (id) => { if (id !== activeId) onSelect(id); };
  clearTimeout(selector.timer); // an external change wins over a pending step
  selector.show(selector.bodies.findIndex((b) => b.id === activeId));
}

/** Step the selector (dir = -1 | 1). */
export function stepBody(dir) { if (selector) selector.step(dir); }

export function renderFilters(bodyId, active, onChange) {
  const row = $('filter-row');
  row.innerHTML = '';
  if (bodyId !== 'earth') {
    row.innerHTML = `<span class="filter-note">${esc(BODIES[bodyId].label)} TARGETS · linked Earth analogs in briefing</span>`;
    return;
  }
  [['all', 'All'], ['moon', 'Moon analogs'], ['mars', 'Mars analogs']].forEach(([key, label]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.target = key;
    b.textContent = label;
    b.setAttribute('aria-pressed', String(active === key));
    b.addEventListener('click', () => onChange(key));
    row.appendChild(b);
  });
}

export function renderSiteList(bodyId, sites, activeId, { onClick, onHover }) {
  $('site-list-title').textContent = bodyId === 'earth' ? 'ANALOG SITES' : 'TARGET SITES';
  $('site-count').textContent = sites.length;
  const ul = $('site-list');
  ul.innerHTML = '';
  if (!sites.length) ul.innerHTML = '<li class="empty">No sites yet for this body.</li>';
  sites.forEach((s) => {
    const li = document.createElement('li');
    li.className = 'site-item' + (s.id === activeId ? ' active' : '');
    const tags = s.body === 'earth'
      ? s.targets.map((t) => `<span class="tag ${t}">${t.toUpperCase()}</span>`).join('')
      : `<span class="tag target">${(s.analogs || []).length} ANALOG${(s.analogs || []).length === 1 ? '' : 'S'}</span>`;
    li.innerHTML = `
      <span class="pip" style="background:${siteColor(s)}"></span>
      <div><div class="name">${esc(s.name)}</div><div class="region">${esc(s.region)}</div></div>
      <div class="tags">${tags}</div>`;
    li.addEventListener('click', () => onClick(s));
    li.addEventListener('mouseenter', () => onHover(s));
    li.addEventListener('mouseleave', () => onHover(null));
    ul.appendChild(li);
  });
}

/** Imagery (basemap) selector for the active body. */
export function renderImagery(bodyId, online, activeLayerId, onSelect) {
  const body = BODIES[bodyId];
  const box = $('imagery-list');
  box.innerHTML = '';
  if (!online) {
    box.innerHTML = `
      <div class="layer-opt active offline"><span class="radio"></span>
        <div><div class="layer-name">${esc(body.offlineLayer.label)}</div>
        <div class="layer-note">${esc(body.offlineLayer.note)}</div></div></div>
      <div class="layer-warn">OFFLINE — NASA tile servers unreachable from this page. Run it from a local server with internet to load Trek / GIBS imagery.</div>`;
    return;
  }
  body.layers.forEach((def) => {
    const opt = document.createElement('button');
    opt.className = 'layer-opt' + (def.id === activeLayerId ? ' active' : '');
    opt.setAttribute('aria-pressed', String(def.id === activeLayerId));
    opt.innerHTML = `<span class="radio"></span>
      <div><div class="layer-name">${esc(def.label)}</div><div class="layer-note">${esc(def.note)}</div></div>`;
    opt.addEventListener('click', () => onSelect(def.id));
    box.appendChild(opt);
  });
}

const fmtLat = (v) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'N' : 'S'}`;
const fmtLon = (v) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? 'E' : 'W'}`;

/* ------------------------------------------------------------------------ *
 *  Simple / Detailed view and collapsible content
 *
 *  Simple view (default) shows headline scores and plain-language
 *  explanations; numbers, tables and data notes sit in collapsed sections.
 *  Detailed view opens them. Anything the user opens or closes is
 *  remembered (per browser) until they switch view again.
 * ------------------------------------------------------------------------ */
const PREFS_KEY = 'analog-atlas-ui';
const prefs = (() => {
  const d = { simple: true, sections: {}, panels: {} };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage blocked */ } };

export const isSimple = () => prefs.simple;

/** Switch view; resets remembered open/closed state to that view's defaults. */
export function setSimple(on) {
  prefs.simple = on;
  prefs.sections = {};
  prefs.panels = {};
  savePrefs();
  applyViewMode();
}

const collapsibles = []; // { panel, key, simpleCollapsed }

export function applyViewMode() {
  document.body.classList.toggle('simple', prefs.simple);
  const btn = $('btn-detail');
  if (btn) {
    btn.setAttribute('aria-pressed', String(!prefs.simple));
    btn.querySelector('.mode-label').textContent = prefs.simple ? 'SIMPLE VIEW' : 'DETAILED VIEW';
  }
  collapsibles.forEach(applyPanel);
}

/** Give a .panel a collapse toggle in its head. */
export function makeCollapsible(panel, key, { simpleCollapsed = false } = {}) {
  const head = panel.querySelector('.panel-head');
  const btn = document.createElement('button');
  btn.className = 'collapse-btn';
  btn.setAttribute('aria-label', 'Show or hide');
  head.appendChild(btn);
  const c = { panel, key, simpleCollapsed, btn };
  head.addEventListener('click', (e) => {
    if (e.target.closest('button') && e.target !== btn) return;
    prefs.panels[key] = !panel.classList.contains('collapsed');
    savePrefs();
    applyPanel(c);
  });
  collapsibles.push(c);
  applyPanel(c);
}

function applyPanel(c) {
  const collapsed = prefs.panels[c.key] ?? (prefs.simple ? c.simpleCollapsed : false);
  c.panel.classList.toggle('collapsed', collapsed);
  c.btn.setAttribute('aria-expanded', String(!collapsed));
  c.btn.textContent = collapsed ? '▸' : '▾';
}

/** A collapsible section inside a panel. open = { simple, detailed } defaults. */
function section(key, title, inner, open = { simple: false, detailed: true }) {
  const isOpen = prefs.sections[key] ?? (prefs.simple ? open.simple : open.detailed);
  return `<details class="sec" data-sec="${key}" ${isOpen ? 'open' : ''}><summary>${title}</summary><div class="sec-body">${inner}</div></details>`;
}
function bindSections(el) {
  el.querySelectorAll('details.sec').forEach((d) => d.addEventListener('toggle', () => {
    prefs.sections[d.dataset.sec] = d.open;
    savePrefs();
  }));
}

/* ------------------------------------------------------------------------ *
 *  Site briefing
 * ------------------------------------------------------------------------ */
/**
 * Briefing panel. `links` = [{ site, label }] — cross-planet jumps.
 * onJump(site) is called when a link is clicked.
 */
export function showBriefing(site, { links = [], onClose, onJump } = {}) {
  const el = $('site-detail');
  if (!site) { el.classList.add('hidden'); return; }
  const isEarth = site.body === 'earth';
  const scored = Object.keys(site.scores || {}).length > 0;
  const rows = ANALOG_DIMENSIONS.map((d) => {
    const v = site.scores?.[d.key];
    const pct = typeof v === 'number' ? Math.round(v * 100) : null;
    return `<div class="score-row"><span>${d.label}</span>
      <div class="score-bar"><span style="width:${pct ?? 0}%"></span></div>
      <span class="score-val">${pct ?? '—'}</span></div>`;
  }).join('');
  const list = (arr) => (arr && arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="coords">—</p>');
  const kicker = isEarth
    ? `ANALOG BRIEFING · ${site.targets.map((t) => t.toUpperCase()).join(' + ')}`
    : `TARGET BRIEFING · ${BODIES[site.body].label}`;
  const linkHtml = links.length
    ? links.map((l, i) => `<button class="jump" data-i="${i}">
        <span class="jump-body">${esc(BODIES[l.site.body].label)}</span>
        <span class="jump-name">${esc(l.site.name)}</span><span class="jump-arrow">▸</span></button>`).join('')
    : '<p class="coords">No linked sites yet.</p>';

  el.innerHTML = `
    <div class="brief-head">
      <div class="brief-kicker">${kicker}</div>
      <div class="brief-title">${esc(site.name)}</div>
      <div class="brief-region">${esc(site.region)}</div>
      <div class="coords detail-only">${fmtLat(site.lat)} · ${fmtLon(site.lon)} · ${esc(site.environment)}</div>
      <button class="brief-close" aria-label="Close briefing">✕</button>
    </div>
    <div class="brief-body">
      <p>${esc(site.summary)}</p>
      ${isEarth ? section('site-match', 'WHERE IT MATCHES · WHERE IT BREAKS DOWN',
        `<h4>WHERE IT MATCHES</h4>${list(site.strengths)}<h4>WHERE IT BREAKS DOWN</h4>${list(site.limits)}`, { simple: true, detailed: true }) : ''}
      <h4>${isEarth ? 'LINKED TARGETS' : 'EARTH ANALOGS'}</h4>
      <div class="jumps">${linkHtml}</div>
      ${section('site-metrics', 'SIMILARITY METRICS', rows +
        (scored ? '' : '<div class="placeholder-note">Scores pending — to be computed from NASA Earth, Moon and Mars datasets.</div>'))}
      ${(site.datasets || []).length ? section('site-sources', 'SOURCES',
        `<ul>${site.datasets.map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a></li>`).join('')}</ul>`) : ''}
      <p class="hint-line">Tip: click any bare ground on the globe to score that exact spot.</p>
    </div>`;
  el.querySelector('.brief-close').addEventListener('click', onClose);
  el.querySelectorAll('.jump').forEach((b) => b.addEventListener('click', () => onJump(links[+b.dataset.i].site)));
  bindSections(el);
  el.classList.remove('hidden');
}

export function updateCursor(pos) {
  $('ro-lat').textContent = pos ? fmtLat(pos.lat) : '—';
  $('ro-lon').textContent = pos ? fmtLon(pos.lon) : '—';
}

export function updateAltitude(rangeM) {
  $('ro-alt').textContent = rangeM >= 1e6
    ? `${(rangeM / 1e3).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`
    : `${(rangeM / 1e3).toFixed(1)} km`;
}

export function setCredit(text) { $('credit').textContent = text; }

/* ---------------- Temperature match panel ---------------- */

const fmtC = (v) => (v == null || Number.isNaN(v) ? '—' : `${v.toFixed(1)}°C`);
const STAT_LABEL = { mean: 'AVG', high: 'HIGH', low: 'LOW' };

/**
 * m = { body, ref, loading, error, stat, range, opacity, gridLines, gridError }
 * h = { onStat, onRange, onOpacity, onGridLines, onGoto, onClear }
 */
export function renderTempPanel(m, h) {
  const box = $('temp-body');
  const isEarth = m.body === 'earth';
  let refHtml;
  if (m.loading) refHtml = '<div class="temp-hint">FETCHING SURFACE TEMPERATURE FROM NASA POWER…</div>';
  else if (m.error) refHtml = `<div class="temp-hint err">${esc(m.error)}</div>`;
  else if (!m.ref) {
    refHtml = isEarth
      ? '<div class="temp-hint">Click anywhere on Earth, or an analog site, to see matching temperatures on the Moon and Mars.</div>'
      : `<div class="temp-hint">Click anywhere on ${m.body === 'moon' ? 'the Moon' : 'Mars'}, or a target site, to find places on <b>Earth</b> with the same temperature.</div>`;
  } else {
    const r = m.ref;
    refHtml = `
      <div class="temp-ref">
        <div class="temp-ref-body">${esc(BODIES[r.body].label)} REFERENCE</div>
        <div class="temp-ref-name">${esc(r.label)}</div>
        <div class="coords">${fmtLat(r.lat)} · ${fmtLon(r.lon)}</div>
        <button class="temp-clear" title="Clear reference" aria-label="Clear reference">✕</button>
      </div>
      <div class="temp-vals">${['mean', 'high', 'low'].map((k) =>
        `<div class="${k === m.stat ? 'on' : ''}"><span>${STAT_LABEL[k]}</span><b>${fmtC(r[k])}</b></div>`).join('')}</div>`;
  }

  const controls = m.ref ? `
    <div class="temp-row">
      <span class="temp-lbl">COMPARE</span>
      <div class="temp-chips">${['mean', 'high', 'low'].map((k) =>
        `<button class="chip" data-stat="${k}" aria-pressed="${k === m.stat}">${STAT_LABEL[k]}</button>`).join('')}</div>
    </div>
    <label class="temp-row"><span class="temp-lbl">0% AT ±<b id="temp-range-val">${m.range}</b>°C</span>
      <input type="range" id="temp-range" min="5" max="200" step="5" value="${m.range}"></label>
    <label class="temp-row"><span class="temp-lbl">OPACITY</span>
      <input type="range" id="temp-opacity" min="10" max="100" value="${Math.round(m.opacity * 100)}"></label>
    <div class="temp-row">
      <span class="temp-lbl">MATCH</span>
      <div class="temp-legend-wrap"><div class="temp-legend"></div>
        <div class="temp-ticks"><span>0%</span><span>50%</span><span>100%</span></div></div>
    </div>
    <div class="temp-row"><span class="temp-lbl">CELLS</span>
      <button class="chip" id="temp-grid" aria-pressed="${m.gridLines}">2° GRID LINES</button></div>
    ${m.heatHere
      ? '<div class="temp-summary" id="temp-summary"></div>'
      : `<div class="jumps temp-jumps">${(m.ref.body === 'earth' ? ['moon', 'mars'] : ['earth']).map((b) => `<button class="jump temp-goto" data-goto="${b}">
          <span class="jump-body">VIEW ON</span><span class="jump-name">${BODIES[b].label}</span><span class="jump-arrow">▸</span></button>`).join('')}</div>`}
    ${m.gridError ? `<div class="temp-hint err">${esc(m.gridError)}</div>` : ''}
    ${m.heatHere && m.grid ? gridNote(m) : ''}` : '';

  box.innerHTML = refHtml + controls;
  box.querySelectorAll('[data-stat]').forEach((b) => b.addEventListener('click', () => h.onStat(b.dataset.stat)));
  box.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => h.onGoto(b.dataset.goto)));
  box.querySelector('.temp-clear')?.addEventListener('click', h.onClear);
  box.querySelector('#temp-grid')?.addEventListener('click', () => h.onGridLines(!m.gridLines));
  const range = box.querySelector('#temp-range');
  range?.addEventListener('input', () => { $('temp-range-val').textContent = range.value; h.onRange(Number(range.value)); });
  const op = box.querySelector('#temp-opacity');
  op?.addEventListener('input', () => h.onOpacity(Number(op.value) / 100));
}

/** Data-source line under the summary; warns about placeholder or partial grids. */
function gridNote(m) {
  const g = m.grid;
  const partial = g.filled < 16200
    ? ` · <b>partial:</b> ${g.filled.toLocaleString()} of 16,200 cells have data (clear cells = not downloaded yet)` : '';
  const warn = g.placeholder || g.filled < 16200;
  return `<div class="temp-note${warn ? ' warn' : ''}">${esc(BODIES[m.body].label)} data: ${esc(g.sourceLabel)}` +
    `${g.placeholder ? ' (not measured data)' : ''} · surface temperature, 2° grid${partial}</div>`;
}

/** s = summary from temperature.summarize() or null */
export function updateTempSummary(s, m) {
  const el = $('temp-summary');
  if (!el) return;
  if (!s) { el.innerHTML = 'No grid data loaded.'; return; }
  if (s.best <= 0) {
    el.innerHTML = `No cell within ${m.range}°C of ${fmtC(m.ref[m.stat])}. Widen the range or compare HIGH / LOW.`;
    return;
  }
  el.innerHTML = `BEST <b>${Math.round(s.best * 100)}%</b> at ${fmtLat(s.lat)} ${fmtLon(s.lon)} (${fmtC(s.temp)})<br>` +
    `<b>${(s.goodShare * 100).toFixed(1)}%</b> of surface ≥ 75% match`;
}

export function updateTempReadout(text) { $('ro-temp').textContent = text || '—'; }

/* ------------------------------------------------------------------------ *
 *  Point-probe panel (shares the right-hand slot with the site briefing)
 * ------------------------------------------------------------------------ */
const pct = (s) => (s == null ? '—' : Math.round(s * 100));
const fmtVal = (m, v) => (v == null ? '—' : `${v.toFixed(m.digits)}${m.unit ? ' ' + m.unit : ''}`);

/**
 * result = analysis.analysePoint(...) output, or null to hide.
 * explanations = { [targetBodyId]: explain.explainMatch(...) }
 * handlers: onScale(scaleId), onClose(), onViewMatch(targetBodyId), onZoomArea()
 */
export function showProbe(result, explanations, { onScale, onClose, onViewMatch, onZoomArea } = {}) {
  const el = $('site-detail');
  if (!result) { el.classList.add('hidden'); return; }
  const body = BODIES[result.body];
  const scale = SCALES[result.scale];
  const targets = Object.keys(result.matches);
  const simple = prefs.simple;

  const cards = targets.map((t) => {
    const m = result.matches[t];
    const x = explanations[t];
    const p = pct(m.score);
    const why = `
      <p class="why-head">${esc(x.headline)}</p>
      ${x.good.length ? `<ul class="why good">${x.good.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ul>` : ''}
      ${x.gaps.length ? `<ul class="why gap">${x.gaps.map((g) => `<li>${esc(g.text)}</li>`).join('')}</ul>` : ''}
      <button class="mini-btn view-match" data-target="${t}">GO TO THIS SPOT ON ${BODIES[t].label} ▸</button>`;
    return `<div class="score-card" data-target="${t}">
        <div class="score-top">
          <div class="dial" style="--p:${p}"><span>${p}<small>%</small></span></div>
          <div class="score-info">
            <div class="score-target">vs ${BODIES[t].label}</div>
            <div class="tier ${x.tier.id}">${x.tier.label}</div>
            <div class="score-summary">${esc(x.summary)}</div>
          </div>
        </div>
        ${section(`why-${t}`, `WHY · WHAT YOU COULD TEST`, why, { simple: true, detailed: true })}
      </div>`;
  }).join('');

  const rows = METRICS.map((m) => {
    const sim = result.simulated[m.key];
    const bar = (t) => {
      const s = result.matches[t].parts[m.key];
      return `<div class="mbar" style="--tc:var(--${t})" title="${BODIES[t].label}: ${pct(s)}% (best-match value ${fmtVal(m, result.matches[t].values[m.key])})"><span style="width:${pct(s) === '—' ? 0 : pct(s)}%"></span></div>`;
    };
    return `<tr title="${esc(m.label)} · planned source: ${esc(m.sources[result.body] || '—')}">
        <td>${esc(simple ? m.plain : m.label)}${sim ? '<span class="sim">SIM</span>' : ''}</td>
        <td class="num">${fmtVal(m, result.values[m.key])}</td>
        ${targets.map((t) => `<td>${bar(t)}</td>`).join('')}
      </tr>`;
  }).join('');
  const table = `<table class="metric-table">
      <thead><tr><th>${simple ? 'What' : 'Metric'}</th><th class="num">Here</th>${targets.map((t) => `<th>${BODIES[t].label.charAt(0) + BODIES[t].label.slice(1).toLowerCase()}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="hint-line">Bars show how closely each one matches the best spot on that body.</p>`;

  const allBodies = [result.body, ...targets];
  const facts = `<table class="metric-table facts">
      <thead><tr><th></th>${allBodies.map((b) => `<th>${b === result.body ? 'Here' : BODIES[b].label.charAt(0) + BODIES[b].label.slice(1).toLowerCase()}</th>`).join('')}</tr></thead>
      <tbody>${BODY_FACTS.map((f) => `<tr title="${esc(f.why)}"><td>${esc(f.label)}</td>${allBodies.map((b) => `<td>${esc(f[b])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    <p class="hint-line">These differ for the whole body, so no single spot can match them. Hover a row for why it matters.</p>`;

  const sources = `${result.anySimulated ? `<div class="placeholder-note">The numbers are placeholders from a simple model, not real measurements yet. Each will be replaced by the NASA dataset listed here (see <code>js/analysis.js</code> → <code>registerGrid</code>).</div>` : ''}
    <table class="metric-table small"><thead><tr><th>Metric</th><th>Earth</th><th>Moon</th><th>Mars</th></tr></thead>
    <tbody>${METRICS.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.sources.earth)}</td><td>${esc(m.sources.moon)}</td><td>${esc(m.sources.mars)}</td></tr>`).join('')}</tbody></table>
    <p class="hint-line">Score per metric = 1 − |difference| / range, then a weighted average (weights depend on Human / Rover).</p>`;

  el.innerHTML = `
    <div class="brief-head">
      <div class="brief-kicker">POINT PROBE · ${body.label}${result.anySimulated ? ' <span class="sim big" title="Values are placeholders until real NASA data is connected">SAMPLE DATA</span>' : ''}</div>
      <div class="brief-title">${fmtLat(result.lat)} · ${fmtLon(result.lon)}</div>
      <div class="brief-region">How well this spot matches ${targets.map((t) => ({ earth: 'Earth', moon: 'the Moon', mars: 'Mars' }[t] || BODIES[t].label)).join(' and ')}</div>
      <button class="brief-close" aria-label="Close probe">✕</button>
    </div>
    <div class="brief-body">
      <div class="seg" role="radiogroup" aria-label="Mission type">
        ${Object.values(SCALES).map((s) => `<button role="radio" data-scale="${s.id}" aria-checked="${s.id === result.scale}">${s.label}</button>`).join('')}
      </div>
      <p class="scale-note">${esc(scale.note)} <span class="key">V</span></p>
      ${result.onLand ? '' : '<div class="layer-warn">This point is in the ocean. Scores assume dry land, so treat them with care.</div>'}
      <div class="score-cards">${cards}</div>
      <button class="mini-btn wide zoom-area">ZOOM TO ${scale.label} OPERATING AREA</button>
      ${section('probe-metrics', 'MEASUREMENTS', table)}
      ${section('probe-facts', 'WHAT NO SPOT CAN MATCH', facts)}
      ${section('probe-data', 'ABOUT THIS DATA', sources, { simple: false, detailed: false })}
    </div>`;

  el.querySelector('.brief-close').addEventListener('click', onClose);
  el.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => onScale(b.dataset.scale)));
  el.querySelectorAll('.view-match').forEach((b) => b.addEventListener('click', () => onViewMatch(b.dataset.target)));
  el.querySelector('.zoom-area').addEventListener('click', onZoomArea);
  bindSections(el);
  el.classList.remove('hidden');
}
