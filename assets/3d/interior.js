/* Dvatone 3D interiors: minimalist rooms whose feature wall wears a granular multicolour coating.
   DVInterior.mount(el, { room:'living'|'bedroom'|'hallway', colors:[{hex, share}], grain:0.6..1.8,
                          density?, seed?, textureUrl?, textureSize? (metres per tile), drift?, poster? (false = none) })
   -> { setColors(colors, grain?), setState(generatorState), setRoom(name), setTexture(url|null, size?),
        destroy(), stats(), ready: Promise<boolean> }
   Declarative: <div data-dv3d="interior" data-room="living" data-colors='[{"hex":"B8A389","share":45},...]' data-grain="1"></div>
   The wall material is a seamless tile baked from the generator data (see core.js bakeGranules); a client texture
   (textureUrl) replaces it 1:1 (scan lighting is evened out and repetition broken up in the shader), so the
   generator's own seamless textures drop in without code changes. Events on el: dv3d:ready, dv3d:fallback. */
import { createStage, createBaker, bakeGranules, normColors, roundedBox, clamp, smooth, crossfade, GLSL_HASH, isSmallScreen } from './core.js';

const BASE = import.meta.url;
const ROOMS = ['living', 'bedroom', 'hallway'];
const LANG = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk';
const LABEL = {
  uk: { living: 'Вітальня, стіна з мультиколоровим покриттям Dvatone', bedroom: 'Спальня, стіна за ліжком з покриттям Dvatone', hallway: 'Передпокій, довга стіна з покриттям Dvatone' },
  en: { living: 'Living room with a Dvatone multicolour coating on the wall', bedroom: 'Bedroom with a Dvatone coating on the wall behind the bed', hallway: 'Hallway with a Dvatone coating along the long wall' }
};
const posterOf = room => new URL('./fallback/interior-' + room + '.webp', BASE).href;
const CELL_M = 0.0021;          /* granule lattice cell in metres at grain 1 (fleck about 1.9 mm, M) */

/* ---------------- texture bakes for the room materials (GPU, seamless, mipmapped) ---------------- */
const MAT_GLSL = `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform int uPass;
uniform vec3 uBase;
uniform int uOne;
uniform int uOct;
${GLSL_HASH}
ivec2 wrap2(ivec2 c, ivec2 n){ return ((c % n) + n) % n; }
float vnA(vec2 p, ivec2 n, int k){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f); ivec2 ii = ivec2(i);
  float a = rnd3(wrap2(ii, n), k, 1.0).x, b = rnd3(wrap2(ii + ivec2(1,0), n), k, 1.0).x;
  float c = rnd3(wrap2(ii + ivec2(0,1), n), k, 1.0).x, d = rnd3(wrap2(ii + ivec2(1,1), n), k, 1.0).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbmA(vec2 p, ivec2 n, int k){ float s = 0.0, a = 0.5; for (int o = 0; o < uOct; o++){ s += a * vnA(p, n, k + o); p *= 2.0; n *= 2; a *= 0.5; } return s; }
float worley(vec2 p, int n, int k){
  ivec2 ci = ivec2(floor(p)); float d = 9.0;
  for (int j = -uOne; j <= uOne; j++) for (int i = -uOne; i <= uOne; i++){
    ivec2 c = ci + ivec2(i, j); vec3 r = rnd3(wrapc(c, n), k, 2.0);
    d = min(d, length(p - (vec2(c) + r.xy)));
  }
  return d;
}
`;
const OAK_FRAG = MAT_GLSL + `
void main(){
  const float TILE = 2.4;
  vec2 m = vUv * TILE;
  float rowF = m.y / 0.2; float row = floor(rowF); float yIn = fract(rowF);
  int ri = int(mod(row, 12.0));
  vec3 rr = rnd3(ivec2(ri, 0), 5, 3.0);
  float xw = mod(m.x + rr.x * TILE, TILE);
  float plF = xw / 1.2; float pl = floor(plF); float xIn = fract(plF);
  vec3 pr = rnd3(ivec2(int(pl), ri), 6, 2.0);
  vec2 lp = vec2(xIn * 1.2, yIn * 0.2) + pr.xy * 37.0;
  float streak = fbmA(vec2(lp.x * 2.2, lp.y * 70.0), ivec2(4096), 20);
  float fine = vnA(vec2(lp.x * 9.0, lp.y * 420.0), ivec2(8192), 30);
  float arc = sin((lp.y * 38.0 + fbmA(vec2(lp.x * 1.4, lp.y * 6.0), ivec2(4096), 40) * 5.0) * 6.2831);
  float grain = streak * 0.75 + fine * 0.25;
  float ring = smoothstep(0.55, 1.0, arc) * 0.5;
  float tone = 0.86 + 0.2 * pr.z;
  vec3 col = uBase * tone * (0.9 + 0.2 * grain) * (1.0 - 0.1 * ring);
  float groove = smoothstep(0.0, 0.016, yIn) * smoothstep(0.0, 0.016, 1.0 - yIn) * smoothstep(0.0, 0.0028, xIn) * smoothstep(0.0, 0.0028, 1.0 - xIn);
  col *= mix(0.55, 1.0, groove);
  if (uPass == 0) gl_FragColor = vec4(col, 1.0);
  else gl_FragColor = vec4(0.55 + 0.08 * grain - 0.45 * (1.0 - groove), 0.5 + 0.16 * fine + 0.1 * ring, 0.0, 1.0);
}`;
const STONE_FRAG = MAT_GLSL + `
void main(){
  vec2 p = vUv;
  float band = fbmA(vec2(p.x * 2.0, p.y * 14.0), ivec2(2, 14), 50);
  float band2 = fbmA(vec2(p.x * 5.0, p.y * 40.0), ivec2(5, 40), 60);
  float pores = smoothstep(0.74, 0.86, vnA(vec2(p.x * 30.0, p.y * 140.0), ivec2(30, 140), 70)) * smoothstep(0.3, 0.7, band2);
  vec3 col = uBase * (0.9 + 0.16 * band + 0.06 * band2);
  col = mix(col, col * vec3(0.78, 0.74, 0.68), pores * 0.8);
  if (uPass == 0) gl_FragColor = vec4(col, 1.0);
  else gl_FragColor = vec4(0.62 + 0.06 * band2 - 0.35 * pores, 0.48 + 0.14 * band2 + 0.3 * pores, 0.0, 1.0);
}`;
const BOUCLE_FRAG = MAT_GLSL + `
void main(){
  vec2 p = vUv * 22.0;
  float w = worley(p, 22, 80);
  float w2 = worley(p * 2.0 + 3.1, 44, 81);
  float h = (1.0 - smoothstep(0.05, 0.65, w)) * 0.7 + (1.0 - smoothstep(0.05, 0.6, w2)) * 0.3;
  gl_FragColor = vec4(h, 0.96, 0.0, 1.0);
}`;
const LINEN_FRAG = MAT_GLSL + `
void main(){
  vec2 p = vUv * 64.0 * 6.2831853;
  float slub = vnA(vec2(vUv.x * 64.0, vUv.y * 4.0), ivec2(64, 4), 90) * 0.5 + vnA(vec2(vUv.x * 4.0, vUv.y * 64.0), ivec2(4, 64), 91) * 0.5;
  float wv = 0.5 + 0.25 * sin(p.x) * sign(sin(p.y * 0.5)) + 0.25 * sin(p.y) * sign(sin(p.x * 0.5));
  gl_FragColor = vec4(mix(wv, slub, 0.35), 0.93, 0.0, 1.0);
}`;
const PLASTER_FRAG = MAT_GLSL + `
void main(){
  float h = fbmA(vUv * 8.0, ivec2(8), 100) * 0.7 + vnA(vUv * 96.0, ivec2(96), 110) * 0.3;
  gl_FragColor = vec4(h, 0.93, 0.0, 1.0);
}`;

/* ---------------- analytic ambient occlusion (room corners + furniture boxes) ---------------- */
const AO_GLSL = `
uniform vec3 uRoomMin; uniform vec3 uRoomMax;
uniform vec4 uWin; uniform vec2 uWinK;
float dvEdge(float d){ return mix(0.52, 1.0, smoothstep(0.0, 0.7, max(d, 0.0))); }
float dvRoomAO(vec3 p, vec3 n){
  vec3 a = p - uRoomMin, b = uRoomMax - p;
  float ao = (n.x > 0.7 ? 1.0 : dvEdge(a.x)) * (n.x < -0.7 ? 1.0 : dvEdge(b.x))
           * (n.y > 0.7 ? 1.0 : dvEdge(a.y)) * (n.y < -0.7 ? 1.0 : dvEdge(b.y))
           * (n.z > 0.7 ? 1.0 : dvEdge(a.z)) * (n.z < -0.7 ? 1.0 : dvEdge(b.z));
  /* daylight falls off away from the window: brighter near it, calmer in the far corners */
  float dw = length(p - uWin.xyz) / uWin.w;
  return ao * (uWinK.x + uWinK.y * exp(-dw * dw));
}
`;

/* anti-tiling for client textures (after I. Quilez, "texture repetition", variant 3): every region of the wall
   reads the tile with its own random offset and neighbouring regions blend, so a small tile never shows a grid */
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

/* soft, stable sun shadows: 12-tap Vogel disk rotated per shadow-map texel (no banding, no crawling) */
let SHADOW_PARS = null;
function shadowPars(T) {
  if (SHADOW_PARS) return SHADOW_PARS;
  const src = T.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('#if defined( SHADOWMAP_TYPE_PCF )'), b = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  const pcf = `#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			/* 4 probe taps first: fully lit or fully shadowed pixels stop here, only the penumbra pays for 12 taps */
			vec2 pr = texelSize * shadowRadius * 0.72;
			float probe = texture2DCompare( shadowMap, shadowCoord.xy + vec2( -pr.x, -pr.y ), shadowCoord.z )
				+ texture2DCompare( shadowMap, shadowCoord.xy + vec2( pr.x, -pr.y ), shadowCoord.z )
				+ texture2DCompare( shadowMap, shadowCoord.xy + vec2( -pr.x, pr.y ), shadowCoord.z )
				+ texture2DCompare( shadowMap, shadowCoord.xy + vec2( pr.x, pr.y ), shadowCoord.z );
			if ( probe < 0.5 || probe > 3.5 ) { shadow = probe * 0.25; } else {
			vec2 tc = floor( shadowCoord.xy * shadowMapSize );
			float ang = 6.2831853 * fract( 52.9829189 * fract( dot( tc, vec2( 0.06711056, 0.00583715 ) ) ) );
			float sa = sin( ang ), ca = cos( ang );
			float sum = 0.0;
			for ( int i = 0; i < 12; i ++ ) {
				float r = sqrt( ( float( i ) + 0.5 ) / 12.0 );
				float th = float( i ) * 2.39996323;
				vec2 o = vec2( cos( th ), sin( th ) ) * r;
				o = vec2( ca * o.x - sa * o.y, sa * o.x + ca * o.y );
				sum += texture2DCompare( shadowMap, shadowCoord.xy + o * shadowRadius * texelSize, shadowCoord.z );
			}
			shadow = sum / 12.0;
			}
		`;
  SHADOW_PARS = (a > 0 && b > a) ? src.slice(0, a) + pcf + src.slice(b) : src;
  return SHADOW_PARS;
}

/* ---------------- room shell + furniture builders ---------------- */
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function metreUV(geo, sx, sy, swap) {     /* PlaneGeometry uv (0..1) -> metres (swap: planks run along local y) */
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * sx, v = uv.getY(i) * sy;
    if (swap) uv.setXY(i, v, u); else uv.setXY(i, u, v);
  }
  return geo;
}

const seg = (len, step = 0.12) => Math.max(1, Math.min(96, Math.ceil(len / step)));
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const DVInterior = { mount, rooms: ROOMS.slice() };
if (typeof window !== 'undefined') window.DVInterior = DVInterior;

function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  const S = {
    room: ROOMS.includes(opts.room) ? opts.room : 'living',
    colors: normColors(opts.colors), grain: clamp(+opts.grain || 1, 0.6, 1.8),
    density: opts.density == null ? 0.92 : clamp(+opts.density, 0.4, 1), seed: opts.seed == null ? 11 : +opts.seed,
    textureUrl: opts.textureUrl || null, textureSize: +opts.textureSize || 0.6, drift: opts.drift !== false
  };
  const small = isSmallScreen();
  let T, R, baker, scene, camera, roomGroup, sun, vignette, probe, M = {}, U, rig = null, coatA, coatB, palette;
  let tiles = { cur: null, next: null }, wipe = null, built = null, envRT = null, coatTok = 0;

  const stage = createStage(el, {
    poster: opts.poster === false ? null : (opts.poster || posterOf(S.room)), label: LABEL[LANG][S.room], className: 'dv3d--interior',
    build, update, render, resize, scene: () => scene, camera: () => camera,
    continuous: () => !!wipe, dispose
  });

  /* ---------- build ---------- */
  async function build(st) {
    T = st.THREE; R = st.renderer;
    R.toneMapping = T.NeutralToneMapping; R.toneMappingExposure = 1.0;
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFShadowMap; R.shadowMap.autoUpdate = false;
    baker = createBaker(T, R);
    scene = new T.Scene(); scene.background = new T.Color(0x0f0e0c);
    camera = new T.PerspectiveCamera(45, st.w / st.h, 0.05, 60);
    camera.rotation.order = 'YXZ';
    U = {
      roomMin: { value: new T.Vector3() }, roomMax: { value: new T.Vector3() },
      win: { value: new T.Vector4(0, 1.3, 0, 3) }, winK: { value: new T.Vector2(0.72, 0.55) }, coatBias: { value: 0.4 }, wipe: { value: 2 }, wipeAxis: { value: new T.Vector3(1, 0, 0) }, wipeRange: { value: new T.Vector2(-3, 3) }
    };
    makeMaterials();
    sun = new T.DirectionalLight(0xfff0dc, 3.2);
    sun.castShadow = true;
    const ms = small ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms); sun.shadow.radius = small ? 3 : 4.5;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    probe = new T.LightProbe(); scene.add(probe);
    roomGroup = new T.Group(); scene.add(roomGroup);
    vignette = makeVignette(); scene.add(vignette);
    coatA = new T.Mesh(new T.PlaneGeometry(1, 1), M.coatA); coatA.receiveShadow = true;
    coatB = new T.Mesh(new T.PlaneGeometry(1, 1), M.coatB); coatB.receiveShadow = true; coatB.visible = false;
    try { tiles.cur = await coatTiles(); }
    catch (e) { console.warn('[dvatone 3d] texture not loaded, using the procedural coating:', S.textureUrl); S.textureUrl = null; tiles.cur = await coatTiles(); }
    applyTiles(M.coatA, tiles.cur);
    applyTiles(M.coatB, tiles.cur);
    buildRoom(S.room);
    /* precompile every material variant once (rooms share them), so room switches never stall:
       a tiny hidden mesh per material sits under the floor until the first frame */
    palette = new T.Group(); palette.position.set(0, -50, 0);
    const pg = new T.PlaneGeometry(0.01, 0.01);
    Object.values(M).forEach(m => { if (m && m.isMaterial) palette.add(new T.Mesh(pg, m)); });
    const leaf = new T.InstancedMesh(pg, M.leaf, 1); leaf.setMatrixAt(0, new T.Matrix4()); palette.add(leaf);
    scene.add(palette);
  }

  function bakeTex(frag, size, base, both, aniso) {
    const u = { uPass: { value: 0 }, uBase: { value: new T.Color(base || '#ffffff') }, uOne: { value: 1 }, uOct: { value: 5 } };
    const mat = baker.shader(frag, u);
    let albedo = null;
    if (both) { albedo = baker.target(size, size, { srgb: true, aniso }); baker.run(mat, albedo); }
    const data = baker.target(size, size, { aniso }); u.uPass.value = 1; baker.run(mat, data);
    mat.dispose();
    return { albedo: albedo && albedo.texture, data: data.texture };
  }

  /* mode 'vertex': ambient occlusion (room corners, furniture, window falloff) baked per vertex at build time
     on finely subdivided room surfaces; mode 'room': cheap per-pixel room term for furniture */
  function aoPatch(mat, mode, extra, coat) {
    const vert = mode === 'vertex';
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, {
        uRoomMin: U.roomMin, uRoomMax: U.roomMax, uWin: U.win, uWinK: U.winK,
        uWipe: U.wipe, uWipeAxis: U.wipeAxis, uWipeRange: U.wipeRange
      });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;' + (vert ? '\nattribute float dvao;\nvarying float vDvao;' : ''))
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n{ vec4 dvW = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n dvW = instanceMatrix * dvW;\n#endif\n vWPos = (modelMatrix * dvW).xyz; }' + (vert ? '\nvDvao = dvao;' : ''));
      let f = sh.fragmentShader
        .replace('#include <shadowmap_pars_fragment>', shadowPars(T))
        .replace('#include <lights_fragment_maps>', T.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', ''))
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\n' + (vert ? 'varying float vDvao;\n' : '') + 'uniform float uWipe; uniform vec3 uWipeAxis; uniform vec2 uWipeRange;\n' + AO_GLSL)
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float dvAO = ' + (vert ? 'vDvao' : 'dvRoomAO(vWPos, inverseTransformDirection(normal, viewMatrix))') + ';\n reflectedLight.indirectDiffuse *= dvAO; reflectedLight.indirectSpecular *= mix(1.0, dvAO, 0.85); }');
      if (coat) {
        const C = T.ShaderChunk, B = ', uCoatBias )';
        f = f.replace('#include <common>', '#include <common>\nuniform float uCoatBias; uniform float uDeLight; uniform float uLowLod;\n' + NOTILE_GLSL)
          .replace('#include <map_fragment>', C.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv' + B)
            /* client textures: no visible repetition over a long wall, and no lighting gradients from the scan */
            .replace('diffuseColor *= sampledDiffuseColor;', 'if ( uDeLight > 0.5 ) { sampledDiffuseColor = dvNoTile( map, vMapUv, uCoatBias ); vec3 dvLo = textureLod( map, vMapUv, uLowLod ).rgb; vec3 dvMean = textureLod( map, vec2( 0.5 ), 16.0 ).rgb; sampledDiffuseColor.rgb *= dvMean / max( dvLo, vec3( 1e-3 ) ); }\n\tdiffuseColor *= sampledDiffuseColor;'))
          .replace('#include <roughnessmap_fragment>', C.roughnessmap_fragment.replace('texture2D( roughnessMap, vRoughnessMapUv )', 'texture2D( roughnessMap, vRoughnessMapUv' + B))
          .replace('#include <metalnessmap_fragment>', C.metalnessmap_fragment.replace('texture2D( metalnessMap, vMetalnessMapUv )', 'texture2D( metalnessMap, vMetalnessMapUv' + B))
          .replace('#include <bumpmap_pars_fragment>', C.bumpmap_pars_fragment.split('texture2D( bumpMap, vBumpMapUv )').join('texture2D( bumpMap, vBumpMapUv' + B)
            .split('texture2D( bumpMap, vBumpMapUv + dSTdx )').join('texture2D( bumpMap, vBumpMapUv + dSTdx' + B).split('texture2D( bumpMap, vBumpMapUv + dSTdy )').join('texture2D( bumpMap, vBumpMapUv + dSTdy' + B));
        sh.uniforms.uCoatBias = U.coatBias;
        mat.userData.deLight = mat.userData.deLight || { value: 0 }; mat.userData.lowLod = mat.userData.lowLod || { value: 8 };
        sh.uniforms.uDeLight = mat.userData.deLight; sh.uniforms.uLowLod = mat.userData.lowLod;
      }
      if (extra === 'wipe') {
        f = f.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
{ float ax = (dot(vWPos, uWipeAxis) - uWipeRange.x) / (uWipeRange.y - uWipeRange.x);
  float n = sin(vWPos.y * 2.3 + 1.3) * 0.022 + sin(vWPos.y * 6.1 + 0.2) * 0.008;
  float edge = uWipe - (ax + n);
  float a = smoothstep(0.0, 0.11, edge);
  if (a <= 0.001) discard;
  diffuseColor.a *= a; }`);
      }
      sh.fragmentShader = f;
    };
    mat.customProgramCacheKey = () => 'dv-ao-' + mode + (extra || '') + (coat ? 'c' : '');
    return mat;
  }

  function makeMaterials() {
    const oak = bakeTex(OAK_FRAG, 1024, '#cdb08c', true, 16);              /* 2.4 m tile: about 2.3 mm per texel */
    const stone = bakeTex(STONE_FRAG, 512, '#d9ccb6', true, 8);
    const boucle = bakeTex(BOUCLE_FRAG, 512, null, false, 8);
    const linen = bakeTex(LINEN_FRAG, 512, null, false, 8);
    const repAll = (o, m) => { if (o.albedo) o.albedo.repeat.set(1 / m, 1 / m); o.data.repeat.set(1 / m, 1 / m); return o; };
    repAll(oak, 2.4); repAll(stone, 0.9);
    const bou = boucle.data, bouRug = bou.clone(); bou.repeat.set(1 / 0.07, 1 / 0.07); bouRug.repeat.set(1 / 0.16, 1 / 0.16);
    const lin = linen.data; lin.repeat.set(1 / 0.06, 1 / 0.06);
    const std = (o) => new T.MeshStandardMaterial(o);
    M.floor = aoPatch(std({ map: oak.albedo, roughnessMap: oak.data, roughness: 1, bumpMap: oak.data, bumpScale: 0.9, metalness: 0 }), 'vertex');
    M.oak = aoPatch(std({ map: oak.albedo, roughnessMap: oak.data, roughness: 1.05, bumpMap: oak.data, bumpScale: 0.6 }), 'room');
    M.oakDark = aoPatch(std({ map: oak.albedo, color: 0x8f775f, roughnessMap: oak.data, roughness: 1.0, bumpMap: oak.data, bumpScale: 0.6 }), 'room');   /* same oak, darker stain */
    M.plaster = aoPatch(std({ color: 0xece8e1, roughness: 0.96 }), 'vertex');
    M.ceiling = aoPatch(std({ color: 0xf2efea, roughness: 0.97 }), 'vertex');
    M.gap = aoPatch(std({ color: 0x0d0c0b, roughness: 1 }), 'room');
    M.boucle = aoPatch(std({ color: 0xe9e3d8, roughness: 1, bumpMap: bou, bumpScale: 1.6 }), 'room');
    M.boucleSand = aoPatch(std({ color: 0xcfc3ae, roughness: 1, bumpMap: bou, bumpScale: 1.6 }), 'room');
    M.linen = aoPatch(std({ color: 0xe6e0d6, roughness: 1, bumpMap: lin, bumpScale: 0.8 }), 'room');
    M.linenOat = aoPatch(std({ color: 0xd5c9b8, roughness: 1, bumpMap: lin, bumpScale: 0.8 }), 'room');
    M.throw = aoPatch(std({ color: 0x8c6656, roughness: 1, bumpMap: lin, bumpScale: 1.2 }), 'room');
    M.rug = aoPatch(std({ color: 0xd3cabd, roughness: 1, bumpMap: bouRug, bumpScale: 2.2 }), 'vertex');
    M.stone = aoPatch(std({ map: stone.albedo, roughnessMap: stone.data, roughness: 1, bumpMap: stone.data, bumpScale: 0.22 }), 'room');
    M.ceramic = aoPatch(std({ color: 0xe8e3db, roughness: 0.42 }), 'room');
    M.clay = aoPatch(std({ color: 0xb9a48c, roughness: 0.85 }), 'room');
    M.black = aoPatch(std({ color: 0x1a1918, roughness: 0.45, metalness: 0.55 }), 'room');
    M.copper = aoPatch(std({ color: new T.Color().setRGB(0.64, 0.37, 0.18, T.LinearSRGBColorSpace), metalness: 1, roughness: 0.27 }), 'room');
    M.shade = aoPatch(std({ color: 0xefe9df, roughness: 0.95, side: T.DoubleSide }), 'room');
    M.wood = aoPatch(std({ color: 0x5b4a3a, roughness: 0.9 }), 'room');
    M.leaf = aoPatch(std({ color: 0x7c8466, roughness: 0.72, side: T.DoubleSide }), 'room');
    M.bookA = aoPatch(std({ color: 0xcfc2ad, roughness: 0.8 }), 'room'); M.bookB = aoPatch(std({ color: 0x2a2826, roughness: 0.7 }), 'room'); M.paper = aoPatch(std({ color: 0xf2eee6, roughness: 0.9 }), 'room');
    M.glow = new T.MeshBasicMaterial({ color: new T.Color().setRGB(3.2, 2.5, 1.7, T.LinearSRGBColorSpace) });
    M.sky = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
    M.curtain = std({ color: 0xf6f2ec, roughness: 1, transparent: true, opacity: 0.5, side: T.DoubleSide, emissive: new T.Color(0xfff4e8), emissiveIntensity: 0.95, depthWrite: false });
    M.coatA = aoPatch(std({ roughness: 1, metalness: 1, bumpScale: 0.3 }), 'vertex', '', true);
    M.coatB = aoPatch(std({ roughness: 1, metalness: 1, bumpScale: 0.3, transparent: true }), 'vertex', 'wipe', true);
  }

  function applyTiles(mat, tl) {
    mat.map = tl.albedo; mat.roughnessMap = tl.data; mat.metalnessMap = tl.data; mat.bumpMap = tl.data;
    mat.roughness = tl.flat ? 0.88 : 1; mat.metalness = tl.flat ? 0 : 1;
    mat.userData.deLight = mat.userData.deLight || { value: 0 }; mat.userData.lowLod = mat.userData.lowLod || { value: 8 };
    mat.userData.deLight.value = tl.flat ? 1 : 0;
    if (tl.flat && tl.albedo.image) mat.userData.lowLod.value = Math.max(2, Math.log2(Math.max(tl.albedo.image.width, tl.albedo.image.height)) - 2.6);
    mat.bumpScale = tl.flat ? 0 : 0.3;
    const mh = tl.metres * (tl.aspect || 1);
    [tl.albedo, tl.data].forEach(t => t.repeat.set(1 / tl.metres, 1 / mh));
  }

  async function coatTiles() {
    if (S.textureUrl) {
      const tex = await new Promise((res, rej) => new T.TextureLoader().load(S.textureUrl, res, undefined, rej));
      tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.anisotropy = Math.min(8, baker.maxAniso);
      const flat = new T.DataTexture(new Uint8Array([128, 255, 0, 255]), 1, 1); flat.needsUpdate = true;
      flat.wrapS = flat.wrapT = T.RepeatWrapping;
      const asp = tex.image && tex.image.width ? tex.image.height / tex.image.width : 1;   /* non-square textures keep their proportions */
      return { albedo: tex, data: flat, metres: S.textureSize, aspect: asp, flat: true, dispose() { tex.dispose(); flat.dispose(); } };
    }
    const b = bakeGranules(T, baker, { colors: S.colors, density: S.density, seed: S.seed, size: 1024, cells: 128 });
    b.metres = b.cells * CELL_M * S.grain;
    return b;
  }

  function makeVignette() {
    const m = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({
      uniforms: { uS: { value: 0.32 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'varying vec2 vUv; uniform float uS; void main(){ vec2 d = (vUv - 0.5) * vec2(1.0, 0.8); float v = smoothstep(0.28, 0.85, length(d) * 1.35); gl_FragColor = vec4(0.0, 0.0, 0.0, v * uS); }',
      transparent: true, depthTest: false, depthWrite: false
    }));
    m.frustumCulled = false; m.renderOrder = 9999;
    return m;
  }

  /* ---------- room construction ---------- */
  function clearRoom() {
    if (!roomGroup) return;
    roomGroup.traverse(o => { if (o.geometry && o !== coatA && o !== coatB) o.geometry.dispose(); });
    roomGroup.clear();
    if (envRT) { envRT.dispose(); envRT = null; }
  }

  function buildRoom(name) {
    clearRoom();
    const ctx = makeCtx();
    const def = (name === 'bedroom' ? bedroom : name === 'hallway' ? hallway : living)(ctx);
    built = def;
    /* AO uniforms */
    U.roomMin.value.copy(def.min); U.roomMax.value.copy(def.max);
    /* feature wall coats */
    const fw = def.feature;
    [coatA, coatB].forEach((m, i) => {
      /* a few cm larger than the wall: the junctions are then resolved by depth (clean, anti-aliased edges) */
      m.geometry.dispose(); m.geometry = metreUV(new T.PlaneGeometry(fw.w + 0.1, fw.h + 0.1, seg(fw.w + 0.1), seg(fw.h + 0.1)), fw.w + 0.1, fw.h + 0.1);
      m.userData.shell = true;
      m.position.copy(fw.pos).addScaledVector(fw.normal, i ? 0.0012 : 0);
      m.rotation.set(0, fw.ry, 0);
      roomGroup.add(m);
    });
    U.wipeAxis.value.copy(fw.axis);
    const c = fw.pos.dot(fw.axis); U.wipeRange.value.set(c - fw.w / 2, c + fw.w / 2);
    /* sun */
    const center = def.min.clone().add(def.max).multiplyScalar(0.5);
    sun.position.copy(center).addScaledVector(def.sun.dir, -18);
    sun.target.position.copy(center);
    sun.intensity = def.sun.intensity; sun.color.set(def.sun.color || 0xfff0dc);
    const ext = def.min.distanceTo(def.max) * 0.52;
    U.win.value.set(def.win[0], def.win[1], def.win[2], def.win[3]);
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 4, far: 36 });
    sun.shadow.camera.updateProjectionMatrix();
    R.shadowMap.needsUpdate = true;
    /* environment */
    envRT = makeEnv(def);
    GLOSSY.forEach(k => { M[k].envMap = envRT.texture; M[k].envMapIntensity = def.envIntensity || 1; });
    probe.sh.copy(envSH(def.env)); probe.intensity = def.envIntensity || 1;
    bakeVertexAO(def, ctx.boxes);
    rig = def.cam;
    stage.wrap.setAttribute('aria-label', LABEL[LANG][name]);
    resize(stage.w, stage.h);
  }

  /* per-vertex ambient occlusion for the room shell (same model the shaders used per pixel, now computed once) */
  function bakeVertexAO(def, boxes) {
    roomGroup.updateMatrixWorld(true);
    const p = new T.Vector3(), n = new T.Vector3(), nm = new T.Matrix3(), mn = def.min, mx = def.max, w = def.win, K = U.winK.value;
    const edge = d => 0.52 + 0.48 * sstep(0, 0.7, Math.max(d, 0));
    const bx = boxes.map(b => ({ min: b.min, max: b.max, c: b.min.clone().add(b.max).multiplyScalar(0.5), e: b.max.clone().sub(b.min).multiplyScalar(0.5) }));
    roomGroup.traverse(o => {
      if (!o.isMesh || !o.userData.shell) return;
      const g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, ao = new Float32Array(pos.count);
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        let a = (n.x > 0.7 ? 1 : edge(p.x - mn.x)) * (n.x < -0.7 ? 1 : edge(mx.x - p.x)) * (n.y > 0.7 ? 1 : edge(p.y - mn.y))
              * (n.y < -0.7 ? 1 : edge(mx.y - p.y)) * (n.z > 0.7 ? 1 : edge(p.z - mn.z)) * (n.z < -0.7 ? 1 : edge(mx.z - p.z));
        const dw = Math.hypot(p.x - w[0], p.y - w[1], p.z - w[2]) / w[3];
        a *= K.x + K.y * Math.exp(-dw * dw);
        for (const b of bx) {
          const qx = Math.abs(p.x - b.c.x) - b.e.x, qy = Math.abs(p.y - b.c.y) - b.e.y, qz = Math.abs(p.z - b.c.z) - b.e.z;
          const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
          const r = 0.18 + 0.28 * Math.min(1, Math.max(0, Math.min(b.e.x, b.e.y, b.e.z) * 3));
          if (d > r) continue;
          const dx = Math.min(Math.max(p.x, b.min.x), b.max.x) - p.x + n.x * 0.02;
          const dy = Math.min(Math.max(p.y, b.min.y), b.max.y) - p.y + n.y * 0.02 + 1e-4;
          const dz = Math.min(Math.max(p.z, b.min.z), b.max.z) - p.z + n.z * 0.02;
          const l = Math.hypot(dx, dy, dz) || 1;
          const facing = Math.min(1, Math.max(0, (n.x * dx + n.y * dy + n.z * dz) / l * 0.5 + 0.55));
          a *= 1 - 0.7 * facing * (1 - sstep(0, r, Math.max(d, 0)));
        }
        ao[i] = a;
      }
      g.setAttribute('dvao', new T.BufferAttribute(ao, 1));
    });
  }

  function makeCtx() {
    const boxes = [];
    const add = (geo, mat, x = 0, y = 0, z = 0, o = {}) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (o.ry) m.rotation.y = o.ry; if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz;
      m.castShadow = o.cast !== false; m.receiveShadow = o.receive !== false;
      if (o.shell) m.userData.shell = true;
      (o.parent || roomGroup).add(m);
      return m;
    };
    const box = (min, max) => boxes.push({ min: new T.Vector3(...min), max: new T.Vector3(...max) });
    const rb = (w, h, d, r, bulge) => roundedBox(T, w, h, d, r, 3, bulge || 0);
    return { add, box, boxes, rb, rnd: mulberry(7) };
  }

  /* walls with optional window openings: wall = { axis:'x'|'z', at, from, to, normal sign } */
  function shell(ctx, o) {
    const { W, D, H } = o; const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
    const fl = new T.PlaneGeometry(W, D, seg(W), seg(D)); metreUV(fl, W, D, true);
    ctx.add(fl, M.floor, 0, 0, 0, { rx: -Math.PI / 2, cast: false, shell: true });
    const ce = new T.BoxGeometry(W + 1.2, 0.3, D + 1.2, seg(W + 1.2, 0.2), 1, seg(D + 1.2, 0.2)); metreUV(ce, W, D);
    ctx.add(ce, M.ceiling, 0, H + 0.15, 0, { receive: false, shell: true });
    const T2 = 0.24;   /* wall thickness for reveals */
    const walls = {
      back: { len: W, c: [0, z0], ry: 0, n: [0, 1] }, front: { len: W, c: [0, z1], ry: Math.PI, n: [0, -1] },
      left: { len: D, c: [x0, 0], ry: Math.PI / 2, n: [1, 0] }, right: { len: D, c: [x1, 0], ry: -Math.PI / 2, n: [-1, 0] }
    };
    Object.entries(walls).forEach(([k, w]) => {
      if (k === o.feature) return;
      const win = (o.windows || []).filter(v => v.wall === k);
      if (!win.length) {
        const g = new T.PlaneGeometry(w.len, H, seg(w.len), seg(H)); metreUV(g, w.len, H);
        ctx.add(g, M.plaster, w.c[0], H / 2, w.c[1], { ry: w.ry, shell: true, receive: false });
        gapStrip(ctx, w, H);
        return;
      }
      /* wall with one opening, built from thick boxes so the sun passes only through the glazing */
      const v = win[0];
      const segs = [
        { a0: -w.len / 2 - T2, a1: v.a0, y0: 0, y1: H + 0.3 }, { a0: v.a1, a1: w.len / 2 + T2, y0: 0, y1: H + 0.3 },
        { a0: v.a0, a1: v.a1, y0: v.y1, y1: H + 0.3 }, { a0: v.a0, a1: v.a1, y0: 0, y1: v.y0 }
      ].filter(s => s.a1 - s.a0 > 0.001 && s.y1 - s.y0 > 0.001);
      segs.forEach(s => {
        const len = s.a1 - s.a0, hh = s.y1 - s.y0;
        const g = new T.BoxGeometry(len, hh, T2, seg(len), seg(hh), 2); metreUV(g, len, hh);
        const mid = (s.a0 + s.a1) / 2;
        const p = wallPoint(w, mid, -T2 / 2);
        ctx.add(g, M.plaster, p[0], (s.y0 + s.y1) / 2, p[1], { ry: w.ry, shell: true, receive: false });
      });
      gapStrip(ctx, w, H, v);
      windowFrame(ctx, w, v, T2);
      exterior(ctx, w, v);
      if (v.curtain) curtain(ctx, w, v);
    });
    /* feature wall gap strip */
    const f = walls[o.feature]; gapStrip(ctx, f, H, null, 0.0025);
    return walls;
  }
  function wallPoint(w, a, off) {    /* point on a wall line at coordinate a along it, offset off along its normal */
    if (w.ry === 0) return [a, w.c[1] + w.n[1] * off];
    if (w.ry === Math.PI) return [-a, w.c[1] + w.n[1] * off];
    if (w.ry === Math.PI / 2) return [w.c[0] + w.n[0] * off, -a];
    return [w.c[0] + w.n[0] * off, a];
  }
  function gapStrip(ctx, w, H, win, lift = 0.0015) {  /* minimalist shadow-gap skirting */
    const pieces = win && win.y0 < 0.01 ? [[-w.len / 2, win.a0], [win.a1, w.len / 2]] : [[-w.len / 2, w.len / 2]];
    pieces.forEach(([a0, a1]) => {
      if (a1 - a0 < 0.01) return;
      const g = new T.PlaneGeometry(a1 - a0, 0.018);
      const p = wallPoint(w, (a0 + a1) / 2, lift);
      ctx.add(g, M.gap, p[0], 0.009, p[1], { ry: w.ry, cast: false });
    });
  }
  function windowFrame(ctx, w, v, T2) {
    const fw = 0.045, depth = 0.07, inset = -T2 * 0.55;
    const len = v.a1 - v.a0, hh = v.y1 - v.y0, midA = (v.a0 + v.a1) / 2, midY = (v.y0 + v.y1) / 2;
    const bars = [
      { a: v.a0 + fw / 2, y: midY, w: fw, h: hh }, { a: v.a1 - fw / 2, y: midY, w: fw, h: hh },
      { a: midA, y: v.y1 - fw / 2, w: len, h: fw }, { a: midA, y: v.y0 + fw / 2, w: len, h: fw }
    ];
    for (let i = 1; i < (v.panes || 3); i++) bars.push({ a: v.a0 + len * i / (v.panes || 3), y: midY, w: 0.035, h: hh });
    if (v.transom) bars.push({ a: midA, y: v.transom, w: len, h: 0.035 });
    bars.forEach(b => {
      const p = wallPoint(w, b.a, inset);
      ctx.add(new T.BoxGeometry(b.w, b.h, depth), M.black, p[0], b.y, p[1], { ry: w.ry });
    });
  }
  function exterior(ctx, w, v) {
    const len = (v.a1 - v.a0) + 3, hh = (v.y1 - v.y0) + 2.5;
    const g = new T.PlaneGeometry(len, hh, 1, 4);
    const col = []; const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) / hh) + 0.5;      /* 0 bottom .. 1 top */
      const k = 0.6 + 0.4 * smooth(clamp(t * 1.15, 0, 1));
      col.push(9 * k * 1.0, 9 * k * 0.99, 9 * k * (0.93 + 0.07 * t));
    }
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    const p = wallPoint(w, (v.a0 + v.a1) / 2, -1.6);
    ctx.add(g, M.sky, p[0], (v.y0 + v.y1) / 2 + 0.6, p[1], { ry: w.ry, cast: false, receive: false });
  }
  function curtain(ctx, w, v) {
    const cw = v.curtain.w, ch = v.y1 - 0.04;
    const g = new T.PlaneGeometry(cw, ch, 96, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); pos.setZ(i, Math.sin(x * 34) * 0.035 + Math.sin(x * 13 + 1) * 0.02); }
    g.computeVertexNormals();
    const a = v.curtain.side < 0 ? v.a0 + cw / 2 - 0.05 : v.a1 - cw / 2 + 0.05;
    const p = wallPoint(w, a, 0.14);
    ctx.add(g, M.curtain, p[0], ch / 2 + 0.02, p[1], { ry: w.ry, cast: false });
  }

  /* furniture pieces */
  function sofa(ctx, cx, cz, ry = 0, len = 2.7) {
    const g = new T.Group(); g.position.set(cx, 0, cz); g.rotation.y = ry; roomGroup.add(g);
    const o = { parent: g };
    ctx.add(new T.BoxGeometry(len - 0.2, 0.06, 0.84), M.gap, 0, 0.03, 0.02, o);
    ctx.add(ctx.rb(len, 0.2, 1.0, 0.04), M.boucle, 0, 0.16, 0, o);
    const half = (len - 0.44) / 2;
    [-1, 1].forEach(s => {
      ctx.add(ctx.rb(half - 0.01, 0.17, 0.8, 0.07, 0.016), M.boucle, s * (half / 2 + 0.005), 0.345, 0.08, o);
      ctx.add(ctx.rb(half - 0.01, 0.5, 0.22, 0.09, 0.02), M.boucle, s * (half / 2 + 0.005), 0.53, -0.33, { parent: g, rx: -0.11 });
      ctx.add(ctx.rb(0.22, 0.38, 1.0, 0.07, 0.006), M.boucle, s * (len / 2 - 0.11), 0.44, 0, o);
    });
    ctx.add(ctx.rb(len - 0.06, 0.4, 0.16, 0.05), M.boucle, 0, 0.45, -0.42, o);
    ctx.add(ctx.rb(0.5, 0.44, 0.15, 0.08, 0.035), M.boucleSand, -half + 0.22, 0.6, -0.16, { parent: g, rx: -0.22, rz: 0.06, ry: 0.15 });
    ctx.add(ctx.rb(0.44, 0.4, 0.14, 0.08, 0.035), M.linenOat, -half + 0.62, 0.58, -0.17, { parent: g, rx: -0.2, rz: -0.05 });
    const wp = new T.Vector3(cx, 0, cz);
    const ex = Math.abs(Math.cos(ry)) * len / 2 + Math.abs(Math.sin(ry)) * 0.5, ez = Math.abs(Math.sin(ry)) * len / 2 + Math.abs(Math.cos(ry)) * 0.5;
    ctx.box([wp.x - ex, 0, wp.z - ez], [wp.x + ex, 0.78, wp.z + ez]);
    return g;
  }
  function armchair(ctx, x, z, ry) {
    const g = new T.Group(); g.position.set(x, 0, z); g.rotation.y = ry; roomGroup.add(g);
    const o = { parent: g };
    ctx.add(new T.BoxGeometry(0.6, 0.05, 0.6), M.gap, 0, 0.025, 0, o);
    ctx.add(ctx.rb(0.84, 0.36, 0.84, 0.14, 0.02), M.boucle, 0, 0.23, 0, o);
    ctx.add(ctx.rb(0.84, 0.44, 0.24, 0.12, 0.02), M.boucle, 0, 0.6, -0.3, { parent: g, rx: -0.12 });
    [-1, 1].forEach(s => ctx.add(ctx.rb(0.2, 0.24, 0.78, 0.09, 0.01), M.boucle, s * 0.34, 0.5, 0.02, o));
    ctx.add(ctx.rb(0.5, 0.42, 0.14, 0.08, 0.035), M.linenOat, 0.04, 0.6, -0.12, { parent: g, rx: -0.35 });
    ctx.box([x - 0.5, 0, z - 0.5], [x + 0.5, 0.8, z + 0.5]);
  }
  function vaseBranches(ctx, x, z, h, seed, scale = 1) {
    const prof = [[0, 0], [0.09, 0], [0.12, 0.05], [0.135, 0.18], [0.12, 0.34], [0.07, 0.48], [0.055, 0.53], [0.06, 0.56], [0.0, 0.56]]
      .map(([r, y]) => new T.Vector2(r * scale, y * scale));
    ctx.add(new T.LatheGeometry(prof, 48), M.clay, x, 0, z);
    const rnd = mulberry(seed);
    const top = new T.Vector3(x, 0.55 * scale, z);
    const leaves = [];
    for (let b = 0; b < 4; b++) {
      const ang = rnd() * Math.PI * 2, lean = 0.12 + rnd() * 0.28, len = h * (0.65 + rnd() * 0.45);
      const pts = []; const dir = new T.Vector3(Math.cos(ang) * lean, 1, Math.sin(ang) * lean).normalize();
      const bend = new T.Vector3(Math.cos(ang + 1.3) * 0.15, 0, Math.sin(ang + 1.3) * 0.15);
      for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push(top.clone().addScaledVector(dir, len * t).addScaledVector(bend, t * t * len * 0.6)); }
      const curve = new T.CatmullRomCurve3(pts);
      ctx.add(new T.TubeGeometry(curve, 24, 0.0055 * (1 - b * 0.12), 5, false), M.wood, 0, 0, 0);
      for (let s = 0; s < 3; s++) {
        const t0 = 0.35 + rnd() * 0.5, p0 = curve.getPoint(t0);
        const sd = new T.Vector3(Math.cos(ang + (rnd() - 0.5) * 2.4), 0.6 + rnd() * 0.6, Math.sin(ang + (rnd() - 0.5) * 2.4)).normalize();
        const sl = 0.12 + rnd() * 0.22;
        const c2 = new T.CatmullRomCurve3([p0, p0.clone().addScaledVector(sd, sl * 0.5), p0.clone().addScaledVector(sd, sl).add(new T.Vector3(0, -0.03, 0))]);
        ctx.add(new T.TubeGeometry(c2, 8, 0.0028, 4, false), M.wood, 0, 0, 0);
        for (let k = 0; k < 13; k++) leaves.push({ c: c2, t: 0.12 + k * 0.068 + rnd() * 0.03 });
      }
      for (let k = 0; k < 20; k++) leaves.push({ c: curve, t: 0.28 + k * 0.036 + rnd() * 0.02 });
    }
    const lg = new T.ShapeGeometry(new T.Shape().moveTo(0, 0).quadraticCurveTo(0.012, 0.035, 0, 0.075).quadraticCurveTo(-0.012, 0.035, 0, 0), 3);
    const im = new T.InstancedMesh(lg, M.leaf, leaves.length);
    const q = new T.Quaternion(), e = new T.Euler(), mtx = new T.Matrix4(), sc = new T.Vector3();
    leaves.forEach((l, i) => {
      const p = l.c.getPoint(Math.min(1, l.t));
      e.set(rnd() * 1.4 - 0.3, rnd() * Math.PI * 2, (rnd() - 0.5) * 2.2); q.setFromEuler(e);
      const s = 0.95 + rnd() * 0.55; sc.set(s, s, s);
      mtx.compose(p, q, sc); im.setMatrixAt(i, mtx);
    });
    im.castShadow = true; im.receiveShadow = true; roomGroup.add(im);
  }
  function floorLamp(ctx, x, z) {
    ctx.add(new T.CylinderGeometry(0.15, 0.15, 0.02, 48), M.black, x, 0.01, z);
    ctx.add(new T.CylinderGeometry(0.009, 0.009, 1.5, 12), M.black, x, 0.77, z);
    ctx.add(new T.CylinderGeometry(0.2, 0.2, 0.34, 64, 1, true), M.shade, x, 1.62, z);
  }
  function books(ctx, x, y, z, ry) {
    const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry; roomGroup.add(g);
    ctx.add(new T.BoxGeometry(0.32, 0.034, 0.24), M.bookA, 0, 0.017, 0, { parent: g });
    ctx.add(new T.BoxGeometry(0.315, 0.026, 0.235), M.paper, 0.004, 0.017, 0, { parent: g, cast: false });
    ctx.add(new T.BoxGeometry(0.27, 0.03, 0.2), M.bookB, 0.01, 0.049, 0.008, { parent: g, ry: 0.12 });
  }
  function bowl(ctx, x, y, z, r = 0.16) {
    const prof = [[0, 0], [r * 0.45, 0], [r * 0.8, r * 0.18], [r, r * 0.42], [r * 0.97, r * 0.44], [r * 0.76, r * 0.24], [r * 0.4, r * 0.08], [0, r * 0.07]]
      .map(([a, b]) => new T.Vector2(a, b));
    ctx.add(new T.LatheGeometry(prof, 48), M.ceramic, x, y, z);
  }

  /* ---------- rooms ---------- */
  function living(ctx) {
    const W = 6.2, D = 5.4, H = 2.9;
    shell(ctx, { W, D, H, feature: 'back', windows: [{ wall: 'left', a0: -0.9, a1: 1.9, y0: 0, y1: 2.6, panes: 4, transom: 2.15, curtain: { w: 0.75, side: -1 } }] });
    ctx.add(roundedBox(T, 3.3, 0.014, 2.4, 0.006, 14), M.rug, 0.3, 0.007, -1.05, { cast: false, shell: true });
    sofa(ctx, 0.3, -2.12);
    ctx.add(new T.BoxGeometry(0.86, 0.04, 0.44), M.gap, 0.3, 0.02, -0.98);
    ctx.add(ctx.rb(1.1, 0.3, 0.62, 0.035), M.stone, 0.3, 0.19, -0.98);
    ctx.box([-0.25, 0, -1.29], [0.85, 0.34, -0.67]);
    bowl(ctx, 0.58, 0.34, -0.95, 0.14);
    books(ctx, 0.05, 0.34, -1.02, 0.25);
    armchair(ctx, -2.0, -1.15, 1.15);
    floorLamp(ctx, 2.2, -2.32);
    ctx.box([2.05, 0, -2.47], [2.35, 1.8, -2.17]);
    vaseBranches(ctx, -2.4, -1.85, 1.15, 21);
    ctx.box([-2.55, 0, -2.0], [-2.25, 0.56, -1.7]);
    /* low oak sideboard on the right wall */
    ctx.add(ctx.rb(0.42, 0.46, 2.0, 0.012), M.oak, 3.1 - 0.23, 0.25, 0.25);
    ctx.add(new T.BoxGeometry(0.36, 0.02, 1.9), M.gap, 3.1 - 0.23, 0.01, 0.25);
    ctx.box([2.67, 0, -0.75], [3.1, 0.48, 1.25]);
    bowl(ctx, 2.88, 0.48, 0.75, 0.12);
    books(ctx, 2.86, 0.48, -0.15, 1.4);
    return {
      min: new T.Vector3(-W / 2, 0, -D / 2), max: new T.Vector3(W / 2, H, D / 2),
      feature: { pos: new T.Vector3(0, H / 2, -D / 2), w: W, h: H, ry: 0, normal: new T.Vector3(0, 0, 1), axis: new T.Vector3(1, 0, 0) },
      sun: { dir: new T.Vector3(0.82, -0.42, -0.4).normalize(), intensity: 8.5 }, win: [-3.1, 1.4, -0.5, 4.2],
      env: { win: 'left', W, D, H }, envIntensity: 1.0,
      cam: { pos: new T.Vector3(1.0, 1.3, 2.4), look: new T.Vector3(-0.35, 1.25, -2.7), vfov: 44, frameW: 4.6, shift: -0.05,
        sway: 0.32, push: 0.85, lookSway: 0.18, T1: 34, T2: 46,
        portrait: { pos: new T.Vector3(0.45, 1.25, 2.5), look: new T.Vector3(0.05, 1.15, -2.7), frameW: 3.3, sway: 0.2, push: 0.6, shift: -0.08 } }
    };
  }
  function bedroom(ctx) {
    const W = 5.2, D = 4.9, H = 2.8;
    shell(ctx, { W, D, H, feature: 'back', windows: [{ wall: 'right', a0: -1.85, a1: 0.75, y0: 0.38, y1: 2.5, panes: 3, transom: 2.05, curtain: { w: 0.8, side: 1 } }] });
    const bx = -0.2, bz = -2.45 + 0.06 + 1.08;
    ctx.add(roundedBox(T, 3.0, 0.014, 3.1, 0.006, 14), M.rug, bx, 0.007, bz + 0.25, { cast: false, shell: true });
    ctx.add(new T.BoxGeometry(1.8, 0.06, 2.0), M.gap, bx, 0.03, bz);
    ctx.add(ctx.rb(2.0, 0.22, 2.16, 0.025), M.oak, bx, 0.17, bz);
    ctx.add(ctx.rb(1.82, 0.2, 2.02, 0.06), M.linen, bx, 0.38, bz);
    ctx.add(ctx.rb(2.02, 0.3, 1.5, 0.12, 0.03), M.linenOat, bx, 0.39, bz + 0.3);
    ctx.add(ctx.rb(2.0, 0.07, 0.3, 0.035, 0.012), M.linen, bx, 0.555, bz - 0.38, { rx: 0.05 });
    ctx.add(ctx.rb(1.98, 0.05, 0.5, 0.025, 0.01), M.throw, bx, 0.56, bz + 0.68);
    [-1, 1].forEach(s => {
      ctx.add(ctx.rb(0.76, 0.5, 0.17, 0.1, 0.04), M.linen, bx + s * 0.43, 0.7, -2.45 + 0.22, { rx: -0.22 });
      ctx.add(ctx.rb(0.56, 0.38, 0.15, 0.08, 0.035), M.linenOat, bx + s * 0.36, 0.64, -2.45 + 0.42, { rx: -0.3, rz: s * 0.04 });
      const nx = bx + s * 1.36;
      ctx.add(new T.CylinderGeometry(0.24, 0.24, 0.48, 64), M.stone, nx, 0.24, -2.45 + 0.32);
      ctx.box([nx - 0.24, 0, -2.45 + 0.08], [nx + 0.24, 0.48, -2.45 + 0.56]);
      /* copper pendants */
      const py = 1.28;
      ctx.add(new T.CylinderGeometry(0.004, 0.004, H - py - 0.2, 6), M.black, nx, (H + py + 0.2) / 2, -2.45 + 0.32, { cast: false });
      ctx.add(new T.CylinderGeometry(0.085, 0.11, 0.2, 48, 1, true), M.copper, nx, py + 0.1, -2.45 + 0.32);
      ctx.add(new T.CircleGeometry(0.1, 32), M.glow, nx, py + 0.02, -2.45 + 0.32, { rx: Math.PI / 2, cast: false });
      bowl(ctx, nx + 0.06, 0.48, -2.45 + 0.3, 0.07);
    });
    books(ctx, bx - 1.42, 0.48, -2.45 + 0.36, 0.5);
    ctx.box([bx - 1.0, 0, -2.45], [bx + 1.0, 0.62, bz + 1.08]);
    vaseBranches(ctx, 2.0, -1.95, 1.0, 44, 0.9);
    ctx.box([1.86, 0, -2.09], [2.14, 0.5, -1.81]);
    return {
      min: new T.Vector3(-W / 2, 0, -D / 2), max: new T.Vector3(W / 2, H, D / 2),
      feature: { pos: new T.Vector3(0, H / 2, -D / 2), w: W, h: H, ry: 0, normal: new T.Vector3(0, 0, 1), axis: new T.Vector3(1, 0, 0) },
      sun: { dir: new T.Vector3(-0.8, -0.38, -0.46).normalize(), intensity: 8.0 }, win: [2.6, 1.4, -0.55, 3.8],
      env: { win: 'right', W, D, H }, envIntensity: 1.0,
      cam: { pos: new T.Vector3(-0.95, 1.32, 2.15), look: new T.Vector3(-0.05, 1.12, -2.45), vfov: 46, frameW: 4.0, shift: -0.06,
        sway: 0.28, push: 0.75, lookSway: 0.16, T1: 36, T2: 50,
        portrait: { pos: new T.Vector3(-0.3, 1.3, 2.25), look: new T.Vector3(-0.15, 1.05, -2.45), frameW: 2.9, sway: 0.18, push: 0.55, shift: -0.08 } }
    };
  }
  function hallway(ctx) {
    const W = 2.3, D = 8.4, H = 2.85;
    shell(ctx, { W, D, H, feature: 'right', windows: [{ wall: 'back', a0: -0.85, a1: 0.85, y0: 0, y1: 2.62, panes: 2 }] });
    ctx.add(roundedBox(T, 0.95, 0.012, 4.6, 0.005, 14), M.rug, -0.05, 0.006, -0.6, { cast: false, shell: true });
    /* floating oak bench on the left wall */
    ctx.add(ctx.rb(0.42, 0.07, 1.9, 0.01), M.oak, -W / 2 + 0.21, 0.46, 0.4);
    ctx.box([-W / 2, 0.42, -0.55], [-W / 2 + 0.42, 0.5, 1.35]);
    /* flush oak door */
    ctx.add(new T.BoxGeometry(0.03, 2.35, 0.95), M.oakDark, -W / 2 + 0.005, 1.175, 2.75);
    ctx.add(new T.BoxGeometry(0.03, 0.5, 0.025), M.black, -W / 2 + 0.03, 1.05, 2.38);
    vaseBranches(ctx, -0.62, -3.85, 1.25, 77, 1.05);
    ctx.box([-0.78, 0, -4.0], [-0.46, 0.6, -3.7]);
    ctx.add(new T.BoxGeometry(0.032, 0.01, 7.4), M.glow, -0.55, H - 0.013, -0.2, { cast: false });
    ctx.add(new T.BoxGeometry(0.075, 0.012, 7.44), M.gap, -0.55, H - 0.005, -0.2, { cast: false });
    return {
      min: new T.Vector3(-W / 2, 0, -D / 2), max: new T.Vector3(W / 2, H, D / 2),
      feature: { pos: new T.Vector3(W / 2, H / 2, 0), w: D, h: H, ry: -Math.PI / 2, normal: new T.Vector3(-1, 0, 0), axis: new T.Vector3(0, 0, -1) },
      sun: { dir: new T.Vector3(0.36, -0.36, 0.86).normalize(), intensity: 9.0 }, win: [0, 1.4, -4.2, 4.8],
      env: { win: 'back', W, D, H }, envIntensity: 0.95,
      cam: { pos: new T.Vector3(-0.5, 1.36, 3.75), look: new T.Vector3(0.28, 1.3, -4.2), vfov: 43, frameW: 2.4, shift: -0.03,
        sway: 0.2, push: 1.4, lookSway: 0.12, T1: 32, T2: 44,
        portrait: { pos: new T.Vector3(-0.45, 1.36, 3.8), look: new T.Vector3(0.38, 1.3, -4.2), frameW: 2.0, sway: 0.12 } }
    };
  }

  /* diffuse daylight as a spherical-harmonics probe, integrated from the same room description as the env map
     (cheap per pixel: no cube-map lookups on walls, fabrics and the coating) */
  const GLOSSY = ['floor', 'oak', 'oakDark', 'stone', 'ceramic', 'black', 'copper', 'bookB'];
  function envSH(e) {
    const sh = new T.SphericalHarmonics3(), basis = new Array(9).fill(0), d = new T.Vector3();
    const hw = e.W / 2, hh = e.H / 2, hd = e.D / 2, N = 1200, wgt = 4 * Math.PI / N;
    const WALL = [0.95, 0.91, 0.85], BACK = [0.98, 0.93, 0.86], CEIL = [1.1, 1.07, 1.02], FLOOR = [0.62, 0.47, 0.33], WIN = [13, 13.2, 13.6], PATCH = [6.5, 5.4, 4.2];
    const px = e.win === 'left' ? -e.W / 4 : e.win === 'right' ? e.W / 4 : 0, pz = e.win === 'back' ? -e.D / 4 : 0;
    for (let i = 0; i < N; i++) {
      const y = 1 - 2 * (i + 0.5) / N, r = Math.sqrt(1 - y * y), ph = i * 2.399963229728653;
      d.set(Math.cos(ph) * r, y, Math.sin(ph) * r);
      const tx = Math.abs(d.x) > 1e-6 ? hw / Math.abs(d.x) : 1e9, ty = Math.abs(d.y) > 1e-6 ? hh / Math.abs(d.y) : 1e9, tz = Math.abs(d.z) > 1e-6 ? hd / Math.abs(d.z) : 1e9;
      const t = Math.min(tx, ty, tz), hx = d.x * t, hy = d.y * t, hz = d.z * t;
      let c;
      if (t === ty) c = d.y > 0 ? CEIL : (Math.abs(hx - px) < 0.9 && Math.abs(hz - pz) < 0.7 ? PATCH : FLOOR);
      else if (t === tx) c = ((e.win === 'left' && d.x < 0) || (e.win === 'right' && d.x > 0)) && Math.abs(hz) < 1.4 && Math.abs(hy) < 1.25 ? WIN : WALL;
      else c = d.z < 0 ? (e.win === 'back' && Math.abs(hx) < 0.85 && Math.abs(hy) < 1.25 ? WIN : BACK) : WALL;
      T.SphericalHarmonics3.getBasisAt(d, basis);
      for (let k = 0; k < 9; k++) { const b = basis[k] * wgt, v = sh.coefficients[k]; v.x += c[0] * b; v.y += c[1] * b; v.z += c[2] * b; }
    }
    return sh;
  }

  /* environment: a soft box of the room with a bright window, prefiltered (PMREM) */
  function makeEnv(def) {
    const e = def.env, s = new T.Scene();
    const mat = c => new T.MeshBasicMaterial({ color: new T.Color().setRGB(c[0], c[1], c[2], T.LinearSRGBColorSpace), side: T.BackSide });
    const room = new T.Mesh(new T.BoxGeometry(e.W, e.H, e.D), [
      mat([0.95, 0.91, 0.85]), mat([0.95, 0.91, 0.85]), mat([1.1, 1.07, 1.02]), mat([0.62, 0.47, 0.33]), mat([0.95, 0.91, 0.85]), mat([0.98, 0.93, 0.86])
    ]);
    room.position.y = 0; s.add(room);
    const win = new T.Mesh(new T.PlaneGeometry(e.win === 'back' ? 1.7 : 2.8, 2.5), new T.MeshBasicMaterial({ color: new T.Color().setRGB(13, 13.2, 13.6, T.LinearSRGBColorSpace) }));
    const patch = new T.Mesh(new T.PlaneGeometry(1.8, 1.4), new T.MeshBasicMaterial({ color: new T.Color().setRGB(6.5, 5.4, 4.2, T.LinearSRGBColorSpace) }));
    patch.rotation.x = -Math.PI / 2; patch.position.y = -e.H / 2 + 0.01;
    if (e.win === 'left') { win.position.set(-e.W / 2 + 0.01, 0, 0); win.rotation.y = Math.PI / 2; patch.position.x = -e.W / 4; }
    if (e.win === 'right') { win.position.set(e.W / 2 - 0.01, 0, 0); win.rotation.y = -Math.PI / 2; patch.position.x = e.W / 4; }
    if (e.win === 'back') { win.position.set(0, 0, -e.D / 2 + 0.01); patch.position.z = -e.D / 4; }
    s.add(win, patch);
    const pm = new T.PMREMGenerator(R);
    const rt = pm.fromScene(s, 0.04);
    pm.dispose(); room.geometry.dispose(); win.geometry.dispose(); patch.geometry.dispose();
    return rt;
  }

  /* ---------- camera ---------- */
  function resize(w, h) {
    if (!camera || !rig) return;
    const aspect = w / h; camera.aspect = aspect;
    const r = (aspect < 0.95 && rig.portrait) ? Object.assign({}, rig, rig.portrait) : rig;
    const dist = r.pos.distanceTo(r.look);
    const needH = 2 * Math.atan((r.frameW / 2) / dist);                   /* keep the feature wall readable */
    const vNeed = 2 * Math.atan(Math.tan(needH / 2) / aspect) * 180 / Math.PI;
    camera.fov = clamp(Math.max(r.vfov, vNeed), 20, aspect < 0.75 ? 62 : 78);   /* tall phones: crop the sides rather than show floor and ceiling */
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[9] = r.shift || 0;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  const _p = { x: 0, y: 0, z: 0 };
  function placeCamera(t) {
    const base = rig; if (!base) return;
    const r = (camera.aspect < 0.95 && base.portrait) ? Object.assign({}, base, base.portrait) : base;
    const still = !S.drift || stage.reduced;
    const w1 = still ? 0 : 2 * Math.PI * t / r.T1, w2 = still ? 0 : 2 * Math.PI * t / r.T2;
    const fx = r.look.x - r.pos.x, fz = r.look.z - r.pos.z, fl = Math.hypot(fx, fz) || 1;
    const dx = fx / fl, dz = fz / fl, rx = -dz, rz = dx;
    const sway = Math.sin(w1) * r.sway, push = (0.5 - 0.5 * Math.cos(w2)) * r.push;
    _p.x = r.pos.x + rx * sway + dx * push; _p.z = r.pos.z + rz * sway + dz * push;
    _p.y = r.pos.y + Math.sin(w1 * 1.7 + 0.8) * 0.025;
    const lx = r.look.x + rx * Math.sin(w1 + 0.7) * r.lookSway, lz = r.look.z + rz * Math.sin(w1 + 0.7) * r.lookSway;
    camera.position.set(_p.x, _p.y, _p.z);
    camera.rotation.set(0, Math.atan2(-(lx - _p.x), -(lz - _p.z)), 0);
  }

  /* ---------- per frame ---------- */
  function update(t, dt) {
    placeCamera(t);
    if (wipe) {
      wipe.k += (dt || 0) / wipe.dur;
      const k = stage.reduced ? 1 : Math.min(1, wipe.k);
      U.wipe.value = -0.04 + k * 1.2;
      if (k >= 1) finishWipe();
    }
  }
  function render() {
    if (palette) { scene.remove(palette); palette.children[0].geometry.dispose(); palette = null; }
    R.render(scene, camera);
  }

  /* ---------- transitions ---------- */
  function startWipe(next) {
    if (wipe) finishWipe();
    applyTiles(M.coatB, next);
    tiles.next = next;
    coatB.visible = true; U.wipe.value = -0.04;
    wipe = { k: 0, dur: 1.9 };
    stage.invalidate();
    if (!stage.reduced) stage.start();
  }
  function finishWipe() {
    if (!wipe) return;
    wipe = null;
    const old = tiles.cur; tiles.cur = tiles.next; tiles.next = null;
    applyTiles(M.coatA, tiles.cur);
    coatB.visible = false; U.wipe.value = 2;
    if (old && old !== tiles.cur) old.dispose();
    stage.invalidate();
  }
  async function refreshCoat() {
    if (!stage.ready) return;
    const tok = ++coatTok;
    let tl;
    try { tl = await coatTiles(); }
    catch (e) { console.warn('[dvatone 3d] texture not loaded:', S.textureUrl); return; }
    if (stage.destroyed || tok !== coatTok) { tl.dispose(); return; }   /* a newer request won */
    startWipe(tl);
  }
  /* ---------- public API ---------- */
  const ctl = {
    el, get ready() { return stage.readyP; },
    setColors(colors, grain) {
      S.colors = normColors(colors); if (grain != null) S.grain = clamp(+grain || 1, 0.6, 1.8);
      S.textureUrl = null; return refreshCoat();
    },
    setState(st = {}) {
      if (st.mix || st.colors) S.colors = normColors(st.mix || st.colors);
      if (st.grain != null) S.grain = clamp(+st.grain, 0.6, 1.8);
      if (st.density != null) S.density = clamp(+st.density, 0.4, 1);
      if (st.seed != null) S.seed = +st.seed;
      S.textureUrl = null; return refreshCoat();
    },
    setTexture(url, metres) {
      S.textureUrl = url || null; if (metres) S.textureSize = +metres;
      return refreshCoat();
    },
    setRoom(name) {
      if (!ROOMS.includes(name) || name === S.room) return;
      S.room = name; if (opts.poster !== false && !opts.poster) stage.setPoster(posterOf(name));
      if (stage.ready) { if (wipe) finishWipe(); crossfade(stage, () => { update(stage.t, 0); render(); }, () => buildRoom(name)); }
    },
    get room() { return S.room; },
    stats() { return Object.assign({ room: S.room }, stage.stats); },
    renderFrame() { if (stage.ready) { update(stage.t, 0); render(); } },
    destroy() { stage.destroy(); }
  };
  el.dv3d = ctl;
  return ctl;

  function dispose() {
    if (!scene) return;
    clearRoom();
    tiles.cur && tiles.cur.dispose(); tiles.next && tiles.next.dispose();
    Object.values(M).forEach(m => {
      if (!m || !m.isMaterial) return;
      ['map', 'roughnessMap', 'bumpMap', 'metalnessMap'].forEach(k => { const t = m[k]; if (t && t.isTexture && !t.isRenderTargetTexture) t.dispose(); });
      m.dispose();
    });
    baker && baker.dispose();
  }
}

/* declarative mounting */
function autoMount() {
  document.querySelectorAll('[data-dv3d="interior"]').forEach(el => {
    if (el.dv3d) return;
    let colors = null; try { colors = JSON.parse(el.getAttribute('data-colors') || 'null'); } catch (e) { colors = null; }
    const poster = el.getAttribute('data-poster');
    mount(el, { room: el.getAttribute('data-room') || 'living', colors, grain: +el.getAttribute('data-grain') || 1, textureUrl: el.getAttribute('data-texture') || null,
      textureSize: +el.getAttribute('data-texture-size') || undefined, poster: poster === 'none' ? false : (poster || undefined) });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
