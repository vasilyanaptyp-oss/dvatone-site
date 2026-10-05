/* Dvatone packaging: premium 3D silhouettes of the paint can and the rigid box, matte black with copper foil,
   soft studio light, slow turntable, optional drag to rotate. Stand-ins until product photos exist.
   DVPack.mount(el, { object:'can'|'box'|'both', drag:true, autoRotate:true, theme:'auto'|'dark'|'light',
                      volume:'2 л', canLine?, boxCaption?, angle? })
   -> { setObject(name), setTheme('dark'|'light'|'auto'), destroy(), stats(), ready }
   Declarative: <div data-dv3d="pack" data-object="both"></div> */
import { createStage, roundedBox, clamp, isSmallScreen } from './core.js';

const BASE = import.meta.url;
const LANG = /^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk';
const TXT = {
  uk: { line: 'МУЛЬТИКОЛОРОВЕ ДЕКОРАТИВНЕ ПОКРИТТЯ', vol: '2 л', box: 'DESIGNER BOX',
    label: { can: 'Банка Dvatone, матова чорна з мідним логотипом', box: 'Коробка Dvatone Designer Box, матова чорна з мідним логотипом', both: 'Банка й коробка Dvatone: матовий чорний і мідь' }, drag: 'Потягніть, щоб повернути' },
  en: { line: 'MULTICOLOUR DECORATIVE COATING', vol: '2 L', box: 'DESIGNER BOX',
    label: { can: 'Dvatone can, matte black with a copper logo', box: 'Dvatone Designer Box, matte black with a copper logo', both: 'Dvatone can and box: matte black and copper' }, drag: 'Drag to rotate' }
}[LANG];
const OBJECTS = ['can', 'box', 'both'];
const R0 = 0.875;          /* can radius, dm (175 mm can) */

let logoP = null;
function loadLogo() {
  if (logoP) return logoP;
  logoP = fetch(new URL('../img/dvatone-logo.svg', BASE)).then(r => r.text()).then(svg => {
    svg = svg.replace('<svg ', '<svg width="2193" height="373" ');
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => { URL.revokeObjectURL(url); res(im); }; im.onerror = rej; im.src = url; });
  });
  return logoP;
}
function copperGradient(g, x0, x1) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  [[0, '#5a1d15'], [0.08, '#934e20'], [0.21, '#9b5824'], [0.38, '#d09d51'], [0.71, '#dcba94'], [0.96, '#9f5606'], [1, '#9f5606']].forEach(s => gr.addColorStop(s[0], s[1]));
  return gr;
}
async function fontsReady() {
  try { await Promise.race([document.fonts.load('600 40px Manrope'), new Promise(r => setTimeout(r, 1500))]); } catch (e) { /* system font */ }
}
function spacedText(g, text, cx, y, spacing) {
  if ('letterSpacing' in g) { g.letterSpacing = spacing + 'px'; g.textAlign = 'center'; g.fillText(text, cx + spacing / 2, y); g.letterSpacing = '0px'; return; }
  const chars = [...text]; let w = 0; chars.forEach(c => (w += g.measureText(c).width + spacing)); w -= spacing;
  let x = cx - w / 2; g.textAlign = 'left'; chars.forEach(c => { g.fillText(c, x, y); x += g.measureText(c).width + spacing; });
}

export const DVPack = { mount, objects: OBJECTS.slice() };
if (typeof window !== 'undefined') window.DVPack = DVPack;

function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  const S = {
    object: OBJECTS.includes(opts.object) ? opts.object : 'can', drag: opts.drag !== false, auto: opts.autoRotate !== false,
    theme: opts.theme || 'auto', vol: opts.volume || TXT.vol, line: opts.canLine || TXT.line, cap: opts.boxCaption != null ? opts.boxCaption : TXT.box,
    angle: opts.angle != null ? +opts.angle : -0.5
  };
  const small = isSmallScreen();
  let T, R, scene, camera, table, can, box, key, ground, envRT = null, mats = {}, fit = { rc: 1, h: 1.9, el: 0.22 };
  const spin = { a: S.angle, v: 0, drag: false, lastX: 0, lastT: 0, idle: 0 };

  const stage = createStage(el, {
    poster: opts.poster === false ? null : (opts.poster || new URL('./fallback/pack-' + S.object + '.webp', BASE).href), label: TXT.label[S.object],
    className: 'dv3d--pack' + (S.drag ? ' is-drag' : ''), alpha: true,
    build, update, render, resize, scene: () => scene, camera: () => camera,
    continuous: () => spin.drag || Math.abs(spin.v) > 0.002, dispose
  });

  async function build(st) {
    T = st.THREE; R = st.renderer;
    R.toneMapping = T.NeutralToneMapping; R.toneMappingExposure = 1.0;
    R.shadowMap.enabled = true; R.shadowMap.type = T.PCFShadowMap;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(24, st.w / st.h, 0.5, 80);
    key = new T.DirectionalLight(0xfff4ea, 2.0);
    key.position.set(-3.2, 9, 5.5); key.castShadow = true;
    key.shadow.mapSize.set(small ? 512 : 1024, small ? 512 : 1024); key.shadow.radius = 7; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 2, far: 22 });
    scene.add(key);
    ground = new T.Mesh(new T.PlaneGeometry(30, 30), new T.ShadowMaterial({ opacity: 0.4, transparent: true, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    applyTheme();
    table = new T.Group(); scene.add(table);
    await makeMaterials();
    can = makeCan(); box = makeBox();
    table.add(can, box);
    layout();
    if (S.drag) bindDrag(st.wrap);
  }

  function applyTheme() {
    const dark = S.theme === 'dark' || (S.theme === 'auto' && isDarkBehind(el));
    if (envRT) envRT.dispose();
    envRT = studioEnv(dark); scene.environment = envRT.texture;
    scene.environmentIntensity = dark ? 1.25 : 0.9;
    key.intensity = dark ? 1.6 : 2.0;
    ground.material.opacity = dark ? 0.55 : 0.24;
  }
  function isDarkBehind(node) {
    for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor, m = c && c.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(Number); if (p.length < 4 || p[3] > 0.5) return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) < 110; }
    }
    return true;
  }

  function studioEnv(dark) {
    const s = new T.Scene();
    const lin = (r, g, b) => new T.Color().setRGB(r, g, b, T.LinearSRGBColorSpace);
    const room = new T.Mesh(new T.BoxGeometry(24, 14, 24), new T.MeshBasicMaterial({ color: dark ? lin(0.012, 0.011, 0.01) : lin(0.32, 0.3, 0.28), side: T.BackSide }));
    s.add(room);
    const panel = (w, h, col, pos, look) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: col, side: T.DoubleSide }));
      m.position.set(...pos); m.lookAt(...look); s.add(m);
    };
    panel(9, 5, lin(4.6, 4.45, 4.3), [0, 6.5, 1.5], [0, 0, 0]);                 /* overhead softbox */
    panel(1.1, 8, lin(15, 14.4, 13.6), [-7, 2.5, -4.5], [0, 1, 0]);             /* rim strips */
    panel(1.1, 8, lin(12, 11.5, 11), [7, 2.5, -4.5], [0, 1, 0]);
    panel(7, 5, lin(1.9, 1.75, 1.6), [-4.5, 2.5, 9], [0, 1, 0]);                /* large front-left fill card */
    panel(2.5, 4, lin(2.6, 2.4, 2.2), [6, 1.5, 6], [0, 1, 0]);                  /* small kicker */
    panel(10, 10, lin(0.16, 0.13, 0.1), [0, -6.5, 0], [0, 0, 0]);              /* soft warm floor bounce */
    const pm = new T.PMREMGenerator(R);
    const rt = pm.fromScene(s, 0.02); pm.dispose();
    s.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });
    return rt;
  }

  async function makeMaterials() {
    const P = o => new T.MeshPhysicalMaterial(o);
    mats.black = P({ color: 0x0f0f0f, roughness: 0.48, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.32 });
    mats.blackPaper = P({ color: 0x111111, roughness: 0.66, metalness: 0.0, sheen: 0.55, sheenRoughness: 0.6, sheenColor: new T.Color(0x3c3b39) });
    mats.blackMetal = P({ color: 0x141312, roughness: 0.34, metalness: 0.85 });
    mats.grip = P({ color: 0x0c0b0b, roughness: 0.7 });
    mats.copper = P({ color: new T.Color().setRGB(0.87, 0.56, 0.33, T.LinearSRGBColorSpace), metalness: 1, roughness: 0.26 });
    await fontsReady();
    let logo = null; try { logo = await loadLogo(); } catch (e) { logo = null; }
    mats.canFoil = foilMaterial(canLabelCanvas(logo));
    mats.boxFoil = foilMaterial(boxLabelCanvas(logo));
  }
  function foilMaterial(cv) {
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy());
    return new T.MeshPhysicalMaterial({ map: tex, metalness: 1, roughness: 0.24, transparent: false, alphaTest: 0.5, alphaToCoverage: true, side: T.FrontSide });
  }
  function canLabelCanvas(logo) {
    /* decal covers 150 degrees of the can front, 0.86 dm high; content stays inside the front ~90 degrees */
    const W = 2048, H = Math.round(W * 0.86 / (R0 * 2.618)), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const lw = W * 0.4, lh = lw * 18.67 / 109.64, lx = (W - lw) / 2, ly = H * 0.3;
    if (logo) g.drawImage(logo, lx, ly, lw, lh);
    else { g.fillStyle = copperGradient(g, lx, lx + lw); g.font = '600 ' + Math.round(lh * 1.1) + 'px Manrope, sans-serif'; spacedText(g, 'DVATONE', W / 2, ly + lh, lh * 0.2); }
    g.fillStyle = copperGradient(g, W * 0.2, W * 0.8);
    let fs = Math.round(H * 0.05); g.textBaseline = 'alphabetic';
    const fitW = W * 0.46, sp = () => fs * 0.3;
    for (let i = 0; i < 12; i++) { g.font = '600 ' + fs + 'px Manrope, system-ui, sans-serif'; if (g.measureText(S.line).width + sp() * S.line.length <= fitW) break; fs = Math.floor(fs * 0.92); }
    spacedText(g, S.line, W / 2, ly + lh + H * 0.17, sp());
    g.fillRect(W * 0.47, ly + lh + H * 0.25, W * 0.06, Math.max(2, H * 0.004));
    g.font = '500 ' + Math.round(H * 0.06) + 'px Manrope, system-ui, sans-serif';
    spacedText(g, S.vol, W / 2, ly + lh + H * 0.36, H * 0.01);
    return cv;
  }
  function boxLabelCanvas(logo) {
    const W = 1536, H = 576, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const lw = W * 0.62, lh = lw * 18.67 / 109.64, lx = (W - lw) / 2, ly = H * 0.26;
    if (logo) g.drawImage(logo, lx, ly, lw, lh);
    if (S.cap) {
      g.fillStyle = copperGradient(g, W * 0.25, W * 0.75);
      g.font = '600 ' + Math.round(H * 0.075) + 'px Manrope, system-ui, sans-serif';
      spacedText(g, S.cap, W / 2, ly + lh + H * 0.25, H * 0.03);
    }
    return cv;
  }

  function lathe(pts, mat, seg = 128) {
    const m = new T.Mesh(new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg), mat);
    m.castShadow = true; m.receiveShadow = true; return m;
  }
  function makeCan() {
    const g = new T.Group(), R = R0;
    const body = new T.Mesh(new T.CylinderGeometry(R, R, 1.71, 128, 1, true), mats.black);
    body.position.y = 0.945; body.castShadow = body.receiveShadow = true; g.add(body);
    g.add(lathe([[0, 0.012], [R - 0.05, 0.012], [R - 0.03, 0.0], [R + 0.006, 0.0], [R + 0.03, 0.02], [R + 0.036, 0.05], [R + 0.022, 0.08], [R + 0.002, 0.095], [R, 0.1]], mats.blackMetal));
    g.add(lathe([[R, 1.79], [R + 0.016, 1.8], [R + 0.036, 1.838], [R + 0.042, 1.878], [R + 0.027, 1.913], [R - 0.004, 1.926], [R - 0.03, 1.912], [R - 0.046, 1.886],
      [R - 0.062, 1.878], [R - 0.078, 1.889], [R - 0.1, 1.894], [R - 0.12, 1.889], [R - 0.14, 1.894], [R * 0.6, 1.899], [R * 0.25, 1.9], [0, 1.9]], mats.copper));
    [0.5, 1.53].forEach(y => { const ring = new T.Mesh(new T.CylinderGeometry(R + 0.0015, R + 0.0015, 0.011, 128, 1, true), mats.copper); ring.position.y = y; g.add(ring); });
    const decal = new T.Mesh(new T.CylinderGeometry(R + 0.002, R + 0.002, 0.86, 128, 1, true, -1.309, 2.618), mats.canFoil);
    decal.position.y = 1.0; g.add(decal);
    /* bail handle folded down the back */
    const pts = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32, ph = -Math.PI * t;                 /* from +x around the back (-z) to -x */
      const r = R + 0.035 + 0.025 * Math.sin(Math.PI * t);
      pts.push(new T.Vector3(r * Math.cos(ph), 1.62 - 0.4 * Math.sin(Math.PI * t), r * Math.sin(ph)));
    }
    const wire = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 96, 0.011, 8, false), mats.blackMetal);
    wire.castShadow = true; g.add(wire);
    const grip = new T.Mesh(new T.CylinderGeometry(0.036, 0.036, 0.42, 24), mats.grip);
    grip.rotation.z = Math.PI / 2; grip.position.set(0, 1.22, -(R + 0.06)); grip.castShadow = true; g.add(grip);
    [-1, 1].forEach(s => { const ear = new T.Mesh(new T.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.black); ear.rotation.z = -s * Math.PI / 2; ear.position.set(s * (R - 0.005), 1.62, 0); ear.scale.set(1, 0.35, 1); g.add(ear); });
    g.add(blob(1.05, true, 0.62));
    return g;
  }
  function makeBox() {
    const g = new T.Group();
    const base = new T.Mesh(roundedBox(T, 3.1, 0.6, 2.2, 0.025, 3), mats.blackPaper);
    base.position.y = 0.3; base.castShadow = base.receiveShadow = true; g.add(base);
    const lid = new T.Mesh(roundedBox(T, 3.16, 0.34, 2.26, 0.03, 3), mats.blackPaper);
    lid.position.y = 0.85 - 0.17; lid.castShadow = lid.receiveShadow = true; g.add(lid);
    const dec = new T.Mesh(new T.PlaneGeometry(2.0, 0.75), mats.boxFoil);
    dec.rotation.x = -Math.PI / 2; dec.position.set(0, 0.8515, 0.05); g.add(dec);
    g.add(blob([3.4, 2.5], false, 0.7));
    return g;
  }
  function blob(size, round, op) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    if (round) { const gr = x.createRadialGradient(128, 128, 30, 128, 128, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(0.62, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); }
    else { x.filter = 'blur(14px)'; x.fillStyle = '#fff'; x.fillRect(34, 34, 188, 188); }
    const tex = new T.CanvasTexture(c);
    const m = new T.Mesh(new T.PlaneGeometry(round ? size * 2 : size[0], round ? size * 2 : size[1]), new T.MeshBasicMaterial({ color: 0x000000, alphaMap: tex, transparent: true, opacity: op, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.002; m.renderOrder = -1;
    return m;
  }

  function layout() {
    can.visible = S.object !== 'box'; box.visible = S.object !== 'can';
    if (S.object === 'both') {
      box.position.set(-0.86, 0, -0.52); box.rotation.y = 0.3;
      can.position.set(0.95, 0, 0.6); can.rotation.y = -0.2;
      fit = { rc: 2.05, h: 1.93, el: 0.28, cx: -0.36 }; /* the pair only sways: fit its real extent, centred */
    } else if (S.object === 'box') {
      box.position.set(0, 0, 0); box.rotation.y = 0; fit = { rc: 1.95, h: 0.86, el: 0.52 };
    } else {
      can.position.set(0, 0, 0); can.rotation.y = 0; fit = { rc: 0.97, h: 1.93, el: 0.22 };
    }
    stage.wrap.setAttribute('aria-label', TXT.label[S.object] + (S.drag ? '. ' + TXT.drag : ''));
    resize(stage.w, stage.h);
  }
  function resize(w, h) {
    if (!camera) return;
    camera.aspect = w / h;
    /* fit the turntable cylinder for every rotation angle: no cut-offs while it spins */
    const vf = 24 * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect), el = fit.el;
    const rcH = fit.rc + (fit.cx && camera.aspect < 1.25 ? Math.abs(fit.cx) + 0.35 : 0);   /* narrow frames: room for the sway */
    const dH = rcH / Math.sin(hf / 2);
    const dV = (fit.h / 2 * Math.cos(el) + fit.rc * Math.sin(el)) / Math.tan(vf / 2) + fit.rc * 0.35;
    const dist = Math.max(dH, dV) * 1.07, cy = fit.h * 0.47;
    camera.fov = vf * 180 / Math.PI; camera.updateProjectionMatrix();
    const cx = fit.cx || 0;
    camera.position.set(cx, cy + Math.sin(el) * dist, Math.cos(el) * dist);
    camera.lookAt(cx, cy, 0);
  }

  /* turntable + drag with inertia */
  function update(t, dt) {
    dt = dt || 0;
    const moving = S.auto && !stage.reduced;
    if (S.object === 'both') {
      /* the pair sways around a balanced three-quarter view instead of orbiting like a carousel */
      const target = S.angle + (moving ? 0.42 * Math.sin(2 * Math.PI * t / 18) : 0);
      if (!spin.drag) {
        spin.idle += dt;
        spin.a += spin.v * dt; spin.v *= Math.exp(-dt * 2.4);
        const k = spin.idle > 1.0 ? Math.min(1, dt * 0.9) : 0;
        spin.a += (target - spin.a) * k;
      }
    } else {
      const autoV = moving ? (2 * Math.PI / 42) : 0;
      if (!spin.drag) {
        spin.idle += dt;
        spin.v += (autoV - spin.v) * Math.min(1, dt * (spin.idle > 1.2 ? 1.2 : 0.35));
        spin.a += spin.v * dt;
      }
    }
    table.rotation.y = spin.a;
  }
  function render() { R.render(scene, camera); }
  function bindDrag(w) {
    w.tabIndex = 0;
    w.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      spin.drag = true; spin.lastX = e.clientX; spin.lastT = performance.now(); spin.v = 0;
      w.classList.add('is-dragging'); try { w.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      stage.start();
    });
    w.addEventListener('pointermove', e => {
      if (!spin.drag) return;
      const now = performance.now(), dx = e.clientX - spin.lastX, dtm = Math.max(1, now - spin.lastT);
      const k = 5.2 / Math.max(320, w.clientWidth);
      spin.a += dx * k; spin.v = (dx * k) / (dtm / 1000); spin.v = clamp(spin.v, -6, 6);
      spin.lastX = e.clientX; spin.lastT = now; spin.idle = 0;
      stage.invalidate();
    });
    const end = () => { if (!spin.drag) return; spin.drag = false; spin.idle = 0; w.classList.remove('is-dragging'); stage.start(); };
    w.addEventListener('pointerup', end); w.addEventListener('pointercancel', end); w.addEventListener('lostpointercapture', end);
    w.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); spin.a += (e.key === 'ArrowLeft' ? -1 : 1) * 0.26; spin.idle = 0; stage.invalidate();
    });
  }

  const ctl = {
    el, get ready() { return stage.readyP; },
    setTheme(theme) {
      S.theme = theme === 'light' || theme === 'dark' ? theme : 'auto';
      if (stage.ready) { applyTheme(); stage.invalidate(); }
    },
    setObject(name) {
      if (!OBJECTS.includes(name) || name === S.object) return;
      S.object = name; spin.a = S.angle; spin.v = 0; if (opts.poster !== false && !opts.poster) stage.setPoster(new URL('./fallback/pack-' + name + '.webp', BASE).href);
      if (stage.ready) { layout(); stage.invalidate(); }
    },
    stats() { return Object.assign({ object: S.object }, stage.stats); },
    renderFrame() { if (stage.ready) { update(stage.t, 0); render(); } },
    destroy() { stage.destroy(); }
  };
  el.dv3d = ctl;
  return ctl;

  function dispose() {
    const seen = new Set();
    scene && scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !seen.has(o.material)) { seen.add(o.material); ['map', 'alphaMap'].forEach(k => o.material[k] && o.material[k].dispose()); o.material.dispose(); }
    });
    envRT && envRT.dispose();
  }
}

function autoMount() {
  document.querySelectorAll('[data-dv3d="pack"]').forEach(el => {
    if (el.dv3d) return;
    const poster = el.getAttribute('data-poster');
    mount(el, { object: el.getAttribute('data-object') || 'can', drag: el.getAttribute('data-drag') !== 'false', theme: el.getAttribute('data-theme') || 'auto',
      volume: el.getAttribute('data-volume') || undefined, poster: poster === 'none' ? false : (poster || undefined) });
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
