/**
 * App entry point: owns state and wires the globe, data and HUD together.
 */
import { CAMERA, BODIES, ONLINE_MODE } from './config.js';
import { SITES } from './data/sites.js';
import { GlobeView } from './globe.js';
import { probeOnline } from './layers.js';
import * as ui from './ui.js';
import * as temp from './temperature.js';

const state = {
  body: 'earth',
  filter: 'all',          // Earth only: 'all' | 'moon' | 'mars'
  selectedId: null,
  basemap: {},            // bodyId -> layerId
  online: false,
  tactical: false,        // stylised map view
  temp: {                 // temperature matching
    ref: null,            // { lat, lon, label, mean, high, low } from NASA POWER
    loading: false,
    error: null,
    stat: 'mean',         // 'mean' | 'high' | 'low'
    range: 40,            // °C difference that counts as 0% match
    opacity: 0.75,
    gridLines: true,
    grids: {},            // body -> grid from CSV
    gridError: null,
  },
};

let globe;
const byId = Object.fromEntries(SITES.map((s) => [s.id, s]));

function visibleSites() {
  let sites = SITES.filter((s) => s.body === state.body);
  if (state.body === 'earth' && state.filter !== 'all') sites = sites.filter((s) => s.targets.includes(state.filter));
  return sites;
}

/** Cross-planet links for a site (targets list analogs; Earth sites get the reverse). */
function linksFor(site) {
  if (site.body !== 'earth') return (site.analogs || []).map((id) => byId[id]).filter(Boolean).map((s) => ({ site: s }));
  return SITES.filter((t) => t.body !== 'earth' && (t.analogs || []).includes(site.id)).map((s) => ({ site: s }));
}

function refreshSites() {
  const sites = visibleSites();
  globe.setSites(sites.map((site) => ({ site, color: ui.siteColor(site) })));
  ui.renderFilters(state.body, state.filter, (f) => { state.filter = f; refreshSites(); });
  ui.renderSiteList(state.body, sites, state.selectedId, {
    onClick: (s) => selectSite(s),
    onHover: (s) => globe.highlight(s ? s.id : state.selectedId),
  });
  globe.highlight(state.selectedId);
  globe.setSelected(state.selectedId);
}

function refreshImagery() {
  const layerId = state.basemap[state.body];
  ui.renderImagery(state.body, state.online, layerId, (id) => {
    state.basemap[state.body] = id;
    globe.setBasemap(id);
    refreshImagery();
  });
  const body = BODIES[state.body];
  const def = body.layers.find((l) => l.id === layerId);
  let credit = state.online && def ? `Imagery: ${def.note}` : `Imagery: ${body.offlineLayer.note}`;
  if (state.tactical && state.online) credit += ` · ${body.tactical.contours.note}`;
  ui.setCredit(credit);
}

/* ---------------- temperature match ---------------- */

const tempHandlers = {
  onStat: (s) => { state.temp.stat = s; refreshTemp(); },
  onRange: (v) => { state.temp.range = v; scheduleHeat(); },
  onOpacity: (o) => { state.temp.opacity = o; globe.setHeatOpacity(o); },
  onGridLines: (on) => { state.temp.gridLines = on; refreshTemp(); },
  onGoto: (b) => setBody(b),
  onClear: () => { state.temp.ref = null; refreshTemp(); },
};

/**
 * Which body shows the heat map for the current reference:
 *   reference on Earth      -> Moon and Mars  (forward search)
 *   reference on Moon/Mars  -> Earth only     (reverse search)
 */
function heatShownOn(bodyId) {
  const ref = state.temp.ref;
  if (!ref) return false;
  return ref.body === 'earth' ? bodyId !== 'earth' : bodyId === 'earth';
}

/** Re-render the panel and the globe overlays for the current body. */
function refreshTemp() {
  const t = state.temp;
  ui.renderTempPanel({
    ...t, body: state.body, grid: t.grids[state.body], heatHere: heatShownOn(state.body),
  }, tempHandlers);
  const onRefBody = t.ref && t.ref.body === state.body;
  globe.setReference(onRefBody ? { ...t.ref, label: t.ref.label.toUpperCase() } : null);
  drawHeat();
}

function drawHeat() {
  const t = state.temp, grid = t.grids[state.body];
  if (!heatShownOn(state.body) || !grid) { globe.setHeatmap(null); return; }
  const target = t.ref[t.stat];
  globe.setHeatmap(temp.renderMatchCanvas(grid, t.stat, target, t.range, { gridLines: t.gridLines }));
  ui.updateTempSummary(temp.summarize(grid, t.stat, target, t.range), t);
}

let heatQueued = false;
function scheduleHeat() {             // slider drags: redraw at most once per frame
  if (heatQueued) return;
  heatQueued = true;
  requestAnimationFrame(() => { heatQueued = false; drawHeat(); });
}

let refToken = 0;
async function setTempReference(lat, lon, label) {
  const t = state.temp, token = ++refToken;
  t.loading = true; t.error = null;
  refreshTemp();
  try {
    const v = await temp.fetchEarthTemps(lat, lon);
    if (token !== refToken) return;   // a newer click won
    t.ref = { body: 'earth', lat, lon, label: label || 'Selected point', ...v };
  } catch (err) {
    if (token !== refToken) return;
    t.error = `Couldn't get temperature: ${err.message}`;
  }
  t.loading = false;
  refreshTemp();
}

/** Reverse search: reference temperature read from the Moon/Mars grid cell. */
function setBodyReference(bodyId, lat, lon, label) {
  const t = state.temp, grid = t.grids[bodyId];
  ++refToken;                          // cancels any Earth lookup still in flight
  t.loading = false;
  if (!grid) { t.error = `The ${BODIES[bodyId].label} temperature grid isn't loaded.`; refreshTemp(); return; }
  const v = temp.cellTemps(grid, lat, lon);
  if (Number.isNaN(v.mean)) {
    t.error = `No ${BODIES[bodyId].label} temperature data at this point.`;
  } else {
    t.error = null;
    t.ref = { body: bodyId, lat, lon, label: label || `${bodyId === 'moon' ? 'Moon' : 'Mars'} point`, ...v };
  }
  refreshTemp();
}

function tempReadout(pos) {
  const t = state.temp, grid = t.grids[state.body];
  if (!pos || !grid) { ui.updateTempReadout(null); return; }
  if (state.body === 'earth' && !heatShownOn('earth')) { ui.updateTempReadout(null); return; } // Earth temps come from NASA POWER on click
  const i = temp.cellIndex(pos.lat, pos.lon);
  const v = grid[t.stat][i];
  if (Number.isNaN(v)) { ui.updateTempReadout('no data'); return; }
  let text = `${v.toFixed(1)}°C ${temp.STATS[t.stat].label}`;
  if (heatShownOn(state.body)) text += ` · ${Math.round(temp.matchValue(grid, i, t.stat, t.ref[t.stat], t.range) * 100)}% MATCH`;
  ui.updateTempReadout(text);
}

async function loadGrids() {
  for (const body of Object.keys(temp.GRID_FILES)) {
    try {
      state.temp.grids[body] = await temp.loadGrid(body);
    } catch (err) {
      console.error(err);
      state.temp.gridError = `Couldn't load the ${body} temperature grid`;
    }
  }
  refreshTemp();
}

function setBody(bodyId, thenSelect = null) {
  state.body = bodyId;
  state.selectedId = null;
  ui.showBriefing(null);
  state.basemap[bodyId] ||= BODIES[bodyId].defaultLayer;
  globe.setBody(bodyId);
  if (state.online) globe.setBasemap(state.basemap[bodyId]);
  ui.renderBodyTabs(bodyId, (id) => setBody(id), { online: state.online });
  document.body.dataset.body = bodyId;
  refreshImagery();
  refreshSites();
  refreshTemp();
  ui.setStatus(`${state.online ? 'UPLINK ESTABLISHED' : 'OFFLINE MODE'} · ${BODIES[bodyId].label}`, state.online ? 'ready' : 'warn');
  if (thenSelect) setTimeout(() => selectSite(thenSelect), 250);
  else { globe.setAutoRotate(true); setRotateButton(true); }
}

function selectSite(site) {
  if (site && site.body !== state.body) { setBody(site.body, site); return; }
  state.selectedId = site ? site.id : null;
  ui.showBriefing(site, { links: site ? linksFor(site) : [], onClose: () => selectSite(null), onJump: (s) => selectSite(s) });
  refreshSites();
  if (site) {
    globe.setAutoRotate(false);
    setRotateButton(false);
    globe.flyTo(site.lat, site.lon);
    if (site.body === 'earth') setTempReference(site.lat, site.lon, site.name);
    else setBodyReference(site.body, site.lat, site.lon, site.name);
  }
}

function setTactical(on) {
  state.tactical = on;
  globe.setTactical(on);
  document.body.classList.toggle('tactical', on);
  document.getElementById('btn-tactical').setAttribute('aria-pressed', String(on));
  refreshImagery();
}

function setRotateButton(on) {
  document.getElementById('btn-rotate').setAttribute('aria-pressed', String(on));
}

function bindControls() {
  const $ = (id) => document.getElementById(id);
  $('btn-zoom-in').onclick = () => globe.zoomBy(CAMERA.zoomStep);
  $('btn-zoom-out').onclick = () => globe.zoomBy(1 / CAMERA.zoomStep);
  $('btn-reset').onclick = () => { selectSite(null); globe.resetView(true); globe.setAutoRotate(true); setRotateButton(true); };
  $('btn-rotate').onclick = () => { const on = !globe.autoRotate; globe.setAutoRotate(on); setRotateButton(on); };
  $('btn-tactical').onclick = () => setTactical(!state.tactical);
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === '+' || k === '=') $('btn-zoom-in').click();
    else if (k === '-' || k === '_') $('btn-zoom-out').click();
    else if (k === 'r') $('btn-rotate').click();
    else if (k === 't') setTactical(!state.tactical);
    else if (k === 'h') $('btn-reset').click();
    else if (k === 'escape') selectSite(null);
    else if (k === 'q') ui.stepBody(-1);
    else if (k === 'e') ui.stepBody(1);
    else if (k === '1') setBody('earth');
    else if (k === '2') setBody('moon');
    else if (k === '3') setBody('mars');
  });
}

async function init() {
  if (typeof WorldWind === 'undefined') { ui.setStatus('WORLDWIND FAILED TO LOAD', 'error'); return; }
  ui.setStatus('CONTACTING NASA TILE SERVERS…');
  state.online = ONLINE_MODE === 'auto' ? await probeOnline() : !!ONLINE_MODE;

  try {
    globe = new GlobeView('globe-canvas', { online: state.online });
  } catch (err) {
    console.error(err);
    ui.setStatus('WEBGL UNAVAILABLE', 'error');
    return;
  }

  globe
    .on('select', (site) => { if (site) selectSite(site); })
    .on('hover', (site) => globe.highlight(site ? site.id : state.selectedId))
    .on('ground', (pos) => {
      globe.setAutoRotate(false);
      setRotateButton(false);
      if (state.body === 'earth') setTempReference(pos.lat, pos.lon, 'Selected point');
      else setBodyReference(state.body, pos.lat, pos.lon);
    })
    .on('cursor', (pos) => { ui.updateCursor(pos); tempReadout(pos); })
    .on('camera', (c) => ui.updateAltitude(c.range));

  bindControls();
  setBody('earth');
  loadGrids();
  window.analogAtlas = { globe, state, SITES, setBody, selectSite, setTactical, setTempReference }; // console debugging
}

init();
