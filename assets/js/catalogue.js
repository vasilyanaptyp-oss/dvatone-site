
(function () {
  'use strict';
  var DV = window.DV || {}, C = DV.cat || {}, base = DV.base || '', lang = DV.lang === 'en' ? 'en' : 'uk';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var NS = window.DVATONE || {};
  var mq = window.matchMedia ? matchMedia('(max-width:760px)') : null;
  var LS = {
    uk: { copiedBtn: 'Скопійовано', copyFail: 'Не вдалося скопіювати автоматично. Виділіть текст і скопіюйте його вручну.', dvFound: 'Знайдено в колекції DV: {n}', dvGo: 'Переглянути колекцію DV',
      filters: 'Стандарт', filtersTitle: 'Колірний стандарт', show: 'Показати {n}', close: 'Закрити', results: 'Знайдено відтінків: {n}',
      unpick: 'Прибрати з композиції', toGen: 'Скласти композицію ({n})', dvColl: 'Колекція DV', copyCode: 'Копіювати код', copied: 'Код скопійовано', sample: 'Зразок покриття {code}' },
    en: { copiedBtn: 'Copied', copyFail: 'We could not copy automatically. Select the text and copy it by hand.', dvFound: 'Found in the DV collection: {n}', dvGo: 'View the DV collection',
      filters: 'Standard', filtersTitle: 'Colour standard', show: 'Show {n}', close: 'Close', results: 'Shades found: {n}',
      unpick: 'Remove from composition', toGen: 'Build a composition ({n})', dvColl: 'DV collection', copyCode: 'Copy code', copied: 'Code copied', sample: 'Coating sample {code}' }
  }[lang];
  var nf = function (n) { try { return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'uk-UA'); } catch (e) { return String(n); } };
  var strip = function (s) { return String(s || '').toLowerCase().replace(/[\s#\-–—]/g, ''); };
  var normQ = function (s) { return strip(s).replace(/^ncs(?!s)/, 'ncss'); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); };

  var live = $('[data-cat-live]');
  function flash(t, kind) {
    if (live) { live.textContent = t; clearTimeout(flash._t); flash._t = setTimeout(function () { live.textContent = ''; }, 2600); }
    if (NS.toast) NS.toast(t, { kind: kind });
  }
  function copy(text, btn) {
    (NS.copyText ? NS.copyText(text) : Promise.resolve(false)).then(function (ok) {
      if (ok) { flash((C.copied || LS.copied) + ': ' + text); if (btn && NS.flashLabel) NS.flashLabel(btn, LS.copiedBtn); }
      else { if (live) live.textContent = LS.copyFail; if (NS.toast) NS.toast(LS.copyFail, { kind: 'warn', copyText: text }); }
    });
  }

  var skipPop = 0, modals = [];
  function lockScroll(on) { document.body.style.overflow = on ? 'hidden' : ''; }
  function scrollMode(m) { try { if ('scrollRestoration' in history) history.scrollRestoration = m; } catch (e) {} }
  function bindModal(d) {
    modals.push(d);
    d.addEventListener('close', function () {
      lockScroll(false);
      if (d._dvPush) { d._dvPush = false; skipPop++; try { history.back(); } catch (e) { skipPop--; } }
    });
  }
  function openModal(d) {
    if (d.open) return;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
    lockScroll(true);
    scrollMode('manual');
    try { history.pushState({ dvModal: 1 }, ''); d._dvPush = true; } catch (e) {}
  }
  window.addEventListener('popstate', function () {
    if (skipPop > 0) skipPop--;
    else modals.forEach(function (d) { if (d.open) { d._dvPush = false; if (d.close) d.close(); } });
    setTimeout(function () { if (!modals.some(function (d) { return d.open; })) scrollMode('auto'); }, 0);
  });
  window.addEventListener('pagehide', function () { scrollMode('auto'); });

  var dlg = $('[data-cat-dialog]');
  function fillDialog(vis, body) {
    if (!dlg) return false;
    $('[data-cxd-vis]', dlg).innerHTML = vis; $('[data-cxd-body]', dlg).innerHTML = body;
    return true;
  }
  if (dlg) {
    bindModal(dlg);
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-cxd-close]')) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); return; }
      var c = e.target.closest('[data-copy]'); if (c) copy(c.getAttribute('data-copy'), c);
    });
  }

  var DVL = (Array.isArray(C.dv) && C.dv.length ? C.dv : Array.isArray(window.DV_COLLECTION) ? window.DV_COLLECTION : []).filter(function (d) { return d && d.code; });
  var codeKey = function (s) { return String(s || '').toUpperCase().replace(/[\s._-]+/g, ''); };
  var loc = function (v) { return !v ? '' : typeof v === 'string' ? v : String(v[lang] || ''); };
  var url = function (p) { return /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(p) ? p : base + p; };
  function dvEntry(code) {
    var k = codeKey(code);
    for (var i = 0; i < DVL.length; i++) if (codeKey(DVL[i].code) === k) return DVL[i];
    return null;
  }
  
  var wideMq = window.matchMedia ? matchMedia('(min-width:1100px)') : null;
  var fineMq = window.matchMedia ? matchMedia('(hover:hover) and (pointer:fine)') : null;
  var wide = function () { return !!(wideMq && wideMq.matches); };
  var reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches);
  var dv6 = $('[data-dv6]'), view = $('[data-dvv]'), grid6 = $('[data-dv-grid]');
  var CATN = C.dvCats || {};
  var pinned = null, shown = null, dvFilter = 'all', hoverT = 0, leaveT = 0, dlgCode = null, viewK = {};
  var nameOf = function (d) { return loc(d && d.name); };
  var tileOf = function (code) { return grid6 ? $('[data-dv-open="' + code + '"]', grid6) : null; };
  var smallOf = function (d) { return d.photo_s || d.photo_m || d.photo || ''; };
  function metaLine(d) {
    return d.cat && CATN[d.cat] ? esc(CATN[d.cat]) : '';
  }
  var arrowSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  function viewsHTML(d, k, attr) {
    if (!d.views || d.views.length < 2) return '';
    return '<div class="dv6__views" role="group" aria-label="' + esc(C.viewL || '') + '" ' + attr + '>' + d.views.map(function (v, i) {
      return '<button type="button" class="dv6__vb" data-dvv-view="' + i + '" aria-pressed="' + (i === (k | 0)) + '">' + esc(v.label) + '</button>';
    }).join('') + '</div>';
  }
  function genHTML(d) {
    if (!d.gen) return '';
    return '<a class="dv6__gen" data-dvv-gen href="' + esc(url(d.gen)) + '"><span class="dv6__dots" aria-hidden="true">' +
      (d.mix || []).slice(0, 6).map(function (m) { return '<i style="background:#' + esc(m[0]) + '"></i>'; }).join('') +
      '</span><span>' + esc(C.genOpen || '') + '</span>' + arrowSvg + '</a><p class="dv6__gnote">' + esc(C.genNote || '') + '</p>';
  }
  function viewOf(d, k) {
    var v = d.views && d.views.length ? d.views[Math.max(0, Math.min(d.views.length - 1, k | 0))] : null;
    if (!v) return d;
    var o = {}; for (var key in d) o[key] = d[key];
    o.x = v.x; o.xm = v.xm; o.xa = v.xa; o.xma = v.xma; o.alt = v.alt; o.view = k | 0;
    return o;
  }
  function macroImg(d, cls, sizes) {
    var name = nameOf(d), alt = d.alt || fmt(C.macroAlt || '{code}', { code: d.code + (name ? ' ' + name : '') });
    if (d.xm) {
      var img = '<img src="' + esc(url(d.xm)) + '" srcset="' + esc(url(d.xm)) + ' ' + (d.wxm || 640) + 'w, ' + esc(url(d.x || d.xm)) + ' ' + (d.wx || 1000) + 'w" sizes="' + sizes + '" alt="' + esc(alt) + '" width="1000" height="1000" decoding="async">';
      if (d.xa && d.xma) return '<picture class="' + cls + '"><source type="image/avif" srcset="' + esc(url(d.xma)) + ' ' + (d.wxm || 640) + 'w, ' + esc(url(d.xa)) + ' ' + (d.wx || 1000) + 'w" sizes="' + sizes + '">' + img + '</picture>';
      return img.replace('<img ', '<img class="' + cls + '" ');
    }
    var ph = d.photo_m || d.photo;
    if (ph) return '<img class="' + cls + '" src="' + esc(url(ph)) + '" alt="' + esc(d.code + (name ? ' ' + name : '')) + '" width="1100" height="825" decoding="async">';
    return '<span class="' + cls + ' dv6__img--type"><span>' + esc(d.code) + '</span></span>';
  }

  
  var ready = {}, pending = {};
  function srcOf(d) { var w = (fig0() || {}).clientWidth || 600, dpr = window.devicePixelRatio || 1; return url(w * dpr > (d.wxm || 800) * 1.05 && d.x ? d.x : (d.xm || d.x || d.photo_m || d.photo || '')); }
  function fig0() { return view ? $('[data-dvv-fig]', view) : null; }
  function warm(d) {
    var u = d && srcOf(d); if (!u) return Promise.resolve('');
    if (ready[u]) return Promise.resolve(u);
    if (pending[u]) return pending[u];
    var im = new Image(); im.decoding = 'async'; im.src = u;
    pending[u] = (im.decode ? im.decode() : new Promise(function (r, j) { im.onload = r; im.onerror = j; })).then(function () { ready[u] = 1; delete pending[u]; return u; }, function () { delete pending[u]; return ''; });
    return pending[u];
  }
  function showInView(d, k) {
    if (!view || !d) return;
    k = k | 0;
    var key = d.code + ':' + k; if (shown === key || (shown === d.code && !k)) return;
    shown = key;
    var base = d; d = viewOf(base, k);
    var fig = fig0(), info = $('[data-dvv-info]', view);
    var vw = $('[data-dvv-views]', view), vh = viewsHTML(base, k, 'data-dvv-views');
    if (vw) { if (vh) vw.outerHTML = vh; else vw.remove(); } else if (vh && fig) fig.insertAdjacentHTML('afterend', vh);
    if (fig) {
      fig.style.backgroundImage = 'none';
      var put = function (u) {
        if (shown !== key) return;
        var cur = $('img', fig);
        if (!u || !cur) {
          if (!u) { fig.innerHTML = macroImg(d, 'dv6__img is-on', '(min-width: 1100px) 40vw, 100vw'); }
          return;
        }
        var pic = cur.closest('picture');
        if (pic) { pic.parentNode.replaceChild(cur, pic); cur.classList.add('dv6__img', 'is-on'); }
        cur.removeAttribute('srcset'); cur.removeAttribute('sizes');
        cur.src = u;
        var name = nameOf(d); cur.alt = d.alt || fmt(C.macroAlt || '{code}', { code: d.code + (name ? ' ' + name : '') });
      };
      var u0 = srcOf(d);
      if (!u0) put('');
      else if (ready[u0]) put(u0);
      else warm(d).then(put);
    }
    if (info) {
      var name = nameOf(d), desc = loc(d.desc);
      $('[data-dvv-code]', info).textContent = d.code;
      var nm = $('[data-dvv-name]', info); nm.textContent = name; nm.hidden = !name;
      var ds = $('[data-dvv-desc]', info); ds.textContent = desc; ds.hidden = !desc;
      var mt = $('[data-dvv-meta]', info); if (mt) mt.innerHTML = metaLine(d);
      var acts = $('.dv6__acts', info);
      if (acts) { $$('[data-dvv-gen], .dv6__gnote', acts).forEach(function (n) { n.remove(); }); acts.insertAdjacentHTML('afterbegin', genHTML(d)); }
    }
  }
  function pin(code, o) {
    var d = dvEntry(code); if (!d) return;
    pinned = d.code;
    $$('[data-dv-open]', grid6 || document).forEach(function (b) { if (b.getAttribute('data-dv-open') === d.code) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    showInView(d, viewK[d.code] || 0);
    if (o && o.hash) { try { history.replaceState(history.state, '', location.pathname + location.search + '#dv-' + d.code.split(' ').pop()); } catch (e) {} }
  }
  function visibleCodes() { return $$('.dv6__i', grid6 || document).filter(function (li) { return !li.hidden; }).map(function (li) { return $('[data-dv-open]', li).getAttribute('data-dv-open'); }); }
  function setFilter(cat) {
    dvFilter = cat;
    $$('[data-dvc]', dv6).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-dvc') === cat ? 'true' : 'false'); });
    $$('.dv6__i', grid6).forEach(function (li) { var on = cat === 'all' || li.getAttribute('data-cat') === cat; li.hidden = !on; li.style.display = on ? '' : 'none'; });
    $$('[data-dvc-note]', dv6).forEach(function (p) { p.hidden = p.getAttribute('data-dvc-note') !== cat; });
    var vis = visibleCodes();
    if (vis.length && vis.indexOf(pinned) < 0) pin(vis[0]);
    if (live) { live.textContent = fmt(C.shown || '{n}', { n: vis.length }); setTimeout(function () { live.textContent = ''; }, 2600); }
  }

  function openDvDialog(code, keepOpen, k) {
    var base = dvEntry(code) || { code: code }, d = viewOf(base, k | 0), name = nameOf(d), desc = loc(d.desc), list = visibleCodes(), i = list.indexOf(d.code);
    dlgCode = d.code;
    var vis = '<div class="dv6__fig dv6__fig--dlg" style="--mm:' + (d.mm || 65) + ';background-image:' + (smallOf(d) ? 'url(&quot;' + esc(url(smallOf(d))) + '&quot;)' : 'none') + '">' +
      macroImg(d, 'dv6__img is-on', '100vw') + '</div>' + viewsHTML(base, k | 0, 'data-dlg-views');
    var nav = list.length > 1 && i > -1 ? '<div class="dv6__nav"><button type="button" class="dv6__navb" data-dv-step="-1" aria-label="' + esc(C.prev || '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
      '<span class="dv6__navn">' + esc(fmt(C.of || '{n} / {total}', { n: i + 1, total: list.length })) + '</span>' +
      '<button type="button" class="dv6__navb" data-dv-step="1" aria-label="' + esc(C.next || '') + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button></div>' : '';
    var body = '<p class="cxd__sys">' + esc(C.dvColl || LS.dvColl) + '</p><h2 class="cxd__code dv6__dcode">' + esc(d.code) + '</h2>' +
      (name ? '<p class="dv6__dname">' + esc(name) + '</p>' : '') + (desc ? '<p class="cxd__desc">' + esc(desc) + '</p>' : '') +
      '<p class="dv6__meta">' + metaLine(d) + '</p>' + (d.gen ? '<div class="dv6__dgen">' + genHTML(d) + '</div>' : '') +
      '<div class="cxd__acts">' + nav + '</div>';
    if (!fillDialog(vis, body)) return;
    dlg.classList.add('cxd--dv');
    var im = $('[data-cxd-vis] img', dlg);
    if (im) im.addEventListener('error', function () { if (im.parentNode) im.parentNode.removeChild(im); });
    if (!keepOpen) openModal(dlg);
  }
  function step(n) {
    var list = visibleCodes(), i = list.indexOf(dlgCode); if (i < 0 || list.length < 2) return;
    var to = list[(i + n + list.length) % list.length];
    openDvDialog(to, true); pin(to);
    var b = $('[data-dv-step="' + (n < 0 ? -1 : 1) + '"]', dlg); if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
  }
  if (dlg) {
    dlg.addEventListener('click', function (e) {
      var s = e.target.closest('[data-dv-step]'); if (s) { step(+s.getAttribute('data-dv-step')); return; }
      var v = e.target.closest('[data-dlg-views] [data-dvv-view]');
      if (v && dlgCode) {
        var kv = +v.getAttribute('data-dvv-view'); openDvDialog(dlgCode, true, kv);
        var nb = $('[data-dlg-views] [data-dvv-view="' + kv + '"]', dlg); if (nb) { try { nb.focus({ preventScroll: true }); } catch (x) { nb.focus(); } }
      }
    });
    dlg.addEventListener('keydown', function (e) { if (dlgCode && dlg.classList.contains('cxd--dv') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); } });
    var sx = null, sy = 0;
    dlg.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse' && e.target.closest('[data-cxd-vis]')) { sx = e.clientX; sy = e.clientY; } });
    dlg.addEventListener('pointerup', function (e) { if (sx == null) return; var dx = e.clientX - sx, dy = e.clientY - sy; sx = null; if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1); });
    dlg.addEventListener('close', function () { dlg.classList.remove('cxd--dv'); dlgCode = null; });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dv-open]'); if (!b) return;
    var k = b.getAttribute('data-dv-open');
    if (view && wide()) pin(k, { hash: true });
    if (b.hasAttribute('data-scan')) return;
    openDvDialog(k);
  });
  if (dv6) {
    dv6.addEventListener('click', function (e) {
      var c = e.target.closest('[data-dvc]'); if (c) { setFilter(c.getAttribute('data-dvc')); return; }
      var cp = view && e.target.closest('[data-dvv-copy]'); if (cp) { copy(cp.getAttribute('data-copy'), cp); return; }
      var vb = view && e.target.closest('[data-dvv-views] [data-dvv-view]');
      if (vb) {
        var d0 = dvEntry(shown ? shown.split(':')[0] : pinned), kk = +vb.getAttribute('data-dvv-view');
        if (d0) { viewK[d0.code] = kk; showInView(d0, kk); var b2 = $('[data-dvv-views] [data-dvv-view="' + kk + '"]', view); if (b2) { try { b2.focus({ preventScroll: true }); } catch (x) { b2.focus(); } } }
      }
    });
    if (grid6 && view) {
      var preview = function (b) {
        clearTimeout(leaveT); clearTimeout(hoverT);
        var d = dvEntry(b.getAttribute('data-dv-open')); if (d) showInView(d);
        var sv = (window.DVATONE || {}).scans; if (sv && sv.warm) sv.warm(b);
      };
      grid6.addEventListener('pointerover', function (e) {
        if (!wide() || !(fineMq && fineMq.matches) || e.pointerType === 'touch') return;
        var b = e.target.closest('[data-dv-open]'); if (b) preview(b);
      });
      grid6.addEventListener('pointerleave', function () {
        clearTimeout(hoverT); clearTimeout(leaveT);
        leaveT = setTimeout(function () { var d = dvEntry(pinned); if (d) showInView(d, viewK[d.code] || 0); }, 120);
      });
      grid6.addEventListener('focusin', function (e) { if (!wide()) return; var b = e.target.closest('[data-dv-open]'); if (b) preview(b); });
      grid6.addEventListener('focusout', function (e) { if (!grid6.contains(e.relatedTarget)) { clearTimeout(hoverT); var d = dvEntry(pinned); if (d) showInView(d); } });
    }
    var hcode = function (d) { var m = /^(\d{1,3})(\.\d)?$/.exec(d); return 'DV ' + ('00' + m[1]).slice(-3) + (m[2] || ''); };
    var hm = /^#dv-(\d{1,3}(?:\.\d)?)$/.exec(location.hash || ''), first = $('[data-dv-open]', grid6 || dv6);
    var start = hm && tileOf(hcode(hm[1])) ? hcode(hm[1]) : (first && first.getAttribute('data-dv-open'));
    shown = (DVL[0] && DVL[0].code) || null;
    if (start) pin(start);
    if (view && wide() && fineMq && fineMq.matches) {
      var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
      var queue = visibleCodes().map(dvEntry).filter(Boolean), step6 = function () { var d = queue.shift(); if (!d) return; warm(d).then(function () { idle(step6); }); };
      setTimeout(function () { idle(step6); }, 1200);
    }
    if (grid6) grid6.addEventListener('pointerdown', function (e) { var b = e.target.closest('[data-scan]'); var sv = (window.DVATONE || {}).scans; if (b && sv && sv.warm) sv.warm(b); }, { passive: true });
    window.addEventListener('hashchange', function () {
      var h = /^#dv-(\d{1,3}(?:\.\d)?)$/.exec(location.hash || ''); if (!h) return;
      var c = hcode(h[1]); if (!tileOf(c)) return;
      if (visibleCodes().indexOf(c) < 0) setFilter('all');
      pin(c);
    });
  }

  var grid = $('[data-cat-grid]');
  if (grid) digital(grid);
  else if (location.hash === '#digital' && !document.getElementById('digital')) {
    var dvSec = document.getElementById('dv');
    if (dvSec) {
      try { history.replaceState(history.state, '', location.pathname + location.search + '#dv'); } catch (e) {}
      try { dvSec.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (e) { dvSec.scrollIntoView(true); }
    }
  }

  function digital(grid) {
    var SYS = { N: 'NCS', F: '5051', R: 'RAL' };
    var TEX = {}; (C.tex || []).forEach(function (h) { TEX[h] = 1; });
    var MAXPICK = 6, CHUNK = 30, MAXWIN = 150, AHEAD = 900;

    var items = [];
    (window.DV_CAT || '').split(';').forEach(function (r) {
      var p = r.split('|'); if (p.length < 3) return;
      items.push({ id: p[0] + '|' + p[1], sys: p[0], code: p[1], hex: p[2], label: SYS[p[0]] + ' ' + p[1], key: strip(SYS[p[0]] + p[1] + p[2]) });
    });
    items.sort(function (a, b) { return (TEX[b.hex] ? 1 : 0) - (TEX[a.hex] ? 1 : 0); });
    items.forEach(function (it, i) { it.i = i; });
    var q = '', filter = 'all', list = items, lo = 0, hi = 0, cap = 0;
    (function () {
      var st = document.createElement('style'); st.setAttribute('data-dv-cat', '');
      st.textContent = '.cx__num{white-space:nowrap}' +
        '.cx__sw img{transition:opacity .35s var(--ease,ease)}.cx__sw img:not(.is-ok){opacity:0}' +
        '@media (hover:none){.cxd__acts .btn--line-l:hover{background:none;color:var(--tl);border-color:var(--line-l2)}}' +
        'html{overflow-anchor:none}' +
        '.cxd__acts .cxd__go{order:-1;flex:0 0 auto;justify-content:center;gap:10px;height:44px;font-size:10.5px}' +
        '.cxd__go svg{flex:none;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.4}.cxd__acts .cxd__go.is-off{visibility:hidden}' +
        '@media (max-width:700px){.cxd__acts .cxd__go{flex:1 1 100%}.cxd__acts .cxd__go.is-off{display:none}}';
      document.head.appendChild(st);
    })();

    var rgb = function (h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };

    var picks = [];
    var byId = function (id) { for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i]; return null; };
    var firstByHex = function (h) { for (var i = 0; i < items.length; i++) if (items[i].hex === h.toUpperCase()) return items[i]; return null; };
    try {
      JSON.parse(sessionStorage.getItem('dv-picks') || '[]').forEach(function (v) {
        var it = /^[0-9A-F]{6}$/i.test(v) ? firstByHex(v) : byId(v);
        if (it && picks.indexOf(it.id) < 0 && picks.length < MAXPICK) picks.push(it.id);
      });
    } catch (e) { picks = []; }
    var savePicks = function () { try { sessionStorage.setItem('dv-picks', JSON.stringify(picks)); } catch (e) {} };
    var tray = $('[data-cat-tray]');
    function genHref() {
      var hexes = []; picks.forEach(function (id) { var it = byId(id); if (it && hexes.indexOf(it.hex) < 0) hexes.push(it.hex); });
      return C.generator + '?add=' + hexes.join(',');
    }
    function renderTray() {
      if (!tray) return;
      tray.hidden = !picks.length;
      $('[data-cat-tray-sw]', tray).innerHTML = picks.map(function (id) {
        var it = byId(id); if (!it) return '';
        return '<button type="button" class="tray__sw" data-pick="' + esc(id) + '" style="background:#' + it.hex + '" aria-label="' + esc(C.remove + ': ' + it.label) + '" title="' + esc(it.label) + '"></button>';
      }).join('');
      var tn = $('[data-cat-tray-n]', tray); tn.textContent = picks.length + ' / ' + MAXPICK; tn.classList.toggle('is-limit', picks.length >= MAXPICK);
      $('[data-cat-tray-go]', tray).setAttribute('href', genHref());
      $$('[data-add]', grid).forEach(function (b) { var on = picks.indexOf(b.getAttribute('data-add')) > -1; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      syncDialogAdd();
    }
    function togglePick(id) {
      var i = picks.indexOf(id);
      if (i > -1) picks.splice(i, 1); else if (picks.length < MAXPICK) picks.push(id); else { flash(fmt(C.max, { max: MAXPICK }), 'warn'); var tn = tray && $('[data-cat-tray-n]', tray); if (tn) tn.classList.add('is-limit'); return; }
      savePicks(); renderTray();
    }
    if (tray) tray.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pick]'); if (!b) return;
      var idx = $$('[data-pick]', tray).indexOf(b), id = b.getAttribute('data-pick');
      togglePick(id);
      var rest = $$('[data-pick]', tray), nb = rest[Math.min(idx, rest.length - 1)];
      if (nb) nb.focus(); else { var card = $$('[data-add]', grid).filter(function (x) { return x.getAttribute('data-add') === id; })[0]; (card || si || document.body).focus(); }
    });

    var plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
    var copyIco = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5v-2a1.5 1.5 0 0 0-1.5-1.5H6.5A1.5 1.5 0 0 0 5 6.5V14a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
    var arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    var texOk = {};
    function swatchHTML(it) {
      if (!TEX[it.hex]) return '<span class="cx__flat" style="background:#' + it.hex + '"></span>';
      var t = base + 'assets/img/tex/' + it.hex;
      return '<img' + (texOk[it.hex] ? ' class="is-ok"' : '') + ' src="' + t + '-s.webp" srcset="' + t + '-s.webp 260w, ' + t + '-m.webp 520w" sizes="(max-width:700px) 46vw, 220px" alt="" loading="lazy" decoding="async" fetchpriority="low" width="520" height="598">' +
        '<span class="cx__photo" aria-hidden="true">' + C.photo + '</span>';
    }
    function card(it, n) {
      return '<li class="cx" data-i="' + it.i + '" aria-posinset="' + (n + 1) + '" aria-setsize="' + list.length + '">' +
        '<button type="button" class="cx__sw" data-open="' + it.i + '"' + (TEX[it.hex] ? ' style="background:#' + it.hex + '"' : '') + ' aria-label="' + esc(C.open + ': ' + it.label) + '">' + swatchHTML(it) + '</button>' +
        '<button type="button" class="cx__add" data-add="' + esc(it.id) + '" aria-pressed="' + (picks.indexOf(it.id) > -1) + '" aria-label="' + esc(C.add + ': ' + it.label) + '" title="' + esc(C.add) + '">' + plus + '</button>' +
        '<div class="cx__meta"><div><b class="cx__code">' + SYS[it.sys] + ' <span class="cx__num">' + esc(it.code) + '</span></b><span class="cx__hex">#' + it.hex + '</span></div>' +
        '<button type="button" class="cx__copy" data-copy="' + esc(it.label) + '" aria-label="' + esc(C.copy + ': ' + it.label) + '" title="' + esc(C.copy) + '">' + copyIco + '</button></div></li>';
    }
    var cnt = $('[data-cat-count]'), more = $('[data-cat-more]'), empty = $('[data-cat-empty]');
    if (cnt) cnt.removeAttribute('aria-live');

    var spacer = null, sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true'); sentinel.style.cssText = 'height:1px;margin-top:-1px;pointer-events:none';
    grid.insertAdjacentElement('afterend', sentinel);
    grid.style.overflowAnchor = 'none';
    grid.addEventListener('load', function (e) {
      var im = e.target, li = im && im.tagName === 'IMG' && im.closest('.cx'); if (!li) return;
      im.classList.add('is-ok'); var it = items[+li.getAttribute('data-i')]; if (it) texOk[it.hex] = 1;
    }, true);
    var colsN = function () { var t = getComputedStyle(grid).gridTemplateColumns; return Math.max(1, t && t !== 'none' ? t.split(' ').length : 1); };
    var gapY = function () { return parseFloat(getComputedStyle(grid).rowGap) || 0; };
    var pageSize = function () { return (mq && mq.matches ? 45 : 30) * colsN(); };
    var offTop = function (el) { return el.getBoundingClientRect().top + window.scrollY; };
    var cardsIn = function () { return grid.querySelectorAll('li.cx'); };
    var html = function (a, b) { var h = ''; for (var i = a; i < b; i++) h += card(list[i], i); return h; };
    function jumpBy(dy) {
      try { window.scrollBy({ top: dy, left: 0, behavior: 'instant' }); }
      catch (e) { var r = document.documentElement.style, b = r.scrollBehavior; r.scrollBehavior = 'auto'; window.scrollBy(0, dy); r.scrollBehavior = b; }
    }
    function held(cs, a, b) {
      var act = document.activeElement, i;
      if (!act || !grid.contains(act)) return false;
      try { if (!act.matches(':focus-visible')) return false; } catch (e) {}
      for (i = a; i < b; i++) if (cs[i].contains(act)) return true;
      return false;
    }
    function setSpacer(h, gap) {
      if (h < 1) { if (spacer) { spacer.remove(); spacer = null; } return; }
      if (!spacer) {
        spacer = document.createElement('li'); spacer.className = 'cgrid__gap'; spacer.setAttribute('aria-hidden', 'true');
        spacer.style.cssText = 'grid-column:1/-1;margin:0;padding:0;border:0;list-style:none;pointer-events:none';
        grid.insertBefore(spacer, grid.firstChild);
      }
      spacer.style.height = h + 'px'; spacer.style.marginBottom = (-gap) + 'px';
    }
    function status() {
      if (cnt) cnt.textContent = list.length ? fmt(C.count, { n: nf(hi), total: nf(list.length) }) : '';
      if (more) more.hidden = hi >= list.length;
    }
    
    function appendChunk() {
      if (hi >= list.length) return false;
      var n = colsN(), end = Math.min(list.length, hi + Math.ceil(CHUNK / n) * n);
      var k = Math.floor((end - lo - MAXWIN) / n) * n, h = 0, gap = 0, cs = null, i;
      if (k >= n) {
        cs = cardsIn();
        if (cs.length <= k || cs[k - 1].getBoundingClientRect().bottom > -window.innerHeight * 0.6 || held(cs, 0, k)) k = 0;
        else { h = offTop(cs[k]) - offTop(grid); gap = gapY(); }
      } else k = 0;
      grid.insertAdjacentHTML('beforeend', html(hi, end)); hi = end;
      if (k) { for (i = 0; i < k; i++) cs[i].remove(); lo += k; setSpacer(h, gap); }
      status();
      return true;
    }
    function prependChunk() {
      if (lo <= 0 || !spacer) return false;
      var n = colsN(), c = Math.min(lo, Math.ceil(CHUNK / n) * n), from = lo - c, cs = cardsIn(), anchor = cs[0]; if (!anchor) return false;
      var a0 = offTop(anchor), h0 = parseFloat(spacer.style.height) || 0, gap = gapY();
      var k = Math.floor((hi - from - MAXWIN) / n) * n, cut = cs.length - k, j;
      if (k < n || cut <= 0 || cs[cut].getBoundingClientRect().top <= window.innerHeight * 1.6 || held(cs, cut, cs.length)) k = 0;
      spacer.insertAdjacentHTML('afterend', html(from, lo)); lo = from;
      var added = offTop(anchor) - a0, nh = lo === 0 ? 0 : Math.max(0, h0 - added);
      setSpacer(nh, gap);
      if (nh < 1) { var shift = offTop(anchor) - a0; if (Math.abs(shift) > 1) jumpBy(shift); }
      if (k) { for (j = cs.length - 1; j >= cut; j--) cs[j].remove(); hi -= k; }
      status();
      return true;
    }
    var fillRaf = 0;
    function fill() {
      if (fillRaf) cancelAnimationFrame(fillRaf);
      fillRaf = 0;
      var vh = window.innerHeight, go = false;
      if (hi < Math.min(list.length, cap) && sentinel.getBoundingClientRect().top < vh + AHEAD) go = appendChunk();
      else if (spacer && lo > 0 && spacer.getBoundingClientRect().bottom > -AHEAD) go = prependChunk();
      if (go) fillSoon();
    }
    var fillSoon = function () { if (!fillRaf) fillRaf = requestAnimationFrame(fill); };
    window.addEventListener('scroll', fillSoon, { passive: true }); window.addEventListener('resize', fillSoon);

    function apply(byReader) {
      var nq = normQ(q);
      var y0 = si ? si.getBoundingClientRect().top : NaN, vh = window.innerHeight, wrap = tool && tool.parentNode, w0 = wrap ? wrap.getBoundingClientRect().top : 0;
      var stuck = !!tool && Math.abs(tool.getBoundingClientRect().top - (parseFloat(getComputedStyle(tool).top) || 0)) < 1.5;
      list = items.filter(function (it) {
        if (filter !== 'all' && SYS[it.sys].toLowerCase() !== filter) return false;
        return !nq || it.key.indexOf(nq) > -1;
      });
      lo = hi = 0; setSpacer(0); grid.innerHTML = '';
      cap = pageSize();
      appendChunk(); status(); fill();
      if (live && (nq || filter !== 'all')) { clearTimeout(apply._t); apply._t = setTimeout(function () { live.textContent = fmt(LS.results, { n: nf(list.length) }); }, 400); }
      var dvHit = 0;
      $$('[data-dv-card]').forEach(function (c) {
        var t = strip(c.getAttribute('data-dv-card')), ok = !nq || t.indexOf(strip(q)) > -1;
        c.hidden = !ok; c.style.display = ok ? '' : 'none';
        if (ok) dvHit++;
      });
      var dvSec = $('[data-dv-section]'); if (dvSec) dvSec.classList.toggle('is-filtered', !!nq && !dvHit);
      if (y0 > -vh / 2 && y0 < vh) {
        var dy = !wrap ? si.getBoundingClientRect().top - y0 : stuck ? Math.max(0, si.getBoundingClientRect().top - y0) : wrap.getBoundingClientRect().top - w0;
        if (Math.abs(dy) > 1) jumpBy(dy);
      }
      if (empty) {
        empty.hidden = !!list.length || dvHit > 0;
        $('[data-cat-empty-text]', empty).textContent = fmt(C.emptyText, { query: q });
        dvNote(!list.length && dvHit > 0 ? dvHit : 0);
      }
      sheetSync();
      if (byReader) toResults();
    }
    var hdrEl = $('#hdr');
    function toResults() {
      if (!tool) return;
      if (tool.getAnimations) tool.getAnimations().forEach(function (a) { try { a.finish(); } catch (e) {} });
      var stick = parseFloat(getComputedStyle(tool).top); if (isNaN(stick)) return;
      var dy = grid.getBoundingClientRect().top - (stick + tool.offsetHeight) - 12;
      if (dy >= -1) return;
      if (hdrEl && hdrEl.classList.contains('is-hidden')) dy -= NS_inset();
      jumpBy(dy);
    }
    var dvNoteEl = null;
    function dvNote(n) {
      if (!n) { if (dvNoteEl) dvNoteEl.hidden = true; return; }
      if (!dvNoteEl) {
        dvNoteEl = document.createElement('div'); dvNoteEl.className = 'cempty'; dvNoteEl.setAttribute('data-cat-dvnote', ''); dvNoteEl.setAttribute('role', 'status');
        dvNoteEl.innerHTML = '<h3></h3><p><a href="#dv" style="color:inherit;text-decoration:underline;text-underline-offset:3px"></a></p>';
        empty.parentNode.insertBefore(dvNoteEl, empty);
      }
      $('h3', dvNoteEl).textContent = fmt(LS.dvFound, { n: n }); $('a', dvNoteEl).textContent = LS.dvGo; dvNoteEl.hidden = false;
    }
    if (more) more.addEventListener('click', function () {
      cap = Math.max(cap, hi) + pageSize();
      var y = window.scrollY, first = hi; appendChunk();
      void more.offsetTop; if (Math.abs(window.scrollY - y) > 1) jumpBy(y - window.scrollY);
      var cs = cardsIn(), b = null;
      for (var i = 0; i < cs.length; i++) if (cs[i].getAttribute('aria-posinset') === String(first + 1)) { b = $('.cx__sw', cs[i]); break; }
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
      fillSoon();
    });
    $$('[data-cat-filter]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-cat-filter') === filter) return;
        filter = b.getAttribute('data-cat-filter');
        $$('[data-cat-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        apply(true);
      });
    });
    var si = $('[data-cat-search]');
    if (si) {
      var t = 0;
      si.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { var v = si.value.trim(); if (v === q) return; q = v; apply(true); }, 120); });
      var rst = $('[data-cat-reset]');
      if (rst) rst.addEventListener('click', function () { si.value = ''; q = ''; apply(true); si.focus(); });
    }
    var dl = /[?&]q=([^&]+)/.exec(location.search); if (dl && si) { try { si.value = q = decodeURIComponent(dl[1].replace(/\+/g, ' ')); } catch (e) {} }

    var tool = $('.ctool'), fbox = $('.ctool__f'), fbtn = null, sheet = null, sheetOk = null, sheetBody = null;
    function sheetSync() {
      if (!fbtn) return;
      var on = $('[data-cat-filter][aria-pressed="true"]'), v = $('.dvfbtn__v', fbtn), name = on ? on.textContent.trim() : '';
      if (v) v.textContent = filter === 'all' ? name.toLowerCase() : name;
      fbtn.classList.toggle('is-set', filter !== 'all');
      if (sheetOk) $('span', sheetOk).textContent = fmt(LS.show, { n: nf(list.length) });
    }
    function buildSheet() {
      var st = document.createElement('style'); st.setAttribute('data-dv-sheet', '');
      st.textContent =
        '.ctool.has-sheet{flex-wrap:wrap;gap:var(--s-4,16px) 10px}.ctool.has-sheet .csearch{order:-1;flex:1 1 100%;min-width:0;max-width:none}' +
        '.ctool.has-sheet .ctool__n{flex:1 1 auto;width:auto;margin:0 0 0 auto;text-align:right}' +
        '.dvfbtn{flex:none;display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 16px 0 14px;border:1px solid var(--line-l2,rgba(25,21,17,.2));border-radius:999px;background:transparent;color:inherit;font:500 13px/1 var(--f-sans,inherit);cursor:pointer;-webkit-tap-highlight-color:transparent}' +
        '.dvfbtn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round}.dvfbtn__v{font-weight:600}.dvfbtn.is-set{background:var(--tl,#191511);color:var(--bone,#f7f4ef);border-color:var(--tl,#191511)}' +
        '.dvsheet{position:fixed;inset:auto 0 0 0;margin:0;width:100%;max-width:none;max-height:min(82vh,82dvh,600px);padding:0;border:0;border-radius:18px 18px 0 0;background:var(--paper,#f7f4ef);color:var(--tl,#191511);box-shadow:0 -18px 50px rgba(0,0,0,.35);overflow:hidden;overscroll-behavior:contain}' +
        '.dvsheet[open]{display:flex;flex-direction:column;animation:dvsheet-in .3s cubic-bezier(.2,.8,.2,1)}.dvsheet::backdrop{background:rgba(18,16,14,.62)}' +
        '@keyframes dvsheet-in{from{transform:translateY(100%)}}' +
        '.dvsheet__head{flex:none;position:relative;display:flex;align-items:center;justify-content:space-between;padding:22px 8px 4px 20px;touch-action:none;cursor:grab}' +
        '.dvsheet__head::before{content:"";position:absolute;left:50%;top:8px;width:40px;height:4px;margin-left:-20px;border-radius:2px;background:currentColor;opacity:.22}' +
        '.dvsheet__head h3{margin:0;font-weight:500;font-size:17px;letter-spacing:-.01em}.dvsheet__x{width:44px;height:44px;display:grid;place-items:center;border-radius:50%;color:inherit}' +
        '.dvsheet__x svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.4}' +
        '.dvsheet__body{flex:1 1 auto;min-height:0;overflow:auto;padding:8px 20px 12px}.dvsheet .ctool__f{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
        '.dvsheet .pill{height:52px;justify-content:center;font-size:15px}' +
        '.dvsheet__foot{flex:none;padding:12px 20px calc(16px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--line-l,rgba(25,21,17,.1))}.dvsheet__foot .btn{width:100%;justify-content:center}' +
        '@media (prefers-reduced-motion:reduce){.dvsheet[open]{animation:none}}';
      document.head.appendChild(st);
      fbtn = document.createElement('button'); fbtn.type = 'button'; fbtn.className = 'dvfbtn'; fbtn.setAttribute('aria-haspopup', 'dialog');
      fbtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg><span>' + esc(LS.filters) + ': <b class="dvfbtn__v"></b></span>';
      sheet = document.createElement('dialog'); sheet.className = 'dvsheet'; sheet.setAttribute('aria-labelledby', 'dvsheetT');
      sheet.innerHTML = '<div class="dvsheet__head"><h3 id="dvsheetT">' + esc(LS.filtersTitle) + '</h3><button type="button" class="dvsheet__x" aria-label="' + esc(LS.close) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg></button></div>' +
        '<div class="dvsheet__body"></div><div class="dvsheet__foot"><button type="button" class="btn btn--ink dvsheet__ok"><span></span></button></div>';
      document.body.appendChild(sheet);
      sheetBody = $('.dvsheet__body', sheet); sheetOk = $('.dvsheet__ok', sheet);
      bindModal(sheet);
      fbtn.addEventListener('click', function () {
        openModal(sheet);
        var on = $('[data-cat-filter][aria-pressed="true"]', sheet); if (on) on.focus();
      });
      var shut = function () { if (sheet.open) sheet.close(); };
      $('.dvsheet__x', sheet).addEventListener('click', shut); sheetOk.addEventListener('click', shut);
      sheet.addEventListener('click', function (e) { if (e.target === sheet) shut(); });
      sheet.addEventListener('close', function () { sheet.style.transform = ''; sheet.style.transition = ''; });
      var head = $('.dvsheet__head', sheet), y0 = null, dy = 0;
      head.addEventListener('pointerdown', function (e) { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; try { head.setPointerCapture(e.pointerId); } catch (x) {} });
      head.addEventListener('pointermove', function (e) { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); sheet.style.transition = 'none'; sheet.style.transform = 'translateY(' + dy + 'px)'; });
      var up = function () { if (y0 == null) return; y0 = null; if (dy > 90) shut(); else { sheet.style.transition = 'transform .2s ease'; sheet.style.transform = ''; } dy = 0; };
      head.addEventListener('pointerup', up); head.addEventListener('pointercancel', up);
    }
    var NS_inset = function () { return NS.topInset ? NS.topInset() : 70; };
    function sheetLayout() {
      if (!tool || !fbox || !mq) return;
      if (mq.matches) {
        if (!sheet) buildSheet();
        sheetBody.appendChild(fbox); tool.insertBefore(fbtn, tool.firstChild); tool.classList.add('has-sheet');
      } else if (sheet) {
        if (sheet.open) sheet.close();
        tool.insertBefore(fbox, tool.firstChild); if (fbtn.parentNode) fbtn.remove(); tool.classList.remove('has-sheet');
      }
      sheetSync();
    }
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', sheetLayout); else if (mq.addListener) mq.addListener(sheetLayout); }

    function openShade(it) {
      var c = rgb(it.hex);
      var vis = TEX[it.hex] ? '<img src="' + base + 'assets/img/tex/' + it.hex + '.webp" alt="' + esc(it.label) + '" width="720" height="480">' : '<div class="cxd__flat" style="background:#' + it.hex + '"></div>';
      var body = '<p class="cxd__sys">' + esc(C.standard) + ': ' + SYS[it.sys] + '</p><h2 class="cxd__code">' + esc(it.label) + '</h2>' +
        '<dl class="cxd__dl"><div><dt>HEX</dt><dd>#' + it.hex + '</dd></div><div><dt>RGB</dt><dd>' + c.join(' · ') + '</dd></div></dl>' +
        '<p class="cxd__note">' + esc(TEX[it.hex] ? C.noteTex : C.noteFlat) + '</p>' +
        '<div class="cxd__acts"><button type="button" class="btn btn--ink btn--sm" data-dlg-add="' + esc(it.id) + '"><span></span></button><button type="button" class="btn btn--line-l btn--sm" data-copy="' + esc(it.label) + '"><span>' + esc(C.copyCode || LS.copyCode) + '</span></button>' +
        '<a class="btn-text cxd__go is-off" data-dlg-go href="' + esc(C.generator || 'generator.html') + '"><span></span>' + arrow + '</a></div>';
      if (!fillDialog(vis, body)) return;
      syncDialogAdd();
      openModal(dlg);
    }
    function syncDialogAdd() {
      var b = dlg && $('[data-dlg-add]', dlg); if (!b) return;
      var on = picks.indexOf(b.getAttribute('data-dlg-add')) > -1;
      b.classList.toggle('btn--ink', !on); b.classList.toggle('btn--line-l', on);
      $('span', b).textContent = on ? LS.unpick : C.add;
      var go = $('[data-dlg-go]', dlg); if (!go) return;
      go.classList.toggle('is-off', !picks.length);
      go.setAttribute('href', genHref()); $('span', go).textContent = fmt(LS.toGen, { n: picks.length });
    }
    if (dlg) dlg.addEventListener('click', function (e) {
      var a = e.target.closest('[data-dlg-add]'); if (a) togglePick(a.getAttribute('data-dlg-add'));
    });
    document.addEventListener('click', function (e) {
      var o = e.target.closest('[data-open]'); if (o && grid.contains(o)) { openShade(items[+o.getAttribute('data-open')]); return; }
      var a = e.target.closest('[data-add]'); if (a && grid.contains(a)) { togglePick(a.getAttribute('data-add')); return; }
      var c = e.target.closest('.cx__copy'); if (c) copy(c.getAttribute('data-copy'), c);
    });

    apply(); renderTray(); sheetLayout();
  }
})();
