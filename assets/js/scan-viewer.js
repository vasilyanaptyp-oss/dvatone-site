/* DVATONE scan viewer (10.10, Viktor A8 / A12): every DV scan can be opened whole, over the full screen.

   Triggers are ordinary links to the full scan, so without JS they still open the picture:
     <a href="assets/img/dv/dv-033.webp" data-scan="DV 033" data-scan-group="dv" data-scan-m="assets/img/dv/dv-033-m.webp"
        data-scan-name="Медова пробка" data-w="2000" data-h="1500">...</a>
   A click opens a modal <dialog> with the scan fitted to the screen. Inside: previous / next (buttons, arrow keys, a swipe),
   «1:1» (the scan at its own pixel size, drag or scroll to look around; a click on the picture does the same), «Fullscreen»
   (the Fullscreen API, hidden where the browser has none, e.g. iPhone) and close (Esc, the cross). The set is every visible
   trigger of the same data-scan-group in page order, one entry per code (a card filtered out of the grid is skipped).
   Other hooks: [data-scan-all="dv"] opens the first scan of a group; [data-dvv-full] opens the code the catalogue's viewer shows
   ([data-dvv-code]). Strings: Ukrainian or English by <html lang>. Nothing here is page specific; the build adds the triggers. */
(function () {
  'use strict';
  var NS = (window.DVATONE = window.DVATONE || {});
  if (NS.scans) return;
  var en = (document.documentElement.lang || '').slice(0, 2) === 'en';
  var T = en ? { view: 'Scan viewer', prev: 'Previous scan', next: 'Next scan', close: 'Close', fs: 'Full screen', fsOff: 'Exit full screen',
                 z1: 'Actual size', z0: 'Fit to screen', of: '{n} of {total}', hint: 'Click the scan to see it at its actual size' }
               : { view: 'Перегляд скану', prev: 'Попередній скан', next: 'Наступний скан', close: 'Закрити', fs: 'На весь екран', fsOff: 'Вийти з повного екрана',
                 z1: 'Реальний розмір', z0: 'Вмістити в екран', of: '{n} з {total}', hint: 'Натисніть на скан, щоб побачити його в реальному розмірі' };
  var svg = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; };
  var dlg = null, img, capB, capS, capN, zoomB, fsB, stage, set = [], idx = 0, zoom = false, opener = null, ownFs = false;
  var canFs = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);

  function visible(el) { return !el.closest('[hidden]') && el.getClientRects().length > 0; }
  function collect(group) {
    var seen = {}, out = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-scan]'), function (el) {
      if ((el.getAttribute('data-scan-group') || '') !== group || !visible(el)) return;
      var code = el.getAttribute('data-scan');
      if (seen[code]) return; seen[code] = 1;
      out.push({ code: code, name: el.getAttribute('data-scan-name') || '', full: el.getAttribute('href'), m: el.getAttribute('data-scan-m') || el.getAttribute('href'),
                 w: +el.getAttribute('data-w') || 0, h: +el.getAttribute('data-h') || 0 });
    });
    return out;
  }
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'scv'; dlg.setAttribute('aria-label', T.view);
    dlg.innerHTML =
      '<div class="scv__bar"><p class="scv__cap"><b data-scv-code></b><span data-scv-name></span><small data-scv-n></small></p>' +
      '<div class="scv__acts"><button type="button" class="scv__b" data-scv-zoom aria-pressed="false">' + svg('M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20M8 10.5h5M10.5 8v5') + '<span>' + T.z1 + '</span></button>' +
      (canFs ? '<button type="button" class="scv__b" data-scv-fs>' + svg('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5') + '<span>' + T.fs + '</span></button>' : '') +
      '<button type="button" class="scv__b scv__x" data-scv-x aria-label="' + T.close + '">' + svg('M6 6l12 12M18 6L6 18') + '</button></div></div>' +
      '<div class="scv__stage" data-scv-stage><img class="scv__img" data-scv-img alt="" decoding="async" title="' + T.hint + '"></div>' +
      '<button type="button" class="scv__nav scv__nav--p" data-scv-step="-1" aria-label="' + T.prev + '">' + svg('M15 6l-6 6 6 6') + '</button>' +
      '<button type="button" class="scv__nav scv__nav--n" data-scv-step="1" aria-label="' + T.next + '">' + svg('M9 6l6 6-6 6') + '</button>';
    document.body.appendChild(dlg);
    img = dlg.querySelector('[data-scv-img]'); stage = dlg.querySelector('[data-scv-stage]');
    capB = dlg.querySelector('[data-scv-code]'); capS = dlg.querySelector('[data-scv-name]'); capN = dlg.querySelector('[data-scv-n]');
    zoomB = dlg.querySelector('[data-scv-zoom]'); fsB = dlg.querySelector('[data-scv-fs]');
    dlg.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-scv-x]')) { dlg.close(); return; }
      var st = t.closest('[data-scv-step]'); if (st) { step(+st.getAttribute('data-scv-step')); return; }
      if (t.closest('[data-scv-zoom]') || t === img) { if (!moved) setZoom(!zoom, e); return; }
      if (t.closest('[data-scv-fs]')) { toggleFs(); return; }
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' && !zoom) { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight' && !zoom) { e.preventDefault(); step(1); }
    });
    dlg.addEventListener('close', function () {
      document.documentElement.classList.remove('scv-open'); setZoom(false);
      if (ownFs && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      ownFs = false;
      if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
    });
    document.addEventListener('fullscreenchange', function () {
      if (!fsB) return; var on = !!document.fullscreenElement;
      fsB.querySelector('span').textContent = on ? T.fsOff : T.fs; fsB.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!on) ownFs = false;
    });
    // a swipe changes the scan (fitted view); in the 1:1 view a drag pans the picture
    var sx = 0, sy = 0, sl = 0, stp = 0, down = false, moved = false;
    stage.addEventListener('pointerdown', function (e) { down = true; moved = false; sx = e.clientX; sy = e.clientY; sl = stage.scrollLeft; stp = stage.scrollTop; if (zoom && e.pointerType === 'mouse') { stage.setPointerCapture(e.pointerId); e.preventDefault(); } });
    stage.addEventListener('pointermove', function (e) {
      if (!down) return; var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (zoom && e.pointerType === 'mouse') { stage.scrollLeft = sl - dx; stage.scrollTop = stp - dy; }
    });
    stage.addEventListener('pointerup', function (e) {
      if (!down) return; down = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!zoom && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
      setTimeout(function () { moved = false; }, 0);
    });
    stage.addEventListener('pointercancel', function () { down = false; });
  }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  function show(i) {
    if (!set.length) return;
    idx = (i + set.length) % set.length;
    var it = set[idx];
    setZoom(false);
    img.removeAttribute('src');
    img.srcset = it.m && it.m !== it.full ? it.m + ' 1100w, ' + it.full + ' ' + (it.w || 2000) + 'w' : '';
    img.sizes = '100vw';
    img.src = it.full;
    if (it.w && it.h) { img.width = it.w; img.height = it.h; }
    img.alt = it.code + (it.name ? ' ' + it.name : '');
    capB.textContent = it.code; capS.textContent = it.name; capS.hidden = !it.name;
    capN.textContent = set.length > 1 ? fmt(T.of, { n: idx + 1, total: set.length }) : '';
    Array.prototype.forEach.call(dlg.querySelectorAll('[data-scv-step]'), function (b) { b.hidden = set.length < 2; });
    if (set.length > 1) { var nx = set[(idx + 1) % set.length]; var pre = new Image(); pre.src = nx.m || nx.full; }   // the next one is ready when asked for
  }
  function step(d) { show(idx + d); }
  function setZoom(on, e) {
    if (!dlg) return;
    zoom = !!on; dlg.classList.toggle('is-zoom', zoom);
    if (zoomB) { zoomB.setAttribute('aria-pressed', zoom ? 'true' : 'false'); zoomB.querySelector('span').textContent = zoom ? T.z0 : T.z1; }
    if (zoom) {
      var it = set[idx]; if (it && img.currentSrc && img.currentSrc.indexOf(it.full) < 0) { img.srcset = ''; img.src = it.full; }
      // keep the point that was clicked under the pointer (the middle when it came from the button)
      var r = img.getBoundingClientRect(), fx = e && e.target === img ? (e.clientX - r.left) / r.width : 0.5, fy = e && e.target === img ? (e.clientY - r.top) / r.height : 0.5;
      requestAnimationFrame(function () { stage.scrollLeft = fx * stage.scrollWidth - stage.clientWidth / 2; stage.scrollTop = fy * stage.scrollHeight - stage.clientHeight / 2; });
    } else if (stage) { stage.scrollLeft = 0; stage.scrollTop = 0; }
  }
  function toggleFs() {
    if (!canFs) return;
    if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen().catch(function () {}); return; }
    document.documentElement.requestFullscreen().then(function () { ownFs = true; }).catch(function () {});
  }
  function open(group, code, from) {
    set = collect(group);
    if (!set.length) return false;
    if (!dlg) build();
    opener = from || document.activeElement;
    var i = 0; set.forEach(function (it, k) { if (it.code === code) i = k; });
    show(i);
    document.documentElement.classList.add('scv-open');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    var x = dlg.querySelector('[data-scv-x]'); if (x) x.focus({ preventScroll: true });
    return true;
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('[data-scan]');
    if (a) { if (open(a.getAttribute('data-scan-group') || '', a.getAttribute('data-scan'), a)) e.preventDefault(); return; }
    var all = e.target.closest('[data-scan-all]');
    if (all) { if (open(all.getAttribute('data-scan-all'), null, all)) e.preventDefault(); return; }
    var cur = e.target.closest('[data-dvv-full]');
    if (cur) {
      var c = document.querySelector('[data-dvv-code]'), code = c ? c.textContent.trim() : '';
      if (open(cur.getAttribute('data-dvv-full') || 'dv', code, cur)) e.preventDefault();
    }
  });
  NS.scans = { open: open };
})();
