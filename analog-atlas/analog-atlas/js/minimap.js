/**
 * Minimap panel: a flat map of the current body (camera view box, sites and
 * the probed point), plus small maps of the two other bodies pinning where
 * the probed point's best match is on each.
 */
import { BODIES } from './config.js';
import { mapHTML, mapXY } from './planet-art.js';

const pos = (el, lat, lon) => {
  const p = mapXY(lat, lon);
  el.style.left = `${p.x * 100}%`;
  el.style.top = `${p.y * 100}%`;
};

export class MiniMap {
  /**
   * handlers: onPick(lat, lon)           click on the main map
   *           onPickMatch(targetBodyId)  click on a Moon / Mars map
   */
  constructor(el, { online, onPick, onPickMatch }) {
    this.el = el;
    this.online = online;
    el.innerHTML = `
      <div class="panel-head"><span>MINI MAP</span><span class="src-tag mm-body"></span></div>
      <div class="mm-main mm-map"><div class="mm-view"></div><div class="mm-sites"></div><div class="mm-pin probe hidden"></div></div>
      <div class="mm-row"></div>
      <div class="mm-foot">Click the big map to fly there · click a small map to visit the best match</div>`;
    this.main = el.querySelector('.mm-main');
    this.view = el.querySelector('.mm-view');
    this.row = el.querySelector('.mm-row');

    this.main.addEventListener('click', (e) => {
      const r = this.main.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      onPick(90 - y * 180, x * 360 - 180);
    });
    this.row.addEventListener('click', (e) => {
      const b = e.target.closest('.mm-small');
      if (b && !b.classList.contains('empty')) onPickMatch(b.dataset.target);
    });
  }

  /** Main map = current body; small maps = the two bodies it is compared with. */
  setBody(bodyId) {
    this.bodyId = bodyId;
    this.el.dataset.body = bodyId;
    this.el.querySelector('.mm-body').textContent = BODIES[bodyId].label;
    this.main.querySelector('.flatmap')?.remove();
    this.main.insertAdjacentHTML('afterbegin', mapHTML(BODIES[bodyId], this.online));
    this.row.innerHTML = Object.values(BODIES).filter((b) => b.enabled && b.id !== bodyId).map((b) => `
      <button class="mm-small" data-target="${b.id}" title="Show the best match on ${b.label}">
        <div class="mm-cap"><span>${b.label}</span><span class="mm-score">—</span></div>
        <div class="mm-map">${mapHTML(b, this.online)}<div class="mm-pin match hidden"></div></div>
      </button>`).join('');
    this.setProbe(null);
  }

  setSites(sites, color) {
    const box = this.main.querySelector('.mm-sites');
    box.innerHTML = '';
    sites.forEach((s) => {
      const d = document.createElement('i');
      d.style.background = color(s);
      d.title = s.name;
      pos(d, s.lat, s.lon);
      box.appendChild(d);
    });
  }

  /** Rough footprint of the camera view on the map. */
  setCamera({ lat, lon, range }) {
    const R = BODIES[this.bodyId].radiusM;
    const half = Math.min(90, ((range * 0.42) / R) * (180 / Math.PI));   // half-height, degrees
    const halfLon = Math.min(180, half / Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    const v = this.view.style;
    v.width = `${(halfLon * 2 / 360) * 100}%`;
    v.height = `${(half * 2 / 180) * 100}%`;
    pos(this.view, lat, lon);
  }

  /** result = analysePoint output, or null. */
  setProbe(result) {
    const mainPin = this.main.querySelector('.mm-pin.probe');
    mainPin.classList.toggle('hidden', !result);
    if (result) pos(mainPin, result.lat, result.lon);
    this.el.querySelectorAll('.mm-small').forEach((b) => {
      const t = b.dataset.target;
      const m = result && result.matches[t];
      b.classList.toggle('empty', !m);
      b.querySelector('.mm-score').textContent = m ? `${Math.round(m.score * 100)}%` : '—';
      const pin = b.querySelector('.mm-pin.match');
      pin.classList.toggle('hidden', !m);
      if (m) pos(pin, m.lat, m.lon);
    });
  }
}
