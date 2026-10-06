/* Dvatone 3D Interiors v2: baked architectural rooms whose feature wall wears the live granular coating.

   DVInterior2.mount(el, { room:'living'|'bedroom'|'hallway', colors:[{hex, share}], grain:0.6..1.8, density?, seed?,
                           textureUrl?, textureSize? (metres per tile), drift?, poster? (false = none),
                           quality? 'auto'|'high'|'mid'|'low', swipe? (true), autostart? (low tier: start without the tap) })
   -> { setColors(colors, grain?), setState(generatorState), setRoom(name), setTexture(url|null, size?),
        destroy(), stats(), renderFrame(), start(), ready: Promise<boolean>, room }   events: dv3d:ready, dv3d:fallback, dv3d:room
   Declarative: <div data-dv3d="interior2" data-room="living" data-colors='[{"hex":"B8A389","share":45},...]' data-grain="1"></div>

   How it is lit
   - Every static surface (walls, floor, furniture AND the feature wall) carries a Cycles lightmap baked in Blender
     (_blender/scripts): RGB = diffuse light from the sky, the bounces and ambient occlusion (sqrt encoded, white balanced
     on the feature wall), plus a second map with the sun's visibility. The sun itself is added live with the baked
     visibility, so its light reacts to normal maps and to the coating's granules, and the leaves of the swaying plants
     cast live shadows into the sun patches. Reflections come from an HDR probe of the same room (box projected).
   - The feature wall's albedo is the generator's coating, baked on the GPU from the composition (core.js bakeGranules,
     the same model as v1: exact colours, fine granules, wipe when the composition changes).
   - Post: HDR target, light shafts through the windows with drifting dust, bloom on the window only, a hue-preserving
     tone curve (identity below 0.76: the coating's colours are not shifted), dithered sRGB output, FXAA on 1x screens.
   - Tiers (MOBILE_STRATEGY.md section 3): high (desktop; lighter set on Intel HD/UHD), mid (flagship phones: pixel ratio
     1.5, 1K lightmaps, half shadows, light post), low (still + "Live 3D" button, then 30 fps). 4:5 phone stages use
     their own camera shots; a horizontal swipe changes the room; 30 fps after 20 s without interaction.
   Lazy (nothing loads before the module nears the viewport), paused off screen, adaptive resolution, reduced motion =
   one still frame per change, no WebGL2 = poster. Assets per room: interior2/<room>.glb (meshopt), -lm/-sun/-env.webp,
   <room>.json; shared textures interior2/tex/*.webp and interior2/exterior.webp. Events on el: dv3d:ready, dv3d:fallback. */
import { createStage, createBaker, bakeGranules, normColors, clamp, crossfade, isSmallScreen, isFinePointer, THREE_VERSION } from './core.js';

const BASE = import.meta.url;
const ASSET = new URL('./interior2/', BASE).href;
const ROOMS = ['living', 'bedroom', 'hallway'];
const LANG = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk';
const LABEL = {
  uk: { living: 'Вітальня, стіна з мультиколоровим покриттям Dvatone у денному світлі', bedroom: 'Спальня, стіна за ліжком з покриттям Dvatone', hallway: 'Передпокій, довга стіна з покриттям Dvatone' },
  en: { living: 'Living room with a Dvatone multicolour coating on the feature wall in daylight', bedroom: 'Bedroom with a Dvatone coating on the wall behind the bed', hallway: 'Hallway with a Dvatone coating along the long wall' }
};
const posterOf = (room, portrait) => ASSET + 'poster-' + room + (portrait ? '-p' : '') + '.webp';
const CELL_M = 0.0021;                 /* granule lattice cell in metres at grain 1 (v1 scale: fleck about 1.9 mm, M) */
const G = window.DV3D || (window.DV3D = {});

/* ------------------------------------------------------------------ quality tiers (MOBILE_STRATEGY.md section 3)
   decided once per visit (sessionStorage), shared with the other modules through window.DV3D.tier;
   ?dv3d-tier=high|mid|low forces one. A 1-second frame-time probe can still step a running module down. */
const TIERS = {
  high: { prCap: 2, volScale: 0.5, volSteps: 22, bloom: 4, dust: 900, shadow: 2048, lm: '', lmq: '', msaa: false, ss: 1, fxaa: true, sheen: true, cubic: true, fps: 60, camSlow: 1 },
  mid: { prCap: 1.5, volScale: 0.32, volSteps: 12, bloom: 3, dust: 320, shadow: 512, lm: '-1k', lmq: '-m', msaa: false, sheen: false, cubic: false, fps: 60, camSlow: 1.7 },
  low: { prCap: 1, volScale: 0.25, volSteps: 8, bloom: 3, dust: 140, shadow: 512, lm: '-1k', lmq: '-m', msaa: false, sheen: false, cubic: false, fps: 30, camSlow: 2 }
};
function gpuName() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const g = gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : '';
    const lose = gl && gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return g;
  } catch (e) { return ''; }
}
function detectTier() {
  let q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  const forced = q && q.get('dv3d-tier'), gpuQ = q && q.get('dv3d-gpu');
  if (!TIERS[forced] && TIERS[G.tier]) return G.tier;
  if (!TIERS[forced]) {
    try {
      const s = sessionStorage.getItem('dv3d-tier');
      if (TIERS[s]) { G.gpuLite = sessionStorage.getItem('dv3d-gpulite') === '1'; return (G.tier = s); }
    } catch (e) { /* storage blocked */ }
  }
  const nav = navigator, conn = nav.connection || {};
  const ua = nav.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mobile = ios || /Android|Mobile/i.test(ua) || (coarse && Math.min(screen.width, screen.height) < 820);
  const gpu = gpuName();
  let tier = 'high';
  if (conn.saveData || /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu)) tier = 'low';
  else if (mobile) {
    const weakGPU = /Adreno \(TM\) ([3-5]\d\d|6[0-3]\d)\b|Mali-(T\d|G[357]\d\b|G5[0-2])|PowerVR|Vivante|Tegra/i.test(gpu);
    const mem = nav.deviceMemory || 8, cores = nav.hardwareConcurrency || 8;
    if (ios) tier = (window.devicePixelRatio || 1) >= 3 ? 'mid' : 'low';
    else tier = (weakGPU || mem <= 3 || cores <= 4) ? 'low' : 'mid';
  }
  if (TIERS[forced]) tier = forced;
  /* desktop integrated GPUs before Intel Xe (measured: 28 ms per frame at 1440 x 900 on a UHD 620 with the full set):
     a lighter high tier with bilinear lightmaps, a 1K plant shadow and cheaper shafts. ?dv3d-gpu=lite|full forces it */
  G.gpuLite = gpuQ === 'lite' ? true : gpuQ === 'full' ? false : (tier === 'high' && /Intel.*(HD|UHD) Graphics/i.test(gpu) && !/Xe|Iris/i.test(gpu));
  G.tier = tier;
  if (!TIERS[forced] && !gpuQ) {
    try { sessionStorage.setItem('dv3d-tier', tier); sessionStorage.setItem('dv3d-gpulite', G.gpuLite ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  return tier;
}

/* scoped CSS: the canvas never traps vertical page scroll; the tap-to-start gate of the low tier */
function injectCSS2() {
  if (document.getElementById('dv3d2-css')) return;
  const s = document.createElement('style'); s.id = 'dv3d2-css';
  s.textContent = `
.dv3d--interior2,.dv3d--interior2>canvas{touch-action:pan-y}
.dv3d2-gate{position:absolute;inset:0;overflow:hidden;background:#0f0e0c}
.dv3d2-gate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.dv3d2-gate button{position:absolute;right:14px;bottom:14px;display:inline-flex;align-items:center;gap:10px;min-height:44px;padding:0 18px;border:0;border-radius:999px;
  background:rgba(18,16,14,.66);color:#f3efe8;font:600 12px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.dv3d2-gate button::before{content:"";width:0;height:0;border-left:9px solid currentColor;border-top:6px solid transparent;border-bottom:6px solid transparent}
.dv3d2-gate button:focus-visible{outline:2px solid #c08a5b;outline-offset:3px}`;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ three.js addons without an import map
   The addons import from the bare specifier 'three'. They are fetched once, their imports are pointed at the exact
   three.js module core.js loaded (same URL = same module instance) and they run from blob URLs. */
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
  return gltfP;
}

/* ------------------------------------------------------------------ runtime material table
   Blender material names -> textures (interior2/tex/<id>-c.webp colour, -n.webp normal xy + roughness in B, -m.webp metal)
   tile = metres per texture tile for the box-projected UVs of the custom pieces (Poly Haven models keep their UVs). */
const MAT = {
  floor_herringbone: { tex: 'herringbone_parquet', tile: 3.4, rough: 0.95, nrm: 0.8, spec: 0.5 },
  floor_oak: { tex: 'laminate_floor_02', tile: 1.7, rough: 0.95, nrm: 0.7, spec: 0.5 },
  floor_stone: { tex: 'marble_01', tile: 1.5, rough: 0.85, nrm: 0.5, spec: 0.5, tint: [1.04, 1.03, 1.01] },
  stone_sill: { tex: 'marble_01', tile: 1.5, rough: 0.8, nrm: 0.5, tint: [1.05, 1.03, 1.0] },
  wall_paint: { color: [0.80, 0.78, 0.745], rough: 0.92, spec: 0.35 },
  ceiling_paint: { color: [0.83, 0.825, 0.81], rough: 0.95, spec: 0.3 },
  feature_coat: { coat: true },
  shadow_gap: { color: [0.02, 0.02, 0.02], rough: 0.8 },
  frame_black: { color: [0.03, 0.03, 0.03], rough: 0.36, metal: 0.6 },
  black_matte: { color: [0.022, 0.021, 0.02], rough: 0.55 },
  boucle: { tex: 'curly_teddy_natural', tile: 0.336, rough: 1.0, nrm: 1.2, tint: [1.12, 1.1, 1.06], sheen: 0.6 },
  linen: { tex: 'terlenka', tile: 0.266, rough: 1.0, nrm: 1.0, tint: [1.05, 1.04, 1.02], sheen: 0.4 },
  jersey: { tex: 'cotton_jersey', tile: 0.264, rough: 1.0, nrm: 1.0, sheen: 0.4 },
  fleece: { tex: 'knitted_fleece', tile: 0.266, rough: 1.0, nrm: 1.2, sheen: 0.5, tint: [2.3, 2.1, 1.9] },
  rug_wool: { tex: 'poly_wool_herringbone', tile: 0.27, rough: 1.0, nrm: 1.4, tint: [1.35, 1.32, 1.27], sheen: 0.5 },
  oak: { tex: 'white_oak_veneer', tile: 0.5, rough: 0.9, nrm: 0.6 },
  walnut: { tex: 'smoked_walnut_veneer', tile: 1.0, rough: 0.85, nrm: 0.6 },
  paper: { color: [0.82, 0.8, 0.76], rough: 0.9 },
  book_sand: { color: [0.55, 0.47, 0.38], rough: 0.8 },
  book_ink: { color: [0.06, 0.06, 0.065], rough: 0.7 },
  book_clay: { color: [0.42, 0.24, 0.17], rough: 0.8 },
  ceramic_white: { color: [0.78, 0.76, 0.72], rough: 0.35 },
  ceramic_clay: { color: [0.48, 0.36, 0.27], rough: 0.8 },
  brass: { color: [0.78, 0.6, 0.35], rough: 0.32, metal: 1 },
  opal_glass: { color: [0.85, 0.85, 0.83], rough: 0.12, nolm: true, glow: 0.14 },
  curtain_sheer: { curtain: true },
  glass: { glass: true },
  /* Poly Haven models: own textures */
  coffee_table_round_01: { tex: 'coffee_table_round_01', metalMap: true },
  wooden_bowl_01: { tex: 'wooden_bowl_01' },
  mid_century_lounge_chair: { tex: 'mid_century_lounge_chair', metalMap: true },
  modern_wooden_cabinet: { tex: 'modern_wooden_cabinet' },
  standing_picture_frame_01: { tex: 'standing_picture_frame_01' },
  standing_picture_frame_01_artwork: { tex: 'standing_picture_frame_01_artwork' },
  standing_picture_frame_01_glass: { color: [0.02, 0.02, 0.02], rough: 0.05, glassy: true },
  side_table_01: { tex: 'side_table_01' },
  potted_plant_04: { tex: 'potted_plant_04' },
  marble_bust_01: { tex: 'marble_bust_01' },
  potted_plant_01_pot: { tex: 'potted_plant_01_pot' },
  potted_plant_02_pot: { tex: 'potted_plant_02_pot' },
  pachira_aquatica_01_bark: { tex: 'pachira_aquatica_01_bark', plant: true },
  pachira_aquatica_01_leaves: { tex: 'pachira_aquatica_01_leaves', plant: true, leaf: true },
  potted_plant_01_leaves: { tex: 'potted_plant_01_leaves', plant: true, leaf: true },
  potted_plant_02_leaves: { tex: 'potted_plant_02_leaves', plant: true, leaf: true }
};
/* cinematic paths (three.js coordinates, metres): wide -> towards the sun patch -> close to the coating -> back.
   p = portrait keys (4:5 phone stage). exposure / shafts per room. */
const LOOK = {
  living: {
    exposure: 3.4, shafts: 0.2,
    keys: [
      { pos: [1.95, 1.24, 2.15], look: [-0.55, 1.2, -2.8], hfov: 66 },
      { pos: [0.35, 1.3, 0.75], look: [-1.45, 1.22, -2.8], hfov: 58 },
      { pos: [-1.05, 1.36, -1.25], look: [-1.95, 1.28, -2.8], hfov: 50 },
      { pos: [-0.25, 1.3, 1.85], look: [0.25, 1.24, -2.8], hfov: 62 }
    ],
    p: [
      { pos: [0.6, 1.3, 2.2], look: [-0.9, 1.25, -2.8], hfov: 56 },
      { pos: [-0.7, 1.35, -0.6], look: [-1.8, 1.3, -2.8], hfov: 52 }
    ]
  },
  bedroom: {
    exposure: 3.4, shafts: 0.2,
    keys: [
      { pos: [-1.55, 1.28, 1.95], look: [0.15, 1.15, -2.3], hfov: 66 },
      { pos: [0.2, 1.38, 2.05], look: [-0.35, 1.2, -2.3], hfov: 60 },
      { pos: [1.05, 1.35, 0.1], look: [1.55, 1.3, -2.3], hfov: 50 },
      { pos: [1.25, 1.18, 1.5], look: [-0.7, 1.1, -2.3], hfov: 64 }
    ],
    p: [
      { pos: [-0.3, 1.3, 2.0], look: [-0.2, 1.15, -2.3], hfov: 58 },
      { pos: [0.9, 1.35, 0.3], look: [1.4, 1.3, -2.3], hfov: 52 }
    ]
  },
  hallway: {
    exposure: 3.4, shafts: 0.24,
    keys: [
      { pos: [-0.45, 1.45, 3.55], look: [0.55, 1.25, -4.0], hfov: 62 },
      { pos: [-0.62, 1.5, 1.9], look: [1.2, 1.2, -2.2], hfov: 60 },
      { pos: [-0.5, 1.32, -0.9], look: [1.2, 1.12, -3.25], hfov: 54 },
      { pos: [-0.1, 1.25, 3.2], look: [0.35, 1.35, -4.0], hfov: 56 }
    ],
    p: [
      { pos: [-0.55, 1.45, 3.3], look: [0.7, 1.3, -3.0], hfov: 52 },
      { pos: [-0.45, 1.45, 0.4], look: [1.2, 1.3, -2.6], hfov: 52 }
    ]
  }
};

function matDef(name) {
  if (MAT[name]) return MAT[name];
  const base = String(name || '').replace(/\.\d+$/, '');
  return MAT[base] || { color: [0.6, 0.6, 0.6], rough: 0.8 };
}

/* ------------------------------------------------------------------ GLSL */
const GLSL_COMMON = `
uniform float uLmScale; uniform vec2 uLmSize; uniform vec2 uSunSize; uniform sampler2D uSunMap;
uniform vec3 uProbePos; uniform vec3 uProbeMin; uniform vec3 uProbeMax; uniform float uSpecRef;
varying vec3 vDvWorld;
vec4 dvCubic( sampler2D t, vec2 uv, vec2 size ) {
  vec2 st = uv * size - 0.5; vec2 i = floor( st ); vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = ( -f3 + 3.0 * f2 - 3.0 * f + 1.0 ) / 6.0, w1 = ( 3.0 * f3 - 6.0 * f2 + 4.0 ) / 6.0;
  vec2 w2 = ( -3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0 ) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = ( i - 0.5 + w1 / g0 ) / size, h1 = ( i + 1.5 + w3 / g1 ) / size;
  return g0.y * ( g0.x * texture2D( t, h0 ) + g1.x * texture2D( t, vec2( h1.x, h0.y ) ) )
       + g1.y * ( g0.x * texture2D( t, vec2( h0.x, h1.y ) ) + g1.x * texture2D( t, h1 ) );
}
vec3 dvBoxProject( vec3 dir ) {
  vec3 p = clamp( vDvWorld, uProbeMin + 0.01, uProbeMax - 0.01 );
  vec3 a = ( uProbeMax - p ) / dir, b = ( uProbeMin - p ) / dir;
  vec3 f = max( a, b );
  float t = min( min( f.x, f.y ), f.z );
  return normalize( p + dir * t - uProbePos );
}
float dvLum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
`;

/* Tangent-space normal with roughness packed in B: rebuild z from xy */
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

/* soft, stable sun shadows (plant leaves on the coated wall): 4 probe taps, 12-tap Vogel disk only in the penumbra */
let SHADOW_PARS = null;
function shadowPars(T) {
  if (SHADOW_PARS) return SHADOW_PARS;
  const src = T.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('#if defined( SHADOWMAP_TYPE_PCF )'), b = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  const pcf = `#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			/* Vogel disk rotated per sub-texel cell: stable on the surface, fine grain instead of blocky steps */
			vec2 rq = floor( shadowCoord.xy * shadowMapSize * 3.0 );
			float ang = 6.2831853 * fract( 52.9829189 * fract( dot( rq, vec2( 0.06711056, 0.00583715 ) ) ) );
			float sa = sin( ang ), ca = cos( ang );
			float sum = 0.0;
			for ( int i = 0; i < DV_PCF; i ++ ) {
				float r = sqrt( ( float( i ) + 0.5 ) / float( DV_PCF ) );
				float th = float( i ) * 2.39996323;
				vec2 o = vec2( cos( th ), sin( th ) ) * r;
				o = vec2( ca * o.x - sa * o.y, sa * o.x + ca * o.y );
				sum += texture2DCompare( shadowMap, shadowCoord.xy + o * shadowRadius * texelSize, shadowCoord.z );
			}
			shadow = sum / float( DV_PCF );
		`;
  SHADOW_PARS = (a > 0 && b > a) ? src.slice(0, a) + pcf + src.slice(b) : src;
  return SHADOW_PARS;
}

/* point lit by the sun through a window opening (analytic, used by the light shafts, the dust and the curtains) */
const GLSL_WINDOWS = `
#define DV_MAXWIN 2
uniform int uWinCount;
uniform vec3 uWinO[ DV_MAXWIN ]; uniform vec3 uWinU[ DV_MAXWIN ]; uniform vec3 uWinV[ DV_MAXWIN ]; uniform vec3 uWinN[ DV_MAXWIN ];
uniform vec2 uWinS[ DV_MAXWIN ]; uniform vec4 uWinM[ DV_MAXWIN ];
uniform vec3 uSunDirW; uniform float uFrameW;
float dvWinLit( vec3 x ) {
  float lit = 0.0;
  for ( int i = 0; i < DV_MAXWIN; i ++ ) {
    if ( i >= uWinCount ) break;
    float dn = dot( uSunDirW, uWinN[ i ] );
    if ( dn <= 0.01 ) continue;
    float t = dot( x - uWinO[ i ], uWinN[ i ] ) / dn;
    if ( t <= 0.0 ) continue;
    vec3 h = x - uSunDirW * t - uWinO[ i ];
    vec2 ab = vec2( dot( h, uWinU[ i ] ), dot( h, uWinV[ i ] ) );
    float pen = 0.004 + t * 0.0087;
    float m = smoothstep( -pen, pen, ab.x - uFrameW ) * smoothstep( -pen, pen, uWinS[ i ].x - uFrameW - ab.x )
            * smoothstep( -pen, pen, ab.y - uFrameW ) * smoothstep( -pen, pen, uWinS[ i ].y - uFrameW - ab.y );
    for ( int k = 0; k < 4; k ++ ) { float a = uWinM[ i ][ k ]; if ( a > 0.0 ) m *= smoothstep( 0.02 - pen, 0.02 + pen, abs( ab.x - a ) ); }
    lit = max( lit, m );
  }
  return lit;
}
`;

const GLSL_NOISE = `
float dvHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float dvNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( dvHash( i ), dvHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( dvHash( i + vec3( 0, 1, 0 ) ), dvHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( dvHash( i + vec3( 0, 0, 1 ) ), dvHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( dvHash( i + vec3( 0, 1, 1 ) ), dvHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float dvIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
`;

/* anti-tiling for client textures (v1, after I. Quilez, "texture repetition", variant 3) */
const NOTILE_GLSL = `
float dvH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dvN(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dvH(i), dvH(i + vec2(1.0, 0.0)), u.x), mix(dvH(i + vec2(0.0, 1.0)), dvH(i + vec2(1.0, 1.0)), u.x), u.y); }
vec4 dvNoTile(sampler2D s, vec2 uv, float bias){
  float k = dvN(uv * 0.41), l = k * 8.0, ia = floor(l), f = fract(l);
  vec2 oa = sin(vec2(3.0, 7.0) * ia), ob = sin(vec2(3.0, 7.0) * (ia + 1.0));
  float g = exp2(bias); vec2 dx = dFdx(uv) * g, dy = dFdy(uv) * g;
  vec4 ca = textureGrad(s, uv + oa, dx, dy), cb = textureGrad(s, uv + ob, dx, dy);
  return mix(ca, cb, smoothstep(0.2, 0.8, f - 0.1 * dot(ca.rgb - cb.rgb, vec3(1.0))));
}
`;

/* plant sway (world space, applied in the colour pass and in the shadow pass) */
const GLSL_SWAY = `
uniform float uTime; uniform vec3 uPlantBase; uniform float uPlantH; uniform float uSway;
vec3 dvSway( vec3 p ) {
  float h = clamp( ( p.y - uPlantBase.y ) / max( uPlantH, 0.1 ), 0.0, 1.2 );
  float w = h * h;
  float t = uTime;
  float gust = 0.55 + 0.45 * sin( t * 0.23 + 1.3 ) * sin( t * 0.137 );
  vec2 dir = vec2( 0.8, 0.6 );
  float s = sin( t * 0.61 + p.x * 0.8 ) * 0.62 + sin( t * 1.07 + p.z * 1.4 + 1.7 ) * 0.28 + sin( t * 2.3 + h * 5.0 ) * 0.1;
  vec3 off = vec3( dir.x, 0.0, dir.y ) * s * uSway * w * gust;
  float fl = sin( t * 4.1 + dot( p, vec3( 37.1, 21.7, 29.3 ) ) ) * 0.0035 * h * gust;
  off += vec3( fl, fl * 0.7, -fl );
  return off;
}
`;

/* hue-preserving tone curve: identity below 0.76 (the coating's colours stay exact), Khronos-Neutral shoulder above,
   no black offset */
const GLSL_TONE = `
vec3 dvTone( vec3 c ) {
  const float S = 0.76; const float D = 0.15;
  float peak = max( c.r, max( c.g, c.b ) );
  if ( peak < S ) return c;
  float d = 1.0 - S;
  float np = 1.0 - d * d / ( peak + d - S );
  c *= np / peak;
  float g = 1.0 - 1.0 / ( D * ( peak - np ) + 1.0 );
  return mix( c, vec3( np ), g );
}
vec3 dvSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
`;

/* ------------------------------------------------------------------ module */
export const DVInterior2 = { mount, rooms: ROOMS.slice() };
if (typeof window !== 'undefined') window.DVInterior2 = DVInterior2;

function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  const S = {
    room: ROOMS.includes(opts.room) ? opts.room : 'living',
    colors: normColors(opts.colors), grain: clamp(+opts.grain || 1, 0.6, 1.8),
    density: opts.density == null ? 0.92 : clamp(+opts.density, 0.4, 1), seed: opts.seed == null ? 11 : +opts.seed,
    textureUrl: opts.textureUrl || null, textureSize: +opts.textureSize || 0.6, drift: opts.drift !== false
  };
  const QUALITY = TIERS[opts.quality] ? opts.quality : detectTier();
  const box0 = el.getBoundingClientRect();
  const portrait = box0.width > 0 && box0.height > 0 && box0.width / box0.height < 0.95;     /* 4:5 phone stage */
  const poster = room => posterOf(room, portrait);
  let Q = Object.assign({}, TIERS[QUALITY]);
  if (QUALITY === 'high' && G.gpuLite) Q = Object.assign(Q, { cubic: false, shadow: 1024, volScale: 0.35, volSteps: 14, dust: 600 });
  const HI = QUALITY === 'high';
  injectCSS2();
  let T, R, baker, scene, camera, sun, post = null, U = null, coatMats = null;
  let tiles = { cur: null, next: null }, wipe = null, coatTok = 0, roomTok = 0;
  let cur = null;                                   /* current room record */
  const cache = new Map();                          /* loaded rooms (keep two) */
  const texCache = new Map();
  let exterior = null, dust = null;
  let lastInput = performance.now(), frameNo = 0, probe = { n: 0, sum: 0, done: false, last: 0 };
  let stage = null, startResolve, gate = null;
  const started = new Promise(r => (startResolve = r));

  function start() {
    if (stage) return;
    if (gate) { gate.remove(); gate = null; }
    stage = createStage(el, {
      poster: opts.poster === false ? null : (opts.poster || poster(S.room)), label: LABEL[LANG][S.room], className: 'dv3d--interior dv3d--interior2',
      build, update, render, resize, scene: () => scene, camera: () => camera,
      continuous: () => !!wipe, dispose
    });
    bindInput();
    startResolve(stage.readyP);
  }
  /* touch: horizontal swipe changes the room, vertical scrolling stays with the page (touch-action: pan-y) */
  function bindInput() {
    const w = stage.wrap;
    let sx = 0, sy = 0, st = 0, id = -1;
    w.addEventListener('pointerdown', e => { lastInput = performance.now(); if (e.pointerType === 'mouse') return; id = e.pointerId; sx = e.clientX; sy = e.clientY; st = e.timeStamp; }, { passive: true });
    w.addEventListener('pointermove', () => { lastInput = performance.now(); }, { passive: true });
    const end = e => {
      if (e.pointerId !== id) return; id = -1;
      if (opts.swipe === false) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && e.timeStamp - st < 900) {
        const i = ROOMS.indexOf(S.room), n = ROOMS.length;
        const next = ROOMS[(i + (dx < 0 ? 1 : -1) + n) % n];
        ctl.setRoom(next);
        el.dispatchEvent(new CustomEvent('dv3d:room', { bubbles: true, detail: { room: next, via: 'swipe' } }));
      }
    };
    w.addEventListener('pointerup', end, { passive: true });
    w.addEventListener('pointercancel', () => { id = -1; }, { passive: true });
    document.addEventListener('visibilitychange', () => { lastInput = performance.now(); });
  }

  /* ---------------------------------------------------------- build */
  async function build(st) {
    T = st.THREE; R = st.renderer;
    R.toneMapping = T.NoToneMapping;
    R.outputColorSpace = T.SRGBColorSpace;
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFShadowMap; R.shadowMap.autoUpdate = true;
    /* every lightmapped surface shares one program, so opaque objects can go strictly front to back (less overdraw) */
    R.setOpaqueSort((a, b) => (a.groupOrder - b.groupOrder) || (a.renderOrder - b.renderOrder) || (a.z - b.z) || (a.id - b.id));
    baker = createBaker(T, R);
    scene = new T.Scene();
    scene.background = new T.Color(0x000000);
    camera = new T.PerspectiveCamera(50, st.w / st.h, 0.05, 120);
    camera.rotation.order = 'YXZ';
    U = {
      lmScale: { value: 1 }, lmSize: { value: new T.Vector2(1024, 1024) }, sunSize: { value: new T.Vector2(2048, 2048) }, sunMap: { value: null },
      probePos: { value: new T.Vector3() }, probeMin: { value: new T.Vector3() }, probeMax: { value: new T.Vector3() }, specRef: { value: 0.3 },
      time: { value: 0 }, vscale: { value: 1 },
      winCount: { value: 0 }, winO: { value: [new T.Vector3(), new T.Vector3()] }, winU: { value: [new T.Vector3(), new T.Vector3()] },
      winV: { value: [new T.Vector3(), new T.Vector3()] }, winN: { value: [new T.Vector3(), new T.Vector3()] },
      winS: { value: [new T.Vector2(), new T.Vector2()] }, winM: { value: [new T.Vector4(), new T.Vector4()] },
      sunDirW: { value: new T.Vector3(0, -1, 0) }, sunCol: { value: new T.Color(1, 1, 1) }, frameW: { value: 0.05 },
      coatBias: { value: 0.35 }, wipe: { value: 2 }, wipeAxis: { value: new T.Vector3(1, 0, 0) }, wipeRange: { value: new T.Vector2(-3, 3) },
      extMap: { value: null }, extGain: { value: 4.0 }, extRot: { value: 0 }, extCenter: { value: new T.Vector3() },
      skyCol: { value: new T.Color(1, 1, 1) }, roomAmb: { value: new T.Color(0.3, 0.3, 0.3) }
    };
    sun = new T.DirectionalLight(0xffffff, 5);
    sun.castShadow = true;
    U.sunLight = sun;
    sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.radius = Q.shadow >= 2048 ? 8 : Q.shadow >= 1024 ? 4.5 : 2.5;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.015;
    scene.add(sun, sun.target);
    post = createPost(T, R, Q);
    const tm = { t0: performance.now() }; st.stats.timing = tm;
    /* network and image decoding first, the GPU work (coat bake) runs while they arrive */
    const roomP = loadRoom(S.room), extP = loadExterior();
    roomP.catch(() => {}); extP.catch(() => {});
    makeCoatMaterials();
    try { tiles.cur = await coatTiles(); }
    catch (e) { console.warn('[dvatone 3d] texture not loaded, using the procedural coating:', S.textureUrl); S.textureUrl = null; tiles.cur = await coatTiles(); }
    applyTiles(coatMats.A, tiles.cur); applyTiles(coatMats.B, tiles.cur);
    tm.coat = Math.round(performance.now() - tm.t0);
    const [rec] = await Promise.all([roomP, extP]);
    tm.assets = Math.round(performance.now() - tm.t0);
    if (stage.destroyed) return;
    dust = makeDust();
    scene.add(dust);
    useRoom(rec);
    lastInput = performance.now();                   /* the 20 s idle timer starts with the first live frame */
    if (rec.name !== S.room) {                       /* the room was changed while the first one loaded */
      const want = S.room; S.room = rec.name;
      stage.readyP.then(ok => { if (ok) ctl.setRoom(want); });
    }
    /* core.js precompiles the scene right after build(): with the HDR target bound the programs are compiled for the
       linear output they are rendered with (otherwise every program would be compiled twice) */
    R.setRenderTarget(post.rtScene);
    if (/[?&]debug(&|$)/.test(location.search)) G.i2 = { T, R, U, sun, scene, camera, get post() { return post; }, get cur() { return cur; }, dust,
      get Q() { return Q; }, set(o) { Q = Object.assign({}, Q, o); post.dispose(); post = createPost(T, R, Q); applyLook(); resize(stage.w, stage.h); } };
  }

  /* ---------------------------------------------------------- textures */
  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; im.onload = () => res(im); im.onerror = () => rej(new Error('image ' + url)); im.src = url; });
  }
  function texture(file, srgb, opt = {}) {
    const key = file + (srgb ? '|s' : '|l');
    if (texCache.has(key)) return texCache.get(key);
    const p = loadImage(ASSET + file).then(im => {
      const t = new T.Texture(im);
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      t.wrapS = t.wrapT = opt.clamp ? T.ClampToEdgeWrapping : T.RepeatWrapping;
      t.flipY = opt.flipY !== undefined ? opt.flipY : false;
      t.anisotropy = Math.min(opt.aniso || 8, R.capabilities.getMaxAnisotropy());
      if (opt.nomip) { t.generateMipmaps = false; t.minFilter = T.LinearFilter; }
      t.needsUpdate = true;
      return t;
    });
    texCache.set(key, p);
    return p;
  }
  async function loadExterior() {
    const t = await texture('exterior.webp', true, { clamp: false, flipY: true, aniso: 4 });
    t.wrapT = T.ClampToEdgeWrapping;
    U.extMap.value = t;
    exterior = new T.Mesh(new T.SphereGeometry(60, 48, 24), new T.ShaderMaterial({
      uniforms: { uExt: U.extMap, uGain: U.extGain, uRot: U.extRot, uCenter: U.extCenter },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform sampler2D uExt; uniform float uGain; uniform float uRot; uniform vec3 uCenter;
        void main(){
          vec3 d = normalize(vW - uCenter);
          float c = cos(uRot), s = sin(uRot);
          d = vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
          vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 col = texture2D(uExt, uv).rgb;
          gl_FragColor = vec4(col * uGain, 1.0);
        }`,
      side: T.BackSide, depthWrite: true
    }));
    exterior.renderOrder = 10;              /* after the room: early depth test skips it everywhere but in the windows */
    exterior.frustumCulled = false;
    scene.add(exterior);
  }

  /* ---------------------------------------------------------- materials */
  function patch(mat, kind, def = {}) {
    /* kind: 'lm' lightmapped static, 'coat', 'plant', 'glass' */
    const isCoat = kind === 'coat', isPlant = kind === 'plant', isGlass = kind === 'glass';
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, {
        uLmScale: U.lmScale, uLmSize: U.lmSize, uSunSize: U.sunSize, uSunMap: U.sunMap, uProbePos: U.probePos, uProbeMin: U.probeMin, uProbeMax: U.probeMax,
        uSpecRef: U.specRef, uTime: U.time, uVScale: U.vscale
      });
      let v = sh.vertexShader, f = sh.fragmentShader;
      if (Q.cubic) f = '#define DV_CUBIC\n' + f;
      v = v.replace('#include <common>', '#include <common>\nvarying vec3 vDvWorld;' + (isPlant ? '\nattribute vec4 color;\nvarying vec4 vDvCol;\n' + GLSL_SWAY : ''));
      if (isPlant) {
        Object.assign(sh.uniforms, { uPlantBase: mat.userData.plantBase, uPlantH: mat.userData.plantH, uSway: mat.userData.sway });
        v = v.replace('#include <project_vertex>', `
          vec4 dvW4 = modelMatrix * vec4( transformed, 1.0 );
          dvW4.xyz += dvSway( dvW4.xyz );
          vec4 mvPosition = viewMatrix * dvW4;
          gl_Position = projectionMatrix * mvPosition;`);
        v = v.replace('#include <fog_vertex>', '#include <fog_vertex>\nvDvWorld = dvW4.xyz;\nvDvCol = color;');
      } else {
        v = v.replace('#include <fog_vertex>', '#include <fog_vertex>\nvDvWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      }
      f = f.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + (isPlant ? 'varying vec4 vDvCol; uniform float uVScale;\n' : '') + (isCoat ? 'uniform float uCoatBias; uniform float uDeLight; uniform float uLowLod; uniform float uWipe; uniform vec3 uWipeAxis; uniform vec2 uWipeRange;\n' + NOTILE_GLSL : ''));
      if (def.packed) f = f.replace('#include <normal_fragment_maps>', NORMAL_PACKED);
      if (def.packed) f = f.replace('#include <roughnessmap_fragment>', T.ShaderChunk.roughnessmap_fragment.replace('texelRoughness.g', 'texelRoughness.b'));
      if (def.metalSep) f = f.replace('#include <metalnessmap_fragment>', T.ShaderChunk.metalnessmap_fragment.replace('texelMetalness.b', 'texelMetalness.r'));
      f = f.replace('#include <shadowmap_pars_fragment>', '#define DV_PCF ' + (Q.shadow >= 2048 ? 16 : 8) + String.fromCharCode(10) + shadowPars(T));
      /* lighting inputs: baked indirect light + sun visibility */
      let pre = 'vec3 dvLmI = vec3( 0.0 ); float dvSunVis = 0.0;\n';
      if (isPlant) pre += 'dvLmI = vDvCol.rgb * uVScale; dvSunVis = vDvCol.a;\n';
      else if (!isGlass) pre += `#ifdef USE_LIGHTMAP
        #ifdef DV_CUBIC
        { vec3 lmS = dvCubic( lightMap, vLightMapUv, uLmSize ).rgb; dvLmI = lmS * lmS * uLmScale;
          dvSunVis = dvCubic( uSunMap, vLightMapUv, uSunSize ).r; }
        #else
        { vec3 lmS = texture2D( lightMap, vLightMapUv ).rgb; dvLmI = lmS * lmS * uLmScale;
          dvSunVis = texture2D( uSunMap, vLightMapUv ).r; }
        #endif
        #endif\n`;
      /* the coating is the product: on the feature wall the bounce light keeps its brightness (falloff, occlusion)
         but only 30 % of its colour cast, so the composition reads true everywhere on the wall */
      if (isCoat) pre += 'dvLmI = mix( vec3( dvLum( dvLmI ) ), dvLmI, 0.3 );' + String.fromCharCode(10);
      f = f.replace('#include <lights_fragment_begin>', pre + T.ShaderChunk.lights_fragment_begin
        .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= dvSunVis;')
        .replace('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow(', 'directLight.color *= ( directLight.visible && receiveShadow && dvSunVis > 0.002 ) ? getShadow(')
        + (isPlant ? `
        #if ( NUM_DIR_LIGHTS > 0 )
        { /* leaf translucency: sunlight through the leaf */
          vec3 dvL = directionalLights[ 0 ].direction;
          float dvB = max( 0.0, -dot( geometryNormal, dvL ) );
          reflectedLight.directDiffuse += directionalLights[ 0 ].color * dvSunVis * dvB * BRDF_Lambert( material.diffuseColor ) * vec3( 0.55, 0.62, 0.3 );
        }
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
      /* specular occlusion from the baked light (corners, under furniture) */
      if (!isGlass) f = f.replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { float dvAO = clamp( dvLum( dvLmI ) / uSpecRef, 0.0, 1.0 );
          reflectedLight.indirectSpecular *= mix( 0.15, 1.0, sqrt( dvAO ) ); }`);
      if (isCoat) {
        const C = T.ShaderChunk, B = ', uCoatBias )';
        f = f.replace('#include <map_fragment>', C.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv' + B)
            .replace('diffuseColor *= sampledDiffuseColor;', 'if ( uDeLight > 0.5 ) { sampledDiffuseColor = dvNoTile( map, vMapUv, uCoatBias ); vec3 dvLo = textureLod( map, vMapUv, uLowLod ).rgb; vec3 dvMean = textureLod( map, vec2( 0.5 ), 16.0 ).rgb; sampledDiffuseColor.rgb *= dvMean / max( dvLo, vec3( 1e-3 ) ); }\n\tdiffuseColor *= sampledDiffuseColor;'))
          .replace('#include <roughnessmap_fragment>', C.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'texture2D( roughnessMap, vRoughnessMapUv' + B))
          .replace('#include <metalnessmap_fragment>', C.metalnessmap_fragment.replace('texture2D( metalnessMap, vMetalnessMapUv )', 'texture2D( metalnessMap, vMetalnessMapUv' + B))
          .replace('#include <bumpmap_pars_fragment>', C.bumpmap_pars_fragment.split('texture2D( bumpMap, vBumpMapUv )').join('texture2D( bumpMap, vBumpMapUv' + B)
            .split('texture2D( bumpMap, vBumpMapUv + dSTdx )').join('texture2D( bumpMap, vBumpMapUv + dSTdx' + B).split('texture2D( bumpMap, vBumpMapUv + dSTdy )').join('texture2D( bumpMap, vBumpMapUv + dSTdy' + B));
        Object.assign(sh.uniforms, { uCoatBias: U.coatBias, uWipe: U.wipe, uWipeAxis: U.wipeAxis, uWipeRange: U.wipeRange, uDeLight: mat.userData.deLight, uLowLod: mat.userData.lowLod });
        if (mat.userData.wipeLayer) {
          f = f.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
            { float ax = ( dot( vDvWorld, uWipeAxis ) - uWipeRange.x ) / ( uWipeRange.y - uWipeRange.x );
              float n = sin( vDvWorld.y * 2.3 + 1.3 ) * 0.022 + sin( vDvWorld.y * 6.1 + 0.2 ) * 0.008;
              float a = smoothstep( 0.0, 0.11, uWipe - ( ax + n ) );
              if ( a <= 0.001 ) discard;
              diffuseColor.a *= a; }`);
        }
      }
      if (isGlass) {
        f = f.replace('#include <opaque_fragment>', `
          float dvF = 0.04 + 0.96 * pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 5.0 );
          gl_FragColor = vec4( outgoingLight, 0.06 + 0.5 * dvF );`);
      }
      sh.vertexShader = v; sh.fragmentShader = f;
    };
    mat.customProgramCacheKey = () => 'dv2-' + kind + (def.packed ? 'p' : '') + (def.metalSep ? 'm' : '') + (mat.userData.wipeLayer ? 'w' : '') + (Q.cubic ? 'c' : '');
    return mat;
  }

  /* one shader program for every lightmapped surface (D3D shader compiles are the slowest part of the start):
     every material samples colour, normal+roughness and metal maps; untextured ones get 1x1 neutral textures */
  let dummies = null;
  function dummy() {
    if (dummies) return dummies;
    const mk = (r, g, b, srgb) => { const t = new T.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.needsUpdate = true; return t; };
    return (dummies = { white: mk(255, 255, 255, true), flat: mk(128, 128, 255, false), one: mk(255, 255, 255, false) });
  }
  async function buildMaterial(name, kind, extra = {}) {
    const d = matDef(name);
    const P = {};
    if (d.coat) return null;
    const dm = dummy();
    if (d.color) P.color = new T.Color().setRGB(d.color[0], d.color[1], d.color[2], T.LinearSRGBColorSpace);
    P.roughness = d.rough != null ? d.rough : 0.8;
    P.metalness = d.metal || 0;
    P.map = dm.white; P.normalMap = dm.flat; P.roughnessMap = dm.flat; P.metalnessMap = dm.one;
    const def = { packed: true, metalSep: true };
    if (d.tex) {
      const jobs = [texture('tex/' + d.tex + '-c.webp', true), texture('tex/' + d.tex + '-n.webp', false)];
      if (d.metalMap) jobs.push(texture('tex/' + d.tex + '-m.webp', false));
      const [c, n, m] = await Promise.all(jobs);
      P.map = c; P.normalMap = n; P.roughnessMap = n;
      P.normalScale = new T.Vector2(d.nrm || 1, d.nrm || 1);
      if (m) { P.metalnessMap = m; P.metalness = 1; }
      if (d.tint) P.color = new T.Color().setRGB(d.tint[0], d.tint[1], d.tint[2], T.LinearSRGBColorSpace);
    }
    const mat = new T.MeshStandardMaterial(P);
    if (d.glassy) { mat.transparent = true; mat.depthWrite = false; mat.opacity = 0.3; }
    if (kind === 'plant') {
      mat.side = T.DoubleSide;
      mat.userData.plantBase = extra.base; mat.userData.plantH = extra.h; mat.userData.sway = extra.sway;
    }
    return patch(mat, kind, def);
  }

  /* coating materials: A shows the current coat, B the next one wiping in */
  function makeCoatMaterials() {
    const mk = (wipeLayer) => {
      const m = new T.MeshStandardMaterial({ roughness: 1, metalness: 1, bumpScale: 0.3, transparent: wipeLayer });
      m.userData.deLight = { value: 0 }; m.userData.lowLod = { value: 8 }; m.userData.wipeLayer = wipeLayer;
      if (wipeLayer) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; }
      return patch(m, 'coat');
    };
    coatMats = { A: mk(false), B: mk(true) };
  }
  function applyTiles(mat, tl) {
    mat.map = tl.albedo; mat.roughnessMap = tl.data; mat.metalnessMap = tl.data; mat.bumpMap = tl.data;
    mat.roughness = tl.flat ? 0.88 : 1; mat.metalness = tl.flat ? 0 : 1;
    mat.userData.deLight.value = tl.flat ? 1 : 0;
    if (tl.flat && tl.albedo.image) mat.userData.lowLod.value = Math.max(2, Math.log2(Math.max(tl.albedo.image.width, tl.albedo.image.height)) - 2.6);
    mat.bumpScale = tl.flat ? 0 : 0.3;
    const mh = tl.metres * (tl.aspect || 1);
    [tl.albedo, tl.data].forEach(t => t.repeat.set(1 / tl.metres, 1 / mh));
    mat.needsUpdate = true;
  }
  async function coatTiles() {
    if (S.textureUrl) {
      const tex = await new Promise((res, rej) => new T.TextureLoader().load(S.textureUrl, res, undefined, rej));
      tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = Math.min(8, baker.maxAniso);
      const flat = new T.DataTexture(new Uint8Array([128, 255, 0, 255]), 1, 1); flat.needsUpdate = true;
      flat.wrapS = flat.wrapT = T.RepeatWrapping;
      const asp = tex.image && tex.image.width ? tex.image.height / tex.image.width : 1;
      return { albedo: tex, data: flat, metres: S.textureSize, aspect: asp, flat: true, dispose() { tex.dispose(); flat.dispose(); } };
    }
    const b = bakeGranules(T, baker, { colors: S.colors, density: S.density, seed: S.seed, size: 1024, cells: 128, sparkle: 0.0 });
    b.metres = b.cells * CELL_M * S.grain;
    return b;
  }

  /* ---------------------------------------------------------- rooms */
  function loadRoom(name) {
    if (cache.has(name)) return cache.get(name);
    const p = (async () => {
      const [meta, loader] = await Promise.all([fetch(ASSET + name + '.json').then(r => { if (!r.ok) throw new Error('room ' + name); return r.json(); }), gltfLoader()]);
      const [gltf, lm, sm, env] = await Promise.all([
        loader.loadAsync(ASSET + name + '.glb'),
        texture(name + '-lm' + Q.lmq + '.webp', false, { clamp: true, nomip: true }),
        texture(name + '-sun' + Q.lm + '.webp', false, { clamp: true, nomip: true }),
        loadEnv(ASSET + name + '-env.webp', meta.env_range || 64)
      ]);
      const rec = { name, meta, group: gltf.scene, lm, sm, env, plants: [], curtains: [], glass: [], feature: null, mats: [] };
      await prepareRoom(rec);
      return rec;
    })();
    cache.set(name, p);
    p.catch(() => cache.delete(name));
    return p;
  }

  async function loadEnv(url, range) {
    const im = await loadImage(url);
    const w = im.naturalWidth, h = im.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    const px = cx.getImageData(0, 0, w, h).data;
    const out = new Uint16Array(w * h * 4), k = Math.log2(1 + range);
    const lut = new Uint16Array(256);
    for (let i = 0; i < 256; i++) lut[i] = T.DataUtils.toHalfFloat(Math.pow(2, i / 255 * k) - 1);
    const one = T.DataUtils.toHalfFloat(1);
    for (let y = 0; y < h; y++) {                 /* rows bottom-up: data row 0 = v 0 = bottom of the panorama */
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, j = ((h - 1 - y) * w + x) * 4;
        out[j] = lut[px[i]]; out[j + 1] = lut[px[i + 1]]; out[j + 2] = lut[px[i + 2]]; out[j + 3] = one;
      }
    }
    const t = new T.DataTexture(out, w, h, T.RGBAFormat, T.HalfFloatType);
    t.mapping = T.EquirectangularReflectionMapping; t.colorSpace = T.LinearSRGBColorSpace;
    t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    const pm = new T.PMREMGenerator(R);
    const rt = pm.fromEquirectangular(t);
    pm.dispose(); t.dispose();
    return rt;
  }

  async function prepareRoom(rec) {
    const meta = rec.meta, g = rec.group;
    const jobs = [];
    g.updateMatrixWorld(true);
    g.traverse(o => {
      if (!o.isMesh) return;
      const name = o.material && o.material.name;
      const d = matDef(name);
      let info = {};
      try { info = o.userData && o.userData.dv ? JSON.parse(o.userData.dv) : (o.parent && o.parent.userData && o.parent.userData.dv ? JSON.parse(o.parent.userData.dv) : {}); } catch (e) { info = {}; }
      o.castShadow = false; o.receiveShadow = false;
      if (d.coat) { rec.feature = o; return; }
      if (d.curtain) { rec.curtains.push(o); return; }
      if (d.glass) { rec.glass.push(o); return; }
      if (d.plant || info.kind === 'plant') {
        const base = new T.Vector3().fromArray(info.base || [0, 0, 0]);
        const sway = { value: d.leaf ? 0.026 : 0.018 };
        jobs.push(buildMaterial(name, 'plant', { base: { value: base }, h: { value: info.height || 1.2 }, sway }).then(m => {
          o.material = m; o.castShadow = true; o.receiveShadow = true; rec.mats.push(m);
          o.customDepthMaterial = plantDepth(m.userData.plantBase, m.userData.plantH, m.userData.sway);
          rec.plants.push(o);
        }));
        return;
      }
      jobs.push(buildMaterial(name, 'lm').then(m => {
        if (d.nolm) {
          /* small milky-glass pieces: daylight scattered inside the glass instead of a coarse lightmap */
          const g = (d.glow || 0.5) * (meta.lm_scale || 0.7);
          m.emissive = new T.Color(g, g, g * 0.98); m.envMap = rec.env.texture;
        } else { m.lightMap = rec.lm; m.lightMap.channel = 1; m.envMap = rec.env.texture; m.envMapIntensity = 1; }
        o.material = m; o.receiveShadow = !d.nolm; rec.mats.push(m);
      }));
    });
    await Promise.all(jobs);
    /* glass, curtains */
    for (const o of rec.glass) {
      const m = patch(new T.MeshStandardMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false, envMap: rec.env.texture }), 'glass');
      m.blending = T.CustomBlending; m.blendSrc = T.OneFactor; m.blendDst = T.OneMinusSrcAlphaFactor;
      o.material = m; o.renderOrder = 2; rec.mats.push(m);
    }
    for (const o of rec.curtains) { o.material = curtainMaterial(o, meta); o.renderOrder = 3; rec.mats.push(o.material); }
    /* feature wall: two coat layers sharing the baked lightmap UVs */
    if (rec.feature) {
      const fw = rec.feature;
      fw.material = coatMats.A; fw.receiveShadow = true;
      const b = new T.Mesh(fw.geometry, coatMats.B); b.matrixAutoUpdate = false; b.matrix.copy(fw.matrix); b.receiveShadow = true;
      b.visible = false; b.renderOrder = 1;
      fw.parent.add(b); rec.featureB = b;
      fw.geometry.computeBoundingBox();
    }
  }

  function plantDepth(base, h, sway) {
    const m = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { uTime: U.time, uPlantBase: base, uPlantH: h, uSway: sway });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL_SWAY)
        .replace('#include <project_vertex>', `
          vec4 dvW4 = modelMatrix * vec4( transformed, 1.0 );
          dvW4.xyz += dvSway( dvW4.xyz );
          vec4 mvPosition = viewMatrix * dvW4;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    m.customProgramCacheKey = () => 'dv2-plantdepth';
    return m;
  }

  /* sheer curtain: a breeze in the vertex shader, light coming through the fabric from the window */
  function curtainMaterial(o, meta) {
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const size = bb.getSize(new T.Vector3());
    const n = new T.Vector3(), a = new T.Vector3();
    /* curtain plane: thin along the wall normal */
    if (size.x < size.z) { a.set(0, 0, 1); n.set(Math.sign(-bb.getCenter(new T.Vector3()).x) || 1, 0, 0); }
    else { a.set(1, 0, 0); n.set(0, 0, Math.sign(-bb.getCenter(new T.Vector3()).z) || 1); }
    const uni = {
      uTime: U.time, uTop: { value: bb.max.y }, uLen: { value: size.y }, uN: { value: n }, uA: { value: a },
      uSky: U.skyCol, uAmb: U.roomAmb, uSunCol: U.sunCol,
      uWinCount: U.winCount, uWinO: U.winO, uWinU: U.winU, uWinV: U.winV, uWinN: U.winN, uWinS: U.winS, uWinM: U.winM, uSunDirW: U.sunDirW, uFrameW: U.frameW
    };
    return new T.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, side: T.DoubleSide,
      vertexShader: `
        uniform float uTime; uniform float uTop; uniform float uLen; uniform vec3 uN; uniform vec3 uA;
        varying vec3 vW; varying vec3 vNrm; varying float vHang;
        void main(){
          vec4 w = modelMatrix * vec4( position, 1.0 );
          float hang = clamp( ( uTop - w.y ) / uLen, 0.0, 1.0 );
          float k = pow( hang, 1.25 );
          float al = dot( w.xyz, uA );
          float t = uTime;
          float gust = 0.6 + 0.4 * sin( t * 0.21 ) * sin( t * 0.13 + 1.0 );
          float p1 = t * 0.8 + al * 2.1 + hang * 1.3, p2 = t * 1.7 + al * 4.7 - hang * 2.0, p3 = t * 3.1 + al * 9.0 + hang * 5.0;
          float d = ( 0.05 * sin( p1 ) + 0.028 * sin( p2 ) + 0.012 * sin( p3 ) ) * gust;
          float dda = ( 0.05 * 2.1 * cos( p1 ) + 0.028 * 4.7 * cos( p2 ) + 0.012 * 9.0 * cos( p3 ) ) * gust * k;
          w.xyz += uN * d * k + uA * 0.018 * sin( t * 0.6 + hang * 2.0 ) * k * gust;
          vec3 nrm = normalize( mat3( modelMatrix ) * normal );
          vNrm = normalize( nrm - uA * dda * 0.6 );
          vW = w.xyz; vHang = hang;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 uSky; uniform vec3 uAmb; uniform vec3 uSunCol; uniform vec3 uN;
        varying vec3 vW; varying vec3 vNrm; varying float vHang;
        ${GLSL_WINDOWS}
        void main(){
          vec3 V = normalize( cameraPosition - vW );
          vec3 N = normalize( vNrm ); if ( dot( N, V ) < 0.0 ) N = -N;
          float facing = abs( dot( N, V ) );
          /* sheer voile: seen flat it is mostly see-through, in the folds (grazing view) the threads pile up */
          float dens = clamp( 0.2 / max( facing, 0.22 ), 0.18, 0.78 );
          vec3 albedo = vec3( 0.86, 0.85, 0.82 );
          float sunT = dvWinLit( vW + uN * 0.2 );
          float fold = 0.55 + 0.45 * facing;
          vec3 through = uSky * 0.16 * fold + uSunCol * sunT * 0.05;
          vec3 front = uAmb * albedo * ( 0.6 + 0.4 * facing );
          vec3 col = albedo * through + front;
          gl_FragColor = vec4( col, dens );
        }`
    });
  }

  function useRoom(rec) {
    const meta = rec.meta;
    if (cur && cur.group.parent) scene.remove(cur.group);
    cur = rec;
    scene.add(rec.group);
    /* lightmap */
    U.lmScale.value = meta.lm_scale; U.sunMap.value = rec.sm;
    const im = rec.lm.image, si = rec.sm.image; U.lmSize.value.set(im.width || 1024, im.height || 1024); U.sunSize.value.set(si.width || 1024, si.height || 1024);
    /* probe */
    U.probePos.value.fromArray(meta.probe);
    const mn = meta.bounds.min, mx = meta.bounds.max;
    U.probeMin.value.set(Math.min(mn[0], mx[0]), Math.min(mn[1], mx[1]), Math.min(mn[2], mx[2]));
    U.probeMax.value.set(Math.max(mn[0], mx[0]), Math.max(mn[1], mx[1]), Math.max(mn[2], mx[2]));
    U.specRef.value = meta.lm_scale * 0.18;
    U.vscale.value = meta.vscale || 1;
    /* sun: Blender strength and colour (white balanced like the lightmap) */
    const sd = new T.Vector3().fromArray(meta.sun.dir).normalize();
    const sc = meta.sun.color_wb || meta.sun.color;
    sun.color.setRGB(sc[0], sc[1], sc[2], T.LinearSRGBColorSpace);
    sun.intensity = meta.sun.strength;
    U.sunCol.value.setRGB(sc[0] * meta.sun.strength, sc[1] * meta.sun.strength, sc[2] * meta.sun.strength, T.LinearSRGBColorSpace);
    U.sunDirW.value.copy(sd);
    fitSunShadow(rec, sd);
    /* windows */
    const ws = meta.windows || [];
    U.winCount.value = Math.min(2, ws.length);
    ws.slice(0, 2).forEach((w, i) => {
      U.winO.value[i].fromArray(w.origin); U.winU.value[i].fromArray(w.u); U.winV.value[i].fromArray(w.v); U.winN.value[i].fromArray(w.n);
      U.winS.value[i].set(w.w, w.h);
      const m = (w.mullions || []).slice(0, 3); U.winM.value[i].set(m[0] || -1, m[1] || -1, m[2] || -1, w.transom ? -1 : -1);
    });
    U.frameW.value = (ws[0] && ws[0].frame) || 0.05;
    /* sky light through the windows and the room's ambient for the curtains (from the probe exposure) */
    const amb = meta.lm_scale * 0.35;
    U.roomAmb.value.setRGB(amb, amb * 0.98, amb * 0.95);
    U.skyCol.value.setRGB(1.6, 1.65, 1.75);
    U.extRot.value = meta.world_rot || 0;
    U.extGain.value = (1 / 0.3) * (meta.world_strength || 1);     /* exterior.webp stores radiance * 0.3 */
    U.extCenter.value.copy(U.probePos.value);
    /* coat: feature wall + wipe axis along the wall */
    if (rec.feature) {
      const bb = rec.feature.geometry.boundingBox.clone().applyMatrix4(rec.feature.matrixWorld);
      const sz = bb.getSize(new T.Vector3());
      const ax = sz.x >= sz.z ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 0, -1);
      U.wipeAxis.value.copy(ax);
      const c = bb.getCenter(new T.Vector3()).dot(ax), half = (sz.x >= sz.z ? sz.x : sz.z) / 2;
      U.wipeRange.value.set(c - half, c + half);
      coatMats.A.lightMap = rec.lm; coatMats.A.lightMap.channel = 1; coatMats.A.envMap = rec.env.texture;
      coatMats.B.lightMap = rec.lm; coatMats.B.envMap = rec.env.texture;
      coatMats.A.needsUpdate = true; coatMats.B.needsUpdate = true;
    }
    if (dust) placeDust(rec);
    rig = makeRig(meta);
    camT0 = stage.t;                                   /* every room starts on its establishing shot */
    applyLook();
    stage.wrap.setAttribute('aria-label', LABEL[LANG][rec.name]);
    resize(stage.w, stage.h);
    R.shadowMap.needsUpdate = true;
  }

  function fitSunShadow(rec, sd) {
    const box = new T.Box3();
    rec.plants.forEach(p => box.expandByObject(p));
    if (box.isEmpty()) { sun.castShadow = false; return; }
    sun.castShadow = true;
    const c = box.getCenter(new T.Vector3()), r = box.getSize(new T.Vector3()).length() * 0.5 + 0.15;
    sun.position.copy(c).addScaledVector(sd, -12);
    sun.target.position.copy(c);
    sun.target.updateMatrixWorld();
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 12 - r - 0.5, far: 12 + 16 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.updateMatrixWorld();
  }

  /* ---------------------------------------------------------- dust in the sun shafts */
  function makeDust() {
    const n = Q.dust;
    const g = new T.BufferGeometry();
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seed[i] = Math.random();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new T.BufferAttribute(seed, 4));
    const m = new T.ShaderMaterial({
      uniforms: {
        uTime: U.time, uMin: { value: new T.Vector3() }, uSize: { value: new T.Vector3(1, 1, 1) }, uPx: { value: 1 }, uSunCol: U.sunCol,
        uWinCount: U.winCount, uWinO: U.winO, uWinU: U.winU, uWinV: U.winV, uWinN: U.winN, uWinS: U.winS, uWinM: U.winM, uSunDirW: U.sunDirW, uFrameW: U.frameW
      },
      vertexShader: `
        attribute vec4 aSeed; uniform float uTime; uniform vec3 uMin; uniform vec3 uSize; uniform float uPx; uniform vec3 uSunCol;
        varying float vA; varying vec3 vC;
        ${GLSL_WINDOWS}
        void main(){
          float t = uTime;
          vec3 s = aSeed.xyz;
          vec3 p = s + vec3( sin( t * 0.031 + aSeed.w * 6.28 ) * 0.06 + t * 0.0021,
                             sin( t * 0.023 + s.x * 9.0 ) * 0.05 - t * 0.0034,
                             cos( t * 0.027 + s.y * 7.0 ) * 0.06 );
          p += vec3( sin( t * 0.37 + aSeed.w * 40.0 ), sin( t * 0.29 + s.z * 31.0 ), cos( t * 0.41 + s.x * 23.0 ) ) * 0.006;
          p = fract( p );
          vec3 w = uMin + p * uSize;
          float lit = dvWinLit( w );
          vec4 mv = viewMatrix * vec4( w, 1.0 );
          float dist = -mv.z;
          float tw = 0.35 + 0.65 * pow( 0.5 + 0.5 * sin( t * ( 0.8 + aSeed.w * 2.0 ) + aSeed.x * 50.0 ), 6.0 );
          vA = lit * tw * smoothstep( 0.25, 0.8, dist );
          vC = uSunCol * ( 0.6 + 0.4 * aSeed.z );
          gl_PointSize = vA > 0.003 ? clamp( ( 1.2 + 2.2 * aSeed.y ) * uPx * 3.2 / max( dist, 0.3 ), 1.5, 7.0 * uPx ) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main(){
          vec2 q = gl_PointCoord * 2.0 - 1.0;
          float r = dot( q, q ); if ( r > 1.0 ) discard;
          float a = vA * ( 1.0 - r ) * ( 1.0 - r );
          gl_FragColor = vec4( vC * a * 0.06, 0.0 );
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending
    });
    const pts = new T.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = 5;
    return pts;
  }
  function placeDust(rec) {
    /* bounding box of the sun shafts: window corners and their footprints on the floor */
    const box = new T.Box3();
    const sd = U.sunDirW.value;
    const mn = U.probeMin.value, mx = U.probeMax.value;
    for (let i = 0; i < U.winCount.value; i++) {
      const o = U.winO.value[i], u = U.winU.value[i], v = U.winV.value[i], s = U.winS.value[i];
      for (const [a, b] of [[0, 0], [s.x, 0], [0, s.y], [s.x, s.y]]) {
        const p = o.clone().addScaledVector(u, a).addScaledVector(v, b);
        box.expandByPoint(p);
        const t = (p.y - mn.y) / Math.max(0.05, -sd.y);
        box.expandByPoint(p.clone().addScaledVector(sd, t));
      }
    }
    box.min.max(mn); box.max.min(mx);
    if (box.isEmpty()) box.set(mn.clone(), mx.clone());
    dust.material.uniforms.uMin.value.copy(box.min);
    dust.material.uniforms.uSize.value.copy(box.getSize(new T.Vector3()));
  }

  /* ---------------------------------------------------------- camera: level (two-point perspective), slow cinematic loop */
  let rig = null, camT0 = 0;
  function makeRig(meta) {
    const conv = c => ({ pos: new T.Vector3().fromArray(c.pos), look: new T.Vector3().fromArray(c.look), hfov: c.hfov });
    const L = LOOK[meta.room] || {};
    return { keys: (L.keys || meta.cams || []).map(conv), pkeys: (L.p || meta.pcams || []).map(conv) };
  }
  let _a = null, _b = null, shot = null;
  function cat(out, p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return out.set(0, 0, 0)
      .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t).addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
      .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t).addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
  }
  function placeCamera(t) {
    if (!rig) return;
    t = Math.max(0, t - camT0);
    if (!shot) { _a = new T.Vector3(); _b = new T.Vector3(); shot = { pos: new T.Vector3(), look: new T.Vector3(), hfov: 60 }; }
    const portrait = camera.aspect < 0.95 && rig.pkeys.length;
    const keys = portrait ? rig.pkeys : rig.keys;
    const still = !S.drift || stage.reduced;
    if (keys.length === 1 || still) {
      const k = keys[0];
      shot.pos.copy(k.pos); shot.look.copy(k.look); shot.hfov = k.hfov;
      if (!still) {               /* single key: a slow breathing dolly */
        const d = _a.copy(k.look).sub(k.pos).setY(0).normalize();
        const sl = Q.camSlow, s = Math.sin(t * 2 * Math.PI / (38 * sl));
        shot.pos.addScaledVector(d, 0.25 / sl * (0.5 - 0.5 * Math.cos(t * 2 * Math.PI / (52 * sl)))).add(_b.set(-d.z, 0, d.x).multiplyScalar(0.18 / sl * s));
      }
    } else {
      const n = keys.length, seg = 17 * Q.camSlow;             /* seconds per key */
      const u = (t / seg) % n, i = Math.floor(u), f = u - i;
      const e = f * f * (3 - 2 * f) * 0.55 + f * 0.45;         /* ease, never fully stops */
      const K = j => keys[(j + n) % n];
      cat(shot.pos, K(i - 1).pos, K(i).pos, K(i + 1).pos, K(i + 2).pos, e);
      cat(shot.look, K(i - 1).look, K(i).look, K(i + 1).look, K(i + 2).look, e);
      shot.hfov = K(i).hfov + (K(i + 1).hfov - K(i).hfov) * e;
    }
    camera.position.copy(shot.pos);
    const dx = shot.look.x - shot.pos.x, dz = shot.look.z - shot.pos.z;
    camera.rotation.set(0, Math.atan2(-dx, -dz), 0);
    /* lens: keep the horizontal field on landscape screens, cap the vertical one on tall screens */
    const hf = shot.hfov * Math.PI / 180;
    let vf = 2 * Math.atan(Math.tan(hf / 2) / camera.aspect);
    vf = Math.min(vf, (camera.aspect < 0.75 ? 74 : 62) * Math.PI / 180);
    camera.fov = vf * 180 / Math.PI;
    camera.updateProjectionMatrix();
    /* vertical lens shift instead of tilting: verticals stay vertical (architectural photography) */
    const dist = Math.hypot(dx, dz) || 1;
    const shift = ((shot.look.y - shot.pos.y) / dist) / Math.tan(vf / 2);
    camera.projectionMatrix.elements[9] = clamp(shift, -0.6, 0.6);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }

  /* ---------------------------------------------------------- per frame */
  function resize(w, h) {
    if (!camera) return;
    camera.aspect = w / h;
    const pr = Math.min(stage.pr, Q.prCap);
    if (R.getPixelRatio() !== pr) { R.setPixelRatio(pr); R.setSize(w, h, false); }
    stage.stats.pr = +pr.toFixed(2);
    if (post) post.setSize(Math.round(w * pr), Math.round(h * pr));
    if (dust) dust.material.uniforms.uPx.value = pr * (h / 900);
    placeCamera(stage.t);
  }
  let skip = false;
  function update(t, dt) {
    frameNo++;
    const now = performance.now();
    /* battery: 30 fps after 20 s without interaction (and always on the low tier); the animation clock keeps real time */
    const cap30 = Q.fps <= 30 || (now - lastInput > 20000 && !wipe && !(stage && stage._fade));
    skip = cap30 && !G.capture && (frameNo & 1) === 1;
    /* 1-second frame-time probe: a module that cannot hold its tier steps down once (median: one-off hitches from
       uploads or a busy machine do not count) */
    if (!probe.done && !stage.reduced && !G.capture && dt > 0) {
      if (probe.last) { probe.n++; if (probe.n > 45) (probe.list || (probe.list = [])).push(now - probe.last); }
      probe.last = now;
      if (probe.n >= 135) {
        probe.done = true;
        const l = probe.list.sort((a, b) => a - b), ms = l[l.length >> 1];
        stage.stats.probeMs = Math.round(ms * 10) / 10;
        if (ms > (QUALITY === 'high' ? 34 : 42) && QUALITY !== 'low') stepDown(ms);
      }
    }
    if (skip) return;
    U.time.value = t;
    placeCamera(t);
    if (wipe) {
      wipe.k += (dt || 0) / wipe.dur;
      const k = stage.reduced ? 1 : Math.min(1, wipe.k);
      U.wipe.value = -0.04 + k * 1.2;
      if (k >= 1) finishWipe();
    }
    R.shadowMap.autoUpdate = !stage.reduced;
    if (stage.reduced) R.shadowMap.needsUpdate = true;
  }
  function render() {
    if (!cur || skip) return;
    R.info.autoReset = false; R.info.reset();
    post.render(scene, camera, U);
    stage.stats.rendered = (stage.stats.rendered || 0) + 1;
  }
  function applyLook() {
    const lk = (cur && LOOK[cur.name]) || {};
    post.compM.uniforms.uExposure.value = lk.exposure || 2.3;
    post.volU.uDensity.value = lk.shafts != null ? lk.shafts : 0.3;
  }
  function stepDown(ms) {
    const nq = QUALITY === 'high' ? TIERS.mid : TIERS.low;
    Q = Object.assign({}, Q, { prCap: nq.prCap, volScale: nq.volScale, volSteps: nq.volSteps, bloom: nq.bloom, msaa: false, ss: 1, fps: nq.fps, camSlow: nq.camSlow });
    stage.stats.stepDown = Math.round(ms);
    post.dispose(); post = createPost(T, R, Q); applyLook();
    if (dust) dust.geometry.setDrawRange(0, Math.min(dust.geometry.attributes.position.count, nq.dust));
    resize(stage.w, stage.h);
  }

  /* ---------------------------------------------------------- coat transitions (v1 logic) */
  function startWipe(next) {
    if (wipe) finishWipe();
    applyTiles(coatMats.B, next);
    tiles.next = next;
    if (cur && cur.featureB) cur.featureB.visible = true;
    U.wipe.value = -0.04;
    wipe = { k: 0, dur: 1.9 };
    stage.invalidate();
    if (!stage.reduced) stage.start();
  }
  function finishWipe() {
    if (!wipe) return;
    wipe = null;
    const old = tiles.cur; tiles.cur = tiles.next; tiles.next = null;
    applyTiles(coatMats.A, tiles.cur);
    if (cur && cur.featureB) cur.featureB.visible = false;
    U.wipe.value = 2;
    if (old && old !== tiles.cur) old.dispose();
    stage.invalidate();
  }
  async function refreshCoat() {
    if (!stage || !stage.ready) return;
    const tok = ++coatTok;
    let tl;
    try { tl = await coatTiles(); }
    catch (e) { console.warn('[dvatone 3d] texture not loaded:', S.textureUrl); return; }
    if (stage.destroyed || tok !== coatTok) { tl.dispose(); return; }
    startWipe(tl);
  }

  /* ---------------------------------------------------------- public API */
  const ctl = {
    el, get ready() { return started.then(p => p); },
    start,
    setColors(colors, grain) {
      lastInput = performance.now();
      S.colors = normColors(colors); if (grain != null) S.grain = clamp(+grain || 1, 0.6, 1.8);
      S.textureUrl = null; return refreshCoat();
    },
    setState(st = {}) {
      lastInput = performance.now();
      if (st.mix || st.colors) S.colors = normColors(st.mix || st.colors);
      if (st.grain != null) S.grain = clamp(+st.grain, 0.6, 1.8);
      if (st.density != null) S.density = clamp(+st.density, 0.4, 1);
      if (st.seed != null) S.seed = +st.seed;
      S.textureUrl = null; return refreshCoat();
    },
    setTexture(url, metres) {
      lastInput = performance.now();
      S.textureUrl = url || null; if (metres) S.textureSize = +metres;
      return refreshCoat();
    },
    async setRoom(name) {
      if (!ROOMS.includes(name) || name === S.room) return;
      S.room = name; const tok = ++roomTok; lastInput = performance.now();
      if (gate) { const im = gate.querySelector('img'); if (im && opts.poster !== false && !opts.poster) im.src = poster(name); }
      if (!stage) return;
      if (opts.poster !== false && !opts.poster) stage.setPoster(poster(name));
      if (!stage.ready) return;
      let rec;
      try { rec = await loadRoom(name); } catch (e) { console.error('[dvatone 3d]', e); return; }
      if (stage.destroyed || tok !== roomTok) return;
      if (wipe) finishWipe();
      crossfade(stage, () => { update(stage.t, 0); render(); }, () => { useRoom(rec); trimCache(name); }, 1.1);
    },
    get room() { return S.room; },
    stats() { return Object.assign({}, stage ? stage.stats : {}, { room: S.room, tier: QUALITY, started: !!stage }); },
    renderFrame() { if (stage && stage.ready) { skip = false; frameNo = 0; U.time.value = stage.t; placeCamera(stage.t); post.render(scene, camera, U); } },
    destroy() { if (gate) { gate.remove(); gate = null; } if (stage) stage.destroy(); }
  };
  el.dv3d = ctl;
  /* low tier: a still with a small "Live 3D" button; nothing heavy loads until it is pressed */
  if (QUALITY === 'low' && opts.autostart !== true) {
    gate = document.createElement('div'); gate.className = 'dv3d2-gate';
    const im = document.createElement('img'); im.alt = LABEL[LANG][S.room]; im.decoding = 'async';
    if (opts.poster !== false) im.src = opts.poster || poster(S.room); else im.style.display = 'none';
    const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = LANG === 'en' ? 'Live 3D' : 'Живе 3D';
    bt.setAttribute('aria-label', LANG === 'en' ? 'Start the live 3D view' : 'Увімкнути живе 3D');
    bt.addEventListener('click', () => { lastInput = performance.now(); start(); });
    gate.append(im, bt); el.appendChild(gate);
  } else start();

  return ctl;

  function trimCache(keep) {
    /* keep the current room and the previous one */
    const names = [...cache.keys()];
    if (names.length <= 2) return;
    names.filter(n => n !== keep).slice(0, names.length - 2).forEach(n => {
      const p = cache.get(n); cache.delete(n);
      p.then(disposeRoom).catch(() => {});
    });
  }
  function disposeRoom(rec) {
    if (!rec || rec === cur) return;
    rec.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    rec.mats.forEach(m => m.dispose());
    rec.env && rec.env.dispose();
  }
  function dispose() {
    if (!scene) return;
    for (const p of cache.values()) p.then(r => { if (r !== cur) disposeRoom(r); }).catch(() => {});
    if (cur) { const c = cur; cur = null; disposeRoom(c); }
    tiles.cur && tiles.cur.dispose(); tiles.next && tiles.next.dispose();
    coatMats && (coatMats.A.dispose(), coatMats.B.dispose());
    for (const p of texCache.values()) p.then(t => t.dispose()).catch(() => {});
    if (exterior) { exterior.geometry.dispose(); exterior.material.dispose(); }
    if (dust) { dust.geometry.dispose(); dust.material.dispose(); }
    post && post.dispose();
    baker && baker.dispose();
  }
}

/* ------------------------------------------------------------------ post: HDR scene -> light shafts, window bloom, tone curve */
function createPost(T, R, Q) {
  const msaa = Q.msaa && (window.devicePixelRatio || 1) < 1.5 ? 4 : 0;
  /* supersampling on standard-density screens: the scene renders at 1.5x and the composite resolves it (tone-mapped box
     filter); MSAA would need a multisampled depth resolve, which stalls on ANGLE/D3D11 */
  const SS = (Q.ss || 1) > 1 && (window.devicePixelRatio || 1) < 1.5 ? Q.ss : 1;
  const AA = !!Q.fxaa && (window.devicePixelRatio || 1) < 1.5;
  const rtLDR = new T.WebGLRenderTarget(4, 4, { type: T.UnsignedByteType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter, generateMipmaps: false });
  const mk = (w, h, o = {}) => new T.WebGLRenderTarget(w, h, Object.assign({ type: T.HalfFloatType, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter, generateMipmaps: false }, o));
  const depth = new T.DepthTexture(4, 4); depth.type = T.UnsignedIntType;
  const rtScene = mk(4, 4, { depthBuffer: true, samples: msaa, depthTexture: depth });
  const volScale = Q.volScale;
  const rtVol = mk(4, 4), rtVol2 = mk(4, 4);
  const LV = Q.bloom;
  const down = [], up = [];
  for (let i = 0; i < LV; i++) { down.push(mk(4, 4)); up.push(mk(4, 4)); }
  const black = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const quad = new T.Mesh(new T.BufferGeometry());
  quad.geometry.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  quad.geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  quad.frustumCulled = false;
  const qs = new T.Scene(); qs.add(quad);
  const qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const sm = (frag, uniforms, defines) => new T.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, defines: defines || {}, depthTest: false, depthWrite: false });

  const volU = {
    tDepth: { value: depth }, uProjInv: { value: new T.Matrix4() }, uViewInv: { value: new T.Matrix4() }, uCam: { value: new T.Vector3() },
    uBoxMin: { value: new T.Vector3() }, uBoxMax: { value: new T.Vector3() }, uTime: { value: 0 }, uSunCol: { value: new T.Color() },
    uDensity: { value: 0.03 }, uFrame: { value: 0 }, tShadow: { value: null }, uShadowMat: { value: new T.Matrix4() }, uHasShadow: { value: 0 },
    uWinCount: { value: 0 }, uWinO: { value: [] }, uWinU: { value: [] }, uWinV: { value: [] }, uWinN: { value: [] }, uWinS: { value: [] }, uWinM: { value: [] }, uSunDirW: { value: new T.Vector3() }, uFrameW: { value: 0.05 }
  };
  const STEPS = Q.volSteps;
  const volM = sm(`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDepth; uniform mat4 uProjInv; uniform mat4 uViewInv; uniform vec3 uCam;
    uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform float uTime; uniform vec3 uSunCol; uniform float uDensity; uniform float uFrame;
    uniform sampler2D tShadow; uniform mat4 uShadowMat; uniform float uHasShadow;
    #include <packing>
    ${GLSL_WINDOWS}
    ${GLSL_NOISE}
    void main(){
      float d = texture2D( tDepth, vUv ).r;
      vec4 vp = uProjInv * vec4( vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 ); vp /= vp.w;
      vec3 wp = ( uViewInv * vp ).xyz;
      vec3 rd = wp - uCam; float L = length( rd ); rd /= L;
      vec3 t0 = ( uBoxMin - uCam ) / rd, t1 = ( uBoxMax - uCam ) / rd;
      vec3 tm = max( t0, t1 );
      float tEnd = min( L, min( min( tm.x, tm.y ), tm.z ) );
      float j = dvIGN( gl_FragCoord.xy + uFrame * 5.588238 );
      float dt = tEnd / float( STEPS );
      float acc = 0.0;
      for ( int s = 0; s < STEPS; s ++ ) {
        vec3 x = uCam + rd * ( ( float( s ) + j ) * dt );
        float lit = dvWinLit( x );
        if ( lit > 0.0 ) {
          if ( uHasShadow > 0.5 ) {            /* the plant's leaves cut shafts into the beam */
            vec4 sc = uShadowMat * vec4( x, 1.0 );
            if ( sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0 )
              lit *= step( sc.z - 0.002, unpackRGBAToDepth( texture2D( tShadow, sc.xy ) ) );
          }
          float n = dvNoise( x * 2.2 + vec3( uTime * 0.05, -uTime * 0.02, uTime * 0.03 ) ) * 0.6 + dvNoise( x * 5.3 - uTime * 0.04 ) * 0.4;
          acc += lit * ( 0.12 + 1.5 * n * n );
        }
      }
      float c = dot( rd, uSunDirW );
      float g = 0.55;
      float hg = ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * c, 1.5 ) * 0.0795775;
      float phase = mix( 0.0795775, hg, 0.8 );
      gl_FragColor = vec4( uSunCol * acc * dt * uDensity * phase, 1.0 );
    }`, volU, { STEPS });
  const blurM = sm(`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel;
    void main(){
      vec3 c = texture2D( tIn, vUv ).rgb * 0.4;
      c += texture2D( tIn, vUv + vec2( uTexel.x, 0.0 ) ).rgb * 0.15 + texture2D( tIn, vUv - vec2( uTexel.x, 0.0 ) ).rgb * 0.15;
      c += texture2D( tIn, vUv + vec2( 0.0, uTexel.y ) ).rgb * 0.15 + texture2D( tIn, vUv - vec2( 0.0, uTexel.y ) ).rgb * 0.15;
      gl_FragColor = vec4( c, 1.0 );
    }`, { tIn: { value: null }, uTexel: { value: new T.Vector2() } });
  /* bloom: only what is far away (the view through the windows), bright pass + dual-filter pyramid */
  const brightM = sm(`
    varying vec2 vUv; uniform sampler2D tIn; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear; uniform float uFar; uniform float uThr;
    float lin( float d ){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / ( uFar + uNear - z * ( uFar - uNear ) ); }
    void main(){
      vec3 c = vec3( 0.0 ); float w = 0.0;
      for ( int i = 0; i < 4; i ++ ) {
        vec2 o = vec2( i == 0 || i == 2 ? -1.5 : 1.5, i < 2 ? -1.5 : 1.5 ) * uTexel;
        float far = smoothstep( 9.0, 14.0, lin( texture2D( tDepth, vUv + o ).r ) );
        vec3 s = texture2D( tIn, vUv + o ).rgb;
        float l = max( s.r, max( s.g, s.b ) );
        c += s * far * smoothstep( uThr, uThr * 2.0, l );
      }
      gl_FragColor = vec4( c * 0.25, 1.0 );
    }`, { tIn: { value: null }, tDepth: { value: depth }, uTexel: { value: new T.Vector2() }, uNear: { value: 0.05 }, uFar: { value: 120 }, uThr: { value: 1.0 } });
  const downM = sm(`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uTexel;
    void main(){
      vec3 c = texture2D( tIn, vUv ).rgb * 4.0;
      c += texture2D( tIn, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tIn, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb;
      c += texture2D( tIn, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tIn, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb;
      gl_FragColor = vec4( c / 8.0, 1.0 );
    }`, { tIn: { value: null }, uTexel: { value: new T.Vector2() } });
  const upM = sm(`
    varying vec2 vUv; uniform sampler2D tIn; uniform sampler2D tAdd; uniform vec2 uTexel; uniform float uAddW;
    void main(){
      vec3 c = texture2D( tIn, vUv + uTexel * vec2( -2.0, 0.0 ) ).rgb + texture2D( tIn, vUv + uTexel * vec2( 2.0, 0.0 ) ).rgb
             + texture2D( tIn, vUv + uTexel * vec2( 0.0, -2.0 ) ).rgb + texture2D( tIn, vUv + uTexel * vec2( 0.0, 2.0 ) ).rgb;
      c += ( texture2D( tIn, vUv + uTexel * vec2( -1.0, -1.0 ) ).rgb + texture2D( tIn, vUv + uTexel * vec2( 1.0, -1.0 ) ).rgb
           + texture2D( tIn, vUv + uTexel * vec2( -1.0, 1.0 ) ).rgb + texture2D( tIn, vUv + uTexel * vec2( 1.0, 1.0 ) ).rgb ) * 2.0;
      gl_FragColor = vec4( c / 12.0 + texture2D( tAdd, vUv ).rgb * uAddW, 1.0 );
    }`, { tIn: { value: null }, tAdd: { value: null }, uTexel: { value: new T.Vector2() }, uAddW: { value: 1 } });
  const compM = sm(`
    varying vec2 vUv; uniform sampler2D tScene; uniform sampler2D tVol; uniform sampler2D tBloom;
    uniform float uExposure; uniform float uBloom; uniform float uVol; uniform float uAspect; uniform float uVig; uniform vec2 uOut;
    ${GLSL_TONE}
    ${GLSL_NOISE}
    vec3 dvShade( vec3 c, vec3 add, float vig ) { return dvTone( max( ( c + add ) * uExposure * vig, 0.0 ) ); }
    void main(){
      vec3 add = texture2D( tVol, vUv ).rgb * uVol + texture2D( tBloom, vUv ).rgb * uBloom;
      vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
      float vig = mix( 1.0, smoothstep( 1.3, 0.25, length( q ) ), uVig );
      vec3 c;
      #if SS > 1
        /* resolve the supersampled scene: 4 bilinear taps (a box over about 2x2 scene texels), tone-mapped before averaging */
        vec2 o = 0.25 / uOut;
        c = ( dvShade( texture2D( tScene, vUv + vec2( -o.x, -o.y ) ).rgb, add, vig ) + dvShade( texture2D( tScene, vUv + vec2( o.x, -o.y ) ).rgb, add, vig )
            + dvShade( texture2D( tScene, vUv + vec2( -o.x, o.y ) ).rgb, add, vig ) + dvShade( texture2D( tScene, vUv + vec2( o.x, o.y ) ).rgb, add, vig ) ) * 0.25;
      #else
        c = dvShade( texture2D( tScene, vUv ).rgb, add, vig );
      #endif
      c = dvSRGB( clamp( c, 0.0, 1.0 ) );
      c += ( dvIGN( gl_FragCoord.xy ) - 0.5 ) / 255.0;
      gl_FragColor = vec4( c, 1.0 );
    }`, { tScene: { value: rtScene.texture }, tVol: { value: rtVol.texture }, tBloom: { value: null }, uExposure: { value: 1.6 }, uBloom: { value: 0.08 }, uVol: { value: 1 }, uAspect: { value: 1 }, uVig: { value: 0.22 }, uOut: { value: new T.Vector2(4, 4) } }, { SS: SS > 1 ? 2 : 1 });

  /* FXAA (after T. Lottes, the compact 3.11 console variant): low-contrast detail such as the coating's grain is left alone */
  const fxaaM = sm(`
    varying vec2 vUv; uniform sampler2D tIn; uniform vec2 uPx;
    void main(){
      vec3 nw = texture2D( tIn, vUv + vec2( -1.0, -1.0 ) * uPx ).rgb, ne = texture2D( tIn, vUv + vec2( 1.0, -1.0 ) * uPx ).rgb;
      vec3 sw = texture2D( tIn, vUv + vec2( -1.0, 1.0 ) * uPx ).rgb, se = texture2D( tIn, vUv + vec2( 1.0, 1.0 ) * uPx ).rgb;
      vec3 m = texture2D( tIn, vUv ).rgb;
      const vec3 L = vec3( 0.299, 0.587, 0.114 );
      float lnw = dot( nw, L ), lne = dot( ne, L ), lsw = dot( sw, L ), lse = dot( se, L ), lm = dot( m, L );
      float lmin = min( lm, min( min( lnw, lne ), min( lsw, lse ) ) ), lmax = max( lm, max( max( lnw, lne ), max( lsw, lse ) ) );
      if ( lmax - lmin < max( 0.05, lmax * 0.14 ) ) { gl_FragColor = vec4( m, 1.0 ); return; }
      vec2 dir = vec2( -( ( lnw + lne ) - ( lsw + lse ) ), ( lnw + lsw ) - ( lne + lse ) );
      float red = max( ( lnw + lne + lsw + lse ) * 0.03125, 0.0078125 );
      dir = clamp( dir / ( min( abs( dir.x ), abs( dir.y ) ) + red ), vec2( -8.0 ), vec2( 8.0 ) ) * uPx;
      vec3 a = 0.5 * ( texture2D( tIn, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb + texture2D( tIn, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
      vec3 b = a * 0.5 + 0.25 * ( texture2D( tIn, vUv - dir * 0.5 ).rgb + texture2D( tIn, vUv + dir * 0.5 ).rgb );
      float lb = dot( b, L );
      gl_FragColor = vec4( ( lb < lmin || lb > lmax ) ? a : b, 1.0 );
    }`, { tIn: { value: rtLDR.texture }, uPx: { value: new T.Vector2() } });

  let W = 4, H = 4, frame = 0;
  function pass(mat, target) { quad.material = mat; R.setRenderTarget(target); R.render(qs, qc); }
  function finish() { if (AA) { pass(compM, rtLDR); pass(fxaaM, null); } else pass(compM, null); }
  return {
    rtScene, volU, compM,
    setSize(w, h) {
      W = Math.max(4, w); H = Math.max(4, h);
      rtScene.setSize(Math.round(W * SS), Math.round(H * SS));
      compM.uniforms.uOut.value.set(W, H);
      if (AA) { rtLDR.setSize(W, H); fxaaM.uniforms.uPx.value.set(1 / W, 1 / H); }
      const vw = Math.max(4, Math.round(W * volScale)), vh = Math.max(4, Math.round(H * volScale));
      rtVol.setSize(vw, vh); rtVol2.setSize(vw, vh);
      let bw = Math.max(4, W >> 2), bh = Math.max(4, H >> 2);
      for (let i = 0; i < LV; i++) { down[i].setSize(bw, bh); up[i].setSize(bw, bh); bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); }
      compM.uniforms.uAspect.value = W / H;
    },
    render(scene, camera, U) {
      frame++;
      const xr = R.xr && R.xr.enabled;
      R.setRenderTarget(rtScene);
      R.render(scene, camera);
      /* light shafts */
      volU.uProjInv.value.copy(camera.projectionMatrixInverse);
      volU.uViewInv.value.copy(camera.matrixWorld);
      volU.uCam.value.copy(camera.position);
      volU.uBoxMin.value.copy(U.probeMin.value); volU.uBoxMax.value.copy(U.probeMax.value);
      volU.uTime.value = U.time.value; volU.uFrame.value = frame % 64;
      volU.uSunCol.value.copy(U.sunCol.value);
      volU.uWinCount.value = U.winCount.value; volU.uWinO.value = U.winO.value; volU.uWinU.value = U.winU.value; volU.uWinV.value = U.winV.value;
      volU.uWinN.value = U.winN.value; volU.uWinS.value = U.winS.value; volU.uWinM.value = U.winM.value; volU.uSunDirW.value.copy(U.sunDirW.value); volU.uFrameW.value = U.frameW.value;
      const sh = U.sunLight && U.sunLight.castShadow && U.sunLight.shadow.map;
      volU.uHasShadow.value = sh ? 1 : 0;
      if (sh) { volU.tShadow.value = U.sunLight.shadow.map.texture; volU.uShadowMat.value.copy(U.sunLight.shadow.matrix); }
      if (STEPS > 0) {
        pass(volM, rtVol);
        blurM.uniforms.tIn.value = rtVol.texture; blurM.uniforms.uTexel.value.set(1 / rtVol.width, 1 / rtVol.height);
        pass(blurM, rtVol2);
        compM.uniforms.tVol.value = rtVol2.texture; compM.uniforms.uVol.value = 1;
      } else { compM.uniforms.tVol.value = black; compM.uniforms.uVol.value = 0; }
      /* window bloom */
      if (LV < 2) { compM.uniforms.tBloom.value = black; compM.uniforms.uBloom.value = 0; finish(); return; }
      brightM.uniforms.tIn.value = rtScene.texture; brightM.uniforms.uTexel.value.set(1 / rtScene.width, 1 / rtScene.height);
      brightM.uniforms.uNear.value = camera.near; brightM.uniforms.uFar.value = camera.far;
      pass(brightM, down[0]);
      for (let i = 1; i < LV; i++) {
        downM.uniforms.tIn.value = down[i - 1].texture; downM.uniforms.uTexel.value.set(1 / down[i - 1].width, 1 / down[i - 1].height);
        pass(downM, down[i]);
      }
      let src = down[LV - 1];
      for (let i = LV - 2; i >= 0; i--) {
        upM.uniforms.tIn.value = src.texture; upM.uniforms.tAdd.value = down[i].texture; upM.uniforms.uAddW.value = 1;
        upM.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
        pass(upM, up[i]); src = up[i];
      }
      compM.uniforms.tBloom.value = src.texture;
      finish();
    },
    dispose() {
      [rtScene, rtVol, rtVol2, rtLDR, ...down, ...up].forEach(r => r.dispose());
      fxaaM.dispose();
      depth.dispose();
      [volM, blurM, brightM, downM, upM, compM].forEach(m => m.dispose());
      black.dispose();
      quad.geometry.dispose();
    }
  };
}

/* declarative mounting */
function autoMount() {
  document.querySelectorAll('[data-dv3d="interior2"]').forEach(el => {
    if (el.dv3d) return;
    let colors = null; try { colors = JSON.parse(el.getAttribute('data-colors') || 'null'); } catch (e) { colors = null; }
    const poster = el.getAttribute('data-poster');
    mount(el, { room: el.getAttribute('data-room') || 'living', colors, grain: +el.getAttribute('data-grain') || 1, textureUrl: el.getAttribute('data-texture') || null,
      textureSize: +el.getAttribute('data-texture-size') || undefined, poster: poster === 'none' ? false : (poster || undefined), quality: el.getAttribute('data-quality') || 'auto' });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
