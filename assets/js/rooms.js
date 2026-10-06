/* DVATONE rooms: photo-based wall recolouring (interiors block on the home page, room view in generator option C).

   How it works (ported from the approved concept):
   - every room has a photo, a MASK (RGB = light and shadow measured on the original wall, alpha = wall area),
     an EDGE layer (object outlines with the old wall colour taken out, no halo) and optionally a GLASS layer
     (vase, decanters: the new wall shows through while rims and highlights stay);
   - a finish (seamless texture) is tiled over the whole picture, multiplied by the mask, cut to the wall area,
     then the edge and glass layers are laid back on top. The wall takes the chosen shade with the real light of the photo.

   Mount point (one per stage):
     <div data-rooms data-rooms-base="assets/img/rooms/" data-texture-base="assets/img/tex/">
       <canvas data-room-canvas></canvas>            the picture
       [data-room-tab="d|a|c"]   (anywhere on the page, inside data-rooms-scope or the stage's section)  room switch
       [data-room-finish]        buttons; data-hex="B8A389" and optional data-texture-url="https://.../seamless.webp"
       [data-room-handle]        before/after handle (role="slider"); [data-room-label="l|r"] captions (left = coated, right = original photo)
       [data-room-now]           text node that receives the finish code
     </div>
   Texture hook for the client's seamless textures: put the file URL in data-texture-url on a finish button,
   or call  DVATONE.rooms.get(stage).setFinish({ url: '...' })  /  setFinish({ canvas: HTMLCanvasElement, key: 'unique' }).
*/
(function () {
  'use strict';
  var NS = (window.DVATONE = window.DVATONE || {});
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // focal point (fx, fy) = which part of the photo stays in view when the stage crops it; tile = texture width / photo width
  var ROOMS = {
    d: { img: 'room-d.jpg', mask: 'room-d-mask.webp', edge: 'room-d-edge.webp', fx: 0.55, fy: 0.55, tile: 0.36, glass: { src: 'room-d-glass.webp', x: 1067, y: 682 } },
    a: { img: 'room-a.jpg', mask: 'room-a-mask.webp', edge: 'room-a-edge.webp', fx: 0.78, fy: 0.5, tile: 0.34 },
    c: { img: 'room-c.jpg', mask: 'room-c-mask.webp', edge: 'room-c-edge.webp', fx: 0.5, fy: 0.5, tile: 0.34, glass: { src: 'room-c-glass.webp', x: 899, y: 407 } }
  };
  var SHADE_GAIN = 1.3;
  /* the heavy per-pixel work is cut into ~10 ms slices (long tasks on a phone freeze taps); between slices the thread goes back to the browser */
  var yieldMain = function () {
    if (window.scheduler && window.scheduler.yield) return window.scheduler.yield();
    return new Promise(function (res) { setTimeout(res, 0); });
  };
  var idle = function (fn) { if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1200 }); else setTimeout(fn, 60); };
  var SLICE_MS = 10;
  var STALE = { stale: true };
  var imgCache = {};
  function loadImg(src) {
    if (imgCache[src]) return imgCache[src];
    imgCache[src] = new Promise(function (res, rej) {
      var im = new Image(); im.decoding = 'async';
      im.onload = function () { res(im); }; im.onerror = function (e) { delete imgCache[src]; rej(e); };
      im.src = src;
    });
    return imgCache[src];
  }

  /* seamless tile without mirror symmetry: the texture is cross-faded with a half-offset copy of itself,
     first across x then across y, with variance-preserving weights so the grain contrast stays even */
  function seamlessTile(src, tw, th, isStale) {
    tw = Math.max(8, Math.round(tw)); th = Math.max(8, Math.round(th));
    var c = document.createElement('canvas'); c.width = tw; c.height = th;
    var x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, tw, th);
    var img;
    try { img = x.getImageData(0, 0, tw, th); } catch (e) { return Promise.resolve(c); }
    var p = img.data, n = tw * th, mr = 0, mg = 0, mb = 0, i, j, k;
    for (k = 0; k < n; k++) { mr += p[k * 4]; mg += p[k * 4 + 1]; mb += p[k * 4 + 2]; }
    mr /= n; mg /= n; mb /= n;
    var A = new Float32Array(n * 3), B = new Float32Array(n * 3);
    for (k = 0; k < n; k++) { A[k * 3] = p[k * 4] - mr; A[k * 3 + 1] = p[k * 4 + 1] - mg; A[k * 3 + 2] = p[k * 4 + 2] - mb; }
    function wts(len) {
      var w = new Float32Array(len * 2);
      for (var q = 0; q < len; q++) {
        var t = 1 - Math.abs(2 * (q + 0.5) / len - 1); t = t * t * (3 - 2 * t);
        var u = 1 - t, nn = 1 / Math.sqrt(t * t + u * u);
        w[q * 2] = t * nn; w[q * 2 + 1] = u * nn;
      }
      return w;
    }
    var wx = wts(tw), wy = wts(th), hw = tw >> 1, hh = th >> 1;
    var pass = 0, row = 0;   // pass 0: cross-fade across x, pass 1: across y; one row at a time, many rows per slice
    function slice() {
      var t0 = performance.now();
      while (pass < 2 && performance.now() - t0 < SLICE_MS) {
        if (pass === 0) {
          j = row;
          for (i = 0; i < tw; i++) {
            var o = (j * tw + i) * 3, s2 = (j * tw + (i + hw) % tw) * 3, a = wx[i * 2], b = wx[i * 2 + 1];
            B[o] = A[o] * a + A[s2] * b; B[o + 1] = A[o + 1] * a + A[s2 + 1] * b; B[o + 2] = A[o + 2] * a + A[s2 + 2] * b;
          }
        } else {
          j = row;
          var a2 = wy[j * 2], b2 = wy[j * 2 + 1], js = ((j + hh) % th) * tw;
          for (i = 0; i < tw; i++) {
            var o2 = (j * tw + i) * 3, s3 = (js + i) * 3, d = (j * tw + i) * 4;
            p[d] = mr + B[o2] * a2 + B[s3] * b2; p[d + 1] = mg + B[o2 + 1] * a2 + B[s3 + 1] * b2; p[d + 2] = mb + B[o2 + 2] * a2 + B[s3 + 2] * b2; p[d + 3] = 255;
          }
        }
        if (++row >= th) { row = 0; pass++; }
      }
    }
    return new Promise(function (resolve, reject) {
      (function step() {
        if (isStale && isStale()) { reject(STALE); return; }
        slice();
        if (pass < 2) yieldMain().then(step); else { x.putImageData(img, 0, 0); resolve(c); }
      })();
    });
  }

  function blur3(a, w, h) {
    var t = new Float32Array(a.length), o = new Float32Array(a.length), x, y, c, i, l, r;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 4; l = (y * w + Math.max(0, x - 1)) * 4; r = (y * w + Math.min(w - 1, x + 1)) * 4;
      for (c = 0; c < 3; c++) t[i + c] = (a[l + c] + a[i + c] + a[r + c]) / 3;
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 4; l = (Math.max(0, y - 1) * w + x) * 4; r = (Math.min(h - 1, y + 1) * w + x) * 4;
      for (c = 0; c < 3; c++) o[i + c] = (t[l + c] + t[i + c] + t[r + c]) / 3;
    }
    return o;
  }
  /* glass file = 3 stacked blocks: T x wall light, R (highlights), refraction amount */
  function glassLayer(o, gimg, G) {
    var w = gimg.naturalWidth, h = Math.round(gimg.naturalHeight / 3);
    try {
      var src = o.getImageData(G.x, G.y, w, h), t = src.data;
      var c = document.createElement('canvas'); c.width = w; c.height = h * 3;
      var x = c.getContext('2d'); x.drawImage(gimg, 0, 0);
      var gd = x.getImageData(0, 0, w, h * 3).data, n = w * h * 4;
      var b = blur3(blur3(t, w, h), w, h), i, ch, k, v;
      for (i = 0; i < n; i += 4) {
        k = gd[2 * n + i] / 255 * 0.85;
        for (ch = 0; ch < 3; ch++) {
          v = t[i + ch] + (b[i + ch] - t[i + ch]) * k;
          t[i + ch] = v * gd[i + ch] * SHADE_GAIN / 255 + gd[n + i + ch];
        }
        t[i + 3] = gd[i + 3];
      }
      c.height = h; x.putImageData(src, 0, 0);
      return c;
    } catch (e) { return null; }
  }

  function Stage(el) {
    var self = this;
    this.el = el;
    this.base = el.getAttribute('data-rooms-base') || 'assets/img/rooms/';
    this.texBase = el.getAttribute('data-texture-base') || 'assets/img/tex/';
    this.canvas = $('[data-room-canvas]', el);
    this.room = el.getAttribute('data-room-start') || 'd';
    this.finish = null;
    this.split = 0.56;
    this.token = 0;
    this.cache = {}; this.order = [];
    this.view = { key: '' };
    this.handle = $('[data-room-handle]', el);
    this.labels = { l: $('[data-room-label="l"]', el), r: $('[data-room-label="r"]', el) };
    this.scope = el.closest('[data-rooms-scope]') || document;
    this.nowEl = $('[data-room-now]', this.scope);
    this.wired = false;
    this.fails = 0; this.failAt = 0; this.retryT = 0;   // failed photo requests in a row, when the last one failed, the pending retry
    this.wire();
  }
  Stage.prototype.src = function (f) { return this.base + f; };
  Stage.prototype.finishKey = function (f) { return f.key || f.url || f.hex || 'x'; };
  Stage.prototype.texture = function (f) {
    if (f.canvas) return Promise.resolve(f.canvas);
    return loadImg(f.url || (this.texBase + f.hex + '.webp'));
  };
  Stage.prototype.coated = function (roomId, f) {
    var self = this, key = roomId + '|' + this.finishKey(f), stale = function () { return self.finish !== f && !self.cache[key]; };   // a newer finish replaced this one while it was being prepared
    if (this.cache[key]) return Promise.resolve(this.cache[key]);
    var R = ROOMS[roomId];
    var glP = R.glass ? loadImg(this.src(R.glass.src)).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([loadImg(this.src(R.img)), loadImg(this.src(R.mask)), loadImg(this.src(R.edge)), this.texture(f), glP]).then(function (r) {
      if (self.cache[key]) return self.cache[key];
      var im = r[0], mask = r[1], edge = r[2], tex = r[3];
      var W = im.naturalWidth, H = im.naturalHeight;
      var off = document.createElement('canvas'); off.width = W; off.height = H;
      var o = off.getContext('2d');
      var tw = W * R.tile, th = tw * (tex.height || tex.naturalHeight) / (tex.width || tex.naturalWidth);
      return seamlessTile(tex, tw, th, stale).then(function (tile) {
        return yieldMain().then(function () {
          if (stale()) throw STALE;
          o.fillStyle = o.createPattern(tile, 'repeat'); o.fillRect(0, 0, W, H);
          var gl = r[4] ? glassLayer(o, r[4], R.glass) : null;
          o.globalCompositeOperation = 'multiply'; o.drawImage(mask, 0, 0, W, H);
          var cp = document.createElement('canvas'); cp.width = W; cp.height = H; cp.getContext('2d').drawImage(off, 0, 0);
          o.globalCompositeOperation = 'lighter'; o.globalAlpha = SHADE_GAIN - 1; o.drawImage(cp, 0, 0);
          o.globalAlpha = 1; cp.width = cp.height = 1;
          o.globalCompositeOperation = 'destination-in'; o.drawImage(mask, 0, 0, W, H);
          o.globalCompositeOperation = 'source-over'; o.drawImage(edge, 0, 0, W, H);
          if (gl) o.drawImage(gl, R.glass.x, R.glass.y);
          self.cache[key] = off; self.order.push(key);
          while (self.order.length > 5) { var old = self.order.shift(); if (old !== key) delete self.cache[old]; }
          return off;
        });
      });
    });
  };
  Stage.prototype.size = function (max) {
    var c = this.canvas, r = c.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.min(max || 2000, Math.round(r.width * dpr)), h = Math.round(w * (r.height / Math.max(1, r.width)));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  };
  Stage.prototype.draw = function () {
    var self = this; if (!this.canvas || !this.finish) return;
    var tok = ++this.token, R = ROOMS[this.room];
    this.placeUI();
    if (this.retryT) return;   // a failed photo is fetched again shortly, and that draw shows the latest state
    if (this.fails > 1 && performance.now() - this.failAt < 2000) { this.plain(true); return; }   // still no photo: at most one new request every 2 s
    Promise.all([loadImg(this.src(R.img)), this.coated(this.room, this.finish)]).then(function (r) {
      if (tok !== self.token) return;
      self.fails = 0; self.plain(false);
      self.size(2000);
      var c = self.canvas, im = r[0], off = r[1], cw = c.width, ch = c.height;
      var vk = self.room + '|' + self.finishKey(self.finish) + '|' + cw + 'x' + ch;
      if (self.view.key !== vk || self.view.off !== off) {
        var s = Math.max(cw / im.naturalWidth, ch / im.naturalHeight), dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        var dx = (cw - dw) * R.fx, dy = (ch - dh) * R.fy;
        [['base', im], ['coat', off]].forEach(function (l) {
          var cc = self.view[l[0]] || (self.view[l[0]] = document.createElement('canvas'));
          if (cc.width !== cw || cc.height !== ch) { cc.width = cw; cc.height = ch; }
          var x = cc.getContext('2d');
          x.clearRect(0, 0, cw, ch); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
          x.drawImage(l[1], dx, dy, dw, dh);
        });
        self.view.key = vk; self.view.off = off;
      }
      var ctx = c.getContext('2d');
      ctx.drawImage(self.view.base, 0, 0);
      var sx = Math.round(cw * self.split);
      if (sx > 0) ctx.drawImage(self.view.coat, 0, 0, sx, ch, 0, 0, sx, ch);
      self.el.classList.add('is-ready');
    }).catch(function (e) {
      if (e === STALE || tok !== self.token) return;
      // the room photo (or its mask) did not arrive: one more try in 2 s (a flaky mobile connection), then the finish itself
      // fills the stage, so the visitor sees the colour instead of an empty box; every later draw tries the photo again
      self.fails = (self.fails || 0) + 1; self.failAt = performance.now();
      if (self.fails === 1) { self.retryT = setTimeout(function () { self.retryT = 0; self.draw(); }, 2000); return; }
      self.plain(true);
    });
  };
  Stage.prototype.plain = function (on) {   // fallback without the room photo: the finish alone, cover-fitted; the before/after controls step aside
    var el = this.el, ui = [this.handle, $('.rooms__line', el), this.labels.l, this.labels.r];
    if (!on) {
      if (el.classList.contains('is-plain')) { el.classList.remove('is-plain'); ui.forEach(function (n) { if (n) n.style.visibility = ''; }); }
      return;
    }
    var c = this.canvas, f = this.finish; if (!c || !f) return;
    this.size(2000);
    var x = c.getContext('2d'), cw = c.width, ch = c.height, src = f.canvas;
    x.clearRect(0, 0, cw, ch);
    if (src && src.width) { var s = Math.max(cw / src.width, ch / src.height), dw = src.width * s, dh = src.height * s; x.drawImage(src, (cw - dw) / 2, (ch - dh) / 2, dw, dh); }
    else if (f.hex) { x.fillStyle = '#' + f.hex; x.fillRect(0, 0, cw, ch); }
    el.classList.add('is-ready', 'is-plain');
    ui.forEach(function (n) { if (n) n.style.visibility = 'hidden'; });
  };
  Stage.prototype.placeUI = function () {
    var st = this.el.getBoundingClientRect(); if (!st.width) return;
    this.el.style.setProperty('--x', (this.split * 100).toFixed(2) + '%');
    if (this.handle) {
      this.handle.setAttribute('aria-valuenow', Math.round(this.split * 100));
      var hx = st.width * this.split, hm = 30;
      this.el.style.setProperty('--hx', (Math.max(hm, Math.min(st.width - hm, hx)) - hx).toFixed(1) + 'px');
    }
    if (this.labels.l && this.labels.r) {
      var lx = st.left + st.width * this.split, l = this.labels.l.getBoundingClientRect(), r = this.labels.r.getBoundingClientRect(), gap = 14;
      this.labels.l.classList.toggle('is-off', lx < l.right + gap);
      this.labels.r.classList.toggle('is-off', lx > r.left - gap);
    }
  };
  Stage.prototype.setRoom = function (id) {
    if (!ROOMS[id]) return; this.room = id;
    var self = this;
    $$('[data-room-tab]', this.scope).forEach(function (t) {
      var on = t.getAttribute('data-room-tab') === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1;
    });
    $$('[data-room-alt]', this.scope).forEach(function (a) { a.hidden = a.getAttribute('data-room-alt') !== id; });
    this.draw();
  };
  Stage.prototype.setFinish = function (f, label) {
    this.finish = f;
    if (label != null && this.nowEl) this.nowEl.textContent = label;
    this.draw();
  };
  Stage.prototype.setSplit = function (v) { this.split = Math.max(0.02, Math.min(0.98, v)); this.draw(); };
  Stage.prototype.dropKey = function (prefix) {
    var self = this;
    Object.keys(this.cache).forEach(function (k) { if (k.indexOf('|' + prefix) > -1) delete self.cache[k]; });
    this.order = this.order.filter(function (k) { return !!self.cache[k]; });
  };
  Stage.prototype.wire = function () {
    var self = this, el = this.el;
    var tabs = $$('[data-room-tab]', this.scope);
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { self.setRoom(t.getAttribute('data-room-tab')); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, to = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : k === 'ArrowRight' || k === 'ArrowDown' ? (i + 1) % tabs.length : k === 'ArrowLeft' || k === 'ArrowUp' ? (i - 1 + tabs.length) % tabs.length : -1;
        if (to < 0) return; e.preventDefault();
        var n = tabs[to]; self.setRoom(n.getAttribute('data-room-tab')); n.focus();
      });
    });
    var fin = $$('[data-room-finish]', this.scope);
    fin.forEach(function (b) {
      b.addEventListener('click', function () {
        fin.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        self.setFinish({ hex: b.getAttribute('data-hex'), url: b.getAttribute('data-texture-url') || '' }, b.getAttribute('data-code') || b.getAttribute('data-hex'));
      });
    });
    var dragging = false, raf = 0;
    var move = function (e) {
      var r = el.getBoundingClientRect();
      self.split = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width));
      if (!raf) raf = requestAnimationFrame(function () { raf = 0; self.draw(); });
    };
    el.addEventListener('pointerdown', function (e) { if (e.target.closest('a,button:not([data-room-handle])')) return; dragging = true; if (el.setPointerCapture) el.setPointerCapture(e.pointerId); move(e); });
    el.addEventListener('pointermove', function (e) { if (dragging) move(e); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) { el.addEventListener(ev, function () { dragging = false; }); });
    if (this.handle) this.handle.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowLeft' ? -0.05 : e.key === 'Home' ? -1 : e.key === 'End' ? 1 : 0; if (!d) return; e.preventDefault();
      self.setSplit(Math.abs(d) === 1 ? (d < 0 ? 0.02 : 0.98) : self.split + d);
    });
    window.addEventListener('resize', function () { clearTimeout(self._rz); self._rz = setTimeout(function () { self.draw(); }, 120); });
    // a short sweep when the stage first comes into view, so the before/after reads at once
    if ('IntersectionObserver' in window && !reduce && el.hasAttribute('data-room-hint')) {
      var hinted = false;
      new IntersectionObserver(function (ents) {
        if (!ents[0].isIntersecting || hinted) return; hinted = true;
        var t0 = performance.now();
        (function step(now) {
          var k = Math.min(1, (now - t0) / 1500), e = 1 - Math.pow(1 - k, 3);
          self.split = 0.92 - (0.92 - 0.56) * e; self.draw();
          if (k < 1 && !dragging) requestAnimationFrame(step);
        })(t0);
      }, { threshold: 0.35 }).observe(el);
    }
  };

  var stages = [];
  NS.rooms = {
    ROOMS: ROOMS,
    mount: function (el) {
      var s = new Stage(el); stages.push([el, s]);
      var first = $('[data-room-finish][aria-pressed="true"]', s.scope) || $('[data-room-finish]', s.scope);
      if (first) s.setFinish({ hex: first.getAttribute('data-hex'), url: first.getAttribute('data-texture-url') || '' }, first.getAttribute('data-code') || first.getAttribute('data-hex'));
      s.setRoom(s.room);
      return s;
    },
    get: function (el) { for (var i = 0; i < stages.length; i++) if (stages[i][0] === el) return stages[i][1]; return null; }
  };
  var mountAll = function () { $$('[data-rooms]').forEach(function (el) { if (!NS.rooms.get(el) && !el.hasAttribute('data-rooms-manual')) NS.rooms.mount(el); }); };
  if ('IntersectionObserver' in window) {
    $$('[data-rooms]').forEach(function (el) {
      if (el.hasAttribute('data-rooms-manual')) return;
      new IntersectionObserver(function (es, o) { if (es[0].isIntersecting) { o.disconnect(); idle(function () { if (!NS.rooms.get(el)) NS.rooms.mount(el); }); } }, { rootMargin: '100% 0px 100% 0px' }).observe(el);   // about one screen ahead, then in an idle slot
    });
  } else mountAll();
})();
