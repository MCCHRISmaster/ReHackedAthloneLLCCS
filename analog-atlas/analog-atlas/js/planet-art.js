/* global WorldWind */
/**
 * Small DOM renderings of whole planets, shared by the space backdrop and the
 * minimap: a spinning CSS sphere, and a flat equirectangular map.
 */
import { TREK_BASE, GIBS_WMS, CAMERA, ILLUSTRATED, TACTICAL } from './config.js';
import { stylizeImagery, contourTile, illustrateImagery, TACTICAL_FX } from './tactical-fx.js';

/** Equirectangular map image(s) for a body: one 2:1 image, or Trek's two 1:1 level-0 tiles (west, east). */
export function planetTexture(body, online) {
  if (body.id === 'earth') return [WorldWind.configuration.baseUrl + 'images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg'];
  const def = body.layers.find((l) => l.id === body.defaultLayer);
  if (!online || !def || def.source !== 'trek') return [];
  const base = `${TREK_BASE}/${def.body}/EQ/${def.layer}/1.0.0/default/default028mm/0/0`;
  return [`${base}/0.${def.ext}`, `${base}/1.${def.ext}`];
}

const imgs = (tex, copies) => Array.from({ length: copies }, () => tex).flat().map((src) =>
  `<img src="${src}" alt="" draggable="false" style="width:${100 / (tex.length * copies)}%" onerror="this.parentNode.classList.add('failed')">`).join('');

/** A shaded sphere whose surface strip scrolls (spins). Procedural look when there is no imagery. */
export function sphereHTML(body, online) {
  const tex = planetTexture(body, online);
  return `<span class="sphere" data-body="${body.id}" style="--base:${body.fallbackColor}">
      <span class="sphere-surface ${tex.length ? '' : 'procedural'}">${imgs(tex, 2)}</span>
      <span class="sphere-shade"></span>
    </span>`;
}

/** Flat map of the whole body (lon −180..180 left→right, lat 90..−90 top→bottom). */
export function mapHTML(body, online) {
  const tex = planetTexture(body, online);
  return `<span class="flatmap ${tex.length ? '' : 'procedural'}" data-body="${body.id}" style="--base:${body.fallbackColor}">${imgs(tex, 1)}</span>`;
}

/** lat/lon → fractional position on a flat map. */
export const mapXY = (lat, lon) => ({ x: (lon + 180) / 360, y: (90 - lat) / 180 });

/* ------------------------------------------------------------------------ *
 *  Real 3-D globe sprite: the body's NASA imagery (the SAME layer the main
 *  WorldWind globe shows by default, at 2048 px) projected onto a sphere and
 *  spun on its axis. Drawn on a small 2-D canvas, orthographic projection,
 *  per pixel, with mip-mapped bilinear sampling so it stays smooth (no grain
 *  or shimmer) at any size. Until the texture loads (or offline for the
 *  Moon/Mars) the CSS sphere from sphereHTML() shows instead.
 * ------------------------------------------------------------------------ */
const GLOBE3D = {
  // same speed and direction as the main globe's auto-rotate, so a stand-in and the real globe move as one
  spinDegPerSec: CAMERA.autoRotateDegPerSec,
  viewLatDeg: 18,                 // look slightly down on the north pole
  light: [-0.45, 0.4, 0.8],       // from upper-left, in front
  ambient: 0.22,
  resStep: 32, minRes: 64, maxRes: 448,
  // camera distance from the planet's centre, in radii, at the globe's home view (range + 1 radius):
  // the stand-in uses the same perspective so it lines up exactly with the WorldWind globe
  eyeDistRadii: CAMERA.homeRangeRadii + 1,
  texWidth: 2048,                 // full texture (equirectangular, 2:1)
  // Earth only: blue haze like WorldWind's ground atmosphere (light everywhere, strongest at the edge)
  haze: { earth: { rgb: [150, 192, 240], base: 0.15, edge: 0.55, power: 3 } },
};

const texCache = new Map();

/** Load a CORS image, retrying a couple of times (some networks drop connections to NASA servers). */
function loadImage(src, tries = 3) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => {
      if (tries > 1) setTimeout(() => loadImage(src, tries - 1).then(resolve, reject), 400);
      else reject(e);
    };
    img.src = src;
  });
}

/**
 * Draw one layer definition (an entry from BODIES.<id>.layers, or a tactical
 * contour source) for the whole body as one equirectangular image onto
 * canvas g (W × W/2). def = null → the bundled Blue Marble (Earth, offline).
 */
async function drawWholeBody(body, def, online, g, W) {
  const H = W / 2;
  if (online && def && def.source === 'gibs') {
    // one WMS request for the whole world, same layer as the globe
    const url = `${GIBS_WMS}SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${def.layer}&STYLES=`
      + `&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${W}&HEIGHT=${H}&FORMAT=${encodeURIComponent(def.format || 'image/jpeg')}`;
    try { g.drawImage(await loadImage(url), 0, 0, W, H); return; } catch { /* fall through to bundled */ }
  }
  if (online && def && def.source === 'trek') {
    // Trek level z has 2^(z+1) × 2^z tiles of 256 px; pick the level that fills W (capped at the layer's depth)
    const z = Math.min((def.levels || 9) - 1, Math.max(0, Math.round(Math.log2(W / 512))));
    const cols = 2 ** (z + 1), rows = 2 ** z, ts = W / cols;
    const base = `${TREK_BASE}/${def.body}/EQ/${def.layer}/1.0.0/default/default028mm/${z}`;
    const jobs = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      jobs.push(loadImage(`${base}/${r}/${c}.${def.ext}`).then((img) => g.drawImage(img, c * ts, r * ts, ts, ts)));
    }
    await Promise.all(jobs);
    return;
  }
  if (body.id === 'earth') {
    g.drawImage(await loadImage(WorldWind.configuration.baseUrl + 'images/BMNG_world.topo.bathy.200405.3.2048x1024.jpg'), 0, 0, W, H);
    return;
  }
  throw new Error('no imagery');
}

const blankCanvas = (W) => {
  const c = document.createElement('canvas');
  c.width = W; c.height = W / 2;
  return c;
};

/** Lat/lon sector grid drawn into a whole-body texture (matches the globe's Tactical grid). */
function drawGrid(c, accentHex) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height, step = TACTICAL.gridStepDeg;
  g.strokeStyle = accentHex; g.lineWidth = Math.max(1, W / 1024);
  for (let lon = -180; lon < 180; lon += step) {
    g.globalAlpha = lon === 0 ? TACTICAL_FX.gridMajor : TACTICAL_FX.gridMinor;
    const x = ((lon + 180) / 360) * W;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  for (let lat = -90 + step; lat < 90; lat += step) {
    g.globalAlpha = lat === 0 ? TACTICAL_FX.gridMajor : TACTICAL_FX.gridMinor;
    const y = ((90 - lat) / 180) * H;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * Whole-body texture for a "look" as a mip chain of ImageData (each level a
 * smooth half-size copy), so small globes sample a matching level.
 *   look.layerId   the imagery chosen for that body: a layer id, 'illustrated' or 'offline'
 *   look.tactical  restyle like the Tactical globe (stylised imagery + contours + grid)
 */
function loadTexture(body, online, look) {
  const key = `${body.id}|${look.layerId}|${look.tactical ? 'tac' : ''}`;
  if (texCache.has(key)) return texCache.get(key);
  const p = (async () => {
    const illus = look.layerId === 'illustrated';
    const srcId = illus ? ILLUSTRATED[body.id].from : look.layerId;
    let def = body.layers.find((l) => l.id === srcId) || null;
    // Tactical restyles the chosen real layer, or the body default otherwise (same rule as the globe)
    if (look.tactical && (!def || illus)) def = body.layers.find((l) => l.id === body.defaultLayer);
    let W = look.tactical ? 1024 : GLOBE3D.texWidth;   // tactical filters are costlier; 1024 is plenty for a sprite
    let c = blankCanvas(W);
    await drawWholeBody(body, online ? def : null, online, c.getContext('2d'), W);

    if (look.tactical) {
      const tac = body.tactical;
      c = stylizeImagery(c, tac.accent, tac.imagery);
      if (online) {
        try {
          const dem = blankCanvas(W);
          await drawWholeBody(body, tac.contours, online, dem.getContext('2d'), W);
          c.getContext('2d').drawImage(contourTile(dem, tac.accent, tac.contours), 0, 0);
        } catch { /* contours are optional */ }
      }
      drawGrid(c, tac.accent);
    } else if (illus) {
      c = illustrateImagery(c, ILLUSTRATED[body.id]);
    }

    const levels = [c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, W / 2)];
    while (W > 128) {
      const prev = c;
      W /= 2;
      c = blankCanvas(W);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingQuality = 'high';
      g.drawImage(prev, 0, 0, W, W / 2);
      levels.push(g.getImageData(0, 0, W, W / 2));
    }
    return levels;
  })();
  texCache.set(key, p);
  p.catch(() => texCache.delete(key));   // let a failed download be retried later
  return p;
}

export class PlanetGlobe {
  constructor(body, online) {
    this.body = body;
    this.online = online;
    this.el = document.createElement('span');
    this.el.className = 'globe3d';
    this.el.dataset.body = body.id;
    this.el.innerHTML = sphereHTML(body, online);   // fallback until the texture is ready
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.rot = Math.random() * 360;   // the longitude facing the viewer is −rot
    this.viewLat = GLOBE3D.viewLatDeg;
    this.viewLatTarget = GLOBE3D.viewLatDeg;
    this.hold = false;                 // true = stop spinning
    this.res = 0;
    this.levels = null;
    this.look = null;
    this.setLook({ layerId: online ? body.defaultLayer : 'offline', tactical: false });
  }

  /**
   * Show the body with the same imagery / Tactical styling as its globe. The
   * current texture stays up until the new one is ready, so it never goes blank.
   */
  setLook(look) {
    const key = `${look.layerId}|${look.tactical}`;
    if (this.lookKey === key) return;
    this.lookKey = key;
    loadTexture(this.body, this.online, look)
      .then((lv) => {
        if (this.lookKey !== key) return;   // superseded while loading
        this.levels = lv; this.look = look; this.res = 0;
        this.el.classList.add('ready');
        this.el.classList.toggle('tactical', !!look.tactical);
      })
      .catch(() => {
        // keep whatever is showing (or the CSS fallback); forget the key so the next sync retries
        if (this.lookKey === key) this.lookKey = null;
      });
  }

  /**
   * Face a given point to the viewer, exactly like the WorldWind globe's camera
   * looking straight down at (lat, lon). It keeps spinning exactly like the
   * auto-rotating globe, so the stand-in and the real globe line up and move
   * together when one replaces the other.
   */
  faceTo(lat, lon, { hold = false } = {}) {
    this.rot = ((-lon % 360) + 360) % 360;
    this.viewLat = this.viewLatTarget = Math.max(-89, Math.min(89, lat));
    this.hold = hold;
    this.res = 0;           // re-project for the new view latitude
  }

  /** The longitude currently facing the viewer (−180..180). */
  get centerLon() { return ((((-this.rot + 180) % 360) + 360) % 360) - 180; }

  /** Resume a gentle spin, easing back to the default slightly-from-above view. */
  release() {
    this.hold = false;
    this.viewLatTarget = GLOBE3D.viewLatDeg;
  }

  /**
   * Precompute, for each pixel of a res×res disc: the two texture rows and
   * blend weight, the base texture column, shading and edge alpha. Picks the
   * mip level whose texels are about one screen pixel at the disc centre.
   */
  prepare(res) {
    this.res = res;
    this.preparedLat = this.viewLat;
    this.canvas.width = this.canvas.height = res;
    this.img = this.ctx.createImageData(res, res);
    // centre of the disc: one texel spans W / (π · res) pixels → want W ≈ π · res
    const need = Math.PI * res;
    this.tex = this.levels.filter((l) => l.width >= need).pop() || this.levels[0];
    const W = this.tex.width, H = this.tex.height;
    const phi0 = (this.viewLat * Math.PI) / 180;
    const sp = Math.sin(phi0), cp = Math.cos(phi0);
    const [lx, ly, lz] = GLOBE3D.light;
    const ln = Math.hypot(lx, ly, lz);
    const pix = [], row0 = [], row1 = [], fy = [], col = [], shade = [], alpha = [], haze = [];
    // atmosphere haze only outside Tactical (the Tactical globe hides its atmosphere too)
    const hz = this.look && this.look.tactical ? null : GLOBE3D.haze[this.body.id];
    const r = res / 2;
    // Perspective like the WorldWind camera: the eye sits D sphere-radii from the centre, so the
    // visible cap is a bit less than a hemisphere and the edges are foreshortened. The disc edge
    // (rho = 1) is the silhouette; each pixel is a ray from the eye, intersected with the sphere.
    const D = GLOBE3D.eyeDistRadii;
    const tanA = 1 / Math.sqrt(D * D - 1);          // tan of the silhouette's angular radius
    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        const sx = (px + 0.5 - r) / r, sy = -(py + 0.5 - r) / r;   // screen position, y up
        const rho = Math.hypot(sx, sy);
        if (rho > 1) continue;
        const th = Math.atan(rho * tanA), s = Math.sin(th), c = Math.cos(th);
        const t = D * c - Math.sqrt(Math.max(0, 1 - D * D * s * s));   // eye → nearest surface hit
        const k = rho > 0 ? (t * s) / rho : 0;
        const x = sx * k, y = sy * k, z = D - t * c;                // surface point (unit sphere)
        const lat = Math.asin(Math.max(-1, Math.min(1, z * sp + y * cp)));
        const lon = Math.atan2(x, z * cp - y * sp);
        pix.push((py * res + px) * 4);
        const ty = Math.max(0, Math.min(H - 1.001, ((Math.PI / 2 - lat) / Math.PI) * H - 0.5));
        const y0 = Math.floor(ty);
        row0.push(y0 * W); row1.push(Math.min(H - 1, y0 + 1) * W); fy.push(ty - y0);
        col.push(((lon + Math.PI) / (2 * Math.PI)) * W - 0.5);
        const lambert = Math.max(0, (x * lx + y * ly + z * lz) / ln);
        shade.push(GLOBE3D.ambient + (1 - GLOBE3D.ambient) * lambert);
        alpha.push(Math.min(1, (1 - rho) * r * 1.2) * 255);       // anti-aliased rim
        haze.push(hz ? hz.base + (hz.edge - hz.base) * rho ** hz.power : 0);
      }
    }
    this.pix = Int32Array.from(pix);
    this.row0 = Int32Array.from(row0); this.row1 = Int32Array.from(row1); this.fy = Float32Array.from(fy);
    this.col = Float32Array.from(col); this.shade = Float32Array.from(shade); this.alpha = Float32Array.from(alpha);
    this.haze = Float32Array.from(haze);
    this.hazeRgb = hz ? hz.rgb : [0, 0, 0];
  }

  /**
   * Spin by dt seconds and redraw at about diameterPx on screen.
   * light: 1 = shaded sphere (background look), 0 = evenly lit (matches the WorldWind globe up front).
   */
  draw(diameterPx, dt, light = 1) {
    // the facing longitude increases, exactly as when the globe's camera auto-rotates eastward
    if (!this.hold) this.rot = ((this.rot - GLOBE3D.spinDegPerSec * dt) % 360 + 360) % 360;
    if (this.viewLat !== this.viewLatTarget) {
      const d = this.viewLatTarget - this.viewLat;
      this.viewLat = Math.abs(d) < 0.3 ? this.viewLatTarget : this.viewLat + d * Math.min(1, dt * 2);
    }
    if (!this.levels) return;
    const want = Math.max(GLOBE3D.minRes, Math.min(GLOBE3D.maxRes,
      Math.ceil((diameterPx * (window.devicePixelRatio || 1)) / GLOBE3D.resStep) * GLOBE3D.resStep));
    if (want !== this.res || Math.abs(this.viewLat - this.preparedLat) > 0.5) this.prepare(want);
    const W = this.tex.width, src = this.tex.data, out = this.img.data;
    const shift = (this.rot / 360) * W;
    const { pix, row0, row1, fy, col, shade, alpha, haze } = this;
    const [hr, hg, hb] = this.hazeRgb;
    for (let k = 0; k < pix.length; k++) {
      // bilinear sample at this pixel's texture position for the current rotation
      let tx = col[k] - shift;
      tx -= Math.floor(tx / W) * W;            // wrap into [0, W)
      const x0 = tx | 0, x1 = x0 + 1 === W ? 0 : x0 + 1, fx = tx - x0, wy = fy[k];
      const a = (row0[k] + x0) * 4, b = (row0[k] + x1) * 4, c = (row1[k] + x0) * 4, e = (row1[k] + x1) * 4;
      const w00 = (1 - fx) * (1 - wy), w10 = fx * (1 - wy), w01 = (1 - fx) * wy, w11 = fx * wy;
      const d = pix[k], f = 1 + (shade[k] - 1) * light;
      const h = haze[k], m = (1 - h) * f;
      out[d] = (src[a] * w00 + src[b] * w10 + src[c] * w01 + src[e] * w11) * m + hr * h;
      out[d + 1] = (src[a + 1] * w00 + src[b + 1] * w10 + src[c + 1] * w01 + src[e + 1] * w11) * m + hg * h;
      out[d + 2] = (src[a + 2] * w00 + src[b + 2] * w10 + src[c + 2] * w01 + src[e + 2] * w11) * m + hb * h;
      out[d + 3] = alpha[k];
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}
