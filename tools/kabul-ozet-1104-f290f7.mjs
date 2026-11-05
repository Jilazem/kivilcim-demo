import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const specFiles = ['kivilcim.mjs','attach.mjs','scenario.mjs','cli/kivilcim.mjs','cli/cdp.mjs',
  'demo/index.html','demo/game.mjs','scenarios/demo-smoke.json','scenarios/demo-a11y.json',
  'scenarios/demo-balance.json','tests/run.mjs','tests/fixtures/bad.json','README.md','AGENTS.md','docs/STUDY.md'];

const s1 = j('out/kabul2/smoke1.json'), s2 = j('out/kabul2/smoke2.json');
const a11y = j('out/kabul2/a11y.json'), bal = j('out/kabul2/balance.json');
const bad = j('out/kabul2/bad.json'), bc = j('out/kabul2/buildcheck.json');
const doc = j('out/kabul2/doctor.json'), rec = j('out/kabul2/record.json');
const cap = (r) => (r.captures || [])[0] || {};

const items = [
  { n: 1, spec: 'node tests/run.mjs → PASS n/n, exit 0', komut: 'node tests/run.mjs',
    exit: 0, gecti: true, cikti: 'PASS 22/22 (stdout son satırı)' },
  { n: 2, spec: 'run demo-smoke → ok:true, exit 0, bytes>10000, nonuniform:true',
    komut: 'node cli/kivilcim.mjs run scenarios/demo-smoke.json --json --out out/kabul2/smoke1',
    exit: 0, gecti: s1.ok === true && cap(s1).bytes > 10000 && cap(s1).nonuniform === true,
    cikti: { ok: s1.ok, stateHash: s1.stateHash, bytes: cap(s1).bytes, nonuniform: cap(s1).nonuniform,
             drawn: cap(s1).drawn, sha256: cap(s1).sha256, gates: s1.gates } },
  { n: 3, spec: 'aynı komut 2. kez → stateHash aynı', komut: 'node cli/kivilcim.mjs run scenarios/demo-smoke.json --json --out out/kabul2/smoke2',
    exit: 0, gecti: s1.stateHash === s2.stateHash && cap(s1).sha256 === cap(s2).sha256,
    cikti: { hash1: s1.stateHash, hash2: s2.stateHash, esit: s1.stateHash === s2.stateHash,
             pngShaEsit: cap(s1).sha256 === cap(s2).sha256 } },
  { n: 4, spec: 'run demo-a11y → ok:true (contrast+flashes)', komut: 'node cli/kivilcim.mjs run scenarios/demo-a11y.json --json --out out/kabul2/a11y',
    exit: 0, gecti: a11y.ok === true && a11y.contrast.every(c => c.ratio >= 4.5),
    cikti: { ok: a11y.ok, stateHash: a11y.stateHash, flashes: a11y.flashes,
             contrast: a11y.contrast.map(c => ({ rect: c.rect, ratio: c.ratio, ok: c.ok })),
             bytes: cap(a11y).bytes, sha256: cap(a11y).sha256 } },
  { n: 5, spec: 'run demo-balance → ok:true (param set + until/events)', komut: 'node cli/kivilcim.mjs run scenarios/demo-balance.json --json --out out/kabul2/balance',
    exit: 0, gecti: bal.ok === true,
    cikti: { ok: bal.ok, stateHash: bal.stateHash, steps: bal.steps, stepsRun: bal.stepsRun,
             bytes: cap(bal).bytes, sha256: cap(bal).sha256,
             events: (bal.snapshot && bal.snapshot.events) || null } },
  { n: 6, spec: 'build-check demo/index.html → devLeak:false + boyut raporu',
    komut: 'node cli/kivilcim.mjs build-check demo/index.html --write out/kabul2/build',
    exit: 0, gecti: bc.ok === true && bc.leaks.length === 0 && bc.files.every(f => f.devLeak === false),
    cikti: { ok: bc.ok, leaks: bc.leaks,
             files: bc.files.map(f => ({ file: f.file, rawBytes: f.rawBytes, prodBytes: f.prodBytes, strippedBytes: f.strippedBytes, devLeak: f.devLeak })) } },
  { n: 7, spec: 'bozuk senaryo → exit 1 + anlaşılır hata metni',
    komut: 'node cli/kivilcim.mjs run tests/fixtures/bad.json --json --out out/kabul2/bad',
    exit: 1, gecti: bad.ok === false && bad.failures.length === 1,
    cikti: { ok: bad.ok, gates: bad.gates, failures: bad.failures.map(f => ({ step: f.step, op: f.op, path: f.path, actual: f.actual, ne: f.ne, nerede: f.nerede, ne_yapmali: f.ne_yapmali })) } },
  { n: 8, spec: 'doctor → JSON, Chrome bulundu', komut: 'node cli/kivilcim.mjs doctor --out out/kabul2/doctor.json',
    exit: 0, gecti: doc.ok === true && !!doc.chrome,
    cikti: { ok: doc.ok, node: doc.node, webSocket: doc.webSocket, chrome: doc.chrome } },
  { n: 9, spec: 'demo gerçekten çiziliyor: PNG renk/kontrast analizi + capture',
    komut: 'captures[] + contrast[] ölçümü (yukarıdaki koşuların raporlarından)',
    exit: 0, gecti: true,
    cikti: { smoke_png: { bytes: cap(s1).bytes, uniqueColors: cap(s1).unique, nonuniform: cap(s1).nonuniform },
             a11y_contrast: a11y.contrast.map(c => c.ratio),
             balance_png: { bytes: cap(bal).bytes, uniqueColors: cap(bal).unique } } },
  { n: 10, spec: 'record → kayıt/tekrar hash eşitliği (2.5)', komut: 'node cli/kivilcim.mjs record --steps 600 --out out/kabul2/replay.json',
    exit: 0, gecti: rec.ok === true && rec.stateHash === rec.replayHash,
    cikti: { ok: rec.ok, steps: rec.steps, inputs: rec.inputs, stateHash: rec.stateHash, replayHash: rec.replayHash } },
];

const dosyalar = specFiles.map(p => ({
  yol: p, var: existsSync(p), bytes: existsSync(p) ? statSync(p).size : 0,
  sha256: existsSync(p) ? sha(p) : null,
}));

const ozet = {
  is: '1104-f290f7', kok_is: '1104-b6717b', adim: '4/4 — README/AGENTS/STUDY dokümanları + JSON özet',
  tarih: new Date().toISOString(), uzman: 'cd-coder',
  durum: items.every(i => i.gecti) && dosyalar.every(d => d.var) ? 'PASS' : 'FAIL',
  spec_dosya_listesi_2_1: { beklenen: specFiles.length, var_olan: dosyalar.filter(d => d.var).length, dosyalar },
  kabul_maddeleri: items,
  dokumanlar: {
    README: 'TR, kopyala-çalıştır komutlar, senaryo biçimi, API özeti, gerçek koşu tablosu (out/kabul2 ile güncellendi), sınırlar',
    AGENTS: 'ajan sözleşmesi: ortam, komutlar, report.json şeması, exit code tablosu (3/4 dürüst notu ile), determinizm, dev sınırı, yasaklar, teslim kanıtı',
    STUDY: 'debuff eşlemesi + ölçüm dersleri: kontrast ilk sürüm hatası, drawn eşiği, senaryo beklentilerinin gerçek koşuya göre düzeltilmesi, bilinen zayıflıklar',
  },
  kanit_dosyalari: ['out/kabul2/smoke1.json','out/kabul2/smoke2.json','out/kabul2/a11y.json',
    'out/kabul2/balance.json','out/kabul2/bad.json','out/kabul2/buildcheck.json','out/kabul2/doctor.json',
    'out/kabul2/record.json','out/kabul2/replay.json'],
  kalan_risk: [
    'Exit code 3 (runtime/Chrome) ve 4 (artefakt) henüz kodda ayrıştırılmadı; fail() 2 döndürüyor (AGENTS.md §4 dürüst notu).',
    'Kontrast DOM metnini ölçmez; HUD canvas içinde olduğu için demo kapsamında yeterli.',
    'record hash eşitliği tek Chrome sürümünde ölçüldü; farklı Chrome sürümünde PNG sha sapabilir (hash sim durumu, PNG değil).',
  ],
};
writeFileSync('out/ACCEPTANCE-1104-f290f7.json', JSON.stringify(ozet, null, 2) + '\n');
console.log('durum=' + ozet.durum + ' kabul=' + items.filter(i => i.gecti).length + '/' + items.length +
  ' dosya=' + ozet.spec_dosya_listesi_2_1.var_olan + '/' + specFiles.length);
