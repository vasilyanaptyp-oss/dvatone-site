/* Dvatone 3D quality tier (MOBILE_STRATEGY.md section 3), decided once per visit:
   high = desktop and strong laptops, mid = flagship phones (Xiaomi 14, iPhone 13+), low = older or weak phones,
   Save-Data, software rendering. Inputs: WebGL renderer, devicePixelRatio, hardwareConcurrency, deviceMemory,
   screen size, Save-Data, then a 1-second frame-time probe that can lower the tier by one step.
   Stored in sessionStorage 'dv3d:tier' and window.DV3D.tier so every 3D module of the visit agrees.
   ?tier=high|mid|low forces a tier (lab, tests). */
import { isSmallScreen } from '../core.js';

export const TIERS = ['low', 'mid', 'high'];
const KEY = 'dv3d:tier';
const G = (typeof window !== 'undefined') ? (window.DV3D = window.DV3D || {}) : {};

function store(t, why) {
  try { sessionStorage.setItem(KEY, t); } catch (e) { /* private mode */ }
  G.tier = t; G.tierWhy = why;
  return t;
}
function cached() {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('tier') : null;
  if (TIERS.includes(q)) return { tier: q, why: 'forced (?tier)', forced: true };
  if (G.tier && TIERS.includes(G.tier)) return { tier: G.tier, why: G.tierWhy || 'this visit' };
  try { const t = sessionStorage.getItem(KEY); if (TIERS.includes(t)) return { tier: t, why: 'this visit' }; } catch (e) { /* ignore */ }
  return null;
}
function rendererInfo() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    if (!gl) return { gl: false, name: '' };
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return { gl: true, name };
  } catch (e) { return { gl: false, name: '' }; }
}

/** Static decision from the device, no timing. -> { tier, why, phone } */
export function staticTier() {
  const c = cached(); if (c) return Object.assign({ phone: isPhone() }, c);
  const nav = navigator, conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  const phone = isPhone();
  if (conn && conn.saveData) return { tier: 'low', why: 'Save-Data', phone };
  const dpr = window.devicePixelRatio || 1;
  const r = rendererInfo();
  if (!r.gl) return { tier: 'low', why: 'no WebGL2', phone };
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft Basic/i.test(r.name)) return { tier: 'low', why: 'software renderer', phone };
  const cores = nav.hardwareConcurrency || 4, mem = nav.deviceMemory;
  if (!phone) return (cores <= 2 || (mem && mem <= 2)) ? { tier: 'mid', why: 'weak desktop', phone } : { tier: 'high', why: 'desktop', phone };
  const strong = /Adreno[^0-9]*(6[6-9]\d|7\d\d|8\d\d)|Apple GPU|Apple M\d|Mali-G(7[1-9]|[89]\d|\d{3})|Immortalis|Xclipse/i.test(r.name);
  if (strong && (!mem || mem >= 4)) return { tier: 'mid', why: 'flagship GPU (' + r.name + '), DPR ' + dpr, phone };
  /* deviceMemory is rounded down to a power of two (6 GB reads 4): only 8 GB+ phones without a known flagship GPU get mid */
  if (cores >= 8 && mem >= 8 && dpr >= 2) return { tier: 'mid', why: 'phone, ' + cores + ' cores, ' + mem + ' GB, DPR ' + dpr, phone };
  return { tier: 'low', why: 'phone, modest GPU (' + (r.name || 'unknown') + ')', phone };
}
export function isPhone() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPod|Mobile|Silk/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ||
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && isSmallScreen());
}

/** 1-second frame-time probe on the main thread -> Promise<{ median, slowShare }> (ms) */
export function probe(ms = 1000) {
  return new Promise(res => {
    if (typeof requestAnimationFrame !== 'function' || document.hidden) return res(null);
    const d = []; let last = 0; const t0 = performance.now();
    const f = now => {
      if (last) d.push(now - last);
      last = now;
      if (now - t0 < ms) requestAnimationFrame(f);
      else { d.sort((a, b) => a - b); res(d.length ? { median: d[d.length >> 1], slowShare: d.filter(x => x > 34).length / d.length } : null); }
    };
    requestAnimationFrame(f);
  });
}

/** Final tier: static decision, lowered one step when the probe shows a struggling device; stored for the visit.
    Call it once the page has loaded (the probe must see a quiet main thread, not the page being built). */
export async function decideTier() {
  const s = staticTier();
  if (s.forced || s.why === 'this visit') return s.tier;
  if (s.tier === 'low') return store('low', s.why);
  const p = await probe(1000);
  if (p && (p.median > 28 || p.slowShare > 0.3)) {
    const t = TIERS[Math.max(0, TIERS.indexOf(s.tier) - 1)];
    return store(t, s.why + ', slow frames (median ' + p.median.toFixed(0) + ' ms)');
  }
  return store(s.tier, s.why);
}
