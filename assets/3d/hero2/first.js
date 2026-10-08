/* hero2 first screen of the home page (07.10, Artur): the black opening with the headline (CSS, site.css hero2 block),
   then the room photograph with the primed wall, the coating applied on the wall (apply.js), the coated room at rest with a
   slow drift, and the header.

   Page contract (build_home.py): .hero__room holds two pictures of the same Cycles frame, img.hero__room-pre (the primed
   wall, the LCP image) and img.hero__room-coat (the coat), and canvas.hero__apply. <html> has dv-intro / dv-nohdr on the
   first visit of a session with motion allowed (head script). This module removes dv-nohdr and adds dv-coated when the
   coat is on (the header fades in, the facts come); a scroll, key or touch brings the header at once.
   No three.js here: about 6 KB of raw WebGL2 (apply.js), run in a worker on the page's canvas where the browser can, and the
   stills. */
import { createApply } from './apply.js';

const DIR = new URL('./first/', import.meta.url).href;
const SEEN = 'dv3d:hero2:intro';                    /* the same flag as the 3D module: the opening plays once per session */
const frame = () => new Promise(r => requestAnimationFrame(r));
const capture = /[?&]capture\b/.test(location.search);
/* test switches: ?nowebgl behaves as without WebGL (also in the worker), ?nowebgl=worker as a worker without WebGL2 */
const nogl = (location.search.match(/[?&]nowebgl(=worker)?\b/) || [])[1] ? 'worker' : /[?&]nowebgl\b/.test(location.search);

export function mountFirst(root) {
  if (!root || root.dataset.first) return;
  root.dataset.first = '1';
  const H = document.documentElement, hero = root.closest('.hero') || root;
  const pre = root.querySelector('.hero__room-pre'), coat = root.querySelector('.hero__room-coat'), cv = root.querySelector('.hero__apply');
  const intro = H.classList.contains('dv-intro');
  const tall = () => innerWidth < innerHeight && innerWidth <= 760;
  const st = { done: false, shown: false, apply: null, meta: null, coated: null };

  /* the LCP: Chrome leaves an image that covers the whole viewport out of it (a background, to its mind), so site.css keeps
     the media layer 1px short at the bottom (black, under the veil) until the still in view has painted; then the clip goes */
  const lit = intro ? pre : coat, unclip = () => hero.classList.add('is-lcp');
  if (!lit) unclip();
  else (lit.complete ? Promise.resolve() : new Promise(r => { lit.addEventListener('load', r, { once: true }); lit.addEventListener('error', r, { once: true }); }))
    .then(() => (lit.naturalWidth && lit.decode ? lit.decode().catch(() => {}) : 0)).then(frame).then(frame).then(frame).then(unclip);

  /* where the photograph is cropped, as object-position in site.css does it (the page never jumps): the desktop frame never
     shows the window's glass at its left edge (9.2 % of the frame) and is centred otherwise; the phone frame ends on the
     right where the sofa's back cushions meet (89 %), but never shows the chair at its left edge (7 %). fx: the share of
     the cropped width taken from the left (object-position's percentage) */
  function place() {
    const tallStill = /room-p-/.test((pre && (pre.currentSrc || pre.src)) || '');
    const ap = tallStill ? 1080 / 1920 : 2400 / 1080, ac = root.offsetWidth / Math.max(1, root.offsetHeight);
    let fx = 0.5;
    if (ac < ap) {
      const ex = 1 - ac / ap;
      fx = tallStill ? Math.min(1, Math.max(0.07, ex - 0.11) / ex) : Math.min(1, Math.max(0.5, 0.092 / ex));
    }
    st.fx = fx;
    return [fx, 0.5];
  }

  /* the header: when the coat is on, or at once on a scroll, key or touch */
  const EV = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'scroll'];
  const showHeader = () => {
    if (st.shown) return; st.shown = true;
    H.classList.remove('dv-nohdr'); H.classList.add('dv-coated');
    EV.forEach(e => removeEventListener(e, showHeader, true));
  };
  if (H.classList.contains('dv-nohdr')) { EV.forEach(e => addEventListener(e, showHeader, { capture: true, passive: true })); if (scrollY > 8) showHeader(); }

  const finish = () => {
    if (st.done) return; st.done = true;
    hero.classList.add('is-coated');                 /* the coat picture shows, the canvas goes */
    showHeader();
    if (st.coated) st.coated();
    try { sessionStorage.setItem(SEEN, '1'); } catch (e) { /* private mode */ }
    if (st.apply) setTimeout(() => { st.apply.destroy(); st.apply = null; }, 900);
  };
  story(root, hero, st, place);
  if (!intro) {                                     /* second visit, reduced motion: the coated room at once */
    hero.classList.add('is-coated');
    if (st.coated) st.coated();
    fetch(DIR + 'first.json').then(r => r.json()).then(m => { st.meta = m; place(); }).catch(() => {});
    return;
  }

  /* the text is in (the buttons' entrance ends, at the latest 2.6 s): the application may start */
  const textIn = new Promise(r => {
    const last = hero.querySelector('.hero__ctas');
    if (last) last.addEventListener('animationend', r, { once: true });
    setTimeout(r, 2600);
  });
  (async () => {
    await frame(); await frame();                    /* WebGL only after the first paint */
    try { st.meta = await fetch(DIR + 'first.json').then(r => r.json()); } catch (e) { st.meta = null; }
    /* the stills the page already chose (AVIF or WebP, desktop or portrait): the same files, from the cache */
    const srcP = pre && (pre.currentSrc || pre.src), srcC = coat && (coat.currentSrc || coat.src);
    const v = /room-p-/.test(srcP || '') ? 'p' : 'd';
    const m = st.meta && st.meta[v];
    const focus = place();
    if (!m || !cv || !srcP || !srcC || typeof createImageBitmap !== 'function') { await textIn; hero.classList.add('is-fade'); setTimeout(finish, 1400); return; }
    st.apply = createApply(cv, {
      meta: m, focus, capture, dur: 3.6, bands: v === 'p' ? 6 : 5, dprCap: tall() ? 1.5 : 2, when: textIn,
      pre: srcP, coat: srcC, mask: DIR + 'room-' + v + '-mask.webp',
      mist: [0.71, 0.64, 0.54], nogl
    });
    addEventListener('resize', () => { const f = place(); if (st.apply) st.apply.resize(f); }, { passive: true });
    const ok = await st.apply.ready;
    await textIn;
    if (!ok) { hero.classList.add('is-fade'); setTimeout(finish, 1400); return; }
    hero.classList.add('is-applying');               /* the canvas over the primed room (it draws the same frame first) */
    if (capture) { window.DV3D_FIRST = { step: dt => st.apply && st.apply.step(dt), state: st }; st.apply.state.onEnd = finish; return; }
    st.apply.play(finish);
  })();
  setTimeout(() => { if (!st.done && !hero.classList.contains('is-applying')) { hero.classList.add('is-fade'); setTimeout(finish, 1400); } }, 12000);
}

/* The story: scrolling through the hero's track pushes into the coated wall (the room photograph, 2D, toward the sun patch)
   and dissolves into the material close-up (a Cycles photograph of the same wall at about half a metre, in the room's
   own light: the coat in the soft shade, a sliver of the sun with the plant's leaf shadows, the corner out of focus;
   _tools/closeup_render.py); the page gets the usual
   dv3d:story events (its text fades, the caption comes). The room's slow drift stops for good when the story starts. */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function story(root, hero, st, place) {
  const track = hero.closest('[data-dv3d-track]');
  if (!track || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const Z = { p: 0, target: 0, raf: 0, last: 0, sent: -1, base: 1, on: false, close: null, img: null };
  const read = () => { const r = track.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - innerHeight), 0, 1); };
  /* the close-up picture: not part of the first screen; added at idle once the coat is on, or at the first scroll */
  const addClose = () => {
    if (Z.close) return;
    const v = innerWidth < innerHeight && innerWidth <= 760 ? 'p' : 'd';          /* the close-up: by the screen */
    const rv = /room-p-/.test((root.querySelector('.hero__room-coat') || {}).currentSrc || '') ? 'p' : 'd';   /* the room: the still in use */
    const pic = document.createElement('picture'); pic.className = 'hero__close';
    pic.innerHTML = '<source type="image/avif" srcset="' + DIR + 'closeup-' + v + '.avif"><img src="' + DIR + 'closeup-' + v + '.webp" alt="" decoding="async">';
    hero.querySelector('.hero__media').insertBefore(pic, hero.querySelector('.hero__shade'));
    Z.close = pic; Z.img = pic.querySelector('img');
    /* the room out of focus (a tiny blurred copy, zooming with the room): the push reads as the lens focusing closer,
       so the room never shows through the close-up as a double exposure */
    const soft = document.createElement('picture'); soft.className = 'hero__soft';
    soft.innerHTML = '<source type="image/avif" srcset="' + DIR + 'room-' + rv + '-soft.avif"><img src="' + DIR + 'room-' + rv + '-soft.webp" alt="" decoding="async">';
    root.appendChild(soft); Z.soft = soft;          /* cropped like the room by site.css (.hero__room img) */
  };
  /* where the push goes: a point of the wall in the sun patch (photo coordinates), on screen through the crop */
  const target = () => {
    const im = root.querySelector('.hero__room-coat'), r = { width: root.offsetWidth, height: root.offsetHeight };   /* layout size: the origin is local */
    const m = st.meta && st.meta[/room-p-/.test((im && im.currentSrc) || '') ? 'p' : 'd'];
    const [u, v] = m && m.focus ? m.focus : [0.3, 0.42];
    if (!m) return [r.width * 0.4, r.height * 0.45];
    const ap = m.w / m.h, ac = r.width / Math.max(1, r.height);
    const fx = place()[0];
    let sw, sh;
    if (ac < ap) { sh = r.height; sw = sh * ap; } else { sw = r.width; sh = sw / ap; }
    const ox = (r.width - sw) * fx, oy = (r.height - sh) * 0.5;
    return [ox + u * sw, oy + v * sh];
  };
  function apply(p) {
    if (!Z.on && p > 0.002) {                      /* the drift stops where it is; the push starts from there */
      Z.on = true; addClose();
      const m = getComputedStyle(root).transform;
      Z.base = m && m !== 'none' ? Math.hypot(...m.slice(7, -1).split(',').slice(0, 2).map(Number)) : 1;
      hero.classList.add('is-story');
    }
    if (!Z.on) return;
    const [tx, ty] = target();
    const s = Z.base * (1 + 0.6 * smooth(0, 0.62, p));
    root.style.transformOrigin = tx.toFixed(1) + 'px ' + ty.toFixed(1) + 'px';
    root.style.transform = 'scale(' + s.toFixed(4) + ')';
    if (Z.soft) Z.soft.style.opacity = smooth(0.18, 0.42, p).toFixed(3);
    if (Z.close) {
      const k = smooth(0.38, 0.62, p);
      Z.close.style.opacity = k.toFixed(3);
      Z.close.style.transform = 'scale(' + (1.14 - 0.14 * smooth(0.34, 1, p)).toFixed(4) + ')';
    }
    if (Math.abs(p - Z.sent) > 0.002 || (p === 0 && Z.sent !== 0)) {
      Z.sent = p;
      hero.dispatchEvent(new CustomEvent('dv3d:story', { bubbles: true, detail: { progress: p, eased: p } }));
    }
  }
  function tick(now) {
    Z.raf = 0;
    const dt = Z.last ? Math.min(0.05, (now - Z.last) / 1000) : 1 / 60; Z.last = now;
    Z.target = read();
    Z.p += (Z.target - Z.p) * (1 - Math.exp(-dt * 7));
    if (Math.abs(Z.target - Z.p) < 2e-4) { Z.p = Z.target; Z.last = 0; } else Z.raf = requestAnimationFrame(tick);
    apply(Z.p);
  }
  const kick = () => { if (!Z.raf) Z.raf = requestAnimationFrame(tick); };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });
  st.coated = () => (window.requestIdleCallback || (f => setTimeout(f, 1500)))(addClose, { timeout: 4000 });
  window.DV3D_STORY = { set: p => { Z.target = Z.p = clamp(+p, 0, 1); apply(Z.p); }, state: Z };
  kick();
}

const auto = () => document.querySelectorAll('.hero__room').forEach(mountFirst);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
