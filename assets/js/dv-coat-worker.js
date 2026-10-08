/* DVATONE coat worker (wave 6): decodes the fleck structure map off the main thread and prepares what dv-coat.js paints with.
   In: { url, qn }   Out: { ok, w, k0, s0, k1, s1 } (transferred buffers): for the full map (w x w) and the half-size map, one
   Uint16 key per pixel = the fleck's rank (8 bits) and its brightness step (5 bits: the fine mottle and the soft fleck edge,
   normalised so the tile's mean is the recipe's colour) and the mean brightness of each step. The same maths as dv-coat.js level(). */
self.onmessage = function (e) {
  var url = e.data && e.data.url, QN = (e.data && e.data.qn) || 32;
  fetch(url).then(function (r) { if (!r.ok) throw new Error('map ' + r.status); return r.blob(); })
    .then(function (b) { return createImageBitmap(b); })
    .then(function (bmp) {
      var w = bmp.width, c = new OffscreenCanvas(w, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(bmp, 0, 0);
      var d = x.getImageData(0, 0, w, w).data, n = w * w, full = new Uint8Array(n), i;
      for (i = 0; i < n; i++) full[i] = d[i * 4];
      var w2 = w / 2, half = new Uint8Array(n / 4);
      for (i = 0; i < n / 4; i++) { var hx = i % w2; half[i] = full[((i - hx) / w2) * 2 * w + hx * 2]; }
      var a = level(full, w, QN), b2 = level(half, w2, QN);
      self.postMessage({ ok: true, w: w, k0: a.key.buffer, s0: a.steps.buffer, k1: b2.key.buffer, s1: b2.steps.buffer },
        [a.key.buffer, a.steps.buffer, b2.key.buffer, b2.steps.buffer]);
    })
    .catch(function () { self.postMessage({ ok: false }); });
};
function level(r, w, QN) {
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
  for (i = 0; i < QN; i++) steps[i] = cnt[i] ? acc[i] / cnt[i] : lo + (i + 0.5) / QN * span;
  return { key: key, steps: steps };
}
