/* DVATONE site.js: header, reveal, hero loupe, fan, generator teaser, rooms, forms, video, live sky.
   Plain JS, no libraries. Page data comes from window.DV (set inline by the page). */
(function () {
  'use strict';
  var DV = window.DV || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ---------- header + mobile nav ---------- */
  var hdr = $('#hdr'), burger = $('.burger'), mnav = $('#mnav');
  function onScrollHdr() { hdr.classList.toggle('is-solid', window.scrollY > 40 || (mnav && mnav.classList.contains('is-open'))); }
  function setMenu(open) {
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    mnav.classList.toggle('is-open', open);
    mnav.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.documentElement.style.overflow = open ? 'hidden' : '';
    onScrollHdr();
  }
  if (burger && mnav) {
    burger.addEventListener('click', function () { setMenu(burger.getAttribute('aria-expanded') !== 'true'); });
    $$('a', mnav).forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1240) setMenu(false); });
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
      if (!fine && !reduce) { var t = (now - t0) / 1000; tx = W * (0.62 + 0.22 * Math.sin(t * 0.42)); ty = H * (0.36 + 0.14 * Math.sin(t * 0.31 + 1)); }
      mx += (tx - mx) * 0.14; my += (ty - my) * 0.14; place();
      raf = requestAnimationFrame(loop);
    };
    var start = function () { if (hero.classList.contains('has-3d')) return; if (!raf) { var W = hero.clientWidth, H = hero.clientHeight; mx = tx = W * 0.7; my = ty = H * 0.4; raf = requestAnimationFrame(loop); } };
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
  var fmt = function (kind, v) {
    v = v.trim(); if (!v) return '';
    if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : ERR.email;
    if (kind === 'phone') return (v.charAt(0) === '@' ? /^@[A-Za-z0-9_]{4,}$/.test(v) : (v.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(v))) ? '' : (v.charAt(0) === '@' ? ERR.telegram : ERR.phone);
    if (kind === 'contact') return (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || /^@[A-Za-z0-9_]{4,}$/.test(v) || (v.replace(/\D/g, '').length >= 9 && /^[+\d\s()\-]+$/.test(v))) ? '' : ERR.contact;
    if (kind === 'area') { var n = parseFloat(v.replace(',', '.')); return n > 0 && isFinite(n) ? '' : ERR.area; }
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
    box.textContent = (ERR.send || '') + ' ';
    var a = document.createElement('a'); a.href = 'https://t.me/Dvatone_bot'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '@Dvatone_bot';
    box.appendChild(a); box.hidden = false;
    if (window.console && console.warn) console.warn('[Dvatone forms] not sent: ' + why);
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
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || j.ok === false) return fail('server answered ' + r.status + (j.error ? ' ' + j.error : ''));
          f.removeAttribute('aria-busy'); if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); }
        });
      }, function (err) { clearTimeout(timer); return fail(err && err.name === 'AbortError' ? 'timeout' : 'network error'); });
  }

  $$('[data-form]').forEach(function (f) {
    var need = (f.getAttribute('data-need') || '').split(' ').filter(Boolean), any = (f.getAttribute('data-need-any') || '').split(' ').filter(Boolean);
    var mark = function (el, msg) {
      var fld = el.closest('.field'), er = fld && $('.err', fld);
      if (fld) fld.classList.toggle('is-bad', !!msg);
      if (er && msg) er.textContent = msg;
      el.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    };
    var check = function () {
      var ok = true, anyFilled = !any.length || any.some(function (n) { return f.elements[n] && f.elements[n].value.trim(); });
      need.forEach(function (n) {
        var el = f.elements[n]; if (!el) return;
        if (n === 'consent') { var bad = !el.checked; var er = $('[data-err-consent]', f); if (er) er.style.display = bad ? 'block' : 'none'; if (bad) ok = false; return; }
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
      if (!check()) { var first = $('.is-bad input, .is-bad textarea, .is-bad select', f); if (first) first.focus(); return; }
      deliver(f, formName(f), collect(f), $('button[type="submit"]', f)).then(function () {
        f.classList.add('is-sent'); var s = $('.form__ok', f); if (s) { s.setAttribute('tabindex', '-1'); s.focus({ preventScroll: true }); }
      }, function () { /* error state already shown by deliver() */ });
    });
    f.addEventListener('input', function (e) { var fld = e.target.closest && e.target.closest('.field'); if (fld) fld.classList.remove('is-bad'); });
  });
  var nf = $('[data-notify]');
  if (nf) {
    initHoneypot(nf);
    nf.addEventListener('submit', function (e) {
      e.preventDefault(); var i = nf.elements.email, ok = /^\S+@\S+\.\S{2,}$/.test(i.value.trim());
      var msg = nf.parentNode.querySelector('.notify__err');
      if (!ok) { i.setAttribute('aria-invalid', 'true'); if (!msg) { msg = document.createElement('p'); msg.className = 'small notify__err'; msg.setAttribute('role', 'alert'); msg.style.cssText = 'margin-top:10px;color:var(--err-l)'; nf.insertAdjacentElement('afterend', msg); } msg.textContent = ERR.email || ''; i.focus(); return; }
      i.setAttribute('aria-invalid', 'false'); if (msg) msg.remove();
      if (nf.getAttribute('aria-busy') === 'true') return;
      deliver(nf, formName(nf), collect(nf), $('button[type="submit"]', nf)).then(function () { nf.classList.add('is-sent'); }, function () {});
    });
  }

  /* ---------- video: load the YouTube player only on click ---------- */
  $$('[data-yt]').forEach(function (b) {
    b.addEventListener('click', function () {
      var f = document.createElement('iframe');
      f.src = 'https://www.youtube-nocookie.com/embed/' + b.getAttribute('data-yt') + '?autoplay=1&rel=0&modestbranding=1';
      f.title = b.getAttribute('aria-label'); f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; f.allowFullscreen = true; f.setAttribute('loading', 'lazy');
      b.replaceWith((function () { var d = document.createElement('div'); d.className = 'vplay'; d.appendChild(f); return d; })());
    });
  });

  /* ---------- self-hosted video: load and play only on click ---------- */
  $$('[data-video]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = document.createElement('video');
      v.src = b.getAttribute('data-video'); v.poster = b.getAttribute('data-poster') || '';
      v.controls = true; v.autoplay = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('aria-label', b.getAttribute('aria-label'));
      var d = document.createElement('div'); d.className = 'vplay is-playing'; d.appendChild(v);
      b.replaceWith(d); var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
    });
  });

  /* ---------- application sweep (scroll-linked) ---------- */
  var sw = $('[data-sweep]');
  if (sw && !reduce) {
    var sweep = function () {
      var r = sw.getBoundingClientRect(), vh = window.innerHeight, k = clamp((vh * 0.9 - r.top) / (vh * 0.75), 0, 1);
      sw.style.setProperty('--p', (14 + k * 82).toFixed(1) + '%');
    };
    window.addEventListener('scroll', sweep, { passive: true }); sweep();
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
  var TXT = { day: { ml: '#5f564b', mute: '#8f8479', copper: '#8a4f1f' }, night: { ml: '#39352f', mute: '#4f4a43', copper: '#5e3513' } };
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
      rs.setProperty('--mute-l', hx(mix(rgb(TXT.day.mute), rgb(TXT.night.mute), d)));
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
    $('#skySeason').innerHTML = SL.seasons.map(function (n, k) { return '<button type="button" data-s="' + k + '" aria-pressed="' + (s.season === k) + '">' + n + '</button>'; }).join('');
    var pb = $('#skyPlay span'); if (pb) pb.textContent = SKY.play ? SL.pause : SL.play;
  }
  var playRaf = 0, playLast = 0;
  function playStep(now) {
    if (!SKY.play) return; if (!playLast) playLast = now;
    var dt = now - playLast; if (dt > 45) { SKY.t = ((SKY.t == null ? 0 : SKY.t) + dt / 24000 * 1440) % 1440; playLast = now; applySky(); }
    playRaf = requestAnimationFrame(playStep);
  }
  function setPlay(on) { SKY.play = on; cancelAnimationFrame(playRaf); playLast = 0; if (on) { if (SKY.t == null) SKY.t = SKY.info ? SKY.info.t : 0; playRaf = requestAnimationFrame(playStep); } skyUI(); }
  function openSky(open) { skyOpen = open; $('#skyPop').hidden = !open; $('#skyPill').setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) skyCtl.classList.remove('is-away'); else tickPill(); }
  function tickPill() {  // never sit on top of the hero or a colour composition
    if (!skyCtl || skyOpen) return;
    var pl = $('#skyPill').getBoundingClientRect(), hit = false, h = hero ? hero.getBoundingClientRect() : null;
    if (h && h.bottom > window.innerHeight * 0.4) hit = true;
    $$('.gen__mat').forEach(function (m) { var r = m.getBoundingClientRect(); if (r.right > pl.left - 12 && r.left < pl.right + 12 && r.bottom > pl.top - 12 && r.top < pl.bottom + 12) hit = true; });
    skyCtl.classList.toggle('is-away', hit);
  }
  if (skyCtl) {
    $('#skyPill').addEventListener('click', function () { openSky(!skyOpen); });
    $('#skyClose').addEventListener('click', function () { openSky(false); $('#skyPill').focus(); });
    $('#skyTime').addEventListener('input', function (e) { if (SKY.play) setPlay(false); SKY.t = +e.target.value; applySky(); });
    $('#skySeason').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; SKY.s = +b.getAttribute('data-s'); applySky(); });
    $('#skyPlay').addEventListener('click', function () { setPlay(!SKY.play); });
    $('#skyLive').addEventListener('click', function () { setPlay(false); SKY.t = null; SKY.s = null; applySky(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && skyOpen) { openSky(false); $('#skyPill').focus(); } });
    document.addEventListener('pointerdown', function (e) { if (skyOpen && !skyCtl.contains(e.target)) openSky(false); });
    window.addEventListener('scroll', tickPill, { passive: true }); window.addEventListener('resize', tickPill);
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
