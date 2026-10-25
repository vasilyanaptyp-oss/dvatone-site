
(function () {
  'use strict';
  
  var NS = (window.DVATONE = window.DVATONE || {});
  if (NS.scans) return;
  var en = (document.documentElement.lang || '').slice(0, 2) === 'en';
  var T = en ? { view: 'Scan viewer', prev: 'Previous scan', next: 'Next scan', close: 'Close', fs: 'Full screen', fsOff: 'Exit full screen',
                 z1: 'Actual size', z0: 'Fit to screen', of: '{n} of {total}', hint: '',
                 viewP: 'Photo viewer', hintP: '' }
               : { view: 'Перегляд скану', prev: 'Попередній скан', next: 'Наступний скан', close: 'Закрити', fs: 'На весь екран', fsOff: 'Вийти з повного екрана',
                 z1: 'Реальний розмір', z0: 'Вмістити в екран', of: '{n} з {total}', hint: '',
                 viewP: 'Перегляд фото', hintP: '' };
  var svg = function (d) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>'; };
  var dlg = null, img, capB, capS, capN, capD, zoomB, fsB, stage, set = [], idx = 0, zoom = false, opener = null, ownFs = false;
  
  var cache = {}, fly = {};
  function pick(it) {
    var need = Math.max(window.innerWidth || 0, (window.innerHeight || 0) * 4 / 3) * (window.devicePixelRatio || 1);
    return it.m && it.m !== it.full && need <= (it.mw || 1100) * 1.2 ? it.m : it.full;
  }
  function fetchSrc(u) {
    if (!u || cache[u]) return Promise.resolve(u);
    if (fly[u]) return fly[u];
    var im = new Image(); im.decoding = 'async'; im.src = u;
    fly[u] = (im.decode ? im.decode() : new Promise(function (r, j) { im.onload = r; im.onerror = j; })).then(function () { cache[u] = 1; delete fly[u]; return u; }, function () { delete fly[u]; return u; });
    return fly[u];
  }
  function itemOf(el) {
    return { full: el.getAttribute('href'), m: el.getAttribute('data-scan-m') || el.getAttribute('href'), mw: +el.getAttribute('data-scan-mw') || 0 };
  }
  function warm(el) { if (el && el.getAttribute && el.getAttribute('href')) fetchSrc(pick(itemOf(el))); }
  var pz = { s: 1, x: 0, y: 0 }, MAXZ = 5;
  var canFs = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);

  function visible(el) { return !el.closest('[hidden]') && el.getClientRects().length > 0; }
  function collect(group) {
    var seen = {}, out = [];
    Array.prototype.forEach.call(document.querySelectorAll('[data-scan]'), function (el) {
      if ((el.getAttribute('data-scan-group') || '') !== group || !visible(el)) return;
      var code = el.getAttribute('data-scan');
      var key = group === 'photo' ? (el.getAttribute('href') || code) : code;
      if (seen[key]) return; seen[key] = 1;
      out.push({ code: code, key: key, name: el.getAttribute('data-scan-name') || '', desc: el.getAttribute('data-scan-desc') || '', alt: el.getAttribute('data-scan-alt') || '', full: el.getAttribute('href'), m: el.getAttribute('data-scan-m') || el.getAttribute('href'),
                 w: +el.getAttribute('data-w') || 0, h: +el.getAttribute('data-h') || 0, mw: +el.getAttribute('data-scan-mw') || 0, photo: group === 'photo' });
    });
    return out;
  }
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'scv'; dlg.setAttribute('aria-label', T.view);
    dlg.innerHTML =
      '<div class="scv__bar"><p class="scv__cap"><b data-scv-code></b><span data-scv-name></span><small data-scv-n></small></p>' +
      '<div class="scv__acts">' +
      (canFs ? '<button type="button" class="scv__b" data-scv-fs>' + svg('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5') + '<span>' + T.fs + '</span></button>' : '') +
      '<button type="button" class="scv__b scv__x" data-scv-x aria-label="' + T.close + '">' + svg('M6 6l12 12M18 6L6 18') + '</button></div></div>' +
      '<div class="scv__stage" data-scv-stage><img class="scv__img" data-scv-img alt="" decoding="async" title="' + T.hint + '"></div>' +
      '<p class="scv__desc" data-scv-desc hidden></p>' +
      '<button type="button" class="scv__nav scv__nav--p" data-scv-step="-1" aria-label="' + T.prev + '">' + svg('M15 6l-6 6 6 6') + '</button>' +
      '<button type="button" class="scv__nav scv__nav--n" data-scv-step="1" aria-label="' + T.next + '">' + svg('M9 6l6 6-6 6') + '</button>';
    document.body.appendChild(dlg);
    img = dlg.querySelector('[data-scv-img]'); stage = dlg.querySelector('[data-scv-stage]');
    capB = dlg.querySelector('[data-scv-code]'); capS = dlg.querySelector('[data-scv-name]'); capN = dlg.querySelector('[data-scv-n]'); capD = dlg.querySelector('[data-scv-desc]');
    zoomB = null; fsB = dlg.querySelector('[data-scv-fs]');
    dlg.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-scv-x]')) { dlg.close(); return; }
      var st = t.closest('[data-scv-step]'); if (st) { step(+st.getAttribute('data-scv-step')); return; }
            if (t.closest('[data-scv-fs]')) { toggleFs(); return; }
      if ((t === dlg || t === stage) && !overImg(e) && !moved && pz.s <= 1.01) dlg.close();
    });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        var l = Array.prototype.filter.call(dlg.querySelectorAll('button'), function (b) { return !b.hidden && !b.disabled && b.getClientRects().length > 0; });
        if (!l.length) return;
        var a = document.activeElement, i = l.indexOf(a);
        if (e.shiftKey && i <= 0) { e.preventDefault(); l[l.length - 1].focus(); }
        else if (!e.shiftKey && (i < 0 || i === l.length - 1)) { e.preventDefault(); l[0].focus(); }
        return;
      }
      if (e.key === 'ArrowLeft' && !zoom && pz.s <= 1.01) { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight' && !zoom && pz.s <= 1.01) { e.preventDefault(); step(1); }
      else if ((e.key === '+' || e.key === '=') ) { e.preventDefault(); full(); var r0 = stage.getBoundingClientRect(); zoomTo(pz.s * 1.5, r0.left + r0.width / 2, r0.top + r0.height / 2, r0.left + r0.width / 2, r0.top + r0.height / 2, { s: pz.s, x: pz.x, y: pz.y }); }
      else if (e.key === '-') { e.preventDefault(); var r1 = stage.getBoundingClientRect(); zoomTo(pz.s / 1.5, r1.left + r1.width / 2, r1.top + r1.height / 2, r1.left + r1.width / 2, r1.top + r1.height / 2, { s: pz.s, x: pz.x, y: pz.y }); if (pz.s < 1.03) resetPz(true); }
    });
    dlg.addEventListener('close', function () {
      document.documentElement.classList.remove('scv-open'); setZoom(false); resetPz(false);
      if (ownFs && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      ownFs = false;
      if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
    });
    document.addEventListener('fullscreenchange', function () {
      if (!fsB) return; var on = !!document.fullscreenElement;
      fsB.querySelector('span').textContent = on ? T.fsOff : T.fs; fsB.setAttribute('aria-pressed', on ? 'true' : 'false');
      if (!on) ownFs = false;
    });
    var pts = {}, n = 0, sx = 0, sy = 0, moved = false, pinch = null, pan = null, lastTap = 0, lastX = 0, lastY = 0, wasPinch = false, lastType = 'mouse';
    function count() { n = 0; for (var k in pts) n++; return n; }
    function pair() { var a = [], k; for (k in pts) a.push(pts[k]); return a; }
    stage.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      lastType = e.pointerType;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch (x) { }
      count();
      if (n === 1) { sx = e.clientX; sy = e.clientY; moved = false; wasPinch = false; pan = pz.s > 1.01 ? { x: pz.x, y: pz.y } : null; }
      if (n === 2) { var q = pair(); pinch = { d: dist(q[0], q[1]), s: pz.s, mx: (q[0].x + q[1].x) / 2, my: (q[0].y + q[1].y) / 2, x: pz.x, y: pz.y }; pan = null; wasPinch = true; full(); }
      if (e.pointerType === 'mouse' && pz.s > 1.01) e.preventDefault();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 6) moved = true;
      if (pinch && count() >= 2) {
        var q = pair(), d = dist(q[0], q[1]), mx = (q[0].x + q[1].x) / 2, my = (q[0].y + q[1].y) / 2;
        zoomTo(pinch.s * d / Math.max(1, pinch.d), pinch.mx, pinch.my, mx, my, pinch);
      } else if (pan && n === 1) {
        setPz(pz.s, pan.x + (e.clientX - sx), pan.y + (e.clientY - sy));
      }
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId]; count();
      if (n < 2) pinch = null;
      if (n === 1) { var q = pair()[0]; sx = q.x; sy = q.y; pan = pz.s > 1.01 ? { x: pz.x, y: pz.y } : null; }
      if (n > 0) return;
      if (pz.s < 1.03) resetPz(true);
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!wasPinch && pz.s <= 1.01 && e.type === 'pointerup' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1);
      else if (!wasPinch && !moved && e.type === 'pointerup' && e.pointerType !== 'mouse' && overImg(e)) {
        var now = Date.now();
        if (now - lastTap < 320 && Math.abs(e.clientX - lastX) < 30 && Math.abs(e.clientY - lastY) < 30) { toggleZoomAt(e.clientX, e.clientY); lastTap = 0; }
        else { lastTap = now; lastX = e.clientX; lastY = e.clientY; }
      }
      setTimeout(function () { moved = false; }, 0);
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', function (e) { if (lastType !== 'mouse' || !overImg(e)) return; e.preventDefault(); toggleZoomAt(e.clientX, e.clientY); });
    stage.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault(); full();
      var f = Math.exp(-e.deltaY * 0.01);
      zoomTo(pz.s * f, e.clientX, e.clientY, e.clientX, e.clientY, { s: pz.s, x: pz.x, y: pz.y });
      if (pz.s < 1.03) resetPz(true);
    }, { passive: false });
    ['gesturestart', 'gesturechange'].forEach(function (ev) { stage.addEventListener(ev, function (e) { e.preventDefault(); }); });
  }
  function dist(a, b) { var x = a.x - b.x, y = a.y - b.y; return Math.sqrt(x * x + y * y); }
  function overImg(e) { var r = img.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }
  function full() {
    var it = set[idx]; if (it && it.full && (img.currentSrc || img.src || '').indexOf(it.full) < 0) { img.srcset = ''; img.src = it.full; }
  }
  function centre() { var r = img.getBoundingClientRect(); return { x: r.left + r.width / 2 - pz.x, y: r.top + r.height / 2 - pz.y }; }
  function zoomTo(s, ax, ay, bx, by, from) {
    s = Math.max(1, Math.min(MAXZ, s));
    var c = centre(), px = (ax - c.x - from.x) / from.s, py = (ay - c.y - from.y) / from.s;
    setPz(s, bx - c.x - s * px, by - c.y - s * py);
  }
  function setPz(s, x, y) {
    var w = img.offsetWidth, h = img.offsetHeight, mx = (w * s - w) / 2, my = (h * s - h) / 2;
    pz.s = s; pz.x = Math.max(-mx, Math.min(mx, x)); pz.y = Math.max(-my, Math.min(my, y));
    img.style.transform = s > 1.001 ? 'translate3d(' + pz.x.toFixed(1) + 'px,' + pz.y.toFixed(1) + 'px,0) scale(' + s.toFixed(3) + ')' : '';
    dlg.classList.toggle('is-pz', s > 1.001);
  }
  function resetPz(anim) {
    if (!img) return;
    if (anim) { img.classList.add('scv__img--ease'); setTimeout(function () { img.classList.remove('scv__img--ease'); }, 260); }
    setPz(1, 0, 0);
  }
  function toggleZoomAt(x, y) {
    img.classList.add('scv__img--ease'); setTimeout(function () { img.classList.remove('scv__img--ease'); }, 260);
    if (pz.s > 1.01) { setPz(1, 0, 0); return; }
    full(); zoomTo(2.5, x, y, x, y, { s: 1, x: 0, y: 0 });
  }
  function fmt(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] != null ? o[k] : m; }); }
  function show(i) {
    if (!set.length) return;
    idx = (i + set.length) % set.length;
    var it = set[idx];
    setZoom(false); resetPz(false);
    var u = pick(it), cur = idx;
    img.removeAttribute('srcset'); img.removeAttribute('sizes');
    if (it.w && it.h) { img.width = it.w; img.height = it.h; }
    if (cache[u]) img.src = u;
    else { img.style.visibility = 'hidden'; img.src = u; fetchSrc(u).then(function () { if (idx === cur) img.style.visibility = ''; }); }
    if (capD) { capD.textContent = it.desc || ''; capD.hidden = !it.desc; }
    img.alt = it.alt || (it.code + (it.name ? ' ' + it.name : ''));
    dlg.setAttribute('aria-label', it.photo ? T.viewP : T.view); img.title = it.photo ? T.hintP : T.hint;
    capB.textContent = it.photo ? '' : it.code; capB.hidden = !!it.photo; capS.textContent = it.name; capS.hidden = !it.name;
    capN.textContent = set.length > 1 ? fmt(T.of, { n: idx + 1, total: set.length }) : '';
    Array.prototype.forEach.call(dlg.querySelectorAll('[data-scv-step]'), function (b) { b.hidden = set.length < 2; });
    if (set.length > 1) { fetchSrc(pick(set[(idx + 1) % set.length])); fetchSrc(pick(set[(idx - 1 + set.length) % set.length])); }
  }
  function step(d) { show(idx + d); }
  function setZoom(on, e) {
    if (!dlg) return;
    zoom = !!on; dlg.classList.toggle('is-zoom', zoom);
    if (zoomB) { zoomB.setAttribute('aria-pressed', zoom ? 'true' : 'false'); zoomB.querySelector('span').textContent = zoom ? T.z0 : T.z1; }
    if (zoom) {
      var it = set[idx]; if (it && img.currentSrc && img.currentSrc.indexOf(it.full) < 0) { img.srcset = ''; img.src = it.full; }
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
    var want = group === 'photo' && from && from.getAttribute && from.getAttribute('href') ? from.getAttribute('href') : code;
    var i = 0; set.forEach(function (it, k) { if ((group === 'photo' ? it.key : it.code) === want) i = k; });
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
  NS.scans = { open: open, warm: warm };
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-dvv-full][role="button"]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('pointerover', function (e) { if (e.pointerType === 'mouse') { var a = e.target.closest && e.target.closest('[data-scan]'); if (a) warm(a); } }, { passive: true });
  document.addEventListener('pointerdown', function (e) { var a = e.target.closest && e.target.closest('[data-scan]'); if (a) warm(a); }, { passive: true });
})();
