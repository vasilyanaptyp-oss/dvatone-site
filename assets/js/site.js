/* DVATONE site.js: header, reveal, hero loupe, fan, generator teaser, forms, video, live sky, shared helpers (window.DVATONE).
   Plain JS, no libraries. Page data comes from window.DV (set inline by the page). */
(function () {
  'use strict';
  var DV = window.DV || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  document.documentElement.classList.add('dv-js');   // also set by the inline head script before the first paint: lets CSS hide reveal blocks and unloaded photos

  /* ---------- reveal on scroll: set up before anything else in this file, so an error further down never leaves a block hidden ---------- */
  var rv = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: matchMedia('(max-width: 760px)').matches ? '0px 0px 25% 0px' : '0px 0px -8% 0px', threshold: 0.06 });   // phones: start before the block scrolls in, so fast flicks never show faded text
    rv.forEach(function (el) { io.observe(el); });
  } else { rv.forEach(function (el) { el.classList.add('is-in'); }); }

  /* ---------- sections below the first screen are laid out only near the screen (content-visibility, site.css). One with
     pictures is rendered for good a screen and a half before it is reached, so its lazy pictures start as early as before
     (the browser's own margin for content-visibility is half a screen). No layout is read here. ---------- */
  if ('IntersectionObserver' in window) {
    var cvIo = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.style.contentVisibility = 'visible'; cvIo.unobserve(e.target); } });
    }, { rootMargin: '150% 0px' });
    $$('main>section:not(:first-child)').forEach(function (s) { if (s.querySelector('img')) cvIo.observe(s); });
  }
  // once the page has settled (6 s after load), the sections not rendered yet are rendered in idle time, one at a time and
  // never while the page is being scrolled, so a later scroll through the page does not lay them out on the way. Not on a page
  // whose first screen is a live picture (a canvas or a video, e.g. the home hero): a section rendered there would drop its frames
  window.addEventListener('load', function () {
    setTimeout(function () {
      if ($('main>section:first-child canvas, main>section:first-child video')) return;
      var rest = $$('main>section:not(:first-child),.ftr').filter(function (s) { return s.style.contentVisibility !== 'visible'; }), moved = 0;
      if (!rest.length) return;
      window.addEventListener('scroll', function () { moved = Date.now(); }, { passive: true });
      var later = function (fn) { if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 200); };
      var next = function () {
        if (Date.now() - moved < 800) { later(next); return; }
        var s = rest.shift(); if (s) s.style.contentVisibility = 'visible';
        if (rest.length) later(next);
      };
      later(next);
    }, 6000);
  });

  /* ---------- digital-catalogue strip: a photo appears only once fully loaded (its swatch colour shows meanwhile),
     so slow phones never see half-painted strips (the catalogue's sample leaves have their own loader, LEAF_JS in build_inner.py) ---------- */
  $$('.sws img').forEach(function (im) {
    var ok = function () { im.classList.add('is-ok'); };
    if (im.complete && im.naturalWidth) ok(); else im.addEventListener('load', ok);   // a failed photo stays hidden: its colour tile remains, never a broken-image icon
  });

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
      'font:400 14px/1.45 var(--f-sans,inherit);opacity:0;visibility:hidden;transform:translate(-50%,10px);transition:opacity .25s ease,transform .25s ease,visibility 0s linear .25s;pointer-events:none}' +
      '.dvt.is-in{opacity:1;visibility:visible;transform:translate(-50%,0);transition-delay:0s}.dvt.is-act{pointer-events:auto}.dvt--warn{border-left:3px solid var(--err,#d98a7c)}' +
      '.dvt__m{flex:1 1 220px;min-width:0}.dvt__c{flex:1 1 100%;order:3;box-sizing:border-box;width:100%;padding:8px 10px;border:1px solid var(--line-d2,rgba(255,255,255,.2));border-radius:var(--r-1,2px);background:rgba(255,255,255,.06);color:inherit;font:400 13px/1.45 var(--f-mono,monospace);resize:none}' +
      '.dvt__x{flex:none;width:32px;height:32px;margin:-6px -8px -6px 0;color:inherit;font-size:20px;line-height:1;border-radius:50%}.dvt__x:hover{background:rgba(255,255,255,.12)}' +
      '.dvt__a{flex:none;min-height:32px;margin:-6px -6px -6px 0;padding:0 8px;border-radius:var(--r-1,2px);color:var(--copper-hi,#dcba94);font:600 13px/1.2 var(--f-sans,inherit);text-decoration:underline;text-underline-offset:3px}.dvt__a:hover{background:rgba(255,255,255,.1)}' +
      '.is-limit{color:var(--err,#d98a7c)!important;font-weight:600}.mixrow__ico[data-lock="true"]{box-shadow:inset 0 0 0 1.5px var(--copper-hi,#c9915c);border-radius:50%}' +
      '@media (pointer:coarse){.dvt__a{min-height:44px;margin-block:-12px}}@media (max-width:760px){.dvt{bottom:72px}}@media (prefers-reduced-motion:reduce){.dvt{transition:none}}';
    document.head.appendChild(st);
  })();
  var toastEl = null, toastT = 0, toastFx = false;
  NS.toast = function (msg, o) {   // o: kind ('warn'), ms, copyText (text to copy by hand), action ({label, run}: one button, e.g. undo)
    o = o || {};
    var host = document.querySelector('dialog[open]') || document.body, act = !!o.copyText, fx = o.action && o.action.label && typeof o.action.run === 'function' ? o.action : null;
    if (!toastEl) {
      toastEl = document.createElement('div');
      var over = false, hold = function () { if (toastFx) clearTimeout(toastT); };   // a toast with an action waits while a mouse is over it or focus is in it
      var resume = function () { if (toastFx && !over && toastEl.classList.contains('is-in') && !toastEl.contains(document.activeElement)) { clearTimeout(toastT); toastT = setTimeout(hideToast, 2400); } };
      toastEl.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') { over = true; hold(); } });
      toastEl.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') { over = false; resume(); } });
      toastEl.addEventListener('focusin', hold); toastEl.addEventListener('focusout', function () { setTimeout(resume, 0); });
    }
    toastFx = !!fx;
    clearTimeout(toastT); toastEl.className = 'dvt' + (o.kind === 'warn' ? ' dvt--warn' : '') + (act || fx ? ' is-act' : '');
    while (toastEl.firstChild) toastEl.removeChild(toastEl.firstChild);
    if (act || host !== document.body) { toastEl.setAttribute('role', act ? 'alert' : 'status'); toastEl.removeAttribute('aria-hidden'); }   // inside a modal dialog the page's .sr live region is inert, so the toast itself must announce
    else if (fx) { toastEl.removeAttribute('role'); toastEl.removeAttribute('aria-hidden'); }   // its button stays reachable; the message itself is announced by the caller's live region
    else { toastEl.removeAttribute('role'); toastEl.setAttribute('aria-hidden', 'true'); }   // on the page a plain toast is only the visual copy of the .sr live region
    var m = document.createElement('span'); m.className = 'dvt__m'; m.textContent = msg; toastEl.appendChild(m);
    if (fx) {
      var ab = document.createElement('button'); ab.type = 'button'; ab.className = 'dvt__a'; ab.textContent = fx.label;
      ab.addEventListener('click', function () { hideToast(); fx.run(); });
      toastEl.appendChild(ab);
    }
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
    toastT = setTimeout(hideToast, fx ? Math.max(o.ms || 0, 8000) : o.ms || (act ? 14000 : 2800));
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
  // runs fn just after the next frame has been drawn, when style and layout are up to date: a first measurement made there
  // costs nothing, while the same read during start-up (or in the frame's own callbacks) forces a whole-page style and layout pass
  var afterFrame = NS.afterFrame = function (fn) { requestAnimationFrame(function () { setTimeout(fn, 0); }); };
  var hdrH = function () { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 70; };
  /* The generator's colour preview ([data-dv-sticky-preview], #dvPrev) is sticky under the header. On phones and tablets it sits
     above the controls, which scroll under it, so it is part of the top inset. On desktop it is a column beside the controls
     (the W5 studio): nothing scrolls under it, and counting it would send every focus and anchor to the bottom of the screen. */
  var PIN = '[data-dv-sticky-preview]';
  var beside = function (el, r) {   // another child of the same parent lies next to it: clear of it sideways, level with it vertically
    var p = el.parentElement, c, q;
    if (!p) return false;
    for (c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (c === el) continue;
      q = c.getBoundingClientRect();
      if (q.width > 0 && q.height > 0 && q.top < r.bottom && q.bottom > r.top && (q.left >= r.right - 1 || q.right <= r.left + 1)) return true;
    }
    return false;
  };
  var overhead = function (el, r) { return r.height > 0 && r.height < window.innerHeight * 0.75 && !beside(el, r); };   // a bar over the controls (a side column, or a preview taller than the screen, is not one)
  NS.topInset = function () {   // bottom edge of whatever is pinned at the top right now: the header and a sticky generator preview above the controls
    var inset = hdrH();
    $$(PIN).forEach(function (el) {
      var cs = getComputedStyle(el); if (cs.position !== 'sticky') return;
      var r = el.getBoundingClientRect(); if (r.top <= (parseFloat(cs.top) || 0) + 2 && r.bottom > 0 && overhead(el, r)) inset = Math.max(inset, r.bottom);
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
    st.textContent = '@media (max-width:1099.98px){html[data-dv-kbd] ' + PIN + '{position:static!important}}';   // one-column generator (below 1100 px): the keyboard needs the room
    document.head.appendChild(st);
    var pad = 0, padRaf = 0;
    var upd = function () {
      padRaf = 0; var v = hdrH();   // header plus a sticky preview above the controls, whether or not it is stuck right now: a focused control must never end up behind it
      $$(PIN).forEach(function (el) { var cs = getComputedStyle(el), r = el.getBoundingClientRect(); if (cs.position === 'sticky' && overhead(el, r)) v = Math.max(v, (parseFloat(cs.top) || 0) + r.height); });
      v = Math.round(v + 12);
      if (v !== pad) { pad = v; document.documentElement.style.scrollPaddingTop = v + 'px'; }
    };
    var soon = function () { if (!padRaf) padRaf = requestAnimationFrame(upd); };
    window.addEventListener('resize', soon); window.addEventListener('load', soon); afterFrame(upd);
    if (window.ResizeObserver) { var ro = new ResizeObserver(soon); $$(PIN).forEach(function (e) { ro.observe(e); }); }
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
  var hdrY = 0, hdrPins = $$(PIN), burgerOff = null, hdrRaf = 0;
  window.addEventListener('resize', function () { burgerOff = null; });   // the burger comes and goes with the breakpoint: measured again after a resize, not on every scroll
  var keepHdr = function () {   // the bar stays: desktop layout, keyboard focus inside it, or a generator preview pinned under it (hiding would open a see-through gap above the preview)
    if (burgerOff === null) burgerOff = !burger || getComputedStyle(burger).display === 'none';
    if (burgerOff) return true;
    var a = document.activeElement;
    if (a && hdr.contains(a)) { try { if (a.matches(':focus-visible')) return true; } catch (e) { return true; } }
    for (var i = 0; i < hdrPins.length; i++) {
      var cs = getComputedStyle(hdrPins[i]); if (cs.position !== 'sticky') continue;
      var r = hdrPins[i].getBoundingClientRect(); if (r.height > 0 && r.bottom > 0 && r.top <= (parseFloat(cs.top) || 0) + 2) return true;
    }
    return false;
  };
  function onScrollHdr() {
    hdrRaf = 0;
    var open = !!(mnav && mnav.classList.contains('is-open')), y0 = window.scrollY;
    // all reads first (scroll height, the pinned preview), then the class writes: never a forced layout between them
    var y = clamp(y0, 0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));   // an iOS rubber band past either end is not a change of direction
    var keep = open || y <= 400 || keepHdr();
    hdr.classList.toggle('is-solid', y0 > 40 || open);
    // phones and tablets: the bar slides away while reading down and comes back on any scroll up
    if (keep) { hdr.classList.remove('is-hidden'); hdrY = y; return; }
    if (y > hdrY + 6) { hdr.classList.add('is-hidden'); hdrY = y; }
    else if (y < hdrY - 6) { hdr.classList.remove('is-hidden'); hdrY = y; }
  }
  hdr.addEventListener('focusin', function () { hdr.classList.remove('is-hidden'); });   // Shift+Tab back into a hidden bar brings it down
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
  var onScrollHdrSoon = function () { if (!hdrRaf) hdrRaf = requestAnimationFrame(onScrollHdr); };   // once per frame, in the frame's own update
  window.addEventListener('scroll', onScrollHdrSoon, { passive: true }); window.addEventListener('resize', onScrollHdrSoon);
  afterFrame(onScrollHdr);   // the first check runs once the first frame is drawn: no forced layout while the page starts

  /* ---------- language switch keeps what is on screen: a shared composition (?mix=…), a search (?q=…), a section (#s4).
     File names and section ids are the same in both languages; the href is refreshed right before it is used. ---------- */
  $$('.lang a[hreflang]').forEach(function (a) {
    var base = a.getAttribute('href');
    if (!base || base.charAt(0) === '#') return;   // the current language
    base = base.split('#')[0].split('?')[0];
    var sync = function () { a.setAttribute('href', base + location.search + location.hash); };
    sync();
    ['pointerenter', 'pointerdown', 'focus', 'click'].forEach(function (t) { a.addEventListener(t, sync); });
  });

  /* ---------- legal pages: the sticky contents list marks the section being read: the one crossing the line just under
     the header (where a click on the list lands a section, so a short one is never skipped), the next one while the line
     is in the gap between two, and the last one once the page cannot scroll further ---------- */
  var toc = $('.prose__toc');
  if (toc) {
    var tocA = $$('a[href^="#"]', toc), tocS = tocA.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }), tocK = -2, tocRaf = 0;
    var spy = function () {
      tocRaf = 0;
      var de = document.documentElement, line = (parseFloat(getComputedStyle(de).scrollPaddingTop) || hdrH()) + 24, k = tocS.length - 1;
      for (var i = 0; i < tocS.length; i++) {
        var r = tocS[i] && tocS[i].getBoundingClientRect(); if (!r || r.bottom <= line) continue;
        k = i === 0 && r.top > line ? -1 : i; break;   // -1: the intro is still on top, nothing is marked yet
      }
      if (k > -1 && window.scrollY + window.innerHeight >= de.scrollHeight - 2) k = tocS.length - 1;
      if (k === tocK) return; tocK = k;
      tocA.forEach(function (a, j) { if (j === k) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    };
    var spySoon = function () { if (!tocRaf) tocRaf = requestAnimationFrame(spy); };
    window.addEventListener('scroll', spySoon, { passive: true }); window.addEventListener('resize', spySoon); afterFrame(spy);   // first mark once the first frame is drawn, not as a forced layout while the page starts
  }

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
  var stage = $('[data-tilt]'), fan = $('#fanPhoto'), cs = $('#casePhoto'), hots = $('#fanHots');
  if (stage && fan && cs) {   // the fan and its case are both on the page (the hot spots are optional)
    $$('.cat__tabs button', stage).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view');
        $$('.cat__tabs button', stage).forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        fan.classList.toggle('is-off', v !== 'fan'); cs.classList.toggle('is-off', v !== 'case');
        if (hots) { hots.style.opacity = v === 'fan' ? 1 : 0; hots.style.transition = 'opacity .5s'; }
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
      var go = $('#generator .gen__cta a[href]');   // the button opens the generator with this composition
      if (go) go.setAttribute('href', go.getAttribute('href').split('?')[0] + '?mix=' + cur.cols.map(function (c, k) { return c[1].toUpperCase() + ':' + SHARE[k]; }).join(','));
    };
    $$('#genSw .sw').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#genSw .sw').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        var pick = [b.getAttribute('data-code'), b.getAttribute('data-hex')];
        for (var j = 1; j < cur.cols.length; j++) if (cur.cols[j][1] === pick[1]) cur.cols[j] = cur.cols[0];   // a shade already in the mix swaps places with the base: no code shows twice
        cur.cols[0] = pick; paint();
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

  /* interiors: the home page's own module script (build_home.py) drives assets/3d/interior2.js; the generator's room view lives in generator.js */

  /* ---------- forms: validation, then delivery (deliver) ----------
     data-need="name contact consent"  required fields (by input name; "consent" is the checkbox)
     data-need-any="email phone"        at least one of these must be filled
     input[data-kind="email|phone|contact|area"] adds a format check (area is optional unless listed in data-need) */
  var ERR = DV.err || {};
  if (ERR.area) ERR.area = ERR.area.replace(', більшою за нуль', ' більшим за нуль');   // UA grammar
  if (!ERR.send) ERR.send = SH.send;   // never a bare Telegram link
  var tgNick = function (v) {   // '@nick', a bare 'nick' or a t.me link: the Telegram handle with its '@', else ''
    v = String(v || '').trim();
    if (/^@[A-Za-z0-9_]{4,}$/.test(v)) return v;
    var m = /^(?:(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/)?([A-Za-z][A-Za-z0-9_]{3,31})\/?$/i.exec(v);
    return m ? '@' + m[1] : '';
  };
  var fmt = function (kind, v) {
    v = v.trim(); if (!v) return '';
    if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : ERR.email;
    if (kind === 'phone') return (tgNick(v) || (v.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(v))) ? '' : (v.charAt(0) === '@' ? ERR.telegram : ERR.phone);
    if (kind === 'contact') return (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || tgNick(v) || (v.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(v))) ? '' : ERR.contact;
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
      var v = String(el.value || '').trim(), k = el.getAttribute('data-kind');
      o[el.name] = ((k === 'phone' || k === 'contact') && tgNick(v)) || v;   // a bare nick or a t.me link reaches the team as @nick
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
      collide = null; tickPillSoon();   // the player replaces the button: the pill's keep-clear list picks it up
    });
  });

  /* self-hosted video: the file is requested only after the tap; the player takes focus so keyboard users are not dropped on <body> */
  $$('[data-video]').forEach(function (b) {
    b.addEventListener('click', function () {
      var lite = NS.lowData(), v = document.createElement('video');
      v.src = (matchMedia('(max-width: 760px)').matches && b.getAttribute('data-video-m')) || b.getAttribute('data-video');   // phones get the lighter file when there is one
      v.poster = b.getAttribute('data-poster') || '';
      v.controls = true; v.playsInline = true; v.preload = lite ? 'metadata' : 'auto'; v.autoplay = !lite;
      v.setAttribute('aria-label', b.getAttribute('aria-label')); v.setAttribute('tabindex', '-1');
      var d = document.createElement('div'); d.className = 'vplay is-playing'; d.appendChild(v);
      b.replaceWith(d); try { v.focus({ preventScroll: true }); } catch (e) {}
      collide = null; tickPillSoon();   // the player (with its control bar) replaces the button: the pill's keep-clear list picks it up
      if (!lite) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }   // data saver: the viewer starts it with the native play button
    });
  });

  /* ---------- application before/after: drag anywhere on the picture (mouse, pen, horizontal swipe), arrow keys on the
     handle; one short hint sweep when it first comes into view. Vertical swipes keep scrolling the page (touch-action: pan-y). ---------- */
  $$('[data-sweep]').forEach(function (sw) {
    var knob = $('.app__knob', sw), cur = 50, drag = null, used = false, hintRaf = 0;
    var set = function (v) {
      cur = clamp(v, 0, 100);
      sw.style.setProperty('--p', cur.toFixed(1) + '%');
      if (knob) { knob.setAttribute('aria-valuenow', String(Math.round(cur))); knob.setAttribute('aria-valuetext', Math.round(cur) + '%'); }
    };
    var atX = function (x) { var r = sw.getBoundingClientRect(); return r.width ? (x - r.left) / r.width * 100 : cur; };
    var take = function () { used = true; if (hintRaf) { cancelAnimationFrame(hintRaf); hintRaf = 0; } };
    // the divider glides to the finger instead of jumping with every pointer event, so sparse or uneven touch events still look smooth
    var tgt = 50, glideRaf = 0;
    var glide = function () {
      glideRaf = 0;
      var d = tgt - cur;
      if (Math.abs(d) < 0.05) { set(tgt); return; }
      set(cur + d * 0.45);
      glideRaf = requestAnimationFrame(glide);
    };
    var aim = function (v) { tgt = clamp(v, 0, 100); if (!glideRaf) glideRaf = requestAnimationFrame(glide); };
    sw.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      take();
      var onKnob = !!(knob && (e.target === knob || knob.contains(e.target)));   // a finger on the round handle drags at once (the handle has touch-action: none)
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: e.pointerType !== 'touch' || onKnob };
      if (drag.on) { aim(atX(e.clientX)); sw.classList.add('is-drag'); try { sw.setPointerCapture(e.pointerId); } catch (_) {} }
    });
    sw.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) {   // touch: start only on a clearly horizontal move, so a vertical swipe still scrolls the page
        var dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
        if (dx < 6 || dx < dy) return;
        drag.on = true; sw.classList.add('is-drag'); try { sw.setPointerCapture(e.pointerId); } catch (_) {}
      }
      aim(atX(e.clientX));
    });
    var end = function () { drag = null; sw.classList.remove('is-drag'); };
    sw.addEventListener('pointerup', end); sw.addEventListener('pointercancel', end);
    sw.addEventListener('lostpointercapture', function (e) { if (e.target === sw) end(); });   // a finger or pen starts captured by the part it lands on (.base, .done, the handle); moving the capture here fires lostpointercapture on that part, which bubbles up and must not end the drag
    if (knob) knob.addEventListener('keydown', function (e) {
      var d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -20, PageUp: 20, Home: -cur, End: 100 - cur }[e.key];
      if (d === undefined) return;
      e.preventDefault(); take(); tgt = clamp(cur + d, 0, 100); set(tgt);
    });
    set(50);
    // the coated side loads its picture only near the viewport (desktop 1000 px or phone 720 px wide)
    var done = $('.done', sw);
    if (done && done.getAttribute('data-bg')) {
      var loadBg = function () {
        var big = sw.clientWidth > 600 && sw.clientWidth * (window.devicePixelRatio || 1) > 800;   // phones always take the 720 px picture
        done.style.backgroundImage = 'url(' + (done.getAttribute(big ? 'data-bg' : 'data-bg-m') || done.getAttribute('data-bg')) + ')';
      };
      if ('IntersectionObserver' in window) {
        var lio = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { lio.disconnect(); loadBg(); } }, { rootMargin: '800px 0px' });
        lio.observe(sw);
      } else loadBg();
    }
    if (reduce || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (en) {
      if (!en[0].isIntersecting) return;
      io.disconnect();
      if (used) return;
      var t0 = 0, dur = 1700;
      var step = function (t) {
        if (used) return;
        if (!t0) t0 = t;
        var k = Math.min(1, (t - t0) / dur);
        set(50 - 18 * Math.sin(k * Math.PI * 2) * (1 - k * 0.35));
        if (k < 1) hintRaf = requestAnimationFrame(step); else { hintRaf = 0; set(50); }
      };
      setTimeout(function () { if (!used) hintRaf = requestAnimationFrame(step); }, 350);
    }, { threshold: 0.6 });
    io.observe(sw);
  });

  /* =====================================================
     Live sky: tones follow local time of day and season.
     Only the page background is driven. Colour previews sit on .gen__mat (opaque neutral grey).
     ===================================================== */
  /* The sky model and its root-variable writes live in the inline <head> script (_src/head_sky.js, window.DVSKY): the page
     paints with the right sky at once and only changed variables are written (each write restyles the whole page).
     Without it (an old cached page with this file) the sky simply keeps its CSS default. */
  var SKYM = window.DVSKY || null;
  var SKY = { t: null, s: null, play: false, info: null }, skyOpen = false;
  function applySky() {
    if (!SKYM) return;
    var s = SKYM.state(SKY.t, SKY.s); SKY.info = s;
    SKYM.apply(s);
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
    tr.setAttribute('aria-valuetext', hhmm(s.t) + ', ' + SL.phases[s.phase]);   // "20:15, сутінки", not the raw minute count
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
  var tickRaf = 0, collide = null, pillOff = null;
  var ZONES = [['form,.btn,.tray', 80], ['.acc,.faqnav,.ftr__top,.ftr__bot', 16], ['.cgrid,.sws,.leaves,.link-arrow,.vplay,.studio__panel', 8]];   // what the pill keeps clear of, and by how many px (a whole FAQ list or generator panel, not row by row, so the pill does not blink in and out while reading)
  // the pill is not shown on tablets, phones and the generator (CSS): then nothing is measured while scrolling. Checked again after a resize.
  var pillHidden = function () { if (pillOff === null) pillOff = !skyCtl || getComputedStyle(skyCtl).display === 'none'; return pillOff; };
  window.addEventListener('resize', function () { pillOff = null; });
  // a block in a part of the page that is not rendered yet (content-visibility) is far from the pill: it is skipped, not measured (measuring would lay it out)
  var unrendered = function (el) { try { return !!el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true }); } catch (e) { return false; } };
  function tickPillSoon() { if (!tickRaf && pillOff !== true) tickRaf = requestAnimationFrame(function () { tickRaf = 0; tickPill(); }); }   // the display check itself is made in tickPill, never in a scroll or start-up call
  function tickPill() {  // never sit on top of the hero, a colour composition, a form, a button, the generator's controls, the catalogue grid, a sample strip, an arrow link, a video, a FAQ list or the footer
    if (!skyCtl || skyOpen || pillHidden()) return;
    var pill = $('#skyPill'), pr = pill.getBoundingClientRect(), hit = false, h = hero ? hero.getBoundingClientRect() : null;
    var tf = /^matrix\((.+)\)$/.exec(getComputedStyle(skyCtl).transform || ''), dy = tf ? parseFloat(tf[1].split(',')[5]) || 0 : 0;
    var pl = { left: pr.left, right: pr.right, top: pr.top - dy, bottom: pr.bottom - dy };   // where the pill rests: its own "away" slide must not feed back into the decision
    if (h && h.bottom > window.innerHeight * 0.4) hit = true;
    var near = function (r, m) { return r.width > 0 && r.right > pl.left - m && r.left < pl.right + m && r.bottom > pl.top - m && r.top < pl.bottom + m; };
    if (!hit) $$('.gen__mat,' + PIN).forEach(function (m) { if (near(m.getBoundingClientRect(), 12)) hit = true; });   // the composition: texture or room view
    if (!hit) {
      if (!collide) {   // built once (again on load); nothing from the closed mobile menu, which is laid out but invisible
        collide = [];
        ZONES.forEach(function (z) { $$(z[0]).forEach(function (el) { if (!el.closest('#mnav')) collide.push([el, z[1]]); }); });
      }
      for (var i = 0; i < collide.length && !hit; i++) {
        var c = collide[i][0];
        if (c.hidden || unrendered(c) || (c.offsetParent === null && getComputedStyle(c).position !== 'fixed')) continue;   // the tray is listed even while it is empty and hidden
        if (near(c.getBoundingClientRect(), collide[i][1]) && getComputedStyle(c).visibility !== 'hidden') hit = true;
      }
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
    document.addEventListener('toggle', tickPillSoon, true);   // an opened FAQ answer moves the rows below it without a scroll
    var trayEl = $('.tray'); if (trayEl && window.MutationObserver) new MutationObserver(tickPillSoon).observe(trayEl, { attributes: true, attributeFilter: ['hidden'] });
  }
  // QA deep links (?t=21:40 ?season=winter ?sky=dusk): parsed by the head script with the same rules
  if (SKYM && SKYM.q) { SKY.t = SKYM.q.t; SKY.s = SKYM.q.s; }
  applySky(); afterFrame(tickPill);   // the head script painted this sky already, so nothing is rewritten; the pill is placed once the first frame is drawn
  setInterval(function () { if (SKY.t == null) applySky(); }, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) applySky(); });
})();
