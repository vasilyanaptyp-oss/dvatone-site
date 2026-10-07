/* Dvatone pack2: pouring the paint out of the open can.
   Physics of the pour: the paint's free surface stays level while the can tips; it reaches the lip when the overflow
   depth d = level + r_lip * tan(tilt) - rim > 0, and flows at a weir rate ~ d^1.5, viscous (slower than water). The
   level drops as it pours, so a full can spills at a small tilt and an almost empty one has to be turned right over.
   The paint runs over the lowest point of the rim as a sheet, gathers into one thick rope that thins as it falls
   (the same flow through a smaller section) and lets go of the rim only when the pour ends.
     high: the lying paint is a particle fluid (fluid.js: position-based fluid in a worker); its landed drops build the
           height field of puddle.js, so it spreads, heaps and settles as the solver says
     mid:  the same rope and an analytic pool in the same height field, growing with the poured volume
     low and reduced motion: a still: the finished pool, no motion
   createPour(THREE, renderer, ctx) -> { update(dt), still(), reset(), dispose(), level, pouring, poured, busy } */
import { createFluid } from './fluid.js';
import { createPuddle, WET, SHEEN } from './puddle.js';

export function createPour(T, R, ctx) {
  const C = ctx.can;                       /* in the can's frame (origin = body origin): rimY, levelTop, levelBottom, lipR, outerR */
  let level = 1;                           /* 0..1 of the paint between levelBottom and levelTop */
  let pouring = false, poured = 0, emitAcc = 0, settleT = 0, fadeK = 1, resetting = false, busy = false;
  const mode = ctx.reduced || ctx.tier === 'low' ? 'still' : (ctx.tier === 'high' ? 'fluid' : 'stylised');
  const V = { p: new T.Vector3(), q: new T.Quaternion(), qi: new T.Quaternion(), up: new T.Vector3(), lip: new T.Vector3(), rim: new T.Vector3(), dir: new T.Vector3(),
    tan: new T.Vector3(), tmp: new T.Vector3(), v: new T.Vector3(), w: new T.Vector3(), land: new T.Vector3(), out: new T.Vector3(), a: new T.Vector3(), b: new T.Vector3(), sd: new T.Vector3() };
  const group = new T.Group(); ctx.scene.add(group);

  /* ---------------- the lying paint: a height field (all tiers) ---------------- */
  const TILE = ctx.paintTile || 2.2;        /* the paint's granule scale (models.js PAINT_TILE): the same grain as in the can */
  const field = createPuddle(T, { n: mode === 'fluid' ? 192 : 160, seg: mode === 'fluid' ? 128 : 96, map: ctx.paintTex(), bump: ctx.bumpTex ? ctx.bumpTex() : null, tile: TILE });
  field.setDomain(ctx.plinth.r, ctx.plinth.top);
  group.add(field.group);

  /* ---------------- high tier: particles ---------------- */
  let fluid = null, emitBuf = new Float32Array(64 * 6), fieldVer = -1, fieldAsleep = false, fieldN = -1;
  const FLUID_MAX = ctx.max || 1000;
  if (mode === 'fluid') fluid = createFluid({ max: FLUID_MAX, spacing: 0.068 });
  const perLevel = FLUID_MAX * 0.94;        /* particles for a full can */

  /* ---------------- the stream: one rope of paint ---------------- */
  let stream = null, streamGeo = null, paintMat = null;
  const SEG = 30, RAD = 12, SHEET = 3;     /* rings along (the first SHEET run over the lip), vertices around */
  const pud = { c: new T.Vector3(), r: 0, target: 0, vol: 0, has: false, seed: Math.random() * 10, drawnR: -1, mound: 0 };
  function paintMaterial() {
    if (paintMat) return paintMat;
    paintMat = new T.MeshPhysicalMaterial({ map: ctx.paintTex(), bumpMap: ctx.bumpTex ? ctx.bumpTex() : null, bumpScale: 0.5, roughness: 0.5, metalness: 0, specularIntensity: 0.5,
      clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 0.7 });
    const U = { uFlow: { value: 0 } };
    paintMat.onBeforeCompile = sh => {
      sh.uniforms.uFlow = U.uFlow; sh.uniforms.uTurn = field.uniforms.uTurn;
      sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y += uFlow;\n#endif\n#ifdef USE_BUMPMAP\nvBumpMapUv.y += uFlow;\n#endif')
        .replace('#include <common>', '#include <common>\nuniform float uFlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTurn;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>' + WET)
        .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>' + SHEEN);
    };
    paintMat.customProgramCacheKey = () => 'dvpour';
    paintMat.userData.U = U;
    return paintMat;
  }
  function makeStream() {
    streamGeo = new T.BufferGeometry();
    const n = (SEG + 1) * (RAD + 1);
    streamGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
    streamGeo.setAttribute('normal', new T.BufferAttribute(new Float32Array(n * 3), 3).setUsage(T.DynamicDrawUsage));
    const uv = new Float32Array(n * 2), idx = [];
    /* about the rope's own girth and length in the paint's granule scale */
    for (let s = 0; s <= SEG; s++) for (let r = 0; r <= RAD; r++) { const k = s * (RAD + 1) + r; uv[k * 2] = r / RAD * 0.45 / TILE; uv[k * 2 + 1] = s / SEG * 1.4 / TILE; }
    /* outward-facing triangles (front side): ring s -> next vertex around -> ring s + 1 */
    for (let s = 0; s < SEG; s++) for (let r = 0; r < RAD; r++) {
      const a = s * (RAD + 1) + r, b = a + RAD + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    streamGeo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    streamGeo.setIndex(idx);
    stream = new T.Mesh(streamGeo, paintMaterial()); stream.frustumCulled = false; stream.castShadow = false; stream.receiveShadow = true; stream.visible = false;
    stream.renderOrder = 2;
    group.add(stream);
  }
  /* the rope: a flat sheet over the rim, gathering into a round rope along the ballistic path down to the plinth (or
     the paint already there), thinning as it speeds up. t0 > 0: the pour has ended and the rope's top end is falling */
  const str = { rim: new T.Vector3(), lip: new T.Vector3(), vel: new T.Vector3(), side: new T.Vector3(), rate: 0, tail: -1 };
  function shapeStream(t0 = 0) {
    const P = streamGeo.attributes.position.array, N = streamGeo.attributes.normal.array;
    const g = 98.1, top = ctx.plinth.top, lip = str.lip, vel = str.vel;
    const tLand = (y0, vy, yT) => { const a = 0.5 * g, b = -vy, c = -(y0 - yT); return (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a); };
    let tl = tLand(lip.y, vel.y, top + 0.04);
    const lx = lip.x + vel.x * tl, lz = lip.z + vel.z * tl;
    if (Math.hypot(lx, lz) > ctx.plinth.r) tl = tLand(lip.y, vel.y, 0);
    V.land.set(lip.x + vel.x * tl, Math.max(0, lip.y + vel.y * tl - 0.5 * g * tl * tl), lip.z + vel.z * tl);
    if (t0 >= tl) { stream.visible = false; return; }
    const r0 = 0.05 + 0.06 * Math.min(1, str.rate), v0 = Math.max(0.3, vel.length());
    const tan = V.tan, side = V.sd, up = V.a, tmp = V.tmp;
    const fall0 = t0 > 0 ? 0 : SHEET;           /* rings before this one lie on the lip */
    for (let s = 0; s <= SEG; s++) {
      let x, y, z, ea, eb;
      if (s < fall0) {
        /* over the lip: from the rim's top to the edge, a wide flat sheet */
        const f = s / fall0;
        tmp.lerpVectors(str.rim, lip, f); x = tmp.x; y = tmp.y; z = tmp.z;
        tan.subVectors(lip, str.rim).normalize();
        ea = r0 * (1.5 + 0.3 * f); eb = s === 0 ? 0.002 : r0 * 0.35;
      } else {
        const u = (s - fall0) / (SEG - fall0), t = t0 + (tl - t0) * u;
        x = lip.x + vel.x * t; y = lip.y + vel.y * t - 0.5 * g * t * t; z = lip.z + vel.z * t;
        tan.set(vel.x, vel.y - g * t, vel.z); const sp = tan.length(); tan.normalize();
        /* the falling end narrows to a point when the pour has ended */
        const tip = t0 > 0 ? Math.min(1, u * 7) : 1;
        const rad = r0 * Math.sqrt(Math.max(0.22, v0 / Math.max(sp, 0.1))) * tip;
        const round = t0 > 0 ? 1 : Math.min(1, u * 4.5);     /* the sheet gathers into a rope */
        ea = rad + (r0 * 1.8 - rad) * (1 - round); eb = rad + (r0 * 0.35 - rad) * (1 - round);
      }
      /* the cross-section's axes: the lip's direction (kept square to the path), and the normal to both */
      side.copy(str.side).addScaledVector(tan, -str.side.dot(tan));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0).addScaledVector(tan, -tan.x);
      side.normalize();
      up.crossVectors(tan, side).normalize();
      for (let r = 0; r <= RAD; r++) {
        const a = r / RAD * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), k = s * (RAD + 1) + r;
        P[k * 3] = x + side.x * c * ea + up.x * sn * eb; P[k * 3 + 1] = y + side.y * c * ea + up.y * sn * eb; P[k * 3 + 2] = z + side.z * c * ea + up.z * sn * eb;
        /* the ellipse's outward normal */
        tmp.copy(side).multiplyScalar(c / Math.max(ea, 1e-4)).addScaledVector(up, sn / Math.max(eb, 1e-4)).normalize();
        N[k * 3] = tmp.x; N[k * 3 + 1] = tmp.y; N[k * 3 + 2] = tmp.z;
      }
    }
    streamGeo.attributes.position.needsUpdate = true; streamGeo.attributes.normal.needsUpdate = true;
    streamGeo.computeBoundingSphere();
    stream.visible = true;
  }
  if (mode !== 'still') makeStream();

  /* ---------------- the pour itself ---------------- */
  let time = 0, lastRate = 0, frozen = false, srcSet = false, blocked = false, fieldMs = 0;
  function canState() {
    const s = ctx.getCan(V);                    /* fills V.p, V.q, V.v, V.w; returns { open } */
    V.qi.copy(V.q).invert();
    V.up.set(0, 1, 0).applyQuaternion(V.q);     /* the can's axis in the world */
    return s;
  }
  function rate() {
    /* world "up" seen from the can: its tilt and the side it tips towards */
    const u = V.tmp.set(0, 1, 0).applyQuaternion(V.qi);
    const cosT = Math.max(-1, Math.min(1, u.y)), tilt = Math.acos(cosT);
    const h = Math.hypot(u.x, u.z);
    if (h < 1e-4) return 0;
    V.dir.set(-u.x / h, 0, -u.z / h);           /* lowest point of the rim, can frame */
    const lvl = C.levelBottom + (C.levelTop - C.levelBottom) * level;
    const t = tilt < 1.45 ? Math.tan(tilt) : 8;
    const d = lvl + C.lipR * t - C.rimY;
    if (d <= 0 || level <= 0.002) return 0;
    return Math.min(1, Math.pow(Math.min(d, 0.35) / 0.35, 1.5));   /* 0..1 of the full flow */
  }
  /* the high tier: the landed drops -> the height field, whenever the solver has moved them */
  function syncField() {
    if (!fluid || fluid.version === fieldVer) return;
    /* asleep and the same drops: nothing has moved since the last picture */
    if (fieldAsleep && fluid.sleeping && fluid.count === fieldN) { fieldVer = fluid.version; return; }
    fieldVer = fluid.version; fieldAsleep = fluid.sleeping; fieldN = fluid.count;
    const t0 = performance.now();
    field.clear();
    if (fluid.count) { field.splat(fluid.positions, fluid.count, fluid.spacing * 1.05); field.blur(3); }
    field.commit();
    fieldMs = fieldMs * 0.9 + (performance.now() - t0) * 0.1;
  }
  function drawPool() {
    if (Math.abs(pud.r - pud.drawnR) < 0.0015 && !pouring && pud.mound < 0.002) return;
    pud.drawnR = pud.r;
    field.setSource(pud.c.x, pud.c.z);
    field.clear();
    field.pool({ cx: pud.c.x, cz: pud.c.z, r: pud.r, th: Math.min(0.085, 0.045 + pud.r * 0.03), seed: pud.seed, t: time,
      mx: V.land.x, mz: V.land.z, mound: pud.mound });
    field.blur(1);
    field.commit();
  }
  function update(dt) {
    time += dt;
    const st = canState();
    let r = st && st.open && !resetting && !blocked ? rate() : 0;
    if (r > 0) {
      /* the lip in the world: just outside the wall below the rim (the solver treats the can as solid) */
      V.lip.set(V.dir.x * (C.outerR + 0.045), C.rimY - 0.02, V.dir.z * (C.outerR + 0.045)).applyQuaternion(V.q).add(V.p);
      /* paint runs out only over the plinth: tipped anywhere else the can holds it (no paint on the floor) */
      if (Math.hypot(V.lip.x, V.lip.z) > ctx.plinth.r - 0.12) r = 0;
    }
    pouring = r > 0.002;
    if (pouring) {
      busy = true; settleT = 0;
      const k = Math.min(1, dt * 0.3 * r);            /* a full flow empties the can in about three seconds */
      level = Math.max(0, level - k);
      ctx.onLevel && ctx.onLevel(level);
      V.rim.set(V.dir.x * (C.outerR - 0.035), C.rimY + 0.012, V.dir.z * (C.outerR - 0.035)).applyQuaternion(V.q).add(V.p);
      const out = V.out.copy(V.dir).applyQuaternion(V.q);
      V.b.set(-V.dir.z, 0, V.dir.x).applyQuaternion(V.q);    /* along the lip */
      const vOut = 0.8 + 0.8 * r;                     /* viscous: it leaves the lip slowly and drops as a rope */
      const lipV = V.w.clone().cross(V.lip.clone().sub(V.p)).add(V.v);
      if (lipV.length() > 1.5) lipV.setLength(1.5);          /* the hand's motion does not hurl the paint off the plinth */
      if (mode === 'fluid') {
        emitAcc += k * perLevel;
        let m = Math.floor(emitAcc); emitAcc -= m;
        m = Math.min(m, FLUID_MAX - fluid.emitted);
        if (m > 0) {
          if (emitBuf.length < m * 6) emitBuf = new Float32Array(m * 12);
          const width = 0.04 + 0.11 * Math.sqrt(r);
          for (let i = 0; i < m; i++) {
            const a = (Math.random() - 0.5) * width, b = Math.random() * 0.02;
            emitBuf[i * 6] = V.lip.x + V.b.x * a + out.x * b; emitBuf[i * 6 + 1] = V.lip.y + V.b.y * a + out.y * b - Math.random() * 0.02; emitBuf[i * 6 + 2] = V.lip.z + V.b.z * a + out.z * b;
            emitBuf[i * 6 + 3] = lipV.x + out.x * vOut; emitBuf[i * 6 + 4] = lipV.y + out.y * vOut - 1; emitBuf[i * 6 + 5] = lipV.z + out.z * vOut;
          }
          fluid.emit(emitBuf, m);
        }
      }
      if (stream) {
        str.rim.copy(V.rim); str.lip.copy(V.lip); str.vel.copy(lipV).addScaledVector(out, vOut * 0.8); str.side.copy(V.b); str.rate = r; str.tail = 0;
        shapeStream(0);
        paintMat.userData.U.uFlow.value -= dt * (1.6 + 2 * r);
        /* the granules in the lying paint are drawn out from where the rope first lands */
        if (!srcSet && mode === 'fluid') { field.setSource(V.land.x, V.land.z); srcSet = true; }
      }
      if (mode === 'stylised') {
        if (!pud.has) { pud.has = true; pud.c.copy(V.land); pud.r = 0.05; }
        else pud.c.lerp(V.land, Math.min(1, dt * 0.6));
        pud.vol += k;
        pud.mound += (0.05 * Math.min(1, r * 1.5) - pud.mound) * Math.min(1, dt * 3);
      }
      poured += k;
    } else if (stream && stream.visible && str.tail >= 0) {
      /* the pour has stopped: the last of the rope falls away from the rim and is gone */
      str.tail += dt; str.rate *= Math.exp(-dt * 3);
      shapeStream(str.tail);
      paintMat.userData.U.uFlow.value -= dt * 2;
      if (!stream.visible) str.tail = -1;
    }
    lastRate = r;

    if (mode === 'stylised' && pud.has) {
      /* spreads towards the size its volume allows, slowing as it goes (viscous); the heap under the rope flattens */
      pud.target = 0.25 + 0.6 * Math.sqrt(pud.vol);   /* the size the particle paint reaches on the high tier */
      pud.r += (pud.target - pud.r) * Math.min(1, dt * (pouring ? 2.2 : 0.9));
      if (!pouring) pud.mound *= Math.exp(-dt * 1.5);
      if (!resetting) drawPool();
    }
    if (mode === 'fluid') {
      fluid.update(dt, ctx.getSolids());
      if (!resetting) syncField();
      if (!pouring && fluid.count) {
        settleT += dt;
        /* a few seconds after the pour the thick paint has stopped: freeze it (no more solver work) */
        if (settleT > 4.5 && !frozen) { frozen = true; fluid.freeze(); }
      } else { frozen = false; }
    } else if (!pouring && pud.has) settleT += dt;
    if (resetting) {
      fadeK = Math.max(0, fadeK - dt / 1.6);
      field.fade(fadeK);
      if (fadeK <= 0) finishReset();
    }
    return pouring || resetting || (stream && stream.visible) || (fluid && !fluid.sleeping) || (mode === 'stylised' && pud.has && (Math.abs(pud.target - pud.r) > 0.002 || pud.mound > 0.002));
  }
  /* low tier and reduced motion: show the finished pour at once */
  function still() {
    pud.has = true; pud.vol = 0.6; pud.r = 0.25 + 0.6 * Math.sqrt(0.6); pud.mound = 0;
    pud.c.set(ctx.stillAt ? ctx.stillAt.x : 0.2, 0, ctx.stillAt ? ctx.stillAt.z : 0.3);
    level = 0.4; ctx.onLevel && ctx.onLevel(level);
    fadeK = 1; field.fade(1);
    field.setDomain(ctx.plinth.r, ctx.plinth.top);
    pud.drawnR = -1; drawPool();
    busy = true; poured = 0.6;
  }
  let resetDone = null;
  function reset(done) {
    if (resetting) return;
    resetting = true; resetDone = done || null;
    if (stream) stream.visible = false;
    if (ctx.reduced) finishReset();                     /* reduced motion: gone at once, no fade */
  }
  /* compile the rope and the pool before the first pour (no hitch when it starts) */
  function precompile(camera, renderer) {
    if (!renderer.compileAsync) return;
    const list = [stream, ...field.meshes].filter(Boolean), vis = list.map(m => m.visible);
    list.forEach(m => (m.visible = true));
    renderer.compileAsync(group, camera, ctx.scene).catch(() => {}).finally(() => list.forEach((m, i) => (m.visible = vis[i])));
  }
  function finishReset() {
    resetting = false; fadeK = 1; busy = false; poured = 0; emitAcc = 0; settleT = 0;
    if (fluid) fluid.clear();
    fieldVer = -1; fieldAsleep = false; fieldN = -1; srcSet = false;
    pud.has = false; pud.vol = 0; pud.r = 0; pud.drawnR = -1; pud.mound = 0;
    field.clear(); field.setDomain(ctx.plinth.r, ctx.plinth.top); field.commit(); field.fade(1);
    const d = resetDone; resetDone = null; d && d();
  }
  return {
    update, still, reset, group, precompile,
    setLevel(v) { level = Math.max(0, Math.min(1, v)); },
    /* the turntable's angle: the studio's soft box in the paint's gloss turns with the view */
    setTurn(a) { field.uniforms.uTurn.value = a; },
    /* the can is being lifted away: whatever is left stays in it */
    block(on) { blocked = !!on; },
    setGranules(tex, bump) { field.setMap(tex, bump); if (paintMat) { paintMat.map = tex; if (bump) paintMat.bumpMap = bump; paintMat.needsUpdate = true; } },
    dispose() { if (fluid) fluid.dispose(); field.dispose(); streamGeo && streamGeo.dispose(); paintMat && paintMat.dispose(); ctx.scene.remove(group); },
    get level() { return level; }, get pouring() { return pouring; }, get poured() { return poured; }, get busy() { return busy; },
    get settled() { return !pouring && settleT > 1.2 && (!fluid || frozen || fluid.sleeping || fluid.active < Math.max(8, fluid.count * 0.03)); }, get resetting() { return resetting; },
    get particles() { return fluid ? fluid.count : 0; }, get rateNow() { return lastRate; }, get idleFor() { return pouring ? 0 : settleT; },
    get fieldMs() { return fieldMs; }, mode, fluid, field
  };
}
