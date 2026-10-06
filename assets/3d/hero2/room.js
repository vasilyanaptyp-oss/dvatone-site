/* Dvatone hero v2: the calm room revealed by the scroll story.
   Millimetres; the coated feature wall is the plane z = 0 (wall.js), the macro spot M is the origin.
   Procedural and light: a few planes and two objects. Light: one sun through a tall window on the left wall
   (it rakes across the coating), soft sky fill. Shadows are analytic (window opening, bench box, vase
   capsule tested along the sun ray), corner occlusion is analytic too: no shadow maps, nothing to download. */
import { roundedBox } from '../core.js';

export const ROOM = {
  x0: -1700, x1: 2500, floor: -1300, ceil: 1500, depth: 5200,
  win: { z0: 405, z1: 1215, y0: -1200, y1: 970 },                   /* window opening in the left wall (x = x0) */
  bench: { x0: -650, x1: 1050, h: 400, d: 380 },
  vase: { x: 820, z: 190, r: 120, h: 540 },
  sun: [-0.84, 0.42, 0.34]                                           /* direction to the sun (normalised in use) */
};

/* tone curve shared by every room surface (procedural room, furnished room, coated wall) */
export const TONE_GLSL = `
/* Khronos PBR Neutral (as three.js) with a hue-keeping toe for the room: the shadow offset scales the colour
   instead of being subtracted from every channel. The subtractive toe empties the blue channel of a warm
   coating in shade and turns honey into mustard; scaled, the coating keeps the chroma of its swatches.
   toe 0 = no shadow offset at all (identity below 0.76, as the Interiors v2 rooms): used by the furnished room. */
vec3 dvTone(vec3 color, float keep, float toe){
#ifdef TONE_MAPPING
  color *= toneMappingExposure;
  float x = min(color.r, min(color.g, color.b));
  float off = (x < 0.08 ? x - 6.25 * x * x : 0.04) * toe;
  float y = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(color - off, color * (max(y - off, 0.0) / max(y, 1e-5)), keep);
  const float sc = 0.76;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < sc) return color;
  const float d = 1.0 - sc;
  float np = 1.0 - d * d / (peak + d - sc);
  color *= np / peak;
  float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
  return mix(color, vec3(np), g);
#else
  return color;
#endif
}
`;

/* the photo frame's tone curve (Interiors v2 photo mode, photoroom.js): identity below 0.55, then a long roll-off
   towards 0.97 that scales the three channels together, a trace of desaturation in the brightest light. The
   furnished room uses it, so its crossfade into the photograph is seamless */
export const TONE_PHOTO_GLSL = `
vec3 dvTonePhoto(vec3 c){
  const float S = 0.55; const float A = 0.97; const float D = 0.03;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < S) return c;
  float np = A - (A - S) * (A - S) / (peak - S + (A - S));
  c *= np / peak;
  float g = 1.0 - 1.0 / (D * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}
`;

/* GLSL shared by the room surfaces and the coated wall */
export const ROOM_GLSL = `
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uSky;
uniform vec4 uWin;            /* window opening: z0, z1, y0, y1 (left wall at uWinX) */
uniform float uWinX;
uniform vec4 uRoomBox;        /* x0, x1, floor y, ceiling y */
uniform vec3 uBenchMin;
uniform vec3 uBenchMax;
uniform vec4 uVase;           /* x, z, radius, top y */
float sdBox(vec3 p, vec3 b0, vec3 b1){ vec3 c = (b0 + b1) * 0.5, e = (b1 - b0) * 0.5; vec3 q = abs(p - c) - e; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdVase(vec3 p){ vec2 d = vec2(length(p.xz - uVase.xy) - uVase.z, max(uBenchMax.y - p.y, p.y - uVase.w)); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
uniform float uWind;          /* time for the leaves outside the window */
float hh2(vec2 c){ return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
${TONE_GLSL}
/* leaves of a tree outside the window, as seen in the window plane (z, y): soft dappled light that sways */
float leaves(vec2 w, float pen){
  float o = 1.0;
  vec2 sway = vec2(sin(uWind * 0.7 + w.y * 0.002) * 14.0, sin(uWind * 0.53 + w.x * 0.003) * 9.0);
  float fine = 1.0 - smoothstep(48.0, 80.0, pen);          /* far from the window the small leaves blur away (and are skipped) */
  for (int L = 0; L < 2; L++) {
    if (L == 1 && fine <= 0.0) break;
    float sc = L == 0 ? 120.0 : 78.0;
    float str = L == 0 ? 0.85 : 0.85 * fine;
    vec2 q = (w + sway * (L == 0 ? 1.0 : 1.6) + float(L) * vec2(37.0, 61.0)) / sc;
    vec2 ci = floor(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 c = ci + vec2(float(i), float(j));
      float r = hh2(c + float(L) * 17.3);
      /* foliage hangs from the top of the opening and thins out downwards */
      float dens = smoothstep(uWin.z + 200.0, uWin.w + 300.0, c.y * sc) * 0.95 + 0.08;
      if (r > dens) continue;
      vec2 ctr = c + 0.5 + (vec2(hh2(c + 3.1), hh2(c + 7.7)) - 0.5) * 0.8;
      float a = hh2(c + 11.0) * 6.2831 + sin(uWind * 1.3 + r * 20.0) * 0.12;
      vec2 d = (q - ctr) * sc;
      d = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
      float len = sc * (0.36 + 0.2 * hh2(c + 5.0)), wid = len * 0.34;
      float e = length(d / vec2(len, wid));
      float k = pen / wid;
      o *= mix(1.0, smoothstep(1.0 - k, 1.0 + k, e), str);
    }
  }
  return o;
}
/* sun visibility: through the window, not blocked by the bench or the vase (soft: penumbra grows with distance) */
float sunVis(vec3 p, vec3 n){
  vec3 s = normalize(uSun);
  if (dot(n, s) <= 0.0 || s.x >= -1e-3) return 0.0;
  float t = (uWinX - p.x) / s.x;
  if (t <= 0.0) return 0.0;
  vec3 h = p + s * t;
  float pen = 10.0 + t * 0.012;
  float m = smoothstep(uWin.x - pen, uWin.x + pen, h.z) * (1.0 - smoothstep(uWin.y - pen, uWin.y + pen, h.z))
          * smoothstep(uWin.z - pen, uWin.z + pen, h.y) * (1.0 - smoothstep(uWin.w - pen, uWin.w + pen, h.y));
  if (m <= 0.0) return 0.0;
  m *= leaves(h.zy, pen * 1.4 + 6.0);
  /* occluders: the ray's closest approach to the bench box and to the vase axis, softened by distance */
  vec3 bc = (uBenchMin + uBenchMax) * 0.5;
  float tb = max(dot(bc - p, s), 0.0);
  vec3 qb = p + s * tb;
  float kb = 4.0 + tb * 0.02;
  float occ = smoothstep(-kb, kb, sdBox(qb, uBenchMin, uBenchMax));
  vec2 sx = s.xz; float sl = max(dot(sx, sx), 1e-5);
  float tv = max(dot(uVase.xy - p.xz, sx) / sl, 0.0);
  vec3 qv = p + s * tv;
  float kv = 4.0 + tv * 0.02;
  occ *= smoothstep(-kv, kv, sdVase(qv));
  return m * occ;
}
/* ambient occlusion of the room corners, the bench and the vase (analytic) */
float roomAO(vec3 p, vec3 n){
  float ex0 = p.x - uRoomBox.x, ex1 = uRoomBox.y - p.x, ey0 = p.y - uRoomBox.z, ey1 = uRoomBox.w - p.y, ez = p.z;
  float a = 1.0;
  if (n.x < 0.5) a *= 1.0 - 0.3 * exp(-max(ex0, 0.0) / 280.0);
  if (n.x > -0.5) a *= 1.0 - 0.3 * exp(-max(ex1, 0.0) / 280.0);
  if (n.y < 0.5) a *= 1.0 - 0.35 * exp(-max(ey0, 0.0) / 260.0);
  if (n.y > -0.5) a *= 1.0 - 0.25 * exp(-max(ey1, 0.0) / 320.0);
  if (n.z < 0.5) a *= 1.0 - 0.3 * exp(-max(ez, 0.0) / 280.0);
  a *= 1.0 - 0.5 * exp(-max(sdBox(p, uBenchMin, uBenchMax), 0.0) / 120.0) * (1.0 - smoothstep(0.6, 1.0, n.y) * step(uBenchMax.y - 2.0, p.y));
  a *= 1.0 - 0.4 * exp(-max(sdVase(p), 0.0) / 90.0);
  return clamp(a, 0.25, 1.0);
}
/* sky fill: brighter towards the window */
vec3 skyFill(vec3 p, vec3 n){
  float w = 0.55 + 0.45 * exp(-max(p.x - uRoomBox.x, 0.0) / 2800.0);
  float up = 0.62 + 0.38 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  float side = 0.8 + 0.2 * clamp(-n.x, 0.0, 1.0);
  /* light bounced off the sunlit oak and the plaster: warm, from below and from the room */
  vec3 bounce = vec3(1.0, 0.9, 0.78) * (0.16 + 0.14 * clamp(-n.y, 0.0, 1.0) + 0.06 * clamp(n.z, 0.0, 1.0));
  return uSky * w * up * side + uSunCol * bounce * 0.11;
}
`;

const VERT = `
varying vec3 vW;
varying vec3 vN;
varying vec3 vO;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz; vO = position;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = `
precision highp float;
uniform vec3 uCol;
uniform float uRough;
uniform int uKind;            /* 0 plaster, 1 oak floor, 2 travertine, 3 stoneware, 4 window light */
uniform float uRFade;         /* fades the room in during the pull-back */
uniform vec3 uFog;
${ROOM_GLSL}
varying vec3 vW;
varying vec3 vN;
varying vec3 vO;
float h1(float x){ return fract(sin(x * 127.1) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h1(i.x + i.y * 57.0), b = h1(i.x + 1.0 + i.y * 57.0), c = h1(i.x + (i.y + 1.0) * 57.0), d = h1(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
void main(){
  vec3 n = normalize(vN);
  vec3 p = vW;
  if (uKind == 4) { gl_FragColor = vec4(dvTone(uCol, 1.0, 1.0), 1.0);
    #include <colorspace_fragment>
    return; }
  /* the left wall has the window opening */
  if (n.x > 0.9 && p.z > uWin.x && p.z < uWin.y && p.y > uWin.z && p.y < uWin.w) discard;
  vec3 alb = uCol;
  float rough = uRough;
  if (uKind == 1) {
    /* light oak boards along the room depth */
    float bw = 165.0;
    float row = floor((p.x + 4000.0) / bw);
    float off = h1(row * 3.1) * 2400.0;
    float seg = floor((p.z + off) / 2400.0);
    float id = h1(row * 7.7 + seg * 1.3);
    float gx = fract((p.x + 4000.0) / bw), gz = fract((p.z + off) / 2400.0);
    float seam = smoothstep(0.0, 0.012, gx) * smoothstep(1.0, 0.988, gx) * smoothstep(0.0, 0.002, gz) * smoothstep(1.0, 0.998, gz);
    float grain = vn(vec2(p.x * 0.09 + row * 13.0, p.z * 0.004)) * 0.6 + vn(vec2(p.x * 0.35, p.z * 0.012 + row)) * 0.4;
    alb *= (0.9 + 0.18 * id) * (0.93 + 0.12 * grain) * mix(0.72, 1.0, seam);
    rough = mix(0.62, 0.48, id);
  } else if (uKind == 2) {
    float v = vn(vec2(p.x * 0.004, p.y * 0.05 + p.z * 0.004)) * 0.7 + vn(vec2(p.x * 0.03, p.y * 0.2)) * 0.3;
    alb *= 0.93 + 0.1 * v;
  } else if (uKind == 0) {
    alb *= 0.985 + 0.03 * vn(p.xy * 0.02 + p.zz * 0.013);
  }
  vec3 s = normalize(uSun);
  float sv = sunVis(p, n);
  float ndl = max(dot(n, s), 0.0);
  vec3 V = normalize(cameraPosition - p);
  vec3 H = normalize(s + V);
  float a2 = pow(rough, 4.0);
  float dd = max(dot(n, H), 0.0); dd = dd * dd * (a2 - 1.0) + 1.0;
  float spec = a2 / (3.14159 * dd * dd) * 0.04 * 0.25;
  vec3 col = (alb / 3.14159 * ndl + spec * ndl) * uSunCol * sv;
  float ao = roomAO(p, n);
  col += alb * skyFill(p, n) * ao;
  /* bounce of the sun patch off the oak floor onto the lower walls */
  col += alb * uSunCol * 0.018 * exp(-max(p.y - uRoomBox.z, 0.0) / 700.0) * (1.0 - abs(n.y));
  col = mix(uFog, col, uRFade);
  gl_FragColor = vec4(dvTone(col, 1.0, 1.0), 1.0);
  #include <colorspace_fragment>
}`;

/** Builds the room around the coated wall. Returns { group, uniforms (shared light), setFade(k), dispose } */
export function createRoom(T) {
  const R = ROOM;
  const sun = new T.Vector3(...R.sun).normalize();
  const shared = {
    uSun: { value: sun }, uSunCol: { value: new T.Color().setRGB(7.2, 6.7, 6.0, T.LinearSRGBColorSpace) },
    uSky: { value: new T.Color().setRGB(0.86, 0.88, 0.92, T.LinearSRGBColorSpace) }, uWind: { value: 0 },   /* daylight from the sky is a little cool */
    uWin: { value: new T.Vector4(R.win.z0, R.win.z1, R.win.y0, R.win.y1) }, uWinX: { value: R.x0 },
    uRoomBox: { value: new T.Vector4(R.x0, R.x1, R.floor, R.ceil) },
    uBenchMin: { value: new T.Vector3(R.bench.x0, R.floor, 0) }, uBenchMax: { value: new T.Vector3(R.bench.x1, R.floor + R.bench.h, R.bench.d) },
    uVase: { value: new T.Vector4(R.vase.x, R.vase.z, R.vase.r, R.floor + R.bench.h + R.vase.h) },
    uRFade: { value: 0 }, uFog: { value: new T.Color(0.012, 0.011, 0.01) }
  };
  const mats = [];
  function mat(hex, rough, kind) {
    const m = new T.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: Object.assign({ uCol: { value: new T.Color(hex) }, uRough: { value: rough }, uKind: { value: kind } }, shared)
    });
    mats.push(m); return m;
  }
  const group = new T.Group();
  const W = R.x1 - R.x0, Hh = R.ceil - R.floor, cx = (R.x0 + R.x1) / 2, cy = (R.floor + R.ceil) / 2;
  const geos = [];
  function plane(w, h, m, pos, rot) {
    const g = new T.PlaneGeometry(w, h, 1, 1); geos.push(g);
    const mesh = new T.Mesh(g, m); mesh.position.set(...pos); mesh.rotation.set(...rot); group.add(mesh); return mesh;
  }
  const plaster = mat('#e7e1d7', 0.92, 0), ceilM = mat('#eeebe5', 0.95, 0);
  plane(W, R.depth, mat('#c4a47c', 0.55, 1), [cx, R.floor, R.depth / 2], [-Math.PI / 2, 0, 0]);         /* oak floor */
  plane(W, R.depth, ceilM, [cx, R.ceil, R.depth / 2], [Math.PI / 2, 0, 0]);                            /* ceiling */
  plane(R.depth, Hh, plaster, [R.x0, cy, R.depth / 2], [0, Math.PI / 2, 0]);                          /* left wall, window cut in the shader */
  plane(R.depth, Hh, plaster, [R.x1, cy, R.depth / 2], [0, -Math.PI / 2, 0]);                         /* right wall */
  /* the window: bright daylight seen through the opening */
  const glow = new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: Object.assign({ uCol: { value: new T.Color().setRGB(4.2, 4.1, 3.9, T.LinearSRGBColorSpace) }, uRough: { value: 1 }, uKind: { value: 4 } }, shared) });
  mats.push(glow);
  plane(R.win.z1 - R.win.z0 + 40, R.win.y1 - R.win.y0 + 40, glow, [R.x0 - 2, (R.win.y0 + R.win.y1) / 2, (R.win.z0 + R.win.z1) / 2], [0, Math.PI / 2, 0]);
  /* slim steel frame and one transom */
  const steel = mat('#1d1b19', 0.6, 3);
  const fw = 28, wz = (R.win.z0 + R.win.z1) / 2, wy = (R.win.y0 + R.win.y1) / 2, ww = R.win.z1 - R.win.z0, wh = R.win.y1 - R.win.y0;
  [[ww + fw * 2, fw, wz, R.win.y1 + fw / 2], [ww + fw * 2, fw, wz, R.win.y0 - fw / 2], [fw, wh, R.win.z0 - fw / 2, wy], [fw, wh, R.win.z1 + fw / 2, wy],
   [ww, fw * 0.7, wz, R.win.y0 + wh * 0.72]].forEach(([w, h, z, y]) => {
    const g = new T.BoxGeometry(24, h, w); geos.push(g);
    const m = new T.Mesh(g, steel); m.position.set(R.x0 + 4, y, z); group.add(m);
  });
  /* travertine bench against the coated wall */
  const bg = roundedBox(T, R.bench.x1 - R.bench.x0, R.bench.h, R.bench.d, 14, 2); geos.push(bg);
  const bench = new T.Mesh(bg, mat('#d9cfbf', 0.7, 2));
  bench.position.set((R.bench.x0 + R.bench.x1) / 2, R.floor + R.bench.h / 2, R.bench.d / 2); group.add(bench);
  /* stoneware vase on the bench */
  const prof = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, y = t * R.vase.h;
    const r = R.vase.r * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t * 1.25)) ) * (t > 0.86 ? 0.55 + 0.45 * (1 - (t - 0.86) / 0.14) : 1);
    prof.push(new T.Vector2(Math.max(r, 8), y));
  }
  prof.push(new T.Vector2(R.vase.r * 0.42, R.vase.h));
  const vg = new T.LatheGeometry(prof, 48); geos.push(vg);
  const vase = new T.Mesh(vg, mat('#4b443c', 0.75, 3));
  vase.position.set(R.vase.x, R.floor + R.bench.h, R.vase.z); group.add(vase);
  group.visible = false;
  return {
    group, uniforms: shared,
    setFade(k) { shared.uRFade.value = k; group.visible = k > 0.001; },
    setTime(t) { shared.uWind.value = t; },
    dispose() { geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); }
  };
}
