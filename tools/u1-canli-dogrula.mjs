/** Yayınlanan sayfayı (GitHub Pages) canlı sınar: gösterge var/yok + piksel kanıtı.
 *  Ölçüm bölgesi HUD güvenli alanıdır (üst bandın altı, alt şeridin üstü) — göstergeler oraya kırpılır. */
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

/** Sayfa içinde güvenli alandaki kırmızı gösterge piksellerini sayar. */
const SAFE_RED = `(() => {
  const g = globalThis.KIVILCIM_GAME;
  const vis = g.visibleWorld(); const sx = g.pixelScale || 1;
  const x = Math.max(0, Math.floor(vis.x * sx));
  const y = Math.max(0, Math.floor((vis.y + 112) * sx));
  const w = Math.min(g.canvas.width - x, Math.ceil(vis.w * sx));
  const h = Math.max(0, Math.min(g.canvas.height - y, Math.ceil((vis.h - 112 - 40) * sx)));
  const d = g.ctx.getImageData(x, y, w, h).data;
  let red = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], gg = d[i+1], b = d[i+2]; if (r >= 170 && gg <= 160 && b >= 50 && b <= 190 && r - gg >= 50) red++; }
  return red;
})()`;

const WARM = `new Promise((resolve) => {
  const g = globalThis.KIVILCIM_GAME;
  g.stop();
  let n = 0;
  const loop = () => { g.render(); n++; if (n < 12) requestAnimationFrame(loop); else setTimeout(resolve, 150); };
  requestAnimationFrame(loop);
})`;

const statsOf = (b64) => `new Promise((resolve, reject) => {
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
})`;

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
    const safeOk = inds.every(i => i.y >= vis.y + 112 - 0.01 && i.y <= vis.y + vis.h - 40 + 0.01);
    return { fit: g.fitInfo, vis, inds: inds.map(i => ({ x: i.x, y: i.y, count: i.count })), safeOk, red: ${SAFE_RED} };
  })()`);
  out.B = await cdp.evaluate(`(() => {
    const g = globalThis.KIVILCIM_GAME;
    g.invokeCommand('killAll'); g.render();
    return { ind: g.hudIndicators().length, red: ${SAFE_RED} };
  })()`);

  await cdp.evaluate(`(() => { const g = globalThis.KIVILCIM_GAME; g.invokeCommand('killAll'); g.invokeCommand('spawnWave', [6]); g.render(); return true; })()`);
  await cdp.send('Page.bringToFront');
  await cdp.evaluate(WARM);
  let png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
  let st = await cdp.evaluate(statsOf(png.toString('base64')));
  for (let i = 0; i < 2 && (st.nonBg < 5000 || st.red === 0); i++) {
    await cdp.evaluate(WARM);
    png = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
    st = await cdp.evaluate(statsOf(png.toString('base64')));
  }
  writeFileSync(path.join(root, 'out/demo-final/u1-canli-390x844.png'), png);
  out.shot = { bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), stats: st };
} finally {
  cdp.close(); chrome.stop();
}

const gates = [
  { gate: 'canlı: A gösterge >= 1', ok: out.A.inds.length >= 1, detail: JSON.stringify(out.A.inds) },
  { gate: 'canlı: A toplanan = 6', ok: out.A.inds.reduce((s, i) => s + i.count, 0) === 6, detail: String(out.A.inds.reduce((s, i) => s + i.count, 0)) },
  { gate: 'canlı: A göstergeler HUD güvenli alanında', ok: out.A.safeOk === true, detail: `safeOk=${out.A.safeOk}` },
  { gate: 'canlı: A güvenli alanda kırmızı > 0', ok: out.A.red > 0, detail: String(out.A.red) },
  { gate: 'canlı: B gösterge 0 ve kırmızı 0', ok: out.B.ind === 0 && out.B.red === 0, detail: `${out.B.ind}/${out.B.red}` },
  { gate: 'canlı: ekran görüntüsünde gösterge kırmızısı > 0', ok: out.shot.stats.red > 0, detail: JSON.stringify(out.shot.stats) },
  { gate: 'canlı: ekran görüntüsü >= 10KB', ok: out.shot.bytes >= 10240, detail: `${out.shot.bytes}` },
];
out.gates = gates;
out.ok = gates.every((g) => g.ok);
writeFileSync(path.join(root, 'out/demo-final/u1-canli.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, A: out.A.inds, safeOk: out.A.safeOk, redA: out.A.red, B: out.B, shot: out.shot, failed: gates.filter(g => !g.ok) }, null, 2));
process.exit(out.ok ? 0 : 1);
