/* Dvatone hero v2: the furnished room of the scroll story's pull-back (the story then rests on the photoreal frame,
   see hero2.js). The Blender-baked living room of Interiors v2, kept as the hero's own snapshot in hero2/room/ (the GLB
   without the pieces the pull-back never shows, its lightmap, sun visibility and reflection probe of the same bake):
   bouclé sofa, round marble table with books and a bowl, lounge chair, rug, pachira by the window. The hero's own
   coated wall stands in for the room's feature wall and is lit by the same baked light, so the macro and the room are
   one continuous surface.
   Units: the hero works in millimetres with the macro spot M of the wall at the origin; the room (metres) sits in a
   group scaled x1000 and shifted so that M lands on its feature wall.
   Light: baked indirect light (sqrt encoded) + baked sun visibility (window frame, furniture and the pachira's leaves),
   the live sun on top (it reacts to normal maps and to the coating's relief), reflections from the room's probe (box
   projected). Like an interior photographer, the story opens the shadows: fill (baked sky and bounce light) and sun
   are scaled against the bake (LIVING.fill / .sun), so a dark composition still reads as its colour in the shade.
   Tone curve without a toe (identity below 0.76), as the Interiors v2 rooms.
   Textures: hero2/tex (copies of the Interiors v2 textures, the big ones smaller: the pull-back passes them in
   motion). Tone: the photo frame's curve (identity below 0.55, a long roll-off), so the crossfade is seamless. */
import { THREE_VERSION } from '../core.js';
import { TONE_GLSL, TONE_PHOTO_GLSL } from './room.js';

const BASE = import.meta.url;
const ROOMDIR = new URL('./room/', BASE).href;
const TEX = new URL('./tex/', BASE).href;

/* the macro spot on the feature wall and the story's final views (room metres; vertical fov in degrees).
   The coated wall fills most of the frame, the furniture sits in front of it, the sun patch with the pachira's
   leaf shadows on the left. */
export const LIVING = {
  M: [-1.15, 1.18, -2.8],
  wide: { pos: [-0.4, 1.15, 2.5], look: [-0.4, 1.15, -2.8], hfov: 60, vmin: 36, shift: 0 },
  tall: { pos: [0.0, 1.22, 2.65], look: [-0.6, 1.22, -2.8], fov: 44, shift: 0 },     /* 07.10: the sofa, the table and the sun patch, no chair up close */
  gain: 3.4, fill: 3.6, sun: 1.2,     /* matched to the photo frame at the same camera: wall within dE 1 to 2, sun patch 5 L darker */
  wall: 0.88                          /* the walls against the photo frame as encoded since 06.10 evening (12 % darker than at the first match; furniture unchanged) */
};

/* ---------- three.js addons without an import map (same URLs as interior2.js: one download for the page) ---------- */
const THREE_ABS = new URL((typeof window !== 'undefined' && window.DV3D_THREE_URL) || ('https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION + '/build/three.module.min.js'), location.href).href;
const ADDONS = (typeof window !== 'undefined' && window.DV3D_THREE_ADDONS) || ('https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION + '/examples/jsm/');
const blobs = new Map();
function rewritten(url) {
  if (blobs.has(url)) return blobs.get(url);
  const p = (async () => {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('addon ' + url + ' ' + res.status);
    let src = await res.text();
    const re = /\b(from\s*|import\s*)(['"])([^'"]+)\2/g;
    const specs = new Set(); let m;
    while ((m = re.exec(src))) specs.add(m[3]);
    const map = {};
    for (const s of specs) {
      if (s === 'three') map[s] = THREE_ABS;
      else if (s[0] === '.') map[s] = await rewritten(new URL(s, url).href);
      else map[s] = s;
    }
    src = src.replace(re, (all, kw, q, s) => kw + q + map[s] + q);
    return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  })();
  blobs.set(url, p);
  return p;
}
let gltfP = null;
function gltfLoader() {
  if (!gltfP) gltfP = (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import(/* @vite-ignore */ await rewritten(new URL('loaders/GLTFLoader.js', ADDONS).href)),
      import(/* @vite-ignore */ new URL('libs/meshopt_decoder.module.js', ADDONS).href)
    ]);
    await MeshoptDecoder.ready;
    const l = new GLTFLoader(); l.setMeshoptDecoder(MeshoptDecoder);
    return l;
  })();
  gltfP.catch(() => { gltfP = null; });
  return gltfP;
}

/* Blender material -> textures in hero2/tex (-c colour, -n normal + roughness, -m metal) and finish.
   Colour textures are sRGB; normal maps carry the roughness in B; metal maps their metalness in R (interior2 format). */
const MAT = {
  floor_herringbone: { c: 'o:herringbone_parquet', rough: 0.95, spec: 0.5, sunB: 2.2 },     /* the photograph's glossy oak catches more sun */
  wall_paint: { color: [0.74, 0.695, 0.634], rough: 0.92 },                                    /* warm plaster, as in the photograph (current encode) */
  ceiling_paint: { color: [0.83, 0.825, 0.81], rough: 0.95 },
  stone_sill: { color: [0.80, 0.78, 0.74], rough: 0.8 },
  shadow_gap: { color: [0.02, 0.02, 0.02], rough: 0.8 },
  frame_black: { color: [0.03, 0.03, 0.03], rough: 0.36, metal: 0.6 },
  black_matte: { color: [0.022, 0.021, 0.02], rough: 0.55 },
  boucle: { c: 'o:curly_teddy_natural', n: 'o:curly_teddy_natural', rough: 1.0, nrm: 1.2, tint: [1.02, 0.97, 0.88] },   /* warm cream, as in the photograph */
  linen: { c: 'o:terlenka', n: 'o:terlenka', rough: 1.0, nrm: 1.0, tint: [1.05, 1.04, 1.02] },
  jersey: { c: 'o:cotton_jersey', n: 'o:cotton_jersey', rough: 1.0, nrm: 1.0 },
  fleece: { c: 'o:knitted_fleece', n: 'o:knitted_fleece', rough: 1.0, nrm: 1.2, tint: [2.3, 2.1, 1.9] },
  rug_wool: { c: 'o:poly_wool_herringbone', rough: 1.0, tint: [1.35, 1.32, 1.27], sunB: 1.5 },
  paper: { color: [0.82, 0.8, 0.76], rough: 0.9 },
  book_sand: { color: [0.55, 0.47, 0.38], rough: 0.8 },
  book_ink: { color: [0.06, 0.06, 0.065], rough: 0.7 },
  book_clay: { color: [0.42, 0.24, 0.17], rough: 0.8 },
  ceramic_clay: { color: [0.48, 0.36, 0.27], rough: 0.8 },
  coffee_table_round_01: { c: 'o:coffee_table_round_01', n: 'o:coffee_table_round_01', m: 'o:coffee_table_round_01' },
  wooden_bowl_01: { c: 'o:wooden_bowl_01', n: 'o:wooden_bowl_01' },
  mid_century_lounge_chair: { c: 'o:mid_century_lounge_chair', n: 'o:mid_century_lounge_chair', m: 'o:mid_century_lounge_chair' },
  pachira_aquatica_01_bark: { c: 'o:pachira_aquatica_01_bark', n: 'o:pachira_aquatica_01_bark', plant: true },
  pachira_aquatica_01_leaves: { c: 'o:pachira_aquatica_01_leaves', n: 'o:pachira_aquatica_01_leaves', plant: true, leaf: true }
};
const matDef = name => MAT[name] || MAT[String(name || '').replace(/\.\d+$/, '')] || { color: [0.6, 0.6, 0.6], rough: 0.8 };
const texURL = id => TEX + id.slice(2);

/* integrated Intel GPUs before Xe (measured: a UHD 620 needs 23 ms for the furnished frame at 1440 x 900 with
   bicubic lightmaps): bilinear lightmaps there, as Interiors v2 */
function lightGPU(R) {
  try {
    const gl = R.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const g = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    return /Intel.*(HD|UHD) Graphics/i.test(g) && !/Xe|Iris/i.test(g);
  } catch (e) { return false; }
}

/* ---------- GLSL ---------- */
/* plant sway in room metres (the hero's world is in millimetres) */
const SWAY_GLSL = `
uniform float uTime; uniform vec3 uPlantBase; uniform float uPlantH; uniform float uSway; uniform vec3 uRoomO;
vec3 dvSway(vec3 w){
  vec3 p = (w - uRoomO) * 0.001;
  float h = clamp((p.y - uPlantBase.y) / max(uPlantH, 0.1), 0.0, 1.2);
  float k = h * h, t = uTime;
  float gust = 0.55 + 0.45 * sin(t * 0.23 + 1.3) * sin(t * 0.137);
  float s = sin(t * 0.61 + p.x * 0.8) * 0.62 + sin(t * 1.07 + p.z * 1.4 + 1.7) * 0.28 + sin(t * 2.3 + h * 5.0) * 0.1;
  vec3 off = vec3(0.8, 0.0, 0.6) * s * uSway * k * gust;
  float fl = sin(t * 4.1 + dot(p, vec3(37.1, 21.7, 29.3))) * 0.0035 * h * gust;
  off += vec3(fl, fl * 0.7, -fl);
  return off * 1000.0;
}
`;
const COMMON_GLSL = `
uniform float uLmScale; uniform vec2 uLmSize; uniform vec2 uSunSize; uniform sampler2D uSunMap;
uniform vec3 uProbePos; uniform vec3 uProbeMin; uniform vec3 uProbeMax; uniform float uSpecRef;
uniform float uRoomGain; uniform float uRFade; uniform vec3 uFog; uniform float uFill; uniform float uSunK; uniform float uSunB;
varying vec3 vDvWorld;
vec4 dvCubic(sampler2D t, vec2 uv, vec2 size){
  vec2 st = uv * size - 0.5; vec2 i = floor(st); vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0, w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size, h1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * texture2D(t, h0) + g1.x * texture2D(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture2D(t, vec2(h0.x, h1.y)) + g1.x * texture2D(t, h1));
}
vec3 dvBoxProject(vec3 dir){
  vec3 p = clamp(vDvWorld, uProbeMin + 10.0, uProbeMax - 10.0);
  vec3 a = (uProbeMax - p) / dir, b = (uProbeMin - p) / dir;
  vec3 f = max(a, b);
  float t = min(min(f.x, f.y), f.z);
  return normalize(p + dir * t - uProbePos);
}
float dvLum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
${TONE_GLSL}
${TONE_PHOTO_GLSL}
`;
/* the coated wall in the furnished room: the room's lightmap and sun visibility at the wall's own position */
export const LIVING_WALL_GLSL = `
uniform sampler2D uLmMap; uniform sampler2D uSunMap; uniform vec3 uLmU; uniform vec3 uLmV; uniform float uLmScale;
uniform vec2 uLmSize; uniform vec2 uSunSize; uniform vec3 uSunDirR; uniform vec3 uSunColR; uniform float uRoomGain; uniform float uWallK;
vec4 dvCubic(sampler2D t, vec2 uv, vec2 size){
  vec2 st = uv * size - 0.5; vec2 i = floor(st); vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0, w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / size, h1 = (i + 1.5 + w3 / g1) / size;
  return g0.y * (g0.x * texture2D(t, h0) + g1.x * texture2D(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture2D(t, vec2(h0.x, h1.y)) + g1.x * texture2D(t, h1));
}
uniform float uFill; uniform float uSunK;
${TONE_GLSL}
${TONE_PHOTO_GLSL}
`;
const NORMAL_PACKED = `
#if defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	mapN.z = sqrt( max( 1e-4, 1.0 - dot( mapN.xy, mapN.xy ) ) );
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
`;

/**
 * createLiving(T, R, { tier, fog, time }) -> { group, U (uniforms for the wall), load(), ready, active, setFade(k),
 *   update(t, kRoom), wallRect, finalView(aspect), stats, dispose }
 * load() fetches and prepares everything; `ready` resolves true when the room can be shown.
 */
export function createLiving(T, R, opts = {}) {
  const hi = opts.tier === 'high';
  const cubic = hi && !lightGPU(R);
  const S = { loaded: false, failed: false, ms: 0, bytes: 0 };
  const Mr = new T.Vector3().fromArray(LIVING.M);
  const group = new T.Group();
  group.scale.setScalar(1000);
  group.position.set(-Mr.x * 1000, -Mr.y * 1000, -Mr.z * 1000);
  group.visible = false;
  group.updateMatrixWorld(true);
  const toHero = (x, y, z) => new T.Vector3(x, y, z).applyMatrix4(group.matrixWorld);
  const fog = opts.fog || { value: new T.Color(0.012, 0.011, 0.01) };
  const time = opts.time || { value: 0 };
  /* uniforms shared by the room materials and the coated wall */
  const U = {
    uLmMap: { value: null }, uSunMap: { value: null }, uLmScale: { value: 0.65 }, uLmSize: { value: new T.Vector2(1024, 1024) }, uSunSize: { value: new T.Vector2(1024, 1024) },
    uLmU: { value: new T.Vector3() }, uLmV: { value: new T.Vector3() },
    uSunDirR: { value: new T.Vector3(-0.55, 0.46, 0.7).normalize() }, uSunColR: { value: new T.Color(5, 4.8, 4.45) },
    uProbePos: { value: new T.Vector3() }, uProbeMin: { value: new T.Vector3() }, uProbeMax: { value: new T.Vector3() }, uSpecRef: { value: 0.12 },
    uRoomGain: { value: LIVING.gain }, uFill: { value: LIVING.fill }, uSunK: { value: LIVING.sun }, uWallK: { value: LIVING.wall },
    uRFade: { value: 0 }, uFog: fog, uTime: time, uRoomO: { value: group.position.clone() }, uVScale: { value: 0.44 }
  };
  const sun = new T.DirectionalLight(0xffffff, 5);
  group.add(sun, sun.target);           /* direction only: position / target in room metres */
  const disposables = [];
  const texCache = new Map();
  let env = null, plants = [], wallRect = null;
  let readyRes; const ready = new Promise(r => (readyRes = r));
  const ctl = { group, U, ready, cubic, get active() { return S.loaded; }, stats: S, load, prefetch, setFade, update, finalView, finalViewFrom, get wallRect() { return wallRect; }, get views() { return views; }, dispose, sun };

  /* the room's files into the HTTP cache, no parsing or GPU work: called while the intro plays, so that load() later
     (end of the intro, or the story's start) only parses and compiles */
  let pre = null;
  function prefetch() {
    gltfLoader().catch(() => {});
    if (pre || S.loaded || S.loading) return pre;
    const get = u => fetch(u).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    const files = ['living.json', 'living.glb', 'living-lm-m.webp', hi ? 'living-sun.webp' : 'living-sun-1k.webp', 'living-env.webp'].map(f => ROOMDIR + f);
    const tex = new Set();
    for (const k in MAT) {
      const d = MAT[k];
      if (d.c) tex.add(texURL(d.c) + '-c.webp');
      if (d.n && hi) tex.add(texURL(d.n) + '-n.webp');
      if (d.m) tex.add(texURL(d.m) + '-m.webp');
    }
    pre = Promise.all([gltfLoader().catch(() => null), ...files.map(get), ...[...tex].map(get)]).then(() => true);
    return pre;
  }

  function image(url) {
    return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + url)); im.src = url; });
  }
  function texture(url, srgb, o = {}) {
    const key = url + (srgb ? '|s' : '|l');
    if (texCache.has(key)) return texCache.get(key);
    const p = image(url).then(im => {
      const t = new T.Texture(im);
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      t.wrapS = t.wrapT = o.clamp ? T.ClampToEdgeWrapping : T.RepeatWrapping;
      t.flipY = false;
      t.anisotropy = Math.min(4, R.capabilities.getMaxAnisotropy());
      if (o.nomip) { t.generateMipmaps = false; t.minFilter = T.LinearFilter; }
      t.needsUpdate = true; disposables.push(t);
      return t;
    });
    texCache.set(key, p);
    return p;
  }
  async function loadEnv(url, range) {
    const im = await image(url);
    const w = im.naturalWidth, h = im.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    const px = cx.getImageData(0, 0, w, h).data;
    const out = new Uint16Array(w * h * 4), k = Math.log2(1 + range), lut = new Uint16Array(256);
    for (let i = 0; i < 256; i++) lut[i] = T.DataUtils.toHalfFloat(Math.pow(2, i / 255 * k) - 1);
    const one = T.DataUtils.toHalfFloat(1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = ((h - 1 - y) * w + x) * 4;
      out[j] = lut[px[i]]; out[j + 1] = lut[px[i + 1]]; out[j + 2] = lut[px[i + 2]]; out[j + 3] = one;
    }
    const t = new T.DataTexture(out, w, h, T.RGBAFormat, T.HalfFloatType);
    t.mapping = T.EquirectangularReflectionMapping; t.colorSpace = T.LinearSRGBColorSpace;
    t.magFilter = t.minFilter = T.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    const pm = new T.PMREMGenerator(R);
    const chk = R.debug.checkShaderErrors; R.debug.checkShaderErrors = false;   /* three's own blur shader: an HLSL loop note on D3D11 */
    let rt; try { rt = pm.fromEquirectangular(t); } finally { R.debug.checkShaderErrors = chk; }
    pm.dispose(); t.dispose(); disposables.push(rt);
    return rt;
  }

  /* one program for every lightmapped surface, one for the plants (fast start: few shader compiles) */
  function patch(mat, kind) {
    const plant = kind === 'plant';
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, {
        uLmScale: U.uLmScale, uLmSize: U.uLmSize, uSunSize: U.uSunSize, uSunMap: U.uSunMap, uProbePos: U.uProbePos, uProbeMin: U.uProbeMin, uProbeMax: U.uProbeMax,
        uSpecRef: U.uSpecRef, uRoomGain: U.uRoomGain, uRFade: U.uRFade, uFog: U.uFog, uFill: U.uFill, uSunK: U.uSunK,
        uSunB: mat.userData.sunB || { value: 1 }
      });
      let v = sh.vertexShader, f = sh.fragmentShader;
      if (cubic) f = '#define DV_CUBIC\n' + f;
      v = v.replace('#include <common>', '#include <common>\nvarying vec3 vDvWorld;' + (plant ? '\nattribute vec4 color;\nvarying vec4 vDvCol;\n' + SWAY_GLSL : ''));
      if (plant) {
        Object.assign(sh.uniforms, { uTime: U.uTime, uRoomO: U.uRoomO, uPlantBase: mat.userData.base, uPlantH: mat.userData.h, uSway: mat.userData.sway, uVScale: U.uVScale });
        v = v.replace('#include <project_vertex>', `
          vec4 dvW4 = modelMatrix * vec4( transformed, 1.0 );
          dvW4.xyz += dvSway( dvW4.xyz );
          vec4 mvPosition = viewMatrix * dvW4;
          gl_Position = projectionMatrix * mvPosition;`);
        v = v.replace('#include <fog_vertex>', '#include <fog_vertex>\nvDvWorld = dvW4.xyz;\nvDvCol = color;');
      } else {
        v = v.replace('#include <fog_vertex>', '#include <fog_vertex>\nvDvWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      }
      f = f.replace('#include <common>', '#include <common>\n' + COMMON_GLSL + (plant ? 'varying vec4 vDvCol; uniform float uVScale;\n' : ''));
      f = f.replace('#include <normal_fragment_maps>', NORMAL_PACKED);
      f = f.replace('#include <roughnessmap_fragment>', T.ShaderChunk.roughnessmap_fragment.replace('texelRoughness.g', 'texelRoughness.b'));
      f = f.replace('#include <metalnessmap_fragment>', T.ShaderChunk.metalnessmap_fragment.replace('texelMetalness.b', 'texelMetalness.r'));
      let pre = 'vec3 dvLmI = vec3( 0.0 ); float dvSunVis = 0.0;\n';
      if (plant) pre += 'dvLmI = vDvCol.rgb * uVScale * uFill; dvSunVis = vDvCol.a * uSunK;\n';
      else pre += `#ifdef USE_LIGHTMAP
        #ifdef DV_CUBIC
        { vec3 lmS = dvCubic( lightMap, vLightMapUv, uLmSize ).rgb; dvLmI = lmS * lmS * uLmScale * uFill; dvSunVis = dvCubic( uSunMap, vLightMapUv, uSunSize ).r * uSunK; }
        #else
        { vec3 lmS = texture2D( lightMap, vLightMapUv ).rgb; dvLmI = lmS * lmS * uLmScale * uFill; dvSunVis = texture2D( uSunMap, vLightMapUv ).r * uSunK; }
        #endif
        #endif\n`;
      f = f.replace('#include <lights_fragment_begin>', pre + T.ShaderChunk.lights_fragment_begin
        .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dvSunVis * uSunB;')
        + (plant ? `
        #if ( NUM_DIR_LIGHTS > 0 )
        { vec3 dvL = directionalLights[ 0 ].direction;
          float dvB = max( 0.0, -dot( geometryNormal, dvL ) );
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * dvSunVis * dvB * BRDF_Lambert( material.diffuseColor ) * vec3( 0.55, 0.62, 0.3 ); }
        #endif` : ''));
      f = f.replace('#include <lights_fragment_maps>', `
        #if defined( RE_IndirectDiffuse )
          irradiance += dvLmI * PI;
        #endif
        #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
          radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
        #endif`);
      f = f.replace('#include <envmap_physical_pars_fragment>', T.ShaderChunk.envmap_physical_pars_fragment
        .replace('reflectVec = inverseTransformDirection( reflectVec, viewMatrix );', 'reflectVec = dvBoxProject( inverseTransformDirection( reflectVec, viewMatrix ) );'));
      f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float dvAO = clamp( dvLum( dvLmI ) / ( uSpecRef * uFill ), 0.0, 1.0 );
          reflectedLight.indirectSpecular *= mix( 0.15, 1.0, sqrt( dvAO ) ); }`);
      /* the room's light scale, the fade-in from the dark macro, the hue-keeping tone curve */
      f = f.replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = dvTonePhoto( mix( uFog, gl_FragColor.rgb * uRoomGain, uRFade ) * toneMappingExposure );');
      sh.vertexShader = v; sh.fragmentShader = f;
    };
    mat.customProgramCacheKey = () => 'dvh2-' + kind + (cubic ? 'c' : '');
    return mat;
  }
  let dummies = null;
  function dummy() {
    if (dummies) return dummies;
    const mk = (r, g, b, srgb) => { const t = new T.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.needsUpdate = true; disposables.push(t); return t; };
    return (dummies = { white: mk(255, 255, 255, true), flat: mk(128, 128, 255, false), one: mk(255, 255, 255, false) });
  }
  async function material(name, kind, extra = {}) {
    const d = matDef(name), dm = dummy();
    const P = { roughness: d.rough != null ? d.rough : 0.8, metalness: d.metal || 0, map: dm.white, normalMap: dm.flat, roughnessMap: dm.flat, metalnessMap: dm.one };
    if (d.color) P.color = new T.Color().setRGB(d.color[0], d.color[1], d.color[2], T.LinearSRGBColorSpace);
    /* phones (mid): no normal maps (invisible at phone size, about 70 KB less) */
    const [c, n, m] = await Promise.all([d.c ? texture(texURL(d.c) + '-c.webp', true) : null, d.n && hi ? texture(texURL(d.n) + '-n.webp', false) : null, d.m ? texture(texURL(d.m) + '-m.webp', false) : null]);
    if (c) P.map = c;
    if (n) { P.normalMap = n; P.roughnessMap = n; P.normalScale = new T.Vector2(d.nrm || 1, d.nrm || 1); }
    if (m) { P.metalnessMap = m; P.metalness = 1; }
    if (d.tint) P.color = new T.Color().setRGB(d.tint[0], d.tint[1], d.tint[2], T.LinearSRGBColorSpace);
    const mat = new T.MeshStandardMaterial(P);
    mat.userData.sunB = { value: d.sunB || 1 };
    if (kind === 'plant') { mat.side = T.DoubleSide; Object.assign(mat.userData, extra); }
    disposables.push(mat);
    return patch(mat, kind);
  }

  async function load() {
    if (S.loaded || S.loading) return ready;
    S.loading = true;
    const t0 = performance.now();
    /* a prefetch in flight: let it finish first (a second request for the same file would wait on the cache entry) */
    if (pre) await Promise.race([pre, new Promise(r => setTimeout(r, 6000))]);
    try {
      const [meta, loader] = await Promise.all([fetch(ROOMDIR + 'living.json').then(r => { if (!r.ok) throw new Error('living.json ' + r.status); return r.json(); }), gltfLoader()]);
      const [gltf, lm, sm, envRT] = await Promise.all([
        loader.loadAsync(ROOMDIR + 'living.glb'),
        texture(ROOMDIR + 'living-lm-m.webp', false, { clamp: true, nomip: true }),
        texture(ROOMDIR + (hi ? 'living-sun.webp' : 'living-sun-1k.webp'), false, { clamp: true, nomip: true }),
        loadEnv(ROOMDIR + 'living-env.webp', meta.env_range || 64)
      ]);
      env = envRT;
      const root = gltf.scene;
      group.add(root);
      group.updateMatrixWorld(true);
      U.uLmMap.value = lm; U.uSunMap.value = sm; U.uLmScale.value = meta.lm_scale || 0.65;
      U.uLmSize.value.set(lm.image.width || 1024, lm.image.height || 1024); U.uSunSize.value.set(sm.image.width || 1024, sm.image.height || 1024);
      U.uSpecRef.value = (meta.lm_scale || 0.65) * 0.18; U.uVScale.value = meta.vscale || 0.44;
      /* probe box in hero millimetres */
      U.uProbePos.value.copy(toHero(...meta.probe));
      const a = toHero(...meta.bounds.min), b = toHero(...meta.bounds.max);
      U.uProbeMin.value.copy(a).min(b); U.uProbeMax.value.copy(a).max(b);
      /* sun: Blender strength and colour (white balanced like the lightmap) */
      const sd = new T.Vector3().fromArray(meta.sun.dir).normalize();
      const sc = meta.sun.color_wb || meta.sun.color;
      sun.color.setRGB(sc[0], sc[1], sc[2], T.LinearSRGBColorSpace); sun.intensity = meta.sun.strength;
      sun.position.set(0, 0, 0).addScaledVector(sd, -10); sun.target.position.set(0, 0, 0);
      U.uSunDirR.value.copy(sd).negate();
      U.uSunColR.value.setRGB(sc[0] * meta.sun.strength, sc[1] * meta.sun.strength, sc[2] * meta.sun.strength, T.LinearSRGBColorSpace);
      /* materials */
      const jobs = [], hide = [];
      root.traverse(o => {
        if (!o.isMesh) return;
        const name = o.material && o.material.name, d = matDef(name);
        let info = {};
        try { info = o.userData && o.userData.dv ? JSON.parse(o.userData.dv) : (o.parent && o.parent.userData && o.parent.userData.dv ? JSON.parse(o.parent.userData.dv) : {}); } catch (e) { info = {}; }
        o.castShadow = o.receiveShadow = false;
        if (name === 'feature_coat') { wallRect = featureMapping(o); hide.push(o); return; }
        if (name === 'curtain_sheer' || name === 'glass' || d.hide) { hide.push(o); return; }
        if (d.plant || info.kind === 'plant') {
          const u = { base: { value: new T.Vector3().fromArray(info.base || [0, 0, 0]) }, h: { value: info.height || 1.2 }, sway: { value: d.leaf ? 0.026 : 0.018 } };
          jobs.push(material(name, 'plant', u).then(m => { o.material = m; plants.push({ o, u }); }));
          return;
        }
        jobs.push(material(name, 'lm').then(m => { m.lightMap = lm; m.lightMap.channel = 1; m.envMap = env.texture; m.envMapIntensity = 1; o.material = m; }));
      });
      hide.forEach(o => { o.visible = false; });
      await Promise.all(jobs);
      S.loaded = true; S.ms = Math.round(performance.now() - t0);
      readyRes(true);
    } catch (e) {
      S.failed = true; S.error = String(e && e.message || e);
      console.warn('[dvatone 3d] furnished room not loaded, the simple room stays:', S.error);
      readyRes(false);
    }
    return ready;
  }

  /* the coated wall samples the room's lightmap: affine map from wall millimetres to the feature wall's lightmap UVs */
  function featureMapping(o) {
    const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv1 || g.attributes.uv2;
    o.updateMatrixWorld(true);
    const v = new T.Vector3();
    const rows = [];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      rows.push([v.x, v.y, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0]);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    /* least squares u = a x + b y + c (exact for a planar quad) */
    const solve = k => {
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
      for (const r of rows) { const q = [r[0] * 1e-3, r[1] * 1e-3, 1]; for (let i = 0; i < 3; i++) { B[i] += q[i] * r[k]; for (let j = 0; j < 3; j++) A[i][j] += q[i] * q[j]; } }
      const m = new T.Matrix3().set(A[0][0], A[0][1], A[0][2], A[1][0], A[1][1], A[1][2], A[2][0], A[2][1], A[2][2]).invert();
      const s = new T.Vector3(B[0], B[1], B[2]).applyMatrix3(m);
      return new T.Vector3(s.x * 1e-3, s.y * 1e-3, s.z);
    };
    if (uv) { U.uLmU.value.copy(solve(2)); U.uLmV.value.copy(solve(3)); }
    return { x0, x1, y0, y1 };
  }

  /* per frame while the room is on screen: nothing to do (the light is baked, the plants sway in their vertex shader) */
  function update() {}
  function setFade(k) {
    U.uRFade.value = k;
    group.visible = S.loaded && k > 0.001;
  }
  /* final view of the story (hero millimetres): target, direction (camera - target), vertical fov, lens shift */
  const FV = { target: new T.Vector3(), dir: new T.Vector3(), fov: 40, shift: 0 };
  const views = { wide: Object.assign({}, LIVING.wide), tall: Object.assign({}, LIVING.tall) };   /* per instance (lab tuning) */
  function finalView(aspect) {
    const v = aspect >= 1 ? views.wide : views.tall;
    FV.target.set(...v.look).applyMatrix4(group.matrixWorld);
    FV.dir.set(...v.pos).applyMatrix4(group.matrixWorld).sub(FV.target);
    FV.fov = v.hfov ? Math.max(v.vmin, 2 * Math.atan(Math.tan(v.hfov * Math.PI / 360) / aspect) * 180 / Math.PI) : v.fov;
    FV.shift = v.shift;
    return FV;
  }
  /* the same, from the photo frame's camera (DVInterior2.photoCamera: room metres, vertical fov, lens shift) */
  const FP = { target: new T.Vector3(), dir: new T.Vector3(), fov: 36, shift: 0 };
  function finalViewFrom(c) {
    FP.target.set(...c.look).applyMatrix4(group.matrixWorld);
    FP.dir.set(...c.pos).applyMatrix4(group.matrixWorld).sub(FP.target);
    FP.fov = c.vfov; FP.shift = c.shift || 0;
    return FP;
  }
  function dispose() {
    disposables.forEach(x => x && x.dispose && x.dispose());
    group.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    
  }
  return ctl;
}
