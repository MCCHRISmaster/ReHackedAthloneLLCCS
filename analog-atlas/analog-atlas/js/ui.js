/**
 * HUD rendering: body tabs, site list, imagery selector, briefing panel,
 * readouts. Pure DOM — knows nothing about WorldWind.
 */
import { BODIES, ANALOG_DIMENSIONS, TARGET_COLORS } from './config.js';

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

export function renderBodyTabs(activeId, onSelect) {
  const nav = $('body-tabs');
  nav.innerHTML = '';
  nav.setAttribute('role', 'tablist');
  Object.values(BODIES).forEach((b) => {
    const btn = document.createElement('button');
    btn.className = 'body-tab';
    btn.dataset.body = b.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(b.id === activeId));
    btn.disabled = !b.enabled;
    btn.textContent = b.label;
    btn.addEventListener('click', () => { if (b.id !== activeId) onSelect(b.id); });
    nav.appendChild(btn);
  });
}

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
      <div class="coords">${fmtLat(site.lat)} · ${fmtLon(site.lon)} · ${esc(site.environment)}</div>
      <button class="brief-close" aria-label="Close briefing">✕</button>
    </div>
    <div class="brief-body">
      <p>${esc(site.summary)}</p>
      ${isEarth ? `<h4>WHERE IT MATCHES</h4>${list(site.strengths)}<h4>WHERE IT BREAKS DOWN</h4>${list(site.limits)}` : ''}
      <h4>${isEarth ? 'LINKED TARGETS' : 'EARTH ANALOGS'}</h4>
      <div class="jumps">${linkHtml}</div>
      <h4>SIMILARITY METRICS</h4>${rows}
      ${scored ? '' : '<div class="placeholder-note">Scores pending — to be computed from NASA Earth, Moon and Mars datasets.</div>'}
      ${(site.datasets || []).length ? `<h4>SOURCES</h4><ul>${site.datasets.map((d) => `<li><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a></li>`).join('')}</ul>` : ''}
    </div>`;
  el.querySelector('.brief-close').addEventListener('click', onClose);
  el.querySelectorAll('.jump').forEach((b) => b.addEventListener('click', () => onJump(links[+b.dataset.i].site)));
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
      ? '<div class="temp-hint">Click anywhere on Earth, or an analog site, to set the reference temperature.</div>'
      : '<div class="temp-hint">No Earth reference yet.</div><button class="jump temp-goto" data-goto="earth"><span class="jump-body">EARTH</span><span class="jump-name">Pick a spot on Earth</span><span class="jump-arrow">▸</span></button>';
  } else {
    const r = m.ref;
    refHtml = `
      <div class="temp-ref">
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
    ${isEarth
      ? `<div class="jumps temp-jumps">${['moon', 'mars'].map((b) => `<button class="jump temp-goto" data-goto="${b}">
          <span class="jump-body">VIEW ON</span><span class="jump-name">${BODIES[b].label}</span><span class="jump-arrow">▸</span></button>`).join('')}</div>`
      : `<div class="temp-summary" id="temp-summary"></div>`}
    ${m.gridError ? `<div class="temp-hint err">${esc(m.gridError)}</div>` : ''}
    ${!isEarth ? '<div class="temp-note">Moon/Mars temperatures: placeholder model. Replace <code>data/*_grid.csv</code> with Diviner / MCD data.</div>' : ''}` : '';

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
