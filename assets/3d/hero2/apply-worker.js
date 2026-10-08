/* hero2 first screen: the coat's application (apply.js) in a worker, drawing on the page's canvas (an OffscreenCanvas), so
   the WebGL context, the compile, the decodes, the uploads and the frames never take the page's main thread */
import { core } from './apply.js';

let C = null, size = [1, 1, 1], go = null;
const gate = new Promise(r => { go = r; });
const raf = self.requestAnimationFrame ? f => self.requestAnimationFrame(f) : f => setTimeout(() => f(performance.now()), 16);
const caf = self.cancelAnimationFrame ? id => self.cancelAnimationFrame(id) : id => clearTimeout(id);
self.onmessage = e => {
  const m = e.data || {};
  if (m.type === 'init') {
    size = m.size;
    C = core(m.canvas, Object.assign(m.o, { when: gate }), { frame: () => new Promise(raf), raf, caf, size: () => size });
    C.ready.then(ok => self.postMessage({ type: 'ready', ok, reason: C ? C.state.reason || '' : '' }));
  } else if (m.type === 'when') go();
  else if (!C) return;
  else if (m.type === 'play') C.play(() => self.postMessage({ type: 'end' }));
  else if (m.type === 'resize') { size = m.size; C.resize(m.focus); }
  else if (m.type === 'stop') C.stop();
  else if (m.type === 'destroy') { C.destroy(); C = null; }
};
