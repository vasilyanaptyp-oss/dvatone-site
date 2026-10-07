/* Dvatone pack2: the paint solver (fluid-sim.js) off the main thread.
   in:  { type: 'init', opts } | { type: 'step', dt, emit, emitN, solids, buf, gen } | { type: 'clear' } | { type: 'freeze' }
   out: { type: 'state', n, active, sleeping, buf, gen }   buf: Float32Array [x, y, z, speed] * n, handed back and forth;
        gen echoes the step's generation (the main thread drops a state that left before the last clear) */
import { createSim } from './fluid-sim.js';

let sim = null;
self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') { sim = createSim(m.opts || {}); self.postMessage({ type: 'ready', max: sim.max, radius: sim.radius }); return; }
  if (!sim) return;
  if (m.type === 'clear') { sim.clear(); return; }
  if (m.type === 'freeze') { sim.sleepAll(); return; }
  if (m.type === 'step') {
    if (m.solids) sim.setSolids(m.solids);
    if (m.emit && m.emitN) sim.emit(m.emit, m.emitN);
    const t0 = performance.now();
    sim.step(m.dt);
    const ms = performance.now() - t0;
    const n = sim.count, p = sim.pos, s = sim.speed;
    let buf = m.buf;
    if (!buf || buf.length < n * 4) buf = new Float32Array(Math.max(n, 64) * 4);
    for (let i = 0; i < n; i++) { buf[i * 4] = p[i * 3]; buf[i * 4 + 1] = p[i * 3 + 1]; buf[i * 4 + 2] = p[i * 3 + 2]; buf[i * 4 + 3] = s[i]; }
    self.postMessage({ type: 'state', n, active: sim.active, sleeping: sim.sleeping, ms, buf, gen: m.gen }, [buf.buffer]);
  }
};
