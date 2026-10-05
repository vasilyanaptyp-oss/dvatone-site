/* Dvatone hero: macro view of the granular coating. A low raking light drifts across the surface and
   reveals the granules (micro-shadows, satin sheen, mica glints), with a macro-lens depth of field.
   DVHero.mount(el, { colors:[{hex, share}] (default DV 033), grain:0.6..1.8, sparkle:0..1, interactive:true, pointerTarget? })
   -> { setColors(colors, {grain, sparkle}?), destroy(), stats(), ready }
   Declarative: <div data-dv3d="hero"></div>  (optional data-colors / data-grain / data-sparkle) */
import { createStage, createBaker, bakeGranules, normColors, clamp, crossfade, isSmallScreen, isFinePointer } from './core.js';

const BASE = import.meta.url;
/* DV 033 "Honey": palette sampled from the client's macro photo (assets/img/dv033.webp), lifted to albedo */
export const DV033 = [
  { hex: '806438', share: 33 }, { hex: '5A4220', share: 24 }, { hex: 'A88C5C', share: 18 },
  { hex: 'D4C095', share: 17 }, { hex: '3A2810', share: 8 }
];
const LANG = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk';
const LABEL = { uk: 'Макро-фактура покриття Dvatone: світло ковзає поверхнею й проявляє гранули', en: 'Macro texture of a Dvatone coating: a raking light glides over the surface and reveals the granules' };
const CELL_MM = 0.9;

const VERT = `
varying vec3 vW;
varying float vDepth;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
precision highp float;
uniform sampler2D uAlb;
uniform sampler2D uDat;
uniform float uTex;
uniform float uTileMM;
uniform float uCells;
uniform vec3 uL;
uniform vec3 uL2;
uniform vec3 uLcol;
uniform vec3 uL2col;
uniform vec3 uPool;
uniform float uFocus;
uniform float uAper;
uniform float uRelief;
uniform float uFade;
uniform vec3 uAmb;
uniform float uTime;
uniform vec2 uRes;
uniform float uSteps;
varying vec3 vW;
varying float vDepth;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  vec2 uv = vW.xz / uTileMM;
  vec2 dx = dFdx(uv) * uTex, dy = dFdy(uv) * uTex;
  float lod0 = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  float coc = abs(1.0 - uFocus / vDepth) * uAper;               /* blur in screen pixels */
  float lod = max(0.0, lod0 + log2(max(coc, 1.0)));
  float tx = exp2(lod) / uTex;
  vec4 d = textureLod(uDat, uv, lod);
  vec3 alb;
  if (coc > 1.6) {
    float a = ign(gl_FragCoord.xy) * 6.2831853;
    vec2 o1 = vec2(cos(a), sin(a)) * tx * 0.8, o2 = vec2(-o1.y, o1.x);
    alb = (textureLod(uAlb, uv + o1, lod).rgb + textureLod(uAlb, uv - o1, lod).rgb + textureLod(uAlb, uv + o2, lod).rgb + textureLod(uAlb, uv - o2, lod).rgb) * 0.25;
  } else {
    alb = textureLod(uAlb, uv, lod).rgb;
  }
  /* normal from the baked height field */
  float hL = textureLod(uDat, uv - vec2(tx, 0.0), lod).r, hR = textureLod(uDat, uv + vec2(tx, 0.0), lod).r;
  float hD = textureLod(uDat, uv - vec2(0.0, tx), lod).r, hU = textureLod(uDat, uv + vec2(0.0, tx), lod).r;
  float cellUV = 1.0 / uCells;
  vec2 g = vec2(hR - hL, hU - hD) * cellUV / (2.0 * tx);
  vec3 n = normalize(vec3(-g.x * uRelief, 1.0, -g.y * uRelief));
  /* micro-shadows: march towards the light through the height field */
  float h0 = d.r;
  float lenXZ = max(length(uL.xz), 1e-3);
  vec2 ld = uL.xz / lenXZ;
  float rise = (uL.y / lenXZ) / uRelief;
  float sh = 1.0;
  float sharp = 1.0 - smoothstep(1.5, 3.5, lod - lod0 + max(lod0 - 1.0, 0.0));
  if (sharp > 0.0) {
    float j = ign(gl_FragCoord.xy + 23.0);
    for (float i = 0.0; i < 16.0; i += 1.0) {
      if (i >= uSteps) break;
      float dc = (i + j) * 0.075 + 0.025;
      float hs = textureLod(uDat, uv + ld * dc * cellUV, lod).r;
      float hr = h0 + dc * rise;
      sh = min(sh, clamp((hr - hs) * 6.0 + 1.0, 0.0, 1.0));
    }
    sh = mix(1.0, sh, sharp);
  }
  /* lighting: diffuse with a little gel wrap, GGX sheen, metallic mica glints */
  vec3 V = normalize(cameraPosition - vW);
  vec3 H = normalize(uL + V);
  float ndl = max(dot(n, uL), 0.0);
  float wrap = max((dot(n, uL) + 0.3) / 1.3, 0.0);
  float metal = d.b;
  float rough = clamp(metal > 0.5 ? d.g * 0.6 : d.g * 0.84, 0.06, 1.0);
  float a = rough * rough, a2 = a * a;
  float NoH = max(dot(n, H), 0.0), NoV = max(dot(n, V), 1e-3), VoH = max(dot(V, H), 0.0);
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (ndl / (ndl * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  vec3 spec = D * G * F / max(4.0 * ndl * NoV, 1e-3);
  vec2 pd = vW.xz - uPool.xy;
  float pool = exp(-dot(pd, pd) / (2.0 * uPool.z * uPool.z));
  float E = 0.03 + 0.97 * pool;
  vec3 diff = alb * (1.0 - metal) * mix(ndl, wrap, 0.3) / 3.14159;
  vec3 col = (diff + spec * ndl) * uLcol * E * sh;
  col += alb * (1.0 - metal) * max(dot(n, uL2), 0.0) / 3.14159 * uL2col * (0.3 + 0.7 * pool);
  float hBlur = textureLod(uDat, uv, lod + 2.5).r;
  float ao = clamp(1.0 - (hBlur - h0) * 1.3, 0.5, 1.0);
  col += alb * uAmb * ao * (0.6 + 0.4 * n.y);
  col *= exp(-max(vDepth - uFocus * 0.92, 0.0) * uFade);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec2 sp = gl_FragCoord.xy / uRes;
  float vig = smoothstep(1.2, 0.3, length((sp - 0.5) * vec2(1.0, 0.9)) * 1.3);
  gl_FragColor.rgb *= mix(0.5, 1.0, vig);
  gl_FragColor.rgb += (ign(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * 0.014;
}`;

export const DVHero = { mount, DV033 };
if (typeof window !== 'undefined') window.DVHero = DVHero;

function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  const custom = Array.isArray(opts.colors) && opts.colors.length;
  const S = {
    colors: normColors(custom ? opts.colors : DV033), grain: clamp(+opts.grain || 1, 0.6, 1.8),
    sparkle: opts.sparkle != null ? clamp(+opts.sparkle, 0, 1) : (custom ? 0.12 : 0.45),
    seed: opts.seed == null ? 33 : +opts.seed, interactive: opts.interactive !== false
  };
  let pt = null;   /* element that receives the cursor (defaults to the module itself) */
  const small = isSmallScreen();
  let T, R, baker, scene, camera, mesh, mat, tile = null;
  const ptr = { on: false, x: 0, z: 0, k: 0 };
  const pool = { x: 0, z: 0, init: false };

  const stage = createStage(el, {
    poster: opts.poster === false ? null : (opts.poster || new URL('./fallback/hero-dv033.webp', BASE).href), label: LABEL[LANG], className: 'dv3d--hero',
    build, update, render, resize, scene: () => scene, camera: () => camera,
    continuous: () => ptr.on && ptr.k > 0.001, dispose
  });

  async function build(st) {
    T = st.THREE; R = st.renderer;
    R.toneMapping = T.NeutralToneMapping; R.toneMappingExposure = 0.92;   /* hue-preserving: compositions keep their colour */
    baker = createBaker(T, R);
    scene = new T.Scene(); scene.background = new T.Color(0x0b0a09);
    camera = new T.PerspectiveCamera(22, st.w / st.h, 1, 4000);
    tile = bake();
    mat = new T.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uAlb: { value: tile.albedo }, uDat: { value: tile.data }, uTex: { value: tile.size }, uTileMM: { value: tile.mm }, uCells: { value: tile.cells },
        uL: { value: new T.Vector3(0, 1, 0) }, uL2: { value: new T.Vector3(0.4, 0.5, 0.75).normalize() },
        uLcol: { value: new T.Color().setRGB(11.2, 9.9, 8.3, T.LinearSRGBColorSpace) },   /* warm-neutral: compositions keep their own colour */
        uL2col: { value: new T.Color().setRGB(0.32, 0.38, 0.5, T.LinearSRGBColorSpace) },
        uPool: { value: new T.Vector3(0, 0, 17) }, uFocus: { value: 80 }, uAper: { value: small ? 20 : 26 },
        uRelief: { value: 0.11 }, uFade: { value: 0.014 }, uAmb: { value: new T.Color().setRGB(0.035, 0.036, 0.042, T.LinearSRGBColorSpace) },
        uTime: { value: 0 }, uRes: { value: new T.Vector2(st.w, st.h) }, uSteps: { value: small ? 9 : 14 }
      }
    });
    mesh = new T.Mesh(new T.PlaneGeometry(900, 900), mat);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    if (S.interactive && isFinePointer()) {
      pt = (typeof opts.pointerTarget === 'string' ? document.querySelector(opts.pointerTarget) : opts.pointerTarget) || st.wrap;
      pt.addEventListener('pointermove', onMove);
      pt.addEventListener('pointerleave', onLeave);
    }
  }
  function bake() {
    const size = small ? 1024 : 2048, cells = small ? 48 : 96;
    const b = bakeGranules(T, baker, { colors: S.colors, size, cells, sparkle: S.sparkle, seed: S.seed, density: 0.95, halfData: true, glint: '#d8b45c' });
    b.mm = cells * CELL_MM * S.grain;
    return b;
  }

  /* camera: a macro lens looking down at ~40 degrees; the frame keeps ~78 mm of surface across (60 mm square-ish, 42 mm portrait) */
  const F = { x: 0, z: 0 }, cam = { D: 80, pitch: 0.7 };
  function resize(w, h) {
    if (!camera) return;
    const aspect = w / h; camera.aspect = aspect;
    const across = aspect < 1 ? 42 : (aspect < 1.4 ? 60 : 78);
    const hfov = 2 * Math.atan(across / (2 * cam.D));
    camera.fov = clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180 / Math.PI, 8, 70);
    camera.updateProjectionMatrix();
    if (mat) {
      mat.uniforms.uRes.value.set(w * stage.pr, h * stage.pr);
      mat.uniforms.uSteps.value = stage.q < 0.85 ? 7 : (small ? 9 : 14);   /* fewer micro-shadow steps when the GPU is struggling */
    }
  }
  function update(t, dt) {
    const still = stage.reduced;
    const tt = still ? 6.0 : t;
    /* lens drift */
    F.x = 2.6 * Math.sin(2 * Math.PI * tt / 47); F.z = 1.6 * Math.sin(2 * Math.PI * tt / 61 + 1.1);
    const D = cam.D * (1 + 0.025 * Math.sin(2 * Math.PI * tt / 53));
    camera.position.set(F.x, D * Math.sin(cam.pitch), F.z + D * Math.cos(cam.pitch));
    camera.lookAt(F.x, 0, F.z);
    mat.uniforms.uFocus.value = D;
    /* raking light: low elevation, slowly swinging azimuth */
    const el = 0.23 + 0.06 * Math.sin(tt * 0.13);
    const az = 4.45 + 0.62 * Math.sin(2 * Math.PI * tt / 36);
    mat.uniforms.uL.value.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    /* light pool wanders across the frame; the cursor (desktop) pulls it */
    const ax = 24 * Math.sin(2 * Math.PI * tt / 29), az2 = 12 * Math.sin(2 * Math.PI * tt / 41 + 0.7) - 3;
    ptr.k += ((ptr.on && !still ? 1 : 0) - ptr.k) * Math.min(1, (dt || 0) * 2.2);
    const tx = ax + (ptr.x - ax) * ptr.k, tz = az2 + (ptr.z - az2) * ptr.k;
    if (!pool.init) { pool.x = tx; pool.z = tz; pool.init = true; } else { pool.x += (tx - pool.x) * Math.min(1, (dt || 0) * 3); pool.z += (tz - pool.z) * Math.min(1, (dt || 0) * 3); }
    mat.uniforms.uPool.value.set(pool.x, pool.z, 17 - 4 * ptr.k);
    mat.uniforms.uTime.value = still ? 0 : t;
  }
  function render() { R.render(scene, camera); }

  const ray = { v: null };
  function onMove(e) {
    if (!camera || stage.reduced) return;
    const r = stage.wrap.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const v = ray.v || (ray.v = new T.Vector3());
    v.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
    if (v.y >= -1e-3) return;
    const t = -camera.position.y / v.y;
    ptr.x = camera.position.x + v.x * t; ptr.z = camera.position.z + v.z * t; ptr.on = true;
    stage.start();
  }
  function onLeave() { ptr.on = false; }

  const ctl = {
    el, get ready() { return stage.readyP; },
    setColors(colors, o = {}) {
      S.colors = normColors(colors && colors.length ? colors : DV033);
      if (o.grain != null) S.grain = clamp(+o.grain, 0.6, 1.8);
      if (o.sparkle != null) S.sparkle = clamp(+o.sparkle, 0, 1);
      if (o.seed != null) S.seed = +o.seed;
      if (!stage.ready) return;
      crossfade(stage, () => { update(stage.t, 0); render(); }, () => {
        const old = tile; tile = bake();
        mat.uniforms.uAlb.value = tile.albedo; mat.uniforms.uDat.value = tile.data;
        mat.uniforms.uTileMM.value = tile.mm; mat.uniforms.uCells.value = tile.cells; mat.uniforms.uTex.value = tile.size;
        old && old.dispose();
      }, 1.1);
    },
    stats() { return Object.assign({}, stage.stats); },
    renderFrame() { if (stage.ready) { update(stage.t, 0); render(); } },
    destroy() { stage.destroy(); }
  };
  el.dv3d = ctl;
  return ctl;

  function dispose() {
    if (pt) { pt.removeEventListener('pointermove', onMove); pt.removeEventListener('pointerleave', onLeave); }
    tile && tile.dispose(); mat && mat.dispose(); mesh && mesh.geometry.dispose(); baker && baker.dispose();
  }
}

function autoMount() {
  document.querySelectorAll('[data-dv3d="hero"]').forEach(el => {
    if (el.dv3d) return;
    let colors = null; try { colors = JSON.parse(el.getAttribute('data-colors') || 'null'); } catch (e) { colors = null; }
    const poster = el.getAttribute('data-poster');
    mount(el, { colors, grain: +el.getAttribute('data-grain') || 1, sparkle: el.hasAttribute('data-sparkle') ? +el.getAttribute('data-sparkle') : undefined,
      poster: poster === 'none' ? false : (poster || undefined), pointerTarget: el.getAttribute('data-pointer-target') || undefined });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
