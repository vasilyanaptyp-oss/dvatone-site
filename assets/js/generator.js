/* DVATONE composition generator: UI, state, preview engine and the try-on in a room. One page (generator.html, UA at the root,
   EN in en/), in the style of the first concept (W5_SPEC section 1, Viktor 07.10). The client's specialist plugs in WITHOUT
   touching this file, see GENERATOR_MODULE.md:

     window.DVATONE.generator.registerEngine('name', { render(canvas, state, opts) {...} })   // replaces the preview painter
     window.DVATONE.generator.registerModule({
       area(state, area)            -> { volume: '4.2', text?: 'optional note' } | Promise   // fills [data-dv-area-result]
       export('passport'|'texture', state, area) -> Promise<{ url, filename }>               // colour passport PDF / 3ds Max texture
     })
   Events on the root [data-dv-generator]:  dvatone:change  dvatone:commit  dvatone:area  dvatone:export (cancelable)  dvatone:recipe (cancelable)
     preventDefault() on dvatone:export: the listener owns that export (module.export is not called) and calls exportDone / exportFail;
     preventDefault() on dvatone:recipe: the listener owns the recipe text (nothing is copied).
   Mount points (data attributes): see the header comment of each block below and GENERATOR_MODULE.md.

   ISOLATION: the composition is only ever drawn into [data-dv-canvas] inside a .gen__mat (opaque neutral grey).
   Nothing on this page may overlap it with transparency, blend modes or filters, and no sky colour reaches it. */
(function () {
  'use strict';
  var NS = (window.DVATONE = window.DVATONE || {});
  var root = document.querySelector('[data-dv-generator]');
  if (!root) return;
  var $ = function (s, r) { return (r || root).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || root).querySelectorAll(s)); };
  var DV = window.DV || {}, G = DV.gen || {}, T = G.t || {}, lang = DV.lang === 'en' ? 'en' : 'uk';
  var MAX = G.max || 6, MIN = G.min || 2, MINSH = 4, PAGE = 24;
  var SYS = { N: 'NCS', F: '5051', R: 'RAL' };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var fmt = function (s, o) { return String(s || '').replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? '' : o[k]; }); };
  var nf = function (n) { try { return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'uk-UA'); } catch (e) { return String(n); } };   // 1 066 / 1,066
  var mq = function (q) { return !!(window.matchMedia && matchMedia(q).matches); };
  var wide = function () { return mq('(min-width:1100px)'); };   // the two-column studio (sticky preview on the left)
  var reduceMotion = function () { return mq('(prefers-reduced-motion:reduce)'); };
  var SHS = NS.strings || {};
  /* strings the page dictionary (window.DV.gen.t) may not carry: the page value wins, except the keys listed in PREFER */
  var L = {
    uk: {
      copiedBtn: 'Скопійовано', copyFail: 'Не вдалося скопіювати автоматично. Виділіть текст і скопіюйте його вручну.',
      lockBase: 'Зафіксувати основний колір', unlockBase: 'Зняти фіксацію', lockOn: 'Основний колір зафіксовано', lockOff: 'Фіксацію знято',
      lockedKeep: 'Основний колір зафіксовано. Зніміть фіксацію, щоб змінити його.',
      areaErr: 'Вкажіть площу числом, більшим за нуль, наприклад 24 або 12,5', areaBig: SHS.areaBig || 'Для площі понад 10 000 м² напишіть нам.',
      areaEstimate: 'Орієнтовно, за базової витрати 200 мл/⁠м². Точний об’єм підтвердимо після вашого запиту.',   // ⁠: the unit never splits after the slash
      areaRequest: 'Надіслати запит на розрахунок', reqArea: 'Прошу розрахувати, скільки покриття потрібно для цієї композиції.',
      exportUnavailable: 'Файли підготуємо за вашим запитом.', exportRequest: 'Надіслати запит на файли',
      reqPassport: 'Прошу підготувати паспорт кольору (PDF) для цієї композиції.', reqTexture: 'Прошу підготувати текстуру у форматі 3ds Max для цієї композиції.',
      presetOn: 'Застосовано поєднання «{name}»', shuffleOn: 'Нове випадкове поєднання', undoHint: 'Попередню композицію можна повернути.', undoDone: 'Попередню композицію повернуто',
      added: '{label}: додано', removed: '{label}: прибрано',
      emptyA: 'Нічого не знайдено. У цьому списку лише відтінки каталогу Dvatone: NCS, 5051 і вибрані RAL. Колекцію DV дивіться ', emptyLink: 'у каталозі',
      titleId: '№ {id}', recipeBase: 'основний', recipeTex: 'Фракція {g} · щільність {d}%', catSwitch: 'Збіги є в категорії «{name}»',
      roomGroups: 'Тип приміщення', roomTabs: 'Приміщення',
      scanColour: 'зі скану', ownColour: 'власний колір'
    },
    en: {
      copiedBtn: 'Copied', copyFail: 'We could not copy automatically. Select the text and copy it by hand.',
      lockBase: 'Lock the base', unlockBase: 'Unlock the base', lockOn: 'Base locked', lockOff: 'Base unlocked',
      lockedKeep: 'The base is locked. Unlock it to change it.',
      areaErr: 'Please enter an area as a number greater than zero, for example 24 or 12.5', areaBig: SHS.areaBig || 'For areas over 10,000 m² please write to us.',
      areaEstimate: 'An estimate at the base rate of 200 ml/⁠m². We will confirm the exact volume after your request.',
      areaRequest: 'Request a calculation', reqArea: 'Please work out how much coating I need for this composition.',
      exportUnavailable: 'We prepare the files on request.', exportRequest: 'Send a request for the files',
      reqPassport: 'Please prepare the colour passport (PDF) for this composition.', reqTexture: 'Please prepare the 3ds Max texture for this composition.',
      presetOn: '“{name}” applied', shuffleOn: 'A new random combination', undoHint: 'You can restore the previous composition.', undoDone: 'Previous composition restored',
      added: '{label}: added', removed: '{label}: removed',
      emptyA: 'Nothing found. This list holds only the Dvatone catalogue shades: NCS, 5051 and selected RAL. The DV collection is ', emptyLink: 'in the catalogue',
      titleId: '#{id}', recipeBase: 'base', recipeTex: 'Granule size {g} · density {d}%', catSwitch: 'Matches are in “{name}”',
      roomGroups: 'Type of space', roomTabs: 'Room',
      scanColour: 'from the scan', ownColour: 'custom colour'
    }
  }[lang];
  var PREFER = { areaErr: 1, areaBig: 1 };
  var tx = function (k) { return (PREFER[k] || T[k] == null || T[k] === '') && L[k] != null ? L[k] : T[k]; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var normQ = function (s) { return String(s || '').toLowerCase().replace(/[\s#\-\u2013\u2014]/g, '').replace(/^ncs(?!s)/, 'ncss'); };   // "NCS 3020-R90B" finds "NCS S 3020-R90B"

  /* ---------- catalogue data ---------- */
  var cat = [], byHex = {};
  (window.DV_CAT || '').split(';').forEach(function (r) {
    var p = r.split('|'); if (p.length < 3) return;
    var it = { sys: p[0], code: p[1], hex: p[2], label: SYS[p[0]] + ' ' + p[1], key: (SYS[p[0]] + p[1] + p[2]).toLowerCase().replace(/[\s#\-]/g, '') };
    cat.push(it); if (!byHex[it.hex]) byHex[it.hex] = it;
  });
  var rgb = function (h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  var hslCache = {};
  function hsl(hex) {   // [hue 0-360, saturation 0-1, lightness 0-1]
    if (hslCache[hex]) return hslCache[hex];
    var c = rgb(hex).map(function (v) { return v / 255; }), mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), l = (mx + mn) / 2, d = mx - mn, h = 0, sat = 0;
    if (d) { sat = d / (1 - Math.abs(2 * l - 1)); h = (mx === c[0] ? ((c[1] - c[2]) / d) % 6 : mx === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4) * 60; if (h < 0) h += 360; }
    return (hslCache[hex] = [h, sat, l]);
  }
  var dist = function (a, b) { var x = rgb(a), y = rgb(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); };
  var labelOf = function (hex) { return byHex[hex] ? byHex[hex].label : '#' + hex; };
  var fillHex = function (hex) {   // slider fill of a colour row: light colours a little darker, so the track reads on the light studio
    var c = rgb(hex), l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11, k = l > 190 ? 0.7 : (l > 150 ? 0.86 : 1);
    return '#' + c.map(function (v) { v = clamp(Math.round(v * k), 0, 255); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  };

  /* ---------- colour categories by saturation (W5_SPEC 1.4) ----------
     The page passes DV.gen.cats = [{ id, name, max }] from config.GEN_CATEGORIES: a shade belongs to the first category whose
     max (an exclusive bound of the CIE LCh chroma C*ab, sRGB D65) is null or greater than its chroma. A hand-made list wins:
     window.DV_CAT_GROUP = { "<sys>|<code>": "<category id>" } (assets/data/gen-categories.js, e.g. { "N|S 3020-Y40R": "c3" }). */
  var CATS = (G.cats && G.cats.length ? G.cats : [{ id: 'c1', name: 'c1', max: 10 }, { id: 'c2', name: 'c2', max: 18 }, { id: 'c3', name: 'c3', max: 30 }, { id: 'c4', name: 'c4', max: null }])
    .map(function (c) { return { id: String(c.id), name: c.name || String(c.id), max: c.max == null ? null : +c.max }; });
  var catById = {}; CATS.forEach(function (c) { catById[c.id] = c; });
  var catHand = window.DV_CAT_GROUP && typeof window.DV_CAT_GROUP === 'object' ? window.DV_CAT_GROUP : {};
  var chromaCache = {};
  function chroma(hex) {
    if (chromaCache[hex] != null) return chromaCache[hex];
    var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var X = (0.4124564 * c[0] + 0.3575761 * c[1] + 0.1804375 * c[2]) / 0.95047, Y = 0.2126729 * c[0] + 0.7151522 * c[1] + 0.0721750 * c[2],
        Z = (0.0193339 * c[0] + 0.1191920 * c[1] + 0.9503041 * c[2]) / 1.08883;
    var f = function (t) { return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116; };
    var a = 500 * (f(X) - f(Y)), b = 200 * (f(Y) - f(Z)); return (chromaCache[hex] = Math.sqrt(a * a + b * b));
  }
  var catOfHex = function (hex) { var cc = chroma(hex); for (var i = 0; i < CATS.length; i++) if (CATS[i].max == null || CATS[i].max > cc) return CATS[i].id; return CATS[CATS.length - 1].id; };
  var catsSorted = false;
  function sortCats() {   // once, in a later task of the start-up (or at the first need)
    if (catsSorted) return; catsSorted = true;
    cat.forEach(function (it) { var h = catHand[it.sys + '|' + it.code]; it.cat = h && catById[h] ? h : catOfHex(it.hex); });
  }
  var catOfColour = function (hex) { sortCats(); return byHex[hex] ? byHex[hex].cat : catOfHex(hex); };

  /* ---------- state ---------- */
  var SHARES = [45, 25, 20, 10];
  var state = { mix: [], grain: 'S', density: 0.9, scale: 'wall', seed: 11, area: '', lock: false };
  var ui = { sel: 0, filter: 'all', q: '', shown: 0, list: cat, cat: CATS[0].id, view: 'wall', dv: '', dvMix: '' };   // view: wall | macro | room (room is not part of the state); dv: the DV composition the catalogue opened (?dv=DV 029) and its mix

  function normList(m) {  // integer shares that always add up to 100 (largest remainder)
    var n = m.length; if (!n) return;
    var sum = 0; m.forEach(function (c) { c.share = Math.max(MINSH, c.share); sum += c.share; });
    var raw = m.map(function (c) { return c.share / sum * 100; }), fl = raw.map(Math.floor), rest = 100 - fl.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (v, i) { return [v - fl[i], i]; }).sort(function (a, b) { return b[0] - a[0]; }).forEach(function (p) { if (rest > 0) { fl[p[1]]++; rest--; } });
    m.forEach(function (c, i) { c.share = fl[i]; });
    for (var g = 0; g < 24; g++) {   // rescaling must never leave a share under the minimum: move the shortfall from the largest share
      var lo = -1, hi = -1; m.forEach(function (c, i) { if (c.share < MINSH && (lo < 0 || c.share < m[lo].share)) lo = i; if (hi < 0 || c.share > m[hi].share) hi = i; });
      if (lo < 0 || lo === hi || m[hi].share <= MINSH) break;
      var need = Math.min(MINSH - m[lo].share, m[hi].share - MINSH); m[lo].share += need; m[hi].share -= need;
    }
  }
  var normalise = function () { normList(state.mix); };
  function startShares(n) {   // the shares a fresh composition of n colours starts with (setMix without shares)
    var m = []; for (var i = 0; i < Math.min(n, MAX); i++) m.push({ share: SHARES[i] || 10 });
    var left = 100 - m.reduce(function (a, c) { return a + c.share; }, 0); if (left && m.length) m[0].share += left;
    normList(m); return m.map(function (c) { return c.share; });
  }
  function setMix(hexes, shares) {
    var st = shares ? null : startShares(hexes.length);
    state.mix = hexes.slice(0, MAX).map(function (h, i) { return { hex: h, share: shares ? shares[i] : st[i] }; });
    normalise(); ui.sel = 0;
  }
  function setShare(i, v) {
    var m = state.mix, n = m.length; if (n < 2) return;
    v = clamp(Math.round(v), MINSH, 100 - MINSH * (n - 1));
    var oth = 0; m.forEach(function (c, k) { if (k !== i) oth += c.share; });
    var rest = 100 - v; m.forEach(function (c, k) { if (k !== i) c.share = oth ? c.share / oth * rest : rest / (n - 1); });
    m[i].share = v; normalise();
  }
  function addColour(hex) {
    var m = state.mix, at = -1; m.forEach(function (c, i) { if (c.hex === hex) at = i; });
    if (at > -1) { ui.sel = at; return 'select'; }
    if (m.length >= MAX) { say(fmt(tx('max'), { max: MAX }), 'warn'); return 'max'; }
    var k = m.length + 1, sh = Math.max(8, Math.round(100 / k));
    m.forEach(function (c) { c.share = c.share * (100 - sh) / 100; });
    m.push({ hex: hex, share: sh }); normalise(); ui.sel = m.length - 1; return 'add';
  }
  function removeColour(i) {
    var m = state.mix; if (m.length <= MIN) { say(tx('min'), 'warn'); return; }
    if (i === 0 && state.lock) { say(tx('lockedKeep'), 'warn'); return; }
    m.splice(i, 1); normalise(); ui.sel = clamp(ui.sel >= i ? ui.sel - 1 : ui.sel, 0, m.length - 1);
  }
  function makeBase(i) {
    if (state.lock) { say(tx('lockedKeep'), 'warn'); return false; }
    var c = state.mix.splice(i, 1)[0]; state.mix.unshift(c); ui.sel = 0; return true;
  }
  var inMix = function (hex) { return state.mix.some(function (c) { return c.hex === hex; }); };

  /* ---------- composition number (same recipe, same number) and title ---------- */
  function compId() {
    var s = state.mix.map(function (c) { return c.hex + c.share; }).join('') + state.grain + Math.round(state.density * 100), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h % 65536).toString(16).toUpperCase().padStart(4, '0');
  }
  var presetShares = (G.presets || []).map(function (p) { return startShares(p.cols.length); });
  function presetIndex() {   // the curated palette this composition is exactly (same colours, same order, its starting shares), or -1
    var ps = G.presets || [];
    for (var k = 0; k < ps.length; k++) {
      var p = ps[k], sh = presetShares[k];
      if (p.cols.length === state.mix.length && p.cols.every(function (h, i) { return state.mix[i].hex === h && state.mix[i].share === sh[i]; })) return k;
    }
    return -1;
  }
  var idMark = function () { return String(tx('titleId')).split('{id}')[0].trim(); };   // "№" / "#"
  /* a DV composition of the catalogue (catalogue.html: «Open in the generator», ?mix=…&dv=DV 029) keeps its code as the title while
     its mix is unchanged; DV.gen.dv names it (the client's names only, nothing invented) */
  var mixSig = function () { return state.mix.map(function (c) { return c.hex + ':' + c.share; }).join(','); };
  var dvShown = function () { return !!ui.dv && ui.dvMix === mixSig(); };
  var dvName = function () { var n = (G.dv || DV.dv || {})[ui.dv]; return n ? String(n) : ''; };
  var titleText = function (id, pk) { return dvShown() ? ui.dv + (dvName() ? ' ' + dvName() : '') : pk > -1 ? G.presets[pk].name : fmt(tx('titleId'), { id: id }); };
  var titleHTML = function (id, pk) { return dvShown() ? esc(ui.dv) : pk > -1 ? esc(G.presets[pk].name) : '<span class="phead__no">' + esc(idMark()) + '</span>' + id; };
  var plural = function (n) {
    if (lang === 'en') return n === 1 ? T.shade1 : T.shade5;
    var a = n % 10, b = n % 100; return (a === 1 && b !== 11) ? T.shade1 : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? T.shade2 : T.shade5;
  };
  var recipeText = function () {
    return fmt(T.previewTitle, { id: compId() }) + '\n' + state.mix.map(function (c) { return labelOf(c.hex) + ' · #' + c.hex + ' · ' + c.share + '%'; }).join('\n') + '\n' +
      T.fraction + ' ' + state.grain + ' · ' + T.density + ' ' + Math.round(state.density * 100) + '%' + (state.area ? '\n' + T.areaLabel + ': ' + state.area + ' ' + T.areaUnit : '');
  };

  /* ---------- events ---------- */
  var CANCELABLE = { 'dvatone:export': 1, 'dvatone:recipe': 1 };   // preventDefault() hands the action to the listener (doExport, the recipe button)
  function emit(name, detail) {
    var ev = new CustomEvent(name, { bubbles: true, cancelable: !!CANCELABLE[name], detail: detail });
    root.dispatchEvent(ev); return ev;
  }
  var copyState = function () { return JSON.parse(JSON.stringify(state)); };
  var commitT = 0, dirty = false;   // dirty: the composition was edited by hand since the last preset / random / reset
  function changed(cause) {
    resetExport();
    if (cause !== 'area' && cause !== 'preset' && cause !== 'shuffle' && cause !== 'reset') { dirty = cause !== 'undo' && cause !== 'external'; clearUndo(); }
    emit('dvatone:change', { state: copyState(), cause: cause });
    clearTimeout(commitT); commitT = setTimeout(function () { emit('dvatone:commit', { state: copyState(), cause: cause }); roomUpdate(); }, 190);
  }

  /* ---------- preview engine (default; replaceable via registerEngine) ----------
     Wave 6 (07.10): the default engine paints with the fleck structure of a real scan (assets/js/dv-coat.js, the rank map the room
     view uses): the shares are the areas, the flecks have the size and grouping of the material, matte, no bright specks. While
     that structure loads, the canvas shows the composition's average colour (coat.interim) and is painted again when it is
     there. The procedural granules below are only the last resort, for a page without dv-coat.js. */
  var mulberry = function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  var shade = function (c, k) { return 'rgb(' + c.map(function (v) { return clamp(Math.round(v * k), 0, 255); }).join(',') + ')'; };
  var GR = { S: 1, M: 1.8, XL: 3.2 };   // fraction multipliers: the product line is very fine, so S is the default
  var coatWait = false;
  /* Performance (07.10): a picture of the default composition rendered with this very engine ([data-dv-poster], AVIF / WebP)
     holds the first paint, and the engine with its fleck map starts at idle (the map is decoded in a worker, dv-coat.js). The
     picture goes as soon as the canvas shows the live engine or any other composition. */
  var poster = $('[data-dv-poster]'), posterSig = '';
  var sigOf = function (st) { return st.mix.map(function (c) { return c.hex + ':' + c.share; }).join(',') + '|' + st.grain + '|' + Math.round(st.density * 100) + '|' + st.scale + '|' + st.seed; };
  function dropPoster() { if (!poster) return; var p0 = poster; poster = null; p0.classList.add('is-gone'); setTimeout(function () { if (p0.parentNode) p0.parentNode.removeChild(p0); }, 450); }
  var defaultEngine = {
    label: 'scan fleck structure',
    render: function (canvas, st, opts) {
      opts = opts || {};
      var coat = NS.coat;
      if (coat) {
        if (poster && !coat.ready() && sigOf(st) === posterSig) return;   // the picture shows exactly this already
        var done = coat.render(canvas, st, { draft: opts.draft, onReady: function () { coatWait = false; paint(); } });
        dropPoster();
        if (done) return;
        coatWait = true; coat.interim(canvas, st); return;
      }
      var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, k = W / 1280;   // granule sizes scale with the canvas: the picture is the same at any backing size
      var cols = st.mix.map(function (c) { var r = rgb(c.hex); return [shade(r, .96), shade(r, 1), shade(r, 1.02)]; });   // matte: no brighter speck than the colour itself (wave 6)
      var cum = [], acc = 0; st.mix.forEach(function (c) { acc += c.share; cum.push(acc); });
      var macro = st.scale === 'macro', gm = (GR[st.grain] || 1) * (macro ? 2.5 : 1) * (opts.draft ? 1.6 : 1);   // draft (slider drag): larger grains, so 2.5x fewer of them cover the same area
      var s0 = 2.2 * gm * k, s1 = 5.2 * gm * k;
      var rnd = mulberry(st.seed * 7919 + 13);
      ctx.fillStyle = shade(rgb(st.mix[0].hex), 1); ctx.fillRect(0, 0, W, H);
      var n = Math.round(W * H / (s0 * s1 * 1.9) * (0.35 + 0.8 * st.density));
      for (var i = 0; i < n; i++) {
        var r = rnd() * 100, c = 0; while (c < cum.length - 1 && r > cum[c]) c++;
        var s = s0 + rnd() * (s1 - s0), x = rnd() * W, y = rnd() * H, v = (rnd() * 3) | 0, rot = rnd() * 3.14, sq = .4 + rnd() * .2, sy = .7 + rnd() * .5;
        ctx.fillStyle = cols[c][v];
        if (s > 5 * k) { ctx.beginPath(); ctx.ellipse(x, y, s * .55, s * sq, rot, 0, 6.2832); ctx.fill(); } else ctx.fillRect(x, y, s, s * sy);
      }
    }
  };
  var engines = { stub: defaultEngine }, engine = defaultEngine;

  /* ---------- paint ----------
     The canvas backing store follows the preview frame (devicePixelRatio up to 1.5, at most 2400 px wide; a resize redraws after
     150 ms of calm), and CSS covers the frame with it. While the room view is shown the hidden canvas is not redrawn: it is
     brought up to date when a texture view comes back or an image is saved. */
  var canvases = $$('[data-dv-canvas]'), paintRaf = 0, paintDraft = false, idleT = 0, draftCv = document.createElement('canvas'), painted = false, texStale = false;
  function sizeCanvases() {
    var any = false;
    canvases.forEach(function (cv) {
      var host = cv.closest('.view__frame') || cv.parentNode, r = host.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      var w = Math.min(2400, Math.round(r.width * Math.min(window.devicePixelRatio || 1, 1.5))), h = Math.max(1, Math.round(w * r.height / r.width));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; any = true; }
    });
    return any;
  }
  function drawOne(cv, draft) {
    if (draft && engine === defaultEngine) {   // slider drag: a quarter of the pixels, scaled up; the full render follows when the hand stops
      var w = Math.round(cv.width / 2), h = Math.round(cv.height / 2);
      if (draftCv.width !== w || draftCv.height !== h) { draftCv.width = w; draftCv.height = h; }
      defaultEngine.render(draftCv, state, { draft: true });
      var c2 = cv.getContext('2d'); c2.imageSmoothingEnabled = true; c2.drawImage(draftCv, 0, 0, cv.width, cv.height);
      return;
    }
    try { engine.render(cv, state, { draft: false }); } catch (e) { engines.stub.render(cv, state, {}); }
  }
  function paint(draft) {
    clearTimeout(idleT);
    if (painted && ui.view === 'room') { texStale = true; paintDraft = false; return; }   // hidden: catch up when it shows
    if (draft === true) { paintDraft = true; idleT = setTimeout(function () { paint(false); }, 220); } else paintDraft = false;
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(function () {
      paintRaf = 0;
      canvases.forEach(function (cv) {
        drawOne(cv, paintDraft);
        cv.setAttribute('aria-label', (T.alt || '') + '. ' + fmt(T.previewTitle, { id: compId() }) + '.');
      });
      if (!paintDraft) texStale = false;
      painted = true;
      root.setAttribute('data-dv-ready', 'true');
    });
  }

  /* ---------- render UI ---------- */
  var mixEl = $('[data-dv-mix]');
  var fill = function (v) { return Math.max(0, Math.min(100, (v - MINSH) / Math.max(1, 100 - MINSH * state.mix.length) * 100)); };
  var ico = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 6.9-.8"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/></svg>'
  };
  /* one colour row of the concept: a 44 px swatch, code and role, the share as a big thin figure, the round icon buttons
     (lock on the base, "make it the base" on an accent, remove) and the thin slider under them */
  function rowHTML(c, i) {
    var lab = labelOf(c.hex), base = i === 0, mx = 100 - MINSH * (state.mix.length - 1);
    var own = !byHex[c.hex] ? (ui.dv ? tx('scanColour') : tx('ownColour')) : '#' + c.hex;   // a colour that is not a catalogue shade: say where it comes from, not its hex twice
    var role = base ? T.base + ' · ' + (state.lock && T.locked ? T.locked : own) : T.accent + ' · ' + own;
    var act = base
      ? '<button type="button" class="icob" data-act="lock" aria-pressed="' + !!state.lock + '" aria-label="' + esc(tx('lockBase') + ': ' + lab) + '" title="' + esc(state.lock ? tx('unlockBase') : tx('lockBase')) + '">' + (state.lock ? ico.lock : ico.unlock) + '</button>'
      : '<button type="button" class="icob" data-act="base" aria-label="' + esc(T.makeBase + ': ' + lab) + '" title="' + esc(T.makeBase) + '">' + ico.pin + '</button>';
    act += '<button type="button" class="icob" data-act="remove" aria-label="' + esc(T.remove + ': ' + lab) + '" title="' + esc(T.remove) + '">' + ico.x + '</button>';
    return '<li class="gmx__row' + (base && state.lock ? ' is-locked' : '') + '" data-i="' + i + '" style="--c:#' + c.hex + ';--c-d:' + fillHex(c.hex) + '">' +
      '<span class="gmx__sw" aria-hidden="true"></span>' +
      '<div class="gmx__name"><b>' + esc(lab) + '</b><small>' + esc(role) + '</small></div>' +
      '<output class="gmx__pct"><span>' + c.share + '</span><sup>%</sup></output>' +
      '<span class="gmx__act">' + act + '</span>' +
      '<input type="range" class="srange gmx__rng" min="' + MINSH + '" max="' + mx + '" step="1" value="' + c.share + '" aria-label="' + esc(T.share + ': ' + lab) + '" aria-valuetext="' + c.share + ' %" style="--v:' + fill(c.share) + '%">' +
      '</li>';
  }
  function renderMix(keepFocus) {
    if (mixEl) {
      var f = document.activeElement, row = f && f.closest ? f.closest('.gmx__row') : null, fi = row ? row.getAttribute('data-i') : null,
          ft = f && f.tagName === 'INPUT' ? 'range' : (f && f.getAttribute && f.getAttribute('data-act'));
      mixEl.innerHTML = state.mix.map(rowHTML).join('');
      if (keepFocus && fi != null) { var r = $('.gmx__row[data-i="' + fi + '"] ' + (ft === 'range' ? 'input' : '[data-act="' + ft + '"]'), mixEl); if (r) r.focus(); }
    }
    $$('.res', res || root).forEach(function (b) { b.setAttribute('aria-pressed', inMix(b.getAttribute('data-hex')) ? 'true' : 'false'); });
  }
  function syncMix() {   // numbers and fills in place, so a slider that is being dragged is never rebuilt
    $$('.gmx__row', mixEl || root).forEach(function (li) {
      var i = +li.getAttribute('data-i'), c = state.mix[i]; if (!c) return;
      var o = $('.gmx__pct span', li); if (o) o.textContent = c.share;
      var r = $('.gmx__rng', li); if (r) { if (+r.value !== c.share) r.value = c.share; r.style.setProperty('--v', fill(c.share) + '%'); r.setAttribute('max', 100 - MINSH * (state.mix.length - 1)); r.setAttribute('aria-valuetext', c.share + ' %'); }
    });
  }
  function renderRatio() {   // the proportion strip under the preview: one bar per colour, as wide as its share
    $$('[data-dv-ratio]').forEach(function (el) {
      var bars = el.children;
      if (bars.length !== state.mix.length) { el.innerHTML = state.mix.map(function (c) { return '<i style="flex-grow:' + c.share + ';background:#' + c.hex + '"></i>'; }).join(''); return; }
      state.mix.forEach(function (c, i) { bars[i].style.flexGrow = c.share; bars[i].style.background = '#' + c.hex; });
    });
  }
  function renderRecipe(id) {
    $$('[data-dv-recipe]').forEach(function (el) {
      el.innerHTML = state.mix.map(function (c, i) {
        return '<li><i style="background:#' + c.hex + '"></i><span class="c">' + esc(labelOf(c.hex)) + (i === 0 ? '<small>' + esc(tx('recipeBase')) + '</small>' : '') + '</span><span class="f"></span><b>' + c.share + '%</b></li>';
      }).join('');
    });
    $$('[data-dv-recipe-tex]').forEach(function (e) { e.textContent = fmt(tx('recipeTex'), { g: state.grain, d: Math.round(state.density * 100) }); });
    $$('[data-dv-recipe-id]').forEach(function (e) { e.textContent = fmt(tx('titleId'), { id: id }); });
  }
  function renderMeta() {
    var id = compId(), pk = presetIndex(), d = Math.round(state.density * 100);
    $$('[data-dv-id]').forEach(function (e) { e.textContent = id; });
    $$('[data-dv-title]').forEach(function (e) { e.innerHTML = titleHTML(id, pk); });
    var dvn = dvShown() ? dvName() : '';
    $$('[data-dv-sub]').forEach(function (e) { e.textContent = (dvn ? dvn + ' · ' : '') + fmt(T.previewSub, { n: state.mix.length, shades: plural(state.mix.length), fraction: state.grain, density: d }); });
    $$('[data-dv-grain]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dv-grain') === state.grain ? 'true' : 'false'); });
    $$('[data-dv-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dv-view') === ui.view ? 'true' : 'false'); });
    $$('[data-dv-density]').forEach(function (r) { r.value = d; r.style.setProperty('--v', ((d - 40) / 60 * 100) + '%'); r.setAttribute('aria-valuetext', d + ' %'); });
    $$('[data-dv-density-out]').forEach(function (e) { e.textContent = d + '%'; });
    $$('[data-dv-presets] [data-preset]').forEach(function (b) { b.setAttribute('aria-pressed', +b.getAttribute('data-preset') === pk ? 'true' : 'false'); });
    $$('[data-dv-count]').forEach(function (e) { e.textContent = fmt(T.count, { n: state.mix.length, max: MAX }); e.classList.toggle('is-max', state.mix.length >= MAX); });
    $$('[data-dv-add]').forEach(function (b) { b.setAttribute('aria-disabled', state.mix.length >= MAX ? 'true' : 'false'); });
    renderRatio(); renderRecipe(id);
    updateExportState();
  }
  function renderAll(keepFocus) { renderMix(keepFocus); renderMeta(); paint(); }

  /* ---------- catalogue shades inside the generator: category, standard and search combine (AND) ---------- */
  var res = $('[data-dv-results]');
  function curate(list) {   // default order: a few neutrals first, then every hue in turn (the catalogue itself starts with 60 pinks)
    var neutrals = [], buckets = [], i;
    for (i = 0; i < 12; i++) buckets.push([]);
    list.forEach(function (it) { var h = hsl(it.hex); if (h[1] < 0.14) neutrals.push(it); else buckets[Math.floor(h[0] / 30) % 12].push(it); });
    neutrals.sort(function (a, b) { return hsl(b.hex)[2] - hsl(a.hex)[2]; });
    var head = [], step = neutrals.length / 12;
    if (neutrals.length <= 12) head = neutrals.slice(); else for (i = 0; i < 12; i++) head.push(neutrals[Math.floor(i * step)]);
    var score = function (it) { var h = hsl(it.hex); return Math.abs(h[1] - 0.28) + Math.abs(h[2] - 0.6) * 0.6; };
    buckets.forEach(function (b) { b.sort(function (a, c) { return score(a) - score(c); }); });
    var out = head.slice(), more = true, k = 0;
    while (more) { more = false; for (i = 0; i < 12; i++) if (buckets[i][k]) { out.push(buckets[i][k]); more = true; } k++; }
    var seen = {}; head.forEach(function (it) { seen[it.hex + it.code] = 1; });
    neutrals.forEach(function (it) { if (!seen[it.hex + it.code]) out.push(it); });
    return out;
  }
  function renderCats(counts) {
    $$('[data-dv-cat]').forEach(function (b) {
      var id = b.getAttribute('data-dv-cat'), n = $('[data-dv-cat-n]', b);
      b.setAttribute('aria-pressed', id === ui.cat ? 'true' : 'false');
      if (n) n.textContent = nf(counts[id] || 0);
    });
  }
  /* auto: a new search or standard may move to another category: if the pressed one has no match while another has, the first
     category with matches is pressed and the live region says so (a pressed category is never changed behind a hand-made choice) */
  function applySearch(auto) {
    sortCats();
    var nq = normQ(ui.q), counts = {}, first = null;
    CATS.forEach(function (c) { counts[c.id] = 0; });
    var base = cat.filter(function (it) { return (ui.filter === 'all' || SYS[it.sys].toLowerCase() === ui.filter) && (!nq || it.key.indexOf(nq) > -1); });
    base.forEach(function (it) { counts[it.cat] = (counts[it.cat] || 0) + 1; });
    CATS.forEach(function (c) { if (!first && counts[c.id]) first = c; });
    if (auto && !counts[ui.cat] && first) { ui.cat = first.id; announce(fmt(tx('catSwitch'), { name: first.name })); }
    renderCats(counts);
    ui.list = base.filter(function (it) { return it.cat === ui.cat; });
    if (!nq) ui.list = curate(ui.list);
    ui.shown = 0; if (res) res.innerHTML = ''; pageResults();
    var em = $('[data-dv-empty]');
    if (em) {
      em.hidden = !!ui.list.length;
      if (!ui.list.length) {
        if (first) em.textContent = fmt(tx('catSwitch'), { name: first.name }) + '.';   // this category is empty for the query, another one is not
        else em.innerHTML = esc(tx('emptyA')) + '<a href="catalogue.html' + (/^\s*dv/i.test(ui.q) ? '?q=' + encodeURIComponent(ui.q) : '') + '#dv">' + esc(tx('emptyLink')) + '</a>.';
      }
    }
  }
  function markUp(code) {   // the typed part of the code in bold (the concept's <mark>)
    var q = String(ui.q || '').trim().toUpperCase().replace(/^(NCS|RAL|5051)\s*/, ''); if (q.length < 2) return esc(code);
    var ix = code.toUpperCase().indexOf(q); if (ix < 0) return esc(code);
    return esc(code.slice(0, ix)) + '<mark>' + esc(code.slice(ix, ix + q.length)) + '</mark>' + esc(code.slice(ix + q.length));
  }
  function pageResults() {
    if (!res) return;
    var end = Math.min(ui.list.length, ui.shown + PAGE), h = '';
    for (var i = ui.shown; i < end; i++) {
      var it = ui.list[i];
      h += '<button type="button" class="res" data-hex="' + it.hex + '" data-label="' + esc(it.label) + '" aria-pressed="' + inMix(it.hex) + '" aria-label="' + esc(it.label) + '" title="#' + it.hex + '">' +
        '<i style="background:#' + it.hex + '"></i><span>' + markUp(it.code) + '</span><small>' + SYS[it.sys] + '</small></button>';
    }
    res.insertAdjacentHTML('beforeend', h); ui.shown = end;
    var more = $('[data-dv-more]'); if (more) more.hidden = ui.shown >= ui.list.length;
    var cn = $('[data-dv-found]'); if (cn) cn.textContent = ui.list.length ? fmt(T.found, { n: nf(ui.shown), total: nf(ui.list.length) }) : '';
  }

  /* ---------- toast / live region ---------- */
  var live = $('[data-dv-live]');
  function announce(msg) { if (!live) return; live.textContent = msg; clearTimeout(announce._t); announce._t = setTimeout(function () { live.textContent = ''; }, 3200); }
  function say(msg, kind, ms) {   // screen readers get the sr-only live region, everyone else the visible toast (NS.toast from site.js)
    announce(msg); if (NS.toast) NS.toast(msg, { kind: kind, ms: ms });
  }
  function copy(text, ok, btn) {   // success only when the browser confirms it; otherwise a selectable copy of the text
    (NS.copyText ? NS.copyText(text) : Promise.resolve(false)).then(function (done) {
      if (done) { say(ok); if (btn && NS.flashLabel) NS.flashLabel(btn, tx('copiedBtn')); }
      else { announce(tx('copyFail')); if (NS.toast) NS.toast(tx('copyFail'), { kind: 'warn', copyText: text }); }
    });
  }

  /* ---------- area + export (mount points for the client's module) ---------- */
  var mod = null;
  var areaIn = $('[data-dv-area]'), areaErr = $('[data-dv-area-err]'), areaRes = $('[data-dv-area-result]');
  var parseArea = function (v) { return NS.parseArea ? NS.parseArea(v) : { n: null, err: '' }; };
  var areaNum = function () { return parseArea(state.area).n; };
  var noteDefault = areaRes ? ($('[data-dv-area-note]', areaRes) || {}).textContent : '';
  function resetExport() {   // an error / "unavailable" / "done" line belongs to the values it was asked for: clear it when they change
    var st = $('[data-dv-export-status]'), cur = st && st.getAttribute('data-state');
    if (!st || !cur || cur === 'idle' || cur === 'preparing') return;
    ['passport', 'texture'].forEach(function (k) { exportStatus(k, 'idle'); });
  }
  function updateExportState() {
    var ok = state.mix.length >= MIN && areaNum() != null, st = $('[data-dv-export-status]');
    $$('[data-dv-export]').forEach(function (b) { b.setAttribute('aria-disabled', ok ? 'false' : 'true'); });
    if (st && (!st.getAttribute('data-state') || st.getAttribute('data-state') === 'idle')) st.textContent = ok ? '' : (T.exportOff || '');
    root.setAttribute('data-has-area', areaNum() != null ? 'true' : 'false');
  }
  function runArea() {
    var pa = parseArea(state.area), a = pa.n;
    resetExport();
    if (areaIn) {
      var bad = !!String(state.area).trim() && a == null;
      if (areaErr) {
        areaErr.hidden = !bad; areaErr.textContent = pa.err === 'big' ? tx('areaBig') : tx('areaErr');
        if (bad && pa.err === 'big') {   // "write to us" for a large area: a link that carries the area and the recipe (laid out like the request link under the files)
          var rq = requestLink('quantity', tx('reqArea'), tx('areaRequest'));
          rq.style.cssText = 'display:flex;width:max-content;max-width:100%;margin-top:10px';
          areaErr.appendChild(document.createTextNode(' ')); areaErr.appendChild(rq);
        }
      }
      areaIn.setAttribute('aria-invalid', bad ? 'true' : 'false');
    }
    var vEl = areaRes && $('[data-dv-area-volume]', areaRes), vBox = vEl && vEl.parentNode, nEl = areaRes && $('[data-dv-area-note]', areaRes);
    if (areaRes) {
      areaRes.setAttribute('data-state', a == null ? 'empty' : 'filled');
      if (a == null) { if (vBox) vBox.style.display = ''; if (vEl) vEl.textContent = '0'; if (nEl) nEl.textContent = noteDefault; }
      else if (!(mod && mod.area)) {   // no module attached yet: an estimate from the published base rate (200 ml/m², rounded up to 0.1 L), marked as such; the module's figure replaces it
        if (vBox) vBox.style.display = ''; if (vEl) vEl.textContent = nf(Math.ceil(a * 2 - 1e-9) / 10); if (nEl) nEl.textContent = tx('areaEstimate');
      }
      else if (vBox) vBox.style.display = '';
    }
    emit('dvatone:area', { area: a, state: copyState() });
    if (mod && mod.area && a != null) {
      Promise.resolve().then(function () { return mod.area(copyState(), a); }).then(function (r) { if (r) NS.generator.setAreaResult(r); }, function () { NS.generator.setAreaResult(null, T.areaError); });
    }
    updateExportState();
  }
  /* the way forward wherever the page says "on request" or "write to us": the contact form, with the request and the recipe
     in the query (contacts.html?topic=&msg=, a relative link, so it works from / and /en/) */
  function requestLink(topic, ask, label) {
    var ln = document.createElement('a'), sp = document.createElement('span');
    var mk = function () { ln.href = 'contacts.html?topic=' + topic + '&msg=' + encodeURIComponent(ask + '\n\n' + recipeText()); };
    ln.className = 'link-arrow'; mk();
    ['pointerdown', 'focus', 'click'].forEach(function (n) { ln.addEventListener(n, mk); });   // the recipe as it is when the link is used, not when it appeared
    sp.textContent = label; ln.appendChild(sp); ln.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>');
    return ln;
  }
  function exportStatus(kind, st, msg) {
    $$('[data-dv-export="' + kind + '"]').forEach(function (b) { b.setAttribute('data-state', st); });
    var s = $('[data-dv-export-status]'); if (!s) return;
    s.setAttribute('data-state', st);
    if (st === 'idle') { updateExportState(); return; }
    s.textContent = msg || '';
    if (st === 'unavailable' || st === 'error') {   // files on request, or a file that failed: a request for this file, with the recipe
      s.appendChild(document.createTextNode(' '));
      s.appendChild(requestLink(kind === 'texture' ? 'other' : 'quantity', tx(kind === 'texture' ? 'reqTexture' : 'reqPassport'), tx('exportRequest')));
    }
  }
  var settled = {};   // exportDone / exportFail calls per kind: tells doExport whether a listener settled its export inside the event
  function doExport(kind) {
    var b = $('[data-dv-export="' + kind + '"]');
    if (!b || b.getAttribute('aria-disabled') === 'true') { exportStatus(kind, 'idle', T.exportOff); say(T.exportOff); return; }
    /* preventDefault() is the one switch: a listener that calls it owns this export (module.export is not called) and reports
       through exportDone / exportFail; otherwise the module exports, and without a module the line says the files come on request */
    var detail = { kind: kind, state: copyState(), area: areaNum() }, n0 = settled[kind] || 0, ev = emit('dvatone:export', detail);
    if (ev.defaultPrevented) {
      if ((settled[kind] || 0) === n0) exportStatus(kind, 'preparing', T.exportPreparing);   // unless the listener already settled it inside the event
    } else if (mod && mod.export) {
      exportStatus(kind, 'preparing', T.exportPreparing);
      Promise.resolve().then(function () { return mod.export(kind, detail.state, detail.area); }).then(function (r) { NS.generator.exportDone(kind, r); }, function () { NS.generator.exportFail(kind); });
    } else {
      exportStatus(kind, 'unavailable', tx('exportUnavailable'));   // no module attached yet: a neutral, honest line (no fake "preparing", no red error) and the request link
    }
  }

  /* ---------- public interface ---------- */
  NS.generator = {
    root: root, version: 1,
    getState: copyState,
    setState: function (partial, opts) {
      partial = partial || {};
      if (partial.mix) {   // entries whose hex is not six hex digits are left out (they would reach the markup)
        var mm = partial.mix.map(function (c) { return { hex: String(c && c.hex).replace('#', '').toUpperCase(), share: +(c && c.share) || 10 }; }).filter(function (c) { return /^[0-9A-F]{6}$/.test(c.hex); });
        if (mm.length) { state.mix = mm.slice(0, MAX); normalise(); ui.sel = 0; }
      }
      if (GR[partial.grain]) state.grain = partial.grain;
      if (partial.scale === 'wall' || partial.scale === 'macro') state.scale = partial.scale;
      if (partial.lock != null) state.lock = !!partial.lock;
      if (partial.density != null) state.density = clamp(+partial.density, 0.4, 1);
      if (partial.seed != null) state.seed = +partial.seed | 0;
      if (partial.area != null) { state.area = String(partial.area); if (areaIn) areaIn.value = state.area; runArea(); }
      viewFollowsScale(); renderAll(); changed((opts && opts.cause) || 'external');
    },
    on: function (name, fn) { root.addEventListener(name, function (e) { fn(e.detail, e); }); },
    registerEngine: function (name, eng) { if (!eng || typeof eng.render !== 'function') return; engines[name] = eng; engine = eng; paint(); },
    useEngine: function (name) { if (engines[name]) { engine = engines[name]; paint(); } },
    registerModule: function (m) { mod = m || null; root.setAttribute('data-dv-module', mod ? 'attached' : 'none'); runArea(); },
    setAreaResult: function (r, errText) {
      if (!areaRes) return;
      var v = $('[data-dv-area-volume]', areaRes), n = $('[data-dv-area-note]', areaRes);
      if (v && v.parentNode) v.parentNode.style.display = '';
      if (!r) { areaRes.setAttribute('data-state', 'error'); if (n) n.textContent = errText || T.areaError; return; }
      areaRes.setAttribute('data-state', 'done'); if (v) v.textContent = r.volume != null ? r.volume : '0'; if (n) n.textContent = r.text || '';
    },
    exportDone: function (kind, r) {
      settled[kind] = (settled[kind] || 0) + 1;
      exportStatus(kind, 'done', T.exportDone);
      if (r && r.url) { var a = document.createElement('a'); a.href = r.url; a.download = r.filename || ''; document.body.appendChild(a); a.click(); a.remove(); }
    },
    exportFail: function (kind) { settled[kind] = (settled[kind] || 0) + 1; exportStatus(kind, 'error', T.exportError); },
    recipe: recipeText
  };
  root.setAttribute('data-dv-module', 'none');

  /* ---------- helpers for wiring ---------- */
  function focusAct(act, idx) {   // keep keyboard focus on the list after a row is removed or moved
    var el = $('[data-dv-mix] .gmx__row[data-i="' + idx + '"] [data-act="' + act + '"]') || $('[data-dv-mix] .gmx__row [data-act]');
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  }
  function lockedCols(cols) {   // a locked base survives presets: it stays first, the accents come from the preset
    var b = state.mix[0].hex;
    return [b].concat(cols.filter(function (h) { return h !== b; }).slice(0, Math.max(MIN, cols.length) - 1));
  }
  function randomMix() {   // analogous mixes: neutrals and hues close to the base, never a rainbow; honours a locked base
    var n = 3 + Math.floor(Math.random() * 2), base, tries = 0, it, h;
    if (state.lock && state.mix.length) base = state.mix[0].hex;
    else { do { it = cat[Math.floor(Math.random() * cat.length)]; h = hsl(it.hex); } while (h[1] > 0.55 && ++tries < 60); base = it.hex; }
    var bh = hsl(base), fh = bh[1] < 0.14 ? Math.random() * 360 : bh[0], out = [base];
    [[35, 48], [60, 40], [90, 30]].forEach(function (tier) {   // widen the hue window and relax the spacing only when the base sits in a sparse part of the catalogue
      var k = 0;
      while (out.length < n && k++ < 400) {
        var c = cat[Math.floor(Math.random() * cat.length)], ch = hsl(c.hex), dh = Math.abs(ch[0] - fh); dh = Math.min(dh, 360 - dh);
        if (!(ch[1] < 0.14 || dh <= tier[0])) continue;
        if (bh[1] < 0.14 && ch[1] > 0.45) continue;
        if (out.some(function (x) { return dist(x, c.hex) < tier[1]; })) continue;
        out.push(c.hex);
      }
    });
    while (out.length < MIN) out.push(cat[Math.floor(Math.random() * cat.length)].hex);
    return out;
  }
  function viewFollowsScale() { if (ui.view !== 'room' && ui.view !== state.scale) setView(state.scale, { quiet: true }); }
  /* one step back after a preset, "random" or "reset" replaced the composition ([data-dv-undo] next to them); any later edit drops it */
  var undoSnap = null, undoBtns = $$('[data-dv-undo]');
  function clearUndo() { undoSnap = null; (undoBtns || []).forEach(function (b) { b.hidden = true; }); }
  function offerUndo(before, msg) {   // before: { st, sel } taken just before the replacement; msg: what to say (empty: nothing)
    var a = before.st, same = a.grain === state.grain && a.density === state.density && a.scale === state.scale && a.seed === state.seed && a.lock === state.lock &&
      a.mix.length === state.mix.length && a.mix.every(function (c, k) { return c.hex === state.mix[k].hex && c.share === state.mix[k].share; });
    undoSnap = same ? null : before;
    undoBtns.forEach(function (b) { b.hidden = !undoSnap; });
    if (msg) say(undoSnap ? msg.replace(/\.?$/, '.') + ' ' + tx('undoHint') : msg, null, undoSnap ? 4200 : 0);
  }
  function undo(btn) {
    if (!undoSnap) return;
    var u = undoSnap.st, wasFocus = btn && document.activeElement === btn;
    state.mix = u.mix; state.grain = u.grain; state.density = u.density; state.scale = u.scale; state.seed = u.seed; state.lock = u.lock;
    ui.sel = clamp(undoSnap.sel, 0, state.mix.length - 1);
    viewFollowsScale(); renderAll(); changed('undo'); dirty = true; say(tx('undoDone'));
    if (wasFocus) { var f = btn.parentNode && btn.parentNode.querySelector('[data-dv-random]'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } } }   // the button hides: keep focus nearby
  }
  /* "Add a colour": bring the catalogue shades into view (under the header, or under the pinned preview on phones) and, with a
     mouse, put the cursor in the search field */
  function revealFinder() {
    var find = document.getElementById('dvFind'); if (!find) return;
    var hdr = document.getElementById('hdr'), off = hdr ? Math.max(0, hdr.getBoundingClientRect().bottom) : 76, cs = prevEl ? getComputedStyle(prevEl) : null;
    if (prevEl && cs && /sticky/.test(cs.position) && !wide()) off = (parseFloat(cs.top) || 0) + (prevEl.classList.contains('is-collapsed') ? 56 : prevEl.offsetHeight);
    off += 16;
    var r = find.getBoundingClientRect();
    if (!(r.top >= off - 2 && r.top < window.innerHeight * 0.5)) window.scrollTo({ top: Math.max(0, window.pageYOffset + r.top - off), behavior: reduceMotion() ? 'auto' : 'smooth' });
    var q = $('[data-dv-search]');
    if (q && mq('(hover:hover) and (pointer:fine)')) { try { q.focus({ preventScroll: true }); } catch (e) { q.focus(); } }
  }

  /* ---------- views: wall, macro, room ----------
     wall and macro set state.scale and show the texture pane (the canvas); room shows the room pane. The bar's mat note belongs
     to the texture views, the room selector and its note to the room view ([data-view-pane]). */
  var prevEl = document.getElementById('dvPrev');
  function setView(v, o) {
    o = o || {};
    if (v !== 'wall' && v !== 'macro' && v !== 'room') return;
    if (v === 'room' && (room.off || !roomPane)) v = 'wall';
    ui.view = v;
    if (v !== 'room' && state.scale !== v) { state.scale = v; if (!o.quiet) { renderMeta(); paint(); changed('scale'); } }
    $$('[data-dv-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dv-view') === v ? 'true' : 'false'); });
    if (prevEl) prevEl.setAttribute('data-view', v);
    $$('[data-view-pane]').forEach(function (p) { p.hidden = (p.getAttribute('data-view-pane') === 'room') !== (v === 'room'); });
    if (v === 'room') { roomMount(); roomUpdate(); }
    else if (texStale) { sizeCanvases(); paint(); }   // the canvas was not redrawn while the room view was shown
  }

  /* ---------- the try-on: the composition on the feature wall of a photoreal room (W5_SPEC 1.5) ----------
     The interiors block's photo mode (assets/3d/photoroom.js, DONE_INTERIOR2.md): Cycles renders whose wall is recoloured live
     and exactly. The page hands the module over as DVATONE.photoRoom() (a module script, so this file stays a classic script).
     It is imported the first time the room view is chosen (on screens from 1100 px also in an idle slot 2.5 s after load) and
     mounted into [data-dv-room-host] the first time the room view is shown; until its first frame the room's poster shows. At
     every commit the wall takes the composition (mix, fraction, density, seed) with the module's own wipe; while the room view
     is hidden the change waits and is applied when it is shown. Which rooms exist, their group and order come from the module
     (PHOTO_GROUPS / PHOTO_ROOMS, ready rooms only; labels DV.roomCopy first, then the module's names): the selector of the build
     is rebuilt from them, so a room that becomes ready appears without a rebuild. Posters and views go by the room's file
     (corridor -> poster-hallway.webp), never by its id. No WebGL 2 or no ES modules: the room view is not offered. */
  var roomPane = $('[data-dv-room]'), roomHost = roomPane ? $('[data-dv-room-host]', roomPane) : null, roomNow = $('[data-room-now]');
  var roomBar = $('.view__rooms') || root, RC = DV.roomCopy || {}, RCg = RC.groups || {}, RCr = RC.rooms || {};
  var ROOM_GRAIN = { S: 0.6, M: 1, XL: 1.8 };   // the fractions on the 3D modules' grain scale (DONE_3D.md: granules of about 1.1, 1.9 and 3.4 mm)
  var room = { name: roomPane ? roomPane.getAttribute('data-dv-room') : 'living', want: null, ctl: null, imp: null, mounting: false, ready: false, dirty: true, key: '', off: false, sig: '' };
  var roomKey = function () { return state.mix.map(function (c) { return c.hex + ':' + c.share; }).join(',') + '|' + state.grain + '|' + state.density + '|' + state.seed; };
  var roomColours = function () { return state.mix.map(function (c) { return { hex: c.hex, share: c.share }; }); };
  var roomTabs = function () { return $$('[data-room-tab]', roomBar); };
  var roomTab = function (id) { var t = null; roomTabs().forEach(function (x) { if (x.getAttribute('data-room-tab') === id) t = x; }); return t; };
  var roomFile = function (id) { var t = roomTab(id); return (t && t.getAttribute('data-room-file')) || id; };
  function roomLabel(on) { var n = roomNow && roomNow.closest('.view__now'); if (n) n.hidden = !on; }   // no composition title over a poster that cannot show the composition
  function roomUpdate() {   // after a commit (scale, area and lock leave the wall as it is)
    if (!roomPane) return;
    if (roomNow) roomNow.textContent = titleText(compId(), presetIndex());
    if (!room.ready || ui.view !== 'room') { room.dirty = true; return; }   // still loading, or the room view is hidden: done once it shows
    room.dirty = false;
    var k = roomKey(); if (k === room.key) return;
    room.key = k;
    room.ctl.setState({ mix: roomColours(), grain: ROOM_GRAIN[state.grain] || 1, density: state.density, seed: state.seed });
  }
  function roomSync(id) {   // tabs, group switch, the pane's attributes and the page's own poster follow the room
    var tab = roomTab(id); if (!tab || !roomPane) return null;
    var g = tab.getAttribute('data-room-in');
    roomTabs().forEach(function (t) { var on = t === tab; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; t.hidden = t.getAttribute('data-room-in') !== g; });
    $$('[data-room-group]', roomBar).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-room-group') === g ? 'true' : 'false'); });
    room.name = id; roomPane.setAttribute('data-dv-room', id); if (tab.id) roomPane.setAttribute('aria-labelledby', tab.id);
    var f = tab.getAttribute('data-room-file') || id;
    if (roomHost) $$('[data-dv-room-poster]', roomHost).forEach(function (n) { var v = n.getAttribute('src'); if (v) n.setAttribute('src', v.replace(/poster-[\w-]+\.webp/, 'poster-' + f + '.webp')); });
    return tab;
  }
  function roomSelect(id, focus) {
    var tab = roomSync(id); if (!tab) return;
    if (focus) tab.focus();
    if (room.ctl) room.ctl.setRoom(id);   // a crossfade; before the first frame only the module's poster changes (roomReady then shows the room)
  }
  function roomGroup(g) {   // a group button: its rooms appear and its first room comes on the stage
    var first = null; roomTabs().forEach(function (t) { if (!first && t.getAttribute('data-room-in') === g) first = t; });
    if (first) roomSelect(first.getAttribute('data-room-tab'));
  }
  function selectorHTML(groups, cur) {   // the markup of common.room_selector() (W5_SPEC 3.3), prefix dvRoom, controls dvRoomPane
    var cg = groups[0];
    groups.forEach(function (g) { g.rooms.forEach(function (r) { if (r.id === cur) cg = g; }); });
    var head = groups.length > 1
      ? '<div class="rsel__g" role="group" aria-label="' + esc(tx('roomGroups')) + '">' + groups.map(function (g) { return '<button type="button" class="rsel__gb" data-room-group="' + esc(g.id) + '" aria-pressed="' + (g === cg) + '">' + esc(g.name) + '</button>'; }).join('') + '</div>'
      : '<p class="rsel__cap">' + esc(groups[0].name) + '</p>';
    var tabs = '';
    groups.forEach(function (g) {
      g.rooms.forEach(function (r, i) {
        var on = r.id === cur;
        tabs += '<button type="button" class="rsel__t" role="tab" id="dvRoomTab-' + esc(r.id) + '" data-room-tab="' + esc(r.id) + '" data-room-file="' + esc(r.file) + '" data-room-in="' + esc(g.id) +
          '" aria-selected="' + on + '" aria-controls="dvRoomPane" tabindex="' + (on ? 0 : -1) + '"' + (g === cg ? '' : ' hidden') + '><i>' + (i < 9 ? '0' : '') + (i + 1) + '</i>' + esc(r.name) + '</button>';
      });
    });
    return '<div class="rsel" data-room-select>' + head + '<div class="rsel__r" role="tablist" aria-label="' + esc(tx('roomTabs')) + '">' + tabs + '</div></div>';
  }
  function domRooms() {   // the selector as it stands, in the shape of the module's list (to tell whether a rebuild is needed)
    var gs = [], by = {};
    roomTabs().forEach(function (t) {
      var g = t.getAttribute('data-room-in'), b = $('[data-room-group="' + g + '"]', roomBar), cap = $('.rsel__cap', roomBar);
      if (!by[g]) { by[g] = { id: g, name: (b || cap || {}).textContent || g, rooms: [] }; gs.push(by[g]); }
      var lab = t.cloneNode(true), num = lab.querySelector('i'); if (num) num.remove();
      by[g].rooms.push({ id: t.getAttribute('data-room-tab'), file: t.getAttribute('data-room-file') || t.getAttribute('data-room-tab'), name: lab.textContent });
    });
    return gs;
  }
  function roomListFromModule(m) {
    var gs = m && m.PHOTO_GROUPS, rs = m && m.PHOTO_ROOMS;
    if (!Array.isArray(gs) || !Array.isArray(rs) || !roomPane || roomBar === root) return;   // without those exports the static list stays
    var nm = function (o, id) { return (o && o.name && (o.name[lang] || o.name.uk)) || id; };
    var groups = gs.map(function (g) {
      return { id: g.id, name: RCg[g.id] || nm(g, g.id), rooms: rs.filter(function (r) { return r && r.ready === true && r.group === g.id; })
        .map(function (r) { return { id: r.id, file: r.file || r.id, name: RCr[r.id] || nm(r, r.id) }; }) };
    }).filter(function (g) { return g.rooms.length; });
    if (!groups.length) return;
    var cur = room.want || room.name, has = function (id) { return groups.some(function (g) { return g.rooms.some(function (r) { return r.id === id; }); }); };
    if (!has(cur)) cur = has(room.name) ? room.name : groups[0].rooms[0].id;
    room.want = null;
    var sig = JSON.stringify(groups);
    if (sig !== JSON.stringify(domRooms())) {   // a room became ready, one went away, the order or a name changed: rebuild in place
      var old = $('[data-room-select]', roomBar), hadFocus = old && old.contains(document.activeElement);
      if (old) old.outerHTML = selectorHTML(groups, cur); else roomBar.insertAdjacentHTML('afterbegin', selectorHTML(groups, cur));
      if (hadFocus) { var t = roomTab(cur); if (t) t.focus(); }
    }
    if (cur !== room.name) roomSelect(cur); else roomSync(cur);
  }
  function roomImport() {
    if (room.imp) return room.imp;
    if (room.off || typeof NS.photoRoom !== 'function') return Promise.reject(new Error('no room module'));
    room.imp = Promise.resolve().then(function () { return NS.photoRoom(); }).then(function (m) { roomListFromModule(m); return m; }, function (e) { room.imp = null; throw e; });
    return room.imp;
  }
  function roomMount() {
    if (room.ctl || room.mounting || !roomHost || room.off) return;
    room.mounting = true; roomLabel(false);
    roomImport().then(function (m) {
      room.mounting = false;
      if (room.ctl || room.off || typeof m.mountPhoto !== 'function') return;
      room.key = roomKey(); room.dirty = false;
      var ctl = room.ctl = m.mountPhoto(roomHost, { room: room.name, colors: roomColours(), grain: ROOM_GRAIN[state.grain] || 1, density: state.density, seed: state.seed });
      var pre = $('[data-dv-room-poster]', roomHost), own = $('.dv3d__poster', roomHost), drop = function () { if (pre && pre.parentNode) pre.parentNode.removeChild(pre); };
      if (pre) { if (!own || own.complete) setTimeout(drop, 60); else { own.addEventListener('load', function () { setTimeout(drop, 60); }, { once: true }); setTimeout(drop, 2500); } }   // the module's poster is the same picture
      Promise.resolve(ctl.ready).then(roomReady, function () { roomReady(false); });
    }, function () { room.mounting = false; });   // not loaded (offline, blocked): the poster stays, the next visit to the room view tries again
  }
  function roomReady(ok) {
    if (!ok) { roomDisable(); return; }   // no WebGL 2 on this device
    room.ready = true; roomLabel(true);
    var v = (room.ctl.stats() || {}).view || '';
    if (v.indexOf(roomFile(room.name) + '-') !== 0) room.ctl.setRoom(room.name, true);   // a tab was picked while the module was loading
    room.dirty = true; roomUpdate();
  }
  function roomDisable() {   // the try-on is not offered: its view button and the "try it" button go, the view returns to the wall
    room.off = true;
    $$('[data-dv-view="room"], [data-dv-try]').forEach(function (b) { b.hidden = true; });
    if (ui.view === 'room') setView('wall');
  }
  function tryOn() {   // "Try it in a room": the room view; on phones and tablets the pinned preview also unfolds and comes into view
    setView('room');
    if (wide() || !prevEl) return;
    pvOpen();
    var cs = getComputedStyle(prevEl), top = parseFloat(cs.top) || 0, r = prevEl.getBoundingClientRect();
    if (r.top < top - 1 || r.top > window.innerHeight * 0.4) window.scrollTo({ top: Math.max(0, window.pageYOffset + r.top - top), behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  /* ---------- wiring ---------- */
  root.addEventListener('click', function (e) {
    var t = e.target, a = t.closest('[data-act]');
    if (a && root.contains(a)) {
      var row = a.closest('[data-i]'), i = row ? +row.getAttribute('data-i') : -1, act = a.getAttribute('data-act');
      if (act === 'lock') { state.lock = !state.lock; renderAll(true); changed('lock'); say(state.lock ? tx('lockOn') : tx('lockOff')); return; }
      if (act === 'base') { if (makeBase(i)) { renderAll(); changed('mix'); focusAct('lock', 0); } return; }
      if (act === 'remove') { var n0 = state.mix.length; removeColour(i); if (state.mix.length < n0) { renderAll(); changed('mix'); focusAct('remove', Math.min(i, state.mix.length - 1)); } return; }
    }
    var sw = t.closest('.res[data-hex]');
    if (sw) {
      var h = sw.getAttribute('data-hex'), at = -1, lab = sw.getAttribute('data-label') || labelOf(h); state.mix.forEach(function (c, k) { if (c.hex === h) at = k; });
      if (at > -1) {
        if (state.mix.length > MIN && !(at === 0 && state.lock)) { removeColour(at); say(fmt(tx('removed'), { label: lab }), null, 1800); }
        else if (at === 0 && state.lock) say(tx('lockedKeep'), 'warn');
        else { ui.sel = at; say(tx('min'), 'warn'); }
      } else if (addColour(h) === 'add') say(fmt(tx('added'), { label: lab }), null, 1800);
      renderAll(); changed('mix'); return;
    }
    var vw = t.closest('[data-dv-view]'); if (vw) { setView(vw.getAttribute('data-dv-view')); return; }
    var ct = t.closest('[data-dv-cat]'); if (ct) { ui.cat = ct.getAttribute('data-dv-cat'); applySearch(false); return; }
    var rg = t.closest('[data-room-group]'); if (rg) { roomGroup(rg.getAttribute('data-room-group')); return; }
    var rt = t.closest('[data-room-tab]'); if (rt) { roomSelect(rt.getAttribute('data-room-tab')); return; }
    if (t.closest('[data-dv-add]')) { if (state.mix.length >= MAX) say(fmt(tx('max'), { max: MAX }), 'warn'); else revealFinder(); return; }
    if (t.closest('[data-dv-try]')) { tryOn(); return; }
    var pr = t.closest('[data-preset]');
    if (pr) {
      var p = G.presets[+pr.getAttribute('data-preset')], bp = { st: copyState(), sel: ui.sel }, dp = dirty;
      setMix(state.lock && state.mix.length ? lockedCols(p.cols) : p.cols); renderAll(); changed('preset');
      offerUndo(bp, dp ? fmt(tx('presetOn'), { name: p.name }) : ''); dirty = false; return;   // a toast only when hand-made work was replaced
    }
    var gr = t.closest('[data-dv-grain]'); if (gr) { state.grain = gr.getAttribute('data-dv-grain'); renderAll(); changed('texture'); return; }
    var fl = t.closest('[data-dv-filter]');
    if (fl) { ui.filter = fl.getAttribute('data-dv-filter'); $$('[data-dv-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === fl ? 'true' : 'false'); }); applySearch(true); return; }
    if (t.closest('[data-dv-more]')) { pageResults(); return; }
    if (t.closest('[data-dv-random]')) {
      var br = { st: copyState(), sel: ui.sel }, dr = dirty;
      state.seed = 1 + Math.floor(Math.random() * 90); setMix(randomMix()); renderAll(); changed('shuffle');
      offerUndo(br, dr ? tx('shuffleOn') : ''); dirty = false; return;
    }
    if (t.closest('[data-dv-reset]')) { var bz = { st: copyState(), sel: ui.sel }; setDefault(); viewFollowsScale(); renderAll(); changed('reset'); offerUndo(bz, tx('resetDone')); dirty = false; return; }
    var ub = t.closest('[data-dv-undo]'); if (ub) { undo(ub); return; }
    var rc = t.closest('[data-dv-recipe-copy]');
    if (rc) { var txt = recipeText(), ev = emit('dvatone:recipe', { state: copyState(), text: txt }); if (!ev.defaultPrevented) copy(txt, tx('recipeCopied'), rc); return; }
    var lc = t.closest('[data-dv-link-copy]');
    if (lc) { copy(shareUrl(), tx('linkCopied'), lc); return; }
    if (t.closest('[data-dv-save-png]')) {
      var cv = canvases[0]; if (!cv || !cv.toBlob) return;
      if (NS.coat && !NS.coat.ready()) { var sb = t.closest('[data-dv-save-png]'); NS.coat.load().then(function () { texStale = true; sb.click(); }); return; }   // the engine starts first
      if (texStale || !painted) { drawOne(cv, false); texStale = false; painted = true; }   // the hidden canvas of the room view is brought up to date first
      cv.toBlob(function (bl) { if (!bl) return; var u = URL.createObjectURL(bl), a2 = document.createElement('a'); a2.href = u; a2.download = 'dvatone-' + compId() + '.png'; document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); });
      return;
    }
    var ex = t.closest('[data-dv-export]'); if (ex) { doExport(ex.getAttribute('data-dv-export')); return; }
  });
  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.classList.contains('gmx__rng')) {
      var row = t.closest('[data-i]'), i = +row.getAttribute('data-i'); setShare(i, +t.value); ui.sel = i;
      syncMix(); renderMeta(); paint(true); changed('share');
    } else if (t.hasAttribute('data-dv-density')) { state.density = clamp(+t.value / 100, 0.4, 1); renderMeta(); paint(true); changed('texture'); }
    else if (t.hasAttribute('data-dv-search')) { clearTimeout(t._t); t._t = setTimeout(function () { ui.q = t.value.trim(); applySearch(true); }, 120); }
    else if (t.hasAttribute('data-dv-area')) { state.area = t.value; runArea(); changed('area'); }
  });
  root.addEventListener('change', function (e) { if (e.target.classList && (e.target.classList.contains('gmx__rng') || e.target.hasAttribute('data-dv-density'))) paint(false); });   // full render as soon as the slider is released
  root.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || !t.hasAttribute) return;
    if (t.hasAttribute('data-room-tab')) {   // roving tabindex among the tabs of the shown group
      var tabs = roomTabs().filter(function (x) { return !x.hidden; }), i = tabs.indexOf(t), n = tabs.length, k = e.key;
      var to = k === 'Home' ? 0 : k === 'End' ? n - 1 : (k === 'ArrowRight' || k === 'ArrowDown') ? (i + 1) % n : (k === 'ArrowLeft' || k === 'ArrowUp') ? (i - 1 + n) % n : -1;
      if (to < 0 || i < 0) return; e.preventDefault(); roomSelect(tabs[to].getAttribute('data-room-tab'), true);
    } else if (t.hasAttribute('data-dv-search')) {
      if (e.key === 'Enter') {   // with a mouse and keyboard: the first shade found joins the composition; on a touch keyboard: just close it
        e.preventDefault();
        if (mq('(pointer:coarse)')) { t.blur(); return; }
        clearTimeout(t._t); ui.q = t.value.trim(); applySearch(true);
        var first = res && $('.res', res); if (first) first.click();
      } else if (e.key === 'Escape' && t.value) { e.preventDefault(); clearTimeout(t._t); t.value = ''; ui.q = ''; applySearch(true); }
    } else if (t.hasAttribute('data-dv-area') && e.key === 'Enter') e.preventDefault();
  });

  /* ---------- share link ---------- */
  function shareUrl() {
    return location.origin.replace('null', '') + location.pathname + '?mix=' + state.mix.map(function (c) { return c.hex + ':' + c.share; }).join(',') + '&g=' + state.grain + '&d=' + Math.round(state.density * 100) + '&s=' + state.scale + '&seed=' + state.seed +
      (state.area ? '&a=' + encodeURIComponent(state.area) : '') + (ui.view === 'room' ? '&v=room&room=' + encodeURIComponent(room.name) : '') + (dvShown() ? '&dv=' + encodeURIComponent(ui.dv) : '');
  }
  function setDefault() {
    var p = G.presets[0]; state.lock = false; setMix(p.cols); state.grain = 'S'; state.density = 0.9; state.scale = 'wall'; state.seed = 11;
  }
  function fromUrl() {
    var s = location.search, ok = false, m;
    if ((m = /[?&]mix=([^&]+)/.exec(s))) {
      var parts = [], hx = [], sh = [], seen = {};
      try { parts = decodeURIComponent(m[1]).split(','); } catch (e) {}
      parts.forEach(function (p) {   // hand-edited links: no duplicates, no zero or negative shares, at most MAX colours
        var kv = p.split(':'), hh = kv[0].toUpperCase(), v = kv.length > 1 ? parseFloat(kv[1]) : 10;
        if (!/^[0-9A-F]{6}$/.test(hh) || seen[hh] || !(v > 0) || !isFinite(v) || hx.length >= MAX) return;
        seen[hh] = 1; hx.push(hh); sh.push(v);
      });
      if (hx.length >= MIN) { var t = sh.reduce(function (a, b) { return a + b; }, 0); setMix(hx, sh.map(function (v) { return v / t * 100; })); ok = true; }
      var dq = /[?&]dv=([^&]+)/.exec(s), dc = '';   // a DV composition opened from the catalogue: its code names it while the mix is unchanged
      try { dc = dq ? decodeURIComponent(dq[1].replace(/\+/g, ' ')).trim().toUpperCase().replace(/^DV[\s_-]*0*(\d{1,3})$/, function (_, n) { return 'DV ' + ('00' + n).slice(-3); }) : ''; } catch (e) {}
      if (ok && /^DV \d{3}$/.test(dc)) { ui.dv = dc; ui.dvMix = mixSig(); }
    }
    if (!ok && (m = /[?&]add=([^&]+)/.exec(s))) {   // picks handed over by the catalogue page
      var hx2 = [];
      try { hx2 = decodeURIComponent(m[1]).split(','); } catch (e) {}
      hx2 = hx2.filter(function (h) { return /^[0-9A-Fa-f]{6}$/.test(h); }).map(function (h) { return h.toUpperCase(); }).filter(function (h, k, arr) { return arr.indexOf(h) === k; });
      if (hx2.length) {
        var pad = G.presets[0].cols.filter(function (h) { return hx2.indexOf(h) < 0; });
        while (hx2.length < MIN && pad.length) hx2.push(pad.shift());
        setMix(hx2); ok = true;
      }
    }
    if ((m = /[?&]g=(S|M|XL)\b/.exec(s))) state.grain = m[1];
    if ((m = /[?&]d=(\d{2,3})/.exec(s))) state.density = clamp(+m[1] / 100, 0.4, 1);
    if ((m = /[?&]s=(wall|macro)\b/.exec(s))) state.scale = m[1];
    if ((m = /[?&]seed=(\d{1,9})\b/.exec(s))) state.seed = +m[1] | 0;
    if ((m = /[?&]a=([^&]+)/.exec(s))) { try { state.area = decodeURIComponent(m[1]); } catch (e) {} }
    ui.view = state.scale;
    if ((m = /[?&]v=(wall|macro|room)\b/.exec(s))) { ui.view = m[1]; if (m[1] !== 'room') state.scale = m[1]; }
    if ((m = /[?&]room=([\w-]{1,40})/.exec(s))) room.want = m[1];
    return ok;
  }

  /* ---------- phones and tablets: the pinned preview (qa/wave2/MOBILE_HOOKS.md section 1) ----------
     Below 1100 px the preview sticks under the header. While it is stuck (.is-stuck), the toggle can fold it to a 56 px strip
     (.is-collapsed, a clip-path in site.css: nothing below it moves). It also folds by itself once the area step comes up, and
     unfolds when the visitor scrolls back above it. A hand-made choice wins and lasts for the session. From 1100 px the preview
     column is sticky too, but it never folds. */
  var prevBtn = prevEl && root.contains(prevEl) ? $('[data-dv-prev-toggle]', prevEl) : null, pvOpen = function () {};
  if (prevBtn) {
    var PKEY = 'dvGenPrevFolded', pv = { pref: false, zone: false, keepOpen: false, stuck: false, rest: null, raf: 0, w: 0 };
    try { pv.pref = sessionStorage.getItem(PKEY) === '1'; } catch (e) {}
    var pvArea = $('[data-dv-mount="area"]'), pvSr = $('.sr', prevBtn);
    var pvApply = function () {
      var folded = pv.stuck && (pv.pref || (pv.zone && !pv.keepOpen));
      prevEl.classList.toggle('is-stuck', pv.stuck); prevEl.classList.toggle('is-collapsed', folded);
      prevBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      if (pvSr) pvSr.textContent = prevBtn.getAttribute(folded ? 'data-label-expand' : 'data-label-collapse') || pvSr.textContent;
    };
    var pvCheck = function () {
      pv.raf = 0;
      if (pv.w !== window.innerWidth) { pv.w = window.innerWidth; pv.rest = null; }   // the resting place is forgotten only when the width changes (the phone URL bar fires resize on every scroll)
      var cs = getComputedStyle(prevEl), sticky = /sticky/.test(cs.position) && !wide(), top = parseFloat(cs.top) || 0, stuck = false, zone = false, y = window.pageYOffset || 0;
      if (sticky) {
        var r = prevEl.getBoundingClientRect();
        if (r.top > top + 1) pv.rest = r.top + y;   // resting in its place: remember where
        stuck = r.top <= top + 1 && (pv.rest == null || y + top - pv.rest > r.height - 56);   // foldable only after it has travelled more than its own height, so it never folds over an empty slot
        if (pvArea) zone = pvArea.getBoundingClientRect().top < window.innerHeight * 0.65;
      }
      if (!zone) pv.keepOpen = false;
      if (stuck !== pv.stuck || zone !== pv.zone) { pv.stuck = stuck; pv.zone = zone; pvApply(); }
    };
    var pvQueue = function () {   // one check per frame; a frame request older than 250 ms counts as lost (a paused or throttled page) and is made again
      var now = Date.now(); if (pv.raf && now - pv.at < 250) return;
      pv.at = now; pv.raf = requestAnimationFrame(pvCheck);
    };
    pvOpen = function () { pv.pref = false; if (pv.zone) pv.keepOpen = true; try { sessionStorage.setItem(PKEY, '0'); } catch (e) {} pvApply(); };
    prevBtn.addEventListener('click', function () {
      if (prevEl.classList.contains('is-collapsed')) pvOpen();
      else { pv.pref = true; pv.keepOpen = false; try { sessionStorage.setItem(PKEY, '1'); } catch (e) {} pvApply(); }
    });
    window.addEventListener('scroll', pvQueue, { passive: true });
    window.addEventListener('resize', pvQueue);
    window.addEventListener('load', pvQueue);   // site.css arrives without blocking: measure again once it applies
    pvQueue();
  }

  /* ---------- go: the first view in this task, the catalogue shades and the rest in later ones (scheduler.yield or a timeout), so a
     slow phone never sees one long start-up task ---------- */
  var later = function (f) { if (window.scheduler && typeof window.scheduler.yield === 'function') window.scheduler.yield().then(f); else setTimeout(f, 0); };
  var fromQuery = fromUrl();
  if (!fromQuery) setMix(G.presets[0].cols);
  if (poster) { if (fromQuery || state.scale !== 'wall' || ui.view !== 'wall') dropPoster(); else posterSig = sigOf(state); }
  if (areaIn) areaIn.value = state.area;
  sizeCanvases();
  renderAll();
  later(function () {
  ui.cat = state.mix.length ? catOfColour(state.mix[0].hex) : CATS[0].id;   // the category of the base colour is pressed first
  applySearch(false); runArea();
  later(function () {
  if (window.ResizeObserver) {   // the canvas follows its frame (a debounced redraw after the size settles)
    var rsT = 0, frameEl = canvases[0] && (canvases[0].closest('.view__frame') || canvases[0].parentNode);
    if (frameEl) new ResizeObserver(function () { clearTimeout(rsT); rsT = setTimeout(function () { if (ui.view === 'room') { texStale = true; return; } if (sizeCanvases()) paint(); }, 150); }).observe(frameEl);
  } else window.addEventListener('resize', function () { clearTimeout(paint._r); paint._r = setTimeout(function () { if (sizeCanvases()) paint(); }, 150); });
  if (!roomPane || typeof NS.photoRoom !== 'function') roomDisable();   // no room markup, or no ES modules: no try-on
  else {
    var want = room.want && roomTab(room.want) ? room.want : room.name;
    if (room.want === want) room.want = null;   // a room that is not in the build's list may still come from the module (roomListFromModule)
    roomSync(want); roomLabel(false);
    roomHost.addEventListener('dv3d:room', function (e) { if (e.detail && e.detail.room) roomSync(e.detail.room); });   // a swipe changed the room (it stays in its group)
    if (wide()) {   // wide screens: the module is fetched in an idle slot 2.5 s after load, so the first click on the room view is quick
      var early = function () { setTimeout(function () { (NS.idle || function (f) { return setTimeout(f, 60); })(function () { roomImport().catch(function () {}); }, 1500); }, 2500); };
      if (document.readyState === 'complete') early(); else window.addEventListener('load', early);
    }
  }
  if (ui.view !== 'wall') setView(ui.view);
  if (poster && NS.coat) {   // the live engine at idle; it takes over from the picture without a visible change
    var startCoat = function () { (window.requestIdleCallback || function (f) { return setTimeout(f, 400); })(function () { NS.coat.load().then(function () { paint(mq('(pointer:coarse)')); }); }, { timeout: 3000 }); };
    if (document.readyState === 'complete') startCoat(); else window.addEventListener('load', startCoat);
  } else if (mq('(pointer:coarse)')) paint(true);   // phones: a quick coarse first frame, the full render follows 220 ms later
  });
  });
})();
