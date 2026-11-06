/** Yayınlanan sayfayı (GitHub Pages) canlı sınar: gösterge var/yok + piksel kanıtı. */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CDP, launchChrome } from '../cli/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = 'https://jilazem.github.io/kivilcim-demo/demo__index.html?dev=0';
const cport = await new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const chrome = await launchChrome({ port: cport, headless: true });
const cdp = await CDP.connect(chrome.wsUrl);
const out = { url: URL_ };
try {
  await cdp.attachTo(URL_);
  let ok = false;
  for (let i = 0; i < 120 && !ok; i++) {
    try { ok = await cdp.evaluate('!!globalThis.KIVILCIM_GAME'); } catch {}
    if (!ok) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ok) throw new Error('Canlı sayfa hazır değil');
  out.bundle = await cdp.evaluate('globalThis.KIVILCIM_BUNDLE_SHA || null').catch(() => null);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  out.A = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME;
    g.stop(); globalThis.KIVILCIM_FIT();
    g.reset(); g.invokeCommand('killAll'); g.invokeCommand('spawnWave', [6]); g.render();
    const vis = g.visibleWorld(); const inds = g.hudIndicators();
    const sx = g.pixelScale || 1;
    const x = Math.max(0, Math.floor(vis.x * sx)), y = Math.max(0, Math.floor(vis.y * sx));
    const w = Math.min(g.canvas.width - x, Math.ceil(vis.w * sx)), h = Math.ceil(40 * sx);
    const d = g.ctx.getImageData(x, y, w, h).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i+1], b = d[i+2]; if (r >= 170 && gg <= 160 && b >= 50 && b <= 190 && r - gg >= 50) red++; }
    return { fit: g.fitInfo, vis, inds: inds.map(i => ({ x: i.x, y: i.y, count: i.count })), red };
  })()`);
  out.B = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME;
    g.invokeCommand('killAll'); g.render();
    const vis = g.visibleWorld(); const sx = g.pixelScale || 1;
    const x = Math.max(0, Math.floor(vis.x * sx)), y = Math.max(0, Math.floor(vis.y * sx));
    const w = Math.min(g.canvas.width - x, Math.ceil(vis.w * sx)), h = Math.ceil(40 * sx);
    const d = g.ctx.getImageData(x, y, w, h).data;
    let red = 0;
    for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i+1], b = d[i+2]; if (r >= 170 && gg <= 160 && b >= 50 && b <= 190 && r - gg >= 50) red++; }
    return { ind: g.hudIndicators().length, red };
  })()`);
  await cdp.evaluate(`(() => { const g = globalThis.KIVILCIM_GAME; g.invokeCommand('killAll'); g.invokeCommand('spawnWave', [6]); g.render(); return true; })()`);
  await cdp.send('Page.bringToFront');
  await cdp.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 150))))');
  let png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  const statsOf = async (b64) => cdp.evaluate(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let nonBg = 0, red = 0;
      for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i+1], b = d[i+2];
        if (r > 20 || g > 20 || b > 30) nonBg++;
        if (r >= 170 && g <= 160 && b >= 50 && b <= 190 && r - g >= 50) red++; }
      resolve({ w: c.width, h: c.height, nonBg, red });
    };
    img.onerror = () => reject(new Error('png'));
    img.src = 'data:image/png;base64,${b64}';
  })`);
  let st = await statsOf(png.toString('base64'));
  if (st.nonBg < 5000) {
    await cdp.evaluate('(() => { globalThis.KIVILCIM_GAME.render(); return true; })()');
    await cdp.evaluate('new Promise(r => setTimeout(r, 250))');
    png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    st = await statsOf(png.toString('base64'));
  }
  writeFileSync(path.join(root, 'out/demo-final/u1-canli-390x844.png'), png);
  out.shot = { bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), stats: st };
} finally {
  cdp.close(); chrome.stop();
}
const gates = [
  { gate: 'canlı: A gösterge >= 1', ok: out.A.inds.length >= 1, detail: JSON.stringify(out.A.inds) },
  { gate: 'canlı: A toplanan = 6', ok: out.A.inds.reduce((s, i) => s + i.count, 0) === 6, detail: String(out.A.inds.reduce((s, i) => s + i.count, 0)) },
  { gate: 'canlı: A şerit kırmızı > 0', ok: out.A.red > 0, detail: String(out.A.red) },
  { gate: 'canlı: B gösterge 0 ve şerit kırmızı 0', ok: out.B.ind === 0 && out.B.red === 0, detail: `${out.B.ind}/${out.B.red}` },
  { gate: 'canlı: ekran görüntüsü >= 10KB', ok: out.shot.bytes >= 10240, detail: `${out.shot.bytes}` },
];
out.gates = gates;
out.ok = gates.every((g) => g.ok);
writeFileSync(path.join(root, 'out/demo-final/u1-canli.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
