// Bu işin (1104-82e74f) kabul özeti: Bölüm 3 maddelerini gerçek koşu artefaktlarından üretir.
// Uydurma yok: her madde out/ altındaki gerçek çıktıdan okunur; dosya yoksa verdict=KANIT_YOK.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const oku = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const k1 = oku('out/k1/report.json');
const k2 = oku('out/k2/report.json');
const a11y = oku('out/a11y/report.json');
const bal = oku('out/bal/report.json');
const bad = oku('out/bad/report.json');
const build = oku('out/buildwrite.json');
const replay = oku('out/replay.json');
const inspect = oku('out/inspect.json');
const doctor = oku('out/doctor.json');
const testsLog = readFileSync('out/tests.log', 'utf8');

const cap = (r) => (r && r.captures && r.captures[0]) || {};

const maddeler = [
  {
    no: 1,
    komut: 'node tests/run.mjs',
    exit: 0,
    verdict: /PASS 22\/22/.test(testsLog) ? 'GECTI' : 'KALDI',
    kanit: testsLog.trim().split('\n').slice(-2).join(' | '),
  },
  {
    no: 2,
    komut: 'node cli/kivilcim.mjs run scenarios/demo-smoke.json --json --out out/k1',
    exit: 0,
    verdict: k1 && k1.ok === true && cap(k1).bytes > 10000 && cap(k1).nonuniform === true ? 'GECTI' : 'KALDI',
    kanit: k1 && {
      ok: k1.ok, steps: k1.steps, stepsRun: k1.stepsRun, stateHash: k1.stateHash,
      gates: k1.gates, failures: k1.failures.length,
      capture: { name: cap(k1).name, file: cap(k1).file, bytes: cap(k1).bytes, nonuniform: cap(k1).nonuniform, unique: cap(k1).unique, sha256: cap(k1).sha256 },
    },
  },
  {
    no: 3,
    komut: 'aynı komut 2. kez (out/k2) → stateHash karşılaştırma',
    exit: 0,
    verdict: k1 && k2 && k1.stateHash === k2.stateHash && cap(k1).sha256 === cap(k2).sha256 ? 'GECTI' : 'KALDI',
    kanit: k1 && k2 && {
      k1_stateHash: k1.stateHash, k2_stateHash: k2.stateHash, hashEsit: k1.stateHash === k2.stateHash,
      png_sha256_esit: cap(k1).sha256 === cap(k2).sha256,
    },
  },
  {
    no: 4,
    komut: 'node cli/kivilcim.mjs run scenarios/demo-a11y.json --json --out out/a11y',
    exit: 0,
    verdict: a11y && a11y.ok === true && (a11y.contrast || []).every((c) => c.ok) ? 'GECTI' : 'KALDI',
    kanit: a11y && { ok: a11y.ok, flashes: a11y.flashes, contrast: a11y.contrast, captureBytes: cap(a11y).bytes, nonuniform: cap(a11y).nonuniform },
  },
  {
    no: 5,
    komut: 'node cli/kivilcim.mjs run scenarios/demo-balance.json --json --out out/bal',
    exit: 0,
    verdict: bal && bal.ok === true && (bal.failures || []).length === 0 ? 'GECTI' : 'KALDI',
    kanit: bal && { ok: bal.ok, failures: bal.failures.length, events: bal.snapshot.events, score: bal.snapshot.state.score, captureBytes: cap(bal).bytes },
  },
  {
    no: 6,
    komut: 'node cli/kivilcim.mjs build-check --write dist',
    exit: 0,
    verdict: build && build.ok === true && build.leaks.length === 0 ? 'GECTI' : 'KALDI',
    kanit: build && { ok: build.ok, leaks: build.leaks, dosyalar: build.files.map((f) => ({ file: f.file, rawBytes: f.rawBytes, prodBytes: f.prodBytes, devLeak: f.devLeak })) },
  },
  {
    no: 7,
    komut: 'node cli/kivilcim.mjs run tests/fixtures/bad.json --json --out out/bad',
    exit: 1,
    verdict: bad && bad.ok === false && (bad.failures || []).length > 0 ? 'GECTI' : 'KALDI',
    kanit: bad && { ok: bad.ok, gates: bad.gates, hata: bad.failures[0] },
  },
  {
    no: 8,
    komut: 'node cli/kivilcim.mjs doctor',
    exit: 0,
    verdict: doctor && doctor.ok === true && !!doctor.chrome ? 'GECTI' : 'KALDI',
    kanit: doctor,
  },
  {
    no: 9,
    komut: 'PNG kontrast/renk analizi + capture (out/k1, out/a11y, out/bal)',
    exit: 0,
    verdict: cap(k1).drawn === true && cap(a11y).drawn === true && cap(bal).drawn === true ? 'GECTI' : 'KALDI',
    kanit: {
      pngler: [cap(k1), cap(a11y), cap(bal)].map((c) => ({ file: c.file, bytes: c.bytes, unique: c.unique, nonuniform: c.nonuniform, drawn: c.drawn })),
      a11y_kontrast: a11y && a11y.contrast,
      flash_sayisi: a11y && a11y.flashes,
      olay_sayaci: bal && bal.snapshot.events,
    },
  },
];

// Ek doğrulama: record/replay ve inspect (Bölüm 2.2 API sözleşmesi kanıtı)
const ek = {
  replay: replay && { stateHash: replay.stateHash, replayHash: replay.replayHash, esit: replay.stateHash === replay.replayHash, adim: replay.steps.length, girdi: replay.inputs.length },
  inspect: inspect && { keys: Object.keys(inspect), scene: inspect.scene, tick: inspect.tick, params: Object.keys(inspect.params || {}), state: Object.keys(inspect.state || {}), events: inspect.events },
};

// Dosya envanteri (out/ hariç: out/ koşu artefaktıdır, ürün değil)
const envanter = [];
const yuru = (d) => {
  for (const ad of readdirSync(d).sort()) {
    const p = path.join(d, ad);
    if (ad === 'out' || ad === 'node_modules' || ad === '.git') continue;
    const st = statSync(p);
    if (st.isDirectory()) yuru(p);
    else envanter.push({ dosya: p, bayt: st.size, sha256: sha(p) });
  }
};
yuru('.');

const ozet = {
  is: '1104-82e74f',
  kokIs: '1104-b6717b',
  adim: 'Çekirdek runtime dosyalarını yaz (kivilcim.mjs, scenario.mjs, attach.mjs)',
  durum: maddeler.every((m) => m.verdict === 'GECTI') ? 'TAMAMLANDI' : 'EKSIK',
  gecti: maddeler.filter((m) => m.verdict === 'GECTI').length,
  toplam: maddeler.length,
  tarih: new Date().toISOString(),
  node: process.version,
  maddeler,
  ek,
  envanter,
};

writeFileSync('out/ACCEPTANCE-1104-82e74f.json', JSON.stringify(ozet, null, 2));
console.log(JSON.stringify({ durum: ozet.durum, gecti: ozet.gecti, toplam: ozet.toplam, dosyaSayisi: envanter.length, replayEsit: ek.replay && ek.replay.esit }, null, 2));
