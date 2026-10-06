/* Dvatone hero v2: "spray to surface".
   Opening (about 4 s, once per visit): thousands of multicolour gel granules (the composition's colours
   and shares) burst from a spray nozzle just off-frame, fly through a raking beam (gravity, air drag by
   size, jet turbulence), land and stick; every landing is stamped into the coating tile, so the surface
   the visitor ends up looking at is literally made of what was sprayed. Then the v1 macro: a raking light
   glides over the relief (micro-shadows, satin sheen, mica glints), follows the cursor on desktop and drifts
   gently on touch. Optional scroll story: the camera pulls back from the macro into a furnished living room (the
   Blender-baked room of Interiors v2, in real time) and comes to rest on a photoreal Cycles frame of the very same
   view (Interiors v2 photo mode, the wall recoloured live), then releases the page.

   DVHero2.mount(el, { colors, grain, intro: true|'always'|false, scrollStory: 'auto'|true|false, track,
                       pointerTarget, poster, sparkle, seed, room: 'furnished'|'simple' })
   -> { setColors(colors, {grain, sparkle, spray}), replay(), setStory(p|null), ready, stats(), destroy() }
   Declarative: <div data-dv3d="hero2" data-colors='[...]' data-grain="1" data-intro="true|always|false"
                      data-scroll-story="auto|true|false|#track" data-poster="none|url" data-pointer-target="#top" data-room="simple"></div>
   Events on the host: dv3d:ready, dv3d:fallback, dv3d:intro-end, dv3d:story {progress}.
   Phones (MOBILE_STRATEGY.md section 3): quality tier high / mid / low decided once per visit (hero2/tier.js); low shows
   the poster with a small "Live 3D" button; the canvas never traps vertical scroll; the light follows the finger;
   tilt only after enableTilt() from a user gesture; 30 fps after 20 s without interaction; camera still after the intro. */
import { normColors, clamp } from './core.js';
import { createStage, crossfade } from './hero2/stage.js';
import { staticTier, decideTier } from './hero2/tier.js';
import { buildCoat, createCoatTile, CELL_MM, SCHED, bandFrac } from './hero2/coat.js';
import { createSpray } from './hero2/spray.js';
import { WALL_VERT, WALL_FRAG } from './hero2/wall.js';
import { createRoom, ROOM } from './hero2/room.js';
import { createLiving } from './hero2/living.js';

const BASE = import.meta.url;
/* DV 033 "Honey" (same palette as v1: sampled from the client's macro photo) */
export const DV033 = [
  { hex: '806438', share: 33 }, { hex: '5A4220', share: 24 }, { hex: 'A88C5C', share: 18 },
  { hex: 'D4C095', share: 17 }, { hex: '3A2810', share: 8 }
];
const LANG = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk';
const LABEL = {
  uk: 'Макро-фактура покриття Dvatone: гранули напилюються на стіну й складаються в покриття, світло ковзає поверхнею',
  en: 'Macro texture of a Dvatone coating: granules are sprayed onto the wall and build the coating, a raking light glides over it'
};
const SEEN = 'dv3d:hero2:intro';
const LIVE = { uk: ['Живе 3D', 'Увімкнути живе 3D'], en: ['Live 3D', 'Start live 3D'] };
/* quality tiers: tile size (at most 2K on mid, 1K on low), pixel-ratio cap, micro-shadow steps, lens blur,
   share of the fast mist that flies visibly (mid sprays about a third of the desktop particle count) */
const QT = {
  high: { px: 2048, cells: 96, steps: 14, aper: 26, dpr: 2, mist: 1, intro: true, fps: 0, drift: true },
  mid: { px: 1536, cells: 72, steps: 9, aper: 20, dpr: 1.5, mist: 0.7, intro: true, fps: 0, drift: false },
  low: { px: 1024, cells: 48, steps: 6, aper: 16, dpr: 1, mist: 0.3, intro: true, fps: 30, drift: false }     /* starts only on a tap */
};
/* the phone view of the photo frame (interior2/photo/hero-p: 4:5, the same camera as the story's tall final view) */
const PHOTO_TALL = true;
const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const L = Math.log;

export const DVHero2 = { mount, DV033 };
if (typeof window !== 'undefined') window.DVHero2 = DVHero2;

/* the granule list is built in a module worker (main thread stays free); in place if workers are unavailable */
let W = null, wid = 0, wBroken = false;
const wWait = new Map();
function buildCoatAsync(o) {
  if (wBroken || typeof Worker === 'undefined') return Promise.resolve(buildCoat(o));
  try {
    if (!W) {
      W = new Worker(new URL('./hero2/coat-worker.js', BASE), { type: 'module' });
      W.onmessage = e => { const d = e.data || {}, r = wWait.get(d.id); if (!r) return; wWait.delete(d.id); r.res(d.coat || buildCoat(r.o)); };
      W.onerror = () => { wBroken = true; wWait.forEach(r => r.res(buildCoat(r.o))); wWait.clear(); W && W.terminate(); W = null; };
    }
    return new Promise(res => { const id = ++wid; wWait.set(id, { res, o }); W.postMessage({ id, opts: o }); });
  } catch (e) { wBroken = true; return Promise.resolve(buildCoat(o)); }
}

function seenIntro() { try { return sessionStorage.getItem(SEEN) === '1'; } catch (e) { return false; } }
function markIntro() { try { sessionStorage.setItem(SEEN, '1'); } catch (e) { /* private mode */ } }

function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  const custom = Array.isArray(opts.colors) && opts.colors.length;
  const S = {
    colors: normColors(custom ? opts.colors : DV033), grain: clamp(+opts.grain || 1, 0.6, 1.8),
    sparkle: opts.sparkle != null ? clamp(+opts.sparkle, 0, 1) : (custom ? 0.12 : 0.45),
    seed: opts.seed == null ? 33 : +opts.seed, interactive: opts.interactive !== false
  };
  const capture = !!(window.DV3D && window.DV3D.capture);
  const introOpt = opts.intro == null ? true : opts.intro;
  const RMQ = matchMedia('(prefers-reduced-motion: reduce)');
  /* quality tier (MOBILE_STRATEGY.md section 3): static now, refined by a 1 s frame probe before the build */
  const T0 = opts.tier && QT[opts.tier] ? { tier: opts.tier, forced: true } : staticTier();
  let tier = T0.tier, Q = QT[tier];
  const wantIntro = () => Q.intro && !RMQ.matches && (introOpt === 'always' || (introOpt && (capture || !seenIntro())));
  /* poster: the finished coating (portrait crop for tall hosts) */
  const tall = (() => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r.width < r.height : matchMedia('(orientation: portrait)').matches; })();
  const posterURL = opts.poster === false ? null : (opts.poster || new URL(tall ? './hero2/poster-dv033-m.webp' : './hero2/poster-dv033.webp', BASE).href);
  const introFirst = wantIntro();

  const M = { x: 0, y: 0 };                    /* macro focus point on the wall (mm); the room is built around it */
  let T, R, scene, camera, U, wallM, wallR, wallL = null, wall, tile = null, spray = null, coat = null, geo = null, room = null, gpu = null;
  /* furnished room for the story end (high and mid tiers): loaded after the intro, while the page is idle */
  let living = null;
  const RM = { use: false, ready: false, busy: false, wall0: null };
  /* the story's resting frame: the photograph of the same view (DVInterior2.photoFrame); k = how much it covers */
  const PH = { mod: null, modP: null, ctl: null, host: null, ready: false, loading: false, err: false, k: 0, target: 0, cam: null, camKey: '', fcam: null };
  const I = { on: false, clock: 0, end: 0, frame: 0, base: 0, over: false, cleanup: false };
  const LT = { t: 0 };                         /* loop clock (v1 drift) */
  const ptr = { on: false, x: 0, y: 0, k: 0 };
  const pool = { x: 0, y: 0, init: false };
  const ST = { on: false, p: 0, target: 0, override: null, sent: -1, init: false, d: 80 };
  let pt = null, track = null;
  const DBG = { noSpray: false, noStamp: false, noFlush: false, noPhoto: false };   /* profiling and tuning switches (?gpu) */
  const CT = { n: 0 };                                                  /* latest setColors call */
  const ACT = { t: performance.now() };                                 /* last interaction (battery: 30 fps after 20 s idle) */
  const onAct = () => { ACT.t = performance.now(); };
  const ACT_EV = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'];
  ACT_EV.forEach(ev => window.addEventListener(ev, onAct, { passive: true }));
  const tilt = { on: false, x: 0, y: 0, tx: 0, ty: 0 };
  const fpsCap = () => Q.fps || (!I.on && performance.now() - ACT.t > 20000 ? 30 : 0);

  const stage = createStage(el, {
    poster: introFirst && tier !== 'low' ? null : posterURL, label: LABEL[LANG], className: 'dv3d--hero2',
    build, update, render, resize, scene: () => scene, camera: () => camera,
    continuous: () => I.on || (ptr.on && ptr.k > 0.001), dispose,
    dpr: () => (I.on ? Math.min(Q.dpr, 1.5) : Q.dpr), fps: fpsCap,      /* the spray (motion, lens blur) does not need 2x */
    /* after load, before three.js: the 1 s frame probe may lower the tier one step (decided once per visit) */
    preInit: async () => { if (T0.forced) return; const tv = await decideTier(); if (QT[tv]) { tier = tv; Q = QT[tier]; } },
    manual: tier === 'low' && !opts.live && !capture, liveLabel: LIVE[LANG][0], liveAria: LIVE[LANG][1]
  });
  if (introFirst && tier !== 'low' && posterURL) el.addEventListener('dv3d:fallback', () => stage.setPoster(posterURL), { once: true });
  /* the story's last frame as a still (the furnished room): without WebGL, and on the low tier (before and after
     "Live 3D"), it fades in over the poster or the macro while the track scrolls; the page gets the same events */
  const SS = { on: false, img: null, raf: 0, p: -1, cover: false };
  const stillURL = () => new URL(tall ? './hero2/poster-room-m.webp' : './hero2/poster-room.webp', BASE).href;
  function stillTick() {
    SS.raf = 0;
    if (!SS.on || stage.destroyed) return;
    const p = readScroll();
    if (Math.abs(p - SS.p) < 0.001) return;
    SS.p = p;
    const k = smooth(0.45, 0.85, p);
    if (k > 0 && !SS.img) {
      const im = document.createElement('img');
      im.className = 'dv3d__room'; im.alt = ''; im.decoding = 'async'; im.setAttribute('aria-hidden', 'true');
      im.src = stillURL(); stage.wrap.appendChild(im); SS.img = im;
    }
    if (SS.img) SS.img.style.opacity = String(k);
    const cover = k >= 0.999;                       /* the still covers the live macro (low tier after "Live 3D"): no frames under it */
    if (cover !== SS.cover) { SS.cover = cover; if (!cover && stage.ready) stage.invalidate(); }
    el.dispatchEvent(new CustomEvent('dv3d:story', { bubbles: true, detail: { progress: p, eased: storyEase(p) } }));
  }
  const stillScroll = () => { if (!SS.raf) SS.raf = requestAnimationFrame(stillTick); };
  function startStill() {
    if (SS.on || RMQ.matches || !resolveStory()) return;
    SS.on = true;
    window.addEventListener('scroll', stillScroll, { passive: true });
    window.addEventListener('resize', stillScroll, { passive: true });
    stillScroll();
  }
  el.addEventListener('dv3d:fallback', startStill, { once: true });
  if (tier === 'low') startStill();

  function tileGeom() {
    const cells = S.grain < 1 ? Math.round(Q.cells / Math.max(S.grain, 0.75) / 2) * 2 : Q.cells;
    const tileMM = cells * CELL_MM * S.grain;
    return { cells, tileMM, origin: [M.x - tileMM / 2, M.y - 30] };
  }

  async function build(st) {
    st.applySize();                                               /* pixel-ratio cap of the final tier */
    T = st.THREE; R = st.renderer;
    R.toneMapping = T.NeutralToneMapping; R.toneMappingExposure = 0.92;   /* hue-preserving: compositions keep their colour */
    scene = new T.Scene(); scene.background = new T.Color(0x0b0a09);
    camera = new T.PerspectiveCamera(22, st.w / st.h, 2, 4000);
    const halfOK = R.extensions.has('EXT_color_buffer_float') || R.extensions.has('EXT_color_buffer_half_float');
    const aniso = Math.min(8, R.capabilities.getMaxAnisotropy ? R.capabilities.getMaxAnisotropy() : 1);
    tile = createCoatTile(T, R, { size: Q.px, halfOK, aniso });
    spray = createSpray(T);
    room = createRoom(T);
    geo = tileGeom();
    U = Object.assign({
      uAlb: { value: tile.albedo }, uDat: { value: tile.data }, uTex: { value: Q.px }, uTileMM: { value: geo.tileMM },
      uCells: { value: geo.cells }, uOrigin: { value: new T.Vector2(...geo.origin) },
      uL: { value: new T.Vector3(0, 1, 0.3).normalize() }, uL2: { value: new T.Vector3(0.4, -0.75, 0.5).normalize() },
      /* key light close to neutral (v1 was 11.2 / 9.9 / 8.3): grey and green compositions keep their hue (colour truth, measured) */
      uLcol: { value: new T.Color().setRGB(10.3, 10.0, 9.5, T.LinearSRGBColorSpace) },
      uL2col: { value: new T.Color().setRGB(0.32, 0.38, 0.5, T.LinearSRGBColorSpace) },
      uPool: { value: new T.Vector3(0, 0, 17) }, uPoolK: { value: 1 }, uFocus: { value: 80 }, uAper: { value: Q.aper },
      uRelief: { value: 0.11 }, uFade: { value: 0.014 }, uAmb: { value: new T.Color().setRGB(0.035, 0.036, 0.042, T.LinearSRGBColorSpace) },
      uTime: { value: 0 }, uRes: { value: new T.Vector2(st.w, st.h) }, uSteps: { value: Q.steps },
      uClock: { value: 0 }, uWet: { value: 0 }, uVig: { value: 1 }, uRoom: { value: 0 }, uPrimer: { value: 0 }, uBomb: { value: 1 }
    }, room.uniforms);
    /* one shader source, two programs: lean macro, and macro + room for the scroll story (both compiled up front) */
    wallM = new T.ShaderMaterial({ vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, uniforms: U, defines: { ROOM: 0 } });
    wallR = new T.ShaderMaterial({ vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, uniforms: U, defines: { ROOM: 1 } });
    /* the whole feature wall of the room; the macro looks at a few centimetres of it */
    wall = new T.Mesh(new T.PlaneGeometry(ROOM.x1 - ROOM.x0, ROOM.ceil - ROOM.floor), wallM);
    wall.position.set((ROOM.x0 + ROOM.x1) / 2, (ROOM.floor + ROOM.ceil) / 2, 0);
    scene.add(wall, room.group, spray.mesh);
    RM.wall0 = { sx: 1, sy: 1, x: wall.position.x, y: wall.position.y, w: ROOM.x1 - ROOM.x0, h: ROOM.ceil - ROOM.floor };
    ST.on = resolveStory() && tier !== 'low';
    if (tier === 'low') startStill();                 /* the probe may have lowered the tier */
    if (ST.on && opts.room !== 'simple' && !RMQ.matches) {        /* reduced motion: no story, nothing to fetch */
      living = createLiving(T, R, { tier, fog: room.uniforms.uFog, time: U.uTime });
      scene.add(living.group);
      wallL = new T.ShaderMaterial({ vertexShader: WALL_VERT, fragmentShader: WALL_FRAG, uniforms: Object.assign({}, U, living.U), defines: living.cubic ? { ROOM: 2, DV_CUBIC: 1 } : { ROOM: 2 } });
      photoModule();                                  /* the photograph's module downloads while the hero compiles */
    }
    const coatP = buildCoatAsync(coatOpts());                 /* worker builds the granules while the room shader compiles */
    if (R.compileAsync) {
      const tmp = new T.Scene(); tmp.add(new T.Mesh(wall.geometry, wallR));
      try { await R.compileAsync(tmp, camera); } catch (e) { /* compiled on first use */ }
    }
    applyCoat(await coatP);
    gpu = gpuTimer(R);
    if (introFirst && Q.intro) startIntro(); else tile.stampAll();
    if (S.interactive) {
      /* mouse: the light follows the cursor; touch: it follows the finger while it is down (vertical scroll stays native) */
      pt = (typeof opts.pointerTarget === 'string' ? document.querySelector(opts.pointerTarget) : opts.pointerTarget) || st.wrap;
      if (pt !== st.wrap) pt.style.touchAction = 'pan-y pinch-zoom';
      pt.addEventListener('pointermove', onMove);
      pt.addEventListener('pointerdown', onMove);
      pt.addEventListener('pointerup', onUp);
      pt.addEventListener('pointercancel', onLeave);
      pt.addEventListener('pointerleave', onLeave);
    }
    if (living) {
      if (capture) { await prepLiving(); await loadPhoto(); }  /* recordings: deterministic, room and photograph are there from the start */
      else {
        /* The photograph is created at once: its WebGL context (about 0.1 s of main thread on a phone) lands in the
           first, still dark frames of the spray, and its programs compile in parallel while the intro plays, which takes
           seconds on a cold shader cache. The room's files are fetched into the cache now; the room itself is parsed
           after the intro or as soon as the story starts. So a visitor who scrolls during the intro still comes to rest
           on the photograph. */
        if (photoOK()) loadPhoto();
        living.prefetch();
        scheduleLiving();
      }
    }
  }

  /* furnished room: fetch after the intro when the page is idle (or at once when the story starts), then compile its
     programs off the critical path; until then the story ends in the simple room */
  function scheduleLiving() {
    if (!living || RM.busy || RM.ready) return;
    const go = () => { if (!RM.busy && !RM.ready && !stage.destroyed) prepLiving(); };
    const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 600));
    if (I.on) el.addEventListener('dv3d:intro-end', idle, { once: true }); else idle();
  }
  async function prepLiving() {
    if (!living || RM.busy || RM.ready) return;
    RM.busy = true;
    const ok = await living.load();
    if (ok && !stage.destroyed && R.compileAsync) {
      /* compile with the room's sun light present (lights are gathered from visible objects only) */
      const tmp = new T.Scene(); tmp.add(new T.Mesh(wall.geometry, wallL));
      living.group.visible = true;
      const pA = R.compileAsync(scene, camera), pB = R.compileAsync(tmp, camera);
      living.group.visible = false;
      try { await Promise.all([pA, pB]); } catch (e) { /* compiled on first use */ }
    }
    RM.busy = false; RM.ready = !!ok && !stage.destroyed;
    if (RM.ready) { photoModule(); schedulePhoto(); stage.invalidate(); stage.start(); }
  }
  /* the photograph is prepared at idle right after the room: its programs compile in parallel and that can take
     seconds, so a visitor who flicks through the story in two seconds still comes to rest on the photograph */
  function schedulePhoto() {
    if (PH.sched || PH.loading || PH.err) return;
    PH.sched = true;
    const go = () => { if (!stage.destroyed && !PH.loading && photoOK()) loadPhoto(); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 600);
  }

  /* ---------- the photoreal resting frame ----------
     The real-time room carries the pull-back. From about 72 % of the final distance the photograph of the same view
     (same camera) fades in over it (0.6 s, time based, so a visitor who stops scrolling there is not left on the
     real-time room); the rest of the way is a 2D zoom-out of the photograph that lands exactly on its frame. While it
     fully covers, the real-time room is not rendered; scrolling back up brings the real-time room back. */
  function photoModule() {
    /* photoroom.js is the photo mode behind DVInterior2.photoFrame / photoCamera (interior2.js re-exports it): the hero
       imports it directly, so it does not pull the live-room code; on a page with the interiors block both share it */
    if (!PH.modP) PH.modP = import('./photoroom.js').then(m => { PH.mod = { photoFrame: m.photoFrame, photoCamera: m.photoCamera }; photoCam(); return PH.mod; })
      .catch(e => { PH.err = true; console.warn('[dvatone 3d] photo frame unavailable:', e && e.message || e); return null; });
    return PH.modP;
  }
  /* the photo's camera for the current aspect (portrait only when the phone view exists) */
  function photoOK() { return !PH.err && camera && (camera.aspect >= 0.95 || PHOTO_TALL); }
  function photoCam() {
    if (!PH.mod || !photoOK()) return Promise.resolve(null);
    const key = camera.aspect.toFixed(3);
    if (key === PH.camKey && PH.camP) return PH.camP;
    PH.camKey = key;
    return (PH.camP = PH.mod.photoCamera('hero-end', camera.aspect).then(c => { if (PH.camKey === key) { PH.cam = c; stage.invalidate(); } return c; })
      .catch(e => { PH.err = true; console.warn('[dvatone 3d] photo camera unavailable:', e && e.message || e); return null; }));
  }
  async function loadPhoto() {
    if (PH.loading || PH.err || !photoOK()) return;
    PH.loading = true;
    const mod = await photoModule();
    if (!mod || stage.destroyed) return;
    await photoCam();
    if (stage.destroyed) return;
    try {
      const host = document.createElement('div');
      host.className = 'dv3d__photo'; host.setAttribute('aria-hidden', 'true');
      /* drawn larger than the stage (up to 1.4x, at most about 2700 device pixels across) and scaled down: the 2D zoom
         at the end of the pull-back then upsamples in the photograph's own bicubic shader instead of the compositor */
      PH.F = clamp(2700 / Math.max(1, stage.w * Math.min(window.devicePixelRatio || 1, 2)), 1, 1.4);
      host.style.width = host.style.height = (PH.F * 100).toFixed(2) + '%';      /* no transform yet: the frame measures its full size */
      stage.wrap.appendChild(host); PH.host = host;
      PH.ctl = mod.photoFrame(host, { colors: S.colors, grain: S.grain, poster: false });
      PH.ready = !!(await PH.ctl.ready) && !stage.destroyed;
      if (PH.ready) { stage.invalidate(); stage.start(); }
    } catch (e) { PH.err = true; console.warn('[dvatone 3d] photo frame not loaded:', e && e.message || e); }
  }
  /* where the current camera's view of the wall sits inside the photograph: a CSS zoom of the photo host */
  const ZV = {};
  function photoZoom() {
    const c = PH.cam; if (!c || !PH.host) return;
    const fv = living.finalViewFrom(c);
    const fc = PH.fcam || (PH.fcam = new T.PerspectiveCamera());
    fc.aspect = camera.aspect; fc.fov = fv.fov; fc.near = 50; fc.far = 30000;
    fc.position.copy(fv.target).add(fv.dir); fc.up.set(0, 1, 0); fc.lookAt(fv.target);
    portraitOffset(fc, 0, fv.shift);
    fc.updateProjectionMatrix(); fc.updateMatrixWorld(true);
    const v = ZV.v || (ZV.v = new T.Vector3()), w = ZV.w || (ZV.w = new T.Vector3());
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < 4; i++) {
      v.set(i & 1 ? 1 : -1, i & 2 ? 1 : -1, 0.5).unproject(camera).sub(camera.position);
      if (v.z >= -1e-6) return;
      w.copy(camera.position).addScaledVector(v, -camera.position.z / v.z).project(fc);
      x0 = Math.min(x0, w.x); x1 = Math.max(x1, w.x); y0 = Math.min(y0, w.y); y1 = Math.max(y1, w.y);
    }
    let s = clamp(4 / ((x1 - x0) + (y1 - y0)), 1, 3);
    const W = stage.w, H = stage.h;
    let px = ((x0 + x1) / 4 + 0.5) * W, py = (0.5 - (y0 + y1) / 4) * H;
    if (s < 1.0005) { s = 1; px = W / 2; py = H / 2; }
    PH.host.style.transform = 'translate(' + (W / 2 - s * px).toFixed(2) + 'px,' + (H / 2 - s * py).toFixed(2) + 'px) scale(' + (s / (PH.F || 1)).toFixed(5) + ')';
  }
  function photoStep(d, dt, rD) {
    if (living && !DBG.noPhoto && !PH.loading && !PH.err && ST.p > 0.01 && photoOK()) loadPhoto();   /* the story started before the idle slot */
    if (!living || !RM.use || DBG.noPhoto) { PH.target = 0; }
    else {
      const frac = d / Math.max(rD, 1);
      if (PH.ready && PH.cam && photoOK() && frac >= 0.72) PH.target = 1;
      else if (!PH.ready || frac < 0.66 || !photoOK()) PH.target = 0;               /* hysteresis: no flicker at the edge */
    }
    const k0 = PH.k;
    PH.k = PH.target > PH.k ? Math.min(PH.target, PH.k + (dt || 0) / 0.6) : Math.max(PH.target, PH.k - (dt || 0) / 0.45);
    if (stage.reduced && PH.target !== PH.k) PH.k = PH.target;
    if (PH.host && (PH.k > 0 || k0 > 0)) {
      PH.host.style.opacity = String(PH.k * PH.k * (3 - 2 * PH.k));
      if (PH.k > 0) photoZoom();
    }
  }
  /* which room ends the story; switching while the story is open crossfades */
  function useRoom(on) {
    RM.use = on;
    const w0 = RM.wall0, r = on && living.wallRect;
    if (r) { wall.scale.set((r.x1 - r.x0) / w0.w, (r.y1 - r.y0) / w0.h, 1); wall.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0); }
    else { wall.scale.set(1, 1, 1); wall.position.set(w0.x, w0.y, 0); }
    if (!on && living) living.setFade(0);
    if (on) room.setFade(0);
  }

  /* scroll story: on with a track (a tall element that holds the sticky hero), 'auto' = only when a track exists */
  function resolveStory() {
    const so = opts.scrollStory == null ? 'auto' : opts.scrollStory;
    if (so === false || so === 'false') return false;
    const sel = typeof so === 'string' && so !== 'auto' && so !== 'true' ? so : null;
    track = (opts.track && (typeof opts.track === 'string' ? document.querySelector(opts.track) : opts.track)) ||
      (sel && document.querySelector(sel)) || el.closest('[data-dv3d-track]');
    return so === 'auto' ? !!track : true;
  }
  function readScroll() {
    const vh = window.innerHeight || 1;
    if (track) { const r = track.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height - vh), 0, 1); }
    const r = el.getBoundingClientRect(); return clamp(-r.top / Math.max(1, r.height * 0.9), 0, 1);   /* no pin: plays while the hero leaves */
  }

  /* granules for the current composition; extra flights for tile repeats the intro camera sees */
  function coatOpts() {
    geo = tileGeom();
    const vc = new T.PerspectiveCamera(22, stage.w / stage.h, 2, 4000);
    const pose = {}; introPose(1.6, pose); applyCamera(vc, pose); vc.updateMatrixWorld(true);
    const vp = Array.from(new T.Matrix4().multiplyMatrices(vc.projectionMatrix, vc.matrixWorldInverse).elements);
    return { colors: S.colors, cells: geo.cells, px: Q.px, seed: S.seed, density: 0.95, sparkle: S.sparkle, tileMM: geo.tileMM, origin: geo.origin, vp, mistFrac: Q.mist };
  }
  function applyCoat(c) {
    coat = c;
    tile.setList(coat, { cells: geo.cells, seed: S.seed });
    spray.setList(coat.fly);
    I.end = coat.lastLanding + 1.05;
    U.uTileMM.value = geo.tileMM; U.uCells.value = geo.cells; U.uOrigin.value.set(...geo.origin);
  }

  /* over = a new composition sprayed over the current coat (the colour changes where the band lands); otherwise from the bare primer */
  function startIntro(over = false) {
    if (!over || I.base > 40) { tile.ground(); I.base = 0; over = false; } else I.base += 8;
    tile.setBase(I.base); I.over = over;
    I.on = true; I.clock = 0; I.frame = 0; LT.t = 0;
    if (stage.applySize && (window.devicePixelRatio || 1) > 1.5) stage.applySize();
    spray.mesh.visible = true;
    U.uWet.value = 1;
    if (!capture) markIntro();
  }
  function finishIntro() {
    I.on = false; spray.mesh.visible = false;
    if (stage.applySize && (window.devicePixelRatio || 1) > 1.5) stage.applySize();
    tile.flush();
    if (I.over) I.cleanup = true;          /* gaps still show the old coat: crossfade to the clean new coat */
    el.dispatchEvent(new CustomEvent('dv3d:intro-end', { bubbles: true }));
  }

  /* ---------- choreography ---------- */
  /* v1 drift, in wall coordinates relative to the focus */
  function loopPose(t, o) {
    const dr = Q.drift ? 1 : 0, lt = Q.drift ? t : t * 0.6;     /* phones: the camera holds still, only a slow light (battery) */
    o.fx = dr * 2.6 * Math.sin(TAU * t / 47); o.fy = dr * -1.6 * Math.sin(TAU * t / 61 + 1.1);
    o.D = 80 * (1 + dr * 0.025 * Math.sin(TAU * t / 53)); o.pitch = 0.7; o.focus = 0;
    o.el = 0.23 + 0.06 * Math.sin(lt * 0.13); o.az = 4.45 + 0.62 * Math.sin(TAU * lt / 36);
    const wx = camera && camera.aspect < 1 ? 0.45 : 1;          /* a narrow portrait frame: the light stays in view */
    o.px = 24 * wx * Math.sin(TAU * lt / 29); o.py = 3 - 12 * Math.sin(TAU * lt / 41 + 0.7); o.ps = 17; o.lit = 1;
    return o;
  }
  /* intro: the light follows the impact band down the wall, the lens half-follows focus, then everything settles */
  function introPose(c, o) {
    const g = geo || tileGeom();
    const band = g.origin[1] + g.tileMM * bandFrac(c - SCHED.spread * 0.45) - M.y;
    const k = smooth(0, I.end || 4.3, c);
    o.fx = mix(-9, 3, k); o.fy = mix(2, 0, k); o.D = mix(92, 80, k); o.pitch = 0.82;     /* slow glide + push-in: parallax between the beads and the wall */
    o.focus = clamp(band, -20, 45) * 0.5;
    o.el = 0.25; o.az = 4.45 + 0.08 * Math.sin(c * 0.9);
    o.px = 4 * Math.sin(c * 0.7); o.py = clamp(band + 4, -10, 40); o.ps = 22; o.lit = smooth(0.0, 0.9, c);
    return o;
  }
  const PA = {}, PB = {}, P = {};
  function blendPose(a, b, w, o) { for (const k in a) o[k] = mix(a[k], b[k], w); return o; }
  function macroFov(aspect) {
    const across = aspect < 1 ? 42 : (aspect < 1.4 ? 60 : 78);
    const hfov = 2 * Math.atan(across / (2 * 80));
    return clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180 / Math.PI, 8, 70);
  }
  function applyCamera(cam, p) {
    cam.position.set(M.x + p.fx, M.y + p.fy - p.D * Math.cos(p.pitch), p.D * Math.sin(p.pitch));
    cam.up.set(0, 1, 0);
    cam.lookAt(M.x + p.fx, M.y + p.fy, 0);
    cam.fov = macroFov(cam.aspect); cam.near = 2; cam.far = 4000;
    portraitOffset(cam);
    cam.updateProjectionMatrix();
  }
  /* portrait screens: the page text covers the lower half, so the lit focus is lifted to the upper part of the frame */
  function portraitOffset(cam, k = 1, shift = 0) {
    const o = (cam.aspect < 1 ? 0.17 * k : 0) - shift;          /* shift > 0: the frame moves up (lens shift, no tilt) */
    if (Math.abs(o) > 1e-4) cam.setViewOffset(1000, 1000 / cam.aspect, 0, (1000 / cam.aspect) * o, 1000, 1000 / cam.aspect);
    else if (cam.view && cam.view.enabled) cam.clearViewOffset();
  }
  /* scroll story camera: log-distance pull-back from the macro to an architectural, level view of the room */
  const SV = {};
  function storyCamera(p, e) {
    const V3 = T.Vector3;
    const a = camera.aspect, wide = a >= 1;
    const mT = SV.mT || (SV.mT = new V3()), mDir = SV.mD || (SV.mD = new V3()), rT = SV.rT || (SV.rT = new V3()), rDir = SV.rD || (SV.rD = new V3());
    mT.set(M.x + p.fx, M.y + p.fy, 0);
    mDir.set(0, -Math.cos(p.pitch), Math.sin(p.pitch));
    let fovEnd = wide ? 46 : 62, shift = 0;
    if (RM.use) {                                       /* furnished room: level camera (verticals stay vertical), lens shift */
      const fv = PH.cam && photoOK() ? living.finalViewFrom(PH.cam) : living.finalView(a);   /* = the photograph's camera */
      rT.copy(fv.target); rDir.copy(fv.dir); fovEnd = fv.fov; shift = fv.shift;
    } else {
      rT.set(wide ? 260 : 330, wide ? -170 : -40, 0);
      rDir.set(wide ? 560 : 120, wide ? -60 : -120, wide ? 3760 : 4800);
    }
    const rD = rDir.length(); rDir.normalize();
    const d = Math.exp(mix(L(p.D), L(rD), e));
    const tgt = mT.lerp(rT, Math.pow(e, 1.7));
    const dir = mDir.lerp(rDir, smooth(0, 1, e)).normalize();
    camera.position.copy(tgt).addScaledVector(dir, d);
    camera.lookAt(tgt);
    camera.fov = mix(macroFov(a), fovEnd, smooth(0.25, 1, e));
    camera.near = clamp(d * 0.03, 2, 90); camera.far = d * 3 + 12000;
    portraitOffset(camera, 1 - smooth(0.3, 1, e), shift * smooth(0.35, 1, e));
    camera.updateProjectionMatrix();
    SV.dist = rD;
    return d;
  }
  const storyEase = p => { const t = clamp((p - 0.06) / 0.82, 0, 1); return t * t * (3 - 2 * t); };   /* gentle: the middle distances get their time */
  /* Until the furnished room is in use, the pull-back waits on the coated wall (about 30 cm away, no room in view yet)
     instead of ending in the simple room, then glides on into the room (about 1.5 s). The page's events keep following
     the scroll. Only if the room cannot load (or after 20 s of waiting) does the simple room end the story. */
  const E_HOLD = 0.32;
  function holdStory(e, dt) {
    const wait = !!living && !RM.use && !RM.giveUp && !living.stats.failed;
    if (wait && e > 0) {
      if (!RM.waitT) RM.waitT = performance.now();
      else if (performance.now() - RM.waitT > 20000) RM.giveUp = true;
    }
    if (wait && !RM.giveUp && e > E_HOLD) { ST.held = true; return (ST.eh = E_HOLD); }
    if (ST.held) {
      if (e <= ST.eh) { ST.held = false; return (ST.eh = e); }
      ST.eh = Math.min(e, ST.eh + Math.max((e - ST.eh) * (1 - Math.exp(-(dt || 0) * 2.2)), (dt || 0) * 0.05));
      if (ST.eh >= e - 1e-4) ST.held = false;
      return ST.eh;
    }
    return (ST.eh = e);
  }

  function resize(w, h) {
    if (!camera) return;
    camera.aspect = w / h;
    const pr = stage.pr;
    U.uRes.value.set(w * pr, h * pr);
    U.uSteps.value = stepsNow();
    spray.uniforms.uRes.value.set(w * pr, h * pr);
    if (PH.mod) photoCam();
  }

  /* micro-shadow steps: fewer when the GPU is struggling, and during the spray (ramped back while it settles) */
  function stepsNow() {
    const full = stage.q < 0.85 ? Math.min(7, Q.steps) : Q.steps;
    return I.on ? Math.round(mix(Math.min(8, full), full, smooth(I.end - 1.6, I.end - 0.2, I.clock))) : full;
  }
  const vtmp = { v: null, f: null };
  function update(t, dt) {
    const still = stage.reduced;
    const u = U;
    dt = dt || 0;
    gpu && gpu.begin();
    /* intro clock + landings stamped into the coating (the mip chain is refreshed every fifth frame:
       blurred areas use the coarse mips, a frame of latency there is invisible) */
    if (I.on) {
      const prev = I.clock;
      I.clock += dt;
      if (dt > 0 && I.clock > coat.firstLanding - 0.05 && prev <= coat.lastLanding + 0.001) {
        if (!DBG.noStamp) tile.stamp(prev, I.clock, false, false);
        if (++I.frame % 5 === 0 && !DBG.noFlush) tile.flush();
      }
      if (I.clock >= I.end) finishIntro();
    } else if (u.uWet.value > 0) {            /* the last flecks keep drying after the hand-over */
      I.clock += dt;
      if (I.clock > coat.lastLanding + 3.5 || still) u.uWet.value = 0;
    }
    /* pose: intro -> v1 loop (the loop clock starts where the intro hands over) */
    let p;
    if (I.on) {
      introPose(I.clock, PA); loopPose(I.clock - I.end, PB);
      p = blendPose(PA, PB, smooth(I.end - 1.6, I.end, I.clock), P);
    } else {
      if (!still) LT.t += dt;
      p = loopPose(still ? 6.0 : LT.t, P);
    }
    /* scroll story progress (smoothed so wheel steps glide) */
    if ((ST.on || ST.override != null) && !still) {
      ST.target = ST.override != null ? ST.override : readScroll();
      if (!ST.init) { ST.p = ST.target; ST.init = true; }
      ST.p += (ST.target - ST.p) * (1 - Math.exp(-dt * 6.5));
      if (Math.abs(ST.target - ST.p) < 2e-4) ST.p = ST.target;
    } else ST.p = 0;
    const e0 = storyEase(ST.p);
    if (Math.abs(ST.p - ST.sent) > 0.002 || (ST.p === 0 && ST.sent !== 0)) {
      ST.sent = ST.p;
      el.dispatchEvent(new CustomEvent('dv3d:story', { bubbles: true, detail: { progress: ST.p, eased: e0 } }));
    }
    const e = holdStory(e0, dt);
    /* the furnished room takes over once it is ready: at once in the macro, with a crossfade inside the story */
    if (living && RM.ready && !RM.use && !RM.switching) {
      if (e <= 0) useRoom(true);
      else { RM.switching = true; crossfade(stage, () => { update(stage.t, 0); render(); }, () => { useRoom(true); RM.switching = false; }, 0.8); }
    }
    if (living && e > 0 && !RM.ready && !RM.busy && !living.stats.failed) prepLiving();     /* the story started before the idle slot came */
    applyCamera(camera, p);
    const d = e > 0 ? storyCamera(p, e) : p.D;
    wall.material = e > 0 ? (RM.use ? wallL : wallR) : wallM;
    ST.d = d;
    const ld = L(d);
    const kRoom = e > 0 ? smooth(L(170), L(1700), ld) : 0;
    const kFade = e > 0 ? smooth(L(380), L(2600), ld) : 0;
    const kMac = d / 80;
    /* focus distance: view depth of the focus point (the impact band during the intro, the wall in the story) */
    const fwd = vtmp.f || (vtmp.f = new T.Vector3()); camera.getWorldDirection(fwd);
    const fp = vtmp.v || (vtmp.v = new T.Vector3());
    fp.set(M.x + p.fx, M.y + p.fy + p.focus * (1 - e), 0).sub(camera.position);
    const focus = e > 0 ? mix(Math.max(20, fp.dot(fwd)), d, smooth(0, 0.3, e)) : Math.max(20, fp.dot(fwd));
    u.uFocus.value = focus; spray.uniforms.uFocus.value = focus;
    const aper = Q.aper * stage.pr * Math.pow(clamp(1 / kMac, 0, 1), 0.85);
    u.uAper.value = aper;
    /* raking light (macro) */
    const ce = Math.cos(p.el);
    u.uL.value.set(ce * Math.cos(p.az), -ce * Math.sin(p.az), Math.sin(p.el)).normalize();
    /* light pool: wanders, the cursor (desktop) pulls it; it widens as the camera pulls back */
    ptr.k += ((ptr.on && !still && !I.on ? 1 : 0) - ptr.k) * Math.min(1, dt * 2.2);
    tilt.x += (tilt.tx - tilt.x) * Math.min(1, dt * 3); tilt.y += (tilt.ty - tilt.y) * Math.min(1, dt * 3);
    const tx = p.px + tilt.x + (ptr.x - M.x - p.px - tilt.x) * ptr.k, ty = p.py + tilt.y + (ptr.y - M.y - p.py - tilt.y) * ptr.k;
    if (!pool.init || I.on) { pool.x = tx; pool.y = ty; pool.init = true; }
    else { pool.x += (tx - pool.x) * Math.min(1, dt * 3); pool.y += (ty - pool.y) * Math.min(1, dt * 3); }
    u.uPool.value.set(M.x + pool.x, M.y + pool.y, (p.ps - 4 * ptr.k) * Math.max(1, Math.pow(kMac, 0.9)));
    u.uPoolK.value = p.lit;
    u.uTime.value = still ? 0 : t;
    u.uClock.value = I.clock + I.base;
    u.uSteps.value = stepsNow();
    u.uRoom.value = kRoom;
    u.uFade.value = 0.014 * (1 - smooth(L(95), L(420), ld));
    u.uVig.value = mix(1, RM.use ? 0 : 0.3, kRoom);
    R.toneMappingExposure = mix(0.92, 1.2, kRoom);                     /* the sunlit room is a brighter scene than the macro */
    if (RM.use) { living.setFade(kFade); living.update(still ? 0 : t, kRoom); }
    else room.setFade(kFade);
    photoStep(d, dt, e > 0 ? SV.dist : 1e9);
    room.setTime(still ? 0 : t);
    /* spray */
    if (I.on) {
      const s = spray.uniforms;
      s.uT.value = I.clock; s.uAper.value = aper;
      s.uShutter.value = clamp((dt || 1 / 60) * 0.5, 1 / 240, 1 / 40);     /* half-frame exposure: smooth motion at any frame rate */
      s.uL.value.copy(u.uL.value); s.uLcol.value.copy(u.uLcol.value); s.uAmb.value.copy(u.uAmb.value);
      s.uPool.value.copy(u.uPool.value); s.uLight.value = p.lit;
      s.uNoz.value.set(M.x - 110, -30, 200);
      spray.mesh.visible = !DBG.noSpray && spray.at(I.clock);
    }
    u.uPrimer.value = I.on && !I.over ? 1 - smooth(I.end - 1.2, I.end, I.clock) : 0;
    /* the tile is complete again: the far-wall bombing comes back over 1.2 s (off while the spray stamps the tile) */
    u.uBomb.value = I.on || I.cleanup ? 0 : Math.min(1, u.uBomb.value + (dt || 0) / 1.2);
    if (still) u.uBomb.value = I.on ? 0 : 1;
    if (I.cleanup) {
      I.cleanup = false; I.over = false;
      crossfade(stage, () => { update(stage.t, 0); render(); }, () => { tile.stampAll(); tile.setBase(0); I.base = 0; }, 0.9);
    }
  }
  function render() {
    if ((PH.k >= 1 && PH.ready) || SS.cover) { gpu && gpu.end(); return; }   /* the photograph (or the still) covers: nothing to draw */
    R.render(scene, camera); gpu && gpu.end(); I.frames = (I.frames || 0) + 1;
  }

  const ray = { v: null };
  function onMove(e) {
    if (!camera || stage.reduced) return;
    if (e.pointerType !== 'mouse' && e.type === 'pointermove' && !e.isPrimary) return;
    const r = stage.wrap.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const v = ray.v || (ray.v = new T.Vector3());
    v.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    if (v.z >= -1e-3) return;
    const k = -camera.position.z / v.z;
    ptr.x = camera.position.x + v.x * k; ptr.y = camera.position.y + v.y * k; ptr.on = true;
    stage.start();
  }
  function onLeave() { ptr.on = false; }
  function onUp(e) { if (e.pointerType !== 'mouse') ptr.on = false; }
  /* optional tilt: only after a user gesture (iOS asks for permission), never automatic */
  function onTilt(e) {
    if (e.gamma == null || stage.reduced) return;
    tilt.tx = clamp(e.gamma / 28, -1, 1) * 20; tilt.ty = clamp((45 - (e.beta == null ? 45 : e.beta)) / 28, -1, 1) * 12;
    stage.start();
  }

  const ctl = {
    el, get ready() { return stage.readyP; },
    /* resolves when the new coat is on (the list is built off the main thread) */
    async setColors(colors, o = {}) {
      S.colors = normColors(colors && colors.length ? colors : DV033);
      if (o.grain != null) S.grain = clamp(+o.grain, 0.6, 1.8);
      if (o.sparkle != null) S.sparkle = clamp(+o.sparkle, 0, 1);
      if (o.seed != null) S.seed = +o.seed;
      if (!stage.ready || stage.destroyed) return;
      const tok = ++CT.n;
      if (PH.ctl) PH.ctl.setColors(S.colors, S.grain);              /* the photograph's wall follows (its own wipe) */
      const c = await buildCoatAsync(coatOpts());
      if (tok !== CT.n || stage.destroyed) return;               /* a newer composition was asked for meanwhile */
      if ((o.spray || I.on) && !stage.reduced) { applyCoat(c); startIntro(true); stage.invalidate(); stage.start(); return; }
      crossfade(stage, () => { update(stage.t, 0); render(); }, () => { applyCoat(c); tile.stampAll(); }, 1.1);
    },
    replay() {
      if (!stage.ready || stage.reduced) return;
      startIntro(); stage.invalidate(); stage.start();
    },
    /* scroll story: p in 0..1 overrides the scroll position (lab, recordings); null gives it back to the scroll */
    setStory(p, o = {}) {
      ST.override = p == null ? null : clamp(+p, 0, 1);
      if (o.instant && ST.override != null) { ST.p = ST.target = ST.override; ST.init = true; }
      stage.invalidate(); stage.start();
    },
    get story() { return { enabled: ST.on, progress: ST.p }; },
    get tier() { return tier; },
    /* low tier: start the live 3D (the "Live 3D" button does the same) */
    start() { stage.begin && stage.begin(); },
    /* call from a user gesture (a tap): the light then follows the tilt of the phone */
    async enableTilt() {
      if (tilt.on || typeof DeviceOrientationEvent === 'undefined') return tilt.on;
      try { if (typeof DeviceOrientationEvent.requestPermission === 'function' && (await DeviceOrientationEvent.requestPermission()) !== 'granted') return false; }
      catch (e) { return false; }
      window.addEventListener('deviceorientation', onTilt); tilt.on = true; return true;
    },
    disableTilt() { window.removeEventListener('deviceorientation', onTilt); tilt.on = false; tilt.tx = tilt.ty = 0; },
    stats() {
      return Object.assign({}, stage.stats, { granules: coat ? coat.granules : 0, flights: coat ? coat.fly.count : 0, stamps: tile ? tile.count : 0,
        tile: Q.px, tier, fpsCap: fpsCap(), frames: I.frames || 0, room: RM.use ? 'furnished' : 'simple', roomMs: living ? living.stats.ms : 0, photo: PH.ready ? +PH.k.toFixed(3) : (PH.err ? 'error' : (PH.loading ? 'loading' : 'off')), light: [Math.round(pool.x), Math.round(pool.y)], intro: I.on ? +I.clock.toFixed(2) : -1, story: +ST.p.toFixed(3), storyCam: +(ST.eh || 0).toFixed(3), gpuMs: gpu ? +gpu.ms.toFixed(2) : undefined });
    },
    renderFrame() { if (stage.ready) { update(stage.t, 0); render(); } },
    get debug() { return gpu ? { U, Q, stage, DBG, living, PH, ST, SV } : null; },          /* ?gpu only: internals for profiling */
    destroy() { stage.destroy(); }
  };
  el.dv3d = ctl;
  return ctl;

  function dispose() {
    if (pt) { ['pointermove', 'pointerdown'].forEach(ev => pt.removeEventListener(ev, onMove)); pt.removeEventListener('pointerup', onUp); ['pointercancel', 'pointerleave'].forEach(ev => pt.removeEventListener(ev, onLeave)); }
    ACT_EV.forEach(ev => window.removeEventListener(ev, onAct));
    if (SS.on) { window.removeEventListener('scroll', stillScroll); window.removeEventListener('resize', stillScroll); SS.on = false; }
    window.removeEventListener('deviceorientation', onTilt);
    tile && tile.dispose(); spray && spray.dispose(); room && room.dispose(); wallM && wallM.dispose(); wallR && wallR.dispose(); wall && wall.geometry.dispose();
    living && living.dispose(); wallL && wallL.dispose();
    if (PH.ctl) PH.ctl.destroy(); if (PH.host) PH.host.remove();
  }
}

/* GPU time per frame (debug, ?gpu): EXT_disjoint_timer_query_webgl2 around the stamp passes and the frame */
function gpuTimer(R) {
  if (typeof location === 'undefined' || !/[?&]gpu\b/.test(location.search)) return null;
  const gl = R.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return null;
  const pend = []; let q = null;
  const t = {
    ms: 0,
    begin() { if (q) return; q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); },
    end() {
      if (!q) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT); pend.push(q); q = null;
      while (pend.length && gl.getQueryParameter(pend[0], gl.QUERY_RESULT_AVAILABLE)) {
        const p = pend.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6; t.ms = t.ms ? t.ms * 0.9 + ms * 0.1 : ms; }
        gl.deleteQuery(p);
      }
    }
  };
  return t;
}

function autoMount() {
  document.querySelectorAll('[data-dv3d="hero2"]').forEach(el => {
    if (el.dv3d) return;
    let colors = null; try { colors = JSON.parse(el.getAttribute('data-colors') || 'null'); } catch (e) { colors = null; }
    const poster = el.getAttribute('data-poster'), intro = el.getAttribute('data-intro'), story = el.getAttribute('data-scroll-story');
    mount(el, {
      colors, grain: +el.getAttribute('data-grain') || 1,
      sparkle: el.hasAttribute('data-sparkle') ? +el.getAttribute('data-sparkle') : undefined,
      intro: intro == null ? true : (intro === 'false' ? false : (intro === 'always' ? 'always' : true)),
      scrollStory: story == null ? 'auto' : (story === 'false' ? false : (story === 'true' ? true : story)),
      poster: poster === 'none' ? false : (poster || undefined), pointerTarget: el.getAttribute('data-pointer-target') || undefined,
      room: el.getAttribute('data-room') || undefined
    });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
