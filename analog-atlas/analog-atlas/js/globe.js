/* global WorldWind */
/**
 * GlobeView — wrapper around a NASA WebWorldWind WorldWindow.
 *
 * All WorldWind-specific code lives here. The rest of the app uses:
 *   setBody(bodyId), setBasemap(layerId), setTactical(on), setSites(sites),
 *   highlight(id), setSelected(id),
 *   flyTo(lat, lon, range), zoomBy(f), resetView(), setAutoRotate(on),
 *   on('select' | 'hover' | 'cursor' | 'camera', fn)
 */
import { CAMERA, BODIES, TACTICAL } from './config.js';
import {
  createLayer, createBundledEarth, createBundledEarthStyled, createPlaceholderSurface,
  createGridLayer, createZoneLayer,
} from './layers.js';
import { stylizeImagery, contourTile, ringSprite } from './tactical-fx.js';

export class GlobeView {
  constructor(canvasId, { online }) {
    this.listeners = {};
    this.online = online;
    this.placemarks = new Map();
    this.basemaps = new Map();   // layerId -> WorldWind layer (current body)
    this.highlighted = null;
    this.autoRotate = true;
    this.lastInteraction = 0;
    this.markerCache = {};
    this.tactical = false;
    this.selectedId = null;

    WorldWind.Logger.setLoggingLevel(WorldWind.Logger.LEVEL_WARNING);
    // Smooth sphere (no elevation coverages): WorldWind's old NASA elevation
    // server is no longer reachable, and Trek has no raw-elevation tile API.
    this.wwd = new WorldWind.WorldWindow(canvasId, new WorldWind.ElevationModel());
    this.canvas = this.wwd.canvas;

    this.bindInput();
    this.startLoop();
  }

  /* ---------------- events ---------------- */
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, payload) { (this.listeners[evt] || []).forEach((fn) => fn(payload)); }

  /* ---------------- bodies & layers ---------------- */
  /**
   * Switch planetary body: new spherical/ellipsoidal globe of the right size,
   * rebuild the layer stack, move the camera home.
   */
  setBody(bodyId) {
    const body = BODIES[bodyId];
    this.body = body;
    this.cancelAnimation(); // a fly-to in progress must not continue on the new globe

    // A fresh Globe gets a fresh id, so WorldWind's terrain cache can't mix bodies.
    const globe = new WorldWind.Globe(new WorldWind.ElevationModel());
    globe.equatorialRadius = body.radiusM;
    if (bodyId === 'earth') {
      const f = 1 / WorldWind.WGS84_INVERSE_FLATTENING;
      globe.polarRadius = body.radiusM * (1 - f);
      globe.eccentricitySquared = 2 * f - f * f;
    } else {
      globe.polarRadius = body.radiusM;   // Trek mosaics use a sphere
      globe.eccentricitySquared = 0;
    }
    this.wwd.globe = globe;

    this.wwd.layers.slice().forEach((l) => this.wwd.removeLayer(l));
    this.basemaps.clear();
    this.tacImagery = new Map();
    const add = (layer) => { this.wwd.addLayer(layer); return layer; };

    const stars = add(new WorldWind.StarFieldLayer());

    // --- real view ---
    this.realBase = add(bodyId === 'earth' ? createBundledEarth() : createPlaceholderSurface(body.fallbackColor));
    if (this.online) {
      body.layers.forEach((def) => {
        const layer = add(createLayer(def));
        layer.enabled = false;
        this.basemaps.set(def.id, layer);
      });
      this.activeBasemap = body.defaultLayer;
    }

    // --- tactical view (created lazily where expensive) ---
    const tac = body.tactical;
    this.tacStyle = (img) => stylizeImagery(img, tac.accent, tac.imagery);
    this.tacBase = null;                                  // built on first use
    this.tacSlot = add(new WorldWind.RenderableLayer('tactical-slot')); // insertion marker
    this.tacContours = this.online
      ? add(createLayer(tac.contours, { transform: (img) => contourTile(img, tac.accent, tac.contours), cacheTag: 'contours' }))
      : null;
    this.grid = add(createGridLayer(tac.accent, TACTICAL.gridStepDeg));
    this.zones = add(new WorldWind.RenderableLayer('Target zones'));
    this.zonesKey = null;

    this.atmosphere = null;
    if (body.atmosphere) {
      this.atmosphere = new WorldWind.AtmosphereLayer();
      this.atmosphere.time = new Date();
      stars.time = this.atmosphere.time;
      add(this.atmosphere);
    }

    this.siteLayer = add(new WorldWind.RenderableLayer('Sites'));
    this.pulseLayer = add(new WorldWind.RenderableLayer('Selection'));
    this.pulse = null;
    this.placemarks.clear();
    this.highlighted = null;
    this.selectedId = null;

    this.applyVisibility();
    this.resetView(false);
  }

  /** Choose the live basemap (radio-button behaviour). Applies to both views. */
  setBasemap(layerId) {
    this.activeBasemap = layerId;
    this.applyVisibility();
  }

  /** Toggle the stylised "Tactical" map view. */
  setTactical(on) {
    this.tactical = on;
    this.applyVisibility();
  }

  /** Single place that decides which layers are visible. */
  applyVisibility() {
    const t = this.tactical;
    const body = this.body;
    this.realBase.enabled = !t;
    this.basemaps.forEach((layer, id) => { layer.enabled = !t && id === this.activeBasemap; });
    if (this.atmosphere) this.atmosphere.enabled = !t;

    if (t && !this.tacBase) {
      // stylised always-available base (bundled Earth or placeholder sphere)
      this.tacBase = body.id === 'earth'
        ? createBundledEarthStyled(this.tacStyle, () => this.wwd.redraw())
        : createPlaceholderSurface(body.fallbackColor, this.tacStyle);
      this.insertBeforeSlot(this.tacBase);
    }
    if (this.tacBase) this.tacBase.enabled = t;

    if (t && this.online && this.activeBasemap && !this.tacImagery.has(this.activeBasemap)) {
      const def = body.layers.find((l) => l.id === this.activeBasemap);
      const layer = createLayer(def, { transform: this.tacStyle, cacheTag: 'tactical' });
      this.tacImagery.set(def.id, layer);
      this.insertBeforeSlot(layer);
    }
    this.tacImagery.forEach((layer, id) => { layer.enabled = t && id === this.activeBasemap; });
    if (this.tacContours) this.tacContours.enabled = t;
    this.grid.enabled = t;
    this.zones.enabled = t;
    this.wwd.redraw();
  }

  insertBeforeSlot(layer) {
    this.wwd.insertLayer(this.wwd.indexOfLayer(this.tacSlot), layer);
  }

  /* ---------------- markers ---------------- */
  markerImage(color, size = 64) {
    if (this.markerCache[color]) return this.markerCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    g.translate(m, m);
    g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, m * 0.82, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1; g.rotate(Math.PI / 4);
    const s = m * 0.42;
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(-s, -s, s * 2, s * 2);
    g.lineWidth = 3; g.strokeStyle = color; g.strokeRect(-s, -s, s * 2, s * 2);
    g.fillStyle = color; g.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    return (this.markerCache[color] = new WorldWind.ImageSource(c));
  }

  /** sites: array of { site, color } */
  setSites(items) {
    this.siteLayer.removeAllRenderables();
    this.placemarks.clear();
    this.rebuildZones(items.map((i) => i.site));
    items.forEach(({ site, color }) => {
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = this.markerImage(color);
      attrs.imageScale = 0.5;
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      attrs.labelAttributes.color = WorldWind.Color.WHITE;
      attrs.labelAttributes.font = new WorldWind.Font(13, 'normal', 'normal', '600', 'Rajdhani, sans-serif');
      attrs.labelAttributes.offset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 1.6);
      attrs.drawLeaderLine = false;
      const hi = new WorldWind.PlacemarkAttributes(attrs);
      hi.imageScale = 0.8;

      const pm = new WorldWind.Placemark(new WorldWind.Position(site.lat, site.lon, 0), false, attrs);
      pm.label = site.name.toUpperCase();
      pm.altitudeMode = WorldWind.CLAMP_TO_GROUND;
      pm.highlightAttributes = hi;
      pm.alwaysOnTop = true;
      pm.userProperties = { site };
      this.siteLayer.addRenderable(pm);
      this.placemarks.set(site.id, pm);
    });
    this.wwd.redraw();
  }

  rebuildZones(sites) {
    const key = sites.map((s) => s.id).join(',');
    if (key === this.zonesKey && this.zonesBody === this.body.id) return;
    this.zonesKey = key; this.zonesBody = this.body.id;
    const fresh = createZoneLayer(sites, this.body.tactical.accent, TACTICAL.zoneRadiusRadii * this.radius, this.radius);
    this.zones.removeAllRenderables();
    fresh.renderables.forEach((r) => this.zones.addRenderable(r));
  }

  /** Pulsing tactical ring on the selected site. */
  setSelected(siteId) {
    this.selectedId = siteId;
    this.pulseLayer.removeAllRenderables();
    this.pulse = null;
    const pm = siteId && this.placemarks.get(siteId);
    if (pm) {
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = new WorldWind.ImageSource(ringSprite(this.body.tactical.accent));
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      attrs.imageScale = 0.6;
      this.pulse = new WorldWind.Placemark(pm.position, false, attrs);
      this.pulse.altitudeMode = WorldWind.CLAMP_TO_GROUND;
      this.pulse.alwaysOnTop = true;
      this.pulse.enabledPicking = false;
      this.pulseLayer.addRenderable(this.pulse);
    }
    this.pulseLayer.pickEnabled = false;
    this.wwd.redraw();
  }

  highlight(siteId) {
    if (this.highlighted) this.highlighted.highlighted = false;
    this.highlighted = siteId ? this.placemarks.get(siteId) || null : null;
    if (this.highlighted) this.highlighted.highlighted = true;
    this.wwd.redraw();
  }

  /* ---------------- camera ---------------- */
  get radius() { return this.body ? this.body.radiusM : 6378137; }

  /** Range in metres for a "site close-up", scaled to the body. */
  siteRange() { return this.radius * 0.35; }

  flyTo(lat, lon, range = this.siteRange(), done) {
    this.markInteraction();
    this.cancelAnimation();
    const anim = new WorldWind.GoToAnimator(this.wwd);
    anim.travelTime = 2200;
    this.animator = anim;
    anim.goTo(new WorldWind.Position(lat, lon, range), done);
  }

  cancelAnimation() {
    if (this.animator) { this.animator.cancel(); this.animator = null; }
  }

  zoomBy(factor) {
    this.markInteraction();
    const nav = this.wwd.navigator;
    const r = this.radius;
    nav.range = Math.min(CAMERA.maxRangeRadii * r, Math.max(CAMERA.minRangeRadii * r, nav.range * factor));
    this.wwd.redraw();
    this.emitCamera();
  }

  resetView(animate = true) {
    const h = this.body.home;
    const range = CAMERA.homeRangeRadii * this.radius;
    const nav = this.wwd.navigator;
    nav.heading = 0; nav.tilt = 0; nav.roll = 0;
    if (animate) { this.flyTo(h.latitude, h.longitude, range); return; }
    nav.lookAtLocation.latitude = h.latitude;
    nav.lookAtLocation.longitude = h.longitude;
    nav.lookAtLocation.altitude = 0;
    nav.range = range;
    this.wwd.redraw();
  }

  setAutoRotate(on) { this.autoRotate = on; if (on) this.lastInteraction = 0; }

  /* ---------------- input & loop ---------------- */
  markInteraction() { this.lastInteraction = performance.now(); }

  bindInput() {
    const c = this.canvas;
    ['pointerdown', 'wheel', 'touchstart'].forEach((e) =>
      c.addEventListener(e, () => this.markInteraction(), { passive: true }));

    let down = null;
    c.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      this.emit('select', this.pickSite(e.clientX, e.clientY));
    });

    c.addEventListener('pointermove', (e) => {
      const site = this.pickSite(e.clientX, e.clientY);
      c.style.cursor = site ? 'pointer' : '';
      this.emit('hover', site);
      const t = this.wwd.pickTerrain(this.wwd.canvasCoordinates(e.clientX, e.clientY)).terrainObject();
      this.emit('cursor', t ? { lat: t.position.latitude, lon: t.position.longitude } : null);
    });
  }

  pickSite(x, y) {
    const picks = this.wwd.pick(this.wwd.canvasCoordinates(x, y));
    for (const o of picks.objects) {
      const s = o.userObject && o.userObject.userProperties && o.userObject.userProperties.site;
      if (s) return s;
    }
    return null;
  }

  emitCamera() {
    const nav = this.wwd.navigator;
    this.emit('camera', { range: nav.range, lat: nav.lookAtLocation.latitude, lon: nav.lookAtLocation.longitude });
  }

  startLoop() {
    let prev = performance.now();
    let lastCamEmit = 0;
    const tick = (now) => {
      const dt = (now - prev) / 1000; prev = now;
      if (this.body && this.autoRotate && now - this.lastInteraction > CAMERA.idleResumeMs) {
        const nav = this.wwd.navigator;
        nav.lookAtLocation.longitude = ((nav.lookAtLocation.longitude + CAMERA.autoRotateDegPerSec * dt + 540) % 360) - 180;
        this.wwd.redraw();
      }
      if (this.pulse) {
        const ph = (now % 1600) / 1600;               // 0..1 sweep
        this.pulse.attributes.imageScale = 0.45 + ph * 0.55;
        this.pulse.attributes.imageColor = new WorldWind.Color(1, 1, 1, 1 - ph * 0.85);
        this.wwd.redraw();
      }
      if (now - lastCamEmit > 150) { this.emitCamera(); lastCamEmit = now; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}
