/* Dvatone 3D core (shared by interior.js, pack.js, hero.js)
   - three.js r180, pinned, loaded from jsDelivr only when a module becomes visible
     (set window.DV3D_THREE_URL before loading a module to self-host it later)
   - Stage: poster first, lazy init when near the viewport, pause off-screen and in hidden tabs,
     devicePixelRatio cap 2 with an adaptive drop when frames get slow, static fallback when
     WebGL2 is missing, prefers-reduced-motion (no drift, renders on demand)
   - Granular coating baker: fine multicolour granules into a seamless tile (albedo + data maps)
   No console output except real errors. */

export const THREE_VERSION = '0.180.0';
const THREE_URL = (typeof window !== 'undefined' && window.DV3D_THREE_URL) ||
  'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION + '/build/three.module.min.js';

let threeP = null;
export function loadThree() {
  if (!threeP) threeP = import(/* @vite-ignore */ THREE_URL);
  return threeP;
}

/* ---------- capability checks ---------- */
let glOK = null;
export function hasWebGL2() {
  if (glOK !== null) return glOK;
  try {
    if (/[?&]nowebgl\b/.test(location.search)) return (glOK = false);
    const c = document.createElement('canvas');
    const gl = window.WebGL2RenderingContext && c.getContext('webgl2');
    glOK = !!gl;
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { glOK = false; }
  return glOK;
}
const RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() {} };
const FINE = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : { matches: true };
export const isFinePointer = () => FINE.matches;
export const isSmallScreen = () => Math.min(screen.width, screen.height) < 820;

/* ---------- global registry (debug + deterministic capture for recordings) ---------- */
const G = (typeof window !== 'undefined') ? (window.DV3D = window.DV3D || {}) : {};
G.version = THREE_VERSION;
G.stages = G.stages || new Set();
G.capture = G.capture || /[?&]capture\b/.test(typeof location !== 'undefined' ? location.search : '');
G.step = function (dt) { G.stages.forEach(s => s._step(dt == null ? 1 / 30 : dt)); };

/* ---------- CSS (injected once) ---------- */
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
function injectCSS() {
  if (document.getElementById('dv3d-css')) return;
  const s = document.createElement('style'); s.id = 'dv3d-css'; s.textContent = CSS; document.head.appendChild(s);
}

/* ---------- Stage ----------
   cfg: { poster, label, className, alpha, antialias, build(stage) -> Promise, update(t, dt), render(), resize(w, h),
          dispose(), continuous: () => bool (true = needs frames even with reduced motion) } */
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
  let raf = 0, ticking = false, last = 0, ema = 16.7, sinceCheck = 0, warm = 0, slow = 0, fast = 0, badQ = 9, badT = -1e9, needFrame = true, t0 = performance.now();
  let resolveReady; st.readyP = new Promise(r => (resolveReady = r));

  function setPoster(src) { if (src) { poster.style.display = ''; poster.src = src; } }
  function fail(err) {
    if (st.failed) return;
    st.failed = true; stop();
    wrap.classList.remove('is-live'); wrap.classList.add('is-fallback');
    if (err && !/nowebgl/.test(String(err))) console.error('[dvatone 3d]', err);
    el.dispatchEvent(new CustomEvent('dv3d:fallback', { bubbles: true, detail: { reason: String(err || '') } }));
    resolveReady(false);
  }

  /* lazy init: start loading a little before the element scrolls in */
  const ioInit = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { ioInit.disconnect(); init(); }
  }, { rootMargin: '300px 0px' });
  /* run only while actually on screen */
  const ioRun = new IntersectionObserver(es => {
    const e = es[es.length - 1];
    st.visible = e.isIntersecting && e.intersectionRect.width > 0 && e.intersectionRect.height > 0;   /* touching the edge is not visible */
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
    let THREE;
    try { THREE = await loadThree(); } catch (e) { return fail(e); }
    if (st.destroyed) return;
    st.THREE = THREE;
    const tb = performance.now();
    try {
      const renderer = new THREE.WebGLRenderer({
        /* MSAA only where pixels are large; dense screens are already smooth at their pixel ratio */
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
  function applySize() {
    if (!st.renderer) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    st.pr = Math.max(0.7, dpr * st.q);              /* cap 2; may drop below 1 only on a genuinely slow GPU */
    st.renderer.setPixelRatio(st.pr);
    st.renderer.setSize(st.w, st.h, false);
    st.stats.pr = +st.pr.toFixed(2); st.stats.w = st.w; st.stats.h = st.h; st.stats.quality = +st.q.toFixed(2);
  }

  function running() { return st.ready && !st.failed && !st.destroyed && st.visible && !document.hidden; }
  function wantsLoop() { return !st.reduced || !!st._fade || (cfg.continuous && cfg.continuous()); }
  function sync() {
    if (G.capture) return;
    if (running() && (wantsLoop() || needFrame)) start(); else if (!running()) stop();
  }
  /* `ticking`: an invalidate() from inside update/render must not start a second rAF loop (every frame was then
     drawn twice); tick() itself schedules the next frame once it is done (found by the pack2 agent, 07.10) */
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
    const raw = (now - last) / 1000; last = now;
    const dt = Math.min(raw, 0.1);                 /* animation step never jumps */
    needFrame = false;
    ticking = true;
    try { frame(dt); } finally { ticking = false; }
    /* adaptive resolution: EMA of the real frame interval, checked about once a second after a warm-up */
    if (raw > 0 && raw < 0.5 && wantsLoop() && !G.noAdapt) {
      ema = ema * 0.9 + raw * 1000 * 0.1; warm += raw; sinceCheck += raw;
      st.stats.ms = +ema.toFixed(1); st.stats.fps = Math.round(1000 / ema);
      if (warm > 1.5 && sinceCheck > 0.8) {
        sinceCheck = 0;
        const minQ = 0.7 / Math.min(window.devicePixelRatio || 1, 2);
        slow = ema > 24 ? slow + 1 : 0;              /* two slow checks in a row, not a single hiccup */
        fast = ema < 17.6 ? fast + 1 : 0;            /* running at the display rate */
        const now = performance.now();
        if (slow >= 2 && st.q > minQ + 0.001) {
          /* proportional step: pixel count scales with q^2, aim at ~16 ms per frame */
          badQ = st.q; badT = now;
          st.q = Math.max(minQ, st.q * Math.min(0.9, Math.max(0.45, Math.sqrt(15.5 / ema))));
          applySize(); cfg.resize && cfg.resize(st.w, st.h); warm = 0.9; ema = 16.7; slow = 0; fast = 0;
        } else if (fast >= 4 && st.q < 1) {
          /* recover after a load spike; never straight back to a level that was too slow in the last 30 s */
          let q = Math.min(1, st.q * 1.15);
          if (now - badT < 30000) q = Math.min(q, badQ * 0.92);
          if (q > st.q + 0.01) { st.q = q; applySize(); cfg.resize && cfg.resize(st.w, st.h); warm = 0.6; }
          fast = 0;
        }
      }
    }
    if (!raf && (wantsLoop() || needFrame)) raf = requestAnimationFrame(tick);   /* needFrame: invalidated during this frame */
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
    wrap.remove(); G.stages.delete(st);
  };
  st.start = sync;
  G.stages.add(st);
  return st;
}

/* Crossfade a state change: freeze the current frame in a 2D overlay, apply the change, fade the overlay out.
   (drawImage right after render, in the same task, works without preserveDrawingBuffer) */
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
  st._fade = { cv, k: 0, dur };          /* advanced by the stage clock (also in deterministic capture) */
  st.invalidate(); st.start();
}
function advanceFade(st, dt) {
  const f = st._fade; if (!f) return;
  f.k += dt / f.dur;
  const k = Math.min(1, f.k), e = 1 - Math.pow(1 - k, 3);
  f.cv.style.opacity = String(1 - e);
  if (k >= 1) { f.cv.style.opacity = '0'; st._fade = null; }
}

/* ---------- helpers ---------- */
export function moduleURL(rel, base) { return new URL(rel, base).href; }
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smooth = t => t * t * (3 - 2 * t);
export const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Normalise a composition: accepts [{hex, share}] or generator mix items {sys, code, hex, share}.
    2 to 6 colours (1 is allowed for a plain shade), shares re-scaled to sum to 100. */
export function normColors(list) {
  let arr = Array.isArray(list) ? list.slice(0, 6) : [];
  arr = arr.map(c => {
    const hex = String((c && (c.hex || c.color)) || '').replace('#', '').trim();
    return { hex: /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : null, share: Math.max(0, +((c && c.share) != null ? c.share : 1)) };
  }).filter(c => c.hex);
  if (!arr.length) arr = [{ hex: 'B8A389', share: 45 }, { hex: 'B4986D', share: 20 }, { hex: '9F9287', share: 20 }, { hex: 'E4D1B4', share: 15 }];
  let sum = arr.reduce((a, c) => a + c.share, 0);
  if (sum <= 0) { arr.forEach(c => (c.share = 1)); sum = arr.length; }
  arr.forEach(c => (c.share = c.share * 100 / sum));
  return arr;
}

/** Rounded box with smooth normals and box-projected UVs in metres (consistent texel density). */
export function roundedBox(THREE, w, h, d, r, seg = 3, bulge = 0) {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const s = seg * 2 + 1;
  const g = new THREE.BoxGeometry(1, 1, 1, s, s, s).toNonIndexed();
  const p = g.attributes.position.array, n = g.attributes.normal.array, uv = g.attributes.uv.array;
  const bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r, half = 0.5 / s;
  for (let i = 0, j = 0; i < p.length; i += 3, j += 2) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    let nx = x - Math.sign(x) * half, ny = y - Math.sign(y) * half, nz = z - Math.sign(z) * half;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let px = bx * Math.sign(x) + nx * r, py = by * Math.sign(y) + ny * r, pz = bz * Math.sign(z) + nz * r;
    if (bulge) {                       /* soft cushion: lift the faces towards their middle */
      const u = px / (w / 2), v = py / (h / 2), q = pz / (d / 2);
      const fx = 1 - u * u, fy = 1 - v * v, fz = 1 - q * q;
      const by2 = bulge * fx * fz, bxz = bulge * 0.35 * fy;
      py += Math.sign(ny) * by2 * Math.abs(ny);
      px += Math.sign(nx) * bxz * fz * Math.abs(nx); pz += Math.sign(nz) * bxz * fx * Math.abs(nz);
      if (Math.abs(ny) > 0.5) {
        const gx = bulge * (-2 * u / (w / 2)) * fz, gz = bulge * fx * (-2 * q / (d / 2));
        nx -= gx * Math.sign(ny) * 0.9; nz -= gz * Math.sign(ny) * 0.9;
        const l2 = Math.hypot(nx, ny, nz); nx /= l2; ny /= l2; nz /= l2;
      }
    }
    p[i] = px; p[i + 1] = py; p[i + 2] = pz; n[i] = nx; n[i + 1] = ny; n[i + 2] = nz;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ay >= ax && ay >= az) { uv[j] = px; uv[j + 1] = pz; }
    else if (ax >= az) { uv[j] = pz; uv[j + 1] = py; }
    else { uv[j] = px; uv[j + 1] = py; }
  }
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

/* ---------- fullscreen bake helper ---------- */
export function createBaker(THREE, renderer) {
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geo); mesh.frustumCulled = false; scene.add(mesh);
  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;
  const halfOK = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');

  function target(w, h, o = {}) {
    const mip = o.mip !== false;
    return new THREE.WebGLRenderTarget(w, h || w, {
      type: o.half && halfOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
      colorSpace: o.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      generateMipmaps: mip,
      minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      wrapT: o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping,
      anisotropy: Math.min(o.aniso || 8, maxAniso),
      depthBuffer: false
    });
  }
  function run(material, rt) {
    mesh.material = material;
    const prev = renderer.getRenderTarget();
    const sh = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
    renderer.shadowMap.autoUpdate = sh;
  }
  function shader(frag, uniforms) {
    return new THREE.ShaderMaterial({
      uniforms: uniforms || {},
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: frag, depthTest: false, depthWrite: false
    });
  }
  return { target, run, shader, halfOK, maxAniso, dispose() { geo.dispose(); } };
}

/* ---------- GLSL shared ---------- */
export const GLSL_HASH = `
uvec3 pcg3d(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
vec3 rnd3(ivec2 c, int k, float seed){
  return vec3(pcg3d(uvec3(uvec2(c), uint(k) * 747796405u + uint(seed)))) * (1.0/4294967295.0);
}
ivec2 wrapc(ivec2 c, int n){ return ((c % n) + n) % n; }
float vnoise(vec2 p, int n, int k, float seed){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  ivec2 ii = ivec2(i);
  float a = rnd3(wrapc(ii, n), k, seed).x;
  float b = rnd3(wrapc(ii + ivec2(1,0), n), k, seed).x;
  float c = rnd3(wrapc(ii + ivec2(0,1), n), k, seed).x;
  float d = rnd3(wrapc(ii + ivec2(1,1), n), k, seed).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/* Granular coating: a dead-leaves model of sprayed gel granules.
   Every granule is an irregular flattened fleck; its colour is drawn from the composition by share,
   so the visible area of each colour equals its share and the mix reads as one even colour at
   distance (no low-frequency clouds, so it can never look blotchy). Seamless: all lattices wrap. */
const GRANULE_FRAG = `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform vec3 uCol[6];
uniform float uCum[6];
uniform int uN;
uniform float uCells;
uniform float uPx;
uniform float uPresence;
uniform float uSparkle;
uniform float uSeed;
uniform vec3 uGround;
uniform vec3 uGlint;
uniform int uPass;
uniform int uOne;        /* = 1; uniform loop bounds keep HLSL/Metal compilers from unrolling (fast compile) */
uniform int uLayers;     /* = 7: five granule lattices, fines, mica */
uniform vec2 uLat;       /* periodic rank-1 lattice generator (a/n, b/n) for the colour sequence */
${GLSL_HASH}
vec3 pickCol(float u){
  int k = 0;
  for (int i = 0; i < uN - 1; i++) { if (u > uCum[i]) k = i + 1; }
  return uCol[k];
}
void main(){
  int n = int(uCells + 0.5);
  vec2 p = vUv * uCells;
  /* gentle periodic domain warp so no lattice ever shows */
  vec2 wq = vec2(vnoise(p * 0.5, n / 2, 3, uSeed), vnoise(p * 0.5, n / 2, 7, uSeed)) - 0.5;
  vec2 wf = vec2(vnoise(p * 2.0, n * 2, 11, uSeed), vnoise(p * 2.0, n * 2, 13, uSeed)) - 0.5;
  vec2 q = p + wq * 0.55 + wf * 0.12;
  float edge = 1.15 / uPx;
  /* top two candidates by depth (dead-leaves), composited over the ground with soft edges */
  float tz = -1.0, ta = 0.0, th = 0.0, tr = 0.88, tm = 0.0; vec3 tc = uGround;
  float sz = -1.0, sa = 0.0, sh = 0.0, sr = 0.88, sm = 0.0; vec3 sc = uGround;
  for (int L = 0; L < uLayers; L++) {
    bool fines = L == 5, mica = L == 6;
    if (mica && uSparkle < 0.001) break;
    float sc0 = fines ? 2.0 : (mica ? 1.5 : 1.0);
    int nL = fines ? n * 2 : (mica ? n + n / 2 : n);
    vec2 off = vec2(fract(float(L) * 0.5), fract(float(L) * 0.25 + 0.5 * float(L / 2)));
    vec2 qL = q * sc0 + off;
    float presence = fines ? 0.22 : (mica ? uSparkle * 0.11 : uPresence);
    float rmin = fines ? 0.16 : (mica ? 0.16 : 0.28), rmax = fines ? 0.3 : (mica ? 0.3 : 0.76);
    float e = edge * sc0;
    ivec2 ci = ivec2(floor(qL));
    for (int j = -uOne; j <= uOne; j++) for (int i = -uOne; i <= uOne; i++) {
      ivec2 c = ci + ivec2(i, j);
      ivec2 cw = wrapc(c, nL);
      vec3 a = rnd3(cw, L * 4 + 1, uSeed);
      if (a.x >= presence) continue;
      vec3 b = rnd3(cw, L * 4 + 2, uSeed);
      vec3 f = rnd3(cw, L * 4 + 3, uSeed);
      vec3 g = rnd3(cw, L * 4, uSeed);
      vec2 d = qL - (vec2(c) + 0.5 + (a.yz - 0.5) * 0.9);
      float rad = mix(rmin, rmax, b.y * b.y);
      /* crumbly outline: warp the local frame with fine periodic noise */
      if (!mica) d += (vec2(vnoise(qL * 3.0, nL * 3, 31 + L, uSeed), vnoise(qL * 3.0, nL * 3, 47 + L, uSeed)) - 0.5) * rad * 0.55;
      float ang = b.x * 6.2831853, cs = cos(ang), sn = sin(ang);
      d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
      d.y /= mix(mica ? 0.4 : 0.5, 1.0, b.z);
      float ta0 = atan(d.y, d.x);
      float wob = 0.12 * sin(2.0 * ta0 + f.x * 6.283) + 0.08 * sin(3.0 * ta0 + f.y * 6.283) + 0.05 * sin(5.0 * ta0 + f.z * 6.283)
                + 0.035 * sin(7.0 * ta0 + g.y * 6.283) + 0.022 * sin(11.0 * ta0 + g.z * 6.283);
      float R = rad * (1.0 + (mica ? 0.0 : wob));
      float rr = mica ? max(abs(d.x), abs(d.y) * 0.8) / R : length(d) / R;
      float w = e / R;
      if (rr >= 1.0 + w) continue;
      float z = mica ? 0.75 + 0.35 * a.y : g.x + (fines ? 0.1 : 0.0);
      float al = 1.0 - smoothstep(1.0 - w, 1.0 + w, rr);
      vec3 col; float hh, ro, me;
      if (mica) {
        /* tilted flake: catches the light only at certain angles, so it glints as the light moves */
        vec2 td = vec2(cos(f.x * 6.2831853), sin(f.x * 6.2831853));
        col = uGlint * (0.8 + 0.4 * b.y); hh = 0.6 + dot(d, td) / R * 0.34; ro = 0.14 + 0.1 * b.z; me = 1.0;
      }
      else {
        /* colour by share from a periodic low-discrepancy lattice: neighbouring granules rarely repeat a colour
           (no clumps, no blotches at any distance) and the sequence wraps exactly at the tile edge (no seam grid) */
        float u = fines ? g.y : fract(0.5 + float(cw.x) * uLat.x + float(cw.y) * uLat.y + float(L) * 0.381966 + (g.y - 0.5) * 0.3);
        col = pickCol(u) * (0.94 + 0.12 * g.z) * mix(0.965, 1.0, smoothstep(1.0, 0.55, rr));
        float lip = smoothstep(1.0, 0.5, rr);
        hh = 0.18 + 0.45 * g.x + 0.4 * lip * (0.75 + 0.25 * sqrt(max(0.0, 1.0 - rr * rr)));
        ro = 0.66 + 0.16 * f.x; me = 0.0;
      }
      if (z > tz) { sz = tz; sa = ta; sh = th; sr = tr; sm = tm; sc = tc; tz = z; ta = al; th = hh; tr = ro; tm = me; tc = col; }
      else if (z > sz) { sz = z; sa = al; sh = hh; sr = ro; sm = me; sc = col; }
    }
  }
  vec3 col = mix(uGround, sc, sa);
  float hh = mix(0.0, sh, sa), ro = mix(0.88, sr, sa), me = mix(0.0, sm, sa);
  col = mix(col, tc, ta); hh = mix(hh, th, ta); ro = mix(ro, tr, ta); me = mix(me, tm, ta);
  float m = vnoise(p * 4.0, n * 4, 17, uSeed) - 0.5;      /* faint mottling inside granules */
  col *= 1.0 + m * 0.05;
  hh += m * 0.04;
  if (uPass == 0) gl_FragColor = vec4(col, 1.0);
  else gl_FragColor = vec4(clamp(hh, 0.0, 1.0), ro, me, 1.0);
}
`;

/* rank-1 lattice generator for a period n: coprime with n, best separation of the values of the first two rings
   of neighbouring cells (searched once per tile size, cached) */
const LAT = {};
function latticeFor(n) {
  if (LAT[n]) return LAT[n];
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const r1 = [[1, 0], [0, 1], [1, 1], [1, -1]], r2 = [[2, 1], [1, 2], [2, -1], [1, -2], [2, 0], [0, 2], [2, 2], [2, -2]];
  const sep = (a, b, vs) => { let m = 1; for (const [x, y] of vs) { const f = (((a * x + b * y) % n) + n) % n / n; m = Math.min(m, f, 1 - f); } return m; };
  let best = [-1, 1, 1];
  for (let a = 1; a < n; a++) {
    if (gcd(a, n) !== 1) continue;
    for (let b = 1; b < n; b++) {
      if (gcd(b, n) !== 1) continue;
      const s = Math.min(sep(a, b, r1), 1.6 * sep(a, b, r2));
      if (s > best[0]) best = [s, a, b];
    }
  }
  return (LAT[n] = [best[1] / n, best[2] / n]);
}

/** Bakes a seamless coating tile. Returns { albedo, data, cells, dispose } where
    albedo = sRGB colour texture, data = R height, G roughness, B metalness (linear). */
export function bakeGranules(THREE, baker, o) {
  const cols = normColors(o.colors);
  const size = o.size || 1024;
  const cells = o.cells || 128;
  const density = clamp(o.density == null ? 0.92 : +o.density, 0.4, 1);
  const lin = cols.map(c => new THREE.Color('#' + c.hex));          /* sRGB hex -> linear working space */
  const mean = new THREE.Color(0, 0, 0);
  cols.forEach((c, i) => { mean.r += lin[i].r * c.share / 100; mean.g += lin[i].g * c.share / 100; mean.b += lin[i].b * c.share / 100; });
  const cum = []; let acc = 0;
  for (let i = 0; i < 6; i++) { acc += cols[i] ? cols[i].share / 100 : 0; cum.push(i < cols.length - 1 ? acc : 2); }
  /* coverage target -> fleck presence per layer (5 layers, mean fleck area ~0.55 cell^2) */
  const C = Math.min(density, 0.94);
  const presence = clamp(-Math.log(1 - C) / (5 * 0.55), 0.05, 1);
  const base = lin[0].clone().multiplyScalar(0.92);
  const ground = base.lerp(mean, clamp((density - 0.55) / 0.4, 0, 1));
  const glint = new THREE.Color(o.glint || '#d9b45a');
  const colArr = []; for (let i = 0; i < 6; i++) colArr.push((lin[i] || lin[lin.length - 1]).clone());
  const uniforms = {
    uCol: { value: colArr }, uCum: { value: cum }, uN: { value: cols.length },
    uCells: { value: cells }, uPx: { value: size / cells }, uPresence: { value: presence },
    uSparkle: { value: clamp(o.sparkle || 0, 0, 1) }, uSeed: { value: (o.seed == null ? 11 : o.seed) % 65536 },
    uGround: { value: ground }, uGlint: { value: glint }, uPass: { value: 0 }, uOne: { value: 1 }, uLayers: { value: 7 },
    uLat: { value: new THREE.Vector2(...latticeFor(cells)) }
  };
  const mat = baker.shader(GRANULE_FRAG, uniforms);
  const albedo = baker.target(size, size, { srgb: true });
  const data = baker.target(size, size, { half: !!o.halfData });
  baker.run(mat, albedo);
  uniforms.uPass.value = 1;
  baker.run(mat, data);
  mat.dispose();
  return {
    albedo: albedo.texture, data: data.texture, cells, size, mean,
    dispose() { albedo.dispose(); data.dispose(); }
  };
}
