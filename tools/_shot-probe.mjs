
import { CDP, findChrome, launchChrome } from '/Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/cli/cdp.mjs';
const b = await launchChrome({ chromePath: findChrome(), port: 9335, headless: true, extraArgs: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync'] });
const cdp = await CDP.connect(b.wsUrl);
const { sessionId } = await cdp.attachTo('file:///Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/demo/index.html?dev=1&fs=1');
cdp.sessionId = sessionId;
await cdp.send('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false });
await new Promise(r=>setTimeout(r,1200));
let n=0; const t0=Date.now(); const times=[];
while (Date.now()-t0 < 3000) {
  const r = await cdp.send('Page.captureScreenshot', { format:'jpeg', quality:80 });
  n++; times.push(Date.now()-t0);
}
console.log(JSON.stringify({ shots:n, spanMs: Date.now()-t0, fps: +(n/3).toFixed(1), firstShotBytes: 0 }));
cdp.close(); b.stop();
