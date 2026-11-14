/* global WorldWind */
/**
 * Imagery layer factories. Every source used here is NASA:
 *   - Moon/Mars Trek WMTS tiles (JPL / SSERVI)
 *   - GIBS WMS (NASA Earth Science Data Systems)
 *   - Blue Marble Next Generation bundled with WebWorldWind
 */
import { TREK_BASE, GIBS_WMS } from './config.js';
import { hatchDisc, TACTICAL_FX } from './tactical-fx.js';

const DETAIL = 1.5; // lower = sharper (more tiles); WorldWind default is 1.75

/**
 * Moon/Mars Trek WMTS layer as a WorldWind TiledImageLayer.
 * Trek's equirectangular matrices: level 0 = 2 cols × 1 row of 180° tiles,
 * rows counted from the NORTH. WorldWind counts rows from the SOUTH, so flip.
 */
export function createTrekLayer(def) {
  const mime = def.ext === 'png' ? 'image/png' : 'image/jpeg';
  const layer = new WorldWind.TiledImageLayer(
    WorldWind.Sector.FULL_SPHERE,
    new WorldWind.Location(180, 180),
    def.levels, mime, `trek/${def.body}/${def.layer}`, 256, 256);
  layer.displayName = def.label;
  layer.detailControl = DETAIL;
  layer.urlBuilder = {
    urlForTile(tile) {
      const z = tile.level.levelNumber;
      const row = (1 << z) - 1 - tile.row;
      return `${TREK_BASE}/${def.body}/EQ/${def.layer}/1.0.0/default/default028mm/${z}/${row}/${tile.column}.${def.ext}`;
    },
  };
  return layer;
}

/** NASA GIBS WMS layer (EPSG:4326, 256 px tiles, 36° level-zero tiles). */
export function createGibsLayer(def) {
  const layer = new WorldWind.WmsLayer({
    service: GIBS_WMS,
    layerNames: def.layer,
    styleNames: '',
    title: def.label,
    sector: WorldWind.Sector.FULL_SPHERE,
    levelZeroDelta: new WorldWind.Location(36, 36),
    numLevels: def.levels,
    format: def.format || 'image/jpeg',
    size: 256,
    coordinateSystem: 'EPSG:4326',
    version: '1.3.0',
  }, def.time || null);
  layer.detailControl = DETAIL;
  return layer;
}

/**
 * Build a layer from a config entry. Optional `transform(image) -> canvas`
 * runs on every tile before it becomes a texture (used by the Tactical view);
 * `cacheTag` keeps transformed tiles separate from the originals in the cache.
 */
export function createLayer(def, { transform = null, cacheTag = '' } = {}) {
  let layer;
  if (def.source === 'trek') layer = createTrekLayer(def);
  else if (def.source === 'gibs') layer = createGibsLayer(def);
  else throw new Error(`Unknown layer source: ${def.source}`);
  if (transform) {
    layer.cachePath += `#${cacheTag || 'fx'}`;
    layer.createTexture = (dc, tile, image) => new WorldWind.Texture(dc.currentGlContext, transform(image));
  }
  return layer;
}

/** Bundled Blue Marble (offline Earth fallback), visible at every altitude. */
export function createBundledEarth() {
  const l = new WorldWind.BMNGOneImageLayer();
  l.minActiveAltitude = 0; // library default hides it below 3,000 km
  return l;
}

/**
 * Procedural placeholder surface for bodies whose imagery can't be fetched:
 * a mottled sphere in the body's colour, so the globe is never invisible.
 */
export function createPlaceholderSurface(hexColor, transform = null) {
  const w = 1024, h = 512;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = hexColor;
  g.fillRect(0, 0, w, h);
  // deterministic pseudo-random "craters" so it doesn't look flat
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 700; i++) {
    const x = rnd() * w, y = rnd() * h, r = 2 + rnd() ** 3 * 28;
    g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.06})`;
    g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, Math.PI * 2); g.fill();
  }
  // faint graticule, tactical-map style
  g.strokeStyle = 'rgba(255,214,0,0.12)'; g.lineWidth = 1;
  for (let lon = 0; lon <= w; lon += w / 24) { g.beginPath(); g.moveTo(lon, 0); g.lineTo(lon, h); g.stroke(); }
  for (let lat = 0; lat <= h; lat += h / 12) { g.beginPath(); g.moveTo(0, lat); g.lineTo(w, lat); g.stroke(); }

  const layer = new WorldWind.RenderableLayer('Placeholder');
  layer.addRenderable(new WorldWind.SurfaceImage(WorldWind.Sector.FULL_SPHERE, new WorldWind.ImageSource(transform ? transform(c) : c)));
  return layer;
}

/** Bundled Blue Marble passed through a canvas transform (offline Tactical view). */
export function createBundledEarthStyled(transform, onReady = () => {}) {
  const layer = new WorldWind.RenderableLayer('Blue Marble (tactical)');
  const img = new Image();
  img.onload = () => {
    layer.addRenderable(new WorldWind.SurfaceImage(WorldWind.Sector.FULL_SPHERE, new WorldWind.ImageSource(transform(img))));
    onReady();
  };
  img.src = WorldWind.configuration.baseUrl + 'images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg';
  return layer;
}

/* ---------------------------- Tactical overlays ---------------------------- */

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return new WorldWind.Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
};

/** Lat/lon sector grid, equator emphasised. */
export function createGridLayer(accentHex, stepDeg = 15) {
  const layer = new WorldWind.RenderableLayer('Sector grid');
  const minor = new WorldWind.ShapeAttributes(null);
  minor.outlineColor = rgba(accentHex, TACTICAL_FX.gridMinor); minor.outlineWidth = 1; minor.drawInterior = false;
  const major = new WorldWind.ShapeAttributes(minor);
  major.outlineColor = rgba(accentHex, TACTICAL_FX.gridMajor); major.outlineWidth = 1.5;
  for (let lon = -180; lon < 180; lon += stepDeg) {
    const pts = [];
    for (let lat = -88; lat <= 88; lat += 4) pts.push(new WorldWind.Location(lat, lon));
    layer.addRenderable(new WorldWind.SurfacePolyline(pts, lon === 0 ? major : minor));
  }
  for (let lat = -90 + stepDeg; lat < 90; lat += stepDeg) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 3) pts.push(new WorldWind.Location(lat, lon));
    layer.addRenderable(new WorldWind.SurfacePolyline(pts, lat === 0 ? major : minor));
  }
  layer.pickEnabled = false;
  return layer;
}

/**
 * Hatched circular "operation zones" around sites, with a solid ring.
 * radiusM is the zone radius in metres; bodyRadiusM converts it to degrees.
 */
export function createZoneLayer(sites, accentHex, radiusM, bodyRadiusM) {
  const layer = new WorldWind.RenderableLayer('Target zones');
  const ringAttrs = new WorldWind.ShapeAttributes(null);
  ringAttrs.drawInterior = false;
  ringAttrs.outlineColor = rgba(accentHex, TACTICAL_FX.zoneRing);
  ringAttrs.outlineWidth = 2;
  const disc = new WorldWind.ImageSource(hatchDisc(accentHex));
  const cap = new WorldWind.ImageSource(hatchDisc(accentHex, 256, { fullCap: true }));
  const dLat = (radiusM / bodyRadiusM) * (180 / Math.PI);

  sites.forEach((s) => {
    const nearPole = Math.abs(s.lat) + dLat > 88;
    let sector, src;
    if (nearPole) {
      // equirectangular discs break down at the pole: hatch the whole polar cap instead
      sector = s.lat < 0
        ? new WorldWind.Sector(-90, Math.min(-90 + (90 + s.lat) + dLat, 90), -180, 180)
        : new WorldWind.Sector(Math.max(90 - (90 - s.lat) - dLat, -90), 90, -180, 180);
      src = cap;
    } else {
      const dLon = Math.min(180, dLat / Math.cos((s.lat * Math.PI) / 180));
      sector = new WorldWind.Sector(s.lat - dLat, s.lat + dLat, s.lon - dLon, s.lon + dLon);
      src = disc;
    }
    layer.addRenderable(new WorldWind.SurfaceImage(sector, src));
    layer.addRenderable(new WorldWind.SurfaceCircle(new WorldWind.Location(s.lat, s.lon), radiusM, ringAttrs));
  });
  layer.pickEnabled = false;
  return layer;
}

/**
 * Check whether NASA tile servers are reachable from this page (they are not
 * inside a CSP-sandboxed artifact). Resolves to true/false within `timeoutMs`.
 */
export function probeOnline(timeoutMs = 5000) {
  const testTile = `${TREK_BASE}/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/0/0/0.jpg`;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => { img.src = ''; resolve(false); }, timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(true); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = testTile;
  });
}
