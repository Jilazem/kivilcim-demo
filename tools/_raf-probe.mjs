
import { CDP, findChrome, launchChrome } from '/Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/cli/cdp.mjs';
const b = await launchChrome({ chromePath: findChrome(), port: 9333, headless: true, extraArgs: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync'] });
const cdp = await CDP.connect(b.wsUrl);
const { sessionId } = await cdp.attachTo('file://' + process.cwd() + '/demo/index.html?dev=1&fs=1');
cdp.sessionId = sessionId;
await new Promise(r => setTimeout(r, 1500));
const vis = await cdp.evaluate('document.visibilityState');
const raf = await cdp.evaluate('new Promise(res => { let n=0; const t0=performance.now(); function f(){ n++; if(performance.now()-t0<2000) requestAnimationFrame(f); else res(n); } requestAnimationFrame(f); })');
const raf2 = await cdp.evaluate('new Promise(res => { let n=0; const t0=performance.now(); function f(){ n++; if(performance.now()-t0<2000) setTimeout(f,16); else res(n); } setTimeout(f,16); })');
console.log(JSON.stringify({ vis, rafFramesIn2s: raf, timeoutFramesIn2s: raf2, dpr: await cdp.evaluate('devicePixelRatio') }));
cdp.close(); b.stop();
