/* global WorldWind */
/**
 * Small DOM renderings of whole planets, shared by the space backdrop and the
 * minimap: a spinning CSS sphere, and a flat equirectangular map.
 */
import { TREK_BASE } from './config.js';

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
