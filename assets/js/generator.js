/* DVATONE generator shell (UI + state + preview engine). One script serves the three interface options
   (generator.html, generator-b.html, generator-c.html): every option only differs in markup and CSS.
   The client's specialist plugs in WITHOUT touching this file, see GENERATOR_MODULE.md:

     window.DVATONE.generator.registerEngine('name', { render(canvas, state, opts) {...} })   // replaces the preview painter
     window.DVATONE.generator.registerModule({
       area(state, area)            -> { volume: '4.2', text?: 'optional note' } | Promise   // fills [data-dv-area-result]
       export('passport'|'texture', state, area) -> Promise<{ url, filename }>               // colour passport PDF / 3ds Max texture
     })
   Events on the root [data-dv-generator]:  dvatone:change  dvatone:commit  dvatone:area  dvatone:export (cancelable)  dvatone:recipe (cancelable)
     preventDefault() on dvatone:export: the listener owns that export (module.export is not called) and calls exportDone / exportFail;
     preventDefault() on dvatone:recipe: the listener owns the recipe text (nothing is copied).
   Mount points (data attributes):          see the header comment of each block below and GENERATOR_MODULE.md.

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
  var MAX = G.max || 6, MIN = G.min || 2, MINSH = 4;
  var SYS = { N: 'NCS', F: '5051', R: 'RAL' };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var fmt = function (s, o) { return String(s || '').replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? '' : o[k]; }); };
  var nf = function (n) { try { return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'uk-UA'); } catch (e) { return String(n); } };   // 1 066 / 1,066
  var SHS = NS.strings || {};
  /* strings the page dictionary (window.DV.gen.t) may not carry: the page value wins, except the keys listed in PREFER */
  var L = {
    uk: {
      copiedBtn: 'Скопійовано', copyFail: 'Не вдалося скопіювати автоматично. Виділіть текст і скопіюйте його вручну.',
      lockBase: 'Зафіксувати основний колір', unlockBase: 'Зняти фіксацію', lockOn: 'Основний колір зафіксовано', lockOff: 'Фіксацію знято',
      lockedKeep: 'Основний колір зафіксовано. Зніміть фіксацію, щоб змінити його.',
      areaErr: 'Вкажіть площу числом, більшим за нуль, наприклад 24 або 12,5', areaBig: SHS.areaBig || 'Для площі понад 10 000 м² напишіть нам.',
      areaEstimate: 'Орієнтовно, за базової витрати 200\u00a0мл/\u2060м². Точний об’єм підтвердимо після вашого запиту.',   // \u2060: the unit never splits after the slash
      areaRequest: 'Надіслати запит на розрахунок', reqArea: 'Прошу розрахувати, скільки покриття потрібно для цієї композиції.',
      exportUnavailable: 'Файли підготуємо за вашим запитом.', exportRequest: 'Надіслати запит на файли',
      reqPassport: 'Прошу підготувати паспорт кольору (PDF) для цієї композиції.', reqTexture: 'Прошу підготувати текстуру у форматі 3ds Max для цієї композиції.',
      presetOn: 'Застосовано поєднання «{name}»', shuffleOn: 'Нове випадкове поєднання', undoHint: 'Попередню композицію можна повернути.', undoDone: 'Попередню композицію повернуто',
      added: '{label}: додано', removed: '{label}: прибрано',
      emptyA: 'Нічого не знайдено. У цьому списку лише відтінки каталогу Dvatone: NCS, 5051 і вибрані RAL. Колекцію DV дивіться ', emptyLink: 'у каталозі'
    },
    en: {
      copiedBtn: 'Copied', copyFail: 'We could not copy automatically. Select the text and copy it by hand.',
      lockBase: 'Lock the base', unlockBase: 'Unlock the base', lockOn: 'Base locked', lockOff: 'Base unlocked',
      lockedKeep: 'The base is locked. Unlock it to change it.',
      areaErr: 'Please enter an area as a number greater than zero, for example 24 or 12.5', areaBig: SHS.areaBig || 'For areas over 10,000 m² please write to us.',
      areaEstimate: 'An estimate at the base rate of 200\u00a0ml/\u2060m². We will confirm the exact volume after your request.',
      areaRequest: 'Request a calculation', reqArea: 'Please work out how much coating I need for this composition.',
      exportUnavailable: 'We prepare the files on request.', exportRequest: 'Send a request for the files',
      reqPassport: 'Please prepare the colour passport (PDF) for this composition.', reqTexture: 'Please prepare the 3ds Max texture for this composition.',
      presetOn: '“{name}” applied', shuffleOn: 'A new random combination', undoHint: 'You can restore the previous composition.', undoDone: 'Previous composition restored',
      added: '{label}: added', removed: '{label}: removed',
      emptyA: 'Nothing found. This list holds only the Dvatone catalogue shades: NCS, 5051 and selected RAL. The DV collection is ', emptyLink: 'in the catalogue'
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
  var relLum = function (hex) { var c = rgb(hex).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  var dist = function (a, b) { var x = rgb(a), y = rgb(b); return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2)); };
  var labelOf = function (hex) { return byHex[hex] ? byHex[hex].label : '#' + hex; };

  /* ---------- state ---------- */
  var SHARES = [45, 25, 20, 10];
  var state = { mix: [], grain: 'S', density: 0.9, scale: 'wall', seed: 11, area: '', lock: false };
  var ui = { sel: 0, filter: 'all', q: '', shown: 0, list: cat };
  var listeners = {};

  function normalise() {  // integer shares that always add up to 100 (largest remainder)
    var m = state.mix, n = m.length; if (!n) return;
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
  function setMix(hexes, shares) {
    state.mix = hexes.slice(0, MAX).map(function (h, i) { return { hex: h, share: shares ? shares[i] : (SHARES[i] || 10) }; });
    if (!shares) { var left = 100 - state.mix.reduce(function (a, c) { return a + c.share; }, 0); if (left) state.mix[0].share += left; }
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

  /* ---------- composition number (same recipe, same number) ---------- */
  function compId() {
    var s = state.mix.map(function (c) { return c.hex + c.share; }).join('') + state.grain + Math.round(state.density * 100), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h % 65536).toString(16).toUpperCase().padStart(4, '0');
  }
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

  /* ---------- preview engine (default; replaceable via registerEngine) ---------- */
  var mulberry = function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  var shade = function (c, k) { return 'rgb(' + c.map(function (v) { return clamp(Math.round(v * k), 0, 255); }).join(',') + ')'; };
  var GR = { S: 1, M: 1.8, XL: 3.2 };   // fraction multipliers: the product line is very fine, so S is the default
  var defaultEngine = {
    label: 'fine granule preview',
    render: function (canvas, st, opts) {
      opts = opts || {};
      var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, k = W / 1280 * (opts.texture ? 1.45 : 1);
      var cols = st.mix.map(function (c) { var r = rgb(c.hex); return [shade(r, .9), shade(r, 1), shade(r, 1.08)]; });
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

  /* ---------- paint ---------- */
  var canvases = $$('[data-dv-canvas]'), paintRaf = 0, paintDraft = false, idleT = 0, draftCv = document.createElement('canvas');
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
    if (draft === true) { paintDraft = true; idleT = setTimeout(function () { paint(false); }, 220); } else paintDraft = false;
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(function () {
      paintRaf = 0;
      canvases.forEach(function (cv) {
        drawOne(cv, paintDraft);
        cv.setAttribute('aria-label', (T.alt || '') + '. ' + fmt(T.previewTitle, { id: compId() }) + '.');
      });
      root.setAttribute('data-dv-ready', 'true');
    });
  }

  /* ---------- render UI ---------- */
  var fill = function (v) { return Math.max(0, Math.min(100, (v - MINSH) / Math.max(1, 100 - MINSH * state.mix.length) * 100)); };
  var ico = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z"/></svg>',
    // padlocks for the main colour: only the body fills when the lock is on (.is-on), the shackle stays a line
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path fill="none" d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path fill="none" d="M8.5 10.5V7.75a3.5 3.5 0 0 1 6.9-.8"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>'
  };
  var roleOf = function (i) { return i === 0 ? T.base + (state.lock && T.locked ? ' · ' + T.locked : '') : T.accent; };
  function rowHTML(c, i, withRange) {
    var lab = labelOf(c.hex), role = roleOf(i);
    return '<li class="mixrow' + (i === ui.sel ? ' is-sel' : '') + '" data-i="' + i + '">' +
      '<button type="button" class="mixrow__dot" data-act="select" style="background:#' + c.hex + '" aria-label="' + lab + '"></button>' +
      '<div class="mixrow__name"><b>' + lab + '</b><small>' + role + '<span class="hx"> · #' + c.hex + '</span></small></div>' +
      '<output class="mixrow__pct">' + c.share + '%</output>' +
      // the main colour carries a padlock that is visibly on or off (aria-pressed holds the state, the name stays the same); accents keep the star "make it the main colour"
      (i === 0 ? '<button type="button" class="mixrow__ico' + (state.lock ? ' is-on' : '') + '" data-act="lock" data-lock="' + !!state.lock + '" aria-pressed="' + !!state.lock + '" aria-label="' + tx('lockBase') + ': ' + lab + '" title="' + (state.lock ? tx('unlockBase') : tx('lockBase')) + '">' + (state.lock ? ico.lock : ico.unlock) + '</button>' : '<button type="button" class="mixrow__ico" data-act="base" aria-label="' + T.makeBase + ': ' + lab + '" title="' + T.makeBase + '">' + ico.pin + '</button>') +
      '<button type="button" class="mixrow__ico" data-act="remove" aria-label="' + T.remove + ': ' + lab + '" title="' + T.remove + '">' + ico.x + '</button>' +
      (withRange === false ? '' : '<input type="range" class="rng mixrow__rng" min="' + MINSH + '" max="' + (100 - MINSH * (state.mix.length - 1)) + '" step="1" value="' + c.share + '" aria-label="' + T.share + ': ' + lab + '" aria-valuetext="' + c.share + ' %" style="--c:#' + c.hex + ';--v:' + fill(c.share) + '%">') + '</li>';
  }
  function renderMix(keepFocus) {
    var el = $('[data-dv-mix]');
    if (el) {
      var f = document.activeElement, fi = f && f.closest && f.closest('.mixrow') ? f.closest('.mixrow').getAttribute('data-i') : null, ft = f && f.tagName === 'INPUT' ? 'range' : (f && f.getAttribute && f.getAttribute('data-act'));
      el.innerHTML = state.mix.map(function (c, i) { return rowHTML(c, i); }).join('');
      if (keepFocus && fi != null) { var r = $('.mixrow[data-i="' + fi + '"] ' + (ft === 'range' ? 'input' : '[data-act="' + ft + '"]'), el); if (r) r.focus(); }
    }
    var strip = $('[data-dv-strip]');
    if (strip) strip.innerHTML = state.mix.map(function (c, i) {
      var lab = labelOf(c.hex), light = relLum(c.hex) > 0.19;   // dark label on light swatches: the cut-over where white and ink text have equal contrast
      return '<button type="button" class="pseg' + (i === ui.sel ? ' is-sel' : '') + (light ? ' is-light' : '') + '" data-i="' + i + '" data-act="select" style="flex:' + c.share + ' 1 0;background:#' + c.hex + '" aria-pressed="' + (i === ui.sel) + '" aria-label="' + lab + ', ' + c.share + '%"><span>' + c.share + '%</span></button>';
    }).join('');
    var sel = $('[data-dv-selected]');
    if (sel) {
      var c = state.mix[ui.sel], f2 = document.activeElement, was = f2 && sel.contains(f2) ? (f2.tagName === 'INPUT' ? 'input' : '[data-act="' + f2.getAttribute('data-act') + '"]') : null;
      sel.innerHTML = c ? rowHTML(c, ui.sel).replace('<li class="mixrow', '<li class="mixrow mixrow--solo') : '';
      if (keepFocus && was) { var r2 = $(was, sel); if (r2) r2.focus(); }
    }
    renderInspectorOnly();
    $$('[data-dv-count]').forEach(function (e) { e.textContent = fmt(T.count, { n: state.mix.length, max: MAX }); e.classList.toggle('is-limit', state.mix.length >= MAX); });
    $$('.sw2', $('[data-dv-results]') || document.createElement('div')).forEach(function (b) { b.setAttribute('aria-pressed', state.mix.some(function (c) { return c.hex === b.getAttribute('data-hex'); }) ? 'true' : 'false'); });
  }
  function renderInspectorOnly() {
    var insp = $('[data-dv-inspector]'), s = state.mix[ui.sel]; if (!insp || !s) return; var rr = rgb(s.hex);
    insp.innerHTML = '<div class="insp__sw" style="background:#' + s.hex + '"></div><div class="insp__t"><b>' + labelOf(s.hex) + '</b><small>' + roleOf(ui.sel) + '</small></div>' +
      '<dl class="insp__dl"><div><dt>HEX</dt><dd>#' + s.hex + '</dd></div><div><dt>RGB</dt><dd>' + rr.join(' ') + '</dd></div><div><dt>' + T.share + '</dt><dd>' + s.share + '%</dd></div></dl>';
  }
  function syncMix() {   // update numbers and fills in place, so a slider that is being dragged is never rebuilt
    $$('.mixrow').forEach(function (li) {
      var i = +li.getAttribute('data-i'), c = state.mix[i]; if (!c) return;
      li.classList.toggle('is-sel', i === ui.sel);
      var o = $('.mixrow__pct', li); if (o) o.textContent = c.share + '%';
      var r = $('.mixrow__rng', li); if (r) { if (+r.value !== c.share) r.value = c.share; r.style.setProperty('--v', fill(c.share) + '%'); r.setAttribute('max', 100 - MINSH * (state.mix.length - 1)); r.setAttribute('aria-valuetext', c.share + ' %'); }
    });
    $$('[data-dv-strip] .pseg').forEach(function (sg) {
      var i = +sg.getAttribute('data-i'), c = state.mix[i]; if (!c) return;
      sg.style.flex = c.share + ' 1 0'; sg.classList.toggle('is-sel', i === ui.sel); sg.setAttribute('aria-pressed', i === ui.sel ? 'true' : 'false');
      $('span', sg).textContent = c.share + '%'; sg.setAttribute('aria-label', labelOf(c.hex) + ', ' + c.share + '%');
    });
    var insp = $('[data-dv-inspector]'); if (insp) { var dd = $$('.insp__dl dd', insp)[2]; if (dd && state.mix[ui.sel]) dd.textContent = state.mix[ui.sel].share + '%'; }
  }
  function renderMeta() {
    var id = compId();
    $$('[data-dv-id]').forEach(function (e) { e.textContent = id; });
    $$('[data-dv-title]').forEach(function (e) { e.textContent = fmt(T.previewTitle, { id: id }); });
    $$('[data-dv-sub]').forEach(function (e) { e.textContent = fmt(T.previewSub, { n: state.mix.length, shades: plural(state.mix.length), fraction: state.grain, density: Math.round(state.density * 100) }); });
    $$('[data-dv-grain]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dv-grain') === state.grain ? 'true' : 'false'); });
    $$('[data-dv-scale]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dv-scale') === state.scale ? 'true' : 'false'); });
    $$('[data-dv-density]').forEach(function (r) { r.value = Math.round(state.density * 100); r.style.setProperty('--v', ((state.density * 100 - 40) / 60 * 100) + '%'); r.setAttribute('aria-valuetext', Math.round(state.density * 100) + ' %'); });
    $$('[data-dv-density-out]').forEach(function (e) { e.textContent = Math.round(state.density * 100) + '%'; });
    $$('[data-dv-presets] [data-preset]').forEach(function (b) {
      var p = G.presets[+b.getAttribute('data-preset')], on = p && p.cols.length === state.mix.length && p.cols.every(function (h, i) { return state.mix[i] && state.mix[i].hex === h; });
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('[data-dv-swatches]').forEach(function (e) {
      e.innerHTML = state.mix.map(function (c) { return '<i style="background:#' + c.hex + '"></i>'; }).join('');
    });
    updateExportState();
  }
  function renderAll(keepFocus) { renderMix(keepFocus); renderMeta(); paint(); }

  /* ---------- results (catalogue search inside the generator) ---------- */
  var res = $('[data-dv-results]'), PAGE = 60;
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
  function applySearch() {
    var nq = normQ(ui.q);
    ui.list = cat.filter(function (it) { return (ui.filter === 'all' || SYS[it.sys].toLowerCase() === ui.filter) && (!nq || it.key.indexOf(nq) > -1); });
    if (!nq) ui.list = curate(ui.list);
    ui.shown = 0; if (res) res.innerHTML = ''; pageResults();
    var pk = $('[data-dv-peek]'); if (pk) pk.textContent = '';   // no stale shade caption after a new search
    var em = $('[data-dv-empty]');
    if (em) {
      em.hidden = !!ui.list.length;
      if (!ui.list.length) em.innerHTML = esc(tx('emptyA')) + '<a href="catalogue.html' + (/^\s*dv/i.test(ui.q) ? '?q=' + encodeURIComponent(ui.q) : '') + '#dv" style="color:inherit;text-decoration:underline;text-underline-offset:3px">' + esc(tx('emptyLink')) + '</a>.';
    }
  }
  function pageResults() {
    if (!res) return;
    var end = Math.min(ui.list.length, ui.shown + PAGE), h = '';
    for (var i = ui.shown; i < end; i++) {
      var it = ui.list[i], on = state.mix.some(function (c) { return c.hex === it.hex; });
      h += '<button type="button" class="sw2" data-hex="' + it.hex + '" data-label="' + it.label + '" aria-pressed="' + on + '" aria-label="' + it.label + '" style="background:#' + it.hex + '"></button>';
    }
    res.insertAdjacentHTML('beforeend', h); ui.shown = end;
    var more = $('[data-dv-more]'); if (more) more.hidden = ui.shown >= ui.list.length;
    var cn = $('[data-dv-found]'); if (cn) cn.textContent = fmt(T.found, { n: nf(ui.shown), total: nf(ui.list.length) });
  }

  /* ---------- toast / live region ---------- */
  var live = $('[data-dv-live]');
  function announce(msg) { if (!live) return; live.textContent = msg; clearTimeout(announce._t); announce._t = setTimeout(function () { live.textContent = ''; }, 3200); }
  function say(msg, kind, ms) {   // screen readers get the sr-only live region, everyone else the visible toast (NS.toast from site.js)
    announce(msg); if (NS.toast) NS.toast(msg, { kind: kind, ms: ms });
  }
  function flashCount() {
    $$('[data-dv-count]').forEach(function (e) { e.classList.add('is-limit'); });
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
          rq.style.cssText = 'display:flex;width:max-content;max-width:100%;margin-top:10px;color:var(--td)';
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
      if (partial.mix) { state.mix = partial.mix.slice(0, MAX).map(function (c) { return { hex: String(c.hex).replace('#', '').toUpperCase(), share: +c.share || 10 }; }); normalise(); ui.sel = 0; }
      ['grain', 'scale'].forEach(function (k) { if (partial[k]) state[k] = partial[k]; });
      if (partial.lock != null) state.lock = !!partial.lock;
      if (partial.density != null) state.density = clamp(+partial.density, 0.4, 1);
      if (partial.seed != null) state.seed = +partial.seed | 0;
      if (partial.area != null) { state.area = String(partial.area); if (areaIn) areaIn.value = state.area; runArea(); }
      renderAll(); changed((opts && opts.cause) || 'external');
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
    var el = $('[data-dv-mix] .mixrow[data-i="' + idx + '"] [data-act="' + act + '"]') || $('[data-dv-selected] [data-act="' + act + '"]') || $('[data-dv-mix] .mixrow [data-act="select"]');
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
    renderAll(); changed('undo'); dirty = true; say(tx('undoDone'));
    if (wasFocus) { var f = btn.parentNode && btn.parentNode.querySelector('[data-dv-random]'); if (f) { try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); } } }   // the button hides: keep focus nearby
  }

  /* ---------- wiring ---------- */
  root.addEventListener('click', function (e) {
    var t = e.target, a = t.closest('[data-act]');
    if (a) {
      var row = a.closest('[data-i]'), i = row ? +row.getAttribute('data-i') : -1, act = a.getAttribute('data-act');
      if (act === 'select') {
        var segFocus = a.classList.contains('pseg') && document.activeElement === a;   // the strip is rebuilt: keep keyboard focus on the same segment
        ui.sel = i; renderMix(true); renderMeta();
        if (segFocus) { var sg = $('[data-dv-strip] .pseg[data-i="' + i + '"]'); if (sg) { try { sg.focus({ preventScroll: true }); } catch (e2) { sg.focus(); } } }
        return;
      }
      if (act === 'lock') { state.lock = !state.lock; renderAll(true); changed('lock'); say(state.lock ? tx('lockOn') : tx('lockOff')); return; }
      if (act === 'base') { if (makeBase(i)) { renderAll(); changed('mix'); focusAct('select', 0); } return; }
      if (act === 'remove') { var n0 = state.mix.length; removeColour(i); if (state.mix.length < n0) { renderAll(); changed('mix'); focusAct('remove', Math.min(i, state.mix.length - 1)); } return; }
    }
    var sw = t.closest('.sw2');
    if (sw) {
      var h = sw.getAttribute('data-hex'), at = -1, lab = sw.getAttribute('data-label') || labelOf(h); state.mix.forEach(function (c, k) { if (c.hex === h) at = k; });
      if (at > -1 && sw.getAttribute('data-toggle') !== 'off') {
        if (state.mix.length > MIN && !(at === 0 && state.lock)) { removeColour(at); say(fmt(tx('removed'), { label: lab }), null, 1800); }
        else if (at === 0 && state.lock) say(tx('lockedKeep'), 'warn');
        else { ui.sel = at; say(tx('min'), 'warn'); }
      } else if (addColour(h) === 'add') say(fmt(tx('added'), { label: lab }), null, 1800);
      renderAll(); changed('mix'); return;
    }
    var pr = t.closest('[data-preset]');
    if (pr) {
      var p = G.presets[+pr.getAttribute('data-preset')], bp = { st: copyState(), sel: ui.sel }, dp = dirty;
      setMix(state.lock && state.mix.length ? lockedCols(p.cols) : p.cols); renderAll(); changed('preset');
      offerUndo(bp, dp ? fmt(tx('presetOn'), { name: p.name }) : ''); dirty = false; return;   // a toast only when hand-made work was replaced
    }
    var gr = t.closest('[data-dv-grain]'); if (gr) { state.grain = gr.getAttribute('data-dv-grain'); renderAll(); changed('texture'); return; }
    var sc = t.closest('[data-dv-scale]'); if (sc) { state.scale = sc.getAttribute('data-dv-scale'); renderAll(); changed('scale'); return; }
    var fl = t.closest('[data-dv-filter]');
    if (fl) { ui.filter = fl.getAttribute('data-dv-filter'); $$('[data-dv-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === fl ? 'true' : 'false'); }); applySearch(); return; }
    if (t.closest('[data-dv-more]')) { pageResults(); return; }
    if (t.closest('[data-dv-random]')) {
      var br = { st: copyState(), sel: ui.sel }, dr = dirty;
      state.seed = 1 + Math.floor(Math.random() * 90); setMix(randomMix()); renderAll(); changed('shuffle');
      offerUndo(br, dr ? tx('shuffleOn') : ''); dirty = false; return;
    }
    if (t.closest('[data-dv-reset]')) { var bz = { st: copyState(), sel: ui.sel }; setDefault(); renderAll(); changed('reset'); offerUndo(bz, tx('resetDone')); dirty = false; return; }
    var ub = t.closest('[data-dv-undo]'); if (ub) { undo(ub); return; }
    var rc = t.closest('[data-dv-recipe-copy]');
    if (rc) { var txt = recipeText(), ev = emit('dvatone:recipe', { state: copyState(), text: txt }); if (!ev.defaultPrevented) copy(txt, tx('recipeCopied'), rc); return; }
    var lc = t.closest('[data-dv-link-copy]');
    if (lc) { copy(shareUrl(), tx('linkCopied'), lc); return; }
    if (t.closest('[data-dv-save-png]')) { var cv = canvases[0]; if (cv && cv.toBlob) cv.toBlob(function (bl) { var u = URL.createObjectURL(bl), a2 = document.createElement('a'); a2.href = u; a2.download = 'dvatone-' + compId() + '.png'; document.body.appendChild(a2); a2.click(); a2.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000); }); return; }
    var ex = t.closest('[data-dv-export]'); if (ex) { doExport(ex.getAttribute('data-dv-export')); return; }
  });
  root.addEventListener('input', function (e) {
    var t = e.target;
    if (t.classList.contains('mixrow__rng')) {
      var row = t.closest('[data-i]'), i = +row.getAttribute('data-i'); setShare(i, +t.value); if (ui.sel !== i) { ui.sel = i; renderInspectorOnly(); }
      syncMix(); renderMeta(); paint(true); changed('share');
    } else if (t.hasAttribute('data-dv-density')) { state.density = clamp(+t.value / 100, 0.4, 1); renderMeta(); paint(true); changed('texture'); }
    else if (t.hasAttribute('data-dv-search')) { clearTimeout(t._t); t._t = setTimeout(function () { ui.q = t.value.trim(); applySearch(); }, 120); }
    else if (t.hasAttribute('data-dv-area')) { state.area = t.value; runArea(); changed('area'); }
  });
  root.addEventListener('change', function (e) { if (e.target.classList && (e.target.classList.contains('mixrow__rng') || e.target.hasAttribute('data-dv-density'))) paint(false); });   // full render as soon as the slider is released
  // peek: show the code under the pointer, focus or finger
  var peek = $('[data-dv-peek]');
  if (res && peek) {
    var show = function (e) { var b = e.target.closest && e.target.closest('.sw2'); peek.textContent = b ? b.getAttribute('data-label') + ' · #' + b.getAttribute('data-hex') : ''; };
    res.addEventListener('mouseover', show); res.addEventListener('focusin', show); res.addEventListener('pointerdown', function (e) { if (e.pointerType === 'touch') show(e); }); res.addEventListener('mouseleave', function () { peek.textContent = ''; });
  }
  $$('[data-dv-area]').forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); }); });

  /* ---------- share link ---------- */
  function shareUrl() {
    return location.origin.replace('null', '') + location.pathname + '?mix=' + state.mix.map(function (c) { return c.hex + ':' + c.share; }).join(',') + '&g=' + state.grain + '&d=' + Math.round(state.density * 100) + '&s=' + state.scale + '&seed=' + state.seed + (state.area ? '&a=' + encodeURIComponent(state.area) : '');
  }
  function setDefault() {
    var p = G.presets[0]; state.lock = false; setMix(p.cols); state.grain = 'S'; state.density = 0.9; state.scale = 'wall'; state.seed = 11;
  }
  function fromUrl() {
    var s = location.search, ok = false, m;
    if ((m = /[?&]mix=([^&]+)/.exec(s))) {
      var parts = decodeURIComponent(m[1]).split(','), hx = [], sh = [];
      var seen = {};
      parts.forEach(function (p) {   // hand-edited links: no duplicates, no zero or negative shares, at most MAX colours
        var kv = p.split(':'), hh = kv[0].toUpperCase(), v = kv.length > 1 ? parseFloat(kv[1]) : 10;
        if (!/^[0-9A-F]{6}$/.test(hh) || seen[hh] || !(v > 0) || !isFinite(v) || hx.length >= MAX) return;
        seen[hh] = 1; hx.push(hh); sh.push(v);
      });
      if (hx.length >= MIN) { var t = sh.reduce(function (a, b) { return a + b; }, 0); setMix(hx, sh.map(function (v) { return v / t * 100; })); ok = true; }
    }
    if (!ok && (m = /[?&]add=([^&]+)/.exec(s))) {   // picks handed over by the catalogue page
      var hx2 = decodeURIComponent(m[1]).split(',').filter(function (h) { return /^[0-9A-Fa-f]{6}$/.test(h); }).map(function (h) { return h.toUpperCase(); }).filter(function (h, k, arr) { return arr.indexOf(h) === k; });
      if (hx2.length) {
        var pad = G.presets[0].cols.filter(function (h) { return hx2.indexOf(h) < 0; });
        while (hx2.length < MIN && pad.length) hx2.push(pad.shift());
        setMix(hx2); ok = true;
      }
    }
    if ((m = /[?&]g=(S|M|XL)\b/.exec(s))) state.grain = m[1];
    if ((m = /[?&]d=(\d{2,3})/.exec(s))) state.density = clamp(+m[1] / 100, 0.4, 1);
    if ((m = /[?&]s=(wall|macro)/.exec(s))) state.scale = m[1];
    if ((m = /[?&]seed=(\d{1,9})\b/.exec(s))) state.seed = +m[1] | 0;
    if ((m = /[?&]a=([^&]+)/.exec(s))) { try { state.area = decodeURIComponent(m[1]); } catch (e) {} }
    return ok;
  }

  /* ---------- room view (option C): photoreal renders of a living room, a bedroom and a hallway whose feature wall wears the composition ----------
     The interiors block's photo mode (assets/3d/photoroom.js, DONE_INTERIOR2.md): Cycles renders, the wall recoloured live and exactly.
     generator-c.html hands the module over as DVATONE.photoRoom() (a module script, so this file stays a classic script); it is imported
     in an idle slot once the stage is within a screen of the viewport, and the room's poster shows until the first frame. The module takes
     the desktop view (-d) or the phone view (-p) by the shape of [data-dv-room-host]: site.css makes it 4:5 on phones held upright (the
     stage then shows its middle band). At every commit the wall takes the composition (mix, fraction, density, seed) with the module's
     own wipe; the [data-room-tab] tabs (arrow keys, Home, End) and a horizontal swipe on a touch screen change the room. */
  var roomEl = $('[data-dv-room]'), roomHost = roomEl ? $('[data-dv-room-host]', roomEl) : null, roomTabs = $$('[data-room-tab]'), roomNow = $('[data-room-now]');
  var ROOM_GRAIN = { S: 0.6, M: 1, XL: 1.8 };   // the fractions on the 3D modules' grain scale (DONE_3D.md: granules of about 1.1, 1.9 and 3.4 mm)
  var room = { name: (roomEl && roomEl.getAttribute('data-dv-room')) || 'living', ctl: null, ready: false, loading: false, queued: false, inView: false, dirty: false, key: '' };
  var roomKey = function () { return state.mix.map(function (c) { return c.hex + ':' + c.share; }).join(',') + '|' + state.grain + '|' + state.density + '|' + state.seed; };
  var roomColours = function () { return state.mix.map(function (c) { return { hex: c.hex, share: c.share }; }); };
  var roomLabel = function (on) { var n = roomNow && roomNow.closest('.rooms__now'); if (n) n.style.display = on ? '' : 'none'; };   // no composition number over a poster that cannot show the composition
  function roomUpdate() {   // after a commit (scale, area and lock leave the wall as it is)
    if (!roomEl) return;
    if (roomNow) roomNow.textContent = (T.idPrefix || '') + compId();
    if (!room.ready || !room.inView) { room.dirty = true; return; }   // still loading, or off-screen: done once it is ready and near
    room.dirty = false;
    var k = roomKey(); if (k === room.key) return;
    room.key = k;
    room.ctl.setState({ mix: roomColours(), grain: ROOM_GRAIN[state.grain] || 1, density: state.density, seed: state.seed });
  }
  function roomSync(name) {   // tabs, stage attributes and the page's own poster follow the room
    var tab = null;
    roomTabs.forEach(function (t) { var on = t.getAttribute('data-room-tab') === name; if (on) tab = t; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
    if (!tab) return null;
    room.name = name; roomEl.setAttribute('data-dv-room', name); if (tab.id) roomEl.setAttribute('aria-labelledby', tab.id);
    if (roomHost) $$('[data-dv-room-poster], source', roomHost).forEach(function (n) {
      ['src', 'srcset'].forEach(function (a) { var v = n.getAttribute(a); if (v) n.setAttribute(a, v.replace(/poster-[a-z]+/, 'poster-' + name)); });
    });
    return tab;
  }
  function roomSelect(name, focus) {
    var tab = roomSync(name); if (!tab) return;
    if (focus) tab.focus();
    if (room.ctl) room.ctl.setRoom(name);   // a crossfade; before the first frame only the module's poster changes (roomReady then shows the room)
  }
  function roomReady(ok) {
    room.ready = !!ok;
    if (!ok) { roomLabel(false); return; }   // no WebGL 2: the module keeps its poster, the tabs still change it
    var v = room.ctl.stats().view || '';
    if (v.indexOf(room.name + '-') !== 0) room.ctl.setRoom(room.name, true);   // a tab was picked while the module was loading
    roomUpdate();
  }
  function roomLoad() {
    if (room.ctl || room.loading || !roomHost) return;
    if (typeof NS.photoRoom !== 'function') { roomLabel(false); return; }   // without ES modules the posters stay
    room.loading = true;
    NS.photoRoom().then(function (m) {
      room.key = roomKey(); roomLabel(true);
      var ctl = room.ctl = m.mountPhoto(roomHost, { room: room.name, colors: roomColours(), grain: ROOM_GRAIN[state.grain] || 1, density: state.density, seed: state.seed });
      var pre = $('picture', roomHost), own = $('.dv3d__poster', roomHost), drop = function () { if (pre && pre.parentNode) pre.parentNode.removeChild(pre); };
      if (pre) { if (!own || own.complete) setTimeout(drop, 60); else { own.addEventListener('load', function () { setTimeout(drop, 60); }, { once: true }); setTimeout(drop, 2500); } }   // the module's poster is the same picture
      ctl.ready.then(roomReady);
    }).catch(function () { if (!room.ctl) { room.loading = false; roomLabel(false); } });   // not loaded (offline, blocked): the poster stays, the next approach tries again
  }

  /* ---------- phones and tablets: the sticky preview (qa/wave2/MOBILE_HOOKS.md section 1) ----------
     While it is stuck under the header (.is-stuck), the toggle can fold it to a 56 px strip (.is-collapsed, a clip-path in site.css:
     nothing below it moves). Options A and C also fold it by themselves once the area step comes up, and unfold it when the visitor
     scrolls back above it; B releases its preview before the area anyway. A hand-made choice wins and lasts for the session. */
  var prevEl = document.getElementById('dvPrev'), prevBtn = prevEl && root.contains(prevEl) ? $('[data-dv-prev-toggle]', prevEl) : null;
  if (prevBtn) {
    var PKEY = 'dvGenPrevFolded', pv = { pref: false, zone: false, keepOpen: false, stuck: false, sticky: false, top: 0, rest: null, raf: 0 };
    try { pv.pref = sessionStorage.getItem(PKEY) === '1'; } catch (e) {}
    var pvArea = root.getAttribute('data-variant') === 'b' ? null : $('[data-dv-mount="area"]'), pvSr = $('.sr', prevBtn);
    var pvMeasure = function () {   // the resting place is forgotten only when the width changes (the phone URL bar fires resize on every scroll)
      var cs = getComputedStyle(prevEl); pv.sticky = /sticky/.test(cs.position); pv.top = parseFloat(cs.top) || 0;
      if (pv.w !== window.innerWidth) { pv.w = window.innerWidth; pv.rest = null; }
    };
    var pvApply = function () {
      var folded = pv.stuck && (pv.pref || (pv.zone && !pv.keepOpen));
      prevEl.classList.toggle('is-stuck', pv.stuck); prevEl.classList.toggle('is-collapsed', folded);
      prevBtn.setAttribute('aria-expanded', folded ? 'false' : 'true');
      if (pvSr) pvSr.textContent = prevBtn.getAttribute(folded ? 'data-label-expand' : 'data-label-collapse') || pvSr.textContent;
    };
    var pvCheck = function () {
      pv.raf = 0;
      var stuck = false, zone = false, y = window.pageYOffset || 0;
      if (pv.sticky) {
        var r = prevEl.getBoundingClientRect();
        if (r.top > pv.top + 1) pv.rest = r.top + y;   // resting in its place: remember where
        stuck = r.top <= pv.top + 1 && (pv.rest == null || y + pv.top - pv.rest > r.height - 56);   // foldable only after it has travelled more than its own height, so it never folds over an empty slot
        if (pvArea) zone = pvArea.getBoundingClientRect().top < window.innerHeight * 0.65;
      }
      if (!zone) pv.keepOpen = false;
      if (stuck !== pv.stuck || zone !== pv.zone) { pv.stuck = stuck; pv.zone = zone; pvApply(); }
    };
    var pvQueue = function () {   // one check per frame; a frame request older than 250 ms counts as lost (a paused or throttled page) and is made again
      var now = Date.now(); if (pv.raf && now - pv.at < 250) return;
      pv.at = now; pv.raf = requestAnimationFrame(pvCheck);
    };
    prevBtn.addEventListener('click', function () {
      if (prevEl.classList.contains('is-collapsed')) { pv.pref = false; if (pv.zone) pv.keepOpen = true; }
      else { pv.pref = true; pv.keepOpen = false; }
      try { sessionStorage.setItem(PKEY, pv.pref ? '1' : '0'); } catch (e) {}
      pvApply();
    });
    window.addEventListener('scroll', pvQueue, { passive: true });
    window.addEventListener('resize', function () { pvMeasure(); pvQueue(); });
    window.addEventListener('load', function () { pvMeasure(); pvQueue(); });   // site.css arrives without blocking: measure again once it applies
    pvMeasure(); pvQueue();
  }

  /* ---------- go ---------- */
  if (window.matchMedia && matchMedia('(min-width:1100px)').matches) $$('details.gadd').forEach(function (d) { d.open = true; });
  var fromQuery = fromUrl();
  if (!fromQuery) setMix(G.presets[0].cols);
  if (areaIn) areaIn.value = state.area;
  applySearch(); renderAll(); runArea();
  if (roomEl) {
    roomTabs.forEach(function (t, i) {
      t.addEventListener('click', function () { roomSelect(t.getAttribute('data-room-tab')); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, n = roomTabs.length, to = k === 'Home' ? 0 : k === 'End' ? n - 1 : k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % n : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + n) % n : -1;
        if (to < 0) return; e.preventDefault(); roomSelect(roomTabs[to].getAttribute('data-room-tab'), true);
      });
    });
    roomEl.addEventListener('dv3d:room', function (e) { if (e.detail && e.detail.room) roomSync(e.detail.room); });   // a swipe changed the room
    roomUpdate();   // the composition number on the stage
    var roomGo = function () {
      room.inView = true;
      if (!room.ctl && !room.loading && !room.queued) { room.queued = true; (NS.idle || function (f) { return setTimeout(f, 60); })(function () { room.queued = false; roomLoad(); }, 1500); }
      if (room.dirty) roomUpdate();
    };
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { if (es[es.length - 1].isIntersecting) roomGo(); else room.inView = false; }, { rootMargin: '100% 0px 100% 0px' }).observe(roomEl); else roomGo();   // about one screen ahead
  }
  if (window.matchMedia && matchMedia('(pointer:coarse)').matches) paint(true);   // phones: a quick coarse first frame, the full render follows 220 ms later
})();
