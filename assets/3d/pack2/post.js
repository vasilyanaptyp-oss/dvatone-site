/* Dvatone pack2 post-processing (no three/addons needed):
   scene -> MSAA half-float target (linear HDR, premultiplied alpha)
         -> bloom: soft-knee threshold with a Karis average (no firefly flicker), 13-tap dual-filter down chain,
            9-tap tent up chain (only real highlights, i.e. the copper and the wet paint glints, reach it)
         -> Khronos PBR Neutral tone mapping (keeps hues: copper stays copper, swatches stay true)
         -> sRGB, premultiplied output for a transparent canvas, triangular dither (no banding on dark sections).
   Falls back to direct rendering with three's Neutral tone mapping when half-float targets are unavailable. */

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const PREFILTER = `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 kw(vec3 a, vec3 b, vec3 c, vec3 d){ /* Karis average: weights 1/(1+luma) */
  float wa = 1.0 / (1.0 + lum(a)), wb = 1.0 / (1.0 + lum(b)), wc = 1.0 / (1.0 + lum(c)), wd = 1.0 / (1.0 + lum(d));
  return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}
vec3 T(vec2 o){ return texture2D(tSrc, vUv + uTexel * o).rgb; }
void main(){
  vec3 a = T(vec2(-2.0, 2.0)), b = T(vec2(0.0, 2.0)), c = T(vec2(2.0, 2.0));
  vec3 d = T(vec2(-2.0, 0.0)), e = T(vec2(0.0)), f = T(vec2(2.0, 0.0));
  vec3 g = T(vec2(-2.0, -2.0)), h = T(vec2(0.0, -2.0)), i = T(vec2(2.0, -2.0));
  vec3 j = T(vec2(-1.0, 1.0)), k = T(vec2(1.0, 1.0)), l = T(vec2(-1.0, -1.0)), m = T(vec2(1.0, -1.0));
  vec3 col = kw(j, k, l, m) * 0.5 + kw(a, b, d, e) * 0.125 + kw(b, c, e, f) * 0.125 + kw(d, e, g, h) * 0.125 + kw(e, f, h, i) * 0.125;
  float br = max(col.r, max(col.g, col.b));
  float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-5);
  float w = max(rq, br - uThreshold) / max(br, 1e-5);
  gl_FragColor = vec4(min(col * w, vec3(64.0)), 1.0);
}`;

const DOWN = `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
vec3 T(vec2 o){ return texture2D(tSrc, vUv + uTexel * o).rgb; }
void main(){
  vec3 a = T(vec2(-2.0, 2.0)), b = T(vec2(0.0, 2.0)), c = T(vec2(2.0, 2.0));
  vec3 d = T(vec2(-2.0, 0.0)), e = T(vec2(0.0)), f = T(vec2(2.0, 0.0));
  vec3 g = T(vec2(-2.0, -2.0)), h = T(vec2(0.0, -2.0)), i = T(vec2(2.0, -2.0));
  vec3 j = T(vec2(-1.0, 1.0)), k = T(vec2(1.0, 1.0)), l = T(vec2(-1.0, -1.0)), m = T(vec2(1.0, -1.0));
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(col, 1.0);
}`;

const UP = `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uRadius; uniform float uWeight; varying vec2 vUv;
vec3 T(vec2 o){ return texture2D(tSrc, vUv + uTexel * o * uRadius).rgb; }
void main(){
  vec3 col = T(vec2(0.0)) * 4.0 + (T(vec2(0.0, 1.0)) + T(vec2(-1.0, 0.0)) + T(vec2(1.0, 0.0)) + T(vec2(0.0, -1.0))) * 2.0
           + T(vec2(-1.0, 1.0)) + T(vec2(1.0, 1.0)) + T(vec2(-1.0, -1.0)) + T(vec2(1.0, -1.0));
  gl_FragColor = vec4(col / 16.0 * uWeight, 1.0);
}`;

const COMP = `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uExposure; uniform float uSeed; varying vec2 vUv;
vec3 neutral(vec3 color){
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 srgb(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec4 s = texture2D(tScene, vUv);
  vec3 b = texture2D(tBloom, vUv).rgb * uBloom;
  float a = clamp(s.a, 0.0, 1.0);
  vec3 obj = s.rgb / max(a, 1e-4);
  vec3 lit = srgb(neutral((obj + b) * uExposure));
  vec3 glow = srgb(neutral(b * uExposure));
  float ga = max(glow.r, max(glow.g, glow.b));
  vec3 col = lit * a + glow * (1.0 - a);
  float alpha = a + ga * (1.0 - a);
  float n = (hash(gl_FragCoord.xy + uSeed) + hash(gl_FragCoord.yx * 1.37 + uSeed * 0.61) - 1.0) / 255.0;
  col = clamp(col + n * step(0.004, alpha), 0.0, alpha);
  gl_FragColor = vec4(col, alpha);
}`;

export function createPost(THREE, renderer, opts = {}) {
  const halfOK = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const direct = !halfOK || opts.direct;
  const S = { exposure: opts.exposure || 1, bloom: opts.bloom == null ? 0.35 : opts.bloom, threshold: opts.threshold || 1.4, knee: opts.knee || 0.7,
    radius: opts.radius || 1.0, samples: opts.samples || 0, mips: opts.mips || 5, bloomOn: opts.bloomOn !== false, seed: 0,
    bloomScale: opts.bloomScale || 2, calls: 0, tris: 0 };
  if (direct) {
    renderer.toneMapping = THREE.NeutralToneMapping;
    return {
      direct: true, S,
      setSize() {}, setSamples() {}, setFluid() {},
      render(scene, camera) { renderer.toneMappingExposure = S.exposure; renderer.setRenderTarget(null); renderer.render(scene, camera); S.calls = renderer.info.render.calls; S.tris = renderer.info.render.triangles; },
      materials: [], target: null,
      dispose() {}
    };
  }
  renderer.toneMapping = THREE.NoToneMapping;
  const fsScene = new THREE.Scene(), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(geo); quad.frustumCulled = false; fsScene.add(quad);

  const T = THREE.HalfFloatType;
  const mk = (w, h, o = {}) => {
    const rt = new THREE.WebGLRenderTarget(w, h, Object.assign({ type: T, depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }, o));
    rt.texture.generateMipmaps = false;
    return rt;
  };
  /* the scene's depth becomes a texture once the poured paint needs it (screen-space fluid, high tier) */
  let depthTex = false, rtMerge = null, fluidPass = null;
  const sceneRT = (w, h, n) => mk(w, h, Object.assign({ depthBuffer: true, samples: n }, depthTex ? { depthTexture: new THREE.DepthTexture(w, h) } : {}));
  let rtScene = sceneRT(1, 1, S.samples);
  const mips = [];
  for (let i = 0; i < S.mips; i++) mips.push(mk(1, 1));
  const mat = (frag, uniforms, extra) => new THREE.ShaderMaterial(Object.assign({ vertexShader: VS, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending }, extra || {}));
  const mPre = mat(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: S.threshold }, uKnee: { value: S.knee } });
  const mDown = mat(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const mUp = mat(UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: S.radius }, uWeight: { value: 1 } },
    { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, transparent: true });
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const mComp = mat(COMP, { tScene: { value: rtScene.texture }, tBloom: { value: black }, uBloom: { value: S.bloom }, uExposure: { value: S.exposure }, uSeed: { value: 0 } });
  let W = 1, H = 1, nm = 0;

  function pass(m, target, clear = true) {
    quad.material = m;
    renderer.setRenderTarget(target);
    const ac = renderer.autoClear; renderer.autoClear = clear;
    renderer.render(fsScene, fsCam);
    renderer.autoClear = ac;
  }
  function setSize(w, h) {
    W = Math.max(1, w | 0); H = Math.max(1, h | 0);
    rtScene.setSize(W, H);
    if (rtMerge) rtMerge.setSize(W, H);
    let mw = Math.max(1, Math.ceil(W / S.bloomScale)), mh = Math.max(1, Math.ceil(H / S.bloomScale));
    nm = 0;
    for (let i = 0; i < mips.length; i++) {
      mips[i].setSize(mw, mh);
      if (mw >= 4 && mh >= 4) nm = i + 1;
      mw = Math.max(1, Math.ceil(mw / 2)); mh = Math.max(1, Math.ceil(mh / 2));
    }
  }
  function setSamples(n) {
    if (n === S.samples) return;
    S.samples = n;
    const w = rtScene.width, h = rtScene.height;
    rtScene.dispose(); rtScene = sceneRT(w, h, n);
    mComp.uniforms.tScene.value = rtScene.texture;
  }
  /* fluid: fn({ sceneColor, sceneDepth, out, width, height }) draws the paint over the scene into `out` and returns
     true, or returns false when there is nothing to draw this frame */
  function setFluid(fn) {
    fluidPass = fn || null;
    if (fn && !depthTex) { depthTex = true; const w = rtScene.width, h = rtScene.height; rtScene.dispose(); rtScene = sceneRT(w, h, S.samples); }
    if (fn && !rtMerge) rtMerge = mk(W, H);
  }
  function render(scene, camera) {
    const prevClear = renderer.getClearColor(new THREE.Color()), prevA = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rtScene);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    S.calls = renderer.info.render.calls; S.tris = renderer.info.render.triangles;
    let src = rtScene.texture;
    if (fluidPass && fluidPass({ sceneColor: rtScene.texture, sceneDepth: rtScene.depthTexture, out: rtMerge, width: W, height: H })) src = rtMerge.texture;
    mComp.uniforms.tScene.value = src;
    const bloomOn = S.bloomOn && S.bloom > 0.001 && nm > 1;
    if (bloomOn) {
      mPre.uniforms.tSrc.value = src; mPre.uniforms.uTexel.value.set(1 / W, 1 / H);
      mPre.uniforms.uThreshold.value = S.threshold; mPre.uniforms.uKnee.value = S.knee;
      pass(mPre, mips[0]);
      for (let i = 1; i < nm; i++) {
        mDown.uniforms.tSrc.value = mips[i - 1].texture; mDown.uniforms.uTexel.value.set(1 / mips[i - 1].width, 1 / mips[i - 1].height);
        pass(mDown, mips[i]);
      }
      for (let i = nm - 1; i > 0; i--) {
        mUp.uniforms.tSrc.value = mips[i].texture; mUp.uniforms.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
        mUp.uniforms.uRadius.value = S.radius; mUp.uniforms.uWeight.value = 1;
        pass(mUp, mips[i - 1], false);
      }
      mComp.uniforms.tBloom.value = mips[0].texture;
    } else mComp.uniforms.tBloom.value = black;
    mComp.uniforms.uBloom.value = bloomOn ? S.bloom / Math.max(1, nm - 1) : 0;
    mComp.uniforms.uExposure.value = S.exposure;
    mComp.uniforms.uSeed.value = (S.seed = (S.seed + 1) % 977);
    pass(mComp, null);
    renderer.setClearColor(prevClear, prevA);
  }
  function dispose() {
    rtScene.dispose(); mips.forEach(m => m.dispose()); if (rtMerge) rtMerge.dispose();
    [mPre, mDown, mUp, mComp].forEach(m => m.dispose()); geo.dispose(); black.dispose();
  }
  return { direct: false, S, setSize, setSamples, setFluid, render, dispose, materials: [mPre, mDown, mUp, mComp], get target() { return rtScene; } };
}
