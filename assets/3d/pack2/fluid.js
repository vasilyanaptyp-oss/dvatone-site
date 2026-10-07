/* Dvatone pack2: the poured paint on the high tier, the solver side.
   fluid-sim.js runs in a module worker (fluid-worker.js), or on the main thread where module workers are missing.
   The drops themselves are never drawn: the landed ones build the height field of puddle.js (the paint lying on the
   plinth), the falling ones are drawn as one rope by pour.js. (dev/fluid-ssf.js keeps the screen-space fluid
   renderer this replaced.)

   createFluid({ max, spacing })
     -> { ready, emit(arr6, n), update(dt, solids), freeze(), clear(), dispose(),
          count, active, sleeping, emitted, version (bumps with every new state), stepMs, rtt, spacing, max,
          positions (Float32Array [x, y, z, speed] * count) } */
export function createFluid(o = {}) {
  const MAX = o.max || 1600, SP = o.spacing || 0.06;
  const P = new Float32Array(MAX * 4);
  let pending = new Float32Array(256 * 6), pendingN = 0, emitted = 0;
  function emit(arr, k) {
    if (pendingN + k > pending.length / 6) { const b = new Float32Array((pendingN + k) * 12); b.set(pending.subarray(0, pendingN * 6)); pending = b; }
    pending.set(arr.subarray(0, k * 6), pendingN * 6); pendingN += k;
    emitted = Math.min(MAX, emitted + k);
  }

  /* the solver: a module worker, or the same code on this thread */
  let worker = null, sim = null, inFlight = false, accDt = 0, n = 0, active = 0, sleeping = true, solidsLatest = null;
  let stepMs = 0, rtt = 0, sentAt = 0, version = 0, gen = 0;
  const spare = [new Float32Array(MAX * 4), new Float32Array(MAX * 4)];
  const opts = { max: MAX, spacing: SP };
  const ready = new Promise(res => {
    try {
      worker = new Worker(new URL('./fluid-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'ready') { res(true); return; }
        if (m.type === 'state') {
          inFlight = false;
          /* a step that was under way when the paint was cleared: its drops are gone already */
          if (m.gen !== gen) { spare.push(m.buf); return; }
          n = m.n; active = m.active; sleeping = m.sleeping; stepMs = stepMs * 0.8 + m.ms * 0.2; rtt = performance.now() - sentAt;
          P.set(m.buf.subarray(0, n * 4)); version++;
          spare.push(m.buf);
        }
      };
      worker.onerror = () => { worker && worker.terminate(); worker = null; local().then(res); };
      worker.postMessage({ type: 'init', opts });
    } catch (e) { worker = null; local().then(res); }
  });
  function local() {
    return import('./fluid-sim.js').then(m => { sim = m.createSim(opts); return true; });
  }

  function update(dt, solids) {
    if (solids) solidsLatest = solids;
    accDt += dt;
    if (worker) {
      if (inFlight) return;
      const buf = spare.pop() || new Float32Array(MAX * 4);
      const em = pendingN ? pending.slice(0, pendingN * 6) : null;
      worker.postMessage({ type: 'step', dt: accDt, emit: em, emitN: pendingN, solids: solidsLatest, buf, gen }, em ? [buf.buffer, em.buffer] : [buf.buffer]);
      inFlight = true; accDt = 0; pendingN = 0; solidsLatest = null; sentAt = performance.now();
    } else if (sim) {
      if (solidsLatest) sim.setSolids(solidsLatest);
      if (pendingN) sim.emit(pending, pendingN);
      const t0 = performance.now();
      sim.step(accDt); accDt = 0; pendingN = 0; solidsLatest = null;
      stepMs = stepMs * 0.8 + (performance.now() - t0) * 0.2;
      n = sim.count; active = sim.active; sleeping = sim.sleeping;
      const p = sim.pos, s = sim.speed;
      for (let i = 0; i < n; i++) { P[i * 4] = p[i * 3]; P[i * 4 + 1] = p[i * 3 + 1]; P[i * 4 + 2] = p[i * 3 + 2]; P[i * 4 + 3] = s[i]; }
      version++;
    }
  }
  function freeze() { if (worker) worker.postMessage({ type: 'freeze' }); else if (sim) sim.sleepAll(); active = 0; sleeping = true; }
  function clear() {
    if (worker) worker.postMessage({ type: 'clear' }); else if (sim) sim.clear();
    gen++;
    n = 0; active = 0; sleeping = true; emitted = 0; pendingN = 0; version++;
  }
  return {
    ready, emit, update, clear, freeze,
    dispose() { if (worker) worker.terminate(); worker = null; sim = null; },
    get count() { return n; }, get active() { return active; }, get sleeping() { return sleeping; }, get emitted() { return emitted; },
    get version() { return version; }, get stepMs() { return stepMs; }, get rtt() { return rtt; },
    spacing: SP, max: MAX, positions: P
  };
}
