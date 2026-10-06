/* Dvatone hero v2: builds the granule list off the main thread (55 000 granules on desktop).
   The typed arrays are transferred back, not copied. hero2.js falls back to building in place if workers fail. */
import { buildCoat } from './coat.js';

self.onmessage = (e) => {
  const { id, opts } = e.data || {};
  try {
    const c = buildCoat(opts);
    const tr = [c.dep.a.buffer, c.dep.b.buffer, c.dep.c.buffer, c.dep.d.buffer, c.fly.a.buffer, c.fly.b.buffer, c.fly.c.buffer];
    self.postMessage({ id, coat: c }, tr);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
