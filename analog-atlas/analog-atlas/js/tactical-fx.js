/**
 * Tactical-view image effects. Pure canvas code, no WorldWind dependency, so
 * they can be unit-tested or reused elsewhere.
 *
 * All parameters are FIXED (no per-tile normalisation) so neighbouring tiles
 * line up without visible seams.
 */

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toCanvas(img, w = img.width, h = img.height) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  return { c, g };
}

/**
 * Monochrome "map print": luminance → gamma → posterised bands → dark-to-accent
 * ramp, with Sobel edges (crater rims, ridges, coastlines) added as bright lines.
 */
export function stylizeImagery(img, accentHex, opts = {}) {
  const { bands = 6, gamma = 0.85, edgeGain = 2.2, edgeFloor = 18, floor = 0.06, ceil = 0.62 } = opts;
  const [ar, ag, ab] = hexToRgb(accentHex);
  const { c, g } = toCanvas(img);
  const w = c.width, h = c.height;
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; p < L.length; i += 4, p++) L[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = Math.pow(L[p], gamma);
      v = Math.floor(v * bands) / (bands - 1);          // posterise
      let t = floor + Math.min(1, v) * (ceil - floor);   // keep it dark overall
      // Sobel edge magnitude
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const a = L[p - w - 1], b = L[p - w], cc = L[p - w + 1], dd = L[p - 1], f = L[p + 1], gg = L[p + w - 1], hh = L[p + w], ii = L[p + w + 1];
        const gx = (cc + 2 * f + ii) - (a + 2 * dd + gg);
        const gy = (gg + 2 * hh + ii) - (a + 2 * b + cc);
        const e = Math.sqrt(gx * gx + gy * gy) * 255;
        if (e > edgeFloor) t = Math.min(1, t + ((e - edgeFloor) / 255) * edgeGain);
      }
      const i = p * 4;
      // ramp: near-black blue-grey → accent
      d[i] = 6 + t * (ar - 6);
      d[i + 1] = 9 + t * (ag - 9);
      d[i + 2] = 12 + t * (ab - 12);
      d[i + 3] = 255;
    }
  }
  g.putImageData(id, 0, 0);
  return c;
}

/** Hue in [0,1), saturation, value for an RGB triple. */
function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), dlt = max - min;
  let hh = 0;
  if (dlt) {
    if (max === r) hh = ((g - b) / dlt) % 6;
    else if (max === g) hh = (b - r) / dlt + 2;
    else hh = (r - g) / dlt + 4;
    hh /= 6; if (hh < 0) hh += 1;
  }
  return [hh, max ? dlt / max : 0, max / 255];
}

/**
 * Contour lines from an elevation-coded tile, on a transparent canvas.
 *   mode 'gray' — luminance is elevation (e.g. LOLA DEM greyscale)
 *   mode 'hue'  — hue is elevation (colour-ramp DEMs / colour shaded relief)
 * A pixel is on a contour where its elevation class differs from its right or
 * lower neighbour. Every `majorEvery`-th class boundary is drawn brighter.
 */
export function contourTile(img, accentHex, opts = {}) {
  const { mode = 'gray', classes = 24, majorEvery = 4, minorAlpha = 110, majorAlpha = 235, minSat = 0.18, minVal = 0.1 } = opts;
  const [ar, ag, ab] = hexToRgb(accentHex);
  const { c, g } = toCanvas(img);
  const w = c.width, h = c.height;
  const src = g.getImageData(0, 0, w, h).data;
  const cls = new Int16Array(w * h);
  for (let i = 0, p = 0; p < cls.length; i += 4, p++) {
    if (src[i + 3] < 20) { cls[p] = -1; continue; }
    if (mode === 'gray') {
      cls[p] = Math.floor(((src[i] + src[i + 1] + src[i + 2]) / 765) * classes);
    } else {
      const [hh, s, v] = hsv(src[i], src[i + 1], src[i + 2]);
      // colour ramps run blue (low) → red/white (high): reverse hue so classes increase with height
      cls[p] = (s < minSat || v < minVal) ? -1 : Math.floor((1 - hh) * classes) % classes;
    }
  }
  const out = g.createImageData(w, h);
  const o = out.data;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const p = y * w + x, a = cls[p];
      if (a < 0) continue;
      const r = cls[p + 1], b = cls[p + w];
      let edge = -1;
      if (r >= 0 && r !== a) edge = Math.max(a, r);
      if (b >= 0 && b !== a) edge = Math.max(edge, Math.max(a, b));
      if (edge < 0) continue;
      const i = p * 4;
      o[i] = ar; o[i + 1] = ag; o[i + 2] = ab;
      o[i + 3] = edge % majorEvery === 0 ? majorAlpha : minorAlpha;
    }
  }
  g.clearRect(0, 0, w, h);
  g.putImageData(out, 0, 0);
  return c;
}

/** Diagonal-hatched disc with a ring, for target zones (equirectangular canvas). */
export function hatchDisc(accentHex, size = 256, { fullCap = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.save();
  if (!fullCap) { g.beginPath(); g.ellipse(size / 2, size / 2, size / 2 - 2, size / 2 - 2, 0, 0, Math.PI * 2); g.clip(); }
  g.strokeStyle = accentHex; g.globalAlpha = 0.45; g.lineWidth = 3;
  for (let k = -size; k < size * 2; k += 14) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k - size, size); g.stroke(); }
  g.restore();
  return c;
}

/** Ring sprite for the pulsing "selected target" marker. */
export function ringSprite(accentHex, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.strokeStyle = accentHex; g.lineWidth = 4;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.5; g.lineWidth = 2;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 14, 0, Math.PI * 2); g.stroke();
  // corner ticks
  g.globalAlpha = 1; g.lineWidth = 4;
  [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([sx, sy]) => {
    const x = sx * size, y = sy * size, dx = sx ? -1 : 1, dy = sy ? -1 : 1;
    g.beginPath(); g.moveTo(x + dx * 2, y + dy * 22); g.lineTo(x + dx * 2, y + dy * 2); g.lineTo(x + dx * 22, y + dy * 2); g.stroke();
  });
  return c;
}
