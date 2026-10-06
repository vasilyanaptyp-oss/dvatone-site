/* DVATONE site.js: header, reveal, hero loupe, fan, generator teaser, rooms, forms, video, live sky.
   Plain JS, no libraries. Page data comes from window.DV (set inline by the page). */
(function () {
  'use strict';
  var DV = window.DV || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ---------- shared helpers for generator.js / catalogue.js (window.DVATONE): toast, clipboard, label flash, area parser ---------- */
  var NS = (window.DVATONE = window.DVATONE || {});
  var LANG = DV.lang === 'en' ? 'en' : 'uk';
  var SH = {
    uk: {
      close: 'Закрити', copiedBtn: 'Скопійовано', copyFail: 'Не вдалося скопіювати автоматично. Виділіть текст і скопіюйте його вручну.',
      areaBig: 'Для площі понад 10 000 м² напишіть нам.',
      errCount: 'Перевірте форму. Полів з помилкою: {n}',
      send: 'Не вдалося надіслати запит. Введені дані збережено у формі: спробуйте ще раз трохи згодом або напишіть нам у Telegram'
    },
    en: {
      close: 'Close', copiedBtn: 'Copied', copyFail: 'We could not copy automatically. Select the text and copy it by hand.',
      areaBig: 'For areas over 10,000 m² please write to us.',
      errCount: 'Please check the form. Fields with errors: {n}',
      send: 'We could not send your request. Your details are still in the form: please try again in a moment, or write to us on Telegram'
    }
  }[LANG];
  NS.strings = SH;
  (function () {
    var st = document.createElement('style'); st.setAttribute('data-dv-toast', '');
    st.textContent =
      '.dvt{position:fixed;left:50%;bottom:24px;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:10px 12px;box-sizing:border-box;width:max-content;max-width:min(560px,calc(100vw - 32px));' +
      'padding:12px 16px;background:var(--ink,#191511);color:var(--td,#ede6da);border:1px solid var(--line-d2,rgba(255,255,255,.2));border-radius:var(--r-1,2px);box-shadow:0 12px 40px rgba(0,0,0,.35);' +
      'font:400 14px/1.45 var(--f-sans,inherit);opacity:0;transform:translate(-50%,10px);transition:opacity .25s ease,transform .25s ease;pointer-events:none}' +
      '.dvt.is-in{opacity:1;transform:translate(-50%,0)}.dvt.is-act{pointer-events:auto}.dvt--warn{border-left:3px solid var(--err,#d98a7c)}' +
      '.dvt__m{flex:1 1 220px;min-width:0}.dvt__c{flex:1 1 100%;order:3;box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--line-d2,rgba(255,255,255,.2));border-radius:var(--r-1,2px);background:rgba(255,255,255,.06);color:inherit;font:400 13px/1.45 var(--f-mono,monospace);resize:none}' +
      '.dvt__x{flex:none;width:32px;height:32px;margin:-6px -8px -6px 0;color:inherit;font-size:20px;line-height:1;border-radius:50%}.dvt__x:hover{background:rgba(255,255,255,.12)}' +
      '.is-limit{color:var(--err,#d98a7c)!important;font-weight:600}.mixrow__ico[data-lock="true"]{box-shadow:inset 0 0 0 1.5px var(--copper-hi,#c9915c);border-radius:50%}' +
      '@media (max-width:760px){.dvt{bottom:72px}}@media (prefers-reduced-motion:reduce){.dvt{transition:none}}';
    document.head.appendChild(st);
  })();
  var toastEl = null, toastT = 0;
  NS.toast = function (msg, o) {
    o = o || {};
    var host = document.querySelector('dialog[open]') || document.body, act = !!o.copyText;
    if (!toastEl) toastEl = document.createElement('div');
    clearTimeout(toastT); toastEl.className = 'dvt' + (o.kind === 'warn' ? ' dvt--warn' : '') + (act ? ' is-act' : '');
    while (toastEl.firstChild) toastEl.removeChild(toastEl.firstChild);
    if (act || host !== document.body) { toastEl.setAttribute('role', act ? 'alert' : 'status'); toastEl.removeAttribute('aria-hidden'); }   // inside a modal dialog the page's .sr live region is inert, so the toast itself must announce
    else { toastEl.removeAttribute('role'); toastEl.setAttribute('aria-hidden', 'true'); }   // on the page a plain toast is only the visual copy of the .sr live region
    var m = document.createElement('span'); m.className = 'dvt__m'; m.textContent = msg; toastEl.appendChild(m);
    var ta = null;
    if (act) {
      ta = document.createElement('textarea'); ta.className = 'dvt__c'; ta.readOnly = true; ta.value = o.copyText; ta.rows = Math.min(5, o.copyText.split('\n').length); ta.setAttribute('aria-label', msg);
      var x = document.createElement('button'); x.type = 'button'; x.className = 'dvt__x'; x.setAttribute('aria-label', SH.close); x.textContent = '×';
      x.addEventListener('click', function () { hideToast(); });
      toastEl.appendChild(x); toastEl.appendChild(ta);
    }
    if (toastEl.parentNode !== host) host.appendChild(toastEl);
    var tray = $('.tray:not([hidden])'), bottom = '';
    if (tray && host === document.body) { var tr = tray.getBoundingClientRect(); if (tr.height) bottom = Math.round(window.innerHeight - tr.top + 12) + 'px'; }
    toastEl.style.bottom = bottom;
    requestAnimationFrame(function () { toastEl.classList.add('is-in'); if (ta) { try { ta.focus({ preventScroll: true }); ta.select(); } catch (e) {} } });
    toastT = setTimeout(hideToast, o.ms || (act ? 14000 : 2800));
  };
  function hideToast() { if (!toastEl) return; clearTimeout(toastT); toastEl.classList.remove('is-in'); }
  NS.copyText = function (text) {   // resolves true/false: never claims success it cannot confirm
    return new Promise(function (resolve) {
      var legacy = function () {
        var ok = false, prev = document.activeElement;
        try {
          var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true'); ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
          (document.querySelector('dialog[open]') || document.body).appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
          ok = !!document.execCommand('copy'); ta.remove();
        } catch (e) { ok = false; }
        try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e2) {}
        return ok;
      };
      if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext !== false) navigator.clipboard.writeText(text).then(function () { resolve(true); }, function () { resolve(legacy()); });
      else resolve(legacy());
    });
  };
  NS.flashLabel = function (btn, text, ms) {   // swap the visible button label for a moment ("Скопійовано")
    var s = btn && btn.querySelector('span'); if (!s) return;
    if (btn.getAttribute('data-flash') == null) btn.setAttribute('data-flash', s.textContent);
    s.textContent = text; clearTimeout(btn._ft);
    btn._ft = setTimeout(function () { s.textContent = btn.getAttribute('data-flash'); btn.removeAttribute('data-flash'); }, ms || 1600);
  };
  NS.parseArea = function (v) {   // strict: "24", "12,5", "1 000", "1 000,5"; no letters, exponents or two separators; up to 10 000 m²
    var s = String(v == null ? '' : v).trim();
    if (!s) return { n: null, err: '' };
    if (!/^\d+([.,]\d{1,2})?$/.test(s) && !/^\d{1,3}([    ]\d{3})+([.,]\d{1,2})?$/.test(s)) return { n: null, err: 'bad' };
    var n = parseFloat(s.replace(/[    ]/g, '').replace(',', '.'));
    if (!(n > 0) || !isFinite(n)) return { n: null, err: 'bad' };
    if (n > 10000) return { n: null, err: 'big' };
    return { n: n, err: '' };
  };

  /* ---------- shared runtime helpers (mobile budget): idle scheduling, yielding, data saver, scroll insets ---------- */
  NS.lowData = function () { var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection; return !!(conn && (conn.saveData || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || ''))); };   // Save-Data or a 2G/3G link: no autoplay, no eager media
  NS.idle = function (fn, timeout) {
    if (window.requestIdleCallback) return window.requestIdleCallback(fn, { timeout: timeout || 1500 });
    return setTimeout(function () { fn({ didTimeout: true, timeRemaining: function () { return 8; } }); }, 60);
  };
  NS.yieldMain = function () {   // give the main thread back between slices of a long job
    if (window.scheduler && window.scheduler.yield) return window.scheduler.yield();
    return new Promise(function (res) { setTimeout(res, 0); });
  };
  var hdrH = function () { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 70; };
  var stickyEls = null;
  NS.topInset = function () {   // bottom edge of whatever is pinned at the top right now: the header and a sticky generator preview
    var inset = hdrH();
    if (!stickyEls) stickyEls = $$('.gframe,.gc__stage,.gb .gen__mat,.ga__easel');
    stickyEls.forEach(function (el) {
      var cs = getComputedStyle(el); if (cs.position !== 'sticky') return;
      var r = el.getBoundingClientRect(); if (r.height > 0 && r.top <= (parseFloat(cs.top) || 0) + 2 && r.bottom > 0) inset = Math.max(inset, r.bottom);
    });
    return inset;
  };
  NS.reveal = function (el, o) {   // scroll an element into the comfortable part of the screen only when it is not already there
    if (!el) return; o = o || {};
    var vv = window.visualViewport, top = (vv ? vv.offsetTop : 0) + NS.topInset() + 8, bot = (vv ? vv.offsetTop + vv.height : window.innerHeight) - (o.bottom != null ? o.bottom : 24);
    var r = el.getBoundingClientRect(); if (r.top >= top && r.bottom <= bot) return;
    var room = bot - top, y = r.height >= room ? r.top - top : r.top - top - (room - r.height) / (o.at === 'center' ? 2 : 3);
    window.scrollTo({ top: Math.max(0, window.scrollY + y), behavior: reduce || o.instant ? 'auto' : 'smooth' });
  };
  (function () {   // JS-owned mobile CSS: scroll padding under the pinned bars, keyboard-open state, loupe-free touch
    var st = document.createElement('style'); st.setAttribute('data-dv-ux', '');
    st.textContent = '@media (max-width:1100px){html[data-dv-kbd] .gframe,html[data-dv-kbd] .gc__stage,html[data-dv-kbd] .gb .gen__mat{position:static!important}}';
    document.head.appendChild(st);
    var pad = 0, padRaf = 0;
    var upd = function () {
      padRaf = 0; var v = hdrH();   // header plus any sticky preview, whether or not it is stuck right now: a focused control must never end up behind it
      $$('.gframe,.gc__stage,.gb .gen__mat').forEach(function (el) { var cs = getComputedStyle(el), h = el.getBoundingClientRect().height; if (cs.position === 'sticky' && h > 0) v = Math.max(v, (parseFloat(cs.top) || 0) + h); });
      v = Math.round(v + 12);
      if (v !== pad) { pad = v; document.documentElement.style.scrollPaddingTop = v + 'px'; }
    };
    var soon = function () { if (!padRaf) padRaf = requestAnimationFrame(upd); };
    window.addEventListener('resize', soon); window.addEventListener('load', soon); soon();
    if (window.ResizeObserver) { var ro = new ResizeObserver(soon); $$('.gframe,.gc__stage,.gb .gen__mat').forEach(function (e) { ro.observe(e); }); }
    var vv = window.visualViewport;   // on-screen keyboard: the visual viewport shrinks well below the layout viewport
    if (vv && window.matchMedia && matchMedia('(pointer:coarse)').matches) {
      var kb = function () { var on = vv.height < window.innerHeight * 0.72 && /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || ''); if (on !== kb.on) { kb.on = on; document.documentElement.toggleAttribute('data-dv-kbd', on); soon(); } };
      vv.addEventListener('resize', kb); document.addEventListener('focusout', function () { setTimeout(kb, 80); });
    }
  })();
  if (window.matchMedia && matchMedia('(pointer:coarse)').matches) {   // a focused field is never left under the keyboard, the header or the pinned preview
    document.addEventListener('focusin', function (e) {
      var t = e.target; if (!t || !t.matches || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=submit]),textarea,select')) return;
      if (t.closest('dialog')) return;
      setTimeout(function () { if (document.activeElement === t) NS.reveal(t, { bottom: 140, at: 'center' }); }, 320);
    });
  }

  /* ---------- header + mobile nav (modal sheet: inert page behind, Tab trapped, focus returned) ---------- */
  var hdr = $('#hdr'), burger = $('.burger'), mnav = $('#mnav'), menuOpen = false, inerted = [];
  function onScrollHdr() { hdr.classList.toggle('is-solid', window.scrollY > 40 || (mnav && mnav.classList.contains('is-open'))); }
  var seen = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'; };
  var tabbables = function () {
    return $$('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', hdr)
      .concat($$('a[href],button:not([disabled])', mnav)).filter(seen);
  };
  function setMenu(open, o) {
    o = o || {};
    if (!!open === menuOpen) return;
    menuOpen = !!open;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    mnav.classList.toggle('is-open', open);
    mnav.removeAttribute('aria-hidden');
    if (open) {
      mnav.inert = false; mnav.setAttribute('role', 'dialog'); mnav.setAttribute('aria-modal', 'true'); mnav.setAttribute('aria-label', burger.getAttribute('aria-label') || 'Menu');
      inerted = [];
      Array.prototype.forEach.call(document.body.children, function (el) {   // everything except the header and the menu: main, footer, sky pill, tray, toasts
        if (el === hdr || el === mnav || /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(el.tagName) || el.inert) return;
        el.inert = true; inerted.push(el);
      });
      var tries = 0;
      (function go() {   // the sheet fades in (visibility flips with the transition): retry until the first link really takes focus
        if (!menuOpen) return;
        var first = $('a[href]', mnav);
        if (first && seen(first)) { first.focus(); if (document.activeElement === first) return; }
        if (++tries < 12) setTimeout(go, 60);
      })();
    } else {
      mnav.inert = true; mnav.removeAttribute('role'); mnav.removeAttribute('aria-modal');
      inerted.forEach(function (el) { el.inert = false; }); inerted = [];
      if (o.focus) burger.focus();
    }
    document.documentElement.style.overflow = open ? 'hidden' : '';
    onScrollHdr();
  }
  if (burger && mnav) {
    mnav.inert = true; mnav.removeAttribute('aria-hidden');
    burger.addEventListener('click', function () { setMenu(!menuOpen, { focus: true }); });
    $$('a', mnav).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) {
      if (!menuOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); setMenu(false, { focus: true }); return; }
      if (e.key !== 'Tab') return;
      var list = tabbables(); if (!list.length) return;
      var f = list[0], l = list[list.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === f || list.indexOf(a) < 0)) { e.preventDefault(); l.focus(); }
      else if (!e.shiftKey && (a === l || list.indexOf(a) < 0)) { e.preventDefault(); f.focus(); }
    });
    window.addEventListener('resize', function () { if (menuOpen && getComputedStyle(burger).display === 'none') setMenu(false); });   // the burger leaves with the breakpoint (px or text size)
  }
  window.addEventListener('scroll', onScrollHdr, { passive: true });
  onScrollHdr();

  /* ---------- reveal on scroll ---------- */
  var rv = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    rv.forEach(function (el) { io.observe(el); });
  } else { rv.forEach(function (el) { el.classList.add('is-in'); }); }

  /* ---------- count-up figures ---------- */
  $$('[data-count]').forEach(function (el) {
    var end = +el.getAttribute('data-count'), pre = el.getAttribute('data-prefix') || '', done = false;
    if (reduce || !('IntersectionObserver' in window)) return;
    var o = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting || done) return; done = true; o.disconnect();
      var t0 = performance.now(), dur = 1400;
      (function step(t) {
        var k = clamp((t - t0) / dur, 0, 1), v = Math.round(end * (1 - Math.pow(1 - k, 3)));
        el.textContent = pre + v; if (k < 1) requestAnimationFrame(step);
      })(t0);
    }, { threshold: 0.6 });
    o.observe(el);
  });

  /* ---------- hero loupe ---------- */
  var hero = $('[data-hero]');
  if (hero) {
    var lens = $('.hero__lens', hero), ring = $('.hero__ring', hero), Z = 1.35, IW = 2000, IH = 1500, OX = 0.64, OY = 0.40;
    var lensSrc = hero.getAttribute('data-img');
    if (window.matchMedia && matchMedia('(max-width: 760px)').matches) lensSrc = lensSrc.replace(/(dv033)\.webp$/, '$1-m.webp');  // same 4:3 photo, smaller file, same as the <picture> source
    lens.style.setProperty('--img', 'url("' + new URL(lensSrc, location.href).href + '")');
    var mx = 0, my = 0, tx = 0, ty = 0, active = false, fine = window.matchMedia && matchMedia('(hover:hover) and (pointer:fine)').matches, raf = 0, t0 = performance.now();
    var place = function () {
      var W = hero.clientWidth, H = hero.clientHeight, s = Math.max(W / IW, H / IH), dw = IW * s, dh = IH * s;
      var ox = (W - dw) * OX, oy = (H - dh) * OY;
      lens.style.backgroundSize = (dw * Z) + 'px ' + (dh * Z) + 'px';
      lens.style.backgroundPosition = (mx - (mx - ox) * Z) + 'px ' + (my - (my - oy) * Z) + 'px';
      hero.style.setProperty('--mx', mx + 'px'); hero.style.setProperty('--my', my + 'px');
      hero.style.setProperty('--lr', (W < 700 ? 90 : 150) + 'px');
    };
    var loop = function (now) {
      if (hero.classList.contains('has-3d')) { stop(); hero.classList.remove('is-live'); return; }
      var W = hero.clientWidth, H = hero.clientHeight;
      if (!fine && !reduce) {
        var t = (now - t0) / 1000; tx = W * (0.62 + 0.22 * Math.sin(t * 0.42)); ty = H * (0.36 + 0.14 * Math.sin(t * 0.31 + 1));
        if (W < 700) {   // phones: the ring (r = 90) stays inside the screen and drifts below the copy block, never over the text
          var lr = 90, row = $('.hero__row', hero), below = row ? row.getBoundingClientRect().bottom - hero.getBoundingClientRect().top + lr + 12 : 0, top = Math.min(below, H - lr - 8);
          tx = clamp(tx, lr + 6, W - lr - 6);
          if (top > ty - 1) ty = top + (H - lr - 8 - top) * (0.5 + 0.5 * Math.sin(t * 0.31 + 1)); else ty = clamp(ty, lr + 6, H - lr - 6);
        }
      }
      mx += (tx - mx) * 0.14; my += (ty - my) * 0.14; place();
      raf = requestAnimationFrame(loop);
    };
    var start = function () { if (hero.classList.contains('has-3d')) return; if (ring && getComputedStyle(ring).display === 'none' && getComputedStyle(lens).display === 'none') return; if (!raf) { var W = hero.clientWidth, H = hero.clientHeight; mx = tx = W * 0.7; my = ty = H * 0.4; raf = requestAnimationFrame(loop); } };
    var stop = function () { cancelAnimationFrame(raf); raf = 0; };
    if (fine) {
      hero.addEventListener('pointermove', function (e) { var r = hero.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; if (!active) { active = true; hero.classList.add('is-live'); } start(); });
      hero.addEventListener('pointerleave', function () { active = false; hero.classList.remove('is-live'); });
    } else if (!reduce) { setTimeout(function () { hero.classList.add('is-live'); start(); }, 1800); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { if (!es[0].isIntersecting) stop(); else if (active || (!fine && !reduce)) start(); }).observe(hero);
  }

  /* ---------- colour fan ---------- */
  var stage = $('[data-tilt]');
  if (stage) {
    var fan = $('#fanPhoto'), cs = $('#casePhoto'), hots = $('#fanHots');
    $$('.cat__tabs button', stage).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view');
        $$('.cat__tabs button', stage).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        fan.classList.toggle('is-off', v !== 'fan'); cs.classList.toggle('is-off', v !== 'case'); hots.style.opacity = v === 'fan' ? 1 : 0; hots.style.transition = 'opacity .5s';
      });
    });
    if (!reduce && window.matchMedia('(hover:hover)').matches) {
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        var t = 'rotateY(' + (x * 9).toFixed(2) + 'deg) rotateX(' + (-y * 6).toFixed(2) + 'deg)';
        fan.style.transform = fan.classList.contains('is-off') ? '' : t; cs.style.transform = cs.classList.contains('is-off') ? '' : t;
      });
      stage.addEventListener('pointerleave', function () { fan.style.transform = ''; cs.style.transform = ''; });
    }
  }

  /* ---------- generator teaser (illustrative live mix on a neutral mat) ---------- */
  var cv = $('#genCanvas');
  if (cv && DV.presets) {
    var ctx = cv.getContext('2d'), cur = { preset: 0, cols: DV.presets[0].map(function (c) { return c.slice(); }), macro: false };
    var SHARE = [45, 25, 20, 10];
    var mulberry = function (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
    var hex2 = function (h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
    var shade = function (rgb, k) { return 'rgb(' + rgb.map(function (v) { return clamp(Math.round(v * k), 0, 255); }).join(',') + ')'; };
    var paint = function () {
      var W = cv.width, H = cv.height, rnd = mulberry(7 + cur.preset * 13 + cur.cols[0][1].charCodeAt(0));
      var rgb = cur.cols.map(function (c) { return hex2(c[1]); });
      ctx.fillStyle = shade(rgb[0], 1); ctx.fillRect(0, 0, W, H);
      var sz = cur.macro ? [7, 15] : [2.2, 5.2], cum = [], acc = 0;
      SHARE.forEach(function (s) { acc += s; cum.push(acc); });
      var n = Math.round(W * H / (cur.macro ? 60 : 9) * 1.15);
      var pal = rgb.map(function (c) { return [shade(c, .9), shade(c, 1), shade(c, 1.08)]; });
      for (var i = 0; i < n; i++) {
        var r = rnd() * 100, k = 0; while (k < 3 && r > cum[k]) k++;
        var s = sz[0] + rnd() * (sz[1] - sz[0]), x = rnd() * W, y = rnd() * H;
        ctx.fillStyle = pal[k][(rnd() * 3) | 0];
        if (s > 5) { ctx.beginPath(); ctx.ellipse(x, y, s * .55, s * (.4 + rnd() * .2), rnd() * 3.14, 0, 6.2832); ctx.fill(); } else ctx.fillRect(x, y, s, s * (.7 + rnd() * .5));
      }
      var id = 0; cur.cols.forEach(function (c) { for (var j = 0; j < c[1].length; j++) id = (id * 31 + c[1].charCodeAt(j)) >>> 0; });
      $('#genId').textContent = '#' + (id % 65536).toString(16).toUpperCase().padStart(4, '0');
      $('#genMix').innerHTML = cur.cols.map(function (c, k) { return '<div><i style="background:#' + c[1] + '"></i><span>' + c[0] + '</span><span>' + SHARE[k] + '%</span></div>'; }).join('');
      $('#genBase').textContent = cur.cols[0][0];
    };
    $$('#genSw .sw').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#genSw .sw').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        cur.cols[0] = [b.getAttribute('data-code'), b.getAttribute('data-hex')]; paint();
      });
    });
    $$('#genPresets .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = +b.getAttribute('data-preset'); cur.preset = n; cur.cols = DV.presets[n].map(function (c) { return c.slice(); });
        $$('#genPresets .chip').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        $$('#genSw .sw').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-hex') === cur.cols[0][1] ? 'true' : 'false'); });
        paint();
      });
    });
    $$('.gen__bar .seg button').forEach(function (b) {
      b.addEventListener('click', function () {
        cur.macro = b.getAttribute('data-scale') === 'macro';
        $$('.gen__bar .seg button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); }); paint();
      });
    });
    var painted = false;
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es, o) { if (es[0].isIntersecting && !painted) { painted = true; paint(); o.disconnect(); } }, { rootMargin: '200px' }).observe(cv);
    else paint();
  }

  /* interiors: see rooms.js (photo-based wall recolouring) */

  /* ---------- forms: validation, then delivery (deliver) ----------
     data-need="name contact consent"  required fields (by input name; "consent" is the checkbox)
     data-need-any="email phone"        at least one of these must be filled
     input[data-kind="email|phone|contact|area"] adds a format check (area is optional unless listed in data-need) */
  var ERR = DV.err || {};
  if (ERR.area) ERR.area = ERR.area.replace(', більшою за нуль', ' більшим за нуль');   // UA grammar
  if (!ERR.send) ERR.send = SH.send;   // never a bare Telegram link
  var fmt = function (kind, v) {
    v = v.trim(); if (!v) return '';
    if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : ERR.email;
    if (kind === 'phone') return (v.charAt(0) === '@' ? /^@[A-Za-z0-9_]{4,}$/.test(v) : (v.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(v))) ? '' : (v.charAt(0) === '@' ? ERR.telegram : ERR.phone);
    if (kind === 'contact') return (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || /^@[A-Za-z0-9_]{4,}$/.test(v) || (v.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(v))) ? '' : ERR.contact;
    if (kind === 'area') { var ar = NS.parseArea(v); return ar.err === 'big' ? SH.areaBig : (ar.err ? ERR.area : ''); }
    return '';
  };
  /* ---------- delivery: one endpoint, JSON POST ----------
     Endpoint = data-endpoint on the form, else window.DV_CONFIG.formEndpoint (assets/js/config.js), else build default.
     No endpoint or any failure = a polite error, never a fake success. Spam guards: hidden honeypot field (name "website"),
     time since page load (ts) and, server side, rate limiting (see deploy/). */
  var T0 = Date.now(), CFG = window.DV_CONFIG || {};
  var endpointOf = function (f) { return (f.getAttribute('data-endpoint') || CFG.formEndpoint || DV.formEndpoint || '').trim(); };
  function formName(f) {
    if (f.getAttribute('data-form-name')) return f.getAttribute('data-form-name');
    if (f.hasAttribute('data-notify')) return 'antibacterial-notify';
    if (f.closest && f.closest('.dbox')) return 'designer-box';
    if (f.classList.contains('contact__form')) return 'contacts';
    return { designerbox: 'designer-box', service: 'service', contacts: 'contacts' }[DV.page] || DV.page || 'form';
  }
  function initHoneypot(f) {
    if ($('.hp-field', f)) return;
    var d = document.createElement('div'); d.className = 'hp-field'; d.setAttribute('aria-hidden', 'true');
    d.innerHTML = '<label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>';
    f.appendChild(d);
  }
  function collect(f) {
    var o = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name || el.name === 'website' || el.type === 'submit' || el.type === 'button') return;
      if (el.type === 'checkbox') { o[el.name] = !!el.checked; return; }
      if (el.type === 'radio' && !el.checked) return;
      o[el.name] = String(el.value || '').trim();
    });
    return o;
  }
  function failBox(f, btn) {
    var box = $('.form__fail', f) || (f.parentNode && $('.form__fail', f.parentNode));
    if (box) return box;
    box = document.createElement('p'); box.className = 'form__fail'; box.setAttribute('role', 'alert');
    if (f.hasAttribute('data-notify')) f.insertAdjacentElement('afterend', box);
    else if (btn && btn.parentNode === f) f.insertBefore(box, btn); else f.appendChild(box);
    return box;
  }
  function showFail(f, btn, why) {
    var box = failBox(f, btn);
    box.textContent = String(ERR.send || SH.send).replace(/[\s:.,;]+$/, '') + ': ';   // "… write to us on Telegram: @Dvatone_bot"
    var a = document.createElement('a'); a.href = 'https://t.me/Dvatone_bot'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '@Dvatone_bot';
    box.appendChild(a); box.hidden = false;
    if (window.console && console.info) console.info('[Dvatone forms] not sent: ' + why);
  }
  function deliver(f, name, fields, btn) {
    var url = endpointOf(f), box = $('.form__fail', f) || (f.parentNode && $('.form__fail', f.parentNode));
    if (box) box.hidden = true;
    var fail = function (why) { f.removeAttribute('aria-busy'); if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); } showFail(f, btn, why); return Promise.reject(new Error(why)); };
    if (!url) return fail('no endpoint configured (set formEndpoint in assets/js/config.js or data-endpoint on the form)');
    if (!window.fetch) return fail('fetch is not available');
    f.setAttribute('aria-busy', 'true'); if (btn) { btn.disabled = true; btn.setAttribute('aria-disabled', 'true'); }
    var hp = $('input[name="website"]', f), ctl = window.AbortController ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : 0;
    var body = { form: name, lang: DV.lang || document.documentElement.lang || '', page: location.pathname, fields: fields, website: hp ? hp.value : '', ts: Date.now() - T0 };
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined, credentials: 'omit' })
      .then(function (r) {
        clearTimeout(timer);
        return r.json().catch(function () { return null; }).then(function (j) {
          if (!r.ok || !j || j.ok !== true) return fail(!r.ok || (j && j.ok === false) ? 'server answered ' + r.status + (j && j.error ? ' ' + j.error : '') : 'unexpected answer (no JSON {"ok":true}, status ' + r.status + ')');
          f.removeAttribute('aria-busy'); if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); }
        });
      }, function (err) { clearTimeout(timer); return fail(err && err.name === 'AbortError' ? 'timeout' : 'network error'); });
  }

  /* ---------- form a11y: errors have ids and are linked to their fields, the first problem gets focus, success is scrolled into view ---------- */
  var uidN = 0, uid = function (p) { return 'dv-' + p + '-' + (++uidN); };
  var addDesc = function (el, id, on) {   // add or remove one id in aria-describedby, keeping the others (hints)
    var a = (el.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== id; });
    if (on) a.push(id);
    if (a.length) el.setAttribute('aria-describedby', a.join(' ')); else el.removeAttribute('aria-describedby');
  };
  var errOf = function (fld) {
    if (!fld) return null;
    var er = $('.err', fld), nx = fld.nextElementSibling;
    if (!er && nx && nx.matches && nx.matches('.err,[data-err-consent]')) er = nx;
    if (er && !er.id) er.id = uid('err');
    return er;
  };
  var focusEl = function (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } };
  function showSent(f, panel) {   // the form collapses and the page gets shorter: bring the confirmation back into view and move focus to it
    f.classList.add('is-sent');
    if (!panel) return;
    panel.setAttribute('tabindex', '-1'); focusEl(panel);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var r = panel.getBoundingClientRect(), vh = window.innerHeight, top = NS.topInset() + 16;
      if (r.top >= top && r.bottom <= vh - 16) return;
      var y = r.height < vh - top - 32 ? r.top - (vh - r.height) / 3 : r.top - top;
      window.scrollTo({ top: Math.max(0, window.scrollY + y), behavior: reduce ? 'auto' : 'smooth' });
    }); });
  }

  $$('[data-form]').forEach(function (f) {
    var need = (f.getAttribute('data-need') || '').split(' ').filter(Boolean), any = (f.getAttribute('data-need-any') || '').split(' ').filter(Boolean);
    var sum = document.createElement('p'); sum.className = 'sr'; sum.setAttribute('role', 'status'); sum.setAttribute('aria-live', 'polite'); sum.setAttribute('data-form-status', ''); f.appendChild(sum);
    $$('.field', f).forEach(function (fld) {   // the error line is announced, and it is no longer part of the field's name
      var el = $('input:not([type=hidden]),textarea,select', fld); if (!el || el.name === 'website') return;
      var er = errOf(fld); if (er) er.setAttribute('role', 'alert');
      var hint = $('.field__hint', fld), cap = fld.matches('label') ? $(':scope > span', fld) : null;
      if (hint) { if (!hint.id) hint.id = uid('hint'); addDesc(el, hint.id, true); }
      if (cap && el.type !== 'checkbox' && ((er && fld.contains(er)) || (hint && fld.contains(hint)))) { if (!cap.id) cap.id = uid('lbl'); el.setAttribute('aria-labelledby', cap.id); }
    });
    var cerr = $('[data-err-consent]', f); if (cerr) { if (!cerr.id) cerr.id = uid('err'); cerr.setAttribute('role', 'alert'); }
    var mark = function (el, msg) {
      var fld = el.closest('.field'), er = errOf(fld);
      if (fld) fld.classList.toggle('is-bad', !!msg);
      if (er) { if (msg) er.textContent = msg; addDesc(el, er.id, !!msg); }
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    };
    var clearBad = function (el) {
      var fld = el.closest && el.closest('.field'); if (!fld) return;
      fld.classList.remove('is-bad');
      if (el.getAttribute('aria-invalid') === 'true') {
        el.setAttribute('aria-invalid', 'false');
        if (el.type === 'checkbox' && el.name === 'consent') { if (cerr) { cerr.style.display = 'none'; addDesc(el, cerr.id, false); } }
        else { var er = errOf(fld); if (er) addDesc(el, er.id, false); }
      }
    };
    var check = function () {
      var ok = true, anyFilled = !any.length || any.some(function (n) { return f.elements[n] && f.elements[n].value.trim(); });
      need.forEach(function (n) {
        var el = f.elements[n]; if (!el) return;
        if (n === 'consent') {
          var bad = !el.checked; if (cerr) { cerr.style.display = bad ? 'block' : 'none'; addDesc(el, cerr.id, bad); }
          el.setAttribute('aria-invalid', bad ? 'true' : 'false'); if (bad) ok = false; return;
        }
        var msg = !el.value.trim() ? (ERR.required || '') : fmt(el.getAttribute('data-kind'), el.value);
        if (!mark(el, msg)) ok = false;
      });
      any.forEach(function (n) {
        var el = f.elements[n]; if (!el) return;
        var msg = !anyFilled ? (ERR.any || ERR.required || '') : fmt(el.getAttribute('data-kind'), el.value);
        if (!mark(el, msg)) ok = false;
      });
      $$('input[data-kind="area"]', f).forEach(function (el) { if (need.indexOf(el.name) < 0 && el.value.trim() && !mark(el, fmt('area', el.value))) ok = false; });
      return ok;
    };
    initHoneypot(f);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (f.getAttribute('aria-busy') === 'true') return;
      if (!check()) {
        var bad = $$('[aria-invalid="true"]', f), first = bad[0];   // DOM order: the first control that needs attention, the consent box included
        sum.textContent = ''; setTimeout(function () { sum.textContent = SH.errCount.replace('{n}', bad.length); }, 60);
        if (first) { focusEl(first); NS.reveal(first, { at: 'center' }); }
        return;
      }
      sum.textContent = '';
      deliver(f, formName(f), collect(f), $('button[type="submit"]', f)).then(function () {
        showSent(f, $('.form__ok', f));
      }, function () { /* error state already shown by deliver() */ });
    });
    f.addEventListener('input', function (e) { clearBad(e.target); });
    f.addEventListener('change', function (e) { if (e.target.type === 'checkbox' || e.target.tagName === 'SELECT') clearBad(e.target); });
  });
  var nf = $('[data-notify]');
  if (nf) {
    initHoneypot(nf);
    nf.addEventListener('submit', function (e) {
      e.preventDefault(); var i = nf.elements.email, ok = /^\S+@\S+\.\S{2,}$/.test(i.value.trim());
      var msg = nf.parentNode.querySelector('.notify__err');
      if (!ok) {
        i.setAttribute('aria-invalid', 'true');
        if (!msg) { msg = document.createElement('p'); msg.className = 'small notify__err'; msg.id = uid('err'); msg.setAttribute('role', 'alert'); msg.style.cssText = 'margin-top:10px;color:var(--err-l)'; nf.insertAdjacentElement('afterend', msg); }
        msg.textContent = ERR.email || ''; addDesc(i, msg.id, true); focusEl(i); NS.reveal(i, { at: 'center' }); return;
      }
      i.setAttribute('aria-invalid', 'false'); if (msg) { addDesc(i, msg.id, false); msg.remove(); }
      if (nf.getAttribute('aria-busy') === 'true') return;
      deliver(nf, formName(nf), collect(nf), $('button[type="submit"]', nf)).then(function () { showSent(nf, nf.parentNode.querySelector('.notify__ok')); }, function () {});
    });
    nf.addEventListener('input', function () { if (nf.elements.email.getAttribute('aria-invalid') === 'true') nf.elements.email.setAttribute('aria-invalid', 'false'); });
  }

  /* ---------- video: poster only until a tap; on Save-Data or a 2G/3G link nothing even starts by itself ---------- */
  $$('[data-yt]').forEach(function (b) {
    b.addEventListener('click', function () {
      var lite = NS.lowData(), f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-yt') + '?autoplay=' + (lite ? 0 : 1) + '&rel=0&modestbranding=1';
      f.title = b.getAttribute('aria-label'); f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.setAttribute('loading', 'lazy');
      var d = document.createElement('div'); d.className = 'vplay'; d.appendChild(f);
      b.replaceWith(d); try { f.focus({ preventScroll: true }); } catch (e) {}
    });
  });

  /* self-hosted video: the file is requested only after the tap; the player takes focus so keyboard users are not dropped on <body> */
  $$('[data-video]').forEach(function (b) {
    b.addEventListener('click', function () {
      var lite = NS.lowData(), v = document.createElement('video');
      v.src = b.getAttribute('data-video'); v.poster = b.getAttribute('data-poster') || '';
      v.controls = true; v.playsInline = true; v.preload = lite ? 'metadata' : 'auto'; v.autoplay = !lite;
      v.setAttribute('aria-label', b.getAttribute('aria-label')); v.setAttribute('tabindex', '-1');
      var d = document.createElement('div'); d.className = 'vplay is-playing'; d.appendChild(v);
      b.replaceWith(d); try { v.focus({ preventScroll: true }); } catch (e) {}
      if (!lite) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }   // data saver: the viewer starts it with the native play button
    });
  });

  /* ---------- application sweep (scroll-linked) ---------- */
  var sw = $('[data-sweep]');
  if (sw && !reduce) {
    var sweep = function () {
      var r = sw.getBoundingClientRect(), vh = window.innerHeight, k = clamp((vh * 0.9 - r.top) / (vh * 0.75), 0, 1);
      sw.style.setProperty('--p', (14 + k * 82).toFixed(1) + '%');
    };
    var swRaf = 0; window.addEventListener('scroll', function () { if (!swRaf) swRaf = requestAnimationFrame(function () { swRaf = 0; sweep(); }); }, { passive: true }); sweep();
  }

  /* =====================================================
     Live sky: tones follow local time of day and season.
     Only the page background is driven. Colour previews sit on .gen__mat (opaque neutral grey).
     ===================================================== */
  var PAL = {
    night: { top: '#8E97A8', mid: '#B3B9C3', bot: '#CCCDCF', glow: '#EEF2F8', ga: .46, dim: 1 },
    dawn: { top: '#D5C4D0', mid: '#EBD6CB', bot: '#F2E6DC', glow: '#FFD2B4', ga: .72, dim: .28 },
    day: { top: '#E8E5DF', mid: '#F1EDE6', bot: '#F2EDE5', glow: '#FFFDF6', ga: .7, dim: 0 },
    golden: { top: '#E9D1B5', mid: '#F1DEC8', bot: '#F4E8DA', glow: '#FFC58C', ga: .42, dim: .08 },
    dusk: { top: '#AFA9BF', mid: '#CFC5CC', bot: '#E1D7D1', glow: '#F2BAA1', ga: .46, dim: .62 }
  };
  var SEASON_TINT = ['#B2C3DA', '#C8DCC0', '#F4D8AB', '#E1B086'];  // winter, spring, summer, autumn
  var SEASON_DOY = [15, 105, 196, 288];
  var SUN = [[473, 980], [435, 1032], [374, 1079], [365, 1185], [310, 1230], [287, 1272], [300, 1265], [345, 1220], [390, 1150], [435, 1085], [430, 985], [470, 960]]; // sunrise/sunset per month, ~Kyiv
  var TXT = { day: { ml: '#5f564b', mute: '#857a6f', copper: '#8a4f1f' }, night: { ml: '#39352f', mute: '#4f4a43', copper: '#5e3513' } };
  var rgb = function (h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  var mix = function (a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  var hx = function (c) { return '#' + c.map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); };
  var PL = {}; Object.keys(PAL).forEach(function (k) { var p = PAL[k]; PL[k] = { top: rgb(p.top), mid: rgb(p.mid), bot: rgb(p.bot), glow: rgb(p.glow), ga: p.ga, dim: p.dim }; });
  var ST = SEASON_TINT.map(rgb);
  var SKY = { t: null, s: null, play: false, info: null }, skyOpen = false;
  var smooth = function (f) { f = clamp(f, 0, 1); return f * f * (3 - 2 * f); };
  var doyOf = function (d) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); };
  var sunFor = function (doy) { var mf = (doy - 15) / 30.44, i = Math.floor(mf), f = mf - i, a = SUN[((i % 12) + 12) % 12], b = SUN[(((i + 1) % 12) + 12) % 12]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  var seasonW = function (doy) {
    for (var k = 0; k < 4; k++) {
      var a = SEASON_DOY[k], b = SEASON_DOY[(k + 1) % 4] + (k === 3 ? 365 : 0), d = doy < a && k === 3 ? doy + 365 : doy;
      if (d >= a && d < b) { var f = smooth((d - a) / (b - a)), w = [0, 0, 0, 0]; w[k] = 1 - f; w[(k + 1) % 4] = f; return w; }
    }
    return [1, 0, 0, 0];
  };
  var phaseAt = function (t, R, S) {
    var K = [[0, 'night'], [R - 100, 'night'], [R - 30, 'dawn'], [R + 45, 'dawn'], [R + 140, 'day'], [S - 160, 'day'], [S - 65, 'golden'], [S - 5, 'golden'], [S + 40, 'dusk'], [S + 110, 'night'], [1440, 'night']];
    for (var i = 0; i < K.length - 1; i++) if (t >= K[i][0] && t < K[i + 1][0]) return { a: K[i][1], b: K[i + 1][1], f: smooth((t - K[i][0]) / Math.max(1, K[i + 1][0] - K[i][0])) };
    return { a: 'night', b: 'night', f: 0 };
  };
  function skyState() {
    var now = new Date(), t = SKY.t != null ? SKY.t : now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    var doy = SKY.s != null ? SEASON_DOY[SKY.s] : doyOf(now), sun = sunFor(doy), R = sun[0], S = sun[1];
    var ph = phaseAt(t, R, S), A = PL[ph.a], B = PL[ph.b], f = ph.f;
    var sw = SKY.s != null ? [0, 1, 2, 3].map(function (k) { return k === SKY.s ? 1 : 0; }) : seasonW(doy);
    var tint = [0, 0, 0]; sw.forEach(function (w, k) { tint = [tint[0] + ST[k][0] * w, tint[1] + ST[k][1] * w, tint[2] + ST[k][2] * w]; });
    var dim = A.dim + (B.dim - A.dim) * f, tk = 1 - 0.45 * dim, night = (ph.a === 'night' ? 1 - f : 0) + (ph.b === 'night' ? f : 0), sx, sy;
    if (t < R) { sx = 6; sy = 88; } else if (t > S) { sx = 94; sy = 88; } else { var k2 = (t - R) / (S - R); sx = 6 + 88 * k2; sy = 86 - 72 * Math.sin(Math.PI * k2); }
    var gl = mix(A.glow, B.glow, f), ga = A.ga + (B.ga - A.ga) * f;
    return {
      t: t, dim: dim, phase: f < .5 ? ph.a : ph.b, season: sw.indexOf(Math.max.apply(null, sw)),
      top: hx(mix(mix(A.top, B.top, f), tint, .2 * tk)), mid: hx(mix(mix(A.mid, B.mid, f), tint, .11 * tk)), bot: hx(mix(mix(A.bot, B.bot, f), tint, .05 * tk)),
      glow: 'rgba(' + gl.map(Math.round).join(',') + ',' + ga.toFixed(3) + ')', tint: 'rgba(' + tint.map(Math.round).join(',') + ',' + (.3 * tk).toFixed(3) + ')',
      gx: (sx + (78 - sx) * night).toFixed(2) + '%', gy: (sy + (12 - sy) * night).toFixed(2) + '%'
    };
  }
  var rs = document.documentElement.style, lastTxt = '';
  function applySky() {
    var s = skyState(); SKY.info = s;
    rs.setProperty('--sky-top', s.top); rs.setProperty('--sky-mid', s.mid); rs.setProperty('--sky-bot', s.bot);
    rs.setProperty('--sky-glow', s.glow); rs.setProperty('--sky-tint', s.tint); rs.setProperty('--sky-gx', s.gx); rs.setProperty('--sky-gy', s.gy);
    var d = Math.round(s.dim * 20) / 20;
    if (String(d) !== lastTxt) {  // keep text on the sky readable when the light dims
      lastTxt = String(d);
      rs.setProperty('--ml', hx(mix(rgb(TXT.day.ml), rgb(TXT.night.ml), d)));
      rs.setProperty('--mute-l', hx(mix(rgb(TXT.day.mute), rgb(TXT.night.mute), d >= 0.05 ? Math.min(1, d * 2) : d)));   // darkens twice as fast from the first dimming: italic h2 tone stays >= 3.2:1 on the golden-hour and winter sky
      rs.setProperty('--copper-lo', hx(mix(rgb(TXT.day.copper), rgb(TXT.night.copper), d)));
    }
    document.documentElement.setAttribute('data-sky', s.phase);
    skyUI();
  }
  var hhmm = function (t) { t = ((Math.round(t) % 1440) + 1440) % 1440; var h = Math.floor(t / 60), m = t % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; };
  var I_SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';
  var I_MOON = '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>';
  var I_HALF = '<path d="M4 17h16M7 17a5 5 0 0 1 10 0M12 7.5v2M6.3 10.3l1.3 1.3M17.7 10.3l-1.3 1.3"/>';
  var skyCtl = $('#skyctl'), SL = DV.sky || {};
  function skyUI() {
    var s = SKY.info; if (!s || !skyCtl) return;
    $('#skyIco').innerHTML = s.phase === 'night' ? I_MOON : (s.phase === 'dawn' || s.phase === 'dusk' ? I_HALF : I_SUN);
    $('#skyPillTxt').textContent = hhmm(s.t) + ' · ' + SL.seasons[s.season];
    $('#skyPill').setAttribute('aria-label', SL.label + ': ' + hhmm(s.t) + ', ' + SL.phases[s.phase] + ', ' + SL.seasons[s.season]);
    $('#skyTimeVal').textContent = hhmm(s.t); $('#skyPhase').textContent = '· ' + SL.phases[s.phase]; $('#skySeasonVal').textContent = SL.seasons[s.season];
    var tr = $('#skyTime'); if (document.activeElement !== tr) tr.value = Math.round(s.t / 5) * 5 % 1440;
    var sg = $('#skySeason');   // built once and updated in place: rebuilding it on every tick would drop keyboard focus
    if (sg.children.length !== SL.seasons.length) sg.innerHTML = SL.seasons.map(function (n, k) { return '<button type="button" data-s="' + k + '">' + n + '</button>'; }).join('');
    Array.prototype.forEach.call(sg.children, function (b, k) { b.setAttribute('aria-pressed', s.season === k ? 'true' : 'false'); });
    var pb = $('#skyPlay span'); if (pb) pb.textContent = SKY.play ? SL.pause : SL.play;
  }
  var playRaf = 0, playLast = 0;
  function playStep(now) {
    if (!SKY.play) return; if (!playLast) playLast = now;
    var dt = now - playLast; if (dt > 45) { SKY.t = ((SKY.t == null ? 0 : SKY.t) + dt / 24000 * 1440) % 1440; playLast = now; applySky(); }
    playRaf = requestAnimationFrame(playStep);
  }
  function setPlay(on) { SKY.play = on; cancelAnimationFrame(playRaf); playLast = 0; if (on) { if (SKY.t == null) SKY.t = SKY.info ? SKY.info.t : 0; playRaf = requestAnimationFrame(playStep); } skyUI(); }
  function openSky(open, toFirst) {
    skyOpen = open; $('#skyPop').hidden = !open; $('#skyPill').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { skyCtl.classList.remove('is-away'); if (toFirst) { var t = $('#skyTime'); if (t) t.focus(); } } else tickPill();
  }
  var tickRaf = 0, collide = null;
  function tickPillSoon() { if (!tickRaf) tickRaf = requestAnimationFrame(function () { tickRaf = 0; tickPill(); }); }
  function tickPill() {  // never sit on top of the hero, a colour composition, a form, a button or the generator action row
    if (!skyCtl || skyOpen) return;
    var pill = $('#skyPill'), pl = pill.getBoundingClientRect(), hit = false, h = hero ? hero.getBoundingClientRect() : null;
    if (h && h.bottom > window.innerHeight * 0.4) hit = true;
    var near = function (r, m) { return r.right > pl.left - m && r.left < pl.right + m && r.bottom > pl.top - m && r.top < pl.bottom + m; };
    if (!hit) $$('.gen__mat').forEach(function (m) { if (near(m.getBoundingClientRect(), 12)) hit = true; });
    if (!hit) {
      if (!collide) collide = $$('form,.btn,.gb__actions,.gacts,.tray:not([hidden])');
      for (var i = 0; i < collide.length && !hit; i++) { var c = collide[i]; if (c.offsetParent === null && getComputedStyle(c).position !== 'fixed') continue; if (near(c.getBoundingClientRect(), 80)) hit = true; }
    }
    if (skyCtl.contains(document.activeElement)) hit = false;   // a focused pill is never hidden from the keyboard user
    skyCtl.classList.toggle('is-away', hit);
  }
  if (skyCtl) {
    var skyPop = $('#skyPop'), skyPill = $('#skyPill');
    skyPop.setAttribute('role', 'group');   // a disclosure, not a modal: Tab leaves it and it closes behind the focus
    skyPill.addEventListener('click', function (e) { var o = !skyOpen; openSky(o, o && e.detail === 0); });   // detail 0: the click came from the keyboard or assistive tech
    $('#skyClose').addEventListener('click', function () { openSky(false); skyPill.focus(); });
    $('#skyTime').addEventListener('input', function (e) { if (SKY.play) setPlay(false); SKY.t = +e.target.value; applySky(); });
    $('#skySeason').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; SKY.s = +b.getAttribute('data-s'); applySky(); });
    $('#skyPlay').addEventListener('click', function () { setPlay(!SKY.play); });
    $('#skyLive').addEventListener('click', function () { setPlay(false); SKY.t = null; SKY.s = null; applySky(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && skyOpen && !menuOpen) { openSky(false); skyPill.focus(); } });
    document.addEventListener('pointerdown', function (e) { if (skyOpen && !skyCtl.contains(e.target)) openSky(false); });
    skyCtl.addEventListener('keydown', function (e) {   // Tab off either end (the browser may report no related target there): the popover closes behind the focus
      if (e.key !== 'Tab' || !skyOpen) return;
      var l = $$('button,input,a[href]', skyCtl).filter(function (x) { return !x.disabled && seen(x); }), a = document.activeElement;
      if (l.length && ((!e.shiftKey && a === l[l.length - 1]) || (e.shiftKey && a === l[0]))) openSky(false);
    });
    skyCtl.addEventListener('focusout', function (e) { var n = e.relatedTarget; if (skyOpen && n && !skyCtl.contains(n)) openSky(false); });
    window.addEventListener('scroll', tickPillSoon, { passive: true }); window.addEventListener('resize', tickPillSoon);
    window.addEventListener('load', function () { collide = null; tickPillSoon(); });
  }
  // QA deep links: ?t=21:40  ?season=winter|spring|summer|autumn  ?sky=night|dawn|day|golden|dusk
  (function () {
    var sp = /[?&]season=(winter|spring|summer|autumn)/i.exec(location.search); if (sp) SKY.s = ['winter', 'spring', 'summer', 'autumn'].indexOf(sp[1].toLowerCase());
    var tp = /[?&]t=(\d{1,2})[:.]?(\d{2})/.exec(location.search); if (tp) SKY.t = (+tp[1] % 24) * 60 + (+tp[2] % 60);
    var ph = /[?&]sky=(night|dawn|day|golden|dusk)/i.exec(location.search);
    if (ph) { var sun = sunFor(SKY.s != null ? SEASON_DOY[SKY.s] : doyOf(new Date())); SKY.t = { night: 60, dawn: sun[0] + 5, day: 780, golden: sun[1] - 35, dusk: sun[1] + 22 }[ph[1].toLowerCase()]; }
  })();
  applySky(); tickPill();
  setInterval(function () { if (SKY.t == null) applySky(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) applySky(); });
})();
