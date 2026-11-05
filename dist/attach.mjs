/**
 * KIVILCIM attach — motor bağımsız mod.
 * Mevcut bir canvas oyununa dokunmadan RAF/canvas kancası kurar, __KIVILCIM_ATTACH__ köprüsü yayınlar.
 * Oyun kodunu değiştirmek gerekmez; yalnızca sayfaya bu modülü eklemek yeterlidir.
 */

export function attach(target = {}, opts = {}) {
  const canvas = target.canvas || (target && target.getContext ? target : (typeof document !== 'undefined' ? document.querySelector(opts.selector || 'canvas') : null));
  const state = {
    frames: 0,
    startedAt: 0, // wallclock-ok: yalnız rapor
    lastFrame: 0,
    fps: 0,
    fpsWindow: [],
    rafPatched: false,
  };

  const origRAF = globalThis.requestAnimationFrame;
  const origCancel = globalThis.cancelAnimationFrame;
  if (typeof origRAF === 'function' && !globalThis.__KIVILCIM_RAF_PATCHED__) {
    globalThis.__KIVILCIM_RAF_PATCHED__ = true;
    state.rafPatched = true;
    globalThis.requestAnimationFrame = function patched(cb) {
      return origRAF.call(globalThis, (ts) => {
        state.frames++;
        if (!state.startedAt) state.startedAt = ts;
        if (state.lastFrame) {
          state.fpsWindow.push(ts - state.lastFrame);
          if (state.fpsWindow.length > 60) state.fpsWindow.shift();
          const avg = state.fpsWindow.reduce((a, b) => a + b, 0) / state.fpsWindow.length;
          state.fps = avg > 0 ? Math.round(1000 / avg) : 0;
        }
        state.lastFrame = ts;
        return cb(ts);
      });
    };
  }

  function capture(name = 'attach') {
    if (!canvas || typeof canvas.toDataURL !== 'function') return { name, dataUrl: null, bytes: 0 };
    const dataUrl = canvas.toDataURL('image/png');
    return { name, dataUrl, bytes: Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4) };
  }

  function press(code) { return dispatch(code, true); }
  function release(code) { return dispatch(code, false); }

  function dispatch(code, down) {
    if (typeof window === 'undefined' || !window.dispatchEvent) return false;
    const ev = new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true });
    window.dispatchEvent(ev);
    if (canvas && canvas.dispatchEvent) canvas.dispatchEvent(ev);
    return true;
  }

  function pointer(x, y, down) {
    if (!canvas || !canvas.dispatchEvent || typeof PointerEvent === 'undefined') return false;
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const type = down ? 'pointerdown' : 'pointerup';
    canvas.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, bubbles: true }));
    return true;
  }

  const bridge = {
    attached: true,
    version: '1.0.0',
    canvas,
    frames: () => state.frames,
    fps: () => state.fps,
    snapshot: () => {
      if (typeof target.snapshot === 'function') return target.snapshot();
      const out = { frames: state.frames, fps: state.fps };
      if (canvas) { out.width = canvas.width; out.height = canvas.height; }
      return out;
    },
    capture,
    press,
    release,
    pointer,
    dispose() {
      if (state.rafPatched && origRAF) {
        globalThis.requestAnimationFrame = origRAF;
        if (origCancel) globalThis.cancelAnimationFrame = origCancel;
        globalThis.__KIVILCIM_RAF_PATCHED__ = false;
      }
    },
  };

  globalThis.__KIVILCIM_ATTACH__ = bridge;
  return bridge;
}
