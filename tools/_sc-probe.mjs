
import { CDP, findChrome, launchChrome } from '/Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/cli/cdp.mjs';
const b = await launchChrome({ chromePath: findChrome(), port: 9334, headless: true, extraArgs: ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-frame-rate-limit','--disable-gpu-vsync','--hide-scrollbars'] });
const cdp = await CDP.connect(b.wsUrl);
const { sessionId } = await cdp.attachTo('file:///Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime/demo/index.html?dev=1&fs=1');
cdp.sessionId = sessionId;
await cdp.send('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false });
let n=0, first=0, last=0; const gaps=[];
cdp.ws.addEventListener('message', ev => {
  const m = JSON.parse(typeof ev.data==='string'?ev.data:String(ev.data));
  if (m.method==='Page.screencastFrame' && m.sessionId===sessionId) {
    const t=Date.now(); if(!first) first=t; else gaps.push(t-last); last=t; n++;
    cdp.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(()=>{});
  }
});
await cdp.send('Page.startScreencast', { format:'jpeg', quality:80, everyNthFrame:1, maxWidth:1280, maxHeight:720 });
await new Promise(r=>setTimeout(r,4000));
await cdp.send('Page.stopScreencast');
gaps.sort((a,b)=>a-b);
console.log(JSON.stringify({ n, spanMs: last-first, medianGap: gaps[Math.floor(gaps.length/2)], p90: gaps[Math.floor(gaps.length*0.9)], maxGap: gaps[gaps.length-1] }));
cdp.close(); b.stop();
