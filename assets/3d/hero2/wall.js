/* Dvatone hero v2: the coated wall.
   The wall is the plane z = 0 (millimetres, y up). The coating tile (coat.js) carries albedo and
   height / roughness / landing time. Lighting follows v1 (raking light, micro-shadows marched through
   the height field, satin sheen, mica glints, macro depth of field from mip blur) and adds:
   - wetness: a freshly landed fleck is darker and glossy, then dries to the matte satin finish;
   - a room mode (scroll story): window sun with a soft analytic window mask, sky fill, corner occlusion.
   Two programs from one source: ROOM 0 (macro only, lean) and ROOM 1 (used while the scroll story is on). */
import { ROOM_GLSL } from './room.js';

export const WALL_VERT = `
varying vec3 vW;
varying float vDepth;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export const WALL_FRAG = `
precision highp float;
uniform sampler2D uAlb;
uniform sampler2D uDat;
uniform float uTex;
uniform float uTileMM;
uniform float uCells;
uniform vec2 uOrigin;
uniform vec3 uL;
uniform vec3 uL2;
uniform vec3 uLcol;
uniform vec3 uL2col;
uniform vec3 uPool;
uniform float uPoolK;
uniform float uFocus;
uniform float uAper;
uniform float uRelief;
uniform float uFade;
uniform vec3 uAmb;
uniform float uTime;
uniform vec2 uRes;
uniform float uSteps;
uniform float uClock;
uniform float uWet;
uniform float uVig;
uniform float uRoom;          /* 0 macro light pool .. 1 room light */
uniform float uPrimer;        /* bare primer is satin until the coat is on */
#if ROOM
${ROOM_GLSL}
#endif
varying vec3 vW;
varying float vDepth;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  vec2 uv = (vW.xy - uOrigin) / uTileMM;
  vec2 dx = dFdx(uv) * uTex, dy = dFdy(uv) * uTex;
  float lod0 = 0.5 * log2(max(max(dot(dx, dx), dot(dy, dy)), 1e-8));
  float coc = abs(1.0 - uFocus / vDepth) * uAper;               /* blur in drawing-buffer pixels */
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
  /* normal from the height field */
  float hL = textureLod(uDat, uv - vec2(tx, 0.0), lod).r, hR = textureLod(uDat, uv + vec2(tx, 0.0), lod).r;
  float hD = textureLod(uDat, uv - vec2(0.0, tx), lod).r, hU = textureLod(uDat, uv + vec2(0.0, tx), lod).r;
  float cellUV = 1.0 / uCells;
  vec2 g = vec2(hR - hL, hU - hD) * cellUV / (2.0 * tx);
  vec3 n = normalize(vec3(-g.x * uRelief, -g.y * uRelief, 1.0));
  float h0 = d.r;
  /* key light: macro pool light blended into the room's window sun */
#if ROOM
  vec3 L = normalize(mix(uL, normalize(uSun), uRoom));
#else
  vec3 L = uL;
#endif
  /* micro-shadows: march towards the light through the height field */
  float lenXY = max(length(L.xy), 1e-3);
  vec2 ld = L.xy / lenXY;
  float rise = (L.z / lenXY) / uRelief;
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
  /* material: gel granules (satin), mica flakes (metallic, low roughness), fresh flecks wet */
  float metal = smoothstep(0.42, 0.3, d.g);
  float rough = clamp(metal > 0.5 ? d.g * 0.6 : d.g * 0.84, 0.06, 1.0);
  float age = uClock - d.b;
  float wet = uWet * (age > -0.03 ? exp(-max(age, 0.0) / 0.55) : 0.0);
  alb *= 1.0 - 0.2 * wet;
  rough = mix(rough, 0.2, 0.75 * wet);
  rough = mix(rough, 0.4, uPrimer * smoothstep(-1.6, -1.95, d.b));
  vec3 V = normalize(cameraPosition - vW);
  vec3 H = normalize(L + V);
  float ndl = max(dot(n, L), 0.0);
  float wrap = max((dot(n, L) + 0.3) / 1.3, 0.0);
  float a = rough * rough, a2 = a * a;
  float NoH = max(dot(n, H), 0.0), NoV = max(dot(n, V), 1e-3), VoH = max(dot(V, H), 0.0);
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (ndl / (ndl * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  vec3 spec = D * G * F / max(4.0 * ndl * NoV, 1e-3);
  vec3 diffB = alb * (1.0 - metal) / 3.14159;
  /* macro: light pool */
  vec2 pd = vW.xy - uPool.xy;
  float pool = exp(-dot(pd, pd) / (2.0 * uPool.z * uPool.z));
  float E = (0.03 + 0.97 * pool) * uPoolK;
  vec3 colM = (diffB * mix(ndl, wrap, 0.3) + spec * ndl) * uLcol * E * sh;
  colM += diffB * max(dot(n, uL2), 0.0) * uL2col * (0.3 + 0.7 * pool);
  float hBlur = textureLod(uDat, uv, lod + 2.5).r;
  float ao = clamp(1.0 - (hBlur - h0) * 1.3, 0.5, 1.0);
  colM += alb * uAmb * ao * (0.6 + 0.4 * n.z);
  vec3 col = colM;
#if ROOM
  if (uRoom > 0.001) {
    /* room: the window sun rakes across the coating (soft analytic mask, bench and vase shadows), sky fill, occlusion */
    vec3 nW = vec3(0.0, 0.0, 1.0);
    float sv = sunVis(vW, nW);
    vec3 colR = (diffB * mix(ndl, wrap, 0.25) + spec * ndl * 0.6) * uSunCol * sv * sh;
    colR += alb * skyFill(vW, nW) * roomAO(vW, nW) * ao * (0.75 + 0.25 * n.z);
    colR += alb * uSunCol * 0.018 * exp(-max(vW.y - uRoomBox.z, 0.0) / 700.0);
    col = mix(colM, colR, uRoom);
  }
#endif
  col *= exp(-max(vDepth - uFocus * 0.92, 0.0) * uFade);
  gl_FragColor = vec4(col, 1.0);
#if ROOM
  gl_FragColor.rgb = dvTone(gl_FragColor.rgb, uRoom);   /* the room keeps the coating's chroma in shade (room.js) */
#else
  #include <tonemapping_fragment>
#endif
  #include <colorspace_fragment>
  vec2 sp = gl_FragCoord.xy / uRes;
  float vig = smoothstep(1.2, 0.3, length((sp - 0.5) * vec2(1.0, 0.9)) * 1.3);
  gl_FragColor.rgb *= mix(mix(0.5, 1.0, vig), 1.0, 1.0 - uVig);
  gl_FragColor.rgb += (ign(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * 0.014;
}`;
