/* Dvatone packaging v2, the scene: a physically based studio scene for the Designer Box block. ../pack2.js (the small
   entry with the public API) loads it when the block nears the viewport.
   Matte black can with a copper lid and copper-foil label, rigid Designer Box with a hinged lid, sample chips and a
   colour fan, a plinth coated with the composition. Studio HDRI (Poly Haven, CC0) reflections, soft key shadow,
   contact shadows, bloom on the copper highlights, Khronos Neutral tone mapping (hue-true).
   Real physics (Rapier, WASM): grab, toss and spin the can and the box; they collide with each other and the plinth
   and settle; after a few idle seconds they glide back to the hero pose. Click/tap the can: the lid lifts and shows
   the paint (granular multicolour, living sheen, ripples where you click). Click the box: the lid opens, click again:
   the colour fan rises and fans out; click a strip to pour that composition into the can.

   mount(el, { object:'can'|'box'|'both', colors:[{hex,share}], physics:true, theme:'dark'|'light'|'auto',
               labels:{...}, lang:'uk'|'en', poster:url|false, fan:[{name, colors}], plinth:'coating'|'dark'|colors,
               hint:true })
     -> { ready, setColors(colors), setObject(name), open(which?), close(which?), setTheme(t), reset(), stats(), destroy() }
   Events on el: dv3d:ready, dv3d:fallback, dv3d:open {object}, dv3d:close {object}, dv3d:pick {name, colors}.
   Declarative: <div data-dv3d="pack2" data-object="both" data-colors='[...]' data-physics="true"></div>
   Keyboard: Tab to the can or the box; arrows turn it (or pick a fan strip), Up/Down tilt the view, Enter opens,
   Escape closes, Home re-arranges. prefers-reduced-motion: no physics, static beauty pose, instant changes.
   No WebGL2: the poster stays. */
import { createStage, createBaker, bakeGranules, normColors, clamp, isSmallScreen, isFinePointer, crossfade, hasWebGL2 } from '../core.js';
import { detectTier, probe, remember, lower, TIER_CFG } from './tier.js';

const BASE = import.meta.url;
const RAPIER_URL = (typeof window !== 'undefined' && window.DV3D_RAPIER_URL) || 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/rapier.mjs';
const OBJECTS = ['can', 'box', 'both'];
const GRAV = 98.1;                 /* dm / s^2: real gravity, the scene is modelled in decimetres */
const HSTEP = 1 / 120;             /* physics substep */
const LAYER_DYN = 2;               /* objects that throw contact shadows */
/* real-ish physics (kg, decimetres, seconds): a filled steel can with its weight low, its thin tin lid, a light
   cardboard box, a stone plinth on a table. Bounce stays low (metal 0.15-0.2, cardboard 0.05), so things clatter
   and settle instead of springing about; rolling slows them the way a real can or a coin-like lid slows */
const PHYS = {
  can: { fr: 0.45, re: 0.15, lin: 0.03, ang: 0.12, roll: 6, held: 1.3 },        /* roll: the thick paint inside soaks up a rolling can quickly */
  lid: { mass: 0.045, fr: 0.32, re: 0.22, lin: 0.02, ang: 0.03, roll: 0.9, held: 0.8 },
  box: { mass: 0.45, fr: 0.6, re: 0.05, lin: 0.05, ang: 0.2, roll: 0, held: 1.7 },
  plinth: { fr: 0.62, re: 0.3 }, floor: { fr: 0.7, re: 0.25 }
};
/* the can's mass properties for a paint level 0..1: 0.3 kg of steel plus up to 1.2 kg of paint, whose weight sits low */
function canMass(level) {
  const R = 0.875, H = 1.93, COM = 0.965, ri = 0.85;
  const ms = 0.3, mp = 1.2 * level, hp = 1.62 * Math.max(level, 1e-3), yp = (0.02 + hp / 2) - COM;
  const m = ms + mp, yc = (mp * yp) / m;
  const ixs = ms * (R * R / 2 + H * H / 12), iys = ms * R * R;
  const ixp = mp * (ri * ri / 4 + hp * hp / 12), iyp = 0.5 * mp * ri * ri;
  const ix = ixs + ms * yc * yc + ixp + mp * (yp - yc) * (yp - yc);
  return { m, com: yc, ix, iy: iys + iyp };
}


/* the scene code (models, post, contact shadows, HDR loader) loads with three.js, when the block nears the viewport */
let loadHDR = null, createPost = null, createContact = null, M = null, partsP = null;
function loadParts() {
  if (!partsP) {
    partsP = Promise.all([import('./hdr.js'), import('./post.js'), import('./contact.js'), import('./models.js')])
      .then(([h, p, c, m]) => { loadHDR = h.loadHDR; createPost = p.createPost; createContact = c.createContact; M = m; });
    partsP.catch(() => { partsP = null; });
  }
  return partsP;
}

let rapierP = null;
function loadRapier() {
  if (!rapierP) {
    rapierP = import(/* @vite-ignore */ RAPIER_URL).then(async mod => {
      const RA = mod.default || mod;
      /* the compat build passes its inlined wasm positionally and warns about it; keep the console clean */
      const warn = console.warn;
      console.warn = function (...a) { if (!/deprecated parameters for the initialization function/.test(String(a[0]))) warn.apply(console, a); };
      let p; try { p = RA.init(); } finally { console.warn = warn; }
      await p;
      return RA;
    });
    rapierP.catch(() => { rapierP = null; });
  }
  return rapierP;
}

const TXT = {
  uk: {
    region: 'Упаковка Dvatone у 3D: банка й коробка Designer Box', can: 'Банка Dvatone', box: 'Коробка Designer Box',
    canHelp: 'Enter відкриває кришку, стрілки обертають банку', boxHelp: 'Enter відкриває коробку, ще раз розгортає віяло, стрілки обертають коробку',
    fanHelp: 'Стрілки вибирають зразок віяла, Enter наливає цей колір у банку, Escape закриває коробку',
    canOpened: 'Кришку знято: усередині фарба', canClosed: 'Банку закрито', boxOpened: 'Коробку відкрито: зразки й віяло',
    fanOpened: 'Віяло розгорнуто', boxClosed: 'Коробку закрито', picked: 'Колір у банці: {name}', strip: 'Зразок {name}',
    hint: 'Натисніть, щоб відкрити · потягніть, щоб підкинути', hintTouch: 'Торкніться, щоб відкрити · змахніть, щоб підкинути',
    live: 'Живе 3D', liveLabel: 'Увімкнути інтерактивне 3D: банка й коробка Designer Box',
    pour: 'Вилити', pourLabel: 'Вилити фарбу з банки на подіум', poured: 'Фарбу вилито: калюжа розтікається', refilled: 'Банку знову наповнено',
    line: 'МУЛЬТИКОЛОРОВЕ ДЕКОРАТИВНЕ ПОКРИТТЯ', vol: '2 л', boxCaption: 'DESIGNER BOX', inside: 'Зразки покриття для вашого проєкту'
  },
  en: {
    region: 'Dvatone packaging in 3D: the can and the Designer Box', can: 'Dvatone can', box: 'Designer Box',
    canHelp: 'Enter lifts the lid, arrow keys turn the can', boxHelp: 'Enter opens the box, again to fan out the colour fan, arrow keys turn the box',
    fanHelp: 'Arrow keys choose a fan strip, Enter pours that colour into the can, Escape closes the box',
    canOpened: 'Lid lifted: the paint inside', canClosed: 'Can closed', boxOpened: 'Box open: samples and the colour fan',
    fanOpened: 'Colour fan open', boxClosed: 'Box closed', picked: 'Colour in the can: {name}', strip: 'Sample {name}',
    hint: 'Click to open · drag to toss', hintTouch: 'Tap to open · flick to toss',
    live: 'Live 3D', liveLabel: 'Start the interactive 3D: the can and the Designer Box',
    pour: 'Pour', pourLabel: 'Pour the paint out of the can onto the plinth', poured: 'Paint poured: the puddle spreads', refilled: 'The can is full again',
    line: 'MULTICOLOUR DECORATIVE COATING', vol: '2 L', boxCaption: 'DESIGNER BOX', inside: 'Coating samples for your project'
  }
};
const mix = pairs => pairs.map(([hex, share]) => ({ hex, share }));
/* colour fan: compositions from the catalogue scans (no official DV recipes yet; DV 033 sampled from the macro photo) */
const FAN_SET = [
  { name: { uk: 'Мінерал', en: 'Mineral' }, colors: mix([['B8A389', 45], ['B4986D', 25], ['9F9287', 20], ['E4D1B4', 10]]) },
  { name: { uk: 'Граніт', en: 'Granite' }, colors: mix([['B7B3A8', 45], ['989492', 25], ['AFB1A8', 20], ['999997', 10]]) },
  { name: { uk: 'Теракота', en: 'Terracotta' }, colors: mix([['C5866E', 45], ['B87C7E', 25], ['BA9377', 20], ['E1D2CA', 10]]) },
  { name: { uk: 'Шавлія', en: 'Sage' }, colors: mix([['90A488', 45], ['C8CBC4', 25], ['819BAD', 20], ['E4D1B4', 10]]) },
  { name: { uk: 'Льон', en: 'Linen' }, colors: mix([['E4D1B4', 65], ['9F9287', 35]]) },
  { name: { uk: 'Слонова кістка', en: 'Ivory' }, colors: mix([['E4D1B4', 40], ['E1D2CA', 35], ['C8CBC4', 15], ['B7B3A8', 10]]) },
  { name: { uk: 'Пісок', en: 'Sand' }, colors: mix([['CFB084', 40], ['B6A277', 30], ['E4D1B4', 20], ['9F9287', 10]]) },
  { name: { uk: 'Туман', en: 'Mist' }, colors: mix([['C8CBC4', 45], ['AFB1A8', 30], ['E1D2CA', 15], ['999997', 10]]) },
  { name: { uk: 'Небо', en: 'Sky' }, colors: mix([['819BAD', 40], ['C8CBC4', 35], ['AFB1A8', 15], ['E4D1B4', 10]]) },
  { name: { uk: 'Глина', en: 'Clay' }, colors: mix([['BA9377', 45], ['C5866E', 20], ['B4986D', 20], ['E1D2CA', 15]]) },
  { name: { uk: 'Бронза', en: 'Bronze' }, colors: mix([['B4986D', 40], ['9F9287', 30], ['806438', 20], ['D4C095', 10]]) },
  { name: { uk: 'DV 033 Медова пробка', en: 'DV 033 Honey' }, colors: mix([['806438', 33], ['5A4220', 24], ['A88C5C', 18], ['D4C095', 17], ['3A2810', 8]]) }
];
const DARK_STONE = mix([['2C2926', 40], ['3A3531', 28], ['1F1D1B', 22], ['4B453E', 10]]);

const CSS = `
.dvp2-stage{touch-action:pan-y pinch-zoom;cursor:default;outline:none}
.dvp2-gate{position:relative;width:100%;height:100%}
.dvp2-gate__img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;user-select:none}
.dvp2-live{position:absolute;left:50%;bottom:clamp(10px,4%,24px);transform:translateX(-50%);display:inline-flex;align-items:center;gap:10px;
  min-height:44px;padding:0 20px;border:0;border-radius:999px;cursor:pointer;font:600 11px/1 Manrope,system-ui,sans-serif;letter-spacing:.14em;
  text-transform:uppercase;color:#ede6da;background:rgba(18,16,14,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  box-shadow:inset 0 0 0 1px rgba(220,186,148,.42);-webkit-tap-highlight-color:transparent}
.dvp2-live i{width:7px;height:7px;border-radius:50%;background:#c4935c;box-shadow:0 0 0 4px rgba(196,147,92,.2)}
.dvp2-live:focus-visible{outline:none;box-shadow:inset 0 0 0 1px rgba(220,186,148,.42),0 0 0 2px var(--focus,#e6c9a4)}
.dvp2-gate.is-light .dvp2-live{color:#191511;background:rgba(247,244,239,.7);box-shadow:inset 0 0 0 1px rgba(138,79,31,.4)}
.dvp2-stage.is-hover{cursor:grab}.dvp2-stage.is-point{cursor:pointer}.dvp2-stage.is-grabbing,.dvp2-stage.is-orbit{cursor:grabbing}
.dvp2-ui{position:absolute;inset:0;pointer-events:none;z-index:2}
.dvp2-hit{position:absolute;left:0;top:0;width:10px;height:10px;margin:0;padding:0;border:0;background:none;color:transparent;font-size:1px;
  border-radius:22px;pointer-events:none;outline:none;opacity:1;transition:box-shadow .25s ease}
.dvp2-hit:focus-visible{box-shadow:0 0 0 1.5px var(--focus,#e6c9a4),0 0 0 7px rgba(230,201,164,.14)}
.dvp2-stage.is-light .dvp2-hit:focus-visible{box-shadow:0 0 0 1.5px var(--focus-l,#8a4f1f),0 0 0 7px rgba(138,79,31,.12)}
.dvp2-hint{position:absolute;left:50%;bottom:clamp(10px,3%,22px);transform:translate(-50%,6px);padding:8px 14px;border-radius:999px;
  font:600 10.5px/1.2 Manrope,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap;
  color:rgba(237,230,218,.78);background:rgba(18,16,14,.38);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  box-shadow:inset 0 0 0 1px rgba(237,230,218,.12);opacity:0;transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}
.dvp2-stage.is-light .dvp2-hint{color:rgba(25,21,17,.7);background:rgba(247,244,239,.55);box-shadow:inset 0 0 0 1px rgba(25,21,17,.12)}
.dvp2-hint.is-on{opacity:1;transform:translate(-50%,0)}
.dvp2-hint i{font-style:normal}
.dvp2-hint.is-stack{border-radius:16px;padding:8px 16px;line-height:1.55;text-align:center}
.dvp2-hint.is-stack span{display:block}.dvp2-hint.is-stack i{display:none}
.dvp2-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.dvp2-pour{position:absolute;right:clamp(10px,3%,20px);bottom:clamp(10px,3%,20px);display:inline-flex;align-items:center;gap:8px;min-height:44px;
  padding:0 16px 0 13px;border:0;border-radius:999px;cursor:pointer;pointer-events:auto;font:600 11px/1 Manrope,system-ui,sans-serif;letter-spacing:.14em;
  text-transform:uppercase;color:#ede6da;background:rgba(18,16,14,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  box-shadow:inset 0 0 0 1px rgba(220,186,148,.42);-webkit-tap-highlight-color:transparent;opacity:0;transform:translateY(6px);
  transition:opacity .45s ease,transform .45s cubic-bezier(.2,.7,.2,1)}
.dvp2-pour.is-on{opacity:1;transform:none}
.dvp2-pour[hidden]{display:none}
.dvp2-pour svg{width:15px;height:15px;fill:none;stroke:#c4935c;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.dvp2-pour:focus-visible{outline:none;box-shadow:inset 0 0 0 1px rgba(220,186,148,.42),0 0 0 2px var(--focus,#e6c9a4)}
.dvp2-stage.is-light .dvp2-pour{color:#191511;background:rgba(247,244,239,.7);box-shadow:inset 0 0 0 1px rgba(138,79,31,.4)}
.dvp2-stage.is-light .dvp2-pour svg{stroke:#8a4f1f}
@media (max-width:420px){.dvp2-hint{font-size:9.5px;letter-spacing:.1em}}
@media (prefers-reduced-motion:reduce){.dvp2-hint,.dvp2-hit{transition:none}}
`;
function injectCSS() {
  if (document.getElementById('dvp2-css')) return;
  const s = document.createElement('style'); s.id = 'dvp2-css'; s.textContent = CSS; document.head.appendChild(s);
}

/* easing */
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t, s = 1.4) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lumOf = cols => cols.reduce((a, c) => { const n = parseInt(c.hex, 16); return a + c.share * (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)); }, 0);

export { mount, mountDeclared, FAN_SET, OBJECTS };

function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  injectCSS();
  const lang = opts.lang || (/^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk');
  const L = Object.assign({}, TXT[lang] || TXT.uk, opts.labels || {});
  const fanSrc = (Array.isArray(opts.fan) && opts.fan.length ? opts.fan : FAN_SET).slice(0, 16);
  const S = {
    object: OBJECTS.includes(opts.object) ? opts.object : 'both',
    colors: normColors(opts.colors || FAN_SET[0].colors),
    plinth: opts.plinth || 'coating',
    physics: opts.physics !== false,
    theme: opts.theme || 'auto',
    hint: opts.hint !== false,
    ph: 0.6, prK: 0.92, el: 0.38,
    fan: fanSrc.map(f => ({ name: typeof f.name === 'object' ? (f.name[lang] || f.name.uk || f.name.en) : (f.name || ''), colors: normColors(f.colors) }))
      .sort((a, b) => lumOf(a.colors) - lumOf(b.colors))
  };
  const small = isSmallScreen(), fine = isFinePointer();
  /* the can's label is in the page's language (the box poster has no text to translate) */
  const posterFor = o => new URL('./poster-' + o + (lang === 'en' && o !== 'box' ? '-en' : '') + '.webp', BASE).href;
  const G3 = (typeof window !== 'undefined' && window.DV3D) || {};
  /* quality tier: decided once per visit (pack2/tier.js); a 1-second frame probe at build may lower it */
  const tierInfo = detectTier();
  let tier = opts.tier && TIER_CFG[opts.tier] ? opts.tier : tierInfo.tier, TC = TIER_CFG[tier], tierWhy = tierInfo.why;

  /* ---------- three objects (created in build) ---------- */
  let T, R, scene, camera, post, contact, contactFloor = null, baker, envRT = null, envHDR = null, key, rim, fill, floor, floorRing, plinthMesh, plinthMat, mats, tex = {}, coat = null, coatPlinth = null, oldCoat = null;
  let paintMat, chipMats = [], stripMats = [], stripBakes = null;
  const chipIdx = [0, 2, 4, 6, 8, 10];
  let can = null, box = null, plinthR = 3.3, world = null, RA = null, physicsState = 'off';
  const items = {};
  const V = {};                       /* scratch vectors */
  const cam = { tx: 0, ty: 1.2, tz: 0, az: 0, el: 0.3, dist: 14, fov: 24 }, camGoal = Object.assign({}, cam), camVel = {};
  const view = { focus: 'hero', userAz: 0, userEl: 0, userVaz: 0, userVel: 0, par: [0, 0], parGoal: [0, 0] };
  let time = 0, lastInput = -10, dirty = true, shadowDirty = true, contactDirty = true, built = false, hintShown = false, hintT = 0;
  const buildSteps = {};
  let msaa = 4;
  let forceRender = false, lastDraw = -1;
  const drawn = [];
  const bounds = { xmin: -5, xmax: 5, ytop: 6, zf: 4.5, zb: -4.5 };
  let acc = 0, alpha = 0, grab = null, fanSel = -1, hoverStrip = -1, transitions = [], tweens = [];
  const ptr = { id: null, mode: null, x0: 0, y0: 0, t0: 0, x: 0, y: 0, lx: 0, ly: 0, lt: 0, vx: 0, vy: 0, hit: null, hold: 0, touch: false, hist: [] };
  let drawCount = 0, quietFrom = 0, physicsFaults = 0, dprBoost = 0;

  let stage = null, wrap = null, ui = null, live = null, hint = null, gate = null, readyResolve = null, pourBtn = null;
  const btn = {}, readyGate = new Promise(r => (readyResolve = r));
  function startStage(fromTap) {
    if (stage) return;
    stage = createStage(el, {
      poster: null,
      className: 'dv3d--pack dvp2-stage', alpha: true, antialias: false,
      build, update, render, resize, dispose,
      continuous: () => !!grab || tweens.length > 0 || transitions.length > 0
    });
    /* the poster too waits until the block nears the viewport (the browser's lazy loading), not the page load */
    const ps = opts.poster === false ? null : (opts.poster || posterFor(S.object));
    if (ps) { stage.poster.loading = 'lazy'; stage.setPoster(ps); }
    wrap = stage.wrap;
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', L.region);
    /* accessible overlay: one focusable button per object, a live region, the hint */
    ui = document.createElement('div'); ui.className = 'dvp2-ui'; wrap.appendChild(ui);
    live = document.createElement('div'); live.className = 'dvp2-sr'; live.setAttribute('aria-live', 'polite'); ui.appendChild(live);
    hint = document.createElement('div'); hint.className = 'dvp2-hint'; hint.setAttribute('aria-hidden', 'true');
    /* "open · toss": one line, or two stacked lines when one would fill the stage (fitHint) */
    (fine ? L.hint : L.hintTouch).split(' · ').forEach((t, i) => {
      if (i) { const d = document.createElement('i'); d.textContent = ' · '; hint.appendChild(d); }
      const s = document.createElement('span'); s.textContent = t; hint.appendChild(s);
    });
    ui.appendChild(hint);
    /* "Pour": shown while the can stands open with paint in it */
    pourBtn = document.createElement('button'); pourBtn.type = 'button'; pourBtn.className = 'dvp2-pour'; pourBtn.hidden = true;
    pourBtn.setAttribute('aria-label', L.pourLabel);
    pourBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l4 4.6M7.5 8.1c-1.4 1.6-2 2.8-2 3.7a2 2 0 004 0c0-.9-.6-2.1-2-3.7z"/><path d="M2 2.5l3-1 1.2 1.6"/></svg>';
    pourBtn.appendChild(document.createTextNode(L.pour));
    pourBtn.addEventListener('pointerdown', e => e.stopPropagation());
    pourBtn.addEventListener('click', e => { e.stopPropagation(); touchInput(); pourNow(); });
    ui.appendChild(pourBtn);
    ['can', 'box'].forEach(n => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dvp2-hit'; b.dataset.object = n;
      b.setAttribute('aria-expanded', 'false'); b.hidden = true; ui.appendChild(b); btn[n] = b;
      b.addEventListener('click', () => { touchInput(); activate(n, null); });
      b.addEventListener('keydown', e => onKey(e, n));
      b.addEventListener('focus', () => { dirty = true; invalidate(); wantPhysics(); });
    });
    if (fromTap) { wrap.tabIndex = -1; try { wrap.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    stage.readyP.then(v => readyResolve(v));
  }
  /* low tier: the poster with a small "Live 3D" button; nothing heavy loads until it is tapped */
  function showGate() {
    gate = document.createElement('div'); gate.className = 'dvp2-gate dv3d--pack';
    if (S.theme === 'light' || (S.theme === 'auto' && !isDarkBehind(el))) gate.classList.add('is-light');
    const im = document.createElement('img'); im.className = 'dvp2-gate__img'; im.alt = ''; im.decoding = 'async'; im.loading = 'lazy'; im.setAttribute('aria-hidden', 'true');
    if (opts.poster !== false) im.src = opts.poster || posterFor(S.object);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'dvp2-live'; b.setAttribute('aria-label', L.liveLabel);
    b.innerHTML = '<i aria-hidden="true"></i>'; b.appendChild(document.createTextNode(L.live));
    b.addEventListener('click', () => { gate.remove(); gate = null; startStage(true); });
    gate.append(im, b); el.appendChild(gate);
  }
  /* wake the stage once the current task is over: called inside a frame (core's tick clears its handle while the frame
     runs) an immediate stage.invalidate() would start a second animation-frame loop, and every frame would be drawn twice */
  let invQueued = false;
  function invalidate() {
    if (invQueued || !stage) return;
    invQueued = true;
    queueMicrotask(() => { invQueued = false; if (stage && !stage.destroyed) stage.invalidate(); });
  }
  function announce(s) { live.textContent = ''; setTimeout(() => { live.textContent = s; }, 30); }
  function emit(type, detail) { el.dispatchEvent(new CustomEvent(type, { bubbles: true, detail })); }
  function labelButtons() {
    if (!btn.can) return;
    btn.can.setAttribute('aria-label', L.can + '. ' + L.canHelp);
    const bx = items.box;
    btn.box.setAttribute('aria-label', L.box + '. ' + (bx && bx.state === 'fan' ? L.fanHelp : L.boxHelp));
    btn.can.setAttribute('aria-expanded', items.can && items.can.state !== 'closed' ? 'true' : 'false');
    btn.box.setAttribute('aria-expanded', bx && bx.state !== 'closed' ? 'true' : 'false');
  }

  /* ================= build ================= */
  async function build(st) {
    const tb = performance.now(), mark = n => (buildSteps[n] = Math.round(performance.now() - tb));
    T = st.THREE; R = st.renderer;
    const vec = () => new T.Vector3();
    Object.assign(V, { a: vec(), b: vec(), c: vec(), d: vec(), pv: vec(), q: new T.Quaternion(), q2: new T.Quaternion(), m: new T.Matrix4(), ray: new T.Raycaster(), ndc: new T.Vector2(), plane: new T.Plane(), box: new T.Box3() });
    R.shadowMap.enabled = true; R.shadowMap.type = T.VSMShadowMap; R.shadowMap.autoUpdate = false;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(cam.fov, st.w / st.h, 0.3, 120);
    const parts = loadParts();
    if (!tierInfo.fixed && !opts.tier && !G3.capture) {
      const ms = await probe(1000);
      tierWhy += ', idle frame ' + ms.toFixed(1) + ' ms';
      if (ms > 24) { tier = lower(tier); TC = TIER_CFG[tier]; tierWhy += ' (lowered)'; }
      remember(tier);
      if (stage.destroyed) return;
    }
    await parts;
    if (stage.destroyed) return;
    msaa = small ? TC.msaaSmall : TC.msaa;
    /* a phone-sized stage has few pixels: it can afford 4x MSAA and a denser pixel ratio (crisp strip edges) */
    if (tier !== 'low' && st.w * st.h < 280000) { msaa = 4; dprBoost = 2; }
    post = createPost(T, R, { samples: msaa, bloom: 0.42, threshold: 1.5, knee: 0.8, radius: 1.0, exposure: 1.0, bloomScale: TC.bloomScale, direct: TC.post === 'direct' });

    const [hdr, logo] = await Promise.all([
      loadHDR(T, new URL('./' + (TC.env || 'studio.hdr'), BASE).href),
      M.loadLogo(new URL('./dvatone-logo.svg', BASE).href).catch(() => null),
      M.fontsReady()
    ]);
    mark('fetch');
    if (stage.destroyed) { hdr.dispose(); return; }
    envHDR = hdr;
    buildEnv();

    /* lights: a soft key from the large front-left panel, a warm rim from behind-right */
    key = new T.SpotLight(0xfff3e8, 2.4, 0, 0.3, 1.0, 0);   /* a soft studio spot: the light pools on the objects and falls off over the plinth */
    key.castShadow = true;
    /* 1024 px is enough for a soft studio spot (512 on phones); the variance blur runs only on frames where something moves */
    key.shadow.mapSize.set(TC.shadow, TC.shadow);
    key.shadow.radius = TC.shadow >= 1024 ? 7 : 4; key.shadow.blurSamples = TC.shadow >= 1024 ? 12 : 8;
    key.shadow.bias = -0.0005; key.shadow.normalBias = 0.015;
    scene.add(key, key.target);
    rim = new T.DirectionalLight(0xffe2c6, 1.1); scene.add(rim, rim.target);
    fill = new T.DirectionalLight(0xffeedd, 0.3); fill.position.set(1.5, 3, 12); scene.add(fill);

    /* textures + materials */
    mark('env');
    baker = createBaker(T, R);
    /* 1) keep the granule bake program alive between bakes (core disposes each bake material, which would make every
          bake recompile it); 2) record the first bake passes, compile the program with the parallel-compile extension
          (no multi-second main-thread stall on Windows/ANGLE), then run the recorded passes */
    const shader0 = baker.shader, run0 = baker.run;
    let rec = [];
    baker.shader = (frag, uni) => { const m = shader0(frag, uni); if (!baker.keep) { baker.keep = m; m.dispose = () => {}; } return m; };
    baker.run = (m, rt) => { if (rec) rec.push([m, rt, Object.entries(m.uniforms).map(([k, u]) => [k, u.value])]); else run0(m, rt); };
    const big = TC.bake;
    coat = bakeGranules(T, baker, { colors: S.colors, size: big, cells: 128, density: 0.95, seed: 11 });
    if (S.plinth !== 'coating') coatPlinth = bakeGranules(T, baker, { colors: S.plinth === 'dark' ? DARK_STONE : normColors(S.plinth), size: big, cells: 128, density: 0.95, seed: 23 });
    await compileQuads([baker.keep].concat(post.materials || [], contactMats()), post.target || rec[0][1]);
    if (stage.destroyed) return;
    const todo = rec; rec = null;
    todo.forEach(([m, rt, vals]) => { vals.forEach(([k, v]) => (m.uniforms[k].value = v)); run0(m, rt); });
    /* the coating is seen at a glancing angle on the plinth and in the poured paint: keep its grain crisp */
    [coat, coatPlinth].forEach(b => { if (b) { aniso(b.albedo); aniso(b.data); } });
    mark('bakes');
    const pair = p => [M.canvasTex(T, R, p.a, true), M.canvasTex(T, R, p.d, false)];
    const txt = { line: L.line, vol: L.vol, box: L.boxCaption, inside: L.inside };
    [tex.canA, tex.canD] = pair(M.canLabel(logo, txt, TC.labels));
    [tex.lidA, tex.lidD] = pair(M.boxLidLabel(logo, txt, TC.labels));
    [tex.inA, tex.inD] = pair(M.boxInsideLabel(logo, txt, TC.labels));
    [tex.covA, tex.covD] = pair(M.coverLabel(logo, TC.labels));
    tex.paper = M.paperGrain(T, R);
    mark('labels');
    mats = M.makeMaterials(T, R, tex);
    paintMat = M.coatMaterial(T, coat, { paint: true, swirl: true, bump: 0.35 });
    plinthMat = M.coatMaterial(T, coatPlinth || coat, { bump: 0.45, roughness: 0.8 });
    stripMats = S.fan.map(() => M.coatMaterial(T, coat, { bump: 0.35, roughness: 0.68 }));        /* real coats baked after the first frame */
    chipMats = chipIdx.map(() => M.coatMaterial(T, coat, { bump: 0.4, roughness: 0.7 }));

    /* models */
    mark('textures');
    can = M.makeCan(T, mats, paintMat);
    box = M.makeBox(T, mats, chipMats, stripMats);
    items.can = makeItem('can', can, M.CAN.COM);
    items.box = makeItem('box', box, M.BOX.COM);
    scene.add(can.root, box.root);
    [can.root, box.root].forEach(r => r.traverse(o => { if (o.isMesh) o.layers.enable(LAYER_DYN); }));

    /* floor: shadow catcher + a soft occlusion ring around the plinth foot */
    floor = new T.Mesh(new T.PlaneGeometry(80, 80), edgeFade(new T.ShadowMaterial({ opacity: 0.5, transparent: true, depthWrite: false })));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; floor.renderOrder = 1; scene.add(floor);
    const rg = new T.RingGeometry(0.9, 1.5, 160, 1), ru = rg.attributes.uv, rp = rg.attributes.position;
    for (let i = 0; i < ru.count; i++) ru.setXY(i, (Math.hypot(rp.getX(i), rp.getY(i)) - 0.9) / 0.6, 0.5);
    floorRing = new T.Mesh(rg, edgeFade(new T.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, alphaMap: ringTex(), toneMapped: false })));
    floorRing.rotation.x = -Math.PI / 2; floorRing.position.y = 0.002; floorRing.renderOrder = 1; scene.add(floorRing);
    contact = createContact(T, R, { res: TC.contact, layer: LAYER_DYN, height: 0.9, darkness: 0.92, blur: TC.contact < 512 ? 1.6 : 2.4 });
    scene.add(contact.mesh);
    contactFloor = createContact(T, R, { res: TC.contact, layer: LAYER_DYN, height: 0.9, darkness: 0.85, blur: TC.contact < 512 ? 1.8 : 2.6, ground: 0 });
    edgeFade(contactFloor.mesh.material); contactFloor.mesh.visible = false; contactFloor.mesh.renderOrder = 1;
    scene.add(contactFloor.mesh);
    await compileQuads(contact.materials, post.target);
    if (stage.destroyed) return;

    applyTheme();
    layout(true);
    const pr0 = capDpr(st.w, st.h);
    post.setSize(Math.round(st.w * pr0), Math.round(st.h * pr0));
    fadeU.uRes.value.set(Math.round(st.w * pr0), Math.round(st.h * pr0));
    /* compile for the target the scene really renders into: the half-float target, or the canvas on the low tier
       (parallel compile: no first-frame stall) */
    if (R.compileAsync) {
      try { R.setRenderTarget(post.direct ? null : post.target); await R.compileAsync(scene, camera); } catch (e) { /* compiles on first frame */ } finally { R.setRenderTarget(null); }
    }
    mark('compile');
    if (stage.destroyed) return;
    bindInput();
    built = true;
    el.addEventListener('dv3d:ready', onReady, { once: true });
  }
  function onReady() {
    fitHint();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!stage.destroyed) fitHint(); });
    if (S.hint && !stage.reduced) setTimeout(() => { if (!hintShown && lastInput < 0) { hint.classList.add('is-on'); hintT = time; } }, 900);
    else if (S.hint) hint.classList.add('is-on');
    idle(() => { if (!stage.destroyed) ensureStrips(); });
    /* Rapier (about 740 KB) waits for a sign of intent (wantPhysics), so a visitor who only scrolls past never loads it;
       recordings (?capture) keep the early start */
    if (G3.capture) idle(() => startPhysics());
  }
  /* load the physics on a mouse press on the stage, the mouse resting on the can or the box, a touch that taps, holds,
     spins or orbits (never one that scrolls the page), keyboard focus on the can or the box */
  function wantPhysics() { if (physicsState === 'off' && built && S.physics && !stage.reduced) startPhysics(); }
  /* studio environment: the Poly Haven HDRI on a sphere (turned so its big diffusion panel is front-left and the two
     strip boxes rim the objects) plus one long overhead softbox behind them: it draws the wet highlight on the paint,
     the long glint on the copper lid and the soft gradient on the black coat */
  const ENV = { rot: 1.4, panel: { w: 9, h: 2.6, i: 5.5, pos: [0, 13, -10] } };
  function buildEnv() {
    const es = new T.Scene();
    const sg = new T.SphereGeometry(40, 96, 48);
    const sph = new T.Mesh(sg, new T.MeshBasicMaterial({ map: envHDR, side: T.BackSide, toneMapped: false }));
    sph.rotation.y = ENV.rot; es.add(sph);
    const P = ENV.panel, pg = new T.PlaneGeometry(P.w, P.h);
    const pmat = new T.MeshBasicMaterial({ color: new T.Color(P.i, P.i * 0.97, P.i * 0.92), side: T.DoubleSide, toneMapped: false });
    const panel = new T.Mesh(pg, pmat); panel.position.set(...P.pos); panel.lookAt(0, 0, 0); es.add(panel);
    const pm = new T.PMREMGenerator(R);
    const rt = pm.fromScene(es, 0, 0.5, 100);
    pm.dispose(); sg.dispose(); pg.dispose(); sph.material.dispose(); pmat.dispose();
    if (envRT) envRT.dispose();
    envRT = rt; scene.environment = rt.texture;
    shadowDirty = dirty = true;
  }
  function ensureStrips() {
    if (stripBakes || !built && !baker) return;
    stripBakes = S.fan.map((f, i) => bakeGranules(T, baker, { colors: f.colors, size: TC.strips, cells: TC.strips >= 512 ? 96 : 64, density: 0.95, seed: 31 + i }));
    stripBakes.forEach(b => { aniso(b.albedo); aniso(b.data); });
    const use = (m, b) => { m.map = b.albedo; m.bumpMap = b.data; m.userData.U.uOld.value = b.albedo; };
    stripMats.forEach((m, i) => use(m, stripBakes[i]));
    chipMats.forEach((m, j) => use(m, stripBakes[Math.min(chipIdx[j], stripBakes.length - 1)]));
    dirty = true; invalidate();
  }
  /* compile full-screen materials asynchronously (KHR_parallel_shader_compile through three's compileAsync) */
  async function compileQuads(list, target) {
    if (!R.compileAsync || !list.length) return;
    const sc = new T.Scene(), cm = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1), g = new T.PlaneGeometry(2, 2);
    list.forEach(m => { const q = new T.Mesh(g, m); q.frustumCulled = false; sc.add(q); });
    const prev = R.getRenderTarget();
    try { R.setRenderTarget(target || null); await R.compileAsync(sc, cm); } catch (e) { /* compiled on first use */ } finally { R.setRenderTarget(prev); g.dispose(); }
  }
  function contactMats() { return []; }
  /* anisotropic filtering on a render-target texture (the granule bakes): seen at a glancing angle the fan strips stay
     sharp instead of smearing into the next mip level */
  function aniso(tex) {
    try {
      const ext = R.extensions.get('EXT_texture_filter_anisotropic'), p = R.properties.get(tex), gl = R.getContext();
      if (!ext || !p || !p.__webglTexture) return;
      R.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, R.capabilities.getMaxAnisotropy()));
      R.state.bindTexture(gl.TEXTURE_2D, null);
    } catch (e) { /* plain trilinear */ }
  }
  function idle(fn) { (window.requestIdleCallback || (f => setTimeout(f, 200)))(fn, { timeout: 1500 }); }

  /* the canvas is transparent and the stage has no frame: whatever darkens the floor fades out before the canvas edges,
     so the shadow never shows a hard vertical cut on the section background */
  const fadeU = { uRes: { value: null }, uFade: { value: null } };
  function edgeFade(m) {
    fadeU.uRes.value = fadeU.uRes.value || new T.Vector2(1, 1);
    fadeU.uFade.value = fadeU.uFade.value || new T.Vector2(3.4, 5.2);
    m.onBeforeCompile = sh => {
      sh.uniforms.uRes = fadeU.uRes; sh.uniforms.uFade = fadeU.uFade;
      if (sh.vertexShader.includes('#include <worldpos_vertex>')) {
        sh.vertexShader = 'varying vec2 vFW_;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFW_ = (modelMatrix * vec4(position, 1.0)).xz;');
        sh.fragmentShader = 'varying vec2 vFW_;\nuniform vec2 uFade;\n' + sh.fragmentShader;
      }
      const f = 'vec2 sc_ = gl_FragCoord.xy / uRes; float ef_ = smoothstep(0.0, 0.12, sc_.x) * smoothstep(0.0, 0.12, 1.0 - sc_.x) * smoothstep(0.0, 0.1, sc_.y);';
      sh.fragmentShader = 'uniform vec2 uRes;\n' + sh.fragmentShader;
      if (sh.fragmentShader.includes('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );'))
        sh.fragmentShader = sh.fragmentShader.replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', f + ' ef_ *= 1.0 - smoothstep(uFade.x, uFade.y, length(vFW_)); gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) * ef_ );');
      else sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + f + ' gl_FragColor.a *= ef_;');
    };
    m.customProgramCacheKey = () => 'dvfade';
    return m;
  }
  function ringTex() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 4; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 512, 0);
    /* alphaMap reads the green channel: grey levels on an opaque canvas */
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.17, '#fff'); gr.addColorStop(0.22, 'rgb(170,170,170)'); gr.addColorStop(0.42, 'rgb(46,46,46)'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 4);
    const t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace; return t;
  }

  function makeItem(name, model, com) {
    return {
      name, model, root: model.root, com, half: model.half, body: null, visible: true,
      home: { p: new T.Vector3(), q: new T.Quaternion() }, cur: { p: new T.Vector3(), q: new T.Quaternion() }, prev: { p: new T.Vector3(), q: new T.Quaternion() },
      last: { p: new T.Vector3(1e9, 0, 0), q: new T.Quaternion() }, glide: null, frozen: false, state: 'closed', k: 0, yawV: 0
    };
  }

  /* ---------- theme ---------- */
  function isDarkBehind(node) {
    for (let n = node; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor, m = c && c.match(/rgba?\(([^)]+)\)/);
      if (m) { const p = m[1].split(',').map(Number); if (p.length < 4 || p[3] > 0.5) return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) < 110; }
    }
    return true;
  }
  function applyTheme() {
    const dark = S.theme === 'dark' || (S.theme === 'auto' && isDarkBehind(el));
    wrap.classList.toggle('is-light', !dark);
    scene.environmentIntensity = dark ? 0.85 : 1.15;
    key.intensity = dark ? 3.0 : 3.0; rim.intensity = dark ? 1.3 : 0.7; fill.intensity = dark ? 0.3 : 0.45;
    floor.material.opacity = dark ? 0.62 : 0.3;
    floorRing.material.opacity = dark ? 0.55 : 0.28;
    contact.set({ darkness: dark ? 0.92 : 0.62 });
    if (contactFloor) contactFloor.set({ darkness: dark ? 0.85 : 0.55 });
    post.S.exposure = dark ? 1.0 : 1.04;
    post.S.bloom = dark ? 0.24 : 0.14;
    shadowDirty = contactDirty = dirty = true;
  }

  /* ---------- layout per object mode ---------- */
  function homes() {
    const H = S.ph, c = items.can, b = items.box;
    const Q = (y) => new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), y);
    if (S.object === 'both') {
      plinthR = 3.37 * S.prK;
      c.home.p.set(1.45, H + M.CAN.COM, 0.9); c.home.q.copy(Q(-0.12));
      b.home.p.set(-0.75, H + M.BOX.COM, -0.8); b.home.q.copy(Q(0.22));
    } else if (S.object === 'can') {
      plinthR = 1.85 * S.prK;
      c.home.p.set(0, H + M.CAN.COM, 0); c.home.q.copy(Q(-0.3));
      b.home.p.set(0, -40, 0); b.home.q.identity();
    } else {
      plinthR = 2.55 * S.prK;
      b.home.p.set(0, H + M.BOX.COM, 0); b.home.q.copy(Q(0.16));
      c.home.p.set(0, -40, 0); c.home.q.identity();
    }
    c.visible = S.object !== 'box'; b.visible = S.object !== 'can';
  }
  function layout(first) {
    seatLidNow();
    homes();
    if (plinthMesh) { scene.remove(plinthMesh); plinthMesh.traverse(o => o.geometry && o.geometry.dispose()); }
    plinthMesh = M.makePlinth(T, plinthMat, plinthR, S.ph, 1.4);
    scene.add(plinthMesh);
    floorRing.scale.setScalar(plinthR);
    if (fadeU.uFade.value) fadeU.uFade.value.set(plinthR * 1.02, plinthR * 1.55);
    contact.set({ radius: plinthR, ground: S.ph });
    if (contactFloor) contactFloor.set({ radius: plinthR * 1.9, ground: 0 });
    Object.values(items).forEach(it => {
      it.root.visible = it.visible;
      closeNow(it);
      it.cur.p.copy(it.home.p); it.cur.q.copy(it.home.q); it.prev.p.copy(it.home.p); it.prev.q.copy(it.home.q);
      it.root.position.copy(it.home.p); it.root.quaternion.copy(it.home.q);
      it.glide = null; it.frozen = false;
      btn[it.name].hidden = !it.visible;
    });
    /* key spot aims at the objects; its cone scales with the plinth */
    key.position.set(-0.5 * 15, 0.8 * 15, 0.45 * 15); key.target.position.set(0.15, S.ph + 0.4, -0.15);
    key.angle = Math.atan((plinthR * 0.85) / 15); key.penumbra = 1;
    key.shadow.camera.near = 8; key.shadow.camera.far = 26; key.shadow.focus = 1; key.shadow.camera.updateProjectionMatrix();
    rim.position.set(9, 6, -10); rim.target.position.set(0, S.ph, 0);
    if (world) rebuildWorld();
    view.focus = 'hero'; view.userAz = view.userEl = 0;
    heroView(camGoal);
    if (first || stage.reduced) Object.assign(cam, camGoal);
    labelButtons();
    shadowDirty = contactDirty = dirty = true;
  }

  /* ---------- camera ---------- */
  function fitDistance(goal, pts, aspect, mx, myTop, myBot) {
    const vf = goal.fov * Math.PI / 180, tv = Math.tan(vf / 2), th = tv * aspect;
    const dir = V.a.set(Math.sin(goal.az) * Math.cos(goal.el), Math.sin(goal.el), Math.cos(goal.az) * Math.cos(goal.el));
    const fwd = V.b.copy(dir).negate(), right = V.c.crossVectors(fwd, new T.Vector3(0, 1, 0)).normalize(), up = V.d.crossVectors(right, fwd);
    let lo = 1, hi = 80;
    for (let it = 0; it < 28; it++) {
      const d = (lo + hi) / 2;
      const ex = goal.tx + dir.x * d, ey = goal.ty + dir.y * d, ez = goal.tz + dir.z * d;
      let ok = true;
      for (const p of pts) {
        const rx = p.x - ex, ry = p.y - ey, rz = p.z - ez;
        const z = rx * fwd.x + ry * fwd.y + rz * fwd.z;
        if (z < 0.5) { ok = false; break; }
        const x = (rx * right.x + ry * right.y + rz * right.z) / (z * th), y = (rx * up.x + ry * up.y + rz * up.z) / (z * tv);
        if (Math.abs(x) > 1 - mx || y > 1 - myTop || y < -1 + myBot) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    return hi;
  }
  function frame(goal, pts, mx, myTop, myBot) {
    const aspect = Math.max(0.3, stage.w / stage.h);
    /* centre the content: iterate target height so top and bottom margins balance */
    let cy = 0, cx = 0, cz = 0; pts.forEach(p => { cx += p.x; cy += p.y; cz += p.z; }); cx /= pts.length; cy /= pts.length; cz /= pts.length;
    goal.tx = cx; goal.ty = cy; goal.tz = cz;
    const c = frame.cam || (frame.cam = new T.PerspectiveCamera()), v = new T.Vector3(), up = new T.Vector3(), right = new T.Vector3();
    for (let k = 0; k < 7; k++) {
      goal.dist = fitDistance(goal, pts, aspect, mx, myTop, myBot);
      c.fov = goal.fov; c.aspect = aspect; c.near = 0.1; c.far = 200;
      c.position.set(goal.tx + Math.sin(goal.az) * Math.cos(goal.el) * goal.dist, goal.ty + Math.sin(goal.el) * goal.dist, goal.tz + Math.cos(goal.az) * Math.cos(goal.el) * goal.dist);
      c.lookAt(goal.tx, goal.ty, goal.tz); c.updateMatrixWorld(); c.updateProjectionMatrix();
      let ymin = 9, ymax = -9, xmin = 9, xmax = -9;
      for (const p of pts) { v.copy(p).project(c); ymin = Math.min(ymin, v.y); ymax = Math.max(ymax, v.y); xmin = Math.min(xmin, v.x); xmax = Math.max(xmax, v.x); }
      /* move the target along the camera's own up/right axes by the screen offset of the content */
      const wantMid = (myBot - myTop) / 2, dy = (ymin + ymax) / 2 - wantMid, dx = (xmin + xmax) / 2;
      const tv = Math.tan(goal.fov * Math.PI / 360) * goal.dist;
      up.set(0, 1, 0).applyQuaternion(c.quaternion); right.set(1, 0, 0).applyQuaternion(c.quaternion);
      goal.tx += (up.x * dy * tv + right.x * dx * tv * aspect) * 0.9; goal.ty += (up.y * dy * tv + right.y * dx * tv * aspect) * 0.9; goal.tz += (up.z * dy * tv + right.z * dx * tv * aspect) * 0.9;
      if (Math.abs(dy) < 0.004 && Math.abs(dx) < 0.004) break;
    }
    goal.dist = fitDistance(goal, pts, aspect, mx, myTop, myBot);
  }
  function circlePts(cx, y, cz, r, n, out) { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push(new T.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); } return out; }
  function boxPts(it, out, pad = 0, extraTop = 0) {
    const h = it.half;
    for (let i = 0; i < 8; i++) {
      const p = new T.Vector3((i & 1 ? 1 : -1) * (h.x + pad), (i & 2 ? 1 : -1) * h.y + (i & 2 ? extraTop : 0), (i & 4 ? 1 : -1) * (h.z + pad));
      out.push(p.applyQuaternion(it.cur.q).add(it.cur.p));
    }
    return out;
  }
  function heroView(goal) {
    const aspect = Math.max(0.3, stage.w / stage.h), portrait = aspect < 0.95;
    goal.fov = portrait ? 30 : 24; goal.el = portrait ? S.el + 0.06 : S.el; goal.az = S.object === 'both' ? -0.06 : 0;
    const pts = circlePts(0, S.ph, 0, plinthR, 24, []);
    circlePts(0, 0, 0, plinthR, 24, pts);
    Object.values(items).forEach(it => { if (it.visible) { const keep = it.cur.p.clone(), kq = it.cur.q.clone(); it.cur.p.copy(it.home.p); it.cur.q.copy(it.home.q); boxPts(it, pts, 0.1, 0.25); it.cur.p.copy(keep); it.cur.q.copy(kq); } });
    frame(goal, pts, portrait ? 0.04 : 0.08, 0.1, 0.07);
    if (goal === camGoal) heroBounds(goal);
  }
  /* the open poses are known in advance: frame them before they happen (the camera moves while the lid lifts) */
  function finalPoints(f) {
    const pts = [], v = () => new T.Vector3();
    if (f === 'can') {
      const it = items.can; it.root.position.copy(it.cur.p); it.root.quaternion.copy(it.cur.q); it.root.updateMatrixWorld(true);
      if (!items.lid && !(world && !stage.reduced)) {        /* the hovering lid belongs to the picture (no physics) */
        const lid = can.lid, p0 = lid.position.clone(), r0 = lid.rotation.clone();
        lid.position.set(0.12, M.CAN.LID_Y + 1.18, -0.62); lid.rotation.set(0.62, 0, 0.1); lid.updateMatrixWorld(true);
        for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push(v().set(Math.cos(a) * M.CAN.R, 0.06, Math.sin(a) * M.CAN.R).applyMatrix4(lid.matrixWorld)); }
        lid.position.copy(p0); lid.rotation.copy(r0); lid.updateMatrixWorld(true);
      }
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push(v().set(Math.cos(a) * (M.CAN.R + 0.05), M.CAN.H, Math.sin(a) * (M.CAN.R + 0.05)).applyMatrix4(can.body.matrixWorld)); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push(v().set(Math.cos(a) * M.CAN.R, M.CAN.H - 0.75, Math.sin(a) * M.CAN.R).applyMatrix4(can.body.matrixWorld)); }
    } else {
      const it = items.box; it.root.position.copy(it.cur.p); it.root.quaternion.copy(it.cur.q); it.root.updateMatrixWorld(true);
      boxPts(it, pts, 0.04, 0);
      const h0 = box.hinge.rotation.x; box.hinge.rotation.x = -1.86; box.hinge.updateMatrixWorld(true);
      [[-1, 0.85, -1], [1, 0.85, -1], [-1, 0.85, 1], [1, 0.85, 1]].forEach(([x, y, z]) => pts.push(v().set(x * M.BOX.LW / 2, y, z * M.BOX.LD / 2).applyMatrix4(box.lid.matrixWorld)));
      box.hinge.rotation.x = h0; box.hinge.updateMatrixWorld(true);
      if (f === 'fan') {
        const fr = box.fan.root, rp = fr.position.clone(), rr = fr.rotation.clone(), sa = box.fan.strips.map(s => s.group.rotation.z);
        fanPose(1); fr.updateMatrixWorld(true);
        box.fan.strips.forEach(s => { [[M.FAN.L - M.FAN.PIV, -M.FAN.W / 2], [M.FAN.L - M.FAN.PIV, M.FAN.W / 2], [-M.FAN.PIV, M.FAN.W / 2]].forEach(([x, y]) => pts.push(v().set(x, y, 0).applyMatrix4(s.mesh.matrixWorld))); });
        fr.position.copy(rp); fr.rotation.copy(rr); box.fan.strips.forEach((s, i) => (s.group.rotation.z = sa[i])); fr.updateMatrixWorld(true);
      }
    }
    return pts;
  }
  let pourPts = null;
  function focusView(goal) {
    const f = view.focus, aspect = Math.max(0.3, stage.w / stage.h), portrait = aspect < 0.95;
    if (f === 'hero') return heroView(goal);
    if (f === 'pour' && pourPts) { goal.fov = portrait ? 30 : 24; goal.az = 0; goal.el = 0.36; frame(goal, pourPts, portrait ? 0.06 : 0.09, 0.12, 0.08); return; }
    goal.fov = portrait ? 30 : 24;
    goal.az = S.object === 'both' ? (f === 'can' ? 0.08 : -0.1) : 0;
    goal.el = f === 'can' ? 0.66 : (f === 'fan' ? 0.34 : 0.7);
    let pts = finalPoints(f);
    /* a phone-sized stage: the other object and the plinth stay in the picture (no can cut off at the edge, no box
       that seems to float because its support is out of frame) */
    if (stage.w < 560 && S.object === 'both') {
      const other = f === 'can' ? items.box : items.can;
      pts = pts.concat(boxPts(other, [], 0.05, 0), circlePts(0, S.ph, 0, plinthR * 0.92, 16, []));
      goal.el = Math.min(goal.el, 0.55); goal.az = 0;
    }
    frame(goal, pts, portrait ? 0.05 : 0.09, 0.07, 0.07);
  }

  function heroBounds(goal) {
    const c = new T.PerspectiveCamera(goal.fov, Math.max(0.3, stage.w / stage.h), 0.1, 200);
    c.position.set(goal.tx + Math.sin(goal.az) * Math.cos(goal.el) * goal.dist, goal.ty + Math.sin(goal.el) * goal.dist, goal.tz + Math.cos(goal.az) * Math.cos(goal.el) * goal.dist);
    c.lookAt(goal.tx, goal.ty, goal.tz); c.updateMatrixWorld(); c.updateProjectionMatrix();
    const pl = new T.Plane(new T.Vector3(0, 0, 1), 0), r = new T.Ray(), hit = new T.Vector3();
    const at = (x, y, p = pl) => { r.origin.copy(c.position); r.direction.set(x, y, 0.5).unproject(c).sub(c.position).normalize(); return r.intersectPlane(p, hit) ? hit.clone() : null; };
    /* the side walls follow the frame where it is narrowest for a thrown object: in front of the plinth's middle, low
       down (a can that lands on the table in front stays whole in the picture) */
    const front = new T.Plane(new T.Vector3(0, 0, 1), -Math.min(1.4, plinthR * 0.45));
    const L = at(-1, 0.2), Rr = at(1, 0.2), Tp = at(0, 1), Lf = at(-1, -0.45, front), Rf = at(1, -0.45, front);
    bounds.xmin = Math.max(-12, L ? L.x + 0.15 : -5, Lf ? Lf.x + 0.1 : -12); bounds.xmax = Math.min(12, Rr ? Rr.x - 0.15 : 5, Rf ? Rf.x - 0.1 : 12);
    bounds.ytop = Tp ? Tp.y : 6;
    bounds.zf = plinthR + 0.9; bounds.zb = -plinthR - 1.0;
    placeWalls();
  }
  function smoothDamp(key, target, smoothTime, dt) {
    const v = camVel[key] || 0, omega = 2 / smoothTime, x = omega * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = cam[key] - target, temp = (v + omega * change) * dt;
    camVel[key] = (v - omega * temp) * ex;
    let out = target + (change + temp) * ex;
    if ((target - cam[key] > 0) === (out > target)) { out = target; camVel[key] = 0; }
    return out;
  }
  function updateCamera(dt) {
    const before = cam.tx + cam.ty * 3.1 + cam.tz * 7.3 + cam.az * 11 + cam.el * 13 + cam.dist * 17 + cam.fov * 19 + view.par[0] * 23 + view.par[1] * 29;
    const idleFor = time - lastInput;
    if (!grab && ptr.mode !== 'orbit' && idleFor > 3.5) {             /* the view drifts back to its composition */
      const k = 1 - Math.exp(-dt * 1.2); view.userAz -= view.userAz * k; view.userEl -= view.userEl * k;
    }
    if (!grab && ptr.mode !== 'orbit' && (view.userVaz || view.userVel)) {   /* orbit inertia */
      view.userAz = clamp(view.userAz + view.userVaz * dt, -0.75, 0.75); view.userEl = clamp(view.userEl + view.userVel * dt, -0.18, 0.42);
      const d = Math.exp(-dt * 4); view.userVaz *= d; view.userVel *= d;
      if (Math.abs(view.userVaz) < 1e-3) view.userVaz = 0; if (Math.abs(view.userVel) < 1e-3) view.userVel = 0;
    }
    const pk = 1 - Math.exp(-dt * 3);
    view.par[0] += (view.parGoal[0] - view.par[0]) * pk; view.par[1] += (view.parGoal[1] - view.par[1]) * pk;
    const g = camGoal;
    if (stage.reduced) Object.assign(cam, g);
    else {
      const st = view.focus === 'hero' ? 0.75 : 0.6;
      ['tx', 'ty', 'tz', 'az', 'el', 'dist', 'fov'].forEach(k => { cam[k] = smoothDamp(k, g[k], st, Math.min(dt, 0.05)); });
    }
    const az = cam.az + view.userAz + view.par[0] * 0.07, el = clamp(cam.el + view.userEl - view.par[1] * 0.04, 0.05, 1.25);
    camera.fov = cam.fov; camera.aspect = stage.w / stage.h;
    camera.position.set(cam.tx + Math.sin(az) * Math.cos(el) * cam.dist, cam.ty + Math.sin(el) * cam.dist, cam.tz + Math.cos(az) * Math.cos(el) * cam.dist);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
    camera.updateProjectionMatrix();
    const after = cam.tx + cam.ty * 3.1 + cam.tz * 7.3 + cam.az * 11 + cam.el * 13 + cam.dist * 17 + cam.fov * 19 + view.par[0] * 23 + view.par[1] * 29;
    if (Math.abs(after - before) > 1e-6 || view.userVaz || view.userVel) dirty = true;
  }
  function setFocus(f) {
    if (view.focus === f) return;
    view.focus = f; focusView(camGoal); dirty = true;
  }

  /* ================= physics ================= */
  async function startPhysics() {
    if (physicsState !== 'off' || !S.physics || stage.reduced || stage.destroyed) return;
    physicsState = 'loading';
    try { RA = await loadRapier(); } catch (e) { physicsState = 'failed'; return; }
    if (stage.destroyed || stage.reduced) { physicsState = 'off'; return; }
    rebuildWorld();
    physicsState = 'on';
  }
  function rebuildWorld() {
    if (!RA) return;
    if (world) { Object.values(items).forEach(it => (it.body = null)); world.free(); world = null; }
    world = new RA.World({ x: 0, y: -GRAV, z: 0 });
    world.timestep = HSTEP;
    try { world.integrationParameters.numSolverIterations = 8; } catch (e) { /* older builds */ }
    const fixed = (desc, x, y, z, fr = 0.6, re = 0.2) => {
      const b = world.createRigidBody(RA.RigidBodyDesc.fixed().setTranslation(x, y, z));
      world.createCollider(desc.setFriction(fr).setRestitution(re), b); return b;
    };
    fixed(RA.ColliderDesc.cuboid(40, 0.5, 40), 0, -0.5, 0, PHYS.floor.fr, PHYS.floor.re);
    fixed(RA.ColliderDesc.cylinder(S.ph / 2, plinthR), 0, S.ph / 2, 0, PHYS.plinth.fr, PHYS.plinth.re);
    walls = ['l', 'r', 'f', 'b'].map(k => fixed(k === 'l' || k === 'r' ? RA.ColliderDesc.cuboid(0.5, 8, 12) : RA.ColliderDesc.cuboid(12, 8, 0.5), 0, 8, 0, 0.25, 0.3));
    placeWalls();
    for (const it of Object.values(items)) {
      if (!it.visible) continue;
      const p = it.cur.p, q = it.cur.q;
      const desc = RA.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCcdEnabled(true).setSleeping(true);
      if (it.name === 'lid') { it.body = world.createRigidBody(desc.setLinearDamping(PHYS.lid.lin).setAngularDamping(PHYS.lid.ang)); it.collider = world.createCollider(lidCollider(), it.body); continue; }
      let col;
      if (it.name === 'can') {
        desc.setLinearDamping(PHYS.can.lin).setAngularDamping(PHYS.can.ang);
        col = RA.ColliderDesc.roundCylinder(M.CAN.H / 2 - 0.03, M.CAN.R + 0.02 - 0.03, 0.03).setFriction(PHYS.can.fr).setRestitution(PHYS.can.re);
        massProps(col, canMass(paintLevel));
      } else {
        desc.setLinearDamping(PHYS.box.lin).setAngularDamping(PHYS.box.ang);
        col = RA.ColliderDesc.roundCuboid(M.BOX.LW / 2 - 0.02, M.BOX.H / 2 - 0.02, M.BOX.LD / 2 - 0.02, 0.02).setFriction(PHYS.box.fr).setRestitution(PHYS.box.re);
        if (col.setMass) col.setMass(PHYS.box.mass); else col.setDensity(PHYS.box.mass / (M.BOX.LW * M.BOX.H * M.BOX.LD));
      }
      combine(col);
      it.body = world.createRigidBody(desc);
      it.collider = world.createCollider(col, it.body);
      if (it.state !== 'closed') freeze(it, true);
    }
  }
  /* the lowest bounce wins (a cardboard box does not bounce off stone), contacts carry a thin skin (no resting jitter) */
  function combine(col) {
    try { if (RA.CoefficientCombineRule) col.setRestitutionCombineRule(RA.CoefficientCombineRule.Min); } catch (e) { /* older builds */ }
    try { if (col.setContactSkin) col.setContactSkin(0.004); } catch (e) { /* older builds */ }
    return col;
  }
  function massProps(col, mp) {
    if (col.setMassProperties) col.setMassProperties(mp.m, { x: 0, y: mp.com, z: 0 }, { x: mp.ix, y: mp.iy, z: mp.ix }, { x: 0, y: 0, z: 0, w: 1 });
    else col.setDensity(mp.m / (Math.PI * M.CAN.R * M.CAN.R * M.CAN.H));
    return col;
  }
  function lidCollider() {
    const col = RA.ColliderDesc.roundCylinder(0.03, M.CAN.R - 0.045, 0.025).setTranslation(0, -0.02, 0).setFriction(PHYS.lid.fr).setRestitution(PHYS.lid.re);
    if (col.setMass) col.setMass(PHYS.lid.mass); else col.setDensity(0.8);
    return combine(col);
  }
  /* the paint level changes the can's weight and where it sits */
  let paintLevel = 1;
  function setPaintLevel(l) {
    paintLevel = clamp(l, 0, 1);
    if (can) { can.paint.position.y = 0.06 + (M.CAN.PAINT_Y - 0.06) * paintLevel; can.paint.visible = paintLevel > 0.01; }
    const it = items.can;
    if (it && it.collider && it.collider.setMassProperties) { const mp = canMass(paintLevel); try { it.collider.setMassProperties(mp.m, { x: 0, y: mp.com, z: 0 }, { x: mp.ix, y: mp.iy, z: mp.ix }, { x: 0, y: 0, z: 0, w: 1 }); } catch (e) { /* keep the old mass */ } }
    dirty = true;
  }
  const RBT = () => RA.RigidBodyType;
  /* invisible walls just inside the visible frame at the plinth's depth (recomputed with the hero view) */
  let walls = null;
  function placeWalls() {
    if (!walls) return;
    const b = bounds;
    if (!isFinite(b.xmin + b.xmax + b.zf + b.zb)) return;
    walls[0].setTranslation({ x: b.xmin - 0.5, y: 8, z: 0 }, true);
    walls[1].setTranslation({ x: b.xmax + 0.5, y: 8, z: 0 }, true);
    walls[2].setTranslation({ x: 0, y: 8, z: b.zf + 0.5 }, true);
    walls[3].setTranslation({ x: 0, y: 8, z: b.zb - 0.5 }, true);
  }
  function freeze(it, on) {
    it.frozen = on;
    if (!it.body) return;
    if (on) { it.body.setBodyType(RBT().KinematicPositionBased, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, false); it.body.setAngvel({ x: 0, y: 0, z: 0 }, false); }
    else { it.body.setBodyType(RBT().Dynamic, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, false); it.body.setAngvel({ x: 0, y: 0, z: 0 }, false); it.body.sleep(); }
  }
  function anyActive() {
    if (grab) return true;
    for (const it of Object.values(items)) if (it.body && it.visible && (it.glide || !it.body.isSleeping())) return true;
    return false;
  }
  function stepPhysics(dt) {
    if (!world) return;
    if (!anyActive()) { acc = 0; alpha = 1; for (const it of Object.values(items)) { it.prev.p.copy(it.cur.p); it.prev.q.copy(it.cur.q); } return; }
    acc += Math.min(dt, 0.1);
    let n = 0;
    while (acc >= HSTEP && n < 8) {
      for (const it of Object.values(items)) if (it.body) { it.prev.p.copy(it.cur.p); it.prev.q.copy(it.cur.q); }
      preStep(HSTEP);
      try { world.step(); } catch (e) { physicsFault(); return; }
      readBodies();
      acc -= HSTEP; n++;
    }
    if (n >= 8) acc = 0;
    alpha = acc / HSTEP;
  }
  let faults = 0;
  function physicsFault() {
    faults++; physicsFaults = faults;
    grab = null; acc = 0;
    const old = world; world = null;
    for (const it of Object.values(items)) {
      it.body = null; it.glide = null;
      if (!isFinite(it.cur.p.x + it.cur.p.y + it.cur.p.z + it.cur.q.x + it.cur.q.y + it.cur.q.z + it.cur.q.w)) { it.cur.p.copy(it.home.p); it.cur.q.copy(it.home.q); }
      it.prev.p.copy(it.cur.p); it.prev.q.copy(it.cur.q);
    }
    try { old && old.free(); } catch (e) { /* the old world may be unusable */ }
    if (faults > 3) { physicsState = 'failed'; return; }
    try { rebuildWorld(); } catch (e) { world = null; physicsState = 'failed'; }
    dirty = shadowDirty = contactDirty = true;
  }
  function readBodies() {
    for (const it of Object.values(items)) {
      if (!it.body || !it.visible) continue;
      const t = it.body.translation(), r = it.body.rotation();
      if (!isFinite(t.x) || t.y < -6 || Math.abs(t.x) > 30 || Math.abs(t.z) > 30) { rescue(it); continue; }
      it.cur.p.set(t.x, t.y, t.z); it.cur.q.set(r.x, r.y, r.z, r.w);
    }
  }
  function rescue(it) {
    it.body.setTranslation({ x: it.home.p.x, y: it.home.p.y + 0.6, z: it.home.p.z }, true);
    it.body.setRotation({ x: it.home.q.x, y: it.home.q.y, z: it.home.q.z, w: it.home.q.w }, true);
    it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); it.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    it.cur.p.copy(it.home.p); it.cur.q.copy(it.home.q);
  }
  function preStep(h) {
    /* grab spring at the anchor point: critically damped, gravity compensated, applied as an impulse at the point */
    if (grab && grab.item.body && !grab.item.glide) {
      const b = grab.item.body, m = b.mass();
      const t = b.translation(), r = b.rotation(), lv = b.linvel(), av = b.angvel();
      const q = V.q.set(r.x, r.y, r.z, r.w);
      const pa = V.a.copy(grab.local).applyQuaternion(q).add(V.b.set(t.x, t.y, t.z));
      const rx = pa.x - t.x, ry = pa.y - t.y, rz = pa.z - t.z;
      const vx = lv.x + av.y * rz - av.z * ry, vy = lv.y + av.z * rx - av.x * rz, vz = lv.z + av.x * ry - av.y * rx;
      grab.lift += (0.35 - grab.lift) * Math.min(1, h * 9);
      const tgt = V.c.copy(grab.target); tgt.y += grab.lift;
      const w0 = 13, z = 0.62;            /* a hand, not a vice: the object follows with a little lag and swings */
      let ax = w0 * w0 * (tgt.x - pa.x) - 2 * z * w0 * vx, ay = w0 * w0 * (tgt.y - pa.y) - 2 * z * w0 * vy + GRAV, az = w0 * w0 * (tgt.z - pa.z) - 2 * z * w0 * vz;
      const am = Math.hypot(ax, ay, az), lim = 1100;
      if (am > lim) { ax *= lim / am; ay *= lim / am; az *= lim / am; }
      if (isFinite(am) && isFinite(pa.x + pa.y + pa.z)) b.applyImpulseAtPoint({ x: ax * m * h, y: ay * m * h, z: az * m * h }, { x: pa.x, y: pa.y, z: pa.z }, true);
    }
    for (const it of Object.values(items)) {
      if (it.glide && it.body) glideStep(it, h);
      else if (it.body) { rollResist(it, h); if (it.name === 'lid') lidLanding(it, h); }
    }
  }
  /* a thin metal lid comes down flat with a clack and stops within a hand's breadth (its curled rim bites into the
     stone); only on the landing after it pops, a lid thrown by hand later moves freely */
  function lidLanding(it, h) {
    const b = it.body;
    if (b.isSleeping() || (grab && grab.item === it)) return;
    const t = b.translation(), ground = Math.hypot(t.x, t.z) < plinthR ? S.ph : 0;
    if (!it.landedAt) {
      /* the lowest point of the (tilted) lid reaches the ground: the first touch */
      const r = b.rotation(), upY = 1 - 2 * (r.x * r.x + r.z * r.z);
      const low = t.y - M.CAN.R * Math.sqrt(Math.max(0, 1 - upY * upY)) - 0.07 * Math.abs(upY);
      if (low - ground > 0.035) return;
      it.landedAt = time;
      /* the clack: the turn stops dead (left spinning it would roll back into the can) */
      const w0 = b.angvel(), v0 = b.linvel();
      b.setAngvel({ x: w0.x * 0.12, y: w0.y * 0.3, z: w0.z * 0.12 }, true);
      b.setLinvel({ x: v0.x * 0.4, y: v0.y, z: v0.z * 0.4 }, true);
    }
    if (time - it.landedAt > 0.7) return;
    const k = Math.exp(-h * 48), v = b.linvel(), w = b.angvel();
    b.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
  }
  /* rolling resistance on the plinth or the table: a can rolling on its side or a lid running on its rim slows down */
  function rollResist(it, h) {
    const P = PHYS[it.name], b = it.body;
    if (!P || !P.roll || it.frozen || b.isSleeping() || (grab && grab.item === it)) return;
    const t = b.translation(), ground = Math.hypot(t.x, t.z) < plinthR ? S.ph : 0;
    if (t.y - ground > Math.max(it.half.x, it.half.y) + 0.12) return;          /* in the air */
    const w = b.angvel(), wm = Math.hypot(w.x, w.z);
    if (wm < 1e-3) return;
    const k = Math.max(0, wm - P.roll * h) / wm;
    b.setAngvel({ x: w.x * k, y: w.y, z: w.z * k }, true);
  }

  /* glide back to a pose: kinematic arc (lift, turn upright, set down softly) */
  function glideTo(it, p1, q1, done, delay = 0, opt) {
    if (!it.visible) return;
    const p0 = it.cur.p.clone(), q0 = it.cur.q.clone();
    const dist = p0.distanceTo(p1), ang = q0.angleTo(q1);
    /* already there: set it down exactly (still and asleep), so a caller waiting for a settled object goes on at once
       instead of asking for the same glide again */
    if (dist < 0.02 && ang < 0.03) { place(it, p1, q1); done && done(); return; }
    const up = V.a.set(0, 1, 0).applyQuaternion(q0).y;
    let lift = 0.18 + Math.min(0.5, dist * 0.08) + (up < 0.9 ? 0.55 : 0) + Math.min(0.3, ang * 0.15);
    /* clear the other object when the straight path passes over it */
    for (const o of Object.values(items)) {
      if (o === it || !o.visible) continue;
      const d = distSeg2D(o.cur.p, p0, p1);
      if (d < Math.max(o.half.x, o.half.z) + Math.max(it.half.x, it.half.z) * 0.8) lift = Math.max(lift, (o.cur.p.y + o.half.y) - Math.min(p0.y, p1.y) + it.half.y * 0.6);
    }
    let T1 = clamp(0.95 + dist * 0.22 + ang * 0.25 + lift * 0.4, 1.1, 2.6);
    if (opt) { if (opt.lift != null) lift = opt.lift; if (opt.T) T1 = opt.T; }
    if (stage.reduced) { place(it, p1, q1); done && done(); return; }
    it.glide = { t: 0, T: T1, delay, p0, q0, p1: p1.clone(), q1: q1.clone(), lift, done, r0: opt && opt.r0 != null ? opt.r0 : 0.06, r1: opt && opt.r1 != null ? opt.r1 : 0.72, pivot: opt && opt.pivot };
    if (it.body) it.body.setBodyType(RBT().KinematicPositionBased, true);
  }
  function distSeg2D(c, a, b) {
    const abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz;
    const t = l2 > 1e-6 ? clamp(((c.x - a.x) * abx + (c.z - a.z) * abz) / l2, 0, 1) : 0;
    return Math.hypot(a.x + abx * t - c.x, a.z + abz * t - c.z);
  }
  function glidePose(g, k, outP, outQ) {
    const e = easeInOut(k);
    /* turning over a point of the object (the can over its own lip): that point runs straight from one place to the other */
    if (g.pivot) {
      outQ.slerpQuaternions(g.q0, g.q1, e);
      outP.lerpVectors(g.pivot.from, g.pivot.to, e).sub(V.pv.copy(g.pivot.local).applyQuaternion(outQ));
      return;
    }
    outP.lerpVectors(g.p0, g.p1, e); outP.y += g.lift * Math.sin(Math.PI * Math.min(1, e * 1.08));
    outQ.slerpQuaternions(g.q0, g.q1, sstep(g.r0 == null ? 0.06 : g.r0, g.r1 == null ? 0.72 : g.r1, k));
  }
  function glideStep(it, h) {
    const g = it.glide; g.t += h;
    let k = clamp((g.t - g.delay) / g.T, 0, 1);
    glidePose(g, k, V.d, V.q2);
    if (!isFinite(V.d.x + V.d.y + V.d.z + V.q2.x + V.q2.y + V.q2.z + V.q2.w)) { V.d.copy(g.p1); V.q2.copy(g.q1); k = 1; }
    it.body.setNextKinematicTranslation({ x: V.d.x, y: V.d.y, z: V.d.z });
    it.body.setNextKinematicRotation({ x: V.q2.x, y: V.q2.y, z: V.q2.z, w: V.q2.w });
    if (k >= 1) {
      it.glide = null; it.glideEnd = time;
      if (!it.frozen) { it.body.setBodyType(RBT().Dynamic, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, false); it.body.setAngvel({ x: 0, y: 0, z: 0 }, false); it.body.sleep(); }
      g.done && setTimeout(g.done, 0);
    }
  }
  /* no-physics glide (reduced motion off, physics off): tween the visual pose */
  function tweenGlide(it, dt) {
    const g = it.glide; g.t += dt;
    const k = clamp((g.t - g.delay) / g.T, 0, 1);
    glidePose(g, k, it.cur.p, it.cur.q);
    if (k >= 1) { it.glide = null; g.done && setTimeout(g.done, 0); }
  }
  function place(it, p, q) {
    it.cur.p.copy(p); it.cur.q.copy(q); it.prev.p.copy(p); it.prev.q.copy(q);
    if (it.body) {
      it.body.setTranslation({ x: p.x, y: p.y, z: p.z }, false); it.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, false);
      it.body.setLinvel({ x: 0, y: 0, z: 0 }, false); it.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      if (!it.frozen) it.body.sleep();
    }
    dirty = shadowDirty = contactDirty = true;
  }
  function displaced(it) {
    if (!it.visible || it.name === 'lid') return false;
    return it.cur.p.distanceTo(it.home.p) > 0.12 || it.cur.q.angleTo(it.home.q) > 0.12 || !footInside(it);
  }
  /* the whole footprint stands on the plinth (nothing overhangs the edge, where it would look as if it floats) */
  function footInside(it, margin = 0.06) {
    const h = it.half, pts = it.name === 'can' ? 10 : 4;
    for (let i = 0; i < pts; i++) {
      if (it.name === 'can') { const a = i / pts * Math.PI * 2; V.c.set(Math.cos(a) * M.CAN.R, -h.y, Math.sin(a) * M.CAN.R); }
      else V.c.set(i & 1 ? h.x : -h.x, -h.y, i & 2 ? h.z : -h.z);
      V.c.applyQuaternion(it.cur.q).add(it.cur.p);
      if (Math.hypot(V.c.x, V.c.z) > plinthR - margin) return false;
    }
    return true;
  }
  function settled(it) {
    const up = V.a.set(0, 1, 0).applyQuaternion(it.cur.q).y;
    const onTop = Math.abs(it.cur.p.y - (S.ph + it.com)) < 0.05 && footInside(it);
    const still = !it.body || it.frozen || it.body.isSleeping() || (Math.hypot(...Object.values(it.body.linvel())) < 0.05);
    return up > 0.995 && onTop && still && !it.glide;
  }
  function autoArrange() {
    const list = Object.values(items).filter(it => it.visible && it.name !== 'lid' && it.state === 'closed' && !it.glide && displaced(it) && time - (it.glideEnd || -9) > 3);
    if (!list.length) return;
    if (list.some(it => it.body && !it.body.isSleeping() && Math.hypot(...Object.values(it.body.linvel())) > 0.3)) return;
    list.sort((a, b) => b.cur.p.distanceTo(b.home.p) - a.cur.p.distanceTo(a.home.p));
    list.forEach((it, i) => glideTo(it, it.home.p, it.home.q, null, i * 0.35));
  }

  /* ================= pour (pack2/pour.js, loaded the first time the can opens) =================
     every tier that moves: one rope of paint from the rim; the paint lying on the plinth is a height field (puddle.js)
     drawn in the scene's own light: high builds it from a particle fluid (worker solver), mid from an analytic pool;
     low and reduced motion: the finished pour as a still */
  let pour = null, pourP = null, pourSeq = null, pourReset = false, pourBtnOn = null;
  function pourBusy() { return !!(pour && pour.pouring) || !!pourSeq || pourReset; }
  function onCanOpen() { ensurePour(); syncPourBtn(); }
  function onCanClose() { syncPourBtn(); }
  function ensurePour() {
    if (pourP || stage.destroyed) return pourP || Promise.resolve(null);
    pourP = import('./pour.js').then(pm => {
      if (stage.destroyed) return null;
      const C = { rimY: 1.868 - M.CAN.COM, levelTop: M.CAN.PAINT_Y - M.CAN.COM, levelBottom: 0.06 - M.CAN.COM, lipR: M.CAN.R - 0.09, outerR: M.CAN.R };
      pour = pm.createPour(T, R, {
        tier: stage.reduced ? 'low' : tier, reduced: stage.reduced, scene, can: C, plinth: { get r() { return plinthR; }, get top() { return S.ph; } }, max: 660,
        paintTex: () => coat.albedo, bumpTex: () => coat.data, paintTile: M.PAINT_TILE, getCan: pourCan, getSolids: pourSolids, onLevel: l => setPaintLevel(l),
        stillAt: S.object === 'both' ? { x: -1.6, z: 1.3 } : { x: 0, z: Math.min(plinthR - 0.35, 1.2) }
      });
      pour.setGranules(coat.albedo, coat.data);
      if (pour.precompile) pour.precompile(camera, R);
      syncPourBtn();
      return pour;
    }).catch(() => { pourP = null; return null; });
    return pourP;
  }
  function pourCan(Vv) {
    const it = items.can;
    Vv.p.copy(it.root.position); Vv.q.copy(it.root.quaternion);
    if (it.body && world) { const lv = it.body.linvel(), av = it.body.angvel(); Vv.v.set(lv.x, lv.y, lv.z); Vv.w.set(av.x, av.y, av.z); }
    else { Vv.v.set(0, 0, 0); Vv.w.set(0, 0, 0); }
    return { open: it.state === 'open' };
  }
  const solidsBuf = { plinth: null, can: null, box: null, lid: null, floor: 0, bound: 9, wakeAt: null };
  function pourSolids() {
    const c = items.can, b = items.box, l = items.lid, arr = (it, ext) => [it.root.position.x, it.root.position.y, it.root.position.z, it.root.quaternion.x, it.root.quaternion.y, it.root.quaternion.z, it.root.quaternion.w].concat(ext);
    solidsBuf.plinth = [plinthR, S.ph];
    solidsBuf.can = c.visible ? arr(c, [M.CAN.R, 0.93]) : null;
    solidsBuf.box = b.visible ? arr(b, [M.BOX.LW / 2, M.BOX.H / 2, M.BOX.LD / 2]) : null;
    solidsBuf.lid = l ? arr(l, [M.CAN.R - 0.02, 0.05]) : null;
    /* whatever moves through the settled puddle wakes the paint it touches */
    const wake = [];
    for (const it of [c, b, l]) if (it && it.body && !it.body.isSleeping()) wake.push(it.root.position.x, it.root.position.y, it.root.position.z, 1.6);
    solidsBuf.wakeAt = wake.length ? wake : null;
    return solidsBuf;
  }
  function syncPourBtn() {
    if (!pourBtn) return;
    const on = !!pour && items.can && items.can.state === 'open' && !pourBusy() && paintLevel > 0.08;
    if (on === pourBtnOn) return;
    pourBtnOn = on;
    if (on) { pourBtn.hidden = false; requestAnimationFrame(() => pourBtn.classList.add('is-on')); }
    else { pourBtn.classList.remove('is-on'); pourBtn.hidden = true; }
  }
  /* the Pour control: tip the can over the free plinth in front of it, hold it while the paint runs out, stand it up */
  function pourNow() {
    const it = items.can;
    if (!pour || pourBusy() || it.state !== 'open' || paintLevel <= 0.08) return;
    hideHint(); lastInput = time;
    emit('dv3d:pour', { state: 'start' });
    if (pour.mode === 'still' || stage.reduced || !world) {
      /* the finished pool beside the open can: the whole plinth in view, and the lid hovering over the can */
      pour.still();
      pourPts = circlePts(0, S.ph, 0, plinthR, 24, []); boxPts(it, pourPts, 0.1, 0.1);
      const lp = can.lid.getWorldPosition(new T.Vector3()), lr = M.CAN.R + 0.05;
      pourPts.push(lp.clone().add(new T.Vector3(lr, 0.2, 0)), lp.clone().add(new T.Vector3(-lr, 0.2, 0)), lp.clone().add(new T.Vector3(0, 0.5, lr)), lp.clone().add(new T.Vector3(0, 0.5, -lr)));   /* it hovers tilted */
      view.focus = ''; setFocus('pour');
      announce(L.poured); emit('dv3d:pour', { state: 'end' }); syncPourBtn(); dirty = true; invalidate(); return;
    }
    /* the puddle goes where the plinth is free (front left, clear of the box, the lid and the can's own spot). The can
       is carried there nearly upright (a full can spills past about 16 degrees), its lip held above the spot, and only
       then turned over its own lip: the lip comes straight down over the spot while the can tips, so the rope always
       falls on the same place and the paint pools round it */
    const home = it.home.p;
    const spot = S.object === 'both' ? new T.Vector3(-1.6, S.ph, 1.3) : new T.Vector3(0, S.ph, Math.min(plinthR - 0.35, 1.2));
    const dir = new T.Vector3(spot.x - home.x, 0, spot.z - home.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const axis = new T.Vector3(0, 1, 0).cross(dir).normalize();
    const dl = dir.clone().applyQuaternion(it.home.q.clone().invert());
    const lipL = new T.Vector3(dl.x * (M.CAN.R + 0.045), 1.868 - M.CAN.COM - 0.02, dl.z * (M.CAN.R + 0.045));
    const q1 = new T.Quaternion().setFromAxisAngle(axis, 0.21).multiply(it.home.q);
    const qT = new T.Quaternion().setFromAxisAngle(axis, 1.95).multiply(it.home.q);
    /* the lip a touch short of the spot: the paint leaves it with a little speed outwards */
    const L1 = spot.clone().addScaledVector(dir, -0.06); L1.y = S.ph + 1.97;
    const L2 = L1.clone(); L2.y = S.ph + 1.05;
    const p1 = L1.clone().sub(lipL.clone().applyQuaternion(q1)), pT = L2.clone().sub(lipL.clone().applyQuaternion(qT));
    freeze(it, true);
    /* frame it all: the can tipped over and turning, the can on its way, the box and the whole puddle it can make */
    const save = { p: it.cur.p.clone(), q: it.cur.q.clone() };
    pourPts = [];
    [[pT, qT], [p1, q1]].forEach(([p, q]) => { it.cur.p.copy(p); it.cur.q.copy(q); boxPts(it, pourPts, 0.1, 0.15); });
    it.cur.p.lerpVectors(home, p1, 0.5).add(new T.Vector3(0, 0.3, 0)); it.cur.q.copy(it.home.q); boxPts(it, pourPts, 0.1, 0.15);
    circlePts(spot.x, S.ph, spot.z, 1.25, 16, pourPts); boxPts(items.box, pourPts, 0.05, 0);
    it.cur.p.copy(save.p); it.cur.q.copy(save.q);
    view.focus = ''; setFocus('pour');
    pourSeq = { phase: 'tilt', t: 0 };
    pour.block(false);
    /* lifted (clear of the lid lying near it), carried and turned a little; then over the lip */
    glideTo(it, p1, q1, () => {
      if (!pourSeq) return;
      glideTo(it, pT, qT, () => { if (pourSeq) { pourSeq.phase = 'hold'; pourSeq.t = 0; } }, 0, { T: 2.0, pivot: { local: lipL, from: L1, to: L2 } });
    }, 0, { lift: 0.45, T: 1.6, r0: 0.35, r1: 1 });
    syncPourBtn(); invalidate();
  }
  function stepPour(dt) {
    if (pourSeq) {
      pourSeq.t += dt;
      if (pourSeq.phase === 'hold' && (paintLevel < 0.05 || pourSeq.t > 3.4)) {
        pourSeq.phase = 'back';
        pour.block(true);                 /* lifted away: the last of the paint stays in the can, no trail across the plinth */
        glideTo(items.can, items.can.home.p, items.can.home.q, () => { pourSeq = null; pour.block(false); announce(L.poured); emit('dv3d:pour', { state: 'end' }); syncPourBtn(); }, 0, { lift: 0.5, T: 1.8, r0: 0, r1: 0.55 });
        setFocus('hero');
      }
    }
    if (!pour) return;
    if (pour.update(dt)) dirty = true;
    /* the scene tidies itself: a settled puddle soaks away, the can fills up again and closes */
    if (pour.busy && !pour.pouring && !pourSeq && !pourReset && pour.settled && pour.idleFor > 6.5 && time - lastInput > 7 && ptr.id === null) startPourReset();
    syncPourBtn();
  }
  function startPourReset(done) {
    if (!pour || pourReset) return;
    pourReset = true; syncPourBtn();
    pour.reset(() => {
      const from = paintLevel;
      if (can.paint.visible || from < 0.02) ripple(can.paint.localToWorld(new T.Vector3(0.05, 0, 0.03)), 0.9);
      tween({ key: 'refill', T: 1.4, fn: k => setPaintLevel(from + (1 - from) * easeInOut(k)), done: () => {
        pour.setLevel(1); pourReset = false; announce(L.refilled); emit('dv3d:pour', { state: 'reset' }); syncPourBtn();
        if (done) done(); else if (items.can.state === 'open' && time - lastInput > 7) closeCan();
      } });
    });
  }

  /* ================= open / close ================= */
  function tween(o) { o.t = 0; tweens = tweens.filter(x => x.key !== o.key); tweens.push(o); if (stage.reduced) finishTween(o); }
  function finishTween(o) { o.t = o.T; o.fn(1); tweens = tweens.filter(x => x !== o); o.done && o.done(); }
  function stepTweens(dt) {
    if (!tweens.length) return;
    for (const o of tweens.slice()) {
      o.t += dt;
      const k = clamp(o.t / o.T, 0, 1);
      o.fn(k);
      if (k >= 1) { tweens = tweens.filter(x => x !== o); o.done && o.done(); }
    }
    dirty = shadowDirty = contactDirty = true;
  }
  /* can lid: pop, lift, tilt towards the viewer, hover */
  const lidOpen = new Float32Array(2), lidFrom = { p: null, r: null };
  function canLid(k) {
    const lid = can.lid;
    const pop = sstep(0, 0.16, k) * (1 - sstep(0.16, 0.4, k));
    const m = easeOutBack(sstep(0.1, 1, k), 1.15);
    lidOpen[0] = m; lidOpen[1] = time;
    lid.position.set(0.12 * m, M.CAN.LID_Y + 0.03 * pop + 1.18 * m, -0.62 * m);
    lid.rotation.set(0.62 * m + 0.05 * pop, 0, 0.1 * m);
  }
  function canLidClose(k) {             /* from wherever the hovering lid is, down onto the can, seated with a tiny tap */
    const lid = can.lid, e = easeInOut(k), tap = 0.012 * Math.sin(Math.PI * sstep(0.86, 1, k));
    lidOpen[0] = 1 - e;
    lid.position.set(lidFrom.p.x * (1 - e), M.CAN.LID_Y + (lidFrom.p.y - M.CAN.LID_Y) * (1 - e) + tap, lidFrom.p.z * (1 - e));
    lid.rotation.set(lidFrom.r.x * (1 - e), 0, lidFrom.r.z * (1 - e));
  }
  function lidHover() {
    if (lidOpen[0] < 0.999 || items.can.state !== 'open') return;
    const w = stage.reduced ? 0 : sstep(0, 1.2, time - lidOpen[1]), t = time - lidOpen[1];
    can.lid.position.y = M.CAN.LID_Y + 1.18 + 0.03 * Math.sin(t * 1.3) * w;
    can.lid.rotation.x = 0.62 + 0.025 * Math.sin(t * 0.9) * w;
    can.lid.rotation.z = 0.1 + 0.02 * Math.sin(t * 0.7 + 1.2) * w;
  }
  function openCan(homed) {
    const it = items.can;
    if (!it.visible || it.state !== 'closed') return;
    if (it.glide) { it.glide.done = () => openCan(true); return; }
    if (!homed && !settled(it) && !stage.reduced) { glideTo(it, it.home.p, it.home.q, () => openCan(true)); return; }
    if (stage.reduced && displaced(it)) place(it, it.home.p, it.home.q);
    it.state = 'open'; freeze(it, true);
    can.paint.visible = paintLevel > 0.01;
    /* with physics the lid pops off as its own body and lands where it lands; without, it lifts and hovers */
    if (world && !stage.reduced && !items.lid) popLid();
    else tween({ key: 'canlid', T: 1.25, fn: k => canLid(k) });
    setFocus('can'); labelButtons(); announce(L.canOpened); emit('dv3d:open', { object: 'can' });
    onCanOpen();
  }
  function closeCan(fast) {
    const it = items.can;
    if (it.state === 'closed' || it.state === 'closing') return;
    if (pour && pour.busy && !pour.pouring && !pourSeq && !pourReset) { startPourReset(() => closeCan(fast)); return; }   /* the puddle soaks away first */
    if (pourBusy()) return;                             /* not in the middle of a pour */
    it.state = 'closing';
    onCanClose();
    const done = () => { it.state = 'closed'; if (!(grab && grab.item === it)) freeze(it, false); labelButtons(); };
    if (items.lid) {
      /* the can stands up at home first, then the lid flies back onto it and seats */
      const back = () => { freeze(it, true); returnLid(fast, done); };
      if (world && !stage.reduced && !settled(it)) { freeze(it, false); glideTo(it, it.home.p, it.home.q, back); }
      else back();
    } else {
      lidFrom.p = can.lid.position.clone(); lidFrom.r = can.lid.rotation.clone();
      tween({ key: 'canlid', T: fast ? 0.32 : 0.75, fn: k => canLidClose(k), done });
    }
    if (view.focus === 'can') setFocus('hero');
    announce(L.canClosed); emit('dv3d:close', { object: 'can' });
  }
  /* the lid's seat on the can, in the world */
  function lidSeat(outP, outQ) {
    can.root.position.copy(items.can.cur.p); can.root.quaternion.copy(items.can.cur.q); can.root.updateMatrixWorld(true);
    outP.set(0, M.CAN.LID_Y - M.CAN.COM, 0).applyMatrix4(can.root.matrixWorld); outQ.copy(items.can.cur.q);
  }
  function popLid() {
    const lid = can.lid;
    /* it starts just clear of the rim (a seated lid would drag on it and lose its spin) */
    lid.position.set(0, M.CAN.LID_Y + 0.07, 0); lid.rotation.set(0, 0, 0);
    can.root.updateMatrixWorld(true);
    scene.attach(lid);
    const it = makeItem('lid', { root: lid, half: new T.Vector3(M.CAN.R, 0.06, M.CAN.R) }, 0);
    it.cur.p.copy(lid.position); it.cur.q.copy(lid.quaternion); it.prev.p.copy(it.cur.p); it.prev.q.copy(it.cur.q);
    it.home.p.copy(it.cur.p); it.home.q.copy(it.cur.q);
    items.lid = it;
    lid.traverse(o => { if (o.isMesh) o.layers.enable(LAYER_DYN); });
    const desc = RA.RigidBodyDesc.dynamic().setTranslation(it.cur.p.x, it.cur.p.y, it.cur.p.z).setRotation({ x: it.cur.q.x, y: it.cur.q.y, z: it.cur.q.z, w: it.cur.q.w })
      .setCcdEnabled(true).setLinearDamping(PHYS.lid.lin).setAngularDamping(PHYS.lid.ang);
    it.body = world.createRigidBody(desc);
    it.collider = world.createCollider(lidCollider(), it.body);
    /* pops up off the can and turns over on its way to the free plinth in front (or to the table in front of a
       lone can's small plinth): half a turn in the air, so it lands flat (on its rim it would roll away), clear of
       the can and of the plinth's edge */
    const cp = items.can.cur.p, onPlinth = S.object === 'both';
    const tx = onPlinth ? 0.1 : cp.x - 0.3, tz = onPlinth ? 2.15 : cp.z + plinthR + 0.8;
    const dx = tx - it.cur.p.x, dz = tz - it.cur.p.z, dist = Math.hypot(dx, dz) || 1;
    const vy = 17, h0 = Math.max(0.2, it.cur.p.y - (onPlinth ? S.ph : 0) - 0.08);   /* high enough that the turning lid clears the rim */
    const tf = vy / GRAV + Math.sqrt(2 * (vy * vy / (2 * GRAV) + h0) / GRAV), vh = dist / tf;
    const sx = dx / dist, sz = dz / dist, r1 = Math.random() - 0.5, r2 = Math.random() - 0.5;
    /* half a turn, backwards (its back edge drops as it goes): it lands face down and the landing eats its speed */
    const w = Math.PI / tf * (1 + PHYS.lid.ang * tf * 0.5) * (1 + 0.01 * r1);
    it.body.setLinvel({ x: sx * vh, y: vy, z: sz * vh }, true);
    it.body.setAngvel({ x: -sz * w, y: 0.5 * r2, z: sx * w }, true);
    emit('dv3d:lid', { state: 'off' });
  }
  function returnLid(fast, done) {
    const it = items.lid;
    if (!it) { done && done(); return; }
    const p = new T.Vector3(), q = new T.Quaternion();
    lidSeat(p, q);
    const seat = () => {
      /* back on the can: one body less, the lid rides with the can again */
      if (it.body && world) { try { world.removeRigidBody(it.body); } catch (e) { /* gone with the world */ } }
      it.body = null; delete items.lid;
      can.body.attach(can.lid);
      can.lid.position.set(0, M.CAN.LID_Y, 0); can.lid.rotation.set(0, 0, 0);
      dirty = shadowDirty = contactDirty = true;
      emit('dv3d:lid', { state: 'on' });
      done && done();
    };
    if (stage.reduced) { seat(); return; }
    glideTo(it, p, q, seat, 0, { lift: 0.75, T: fast ? 0.5 : 0.95 });
  }
  /* box: hinged lid with a soft overshoot; fan rises, tilts towards the viewer, strips spread with a stagger */
  const FAN_OPEN = { x: -1.05, y: 0.95, z: 0.55, rx: -0.38 }, MAXA = 1.92;
  function boxLid(k) { box.hinge.rotation.x = -1.86 * k; }
  function fanPose(k) {
    const f = box.fan, e = easeInOut(sstep(0, 0.55, k));
    f.root.position.set(-1.22 + (FAN_OPEN.x + 1.22) * e, (M.BOX.BED + 0.005) + (FAN_OPEN.y - M.BOX.BED - 0.005) * e + 0.25 * Math.sin(Math.PI * e), FAN_OPEN.z * e);
    f.root.rotation.x = -Math.PI / 2 + (Math.PI / 2 + FAN_OPEN.rx) * e;
    const N = f.strips.length;
    f.strips.forEach((s, i) => {
      const d = 0.4 + (N - 1 - i) * 0.035, kk = sstep(d, d + 0.5, k);
      s.a = MAXA * (N - i) / N * (kk > 0 ? easeOutBack(kk, 1.25) : 0);
      s.group.rotation.z = s.a;
    });
  }
  function stripLift(dt) {
    let moved = false;
    box.fan.strips.forEach((s, i) => {
      const want = items.box.state === 'fan' && (i === fanSel || i === hoverStrip) ? (i === fanSel ? 1 : 0.55) : 0;
      const nv = stage.reduced ? want : s.lift + (want - s.lift) * Math.min(1, dt * 10);
      if (Math.abs(nv - s.lift) > 1e-4) { s.lift = nv; moved = true; }
      s.mesh.position.x = 0.2 * s.lift; s.group.position.z = s.z0 + 0.02 * s.lift;
    });
    if (moved) dirty = shadowDirty = true;
  }
  function openBox(homed) {
    const it = items.box;
    if (!it.visible || it.state !== 'closed') return;
    if (it.glide) { it.glide.done = () => openBox(true); return; }
    if (!homed && !settled(it) && !stage.reduced) { glideTo(it, it.home.p, it.home.q, () => openBox(true)); return; }
    if (stage.reduced && displaced(it)) place(it, it.home.p, it.home.q);
    ensureStrips();
    it.state = 'open'; freeze(it, true);
    tween({ key: 'boxlid', T: 1.15, fn: k => boxLid(easeOutBack(k, 1.05)) });
    setFocus('box'); labelButtons(); announce(L.boxOpened); emit('dv3d:open', { object: 'box' });
  }
  function fanOut() {
    const it = items.box;
    if (it.state !== 'open') return;
    it.state = 'fan'; fanSel = -1;
    tween({ key: 'fan', T: 1.6, fn: k => fanPose(k) });
    setFocus('fan'); labelButtons(); announce(L.fanOpened); emit('dv3d:open', { object: 'fan' });
  }
  function closeBox(fast) {
    const it = items.box;
    if (it.state === 'closed') return;
    const wasFan = it.state === 'fan';
    it.state = 'closing'; fanSel = -1; hoverStrip = -1;
    const lidClose = () => tween({ key: 'boxlid', T: fast ? 0.3 : 0.75, fn: k => boxLid(1 - easeInOut(k)), done: () => { it.state = 'closed'; if (!(grab && grab.item === it)) freeze(it, false); labelButtons(); } });
    if (wasFan) tween({ key: 'fan', T: fast ? 0.3 : 0.8, fn: k => fanPose(1 - k), done: lidClose });
    else lidClose();
    if (view.focus === 'box' || view.focus === 'fan') setFocus('hero');
    announce(L.boxClosed); emit('dv3d:close', { object: 'box' });
  }
  function seatLidNow() {
    const it = items.lid; if (!it) return;
    if (it.body && world) { try { world.removeRigidBody(it.body); } catch (e) { /* gone with the world */ } }
    it.body = null; delete items.lid;
    can.body.attach(can.lid); can.lid.position.set(0, M.CAN.LID_Y, 0); can.lid.rotation.set(0, 0, 0);
  }
  function closeNow(it) {
    if (!can) return;
    if (it.name === 'can') seatLidNow();
    tweens = tweens.filter(o => !(it.name === 'can' ? o.key === 'canlid' : (o.key === 'boxlid' || o.key === 'fan')));
    if (it.name === 'can') { canLid(0); lidOpen[0] = 0; }
    else { boxLid(0); fanPose(0); fanSel = -1; }
    it.state = 'closed';
  }
  function activate(name, hit) {
    const it = items[name]; if (!it || !it.visible) return;
    hideHint();
    if (name === 'lid') { closeCan(); invalidate(); return; }
    if (name === 'can') {
      if (it.state === 'open') { if (hit && hit.object === can.paint) ripple(hit.point); else closeCan(); }
      else if (it.state === 'closed') openCan();
    } else {
      if (it.state === 'closed') openBox();
      else if (it.state === 'open') fanOut();
      else if (it.state === 'fan') { if (fanSel >= 0 && !hit) pickStrip(fanSel); else closeBox(); }
    }
    invalidate();
  }
  /* every touch of the paint rings out and twists the granules (four at a time, the oldest gives way) */
  let ripK = 0, lastStir = -1;
  function ripple(p, amp = 1) {
    const loc = can.paint.worldToLocal(p.clone());
    const U = paintMat.userData.U, r = U.uRad.value, R4 = U.uRips.value[ripK];
    ripK = (ripK + 1) % U.uRips.value.length;
    R4.set(loc.x / r, loc.z / r, U.uTime.value, amp);
    U.uRip = { value: R4 };
    dirty = true; invalidate();
    emit('dv3d:paint', { x: +R4.x.toFixed(3), y: +R4.y.toFixed(3) });
  }
  /* dragging across the open paint stirs it: a trail of small rings and twists */
  function stirAt(x, y) {
    if (time - lastStir < 0.06) return;
    V.ray.setFromCamera(toNdc(x, y), camera);
    const h = V.ray.intersectObject(can.paint, false)[0];
    if (h) { lastStir = time; ripple(h.point, 0.55); }
  }
  function pickStrip(i) {
    const f = S.fan[i]; if (!f) return;
    fanSel = i;
    setColors(f.colors);
    announce(L.picked.replace('{name}', f.name));
    emit('dv3d:pick', { name: f.name, colors: f.colors.map(c => ({ hex: c.hex, share: Math.round(c.share * 10) / 10 })) });
  }

  /* ================= colours ================= */
  function setColors(colors) {
    S.colors = normColors(colors);
    if (!built) return;
    ensureStrips();                     /* placeholders still point at the current coat, which is about to be replaced */
    finishTransitions();
    const next = bakeGranules(T, baker, { colors: S.colors, size: TC.bake, cells: 128, density: 0.95, seed: 11 });
    aniso(next.albedo); aniso(next.data);
    oldCoat = coat; coat = next;
    if (pour) pour.setGranules(coat.albedo, coat.data);
    const targets = [paintMat].concat(S.plinth === 'coating' ? [plinthMat] : []);
    targets.forEach(m => { m.userData.U.uOld.value = oldCoat.albedo; m.map = coat.albedo; m.bumpMap = coat.data; m.userData.U.uMix.value = 0; m.needsUpdate = false; });
    const tr = { t: 0, T: 1.6, mats: targets, old: oldCoat };
    transitions.push(tr);
    if (stage.reduced) finishTransitions();
    dirty = true; invalidate();
  }
  function stepTransitions(dt) {
    if (!transitions.length) return;
    for (const tr of transitions.slice()) {
      tr.t += dt;
      const k = clamp(tr.t / tr.T, 0, 1);
      tr.mats.forEach(m => (m.userData.U.uMix.value = k));
      if (k >= 1) endTransition(tr);
    }
    dirty = true;
  }
  function endTransition(tr) {
    tr.mats.forEach(m => { m.userData.U.uMix.value = 1; m.userData.U.uOld.value = m.map; });
    transitions = transitions.filter(x => x !== tr);
    if (tr.old && tr.old !== coat && tr.old !== coatPlinth) { tr.old.dispose(); if (oldCoat === tr.old) oldCoat = null; }
  }
  function finishTransitions() { transitions.slice().forEach(endTransition); }

  /* ================= input ================= */
  function touchInput() { lastInput = time; hideHint(); }
  /* gesture timing uses the platform timestamp of the event: on a busy main thread input is handled late, its timestamp is not */
  function evT(e) { const n = performance.now(), t = e && e.timeStamp; return t > 0 && t <= n + 50 && n - t < 2000 ? t : n; }
  function track(t, x, y) {
    const h = ptr.hist; h.push([t, x, y]);
    while (h.length > 2 && t - h[0][0] > 140) h.shift();
  }
  /* release velocity (css px per ms) over the last ~60-140 ms; zero when the finger rested before lifting */
  function releaseVel(tUp) {
    const h = ptr.hist, n = h.length;
    if (n < 2 || tUp - h[n - 1][0] > 90) return [0, 0];
    const b = h[n - 1]; let i = n - 2;
    while (i > 0 && b[0] - h[i][0] < 60) i--;
    const a = h[i], dt = Math.max(8, b[0] - a[0]);
    return [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
  }
  function hideHint() { if (!hintShown && hint.classList.contains('is-on')) { hint.classList.remove('is-on'); } hintShown = true; }
  function fitHint() {
    if (!hint || !wrap || !hint.querySelector('i')) return;
    hint.classList.remove('is-stack');
    if (hint.offsetWidth > wrap.clientWidth * 0.84) hint.classList.add('is-stack');
  }
  function toNdc(x, y) {
    const r = wrap.getBoundingClientRect();
    return V.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }
  function pick(x, y) {
    V.ray.setFromCamera(toNdc(x, y), camera);
    V.ray.layers.set(0);
    const roots = Object.values(items).filter(it => it.visible).map(it => it.root);   /* the free lid is an item of its own */
    const hits = V.ray.intersectObjects(roots, true);
    for (const h of hits) {
      let o = h.object;
      if (!o.visible) continue;
      if (items.box.state === 'fan') {
        const si = box.fan.strips.findIndex(s => s.mesh === o);
        if (si >= 0) return { item: items.box, strip: si, point: h.point, object: o };
      }
      while (o && o !== can.root && o !== box.root && o !== can.lid) o = o.parent;
      if (!o) continue;
      if (o === can.lid && items.lid) return { item: items.lid, point: h.point, object: h.object };
      return { item: o === box.root ? items.box : items.can, point: h.point, object: h.object };
    }
    return null;
  }
  function bindInput() {
    wrap.addEventListener('pointerdown', onDown);
    wrap.addEventListener('pointermove', onMove);
    wrap.addEventListener('pointerup', onUp);
    wrap.addEventListener('pointercancel', onCancel);
    wrap.addEventListener('pointerleave', onLeave);
    wrap.addEventListener('touchmove', onTouchMove, { passive: false });
    wrap.addEventListener('contextmenu', onContext);
  }
  function unbindInput() {
    wrap.removeEventListener('pointerdown', onDown); wrap.removeEventListener('pointermove', onMove); wrap.removeEventListener('pointerup', onUp);
    wrap.removeEventListener('pointercancel', onCancel); wrap.removeEventListener('pointerleave', onLeave);
    wrap.removeEventListener('touchmove', onTouchMove); wrap.removeEventListener('contextmenu', onContext);
  }
  function onContext(e) { if (ptr.mode === 'grab' || ptr.mode === 'press' || ptr.mode === 'hold') e.preventDefault(); }
  function onTouchMove(e) { if (ptr.mode === 'grab' || ptr.mode === 'hold' || ptr.mode === 'turn' || ptr.mode === 'spin' || ptr.mode === 'orbit' || ptr.mode === 'stir') { if (e.cancelable) e.preventDefault(); } }
  function onDown(e) {
    if (!built || ptr.id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    touchInput();
    if (e.pointerType === 'mouse') wantPhysics();       /* a touch asks for it only once it is not a page scroll */
    const hit = pick(e.clientX, e.clientY), t = evT(e);
    Object.assign(ptr, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t0: t, lt: t, vx: 0, vy: 0, hit, touch: e.pointerType !== 'mouse', mode: hit ? 'press' : 'idle', hist: [[t, e.clientX, e.clientY]] });
    try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (ptr.touch && hit && hit.strip == null) {
      clearTimeout(ptr.hold);
      /* press and hold lifts the object; the grab itself starts on the next frame, so a tap whose release
         was queued behind a long frame still counts as a tap */
      ptr.hold = setTimeout(() => {
        if (ptr.mode !== 'press' || Math.hypot(ptr.x - ptr.x0, ptr.y - ptr.y0) >= 10) return;
        ptr.mode = 'hold'; wantPhysics();
        const id = ptr.id;
        requestAnimationFrame(() => {
          if (ptr.mode !== 'hold' || ptr.id !== id) return;
          beginGrab();
          if (navigator.vibrate) try { navigator.vibrate(8); } catch (_) { /* ignore */ }
        });
      }, 190);
    }
    stage.start();
  }
  function onMove(e) {
    if (!built) return;
    if (fine && e.pointerType === 'mouse') {
      const r = wrap.getBoundingClientRect();
      view.parGoal[0] = ((e.clientX - r.left) / r.width - 0.5) * 2; view.parGoal[1] = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (stage.reduced) view.parGoal[0] = view.parGoal[1] = 0;
    }
    if (ptr.id === null) { hover(e); return; }
    if (e.pointerId !== ptr.id) return;
    const now = evT(e), dtm = Math.max(1, now - ptr.lt);
    ptr.vx = ptr.vx * 0.6 + ((e.clientX - ptr.lx) / dtm) * 0.4; ptr.vy = ptr.vy * 0.6 + ((e.clientY - ptr.ly) / dtm) * 0.4;
    const dx = e.clientX - ptr.lx, dy = e.clientY - ptr.ly;
    ptr.lx = ptr.x = e.clientX; ptr.ly = ptr.y = e.clientY; ptr.lt = now;
    track(now, e.clientX, e.clientY);
    const tdx = ptr.x - ptr.x0, tdy = ptr.y - ptr.y0, moved = Math.hypot(tdx, tdy);
    lastInput = time;
    if (ptr.mode === 'hold') {
      if (now - ptr.t0 < 190) { if (moved > 9) ptr.mode = 'press'; }   /* the finger moved before the hold threshold (the timer ran late): a swipe */
      else if (moved > 2) beginGrab();
    }
    const onPaint = ptr.hit && ptr.hit.object === can.paint && items.can.state === 'open';
    if (ptr.mode === 'press' && onPaint) {
      /* a drag that starts on the open paint stirs it (on touch only a sideways one; an upward one still scrolls) */
      if (moved > (ptr.touch ? 9 : 4)) { clearTimeout(ptr.hold); ptr.mode = !ptr.touch || Math.abs(tdx) > Math.abs(tdy) * 1.1 ? 'stir' : 'scroll'; }
    } else if (ptr.mode === 'press') {
      if (ptr.touch) {
        if (moved > 9) {
          clearTimeout(ptr.hold);
          if (Math.abs(tdx) > Math.abs(tdy) * 1.1 && ptr.hit.strip == null) { ptr.mode = 'spin'; }
          else { ptr.mode = 'scroll'; }
        }
      } else if (moved > 4 && ptr.hit.strip == null) beginGrab();
    } else if (ptr.mode === 'idle') {
      if (moved > (ptr.touch ? 9 : 3)) ptr.mode = (!ptr.touch || Math.abs(tdx) > Math.abs(tdy)) ? 'orbit' : 'scroll';
    }
    if (ptr.mode === 'stir') stirAt(e.clientX, e.clientY);
    else if (ptr.mode === 'grab') moveGrab(e.clientX, e.clientY);
    else if (ptr.mode === 'turn' || ptr.mode === 'spin') turnBy(ptr.hit.item, dx * 5.5 / Math.max(320, wrap.clientWidth));
    else if (ptr.mode === 'orbit') {
      const k = 3.2 / Math.max(360, wrap.clientWidth);
      view.userAz = clamp(view.userAz - dx * k, -0.75, 0.75);
      view.userEl = clamp(view.userEl + dy * k * 0.7, -0.18, 0.42);
      view.userVaz = 0; view.userVel = 0;
      wrap.classList.add('is-orbit'); dirty = true;
    }
    if (ptr.mode === 'spin' || ptr.mode === 'orbit' || ptr.mode === 'grab' || ptr.mode === 'turn') wantPhysics();
    stage.start();
  }
  function onUp(e) {
    if (e.pointerId !== ptr.id) return;
    clearTimeout(ptr.hold);
    const tUp = evT(e), held = tUp - ptr.t0, mode = ptr.mode, hit = ptr.hit;
    if (e.clientX !== ptr.lx || e.clientY !== ptr.ly) track(tUp, e.clientX, e.clientY);
    const rv = releaseVel(tUp); ptr.vx = rv[0]; ptr.vy = rv[1];
    if ((mode === 'press' || (mode === 'hold' && held < 330)) && hit) {
      wantPhysics();
      if (hit.strip != null) pickStrip(hit.strip);
      else activate(hit.item.name, hit);
    } else if (mode === 'grab') endGrab();
    else if (mode === 'spin' && ptr.touch && held < 450 && Math.abs(ptr.vx) > 0.6 && Math.abs(ptr.vx) > Math.abs(ptr.vy) && toss(hit.item, ptr.vx)) { /* flicked */ }
    else if (mode === 'spin' || mode === 'turn') endTurn(hit.item);
    else if (mode === 'orbit') {
      const k = 3.2 / Math.max(360, wrap.clientWidth) * 1000;
      view.userVaz = clamp(-ptr.vx * k, -3, 3); view.userVel = clamp(ptr.vy * k * 0.7, -2, 2);
    }
    releasePtr(e);
  }
  function onCancel(e) {
    if (e.pointerId !== ptr.id) return;
    clearTimeout(ptr.hold);
    if (ptr.mode === 'grab') endGrab();
    if (ptr.mode === 'spin' || ptr.mode === 'turn') endTurn(ptr.hit.item);
    releasePtr(e);
  }
  function onLeave(e) { if (e.pointerType === 'mouse' && ptr.id === null) { view.parGoal[0] = view.parGoal[1] = 0; setHover(null); } }
  function releasePtr(e) {
    try { wrap.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    ptr.id = null; ptr.mode = null; ptr.hit = null;
    wrap.classList.remove('is-grabbing', 'is-orbit');
    lastInput = time; stage.start();
  }
  let hoverRaf = 0, hoverEvt = null;
  function hover(e) {
    if (e.pointerType !== 'mouse') return;
    hoverEvt = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; if (hoverEvt) setHover(pick(hoverEvt.clientX, hoverEvt.clientY)); });
  }
  function setHover(h) {
    const strip = h && h.strip != null ? h.strip : -1;
    if (strip !== hoverStrip) { hoverStrip = strip; dirty = true; invalidate(); }
    wrap.classList.toggle('is-point', strip >= 0);
    wrap.classList.toggle('is-hover', !!h && strip < 0);
    if (h) wantPhysics();
  }

  /* grab: the object hangs from the point you took it by, follows the pointer on a plane facing the camera */
  function beginGrab() {
    const hit = ptr.hit, it = hit && hit.item;
    if (!it) return;
    if (!world || !it.body || stage.reduced) { ptr.mode = 'turn'; wrap.classList.add('is-grabbing'); return; }
    /* an open can stays open in the hand: tip it and the paint pours; an open box closes first */
    if (it.name === 'box' && it.state !== 'closed') closeBox(true);
    if (it.name === 'can' && (it.state === 'closing' || pourReset)) return;
    if (it.name === 'can' && pourSeq) pourSeq = null;     /* taking the can out of the pour: it is now in the hand */
    if (it.glide) { it.glide = null; }
    it.frozen = false;
    it.body.setBodyType(RBT().Dynamic, true);
    it.body.wakeUp();
    it.body.setAngularDamping(PHYS[it.name].held); it.body.setLinearDamping(0.25);
    const local = hit.point.clone().sub(it.cur.p).applyQuaternion(it.cur.q.clone().invert());
    const n = new T.Vector3(); camera.getWorldDirection(n); n.y = 0; n.normalize();
    grab = { item: it, local, target: hit.point.clone(), lift: 0, dy: hit.point.y - it.cur.p.y, plane: new T.Plane().setFromNormalAndCoplanarPoint(n, hit.point) };
    ptr.mode = 'grab'; wrap.classList.add('is-grabbing'); wrap.classList.remove('is-hover');
    if (view.focus !== 'hero') setFocus('hero');
    hideHint();
  }
  function moveGrab(x, y) {
    if (!grab) return;
    V.ray.setFromCamera(toNdc(x, y), camera);
    const p = V.ray.ray.intersectPlane(grab.plane, V.d);
    if (!p) return;
    /* the target is the point you hold: the object's top stays inside the frame, and it can always be lifted clear */
    const b = bounds, it = grab.item, h = it.half.x;
    const comMax = Math.max(S.ph + it.com + 0.9, b.ytop - it.half.y * 1.15);
    grab.target.set(clamp(p.x, b.xmin + h, b.xmax - h), clamp(p.y, 0.3, comMax + grab.dy), clamp(p.z, b.zb + h, b.zf - h));
  }
  function endGrab() {
    if (!grab) return;
    const it = grab.item, b = it.body;
    grab = null;
    if (b) {
      b.setAngularDamping(PHYS[it.name].ang); b.setLinearDamping(PHYS[it.name].lin);
      const v = b.linvel(), w = b.angvel(), vm = Math.hypot(v.x, v.y, v.z), wm = Math.hypot(w.x, w.y, w.z);
      if (vm > 40) { v.x *= 40 / vm; v.y *= 40 / vm; v.z *= 40 / vm; }
      /* a throw never leaves the frame through the top: cap the upward speed by the room above */
      const room = Math.max(0.3, bounds.ytop - b.translation().y - it.half.y * 1.2), vyMax = Math.sqrt(2 * GRAV * room);
      if (v.y > vyMax) v.y = vyMax;
      b.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
      if (wm > 24) b.setAngvel({ x: w.x * 24 / wm, y: w.y * 24 / wm, z: w.z * 24 / wm }, true);
      /* an open can that was tipped and let go stays a physical can (it can roll and spill); it is no longer frozen */
      if (it.name === 'can' && it.state === 'open') it.frozen = false;
    }
  }
  /* turning by hand (drag without physics, a horizontal swipe on touch): yaw around the vertical axis;
     with physics the swipe speed becomes a real spin that friction slows down */
  function turnBy(it, da) {
    if (!it || it.glide) return;
    if (it.state !== 'closed') return;
    const q = V.q.setFromAxisAngle(V.a.set(0, 1, 0), da);
    it.cur.q.premultiply(q); it.prev.q.copy(it.cur.q);
    if (stage.reduced || !world) it.home.q.premultiply(q);       /* no physics: the turn is the new pose */
    if (it.body) { it.body.setRotation({ x: it.cur.q.x, y: it.cur.q.y, z: it.cur.q.z, w: it.cur.q.w }, false); }
    dirty = shadowDirty = contactDirty = true;
    invalidate();
  }
  function endTurn(it) {
    if (it && world && it.body && !stage.reduced && it.state === 'closed' && !it.glide) {
      const yawV = clamp(ptr.vx * 1000 * 5.5 / Math.max(320, wrap.clientWidth), -14, 14);
      if (Math.abs(yawV) > 0.4) { it.body.wakeUp(); const w = it.body.angvel(); it.body.setAngvel({ x: w.x, y: w.y + yawV, z: w.z }, true); }
    }
  }
  function toss(it, vx) {
    if (!it || !world || !it.body || stage.reduced || it.state !== 'closed') return false;
    if (it.glide) { it.glide = null; it.body.setBodyType(RBT().Dynamic, true); }
    const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
    const dir = Math.sign(vx), k = clamp(Math.abs(vx) / 2.2, 0.4, 1);
    it.body.wakeUp();
    it.body.setLinvel({ x: right.x * dir * 13 * k, y: 8 + 7 * k, z: right.z * dir * 13 * k - 1.2 }, true);
    it.body.setAngvel({ x: -3 * k, y: dir * 6 * k, z: -dir * 5 * k }, true);
    lastInput = time; dirty = true; invalidate();
    hideHint(); emit('dv3d:toss', { object: it.name });
    return true;
  }
  function spinKey(it, dir) {
    if (!it || !it.visible) return;
    if (world && it.body && !stage.reduced && it.state === 'closed') {
      if (it.glide) return;
      const q1 = it.cur.q.clone().premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), dir * 0.35));
      glideTo(it, it.cur.p.clone(), q1, null, 0, { lift: 0.015, T: 0.42 });
    } else turnBy(it, dir * 0.35);
    invalidate();
  }
  function onKey(e, name) {
    const it = items[name];
    touchInput();
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (name === 'box' && it.state === 'fan') {
        const N = S.fan.length;
        fanSel = fanSel < 0 ? (dir > 0 ? N - 1 : 0) : (fanSel - dir + N) % N;     /* left = towards the darker strips */
        announce(L.strip.replace('{name}', S.fan[fanSel].name));
        dirty = true; invalidate();
      } else spinKey(it, dir);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      view.userEl = clamp(view.userEl + (e.key === 'ArrowUp' ? 0.07 : -0.07), -0.18, 0.42);
      dirty = true; invalidate();
    } else if (e.key === 'Escape') {
      if (it.state !== 'closed') { e.preventDefault(); if (name === 'can') closeCan(); else closeBox(); }
    } else if (e.key === 'Home') {
      e.preventDefault(); ctl.reset();
    } else if ((e.key === 'Enter' || e.key === ' ') && name === 'box' && it.state === 'fan' && fanSel >= 0) {
      e.preventDefault(); pickStrip(fanSel);
    } else if ((e.key === 'p' || e.key === 'P') && name === 'can') {
      e.preventDefault(); ctl.pour();
    }
  }

  /* ================= frame ================= */
  function update(t, dt) {
    if (!built) return;
    /* never a negative step: after a long main-thread task the first rAF timestamp can be older than the moment the
       loop (re)started, which would run the clock, the tweens and the physics accumulator backwards */
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    time += dt;
    if (S.hint && !hintShown && lastInput < 0 && hint.classList.contains('is-on') && time - hintT > 9) hideHint();
    /* physics or tweened glides */
    if (world && !stage.reduced) stepPhysics(dt);
    for (const it of Object.values(items)) if (it.glide && !it.body) { tweenGlide(it, dt); dirty = true; }
    if (stage.reduced && grab) endGrab();
    stepTweens(dt);
    stepTransitions(dt);
    stepPour(dt);
    lidHover();
    if (box) stripLift(dt);
    /* visual poses (interpolated between physics steps) */
    for (const it of Object.values(items)) {
      if (!it.visible) continue;
      if (it.body && world && !stage.reduced) {
        it.root.position.lerpVectors(it.prev.p, it.cur.p, alpha);
        it.root.quaternion.slerpQuaternions(it.prev.q, it.cur.q, alpha);
      } else { it.root.position.copy(it.cur.p); it.root.quaternion.copy(it.cur.q); }
      if (it.root.position.distanceToSquared(it.last.p) > 1e-10 || Math.abs(it.root.quaternion.dot(it.last.q)) < 1 - 1e-9) {
        it.last.p.copy(it.root.position); it.last.q.copy(it.root.quaternion);
        dirty = shadowDirty = contactDirty = true;
      }
    }
    /* the paint is alive while it is visible */
    if (items.can.state !== 'closed' && !stage.reduced) {
      paintMat.userData.U.uTime.value += dt;
      dirty = true;
    }
    /* a long pause: back to the hero picture (an open can or box closes, the puddle soaks away first) */
    if (time - lastInput > 24 && !grab && ptr.id === null && !tweens.length && !pourBusy() && (items.can.state === 'open' || items.box.state === 'open' || items.box.state === 'fan')) {
      if (items.can.state === 'open') closeCan();
      if (items.box.state === 'open' || items.box.state === 'fan') closeBox();
    }
    /* idle: arrange and recompose */
    if (time - lastInput > 4.5 && !grab && ptr.id === null && !tweens.length) {
      if (world && !stage.reduced) autoArrange();
      else for (const it of Object.values(items)) if (it.visible && !it.glide && it.state === 'closed' && displaced(it) && !stage.reduced) glideTo(it, it.home.p, it.home.q);
    }
    updateCamera(dt);
  }
  function render() {
    if (!built) return;
    if (!dirty && !forceRender) return;
    /* battery: 30 fps on the low tier, and everywhere after 20 s without interaction */
    if ((TC.fps30 || time - Math.max(lastInput, quietFrom) > 20) && !G3.capture && time - lastDraw < 1 / 30 - 0.004) return;
    lastDraw = time; drawCount++; drawn.push(time); while (drawn.length && time - drawn[0] > 1) drawn.shift();
    dirty = false;
    if (contactDirty) {
      contact.update(scene);
      /* only when something lies on the table beside the plinth */
      const low = Object.values(items).some(it => it.visible && it.cur.p.y < S.ph * 0.9 + it.half.y);
      contactFloor.mesh.visible = low;
      if (low) contactFloor.update(scene);
      contactDirty = false;
    }
    if (shadowDirty) { R.shadowMap.needsUpdate = true; shadowDirty = false; }
    post.render(scene, camera);
    placeButtons();
  }
  function capDpr(w, h) {
    const cap = dprBoost && w * h < 280000 ? Math.max(TC.dpr, dprBoost) : TC.dpr;
    if (R.getPixelRatio() > cap + 1e-3) { R.setPixelRatio(cap); R.setSize(w, h, false); }
    return R.getPixelRatio();
  }
  function resize(w, h) {
    if (!camera || !post) return;
    camera.aspect = w / h;
    const pr = capDpr(w, h);
    post.setSize(Math.round(w * pr), Math.round(h * pr));
    if (fadeU.uRes.value) fadeU.uRes.value.set(Math.round(w * pr), Math.round(h * pr));
    if (stage.q < 0.8 && post.S.samples > 0) post.setSamples(0);
    else if (stage.q > 0.95 && post.S.samples === 0 && msaa > 0) post.setSamples(msaa);
    focusView(camGoal);
    if (stage.reduced || !built) Object.assign(cam, camGoal);
    fitHint();
    dirty = true;
  }
  /* focus rings follow the objects on screen */
  function placeButtons() {
    const rect = { w: stage.w, h: stage.h };
    for (const it of Object.values(items)) {
      const b = btn[it.name]; if (!b) continue;
      if (!it.visible) { b.hidden = true; continue; }
      b.hidden = false;
      const pts = boxPts(it, [], 0.06, 0);
      if (it.name === 'can' && it.state !== 'closed' && !items.lid) pts.push(can.lid.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, 0.4, 0)));
      if (it.name === 'box' && it.state !== 'closed') { box.lid.updateMatrixWorld(); V.box.setFromObject(box.lid); pts.push(V.box.min.clone(), V.box.max.clone()); }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of pts) {
        const v = p.project(camera);
        const x = (v.x * 0.5 + 0.5) * rect.w, y = (-v.y * 0.5 + 0.5) * rect.h;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const pad = 6;
      x0 = clamp(x0 - pad, 2, rect.w - 2); y0 = clamp(y0 - pad, 2, rect.h - 2); x1 = clamp(x1 + pad, 2, rect.w - 2); y1 = clamp(y1 + pad, 2, rect.h - 2);
      b.style.transform = 'translate(' + x0.toFixed(1) + 'px,' + y0.toFixed(1) + 'px)';
      b.style.width = Math.max(10, x1 - x0).toFixed(1) + 'px'; b.style.height = Math.max(10, y1 - y0).toFixed(1) + 'px';
    }
  }

  function dispose() {
    unbindInput();
    clearTimeout(ptr.hold);
    if (world) { world.free(); world = null; }
    const seen = new Set();
    scene && scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      ms.forEach(m => { if (!seen.has(m)) { seen.add(m); m.dispose(); } });
    });
    Object.values(tex).forEach(t => t && t.dispose && t.dispose());
    [coat, coatPlinth, oldCoat].concat(stripBakes || []).forEach(b => b && b.dispose && b.dispose());
    pour && pour.dispose();
    envRT && envRT.dispose(); envHDR && envHDR.dispose(); post && post.dispose(); contact && contact.dispose(); contactFloor && contactFloor.dispose(); baker && baker.dispose();
    ui.remove();
  }

  /* ================= public API ================= */
  const ctl = {
    el, get ready() { return readyGate; },
    start() { if (gate) { gate.remove(); gate = null; } startStage(false); },
    setColors(colors) { setColors(colors); },
    setObject(name) {
      if (!OBJECTS.includes(name) || name === S.object) return;
      S.object = name;
      if (gate && opts.poster !== false && !opts.poster) gate.querySelector('img').src = posterFor(name);
      if (stage && opts.poster !== false && !opts.poster) stage.setPoster(posterFor(name));
      if (!built) return;
      const apply = () => { grab = null; layout(false); Object.assign(cam, camGoal); };
      crossfade(stage, () => { dirty = true; update(stage.t, 0); render(); }, apply, 0.8);
      dirty = true;
    },
    /* the public calls count as input: an idle stage does not undo them at once */
    open(which) {
      if (!built) return;
      touchInput();
      which = which || (S.object === 'box' ? 'box' : 'can');
      if (which === 'can') openCan();
      else if (which === 'box') openBox();
      else if (which === 'fan') { if (items.box.state === 'closed') { openBox(); setTimeout(() => fanOut(), stage.reduced ? 0 : 1250); } else fanOut(); }
      invalidate();
    },
    close(which) {
      if (!built) return;
      touchInput();
      if (!which || which === 'can') closeCan();
      if (!which || which === 'box' || which === 'fan') closeBox();
      invalidate();
    },
    setTheme(theme) { S.theme = ['light', 'dark'].includes(theme) ? theme : 'auto'; if (built) { applyTheme(); invalidate(); } },
    /* opens the can if needed and pours (the Pour control); low tier and reduced motion show the finished pour */
    pour() {
      if (!built) return;
      touchInput();
      const go = () => ensurePour().then(() => pourNow());
      if (items.can.state === 'closed') { openCan(); setTimeout(go, stage.reduced ? 0 : 900); } else go();
    },
    reset() {
      if (!built) return;
      closeCan(); closeBox();
      view.userAz = view.userEl = 0;
      Object.values(items).forEach((it, i) => { if (displaced(it)) { if (stage.reduced) place(it, it.home.p, it.home.q); else glideTo(it, it.home.p, it.home.q, null, i * 0.3); } });
      invalidate();
    },
    stats() {
      return Object.assign({}, stage ? stage.stats : {}, { object: S.object, physics: physicsState, can: items.can && items.can.state, box: items.box && items.box.state,
        calls: post ? post.S.calls : 0, tris: post ? post.S.tris : 0, samples: post ? post.S.samples : 0, steps: buildSteps, programs: R ? R.info.programs.length : 0,
        tier, tierWhy, gated: !!gate, pr: R ? +R.getPixelRatio().toFixed(2) : 0, drawFps: drawn.length, frames: drawCount, dprCap: dprBoost && stage && stage.w * stage.h < 280000 ? Math.max(TC.dpr, dprBoost) : TC.dpr, physicsFaults,
        lid: items.lid ? 'off' : 'on', level: +paintLevel.toFixed(3), pour: pour ? (pour.pouring ? 'pouring' : (pour.busy ? 'poured' : 'idle')) : 'none' });
    },
    renderFrame() { if (stage && stage.ready) { dirty = true; update(stage.t, 0); render(); } },
    destroy() { if (gate) { gate.remove(); gate = null; } if (stage) stage.destroy(); readyResolve(false); },
    /* test hooks: positions of objects on screen (css px) and the internal state */
    _debug: {
      screenOf(name, part) {
        const it = items[name]; if (!it || !camera) return null;
        let p;
        if (part === 'paint') p = can.paint.getWorldPosition(new T.Vector3());
        else if (part === 'strip') { const s = box.fan.strips[clamp(+arguments[2] || 0, 0, box.fan.strips.length - 1)]; s.mesh.updateMatrixWorld(); p = new T.Vector3(1.6, 0, 0.005).applyMatrix4(s.mesh.matrixWorld); }
        else if (part === 'top') p = new T.Vector3(0, it.half.y * 0.6, 0).applyQuaternion(it.cur.q).add(it.cur.p);
        else p = it.cur.p.clone();
        const v = p.project(camera), r = wrap.getBoundingClientRect();
        return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
      },
      pose(name) { const it = items[name]; return it && { p: it.cur.p.toArray().map(v => +v.toFixed(3)), q: it.cur.q.toArray().map(v => +v.toFixed(3)), state: it.state, sleeping: it.body ? it.body.isSleeping() : null, glide: !!it.glide }; },
      physics: () => physicsState,
      startPhysics: () => { startPhysics(); return physicsState; },     /* checks: physics without a gesture */
      pourState: () => pour ? { mode: pour.mode, level: +paintLevel.toFixed(3), pouring: pour.pouring, busy: pour.busy, settled: pour.settled, particles: pour.particles, active: pour.fluid ? pour.fluid.active : 0, sleeping: pour.fluid ? pour.fluid.sleeping : null, seq: pourSeq && pourSeq.phase, reset: pourReset } : null,
      resetPour: () => startPourReset(),
      always(on) { forceRender = !!on; },
      idle(sec) { lastInput = quietFrom = time - sec; return true; },
      paint() { const U = paintMat && paintMat.userData.U; return U ? { time: +U.uTime.value.toFixed(2), ripple: (U.uRip ? U.uRip.value : U.uRips.value[0]).toArray().map(v => +v.toFixed(2)), rings: U.uRips.value.filter(v => U.uTime.value - v.z < 7).length, mix: U.uMix.value } : null; },
      throwAll() {
        if (!world) return false;
        Object.values(items).forEach((it, i) => {
          if (!it.body || !it.visible || it.state !== 'closed') return;
          if (it.glide) { it.glide = null; it.body.setBodyType(RBT().Dynamic, true); }
          it.body.wakeUp();
          it.body.setLinvel({ x: (i ? 1 : -1) * 2.5, y: 15 + i * 2, z: 0.6 }, true);
          it.body.setAngvel({ x: 2.5 - i * 4, y: 3 + i, z: -2 + i * 3 }, true);
        });
        lastInput = time;
        return true;
      },
      tune(o) {
        if (o.envRot != null || o.panel) { if (o.envRot != null) ENV.rot = o.envRot; if (o.panel) Object.assign(ENV.panel, o.panel); buildEnv(); }
        if (o.envInt != null) scene.environmentIntensity = o.envInt;
        ['bloom', 'threshold', 'knee', 'exposure', 'radius'].forEach(k => { if (o[k] != null) post.S[k] = o[k]; });
        if (o.key != null) key.intensity = o.key; if (o.rim != null) rim.intensity = o.rim; if (o.fill != null) fill.intensity = o.fill;
        if (o.keyDir) { key.position.set(o.keyDir[0] * 15, o.keyDir[1] * 15, o.keyDir[2] * 15); }
        if (o.spotK != null) key.angle = Math.atan((plinthR * o.spotK) / 15);
        if (o.pen != null) key.penumbra = o.pen;
        if (o.canYaw != null) { items.can.home.q.setFromAxisAngle(new T.Vector3(0, 1, 0), o.canYaw); place(items.can, items.can.home.p, items.can.home.q); }
        if (o.mat) Object.entries(o.mat).forEach(([n, props]) => Object.assign(mats[n], props));
        if (o.cam) Object.assign(camGoal, o.cam);
        if (o.ph != null || o.prK != null || o.el != null) { if (o.ph != null) S.ph = o.ph; if (o.prK != null) S.prK = o.prK; if (o.el != null) S.el = o.el; layout(true); }
        if (o.plinth) { const nb = bakeGranules(T, baker, { colors: o.plinth === 'dark' ? DARK_STONE : normColors(o.plinth), size: 1024, cells: 128, density: 0.95, seed: 23 }); plinthMat.map = nb.albedo; plinthMat.bumpMap = nb.data; plinthMat.userData.U.uOld.value = nb.albedo; S.plinth = 'custom'; }
        shadowDirty = contactDirty = dirty = true; invalidate();
        return { envRot: scene.environmentRotation.y, envInt: scene.environmentIntensity, post: post.S };
      },
      get world() { return world; }, get pour() { return pour; },
      frameInfo(f) { const pts = finalPoints(f || view.focus); const out = pts.map(p => { const v = p.clone().project(camera); return [+v.x.toFixed(2), +v.y.toFixed(2)]; }); return { goal: Object.assign({}, camGoal), cam: Object.assign({}, cam), view: { focus: view.focus, userAz: view.userAz, userEl: view.userEl }, ndc: out }; }
    }
  };
  el.dv3d = ctl;
  if (tier === 'low' && !G3.capture && opts.autostart !== true && hasWebGL2()) showGate(); else startStage(false);
  return ctl;
}

function mountDeclared(el) {
  if (el.dv3d) return;
  const a = n => el.getAttribute('data-' + n);
  let colors, labels;
  try { colors = a('colors') ? JSON.parse(a('colors')) : undefined; } catch (e) { colors = undefined; }
  try { labels = a('labels') ? JSON.parse(a('labels')) : undefined; } catch (e) { labels = undefined; }
  const poster = a('poster');
  mount(el, {
    object: a('object') || 'both', colors, labels, lang: a('lang') || undefined,
    physics: a('physics') !== 'false', theme: a('theme') || 'auto', hint: a('hint') !== 'false',
    plinth: a('plinth') || undefined, poster: poster === 'none' ? false : (poster || undefined)
  });
}
