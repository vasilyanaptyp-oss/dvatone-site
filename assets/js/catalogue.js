/* DVATONE digital catalogue: browse, filter and search the real shades (assets/data/catalog.js, system|code|hex),
   named DV collection (assets/data/dv-collection.js), picks tray that hands shades to the generator (?add=HEX,HEX).
   No texture is invented: a card shows a photo only when a real scan exists in assets/img/tex/<HEX>.webp (TEX below);
   otherwise a flat screen colour of the catalogue hex. DV colours without a scan get a neutral card (no colour, no texture). */
(function () {
  'use strict';
  var DV = window.DV || {}, C = DV.cat || {}, base = DV.base || '', lang = DV.lang === 'en' ? 'en' : 'uk';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SYS = { N: 'NCS', F: '5051', R: 'RAL' };
  var TEX = {}; (C.tex || []).forEach(function (h) { TEX[h] = 1; });
  var PAGE = 48, MAXPICK = 6;

  var items = [];
  (window.DV_CAT || '').split(';').forEach(function (r) {
    var p = r.split('|'); if (p.length < 3) return;
    items.push({ sys: p[0], code: p[1], hex: p[2], label: SYS[p[0]] + ' ' + p[1], key: (SYS[p[0]] + p[1] + p[2]).toLowerCase().replace(/[\s#]/g, '') });
  });
  items.sort(function (a, b) { return (TEX[b.hex] ? 1 : 0) - (TEX[a.hex] ? 1 : 0); });   // shades with a real sample photo first, the rest stays in hue order
  var grid = $('[data-cat-grid]'); if (!grid) return;
  var q = '', filter = 'all', shown = 0, list = items;

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rgb = function (h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  var fmt = function (s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); };

  /* ---------- picks (hand-off to the generator) ---------- */
  var picks = [];
  try { picks = JSON.parse(sessionStorage.getItem('dv-picks') || '[]').filter(function (h) { return /^[0-9A-F]{6}$/i.test(h); }).slice(0, MAXPICK); } catch (e) { picks = []; }
  var savePicks = function () { try { sessionStorage.setItem('dv-picks', JSON.stringify(picks)); } catch (e) {} };
  var byHex = function (h) { for (var i = 0; i < items.length; i++) if (items[i].hex === h) return items[i]; return null; };
  var tray = $('[data-cat-tray]');
  function renderTray() {
    if (!tray) return;
    tray.hidden = !picks.length;
    $('[data-cat-tray-sw]', tray).innerHTML = picks.map(function (h) {
      var it = byHex(h);
      return '<button type="button" class="tray__sw" data-pick="' + h + '" style="background:#' + h + '" aria-label="' + esc(C.remove + ': ' + (it ? it.label : h)) + '" title="' + esc(it ? it.label : h) + '"></button>';
    }).join('');
    $('[data-cat-tray-n]', tray).textContent = picks.length + ' / ' + MAXPICK;
    $('[data-cat-tray-go]', tray).setAttribute('href', C.generator + '?add=' + picks.join(','));
    $$('[data-add]', grid).forEach(function (b) { var on = picks.indexOf(b.getAttribute('data-add')) > -1; b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    syncDialogAdd();
  }
  function togglePick(h) {
    var i = picks.indexOf(h);
    if (i > -1) picks.splice(i, 1); else if (picks.length < MAXPICK) picks.push(h); else { flash(fmt(C.max, { max: MAXPICK })); return; }
    savePicks(); renderTray();
  }
  var live = $('[data-cat-live]');
  function flash(t) { if (live) { live.textContent = t; clearTimeout(flash._t); flash._t = setTimeout(function () { live.textContent = ''; }, 2600); } }
  if (tray) tray.addEventListener('click', function (e) { var b = e.target.closest('[data-pick]'); if (b) togglePick(b.getAttribute('data-pick')); });

  /* ---------- cards ---------- */
  var plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
  var copyIco = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5v-2a1.5 1.5 0 0 0-1.5-1.5H6.5A1.5 1.5 0 0 0 5 6.5V14a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
  function swatchHTML(it) {
    return TEX[it.hex] ? '<img src="' + base + 'assets/img/tex/' + it.hex + '.webp" alt="" loading="lazy" width="720" height="480"><span class="cx__photo" aria-hidden="true">' + C.photo + '</span>' : '<span class="cx__flat" style="background:#' + it.hex + '"></span>';
  }
  function card(it, i) {
    return '<li class="cx" data-i="' + i + '">' +
      '<button type="button" class="cx__sw" data-open="' + i + '" aria-label="' + esc(C.open + ': ' + it.label) + '">' + swatchHTML(it) + '</button>' +
      '<button type="button" class="cx__add" data-add="' + it.hex + '" aria-pressed="' + (picks.indexOf(it.hex) > -1) + '" aria-label="' + esc(C.add + ': ' + it.label) + '" title="' + esc(C.add) + '">' + plus + '</button>' +
      '<div class="cx__meta"><div><b class="cx__code">' + esc(it.label) + '</b><span class="cx__hex">#' + it.hex + '</span></div>' +
      '<button type="button" class="cx__copy" data-copy="' + esc(it.label) + '" aria-label="' + esc(C.copy + ': ' + it.label) + '" title="' + esc(C.copy) + '">' + copyIco + '</button></div></li>';
  }
  var cnt = $('[data-cat-count]'), more = $('[data-cat-more]'), empty = $('[data-cat-empty]');
  function apply() {
    var nq = q.toLowerCase().replace(/[\s#]/g, '');
    list = items.filter(function (it) {
      if (filter !== 'all' && SYS[it.sys].toLowerCase() !== filter) return false;
      return !nq || it.key.indexOf(nq) > -1;
    });
    shown = 0; grid.innerHTML = ''; page();
    // DV collection follows the search too
    var dvHit = 0;
    $$('[data-dv-card]').forEach(function (c) {
      var t = (c.getAttribute('data-dv-card') || '').toLowerCase().replace(/[\s#]/g, ''), ok = !nq || t.indexOf(nq) > -1;
      c.hidden = !ok; if (ok) dvHit++;
    });
    var dvSec = $('[data-dv-section]'); if (dvSec) dvSec.classList.toggle('is-filtered', !!nq && !dvHit);
    if (empty) {
      empty.hidden = !!list.length;
      $('[data-cat-empty-text]', empty).textContent = fmt(C.emptyText, { query: q });
    }
  }
  function page() {
    var end = Math.min(list.length, shown + PAGE), h = '';
    for (var i = shown; i < end; i++) h += card(list[i], items.indexOf(list[i]));
    grid.insertAdjacentHTML('beforeend', h); shown = end;
    if (cnt) cnt.textContent = fmt(C.count, { n: shown, total: list.length });
    if (more) more.hidden = shown >= list.length;
  }
  if (more) more.addEventListener('click', function () { var y = window.scrollY; page(); window.scrollTo(0, y); });
  $$('[data-cat-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-cat-filter');
      $$('[data-cat-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      apply();
    });
  });
  var si = $('[data-cat-search]');
  if (si) {
    var t = 0;
    si.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { q = si.value.trim(); apply(); }, 120); });
    var rst = $('[data-cat-reset]');
    if (rst) rst.addEventListener('click', function () { si.value = ''; q = ''; filter = 'all'; $$('[data-cat-filter]').forEach(function (x) { x.setAttribute('aria-pressed', x.getAttribute('data-cat-filter') === 'all' ? 'true' : 'false'); }); apply(); si.focus(); });
  }
  // deep link from the generator or the home page: ?q=RAL 1039
  var dl = /[?&]q=([^&]+)/.exec(location.search); if (dl && si) { try { si.value = q = decodeURIComponent(dl[1].replace(/\+/g, ' ')); } catch (e) {} }

  /* ---------- copy ---------- */
  function copy(text) {
    var done = function () { flash(C.copied + ': ' + text); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, done); else done();
  }

  /* ---------- dialog ---------- */
  var dlg = $('[data-cat-dialog]'), cur = null;
  function openDialog(it, dvEntry) {
    if (!dlg) return;
    cur = it;
    var vis, body;
    if (dvEntry) {
      var d = dvEntry;
      vis = d.photo ? '<img src="' + base + d.photo + '" alt="' + esc(d.code + ' ' + d.name[lang]) + '">' : '<div class="cxd__neutral"><span>' + esc(d.code) + '</span></div>';
      body = '<p class="cxd__sys">' + esc(C.dvColl) + '</p><h2 class="cxd__code">' + esc(d.code) + '</h2><p class="cxd__name">' + esc(d.name[lang]) + '</p><p class="cxd__desc">' + esc(d.desc[lang]) + '</p>' +
        '<div class="cxd__acts"><button type="button" class="btn btn--ink btn--sm" data-copy="' + esc(d.code) + '"><span>' + esc(C.copyCode) + '</span></button></div>';
    } else {
      var c = rgb(it.hex);
      vis = TEX[it.hex] ? '<img src="' + base + 'assets/img/tex/' + it.hex + '.webp" alt="' + esc(it.label) + '" width="720" height="480">' : '<div class="cxd__flat" style="background:#' + it.hex + '"></div>';
      body = '<p class="cxd__sys">' + esc(C.standard) + ': ' + SYS[it.sys] + '</p><h2 class="cxd__code">' + esc(it.label) + '</h2>' +
        '<dl class="cxd__dl"><div><dt>HEX</dt><dd>#' + it.hex + '</dd></div><div><dt>RGB</dt><dd>' + c.join(' · ') + '</dd></div></dl>' +
        '<p class="cxd__note">' + esc(TEX[it.hex] ? C.noteTex : C.noteFlat) + '</p>' +
        '<div class="cxd__acts"><button type="button" class="btn btn--ink btn--sm" data-dlg-add="' + it.hex + '" aria-pressed="false"><span></span></button><button type="button" class="btn btn--line-l btn--sm" data-copy="' + esc(it.label) + '"><span>' + esc(C.copyCode) + '</span></button></div>';
    }
    $('[data-cxd-vis]', dlg).innerHTML = vis; $('[data-cxd-body]', dlg).innerHTML = body;
    syncDialogAdd();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function syncDialogAdd() {
    var b = dlg && $('[data-dlg-add]', dlg); if (!b) return;
    var on = picks.indexOf(b.getAttribute('data-dlg-add')) > -1;
    b.setAttribute('aria-pressed', on ? 'true' : 'false'); $('span', b).textContent = on ? C.added : C.add;
  }
  if (dlg) {
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-cxd-close]')) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); return; }
      var a = e.target.closest('[data-dlg-add]'); if (a) togglePick(a.getAttribute('data-dlg-add'));
      var c = e.target.closest('[data-copy]'); if (c) copy(c.getAttribute('data-copy'));
    });
  }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]'); if (o) { openDialog(items[+o.getAttribute('data-open')]); return; }
    var a = e.target.closest('[data-add]'); if (a && grid.contains(a)) { togglePick(a.getAttribute('data-add')); return; }
    var c = e.target.closest('.cx__copy'); if (c) { copy(c.getAttribute('data-copy')); return; }
    var d = e.target.closest('[data-dv-open]'); if (d) { var k = d.getAttribute('data-dv-open'); (window.DV_COLLECTION || []).forEach(function (x) { if (x.code === k) openDialog(null, x); }); }
  });

  apply(); renderTray();
})();
