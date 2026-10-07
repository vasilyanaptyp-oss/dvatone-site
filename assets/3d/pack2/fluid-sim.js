/* Dvatone pack2: viscous paint as a position-based fluid (Macklin & Müller 2013, "Position Based Fluids").
   Decimetres and seconds, like the rest of the scene. Runs in a worker (fluid-worker.js) or, without workers, on the
   main thread. Particles are emitted at the can's lip, fall, hit the plinth, the floor, the can, its lid and the box,
   and spread into a puddle: incompressibility from the density constraint, a little cohesion, strong XSPH viscosity
   and sticky friction on solid surfaces (paint clings to the stone instead of skating on it).
   Particles that come to rest go to sleep one by one and only serve as neighbours, so a settled puddle costs almost
   nothing; anything moving into it (new paint, the can, the box) wakes the particles it touches.

   createSim({ max, spacing }) -> {
     emit(arr, n)       arr: [x, y, z, vx, vy, vz] * n
     setSolids(s)       { plinth: [r, top], can / lid: [cx,cy,cz, qx,qy,qz,qw, r, halfH], box: [cx,cy,cz, qx,qy,qz,qw, hx,hy,hz],
                          wakeAt: [x, y, z, r] (wake everything within r) }
     step(dt)           advances in fixed substeps; returns true when something moved
     count, active, pos (Float32Array), speed (Float32Array), sleeping, clear()
   } */
export function createSim(opts = {}) {
  const MAX = opts.max || 3000;
  const S0 = opts.spacing || 0.06;                   /* rest spacing */
  const H = S0 * (opts.kernel || 1.8), H2 = H * H;    /* kernel radius */
  const G = opts.gravity || 98.1;
  const SUB = opts.substep || 1 / 60, ITER = opts.iterations || 2;
  const COH = opts.cohesion == null ? 0.35 : opts.cohesion;        /* share of the density constraint kept when stretched */
  const COHMIN = opts.cohMin || 12;     /* cohesion inside the body of the paint (the stream, a heap); a lying film relaxes freely */
  const DPMAX = S0 * 0.25;                                          /* no single correction moves a drop more than this: no splashes */                                  /* cohesion needs this many neighbours (not for lone drops) */
  const VISC = opts.viscosity == null ? 0.6 : opts.viscosity;      /* XSPH per substep: thick paint */
  const STICK = opts.stick == null ? 0.6 : opts.stick;              /* tangential speed lost per substep on contact */
  const SLEEPV = opts.sleepSpeed || 0.25;                           /* dm/s */
  const VMAXC = 6;                                                  /* dm/s, speed limit for paint touching a solid */
  const SPREAD = opts.spread || 1.4;                                /* dm/s, fastest creep of paint lying on a surface */
  const STATIC = opts.static || 0.3;                                /* dm/s, slower than this a lying drop stays put */
  const RAD = S0 * 0.5;                              /* collision radius */
  const POLY6 = 315 / (64 * Math.PI * Math.pow(H, 9));
  const SPIKY = -45 / (Math.PI * Math.pow(H, 6));
  const W = r2 => { const d = H2 - r2; return d > 0 ? POLY6 * d * d * d : 0; };
  const W0 = POLY6 * H2 * H2 * H2;

  /* rest density and the scale of the constraint gradient, measured on a lattice at rest spacing */
  let rho0 = 0, sq = 0;
  {
    const k = Math.ceil(H / S0);
    for (let x = -k; x <= k; x++) for (let y = -k; y <= k; y++) for (let z = -k; z <= k; z++) {
      const dx = x * S0, dy = y * S0, dz = z * S0, r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= H2) continue;
      rho0 += W(r2);
      if (r2 > 0) { const r = Math.sqrt(r2), s = SPIKY * (H - r) * (H - r) / r; sq += s * s * r2; }
    }
  }
  const EPS = (sq / (rho0 * rho0)) * 0.08;           /* constraint relaxation */
  const DQ = W((0.25 * H) * (0.25 * H));             /* s_corr reference (tensile instability) */
  /* artificial pressure (anti-clumping), scaled to the constraint's own size so it means the same at any spacing */
  const KCORR = (opts.kcorr == null ? 0.02 : opts.kcorr) / (sq / (rho0 * rho0));
  const WAKE2 = (0.72 * S0) * (0.72 * S0);

  const pos = new Float32Array(MAX * 3), prv = new Float32Array(MAX * 3), vel = new Float32Array(MAX * 3);
  const lam = new Float32Array(MAX), dp = new Float32Array(MAX * 3), speed = new Float32Array(MAX), rest = new Float32Array(MAX);
  const act = new Uint8Array(MAX), wake = new Uint8Array(MAX), contact = new Uint8Array(MAX), nrm = new Float32Array(MAX * 3);
  const al = new Int32Array(MAX);
  const NB = 26, nbr = new Int32Array(MAX * NB), nbc = new Uint8Array(MAX);
  const TABLE = 8192, head = new Int32Array(TABLE), next = new Int32Array(MAX);
  let n = 0, na = 0, acc = 0, sleeping = true;
  const solids = { plinth: null, can: null, box: null, lid: null, floor: 0, bound: 9 };

  function emit(a, m) {
    for (let k = 0; k < m && n < MAX; k++) {
      const o = k * 6, i = n * 3;
      pos[i] = prv[i] = a[o]; pos[i + 1] = prv[i + 1] = a[o + 1]; pos[i + 2] = prv[i + 2] = a[o + 2];
      vel[i] = a[o + 3]; vel[i + 1] = a[o + 4]; vel[i + 2] = a[o + 5];
      act[n] = 1; rest[n] = 0; wake[n] = 0; speed[n] = 0;
      n++;
    }
    if (m > 0) sleeping = false;
  }
  function clear() { n = 0; na = 0; sleeping = true; acc = 0; }
  function wakeAll() { for (let i = 0; i < n; i++) { act[i] = 1; rest[i] = 0; } if (n) sleeping = false; }
  /* thick paint stops: everything at rest now (it still reacts when something moves into it) */
  function sleepAll() { for (let i = 0; i < n; i++) { act[i] = 0; vel[i * 3] = vel[i * 3 + 1] = vel[i * 3 + 2] = 0; speed[i] = 0; } na = 0; sleeping = true; }
  function wakeNear(x, y, z, r) {
    const r2 = r * r; let any = false;
    for (let i = 0; i < n; i++) {
      if (act[i]) continue;
      const dx = pos[i * 3] - x, dy = pos[i * 3 + 1] - y, dz = pos[i * 3 + 2] - z;
      if (dx * dx + dy * dy + dz * dz < r2) { act[i] = 1; rest[i] = 0; any = true; }
    }
    if (any) sleeping = false;
  }

  /* ---------- neighbours: hashed uniform grid (all particles), lists for the active ones ---------- */
  const inv = 1 / H;
  const hash = (x, y, z) => (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) & (TABLE - 1);
  function neighbours() {
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      const h = hash(Math.floor(pos[i * 3] * inv), Math.floor(pos[i * 3 + 1] * inv), Math.floor(pos[i * 3 + 2] * inv));
      next[i] = head[h]; head[h] = i;
    }
    for (let a = 0; a < na; a++) {
      const i = al[a], px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2];
      const cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
      let c = 0; const base = i * NB;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        let j = head[hash(cx + ox, cy + oy, cz + oz)];
        while (j >= 0) {
          if (j !== i) {
            const dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
            if (dx * dx + dy * dy + dz * dz < H2 && c < NB) nbr[base + c++] = j;
          }
          j = next[j];
        }
      }
      nbc[i] = c;
    }
  }

  /* ---------- solids: push particles out, remember the contact normal ---------- */
  const L = [0, 0, 0], Wd = [0, 0, 0], Po = [0, 0, 0];
  function rotInv(s, x, y, z, out) {              /* world -> local, quaternion at s[3..6] */
    const qx = -s[3], qy = -s[4], qz = -s[5], qw = s[6];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty); out[1] = y + qw * ty + (qz * tx - qx * tz); out[2] = z + qw * tz + (qx * ty - qy * tx);
  }
  function rot(s, x, y, z, out) {                 /* local -> world */
    const qx = s[3], qy = s[4], qz = s[5], qw = s[6];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty); out[1] = y + qw * ty + (qz * tx - qx * tz); out[2] = z + qw * tz + (qx * ty - qy * tx);
  }
  function setN(i, x, y, z) { contact[i] = 1; nrm[i * 3] = x; nrm[i * 3 + 1] = y; nrm[i * 3 + 2] = z; }
  function cylinder(i, s) {                       /* capped cylinder: centre, axis = local y, radius s[7], half height s[8] */
    const o = i * 3;
    rotInv(s, pos[o] - s[0], pos[o + 1] - s[1], pos[o + 2] - s[2], L);
    const r = s[7] + RAD, hh = s[8] + RAD, d = Math.sqrt(L[0] * L[0] + L[2] * L[2]);
    if (d >= r || Math.abs(L[1]) >= hh) return;
    if (r - d < hh - Math.abs(L[1])) {
      const ux = d > 1e-6 ? L[0] / d : 1, uz = d > 1e-6 ? L[2] / d : 0;
      L[0] = ux * r; L[2] = uz * r; rot(s, ux, 0, uz, Wd);
    } else { const sg = L[1] >= 0 ? 1 : -1; L[1] = sg * hh; rot(s, 0, sg, 0, Wd); }
    rot(s, L[0], L[1], L[2], Po);
    pos[o] = Po[0] + s[0]; pos[o + 1] = Po[1] + s[1]; pos[o + 2] = Po[2] + s[2];
    setN(i, Wd[0], Wd[1], Wd[2]);
  }
  function cuboid(i, s) {
    const o = i * 3;
    rotInv(s, pos[o] - s[0], pos[o + 1] - s[1], pos[o + 2] - s[2], L);
    const hx = s[7] + RAD, hy = s[8] + RAD, hz = s[9] + RAD;
    const ex = hx - Math.abs(L[0]), ey = hy - Math.abs(L[1]), ez = hz - Math.abs(L[2]);
    if (ex <= 0 || ey <= 0 || ez <= 0) return;
    let ax = 0, ay = 0, az = 0;
    if (ex <= ey && ex <= ez) { ax = L[0] >= 0 ? 1 : -1; L[0] = ax * hx; }
    else if (ey <= ez) { ay = L[1] >= 0 ? 1 : -1; L[1] = ay * hy; }
    else { az = L[2] >= 0 ? 1 : -1; L[2] = az * hz; }
    rot(s, L[0], L[1], L[2], Po); rot(s, ax, ay, az, Wd);
    pos[o] = Po[0] + s[0]; pos[o + 1] = Po[1] + s[1]; pos[o + 2] = Po[2] + s[2];
    setN(i, Wd[0], Wd[1], Wd[2]);
  }
  /* contact is remembered for the whole substep (a drop resting exactly on the stone still touches it) */
  function collide(i) {
    const o = i * 3;
    const p = solids.plinth;
    if (p) {
      const x = pos[o], z = pos[o + 2], d = Math.sqrt(x * x + z * z), top = p[1] + RAD;
      if (pos[o + 1] < top + 1e-4 && d < p[0] + RAD && pos[o + 1] >= top - 1e-4) setN(i, 0, 1, 0);
      if (pos[o + 1] < top && d < p[0] + RAD) {
        if (top - pos[o + 1] < p[0] + RAD - d || d < p[0] - 0.02) { pos[o + 1] = top; setN(i, 0, 1, 0); }
        else { const k = (p[0] + RAD) / Math.max(d, 1e-6); pos[o] = x * k; pos[o + 2] = z * k; setN(i, x / Math.max(d, 1e-6), 0, z / Math.max(d, 1e-6)); }
      }
    }
    if (pos[o + 1] < solids.floor + RAD + 1e-4) { pos[o + 1] = Math.max(pos[o + 1], solids.floor + RAD); setN(i, 0, 1, 0); }
    if (solids.can) cylinder(i, solids.can);
    if (solids.lid) cylinder(i, solids.lid);
    if (solids.box) cuboid(i, solids.box);
    const B = solids.bound;
    if (pos[o] < -B) pos[o] = -B; else if (pos[o] > B) pos[o] = B;
    if (pos[o + 2] < -B) pos[o + 2] = -B; else if (pos[o + 2] > B) pos[o + 2] = B;
  }

  /* ---------- one substep over the active particles ---------- */
  function substep(h) {
    na = 0;
    for (let i = 0; i < n; i++) {
      if (wake[i]) { wake[i] = 0; act[i] = 1; rest[i] = 0; }
      if (act[i]) al[na++] = i;
    }
    if (!na) { sleeping = true; return 0; }
    for (let a = 0; a < na; a++) {
      const i = al[a], o = i * 3;
      contact[i] = 0;
      vel[o + 1] -= G * h;
      prv[o] = pos[o]; prv[o + 1] = pos[o + 1]; prv[o + 2] = pos[o + 2];
      pos[o] += vel[o] * h; pos[o + 1] += vel[o + 1] * h; pos[o + 2] += vel[o + 2] * h;
      collide(i);
    }
    neighbours();
    for (let it = 0; it < ITER; it++) {
      for (let a = 0; a < na; a++) {               /* density constraint -> lambda */
        const i = al[a], o = i * 3, px = pos[o], py = pos[o + 1], pz = pos[o + 2], base = i * NB, c = nbc[i];
        let rho = W0, sx = 0, sy = 0, sz = 0, s2 = 0;
        for (let k = 0; k < c; k++) {
          const j = nbr[base + k], dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= H2) continue;
          const d = H2 - r2; rho += POLY6 * d * d * d;
          if (r2 > 1e-12) {
            const r = Math.sqrt(r2), g = SPIKY * (H - r) * (H - r) / (r * rho0);
            const gx = g * dx, gy = g * dy, gz = g * dz;
            sx += gx; sy += gy; sz += gz; s2 += gx * gx + gy * gy + gz * gz;
          }
        }
        const C = rho / rho0 - 1;
        /* compressed: push apart; stretched inside the paint (not at its free surface): pull together a little */
        lam[i] = -(C > 0 ? C : (c >= COHMIN ? C * COH : 0)) / (s2 + sx * sx + sy * sy + sz * sz + EPS);
      }
      for (let a = 0; a < na; a++) {               /* position correction */
        const i = al[a], o = i * 3, px = pos[o], py = pos[o + 1], pz = pos[o + 2], base = i * NB, c = nbc[i], li = lam[i];
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < c; k++) {
          const j = nbr[base + k], dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 >= H2 || r2 < 1e-12) continue;
          if (!act[j] && r2 < WAKE2 && speed[i] > 0.5) wake[j] = 1;      /* only a moving drop wakes a sleeping one */
          const w = W(r2) / DQ, w2 = w * w, sc = -KCORR * w2 * w2;
          const r = Math.sqrt(r2), g = ((act[j] ? li + lam[j] : 2 * li) + sc) * SPIKY * (H - r) * (H - r) / (r * rho0);
          x += g * dx; y += g * dy; z += g * dz;
        }
        const m2 = x * x + y * y + z * z;
        if (m2 > DPMAX * DPMAX) { const k = DPMAX / Math.sqrt(m2); x *= k; y *= k; z *= k; }
        dp[o] = x; dp[o + 1] = y; dp[o + 2] = z;
      }
      for (let a = 0; a < na; a++) {
        const i = al[a], o = i * 3;
        pos[o] += dp[o]; pos[o + 1] += dp[o + 1]; pos[o + 2] += dp[o + 2];
        collide(i);
      }
    }
    /* velocities, sticky friction on surfaces, then XSPH viscosity (sleeping neighbours count as still paint) */
    const ih = 1 / h;
    for (let a = 0; a < na; a++) {
      const i = al[a], o = i * 3;
      let vx = (pos[o] - prv[o]) * ih, vy = (pos[o + 1] - prv[o + 1]) * ih, vz = (pos[o + 2] - prv[o + 2]) * ih;
      if (contact[i]) {
        const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2], vn = vx * nx + vy * ny + vz * nz, k = 1 - STICK, vp = vn > 0 ? vn : 0;
        vx = (vx - vn * nx) * k + vp * nx; vy = (vy - vn * ny) * k + vp * ny; vz = (vz - vn * nz) * k + vp * nz;
        /* a moving can or box pushes the paint, it does not fling it */
        const s2 = vx * vx + vy * vy + vz * vz;
        if (s2 > VMAXC * VMAXC) { const f = VMAXC / Math.sqrt(s2); vx *= f; vz *= f; vy *= f; }
        /* thick paint on the stone creeps, it never skates: the spread is slow, and below a small speed it holds
           still (static friction, in position: the drop goes back to where it was) */
        if (ny > 0.7) {
          const h2 = vx * vx + vz * vz;
          if (h2 < STATIC * STATIC) { pos[o] = prv[o]; pos[o + 2] = prv[o + 2]; vx = 0; vz = 0; }
          else if (h2 > SPREAD * SPREAD) { const f = SPREAD / Math.sqrt(h2); vx *= f; vz *= f; }
        }
      }
      vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    }
    let vmax = 0;
    for (let a = 0; a < na; a++) {
      const i = al[a], o = i * 3, base = i * NB, c = nbc[i], px = pos[o], py = pos[o + 1], pz = pos[o + 2];
      let x = 0, y = 0, z = 0, ws = 0;
      for (let k = 0; k < c; k++) {
        const j = nbr[base + k], dx = px - pos[j * 3], dy = py - pos[j * 3 + 1], dz = pz - pos[j * 3 + 2];
        const w = W(dx * dx + dy * dy + dz * dz);
        x += (vel[j * 3] - vel[o]) * w; y += (vel[j * 3 + 1] - vel[o + 1]) * w; z += (vel[j * 3 + 2] - vel[o + 2]) * w; ws += w;
      }
      if (ws > 0) { const k = VISC * Math.min(1, ws / rho0) / ws; dp[o] = vel[o] + x * k; dp[o + 1] = vel[o + 1] + y * k; dp[o + 2] = vel[o + 2] + z * k; }
      else { dp[o] = vel[o]; dp[o + 1] = vel[o + 1]; dp[o + 2] = vel[o + 2]; }
    }
    for (let a = 0; a < na; a++) {
      const i = al[a], o = i * 3;
      const vx = dp[o], vy = dp[o + 1], vz = dp[o + 2], sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz; speed[i] = sp;
      if (sp > vmax) vmax = sp;
      /* rest: slow for a moment while touching a surface (or slow for longer) -> asleep */
      if (sp < SLEEPV) { rest[i] += h; if (rest[i] > (contact[i] ? 0.25 : 0.6)) { act[i] = 0; vel[o] = vel[o + 1] = vel[o + 2] = 0; speed[i] = 0; } }
      else rest[i] = 0;
    }
    return vmax;
  }

  function step(dt) {
    if (!n || sleeping) return false;
    acc += Math.min(dt, SUB * 2);                    /* overloaded: slow motion, never a spiral of catch-up steps */
    let did = false;
    while (acc >= SUB && !sleeping) { substep(SUB); acc -= SUB; did = true; }
    if (sleeping) acc = 0;
    return did;
  }
  function setSolids(s) {
    for (const k of ['plinth', 'can', 'box', 'lid']) if (k in s) solids[k] = s[k];
    if (s.floor != null) solids.floor = s.floor;
    if (s.bound != null) solids.bound = s.bound;
    if (s.wakeAt) for (let k = 0; k + 3 < s.wakeAt.length; k += 4) wakeNear(s.wakeAt[k], s.wakeAt[k + 1], s.wakeAt[k + 2], s.wakeAt[k + 3]);
  }
  return {
    emit, clear, step, setSolids, wakeAll, sleepAll, pos, speed,
    get count() { return n; }, get active() { return na; }, get sleeping() { return sleeping; },
    spacing: S0, radius: RAD, kernel: H, max: MAX
  };
}
