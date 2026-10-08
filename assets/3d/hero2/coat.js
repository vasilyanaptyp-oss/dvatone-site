/* Dvatone hero v2: the coating, made of sprayed granules.
   One deterministic list of granules per composition (seamless, colour by share from a periodic
   low-discrepancy lattice, the same dead-leaves statistics as the v1 tile). Each granule is
   - a particle that flies from the nozzle and lands on its site (spray.js), and
   - a fleck stamped into a seamless tile (MRT: albedo + data) at the moment it lands.
   The coating the visitor sees is the accumulation of those landings; without the intro the very same
   list is stamped in one go, so both paths give the same surface. */
import { normColors, clamp, GLSL_HASH } from '../core.js';

export const CELL_MM = 0.9;          /* fleck lattice step on the wall at grain 1 (M), as in v1 */

/* ---------- deterministic hash (pcg3d, 32-bit) ---------- */
const H = new Float64Array(3);
function rnd3(cx, cy, k, seed) {
  let x = cx >>> 0, y = cy >>> 0, z = (Math.imul(k, 747796405) + seed) >>> 0;
  x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  z = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0; z = (z ^ (z >>> 16)) >>> 0;
  x = (x + Math.imul(y, z)) >>> 0; y = (y + Math.imul(z, x)) >>> 0; z = (z + Math.imul(x, y)) >>> 0;
  H[0] = x / 4294967296; H[1] = y / 4294967296; H[2] = z / 4294967296;
  return H;
}
const wrapi = (v, n) => ((v % n) + n) % n;
const fract = v => v - Math.floor(v);
const s2l = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex) {
  const v = parseInt(hex, 16);
  return [s2l(((v >> 16) & 255) / 255), s2l(((v >> 8) & 255) / 255), s2l((v & 255) / 255)];
}

/* rank-1 lattice generator for a period n (coprime, best separation of near neighbours; cached).
   Copied from core.js (not exported there). */
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

/* ---------- the spray schedule ----------
   The applicator's pass sweeps the impact band down the wall (far -> near in the macro frame, i.e. towards
   the viewer) with an ease-in-out speed; every spot receives its granules over SPREAD seconds, lowest first,
   so a later granule always lands on top of an earlier one (painter's order == landing order == depth).
   f = position of the band in the tile, 1 = far edge (top of the frame) .. 0 = near edge. */
export const SCHED = { t0: 0.5, sweep: 1.7, spread: 0.65, pre: 0.3, top: 0.92 };   /* 07.10: the coat is on in about 2.9 s (was 3.2) */
export const DRY = -2;                /* landing time stored for a dry surface (interpolates gracefully in the mips) */
export function bandTime(f) {
  f = clamp(f, 0, 1);
  if (f > SCHED.top) return SCHED.t0 - SCHED.pre * (f - SCHED.top) / (1 - SCHED.top);   /* beyond the top of the frame: quick */
  return SCHED.t0 + SCHED.sweep * Math.acos(1 - 2 * (1 - f / SCHED.top)) / Math.PI;
}
export function bandFrac(t) {
  if (t < SCHED.t0) return SCHED.top + (1 - SCHED.top) * clamp((SCHED.t0 - t) / SCHED.pre, 0, 1);
  const u = clamp((t - SCHED.t0) / SCHED.sweep, 0, 1);
  return SCHED.top * (1 - (1 - Math.cos(Math.PI * u)) / 2);
}

/**
 * Build the granule list (allocation-light: typed arrays, precomputed warp lattices, native numeric sort).
 * o: { colors, cells (main lattice period, even), px (tile size), seed, density, sparkle, glint (linear rgb), tileMM, origin:[x,y], mistFrac,
 *      vp: 16 numbers (column-major view-projection of the intro camera: extra flights for tile repeats it sees) }
 * Returns { dep: {a,b,c,d,count}, fly: {a,b,c,count}, granules, ground:[r,g,b], mean, firstLanding, lastLanding }
 */
export function buildCoat(o) {
  const cols = normColors(o.colors);
  const n = o.cells, seed = (o.seed == null ? 33 : o.seed) % 65536;
  const density = clamp(o.density == null ? 0.95 : +o.density, 0.4, 1);
  const sparkle = clamp(o.sparkle || 0, 0, 1);
  const lin = cols.map(c => hexToLinear(c.hex));
  const mean = [0, 0, 0];
  cols.forEach((c, i) => { for (let k = 0; k < 3; k++) mean[k] += lin[i][k] * c.share / 100; });
  const cum = []; let acc = 0;
  for (let i = 0; i < cols.length; i++) { acc += cols[i].share / 100; cum.push(i < cols.length - 1 ? acc : 2); }
  const nc = cols.length;
  const pickK = u => { let k = 0; for (let i = 0; i < nc - 1; i++) if (u > cum[i]) k = i + 1; return k; };
  const C = Math.min(density, 0.94);
  const presence = clamp(-Math.log(1 - C) / (5 * 0.55), 0.05, 1);
  const gk = clamp((density - 0.55) / 0.4, 0, 1);
  const ground = lin[0].map((v, k) => v * 0.92 + (mean[k] - v * 0.92) * gk);
  const glint = o.glint || [0.69, 0.46, 0.105];
  const lat = latticeFor(n);
  const T = o.tileMM, cellMM = T / n, ox = o.origin[0], oy = o.origin[1];

  /* the gentle periodic domain warp of v1, as four precomputed value-noise lattices */
  const n2 = n / 2, n4 = n * 2;
  const lattice = (m, k) => { const a = new Float32Array(m * m); for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) a[i + j * m] = rnd3(i, j, k, seed)[0]; return a; };
  const W3 = lattice(n2, 3), W7 = lattice(n2, 7), W11 = lattice(n4, 11), W13 = lattice(n4, 13);
  const vn = (A, m, px, py) => {
    const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % m) + m) % m, y0 = ((iy % m) + m) % m, x1 = (x0 + 1) % m, y1 = (y0 + 1) % m;
    const a = A[x0 + y0 * m], b = A[x1 + y0 * m], c = A[x0 + y1 * m], d = A[x1 + y1 * m];
    const ab = a + (b - a) * ux, cd = c + (d - c) * ux;
    return ab + (cd - ab) * uy;
  };

  /* granules, struct of arrays */
  const cap = Math.ceil(n * n * (5 + 4 * 0.24 + 2.25 * (sparkle * 0.11 + 0.01))) + 64;
  const QX = new Float32Array(cap), QY = new Float32Array(cap), RAD = new Float32Array(cap), ANG = new Float32Array(cap), ASP = new Float32Array(cap);
  const SC = new Float32Array(cap), TY = new Uint8Array(cap), PH = new Float32Array(cap), Z = new Float32Array(cap), TL = new Float64Array(cap);
  const CR = new Float32Array(cap), CG = new Float32Array(cap), CB = new Float32Array(cap), RO = new Float32Array(cap), TI = new Float32Array(cap);
  let N = 0;
  for (let L = 0; L < 7; L++) {
    const fines = L === 5, mica = L === 6;
    if (mica && sparkle < 0.001) break;
    const sc0 = fines ? 2 : (mica ? 1.5 : 1);
    const nL = fines ? n * 2 : (mica ? n + n / 2 : n);
    const offx = fract(L * 0.5), offy = fract(L * 0.25 + 0.5 * Math.floor(L / 2));
    const pres = fines ? 0.22 : (mica ? sparkle * 0.11 : presence);
    const rmin = (fines || mica) ? 0.16 : 0.28, rmax = (fines || mica) ? 0.3 : 0.76;
    for (let j = 0; j < nL; j++) for (let i = 0; i < nL; i++) {
      let h = rnd3(i, j, L * 4 + 1, seed); const ax = h[0], ay = h[1], az = h[2];
      if (ax >= pres) continue;
      if (N >= cap) break;
      h = rnd3(i, j, L * 4 + 2, seed); const bx = h[0], by = h[1], bz = h[2];
      h = rnd3(i, j, L * 4 + 3, seed); const fx = h[0], fy = h[1], fz = h[2];
      h = rnd3(i, j, L * 4, seed); const gx = h[0], gy = h[1], gz = h[2];
      /* centre in tile cells; undo the gentle periodic domain warp so no lattice ever shows */
      let qx = (i + 0.5 + (ay - 0.5) * 0.9 - offx) / sc0, qy = (j + 0.5 + (az - 0.5) * 0.9 - offy) / sc0;
      const wx = (vn(W3, n2, qx * 0.5, qy * 0.5) - 0.5) * 0.55 + (vn(W11, n4, qx * 2, qy * 2) - 0.5) * 0.12;
      const wy = (vn(W7, n2, qx * 0.5, qy * 0.5) - 0.5) * 0.55 + (vn(W13, n4, qx * 2, qy * 2) - 0.5) * 0.12;
      qx -= wx; qy -= wy;
      qx -= Math.floor(qx / n) * n; qy -= Math.floor(qy / n) * n;
      const z = mica ? 0.75 + 0.35 * ay : gx + (fines ? 0.1 : 0);
      if (mica) { const k = 0.8 + 0.4 * by; CR[N] = glint[0] * k; CG[N] = glint[1] * k; CB[N] = glint[2] * k; RO[N] = 0.14 + 0.1 * bz; }
      else {
        const u = fines ? gy : fract(0.5 + i * lat[0] + j * lat[1] + L * 0.381966 + (gy - 0.5) * 0.3);
        const c = lin[pickK(u)], k = 0.94 + 0.12 * gz;
        CR[N] = c[0] * k; CG[N] = c[1] * k; CB[N] = c[2] * k; RO[N] = 0.66 + 0.16 * fx;
      }
      /* the fan's front is not a ruler line: a slow wobble across the wall, plus a little scatter per granule */
      const xw = qx / n * 6.2831853;
      const wob = 0.034 * Math.sin(xw * 2 + 1.3) + 0.022 * Math.sin(xw * 5 + 0.4) + 0.012 * Math.sin(xw * 11 + 2.2);
      QX[N] = qx; QY[N] = qy; RAD[N] = (rmin + (rmax - rmin) * by * by) / sc0; ANG[N] = bx * 6.2831853;
      ASP[N] = (mica ? 0.4 : 0.5) + (1 - (mica ? 0.4 : 0.5)) * bz; SC[N] = sc0; TY[N] = fines ? 1 : (mica ? 2 : 0); PH[N] = fz;
      Z[N] = z; TI[N] = fx * 6.2831853;
      TL[N] = bandTime(qy / n + wob) + SCHED.spread * (z / 1.1) + 0.07 * (fy - 0.5);
      N++;
    }
  }
  /* sort by landing time: (time in microseconds, index) packed into one double, native numeric sort */
  const KEY = new Float64Array(N), SH = 131072;
  for (let i = 0; i < N; i++) KEY[i] = Math.round((TL[i] + 2) * 1e6) * SH + i;
  KEY.sort();
  const ORD = new Uint32Array(N);
  for (let i = 0; i < N; i++) ORD[i] = KEY[i] % SH;

  /* deposit instances: granule + wrap copies right behind it (keeps painter's order across the seam) */
  const edge = 2.2 / (o.px / n);                                   /* AA margin in cells */
  const MSK = new Uint8Array(N);
  let cnt = 0;
  for (let r = 0; r < N; r++) {
    const g = ORD[r], rb = RAD[g] * 1.66 + edge;
    const m = (QX[g] - rb < 0 ? 1 : 0) | (QX[g] + rb > n ? 2 : 0) | (QY[g] - rb < 0 ? 4 : 0) | (QY[g] + rb > n ? 8 : 0);
    MSK[r] = m;
    cnt += (1 + ((m & 1) ? 1 : 0) + ((m & 2) ? 1 : 0)) * (1 + ((m & 4) ? 1 : 0) + ((m & 8) ? 1 : 0));
  }
  const dA = new Float32Array(cnt * 4), dB = new Float32Array(cnt * 4), dC = new Float32Array(cnt * 4), dD = new Float32Array(cnt * 4);
  const XS = [0, 0, 0], YS = [0, 0, 0];
  let w = 0;
  for (let r = 0; r < N; r++) {
    const g = ORD[r], m = MSK[r];
    let nx = 1, ny = 1;
    if (m & 1) XS[nx++] = n; if (m & 2) XS[nx++] = -n;
    if (m & 4) YS[ny++] = n; if (m & 8) YS[ny++] = -n;
    for (let yi = 0; yi < ny; yi++) for (let xi = 0; xi < nx; xi++) {
      const i4 = w * 4;
      dA[i4] = QX[g] + XS[xi]; dA[i4 + 1] = QY[g] + YS[yi]; dA[i4 + 2] = RAD[g]; dA[i4 + 3] = ANG[g];
      dB[i4] = ASP[g]; dB[i4 + 1] = SC[g]; dB[i4 + 2] = TY[g]; dB[i4 + 3] = PH[g];
      dC[i4] = CR[g]; dC[i4 + 1] = CG[g]; dC[i4 + 2] = CB[g]; dC[i4 + 3] = RO[g];
      dD[i4] = Z[g]; dD[i4 + 1] = TL[g]; dD[i4 + 2] = TI[g]; dD[i4 + 3] = 0;
      w++;
    }
  }

  /* flights: one per granule, aimed at its site in the tile's primary repeat; plus repeats the intro camera sees */
  const e = o.vp || null;
  const seen = (x, y) => {
    const cw = e[3] * x + e[7] * y + e[15];
    if (cw <= 1e-6) return false;
    const cx = (e[0] * x + e[4] * y + e[12]) / cw, cy = (e[1] * x + e[5] * y + e[13]) / cw, cz = (e[2] * x + e[6] * y + e[14]) / cw;
    return Math.abs(cx) < 1.1 && Math.abs(cy) < 1.1 && cz < 1;
  };
  const FX = new Float32Array(N * 3), FY = new Float32Array(N * 3), FG = new Uint32Array(N * 3);
  const mf = o.mistFrac == null ? 1 : clamp(+o.mistFrac, 0, 1);
  let fc = 0;
  for (let r = 0; r < N; r++) {
    const g = ORD[r], x = ox + QX[g] * cellMM, y = oy + QY[g] * cellMM;
    /* lighter tiers: part of the fast mist lands without a visible flight (it is stamped all the same) */
    if (mf < 1 && !(TY[g] === 2 || (TY[g] === 0 && Z[g] > 0.78)) && rnd3(g, 3, 57, seed)[0] > mf) continue;
    FX[fc] = x; FY[fc] = y; FG[fc++] = g;
    if (e) for (let k = -1; k <= 1; k += 2) { const x2 = x + k * T; if (seen(x2, y)) { FX[fc] = x2; FY[fc] = y; FG[fc++] = g; } }
  }
  const fA = new Float32Array(fc * 4), fB = new Float32Array(fc * 4), fC = new Float32Array(fc * 4);
  for (let i = 0; i < fc; i++) {
    const g = FG[i], Rmm = RAD[g] * cellMM, ty = TY[g];
    const h = rnd3(i, 7, 91, seed); const r0 = h[0], r1 = h[1], r2 = h[2];
    /* two kinds of flight: the granules that end up on top (and every mica flake) glide in slowly through the
       raking beam; the deeper layers arrive first as a fast, faint mist (the base pass of the spray) */
    const slow = ty === 2 || (ty === 0 && Z[g] > 0.78);
    const i4 = i * 4;
    fA[i4] = FX[i]; fA[i4 + 1] = FY[i]; fA[i4 + 2] = TL[g]; fA[i4 + 3] = slow ? 0.62 + 0.16 * (r0 - 0.5) : 0.2 + 0.06 * (r0 - 0.5);
    fB[i4] = ty === 2 ? Rmm * 0.9 : Rmm * (slow ? 0.62 : 0.3);      /* bead radius before it flattens */
    fB[i4 + 1] = ty + (slow ? 0 : 4); fB[i4 + 2] = r1; fB[i4 + 3] = slow ? 7.5 + 2.0 * r1 : 1.6;   /* air drag, 1/s: the slow ones brake hard */
    fC[i4] = CR[g]; fC[i4 + 1] = CG[g]; fC[i4 + 2] = CB[g]; fC[i4 + 3] = r2;
  }
  return {
    dep: { a: dA, b: dB, c: dC, d: dD, count: cnt },
    fly: { a: fA, b: fB, c: fC, count: fc },
    granules: N, ground, mean, firstLanding: N ? TL[ORD[0]] : 0, lastLanding: N ? TL[ORD[N - 1]] : 0
  };
}

/* ---------- GPU: the seamless coating tile, written by stamping granules ---------- */
const STAMP_VERT = `
attribute vec4 iA;   /* centre x, y (tile cells), radius (cells), angle */
attribute vec4 iB;   /* aspect, lattice scale, type (0 granule, 1 fine, 2 mica), wobble seed */
attribute vec4 iC;   /* linear colour, roughness */
attribute vec4 iD;   /* depth (relief), landing time, mica tilt, - */
uniform vec2 uWin;
uniform float uCells;
uniform float uPx;
varying vec2 vP;
varying vec2 vC;
varying vec4 vA;
varying vec4 vB;
varying vec4 vCol;
varying vec4 vD;
void main(){
  if (iD.y <= uWin.x || iD.y > uWin.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float rb = iA.z * 1.66 + 2.2 / (uPx / uCells);
  vec2 p = iA.xy + position.xy * rb;
  vP = p; vC = iA.xy; vA = iA; vB = iB; vCol = iC; vD = iD;
  gl_Position = vec4(p / uCells * 2.0 - 1.0, 0.0, 1.0);
}`;
const STAMP_FRAG = `
precision highp float;
precision highp int;
layout(location = 0) out vec4 oAlb;
layout(location = 1) out vec4 oDat;
uniform float uCells;
uniform float uPx;
uniform float uSeed;
uniform float uDry;
uniform float uTlBase;
varying vec2 vP;
varying vec2 vC;
varying vec4 vA;
varying vec4 vB;
varying vec4 vCol;
varying vec4 vD;
${GLSL_HASH}
void main(){
  int n = int(uCells + 0.5);
  float R = vA.z, type = vB.z, sc0 = vB.y;
  bool mica = type > 1.5;
  vec2 d = vP - vC;
  vec2 pp = vP + uCells;                 /* one period up: keeps lattice indices positive (integer % is undefined below 0) */
  if (!mica) {          /* crumbly outline: fine periodic noise, continuous across neighbours and the tile seam */
    vec2 q3 = pp * 3.0 * sc0;
    int n3 = int(uCells * 3.0 * sc0 + 0.5);
    int kk = type > 0.5 ? 36 : 31;
    d += (vec2(vnoise(q3, n3, kk, uSeed), vnoise(q3, n3, kk + 16, uSeed)) - 0.5) * R * 0.55;
  }
  float cs = cos(vA.w), sn = sin(vA.w);
  d = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
  d.y /= vB.x;
  float ta0 = atan(d.y, d.x);
  vec4 ph = fract(vB.w * vec4(12.9898, 78.233, 37.719, 52.31) + vec4(0.1, 0.3, 0.7, 0.9)) * 6.2831853;
  float ph5 = fract(vB.w * 91.17 + 0.5) * 6.2831853;
  float wob = 0.12 * sin(2.0 * ta0 + ph.x) + 0.08 * sin(3.0 * ta0 + ph.y) + 0.05 * sin(5.0 * ta0 + ph.z)
            + 0.035 * sin(7.0 * ta0 + ph.w) + 0.022 * sin(11.0 * ta0 + ph5);
  float Rr = R * (1.0 + (mica ? 0.0 : wob));
  float rr = mica ? max(abs(d.x), abs(d.y) * 0.8) / Rr : length(d) / Rr;
  float w = (1.15 / (uPx / uCells)) / Rr;
  float al = 1.0 - smoothstep(1.0 - w, 1.0 + w, rr);
  if (al <= 0.002) discard;
  vec3 col; float hh;
  if (mica) {
    /* tilted flake: catches the light only at certain angles, so it glints as the light moves */
    vec2 td = vec2(cos(vD.z), sin(vD.z));
    col = vCol.rgb; hh = 0.6 + dot(d, td) / Rr * 0.34;
  } else {
    col = vCol.rgb * mix(0.965, 1.0, smoothstep(1.0, 0.55, rr));
    float lip = smoothstep(1.0, 0.5, rr);
    hh = 0.18 + 0.45 * vD.x + 0.4 * lip * (0.75 + 0.25 * sqrt(max(0.0, 1.0 - rr * rr)));
  }
  float m = vnoise(pp * 4.0, n * 4, 17, uSeed) - 0.5;     /* faint mottling inside granules */
  col *= 1.0 + m * 0.05;
  hh += m * 0.04;
  oAlb = vec4(col, al);
  oDat = vec4(clamp(hh, 0.0, 1.0), vCol.a, uDry > 0.5 ? -2.0 : vD.y + uTlBase, al);
}`;
const GROUND_FRAG = `
precision highp float;
precision highp int;
layout(location = 0) out vec4 oAlb;
layout(location = 1) out vec4 oDat;
uniform float uCells;
uniform float uSeed;
uniform vec3 uGround;
varying vec2 vUv;
${GLSL_HASH}
void main(){
  int n = int(uCells + 0.5);
  vec2 p = vUv * uCells;
  float m = vnoise(p * 4.0, n * 4, 17, uSeed) - 0.5;
  float st = vnoise(p * 9.0, n * 9, 23, uSeed) - 0.5;          /* primer stipple */
  oAlb = vec4(uGround * (1.0 + m * 0.05), 1.0);
  oDat = vec4(clamp(m * 0.04 + 0.03 + st * 0.03, 0.0, 1.0), 0.88, -2.0, 1.0);
}`;

/**
 * cfg: { size (px), halfOK, aniso }
 * -> { rt, albedo, data, setList(coat), ground(), stamp(t0, t1, dry, mips), flush(), stampAll(), dispose() }
 */
export function createCoatTile(T, renderer, cfg) {
  const size = cfg.size;
  const rt = new T.WebGLRenderTarget(size, size, {
    count: 2, type: T.UnsignedByteType, colorSpace: T.SRGBColorSpace,
    generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter,
    wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping, anisotropy: cfg.aniso || 8, depthBuffer: false
  });
  const dat = rt.textures[1];
  dat.type = cfg.halfOK ? T.HalfFloatType : T.UnsignedByteType; dat.colorSpace = T.NoColorSpace;
  rt.textures[0].name = 'dv-coat-albedo'; dat.name = 'dv-coat-data';

  const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /* ground: fullscreen triangle */
  const gGeo = new T.BufferGeometry();
  gGeo.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  gGeo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const uni = { uCells: { value: 96 }, uPx: { value: size }, uSeed: { value: 33 }, uGround: { value: new T.Vector3() }, uWin: { value: new T.Vector2() }, uDry: { value: 0 }, uTlBase: { value: 0 } };
  const gMat = new T.ShaderMaterial({
    glslVersion: T.GLSL3, uniforms: uni, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: GROUND_FRAG
  });
  const gMesh = new T.Mesh(gGeo, gMat); gMesh.frustumCulled = false;
  const gScene = new T.Scene(); gScene.add(gMesh);
  /* stamps: one instanced quad per granule (+ wrap copies) */
  const sMat = new T.ShaderMaterial({
    glslVersion: T.GLSL3, uniforms: uni, depthTest: false, depthWrite: false, transparent: true,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.SrcAlphaFactor, blendDst: T.OneMinusSrcAlphaFactor,
    blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneMinusSrcAlphaFactor,
    vertexShader: STAMP_VERT, fragmentShader: STAMP_FRAG
  });
  /* stamps are drawn in chunks of the time-sorted list: a frame of the spray only touches the chunks that land now */
  const CH = 3072;
  const quadPos = new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3), quadIdx = new T.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1);
  let chunks = [];
  const sScene = new T.Scene(), empty = new T.Scene();
  let mipsDirty = false;

  function draw(scene) {
    const prev = renderer.getRenderTarget(), ac = renderer.autoClear, tm = renderer.toneMapping;
    renderer.autoClear = false; renderer.toneMapping = T.NoToneMapping;
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
    renderer.autoClear = ac; renderer.toneMapping = tm;
  }
  function setMips(on) { rt.textures.forEach(t => (t.generateMipmaps = on)); }
  const api = {
    rt, albedo: rt.textures[0], data: dat, size, count: 0,
    setList(coat, o) {
      uni.uCells.value = o.cells; uni.uSeed.value = o.seed % 65536; uni.uGround.value.set(...coat.ground);
      const d = coat.dep;
      chunks.forEach(c => { sScene.remove(c.m); c.g.dispose(); });
      chunks = [];
      for (let s0 = 0; s0 < d.count; s0 += CH) {
        const e = Math.min(d.count, s0 + CH);
        const g = new T.InstancedBufferGeometry();
        g.setAttribute('position', quadPos); g.setIndex(quadIdx);
        g.setAttribute('iA', new T.InstancedBufferAttribute(d.a.subarray(s0 * 4, e * 4), 4));
        g.setAttribute('iB', new T.InstancedBufferAttribute(d.b.subarray(s0 * 4, e * 4), 4));
        g.setAttribute('iC', new T.InstancedBufferAttribute(d.c.subarray(s0 * 4, e * 4), 4));
        g.setAttribute('iD', new T.InstancedBufferAttribute(d.d.subarray(s0 * 4, e * 4), 4));
        g.instanceCount = e - s0;
        const m = new T.Mesh(g, sMat); m.frustumCulled = false; sScene.add(m);
        chunks.push({ g, m, t0: d.d[s0 * 4 + 1], t1: d.d[(e - 1) * 4 + 1] });      /* the list is sorted by landing time */
      }
      api.count = d.count;
    },
    ground() { setMips(true); draw(gScene); mipsDirty = false; },
    /* stamps the granules landing in (t0, t1]; mips = false defers the mip chain (call flush() later) */
    stamp(t0, t1, dry, mips = true) {
      let any = false;
      for (const c of chunks) { c.m.visible = c.t1 > t0 && c.t0 <= t1; any = any || c.m.visible; }
      if (!any) return false;
      uni.uWin.value.set(t0, t1); uni.uDry.value = dry ? 1 : 0;
      setMips(mips); draw(sScene); setMips(true);
      mipsDirty = !mips;
      return true;
    },
    /* rebuilds the mip chain if a stamp skipped it (an empty pass into the target is enough for three.js) */
    flush() { if (mipsDirty) { draw(empty); mipsDirty = false; } },
    stampAll() { api.ground(); api.stamp(-1e9, 1e9, true); },
    /* time base written with the landings (a re-spray over an existing coat starts later than its old landings) */
    setBase(b) { uni.uTlBase.value = b; },
    dispose() { rt.dispose(); gGeo.dispose(); gMat.dispose(); sMat.dispose(); chunks.forEach(c => c.g.dispose()); }
  };
  return api;
}
