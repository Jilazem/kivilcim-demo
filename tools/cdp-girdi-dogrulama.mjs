/**
 * KILIT-2 · girdi doğrulaması — GERÇEK CDP girdisi ile ölçüm.
 * Ölçülen: klavye ArrowRight/ArrowLeft ve dokunma (sol/sağ yarı) ile oyuncu x'i.
 * Çıktı: out/demo-final/cdp-girdi-dogrulama.json (sayısal kanıt + konsol hataları).
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CDP, findChrome, launchChrome } from '../cli/cdp.mjs';

const root = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.wasm': 'application/wasm',
};

function startStatic(dir) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const file = path.resolve(dir, '.' + urlPath);
        if (!file.startsWith(dir + path.sep)) { res.writeHead(403); res.end('403'); return; }
        const body = readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch (err) { res.writeHead(404); res.end('404'); }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
    srv.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runKey(cdp, key, down) {
  const table = { ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, Space: { code: 'Space', vk: 32 } };
  const m = table[key];
  const ev = { type: down ? 'keyDown' : 'keyUp', key: key === 'Space' ? ' ' : key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk };
  if (down) { ev.text = key === 'Space' ? ' ' : '\uE000'; ev.unmodifiedText = ev.text; }
  await cdp.send('Input.dispatchKeyEvent', ev);
}

async function touch(cdp, x, y, phase) {
  const point = { x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 };
  if (phase === 'start') await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  else if (phase === 'move') await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const xOf = async (cdp) => {
  const raw = await cdp.evaluate('JSON.stringify(globalThis.KIVILCIM_GAME.inspect.snapshot())');
  const snap = JSON.parse(raw);
  const s = snap.state;
  return { x: s.player.x, tick: snap.tick, score: s.score, lives: s.lives };
};

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome bulunamadı'); process.exit(2); }
  const server = await startStatic(root);
  const browser = await launchChrome({
    chromePath: chrome, port: 9000 + Math.floor(Math.random() * 900), headless: true,
    extraArgs: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'],
  });
  const errors = [];
  const steps = [];
  let cdp;
  try {
    cdp = await CDP.connect(browser.wsUrl);
    const { sessionId } = await cdp.attachTo('about:blank');
    await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const sessionIdCur = cdp.sessionId;
    cdp.ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
      if (msg.sessionId !== sessionIdCur) return;
      if (msg.method === 'Runtime.exceptionThrown') { const d = msg.params.exceptionDetails || {}; errors.push(`exception: ${(d.exception && d.exception.description) || d.text}`); }
      else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(`console.error: ${(msg.params.args || []).map((a) => a.value || a.description || '').join(' ')}`);
      else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`log: ${msg.params.entry.text}`);
    });

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/dist/demo__index.html?seed=260110` });
    const deadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < deadline) {
      ready = await cdp.evaluate('Boolean(globalThis.KIVILCIM_GAME && globalThis.KIVILCIM_GAME.inspect)').catch(() => false);
      if (ready) break;
      await sleep(200);
    }
    if (!ready) throw new Error('KIVILCIM_GAME hazır olmadı');
    await sleep(600);

    const base = await xOf(cdp);
    steps.push({ step: 'baslangic', ...base });

    // 1) Klavye ArrowRight basılı tut (900 ms)
    await runKey(cdp, 'ArrowRight', true); await sleep(900);
    const afterRight = await xOf(cdp);
    await runKey(cdp, 'ArrowRight', false); await sleep(250);
    steps.push({ step: 'klavye ArrowRight (900ms)', ...afterRight });

    // 2) Klavye ArrowLeft basılı tut (900 ms)
    await runKey(cdp, 'ArrowLeft', true); await sleep(900);
    const afterLeft = await xOf(cdp);
    await runKey(cdp, 'ArrowLeft', false); await sleep(250);
    steps.push({ step: 'klavye ArrowLeft (900ms)', ...afterLeft });

    // 3) Dokunma — sağ yarı (x=1100)
    await touch(cdp, 1100, 600, 'start'); await sleep(900);
    const afterTouchRight = await xOf(cdp);
    await touch(cdp, 1100, 600, 'end'); await sleep(250);
    steps.push({ step: 'dokunma sag yari (900ms)', ...afterTouchRight });

    // 4) Dokunma — sol yarı (x=100)
    await touch(cdp, 100, 600, 'start'); await sleep(900);
    const afterTouchLeft = await xOf(cdp);
    await touch(cdp, 100, 600, 'end'); await sleep(250);
    steps.push({ step: 'dokunma sol yari (900ms)', ...afterTouchLeft });

    const checks = {
      klavyeSagArtti: afterRight.x > base.x,
      klavyeSolAzaltti: afterLeft.x < afterRight.x,
      dokunmaSagArtti: afterTouchRight.x > afterLeft.x,
      dokunmaSolAzaltti: afterTouchLeft.x < afterTouchRight.x,
      tickIledi: afterTouchLeft.tick > base.tick,
      konsolHatasiYok: errors.length === 0,
    };
    const ok = Object.values(checks).every(Boolean);
    const out = {
      ok, generatedAt: new Date().toISOString(),
      url: `http://127.0.0.1:${server.port}/dist/demo__index.html?seed=260110`,
      viewport: '1280x720 dpr1', chrome: path.basename(chrome),
      steps, checks, consoleErrors: errors,
      deltas: {
        klavyeSag: afterRight.x - base.x, klavyeSol: afterLeft.x - afterRight.x,
        dokunmaSag: afterTouchRight.x - afterLeft.x, dokunmaSol: afterTouchLeft.x - afterTouchRight.x,
      },
    };
    mkdirSync(path.join(root, 'out/demo-final'), { recursive: true });
    writeFileSync(path.join(root, 'out/demo-final/cdp-girdi-dogrulama.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error('cdp dogrulama hatasi: ' + (err && err.message ? err.message : err));
    process.exitCode = 2;
  } finally {
    try { cdp && cdp.close(); } catch (e) {}
    try { browser.stop(); } catch (e) {}
    try { server.srv.close(); } catch (e) {}
  }
}
main();
