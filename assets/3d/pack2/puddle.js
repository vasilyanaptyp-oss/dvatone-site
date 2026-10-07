/* Dvatone pack2: the paint lying on the plinth, for every tier that pours.
   The surface is a height field over the plinth top. The high tier splats the landed drops of the fluid into it (each
   drop a spherical cap; the envelope of the caps, softened by a small blur, is the paint's surface: a flat top, a thick
   rounded edge, a heap where the stream lands). The mid tier and the still draw an analytic pool that grows with the
   poured volume. One mesh draws it in the scene's own lights, shadows and environment: opaque paint in the
   composition's own granules under a wet clear coat. A soft contact shadow rings it, so it stands out even on a plinth
   made of the same composition.
   createPuddle(THREE, { n, seg, map, tile }) -> { group, setDomain(r, top), clear(), splat(P, count, rc), pool(o),
     blur(passes), commit(), fade(k), setMap(tex), dispose(), empty, meshes } */
/* wet paint: the composition's own colours, a touch richer than the same coating dry on the plinth */
export const WET = `
  {
    vec3 c = diffuseColor.rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = max(vec3(0.0), mix(vec3(l), c, 1.08));
  }`;
/* the studio's low soft box behind the plinth, seen only in wet gloss: the clear coat of the paint mirrors it as a broad
   sheen (the matte stone beside it does not), the way a poured paint catches the light in a product shot */
export const SHEEN = `
#ifdef USE_CLEARCOAT
  {
    vec3 Rw = normalize((vec4(reflect(-geometryViewDir, geometryClearcoatNormal), 0.0) * viewMatrix).xyz);
    /* the soft box belongs to the studio, which turns with the view (the turntable): into the studio's frame */
    float cT = cos(uTurn), sT = sin(uTurn);
    Rw.xz = vec2(cT * Rw.x - sT * Rw.z, sT * Rw.x + cT * Rw.z);
    float az = atan(Rw.x, -Rw.z);
    float box = smoothstep(0.02, 0.16, Rw.y) * (1.0 - smoothstep(0.42, 0.62, Rw.y)) * (1.0 - smoothstep(0.55, 0.95, abs(az)));
    /* a warm box, a little of the paint's colour in its reflection: wet gloss over the grain, not chrome */
    clearcoatRadiance += mix(vec3(1.0, 0.97, 0.92), material.diffuseColor * 1.3, 0.3) * 1.0 * box;
  }
#endif`;
export function createPuddle(T, o = {}) {
  const N = o.n || 192;
  const F = new Float32Array(N * N), B = new Float32Array(N * N), H16 = new Uint16Array(N * N);
  const toHalf = T.DataUtils.toHalfFloat;
  const tex = new T.DataTexture(H16, N, N, T.RedFormat, T.HalfFloatType);
  tex.minFilter = tex.magFilter = T.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; tex.colorSpace = T.NoColorSpace; tex.needsUpdate = true;
  let x0 = -3.5, z0 = -3.5, span = 7, cell = span / N, top = 0.6;
  /* cells holding paint now (i0, j0, i1, j1), and the ones the texture showed last time (to wipe them) */
  let bb = null, shown = null;
  const U = {
    tH: { value: tex }, uOrigin: { value: new T.Vector2(x0, z0) }, uSpan: { value: span }, uTexel: { value: 1 / N },
    uTile: { value: o.tile || 0.9 }, uFade: { value: 1 }, uFadeH: { value: 1 }, uThr: { value: 0.006 }, uHalo: { value: 0.9 }, uSrc: { value: new T.Vector2() }, uTurn: { value: 0 }
  };

  /* the paint: the scene's physical shading, its normal from the height field, opaque inside a crisp soft outline */
  /* like the paint in the can: the granules' relief under a clear wet coat (the coat follows the paint's surface) */
  const mat = new T.MeshPhysicalMaterial({ map: o.map || null, bumpMap: o.bump || null, bumpScale: 0.5, roughness: 0.5, metalness: 0, specularIntensity: 0.5,
    clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 0.7, transparent: true, depthWrite: true });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tH; uniform vec2 uOrigin; uniform float uSpan; uniform float uTile; uniform float uFadeH; varying vec2 vHUv; varying vec2 vWxz;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv = (modelMatrix * vec4(position, 1.0)).xz / uTile;\n#endif\n#ifdef USE_BUMPMAP\n  vBumpMapUv = (modelMatrix * vec4(position, 1.0)).xz / uTile;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWxz = (modelMatrix * vec4(position, 1.0)).xz;\n  vHUv = (vWxz - uOrigin) / uSpan;\n  transformed.y += textureLod(tH, vHUv, 0.0).r * uFadeH;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tH; uniform float uSpan; uniform float uTexel; uniform float uFade; uniform float uFadeH; uniform float uThr; uniform float uTile; uniform vec2 uSrc; uniform float uTurn; varying vec2 vHUv; varying vec2 vWxz;')
      .replace('#include <clipping_planes_fragment>', 'float hC = texture2D(tH, vHUv).r;\n  if (hC < uThr) discard;\n#include <clipping_planes_fragment>')
      .replace('#include <map_fragment>', '#include <map_fragment>' + WET + '\n  diffuseColor.a = smoothstep(uThr, uThr + 0.014, hC) * uFade;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float hx = texture2D(tH, vHUv + vec2(uTexel, 0.0)).r - texture2D(tH, vHUv - vec2(uTexel, 0.0)).r;
    float hz = texture2D(tH, vHUv + vec2(0.0, uTexel)).r - texture2D(tH, vHUv - vec2(0.0, uTexel)).r;
    vec3 nW = normalize(vec3(-hx * uFadeH, 2.0 * uTexel * uSpan, -hz * uFadeH));
    nPaint = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    normal = nPaint;
#ifdef USE_BUMPMAP
    normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
  }`)
      .replace('#include <clearcoat_normal_fragment_begin>', '#include <clearcoat_normal_fragment_begin>\n#ifdef USE_CLEARCOAT\n  clearcoatNormal = nPaint;\n#endif')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>' + SHEEN)
      .replace('void main() {', 'vec3 nPaint;\nvoid main() {');
  };
  mat.customProgramCacheKey = () => 'dvpuddle';

  /* the contact shadow: darker the more paint lies close by, fading out a few millimetres beyond the edge */
  const hmat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  hmat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uOrigin; uniform float uSpan; varying vec2 vHUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vHUv = ((modelMatrix * vec4(position, 1.0)).xz - uOrigin) / uSpan;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tH; uniform float uTexel; uniform float uFade; uniform float uHalo; uniform float uThr; varying vec2 vHUv;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
  {
    float c = 0.0;
    for (int k = 0; k < 12; k++) {
      float a = float(k) * 0.5236;
      vec2 d = vec2(cos(a), sin(a)) * uTexel;
      c += smoothstep(uThr, uThr + 0.03, texture2D(tH, vHUv + d * 3.5).r) + 0.7 * smoothstep(uThr, uThr + 0.03, texture2D(tH, vHUv + d * 8.0).r);
    }
    diffuseColor.a *= uHalo * min(1.0, c / 9.0) * uFade;
  }`);
  };
  hmat.customProgramCacheKey = () => 'dvpuddlehalo';

  const seg = o.seg || 128;
  const geo = new T.PlaneGeometry(1, 1, seg, seg).rotateX(-Math.PI / 2);
  const mesh = new T.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.renderOrder = 2; mesh.visible = false;
  const hgeo = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const halo = new T.Mesh(hgeo, hmat);
  halo.frustumCulled = false; halo.receiveShadow = false; halo.castShadow = false; halo.renderOrder = 1; halo.visible = false;
  const group = new T.Group(); group.add(halo, mesh);

  function setDomain(r, y) {
    const h = r + 0.2;
    x0 = z0 = -h; span = 2 * h; cell = span / N; top = y;
    U.uOrigin.value.set(x0, z0); U.uSpan.value = span;
  }
  function grow(i0, j0, i1, j1) {
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(N - 1, i1); j1 = Math.min(N - 1, j1);
    if (i0 > i1 || j0 > j1) return;
    if (!bb) bb = [i0, j0, i1, j1];
    else { bb[0] = Math.min(bb[0], i0); bb[1] = Math.min(bb[1], j0); bb[2] = Math.max(bb[2], i1); bb[3] = Math.max(bb[3], j1); }
  }
  function zero(b, m) {
    if (!b) return;
    const i0 = Math.max(0, b[0] - m), j0 = Math.max(0, b[1] - m), i1 = Math.min(N - 1, b[2] + m), j1 = Math.min(N - 1, b[3] + m);
    for (let j = j0; j <= j1; j++) F.fill(0, j * N + i0, j * N + i1 + 1);
  }
  function clear() { zero(bb, 6); bb = null; }

  /* the landed drops: [x, y, z, speed] * count; rc = the radius of the cap each one stands for */
  function splat(P, count, rc) {
    const rc2 = rc * rc, rn = Math.ceil(rc / cell);
    for (let i = 0; i < count; i++) {
      const x = P[i * 4], y = P[i * 4 + 1] - top, z = P[i * 4 + 2], sp = P[i * 4 + 3];
      /* off the plinth, or still in the air (the stream is drawn as one rope) */
      if (y < -0.05 || y > 0.45 || (y > 0.2 && sp > 1.5)) continue;
      const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell);
      if (ci < -rn || cj < -rn || ci > N + rn || cj > N + rn) continue;
      const j0 = Math.max(0, cj - rn), j1 = Math.min(N - 1, cj + rn), i0 = Math.max(0, ci - rn), i1 = Math.min(N - 1, ci + rn);
      for (let j = j0; j <= j1; j++) {
        const dz = z0 + (j + 0.5) * cell - z, row = j * N;
        for (let ii = i0; ii <= i1; ii++) {
          const dx = x0 + (ii + 0.5) * cell - x, d2 = dx * dx + dz * dz;
          if (d2 >= rc2) continue;
          const h = y + Math.sqrt(rc2 - d2);
          if (h > F[row + ii]) F[row + ii] = h;
        }
      }
      grow(i0, j0, i1, j1);
    }
  }
  /* an analytic pool: { cx, cz, r, th, seed, t, mx, mz, mound }: a flat top rolling over into a steep rounded edge,
     an organic outline, a heap where the stream lands */
  function pool(p) {
    const R = p.r * 1.22, s = p.seed || 0, t = p.t || 0;
    const ci0 = Math.floor((p.cx - R - x0) / cell), ci1 = Math.ceil((p.cx + R - x0) / cell);
    const cj0 = Math.floor((p.cz - R - z0) / cell), cj1 = Math.ceil((p.cz + R - z0) / cell);
    const i0 = Math.max(0, ci0), i1 = Math.min(N - 1, ci1), j0 = Math.max(0, cj0), j1 = Math.min(N - 1, cj1);
    for (let j = j0; j <= j1; j++) {
      const dz = z0 + (j + 0.5) * cell - p.cz, row = j * N;
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + 0.5) * cell - p.cx, d = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
        const e = 1 + 0.07 * Math.sin(3 * a + s + t * 0.3) + 0.045 * Math.sin(5 * a - 1.3 * s) + 0.03 * Math.sin(8 * a + 2.1 * s - t * 0.2);
        const q = d / (p.r * e);
        if (q >= 1) continue;
        const q2 = q * q, q4 = q2 * q2;
        let h = p.th * Math.sqrt(1 - q4 * q4);
        if (p.mound) { const mx = x0 + (i + 0.5) * cell - p.mx, mz = z0 + (j + 0.5) * cell - p.mz; h += p.mound * Math.exp(-(mx * mx + mz * mz) / 0.035); }
        if (h > F[row + i]) F[row + i] = h;
      }
    }
    grow(i0, j0, i1, j1);
  }
  /* [1 4 6 4 1] / 16 along x, then along z, over the painted cells (and the margin the blur spreads into) */
  function blur(passes = 1) {
    if (!bb) return;
    for (let p = 0; p < passes; p++) {
      grow(bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2);
      const [i0, j0, i1, j1] = bb;
      for (let j = j0; j <= j1; j++) {
        const row = j * N;
        for (let i = i0; i <= i1; i++) {
          const a = i > 1 ? F[row + i - 2] : 0, b = i > 0 ? F[row + i - 1] : 0, c = i < N - 1 ? F[row + i + 1] : 0, d = i < N - 2 ? F[row + i + 2] : 0;
          B[row + i] = (a + d + 4 * (b + c) + 6 * F[row + i]) * 0.0625;
        }
      }
      for (let j = j0; j <= j1; j++) {
        const row = j * N;
        for (let i = i0; i <= i1; i++) {
          const a = j > 1 ? B[row - 2 * N + i] : 0, b = j > 0 ? B[row - N + i] : 0, c = j < N - 1 ? B[row + N + i] : 0, d = j < N - 2 ? B[row + 2 * N + i] : 0;
          F[row + i] = (a + d + 4 * (b + c) + 6 * B[row + i]) * 0.0625;
        }
      }
    }
  }
  /* to the GPU: the painted cells and whatever the texture showed before; the meshes cover just the paint */
  function commit() {
    const regions = [bb, shown].filter(Boolean);
    for (const r of regions) {
      const i0 = Math.max(0, r[0] - 1), j0 = Math.max(0, r[1] - 1), i1 = Math.min(N - 1, r[2] + 1), j1 = Math.min(N - 1, r[3] + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0, k = j * N + i0; i <= i1; i++, k++) H16[k] = F[k] > 1e-5 ? toHalf(F[k]) : 0;
    }
    tex.needsUpdate = true;
    shown = bb ? bb.slice() : null;
    if (!bb) { mesh.visible = halo.visible = false; return; }
    const place = (m, pad, y) => {
      const i0 = bb[0] - pad, j0 = bb[1] - pad, i1 = bb[2] + 1 + pad, j1 = bb[3] + 1 + pad;
      m.position.set(x0 + (i0 + i1) * 0.5 * cell, y, z0 + (j0 + j1) * 0.5 * cell);
      m.scale.set((i1 - i0) * cell, 1, (j1 - j0) * cell);
      m.updateMatrix(); m.updateMatrixWorld(true);
    };
    place(mesh, 1, top + 0.003); place(halo, 5, top + 0.001);
    mesh.visible = halo.visible = U.uFade.value > 0.001;
  }
  /* the reset: the paint sinks and draws back from its thin edges inward as it fades */
  function fade(k) {
    U.uFade.value = Math.min(1, k * 1.6);
    U.uFadeH.value = 0.3 + 0.7 * k;
    U.uThr.value = 0.006 + (1 - k) * 0.075;
    mesh.visible = halo.visible = !!bb && k > 0.001;
  }
  return {
    group, setDomain, clear, splat, pool, blur, commit, fade,
    setMap(t, bump) { mat.map = t; if (bump) mat.bumpMap = bump; mat.needsUpdate = true; },
    setSource(x, z) { U.uSrc.value.set(x, z); },
    dispose() { geo.dispose(); hgeo.dispose(); mat.dispose(); hmat.dispose(); tex.dispose(); },
    get empty() { return !bb; }, meshes: [mesh, halo], material: mat, uniforms: U
  };
}
