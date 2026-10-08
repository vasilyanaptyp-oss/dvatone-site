/* hero2 first screen of the home page. Since 08.10 late evening (Artur: «появляются только "Створіть... з характ." и
   начинается пшик на стенку и только потом появляется сначала верхняя панель плавно! ну и потом остальное после
   анимации»; the animation is a pre-rendered Cycles video):
     black, only the headline, letter by letter (CSS, site.css hero2 block);
     then the opening video (video.hero__anim: the coat sprayed on the primed wall from the top down, then the camera pulls
     back into the room); the header fades in where the spray ends (data-cue, seconds of the video);
     at the video's end its last frame (the room) dissolves into the identical still (img.hero__room-coat) and the rest
     comes: the eyebrow, the lead, the buttons, the facts (html.dv-rest);
     a scroll, key or touch lands everything at once.
   Without the video (it cannot start within about 2.5 s, Save-Data or a 2G connection, autoplay refused, an error or a
   stall): the same sequence on the room still. Reduced motion and later visits in the session: the room still at once.
   Page contract (build_home.py): <html> gets dv-intro and dv-nohdr on the first visit of a session with motion allowed,
   and dv-anim when the video may be tried (head script); the inline script after the video picks the desktop or the
   phone file and starts loading it while the page parses. No WebGL here. */
const DIR = new URL('./first/', import.meta.url).href;
const SEEN = 'dv3d:hero2:intro';                    /* the opening plays once per session */
const frame = () => new Promise(r => requestAnimationFrame(r));

export function mountFirst(root) {
  if (!root || root.dataset.first) return;
  root.dataset.first = '1';
  const H = document.documentElement, hero = root.closest('.hero') || root;
  const coat = root.querySelector('.hero__room-coat');
  const vid = hero.querySelector('video.hero__anim');
  /* the page's safety net may already have shown everything (a very slow network brought this module late): no opening */
  const intro = H.classList.contains('dv-intro') && !H.classList.contains('dv-rest');
  const st = { done: false, shown: false, rest: false, meta: null, coated: null, hold3d: intro, kick: null, mode: '' };
  window.DV3D_OPEN = st;                            /* state, for the checks */

  /* the LCP: Chrome leaves an image that covers the whole viewport out of it (a background, to its mind), so site.css keeps
     the media layer 1px short at the bottom (black, under the veil) until the still has painted; then the clip goes */
  const unclip = () => hero.classList.add('is-lcp');
  if (!coat) unclip();
  else (coat.complete ? Promise.resolve() : new Promise(r => { coat.addEventListener('load', r, { once: true }); coat.addEventListener('error', r, { once: true }); }))
    .then(() => (coat.naturalWidth && coat.decode ? coat.decode().catch(() => {}) : 0)).then(frame).then(frame).then(frame).then(unclip);

  /* where the photograph is cropped, as object-position in site.css does it (the still and the video alike): the desktop
     frame never shows the window's glass at its left edge (9.2 %) and is centred otherwise; the phone frame ends on the
     right where the sofa's back cushions meet (89 %), but never shows the chair at its left edge (7 %) */
  function place() {
    const tallStill = /room-p-/.test((coat && (coat.currentSrc || coat.src)) || '');
    const ap = tallStill ? 1080 / 1920 : 2400 / 1080, ac = root.offsetWidth / Math.max(1, root.offsetHeight);
    let fx = 0.5;
    if (ac < ap) { const ex = 1 - ac / ap; fx = tallStill ? Math.min(1, Math.max(0.07, ex - 0.11) / ex) : Math.min(1, Math.max(0.5, 0.092 / ex)); }
    st.fx = fx;
    return [fx, 0.5];
  }

  /* the header; the rest of the first screen (eyebrow, lead, buttons, facts) */
  const showHeader = () => { if (st.shown) return; st.shown = true; H.classList.remove('dv-nohdr'); H.classList.add('dv-coated'); };
  const showRest = () => { if (st.rest) return; st.rest = true; H.classList.add('dv-rest'); };
  /* the still: the room is on, the story below may run */
  const finish = () => {
    if (st.done) return; st.done = true;
    hero.classList.add('is-coated');
    try { sessionStorage.setItem(SEEN, '1'); } catch (e) { /* private mode */ }
    if (st.unhook) st.unhook();                      /* the opening's scroll / key / touch listeners */
    st.hold3d = false; if (st.kick) st.kick();
    if (st.coated) st.coated();
  };
  story(root, hero, st, place);
  if (!intro) {                                     /* later visits, reduced motion: the room, the header, the text at once */
    showHeader(); showRest(); finish();
    fetch(DIR + 'first.json').then(r => r.json()).then(m => { st.meta = m; }).catch(() => {});
    return;
  }

  /* the headline is in (its letters, 0.3 to about 1.6 s): the opening starts slightly before the last letters settle */
  const T0 = performance.now();
  const at = ms => new Promise(r => setTimeout(r, Math.max(0, ms - (performance.now() - T0))));
  const timers = [];
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  let landed = false;
  /* a scroll, key or touch: everything at once (the video stops where it is and dissolves into the room) */
  const EV = ['wheel', 'touchstart', 'pointerdown', 'keydown', 'scroll'];
  const land = () => {
    if (landed) return; landed = true;
    EV.forEach(e => removeEventListener(e, land, true));
    timers.forEach(clearTimeout);
    hero.classList.remove('is-macro');
    hero.classList.add('is-landed');
    showHeader(); showRest();
    if (st.mode === 'video' && vid) { hero.classList.add('is-anim-out'); setTimeout(() => { try { vid.pause(); } catch (e) { /* gone */ } }, 400); }
    hero.classList.add('is-still-in');
    finish();
  };
  EV.forEach(e => addEventListener(e, land, { capture: true, passive: true }));
  st.unhook = () => EV.forEach(e => removeEventListener(e, land, true));
  if (scrollY > 8) land();

  /* without the video: the room still fades in after the headline (never before it: an early error waits), then the header,
     then the rest */
  const toStill = (delay = 0) => {
    if (landed || st.mode === 'still') return;
    st.mode = 'still';
    delay = Math.max(delay, 1300 - (performance.now() - T0));
    hero.classList.remove('is-macro');
    if (vid) { hero.classList.add('is-anim-out'); try { vid.pause(); } catch (e) { /* gone */ } }
    later(() => hero.classList.add('is-still-in'), delay);
    later(showHeader, delay + 700);
    later(() => { showRest(); finish(); }, delay + 1500);
  };

  const canVideo = vid && H.classList.contains('dv-anim') && typeof vid.play === 'function';
  if (!canVideo) { at(1500).then(() => toStill()); return; }
  /* the desktop or the phone file, WebM (VP9) where it plays, else MP4 (H.264); loaded now, after the page's own files */
  try {
    const kind = innerWidth < innerHeight && innerWidth <= 760 ? 'p' : 'd', base = vid.getAttribute('data-base') + kind;
    vid.poster = base + '-poster.webp';
    vid.src = base + (vid.canPlayType('video/webm; codecs="vp9"') ? '.webm' : '.mp4');
    vid.preload = 'auto'; vid.load();
  } catch (e) { at(1500).then(() => toStill()); return; }

  /* the video: started at 1.2 s if it can play by then, else as soon as it can, at most until 2.6 s */
  const cue = +(vid.getAttribute('data-cue') || 3.3);
  let started = false;
  const ready = () => vid.readyState >= 3;
  /* the video's own clock drives the steps: the header at the cue (the spray ends, the camera starts to pull back), the
     rest in the last held frames, the end; read on every presented frame (requestVideoFrameCallback), on timeupdate and
     on every page frame, so a busy page never delays a step. A stall (no progress for 1.2 s): the room still */
  let lastT = -1, lastWall = 0;
  const step = t => {
    if (landed || st.mode !== 'video') return;
    if (t >= cue && !st.shown) { showHeader(); hero.classList.remove('is-macro'); }
    if (vid.duration && t >= vid.duration - 0.32 && !st.rest) showRest();
    if (vid.ended || (vid.duration && t >= vid.duration - 0.04)) end();
  };
  const watch = () => {
    if (landed || st.mode !== 'video') return;
    const t = vid.currentTime, now = performance.now();
    if (t !== lastT) { lastT = t; lastWall = now; }
    else if (!vid.paused && now - lastWall > 1200) { toStill(); return; }      /* the network cannot keep up */
    step(t);
    if (st.mode === 'video') requestAnimationFrame(watch);
  };
  vid.addEventListener('timeupdate', () => step(vid.currentTime));
  const onFrame = (now, meta) => { step(meta && meta.mediaTime != null ? meta.mediaTime : vid.currentTime); if (st.mode === 'video') vid.requestVideoFrameCallback(onFrame); };
  /* the end: the still under the last frame (the same picture), the video dissolves, then the rest */
  const end = () => {
    if (landed || st.mode !== 'video') return;
    st.mode = 'ended';
    showHeader();
    hero.classList.add('is-still-in');
    requestAnimationFrame(() => hero.classList.add('is-anim-out'));
    later(() => { showRest(); finish(); }, 250);
  };
  const start = async () => {
    if (started || landed || st.mode) return;
    started = true; st.mode = 'video';
    try { await vid.play(); } catch (e) { st.mode = ''; toStill(); return; }   /* autoplay refused */
    lastWall = performance.now();
    hero.classList.add('is-anim-on', 'is-macro');
    if (vid.requestVideoFrameCallback) vid.requestVideoFrameCallback(onFrame);
    watch();
  };
  vid.addEventListener('ended', end, { once: true });
  vid.addEventListener('error', () => { if (st.mode === '' || st.mode === 'video') toStill(); }, { once: true });
  at(1200).then(() => {
    if (landed || st.mode) return;
    if (ready()) { start(); return; }
    vid.addEventListener('canplay', () => { if (!st.mode && performance.now() - T0 < 2600) start(); }, { once: true });
    at(2600).then(() => { if (!started && !landed) toStill(); });
  });
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
    if (st.hold3d) return;                         /* the 3D opening is on screen: its own events drive the page */
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
  st.kick = kick;
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick, { passive: true });
  st.coated = () => (window.requestIdleCallback || (f => setTimeout(f, 1500)))(addClose, { timeout: 4000 });
  window.DV3D_STORY = { set: p => { Z.target = Z.p = clamp(+p, 0, 1); apply(Z.p); }, state: Z };
  kick();
}

const auto = () => document.querySelectorAll('.hero__room').forEach(mountFirst);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
