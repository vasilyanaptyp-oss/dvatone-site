/* Dvatone pack2 models: the 2.5 l can (matte black, copper lid, copper-foil label, rolled bead, plug well, paint
   inside), the Designer Box (rigid tray + hinged lid, foil logo, interior print, coated sample chips, colour fan
   with a brass rivet), the coated plinth. Units: decimetres. Everything is procedural; textures are drawn on
   canvases (labels) or baked on the GPU by core.bakeGranules (coatings). */
import { roundedBox } from '../core.js';

export const CAN = { R: 0.875, H: 1.93, COM: 0.965, PAINT_Y: 1.64, LID_Y: 1.83 };
/* the paint's granules: one repeat of the coating bake (128 granule cells) spans this many decimetres, so a granule is
   about 1.7 mm: the multicolour grain shows at close range, in the can and wherever the paint is poured */
export const PAINT_TILE = 2.2;
export const BOX = { W: 3.1, D: 2.2, H: 0.85, COM: 0.425, LW: 3.16, LD: 2.26, BED: 0.36, HINGE_Y: 0.85, HINGE_Z: -1.13 };
export const FAN = { L: 2.45, W: 0.5, T: 0.01, PIV: 0.22, N: 12 };

/* linear copper F0, tuned so that a mid reflection reads as the brand copper (#c4935c ... #dcba94), never pink */
export const COPPER = [0.83, 0.53, 0.32];
const BRASS = [0.86, 0.69, 0.36];
const TIN = [0.80, 0.74, 0.60];

const lin = (T, r, g, b) => new T.Color().setRGB(r, g, b, T.LinearSRGBColorSpace);

/* ---------------- logo + text helpers ---------------- */
let logoP = null;
export function loadLogo(url) {
  if (logoP) return logoP;
  logoP = fetch(url).then(r => { if (!r.ok) throw new Error('logo ' + r.status); return r.text(); }).then(svg => {
    /* solid white mask of the mark (the gradient in the file imitates foil; the real foil is lit by the scene) */
    svg = svg.replace('<svg ', '<svg width="2193" height="373" ').replace(/fill:\s*url\(#linear-gradient\)/, 'fill:#ffffff');
    const url2 = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => { URL.revokeObjectURL(url2); res(im); }; im.onerror = rej; im.src = url2; });
  });
  return logoP;
}
export async function fontsReady() {
  try { await Promise.race([document.fonts.load('600 40px Manrope'), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* system font */ }
}
function spaced(g, text, cx, y, sp) {
  if ('letterSpacing' in g) { g.letterSpacing = sp + 'px'; g.textAlign = 'center'; g.fillText(text, cx + sp / 2, y); g.letterSpacing = '0px'; return; }
  const ch = [...text]; let w = 0; ch.forEach(c => (w += g.measureText(c).width + sp)); w -= sp;
  let x = cx - w / 2; g.textAlign = 'left'; ch.forEach(c => { g.fillText(c, x, y); x += g.measureText(c).width + sp; });
}
function fitFont(g, text, weight, size, maxW, sp) {
  let fs = size;
  for (let i = 0; i < 14; i++) { g.font = weight + ' ' + fs + 'px Manrope, system-ui, sans-serif'; if (g.measureText(text).width + sp(fs) * text.length <= maxW) break; fs = Math.floor(fs * 0.93); }
  return fs;
}
/* draws the foil artwork twice: albedo canvas (copper F0 on black) and data canvas (R bump, G roughness, B metalness) */
function foilPair(W, H, base, draw) {
  const a = document.createElement('canvas'), d = document.createElement('canvas');
  a.width = d.width = W; a.height = d.height = H;
  const ga = a.getContext('2d'), gd = d.getContext('2d');
  ga.fillStyle = base.albedo; ga.fillRect(0, 0, W, H);
  gd.fillStyle = base.data; gd.fillRect(0, 0, W, H);
  const cu = 'rgb(' + COPPER.map(v => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))).join(',') + ')';
  draw(ga, cu, false);
  /* R: soft raised shoulder around the foil (added, so roughness and metalness stay crisp), then the crisp foil */
  gd.save(); gd.globalCompositeOperation = 'lighter'; gd.filter = 'blur(' + Math.max(1, Math.round(W / 900)) + 'px)'; draw(gd, 'rgb(160,0,0)', true); gd.restore();
  draw(gd, 'rgb(235,' + Math.round(0.2 * 255) + ',255)', true);
  return { a, d };
}
function drawLogo(g, logo, color, x, y, w) {
  const h = w * 18.67 / 109.64;
  if (!logo) { g.fillStyle = color; g.font = '600 ' + Math.round(h * 1.15) + 'px Manrope, sans-serif'; spaced(g, 'DVATONE', x + w / 2, y + h, h * 0.2); return h; }
  /* tint the white mask with the requested colour via an offscreen canvas */
  const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const t = c.getContext('2d'); t.drawImage(logo, 0, 0, w, h); t.globalCompositeOperation = 'source-in'; t.fillStyle = color; t.fillRect(0, 0, w, h);
  g.drawImage(c, x, y);
  return h;
}

/* can label: the full circumference (u = 0.5 faces the viewer), body height 0.09..1.775 */
export function canLabel(logo, txt, size = 2048) {
  const W = size, H = Math.round(W * (1.685 / (2 * Math.PI * CAN.R))), cx = W / 2;
  return foilPair(W, H, { albedo: '#0d0d0e', data: 'rgb(0,' + Math.round(0.56 * 255) + ',0)' }, (g, col, isData) => {
    g.fillStyle = col;
    const lw = W * 0.2, lx = cx - lw / 2, ly = H * 0.36;
    const lh = drawLogo(g, logo, col, lx, ly, lw);
    g.textBaseline = 'alphabetic';
    const sp = fs => fs * 0.32;
    const fs = fitFont(g, txt.line, '600', Math.round(H * 0.03), W * 0.23, sp);
    g.font = '600 ' + fs + 'px Manrope, system-ui, sans-serif';
    spaced(g, txt.line, cx, ly + lh + H * 0.095, sp(fs));
    g.fillRect(cx - W * 0.012, ly + lh + H * 0.135, W * 0.024, Math.max(2, H * 0.0035));
    g.font = '500 ' + Math.round(H * 0.04) + 'px Manrope, system-ui, sans-serif';
    spaced(g, txt.vol, cx, ly + lh + H * 0.215, H * 0.006);
    /* two foil hairlines around the whole can */
    const t = Math.max(2, Math.round(H * 0.0042));
    g.fillRect(0, Math.round(H * 0.155), W, t);
    g.fillRect(0, Math.round(H * 0.845), W, t);
  });
}
/* lid top of the box: logo + caption + a fine foil frame */
export function boxLidLabel(logo, txt, size = 2048) {
  const W = size, H = Math.round(W * BOX.LD / BOX.LW), cx = W / 2;
  return foilPair(W, H, { albedo: '#0e0e0e', data: 'rgb(0,' + Math.round(0.8 * 255) + ',0)' }, (g, col) => {
    g.fillStyle = col;
    const lw = W * 0.5, ly = H * 0.38;
    const lh = drawLogo(g, logo, col, cx - lw / 2, ly, lw);
    if (txt.box) {
      const sp = fs => fs * 0.42;
      const fs = fitFont(g, txt.box, '600', Math.round(H * 0.045), W * 0.4, sp);
      g.font = '600 ' + fs + 'px Manrope, system-ui, sans-serif'; g.textBaseline = 'alphabetic';
      spaced(g, txt.box, cx, ly + lh + H * 0.15, sp(fs));
    }
    const m = W * 0.035, t = Math.max(2, W * 0.0018);
    g.strokeStyle = col; g.lineWidth = t; g.strokeRect(m, m, W - 2 * m, H - 2 * m);
  });
}
/* inside of the lid: a quiet foil line, seen when the lid stands open */
export function boxInsideLabel(logo, txt, size = 1024) {
  const W = Math.min(1024, size), H = Math.round(W * BOX.LD / BOX.LW), cx = W / 2;
  return foilPair(W, H, { albedo: '#2a2622', data: 'rgb(0,' + Math.round(0.86 * 255) + ',0)' }, (g, col) => {
    g.fillStyle = col;
    const lw = W * 0.22, ly = H * 0.42;
    const lh = drawLogo(g, logo, col, cx - lw / 2, ly, lw);
    if (txt.inside) {
      const sp = fs => fs * 0.3;
      const fs = fitFont(g, txt.inside, '500', Math.round(H * 0.032), W * 0.6, sp);
      g.font = '500 ' + fs + 'px Manrope, system-ui, sans-serif'; g.textBaseline = 'alphabetic';
      spaced(g, txt.inside, cx, ly + lh + H * 0.12, sp(fs));
    }
  });
}
/* cover card of the fan: black with the copper logo, like the client's real colour fan */
export function coverLabel(logo, size = 1024) {
  const W = Math.min(1024, size), H = Math.round(W * FAN.W / FAN.L);
  return foilPair(W, H, { albedo: '#0c0c0c', data: 'rgb(0,' + Math.round(0.62 * 255) + ',0)' }, (g, col) => {
    const lw = W * 0.5;
    drawLogo(g, logo, col, W * 0.36, H / 2 - lw * 18.67 / 109.64 / 2, lw);
  });
}
export function canvasTex(T, R, cv, srgb) {
  const t = new T.CanvasTexture(cv);
  t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace;
  t.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy());
  t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter;
  return t;
}
/* soft-touch paper grain (tiling noise) used as a bump map */
export function paperGrain(T, R) {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), im = g.createImageData(N, N);
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const v = new Float32Array(N * N);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  /* two-scale periodic blur for a felted paper look */
  const blur = (src, r) => {
    const o = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0, n = 0;
      for (let k = -r; k <= r; k++) { a += src[y * N + ((x + k + N) % N)]; n++; }
      o[y * N + x] = a / n;
    }
    const o2 = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let a = 0, n = 0;
      for (let k = -r; k <= r; k++) { a += o[((y + k + N) % N) * N + x]; n++; }
      o2[y * N + x] = a / n;
    }
    return o2;
  };
  const b1 = blur(v, 1), b3 = blur(v, 4);
  for (let i = 0; i < v.length; i++) {
    const x = 0.5 + (b1[i] - 0.5) * 1.6 + (b3[i] - 0.5) * 2.2;
    const q = Math.max(0, Math.min(255, Math.round(x * 255)));
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = q; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.colorSpace = T.NoColorSpace;
  t.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy());
  return t;
}

/* brushed metal: fine circumferential lines (the lathe's u runs around the can), as a roughness map (G channel) */
function brushedMap(T, R) {
  const W = 1024, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), im = g.createImageData(W, H);
  let s = 987654321;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const rows = new Float32Array(H);
  for (let y = 0; y < H; y++) rows[y] = rnd();
  for (let y = 0; y < H; y++) {
    /* each line keeps its own value along u with a slow drift and a little grain */
    const base = 0.62 + 0.3 * (rows[y] * 0.65 + rows[(y + 1) % H] * 0.2 + rows[(y + H - 1) % H] * 0.15);
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(1, base + (rnd() - 0.5) * 0.08 + 0.04 * Math.sin(x / W * Math.PI * 6 + rows[y] * 9)));
      const k = (y * W + x) * 4, q = Math.round(v * 255);
      im.data[k] = q; im.data[k + 1] = q; im.data[k + 2] = q; im.data[k + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  const t = new T.CanvasTexture(c);
  t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(1, 6); t.colorSpace = T.NoColorSpace;
  t.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy());
  return t;
}
/* ---------------- materials ---------------- */
export function makeMaterials(T, R, tex) {
  const P = o => new T.MeshPhysicalMaterial(o);
  const m = {};
  const brushed = brushedMap(T, R);
  m.canBody = P({ map: tex.canA, roughnessMap: tex.canD, metalnessMap: tex.canD, bumpMap: tex.canD, bumpScale: 1.2,
    roughness: 1, metalness: 1, clearcoat: 0.32, clearcoatRoughness: 0.38 });
  m.blackMetal = P({ color: lin(T, 0.012, 0.012, 0.013), metalness: 0.75, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3 });
  m.copper = P({ color: lin(T, ...COPPER), metalness: 1, roughness: 0.27 });
  /* the lid and the tin parts are brushed: the highlight stretches around them in fine rings */
  m.copperLid = P({ color: lin(T, ...COPPER), metalness: 1, roughness: 0.34, roughnessMap: brushed, anisotropy: 0.65, anisotropyRotation: 0 });
  m.tin = P({ color: lin(T, ...TIN), metalness: 1, roughness: 0.42, roughnessMap: brushed, anisotropy: 0.55, anisotropyRotation: 0 });
  m.grip = P({ color: lin(T, 0.01, 0.01, 0.01), roughness: 0.72 });
  m.paper = P({ color: lin(T, 0.0085, 0.0085, 0.009), roughness: 0.74, bumpMap: tex.paper, bumpScale: 0.35,
    sheen: 0.6, sheenRoughness: 0.55, sheenColor: lin(T, 0.05, 0.048, 0.046) });
  m.lidTop = P({ map: tex.lidA, roughnessMap: tex.lidD, metalnessMap: tex.lidD, bumpMap: tex.lidD, bumpScale: 0.9,
    roughness: 1, metalness: 1, sheen: 0.5, sheenRoughness: 0.55, sheenColor: lin(T, 0.05, 0.048, 0.046) });
  m.inside = P({ color: lin(T, 0.024, 0.02, 0.016), roughness: 0.86, bumpMap: tex.paper, bumpScale: 0.25 });
  m.insideLid = P({ map: tex.inA, roughnessMap: tex.inD, metalnessMap: tex.inD, bumpMap: tex.inD, bumpScale: 0.6, roughness: 1, metalness: 1 });
  m.edge = P({ color: lin(T, 0.03, 0.028, 0.026), roughness: 0.8 });
  m.card = P({ color: lin(T, 0.8, 0.77, 0.72), roughness: 0.9 });
  m.cover = P({ map: tex.covA, roughnessMap: tex.covD, metalnessMap: tex.covD, bumpMap: tex.covD, bumpScale: 0.6, roughness: 1, metalness: 1 });
  m.brass = P({ color: lin(T, ...BRASS), metalness: 1, roughness: 0.22 });
  return m;
}

/* Coating material (plinth, chips, fan strips, the paint). Granule albedo + data from core.bakeGranules.
   uMix/uOld cross-dissolve granule by granule when the composition changes; the paint adds a wet clearcoat
   whose normal slowly undulates (the living sheen), climbs the can wall (meniscus) and ripples where clicked. */
const COAT_HEAD = `
uniform float uMix; uniform sampler2D uOld; uniform float uSwirl; uniform float uTime; uniform vec4 uRips[4]; uniform float uSheen; uniform float uRad;
varying vec2 vDisc; varying vec3 vTx; varying vec3 vTz;
float paintH(vec2 p, float t){
  float h = 0.010 * sin(p.x * 2.1 + t * 0.13 + 1.3 * sin(p.y * 1.6 - t * 0.07))
          + 0.008 * sin(p.y * 2.7 - t * 0.10 + 1.1 * sin(p.x * 1.9 + t * 0.05))
          + 0.004 * sin((p.x + p.y) * 5.3 + t * 0.21);
  for (int k = 0; k < 4; k++) {                 /* up to four touches ring out at once */
    vec4 R = uRips[k]; float dt = t - R.z;
    if (dt > 0.0 && dt < 7.0) {
      float d = length(p - R.xy), front = dt * 0.55;
      h += R.w * 0.016 * sin((d - front) * 24.0) * exp(-abs(d - front) * 5.0) * exp(-dt * 0.75) * smoothstep(0.0, 0.25, dt);
    }
  }
  return h;
}
/* stirring: every touch twists the granules around it, and the twist eases out as the thick paint settles */
vec2 stir(vec2 p, float t){
  for (int k = 0; k < 4; k++) {
    vec4 R = uRips[k]; float dt = t - R.z;
    if (dt > 0.0 && dt < 9.0) {
      vec2 o = p - R.xy;
      float a = R.w * 1.4 * exp(-dot(o, o) * 7.0) * exp(-dt * 0.5) * (1.0 - exp(-dt * 5.0));
      float c = cos(a), s = sin(a); p = R.xy + mat2(c, s, -s, c) * o;
    }
  }
  return p;
}`;
const COAT_MAP = `
#ifdef USE_MAP
  vec2 uvS = uSheen > 0.5 ? stir(vDisc, uTime) * (uRad / ${PAINT_TILE.toFixed(3)}) : vMapUv;
  vec4 sampledDiffuseColor = texture2D( map, uvS );
  if (uMix < 0.999) {
    float r = clamp(length(vDisc), 0.0, 1.0);
    float ang = uSwirl * (1.0 - uMix) * (1.0 - r) * 2.6;
    float cs = cos(ang), sn = sin(ang);
    vec4 oldC = texture2D(uOld, mat2(cs, sn, -sn, cs) * vMapUv);
    float g = texture2D(bumpMap, vMapUv).r;
    float front = uMix * 1.5 - (uSwirl > 0.5 ? r * 0.5 : 0.25);
    float k = smoothstep(0.0, 0.18, front - (1.0 - g) * 0.3);
    sampledDiffuseColor = mix(oldC, sampledDiffuseColor, k);
  }
  diffuseColor *= sampledDiffuseColor;
#endif`;
const COAT_CC = `
#ifdef USE_CLEARCOAT
  {
    vec2 p = vDisc; float e = 0.01;
    float h0 = paintH(p, uTime);
    vec2 gr = vec2(paintH(p + vec2(e, 0.0), uTime) - h0, paintH(p + vec2(0.0, e), uTime) - h0) / e;
    float r = length(p);
    gr += (p / max(r, 1e-3)) * 0.85 * exp((r - 1.0) / 0.035);
    clearcoatNormal = normalize(nonPerturbedNormal - (gr.x * vTx + gr.y * vTz) * uSheen);
  }
#endif`;
export function coatMaterial(T, bake, o = {}) {
  const U = {
    uMix: { value: 1 }, uOld: { value: bake.albedo }, uSwirl: { value: o.swirl ? 1 : 0 }, uTime: { value: 0 },
    uRips: { value: [0, 1, 2, 3].map(() => new T.Vector4(0, 0, -100, 0)) }, uSheen: { value: o.paint ? 1 : 0 }, uRad: { value: o.radius || 1 }
  };
  const m = new T.MeshPhysicalMaterial(Object.assign({
    map: bake.albedo, bumpMap: bake.data, bumpScale: o.bump == null ? 0.5 : o.bump,
    roughness: o.roughness == null ? 0.72 : o.roughness, metalness: 0
  }, o.paint ? { clearcoat: 1, clearcoatRoughness: 0.06, roughness: 0.46 } : {}, o.mat || {}));
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uRad; varying vec2 vDisc; varying vec3 vTx; varying vec3 vTz;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDisc = position.xz / uRad;\nvTx = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);\nvTz = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COAT_HEAD)
      .replace('#include <map_fragment>', COAT_MAP)
      .replace('#include <clearcoat_normal_fragment_maps>', COAT_CC);
  };
  m.customProgramCacheKey = () => 'dvcoat' + (o.paint ? 'P' : 'C');
  m.userData.U = U;
  return m;
}

/* ---------------- geometry helpers ---------------- */
function lathe(T, pts, mat, seg = 128) {
  const m = new T.Mesh(new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg), mat);
  m.castShadow = true; m.receiveShadow = true; return m;
}
function rrShape(T, w, h, r, path) {
  const s = path ? new T.Path() : new T.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
/* merge non-indexed geometries, sorting triangles into material groups by classify(centroid, normal) -> group */
function sortTris(T, geos, classify, nGroups) {
  const buckets = []; for (let i = 0; i < nGroups; i++) buckets.push({ p: [], n: [], u: [] });
  const c = new T.Vector3(), n = new T.Vector3();
  for (let g of geos) {
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i += 3) {
      c.set(0, 0, 0); n.set(0, 0, 0);
      for (let k = 0; k < 3; k++) { c.x += P.getX(i + k) / 3; c.y += P.getY(i + k) / 3; c.z += P.getZ(i + k) / 3; n.x += N.getX(i + k); n.y += N.getY(i + k); n.z += N.getZ(i + k); }
      n.normalize();
      const b = buckets[classify(c, n)];
      for (let k = 0; k < 3; k++) {
        b.p.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k));
        b.n.push(N.getX(i + k), N.getY(i + k), N.getZ(i + k));
        b.u.push(U ? U.getX(i + k) : 0, U ? U.getY(i + k) : 0);
      }
    }
  }
  const out = new T.BufferGeometry(), p = [], nn = [], u = [];
  let start = 0;
  buckets.forEach((b, gi) => { p.push(...b.p); nn.push(...b.n); u.push(...b.u); const cnt = b.p.length / 3; out.addGroup(start, cnt, gi); start += cnt; });
  out.setAttribute('position', new T.Float32BufferAttribute(p, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(nn, 3));
  out.setAttribute('uv', new T.Float32BufferAttribute(u, 2));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
/* rigid tray: walls with outer/inner/rim groups (+ floor). y from 0 to h */
function trayGeometry(T, w, d, h, wall, r, floor) {
  const shape = rrShape(T, w, d, r); shape.holes.push(rrShape(T, w - 2 * wall, d - 2 * wall, Math.max(0.004, r - wall), true));
  const walls = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
  const geos = [walls];
  if (floor) geos.push(new T.ExtrudeGeometry(rrShape(T, w, d, r), { depth: floor, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2));
  const hw = w / 2 - wall * 0.5, hd = d / 2 - wall * 0.5;
  return sortTris(T, geos, (c, n) => {
    if (n.y > 0.5) return c.y > h - 1e-3 ? 2 : 1;             /* rim : inner floor */
    if (n.y < -0.5) return 0;                                 /* bottom */
    const out = Math.abs(c.x) > hw || Math.abs(c.z) > hd;   /* outside of the wall mid-line */
    return out ? 0 : 1;
  }, 3);
}

/* ---------------- can ---------------- */
export function makeCan(T, mats, paintMat) {
  const { R } = CAN, root = new T.Group(), body = new T.Group();
  body.position.y = -CAN.COM; root.add(body);
  const parts = [];
  const add = (m, cast = true) => { m.castShadow = cast; m.receiveShadow = true; body.add(m); parts.push(m); return m; };
  add(lathe(T, [[0, 0.012], [R - 0.05, 0.012], [R - 0.03, 0.0], [R + 0.006, 0.0], [R + 0.03, 0.02], [R + 0.036, 0.05], [R + 0.022, 0.08], [R + 0.002, 0.095], [R, 0.1]], mats.blackMetal));
  const cyl = new T.CylinderGeometry(R, R, 1.685, 160, 1, true, Math.PI, Math.PI * 2);
  const bodyMesh = add(new T.Mesh(cyl, mats.canBody)); bodyMesh.position.y = 0.09 + 1.685 / 2;
  add(lathe(T, [[R, 1.77], [R + 0.012, 1.778], [R + 0.03, 1.8], [R + 0.036, 1.83], [R + 0.026, 1.856], [R + 0.004, 1.868], [R - 0.022, 1.862], [R - 0.04, 1.845], [R - 0.048, 1.83]], mats.blackMetal));
  add(lathe(T, [[R - 0.048, 1.83], [R - 0.058, 1.79], [R - 0.062, 1.735], [R - 0.075, 1.722], [R - 0.105, 1.722], [R - 0.118, 1.735], [R - 0.122, 1.8],
    [R - 0.13, 1.83], [R - 0.142, 1.838], [R - 0.155, 1.832], [R - 0.16, 1.81], [R - 0.162, CAN.PAINT_Y - 0.02]], mats.tin), false);
  /* paint */
  const pr = R - 0.161, pg = new T.CircleGeometry(pr, 120).rotateX(-Math.PI / 2);
  const tile = PAINT_TILE, uv = pg.attributes.uv, pp = pg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pp.getX(i) / tile, pp.getZ(i) / tile);
  const paint = new T.Mesh(pg, paintMat); paint.position.y = CAN.PAINT_Y; paint.receiveShadow = true; body.add(paint);
  paintMat.userData.U.uRad.value = pr;
  /* lid: closed profile (underside out, plug, curl, groove, centre panel back in) */
  const lid = new T.Group(); lid.position.y = CAN.LID_Y; body.add(lid);
  const lidMesh = lathe(T, [[0, -0.010], [R - 0.175, -0.012], [R - 0.165, -0.085], [R - 0.112, -0.1], [R - 0.062, -0.085], [R - 0.052, -0.012], [R - 0.03, -0.008],
    [R - 0.012, -0.012], [R - 0.003, 0.0], [R - 0.01, 0.016], [R - 0.03, 0.022], [R - 0.05, 0.014], [R - 0.06, 0.0], [R - 0.07, -0.07], [R - 0.112, -0.082],
    [R - 0.155, -0.07], [R - 0.165, 0.0], [R - 0.185, 0.009], [R - 0.30, 0.012], [R - 0.31, 0.006], [R - 0.33, 0.006], [R - 0.34, 0.012], [0, 0.014]], mats.copperLid, 128);
  lid.add(lidMesh); parts.push(lidMesh);
  /* folded wire bail, ears and grip on the back */
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, ph = -Math.PI * t, r = R + 0.035 + 0.025 * Math.sin(Math.PI * t);
    pts.push(new T.Vector3(r * Math.cos(ph), 1.62 - 0.42 * Math.sin(Math.PI * t), r * Math.sin(ph)));
  }
  add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 120, 0.011, 10, false), mats.blackMetal));
  const grip = add(new T.Mesh(new T.CylinderGeometry(0.036, 0.036, 0.42, 28), mats.grip)); grip.rotation.z = Math.PI / 2; grip.position.set(0, 1.2, -(R + 0.06));
  [-1, 1].forEach(s => { const ear = add(new T.Mesh(new T.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.blackMetal)); ear.rotation.z = -s * Math.PI / 2; ear.position.set(s * (R - 0.005), 1.62, 0); ear.scale.set(1, 0.35, 1); });
  return { root, body, lid, paint, parts, half: new T.Vector3(R + 0.04, CAN.H / 2, R + 0.1) };
}

/* ---------------- box + fan ---------------- */
export function makeBox(T, mats, chipMats, stripMats) {
  const root = new T.Group(), body = new T.Group();
  body.position.y = -BOX.COM; root.add(body);
  const parts = [];
  const tray = new T.Mesh(trayGeometry(T, BOX.W, BOX.D, 0.6, 0.028, 0.03, 0.03), [mats.paper, mats.inside, mats.edge]);
  tray.castShadow = tray.receiveShadow = true; body.add(tray); parts.push(tray);
  /* fan bed */
  const bed = new T.Mesh(roundedBox(T, BOX.W - 0.06, 0.03, BOX.D - 0.06, 0.01, 1), mats.inside);
  bed.position.y = BOX.BED - 0.015; bed.receiveShadow = true; body.add(bed);
  /* hinged lid: pivot on the back top edge */
  const hinge = new T.Group(); hinge.position.set(0, BOX.HINGE_Y, BOX.HINGE_Z); body.add(hinge);
  const lid = new T.Group(); lid.position.set(0, -BOX.HINGE_Y, -BOX.HINGE_Z); hinge.add(lid);
  const skirt = new T.Mesh(trayGeometry(T, BOX.LW, BOX.LD, 0.31, 0.026, 0.032, 0), [mats.paper, mats.inside, mats.edge]);
  skirt.position.y = 0.51; skirt.castShadow = skirt.receiveShadow = true; lid.add(skirt); parts.push(skirt);
  const top = new T.Mesh(roundedBox(T, BOX.LW, 0.03, BOX.LD, 0.012, 2), mats.lidTop);
  top.position.y = 0.835; top.castShadow = top.receiveShadow = true; lid.add(top); parts.push(top);
  /* the label covers the top face exactly: box-projected uv (metres) -> 0..1 */
  const tu = top.geometry.attributes.uv, tp = top.geometry.attributes.position, tn = top.geometry.attributes.normal;
  for (let i = 0; i < tu.count; i++) {
    if (tn.getY(i) > 0.5) tu.setXY(i, tp.getX(i) / BOX.LW + 0.5, 0.5 - tp.getZ(i) / BOX.LD);
    else tu.setXY(i, 0.003, 0.003);
  }
  const inside = new T.Mesh(new T.PlaneGeometry(BOX.LW - 0.06, BOX.LD - 0.06), mats.insideLid);
  inside.rotation.x = Math.PI / 2; inside.position.y = 0.8195; lid.add(inside);
  /* sample chips: two rows of coated plaques */
  const chipGeo = roundedBox(T, 0.72, 0.035, 0.66, 0.008, 1);
  const cu = chipGeo.attributes.uv; for (let i = 0; i < cu.count; i++) cu.setXY(i, cu.getX(i) / 0.6, cu.getY(i) / 0.6);
  const chips = [];
  chipMats.forEach((m, i) => {
    const c = new T.Mesh(chipGeo, m), row = i < 3 ? -1 : 1, col = (i % 3) - 1;
    c.position.set(col * 0.92, BOX.BED + 0.018, row * 0.71);
    c.rotation.y = (i * 0.37 % 1 - 0.5) * 0.06; c.castShadow = c.receiveShadow = true;
    body.add(c); chips.push(c);
  });
  const fan = makeFan(T, mats, stripMats);
  fan.root.position.set(-1.22, BOX.BED + 0.005, 0.0);
  body.add(fan.root);
  return { root, body, hinge, lid, fan, chips, parts, half: new T.Vector3(BOX.LW / 2, BOX.H / 2, BOX.LD / 2) };
}

export function makeFan(T, mats, stripMats) {
  /* strips along +x from the rivet (pivot at the origin), stacked along local +z; lying flat: rotation.x = -pi/2 */
  const root = new T.Group(); root.rotation.x = -Math.PI / 2;
  const { L, W, T: th, PIV } = FAN;
  const shape = new T.Shape(), x0 = -PIV, x1 = L - PIV, y0 = -W / 2, y1 = W / 2, r0 = 0.05, r1 = 0.06;
  shape.moveTo(x0 + r0, y0); shape.lineTo(x1 - r1, y0); shape.quadraticCurveTo(x1, y0, x1, y0 + r1); shape.lineTo(x1, y1 - r1);
  shape.quadraticCurveTo(x1, y1, x1 - r1, y1); shape.lineTo(x0 + r0, y1); shape.quadraticCurveTo(x0, y1, x0, y1 - r0); shape.lineTo(x0, y0 + r0); shape.quadraticCurveTo(x0, y0, x0 + r0, y0);
  shape.holes.push(new T.Path().absarc(0, 0, 0.03, 0, Math.PI * 2, true));
  const g = new T.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false, curveSegments: 8 });
  const tile = 0.5, u = g.attributes.uv;
  for (let i = 0; i < u.count; i++) u.setXY(i, u.getX(i) / tile, u.getY(i) / tile);
  const gc = g.clone(), uc = gc.attributes.uv, pc = gc.attributes.position;
  for (let i = 0; i < uc.count; i++) uc.setXY(i, (pc.getX(i) - x0) / L, (pc.getY(i) - y0) / W);
  const strips = [];
  stripMats.forEach((m, i) => {
    const s = new T.Group(); s.position.z = i * (th + 0.0012); root.add(s);
    const mesh = new T.Mesh(g, [m, mats.card]); mesh.castShadow = mesh.receiveShadow = true; s.add(mesh);
    strips.push({ group: s, mesh, i, a: 0, lift: 0, z0: s.position.z });
  });
  const coverG = new T.Group(); coverG.position.z = stripMats.length * (th + 0.0012); root.add(coverG);
  const cover = new T.Mesh(gc, [mats.cover, mats.edge]); cover.castShadow = cover.receiveShadow = true; coverG.add(cover);
  const rivet = new T.Mesh(new T.CylinderGeometry(0.034, 0.034, (stripMats.length + 2) * (th + 0.0012) + 0.02, 24), mats.brass);
  rivet.rotation.x = Math.PI / 2; rivet.position.z = (stripMats.length + 1) * (th + 0.0012) / 2; rivet.castShadow = true; root.add(rivet);
  const capG = new T.SphereGeometry(0.052, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap1 = new T.Mesh(capG, mats.brass); cap1.rotation.x = Math.PI / 2; cap1.scale.set(1, 0.35, 1); cap1.position.z = coverG.position.z + th + 0.001; root.add(cap1);
  const cap2 = new T.Mesh(capG, mats.brass); cap2.rotation.x = -Math.PI / 2; cap2.scale.set(1, 0.35, 1); cap2.position.z = -0.001; root.add(cap2);
  return { root, strips, cover: { group: coverG, mesh: cover, a: 0 }, rivet };
}

/* ---------------- plinth ---------------- */
export function makePlinth(T, mat, Rp, Hp, tile) {
  const g = new T.Group();
  const ch = 0.035;
  const top = new T.CircleGeometry(Rp - ch, 160).rotateX(-Math.PI / 2);
  const tu = top.attributes.uv, tp = top.attributes.position;
  for (let i = 0; i < tu.count; i++) tu.setXY(i, tp.getX(i) / tile, tp.getZ(i) / tile);
  const side = new T.CylinderGeometry(Rp, Rp, Hp - ch, 200, 1, true);
  const su = side.attributes.uv, sp = side.attributes.position;
  for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) * 2 * Math.PI * Rp / tile, (sp.getY(i) + (Hp - ch) / 2) / tile);
  side.translate(0, (Hp - ch) / 2, 0);
  const bev = new T.LatheGeometry([new T.Vector2(Rp, Hp - ch), new T.Vector2(Rp - ch * 0.3, Hp - ch * 0.3), new T.Vector2(Rp - ch, Hp)], 200);
  const bu = bev.attributes.uv, bp = bev.attributes.position;
  for (let i = 0; i < bu.count; i++) bu.setXY(i, Math.atan2(bp.getX(i), bp.getZ(i)) * Rp / tile, bp.getY(i) / tile);
  const mTop = new T.Mesh(top, mat); mTop.position.y = Hp;
  const mSide = new T.Mesh(side, mat), mBev = new T.Mesh(bev, mat);
  [mTop, mSide, mBev].forEach(m => { m.receiveShadow = true; m.castShadow = true; g.add(m); });
  mTop.castShadow = false;
  return g;
}
