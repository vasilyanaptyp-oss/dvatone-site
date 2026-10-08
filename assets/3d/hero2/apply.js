/* hero2 first screen: the coating applied on the wall of the room photograph.
   Two stills of the same Cycles frame (the room with the primed wall, the room with the coat), the wall's coverage mask
   and the frame's homography (wall metres for every photo pixel). The sprayer works in horizontal passes from the top of
   the wall to the bottom, alternating direction; the paint lands in a soft disc around the nozzle, so every pass leaves
   an organic, noise-broken edge and overlaps the next one. The multicolour coat is there as soon as the wet layer lands:
   a little darker and glossy where the light is (a wet sheen), drying in about a second. A fine mist travels with the
   nozzle in front of the wall (behind the furniture). Outside the wall the room's colour bleed changes with the coat.
   Raw WebGL2, no three.js; one full-screen pass. Where the browser can, all of it runs in a worker on the page's canvas
   (OffscreenCanvas, apply-worker.js): the WebGL context's creation, the shader's compile, the decodes, the uploads and every
   frame stay off the page's main thread, so the headline's letters and the page never wait for it. */

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 oColor;
uniform sampler2D uPre, uCoat, uMask;
uniform vec4 uFit;            /* photo uv = uFit.xy + vUv * uFit.zw (cover crop) */
uniform mat3 uH;              /* photo NDC -> wall metres (homogeneous) */
uniform vec4 uRect;           /* wall area the passes cover: x0, x1, y top, y bottom (metres) */
uniform float uT, uDur, uBands, uPx; uniform vec2 uPhotoPx;
uniform vec3 uMist;           /* the coat's mean colour (sRGB) */
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main(){
  vec2 puv = uFit.xy + vUv * uFit.zw;
  vec3 P = texture(uPre, puv).rgb, C = texture(uCoat, puv).rgb;
  float m = texture(uMask, puv).r;
  vec3 hw = uH * vec3(puv * 2.0 - 1.0, 1.0);
  vec2 w = hw.xy / hw.z;                                   /* wall metres: x to the right, y up from the floor */
  float x0 = uRect.x, x1 = uRect.y, yt = uRect.z, yb = uRect.w;
  float hb = (yt - yb) / uBands, span = x1 - x0, over = 0.5 * hb;
  float s = clamp(uT / uDur, 0.0, 1.0) * uBands;            /* passes done so far (fractional) */
  float b = min(floor(s), uBands - 1.0), f = s - b;
  float dirB = mod(b, 2.0) < 0.5 ? 1.0 : -1.0;
  float xn = dirB > 0.0 ? mix(x0 - over, x1 + over, f) : mix(x1 + over, x0 - over, f);   /* the nozzle */
  float yn = yt - (b + 0.5) * hb;
  /* coverage: the passes over and under this point (the spray disc reaches about 0.7 of a band each way) */
  float by = clamp(floor((yt - w.y) / hb), 0.0, uBands - 1.0);
  float cov = 0.0, tc = 1e5;
  for (int k = -1; k <= 1; k++) {
    float bb = by + float(k);
    if (bb < 0.0 || bb > uBands - 1.0) continue;
    /* a hand-held pass is never a straight line: its centre wanders a little along the wall, its reach is lumpy */
    float yc = yt - (bb + 0.5) * hb + hb * (0.1 * sin(w.x * 1.15 + bb * 2.3) + 0.16 * (fbm(vec2(w.x * 0.7, bb * 3.7)) - 0.5));
    float dy = abs(w.y - yc) / hb;
    float g = 1.0 - smoothstep(0.3, 0.95, dy + 0.35 * (fbm(w * 2.6 + bb * 5.3) - 0.5));   /* the pass's vertical reach */
    if (g <= 0.0) continue;
    float db = mod(bb, 2.0) < 0.5 ? 1.0 : -1.0;
    float fx = clamp((db > 0.0 ? (w.x - x0 + over) : (x1 + over - w.x)) / (span + 2.0 * over), 0.0, 1.0);
    float tp = (bb + fx) / uBands * uDur;                   /* when this pass's nozzle is over the point */
    float r = hb * (0.55 + 0.25 * fbm(w * 1.7 + bb * 3.1));   /* the spray disc, lumpy */
    float ahead = (uT - tp) * (span + 2.0 * over) / (uDur / uBands);   /* metres the nozzle is past the point */
    float c = smoothstep(-0.55 * r, 0.65 * r, ahead - r * dy * 0.8) * g;      /* the landed density, soft over ~0.3 m */
    cov = max(cov, c);
    if (c > 0.02) tc = min(tc, tp + 0.15 * r / ((span + 2.0 * over) / (uDur / uBands)));
  }
  /* the edge of every pass is a spray's: the landed density falls off softly and organically (slow lumps along it) and
     lands as droplets, one threshold per photo pixel, so the edge is stippled, solid where the density is full */
  float dens = cov + (fbm(w * 2.3 + 7.0) - 0.5) * 0.5;
  float th = h21(floor(puv * uPhotoPx));
  float k = smoothstep(th - 0.06, th + 0.06, smoothstep(0.08, 0.92, dens));
  /* the wet layer: darker and richer, with a gloss where the light is, drying in about a second */
  float L = luma(P);
  float wet = k * exp(-max(uT - tc, 0.0) / 1.1) * step(tc, uT + 0.25);
  vec3 wetC = C * (1.0 - 0.3 * wet);
  wetC = max(mix(vec3(luma(wetC)), wetC, 1.0 + 0.3 * wet), 0.0);
  wetC += vec3(1.0, 0.97, 0.92) * wet * (0.6 * pow(L, 3.0) + 0.04);
  vec3 wall = mix(P, wetC, k);
  /* the room's colour bleed follows the coat */
  vec3 outside = mix(P, C, smoothstep(0.0, 1.0, uT / uDur));
  vec3 col = mix(outside, wall, m);
  /* fine mist travelling with the nozzle, in front of the wall and behind the furniture */
  if (uT < uDur + 0.4) {
    /* the spray cloud in front of the wall around the nozzle: a soft haze lit like the wall there, and drifting droplets */
    vec2 d = (w - vec2(xn + dirB * 0.25 * hb, yn)) / vec2(0.95 * hb, 0.55 * hb);
    float env = smoothstep(uDur + 0.4, uDur - 0.2, uT) * smoothstep(0.0, 0.2, uT);
    float haze = exp(-dot(d, d) * 1.3) * env;
    float drops = step(0.991 - 0.035 * haze, h21(floor(puv * uPhotoPx * 0.5) + floor(uT * 30.0) * 3.17));
    vec3 mc = mix(uMist, vec3(0.97, 0.95, 0.91), 0.5) * (0.62 + 0.6 * L);
    col = mix(col, mc, m * clamp(haze * 0.26 + drops * haze * 0.7, 0.0, 0.85));
  }
  oColor = vec4(col, 1.0);
}`;

/** The compositor on a canvas or an OffscreenCanvas (no DOM here).
    env: { frame() -> Promise, raf(f), caf(id), size() -> [css width, css height, devicePixelRatio] } */
export function core(canvas, o, env) {
  const gl = (o.nogl === true || (o.nogl === 'worker' && o.inWorker)) ? null : canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: !!o.capture, powerPreference: 'default' });
  const st = { t: 0, raf: 0, playing: false, dead: false, onEnd: null, fit: [0, 0, 1, 1], focus: o.focus || [0.5, 0.5], reason: '' };
  if (!gl) { st.reason = 'nogl'; return { ready: Promise.resolve(false), play() {}, step() {}, stop() {}, resize() {}, destroy() {}, state: st }; }
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  let prog = null, buf = null;
  /* the program compiles in parallel (checked lazily), in its own task after the context's creation */
  const compile = () => {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  };
  const tex = {};
  /* images are decoded off the main thread, already at the size the canvas needs (about one texel per screen pixel);
     each upload is its own short task (one per frame), and the uploads wait for o.when (the page's opening text) */
  const px = () => { const [w, h, d] = env.size(); return [w, h, Math.min(d || 1, o.dprCap || 2)]; };
  const need = () => {
    const [cw, ch, dpr] = px();
    const ap = o.meta.w / o.meta.h, ac = cw / Math.max(1, ch), fw = ac > ap ? 1 : ac / ap;
    const w = Math.min(o.meta.w, Math.ceil(cw * dpr / fw));
    return [w, Math.round(w / ap)];
  };
  const load = (url, full) => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.blob(); })
    .then(b => { const [w, h] = full ? [o.meta.w, o.meta.h] : need();
      return createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); });
  const frame = env.frame;
  const upload = (name, bmp, unit) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    tex[name] = t; bmp.close && bmp.close();
  };
  /* the program compiles in parallel while the images load; asked once, a few frames apart (each ask is a round trip) */
  const linked = async () => {
    if (ext) { for (let i = 0; i < 120 && !gl.getProgramParameter(prog, ext.COMPLETION_STATUS_KHR); i++) { await frame(); await frame(); } }
    return !!gl.getProgramParameter(prog, gl.LINK_STATUS);
  };
  const U = {};
  const ready = (async () => {
    try {
      await frame(); compile();
      const [pre, coat, mask] = await Promise.all([load(o.pre), load(o.coat), load(o.mask)]);
      if (st.dead) return false;
      if (o.when) await o.when;                     /* no uploads while the page's opening text runs */
      if (st.dead) return false;
      await frame(); upload('pre', pre, 0);
      await frame(); upload('coat', coat, 1);
      await frame(); upload('mask', mask, 2);
      if (!(await linked())) { console.warn('[dvatone 3d] apply shader:', gl.getProgramInfoLog(prog)); return false; }
      gl.useProgram(prog);
      for (const n of ['uPre', 'uCoat', 'uMask', 'uFit', 'uH', 'uRect', 'uT', 'uDur', 'uBands', 'uPx', 'uMist', 'uPhotoPx']) U[n] = gl.getUniformLocation(prog, n);
      gl.uniform1i(U.uPre, 0); gl.uniform1i(U.uCoat, 1); gl.uniform1i(U.uMask, 2);
      const h = o.meta.Hinv;
      gl.uniformMatrix3fv(U.uH, false, [h[0][0], h[1][0], h[2][0], h[0][1], h[1][1], h[2][1], h[0][2], h[1][2], h[2][2]]);
      gl.uniform1f(U.uDur, o.dur || 3.0); gl.uniform1f(U.uBands, o.bands || 5); gl.uniform2f(U.uPhotoPx, o.meta.w, o.meta.h);
      gl.uniform3fv(U.uMist, o.mist || [0.66, 0.6, 0.52]);
      const loc = gl.getAttribLocation(prog, 'aPos'); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      resize(); draw();
      await frame(); draw();                        /* the primed frame is on screen before the canvas shows */
      return !st.dead;
    } catch (e) { console.warn('[dvatone 3d] apply:', e && e.message || e); return false; }
  })();

  function resize(focus) {
    if (focus) st.focus = focus;
    const [cw, ch, dpr] = px();
    const W = Math.max(1, Math.round(cw * dpr)), H = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    /* cover crop, the same as the page's object-fit: cover with object-position = focus */
    const ap = o.meta.w / o.meta.h, ac = W / H;
    let fw = 1, fh = 1;
    if (ac > ap) fh = ap / ac; else fw = ac / ap;
    st.fit = [(1 - fw) * st.focus[0], (1 - fh) * (1 - st.focus[1]), fw, fh];
    if (!U.uFit) return;
    gl.uniform4fv(U.uFit, st.fit);
    gl.uniform1f(U.uPx, dpr);
    /* the passes cover the wall in view (left and right edges of the crop on the wall plane), floor to ceiling */
    const wx = u => { const hh = o.meta.Hinv, x = u * 2 - 1, y = 0; const X = hh[0][0] * x + hh[0][1] * y + hh[0][2], Z = hh[2][0] * x + hh[2][1] * y + hh[2][2]; return X / Z; };
    const xa = Math.max(0, wx(st.fit[0]) - 0.2), xb = Math.min(o.meta.wall[0], wx(st.fit[0] + st.fit[2]) + 0.2);
    gl.uniform4f(U.uRect, xa, xb, o.meta.wall[1], 0.0);
  }
  function draw() {
    if (!U.uT || st.dead) return;
    gl.uniform1f(U.uT, st.t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function tick(now) {
    if (!st.playing) return;
    if (st.last == null) st.last = now;
    st.t += Math.min(0.05, (now - st.last) / 1000); st.last = now;
    draw();
    if (st.t >= (o.dur || 3.0) + 0.6) { st.playing = false; const f = st.onEnd; st.onEnd = null; f && f(); return; }
    st.raf = env.raf(tick);
  }
  return {
    ready, state: st, resize: f => { resize(f); draw(); },
    play(onEnd) { st.onEnd = onEnd; st.playing = true; st.last = null; st.raf = env.raf(tick); },
    /* deterministic capture: advance the clock by dt and draw */
    step(dt) { st.t += dt; draw(); if (st.t >= (o.dur || 3.0) + 0.6 && st.onEnd) { const f = st.onEnd; st.onEnd = null; f(); } },
    stop() { st.playing = false; env.caf(st.raf); },
    destroy() { st.dead = true; st.playing = false; env.caf(st.raf); const l = gl.getExtension('WEBGL_lose_context'); l && l.loseContext(); }
  };
}

/** createApply(canvas, { meta, pre, coat, mask, focus, dur, bands, dprCap, mist, when, capture })
    -> { ready, state, play(onEnd), step(dt), stop(), resize(focus), destroy() }.
    In a worker on an OffscreenCanvas where the browser can (not for the deterministic capture), else on this thread. */
export function createApply(canvas, o) {
  const size = cv => [cv.clientWidth || 1, cv.clientHeight || 1, window.devicePixelRatio || 1];   /* layout size (the room drifts) */
  const local = cv => core(cv, o, { frame: () => new Promise(r => requestAnimationFrame(r)), raf: f => requestAnimationFrame(f), caf: id => cancelAnimationFrame(id), size: () => size(cv) });
  if (o.capture || typeof canvas.transferControlToOffscreen !== 'function' || typeof Worker !== 'function') return local(canvas);
  let w = null, off = null;
  try { w = new Worker(new URL('./apply-worker.js', import.meta.url), { type: 'module' }); off = canvas.transferControlToOffscreen(); }
  catch (e) { if (w) w.terminate(); return local(canvas); }
  const st = { mode: 'worker', onEnd: null };
  let impl = null;                                  /* this thread's compositor, when the worker has no WebGL2 (Safari 16) */
  const post = (m, tr) => { try { w.postMessage(m, tr || []); } catch (e) { /* the worker is gone */ } };
  const ready = new Promise(res => {
    w.onmessage = e => {
      const m = e.data || {};
      if (m.type === 'ready') {
        if (m.ok || m.reason !== 'nogl') { res(!!m.ok); return; }
        w.terminate(); const c2 = canvas.cloneNode(false); canvas.replaceWith(c2); impl = local(c2); impl.ready.then(res);
      } else if (m.type === 'end') { const f = st.onEnd; st.onEnd = null; if (f) f(); }
    };
    w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); res(false); };
  });
  post({ type: 'init', canvas: off, size: size(canvas), o: { meta: o.meta, pre: o.pre, coat: o.coat, mask: o.mask, focus: o.focus, dur: o.dur, bands: o.bands, dprCap: o.dprCap, mist: o.mist, nogl: o.nogl || false, inWorker: true } }, [off]);
  Promise.resolve(o.when).then(() => post({ type: 'when' }));
  return {
    ready, state: st,
    play(onEnd) { if (impl) { impl.play(onEnd); return; } st.onEnd = onEnd; post({ type: 'play' }); },
    step(dt) { if (impl) impl.step(dt); },
    stop() { if (impl) impl.stop(); else post({ type: 'stop' }); },
    resize(focus) { if (impl) impl.resize(focus); else post({ type: 'resize', size: size(canvas), focus }); },
    destroy() { if (impl) { impl.destroy(); return; } post({ type: 'destroy' }); setTimeout(() => w.terminate(), 300); }
  };
}
