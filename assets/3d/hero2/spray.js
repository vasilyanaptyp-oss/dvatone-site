/* Dvatone hero v2: granules in flight.
   Every granule of the coating (coat.js) leaves the nozzle at its own moment and lands on its own site.
   Motion: the exact solution for gravity + air drag (drag grows as the bead gets smaller, so fine mist
   brakes hard and drifts while big beads fly straight), solved backwards from the landing site, plus a
   swirling turbulence field of the air jet that fades out at the wall. Each bead is a GPU instance:
   a screen-space capsule (motion blur over the shutter time), widened by the circle of confusion of the
   same macro lens as the wall (bokeh), lit by the raking light; backlit gel glows, mica flakes tumble
   and flash. Deterministic in time (scrubbable, replayable, frame-exact recordings). */

const VERT = `
attribute vec4 fA;   /* landing site x, y (wall mm), landing time, flight time */
attribute vec4 fB;   /* bead radius (mm), type (0 granule, 1 fine, 2 mica; +4 = fast mist), seed, drag (1/s) */
attribute vec4 fC;   /* linear colour, seed 2 */
uniform float uT;
uniform vec3 uNoz;
uniform vec3 uNozD;
uniform float uG;
uniform float uTurb;
uniform float uShutter;
uniform float uFocus;
uniform float uAper;
uniform vec2 uRes;
uniform vec3 uL;
uniform vec3 uLcol;
uniform vec3 uAmb;
uniform vec3 uPool;
uniform float uLight;
uniform float uNear;
uniform float uDofK;
uniform float uBeamH;
uniform float uHighA;
uniform float uMistA;
varying vec2 vQ;
varying vec4 vS;
varying vec4 vCol;
varying vec3 vRim;
varying vec3 vGlow;
varying vec2 vLd;
varying vec4 vSh;
vec3 hash3(float s){ return fract(sin(vec3(s * 127.1, s * 311.7, s * 74.7)) * 43758.5453); }
/* air jet turbulence: smooth swirling eddies (nested sines), drifting with time */
vec3 flow(vec3 p, float t){
  vec3 q = p * 0.045;
  vec3 a = vec3(sin(q.y * 1.7 + t * 0.9 + 1.3 * sin(q.z * 1.1 - t * 0.6)),
                sin(q.z * 1.5 - t * 0.8 + 1.1 * sin(q.x * 1.3 + t * 0.5)),
                sin(q.x * 1.9 + t * 0.7 + 1.2 * sin(q.y * 0.9 - t * 0.7)));
  vec3 q2 = q * 2.9;
  a += 0.5 * vec3(sin(q2.y * 1.3 - t * 1.6 + 2.1 + sin(q2.z)), sin(q2.z * 1.1 + t * 1.3 + 0.7 + sin(q2.x * 0.8)), sin(q2.x * 1.4 - t * 1.1 + 1.9 + sin(q2.y * 1.2)));
  return a;
}
vec3 pathAt(float s, vec3 P0, vec3 P1, float tau, float k, float sz, float seed){
  vec3 g = vec3(0.0, -uG, 0.0);
  vec3 vt = g / k;
  float E = 1.0 - exp(-k * tau);
  vec3 V0 = vt + k * (P1 - P0 - vt * tau) / E;
  vec3 pb = P0 + vt * s + (V0 - vt) * (1.0 - exp(-k * s)) / k;
  float u = clamp(s / tau, 0.0, 1.0);
  float env = sin(3.14159265 * pow(u, 0.75));
  return pb + flow(pb + seed * 2.0, uT) * uTurb * (0.3 + 0.9 * (1.0 - sz)) * env;
}
void cull(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); }
void main(){
  float tau = fA.w;
  float s = uT - (fA.z - tau);
  if (s <= 0.0 || s >= tau) { cull(); return; }
  float k = fB.w, seed = fB.z;
  bool mist = fB.y > 3.5;
  float type = mod(fB.y, 4.0);
  float sz = clamp((fB.x - 0.04) / 0.45, 0.0, 1.0);
  /* the applicator's gun travels with the band: the nozzle sits uNoz away from the bead's own landing row */
  vec3 P0 = vec3(uNoz.x, fA.y + uNoz.y, uNoz.z) + (hash3(seed * 91.7 + 0.37) - 0.5) * 2.0 * uNozD;
  vec3 P1 = vec3(fA.xy, 0.0);
  vec3 P = pathAt(s, P0, P1, tau, k, sz, seed);
  if (mist && P.z > uBeamH * 3.4) { cull(); return; }        /* fast mist is only seen once it drops into the beam */
  vec3 Pp = pathAt(max(s - uShutter * (mist ? 0.6 : 1.0), 0.0), P0, P1, tau, k, sz, seed);
  mat4 vp = projectionMatrix * viewMatrix;
  vec4 c1 = vp * vec4(P, 1.0), c0 = vp * vec4(Pp, 1.0);
  if (c1.w < uNear || c0.w < uNear * 0.5) { cull(); return; }
  vec2 s1 = (c1.xy / c1.w * 0.5 + 0.5) * uRes, s0 = (c0.xy / c0.w * 0.5 + 0.5) * uRes;
  float depth = c1.w;
  float pxmm = uRes.y * 0.5 * projectionMatrix[1][1] / depth;
  float r = fB.x * pxmm;
  float coc = min(abs(1.0 - uFocus / depth) * uAper * uDofK, 9.0);
  float R = r + coc;
  float al = mix(1.0, clamp(r * r / (R * R), 0.0, 1.0), 0.65);
  if (R < 0.9) { al *= R * R / 0.81; R = 0.9; }
  vec2 m = s1 - s0;
  float len = length(m);
  vec2 dir = len > 0.01 ? m / len : vec2(1.0, 0.0), perp = vec2(-dir.y, dir.x);
  float hl = len * 0.5;
  al *= mix(1.0, 3.14159 * R * R / (3.14159 * R * R + 4.0 * R * hl), 0.6);
  al *= smoothstep(uNear, uNear * 2.2, depth);
  if (mist) al *= uMistA;
  /* lighting: broad beam around the light pool (reaching into the air), contre-jour glow of the gel */
  vec3 V = normalize(cameraPosition - P);
  vec3 dp = P - vec3(uPool.xy, 0.0); dp.z *= 0.5;
  float sb = uPool.z * 2.6;
  float beam = (0.25 + 0.75 * exp(-dot(dp, dp) / (2.0 * sb * sb))) * uLight;
  /* the raking beam is thin and low: beads high above the wall stay dim, they light up as they drop into it */
  float inBeam = exp(-P.z * P.z / (2.0 * uBeamH * uBeamH));
  beam *= mix(0.12, 1.0, inBeam);
  al *= mix(uHighA, 1.0, smoothstep(uBeamH * 3.2, uBeamH * 0.8, P.z));
  float fwd = pow(max(dot(-V, uL), 0.0), 2.0);
  vec3 alb = fC.rgb;
  vec3 lit = alb * uLcol * beam * (0.06 + 0.06 * max(uL.z, 0.0)) + alb * uAmb * 5.0;
  vec3 glow = alb * uLcol * beam * 0.16 * fwd;                       /* light through the translucent gel */
  vec3 rim = uLcol * beam * (0.035 + 0.1 * fwd) * (0.5 + alb);
  float spin = seed * 6.2831853 + uT * (2.0 + 6.0 * fC.a) * (fC.a > 0.5 ? 1.0 : -1.0);
  if (mist) { glow *= 0.0; rim *= 0.4; }
  if (type > 1.5) {
    /* mica flake: tumbles in flight, flashes when its face meets the half vector */
    float ph = seed * 40.0 + uT * (7.0 + 5.0 * fC.a);
    vec3 nf = normalize(vec3(sin(ph), cos(ph * 1.31 + seed * 17.0), 0.55 + 0.45 * sin(ph * 0.73 + 3.0)));
    vec3 Hh = normalize(uL + V);
    float gl = pow(max(abs(dot(nf, Hh)), 0.0), 60.0);
    lit = alb * uLcol * beam * (0.05 + 3.0 * gl);
    glow = vec3(0.0); rim *= 0.4;
  }
  vGlow = glow;
  vec4 cl = vp * vec4(P + uL * 4.0, 1.0);
  vec2 sl = (cl.xy / cl.w * 0.5 + 0.5) * uRes - s1;
  vec2 ldir = length(sl) > 1e-3 ? normalize(sl) : vec2(0.0, 1.0);
  vLd = vec2(dot(ldir, dir), dot(ldir, perp));
  float Rq = R * 1.2;
  vec2 loc = vec2(position.x * (hl + Rq), position.y * Rq);
  vec2 scr = (s0 + s1) * 0.5 + dir * loc.x + perp * loc.y;
  vQ = loc;
  vS = vec4(hl, R, max(0.85, coc * 0.8), clamp(r / R, 0.0, 1.0));
  vSh = vec4(spin - atan(dir.y, dir.x), fract(seed * 13.7), fract(seed * 7.31), type);
  vCol = vec4(lit, al);
  vRim = rim;
  gl_Position = vec4((scr / uRes) * 2.0 - 1.0, c1.z / c1.w, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vQ;
varying vec4 vS;
varying vec4 vSh;
varying vec4 vCol;
varying vec3 vRim;
varying vec3 vGlow;
varying vec2 vLd;
void main(){
  float hl = vS.x, R = vS.y;
  vec2 e = vec2(max(abs(vQ.x) - hl, 0.0) * sign(vQ.x), vQ.y);
  float dist = length(e);
  /* irregular gel granule: a lumpy outline that tumbles in flight (sharp beads only) */
  float th = atan(e.y, e.x) - vSh.x;
  float lump = vSh.w > 1.5 ? 0.0 : (0.13 * sin(2.0 * th + vSh.y * 6.283) + 0.07 * sin(3.0 * th + vSh.z * 6.283) + 0.04 * sin(5.0 * th + vSh.y * 12.0));
  float Re = R * (1.0 + lump * vS.w);
  if (vSh.w > 1.5) Re = R * mix(1.0, 0.55 + 0.45 * abs(cos(th)), vS.w);   /* mica: a thin flake seen edge-on / face-on */
  float cov = 1.0 - smoothstep(Re - vS.z, Re, dist);
  float a = vCol.a * cov;
  if (a < 0.003) discard;
  /* volume (limb darkening), light through the gel from behind, a crescent rim and a glint on the lit side;
     blurred beads fade to their flat average colour */
  float sharp = vS.w;
  float rr = clamp(dist / Re, 0.0, 1.0);
  float nz = sqrt(max(1.0 - rr * rr, 0.0));
  vec2 od = dist > 1e-4 ? e / dist : vec2(0.0);
  float side = max(dot(od, vLd), 0.0);
  float rim = smoothstep(0.55, 0.98, rr) * side * side;
  vec2 gp = e / Re - vLd * 0.45;
  float glint = exp(-dot(gp, gp) / 0.03);
  vec3 col = vCol.rgb * mix(1.0, 0.55 + 0.6 * nz, sharp) + vGlow * mix(0.6, nz * 1.5, sharp)
           + vRim * (rim * 1.5 + glint * 1.0) * sharp;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createSpray(T) {
  const uniforms = {
    uT: { value: 0 }, uNoz: { value: new T.Vector3() }, uNozD: { value: new T.Vector3(3, 3, 3) },
    uG: { value: 60 }, uTurb: { value: 5 }, uShutter: { value: 1 / 600 },
    uFocus: { value: 80 }, uAper: { value: 26 }, uRes: { value: new T.Vector2(1, 1) },
    uL: { value: new T.Vector3(0, 1, 0) }, uLcol: { value: new T.Color() }, uAmb: { value: new T.Color() },
    uPool: { value: new T.Vector3(0, 0, 20) }, uLight: { value: 1 }, uNear: { value: 9 }, uDofK: { value: 0.3 }, uBeamH: { value: 7.5 }, uHighA: { value: 0.16 }, uMistA: { value: 0.32 }
  };
  const material = new T.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: true, blending: T.NormalBlending
  });
  /* flights are drawn in chunks of the time-sorted list: only chunks with beads in the air are submitted */
  const CH = 4096;
  const quadPos = new T.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3), quadIdx = new T.Uint16BufferAttribute([0, 1, 2, 0, 2, 3], 1);
  const mesh = new T.Group();
  mesh.visible = false;
  let chunks = [];
  return {
    mesh, material, uniforms,
    setList(fly) {
      chunks.forEach(c => { mesh.remove(c.m); c.g.dispose(); });
      chunks = [];
      for (let s0 = 0; s0 < fly.count; s0 += CH) {
        const e = Math.min(fly.count, s0 + CH);
        const g = new T.InstancedBufferGeometry();
        g.setAttribute('position', quadPos); g.setIndex(quadIdx);
        g.setAttribute('fA', new T.InstancedBufferAttribute(fly.a.subarray(s0 * 4, e * 4), 4));
        g.setAttribute('fB', new T.InstancedBufferAttribute(fly.b.subarray(s0 * 4, e * 4), 4));
        g.setAttribute('fC', new T.InstancedBufferAttribute(fly.c.subarray(s0 * 4, e * 4), 4));
        g.instanceCount = e - s0;
        let t0 = 1e9, t1 = -1e9;
        for (let i = s0; i < e; i++) { t0 = Math.min(t0, fly.a[i * 4 + 2] - fly.a[i * 4 + 3]); t1 = Math.max(t1, fly.a[i * 4 + 2]); }
        const m = new T.Mesh(g, material); m.frustumCulled = false; m.renderOrder = 10;
        mesh.add(m); chunks.push({ g, m, t0, t1 });
      }
    },
    /* shows the chunks with beads in flight at time t; false when nothing is in the air */
    at(t) { let any = false; for (const c of chunks) { c.m.visible = t > c.t0 && t < c.t1; any = any || c.m.visible; } return any; },
    dispose() { chunks.forEach(c => c.g.dispose()); material.dispose(); }
  };
}
