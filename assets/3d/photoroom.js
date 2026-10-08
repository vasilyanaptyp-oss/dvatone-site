/* Dvatone 3D Interiors, photo mode: photoreal Cycles renders of the rooms whose feature wall is recoloured live and
   exactly with the generator's coating.

   Each view (a room at 16:9 or 4:5, and the hero story's end frame) is one Cycles render (path guiding, adaptive
   sampling, OIDN with albedo and normal, light portals) of the room with the feature wall as a neutral Lambert
   surface of albedo RHO0, white-balanced on the wall's shade side, plus:
     - the wall's anti-aliased coverage (mask),
     - the light the wall throws onto the room per unit albedo (bleed, low resolution),
     - the homography from the image to the wall plane (metres).
   Per pixel: wall = tone(coat(uv) * light), rest = photo + slope(tone) * (coatMean - RHO0) * bleed, blended by the
   wall's anti-aliased coverage (the photo holds the object alone at the wall's edges)
   coat(uv) = the generator's granule albedo (core.js bakeGranules: exact colours and shares), laid out without
   repetition or seams (tiling and blending: a triangle grid of random offsets into the seamless tile, blended with a
   variance-preserving operator) and filtered by its on-screen size (mip-mapped, slightly biased), so at room
   distance it averages into a fine matte surface and never sparkles or crawls.
   The wall's light is stored with real precision: low-frequency log luminance in 16 bits (hi and lo bytes: the GPU's
   bilinear filtering is linear in each, so the 16 bits survive filtering) plus chroma at a quarter resolution in one
   lossless image (cubic B-spline reconstruction), times a full-resolution 8-bit detail ratio around 1.0 (shadow
   edges, leaf shadows); the output carries a +-0.5 LSB blue-noise dither, so smooth gradients show no steps. Then the hue-preserving tone
   curve (identity below 0.55, a long hue-keeping roll-off above that never clips). The photograph itself never moves except a slow push-in.

   mountPhoto(el, { room, colors, grain, density, seed, textureUrl, textureSize, drift, poster, maxHeight, view })
     -> { setColors, setState, setRoom, setTexture, destroy, stats, renderFrame, start, ready, room }   (DVInterior2 API)
   photoFrame(host, { view: 'hero-end', colors, grain, drift: false })   the hero story's end frame, same controller
   photoCamera(view, aspect) -> { pos, look, vfov, shift, crop }        camera that the frame shows at that aspect */
import { createStage, createBaker, bakeGranules, normColors, clamp, crossfade, loadThree } from './core.js';

const ASSET = new URL('./interior2/photo/', import.meta.url).href;
const POSTER = new URL('./interior2/', import.meta.url).href;
const CELL_M = 0.0021;                  /* granule lattice cell at grain 1 (as the live rooms and v1) */
const COAT = new URL('./interior2/coat/', import.meta.url).href;
const STRUCTURE = 'dv018';              /* the default fleck structure (from the DV 018 scan); others: setState({ structure }) */
/* albedo tile from a real fleck structure: each fleck's rank u picks the composition colour (sorted dark to light) whose
   cumulative share contains it; a faint rim where the neighbour is another colour; a fine mottle inside the flecks */
const SCAN_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tRank; uniform vec2 uTexel; uniform vec3 uCol[6]; uniform float uCum[6]; uniform int uN;
vec3 pickCol( float u ) { vec3 c = uCol[0]; for ( int i = 1; i < 6; i ++ ) { if ( i < uN && u > uCum[i - 1] ) c = uCol[i]; } return c; }
float h21( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
void main() {
  float u = texture( tRank, vUv ).r;
  vec3 c = pickCol( u );
  float e = 0.0;
  e += step( 0.0001, distance( pickCol( texture( tRank, vUv + vec2( uTexel.x, 0.0 ) ).r ), c ) );
  e += step( 0.0001, distance( pickCol( texture( tRank, vUv - vec2( uTexel.x, 0.0 ) ).r ), c ) );
  e += step( 0.0001, distance( pickCol( texture( tRank, vUv + vec2( 0.0, uTexel.y ) ).r ), c ) );
  e += step( 0.0001, distance( pickCol( texture( tRank, vUv - vec2( 0.0, uTexel.y ) ).r ), c ) );
  c *= ( 1.0 - 0.05 * e * 0.25 ) * ( 1.0 + 0.05 * ( h21( floor( vUv / uTexel ) ) - 0.5 ) );
  gl_FragColor = vec4( c, 1.0 );
}`;
const structures = new Map();
function loadStructure(T, id) {
  if (!structures.has(id)) {
    const setup = t => {
      t.colorSpace = T.NoColorSpace; t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false;
      t.wrapS = t.wrapT = T.RepeatWrapping; t.needsUpdate = true; return t;
    };
    const p = Promise.all([
      fetch(COAT + id + '.json').then(r => { if (!r.ok) throw new Error('coat ' + id); return r.json(); }),
      /* shared by every stage on the page (each uploads it to its own context): its bitmap is kept, never closed */
      takeBitmap(COAT + id + '.webp').then(bm => bm ? setup(bitmapTexture(T, bm)) :
        new Promise((res, rej) => new T.TextureLoader().load(COAT + id + '.webp', t => res(setup(t)), undefined, rej)))
    ]).then(([meta, tex]) => ({ meta, tex }));
    p.catch(() => structures.delete(id));
    structures.set(id, p);
  }
  return structures.get(id);
}
function bakeScan(T, baker, st, colors) {
  const cols = normColors(colors).map(c => ({ c: new T.Color('#' + c.hex), share: c.share }));
  cols.sort((a, b) => (0.2126 * a.c.r + 0.7152 * a.c.g + 0.0722 * a.c.b) - (0.2126 * b.c.r + 0.7152 * b.c.g + 0.0722 * b.c.b));
  const tot = cols.reduce((s, c) => s + c.share, 0) || 1;
  const uCol = [], uCum = []; let acc = 0;
  for (let i = 0; i < 6; i++) {
    const c = cols[Math.min(i, cols.length - 1)];
    uCol.push(c.c.clone());
    if (i < cols.length) acc += c.share / tot;
    uCum.push(i < cols.length - 1 ? acc : 2.0);
  }
  const size = st.meta.size || 1024;
  const mat = baker.shader(SCAN_FRAG, { tRank: { value: st.tex }, uTexel: { value: new T.Vector2(1 / size, 1 / size) }, uCol: { value: uCol }, uCum: { value: uCum }, uN: { value: cols.length } });
  const rt = baker.target(size, size, { srgb: true });
  baker.run(mat, rt); mat.dispose();
  return { albedo: rt.texture, cells: st.meta.cells || 190, size, structure: st.meta.id, dispose() { rt.dispose(); } };
}
/* rooms of the photo mode, in two groups (Viktor 07.10). id: the room for setRoom(); file: the prefix of its view files
   (<file>-d desktop 16:9, <file>-p phone 4:5); ready: its views are rendered and published. 'hallway' is an alias of
   'corridor' (the home page's old tab). */
export const PHOTO_GROUPS = [
  { id: 'residential', name: { uk: 'Житлові', en: 'Residential' } },
  { id: 'public', name: { uk: 'Комерційні / Громадські', en: 'Commercial / Public' } }
];
export const PHOTO_ROOMS = [
  { id: 'living', group: 'residential', file: 'living', ready: true, name: { uk: 'Вітальня', en: 'Living room' },
    label: { uk: 'Вітальня, стіна з мультикольоровим покриттям Dvatone у денному світлі', en: 'Living room with a Dvatone multicolour coating on the feature wall in daylight' } },
  { id: 'bedroom', group: 'residential', file: 'bedroom', ready: true, name: { uk: 'Спальня', en: 'Bedroom' },
    label: { uk: 'Спальня, стіна за ліжком з покриттям Dvatone', en: 'Bedroom with a Dvatone coating on the wall behind the bed' } },
  { id: 'kitchen', group: 'residential', file: 'kitchen', ready: true, name: { uk: 'Кухня', en: 'Kitchen' },
    label: { uk: 'Кухня, стіна з покриттям Dvatone за робочою зоною', en: 'Kitchen with a Dvatone coating on the wall behind the counter' } },
  { id: 'lobby', group: 'public', file: 'lobby', ready: true, name: { uk: 'Хол / лобі', en: 'Lobby' },
    label: { uk: 'Хол, стіна з покриттям Dvatone за стійкою рецепції', en: 'Lobby with a Dvatone coating on the wall behind the reception desk' } },
  { id: 'office', group: 'public', file: 'office', ready: true, name: { uk: 'Офіс', en: 'Office' },
    label: { uk: 'Кабінет, стіна з покриттям Dvatone', en: 'Office with a Dvatone coating on the feature wall' } },
  { id: 'meeting', group: 'public', file: 'meeting', ready: true, name: { uk: 'Переговорна', en: 'Meeting room' },
    label: { uk: 'Переговорна кімната, торцева стіна з покриттям Dvatone', en: 'Meeting room with a Dvatone coating on the end wall' } },
  { id: 'corridor', group: 'public', file: 'hallway', ready: true, name: { uk: 'Коридор', en: 'Corridor' },
    label: { uk: 'Коридор, стіна з покриттям Dvatone', en: 'Corridor with a Dvatone coating' } },
  { id: 'staircase', group: 'public', file: 'staircase', ready: true, name: { uk: 'Сходи', en: 'Staircase' },
    label: { uk: 'Сходи, стіна з покриттям Dvatone вздовж маршу', en: 'Staircase with a Dvatone coating on the wall along the flight' } },
  { id: 'playroom', group: 'public', file: 'playroom', ready: true, name: { uk: 'Ігрова в садочку', en: 'Kindergarten playroom' },
    label: { uk: 'Ігрова кімната дитячого садка, стіна з покриттям Dvatone', en: 'Kindergarten playroom with a Dvatone coating on the feature wall' } },
  { id: 'classroom', group: 'public', file: 'classroom', ready: true, name: { uk: 'Клас', en: 'Classroom' },
    label: { uk: 'Шкільний клас, задня стіна з покриттям Dvatone', en: 'Classroom with a Dvatone coating on the back wall' } },
  { id: 'foyer', group: 'public', file: 'foyer', ready: true, name: { uk: 'Фоє школи', en: 'School foyer' },
    label: { uk: 'Фоє школи, стіна з покриттям Dvatone', en: 'School foyer with a Dvatone coating on the feature wall' } }
];
const ALIAS = { hallway: 'corridor' };
const roomDef = id => PHOTO_ROOMS.find(r => r.id === (ALIAS[id] || id));
const ROOMS = PHOTO_ROOMS.map(r => r.id);
const VIEWS = { 'hero-end': ['hero-d', 'hero-p'] };
PHOTO_ROOMS.forEach(r => { VIEWS[r.id] = [r.file + '-d', r.file + '-p']; });
const LANG = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk';
const LABEL = { uk: { 'hero-end': 'Вітальня з покриттям Dvatone на стіні' }, en: { 'hero-end': 'Living room with a Dvatone coating on the wall' } };
PHOTO_ROOMS.forEach(r => { LABEL.uk[r.id] = r.label.uk; LABEL.en[r.id] = r.label.en; });
/* ready rooms of the same group as `id` (swipe and prefetch stay inside the group the visitor chose) */
const groupRooms = id => { const d = roomDef(id); return PHOTO_ROOMS.filter(r => r.ready && (!d || r.group === d.group)).map(r => r.id); };
const G = window.DV3D || (window.DV3D = {});
const PUSH = { amount: 0.025, secs: 22 };   /* slow push-in after a view appears */

/* AVIF support, tested once with a 1 x 1 image */
const AVIF = new Promise(res => {
  const i = new Image(); i.onload = () => res(i.width > 0); i.onerror = () => res(false);
  i.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
});
/* images decoded off the main thread (07.10 night, the performance pass): fetch + createImageBitmap, flipped as three.js
   flips images and without colour conversion (the maps are data, the photograph is sRGB decoded on the GPU), so the
   upload needs no decode or conversion. Where createImageBitmap or its options are missing: null (the TextureLoader). */
const BITMAPS = new Map();
function bitmapOf(url) {
  if (!BITMAPS.has(url)) {
    BITMAPS.set(url, typeof createImageBitmap !== 'function' ? Promise.resolve(null) :
      fetch(url).then(r => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.blob(); })
        .then(b => createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .catch(() => null));
  }
  return BITMAPS.get(url);
}
function takeBitmap(url) { const p = bitmapOf(url); BITMAPS.delete(url); return p; }
function bitmapTexture(T, bm) { const t = new T.Texture(bm); t.flipY = false; return t; }
const metaCache = new Map();
function viewMeta(id) {
  if (!metaCache.has(id)) {
    const p = fetch(ASSET + id + '.json').then(r => { if (!r.ok) throw new Error('photo view ' + id); return r.json(); });
    p.catch(() => metaCache.delete(id));
    metaCache.set(id, p);
  }
  return metaCache.get(id);
}
const viewId = (name, portrait) => (VIEWS[name] || VIEWS.living)[portrait ? 1 : 0];

/* the part of the photo a stage of aspect a shows: full height and the centre cut to width when the stage is
   narrower than the photo (vertical field of view kept: the hero story's rule for its end frame), otherwise full
   width and the middle cut to height */
function fitFor(a, ap) {
  return a <= ap ? [(1 - a / ap) / 2, 0, a / ap, 1] : [0, (1 - ap / a) / 2, 1, ap / a];
}
export async function photoCamera(view, aspect) {
  const id = viewId(view, aspect < 0.95);
  const m = await viewMeta(id);
  const ap = m.w / m.h, f = fitFor(aspect, ap);
  const vfov = 2 * Math.atan(Math.tan(m.cam.vfov * Math.PI / 360) * f[3]) * 180 / Math.PI;
  /* shift: vertical lens shift as a fraction of the shown height (+ = the frame moves up), as hero2's portraitOffset */
  return { id, pos: m.cam.pos, look: m.cam.look, vfov, shift: m.cam.shift_ndc / 2 / f[3], crop: f, level: m.cam.level, size: [m.w, m.h] };
}

const GLSL = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tBase; uniform sampler2D tLight; uniform sampler2D tDetail; uniform sampler2D tMask; uniform sampler2D tBleed;
uniform sampler2D tBlue; uniform vec2 uLightPx; uniform vec3 uLightK; uniform vec2 uChroma;
uniform sampler2D tCoatA; uniform sampler2D tCoatB;
uniform vec4 uFit; uniform vec2 uFocus; uniform float uZoom; uniform vec2 uPhotoPx; uniform float uMinify;
uniform mat3 uH; uniform float uRho0; uniform float uBleedScale;
uniform float uMetresA; uniform float uMetresB; uniform float uFlatA; uniform float uFlatB;
uniform float uWipe; uniform vec2 uWipeRange; uniform float uWipeMix; uniform float uCoatBias; uniform float uCells;
uniform float uFade; uniform vec3 uBg;
vec2 dvHash2( vec2 p ) { vec3 p3 = fract( p.xyx * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
/* tiling and blending (Heitz and Neyret 2018): a triangle grid over the wall, each of its vertices reads the seamless
   tile at its own random offset and the three reads are blended around the tile's mean with a variance-preserving
   operator, so there is no seam and no repetition, and the granules' contrast and colour statistics are the same
   everywhere; explicit gradients keep the three reads at the same mip level */
vec3 coat( sampler2D t, vec2 uv, float isFlat ) {
  vec2 dx = dFdx( uv ), dy = dFdy( uv );
  /* granules smaller than about 3 screen pixels would read as salt-and-pepper noise: the filter then averages over about
     four granules (a real lens and sensor see a fine matte mottle there); bigger granules stay crisp */
  float px = 1.0 / max( max( length( dx ), length( dy ) ) * uCells, 1e-6 );
  float g = exp2( uCoatBias + mix( log2( max( 4.0 * px, 1.0 ) ), 0.0, smoothstep( 1.2, 3.0, px ) ) );
  vec2 gx = dx * g, gy = dy * g;
  vec3 r = textureGrad( t, uv, gx, gy ).rgb;            /* a client's flat texture: plain tiling */
  if ( isFlat > 0.5 ) return r;
  vec2 s = mat2( 1.0, 0.0, -0.57735027, 1.15470054 ) * ( uv * 2.6 );
  vec2 b = floor( s ), f = s - b;
  float z = 1.0 - f.x - f.y;
  bool lower = z > 0.0;
  vec3 wt = lower ? vec3( z, f.y, f.x ) : vec3( -z, 1.0 - f.y, 1.0 - f.x );
  vec2 v1 = lower ? b : b + 1.0;
  vec2 v2 = lower ? b + vec2( 0.0, 1.0 ) : b + vec2( 1.0, 0.0 );
  vec2 v3 = lower ? b + vec2( 1.0, 0.0 ) : b + vec2( 0.0, 1.0 );
  vec3 mu = textureLod( t, vec2( 0.5 ), 16.0 ).rgb;
  vec3 c1 = textureGrad( t, uv + dvHash2( v1 + 0.37 ), gx, gy ).rgb;
  vec3 c2 = textureGrad( t, uv + dvHash2( v2 + 0.37 ), gx, gy ).rgb;
  vec3 c3 = textureGrad( t, uv + dvHash2( v3 + 0.37 ), gx, gy ).rgb;
  return max( mu + ( wt.x * ( c1 - mu ) + wt.y * ( c2 - mu ) + wt.z * ( c3 - mu ) ) * inversesqrt( dot( wt, wt ) ), 0.0 );
}
/* cubic B-spline reconstruction from 4 bilinear taps (smooth, no ringing) of one half of the light image (w x 2h,
   rows oy .. oy + h), clamped to its own edge; bilinear filtering of the hi and lo bytes is linear, so it is exact */
vec4 bsplineHalf( sampler2D t, vec2 uv, vec2 size, float oy ) {
  vec2 sp = uv * size - 0.5, i = floor( sp ), f = sp - i, f2 = f * f, f3 = f2 * f;
  vec2 w0 = ( 1.0 - 3.0 * f + 3.0 * f2 - f3 ) / 6.0, w1 = ( 4.0 - 6.0 * f2 + 3.0 * f3 ) / 6.0;
  vec2 w2 = ( 1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3 ) / 6.0, w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = clamp( i - 0.5 + w1 / g0, vec2( 0.5 ), size - 0.5 ), h1 = clamp( i + 1.5 + w3 / g1, vec2( 0.5 ), size - 0.5 );
  vec2 inv = 1.0 / vec2( size.x, 2.0 * size.y );
  vec2 a = ( h0 + vec2( 0.0, oy ) ) * inv, b = ( h1 + vec2( 0.0, oy ) ) * inv;
  return g0.y * ( g0.x * texture( t, a ) + g1.x * texture( t, vec2( b.x, a.y ) ) )
       + g1.y * ( g0.x * texture( t, vec2( a.x, b.y ) ) + g1.x * texture( t, b ) );
}
vec3 catmull( sampler2D t, vec2 uv, vec2 size ) {
  vec2 sp = uv * size, t1 = floor( sp - 0.5 ) + 0.5, f = sp - t1;
  vec2 w0 = f * ( -0.5 + f * ( 1.0 - 0.5 * f ) ), w1 = 1.0 + f * f * ( -2.5 + 1.5 * f );
  vec2 w2 = f * ( 0.5 + f * ( 2.0 - 1.5 * f ) ), w3 = f * f * ( -0.5 + 0.5 * f );
  vec2 w12 = w1 + w2, t0 = ( t1 - 1.0 ) / size, t3 = ( t1 + 2.0 ) / size, t12 = ( t1 + w2 / w12 ) / size;
  vec3 c = textureLod( t, vec2( t12.x, t0.y ), 0.0 ).rgb * ( w12.x * w0.y ) + textureLod( t, vec2( t0.x, t12.y ), 0.0 ).rgb * ( w0.x * w12.y )
         + textureLod( t, t12, 0.0 ).rgb * ( w12.x * w12.y ) + textureLod( t, vec2( t3.x, t12.y ), 0.0 ).rgb * ( w3.x * w12.y )
         + textureLod( t, vec2( t12.x, t3.y ), 0.0 ).rgb * ( w12.x * w3.y );
  return max( c / ( w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y ), 0.0 );
}
/* identity below 0.55 (the coating's shade side stays exact), above it a long roll-off towards 0.97 that scales the
   three channels together: a sunlit coating keeps its hue and nothing clips; a trace of desaturation in the brightest
   light (window, sun on the floor). Same curve as _blender/photo_encode.py */
vec3 dvTone( vec3 c ) {
  const float S = 0.55; const float A = 0.97; const float D = 0.03;
  float peak = max( c.r, max( c.g, c.b ) );
  if ( peak < S ) return c;
  float np = A - ( A - S ) * ( A - S ) / ( peak - S + ( A - S ) );
  c *= np / peak;
  float g = 1.0 - 1.0 / ( D * ( peak - np ) + 1.0 );
  return mix( c, vec3( np ), g );
}
vec3 dvSRGB( vec3 c ) { return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) ); }
void main() {
  vec2 puv = uFit.xy + vUv * uFit.zw;
  puv = uFocus + ( puv - uFocus ) / uZoom;
  /* the photograph as shown (display-linear); the light on the wall per unit albedo (linear, display exposure) */
  vec3 b = uMinify > 1.02 ? texture( tBase, puv ).rgb : catmull( tBase, puv, uPhotoPx );
  vec2 hl = bsplineHalf( tLight, puv, uLightPx, uLightPx.y ).rg * 255.0;      /* top half (texture rows h .. 2h) */
  vec3 ch = uChroma.x + bsplineHalf( tLight, puv, uLightPx, 0.0 ).rgb * uChroma.y;
  float dc = texture( tDetail, puv ).r * 255.0 - 128.0;
  vec3 lw = exp2( uLightK.x + ( hl.x * 256.0 + hl.y ) / 65535.0 * uLightK.y + dc * uLightK.z ) * ch;
  float m = texture( tMask, puv ).r;
  vec3 bl = texture( tBleed, puv ).rgb; bl = bl * bl * uBleedScale;
  /* the coating on the wall plane (metres), current composition A and the next one B wiping in */
  vec3 hw = uH * vec3( puv * 2.0 - 1.0, 1.0 );
  vec2 w = hw.xy / hw.z;
  vec3 ca = coat( tCoatA, w / uMetresA, uFlatA );
  vec3 meanC = textureLod( tCoatA, vec2( 0.5 ), 16.0 ).rgb;
  vec3 cc = ca;
  if ( uWipeMix > 0.0 ) {
    vec3 cb = coat( tCoatB, w / uMetresB, uFlatB );
    float n = sin( w.y * 2.3 + 1.3 ) * 0.05 + sin( w.y * 6.1 + 0.2 ) * 0.02;
    float k = smoothstep( 0.0, 0.3, uWipe - ( ( w.x - uWipeRange.x ) + n ) );
    cc = mix( ca, cb, k );
    meanC = mix( meanC, textureLod( tCoatB, vec2( 0.5 ), 16.0 ).rgb, uWipeMix );
  }
  /* the wall: its light times the coating, through the tone curve; the rest: the photograph plus the change of the
     wall's colour bleed, through the slope of the tone curve there; blended by the wall's anti-aliased coverage */
  vec3 wallC = dvTone( cc * lw );
  float pk = max( b.r, max( b.g, b.b ) );
  float J = pk < 0.55 ? 1.0 : ( 0.97 - pk ) * ( 0.97 - pk ) / ( 0.42 * 0.42 );
  vec3 rest = max( b + J * ( meanC - uRho0 ) * bl, 0.0 );
  vec3 col = dvSRGB( clamp( mix( rest, wallC, m ), 0.0, 1.0 ) );
  float dn = texture( tBlue, gl_FragCoord.xy / 64.0 ).r;
  col = mix( col, uBg, uFade );                            /* room change: through the stage colour, never a double exposure */
  gl_FragColor = vec4( col + ( dn - 0.5 ) / 255.0, 1.0 );
}`;

export function mountPhoto(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  if (opts.maxHeight != null && opts.maxHeight !== '') el.style.maxHeight = typeof opts.maxHeight === 'number' ? opts.maxHeight + 'px' : String(opts.maxHeight);
  const hero = opts.view === 'hero-end';
  const S = {
    room: hero ? 'hero-end' : (roomDef(opts.room) ? roomDef(opts.room).id : 'living'),
    colors: normColors(opts.colors), grain: clamp(+opts.grain || 1, 0.6, 1.8),
    density: opts.density == null ? 0.92 : clamp(+opts.density, 0.4, 1), seed: opts.seed == null ? 11 : +opts.seed,
    textureUrl: opts.textureUrl || null, textureSize: +opts.textureSize || 0.6,
    structure: opts.structure === false || opts.structure === null ? null : (opts.structure || STRUCTURE),   /* null or false: synthetic granules */
    drift: opts.drift == null ? !hero : opts.drift !== false
  };
  const box0 = el.getBoundingClientRect();
  let portrait = box0.width > 0 && box0.height > 0 && box0.width / box0.height < 0.95;
  const posterOf = (room, p) => POSTER + 'poster-' + (room === 'hero-end' ? 'hero' : (roomDef(room) ? roomDef(room).file : room)) + (p ? '-p' : '') + '.webp';
  let T, R, baker, scene, camera, mat, U, stage = null, view = null, coatA = null, coatB = null, wipe = null, roomTok = 0, coatTok = 0;
  let push = 0, dirty = true, lastT = null;
  const views = new Map();
  let startResolve;
  const started = new Promise(r => (startResolve = r));

  function start() {
    if (stage) return;
    stage = createStage(el, {
      poster: opts.poster === false ? null : (opts.poster || posterOf(S.room, portrait)), label: LABEL[LANG][S.room] || LABEL[LANG].living,
      className: 'dv3d--interior dv3d--interior2 dv3d--photo', antialias: false,
      build, update, render, resize, scene: () => scene, camera: () => camera,
      continuous: () => !!wipe || (S.drift && push < 1), dispose
    });
    bindInput();
    startResolve(stage.readyP);
  }
  function bindInput() {
    if (hero || opts.swipe === false) return;
    const w = stage.wrap; let sx = 0, sy = 0, st = 0, id = -1;
    w.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; id = e.pointerId; sx = e.clientX; sy = e.clientY; st = e.timeStamp; }, { passive: true });
    w.addEventListener('pointerup', e => {
      if (e.pointerId !== id) return; id = -1;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4 && e.timeStamp - st < 900) {
        const list = groupRooms(S.room), i = Math.max(0, list.indexOf(S.room)), n = list.length;
        if (n < 2) return;
        const next = list[(i + (dx < 0 ? 1 : -1) + n) % n];
        ctl.setRoom(next);
        el.dispatchEvent(new CustomEvent('dv3d:room', { bubbles: true, detail: { room: next, via: 'swipe' } }));
      }
    }, { passive: true });
    w.addEventListener('pointercancel', () => { id = -1; }, { passive: true });
  }

  /* one render pixel per CSS pixel or more (core.js's adaptive steps are ignored: the composite is cheap) */
  let setPR0, setSize0, curPR = 0, curW = 0, curH = 0, inner = false;
  function wrapSize() {
    setPR0 = R.setPixelRatio.bind(R); setSize0 = R.setSize.bind(R);
    R.setPixelRatio = () => {};
    R.setSize = (w, h) => { if (inner) { setSize0(w, h, false); return; } if (w === curW && h === curH) return; curW = w; curH = h; inner = true; setSize0(w, h, false); inner = false; };
  }
  function applyPR() {
    const pr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    if (pr === curPR && stage.w === curW && stage.h === curH) return;
    curPR = pr; curW = stage.w; curH = stage.h; inner = true; setPR0(pr); setSize0(curW, curH, false); inner = false;
  }

  async function build(st) {
    T = st.THREE; R = st.renderer;
    wrapSize(); applyPR();
    R.toneMapping = T.NoToneMapping;
    baker = createBaker(T, R);
    scene = new T.Scene(); camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const one = new T.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); one.needsUpdate = true;
    U = {
      tBase: { value: one }, tLight: { value: one }, tDetail: { value: one }, tMask: { value: one }, tBleed: { value: one }, tCoatA: { value: one }, tCoatB: { value: one },
      tBlue: { value: one }, uLightPx: { value: new T.Vector2(1, 1) }, uLightK: { value: new T.Vector3(0, 0, 0) }, uChroma: { value: new T.Vector2(0, 1) },
      uFit: { value: new T.Vector4(0, 0, 1, 1) }, uFocus: { value: new T.Vector2(0.5, 0.5) }, uZoom: { value: 1 }, uPhotoPx: { value: new T.Vector2(1920, 1080) },
      uMinify: { value: 1 }, uH: { value: new T.Matrix3() }, uRho0: { value: 0.42 }, uBleedScale: { value: 0 },
      uMetresA: { value: 0.27 }, uMetresB: { value: 0.27 }, uFlatA: { value: 0 }, uFlatB: { value: 0 },
      uWipe: { value: 0 }, uWipeRange: { value: new T.Vector2(0, 6) }, uWipeMix: { value: 0 }, uCoatBias: { value: 0.15 }, uCells: { value: 128 },
      uFade: { value: 0 }, uBg: { value: new T.Vector3(0.11, 0.105, 0.1) }
    };
    mat = new T.ShaderMaterial({ uniforms: U, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: GLSL, depthTest: false, depthWrite: false });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new T.Mesh(g, mat); quad.frustumCulled = false; scene.add(quad);
    const vP = loadView(viewId(S.room, portrait));
    loadTex(ASSET + 'bluenoise64.webp', false, false).then(t => {
      t.wrapS = t.wrapT = T.RepeatWrapping; t.minFilter = t.magFilter = T.NearestFilter; t.needsUpdate = true; U.tBlue.value = t; dirty = true;
    }).catch(() => {});
    vP.catch(() => {});
    coatA = await coatTiles();
    if (!coatA || stage.destroyed) return;
    useCoat(coatA, 'A');
    const v = await vP;
    if (stage.destroyed) return;
    await upload(v);
    if (stage.destroyed) return;
    useView(v);
    /* after the first frame the next room of the same group loads when the browser is idle (prefetchNext) */
    if (!hero) prefetchNext();
    if (/[?&]debug(&|$)/.test(location.search)) G.photo = { T, R, U, get view() { return view; }, stage };
  }
  function loadTex(url, srgb, mip) {
    const setup = t => {
      t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
      t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
      t.generateMipmaps = !!mip; t.minFilter = mip ? T.LinearMipmapLinearFilter : T.LinearFilter; t.magFilter = T.LinearFilter;
      t.anisotropy = 1; t.needsUpdate = true; return t;
    };
    return takeBitmap(url).then(bm => bm ? setup(bitmapTexture(T, bm)) : new Promise((res, rej) => new T.TextureLoader().load(url, t => {
      setup(t);
      const im = t.image;                                    /* decode now, off the main thread, not at the upload */
      if (im && im.decode) im.decode().then(() => res(t), () => res(t)); else res(t);
    }, undefined, rej)));
  }
  /* a view's maps go to the GPU one per animation frame before it is shown (all at once was a 300 ms long task); a
     decoded bitmap is freed once its texture is on the GPU */
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
  async function upload(v) {
    if (v.uploaded) return;
    for (const t of [v.light, v.bleed, v.mask, v.detail, v.base]) {
      await nextFrame();
      if (stage.destroyed) return;
      if (R.initTexture) {
        R.initTexture(t);
        if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
      }
    }
    v.uploaded = true;
  }
  /* before the stage exists: three.js parsed and the first view's maps, the fleck structure and the dither decoded, all
     off the main thread, so the stage's own start (300 px before the section) has only the uploads left */
  function prewarm() {
    loadThree().catch(() => {});
    if (typeof createImageBitmap !== 'function') return;
    const id = viewId(S.room, portrait);
    viewMeta(id).then(async meta => {
      const ext = meta.avif && await AVIF ? '.avif' : '.webp';
      for (const u of [ASSET + id + ext, ASSET + id + '-l.webp', ASSET + id + '-d.webp', ASSET + id + '-m.webp', ASSET + id + '-b.webp']) bitmapOf(u);
    }).catch(() => {});
    if (S.structure && !S.textureUrl && !structures.has(S.structure)) bitmapOf(COAT + S.structure + '.webp');
    bitmapOf(ASSET + 'bluenoise64.webp');
  }
  function loadView(id) {
    if (views.has(id)) return views.get(id);
    const p = (async () => {
      const meta = await viewMeta(id);
      const ext = meta.avif && await AVIF ? '.avif' : '.webp';
      const [base, light, detail, mask, bleed] = await Promise.all([loadTex(ASSET + id + ext, true, true), loadTex(ASSET + id + '-l.webp', false, false),
        loadTex(ASSET + id + '-d.webp', false, true), loadTex(ASSET + id + '-m.webp', false, true), loadTex(ASSET + id + '-b.webp', false, false)]);
      return { id, meta, base, light, detail, mask, bleed };
    })();
    views.set(id, p); p.catch(() => views.delete(id));
    return p;
  }
  /* fade the frame towards the stage's own colour (read once from the page) and back: a room change in ~380 ms */
  function stageColour() {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const m = getComputedStyle(n).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const c = m[1].split(',').map(Number);
      if (c.length > 3 && c[3] === 0) continue;
      return [c[0] / 255, c[1] / 255, c[2] / 255];
    }
    return [0.11, 0.105, 0.1];
  }
  let fadeRun = 0;
  function fade(to, ms) {
    const id = ++fadeRun, from = U.uFade.value, t0 = performance.now();
    if (to > 0) { const c = stageColour(); U.uBg.value.set(c[0], c[1], c[2]); }
    return new Promise(res => {
      const step = () => {
        if (stage.destroyed || id !== fadeRun) return res();
        const k = Math.min(1, (performance.now() - t0) / ms), e = k * k * (3 - 2 * k);
        U.uFade.value = from + (to - from) * e; frameNow();
        if (k < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }
  /* when the browser is idle after a view is shown: the next room of the same group, and only that one */
  function prefetchNext() {
    const list = groupRooms(S.room), i = list.indexOf(S.room);
    if (i < 0 || list.length < 2) return;
    const next = list[(i + 1) % list.length];
    const go = () => { if (!stage || stage.destroyed) return; loadView(viewId(next, portrait)).catch(() => {}); };
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 5000 }); else setTimeout(go, 2000);
  }
  function useView(v) {
    view = v;
    const m = v.meta;
    U.tBase.value = v.base; U.tLight.value = v.light; U.tDetail.value = v.detail; U.tMask.value = v.mask; U.tBleed.value = v.bleed;
    U.uPhotoPx.value.set(m.w, m.h); U.uRho0.value = m.rho0; U.uBleedScale.value = m.bleedScale;
    U.uLightPx.value.set(m.light.w, m.light.h); U.uLightK.value.set(m.light.lmin, m.light.lmax - m.light.lmin, 1 / m.light.K);
    U.uChroma.value.set(m.light.cmin, m.light.cmax - m.light.cmin);
    const h = m.Hinv; U.uH.value.set(h[0][0], h[0][1], h[0][2], h[1][0], h[1][1], h[1][2], h[2][0], h[2][1], h[2][2]);
    U.uWipeRange.value.set(0, m.wall.size[0]);
    stage.wrap.setAttribute('aria-label', LABEL[LANG][S.room] || LABEL[LANG].living);
    push = 0; lastT = null;
    resize(stage.w, stage.h);
    dirty = true;
  }
  function useCoat(tl, which) {
    const t = tl.albedo; t.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
    U['tCoat' + which].value = t; U['uMetres' + which].value = tl.metres; U['uFlat' + which].value = tl.flat ? 1 : 0;
    if (which === 'A' || !U.uWipeMix.value) U.uCells.value = tl.cells || 128;      /* flecks across a tile: the coat's filter size */
  }
  /* the granule bake's program compiles in parallel before the first bake (KHR_parallel_shader_compile through
     compileAsync): compiled synchronously at the first bake it froze the main thread for seconds (ANGLE/D3D11). The
     warm material stays alive, so every later composition change reuses the program */
  let warmMat = null, warmP = null;
  function warmBake() {
    if (warmP) return warmP;
    warmP = (async () => {
      if (!R.compileAsync) return;
      const run0 = baker.run; let cap = null, tiny = null;
      baker.run = m => { if (!cap) cap = m; };                /* a dry run only captures the bake material */
      try { tiny = bakeGranules(T, baker, { colors: S.colors, density: S.density, seed: S.seed, size: 4, cells: 4, sparkle: 0 }); }
      finally { baker.run = run0; }
      if (tiny) tiny.dispose();
      if (!cap) return;
      warmMat = cap;
      const sc = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
      g.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
      const q = new T.Mesh(g, cap); q.frustumCulled = false; sc.add(q);
      const ta = baker.target(4, 4, { srgb: true }), td = baker.target(4, 4, {}), prev = R.getRenderTarget(), ps = [];
      try { for (const t of [ta, td]) { R.setRenderTarget(t); ps.push(R.compileAsync(sc, cam)); } }   /* the bake's own variants */
      finally { R.setRenderTarget(prev); }
      try { await Promise.all(ps); } catch (e) { /* then it compiles at the first bake */ }
      ta.dispose(); td.dispose(); g.dispose();
    })();
    return warmP;
  }
  async function coatTiles() {
    if (S.textureUrl) {
      const tex = await new Promise((res, rej) => new T.TextureLoader().load(S.textureUrl, res, undefined, rej));
      tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.generateMipmaps = true; tex.minFilter = T.LinearMipmapLinearFilter;
      return { albedo: tex, metres: S.textureSize, flat: true, dispose() { tex.dispose(); } };
    }
    if (S.structure) {                                     /* real fleck structure from the DV scans, recoloured live */
      try {
        const st = await loadStructure(T, S.structure);
        if (stage.destroyed) return null;
        const b = bakeScan(T, baker, st, S.colors);
        b.metres = st.meta.tileMetres * S.grain;
        return b;
      } catch (e) { console.warn('[dvatone 3d] fleck structure not loaded, synthetic granules instead:', S.structure); }
    }
    await warmBake();
    if (stage.destroyed) return null;
    const b = bakeGranules(T, baker, { colors: S.colors, density: S.density, seed: S.seed, size: 1024, cells: 128, sparkle: 0 });
    b.metres = b.cells * CELL_M * S.grain;
    return b;
  }

  function resize(w, h) {
    if (!U) return;
    applyPR();
    stage.stats.pr = curPR;
    const p = w / h < 0.95;
    if (p !== portrait) { portrait = p; ctl.setRoom(S.room, true); }
    if (!view) return;
    const ap = view.meta.w / view.meta.h, f = fitFor(w / h, ap);
    U.uFit.value.set(f[0], f[1], f[2], f[3]);
    U.uMinify.value = (view.meta.h * f[3]) / (h * curPR);
    dirty = true;
  }
  function update(t, dt) {
    if (!view) return;
    const step = lastT == null ? 0 : clamp(t - lastT, 0, 0.1); lastT = t;
    if (S.drift && !stage.reduced && push < 1) {
      push = Math.min(1, push + step / PUSH.secs);
      const e = push * push * (3 - 2 * push);
      U.uZoom.value = 1 + PUSH.amount * e;
      dirty = true;
    } else if (stage.reduced || !S.drift) U.uZoom.value = 1;
    if (wipe) {
      wipe.k += (dt || 0) / wipe.dur;
      const k = stage.reduced ? 1 : Math.min(1, wipe.k), e = k * k * (3 - 2 * k);
      U.uWipe.value = -0.4 + e * (view.meta.wall.size[0] + 0.8);
      U.uWipeMix.value = e;
      if (k >= 1) finishWipe();
      dirty = true;
    }
  }
  function render() {
    if (!view || (!dirty && !stage._fade)) return;
    R.setRenderTarget(null);
    R.render(scene, camera);
    dirty = false;
    stage.stats.rendered = (stage.stats.rendered || 0) + 1;
  }
  function frameNow() { dirty = true; render(); }

  function startWipe(next) {
    if (wipe) finishWipe();
    coatB = next; useCoat(next, 'B');
    U.uWipe.value = -0.4; U.uWipeMix.value = 0.0001;
    wipe = { k: 0, dur: 1.9 };
    dirty = true; stage.invalidate(); if (!stage.reduced) stage.start();
  }
  function finishWipe() {
    if (!wipe) return;
    wipe = null;
    const old = coatA; coatA = coatB; coatB = null;
    useCoat(coatA, 'A'); U.uWipeMix.value = 0;
    if (old && old !== coatA) old.dispose();
    dirty = true; stage.invalidate();
  }
  async function refreshCoat() {
    if (!stage || !stage.ready) return;
    const tok = ++coatTok;
    let tl;
    try { tl = await coatTiles(); } catch (e) { console.warn('[dvatone 3d] texture not loaded:', S.textureUrl); return; }
    if (!tl) return;
    if (stage.destroyed || tok !== coatTok) { tl.dispose(); return; }
    startWipe(tl);
  }

  const ctl = {
    el, get ready() { return started.then(p => p); }, start,
    setColors(colors, grain) { S.colors = normColors(colors); if (grain != null) S.grain = clamp(+grain || 1, 0.6, 1.8); S.textureUrl = null; return refreshCoat(); },
    setState(st = {}) {
      if (st.mix || st.colors) S.colors = normColors(st.mix || st.colors);
      if (st.grain != null) S.grain = clamp(+st.grain, 0.6, 1.8);
      if (st.density != null) S.density = clamp(+st.density, 0.4, 1);
      if (st.seed != null) S.seed = +st.seed;
      if (st.structure !== undefined) S.structure = st.structure || null;     /* a DV id with a structure file, or null: synthetic */
      S.textureUrl = null; return refreshCoat();
    },
    setTexture(url, metres) { S.textureUrl = url || null; if (metres) S.textureSize = +metres; return refreshCoat(); },
    async setRoom(name, orientation) {
      if (hero) name = 'hero-end';
      else if (!roomDef(name)) return;
      else name = roomDef(name).id;
      if (name === S.room && !orientation) return;
      S.room = name; const tok = ++roomTok;
      if (!stage) return;
      if (opts.poster !== false && !opts.poster) stage.setPoster(posterOf(name, portrait));
      if (!stage.ready) return;
      let v;
      try { v = await loadView(viewId(name, portrait)); await upload(v); } catch (e) { console.error('[dvatone 3d]', e); return; }
      if (stage.destroyed || tok !== roomTok) return;
      if (orientation) { useView(v); stage.invalidate(); return; }
      if (stage.reduced) { useView(v); frameNow(); prefetchNext(); return; }
      await fade(1, 170);                                        /* out to the stage colour */
      if (stage.destroyed) return;
      if (tok === roomTok) useView(v);                           /* a newer setRoom takes over from here */
      await fade(0, 210);                                        /* the new room in */
      prefetchNext();
    },
    get room() { return S.room; },
    stats() { return Object.assign({}, stage ? stage.stats : {}, { room: S.room, mode: 'photo', view: view && view.id, started: !!stage }); },
    renderFrame() { if (stage && stage.ready) frameNow(); },
    destroy() { if (stage) stage.destroy(); }
  };
  el.dv3d = ctl;
  /* start-up (07.10 night, the performance pass): at idle once the section is about two screens away, with the decoding
     done ahead (prewarm), instead of at mount; in view or near it at mount, and the hero's end frame: at once, as before */
  const r0 = el.getBoundingClientRect(), vh = window.innerHeight || 800;
  if (hero || typeof IntersectionObserver !== 'function' || (r0.bottom > -2 * vh && r0.top < 3 * vh)) { prewarm(); start(); }
  else {
    const near = new IntersectionObserver(es => {
      if (!es.some(e => e.isIntersecting)) return;
      near.disconnect();
      const go = () => { if (!stage) { prewarm(); start(); } };
      if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 1200 }); else setTimeout(go, 50);
    }, { rootMargin: '200% 0px' });
    near.observe(el);
  }
  return ctl;

  function dispose() {
    for (const p of views.values()) p.then(v => { v.base.dispose(); v.light.dispose(); v.detail.dispose(); v.mask.dispose(); v.bleed.dispose(); }).catch(() => {});
    coatA && coatA.dispose(); coatB && coatB.dispose();
    mat && mat.dispose(); warmMat && warmMat.dispose(); baker && baker.dispose();
  }
}

/* the hero story's end frame: the living room photograph, framed exactly like the story's final camera */
export function photoFrame(host, o = {}) {
  /* the hero story ends on DV 033: its own fleck structure (from the DV 033 photo) unless the caller sets another */
  return mountPhoto(host, Object.assign({ drift: false, swipe: false, structure: 'dv033' }, o, { view: o.view || 'hero-end' }));
}
