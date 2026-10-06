/* Dvatone pack2: tiny Radiance RGBE (.hdr) loader (RLE scanlines) -> half-float equirectangular DataTexture.
   Kept local so the module needs no three/addons import map. */
export async function loadHDR(THREE, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('HDR ' + res.status + ' ' + url);
  const buf = new Uint8Array(await res.arrayBuffer());
  let p = 0, W = 0, H = 0;
  const line = () => { let s = ''; while (p < buf.length && buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  if (!/^#\?(RADIANCE|RGBE)/.test(line())) throw new Error('HDR: bad header');
  for (;;) {
    if (p >= buf.length) throw new Error('HDR: no size');
    const m = line().match(/^-Y (\d+) \+X (\d+)/);
    if (m) { H = +m[1]; W = +m[2]; break; }
  }
  const rgbe = new Uint8Array(W * H * 4), row = new Uint8Array(W * 4);
  for (let y = 0; y < H; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          let n = buf[p++];
          if (n > 128) { n -= 128; const v = buf[p++]; while (n--) row[(x++) * 4 + c] = v; }
          else { while (n--) row[(x++) * 4 + c] = buf[p++]; }
        }
      }
    } else { row.set(buf.subarray(p, p + W * 4)); p += W * 4; }
    rgbe.set(row, (H - 1 - y) * W * 4);          /* bottom-up rows: texture v = 1 is the zenith, no flipY needed */
  }
  const half = new Uint16Array(W * H * 4), toHalf = THREE.DataUtils.toHalfFloat, one = toHalf(1);
  for (let i = 0; i < half.length; i += 4) {
    const e = rgbe[i + 3];
    if (e) {
      const f = Math.pow(2, e - 136);
      half[i] = toHalf(rgbe[i] * f); half[i + 1] = toHalf(rgbe[i + 1] * f); half[i + 2] = toHalf(rgbe[i + 2] * f);
    }
    half[i + 3] = one;
  }
  const tex = new THREE.DataTexture(half, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
