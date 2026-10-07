/* Dvatone packaging v2: the Designer Box block in 3D. The can and the Designer Box on a plinth coated with the
   composition. The plinth is a turntable (drag sideways to turn it); a tap opens the box on its hinge or pops the can's
   lid off, the paint answers every tap and can be poured out, the colour fan rises from the open box.

   This file is the small entry the page loads with its own <script type="module">; it holds no 3D at all. Everything
   heavy waits until the block comes near the viewport, step by step:
     about 1.5 screens away  the scene module (pack2/scene.js) mounts the block: its poster (a lazy image) and the stage
     about 300 px away       three.js, the scene parts and the studio HDR (the stage's own lazy start in core.js)
     the can first opened    the pour (pour.js, puddle.js; on the high tier the paint solver in a worker)
   There is no physics engine: every motion is scripted.
   Until the scene has mounted, the block shows its poster (loaded lazily by the browser as well).

   DVPack2.mount(el, { object:'can'|'box'|'both', colors:[{hex,share}], theme:'dark'|'light'|'auto',
                       labels:{...}, lang:'uk'|'en', poster:url|false, fan:[{name, colors}], plinth:'coating'|'dark'|colors,
                       hint:true })
     -> { ready, setColors(colors), setObject(name), open(which?), close(which?), pour(), setTheme(t), reset(), stats(),
          destroy() }
     The controller is returned at once (the scene module loads right away for an explicit mount); calls made before
     the scene is there are applied when it is.
   DVPack2.load() -> a promise of the scene module.
   Events on el: dv3d:ready, dv3d:fallback, dv3d:open {object}, dv3d:close {object}, dv3d:pick {name, colors},
   dv3d:pour {state}, dv3d:lid {state}, dv3d:paint, dv3d:turn {angle}.
   Declarative: <div data-dv3d="pack2" data-object="both" data-colors='[...]'></div>
   Keyboard: Tab to the can or the box; Left/Right turn the plinth (or walk the fan strips), Up/Down tilt the view,
   Enter opens, Escape closes, Home turns the front back, P pours. prefers-reduced-motion: static beauty pose, instant
   changes, no coasting. No WebGL2: the poster stays. */
const OBJECTS = ['can', 'box', 'both'];
const BASE = import.meta.url;

let sceneP = null, scene = null;
function load() {
  if (!sceneP) {
    sceneP = import('./pack2/scene.js').then(m => (scene = m));
    sceneP.catch(() => { sceneP = null; });
  }
  return sceneP;
}

function posterUrl(el, opts) {
  if (opts.poster === false) return null;
  if (opts.poster) return opts.poster;
  const o = OBJECTS.includes(opts.object) ? opts.object : 'both';
  const lang = opts.lang || (/^en/i.test(document.documentElement.lang || '') ? 'en' : 'uk');
  return new URL('./pack2/poster-' + o + (lang === 'en' && o !== 'box' ? '-en' : '') + '.webp', BASE).href;
}
/* the poster that holds the place until the scene mounts (the scene then shows the same image from the cache) */
function placeholder(el, opts) {
  const src = posterUrl(el, opts);
  if (!src || el.querySelector('.dvp2-pre')) return;
  const im = document.createElement('img');
  im.className = 'dvp2-pre'; im.alt = ''; im.decoding = 'async'; im.loading = 'lazy'; im.setAttribute('aria-hidden', 'true');
  im.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;pointer-events:none';
  im.src = src;
  el.appendChild(im);
}
function unplace(el) { const im = el.querySelector('.dvp2-pre'); if (im) im.remove(); }
function failed(el, opts, e) {
  placeholder(el, opts);
  const im = el.querySelector('.dvp2-pre'); if (im) im.loading = 'eager';
  el.dispatchEvent(new CustomEvent('dv3d:fallback', { bubbles: true, detail: { reason: 'scene module: ' + ((e && e.message) || e) } }));
}

/* a controller that exists at once; before the scene is there, its calls wait in a queue */
function mount(el, opts = {}) {
  if (typeof el === 'string') el = document.querySelector(el);
  let real = null, dead = false, readyRes;
  const queue = [], ready = new Promise(r => (readyRes = r));
  const early = {
    el,
    get ready() { return real ? real.ready : ready; },
    stats: () => (real ? real.stats() : { buildMs: 0, loading: true }),
    destroy: () => { if (real) real.destroy(); else { dead = true; readyRes(false); } },
    get _debug() { return real ? real._debug : undefined; }
  };
  const ctl = new Proxy(early, {
    get(t, k) {
      if (real) { const v = real[k]; return typeof v === 'function' ? v.bind(real) : v; }
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then') return undefined;
      return (...a) => { queue.push([k, a]); };
    }
  });
  el.dv3d = ctl;
  load().then(m => {
    if (dead) return;
    unplace(el);
    real = m.mount(el, opts);
    queue.splice(0).forEach(([k, a]) => { if (typeof real[k] === 'function') real[k](...a); });
    real.ready.then(readyRes);
  }).catch(e => { if (!dead) { failed(el, opts, e); readyRes(false); } });
  return ctl;
}

function declaredOpts(el) {
  const a = n => el.getAttribute('data-' + n), poster = a('poster');
  return { object: a('object') || 'both', lang: a('lang') || undefined, poster: poster === 'none' ? false : (poster || undefined) };
}
/* a declared block: its poster at once (the browser loads it lazily), the scene module when the block comes within
   about one and a half screens of the viewport; a block in the first screen mounts straight away */
function autoMount() {
  const els = [...document.querySelectorAll('[data-dv3d="pack2"]')].filter(el => !el.dv3d);
  if (!els.length) return;
  const go = el => {
    if (el.dv3d) return;
    el.dv3d = { pending: true };
    load().then(m => { unplace(el); el.dv3d = null; m.mountDeclared(el); }).catch(e => { el.dv3d = null; failed(el, declaredOpts(el), e); });
  };
  els.forEach(el => placeholder(el, declaredOpts(el)));
  if (typeof IntersectionObserver === 'undefined') { els.forEach(go); return; }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { io.unobserve(e.target); go(e.target); }
  }), { rootMargin: '150% 0px' });
  els.forEach(el => io.observe(el));
}

export const DVPack2 = { mount, load, objects: OBJECTS.slice(), get fan() { return scene ? scene.FAN_SET : null; } };
if (typeof window !== 'undefined') window.DVPack2 = DVPack2;
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount); else autoMount();
}
