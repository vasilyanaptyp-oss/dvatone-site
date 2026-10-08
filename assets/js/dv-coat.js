/* DVATONE coat (wave 6, 07.10): the composition painted on a 2D canvas with the fleck structure of a real Dvatone scan, for the
   generator page (generator.js uses it as its default preview engine) and the generator teaser on the home page ([data-gt]).

   The structure is the rank map the room view already uses (assets/3d/interior2/coat/dv018.webp, read only: 1024 x 1024,
   seamless, one channel; every fleck of the DV 018 scan carries a rank u, uniform over 0..1). Each fleck takes the colour of the
   composition, sorted dark to light, whose cumulative share contains its rank (the room view's rule, photoroom.js bakeScan), with
   the room view's faint rim where the neighbour is another colour and a fine mottle inside the fleck. So the shares are the
   areas, the flecks have the size, shape and grouping of the real material, and nothing is added: no highlight, no bright
   speck, no sparkle (no metallic finish exists in the generator yet). Granule density hands a part of the accent flecks back to
   the base colour (sparser accents; at 100 % the shares are exact).
   Scale: the room view's (the tile is 20 cm of wall at granule size M; S 0.6, XL 1.8); at S, the standard very fine fraction, the
   flecks have the size of the granules of the DV scans: checked side by side at the same scale, qa/w6/coat-compare.png. Every
   fleck keeps a soft edge (its border with the next fleck is a touch darker, as the scans show it); the average colour stays
   the recipe's (the edges are normalised away). Painting a new composition is one table lookup per pixel (about 10 ms). The wall view shows 60 cm across the frame, the macro view 16 cm.

   DVATONE.coat.render(canvas, state, { draft, onReady }) -> true when the scan structure painted the canvas; false while it is
   still loading (or could not load): the caller paints its own interim picture and onReady() asks it to paint again.
   state: { mix: [{ hex, share }], grain: 'S' | 'M' | 'XL', density: 0.4..1, scale: 'wall' | 'macro', seed }. */
(function () {
  'use strict';
  var NS = (window.DVATONE = window.DVATONE || {});
  if (NS.coat) return;
  var me = document.currentScript && document.currentScript.src || '';
  var ROOT = me ? me.replace(/assets\/js\/dv-coat\.js(?:\?.*)?$/, '') : '';
  var MAP = ROOT + 'assets/3d/interior2/coat/dv018.webp';
  var TILE_M = 0.2, GRAIN = { S: 0.6, M: 1, XL: 1.8 }, VIEW_M = { wall: 0.6, macro: 0.16 };
  var LV = [], rank = null, failed = false, loading = null, waiters = [];   // LV[0]: the full rank map, LV[1]: half size (a slider being dragged)

  /* The map is decoded and prepared in a worker (dv-coat-worker.js: createImageBitmap + OffscreenCanvas), so the main thread only
     paints; without workers or OffscreenCanvas the same work runs here (one longer task). Nothing loads until load() is called:
     generator.js calls it at idle (a pre-rendered picture of the default composition holds the first paint), the home teaser when
     it comes near the screen. */
  var QN = 32;
  function load() {
    if (loading) return loading;
    loading = new Promise(function (res) {
      var done = function () { rank = true; res(true); };
      if (window.Worker && window.OffscreenCanvas && window.createImageBitmap) {
        try {
          var wk = new Worker(ROOT + 'assets/js/dv-coat-worker.js');
          wk.onmessage = function (e) {
            var d = e.data || {}; wk.terminate();
            if (!d.ok) { onMain(res); return; }
            LV = [{ size: d.w, key: new Uint16Array(d.k0), steps: new Float32Array(d.s0), tile: { key: '', c: null } },
                  { size: d.w / 2, key: new Uint16Array(d.k1), steps: new Float32Array(d.s1), tile: { key: '', c: null } }];
            done();
          };
          wk.onerror = function () { wk.terminate(); onMain(res); };
          wk.postMessage({ url: new URL(MAP, location.href).href, qn: QN });
          return;
        } catch (e) { /* a blocked worker: the main-thread path below */ }
      }
      onMain(res);
    });
    loading.then(function () { var w = waiters; waiters = []; w.forEach(function (f) { try { f(); } catch (e) {} }); });
    return loading;
  }
  function onMain(res) {
    var im = new Image();
    im.decoding = 'async';
    im.onload = function () {
      try {
        var c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0);
        var d = x.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height;
        var full = new Uint8Array(n), w = c.width, i;
        for (i = 0; i < n; i++) full[i] = d[i * 4];
        var half = new Uint8Array(n / 4), w2 = w / 2;
        for (i = 0; i < n / 4; i++) { var hx = i % w2; half[i] = full[((i - hx) / w2) * 2 * w + hx * 2]; }
        LV = [level(full, w), level(half, w2)];
        rank = true;
      } catch (e) { failed = true; }
      res(!failed);
    };
    im.onerror = function () { failed = true; res(false); };
    im.src = MAP;
  }

  /* a fine mottle inside the fleck (+-2.5 %) and its soft edge: the border with the next fleck 5 to 10 % darker. Both depend only
     on the map, so they are worked out once: every pixel gets a key = its fleck's rank (8 bits) and its brightness step (5 bits,
     32 steps of about 0.5 %, normalised so the tile's mean is the recipe's colour). A composition then paints the tile with one
     lookup per pixel in a table of 8 192 colours. */
  function level(r, w) {
    var n = w * w, f = new Float32Array(n), m = w - 1, sum = 0, lo = 9, hi = 0, i;
    for (i = 0; i < n; i++) {
      var px = i % w, py = (i - px) / w, r0 = r[i], b = 0;
      if (r[py * w + ((px + 1) & m)] !== r0) b++;
      if (r[py * w + ((px + m) & m)] !== r0) b++;
      if (r[((py + 1) & m) * w + px] !== r0) b++;
      if (r[((py + m) & m) * w + px] !== r0) b++;
      var h = Math.sin(px * 12.9898 + py * 78.233) * 43758.5453;
      f[i] = (1 + 0.05 * ((h - Math.floor(h)) - 0.5)) * (1 - 0.05 * Math.min(b, 2)); sum += f[i];
    }
    var k1 = n / sum, key = new Uint16Array(n), steps = new Float32Array(QN);
    for (i = 0; i < n; i++) { f[i] *= k1; if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    var span = (hi - lo) || 1, cnt = new Float64Array(QN), acc = new Float64Array(QN);
    for (i = 0; i < n; i++) { var q = Math.min(QN - 1, Math.floor((f[i] - lo) / span * QN)); key[i] = (r[i] << 5) | q; cnt[q]++; acc[q] += f[i]; }
    for (i = 0; i < QN; i++) steps[i] = cnt[i] ? acc[i] / cnt[i] : lo + (i + 0.5) / QN * span;   // each step paints its own mean brightness
    return { size: w, key: key, steps: steps, tile: { key: '', c: null } };
  }
  var rgb = function (h) { return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  var lin = function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  var luma = function (c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); };
  var hash = function (n) { var h = Math.sin(n * 91.3458 + 17.17) * 47453.5453; return h - Math.floor(h); };

  /* the albedo tile of one composition (size x size), cached by composition and density, per level */
  function albedo(st, lv) {
    var L = LV[lv], size = L.size, tile = L.tile;
    var mix = (st.mix || []).filter(function (c) { return c && /^[0-9A-Fa-f]{6}$/.test(c.hex); });
    if (!mix.length) mix = [{ hex: 'B8A389', share: 100 }];
    var dens = Math.max(0.4, Math.min(1, st.density == null ? 0.9 : +st.density));
    var key = mix.map(function (c) { return c.hex + ':' + c.share; }).join(',') + '|' + dens.toFixed(2) + '|' + (st.seed | 0);
    if (tile.key === key && tile.c) return tile.c;
    var cols = mix.map(function (c, i) { var r = rgb(c.hex.toUpperCase()); return { r: r, l: luma(r), share: Math.max(0, +c.share || 0), base: i === 0 }; });
    cols.sort(function (a, b) { return a.l - b.l; });
    var tot = cols.reduce(function (a, c) { return a + c.share; }, 0) || 1, cum = [], acc = 0, bi = 0;
    cols.forEach(function (c, i) { acc += c.share / tot; cum.push(acc); if (c.base) bi = i; });
    var keep = 0.4 + 0.6 * (dens - 0.4) / 0.6, sd = (st.seed | 0) * 7.31, tab = new Uint32Array(256 * QN), u, q;
    for (u = 0; u < 256; u++) {
      var v = (u + 0.5) / 256, k = 0;
      while (k < cols.length - 1 && v > cum[k]) k++;
      if (k !== bi && hash(u + sd) > keep) k = bi;   // a sparser composition: this group of flecks wears the base colour
      var c0 = cols[k].r;
      for (q = 0; q < QN; q++) {
        var g = L.steps[q], R = Math.min(255, Math.round(c0[0] * g)), G = Math.min(255, Math.round(c0[1] * g)), B = Math.min(255, Math.round(c0[2] * g));
        tab[(u << 5) | q] = (255 << 24 | B << 16 | G << 8 | R) >>> 0;
      }
    }
    var c = tile.c || document.createElement('canvas');
    if (c.width !== size) { c.width = size; c.height = size; }
    var x = c.getContext('2d'), img = x.createImageData(size, size), o32 = new Uint32Array(img.data.buffer), kk = L.key, n = size * size;
    for (var i = 0; i < n; i++) o32[i] = tab[kk[i]];
    x.putImageData(img, 0, 0);
    tile.key = key; tile.c = c;
    return c;
  }

  /* the tile scaled to its size on this canvas (a high-quality downscale once, then a plain repeat: no shimmer, no moire) */
  var scaled = { key: '', c: null };
  function paintCanvas(canvas, st, draft) {
    var W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    var view = st.scale === 'macro' ? 'macro' : 'wall';
    var pxm = W / VIEW_M[view], tp = Math.max(24, Math.round(TILE_M * (GRAIN[st.grain] || 0.6) * pxm));
    var lv = (draft || tp * 1.6 <= LV[1].size) ? 1 : 0, size = LV[lv].size;   // the half-size map while a slider is dragged and whenever the tile is drawn small anyway (the wall view): a quarter of the work, the same picture
    var a = albedo(st, lv), key = lv + '|' + LV[lv].tile.key + '|' + tp;
    if (scaled.key !== key) {
      var s = scaled.c || document.createElement('canvas');
      s.width = tp; s.height = tp;
      var sx = s.getContext('2d');
      sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
      if (tp < size / 2) {   // two steps for a large reduction: the high-quality filter alone can alias at 4x
        var mid = document.createElement('canvas'); mid.width = mid.height = Math.round(tp * 2);
        var mx = mid.getContext('2d'); mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high';
        mx.drawImage(a, 0, 0, mid.width, mid.height); sx.drawImage(mid, 0, 0, tp, tp);
      } else sx.drawImage(a, 0, 0, tp, tp);
      scaled.c = s; scaled.key = key;
    }
    var pat = ctx.createPattern(scaled.c, 'repeat'), off = ((st.seed | 0) * 0.618) % 1;
    ctx.save();
    ctx.translate(-Math.round(off * tp), -Math.round(((st.seed | 0) * 0.382 % 1) * tp));
    ctx.fillStyle = pat; ctx.fillRect(0, 0, W + tp, H + tp);
    ctx.restore();
  }

  NS.coat = {
    map: MAP,
    ready: function () { return !!rank; },
    load: load,
    render: function (canvas, st, opts) {
      opts = opts || {};
      if (!rank) {
        if (opts.onReady) waiters.push(opts.onReady);
        if (!failed) load();
        return false;
      }
      paintCanvas(canvas, st || {}, !!opts.draft);
      return true;
    },
    /* the interim picture while the structure loads (and the fallback if it cannot): the average colour of the composition with a
       fine, low-contrast grain, never a bright speck */
    interim: function (canvas, st) {
      var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height, mix = (st && st.mix) || [], t = 0, s = [0, 0, 0];
      mix.forEach(function (c) { var r = rgb(c.hex); for (var k = 0; k < 3; k++) s[k] += lin(r[k]) * c.share; t += c.share; });
      if (!t) { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, W, H); return; }
      var g = s.map(function (v) { v /= t; v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(v * 255); });
      ctx.fillStyle = 'rgb(' + g.join(',') + ')'; ctx.fillRect(0, 0, W, H);
    }
  };

  /* ---------- the home page teaser ([data-gt]): curated palettes, the base colour, wall / macro; the button opens the full
     generator with this composition (same composition number there) ---------- */
  var gt = document.querySelector('[data-gt]');
  if (!gt) return;
  var DV = window.DV || {}, PRE = DV.presets || [], NAMES = DV.presetNames || [], T = DV.gt || {};
  var SH = [45, 25, 20, 10];
  var cv = gt.querySelector('[data-gt-canvas]');
  var st = { preset: 0, cols: (PRE[0] || []).map(function (c) { return c.slice(); }), scale: 'wall', grain: 'S', density: 0.9, seed: 11 };
  var $$ = function (s) { return Array.prototype.slice.call(gt.querySelectorAll(s)); };
  var mixOf = function () { return st.cols.map(function (c, k) { return { hex: c[1].toUpperCase(), share: SH[k] || 10 }; }); };
  function compId(mix) {   // the generator's composition number (generator.js compId): the same recipe, the same number
    var s = mix.map(function (c) { return c.hex + c.share; }).join('') + st.grain + Math.round(st.density * 100), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h % 65536).toString(16).toUpperCase();
  }
  var pad4 = function (s) { while (s.length < 4) s = '0' + s; return s; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function sizeCanvas() {
    if (!cv) return false;
    var r = cv.getBoundingClientRect(); if (r.width < 2) return false;
    var w = Math.min(2000, Math.round(r.width * Math.min(window.devicePixelRatio || 1, 1.5))), h = Math.max(1, Math.round(w * r.height / r.width));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; return true; }
    return false;
  }
  function draw() {
    if (!cv) return;
    var s = { mix: mixOf(), grain: st.grain, density: st.density, scale: st.scale, seed: st.seed };
    if (!NS.coat.render(cv, s, { onReady: draw })) NS.coat.interim(cv, s);
  }
  function render() {
    var mix = mixOf(), same = PRE[st.preset] && PRE[st.preset].every(function (c, k) { return st.cols[k] && st.cols[k][1] === c[1]; }) && st.cols.length === PRE[st.preset].length;
    var title = gt.querySelector('[data-gt-title]');
    if (title) title.innerHTML = same && NAMES[st.preset] ? esc(NAMES[st.preset]) : '<span class="phead__no">' + esc(T.no || '№') + '</span>' + pad4(compId(mix));
    var sub = gt.querySelector('[data-gt-sub]');
    if (sub && T.sub) sub.textContent = T.sub.replace('{n}', mix.length).replace('{shades}', (T.shades || {})[mix.length] || '').replace('{fraction}', st.grain).replace('{density}', Math.round(st.density * 100));
    var base = gt.querySelector('[data-gt-base]'); if (base) base.textContent = st.cols[0] ? st.cols[0][0] : '';
    $$('[data-gt-preset]').forEach(function (b) { b.setAttribute('aria-pressed', same && +b.getAttribute('data-gt-preset') === st.preset ? 'true' : 'false'); });
    $$('[data-gt-hex]').forEach(function (b) { b.setAttribute('aria-pressed', st.cols[0] && b.getAttribute('data-gt-hex') === st.cols[0][1] ? 'true' : 'false'); });
    $$('[data-gt-view]').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-gt-view') === st.scale ? 'true' : 'false'); });
    var ratio = gt.querySelector('[data-gt-ratio]');
    if (ratio) ratio.innerHTML = mix.map(function (c) { return '<i style="flex-grow:' + c.share + ';background:#' + c.hex + '"></i>'; }).join('');
    var rec = gt.querySelector('[data-gt-recipe]');
    if (rec) rec.innerHTML = st.cols.map(function (c, k) {
      return '<li><i style="background:#' + esc(c[1]) + '"></i><span class="c">' + esc(c[0]) + (k === 0 && T.base ? '<small>' + esc(T.base) + '</small>' : '') + '</span><span class="f"></span><b>' + (SH[k] || 10) + '%</b></li>';
    }).join('');
    var go = gt.querySelector('[data-gt-go]');
    if (go) go.setAttribute('href', go.getAttribute('href').split('?')[0] + '?mix=' + mix.map(function (c) { return c.hex + ':' + c.share; }).join(','));
    draw();
  }
  gt.addEventListener('click', function (e) {
    var p = e.target.closest('[data-gt-preset]');
    if (p) { st.preset = +p.getAttribute('data-gt-preset'); st.cols = (PRE[st.preset] || []).map(function (c) { return c.slice(); }); render(); return; }
    var b = e.target.closest('[data-gt-hex]');
    if (b) {
      var pick = [b.getAttribute('data-gt-code'), b.getAttribute('data-gt-hex')];
      for (var j = 1; j < st.cols.length; j++) if (st.cols[j][1] === pick[1]) st.cols[j] = st.cols[0];   // a shade already in the mix swaps places with the base
      st.cols[0] = pick; render(); return;
    }
    var v = e.target.closest('[data-gt-view]'); if (v) { st.scale = v.getAttribute('data-gt-view'); render(); }
  });
  var started = false;
  function start() { if (started) return; started = true; sizeCanvas(); render(); }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '600px 0px' });
    io.observe(gt);
    if (cv && window.ResizeObserver) { var rt = 0; new ResizeObserver(function () { if (!started) return; clearTimeout(rt); rt = setTimeout(function () { if (sizeCanvas()) draw(); }, 150); }).observe(cv); }
  } else start();
})();
