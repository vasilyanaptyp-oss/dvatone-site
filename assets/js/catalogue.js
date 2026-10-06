/* DVATONE digital catalogue: browse, filter and search the real shades (assets/data/catalog.js, system|code|hex),
   named DV collection (assets/data/dv-collection.js), picks tray that hands shades to the generator (?add=HEX,HEX).
   No texture is invented: a card shows a photo only when a real scan exists in assets/img/tex/<HEX>.webp (TEX below);
   otherwise a flat screen colour of the catalogue hex. DV colours without a scan get a neutral card (no colour, no texture).

   Mobile budget: the grid is windowed. Only a few dozen cards are in the DOM at any time (never the 1 066): chunks are added
   as the reader nears the end (one chunk per frame, so a fast flick never turns into one long task), and rows far above the
   screen are replaced by one measured spacer (and come back when the reader scrolls up). Cards load by themselves for one
   page (45 rows on phones, 30 rows on wider screens); then "Show more" opens the next page, so the closing band and the
   footer stay reachable. On phones the colour-standard filter lives in a bottom sheet; the shade dialog closes with Esc and
   the Back button. */
(function () {
  'use strict';
  var DV = window.DV || {}, C = DV.cat || {}, base = DV.base || '', lang = DV.lang === 'en' ? 'en' : 'uk';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var SYS = { N: 'NCS', F: '5051', R: 'RAL' };
  var TEX = {}; (C.tex || []).forEach(function (h) { TEX[h] = 1; });
  var MAXPICK = 6, CHUNK = 30, MAXWIN = 150, AHEAD = 900;   // cards per chunk (rounded up to whole rows), cards kept at most, px to load ahead
  var NS = window.DVATONE || {};
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mq = window.matchMedia ? matchMedia('(max-width:760px)') : null;   // phones: filter sheet, longer first page
  var LS = {
    uk: { copiedBtn: 'Скопійовано', copyFail: 'Не вдалося скопіювати автоматично. Виділіть текст і скопіюйте його вручну.', dvFound: 'Знайдено в колекції DV: {n}', dvGo: 'Переглянути колекцію DV',
      filters: 'Стандарт', filtersTitle: 'Колірний стандарт', show: 'Показати {n}', close: 'Закрити', results: 'Знайдено відтінків: {n}',
      unpick: 'Прибрати з композиції', toGen: 'Скласти композицію ({n})' },
    en: { copiedBtn: 'Copied', copyFail: 'We could not copy automatically. Select the text and copy it by hand.', dvFound: 'Found in the DV collection: {n}', dvGo: 'View the DV collection',
      filters: 'Standard', filtersTitle: 'Colour standard', show: 'Show {n}', close: 'Close', results: 'Shades found: {n}',
      unpick: 'Remove from composition', toGen: 'Build a composition ({n})' }
  }[lang];
  var nf = function (n) { try { return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'uk-UA'); } catch (e) { return String(n); } };   // 1 066 / 1,066
  var strip = function (s) { return String(s || '').toLowerCase().replace(/[\s#\-–—]/g, ''); };
  var normQ = function (s) { return strip(s).replace(/^ncs(?!s)/, 'ncss'); };   // "NCS 3020-R90B" finds "NCS S 3020-R90B"

  var items = [];
  (window.DV_CAT || '').split(';').forEach(function (r) {
    var p = r.split('|'); if (p.length < 3) return;
    items.push({ id: p[0] + '|' + p[1], sys: p[0], code: p[1], hex: p[2], label: SYS[p[0]] + ' ' + p[1], key: strip(SYS[p[0]] + p[1] + p[2]) });
  });
  items.sort(function (a, b) { return (TEX[b.hex] ? 1 : 0) - (TEX[a.hex] ? 1 : 0); });   // shades with a real sample photo first, the rest stays in hue order
  items.forEach(function (it, i) { it.i = i; });
  var grid = $('[data-cat-grid]'); if (!grid) return;
  var q = '', filter = 'all', list = items, lo = 0, hi = 0, cap = 0;   // list[lo..hi) is what sits in the DOM; cards load by themselves up to cap
  (function () {   // card rules that only these script-made cards need
    var st = document.createElement('style'); st.setAttribute('data-dv-cat', '');
    st.textContent = '.cx__num{white-space:nowrap}' +   // a narrow card may put "NCS" above the code, the code itself never breaks at its hyphen
      '.cx__sw img{transition:opacity .35s var(--ease,ease)}.cx__sw img:not(.is-ok){opacity:0}' +   // a photo shows once it has loaded; the shade colour fills the card meanwhile
      '@media (hover:none){.cxd__acts .btn--line-l:hover{background:none;color:var(--tl);border-color:var(--line-l2)}}';   // phones keep :hover on a tapped button: the outline "Remove" state must show at once
    document.head.appendChild(st);
  })();

  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var rgb = function (h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  var fmt = function (s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); };

  /* ---------- picks (hand-off to the generator) ---------- */
  var picks = [];   // item ids ("N|S 3020-R10B"); old sessions stored bare HEX values, those are mapped to the first shade with that HEX
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
    var hexes = []; picks.forEach(function (id) { var it = byId(id); if (it && hexes.indexOf(it.hex) < 0) hexes.push(it.hex); });   // shades sharing a HEX are the same colour for the generator
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
  var live = $('[data-cat-live]');
  function flash(t, kind) {   // sr-only live region for screen readers, visible toast for everyone
    if (live) { live.textContent = t; clearTimeout(flash._t); flash._t = setTimeout(function () { live.textContent = ''; }, 2600); }
    if (NS.toast) NS.toast(t, { kind: kind });
  }
  if (tray) tray.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick]'); if (!b) return;
    var idx = $$('[data-pick]', tray).indexOf(b), id = b.getAttribute('data-pick');
    togglePick(id);
    var rest = $$('[data-pick]', tray), nb = rest[Math.min(idx, rest.length - 1)];   // keep keyboard focus: next swatch, else the card it came from, else the search box
    if (nb) nb.focus(); else { var card = $$('[data-add]', grid).filter(function (x) { return x.getAttribute('data-add') === id; })[0]; (card || si || document.body).focus(); }
  });

  /* ---------- cards ---------- */
  var plus = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';
  var copyIco = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M15.5 8.5v-2a1.5 1.5 0 0 0-1.5-1.5H6.5A1.5 1.5 0 0 0 5 6.5V14a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
  var texOk = {};   // photos that have loaded once: rows rebuilt while scrolling back show them at once, without a second fade
  function swatchHTML(it) {
    if (!TEX[it.hex]) return '<span class="cx__flat" style="background:#' + it.hex + '"></span>';
    var t = base + 'assets/img/tex/' + it.hex;   // the card cuts (260 and 520 px wide); the 720 px original is kept for the shade dialog
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
  if (cnt) cnt.removeAttribute('aria-live');   // it changes while the reader scrolls: the polite announcement goes through the status line on a new search instead

  /* ---------- windowed grid ---------- */
  var spacer = null, sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true'); sentinel.style.cssText = 'height:1px;margin-top:-1px;pointer-events:none';
  grid.insertAdjacentElement('afterend', sentinel);
  grid.style.overflowAnchor = 'none';   // positions are kept by hand below (spacer); the browser's own scroll anchoring would fight it
  grid.addEventListener('load', function (e) {   // load does not bubble, so it is caught on the way down; a photo that fails stays hidden and the card keeps its colour
    var im = e.target, li = im && im.tagName === 'IMG' && im.closest('.cx'); if (!li) return;
    im.classList.add('is-ok'); var it = items[+li.getAttribute('data-i')]; if (it) texOk[it.hex] = 1;
  }, true);
  var colsN = function () { var t = getComputedStyle(grid).gridTemplateColumns; return Math.max(1, t && t !== 'none' ? t.split(' ').length : 1); };
  var gapY = function () { return parseFloat(getComputedStyle(grid).rowGap) || 0; };
  var pageSize = function () { return (mq && mq.matches ? 45 : 30) * colsN(); };   // cards that load by themselves before "Show more" (whole rows)
  var offTop = function (el) { return el.getBoundingClientRect().top + window.scrollY; };
  var cardsIn = function () { return grid.querySelectorAll('li.cx'); };
  var html = function (a, b) { var h = ''; for (var i = a; i < b; i++) h += card(list[i], i); return h; };
  function jumpBy(dy) {   // instant: html{scroll-behavior:smooth} would turn a position fix into a visible glide
    try { window.scrollBy({ top: dy, left: 0, behavior: 'instant' }); }
    catch (e) { var r = document.documentElement.style, b = r.scrollBehavior; r.scrollBehavior = 'auto'; window.scrollBy(0, dy); r.scrollBehavior = b; }
  }
  function held(cs, a, b) {   // keyboard focus inside cards a..b-1 keeps those rows; a tapped button keeps focus on Android, and that must not freeze the window
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
    spacer.style.height = h + 'px'; spacer.style.marginBottom = (-gap) + 'px';   // the row gap after the spacer is cancelled so the next row starts exactly at the measured offset
  }
  function status() {
    if (cnt) cnt.textContent = list.length ? fmt(C.count, { n: nf(hi), total: nf(list.length) }) : '';   // no "0 of 0" above "Nothing found"
    if (more) more.hidden = hi >= list.length;
  }
  /* Geometry is read before the DOM is written: rows above do not move when cards are added below, and the spacer keeps the
     rows below in place when rows are added above. A chunk then costs one layout instead of several. */
  function appendChunk() {
    if (hi >= list.length) return false;
    var n = colsN(), end = Math.min(list.length, hi + Math.ceil(CHUNK / n) * n);
    var k = Math.floor((end - lo - MAXWIN) / n) * n, h = 0, gap = 0, cs = null, i;   // rows far above the screen go; one spacer of the exact measured height stands in for them
    if (k >= n) {
      cs = cardsIn();
      if (cs.length <= k || cs[k - 1].getBoundingClientRect().bottom > -window.innerHeight * 0.6 || held(cs, 0, k)) k = 0;   // still close to the screen: try again with the next chunk
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
    var k = Math.floor((hi - from - MAXWIN) / n) * n, cut = cs.length - k, j;   // and rows far below the screen go
    if (k < n || cut <= 0 || cs[cut].getBoundingClientRect().top <= window.innerHeight * 1.6 || held(cs, cut, cs.length)) k = 0;
    spacer.insertAdjacentHTML('afterend', html(from, lo)); lo = from;
    var added = offTop(anchor) - a0, nh = lo === 0 ? 0 : Math.max(0, h0 - added);   // what the new rows really occupy (the one layout this needs)
    setSpacer(nh, gap);
    if (nh < 1) { var shift = offTop(anchor) - a0; if (Math.abs(shift) > 1) jumpBy(shift); }   // the spacer ran out (an estimate that was too small): keep the reader where they were
    if (k) { for (j = cs.length - 1; j >= cut; j--) cs[j].remove(); hi -= k; }
    status();
    return true;
  }
  var fillRaf = 0;
  function fill() {   // one chunk per frame, then a fresh look on the next frame: a fast flick never becomes one long task
    if (fillRaf) cancelAnimationFrame(fillRaf);
    fillRaf = 0;
    var vh = window.innerHeight, go = false;
    if (hi < Math.min(list.length, cap) && sentinel.getBoundingClientRect().top < vh + AHEAD) go = appendChunk();
    else if (spacer && lo > 0 && spacer.getBoundingClientRect().bottom > -AHEAD) go = prependChunk();
    if (go) fillSoon();
  }
  var fillSoon = function () { if (!fillRaf) fillRaf = requestAnimationFrame(fill); };
  window.addEventListener('scroll', fillSoon, { passive: true }); window.addEventListener('resize', fillSoon);

  function apply() {
    var nq = normQ(q);
    list = items.filter(function (it) {
      if (filter !== 'all' && SYS[it.sys].toLowerCase() !== filter) return false;
      return !nq || it.key.indexOf(nq) > -1;
    });
    lo = hi = 0; setSpacer(0); grid.innerHTML = '';
    cap = pageSize();
    appendChunk(); status(); fill();
    if (live && (nq || filter !== 'all')) { clearTimeout(apply._t); apply._t = setTimeout(function () { live.textContent = fmt(LS.results, { n: nf(list.length) }); }, 400); }
    // DV collection follows the search too. It sits above the toolbar, so while it shrinks or grows the search field keeps
    // its place on screen (Safari has no scroll anchoring: clearing a search used to drop the reader into the DV cards)
    var y0 = si ? si.getBoundingClientRect().top : NaN, vh = window.innerHeight;
    var dvHit = 0;
    $$('[data-dv-card]').forEach(function (c) {
      var t = strip(c.getAttribute('data-dv-card')), ok = !nq || t.indexOf(strip(q)) > -1;
      c.hidden = !ok; if (ok) dvHit++;
    });
    var dvSec = $('[data-dv-section]'); if (dvSec) dvSec.classList.toggle('is-filtered', !!nq && !dvHit);
    if (y0 > -vh / 2 && y0 < vh) { var dy = si.getBoundingClientRect().top - y0; if (Math.abs(dy) > 1) jumpBy(dy); }   // only while the toolbar is on screen (typing, "Clear search")
    if (empty) {
      empty.hidden = !!list.length || dvHit > 0;   // a matching DV card is on screen above: never say "nothing found"
      $('[data-cat-empty-text]', empty).textContent = fmt(C.emptyText, { query: q });
      dvNote(!list.length && dvHit > 0 ? dvHit : 0);
    }
    sheetSync();
  }
  var dvNoteEl = null;
  function dvNote(n) {   // "Found in the DV collection: N" with a link to the section, instead of the empty state
    if (!n) { if (dvNoteEl) dvNoteEl.hidden = true; return; }
    if (!dvNoteEl) {
      dvNoteEl = document.createElement('div'); dvNoteEl.className = 'cempty'; dvNoteEl.setAttribute('data-cat-dvnote', ''); dvNoteEl.setAttribute('role', 'status');
      dvNoteEl.innerHTML = '<h3></h3><p><a href="#dv" style="color:inherit;text-decoration:underline;text-underline-offset:3px"></a></p>';
      empty.parentNode.insertBefore(dvNoteEl, empty);
    }
    $('h3', dvNoteEl).textContent = fmt(LS.dvFound, { n: n }); $('a', dvNoteEl).textContent = LS.dvGo; dvNoteEl.hidden = false;
  }
  if (more) more.addEventListener('click', function () {   // opens the next page: one chunk now, the rest of the page loads as the reader scrolls on
    cap = Math.max(cap, hi) + pageSize();
    var y = window.scrollY, first = hi; appendChunk();
    void more.offsetTop; if (Math.abs(window.scrollY - y) > 1) jumpBy(y - window.scrollY);   // the new cards appear where the button was: the page does not follow the button down
    var cs = cardsIn(), b = null;
    for (var i = 0; i < cs.length; i++) if (cs[i].getAttribute('aria-posinset') === String(first + 1)) { b = $('.cx__sw', cs[i]); break; }   // the button that was pressed may disappear: focus moves to the first new card
    if (b) { try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); } }
    fillSoon();
  });
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
    if (rst) rst.addEventListener('click', function () { si.value = ''; q = ''; apply(); si.focus(); });   // clears the search only, as the button says: the chosen standard stays
  }
  // deep link from the generator or the home page: ?q=RAL 1039
  var dl = /[?&]q=([^&]+)/.exec(location.search); if (dl && si) { try { si.value = q = decodeURIComponent(dl[1].replace(/\+/g, ' ')); } catch (e) {} }

  /* ---------- modal helpers: scroll lock, Esc (native) and the Back button close the top dialog ---------- */
  var skipPop = 0, modals = [];
  function lockScroll(on) { document.documentElement.style.overflow = on ? 'hidden' : ''; }
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
    try { history.pushState({ dvModal: 1 }, ''); d._dvPush = true; } catch (e) {}
  }
  window.addEventListener('popstate', function () {
    if (skipPop > 0) { skipPop--; return; }
    modals.forEach(function (d) { if (d.open) { d._dvPush = false; if (d.close) d.close(); } });
  });

  /* ---------- filters: on phones the colour-standard pills live in a bottom sheet ---------- */
  var tool = $('.ctool'), fbox = $('.ctool__f'), fbtn = null, sheet = null, sheetOk = null, sheetBody = null;
  function sheetSync() {
    if (!fbtn) return;
    var on = $('[data-cat-filter][aria-pressed="true"]'), v = $('.dvfbtn__v', fbtn), name = on ? on.textContent.trim() : '';
    if (v) v.textContent = filter === 'all' ? name.toLowerCase() : name;   // "Стандарт: усі", "Стандарт: RAL"
    fbtn.classList.toggle('is-set', filter !== 'all');
    if (sheetOk) $('span', sheetOk).textContent = fmt(LS.show, { n: nf(list.length) });
  }
  function buildSheet() {
    var st = document.createElement('style'); st.setAttribute('data-dv-sheet', '');
    st.textContent =
      // the search gets the whole first row (its placeholder is never cut); the standard button and the count share the second
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
    sheet.addEventListener('click', function (e) { if (e.target === sheet) shut(); });   // a tap on the dimmed backdrop
    sheet.addEventListener('close', function () {
      sheet.style.transform = ''; sheet.style.transition = '';
      var top = offTop(grid) - NS_inset() - 16; if (window.scrollY > top + 40) window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });   // results start at the top of the grid
    });
    var head = $('.dvsheet__head', sheet), y0 = null, dy = 0;   // drag the handle down to dismiss
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

  /* ---------- copy ---------- */
  function copy(text, btn) {   // success only when the browser confirms it; otherwise the code is shown selectable
    (NS.copyText ? NS.copyText(text) : Promise.resolve(false)).then(function (ok) {
      if (ok) { flash(C.copied + ': ' + text); if (btn && NS.flashLabel) NS.flashLabel(btn, LS.copiedBtn); }
      else { if (live) live.textContent = LS.copyFail; if (NS.toast) NS.toast(LS.copyFail, { kind: 'warn', copyText: text }); }
    });
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
        '<div class="cxd__acts"><button type="button" class="btn btn--ink btn--sm" data-dlg-add="' + esc(it.id) + '"><span></span></button><button type="button" class="btn btn--line-l btn--sm" data-copy="' + esc(it.label) + '"><span>' + esc(C.copyCode) + '</span></button></div>';
    }
    $('[data-cxd-vis]', dlg).innerHTML = vis; $('[data-cxd-body]', dlg).innerHTML = body;
    syncDialogAdd();
    openModal(dlg);
  }
  function syncDialogAdd() {   // the label carries the state (add / remove), so there is no aria-pressed on top of it
    var b = dlg && $('[data-dlg-add]', dlg); if (!b) return;
    var on = picks.indexOf(b.getAttribute('data-dlg-add')) > -1;
    b.classList.toggle('btn--ink', !on); b.classList.toggle('btn--line-l', on);
    $('span', b).textContent = on ? LS.unpick : C.add;
    var go = $('[data-dlg-go]', dlg);   // a way on to the generator while there are picks: on phones the full-screen dialog covers the tray
    if (!picks.length) { if (go) go.remove(); return; }
    if (!go) { go = document.createElement('a'); go.className = 'btn-text'; go.setAttribute('data-dlg-go', ''); go.innerHTML = '<span></span>'; b.parentNode.appendChild(go); }
    go.setAttribute('href', genHref()); $('span', go).textContent = fmt(LS.toGen, { n: picks.length });
  }
  if (dlg) {
    bindModal(dlg);
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-cxd-close]')) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); return; }
      var a = e.target.closest('[data-dlg-add]'); if (a) togglePick(a.getAttribute('data-dlg-add'));
      var c = e.target.closest('[data-copy]'); if (c) copy(c.getAttribute('data-copy'), c);
    });
  }
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]'); if (o) { openDialog(items[+o.getAttribute('data-open')]); return; }
    var a = e.target.closest('[data-add]'); if (a && grid.contains(a)) { togglePick(a.getAttribute('data-add')); return; }
    var c = e.target.closest('.cx__copy'); if (c) { copy(c.getAttribute('data-copy'), c); return; }
    var d = e.target.closest('[data-dv-open]'); if (d) { var k = d.getAttribute('data-dv-open'); (window.DV_COLLECTION || []).forEach(function (x) { if (x.code === k) openDialog(null, x); }); }
  });

  apply(); renderTray(); sheetLayout();
})();
