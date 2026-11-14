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

const state = {
  body: 'earth',
  filter: 'all',          // Earth only: 'all' | 'moon' | 'mars'
  selectedId: null,
  basemap: {},            // bodyId -> layerId
  online: false,
  tactical: false,        // stylised map view
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
  }
  refreshSites();
  if (site && fly) {
    globe.setAutoRotate(false);
    setRotateButton(false);
    globe.flyTo(site.lat, site.lon);
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
    getGlobeRadius: () => globeRadiusEstimate(),
  });

  globe
    .on('select', (site) => { if (site) selectSite(site); })
    .on('probe', (p) => {
      probeAt(p.lat, p.lon);
      if (ui.isSimple()) globe.centreOn(p.lat, p.lon);   // Simple view: bring the clicked spot to the middle
    })
    .on('space', ({ x, y }) => { const b = space.hitTest(x, y); if (b) switchBody(b); })
    .on('pointer', ({ x, y, onGlobe }) => {
      const b = onGlobe ? null : space.hitTest(x, y);
      space.hover(b);
      if (b) globe.canvas.style.cursor = 'pointer';
    })
    .on('hover', (site) => globe.highlight(site ? site.id : state.selectedId))
    .on('cursor', ui.updateCursor)
    .on('camera', (c) => { ui.updateAltitude(c.range); minimap.setCamera(c); });

  ui.applyViewMode();
  globe.setSimple(ui.isSimple());
  ui.initHelp();
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
  window.analogAtlas = { globe, state, SITES, setBody, switchBody, selectSite, probeAt, setTactical }; // console debugging
}

init();
