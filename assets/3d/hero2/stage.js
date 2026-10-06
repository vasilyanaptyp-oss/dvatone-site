/* Dvatone hero v2: the stage. A copy of createStage() from core.js (which is shared and must not change),
   extended with the phone rules of MOBILE_STRATEGY.md section 3:
   - pixel-ratio cap per quality tier (high 2, mid 1.5, low 1) on top of the adaptive resolution;
   - a frame-rate cap that can change at any time (30 fps after 20 s without interaction, always on the low tier);
   - touch-action: pan-y pinch-zoom, so the canvas never traps vertical page scroll;
   - manual start (low tier: poster with a small "Live 3D" button, nothing loads before the tap).
   Unchanged from core.js: poster first, lazy init near the viewport, pause off-screen and in hidden tabs,
   no WebGL2 = poster, reduced motion = frames only on demand, deterministic capture (DV3D.step). */
import { loadThree, hasWebGL2, isSmallScreen } from '../core.js';

const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
const G = (typeof window !== 'undefined') ? (window.DV3D = window.DV3D || {}) : {};
G.stages = G.stages || new Set();
G.capture = G.capture || /[?&]capture\b/.test(typeof location !== 'undefined' ? location.search : '');
if (!G.step) G.step = function (dt) { G.stages.forEach(s => s._step(dt == null ? 1 / 30 : dt)); };

/* same base CSS as core.js (same id: whichever module comes first injects it), plus hero v2 extras */
const CSS = `
.dv3d{position:relative;width:100%;height:100%;overflow:hidden;isolation:isolate;contain:layout paint;-webkit-tap-highlight-color:transparent}
.dv3d>canvas{position:absolute;inset:0;width:100%!important;height:100%!important;display:block;opacity:0;transition:opacity .9s cubic-bezier(.2,.7,.2,1)}
.dv3d.is-live>canvas{opacity:1}
.dv3d__poster{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;transition:opacity .9s cubic-bezier(.2,.7,.2,1);pointer-events:none;user-select:none}
.dv3d.is-live .dv3d__poster{opacity:0}
.dv3d.is-fallback .dv3d__poster{opacity:1}
.dv3d--pack .dv3d__poster{object-fit:contain}
.dv3d__fade{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0}
.dv3d.is-drag{cursor:grab;touch-action:pan-y}
.dv3d.is-dragging{cursor:grabbing}
@media (prefers-reduced-motion:reduce){.dv3d>canvas,.dv3d__poster{transition:none}}
`;
const CSS_H2 = `
.dv3d--hero2,.dv3d--hero2>canvas{touch-action:pan-y pinch-zoom}
.dv3d__photo{position:absolute;inset:0;z-index:1;opacity:0;pointer-events:none;transform-origin:0 0;will-change:opacity,transform}
.dv3d__room{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;z-index:1;opacity:0;pointer-events:none;user-select:none}
.dv3d__live{position:absolute;right:max(16px,env(safe-area-inset-right));top:calc(var(--hdr,64px) + 14px);z-index:3;display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px 0 12px;border:1px solid rgba(237,230,218,.34);border-radius:999px;background:rgba(18,16,14,.55);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#ede6da;font:600 11px/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;pointer-events:auto}
.dv3d__live svg{width:16px;height:16px;fill:currentColor}
.dv3d__live:focus-visible{outline:2px solid #ede6da;outline-offset:3px}
`;
function injectCSS() {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('dv3d-css')) { const s = document.createElement('style'); s.id = 'dv3d-css'; s.textContent = CSS; document.head.appendChild(s); }
  if (!document.getElementById('dv3d-css-h2')) { const s = document.createElement('style'); s.id = 'dv3d-css-h2'; s.textContent = CSS_H2; document.head.appendChild(s); }
}

/* after the page has loaded and the main thread is idle: no 3D before the first paint (MOBILE_STRATEGY.md section 2) */
export function afterLoad(timeout = 1200) {
  return new Promise(res => {
    const go = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => res(), { timeout }) : setTimeout(res, 120));
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  });
}

/* cfg as core.js createStage, plus: dpr (cap), fps() -> max frames per second or 0, manual (start on begin()),
   liveLabel / liveAria (start button), preInit() -> Promise (awaited after load, before three.js is requested) */
export function createStage(el, cfg) {
  injectCSS();
  const wrap = document.createElement('div');
  wrap.className = 'dv3d' + (cfg.className ? ' ' + cfg.className : '');
  if (cfg.label) { wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', cfg.label); }
  const poster = document.createElement('img');
  poster.className = 'dv3d__poster'; poster.alt = ''; poster.decoding = 'async'; poster.setAttribute('aria-hidden', 'true');
  if (cfg.poster) poster.src = cfg.poster; else poster.style.display = 'none';
  wrap.appendChild(poster);
  el.appendChild(wrap);

  const st = {
    el, wrap, poster, canvas: null, renderer: null, THREE: null,
    w: 0, h: 0, pr: 1, q: 1, t: 0,
    visible: false, inited: false, ready: false, failed: false, destroyed: false,
    reduced: RM.matches, small: isSmallScreen(),
    stats: { fps: 0, ms: 0, pr: 1, w: 0, h: 0, calls: 0, tris: 0, buildMs: 0, firstFrameMs: 0, quality: 1 },
    invalidate, setPoster, fail, readyP: null, _step: step
  };
  let raf = 0, ticking = false, last = 0, lastDraw = 0, ema = 16.7, sinceCheck = 0, warm = 0, slow = 0, fast = 0, badQ = 9, badT = -1e9, needFrame = true, t0 = performance.now();
  let resolveReady; st.readyP = new Promise(r => (resolveReady = r));
  let armed = !cfg.manual;

  function setPoster(src) { if (src) { poster.style.display = ''; poster.src = src; } }
  function fail(err) {
    if (st.failed) return;
    st.failed = true; stop();
    wrap.classList.remove('is-live'); wrap.classList.add('is-fallback');
    if (err && !/nowebgl/.test(String(err))) console.error('[dvatone 3d]', err);
    el.dispatchEvent(new CustomEvent('dv3d:fallback', { bubbles: true, detail: { reason: String(err || '') } }));
    resolveReady(false);
  }

  /* manual start (low tier): a small button over the poster; nothing is requested before the tap */
  let liveBtn = null;
  if (cfg.manual) {
    liveBtn = document.createElement('button');
    liveBtn.type = 'button'; liveBtn.className = 'dv3d__live';
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); path.setAttribute('d', 'M5 3.5v9l7-4.5z');
    svg.appendChild(path);
    const span = document.createElement('span'); span.textContent = cfg.liveLabel || 'Live 3D';
    liveBtn.append(svg, span);
    liveBtn.setAttribute('aria-label', cfg.liveAria || cfg.liveLabel || 'Live 3D');
    liveBtn.addEventListener('click', () => st.begin());
    /* outside the role="img" wrapper (an image cannot hold a control); the host gets positioned if it is static */
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.appendChild(liveBtn);
  }
  st.begin = function () {
    if (armed || st.destroyed) return;
    armed = true;
    if (liveBtn) { liveBtn.remove(); liveBtn = null; }
    if (st.nearView) init();
  };

  /* lazy init: start loading a little before the element scrolls in */
  const ioInit = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { st.nearView = true; if (armed) { ioInit.disconnect(); init(); } }
  }, { rootMargin: '300px 0px' });
  /* run only while actually on screen */
  const ioRun = new IntersectionObserver(es => {
    const e = es[es.length - 1];
    st.visible = e.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0;
    sync();
  }, { threshold: [0, 0.001] });
  ioInit.observe(wrap); ioRun.observe(wrap);
  const onVis = () => sync();
  document.addEventListener('visibilitychange', onVis);
  const onRM = () => { st.reduced = RM.matches; invalidate(); sync(); };
  if (RM.addEventListener) RM.addEventListener('change', onRM);
  let ro = null;

  async function init() {
    if (st.inited || st.destroyed) return;
    st.inited = true;
    if (!hasWebGL2()) return fail('nowebgl');
    if (!G.capture) await afterLoad();
    if (cfg.preInit) { try { await cfg.preInit(); } catch (e) { /* keep the static settings */ } }
    if (st.destroyed) return;
    let THREE;
    try { THREE = await loadThree(); } catch (e) { return fail(e); }
    if (st.destroyed) return;
    st.THREE = THREE;
    const tb = performance.now();
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: cfg.antialias !== false && (window.devicePixelRatio || 1) < 1.5, alpha: !!cfg.alpha, powerPreference: 'default',
        premultipliedAlpha: true, preserveDrawingBuffer: !!G.capture
      });
      st.renderer = renderer; st.canvas = renderer.domElement;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (cfg.alpha) renderer.setClearColor(0x000000, 0);
      st.canvas.setAttribute('aria-hidden', 'true');
      st.canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); fail('WebGL context lost'); }, false);
      measure();
      applySize();
      wrap.appendChild(st.canvas);
      await cfg.build(st);
      if (st.destroyed) return;
      if (renderer.compileAsync && cfg.scene && cfg.camera) {
        try { await renderer.compileAsync(cfg.scene(), cfg.camera()); } catch (e) { /* compile synchronously on first render */ }
      }
      if (st.destroyed) return;
      st.stats.buildMs = Math.round(performance.now() - tb);
      cfg.resize && cfg.resize(st.w, st.h);
      cfg.update && cfg.update(st.t, 0);
      cfg.render();
      st.ready = true;
      st.stats.firstFrameMs = Math.round(performance.now() - t0);
      requestAnimationFrame(() => {
        if (st.failed) return;
        wrap.classList.add('is-live');
        el.dispatchEvent(new CustomEvent('dv3d:ready', { bubbles: true, detail: { stats: st.stats } }));
      });
      ro = new ResizeObserver(() => { measure(); applySize(); cfg.resize && cfg.resize(st.w, st.h); invalidate(); });
      ro.observe(wrap);
      resolveReady(true);
      sync();
    } catch (e) { fail(e); }
  }

  function measure() {
    const r = wrap.getBoundingClientRect();
    st.w = Math.max(1, Math.round(r.width)); st.h = Math.max(1, Math.round(r.height));
  }
  const cap = () => Math.min(window.devicePixelRatio || 1, (typeof cfg.dpr === 'function' ? cfg.dpr() : cfg.dpr) || 2);
  const minPr = () => Math.min(0.7, cap());
  function applySize() {
    if (!st.renderer) return;
    st.pr = Math.max(minPr(), cap() * st.q);
    st.renderer.setPixelRatio(st.pr);
    st.renderer.setSize(st.w, st.h, false);
    st.stats.pr = +st.pr.toFixed(2); st.stats.w = st.w; st.stats.h = st.h; st.stats.quality = +st.q.toFixed(2);
  }
  st.applySize = () => { applySize(); cfg.resize && cfg.resize(st.w, st.h); invalidate(); };

  function running() { return st.ready && !st.failed && !st.destroyed && st.visible && !document.hidden; }
  function wantsLoop() { return !st.reduced || !!st._fade || (cfg.continuous && cfg.continuous()); }
  function sync() {
    if (G.capture) return;
    if (running() && (wantsLoop() || needFrame)) start(); else if (!running()) stop();
  }
  /* one loop only: a start() from inside a frame (e.g. a resize during the update) must not spawn a second rAF chain */
  function start() { if (!raf && !ticking) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function invalidate() { needFrame = true; if (!G.capture) sync(); }

  function frame(dt) {
    advanceFade(st, dt);
    if (!st.reduced) st.t += dt;
    cfg.update && cfg.update(st.t, dt);
    cfg.render();
    const info = st.renderer.info.render; st.stats.calls = info.calls; st.stats.tris = info.triangles;
  }
  function tick(now) {
    raf = 0;
    if (!running()) return;
    /* frame-rate cap (battery): skip this vsync without touching the clock; the next drawn frame gets the full dt */
    const fcap = !needFrame && cfg.fps ? cfg.fps() : 0;
    if (fcap > 0 && now - lastDraw < 1000 / fcap - 2.5) { raf = requestAnimationFrame(tick); return; }
    const raw = (now - last) / 1000; last = now; lastDraw = now;
    const dt = Math.min(raw, 0.1);
    needFrame = false;
    ticking = true;
    try { frame(dt); } finally { ticking = false; }
    /* adaptive resolution: EMA of the real frame interval, checked about once a second after a warm-up (not while capped) */
    if (raw > 0 && raw < 0.5 && wantsLoop() && !G.noAdapt && !fcap) {
      ema = ema * 0.9 + raw * 1000 * 0.1; warm += raw; sinceCheck += raw;
      st.stats.ms = +ema.toFixed(1); st.stats.fps = Math.round(1000 / ema);
      if (warm > 1.5 && sinceCheck > 0.8) {
        sinceCheck = 0;
        const minQ = minPr() / cap();
        slow = ema > 24 ? slow + 1 : 0;
        fast = ema < 17.6 ? fast + 1 : 0;
        const tnow = performance.now();
        if (slow >= 2 && st.q > minQ + 0.001) {
          badQ = st.q; badT = tnow;
          st.q = Math.max(minQ, st.q * Math.min(0.9, Math.max(0.45, Math.sqrt(15.5 / ema))));
          applySize(); cfg.resize && cfg.resize(st.w, st.h); warm = 0.9; ema = 16.7; slow = 0; fast = 0;
        } else if (fast >= 4 && st.q < 1) {
          let q = Math.min(1, st.q * 1.15);
          if (tnow - badT < 30000) q = Math.min(q, badQ * 0.92);
          if (q > st.q + 0.01) { st.q = q; applySize(); cfg.resize && cfg.resize(st.w, st.h); warm = 0.6; }
          fast = 0;
        }
      }
    } else if (fcap && raw > 0 && raw < 0.5) {
      ema = ema * 0.9 + raw * 1000 * 0.1; st.stats.ms = +ema.toFixed(1); st.stats.fps = Math.round(1000 / ema); warm = 0;
    }
    if ((wantsLoop() || needFrame) && !raf) raf = requestAnimationFrame(tick);
  }
  function step(dt) {               /* deterministic capture: DV3D.step(1/30) */
    if (!st.ready || st.failed) return;
    advanceFade(st, dt);
    st.t += dt; cfg.update && cfg.update(st.t, dt); cfg.render();
  }

  st.destroy = function () {
    if (st.destroyed) return;
    st.destroyed = true; stop();
    ioInit.disconnect(); ioRun.disconnect(); ro && ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    if (RM.removeEventListener) RM.removeEventListener('change', onRM);
    try { cfg.dispose && cfg.dispose(); } catch (e) { /* ignore */ }
    if (st.renderer) { st.renderer.dispose(); st.renderer.forceContextLoss(); }
    liveBtn && liveBtn.remove(); wrap.remove(); G.stages.delete(st);
  };
  st.start = sync;
  G.stages.add(st);
  return st;
}

/* Crossfade a state change (copy of core.js crossfade, driven by this stage's clock) */
export function crossfade(st, renderNow, apply, dur = 0.9) {
  if (st.reduced || !st.ready) { apply(); st.invalidate(); return; }
  let cv = st.wrap.querySelector('.dv3d__fade');
  if (!cv) { cv = document.createElement('canvas'); cv.className = 'dv3d__fade'; cv.setAttribute('aria-hidden', 'true'); st.wrap.appendChild(cv); }
  const c = st.renderer.domElement;
  cv.width = c.width; cv.height = c.height;
  renderNow();
  cv.getContext('2d').drawImage(c, 0, 0);
  cv.style.transition = 'none'; cv.style.opacity = '1';
  apply(); renderNow();
  st._fade = { cv, k: 0, dur };
  st.invalidate(); st.start();
}
function advanceFade(st, dt) {
  const f = st._fade; if (!f) return;
  f.k += dt / f.dur;
  const k = Math.min(1, f.k), e = 1 - Math.pow(1 - k, 3);
  f.cv.style.opacity = String(1 - e);
  if (k >= 1) { f.cv.style.opacity = '0'; st._fade = null; }
}
