/**
 * App entry point: owns state and wires the globe, data and HUD together.
 */
import { CAMERA, BODIES, ONLINE_MODE, SCALES } from './config.js';
import { SITES } from './data/sites.js';
import { GlobeView } from './globe.js';
import { probeOnline } from './layers.js';
import { analysePoint, warmUp, loadLandMask } from './analysis.js';
import { explainMatch } from './explain.js';
import { MiniMap } from './minimap.js';
import { SpaceBackdrop } from './space.js';
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
  probe: null,            // { lat, lon } of the probed point
  probeResult: null,
  scale: 'human',         // operating scale for probes: 'human' | 'rover'
  panel: null,            // what the right-hand panel shows: 'site' | 'probe' | null
  switching: false,       // a body-switch animation is running
};

let globe, minimap, space;
let homeRadiusRatio = 0.2;  // globe disc radius / viewport height at the home view (measured at start)
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
  minimap.setSites(sites, ui.siteColor);
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
  onGoto: (b) => switchBody(b),
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
    // NASA POWER unreachable: fall back to the 2° Earth grid cell (same POWER climatology, cell average)
    const g = t.grids.earth, v = g && temp.cellTemps(g, lat, lon);
    if (v && !Number.isNaN(v.mean)) t.ref = { body: 'earth', lat, lon, label: `${label || 'Selected point'} (2° grid)`, ...v };
    else t.error = `Couldn't get temperature: ${err.message}`;
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

/** Instant body change (no animation). `after` runs once the new globe is up. */
function setBody(bodyId, after = null) {
  state.body = bodyId;
  state.selectedId = null;
  clearProbe();
  closePanel();
  state.basemap[bodyId] ||= BODIES[bodyId].defaultLayer;
  globe.setBody(bodyId);
  if (state.online) globe.setBasemap(state.basemap[bodyId]);
  ui.renderBodyTabs(bodyId, (id) => switchBody(id));
  document.body.dataset.body = bodyId;
  minimap.setBody(bodyId);
  refreshImagery();
  refreshSites();
  refreshTemp();
  ui.setStatus(`${state.online ? 'UPLINK ESTABLISHED' : 'OFFLINE MODE'} · ${BODIES[bodyId].label}`, state.online ? 'ready' : 'warn');
  if (after) setTimeout(after, 250);
  else { globe.setAutoRotate(true); setRotateButton(true); }
}

/** Animated body change: the chosen planet flies in from the background. */
function switchBody(bodyId, after = null) {
  if (bodyId === state.body) { if (after) after(); return; }
  if (state.switching) return;
  state.switching = true;
  ui.renderBodyTabs(bodyId, (id) => switchBody(id)); // label updates straight away
  space.transitionTo(bodyId, {
    canvas: globe.canvas,
    globeRadiusPx: globe.screenRadiusPx(),
    swap: () => setBody(bodyId, after),
  }).then(() => { state.switching = false; });
}

function closePanel() {
  state.panel = null;
  ui.showBriefing(null);
}

function selectSite(site, { fly = true } = {}) {
  if (site && site.body !== state.body) { switchBody(site.body, () => selectSite(site)); return; }
  if (site) clearProbe();
  state.selectedId = site ? site.id : null;
  if (site || state.panel === 'site') {
    state.panel = site ? 'site' : null;
    ui.showBriefing(site, { links: site ? linksFor(site) : [], onClose: () => selectSite(null), onJump: (s) => selectSite(s) });
  }
  refreshSites();
  if (site && fly) {
    globe.setAutoRotate(false);
    setRotateButton(false);
    globe.flyTo(site.lat, site.lon);
    if (site.body === 'earth') setTempReference(site.lat, site.lon, site.name);
    else setBodyReference(site.body, site.lat, site.lon, site.name);
  }
}

/* ---------------------------- point probe ---------------------------- */
function probeAt(lat, lon) {
  if (state.selectedId) { state.selectedId = null; refreshSites(); }
  state.probe = { lat, lon };
  globe.setAutoRotate(false);
  setRotateButton(false);
  runProbe();
}

function runProbe() {
  const { lat, lon } = state.probe;
  const r = state.probeResult = analysePoint(state.body, lat, lon, state.scale);
  globe.setProbe({ lat, lon, radiusM: SCALES[state.scale].radiusM });
  minimap.setProbe(r);
  state.panel = 'probe';
  const why = Object.fromEntries(Object.keys(r.matches).map((t) => [t, explainMatch(r, t)]));
  ui.showProbe(r, why, {
    onScale: (s) => { state.scale = s; runProbe(); },
    onClose: () => clearProbe(),
    onViewMatch: (t) => viewMatch(t),
    onZoomArea: () => globe.flyTo(lat, lon, SCALES[state.scale].radiusM * 7),
  });
}

function clearProbe() {
  const had = !!state.probe;
  state.probe = null;
  state.probeResult = null;
  if (!globe.probeLayer) return;
  globe.setProbe(null);
  minimap.setProbe(null);
  if (had && state.panel === 'probe') closePanel();
}

/** Go to the best-matching spot on the Moon / Mars and probe it there. */
function viewMatch(targetId) {
  const m = state.probeResult && state.probeResult.matches[targetId];
  if (!m) return;
  const go = () => { probeAt(m.lat, m.lon); globe.flyTo(m.lat, m.lon); };
  if (targetId === state.body) go(); else switchBody(targetId, go);
}

/* ---------------------------- controls ---------------------------- */
function setTactical(on) {
  state.tactical = on;
  globe.setTactical(on);
  document.body.classList.toggle('tactical', on);
  document.getElementById('btn-tactical').setAttribute('aria-pressed', String(on));
  refreshImagery();
}

/** Simple ↔ Detailed view: re-render whatever panel is open so it picks up the new defaults. */
function toggleDetail() {
  ui.setSimple(!ui.isSimple());
  if (state.panel === 'probe' && state.probe) runProbe();
  else if (state.panel === 'site' && state.selectedId) selectSite(byId[state.selectedId], { fly: false });
}

function setRotateButton(on) {
  document.getElementById('btn-rotate').setAttribute('aria-pressed', String(on));
}

function bindControls() {
  const $ = (id) => document.getElementById(id);
  $('btn-zoom-in').onclick = () => globe.zoomBy(CAMERA.zoomStep);
  $('btn-zoom-out').onclick = () => globe.zoomBy(1 / CAMERA.zoomStep);
  $('btn-reset').onclick = () => { selectSite(null); clearProbe(); globe.resetView(true); globe.setAutoRotate(true); setRotateButton(true); };
  $('btn-rotate').onclick = () => { const on = !globe.autoRotate; globe.setAutoRotate(on); setRotateButton(on); };
  $('btn-tactical').onclick = () => setTactical(!state.tactical);
  $('btn-detail').onclick = () => toggleDetail();
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === '+' || k === '=') $('btn-zoom-in').click();
    else if (k === '-' || k === '_') $('btn-zoom-out').click();
    else if (k === 'r') $('btn-rotate').click();
    else if (k === 't') setTactical(!state.tactical);
    else if (k === 'd') toggleDetail();
    else if (k === 'h') $('btn-reset').click();
    else if (k === 'escape') { clearProbe(); selectSite(null); }
    else if (k === 'q') ui.stepBody(-1);
    else if (k === 'e') ui.stepBody(1);
    else if (k === 'v' && state.probe) { state.scale = state.scale === 'human' ? 'rover' : 'human'; runProbe(); }
    else if (k === '1') switchBody('earth');
    else if (k === '2') switchBody('moon');
    else if (k === '3') switchBody('mars');
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

  minimap = new MiniMap(document.getElementById('minimap'), {
    online: state.online,
    onPick: (lat, lon) => globe.flyTo(lat, lon, globe.cameraState().range),
    onPickMatch: (t) => viewMatch(t),
  });
  space = new SpaceBackdrop(document.getElementById('space'), {
    online: state.online,
    getCamera: () => globe.cameraState(),
    getHomeRadius: () => homeRadiusRatio * window.innerHeight,
  });

  globe
    .on('select', (site) => { if (site) selectSite(site); })
    .on('probe', (p) => {
      probeAt(p.lat, p.lon);              // teammate's multi-metric probe (right panel)
      // temperature reference for the heat map (left panel): Earth via NASA POWER, Moon/Mars from the grid
      if (state.body === 'earth') setTempReference(p.lat, p.lon, 'Selected point');
      else setBodyReference(state.body, p.lat, p.lon);
    })
    .on('space', ({ x, y }) => { const b = space.hitTest(x, y); if (b) switchBody(b); })
    .on('pointer', ({ x, y, onGlobe }) => {
      const b = onGlobe ? null : space.hitTest(x, y);
      space.hover(b);
      if (b) globe.canvas.style.cursor = 'pointer';
    })
    .on('hover', (site) => globe.highlight(site ? site.id : state.selectedId))
    .on('cursor', (pos) => { ui.updateCursor(pos); tempReadout(pos); })
    .on('camera', (c) => { ui.updateAltitude(c.range); minimap.setCamera(c); });

  ui.applyViewMode();
  ui.makeCollapsible(document.getElementById('site-list-panel'), 'sites');
  ui.makeCollapsible(document.getElementById('imagery-panel'), 'imagery', { simpleCollapsed: true });
  ui.makeCollapsible(document.getElementById('minimap'), 'minimap');

  bindControls();
  setBody('earth');
  space.setActive('earth');
  // measure the home-view globe size once it has drawn (used to size the fly-in planet)
  setTimeout(() => {
    const r = globe.screenRadiusPx();
    if (r > 0) homeRadiusRatio = r / window.innerHeight;
  }, 600);
  loadLandMask().then(warmUp);
  loadGrids();
  window.analogAtlas = { globe, state, SITES, setBody, switchBody, selectSite, probeAt, setTactical, setTempReference, setBodyReference }; // console debugging
}

init();
