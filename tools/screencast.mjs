#!/usr/bin/env node
/**
 * screencast.mjs — gerçek zamanlı CDP ekran kaydı (Page.startScreencast) + gerçek girdi.
 *
 * Uydurma kare yoktur: kareler Chrome'un compositor'ından Page.screencastFrame ile gelir,
 * girdi gerçek DOM olayıdır (masaüstü: Input.dispatchKeyEvent, mobil: Input.dispatchTouchEvent).
 * Dalga çağrıları sayfanın kendi komut hattına gider (__KIVILCIM_DEV__.command).
 *
 * Kullanım:
 *   node tools/screencast.mjs --mode desktop --width 1280 --height 720 --seconds 18 \
 *        --out out/demo-final/masaustu-oynanis.mp4 --title "KIVILCIM · gerçek zamanlı oynanış"
 *   node tools/screencast.mjs --mode mobile --width 390 --height 844 --dpr 3 --seconds 6 \
 *        --out out/demo-final/mobil-dokunmatik.mp4 --title "KIVILCIM · mobil dokunmatik"
 *
 * Çıkış: mp4 (H.264, CFR 30) + <out>.report.json (kare sayısı, süre, ffprobe, konsol hataları).
 * Çıkış kodları: 0 başarı, 1 kabul ölçütü düştü, 2 araç/ortam hatası.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CDP, findChrome, launchChrome } from '../cli/cdp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FORMAT = 'png';
const DEFAULT_QUALITY = 80;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const FONTS = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Verdana.ttf',
];

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

function startStatic(dir) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const rel = urlPath === '/' ? '/demo/index.html' : urlPath;
        const file = path.resolve(dir, '.' + rel);
        if (!file.startsWith(dir + path.sep)) { res.writeHead(403); res.end('403'); return; }
        const body = readFileSync(file);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ffmpegPath() {
  for (const p of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) {
    if (existsSync(p)) return p;
  }
  return null;
}

function ffprobePath() {
  for (const p of ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe']) {
    if (existsSync(p)) return p;
  }
  return null;
}

/* Gerçek girdi planı — zamana yayılmış, sayfa içi timer değil Node tarafından sürülür. */
function buildSchedule({ seconds, mode }) {
  const plan = [];
  const move = (t, key, down) => plan.push({ t, kind: 'key', key, down });
  const wave = (t, n) => plan.push({ t, kind: 'wave', n });
  const touch = (t, x, y, phase) => plan.push({ t, kind: 'touch', x, y, phase });

  if (mode === 'mobile') {
    // 6 sn: dokunma ile sağa/sola git, dokunuşla ateş, dalga çağır.
    touch(0.3, 330, 700, 'start'); touch(1.1, 330, 700, 'end');
    wave(1.2, 3);
    touch(1.4, 60, 700, 'start'); touch(2.4, 60, 700, 'move'); touch(3.0, 60, 700, 'end');
    touch(3.1, 330, 700, 'start'); touch(3.9, 330, 700, 'end');
    wave(4.0, 3);
    touch(4.2, 200, 700, 'start'); touch(4.9, 200, 700, 'end');
    touch(5.1, 330, 700, 'start'); touch(5.7, 330, 700, 'end');
    return plan;
  }

  // 18 sn masaüstü: klavye ile hareket, boşluk ile ateş, aralarda dalga.
  const moves = [
    [0.6, 'ArrowRight'], [2.2, 'ArrowLeft'], [4.0, 'ArrowRight'], [6.4, 'ArrowLeft'],
    [8.6, 'ArrowRight'], [11.0, 'ArrowLeft'], [13.6, 'ArrowRight'], [16.0, 'ArrowLeft'],
  ];
  for (const [t, key] of moves) { move(t, key, true); move(t + 1.1, key, false); }
  for (let t = 1.0; t < seconds - 0.6; t += 0.42) move(t, 'Space', true), move(t + 0.09, 'Space', false);
  for (const t of [1.4, 4.6, 8.2, 11.8, 15.2]) wave(t, 4);
  return plan.sort((a, b) => a.t - b.t);
}

async function runKey(cdp, key, down) {
  const table = {
    ArrowLeft: { code: 'ArrowLeft', vk: 37 },
    ArrowRight: { code: 'ArrowRight', vk: 39 },
    Space: { code: 'Space', vk: 32 },
  };
  const m = table[key];
  const ev = {
    type: down ? 'keyDown' : 'keyUp',
    key: key === 'Space' ? ' ' : key,
    code: m.code,
    windowsVirtualKeyCode: m.vk,
    nativeVirtualKeyCode: m.vk,
  };
  // Chrome bu sürümde text alanı olmayan keyDown'da renderer kare üretimini durduruyor
  // (ölçüldü: 3 sn'de tick 11). Gerçek CDP girdisi korunur; yalnız text/unmodifiedText eklenir.
  if (down) { ev.text = key === 'Space' ? ' ' : '\uE000'; ev.unmodifiedText = ev.text; }
  await cdp.send('Input.dispatchKeyEvent', ev);
}

async function runTouch(cdp, x, y, phase) {
  const point = { x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 };
  if (phase === 'start') await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  else if (phase === 'move') await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  else await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = String(args.mode || 'desktop');
  const mobile = mode === 'mobile';
  const width = Number(args.width || (mobile ? 390 : 1280));
  const height = Number(args.height || (mobile ? 844 : 720));
  const dpr = Number(args.dpr || (mobile ? 3 : 1));
  const seconds = Number(args.seconds || (mobile ? 6 : 18));
  const fps = Number(args.fps || 30);
  const seed = String(args.seed || '260110');
  const title = args.title ? String(args.title) : '';
  const outFile = path.resolve(root, String(args.out || (mobile ? 'out/demo-final/mobil-dokunmatik.mp4' : 'out/demo-final/masaustu-oynanis.mp4')));
  const framesDir = path.resolve(root, String(args.framesDir || path.join(path.dirname(outFile), 'kareler-' + mode)));
  const fmt = String(args.format || DEFAULT_FORMAT) === 'jpeg' ? 'jpeg' : 'png';
  const frameExt = fmt === 'png' ? 'png' : 'jpg';
  const quality = Number(args.quality || DEFAULT_QUALITY);

  if (!(width > 0 && height > 0 && seconds > 0 && fps > 0)) {
    console.error('screencast: geçersiz --width/--height/--seconds/--fps');
    process.exit(2);
  }
  const chrome = findChrome();
  if (!chrome) { console.error('screencast: Chrome bulunamadı (KIVILCIM_CHROME ile yol ver)'); process.exit(2); }
  const ffmpeg = ffmpegPath();
  const ffprobe = ffprobePath();
  if (!ffmpeg) { console.error('screencast: ffmpeg bulunamadı'); process.exit(2); }

  mkdirSync(path.dirname(outFile), { recursive: true });
  mkdirSync(framesDir, { recursive: true });
  for (const f of readDirSafe(framesDir)) rmSync(path.join(framesDir, f), { force: true });

  const server = await startStatic(root);
  const browser = await launchChrome({
    chromePath: chrome,
    port: 0 + (9000 + Math.floor(Math.random() * 900)),
    headless: true,
    extraArgs: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--force-color-profile=srgb',
      '--disable-features=CalculateNativeWinOcclusion',
      '--hide-scrollbars',
      ...(process.env.KIVILCIM_CHROME_ARGS || '').split(/\s+/).filter(Boolean),
    ],
  });

  const errors = [];
  let cdp;
  let frameCount = 0;
  let report;
  try {
    cdp = await CDP.connect(browser.wsUrl);
    const { targetId, sessionId } = await cdp.send('Target.createTarget', { url: 'about:blank' }).then(async (r) => {
      const att = await cdp.send('Target.attachToTarget', { targetId: r.targetId, flatten: true });
      return { targetId: r.targetId, sessionId: att.sessionId };
    });
    cdp.sessionId = sessionId;

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Log.enable');

    // Viewport + DPR: kayıt gerçek cihaz ölçüsünü taşır (masaüstü 1280x720, mobil 390x844 @3).
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: dpr, mobile,
      screenWidth: width, screenHeight: height,
      ...(mobile ? { screenOrientation: { type: 'portraitPrimary', angle: 0 } } : {}),
    });
    if (mobile) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const bufferW = Math.round(width * dpr);
    const bufferH = Math.round(height * dpr);
    await cdp.send('Page.startScreencast', {
      format: fmt, quality, everyNthFrame: 1, maxWidth: bufferW, maxHeight: bufferH,
    });

    // Kareler: Page.screencastFrame olayı → PNG diske, metadata zaman damgası kayda.
    const frameTimes = [];
    cdp.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (err) { return; }
      if (msg.method === 'Page.screencastFrame' && msg.params && msg.sessionId === sessionId) {
        const p = msg.params;
        const idx = frameCount++;
        try {
          writeFileSync(path.join(framesDir, `kare_${String(idx).padStart(6, '0')}.${frameExt}`), Buffer.from(p.data, 'base64'));
          frameTimes.push({ i: idx, t: Number(p.metadata && p.metadata.timestamp) || 0 });
        } catch (err) { errors.push(`kare yazılamadı ${idx}: ${err.message}`); }
        cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      } else if (msg.method === 'Runtime.exceptionThrown' && msg.sessionId === sessionId) {
        const d = msg.params.exceptionDetails || {};
        errors.push(`exception: ${(d.exception && d.exception.description) || d.text}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.sessionId === sessionId && msg.params.type === 'error') {
        errors.push(`console.error: ${(msg.params.args || []).map((a) => a.value || a.description || '').join(' ')}`);
      } else if (msg.method === 'Log.entryAdded' && msg.sessionId === sessionId && msg.params.entry.level === 'error') {
        errors.push(`log: ${msg.params.entry.text}`);
      }
    });

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.port}/demo/index.html?dev=1&fs=1&seed=${encodeURIComponent(seed)}` });

    // Hazır olana kadar bekle: dev köprüsü + oyun nesnesi.
    const readyDeadline = Date.now() + 25000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      ready = await cdp.evaluate('Boolean(globalThis.__KIVILCIM_DEV__ && globalThis.__KIVILCIM_DEV__.ready && globalThis.KIVILCIM_GAME)').catch(() => false);
      if (ready) break;
      await sleep(150);
    }
    if (!ready) throw new Error('sayfa hazır olmadı (__KIVILCIM_DEV__.ready yok) — konsol hatası olabilir');

    const fit = await cdp.evaluate('(() => { const f = globalThis.__KIVILCIM_DEV__.game.fitInfo || null; const c = globalThis.KIVILCIM_GAME.canvas; const r = c.getBoundingClientRect(); return { fit: f, rect: { w: r.width, h: r.height, x: r.x, y: r.y }, dpr: window.devicePixelRatio, inner: [innerWidth, innerHeight] }; })()');
    const rectOk = fit.rect.w >= width - 1 && fit.rect.h >= height - 1;

    // Gerçek girdi planı.
    const schedule = buildSchedule({ seconds, mode });
    const t0 = Date.now();
    let si = 0;
    let lastHp = null;
    const timeline = [];
    let touchDispatched = 0;
    let lastSample = -1;
    const readState = `(() => { const s = globalThis.__KIVILCIM_DEV__.snapshot() || {}; const st = s.state || {}; const pl = st.player || {}; return { tick: s.tick || 0, gameOver: Boolean(st.gameOver), hp: pl.hp === undefined ? null : pl.hp, score: st.score || 0, wave: st.wave || 0, enemies: Array.isArray(st.enemies) ? st.enemies.length : (st.enemies || 0), x: pl.x === undefined ? null : Math.round(pl.x) }; })()`;
    while (true) {
      const el = (Date.now() - t0) / 1000;
      if (el >= seconds) break;
      while (si < schedule.length && schedule[si].t <= el) {
        const a = schedule[si++];
        if (a.kind === 'key') await runKey(cdp, a.key, a.down);
        else if (a.kind === 'touch') { await runTouch(cdp, a.x, a.y, a.phase); touchDispatched++; }
        else if (a.kind === 'wave') {
          await cdp.evaluate(`globalThis.__KIVILCIM_DEV__.command('spawnWave',[${a.n}])`).catch((err) => errors.push(`spawnWave: ${err.message}`));
        }
      }
      // Ölürse koşuyu yeniden başlat: kayıt kesintisiz oynanış gösterir.
      const st = await cdp.evaluate(readState).catch(() => null);
      if (st && st.gameOver) {
        await cdp.evaluate('globalThis.__KIVILCIM_DEV__.command(\'resetRun\',[])').catch(() => {});
      }
      if (st) {
        lastHp = st;
        if (el - lastSample >= 0.5) { lastSample = el; timeline.push({ t: Number(el.toFixed(2)), ...st }); }
      }
      await sleep(100);
    }
    const state = await cdp.evaluate(readState);

    await cdp.send('Page.stopScreencast');

    // Kare → video: gerçek zaman damgalarından süre listesi (CFR 30'a ffmpeg çevirir).
    const times = frameTimes.filter((f) => existsSync(path.join(framesDir, `kare_${String(f.i).padStart(6, '0')}.${frameExt}`)));
    if (times.length < Math.max(10, seconds * fps * 0.4)) {
      throw new Error(`yetersiz kare: ${times.length} (beklenen ~${Math.round(seconds * fps)}) — screencast kare üretmedi; hata: ${errors.slice(0,3).join(' | ') || 'yok'}; zaman aralığı ${(times[0] && times[0].t) || 0}..${(times[times.length - 1] && times[times.length - 1].t) || 0}`);
    }
    const base = times[0].t || 0;
    const concat = [];
    for (let i = 0; i < times.length; i++) {
      const start = (times[i].t || 0) - base;
      const next = i + 1 < times.length ? (times[i + 1].t || 0) - base : start + 1 / fps;
      const dur = Math.max(1 / (fps * 2), Math.min(0.5, next - start));
      concat.push(`file '${path.join(framesDir, `kare_${String(times[i].i).padStart(6, '0')}.${frameExt}`)}'`);
      concat.push(`duration ${dur.toFixed(4)}`);
    }
    const lastPath = path.join(framesDir, `kare_${String(times[times.length - 1].i).padStart(6, '0')}.${frameExt}`);
    concat.push(`file '${lastPath}'`);
    concat.push(`duration ${(1 / fps).toFixed(4)}`);
    const listFile = path.join(framesDir, 'liste.txt');
    writeFileSync(listFile, concat.join('\n') + '\n');

    const font = FONTS.find((f) => existsSync(f)) || null;
    let vf = `fps=${fps},scale=${width}:${height}:flags=lanczos,format=yuv420p`;
    let textFile = null;
    if (title) {
      textFile = path.join(framesDir, 'baslik.txt');
      writeFileSync(textFile, title + '\n');
      if (font) {
        vf += `,drawtext=fontfile=${font}:textfile=${textFile}:fontcolor=white:fontsize=${mobile ? 16 : 22}:box=1:boxcolor=black@0.55:boxborderw=${mobile ? 8 : 12}:x=(w-text_w)/2:y=h-text_h-${mobile ? 28 : 18}`;
      } else {
        errors.push('drawtext: sistem fontu bulunamadı, başlık yazılmadı');
      }
    }

    const enc = spawnSync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', listFile,
      '-vf', vf, '-fps_mode', 'cfr',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-an',
      outFile,
    ], { encoding: 'utf8' });
    if (enc.status !== 0) throw new Error(`ffmpeg hatası (${enc.status}): ${(enc.stderr || '').trim().slice(0, 500)}`);

    // Bağımsız doğrulama: ffprobe gerçek çıktıyı okur.
    let probe = null;
    if (ffprobe) {
      const pr = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', outFile], { encoding: 'utf8' });
      if (pr.status === 0) probe = JSON.parse(pr.stdout);
    }
    const v = probe && probe.streams ? probe.streams.find((s) => s.codec_type === 'video') : null;
    const duration = probe && probe.format ? Number(probe.format.duration) : null;
    const xs = timeline.map((s) => s.x).filter((x) => typeof x === 'number');
    const xSpan = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    const touchEvidence = { touchDispatched, xSpan, timeline: timeline.length };
    if (mobile && (touchDispatched === 0 || xSpan < 5)) {
      errors.push(`touch oynanışı kanıtlanmadı (olay=${touchDispatched}, x sapması=${xSpan}px)`);
    }
    const ok = Boolean(v && v.width === width && v.height === height && Math.abs((duration || 0) - seconds) <= 2 && rectOk && errors.filter((e) => !/fontu bulunamadı/.test(e)).length === 0);

    // Kontrol kareleri: kaydın başından/ortasından/sonundan.
    const checkFrames = [];
    for (const frac of [0.08, 0.5, 0.92]) {
      const p = path.join(path.dirname(outFile), `${mode}-kontrol-${Math.round(frac * 100)}.png`);
      const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String((duration || seconds) * frac), '-i', outFile, '-frames:v', '1', p], { encoding: 'utf8' });
      if (r.status === 0 && existsSync(p)) checkFrames.push(p);
    }

    report = {
      ok,
      mode,
      out: outFile,
      framesDir,
      frames: times.length,
      seconds,
      requested: { width, height, dpr, fps, seconds, touch: mobile },
      viewport: { rect: fit.rect, inner: fit.inner, dpr: fit.dpr, rectOk },
      fitInfo: fit.fit,
      video: v ? { width: v.width, height: v.height, codec: v.codec_name, fps: v.r_frame_rate, duration, frames: Number(v.nb_frames) || null, sizeBytes: probe.format.size } : null,
      checkFrames,
      finalState: state,
      lastHp,
      touchEvidence,
      timeline,
      consoleErrors: errors,
      chrome: { path: chrome, version: browser.version && browser.version.Browser },
    };
  } finally {
    try { if (cdp) cdp.close(); } catch (err) { /* yut */ }
    try { browser.stop(); } catch (err) { /* yut */ }
    try { server.srv.close(); } catch (err) { /* yut */ }
  }

  const reportPath = outFile.replace(/\.mp4$/i, '') + '.report.json';
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ok: report.ok, out: report.out, report: reportPath, frames: report.frames, video: report.video, errors: report.consoleErrors }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

function readDirSafe(dir) {
  try { return readdirSync(dir); } catch (err) { return []; }
}

main().catch((err) => {
  console.error('screencast: ' + (err && err.message ? err.message : err));
  process.exit(2);
});
