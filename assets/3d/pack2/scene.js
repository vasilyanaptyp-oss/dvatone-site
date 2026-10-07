/* Dvatone packaging v2, the scene: a physically based studio scene for the Designer Box block. ../pack2.js (the small
   entry with the public API) loads it when the block nears the viewport.
   Matte black can with a copper lid and copper-foil label, rigid Designer Box with a hinged lid, sample chips and a
   colour fan, all on a plinth coated with the composition. Studio HDRI (Poly Haven, CC0) reflections, soft key shadow,
   contact shadows, bloom on the copper highlights, Khronos Neutral tone mapping (hue-true).
   The plinth is a turntable: a sideways drag turns it, a flick lets it coast to a stop, and after a quiet while it
   turns back to the front. The studio light turns with the view, so every side is seen in the same light. Nothing
   else is dragged about: tap the can and its lid pops off onto the plinth (the paint inside ripples wherever it is
   tapped, «Вилити» pours it out), tap it again and the lid flies back on; tap the box and its lid swings open on the
   hinge at its back edge, again and the colour fan rises and fans out, tap a strip to pour that composition into the
   can. All motion is scripted (no physics engine).

   mount(el, { object:'can'|'box'|'both', colors:[{hex,share}], theme:'dark'|'light'|'auto',
               labels:{...}, lang:'uk'|'en', poster:url|false, fan:[{name, colors}], plinth:'coating'|'dark'|colors,
               hint:true })
     -> { ready, setColors(colors), setObject(name), open(which?), close(which?), pour(), setTheme(t), reset(), stats(), destroy() }
   Events on el: dv3d:ready, dv3d:fallback, dv3d:open {object}, dv3d:close {object}, dv3d:pick {name, colors},
   dv3d:pour {state}, dv3d:lid {state}, dv3d:paint {x, y}, dv3d:turn {angle}.
   Declarative: <div data-dv3d="pack2" data-object="both" data-colors='[...]'></div>
   Keyboard: Tab to the can or the box; Left/Right turn the plinth (or walk the fan strips), Up/Down tilt the view,
   Enter opens, Escape closes, Home brings the front back, P pours. prefers-reduced-motion: static beauty pose,
   instant changes, no coasting. No WebGL2: the poster stays. */
import { createStage, createBaker, bakeGranules, normColors, clamp, isSmallScreen, isFinePointer, crossfade, hasWebGL2 } from '../core.js';
import { detectTier, probe, remember, lower, TIER_CFG } from './tier.js';

const BASE = import.meta.url;
const OBJECTS = ['can', 'box', 'both'];
const GRAV = 98.1;                 /* dm / s^2: the popped lid's arc, the scene is modelled in decimetres */
const LAYER_DYN = 2;               /* objects that throw contact shadows */
/* the box lid opens to 100 degrees on its hinge at the back edge of the base: just past upright, leaning back a
   little, the whole open box standing on the plinth */
const BOX_OPEN = 1.745;
/* plinth radius per arrangement (decimetres, times S.prK 0.92): the open box with its standing lid, the can, its
   popped lid and a poured puddle all lie on it with room to spare (checked by projecting their footprints) */
const PLINTH = { both: 3.663, can: 2.5, box: 2.717 };
/* where the popped lid lands and where the pour runs, per arrangement (x, z on the plinth top) */
const SPOTS = { both: { lid: [0.89, 2.01], pour: [-1.11, 2.03] }, can: { lid: [0.55, 1.03], pour: [0.87, -0.9] }, box: {} };
const wrapPi = a => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

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

const TXT = {
  uk: {
    region: 'Упаковка Dvatone у 3D: банка й коробка Designer Box', can: 'Банка Dvatone', box: 'Коробка Designer Box',
    canHelp: 'Enter відкриває кришку, стрілки повертають подіум', boxHelp: 'Enter відкриває коробку, ще раз розгортає віяло, стрілки повертають подіум',
    fanHelp: 'Стрілки вибирають зразок віяла, Enter наливає цей колір у банку, Escape закриває коробку',
    canOpened: 'Кришку знято: усередині фарба', canClosed: 'Банку закрито', boxOpened: 'Коробку відкрито: зразки й віяло',
    fanOpened: 'Віяло розгорнуто', boxClosed: 'Коробку закрито', picked: 'Колір у банці: {name}', strip: 'Зразок {name}',
    hint: 'Натисніть, щоб відкрити · Тягніть, щоб повернути', hintTouch: 'Торкніться, щоб відкрити · Тягніть, щоб повернути',
    live: 'Живе 3D', liveLabel: 'Увімкнути інтерактивне 3D: банка й коробка Designer Box',
    pour: 'Вилити', pourLabel: 'Вилити фарбу з банки на подіум', poured: 'Фарбу вилито: калюжа розтікається', refilled: 'Банку знову наповнено',
    line: 'МУЛЬТИКОЛОРОВЕ ДЕКОРАТИВНЕ ПОКРИТТЯ', vol: '2 л', boxCaption: 'DESIGNER BOX', inside: 'Зразки покриття для вашого проєкту'
  },
  en: {
    region: 'Dvatone packaging in 3D: the can and the Designer Box', can: 'Dvatone can', box: 'Designer Box',
    canHelp: 'Enter lifts the lid, arrow keys turn the plinth', boxHelp: 'Enter opens the box, again to fan out the colour fan, arrow keys turn the plinth',
    fanHelp: 'Arrow keys choose a fan strip, Enter pours that colour into the can, Escape closes the box',
    canOpened: 'Lid lifted: the paint inside', canClosed: 'Can closed', boxOpened: 'Box open: samples and the colour fan',
    fanOpened: 'Colour fan open', boxClosed: 'Box closed', picked: 'Colour in the can: {name}', strip: 'Sample {name}',
    hint: 'Click to open · Drag to turn', hintTouch: 'Tap to open · Drag to turn',
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
.dvp2-stage{touch-action:pan-y pinch-zoom;cursor:grab;outline:none}
.dvp2-gate{position:relative;width:100%;height:100%}
.dvp2-gate__img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;user-select:none}
.dvp2-live{position:absolute;left:50%;bottom:clamp(10px,4%,24px);transform:translateX(-50%);display:inline-flex;align-items:center;gap:10px;
  min-height:44px;padding:0 20px;border:0;border-radius:999px;cursor:pointer;font:600 11px/1 Manrope,system-ui,sans-serif;letter-spacing:.14em;
  text-transform:uppercase;color:#ede6da;background:rgba(18,16,14,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  box-shadow:inset 0 0 0 1px rgba(220,186,148,.42);-webkit-tap-highlight-color:transparent}
.dvp2-live i{width:7px;height:7px;border-radius:50%;background:#c4935c;box-shadow:0 0 0 4px rgba(196,147,92,.2)}
.dvp2-live:focus-visible{outline:none;box-shadow:inset 0 0 0 1px rgba(220,186,148,.42),0 0 0 2px var(--focus,#e6c9a4)}
.dvp2-gate.is-light .dvp2-live{color:#191511;background:rgba(247,244,239,.7);box-shadow:inset 0 0 0 1px rgba(138,79,31,.4)}
.dvp2-stage.is-hover,.dvp2-stage.is-point{cursor:pointer}.dvp2-stage.is-turning{cursor:grabbing}
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
  let can = null, box = null, plinthR = 3.3;
  const items = {};
  const V = {};                       /* scratch vectors */
  const cam = { tx: 0, ty: 1.2, tz: 0, az: 0, el: 0.3, dist: 14, fov: 24 }, camGoal = Object.assign({}, cam), camVel = {};
  const view = { focus: 'hero', wide: true, userEl: 0, par: [0, 0], parGoal: [0, 0] };
  /* the turntable: the studio (camera, lights, environment) turns around the plinth by a. v: coasting after a flick;
     goal: a glide (the arrow keys, Home, the slow return to the front after a quiet while), spring rate w */
  const turn = { a: 0, v: 0, goal: null, w: 6, sv: 0, applied: NaN };
  let time = 0, lastInput = -10, dirty = true, shadowDirty = true, contactDirty = true, built = false, hintShown = false, hintT = 0;
  const buildSteps = {};
  let msaa = 4;
  let forceRender = false, lastDraw = -1;
  const drawn = [];
  let fanSel = -1, hoverStrip = -1, transitions = [], tweens = [];
  const ptr = { id: null, mode: null, x0: 0, y0: 0, t0: 0, x: 0, y: 0, lx: 0, ly: 0, lt: 0, vx: 0, vy: 0, hit: null, hold: 0, touch: false, hist: [] };
  let drawCount = 0, quietFrom = 0, dprBoost = 0;

  let stage = null, wrap = null, ui = null, live = null, hint = null, gate = null, readyResolve = null, pourBtn = null;
  const btn = {}, readyGate = new Promise(r => (readyResolve = r));
  function startStage(fromTap) {
    if (stage) return;
    stage = createStage(el, {
      poster: null,
      className: 'dv3d--pack dvp2-stage', alpha: true, antialias: false,
      build, update, render, resize, dispose,
      continuous: () => ptr.mode === 'turn' || !!turn.v || turn.goal != null || tweens.length > 0 || transitions.length > 0
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
    ['can', 'box'].forEach(n => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dvp2-hit'; b.dataset.object = n;
      b.setAttribute('aria-expanded', 'false'); b.hidden = true; ui.appendChild(b); btn[n] = b;
      b.addEventListener('click', () => { touchInput(); activate(n, null); });
      b.addEventListener('keydown', e => onKey(e, n));
      b.addEventListener('focus', () => { dirty = true; invalidate(); });
    });
    ui.appendChild(pourBtn);                     /* after the can and the box in the tab order */
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
    Object.assign(V, { a: vec(), b: vec(), c: vec(), d: vec(), pv: vec(), cp: vec(), ct: vec(), Y: new T.Vector3(0, 1, 0), q: new T.Quaternion(), q2: new T.Quaternion(), m: new T.Matrix4(), ray: new T.Raycaster(), ndc: new T.Vector2(), plane: new T.Plane(), box: new T.Box3() });
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
    contact = createContact(T, R, { res: TC.contact, layer: LAYER_DYN, height: 1.25, darkness: 0.92, blur: TC.contact < 512 ? 1.6 : 2.4 });
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
  }
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
      name, model, root: model.root, com, half: model.half, visible: true,
      home: { p: new T.Vector3(), q: new T.Quaternion() }, cur: { p: new T.Vector3(), q: new T.Quaternion() }, prev: { p: new T.Vector3(), q: new T.Quaternion() },
      last: { p: new T.Vector3(1e9, 0, 0), q: new T.Quaternion() }, glide: null, frozen: false, state: 'closed'
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
    plinthR = PLINTH[S.object] * S.prK;
    if (S.object === 'both') {
      /* the box at the back left with room behind it for its standing lid, the can on the right; the can's lid lands
         front centre and the pour runs front left (SPOTS) */
      c.home.p.set(2.19, H + M.CAN.COM, 0.35); c.home.q.copy(Q(-0.12));
      b.home.p.set(-0.67, H + M.BOX.COM, -0.28); b.home.q.copy(Q(0.14));
    } else if (S.object === 'can') {
      c.home.p.set(-1.05, H + M.CAN.COM, -0.3); c.home.q.copy(Q(-0.3));
      b.home.p.set(0, -40, 0); b.home.q.identity();
    } else {
      /* the open box (base and standing lid) centred on the plinth */
      b.home.p.set(0.062, H + M.BOX.COM, 0.385); b.home.q.copy(Q(0.16));
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
    rigSave();
    turn.a = 0; turn.v = 0; turn.sv = 0; turn.goal = null; turn.applied = NaN;
    view.focus = 'hero'; view.wide = true; view.userEl = 0;
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
  /* the whole turntable in the picture at every angle: each point stands for the circle it sweeps as the plinth turns,
     so turning never pushes anything out of the frame (and the camera stays put while it turns) */
  function sweep(pts, out) {
    const seen = new Set();
    for (const p of pts) {
      const r = Math.hypot(p.x, p.z), k = Math.round(r * 25) + ':' + Math.round(p.y * 25);
      if (seen.has(k)) continue;
      seen.add(k); circlePts(0, p.y, 0, r, 24, out);
    }
    return out;
  }
  function wideView(goal, f) {
    const aspect = Math.max(0.3, stage.w / stage.h), portrait = aspect < 0.95;
    goal.fov = portrait ? 30 : 24; goal.el = portrait ? S.el + 0.06 : S.el; goal.az = S.object === 'both' ? -0.06 : 0;
    const pts = circlePts(0, S.ph, 0, plinthR, 32, []);
    circlePts(0, 0, 0, plinthR, 32, pts);
    const own = [];
    Object.values(items).forEach(it => {
      if (!it.visible || it.name === 'lid') return;
      const keep = it.cur.p.clone(), kq = it.cur.q.clone(); it.cur.p.copy(it.home.p); it.cur.q.copy(it.home.q);
      boxPts(it, own, 0.1, 0.25);
      it.cur.p.copy(keep); it.cur.q.copy(kq);
    });
    const ci = items.can, bi = items.box;
    /* the popped lid's arc over the can */
    if (ci.visible && (f === 'can' || f === 'pour' || ci.state !== 'closed')) circlePts(ci.home.p.x, ci.home.p.y + M.CAN.H / 2 + 1.45, ci.home.p.z, M.CAN.R, 8, own);
    if (bi.visible && (f === 'box' || f === 'fan' || bi.state !== 'closed')) own.push(...finalPoints(f === 'fan' || bi.state === 'fan' ? 'fan' : 'box'));
    if (f === 'pour' && pourPts) own.push(...pourPts);
    frame(goal, sweep(own, pts), portrait ? 0.04 : 0.08, 0.1, 0.07);
  }
  function heroView(goal) { wideView(goal, 'hero'); }
  /* the open poses are known in advance: frame them before they happen (the camera moves while the lid lifts) */
  function finalPoints(f) {
    const pts = [], v = () => new T.Vector3();
    if (f === 'can') {
      const it = items.can; it.root.position.copy(it.cur.p); it.root.quaternion.copy(it.cur.q); it.root.updateMatrixWorld(true);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; pts.push(v().set(Math.cos(a) * (M.CAN.R + 0.05), M.CAN.H, Math.sin(a) * (M.CAN.R + 0.05)).applyMatrix4(can.body.matrixWorld)); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; pts.push(v().set(Math.cos(a) * M.CAN.R, M.CAN.H - 0.75, Math.sin(a) * M.CAN.R).applyMatrix4(can.body.matrixWorld)); }
    } else {
      const it = items.box; it.root.position.copy(it.cur.p); it.root.quaternion.copy(it.cur.q); it.root.updateMatrixWorld(true);
      boxPts(it, pts, 0.04, 0);
      const h0 = box.hinge.rotation.x; box.hinge.rotation.x = -BOX_OPEN; box.hinge.updateMatrixWorld(true);
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
    /* the whole turntable: always on a phone-sized stage (both objects stay whole at every angle), and on a desktop
       once the plinth has been turned; otherwise a close-up of what was opened, seen from where the plinth stands */
    if (f === 'hero' || view.wide || stage.w < 560) return wideView(goal, f);
    const at = turn.goal != null ? turn.goal : turn.a, rig = pts => pts.map(p => p.clone().applyAxisAngle(V.Y, -at));
    if (f === 'pour' && pourPts) { goal.fov = portrait ? 30 : 24; goal.az = 0; goal.el = 0.36; frame(goal, rig(pourPts), portrait ? 0.06 : 0.09, 0.12, 0.08); return; }
    goal.fov = portrait ? 30 : 24;
    goal.az = S.object === 'both' ? (f === 'can' ? 0.08 : -0.1) : 0;
    goal.el = f === 'can' ? 0.66 : (f === 'fan' ? 0.34 : 0.7);
    frame(goal, rig(finalPoints(f)), portrait ? 0.05 : 0.09, 0.07, 0.07);
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
    if (ptr.mode !== 'turn' && idleFor > 3.5) {             /* a tilted view drifts back to its composition */
      const k = 1 - Math.exp(-dt * 1.2); view.userEl -= view.userEl * k;
    }
    stepTurn(dt, idleFor);
    const pk = 1 - Math.exp(-dt * 3);
    view.par[0] += (view.parGoal[0] - view.par[0]) * pk; view.par[1] += (view.parGoal[1] - view.par[1]) * pk;
    const g = camGoal;
    if (stage.reduced) Object.assign(cam, g);
    else {
      const st = view.focus === 'hero' ? 0.75 : 0.6;
      ['tx', 'ty', 'tz', 'az', 'el', 'dist', 'fov'].forEach(k => { cam[k] = smoothDamp(k, g[k], st, Math.min(dt, 0.05)); });
    }
    const az = cam.az + view.par[0] * 0.07, el = clamp(cam.el + view.userEl - view.par[1] * 0.04, 0.05, 1.25);
    camera.fov = cam.fov; camera.aspect = stage.w / stage.h;
    /* the camera in the turntable's frame, then the whole studio turned round the plinth's axis */
    V.cp.set(cam.tx + Math.sin(az) * Math.cos(el) * cam.dist, cam.ty + Math.sin(el) * cam.dist, cam.tz + Math.cos(az) * Math.cos(el) * cam.dist).applyAxisAngle(V.Y, turn.a);
    V.ct.set(cam.tx, cam.ty, cam.tz).applyAxisAngle(V.Y, turn.a);
    camera.position.copy(V.cp); camera.lookAt(V.ct);
    camera.updateProjectionMatrix();
    if (turn.applied !== turn.a) applyTurn();
    const after = cam.tx + cam.ty * 3.1 + cam.tz * 7.3 + cam.az * 11 + cam.el * 13 + cam.dist * 17 + cam.fov * 19 + view.par[0] * 23 + view.par[1] * 29 + turn.a * 31;
    if (Math.abs(after - before) > 1e-6) dirty = true;
  }
  /* the studio turns with the view: the lights and the environment keep their place relative to the camera, so the
     plinth turns under unchanged light (and the shadows move over it the way they would on a real turntable) */
  let rigBase = null;
  function rigSave() { rigBase = [key.position, key.target.position, rim.position, rim.target.position, fill.position].map(v => v.clone()); }
  function applyTurn() {
    turn.applied = turn.a;
    if (rigBase) [key.position, key.target.position, rim.position, rim.target.position, fill.position].forEach((v, i) => v.copy(rigBase[i]).applyAxisAngle(V.Y, turn.a));
    key.target.updateMatrixWorld(); rim.target.updateMatrixWorld();
    if (scene.environmentRotation) scene.environmentRotation.y = turn.a;
    if (pour && pour.setTurn) pour.setTurn(turn.a);
    shadowDirty = dirty = true;
  }
  /* a drag turns it (onMove); let go while moving and it coasts, slowing gently; the keys, Home and the pour glide it
     to an angle on a critically damped spring; after a quiet while it turns back to the front by the short way */
  function stepTurn(dt, idleFor) {
    if (ptr.mode === 'turn') return;
    if (turn.goal == null && !turn.v && Math.abs(wrapPi(turn.a)) > 0.003 && idleFor > 8 && ptr.id === null && !stage.reduced && !pourBusy() && !tweens.length) {
      turn.a = wrapPi(turn.a); turn.goal = 0; turn.w = 1.7; turn.sv = 0;
    }
    if (turn.goal != null) {
      const h = Math.min(dt, 0.05), w = turn.w;
      turn.sv += (w * w * (turn.goal - turn.a) - 2 * w * turn.sv) * h;
      turn.a += turn.sv * h;
      if (Math.abs(turn.goal - turn.a) < 0.0008 && Math.abs(turn.sv) < 0.01) { turn.a = turn.goal; turn.goal = null; turn.sv = 0; }
    } else if (turn.v) {
      turn.a += turn.v * dt;
      turn.v *= Math.exp(-dt * 2.4);
      if (Math.abs(turn.v) < 0.03) turn.v = 0;
    }
  }
  function turnTo(a, w) {
    turn.v = 0;
    if (stage.reduced) { turn.a = a; turn.goal = null; turn.sv = 0; dirty = true; invalidate(); return; }
    turn.goal = a; turn.w = w || 7; turn.sv = 0;
    invalidate();
  }
  function setFocus(f) {
    if (view.focus === f) return;
    view.focus = f; focusView(camGoal); dirty = true;
  }

  /* ================= the paint level ================= */
  let paintLevel = 1;
  function setPaintLevel(l) {
    paintLevel = clamp(l, 0, 1);
    if (can) { can.paint.position.y = 0.06 + (M.CAN.PAINT_Y - 0.06) * paintLevel; can.paint.visible = paintLevel > 0.01; }
    dirty = true;
  }
  function freeze(it, on) { it.frozen = on; }

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
  /* a glide: the visual pose follows the arc (all motion is scripted) */
  function tweenGlide(it, dt) {
    const g = it.glide; g.t += dt;
    const k = clamp((g.t - g.delay) / g.T, 0, 1);
    glidePose(g, k, it.cur.p, it.cur.q);
    if (k >= 1) { it.glide = null; g.done && setTimeout(g.done, 0); }
  }
  function place(it, p, q) {
    it.cur.p.copy(p); it.cur.q.copy(q); it.prev.p.copy(p); it.prev.q.copy(q);
    dirty = shadowDirty = contactDirty = true;
  }
  /* off its place on the plinth (only an interrupted pour leaves the can elsewhere) */
  function displaced(it) {
    if (!it.visible || it.name === 'lid') return false;
    return it.cur.p.distanceTo(it.home.p) > 0.05 || it.cur.q.angleTo(it.home.q) > 0.05;
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
        stillAt: { x: SPOTS[S.object].pour[0], z: SPOTS[S.object].pour[1] }
      });
      pour.setGranules(coat.albedo, coat.data);
      if (pour.setTurn) pour.setTurn(turn.a);
      if (pour.precompile) pour.precompile(camera, R);
      syncPourBtn();
      return pour;
    }).catch(() => { pourP = null; return null; });
    return pourP;
  }
  function pourCan(Vv) {
    const it = items.can;
    Vv.p.copy(it.root.position); Vv.q.copy(it.root.quaternion);
    Vv.v.set(0, 0, 0); Vv.w.set(0, 0, 0);
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
    for (const it of [c, b, l]) if (it && it.glide) wake.push(it.root.position.x, it.root.position.y, it.root.position.z, 1.6);
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
    if (pour.mode === 'still' || stage.reduced) {
      /* the finished pool beside the open can, the whole plinth in view */
      pour.still();
      pourPts = [];
      view.focus = ''; view.wide = true; setFocus('pour');
      announce(L.poured); emit('dv3d:pour', { state: 'end' }); syncPourBtn(); dirty = true; invalidate(); return;
    }
    /* the puddle goes where the plinth is free (front left, clear of the box, the lid and the can's own spot). The can
       is carried there nearly upright (a full can spills past about 16 degrees), its lip held above the spot, and only
       then turned over its own lip: the lip comes straight down over the spot while the can tips, so the rope always
       falls on the same place and the paint pools round it */
    const home = it.home.p;
    const sp = SPOTS[S.object].pour, spot = new T.Vector3(sp[0], S.ph, sp[1]);
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
    circlePts(spot.x, S.ph, spot.z, 1.25, 16, pourPts); if (items.box.visible) boxPts(items.box, pourPts, 0.05, 0);
    it.cur.p.copy(save.p); it.cur.q.copy(save.q);
    /* the plinth turns to the front while the can is lifted: the pour is seen from where it was composed */
    turn.a = wrapPi(turn.a); turnTo(0, 3);
    view.focus = ''; view.wide = false; setFocus('pour');
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
  function openCan(homed) {
    const it = items.can;
    if (!it.visible || it.state !== 'closed') return;
    if (it.glide) { it.glide.done = () => openCan(true); return; }
    if (!homed && displaced(it)) { if (stage.reduced) place(it, it.home.p, it.home.q); else { glideTo(it, it.home.p, it.home.q, () => openCan(true)); return; } }
    it.state = 'open';
    can.paint.visible = paintLevel > 0.01;
    if (!items.lid) popLid();
    view.wide = false; setFocus('can'); labelButtons(); announce(L.canOpened); emit('dv3d:open', { object: 'can' });
    onCanOpen();
  }
  function closeCan(fast) {
    const it = items.can;
    if (it.state === 'closed' || it.state === 'closing') return;
    if (pour && pour.busy && !pour.pouring && !pourSeq && !pourReset) { startPourReset(() => closeCan(fast)); return; }   /* the puddle soaks away first */
    if (pourBusy()) return;                             /* not in the middle of a pour */
    it.state = 'closing';
    onCanClose();
    const done = () => { it.state = 'closed'; labelButtons(); };
    /* the can stands at home, then the lid flies back onto it and seats */
    const back = () => returnLid(fast, done);
    if (displaced(it) && !stage.reduced) glideTo(it, it.home.p, it.home.q, back); else back();
    if (view.focus === 'can') setFocus('hero');
    announce(L.canClosed); emit('dv3d:close', { object: 'can' });
  }
  /* the lid's seat on the can, in the world */
  function lidSeat(outP, outQ) {
    can.root.position.copy(items.can.cur.p); can.root.quaternion.copy(items.can.cur.q); can.root.updateMatrixWorld(true);
    outP.set(0, M.CAN.LID_Y - M.CAN.COM, 0).applyMatrix4(can.root.matrixWorld); outQ.copy(items.can.cur.q);
  }
  /* the lid pops off: straight up off the rim, then an arc with half a turn onto the free plinth (it lands face down),
     a clack and a little rock as it settles. Scripted, so it lands in the same place every time */
  const LID_REST = 0.024;              /* face down, the lid's centre stands this far above what it lies on */
  function popLid() {
    const lid = can.lid;
    lid.position.set(0, M.CAN.LID_Y, 0); lid.rotation.set(0, 0, 0);
    can.root.position.copy(items.can.cur.p); can.root.quaternion.copy(items.can.cur.q);
    can.root.updateMatrixWorld(true);
    scene.attach(lid);
    const it = makeItem('lid', { root: lid, half: new T.Vector3(M.CAN.R, 0.06, M.CAN.R) }, 0);
    place(it, lid.position, lid.quaternion);
    items.lid = it;
    lid.traverse(o => { if (o.isMesh) o.layers.enable(LAYER_DYN); });
    const sp = SPOTS[S.object] && SPOTS[S.object].lid;
    const cp = items.can.cur.p, tx = sp ? sp[0] : cp.x - 0.3, tz = sp ? sp[1] : cp.z + plinthR + 0.8;
    const ground = Math.hypot(tx, tz) < plinthR ? S.ph : 0;
    const p0 = it.cur.p.clone(), q0 = it.cur.q.clone(), p1 = new T.Vector3(tx, ground + LID_REST, tz);
    const dx = p1.x - p0.x, dz = p1.z - p0.z, dist = Math.hypot(dx, dz) || 1, ax = new T.Vector3(-dz / dist, 0, dx / dist);
    /* lifted 0.07 dm clear of the rim first, then the arc: up at 12 dm/s, down under gravity onto the spot */
    const vy = 12, h0 = p0.y + 0.07 - p1.y, tf = vy / GRAV + Math.sqrt(2 * (vy * vy / (2 * GRAV) + h0) / GRAV);
    const yaw = (Math.random() - 0.5) * 0.5, qa = new T.Quaternion(), qy = new T.Quaternion();
    if (stage.reduced) { place(it, p1, new T.Quaternion().setFromAxisAngle(ax, Math.PI).multiply(q0)); it.home.p.copy(it.cur.p); it.home.q.copy(it.cur.q); emit('dv3d:lid', { state: 'off' }); return; }
    const T0 = 0.06, T1 = T0 + tf, T2 = T1 + 0.42;
    tween({ key: 'lidpop', T: T2, fn: k => {
      const t = k * T2;
      if (t < T0) {                                   /* off the rim */
        const e = t / T0; it.cur.p.copy(p0); it.cur.p.y += 0.07 * e * e; it.cur.q.copy(q0);
      } else if (t < T1) {                            /* the arc and half a turn backwards */
        const s = t - T0, f = s / tf;
        it.cur.p.set(p0.x + dx * f, p0.y + 0.07 + vy * s - 0.5 * GRAV * s * s, p0.z + dz * f);
        qa.setFromAxisAngle(ax, Math.PI * f); qy.setFromAxisAngle(V.Y, yaw * f);
        it.cur.q.copy(qy).multiply(qa).multiply(q0);
      } else {                                        /* the clack: a short rock about the landing edge, settling */
        const s = t - T1, tilt = 0.075 * Math.exp(-s * 13) * Math.sin(s * 34), hop = 0.018 * Math.exp(-s * 20) * Math.abs(Math.sin(s * 30));
        qa.setFromAxisAngle(ax, Math.PI + tilt); qy.setFromAxisAngle(V.Y, yaw);
        it.cur.q.copy(qy).multiply(qa).multiply(q0);
        it.cur.p.copy(p1); it.cur.p.y += hop + Math.sin(Math.abs(tilt)) * M.CAN.R;
      }
      it.prev.p.copy(it.cur.p); it.prev.q.copy(it.cur.q);
    }, done: () => { it.home.p.copy(it.cur.p); it.home.q.copy(it.cur.q); } });
    emit('dv3d:lid', { state: 'off' });
  }
  function returnLid(fast, done) {
    const it = items.lid;
    if (!it) { done && done(); return; }
    const p = new T.Vector3(), q = new T.Quaternion();
    lidSeat(p, q);
    const seat = () => {
      /* back on the can: the lid rides with the can again */
      delete items.lid;
      can.body.attach(can.lid);
      can.lid.position.set(0, M.CAN.LID_Y, 0); can.lid.rotation.set(0, 0, 0);
      dirty = shadowDirty = contactDirty = true;
      emit('dv3d:lid', { state: 'on' });
      done && done();
    };
    tweens = tweens.filter(o => o.key !== 'lidpop');
    if (stage.reduced) { seat(); return; }
    glideTo(it, p, q, seat, 0, { lift: 0.75, T: fast ? 0.5 : 0.95 });
  }
  /* box: hinged lid with a soft overshoot; fan rises, tilts towards the viewer, strips spread with a stagger */
  const FAN_OPEN = { x: -1.05, y: 0.95, z: 0.55, rx: -0.38 }, MAXA = 1.92;
  function boxLid(k) { box.hinge.rotation.x = -BOX_OPEN * k; }
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
    ensureStrips();
    it.state = 'open';
    tween({ key: 'boxlid', T: 1.15, fn: k => boxLid(easeOutBack(k, 1.05)) });
    view.wide = false; setFocus('box'); labelButtons(); announce(L.boxOpened); emit('dv3d:open', { object: 'box' });
  }
  function fanOut() {
    const it = items.box;
    if (it.state !== 'open') return;
    it.state = 'fan'; fanSel = -1;
    tween({ key: 'fan', T: 1.6, fn: k => fanPose(k) });
    view.wide = false; setFocus('fan'); labelButtons(); announce(L.fanOpened); emit('dv3d:open', { object: 'fan' });
  }
  function closeBox(fast) {
    const it = items.box;
    if (it.state === 'closed') return;
    const wasFan = it.state === 'fan';
    it.state = 'closing'; fanSel = -1; hoverStrip = -1;
    const lidClose = () => tween({ key: 'boxlid', T: fast ? 0.3 : 0.75, fn: k => boxLid(1 - easeInOut(k)), done: () => { it.state = 'closed'; labelButtons(); } });
    if (wasFan) tween({ key: 'fan', T: fast ? 0.3 : 0.8, fn: k => fanPose(1 - k), done: lidClose });
    else lidClose();
    if (view.focus === 'box' || view.focus === 'fan') setFocus('hero');
    announce(L.boxClosed); emit('dv3d:close', { object: 'box' });
  }
  function seatLidNow() {
    const it = items.lid; if (!it) return;
    delete items.lid;
    can.body.attach(can.lid); can.lid.position.set(0, M.CAN.LID_Y, 0); can.lid.rotation.set(0, 0, 0);
  }
  function closeNow(it) {
    if (!can) return;
    if (it.name === 'can') seatLidNow();
    tweens = tweens.filter(o => !(it.name === 'can' ? (o.key === 'lidpop' || o.key === 'refill') : (o.key === 'boxlid' || o.key === 'fan')));
    if (it.name === 'can') { can.lid.position.set(0, M.CAN.LID_Y, 0); can.lid.rotation.set(0, 0, 0); }
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
  let ripK = 0;
  function ripple(p, amp = 1) {
    const loc = can.paint.worldToLocal(p.clone());
    const U = paintMat.userData.U, r = U.uRad.value, R4 = U.uRips.value[ripK];
    ripK = (ripK + 1) % U.uRips.value.length;
    R4.set(loc.x / r, loc.z / r, U.uTime.value, amp);
    U.uRip = { value: R4 };
    dirty = true; invalidate();
    emit('dv3d:paint', { x: +R4.x.toFixed(3), y: +R4.y.toFixed(3) });
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
  function onContext(e) { if (ptr.touch && ptr.mode === 'press') e.preventDefault(); }
  function onTouchMove(e) { if (ptr.mode === 'turn' && e.cancelable) e.preventDefault(); }
  /* a press becomes a tap (open, close, a ripple in the paint, a fan strip) or a turn of the plinth: a drag sideways
     (with a mouse, any drag); on touch a mostly vertical swipe is left to the page, which scrolls */
  function onDown(e) {
    if (!built || ptr.id !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    touchInput();
    const hit = pick(e.clientX, e.clientY), t = evT(e);
    Object.assign(ptr, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t0: t, lt: t, vx: 0, vy: 0, hit, touch: e.pointerType !== 'mouse', mode: 'press', hist: [[t, e.clientX, e.clientY]] });
    try { wrap.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    turn.v = 0;                                   /* a hand on the coasting plinth stops it */
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
    const dx = e.clientX - ptr.lx;
    ptr.lx = ptr.x = e.clientX; ptr.ly = ptr.y = e.clientY; ptr.lt = now;
    track(now, e.clientX, e.clientY);
    const tdx = ptr.x - ptr.x0, tdy = ptr.y - ptr.y0, moved = Math.hypot(tdx, tdy);
    lastInput = time;
    if (ptr.mode === 'press' && moved > (ptr.touch ? 9 : 4)) {
      if (!ptr.touch || Math.abs(tdx) > Math.abs(tdy) * 1.1) beginTurn();
      else ptr.mode = 'scroll';
    }
    if (ptr.mode === 'turn') turnBy(dx);
    stage.start();
  }
  function onUp(e) {
    if (e.pointerId !== ptr.id) return;
    const tUp = evT(e), mode = ptr.mode, hit = ptr.hit;
    if (e.clientX !== ptr.lx || e.clientY !== ptr.ly) track(tUp, e.clientX, e.clientY);
    const rv = releaseVel(tUp); ptr.vx = rv[0]; ptr.vy = rv[1];
    if (mode === 'press' && hit) {
      if (hit.strip != null) pickStrip(hit.strip);
      else activate(hit.item.name, hit);
    } else if (mode === 'turn') endTurn();
    releasePtr(e);
  }
  function onCancel(e) {
    if (e.pointerId !== ptr.id) return;
    if (ptr.mode === 'turn') { ptr.vx = 0; endTurn(); }
    releasePtr(e);
  }
  function onLeave(e) { if (e.pointerType === 'mouse' && ptr.id === null) { view.parGoal[0] = view.parGoal[1] = 0; setHover(null); } }
  function releasePtr(e) {
    try { wrap.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    ptr.id = null; ptr.mode = null; ptr.hit = null;
    wrap.classList.remove('is-turning');
    lastInput = time; stage.start();
  }
  let hoverRaf = 0, hoverEvt = null;
  function hover(e) {
    if (e.pointerType !== 'mouse') return;
    hoverEvt = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; if (hoverEvt && ptr.id === null) setHover(pick(hoverEvt.clientX, hoverEvt.clientY)); });
  }
  function setHover(h) {
    const strip = h && h.strip != null ? h.strip : -1;
    if (strip !== hoverStrip) { hoverStrip = strip; dirty = true; invalidate(); }
    wrap.classList.toggle('is-point', strip >= 0);
    wrap.classList.toggle('is-hover', !!h && strip < 0);
  }
  /* turning the plinth by hand: 1.6 stage widths of drag for a whole turn */
  const turnK = () => (Math.PI * 2) / (1.6 * Math.max(320, wrap.clientWidth));
  function beginTurn() {
    ptr.mode = 'turn'; turn.goal = null; turn.v = 0; turn.sv = 0;
    wrap.classList.add('is-turning'); wrap.classList.remove('is-hover', 'is-point');
    hideHint();
    if (!view.wide) { view.wide = true; focusView(camGoal); }        /* a close-up gives way to the whole turntable */
  }
  function turnBy(dx) {
    turn.a -= dx * turnK();
    dirty = true; invalidate();
  }
  function endTurn() {
    turn.v = stage.reduced ? 0 : clamp(-ptr.vx * 1000 * turnK(), -7, 7);
    if (Math.abs(turn.v) < 0.15) turn.v = 0;
    lastInput = time;
    emit('dv3d:turn', { angle: +wrapPi(turn.a).toFixed(3) });
  }
  function turnKey(dir) {
    if (!view.wide) { view.wide = true; focusView(camGoal); }
    turnTo((turn.goal != null ? turn.goal : turn.a) - dir * Math.PI / 9, 7);
    emit('dv3d:turn', { angle: +wrapPi(turn.goal != null ? turn.goal : turn.a).toFixed(3) });
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
      } else turnKey(dir);
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
    for (const it of Object.values(items)) if (it.glide) { tweenGlide(it, dt); dirty = true; }
    stepTweens(dt);
    stepTransitions(dt);
    stepPour(dt);
    if (box) stripLift(dt);
    /* visual poses (interpolated between physics steps) */
    for (const it of Object.values(items)) {
      if (!it.visible) continue;
      it.root.position.copy(it.cur.p); it.root.quaternion.copy(it.cur.q);
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
    if (time - lastInput > 24 && ptr.id === null && !tweens.length && !pourBusy() && (items.can.state === 'open' || items.box.state === 'open' || items.box.state === 'fan')) {
      if (items.can.state === 'open') closeCan();
      if (items.box.state === 'open' || items.box.state === 'fan') closeBox();
    }
    /* idle: anything off its place (an interrupted pour) goes home */
    if (time - lastInput > 4.5 && ptr.id === null && !tweens.length && !pourBusy() && !stage.reduced) {
      for (const it of Object.values(items)) if (it.visible && !it.glide && it.state === 'closed' && displaced(it)) glideTo(it, it.home.p, it.home.q);
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
      const apply = () => { layout(false); Object.assign(cam, camGoal); };
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
      view.userEl = 0; view.wide = true; focusView(camGoal);
      turn.a = wrapPi(turn.a); turnTo(0, 3);
      Object.values(items).forEach((it, i) => { if (displaced(it)) { if (stage.reduced) place(it, it.home.p, it.home.q); else glideTo(it, it.home.p, it.home.q, null, i * 0.3); } });
      invalidate();
    },
    stats() {
      return Object.assign({}, stage ? stage.stats : {}, { object: S.object, physics: 'none', turn: +wrapPi(turn.a).toFixed(3), can: items.can && items.can.state, box: items.box && items.box.state,
        calls: post ? post.S.calls : 0, tris: post ? post.S.tris : 0, samples: post ? post.S.samples : 0, steps: buildSteps, programs: R ? R.info.programs.length : 0,
        tier, tierWhy, gated: !!gate, pr: R ? +R.getPixelRatio().toFixed(2) : 0, drawFps: drawn.length, frames: drawCount, dprCap: dprBoost && stage && stage.w * stage.h < 280000 ? Math.max(TC.dpr, dprBoost) : TC.dpr,
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
      pose(name) { const it = items[name]; return it && { p: it.cur.p.toArray().map(v => +v.toFixed(3)), q: it.cur.q.toArray().map(v => +v.toFixed(3)), state: it.state, glide: !!it.glide }; },
      /* the turntable: read, or set at once (tests, recordings); spin(v) sets it coasting */
      turn(a) { if (a != null) { if (!view.wide) { view.wide = true; focusView(camGoal); } turn.a = a; turn.v = 0; turn.goal = null; turn.sv = 0; lastInput = time; dirty = true; invalidate(); } return +turn.a.toFixed(4); },
      spin(v) { turn.v = v; turn.goal = null; lastInput = time; invalidate(); return v; },
      /* checks: every vertex of every visible object, in the world: how far it reaches from the plinth's axis (against the
         plinth's radius) and where it falls on the screen (normalised device coordinates, the frame is -1..1) */
      extent() {
        const out = { plinthR: +plinthR.toFixed(3) }, v = new T.Vector3();
        camera.updateMatrixWorld();
        for (const it of Object.values(items)) {
          if (!it.visible) continue;
          it.root.updateMatrixWorld(true);
          let r = 0, x0 = 9, x1 = -9, y0 = 9, y1 = -9, low = 9;
          it.root.traverse(o => {
            if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
            let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) { vis = false; break; }
            if (!vis) return;
            const P = o.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 1500));
            for (let i = 0; i < P.count; i += step) {
              v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld);
              r = Math.max(r, Math.hypot(v.x, v.z)); low = Math.min(low, v.y);
              v.project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
            }
          });
          out[it.name] = { r: +r.toFixed(3), margin: +(plinthR - r).toFixed(3), low: +(low - S.ph).toFixed(3), ndc: [+x0.toFixed(3), +x1.toFixed(3), +y0.toFixed(3), +y1.toFixed(3)], inFrame: x0 > -1 && x1 < 1 && y0 > -1 && y1 < 1 };
        }
        return out;
      },
      turnState: () => ({ a: +turn.a.toFixed(4), v: +turn.v.toFixed(3), goal: turn.goal, wide: view.wide, focus: view.focus }),
      pourState: () => pour ? { mode: pour.mode, level: +paintLevel.toFixed(3), pouring: pour.pouring, busy: pour.busy, settled: pour.settled, particles: pour.particles, active: pour.fluid ? pour.fluid.active : 0, sleeping: pour.fluid ? pour.fluid.sleeping : null, seq: pourSeq && pourSeq.phase, reset: pourReset } : null,
      resetPour: () => startPourReset(),
      always(on) { forceRender = !!on; },
      idle(sec) { lastInput = quietFrom = time - sec; return true; },
      paint() { const U = paintMat && paintMat.userData.U; return U ? { time: +U.uTime.value.toFixed(2), ripple: (U.uRip ? U.uRip.value : U.uRips.value[0]).toArray().map(v => +v.toFixed(2)), rings: U.uRips.value.filter(v => U.uTime.value - v.z < 7).length, mix: U.uMix.value } : null; },
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
      get pour() { return pour; },
      frameInfo(f) { const pts = finalPoints(f || view.focus); const out = pts.map(p => { const v = p.clone().project(camera); return [+v.x.toFixed(2), +v.y.toFixed(2)]; }); return { goal: Object.assign({}, camGoal), cam: Object.assign({}, cam), view: { focus: view.focus, wide: view.wide, turn: turn.a, userEl: view.userEl }, ndc: out }; }
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
