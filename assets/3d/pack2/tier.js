/* Dvatone pack2: quality tier, decided once per visit (MOBILE_STRATEGY.md section 3).
   high: desktops and strong laptops, full quality.
   mid:  flagship phones (Xiaomi 14, iPhone 13+), DPR cap 1.5, quarter-res bloom, halved shadow map, 512 px coatings.
   low:  older or weak phones, Save-Data, 2G/3G: poster with a "Live 3D" tap-to-start; if started, DPR 1, no post,
         30 fps cap.
   Signals: WebGL renderer, devicePixelRatio, hardwareConcurrency, deviceMemory, screen size, pointer, Save-Data and
   network type; a 1-second frame-time probe at start can lower the tier by one step. Remembered for the visit
   (sessionStorage 'dv3d.tier'). Overrides: ?tier=high|mid|low, window.DV3D_TIER. */
const KEY = 'dv3d.tier';
const TIERS = ['low', 'mid', 'high'];

export const TIER_CFG = {
  high: { dpr: 2, msaa: 4, msaaSmall: 2, post: 'full', bloomScale: 2, shadow: 1024, contact: 512, bake: 1024, strips: 384, labels: 2048, fps30: false },
  mid: { dpr: 1.5, msaa: 2, msaaSmall: 2, post: 'full', bloomScale: 4, shadow: 512, contact: 256, bake: 512, strips: 256, labels: 2048, fps30: false },
  low: { dpr: 1, msaa: 0, msaaSmall: 0, post: 'direct', bloomScale: 4, shadow: 512, contact: 256, bake: 512, strips: 256, labels: 1024, fps30: true }
};

let gpuStr = null;
export function gpuName() {
  if (gpuStr !== null) return gpuStr;
  gpuStr = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpuStr = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    }
  } catch (e) { gpuStr = ''; }
  return gpuStr;
}

function forced() {
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (TIERS.includes(q)) return q;
  } catch (e) { /* no location */ }
  if (typeof window !== 'undefined' && TIERS.includes(window.DV3D_TIER)) return window.DV3D_TIER;
  return null;
}
function stored() { try { const t = sessionStorage.getItem(KEY); return TIERS.includes(t) ? t : null; } catch (e) { return null; } }
export function remember(t) { try { sessionStorage.setItem(KEY, t); } catch (e) { /* private mode */ } }

/** static decision (synchronous): returns { tier, why, fixed } where fixed = forced or remembered (no probe needed) */
export function detectTier() {
  const f = forced(); if (f) return { tier: f, why: 'forced', fixed: true };
  const s = stored(); if (s) return { tier: s, why: 'remembered for this visit', fixed: true };
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const conn = nav.connection || {};
  if (conn.saveData) return { tier: 'low', why: 'Save-Data', fixed: false };
  if (/(^|-)2g|^3g$/.test(conn.effectiveType || '')) return { tier: 'low', why: 'slow network ' + conn.effectiveType, fixed: false };
  const gpu = gpuName();
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(gpu)) return { tier: 'low', why: 'software GPU', fixed: false };
  /* phones and tablets: touch is the primary pointer, or a phone-sized screen (a 1366x768 laptop stays a desktop) */
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const smallScr = Math.min(screen.width, screen.height) < 600;
  const phone = smallScr || coarse;
  const mem = nav.deviceMemory || 8, cores = nav.hardwareConcurrency || 8;
  const apple = /apple/i.test(gpu);
  if (!phone) return { tier: (mem <= 2 || cores <= 2) ? 'mid' : 'high', why: 'desktop, ' + cores + ' cores, ' + mem + ' GB', fixed: false };
  if (mem <= 3 || (!apple && cores <= 4)) return { tier: 'low', why: 'phone with ' + mem + ' GB / ' + cores + ' cores', fixed: false };
  if (/adreno[^0-9]*([1-5]\d\d|6[0-3]\d)\b/i.test(gpu) || /mali-(t\d+|g[0-6]\d)\b/i.test(gpu) || /powervr|videocore/i.test(gpu))
    return { tier: 'low', why: 'older mobile GPU ' + gpu, fixed: false };
  return { tier: 'mid', why: 'phone ' + (gpu || 'GPU unknown'), fixed: false };
}

/** idle frame-time probe: mean rAF interval in ms over about `ms` */
export function probe(ms = 1000) {
  return new Promise(res => {
    let n = 0, t0 = 0, last = 0, sum = 0;
    const f = t => {
      if (!t0) { t0 = last = t; requestAnimationFrame(f); return; }
      sum += t - last; last = t; n++;
      if (t - t0 < ms) requestAnimationFrame(f); else res(sum / Math.max(1, n));
    };
    requestAnimationFrame(f);
  });
}
export function lower(t) { return TIERS[Math.max(0, TIERS.indexOf(t) - 1)]; }
