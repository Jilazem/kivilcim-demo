#!/usr/bin/env node
/**
 * KIVILCIM CLI — bağımlılık yok.
 *
 *   node cli/kivilcim.mjs doctor
 *   node cli/kivilcim.mjs run scenarios/demo-smoke.json --out out/smoke
 *   node cli/kivilcim.mjs inspect [demo/index.html | dist/demo__index.html] --out out/inspect.json
 *   node cli/kivilcim.mjs record --steps 600 --out out/replay.json
 *   node cli/kivilcim.mjs build-check --write out/build [--file demo/index.html]
 *
 * Çıkış kodları: 0 başarı, 1 kabul ölçütü düştü, 2 araç/ortam hatası.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CDP, findChrome, launchChrome } from './cdp.mjs';
import { resolvePagePath } from './page-path.mjs';
import { buildProduction } from '../tools/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function fail(msg, code = 2) {
  console.error(`HATA: ${msg}`);
  process.exit(code);
}

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

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function startStatic(dir) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
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

/* Üretim paketinde dev köprüsü yoktur (build-check bölgeyi çıkarır). Sayfanın
 * bıraktığı KIVILCIM_GAME tutamağından CLI kendi köprüsünü kurar; böylece
 * inspect/run üretim HTML'ini de sınar. Tutamak yoksa dev köprüsü beklenir. */
const TOOLING_BRIDGE = `(() => {
  if (globalThis.__KIVILCIM_DEV__ && globalThis.__KIVILCIM_DEV__.ready) return true;
  const g = globalThis.KIVILCIM_GAME;
  if (!g) return false;
  const loadScenario = async () => {
    const base = document.baseURI;
    for (const spec of ['scenario.mjs', '../scenario.mjs']) {
      try { return await import(new URL(spec, base).href); } catch (err) { /* sıradaki yol */ }
    }
    throw new Error('scenario.mjs yüklenemedi');
  };
  globalThis.__KIVILCIM_DEV__ = {
    game: g,
    ready: true,
    params: () => g.params.describe(),
    snapshot: () => g.inspect.snapshot(),
    hash: () => g.hash(),
    step: (n) => g.step(n),
    capture: (name) => g.capture(name),
    command: (name, args) => g.invokeCommand(name, args || []),
    runScenario: async (scenario) => (await loadScenario()).runScenario(g, scenario),
    record: (opts = {}) => {
      g.stop();
      g.reset();
      g.startRecording();
      const steps = Math.max(1, Math.floor(opts.steps || 600));
      for (let i = 0; i < steps; i++) {
        if (i % 90 === 0) g.input.inject({ code: 'ArrowRight', down: true });
        if (i % 90 === 45) g.input.inject({ code: 'ArrowRight', down: false });
        if (i % 30 === 0) g.input.inject({ code: 'Space', down: true });
        if (i % 30 === 5) g.input.inject({ code: 'Space', down: false });
        g.step(1);
      }
      const rec = g.stopRecording();
      rec.replayHash = g.replay(rec);
      return rec;
    },
  };
  return true;
})()`;

async function withPage(fn, { pagePath = '/demo/index.html', query = '?dev=1&headless=1' } = {}) {
  const server = await startStatic(root);
  const chromePort = await freePort();
  const chrome = await launchChrome({ port: chromePort });
  const cdp = await CDP.connect(chrome.wsUrl);
  try {
    await cdp.attachTo(`http://127.0.0.1:${server.port}${pagePath}${query}`);
    // köprü hazır mı? önce sayfanın dev köprüsü, yoksa üretim tutamağından CLI köprüsü
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        ready = await cdp.evaluate('!!(globalThis.__KIVILCIM_DEV__ && globalThis.__KIVILCIM_DEV__.ready)');
        if (!ready) ready = await cdp.evaluate(TOOLING_BRIDGE);
      } catch (err) { /* sayfa yükleniyor */ }
      if (!ready) await new Promise((r) => setTimeout(r, 150));
    }
    if (!ready) {
      const err = await cdp.evaluate('String(globalThis.__KIVILCIM_BOOT_ERROR__ || "dev köprüsü kurulmadı")').catch(() => 'okunamadı');
      throw new Error(`Sayfa hazır değil (${pagePath}): ${err}`);
    }
    return await fn({ cdp });
  } finally {
    cdp.close();
    chrome.stop();
    server.srv.close();
  }
}

function ensureDir(dir) { mkdirSync(dir, { recursive: true }); return dir; }
function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

/* ------------------------------------------------------------- komutlar */

async function cmdDoctor(args) {
  const chrome = findChrome();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const report = {
    ok: Boolean(chrome) && nodeMajor >= 22,
    node: process.versions.node,
    nodeOk: nodeMajor >= 22,
    webSocket: typeof WebSocket === 'function',
    chrome: chrome || null,
    chromeEnv: process.env.KIVILCIM_CHROME || null,
    platform: process.platform,
    cwd: root,
  };
  console.log(JSON.stringify(report, null, 2));
  if (args.out) {
    ensureDir(path.dirname(path.resolve(args.out)));
    writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2));
  }
  process.exit(report.ok ? 0 : 1);
}

async function cmdRun(args) {
  const scenarioPath = args._[1] || args.scenario;
  if (!scenarioPath) fail('kullanım: run <senaryo.json> [sayfa.html | --file <sayfa.html>] --out <dizin>');
  const page = resolvePagePath(args.file || args._[2], { root });
  if (!page.ok) fail(page.error);
  const abs = path.resolve(scenarioPath);
  const scenario = JSON.parse(readFileSync(abs, 'utf8'));
  const outDir = ensureDir(path.resolve(args.out || path.join(root, 'out', `run-${Date.now()}`)));

  const result = await withPage(async ({ cdp }) => {
    const expr = `(() => {
      const d = globalThis.__KIVILCIM_DEV__;
      d.game.stop();
      return d.runScenario(${JSON.stringify(scenario)});
    })()`;
    return cdp.evaluate(expr);
  }, { pagePath: page.pagePath });

  const gates = [];
  const captures = [];
  for (const cap of result.captures || []) {
    const b64 = String(cap.dataUrl || '').split(',')[1] || '';
    const buf = Buffer.from(b64, 'base64');
    const file = path.join(outDir, `${String(cap.name).replace(/[^\w.-]+/g, '_')}.png`);
    writeFileSync(file, buf);
    const entry = {
      name: cap.name,
      step: cap.step,
      file,
      bytes: buf.length,
      sha256: sha256(buf),
      unique: cap.unique,
      nonuniform: cap.nonuniform,
      gte10k: buf.length >= 10000,
      drawn: cap.nonuniform === true,
    };
    captures.push(entry);
    if (!entry.gte10k) gates.push(`${cap.name}: PNG ${buf.length} bayt < 10000 (boş/tek renk olabilir)`);
    if (!entry.drawn) gates.push(`${cap.name}: nonuniform=false (gerçek çizim yok)`);
  }
  if ((result.captures || []).length === 0) gates.push('hiç capture yok');
  if (!result.ok) gates.push(`senaryo başarısız: ${(result.failures || []).length} ihlal`);

  const report = {
    ok: gates.length === 0,
    scenario: result.scenario,
    steps: result.steps,
    stepsRun: result.stepsRun,
    stateHash: result.stateHash,
    flashes: result.flashes,
    contrast: result.contrast,
    failures: result.failures,
    gates,
    captures,
    snapshot: result.snapshot,
  };
  writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

async function cmdInspect(args) {
  const out = path.resolve(args.out || path.join(root, 'out', 'inspect.json'));
  const page = resolvePagePath(args._[1] || args.file, { root });
  if (!page.ok) fail(page.error);
  const snap = await withPage(async ({ cdp }) => cdp.evaluate('(() => { const d = globalThis.__KIVILCIM_DEV__; d.game.stop(); d.game.step(30); return d.game.inspect.snapshot(); })()'), { pagePath: page.pagePath });
  ensureDir(path.dirname(out));
  writeFileSync(out, JSON.stringify(snap, null, 2));
  console.log(JSON.stringify({ ok: true, page: page.pagePath, out, scene: snap.scene, tick: snap.tick, keys: Object.keys(snap.state || {}) }, null, 2));
  process.exit(0);
}

async function cmdRecord(args) {
  const out = path.resolve(args.out || path.join(root, 'out', 'replay.json'));
  const steps = Math.max(1, Number(args.steps) || 600);
  const rec = await withPage(async ({ cdp }) => cdp.evaluate(`(() => { const d = globalThis.__KIVILCIM_DEV__; return d.record({ steps: ${steps} }); })()`));
  const ok = rec.stateHash === rec.replayHash && rec.inputs.length > 0;
  ensureDir(path.dirname(out));
  writeFileSync(out, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify({
    ok,
    out,
    steps: rec.steps,
    inputs: rec.inputs.length,
    stateHash: rec.stateHash,
    replayHash: rec.replayHash,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

async function cmdBuildCheck(args) {
  if (args.write === true) fail('kullanım: build-check --write <dizin> [--file <html>]');
  if (args.file === true) fail('kullanım: build-check --file <html>');
  const writeDir = args.write ? path.resolve(String(args.write)) : null;
  const report = buildProduction({ root, write: writeDir, file: args.file || args._[1] || null });
  if (args.out) {
    ensureDir(path.dirname(path.resolve(args.out)));
    writeFileSync(path.resolve(args.out), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0] || 'help';

try {
  if (cmd === 'doctor') await cmdDoctor(args);
  else if (cmd === 'run') await cmdRun(args);
  else if (cmd === 'inspect') await cmdInspect(args);
  else if (cmd === 'record') await cmdRecord(args);
  else if (cmd === 'build-check') await cmdBuildCheck(args);
  else {
    console.log('komutlar: doctor | run <senaryo.json> [sayfa.html | --file <sayfa.html>] --out <dizin> | inspect [sayfa.html | --file <sayfa.html>] --out <json> | record --steps N --out <json> | build-check --write <dizin> [--file <html>]');
    process.exit(0);
  }
} catch (err) {
  fail(err && err.stack ? err.stack : String(err));
}
