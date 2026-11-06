/**
 * U1 ölçümü — YAYIN PAKETİ (dist/) üzerinde CDP ile gerçek ölçüm + piksel kanıtı.
 *
 * Ölçülenler:
 *  - 390x844 (portrait, dpr 3) ve 1280x720 (desktop) viewport'larda fit/visibleWorld
 *  - Ekran DIŞI düşman sayısı ↔ gösterge sayısı ve toplanan sayı (aynı yönde tek ok)
 *  - Göstergenin görünür dünya dikdörtgeninin içinde olması
 *  - Göstergenin GERÇEKTEN çizildiğinin piksel kanıtı: HUD şeridindeki kırmızı piksel
 *    sayısı (düşmanlar ekran dışıyken) ile gösterge yokken (killAll) farkı
 *  - Ekranda görünen düşman için ek işaret çizilmemesi (gösterge 0 + kırmızı piksel artmıyor)
 *  - Ekran görüntüleri (PNG) ve sha256
 *
 * Çalıştır: node tools/u1-hud-olcum.mjs
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, launchChrome } from '../cli/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'out', 'demo-final');
mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function startStatic(dir) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const file = path.resolve(dir, '.' + urlPath);
        if (!file.startsWith(dir + path.sep)) { res.writeHead(403); res.end('403'); return; }
        const body = readFileSync(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
    srv.on('error', reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

const BRIDGE = `(() => {
  const g = globalThis.KIVILCIM_GAME;
  if (!g) return false;
  if (!globalThis.__U1__) {
    globalThis.__U1__ = {
      /* HUD güvenli alanındaki (üst bandın altı, alt şeridin üstü) kırmızı gösterge piksellerini
       * sayar. Kırmızı ölçütü dar tutuldu: #ff5470 (r255 g84 b112) ve kenar yumuşatma tonları.
       * Düşman gövdeleri camgöbeği olduğundan bu ölçüt onlardan etkilenmez. */
      stripRed(vis, bandH) {
        const sx = g.pixelScale || 1, sy = g.pixelScale || 1;
        const x = Math.max(0, Math.floor(vis.x * sx));
        const y = Math.max(0, Math.floor((vis.y + bandH) * sy));
        const w = Math.min(g.canvas.width - x, Math.ceil(vis.w * sx));
        const h = Math.max(0, Math.min(g.canvas.height - y, Math.ceil((vis.h - bandH - 40) * sy)));
        const d = g.ctx.getImageData(x, y, w, h).data;
        let red = 0, bright = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          if (r >= 170 && gg <= 160 && b >= 50 && b <= 190 && r - gg >= 50) red++;
          if (r >= 230 && gg >= 210 && b >= 210) bright++;
        }
        return { red, bright, rect: [x, y, w, h] };
      },
      box(vis, ind, half) {
        const sx = g.pixelScale || 1;
        const x = Math.max(0, Math.floor((ind.x - half) * sx));
        const y = Math.max(0, Math.floor((ind.y - half) * sx));
        const w = Math.min(g.canvas.width - x, Math.ceil(half * 2 * sx));
        const h = Math.min(g.canvas.height - y, Math.ceil(half * 2 * sx));
        const d = g.ctx.getImageData(x, y, w, h).data;
        let red = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          if (r >= 170 && gg <= 160 && b >= 50 && b <= 190 && r - gg >= 50) red++;
        }
        return red;
      },
      measure(label, bandH) {
        const vis = g.visibleWorld();
        const inds = g.hudIndicators();
        const snap = g.inspect.snapshot();
        const perInd = inds.map((i) => {
          const inside = i.x >= vis.x - 0.01 && i.x <= vis.x + vis.w + 0.01 && i.y >= vis.y + 112 - 0.01 && i.y <= vis.y + vis.h - 40 - 0.01;
          return { x: i.x, y: i.y, count: i.count, dx: i.dx, dy: i.dy, inside, redInBox: this.box(vis, i, 14) };
        });
        return {
          label,
          fit: g.fitInfo,
          vis,
          buffer: [g.canvas.width, g.canvas.height],
          pixelScale: g.pixelScale,
          enemyCount: snap.state.enemyXs.length,
          score: snap.state.score,
          hp: snap.state.player.hp,
          indicatorCount: inds.length,
          indicatorSum: inds.reduce((s, i) => s + i.count, 0),
          allInside: perInd.every((p) => p.inside),
          perInd,
          strip: this.stripRed(vis, bandH),
        };
      },
    };
  }
  return true;
})()`;

const PAGE = '/dist/demo__index.html?dev=0&headless=1';

/** Yakalanan PNG'yi sayfada Image olarak açıp piksel istatistiği çıkarır (kompozit kanıt). */
const SHOT_STATS = (dataUrl) => `new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let nonBg = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 20 || g > 20 || b > 30) nonBg++;
      if (r >= 170 && g <= 160 && b >= 50 && b <= 190 && r - g >= 50) red++;
    }
    resolve({ w: c.width, h: c.height, nonBg, red });
  };
  img.onerror = () => reject(new Error('PNG açılamadı'));
  img.src = '${dataUrl}';
})`;

/** Gerçek kare üretir: render'ı rAF içinde 12 kez çalıştırır (kompozitör bayat kare yakalamasın). */
const WARM_FRAMES = `new Promise((resolve) => {
  const g = globalThis.KIVILCIM_GAME;
  g.stop();
  let n = 0;
  const loop = () => {
    g.render();
    n++;
    if (n < 12) requestAnimationFrame(loop);
    else setTimeout(resolve, 150);
  };
  requestAnimationFrame(loop);
})`;

async function shoot(cdp, file, expectRed) {
  await cdp.send('Page.bringToFront');
  await cdp.evaluate(WARM_FRAMES);
  let png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  let stats = await cdp.evaluate(SHOT_STATS('data:image/png;base64,' + png.toString('base64')));
  const bad = () => stats.nonBg < 5000 || (expectRed && stats.red === 0);
  if (bad()) {
    await cdp.evaluate(WARM_FRAMES);
    png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    stats = await cdp.evaluate(SHOT_STATS('data:image/png;base64,' + png.toString('base64')));
  }
  if (bad()) {
    await cdp.evaluate(WARM_FRAMES);
    png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    stats = await cdp.evaluate(SHOT_STATS('data:image/png;base64,' + png.toString('base64')));
  }
  writeFileSync(file, png);
  return { file, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), stats };
}

async function runViewport(cdp, { label, vw, vh, dpr, wave, shot }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: dpr, mobile: vw < vh });
  const fit = await cdp.evaluate('(() => { const g = globalThis.KIVILCIM_GAME; g.stop(); globalThis.KIVILCIM_FIT(); return g.fitInfo; })()');
  // durum A: düşmanlar ekran DIŞINDA (spawn y=-24)
  const A = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME, u = globalThis.__U1__;
    g.stop(); g.reset(); g.invokeCommand('killAll');
    g.invokeCommand('spawnWave', [${wave}]);
    g.render();
    return u.measure('A: dusmanlar ekran disi', 112);
  })()`);
  const shotPath = path.join(outDir, shot);
  const shotInfo = await shoot(cdp, shotPath, true);

  // durum B: hiç düşman yok → gösterge yok (piksel tabanı)
  const B = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME, u = globalThis.__U1__;
    g.invokeCommand('killAll'); g.render();
    return u.measure('B: dusman yok', 112);
  })()`);

  // durum C: düşmanlar aşağı indi, ekranda GÖRÜNÜYOR → ek işaret olmamalı
  const C = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME, u = globalThis.__U1__;
    g.invokeCommand('killAll');
    g.invokeCommand('spawnWave', [${wave}]);
    g.step(45);
    g.render();
    return u.measure('C: dusmanlar ekranda', 112);
  })()`);
  const shotC = await shoot(cdp, path.join(outDir, shot.replace('.png', '-c-ekranda.png')), false);

  // durum D: üst sınır — 40 düşman, en fazla 8 gösterge
  const D = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME, u = globalThis.__U1__;
    g.invokeCommand('killAll');
    g.invokeCommand('spawnWave', [40]);
    g.render();
    return u.measure('D: 40 dusman (ust sinir)', 112);
  })()`);

  return { label, viewport: { vw, vh, dpr }, fit, shot: shotInfo, shotC, A, B, C, D };
}

const server = await startStatic(root);
const chromePort = await freePort();
const chrome = await launchChrome({ port: chromePort, headless: true });
const cdp = await CDP.connect(chrome.wsUrl);
let report;
try {
  await cdp.attachTo(`http://127.0.0.1:${server.port}${PAGE}`);
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = await cdp.evaluate(BRIDGE); } catch (err) { /* yükleniyor */ }
    if (!ready) await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) throw new Error('Sayfa hazır değil (KIVILCIM_GAME yok)');

  const portrait = await runViewport(cdp, { label: 'portrait-390x844', vw: 390, vh: 844, dpr: 3, wave: 6, shot: 'u1-portrait-390x844.png' });
  const desktop = await runViewport(cdp, { label: 'desktop-1280x720', vw: 1280, vh: 720, dpr: 1, wave: 6, shot: 'u1-desktop-1280x720.png' });

  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const distSha = {
    'dist/demo__index.html': sha(path.join(root, 'dist/demo__index.html')),
    'dist/demo__game.mjs': sha(path.join(root, 'dist/demo__game.mjs')),
    'dist/kivilcim.mjs': sha(path.join(root, 'dist/kivilcim.mjs')),
    'dist/scenario.mjs': sha(path.join(root, 'dist/scenario.mjs')),
  };

  report = {
    generatedAt: new Date().toISOString(),
    page: PAGE,
    bundle: distSha,
    runs: [portrait, desktop],
  };
} finally {
  cdp.close();
  chrome.stop();
  server.srv.close();
}

const gates = [];
for (const r of report.runs) {
  gates.push({ gate: `${r.label}: A göstergesi var (ekran dışı düşman)`, ok: r.A.indicatorCount >= 1, detail: `${r.A.indicatorCount} gösterge / ${r.A.enemyCount} düşman, toplanan ${r.A.indicatorSum}` });
  gates.push({ gate: `${r.label}: A toplanan sayı = düşman sayısı`, ok: r.A.indicatorSum === r.A.enemyCount && r.A.enemyCount === 6, detail: `${r.A.indicatorSum} / ${r.A.enemyCount}` });
  gates.push({ gate: `${r.label}: A tüm göstergeler görünür dikdörtgende`, ok: r.A.allInside === true, detail: JSON.stringify(r.A.perInd.map((p) => [p.x, p.y])) });
  gates.push({ gate: `${r.label}: A her göstergede kırmızı piksel > 0 (gerçekten çizildi)`, ok: r.A.perInd.length > 0 && r.A.perInd.every((p) => p.redInBox > 0), detail: JSON.stringify(r.A.perInd.map((p) => p.redInBox)) });
  gates.push({ gate: `${r.label}: B (düşman yok) gösterge 0`, ok: r.B.indicatorCount === 0, detail: String(r.B.indicatorCount) });
  gates.push({ gate: `${r.label}: A şerit kırmızı > B taban (piksel farkı)`, ok: r.A.strip.red > r.B.strip.red, detail: `A ${r.A.strip.red} > B ${r.B.strip.red}` });
  gates.push({ gate: `${r.label}: C (ekranda görünen düşman) gösterge 0`, ok: r.C.indicatorCount === 0, detail: `${r.C.indicatorCount} gösterge / ${r.C.enemyCount} düşman` });
  gates.push({ gate: `${r.label}: C şerit kırmızı B tabanını aşmıyor`, ok: r.C.strip.red <= r.B.strip.red, detail: `C ${r.C.strip.red} <= B ${r.B.strip.red}` });
  gates.push({ gate: `${r.label}: D üst sınır 8 gösterge`, ok: r.D.indicatorCount <= 8, detail: `${r.D.indicatorCount} gösterge / ${r.D.enemyCount} düşman, toplanan ${r.D.indicatorSum}` });
  gates.push({ gate: `${r.label}: D toplanan sayı = 40`, ok: r.D.indicatorSum === 40, detail: String(r.D.indicatorSum) });
  gates.push({ gate: `${r.label}: ekran görüntüsü >= 10KB`, ok: r.shot.bytes >= 10240, detail: `${r.shot.bytes} bayt` });
  gates.push({ gate: `${r.label}: kompozit görüntüde oyun çizilmiş (boş kare değil)`, ok: r.shot.stats.nonBg > 5000, detail: `${r.shot.stats.w}x${r.shot.stats.h}, nonBg ${r.shot.stats.nonBg}` });
  gates.push({ gate: `${r.label}: kompozit görüntüde gösterge kırmızısı var`, ok: r.shot.stats.red > 0, detail: `kırmızı ${r.shot.stats.red}` });
  gates.push({ gate: `${r.label}: ekranda düşman varken kompozit kırmızı artmıyor`, ok: r.shotC.stats.nonBg > 5000 && r.shotC.stats.red <= r.shot.stats.red, detail: `A ${r.shot.stats.red} / C ${r.shotC.stats.red}` });
}

const ok = gates.every((g) => g.ok);
report.gates = gates;
report.ok = ok;
writeFileSync(path.join(outDir, 'u1-olcum.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok, failed: gates.filter((g) => !g.ok), runs: report.runs.map((r) => ({ label: r.label, vis: r.A.vis, buffer: r.A.buffer, A: { ind: r.A.indicatorCount, sum: r.A.indicatorSum, strip: r.A.strip.red }, B: { ind: r.B.indicatorCount, strip: r.B.strip.red }, C: { ind: r.C.indicatorCount, strip: r.C.strip.red }, D: { ind: r.D.indicatorCount, sum: r.D.indicatorSum }, shot: r.shot })) }, null, 2));
process.exit(ok ? 0 : 1);
