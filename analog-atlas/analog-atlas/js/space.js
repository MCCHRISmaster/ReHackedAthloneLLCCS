/**
 * Space backdrop: all bodies sit on one big wheel that fills the screen. The
 * current body is at the front (where the WorldWind globe is drawn, so its
 * sprite is hidden) and the others hang on the wheel behind it, upper left and
 * upper right. Switching bodies spins the WHOLE wheel: every planet travels
 * along the same ring, so the pattern never changes, only who is in front.
 *
 * The sprites live behind the transparent WorldWind canvas, so the globe
 * always occludes them. They drift with the camera (parallax) so they stay
 * in view as you orbit.
 */
import { BODIES } from './config.js';
import { PlanetGlobe } from './planet-art.js';

const WHEEL = {
  backSize: 0.11,      // planet diameter at a back position, fraction of the viewport's short side
  rx: 0.3,             // wheel half-width, fraction of viewport width (narrowed to clear the left HUD)
  ry: 0.37,            // how far up the wheel reaches, fraction of viewport height
  spinMs: 1500,
  handoffMs: 150,      // globe → stand-in sprite cross-fade at the start
  fadeMs: 450,         // stand-in sprite → new globe fade at the end
};
const PARALLAX = { x: 0.05, y: 0.035 };  // max drift as a fraction of the viewport
const LEFT_HUD_PX = 320;                  // width of the left panel column

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const mix = (a, b, k) => a + (b - a) * k;

export class SpaceBackdrop {
  /**
   * getCamera()      → { lat, lon, heading }
   * getHomeRadius()  → on-screen radius (px) of a globe at its home view
   */
  constructor(el, { online, getCamera, getHomeRadius, getGlobeRadius }) {
    this.el = el;
    this.getCamera = getCamera;
    this.getHomeRadius = getHomeRadius;
    this.getGlobeRadius = getGlobeRadius;
    // soft halo behind the current globe (shown in Simple view via CSS)
    this.glow = document.createElement('div');
    this.glow.className = 'globe-glow';
    el.appendChild(this.glow);
    this.sprites = Object.values(BODIES).filter((b) => b.enabled).map((b) => {
      const s = document.createElement('div');
      s.className = 'space-planet';
      s.dataset.body = b.id;
      const globe = new PlanetGlobe(b, online);   // real rotating 3-D globe from NASA imagery
      s.appendChild(globe.el);
      s.insertAdjacentHTML('beforeend', `<span class="space-name">${b.label}</span>`);
      el.appendChild(s);
      return { id: b.id, el: s, globe, x: 0, y: 0, d: 0, depth: 0 };
    });
    this.lastNow = performance.now();
    this.n = this.sprites.length;
    this.pos = 0;           // wheel position, in slots (index of the body in front)
    this.spin = null;
    this.frontVisible = false;
    this.hovered = null;
    const loop = (now) => { this.frame(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  indexOf(id) { return this.sprites.findIndex((s) => s.id === id); }

  /** Instantly put bodyId in front. */
  /** Imagery / Tactical look for one body's 3-D globe: { layerId, tactical }. */
  setLook(bodyId, look) {
    const sp = this.sprites.find((s) => s.id === bodyId);
    if (sp) sp.globe.setLook(look);
  }

  setActive(bodyId) {
    this.pos = this.indexOf(bodyId);
    this.spin = null;
    this.frontVisible = false;
  }

  /** Screen placement of a sprite whose offset from the front is `rel` slots. */
  place(rel) {
    const w = window.innerWidth, h = window.innerHeight;
    const a = (rel / this.n) * Math.PI * 2;
    const depth = (Math.cos(a) + 1) / 2;                   // 1 = front, 0 = far back
    const front = 2 * this.getHomeRadius();
    const backTarget = WHEEL.backSize * Math.min(w, h);
    const back = Math.max(backTarget * 0.4, (backTarget - 0.0625 * front) / 0.9375); // = backTarget at the ±120° slots
    const d = back + (front - back) * depth * depth;

    let rx = WHEEL.rx * w;
    if (w > 820) rx = Math.max(0.18 * w, Math.min(rx, (w / 2 - LEFT_HUD_PX - backTarget / 2) / Math.sin((2 * Math.PI) / 3)));
    const cam = this.getCamera() || { lat: 0, lon: 0, heading: 0 };
    const rad = Math.PI / 180;
    const far = 1 - depth;
    const px = Math.sin((cam.lon + cam.heading) * rad) * PARALLAX.x * w * far;
    const py = Math.sin(cam.lat * rad) * PARALLAX.y * h * far;
    return {
      x: w / 2 + Math.sin(a) * rx - px,
      y: h / 2 - ((1 - Math.cos(a)) / 2) * WHEEL.ry * h + py,
      d, depth,
    };
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    let mult = null;
    if (this.spin) {
      const s = this.spin;
      const k = Math.min(1, Math.max(0, (now - s.t0) / WHEEL.spinMs));
      const e = ease(k);
      this.pos = mix(s.from, s.to, e);
      mult = { idx: s.outIdx, m: mix(s.startScale, 1, e) };
      if (k >= 1) { this.spin = null; this.pos = s.to; s.done(); }
    }
    const frontIdx = ((Math.round(this.pos) % this.n) + this.n) % this.n;

    const gr = this.getGlobeRadius ? this.getGlobeRadius() : 0;
    const gs = this.glow.style;
    const gd = gr * 2.5;
    gs.width = gs.height = `${gd}px`;
    gs.transform = `translate(${window.innerWidth / 2 - gd / 2}px, ${window.innerHeight / 2 - gd / 2}px)`;
    // hide while switching, and when zoomed in so far the globe fills the screen
    gs.opacity = this.spin || this.frontVisible || gr > Math.max(window.innerWidth, window.innerHeight) ? 0 : 1;
    this.glow.dataset.body = this.sprites[frontIdx].id;

    this.sprites.forEach((sp, i) => {
      let rel = (i - this.pos) % this.n;
      rel = ((rel + this.n * 1.5) % this.n) - this.n / 2;  // wrap into [-n/2, n/2)
      const p = this.place(rel);
      if (mult && mult.idx === i) p.d *= mult.m;            // outgoing planet starts at the globe's current size
      sp.x = p.x; sp.y = p.y; sp.d = p.d; sp.depth = p.depth;
      const hidden = !this.spin && i === frontIdx && !this.frontVisible;
      const st = sp.el.style;
      st.width = st.height = `${p.d}px`;
      st.transform = `translate(${p.x - p.d / 2}px, ${p.y - p.d / 2}px)`;
      st.opacity = hidden ? 0 : 1;
      st.visibility = hidden ? 'hidden' : 'visible';
      st.zIndex = String(Math.round(p.depth * 100));
      sp.el.classList.toggle('front', i === frontIdx);
      // only spin/redraw globes you can see; evenly lit up front (like WorldWind), shaded further back
      if (!hidden) sp.globe.draw(p.d, dt, 1 - p.depth);
    });
  }

  /** Body whose background planet is under a screen point. */
  hitTest(x, y) {
    if (this.spin) return null;
    const frontIdx = ((Math.round(this.pos) % this.n) + this.n) % this.n;
    const hit = this.sprites.find((sp, i) => i !== frontIdx && Math.hypot(x - sp.x, y - sp.y) < sp.d / 2 + 4);
    return hit ? hit.id : null;
  }

  hover(bodyId) {
    if (bodyId === this.hovered) return;
    this.hovered = bodyId;
    this.sprites.forEach((sp) => sp.el.classList.toggle('hover', sp.id === bodyId));
  }

  /**
   * Spin the wheel the short way round until bodyId is in front.
   * globeRadiusPx = current globe disc on screen. swap() is called while the
   * canvas is faded out; resolves when the new globe is showing.
   *
   * The hand-over is hidden by making the 3-D sprite an exact, moving stand-in
   * for the WorldWind globe at both ends (it spins at the globe's auto-rotate
   * speed and direction, so nothing pauses or jumps):
   *   fromView    {lat, lon, rotating} what the camera is looking at now → outgoing sprite takes over from there
   *   toView      {lat, lon} the new globe's home view → incoming sprite arrives facing it
   *   ready()     resolves once the new globe has drawn its imagery; only then does it fade in
   *   onHandBack({lat, lon}) called just before the fade: point the real camera at exactly what
   *               the incoming sprite is showing at that moment
   */
  transitionTo(bodyId, { canvas, globeRadiusPx, swap, fromView, toView, ready = () => Promise.resolve(), onHandBack = null }) {
    const to = this.indexOf(bodyId);
    const fromIdx = ((Math.round(this.pos) % this.n) + this.n) % this.n;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (to < 0 || to === fromIdx || reduced) { swap(); this.setActive(bodyId); return Promise.resolve(); }

    let delta = to - fromIdx;
    if (delta > this.n / 2) delta -= this.n;
    if (delta < -this.n / 2) delta += this.n;
    const homeR = this.getHomeRadius();
    const startScale = Math.min(3, Math.max(0.3, globeRadiusPx / homeR));
    const outgoing = this.sprites[fromIdx].globe, incoming = this.sprites[to].globe;
    // keep turning only if the real globe was turning, so the hand-over is motion-continuous
    if (fromView) outgoing.faceTo(fromView.lat, fromView.lon, { hold: !fromView.rotating });
    if (toView) incoming.faceTo(toView.lat, toView.lon);

    // quick cross-fade to the (identical-looking) sprite, then the wheel turns
    canvas.style.transition = `opacity ${WHEEL.handoffMs}ms linear`;
    canvas.style.opacity = '0';
    this.frontVisible = true;
    return new Promise((resolve) => {
      setTimeout(swap, WHEEL.handoffMs + WHEEL.spinMs * 0.4); // new globe loads while hidden
      this.spin = {
        from: this.pos, to: this.pos + delta, t0: performance.now() + WHEEL.handoffMs, outIdx: fromIdx, startScale,
        done: () => {
          outgoing.release();
          // keep the incoming sprite in place until the real globe has its imagery, then fade the globe in over it
          ready().then(() => {
            if (onHandBack) onHandBack({ lat: incoming.viewLat, lon: incoming.centerLon });
            canvas.style.transition = `opacity ${WHEEL.fadeMs}ms ease`;
            canvas.style.opacity = '1';
            setTimeout(() => { this.frontVisible = false; incoming.release(); resolve(); }, WHEEL.fadeMs);
          });
        },
      };
    });
  }
}
