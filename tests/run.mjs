/**
 * KIVILCIM mantık testleri — sıfır bağımlılık, stub canvas (tarayıcı gerekmez).
 * Çalıştır: node tests/run.mjs
 * Çıkış: PASS n/n ve exit 0; herhangi bir başarısızlıkta exit 1.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Game, RNG, Storage, devEnabled, KivilcimError, stateHash, makeStubCanvas } from '../kivilcim.mjs';
import { runScenario, compare } from '../scenario.mjs';
import { attach } from '../attach.mjs';
import { buildProduction } from '../tools/build.mjs';
import { createDemoGame } from '../demo/game.mjs';
import { resolvePagePath } from '../cli/page-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err && err.stack ? err.stack : String(err) });
    console.log(`FAIL ${name}: ${err && err.message ? err.message : err}`);
  }
}
function eq(a, b, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} beklenen ${JSON.stringify(b)}, gerçek ${JSON.stringify(a)}`);
}
function throwsWith(code, fn) {
  try { fn(); } catch (err) {
    if (!(err instanceof KivilcimError)) throw new Error(`KivilcimError bekleniyordu, gelen ${err && err.name}: ${err && err.message}`);
    if (err.code !== code) throw new Error(`kod ${code} bekleniyordu, gelen ${err.code} (${err.message})`);
    return err;
  }
  throw new Error(`hata atılmadı; kod ${code} bekleniyordu`);
}

function makeSim(seed = 7) {
  const game = new Game({ width: 320, height: 180, seed, step: 1 / 60 });
  const st = { x: 0, shots: 0, hits: 0 };
  game.params.define('sim', {
    speed: { type: 'number', min: 0, max: 500, default: 120, unit: 'px/s' },
    shots: { type: 'int', min: 0, max: 10, default: 2 },
    mode: { type: 'enum', options: ['a', 'b'], default: 'a' },
    active: { type: 'bool', default: true },
  });
  const scene = {
    id: 'sim',
    enter() { st.x = 0; st.shots = 0; st.hits = 0; },
    update(dt) {
      const s = game.params.get('sim.speed');
      st.x += game.input.axis('right') * s * dt;
      if (game.input.justPressed('Space')) { st.shots++; game.emit('shot'); }
      if (st.x > 100 && st.hits === 0) { st.hits = 1; game.emit('crossed'); }
      if (game.random.next() > 0.9) game.emit('tick');
    },
    render() {},
    inspect() { return { player: { x: Number(st.x.toFixed(6)) }, shots: st.shots, hits: st.hits }; },
  };
  game.addScene(scene);
  game.inspect.register('state', () => scene.inspect());
  game.command('addShots', (n) => { st.shots += Number(n) || 0; return st.shots; });
  game.go('sim');
  return game;
}

/* 1 — determinizm: aynı seed + aynı girdi → aynı hash */
test('determinizm: aynı seed ve girdi aynı hash üretir', () => {
  const a = makeSim(42);
  const b = makeSim(42);
  for (const g of [a, b]) {
    g.input.inject({ code: 'ArrowRight', down: true });
    g.step(30);
    g.input.inject({ code: 'Space', down: true });
    g.step(1);
    g.input.inject({ code: 'Space', down: false });
    g.step(60);
  }
  eq(a.hash(), b.hash(), 'hash');
  eq(a.inspect.snapshot().state, b.inspect.snapshot().state, 'state');
});

/* 2 — farklı seed farklı akış */
test('farklı seed farklı olay akışı üretir', () => {
  const a = makeSim(1);
  const b = makeSim(999);
  a.step(120); b.step(120);
  const ea = JSON.stringify(a.events);
  const eb = JSON.stringify(b.events);
  if (ea === eb) throw new Error('iki farklı seed aynı olay akışını verdi (RNG bağlı değil?)');
});

/* 3 — param aralık dışı throw (sessiz clamp yok) */
test('params.set aralık dışı değerde PARAM_RANGE atar', () => {
  const g = makeSim();
  const err = throwsWith('PARAM_RANGE', () => g.params.set('sim.speed', 900));
  if (!/aralık dışı/.test(err.message)) throw new Error('hata metni aralığı açıklamıyor');
  eq(g.params.get('sim.speed'), 120, 'reddedilen set değeri değiştirmemeli');
});

/* 4 — tip hataları */
test('params.set tip hatasında PARAM_TYPE atar', () => {
  const g = makeSim();
  throwsWith('PARAM_TYPE', () => g.params.set('sim.shots', 2.5));
  throwsWith('PARAM_TYPE', () => g.params.set('sim.active', 'evet'));
  throwsWith('PARAM_TYPE', () => g.params.set('sim.mode', 'c'));
  throwsWith('PARAM_UNKNOWN', () => g.params.set('sim.yok', 1));
});

/* 5 — describe() JSON ve onChange */
test('params.describe ve onChange çalışır', () => {
  const g = makeSim();
  const d = g.params.describe();
  eq(d.groups.sim.speed.type, 'number');
  eq(d.groups.sim.mode.options, ['a', 'b']);
  let seen = null;
  const off = g.params.onChange((ev) => { seen = ev; });
  g.params.set('sim.speed', 200);
  eq(seen.value, 200, 'onChange değeri');
  off();
  g.params.set('sim.speed', 300);
  eq(seen.value, 200, 'off sonrası dinleyici susmalı');
});

/* 6 — save şeması: eksik anahtar uyarı, bozuk kayıt null */
test('Storage şema denetimi ve bozuk kayıt davranışı', () => {
  const s = new Storage('t1');
  eq(s.save('run', { highScore: 10 }, { highScore: 'number', wave: 'number' }), true);
  const loaded = s.load('run', { highScore: 'number', wave: 'number' });
  eq(loaded.highScore, 10);
  if (!s.warnings.some((w) => w.code === 'STORAGE_SCHEMA')) throw new Error('eksik anahtar uyarısı yok');
  s._writeRaw('run', '{bozuk json');
  eq(s.load('run'), null, 'bozuk kayıt null dönmeli');
  if (!s.warnings.some((w) => w.code === 'STORAGE_CORRUPT')) throw new Error('bozuk kayıt uyarısı yok');
});

/* 7 — migrate + versiyon */
test('Storage migrate sürüm yükseltmesi', () => {
  const s = new Storage('t2', { version: 2, migrate: (d) => ({ ...d, value: { ...d.value, wave: d.value.wave || 1 } }) });
  s._writeRaw('run', JSON.stringify({ version: 1, value: { highScore: 5 } }));
  const v = s.load('run');
  eq(v.highScore, 5);
  eq(v.wave, 1, 'migrate alanı eklemeli');
});

/* 8 — Storage asla throw etmez */
test('Storage asla throw etmez', () => {
  const s = new Storage('t3');
  eq(s.load('yok'), null);
  eq(s.save('x', { a: 1 }), true);
  s.clear('x');
  eq(s.load('x'), null);
});

/* 9 — RNG deterministik + save/restore */
test('RNG save/restore aynı diziyi üretir', () => {
  const r = new RNG(123);
  const first = [r.next(), r.int(0, 9), r.pick(['a', 'b', 'c'])];
  const snap = r.save();
  const again = [r.next(), r.int(0, 9), r.pick(['a', 'b', 'c'])];
  r.restore(snap);
  const replay = [r.next(), r.int(0, 9), r.pick(['a', 'b', 'c'])];
  eq(replay, again, 'restore sonrası');
  eq(first.length, 3);
});

/* 10 — replay: kayıt yeniden oynatıldığında aynı hash */
test('replay kaydı aynı stateHash üretir', () => {
  const g = makeSim(5);
  g.startRecording();
  for (let i = 0; i < 120; i++) {
    if (i === 0) g.input.inject({ code: 'ArrowRight', down: true });
    if (i === 40) g.input.inject({ code: 'Space', down: true });
    if (i === 41) g.input.inject({ code: 'Space', down: false });
    if (i === 90) g.input.inject({ code: 'ArrowRight', down: false });
    g.step(1);
  }
  const rec = g.stopRecording();
  const h = g.replay(rec);
  eq(h, rec.stateHash, 'replay hash');
});

/* 11 — freeze / timeScale */
test('freeze simülasyonu durdurur, timeScale ölçekler', () => {
  const g = makeSim();
  g.input.inject({ code: 'ArrowRight', down: true });
  g.freeze(0.5);
  g.step(30);
  eq(g.inspect.snapshot().state.player.x, 0, 'freeze sırasında hareket olmamalı');
  g.timeScale = 0.5;
  g.step(60);
  const x = g.inspect.snapshot().state.player.x;
  if (!(x > 0 && x < 120)) throw new Error(`timeScale 0.5 ile x=${x} beklenen 0<x<120`);
});

/* 12 — dev sınırı */
test('dev bayrağı yalnız ?dev=1 veya global bayrakla açılır', () => {
  eq(devEnabled(''), false);
  eq(devEnabled('?foo=1'), false);
  eq(devEnabled('?dev=1'), true);
  eq(devEnabled('?a=1&dev=1&b=2'), true);
  eq(devEnabled('?dev=10'), false);
  const g = new Game({ width: 10, height: 10, search: '' });
  eq(g.dev, false);
  const g2 = new Game({ width: 10, height: 10, search: '?dev=1' });
  eq(g2.dev, true);
});

/* 13 — inspect snapshot şeması */
test('inspect.snapshot beklenen alanları içerir', () => {
  const g = makeSim();
  g.step(3);
  const s = g.inspect.snapshot();
  for (const k of ['scene', 'tick', 'params', 'state', 'events', 'stats']) {
    if (!(k in s)) throw new Error(`snapshot alanı eksik: ${k}`);
  }
  eq(s.scene, 'sim');
  eq(s.tick, 3);
});

/* 14 — hooks ve emit sayacı */
test('hooks ve emit sayacı çalışır', () => {
  const g = makeSim();
  let before = 0, after = 0;
  g.on('beforeUpdate', () => { before++; });
  g.on('afterUpdate', () => { after++; });
  g.step(5);
  eq(before, 5); eq(after, 5);
  g.emit('x', { a: 1 });
  g.emit('x');
  eq(g.events.x, 2);
  throwsWith('HOOK_NAME', () => g.on('yok', () => {}));
});

/* 15 — senaryo: temiz senaryo geçer */
test('senaryo motoru temiz senaryoyu geçirir', () => {
  const g = makeSim();
  const res = runScenario(g, {
    name: 'unit-pass',
    steps: [
      { wait: 10 },
      { press: 'ArrowRight' },
      { "wait": 40 },
      { "expect": { "state.player.x": { "gt": 50 }, "tick": { "gte": 51 } } },
      { "command": "addShots", "args": [3] },
      { "expect": { "state.shots": { "eq": 3 } } },
      { "set": { "sim.speed": 300 } },
      { "expect": { "params.sim.speed": { "eq": 300 } } },
      { "until": { "events.crossed": { "gte": 1 } }, "within": 120 },
      { "release": "ArrowRight" }
    ],
  });
  eq(res.ok, true, JSON.stringify(res.failures));
  eq(res.stepsRun > 0, true);
});

/* 16 — senaryo: bozuk fixture anlaşılır hata üretir */
test('bozuk fixture ok:false ve açıklayıcı hata döner', () => {
  const g = makeSim();
  const bad = JSON.parse(readFileSync(path.join(here, 'fixtures', 'bad.json'), 'utf8'));
  const res = runScenario(g, bad);
  eq(res.ok, false);
  if (res.failures.length === 0) throw new Error('başarısızlık kaydı yok');
  const f = res.failures[0];
  for (const k of ['step', 'path', 'expected', 'actual', 'hint', 'ne', 'nerede', 'ne_yapmali']) {
    if (!(k in f)) throw new Error(`hata alanı eksik: ${k}`);
  }
  if (!/adım 1/.test(f.nerede)) throw new Error(`hata konumu adımı belirtmiyor: ${f.nerede}`);
  if (!/99999/.test(f.ne)) throw new Error(`hata metni gerçek değeri belirtmiyor: ${f.ne}`);
});

/* 17 — karşılaştırıcılar */
test('karşılaştırıcılar doğru çalışır', () => {
  eq(compare(5, { gt: 4 }).ok, true);
  eq(compare(5, { lt: 4 }).ok, false);
  eq(compare(5, { eq: 5 }).ok, true);
  eq(compare(5.0000001, { approx: 5 }).ok, true);
  eq(compare(5, 5).ok, true);
  throwsWith('EXPECT_OP', () => compare(5, { neq: 5 }));
});

/* 18 — attach motor bağımsız köprü kurar */
test('attach motor bağımsız köprü kurar ve yıkar', () => {
  const bridge = attach({ canvas: null, snapshot: () => ({ ok: 1 }) });
  eq(typeof globalThis.__KIVILCIM_ATTACH__, 'object');
  eq(bridge.snapshot(), { ok: 1 });
  eq(typeof bridge.press, 'function');
  bridge.dispose();
});

/* 19 — sim kodunda duvar saati yasak (grep denetimi) */
test('sim kodunda Math.random/Date.now/performance.now yok', () => {
  const files = ['kivilcim.mjs', 'scenario.mjs', 'demo/game.mjs', 'attach.mjs'];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(path.join(root, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (line.includes('wallclock-ok')) return;
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return; // açıklama satırı
      if (/\bMath\.random\b|\bDate\.now\b|\bperformance\.now\b/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  if (bad.length) throw new Error('duvar saati kullanımı:\n' + bad.join('\n'));
});

/* 20 — stateHash kararlı */
test('stateHash anahtar sırasından bağımsız', () => {
  eq(stateHash({ a: 1, b: 2 }), stateHash({ b: 2, a: 1 }));
  if (stateHash({ a: 1 }) === stateHash({ a: 2 })) throw new Error('farklı durum aynı hash');
});

/* 21 — dispose temizliği */
test('dispose sahneleri ve girdiyi temizler', () => {
  const g = makeSim();
  g.input.inject({ code: 'ArrowRight', down: true });
  g.dispose();
  eq(g.scenes.size, 0);
  eq(g.current, null);
  eq(g.input.keys.size, 0);
});

/* 22 — sahne yoksa anlaşılır hata */
test('go() bilinmeyen sahnede SCENE_MISSING atar', () => {
  const g = makeSim();
  const err = throwsWith('SCENE_MISSING', () => g.go('yok'));
  if (!/sim/.test(err.hint)) throw new Error('hata ipucu tanımlı sahneleri listelemiyor');
});

/* 23 — build-check üretim HTML'i paket içi import yollarına yeniden yazar */
test('build-check HTML importları paket içinde gerçekten var', () => {
  const outDir = path.join(root, 'out', 'test-build-f1f2');
  const report = buildProduction({ root, write: outDir });
  if (!report.ok) throw new Error(`build raporu ok:false — çözülemeyen import: ${JSON.stringify(report.unresolvedImports)}`);
  const html = readFileSync(path.join(outDir, 'demo__index.html'), 'utf8');
  const specs = [
    ...html.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...html.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
    ...html.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
  ].map((m) => m[1]);
  if (specs.length < 2) throw new Error(`üretim HTML'de import sayısı beklenen >=2, gelen ${specs.length}: ${JSON.stringify(specs)}`);
  if (!specs.includes('./demo__game.mjs')) throw new Error(`./demo__game.mjs yok: ${JSON.stringify(specs)}`);
  if (!specs.includes('./scenario.mjs')) throw new Error(`./scenario.mjs yok: ${JSON.stringify(specs)}`);
  for (const spec of specs) {
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(outDir, spec);
    if (!existsSync(target)) throw new Error(`import ${spec} paket içinde yok: ${target}`);
  }
  for (const entry of report.imports) {
    for (const r of entry.rewrites) {
      if (r.to.includes('/demo/')) throw new Error(`üst dizin kalıntısı: ${r.to}`);
    }
  }
  if (html.includes('./game.mjs')) throw new Error('üretim HTML hâlâ ./game.mjs işaret ediyor');
});

/* 24 — CLI sayfa argümanını yok saymıyor: iki dosya iki farklı sayfa yolu */
test('resolvePagePath iki farklı dosyayı iki farklı sayfaya çözer', () => {
  const dev = resolvePagePath('demo/index.html', { root, cwd: root });
  const prod = resolvePagePath('dist/demo__index.html', { root, cwd: root });
  eq(dev.ok, true, 'dev sayfa çözümü');
  eq(prod.ok, true, 'üretim sayfa çözümü');
  eq(dev.pagePath, '/demo/index.html', 'dev pagePath');
  eq(prod.pagePath, '/dist/demo__index.html', 'üretim pagePath');
  if (dev.pagePath === prod.pagePath) throw new Error('iki farklı dosya aynı sayfa yoluna çözüldü — argüman yok sayılıyor');
  const missing = resolvePagePath('dist/yok-boyle-dosya.html', { root, cwd: root });
  eq(missing.ok, false, 'olmayan dosya hata vermeli');
  eq(resolvePagePath(undefined, { root, cwd: root }).pagePath, '/demo/index.html', 'argümansız varsayılan');
  eq(resolvePagePath('../../../etc/hosts', { root, cwd: root }).ok, false, 'kök dışı yol hata vermeli');
});

/* 25 — canvas viewport'a göre ölçeklenir: mantıksal dünya sabit, buffer 960x540..1920x1080 */
test('fitToViewport mantıksal dünyayı bozmadan buffer/CSS ölçeğini uyarlar', () => {
  const canvas = makeStubCanvas(960, 540);
  const g = new Game({ canvas, width: 960, height: 540, seed: 7, step: 1 / 60 });
  const before = stateHash(g.inspect.snapshot());

  const desk = g.fitToViewport({ vw: 1280, vh: 720, dpr: 1 });
  eq(desk.world[0], 960, 'mantıksal dünya genişliği');
  eq(desk.world[1], 540, 'mantıksal dünya yüksekliği');
  eq(desk.buffer[0], 1280, 'masaüstü buffer genişliği');
  eq(desk.buffer[1], 720, 'masaüstü buffer yüksekliği');
  if (!(desk.css[0] >= 1280 && desk.css[1] >= 720)) throw new Error(`masaüstü CSS viewport'u doldurmuyor: ${desk.css}`);

  const mob = g.fitToViewport({ vw: 390, vh: 844, dpr: 3 });
  eq(mob.buffer[0], 1920, 'mobil buffer üst sınır 1920');
  eq(mob.buffer[1], 1080, 'mobil buffer üst sınır 1080');
  if (!(mob.css[0] >= 390 && mob.css[1] >= 844)) throw new Error(`mobil CSS viewport'u doldurmuyor: ${mob.css}`);

  const tiny = g.fitToViewport({ vw: 320, vh: 180, dpr: 1 });
  eq(tiny.buffer[0], 960, 'küçük viewport alt sınır 960');
  eq(tiny.buffer[1], 540, 'küçük viewport alt sınır 540');

  eq(g.width, 960, 'mantıksal genişlik değişmemeli');
  eq(g.height, 540, 'mantıksal yükseklik değişmemeli');
  eq(stateHash(g.inspect.snapshot()), before, 'ölçekleme sim durumunu değiştirmemeli');

  // dikey ekran: görünen dünya merkezli ve dünyadan dar; HUD bu dikdörtgene yerleşir
  g.fitToViewport({ vw: 390, vh: 844, dpr: 3 });
  const vis = g.visibleWorld();
  if (!(vis.w < 960)) throw new Error(`dikey görünür dünya genişliği daralmalı: ${vis.w}`);
  if (Math.abs(vis.x * 2 + vis.w - 960) > 0.01) throw new Error(`görünür dünya merkezli değil: ${JSON.stringify(vis)}`);
  if (!(vis.y >= 0 && vis.y + vis.h <= 540.01)) throw new Error(`görünür dünya dışına taşıyor: ${JSON.stringify(vis)}`);
});

/* 26 — B1 regresyonu: demo arenasında yatay eksenin YÖNÜ (klavye) */
test('demo: ArrowRight basılı 30 tick player.x ARTAR, ArrowLeft AZALIR', () => {
  const right = createDemoGame(makeStubCanvas(), { seed: 42 });
  const r0 = right.inspect.snapshot().state.player.x;
  right.input.inject({ code: 'ArrowRight', down: true });
  right.step(30);
  const r1 = right.inspect.snapshot().state.player.x;
  right.input.inject({ code: 'ArrowRight', down: false });
  if (!(r1 > r0)) throw new Error(`ArrowRight x'i artırmalı: ${r0} → ${r1} (eksen ters)`);

  const left = createDemoGame(makeStubCanvas(), { seed: 42 });
  const l0 = left.inspect.snapshot().state.player.x;
  left.input.inject({ code: 'ArrowLeft', down: true });
  left.step(30);
  const l1 = left.inspect.snapshot().state.player.x;
  left.input.inject({ code: 'ArrowLeft', down: false });
  if (!(l1 < l0)) throw new Error(`ArrowLeft x'i azaltmalı: ${l0} → ${l1} (eksen ters)`);

  const deltaR = r1 - r0;
  const deltaL = l1 - l0;
  if (Math.abs(deltaR + deltaL) > 0.01) throw new Error(`yön büyüklükleri simetrik değil: +${deltaR} / ${deltaL}`);
});

/* 27 — U1: ekran dışı düşmanlar için HUD yön göstergesi */
test('U1: gösterge yalnız ekran DIŞI düşman için, aynı yönde tek ok, en fazla 8', () => {
  const g = createDemoGame(makeStubCanvas(), { seed: 9 });
  g.fitToViewport({ vw: 390, vh: 844, dpr: 3 });
  const vis = g.visibleWorld();
  g.invokeCommand('killAll');
  eq(g.hudIndicators().length, 0, 'düşman yokken gösterge olmamalı');

  g.invokeCommand('spawnWave', [1]);
  const one = g.hudIndicators();
  eq(one.length, 1, 'tek ekran dışı düşman tek gösterge üretmeli');
  eq(one[0].count, 1, 'tek düşmanın sayısı 1 olmalı');

  // düşman aşağı inip görünür alana girince gösterge kalkmalı (45 tick × 0.6 px = 27 px → y=3)
  g.step(45);
  eq(g.hudIndicators().length, 0, 'ekranda görünen düşman için gösterge olmamalı');

  // aynı yöndeki düşmanlar tek oka toplanır; toplam sayı korunur
  g.invokeCommand('killAll');
  g.invokeCommand('spawnWave', [8]);
  const many = g.hudIndicators();
  if (many.length < 1 || many.length > 8) throw new Error(`gösterge sayısı 1..8 olmalı, gelen ${many.length}`);
  const sum = many.reduce((s, i) => s + i.count, 0);
  eq(sum, 8, 'toplanan gösterge sayıları düşman sayısını vermeli');

  // üst sınır: 40 düşman da en fazla 8 gösterge
  g.invokeCommand('killAll');
  g.invokeCommand('spawnWave', [40]);
  const capped = g.hudIndicators();
  if (capped.length > 8) throw new Error(`gösterge üst sınırı 8 aşıldı: ${capped.length}`);

  // her gösterge görünür dünya dikdörtgeninin İÇİNDE ve HUD güvenli alanında olmalı (metinlerle çakışmaz)
  for (const ind of capped) {
    if (!(ind.x >= vis.x - 0.01 && ind.x <= vis.x + vis.w + 0.01)) throw new Error(`gösterge x görünür alan dışında: ${JSON.stringify(ind)} / ${JSON.stringify(vis)}`);
    if (!(ind.y >= vis.y - 0.01 && ind.y <= vis.y + vis.h + 0.01)) throw new Error(`gösterge y görünür alan dışında: ${JSON.stringify(ind)} / ${JSON.stringify(vis)}`);
    if (!(ind.y >= vis.y + 112 - 0.01)) throw new Error(`gösterge HUD bandının içine girdi (metinlerle çakışır): ${JSON.stringify(ind)}`);
  }

  // gösterge çizimi simülasyon durumunu değiştirmemeli (hash sabit)
  const h0 = g.hash();
  g.render();
  eq(g.hash(), h0, 'gösterge çizimi hash değiştirmemeli');
});

const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log('');
if (passed === total) {
  console.log(`PASS ${passed}/${total}`);
  process.exit(0);
} else {
  console.log(`FAIL ${passed}/${total}`);
  for (const r of results.filter((x) => !x.ok)) console.log(`\n--- ${r.name} ---\n${r.error}`);
  process.exit(1);
}
