import { CDP, findChrome, launchChrome } from '/Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/cli/cdp.mjs';
const variants = [
  { name:'gpu-metal', args:['--enable-gpu','--use-angle=metal','--enable-features=CanvasOopRasterization'] },
  { name:'gpu-default', args:['--enable-gpu'] },
];
for (const v of variants) {
  const b = await launchChrome({ chromePath: findChrome(), port: 9336+Math.floor(Math.random()*100), headless: true, extraArgs: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync', ...v.args] });
  const cdp = await CDP.connect(b.wsUrl);
  const { sessionId } = await cdp.attachTo('file:///Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/demo/index.html?dev=1&fs=1');
  cdp.sessionId = sessionId;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false });
  await new Promise(r=>setTimeout(r,1500));
  const raf = await cdp.evaluate('new Promise(res => { let n=0; const t0=performance.now(); function f(){ n++; if(performance.now()-t0<1500) requestAnimationFrame(f); else res(n); } requestAnimationFrame(f); })');
  let n=0; const t0=Date.now();
  while (Date.now()-t0 < 2000) { await cdp.send('Page.captureScreenshot', { format:'jpeg', quality:80 }); n++; }
  console.log(JSON.stringify({ variant: v.name, rafIn1500ms: raf, captureFps: +(n/2).toFixed(1) }));
  cdp.close(); b.stop();
}
