/**
 * App entry point: owns state and wires the globe, data and HUD together.
 */
import { CAMERA, BODIES, ONLINE_MODE, SCALES, ILLUSTRATED } from './config.js';
import { SITES } from './data/sites.js';
import { GlobeView } from './globe.js';
import { probeOnline } from './layers.js';
import { analysePoint, warmUp, loadLandMask } from './analysis.js';
import { explainMatch } from './explain.js';
import { MiniMap } from './minimap.js';
import { SpaceBackdrop } from './space.js';
import * as ui from './ui.js';
import * as temp from './temperature.js';
import * as dataTab from './datatab.js';
import * as match from './match.js';
import * as mui from './matchui.js';

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
  match: { metric: 'combo', active: null, results: {}, key: '', open: false, weights: null }, // location match HUD
  ui: { left: false, right: false },   // side panels: both start collapsed
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
  const def = body.layers.find((l) => l.id === (layerId === 'illustrated' ? ILLUSTRATED[state.body].from : layerId));
  let credit = state.online && def ? `Imagery: ${def.note}` : `Imagery: ${body.offlineLayer.note}`;
  if (layerId === 'illustrated') credit = `Illustrated from ${credit.replace('Imagery: ', '')}`;
  if (state.tactical && state.online) credit += ` · ${body.tactical.contours.note}`;
  ui.setCredit(credit);
  syncPlanetLooks();
}

/**
 * Background / stand-in planets show each body with the imagery chosen for it
 * (its default until you pick one) and in Tactical style when Tactical is on.
 */
function syncPlanetLooks() {
  if (!space) return;
  Object.values(BODIES).filter((b) => b.enabled).forEach((b) => {
    space.setLook(b.id, { layerId: state.basemap[b.id] || ui.defaultBasemap(b.id, state.online), tactical: state.tactical });
  });
}

/* ---------------- location match (whiteboard layout) ---------------- */

const targetsOf = (ref) => Object.keys(BODIES).filter((b) => BODIES[b].enabled && b !== ref.body);
let landReady = false;
let switchToken = 0;
let terrainVersion = 0;

function weightsText() {
  const anyReal = Object.values(state.match.results).some((r) => !r.terrainSim);
  return anyReal ? '50% temperature + 25% pressure + 25% terrain'
    : '65% temperature + 35% pressure (terrain is sample data, so it is shown but not counted)';
}

/** Recompute every other world's match for the current reference (cached by inputs). */
function computeResults() {
  const t = state.temp, m = state.match;
  if (!t.ref) { m.results = {}; m.key = ''; return; }
  m.weights ||= { ...match.DEFAULT_WEIGHTS };
  const key = [t.ref.body, t.ref.lat, t.ref.lon, t.stat, t.range, state.scale, Object.keys(t.grids).join(','), landReady, terrainVersion, JSON.stringify(m.weights)].join('|');
  if (key === m.key) return;
  m.key = key;
  m.results = {};
  targetsOf(t.ref).forEach((b) => {
    const g = t.grids[b];
    if (g) m.results[b] = match.computeMatch(t.ref, g, b, { stat: t.stat, range: t.range, scale: state.scale, weights: m.weights });
  });
  if (!m.active || !m.results[m.active]) m.active = targetsOf(t.ref)[0];
}

const leftHandlers = {
  onMetric: (k) => { state.match.metric = k; refreshTemp(); },
  onPickMap: (b) => {
    const t = state.temp, r = state.match.results[b];
    if (t.ref && b !== t.ref.body && r && r.best) { state.match.active = b; goToSpot(b, r.best.lat, r.best.lon); }
    else if (t.ref && b === t.ref.body) goToSpot(b, t.ref.lat, t.ref.lon);
    else switchBody(b);
  },
  onClear: () => { state.temp.ref = null; state.match.open = false; ui.showBriefing(null); refreshTemp(); },
};

const advHandlers = {
  onStat: (s) => { state.temp.stat = s; refreshTemp(); },
  onRange: (v) => { state.temp.range = v; scheduleHeat(); },
  onOpacity: (o) => { state.temp.opacity = o; globe.setHeatOpacity(o); },
  onGridLines: (on) => { state.temp.gridLines = on; refreshTemp(); },
  onScale: (s) => {
    state.scale = s;
    const r = state.temp.ref;
    if (r) r.terrain = match.terrainAt(r.body, r.lat, r.lon, s);
    refreshTemp();
  },
  onProbe: () => {   // teammate's detailed multi-metric probe (sample data)
    const r = state.temp.ref;
    if (!r) return;
    const open = () => { probeAt(r.lat, r.lon); setRightOpen(true); };
    if (state.body === r.body) open();
    else switchBody(r.body, open);
  },
};

const panelHandlers = {
  onTarget: (b) => { state.match.active = b; refreshTemp(); },
  onWeights: (w) => { state.match.weights = { ...w }; refreshTemp(); },
  onResetWeights: () => { state.match.weights = { ...match.DEFAULT_WEIGHTS }; refreshTemp(); },
  onGo: () => { const r = state.match.results[state.match.active]; if (r && r.best) goToSpot(r.target, r.best.lat, r.best.lon); },
  onClose: () => { state.panel = null; setRightOpen(false); },
  onBriefing: () => { const id = state.temp.ref && state.temp.ref.siteId; if (id) { state.match.open = false; selectSite(byId[id], { fly: false }); } },
};

/** Fly to a spot, switching world first if needed. */
function goToSpot(bodyId, lat, lon) {
  const fly = () => { globe.setAutoRotate(false); setRotateButton(false); globe.flyTo(lat, lon, globe.radius * 1.2); };
  if (state.body === bodyId) fly(); else switchBody(bodyId, fly);
}

/** Re-render the match HUD and the globe overlays for the current world. */
function refreshTemp({ keepAdvanced = false } = {}) {
  computeResults();
  const t = state.temp, m = state.match;
  const targets = t.ref ? targetsOf(t.ref) : [];
  mui.renderMatchBar({ ref: t.ref, loading: t.loading, targets, results: m.results, active: m.active }, {
    onPick: (b) => { m.active = b; clearProbe(); state.panel = null; setRightOpen(true); },
    onGoRef: () => { if (t.ref) goToSpot(t.ref.body, t.ref.lat, t.ref.lon); },
    onGoBest: () => { const r = m.results[m.active]; if (r && r.best) goToSpot(r.target, r.best.lat, r.best.lon); },
  });
  mui.renderLeft({ current: state.body, ref: t.ref, loading: t.loading, error: t.error, metric: m.metric,
    results: m.results, online: state.online, stat: t.stat }, leftHandlers);
  if (!keepAdvanced) {
    mui.renderAdvanced({ stat: t.stat, range: t.range, opacity: t.opacity, gridLines: t.gridLines,
      scale: state.scale, ref: t.ref, weightsText: weightsText() }, advHandlers);
  }
  renderPanel();
  drawHeat();
}

/** Right panel: the match card, unless a site briefing or the detailed probe is showing. */
function renderPanel(force = false) {
  const t = state.temp, m = state.match;
  updateSideTabs();
  if (!force && (state.panel === 'site' || state.panel === 'probe')) return;
  state.panel = 'match';
  mui.renderMatchPanel({ ref: t.ref, loading: t.loading, targets: t.ref ? targetsOf(t.ref) : [], active: m.active,
    result: t.ref ? m.results[m.active] : null, stat: t.stat, isSite: !!(t.ref && t.ref.siteId),
    weights: m.weights || match.DEFAULT_WEIGHTS, grids: t.grids }, panelHandlers);
}

/* ---------------- collapsible side panels (both start collapsed) ---------------- */

function setLeftOpen(open) {
  state.ui.left = open;
  document.body.classList.toggle('left-collapsed', !open);
  updateSideTabs();
}

function setRightOpen(open) {
  state.ui.right = open;
  document.body.classList.toggle('right-collapsed', !open);
  if (open && state.panel !== 'site' && state.panel !== 'probe') renderPanel(true);
  updateSideTabs();
}

/** Edge tabs: arrow direction + the best overall % on the right tab once a location is picked. */
function updateSideTabs() {
  const l = document.getElementById('tab-left'), r = document.getElementById('tab-right');
  if (!l || !r) return;
  l.setAttribute('aria-expanded', String(state.ui.left));
  l.querySelector('.side-arrow').textContent = state.ui.left ? '◂' : '▸';
  r.setAttribute('aria-expanded', String(state.ui.right));
  r.querySelector('.side-arrow').textContent = state.ui.right ? '▸' : '◂';
  const best = Object.values(state.match.results).reduce((mx, x) => (x.best && x.best.overall > mx ? x.best.overall : mx), -1);
  const badge = document.getElementById('tab-right-badge');
  badge.textContent = state.temp.ref && best >= 0 ? `${Math.round(best * 100)}%` : '';
  r.classList.toggle('has-result', !!badge.textContent);
  // 🌡️ ⏲️ ⛰️ rail: scores for the world currently shown in the match panel
  mui.renderRail(state.temp.ref ? state.match.results[state.match.active] : null, { onMetric: onRailMetric, heat: state.match.metric });
}

/** Tap a rail symbol: open the right panel on that measurement's details (tap again to hide them). */
function onRailMetric(k) {
  const showing = state.ui.right && state.panel === 'match' && (mui.getOpenMetric() || 'combo') === k;
  if (mui.HEAT_KEYS.includes(k)) state.match.metric = k;          // globe + minimaps follow the symbol
  mui.setOpenMetric(showing && k === 'grid' ? null : k);
  clearProbe();
  if (state.panel === 'site') { ui.showBriefing(null); state.selectedId = null; }
  state.panel = null;
  if (showing && k === 'grid') { refreshTemp(); return; }
  setRightOpen(true);
  refreshTemp();
}

/** Globe overlays: crosshair on your location's world; heat map + best-match pin on every other world. */
function drawHeat() {
  const t = state.temp, m = state.match;
  const onRef = t.ref && t.ref.body === state.body;
  globe.setReference(onRef ? { ...t.ref, label: t.ref.label.toUpperCase() } : null);
  const r = t.ref && !onRef ? m.results[state.body] : null;
  if (!r) { globe.setHeatmap(null); globe.setBestMatch(null); return; }
  globe.setHeatmap(match.renderScoreCanvas(r[m.metric], { gridLines: t.gridLines }));
  globe.setBestMatch(r.best ? { lat: r.best.lat, lon: r.best.lon,
    label: r.best.closestOnly ? `CLOSEST (${Math.round(r.best.gap)}°C APART)` : `BEST MATCH ${Math.round(r.best.overall * 100)}%` } : null);
}

let heatQueued = false;
function scheduleHeat() {             // slider drags: redraw at most once per frame, keep the slider alive
  if (heatQueued) return;
  heatQueued = true;
  requestAnimationFrame(() => { heatQueued = false; refreshTemp({ keepAdvanced: true }); });
}

function gridPressure(bodyId, lat, lon) {
  const g = state.temp.grids[bodyId], col = g && g.columns && g.columns.pressure_pa;
  return col ? col[match.cellIndex(lat, lon)] : NaN;
}

let refToken = 0;
async function setTempReference(lat, lon, label, siteId = null) {
  const t = state.temp, token = ++refToken;
  t.loading = true; t.error = null;
  refreshTemp();
  try {
    const v = await temp.fetchEarthTemps(lat, lon);
    if (token !== refToken) return;   // a newer click won
    if (Number.isNaN(v.pressure)) v.pressure = gridPressure('earth', lat, lon);
    t.ref = { body: 'earth', lat, lon, label: label || 'Selected point', siteId, ...v, ...match.refExtras('earth', lat, lon) };
  } catch (err) {
    if (token !== refToken) return;
    // NASA POWER unreachable: fall back to the 2° Earth grid cell (same POWER climatology, cell average)
    const g = t.grids.earth, v = g && temp.cellTemps(g, lat, lon);
    if (v && !Number.isNaN(v.mean)) {
      t.ref = { body: 'earth', lat, lon, label: `${label || 'Selected point'} (2° grid)`, siteId, ...v, pressure: gridPressure('earth', lat, lon), ...match.refExtras('earth', lat, lon) };
    } else t.error = `Couldn't get temperature: ${err.message}`;
  }
  if (t.ref && t.ref.body === 'earth' && t.ref.lat === lat && t.ref.lon === lon) t.ref.terrain = match.terrainAt('earth', lat, lon, state.scale);
  t.loading = false;
  refreshTemp();
}

/** Location on the Moon or Mars: everything read from that world's grid cell. */
function setBodyReference(bodyId, lat, lon, label, siteId = null) {
  const t = state.temp, grid = t.grids[bodyId];
  ++refToken;                          // cancels any Earth lookup still in flight
  t.loading = false;
  if (!grid) { t.error = `The ${BODIES[bodyId].label} data grid isn't loaded.`; refreshTemp(); return; }
  const v = temp.cellTemps(grid, lat, lon);
  if (Number.isNaN(v.mean)) {
    t.error = `No ${BODIES[bodyId].label} temperature data at this point.`;
  } else {
    t.error = null;
    t.ref = { body: bodyId, lat, lon, label: label || `${bodyId === 'moon' ? 'Moon' : 'Mars'} point`, siteId, ...v,
      pressure: gridPressure(bodyId, lat, lon), terrain: match.terrainAt(bodyId, lat, lon, state.scale), ...match.refExtras(bodyId, lat, lon) };
  }
  refreshTemp();
}

function tempReadout(pos) {
  const t = state.temp, grid = t.grids[state.body];
  if (!pos || !grid) { ui.updateTempReadout(null); return; }
  const i = match.cellIndex(pos.lat, pos.lon);
  const v = grid[t.stat][i];
  if (Number.isNaN(v)) { ui.updateTempReadout('no data'); return; }
  let text = `${v.toFixed(1)}°C ${temp.STATS[t.stat].label}`;
  const p = grid.columns && grid.columns.pressure_pa ? grid.columns.pressure_pa[i] : NaN;
  if (!Number.isNaN(p)) text += ` · ${mui.fmtP(p)}`;
  const r = t.ref && t.ref.body !== state.body ? state.match.results[state.body] : null;
  if (r) text += ` · ${Math.round((r.overall[i] || 0) * 100)}% MATCH`;
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
  loadTerrain();
}

/** Real terrain (slope, roughness, relief, cratering) from the terrain-data team's 2° feature grids. */
async function loadTerrain() {
  let ranges = null;
  try { ranges = await (await fetch(match.TERRAIN_RANGES_FILE)).json(); } catch (err) { console.warn('terrain ranges', err); }
  for (const [body, path] of Object.entries(match.TERRAIN_FILES)) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      match.registerTerrain(body, temp.parseCSV(await res.text()), ranges);
    } catch (err) {
      console.warn('terrain data not loaded, using sample values:', err.message);
    }
  }
  // re-measure the current location's terrain with the real data and rescore everything
  const r = state.temp.ref;
  if (r) Object.assign(r, { terrain: match.terrainAt(r.body, r.lat, r.lon, state.scale) }, match.refExtras(r.body, r.lat, r.lon));
  terrainVersion++;
  match.loadNightLights('lib/images/dnb_land_ocean_ice_2012.png').then(() => { if (state.ui.right) renderPanel(true); });
  state.match.key = '';
  refreshTemp();
}

/** Instant body change (no animation). `after` runs once the new globe is up. */
function setBody(bodyId, after = null) {
  state.body = bodyId;
  state.selectedId = null;
  clearProbe();
  closePanel();
  state.basemap[bodyId] ||= ui.defaultBasemap(bodyId, state.online);
  globe.setBody(bodyId);
  globe.setBasemap(state.basemap[bodyId]);
  ui.renderBodyTabs(bodyId, (id) => switchBody(id));
  document.body.dataset.body = bodyId;
  minimap.setBody(bodyId);
  refreshImagery();
  refreshSites();
  refreshTemp();
  ui.setStatus(state.online ? 'LIVE' : 'OFFLINE', state.online ? 'ready' : 'warn');
  if (after) setTimeout(after, 250);
  else { globe.setAutoRotate(true); setRotateButton(true); }
}

/** Animated body change: the chosen planet flies in from the background. */
function switchBody(bodyId, after = null) {
  if (bodyId === state.body) { if (after) after(); return; }
  if (state.switching) return;
  state.switching = true;
  // Safety net: if the switch animation stalls (e.g. the browser pauses animation frames),
  // finish the switch directly after 8 s so planet switching never locks up.
  const token = (switchToken = (switchToken || 0) + 1);
  setTimeout(() => {
    if (!state.switching || token !== switchToken) return;
    if (state.body !== bodyId) setBody(bodyId, after);
    state.switching = false;
  }, 8000);
  ui.renderBodyTabs(bodyId, (id) => switchBody(id)); // label updates straight away
  // First ease the real globe back to the overview (if zoomed in or tilted), so the stand-in
  // planet can take over at exactly the same size and nothing jumps.
  globe.pullBackToHome().then(() => startSwitch(bodyId, after));
}

function startSwitch(bodyId, after) {
  space.transitionTo(bodyId, {
    canvas: globe.canvas,
    globeRadiusPx: globeRadiusEstimate(),   // from the camera distance (exact right after the pull-back)
    swap: () => {
      setBody(bodyId, after);
      globe.autoRotate = false; // hold still at the home view so it matches the stand-in when it fades in
    },
    fromView: { ...(({ lat, lon }) => ({ lat, lon }))(globe.cameraState()), rotating: globe.isAutoRotating() },
    toView: { lat: BODIES[bodyId].home.latitude, lon: BODIES[bodyId].home.longitude },
    ready: () => globe.whenSettled(),
    onHandBack: (view) => {
      if (after) return;   // a fly-to (site / best match) is taking the camera elsewhere
      // carry on from exactly where the spinning stand-in is, still turning, so there is no cut
      globe.lookAt(view.lat, view.lon);
      globe.setAutoRotate(true);
      setRotateButton(true);
    },
  }).then(() => { state.switching = false; });
}

/**
 * On-screen globe radius from the camera range, scaled from the measured home
 * view (cheap enough to call every frame, unlike screenRadiusPx()).
 */
function globeRadiusEstimate() {
  if (!globe || !globe.body) return 0;
  const R = globe.radius, range = globe.wwd.navigator.range;
  const ang = (r) => Math.tan(Math.asin(1 / (1 + r)));
  return homeRadiusRatio * window.innerHeight * (ang(range / R) / ang(CAMERA.homeRangeRadii));
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
    if (site) setRightOpen(true);            // a site briefing was asked for: open the right panel
    else if (state.ui.right) renderPanel(true);  // briefing closed: back to the match card
  }
  refreshSites();
  if (site && fly) {
    globe.setAutoRotate(false);
    setRotateButton(false);
    globe.flyTo(site.lat, site.lon);
    if (site.body === 'earth') setTempReference(site.lat, site.lon, site.name, site.id);
    else setBodyReference(site.body, site.lat, site.lon, site.name, site.id);
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
  if (had && state.panel === 'probe') { closePanel(); if (state.ui.right) renderPanel(true); }
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
  globe.setSimple(ui.isSimple());
  // each view has its own default look: illustrated planets (Simple) or real imagery (Detailed)
  state.basemap = { [state.body]: ui.defaultBasemap(state.body, state.online) };
  globe.setBasemap(state.basemap[state.body]);
  refreshImagery();
  refreshSites();
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
  $('btn-data').onclick = () => dataTab.toggleDataTab(state.body);
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === 'n') { dataTab.toggleDataTab(state.body); return; }
    if (k === 'escape' && dataTab.isOpen()) { dataTab.closeDataTab(); return; }
    if (dataTab.isOpen()) return;          // keep globe shortcuts quiet while the data tab is open
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
    getGlobeRadius: () => globeRadiusEstimate(),
  });

  globe
    .on('select', (site) => { if (site) selectSite(site); })
    .on('probe', (p) => {
      // Location match: open the match card (teammate's detailed probe is in Advanced options)
      clearProbe();
      if (state.panel === 'site') selectSite(null);
      state.match.open = true;
      if (ui.isSimple()) globe.centreOn(p.lat, p.lon);   // Simple view: bring the clicked spot to the middle
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
  globe.setSimple(ui.isSimple());
  ui.initHelp();
  ui.makeCollapsible(document.getElementById('site-list-panel'), 'sites');
  ui.makeCollapsible(document.getElementById('imagery-panel'), 'imagery', { simpleCollapsed: true });
  ui.makeCollapsible(document.getElementById('minimap'), 'minimap');
  ui.makeCollapsible(document.getElementById('adv-panel'), 'advanced', { simpleCollapsed: true });

  bindControls();
  document.getElementById('tab-left').onclick = () => setLeftOpen(!state.ui.left);
  document.getElementById('tab-right').onclick = () => setRightOpen(!state.ui.right);
  setLeftOpen(false);
  setRightOpen(false);
  setBody('earth');
  space.setActive('earth');
  // measure the home-view globe size once it has drawn (used to size the fly-in planet)
  setTimeout(() => {
    const r = globe.screenRadiusPx();
    if (r > 0) homeRadiusRatio = r / window.innerHeight;
  }, 600);
  loadLandMask().then(() => { landReady = true; refreshTemp(); warmUp(); });
  loadGrids();
  dataTab.initDataTab({ grids: () => state.temp.grids });
  window.analogAtlas = { globe, state, SITES, setBody, switchBody, selectSite, probeAt, setTactical, setTempReference, setBodyReference }; // console debugging
}

init();
