/**
 * App entry point: owns state and wires the globe, data and HUD together.
 */
import { CAMERA, BODIES, ONLINE_MODE } from './config.js';
import { SITES } from './data/sites.js';
import { GlobeView } from './globe.js';
import { probeOnline } from './layers.js';
import * as ui from './ui.js';

const state = {
  body: 'earth',
  filter: 'all',          // Earth only: 'all' | 'moon' | 'mars'
  selectedId: null,
  basemap: {},            // bodyId -> layerId
  online: false,
  tactical: false,        // stylised map view
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
    .on('cursor', ui.updateCursor)
    .on('camera', (c) => ui.updateAltitude(c.range));

  bindControls();
  setBody('earth');
  window.analogAtlas = { globe, state, SITES, setBody, selectSite, setTactical }; // console debugging
}

init();
