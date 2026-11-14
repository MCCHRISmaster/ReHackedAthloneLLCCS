/* global WorldWind */
/**
 * GlobeView — wrapper around a NASA WebWorldWind WorldWindow.
 *
 * All WorldWind-specific code lives here. The rest of the app uses:
 *   setBody(bodyId), setBasemap(layerId), setTactical(on), setSites(sites),
 *   highlight(id), setSelected(id),
 *   setProbe({ lat, lon, radiusM } | null), cameraState(), screenRadiusPx(),
 *   flyTo(lat, lon, range), zoomBy(f), resetView(), setAutoRotate(on),
 *   on('select' | 'probe' | 'space' | 'pointer' | 'hover' | 'cursor' | 'camera', fn)
 */
import { CAMERA, BODIES, TACTICAL, ILLUSTRATED, SIMPLE_NAV } from './config.js';
import {
  createLayer, createBundledEarth, createBundledEarthStyled, createPlaceholderSurface,
  createGridLayer, createZoneLayer,
} from './layers.js';
import { stylizeImagery, contourTile, ringSprite, illustrateImagery } from './tactical-fx.js';

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
    this.simple = false;         // Simple view: round pins, labels on hover, north-up navigation

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

    // --- illustrated view (Simple view default; created on first use) ---
    this.illusStyle = (img) => illustrateImagery(img, ILLUSTRATED[bodyId]);
    this.illusBase = null;    // whole-globe underlay (bundled Earth / placeholder), works offline
    this.illusTiles = null;   // restyled NASA tiles, full resolution

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

    // Temperature-match heat map (Moon/Mars) and the Earth reference marker
    this.heatLayer = add(new WorldWind.RenderableLayer('Temperature match'));
    this.heatLayer.pickEnabled = false;
    this.heatLayer.opacity = this.heatOpacity ?? 0.75;
    this.refLayer = add(new WorldWind.RenderableLayer('Reference point'));
    this.refLayer.pickEnabled = false;
    this.bestLayer = add(new WorldWind.RenderableLayer('Best temperature match'));
    this.bestLayer.pickEnabled = false;

    this.atmosphere = null;
    if (body.atmosphere) {
      this.atmosphere = new WorldWind.AtmosphereLayer();
      this.atmosphere.time = new Date();
      stars.time = this.atmosphere.time;
      add(this.atmosphere);
      this.applyLighting();
    }

    this.siteLayer = add(new WorldWind.RenderableLayer('Sites'));
    this.pulseLayer = add(new WorldWind.RenderableLayer('Selection'));
    this.pulse = null;
    this.probeLayer = add(new WorldWind.RenderableLayer('Probe'));
    this.probeLayer.pickEnabled = false;
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
    const illus = !t && this.activeBasemap === 'illustrated';
    this.realBase.enabled = !t && !illus;
    this.basemaps.forEach((layer, id) => { layer.enabled = !t && id === this.activeBasemap; });
    if (this.atmosphere) this.atmosphere.enabled = !t;

    if (illus && !this.illusBase) {
      this.illusBase = body.id === 'earth'
        ? createBundledEarthStyled(this.illusStyle, () => this.wwd.redraw())
        : createPlaceholderSurface(ILLUSTRATED[body.id].colors[1]);
      this.insertBeforeSlot(this.illusBase);
    }
    if (illus && this.online && !this.illusTiles) {
      const def = body.layers.find((l) => l.id === ILLUSTRATED[body.id].from);
      if (def) {
        this.illusTiles = createLayer(def, { transform: this.illusStyle, cacheTag: 'illustrated' });
        this.insertBeforeSlot(this.illusTiles);   // after the base, so drawn on top of it
      }
    }
    if (this.illusBase) this.illusBase.enabled = illus;
    if (this.illusTiles) this.illusTiles.enabled = illus;

    if (t && !this.tacBase) {
      // stylised always-available base (bundled Earth or placeholder sphere)
      this.tacBase = body.id === 'earth'
        ? createBundledEarthStyled(this.tacStyle, () => this.wwd.redraw())
        : createPlaceholderSurface(body.fallbackColor, this.tacStyle);
      this.insertBeforeSlot(this.tacBase);
    }
    if (this.tacBase) this.tacBase.enabled = t;

    // Tactical restyles the chosen real layer, or the body default when "illustrated" is chosen.
    const tacId = body.layers.some((l) => l.id === this.activeBasemap) ? this.activeBasemap : body.defaultLayer;
    if (t && this.online && !this.tacImagery.has(tacId)) {
      const def = body.layers.find((l) => l.id === tacId);
      const layer = createLayer(def, { transform: this.tacStyle, cacheTag: 'tactical' });
      this.tacImagery.set(def.id, layer);
      this.insertBeforeSlot(layer);
    }
    this.tacImagery.forEach((layer, id) => { layer.enabled = t && id === tacId; });
    if (this.tacContours) this.tacContours.enabled = t;
    this.grid.enabled = t;
    this.zones.enabled = t;
    this.wwd.redraw();
  }

  insertBeforeSlot(layer) {
    this.wwd.insertLayer(this.wwd.indexOfLayer(this.tacSlot), layer);
  }

  /* ---------------- temperature match ---------------- */
  /** Drape an equirectangular canvas over the whole body, or clear it with null. */
  setHeatmap(canvas) {
    this.heatLayer.removeAllRenderables();
    if (canvas) {
      this.heatLayer.addRenderable(new WorldWind.SurfaceImage(WorldWind.Sector.FULL_SPHERE, new WorldWind.ImageSource(canvas)));
    }
    this.wwd.redraw();
  }

  setHeatOpacity(opacity) {
    this.heatOpacity = opacity;
    this.heatLayer.opacity = opacity;
    this.wwd.redraw();
  }

  /** Crosshair marker for the Earth reference point (null clears it). */
  /** Marker on the best-matching cell for the current reference (null clears it). */
  setBestMatch(pos) {
    this.bestLayer.removeAllRenderables();
    if (pos) {
      const c = document.createElement('canvas');
      c.width = c.height = 72;
      const g = c.getContext('2d');
      g.translate(36, 36);
      g.strokeStyle = 'rgba(26,152,80,0.55)'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); g.stroke();
      g.rotate(Math.PI / 4);
      g.fillStyle = '#1a9850'; g.fillRect(-11, -11, 22, 22);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(-11, -11, 22, 22);
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = new WorldWind.ImageSource(c);
      attrs.imageScale = 0.6;
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      attrs.labelAttributes.color = new WorldWind.Color(0.6, 1, 0.7, 1);
      attrs.labelAttributes.font = new WorldWind.Font(14, 'normal', 'normal', '700', 'Rajdhani, sans-serif');
      attrs.labelAttributes.offset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, -0.9);
      const pm = new WorldWind.Placemark(new WorldWind.Position(pos.lat, pos.lon, 0), false, attrs);
      pm.altitudeMode = WorldWind.CLAMP_TO_GROUND;
      pm.alwaysOnTop = true;
      pm.label = pos.label || 'BEST MATCH';
      this.bestLayer.addRenderable(pm);
    }
    this.wwd.redraw();
  }

  setReference(pos) {
    this.refLayer.removeAllRenderables();
    if (pos) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.strokeStyle = '#ffffff'; g.lineWidth = 3;
      g.beginPath(); g.arc(32, 32, 14, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(32, 2); g.lineTo(32, 18); g.moveTo(32, 46); g.lineTo(32, 62);
      g.moveTo(2, 32); g.lineTo(18, 32); g.moveTo(46, 32); g.lineTo(62, 32); g.stroke();
      g.fillStyle = '#1a9850'; g.beginPath(); g.arc(32, 32, 6, 0, Math.PI * 2); g.fill();
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = new WorldWind.ImageSource(c);
      attrs.imageScale = 0.6;
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      attrs.labelAttributes.color = WorldWind.Color.WHITE;
      attrs.labelAttributes.font = new WorldWind.Font(13, 'normal', 'normal', '600', 'Rajdhani, sans-serif');
      attrs.labelAttributes.offset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, -0.9);
      const pm = new WorldWind.Placemark(new WorldWind.Position(pos.lat, pos.lon, 0), false, attrs);
      pm.altitudeMode = WorldWind.CLAMP_TO_GROUND;
      pm.alwaysOnTop = true;
      pm.label = pos.label || '';
      this.refLayer.addRenderable(pm);
    }
    this.wwd.redraw();
  }

  /* ---------------- markers ---------------- */
  markerImage(color, size = 64) {
    const key = (this.simple ? 'pin' : 'hud') + color;
    if (this.markerCache[key]) return this.markerCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    if (this.simple) {
      // friendly round pin: soft shadow, white rim, solid colour
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 6; g.shadowOffsetY = 2;
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(m, m, m * 0.5, 0, Math.PI * 2); g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = color;
      g.beginPath(); g.arc(m, m, m * 0.38, 0, Math.PI * 2); g.fill();
      return (this.markerCache[key] = new WorldWind.ImageSource(c));
    }
    g.translate(m, m);
    g.strokeStyle = color; g.globalAlpha = 0.35; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, m * 0.82, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1; g.rotate(Math.PI / 4);
    const s = m * 0.42;
    g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(-s, -s, s * 2, s * 2);
    g.lineWidth = 3; g.strokeStyle = color; g.strokeRect(-s, -s, s * 2, s * 2);
    g.fillStyle = color; g.fillRect(-s * 0.4, -s * 0.4, s * 0.8, s * 0.8);
    return (this.markerCache[key] = new WorldWind.ImageSource(c));
  }

  /**
   * Simple view: round pins with names only on hover / selection, north-up
   * camera with no tilt, and range limits that keep the planet in view.
   */
  setSimple(on) {
    this.simple = on;
    if (this.siteItems) this.setSites(this.siteItems);
    this.applyLighting();
    this.wwd.redraw();
  }

  /** Simple view lights the side facing you (no night side); Detailed shows real day/night. */
  applyLighting() {
    if (this.atmosphere) this.atmosphere.time = this.simple ? null : new Date();
  }

  /** Names always in Detailed view; in Simple view only for the hovered / selected site. */
  refreshLabels() {
    this.placemarks.forEach((pm, id) => {
      const show = !this.simple || pm === this.highlighted || id === this.selectedId;
      pm.label = show ? pm.userProperties.site.name.toUpperCase() : null;
    });
  }

  /** sites: array of { site, color } */
  setSites(items) {
    this.siteItems = items;
    this.siteLayer.removeAllRenderables();
    this.placemarks.clear();
    this.rebuildZones(items.map((i) => i.site));
    items.forEach(({ site, color }) => {
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = this.markerImage(color);
      attrs.imageScale = this.simple ? 0.45 : 0.5;
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      attrs.labelAttributes.color = WorldWind.Color.WHITE;
      attrs.labelAttributes.font = new WorldWind.Font(this.simple ? 15 : 13, 'normal', 'normal', '600', 'Rajdhani, sans-serif');
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
    this.highlighted = null;
    this.refreshLabels();
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
    this.refreshLabels();
    this.wwd.redraw();
  }

  /* ---------------- point probe ---------------- */
  probeSprite(color, size = 96) {
    const key = 'probe' + color;
    if (this.markerCache[key]) return this.markerCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.arc(m, m, m * 0.42, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2;
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
      g.beginPath(); g.moveTo(m + dx * m * 0.18, m + dy * m * 0.18); g.lineTo(m + dx * m * 0.95, m + dy * m * 0.95); g.stroke();
    });
    g.fillStyle = color; g.fillRect(m - 2.5, m - 2.5, 5, 5);
    return (this.markerCache[key] = new WorldWind.ImageSource(c));
  }

  /** Crosshair + operating-radius circle at a probed point; null clears it. */
  setProbe(p) {
    this.probeLayer.removeAllRenderables();
    if (p) {
      const color = this.body.tactical.accent;
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = this.probeSprite(color);
      attrs.imageScale = 0.55;
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      const pm = new WorldWind.Placemark(new WorldWind.Position(p.lat, p.lon, 0), false, attrs);
      pm.altitudeMode = WorldWind.CLAMP_TO_GROUND;
      pm.alwaysOnTop = true;
      this.probeLayer.addRenderable(pm);

      const ring = new WorldWind.ShapeAttributes(null);
      const n = parseInt(color.slice(1), 16);
      const rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      ring.outlineColor = new WorldWind.Color(...rgb, 0.95);
      ring.interiorColor = new WorldWind.Color(...rgb, 0.14);
      ring.outlineWidth = 2;
      this.probeLayer.addRenderable(new WorldWind.SurfaceCircle(new WorldWind.Location(p.lat, p.lon), p.radiusM, ring));
    }
    this.wwd.redraw();
  }

  /* ---------------- point probe ---------------- */
  probeSprite(color, size = 96) {
    const key = 'probe' + color;
    if (this.markerCache[key]) return this.markerCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    g.strokeStyle = color; g.lineWidth = 3;
    g.beginPath(); g.arc(m, m, m * 0.42, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2;
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
      g.beginPath(); g.moveTo(m + dx * m * 0.18, m + dy * m * 0.18); g.lineTo(m + dx * m * 0.95, m + dy * m * 0.95); g.stroke();
    });
    g.fillStyle = color; g.fillRect(m - 2.5, m - 2.5, 5, 5);
    return (this.markerCache[key] = new WorldWind.ImageSource(c));
  }

  /** Crosshair + operating-radius circle at a probed point; null clears it. */
  setProbe(p) {
    this.probeLayer.removeAllRenderables();
    if (p) {
      const color = this.body.tactical.accent;
      const attrs = new WorldWind.PlacemarkAttributes(null);
      attrs.imageSource = this.probeSprite(color);
      attrs.imageScale = 0.55;
      attrs.imageOffset = new WorldWind.Offset(WorldWind.OFFSET_FRACTION, 0.5, WorldWind.OFFSET_FRACTION, 0.5);
      const pm = new WorldWind.Placemark(new WorldWind.Position(p.lat, p.lon, 0), false, attrs);
      pm.altitudeMode = WorldWind.CLAMP_TO_GROUND;
      pm.alwaysOnTop = true;
      this.probeLayer.addRenderable(pm);

      const ring = new WorldWind.ShapeAttributes(null);
      const n = parseInt(color.slice(1), 16);
      const rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      ring.outlineColor = new WorldWind.Color(...rgb, 0.95);
      ring.interiorColor = new WorldWind.Color(...rgb, 0.14);
      ring.outlineWidth = 2;
      this.probeLayer.addRenderable(new WorldWind.SurfaceCircle(new WorldWind.Location(p.lat, p.lon), p.radiusM, ring));
    }
    this.wwd.redraw();
  }

  highlight(siteId) {
    if (this.highlighted) this.highlighted.highlighted = false;
    this.highlighted = siteId ? this.placemarks.get(siteId) || null : null;
    if (this.highlighted) this.highlighted.highlighted = true;
    this.refreshLabels();
    this.wwd.redraw();
  }

  /* ---------------- camera ---------------- */
  get radius() { return this.body ? this.body.radiusM : 6378137; }

  /** Range in metres for a "site close-up", scaled to the body. */
  siteRange() { return this.radius * 0.35; }

  flyTo(lat, lon, range = this.siteRange(), done, travelMs = 2200) {
    this.markInteraction();
    this.cancelAnimation();
    const anim = new WorldWind.GoToAnimator(this.wwd);
    anim.travelTime = travelMs;
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

  /** True when the globe is actually turning right now (auto-rotate on and not paused by user input). */
  isAutoRotating() { return this.autoRotate && performance.now() - this.lastInteraction > CAMERA.idleResumeMs; }

  /**
   * Smoothly zoom back out to the home distance and straighten any tilt/heading,
   * keeping whatever spot is in the middle. Resolves at once when already there.
   */
  pullBackToHome(ms = 650) {
    const nav = this.wwd.navigator;
    const target = CAMERA.homeRangeRadii * this.radius;
    const heading = ((nav.heading + 540) % 360) - 180;
    if (Math.abs(nav.range / target - 1) < 0.03 && Math.abs(nav.tilt) < 0.5 && Math.abs(heading) < 0.5) return Promise.resolve();
    this.cancelAnimation();
    const from = { range: nav.range, tilt: nav.tilt, heading };
    const t0 = performance.now();
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    return new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms), e = ease(k);
        // interpolate range geometrically so the zoom speed feels even
        nav.range = from.range * Math.pow(target / from.range, e);
        nav.tilt = from.tilt * (1 - e);
        nav.heading = from.heading * (1 - e);
        this.wwd.redraw();
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Point the camera straight down at (lat, lon) instantly, keeping the zoom. */
  lookAt(lat, lon) {
    const nav = this.wwd.navigator;
    this.cancelAnimation();
    nav.lookAtLocation.latitude = lat;
    nav.lookAtLocation.longitude = lon;
    nav.heading = 0; nav.tilt = 0;
    this.wwd.redraw();
  }

  /* ---------------- input & loop ---------------- */
  markInteraction() { this.lastInteraction = performance.now(); }

  bindInput() {
    const c = this.canvas;
    ['pointerdown', 'wheel', 'touchstart'].forEach((e) =>
      c.addEventListener(e, () => this.markInteraction(), { passive: true }));

    let down = null;
    c.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
      // marker → site briefing; bare ground → point probe; empty space → backdrop click
      const site = this.pickSite(e.clientX, e.clientY);
      if (site) { this.emit('select', site); return; }
      const t = this.terrainAt(e.clientX, e.clientY);
      if (t) this.emit('probe', t);
      else this.emit('space', { x: e.clientX, y: e.clientY });
    });

    c.addEventListener('pointermove', (e) => {
      const site = this.pickSite(e.clientX, e.clientY);
      this.emit('hover', site);
      const t = this.terrainAt(e.clientX, e.clientY);
      c.style.cursor = site ? 'pointer' : t ? 'crosshair' : '';
      this.emit('cursor', t);
      this.emit('pointer', { x: e.clientX, y: e.clientY, onGlobe: !!(site || t) });
    });
  }

  terrainAt(x, y) {
    const t = this.wwd.pickTerrain(this.wwd.canvasCoordinates(x, y)).terrainObject();
    return t ? { lat: t.position.latitude, lon: t.position.longitude } : null;
  }

  /** Camera pose, for the minimap and the space backdrop. */
  cameraState() {
    const nav = this.wwd.navigator;
    return { lat: nav.lookAtLocation.latitude, lon: nav.lookAtLocation.longitude, range: nav.range, heading: nav.heading, tilt: nav.tilt };
  }

  /** On-screen radius of the globe disc in CSS px (found by probing outward from the centre). */
  screenRadiusPx() {
    const r = this.canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const max = Math.hypot(r.width, r.height) / 2;
    if (this.terrainAt(cx + max, cy)) return max; // globe fills the screen
    let lo = 0, hi = max;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      if (this.terrainAt(cx + mid, cy)) lo = mid; else hi = mid;
    }
    return lo;
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

  /** Simple view: ease tilt / heading back to a straight-down, north-up view and keep the range in bounds. */
  applySimpleNav(dt) {
    const nav = this.wwd.navigator;
    const k = Math.min(1, dt * 6);
    let changed = false;
    if (Math.abs(nav.tilt) > 0.05) { nav.tilt -= nav.tilt * k; changed = true; } else if (nav.tilt) { nav.tilt = 0; changed = true; }
    if (nav.roll) { nav.roll = 0; changed = true; }
    const h = ((nav.heading + 540) % 360) - 180;
    if (Math.abs(h) > 0.05) { nav.heading = h - h * k; changed = true; } else if (nav.heading) { nav.heading = 0; changed = true; }
    const r = this.radius;
    const lo = SIMPLE_NAV.minRangeRadii * r, hi = SIMPLE_NAV.maxRangeRadii * r;
    if (nav.range < lo) { nav.range = lo; changed = true; }
    if (nav.range > hi) { nav.range = hi; changed = true; }
    if (changed) this.wwd.redraw();
  }

  /** Image tiles still being downloaded by the visible layers. */
  tilesPending() {
    let n = 0;
    this.wwd.layers.forEach((l) => { if (l.enabled && l.currentRetrievals) n += Object.keys(l.currentRetrievals).length; });
    return n;
  }

  /**
   * Resolves once the globe has drawn its imagery (no tile downloads for a few
   * checks in a row), or after maxMs so a slow network never blocks the app.
   */
  whenSettled(maxMs = 3000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      let calm = 0;
      const check = () => {
        this.wwd.redraw();
        calm = this.tilesPending() === 0 ? calm + 1 : 0;
        if (calm >= 3 || performance.now() - t0 > maxMs) resolve();
        else setTimeout(check, 100);
      };
      setTimeout(check, 150);
    });
  }

  /** Gently re-centre the camera on a point, keeping the current zoom. */
  centreOn(lat, lon) {
    this.flyTo(lat, lon, this.wwd.navigator.range, undefined, SIMPLE_NAV.centreOnClickMs);
  }

  startLoop() {
    let prev = performance.now();
    let lastCamEmit = 0;
    const tick = (now) => {
      const dt = (now - prev) / 1000; prev = now;
      if (this.body && this.simple) this.applySimpleNav(dt);
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
