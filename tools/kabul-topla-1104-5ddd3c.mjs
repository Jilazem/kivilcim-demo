// Birleşik kabul özeti — yalnız DİSKTEKİ gerçek koşu çıktılarından üretir, varsayım yok.
// Kullanım: node tools/kabul-topla-1104-5ddd3c.mjs
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const D = 'out/kabul-1104-5ddd3c';
const j = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const var_ = (p) => existsSync(p) && statSync(p).size > 0;

const smoke1 = j(`${D}/smoke-1/report.json`);
const smoke2 = j(`${D}/smoke-2/report.json`);
const a11y = j(`${D}/a11y/report.json`);
const balance = j(`${D}/balance/report.json`);
const bad = j(`${D}/bad.stdout.json`);
const doctor = j(`${D}/doctor.json`);
const build = j(`${D}/build-check.json`);
const replay = j(`${D}/replay.json`);
const png = (n) => j(`${D}/${n}.png-denetim.json`);
const testsLog = readFileSync(`${D}/tests.log`, 'utf8');

const pngSmoke = png('smoke-1');
const pngA11y = png('a11y-1');
const pngBal = png('balance-1');
const captureOk = (r) => r.ok === true && (r.captures || []).length > 0 && r.captures.every((c) => c.bytes >= 10000 && c.nonuniform === true && c.gte10k === true && c.drawn === true);

const kabul = [
  {
    no: 1, komut: 'node tests/run.mjs', exit: 0,
    gecti: /PASS (\d+)\/\1/.test(testsLog.replace(/\s+/g, ' ')) && testsLog.includes('PASS 22/22'),
    kanit: `tests.log: ${testsLog.trim().split('\n').pop()}`,
  },
  {
    no: 2, komut: 'node cli/kivilcim.mjs run scenarios/demo-smoke.json --json --out out/kabul-1104-5ddd3c/smoke-1', exit: 0,
    gecti: captureOk(smoke1) && smoke1.ok === true && (smoke1.gates || []).length === 0,
    kanit: `ok=${smoke1.ok} stateHash=${smoke1.stateHash} capture bytes=${smoke1.captures[0].bytes} nonuniform=${smoke1.captures[0].nonuniform} sha256=${smoke1.captures[0].sha256}`,
  },
  {
    no: 3, komut: 'aynı komut 2. kez (out/kabul-1104-5ddd3c/smoke-2)', exit: 0,
    gecti: smoke1.stateHash === smoke2.stateHash && smoke1.ok === true && smoke2.ok === true,
    kanit: `hash1=${smoke1.stateHash} hash2=${smoke2.stateHash} esit=${smoke1.stateHash === smoke2.stateHash} pngShaEsit=${smoke1.captures[0].sha256 === smoke2.captures[0].sha256}`,
  },
  {
    no: 4, komut: 'node cli/kivilcim.mjs run scenarios/demo-a11y.json --json --out out/kabul-1104-5ddd3c/a11y', exit: 0,
    gecti: a11y.ok === true && (a11y.contrast || []).every((c) => c.ratio >= 4.5 && c.ok === true),
    kanit: `ok=${a11y.ok} kontrast=${(a11y.contrast || []).map((c) => c.ratio).join('/')}:1 flashes=${a11y.flashes}`,
  },
  {
    no: 5, komut: 'node cli/kivilcim.mjs run scenarios/demo-balance.json --json --out out/kabul-1104-5ddd3c/balance', exit: 0,
    gecti: balance.ok === true && balance.snapshot.params.player.speed === 400 && balance.snapshot.events.waveCleared >= 1,
    kanit: `ok=${balance.ok} speed=${balance.snapshot.params.player.speed} events=${JSON.stringify(balance.snapshot.events)}`,
  },
  {
    no: 6, komut: 'node cli/kivilcim.mjs build-check demo/index.html --write out/kabul-1104-5ddd3c/build', exit: 0,
    gecti: build.devLeak === false && (build.leaks || []).length === 0,
    kanit: `devLeak=${build.devLeak} leaks=${build.leaks.length} dosya=${build.files.length}`,
  },
  {
    no: 7, komut: 'node cli/kivilcim.mjs run tests/fixtures/bad.json --json --out out/kabul-1104-5ddd3c/bad', exit: 1,
    gecti: bad.ok === false && bad.failures.length > 0 && typeof bad.failures[0].ne === 'string' && bad.failures[0].ne.length > 0,
    kanit: `ok=${bad.ok} hata="${bad.failures[0].ne}" / "${bad.failures[0].nerede}" / "${bad.failures[0].ne_yapmali}"`,
  },
  {
    no: 8, komut: 'node cli/kivilcim.mjs doctor --out out/kabul-1104-5ddd3c/doctor.json', exit: 0,
    gecti: doctor.ok === true && doctor.nodeOk === true && doctor.webSocket === true && typeof doctor.chrome === 'string' && existsSync(doctor.chrome),
    kanit: `ok=${doctor.ok} node=${doctor.node} webSocket=${doctor.webSocket} chrome=${doctor.chrome}`,
  },
  {
    no: 9, komut: 'node tools/png-denetim.mjs <capture.png> (bağımsız PNG çözümü, node:zlib)', exit: 0,
    gecti: pngSmoke.cizilmis && pngA11y.cizilmis && pngBal.cizilmis,
    kanit: `smoke: ${pngSmoke.w}x${pngSmoke.h} renk=${pngSmoke.benzersizRenk} parlaklik=${pngSmoke.parlaklikMin}-${pngSmoke.parlaklikMax} bytes=${pngSmoke.bytes}; a11y renk=${pngA11y.benzersizRenk}; balance renk=${pngBal.benzersizRenk}`,
  },
  {
    no: 10, komut: 'node cli/kivilcim.mjs record --steps 60 --out out/kabul-1104-5ddd3c/replay.json', exit: 0,
    gecti: replay.stateHash === replay.replayHash && Array.isArray(replay.inputs) && replay.inputs.length > 0,
    kanit: `stateHash=${replay.stateHash} replayHash=${replay.replayHash} esit=${replay.stateHash === replay.replayHash} inputs=${replay.inputs}`,
  },
];

const specFiles = ['kivilcim.mjs', 'attach.mjs', 'scenario.mjs', 'cli/kivilcim.mjs', 'cli/cdp.mjs', 'demo/index.html', 'demo/game.mjs', 'scenarios/demo-smoke.json', 'scenarios/demo-a11y.json', 'scenarios/demo-balance.json', 'tests/run.mjs', 'tests/fixtures/bad.json', 'README.md', 'AGENTS.md', 'docs/STUDY.md'];
const dosyalar = specFiles.map((f) => ({ yol: path.resolve(f), var: existsSync(f), bytes: existsSync(f) ? statSync(f).size : 0, sha256: existsSync(f) ? sha(f) : null }));

const ozet = {
  is: '1104-5ddd3c',
  kok_is: '1104-b6717b',
  tip: 'PARÇALA-BİRLEŞTİR (alt işler: 1104-82e74f, 1104-de3cc0, 1104-1850c1, 1104-f290f7)',
  tarih: new Date().toISOString(),
  spec: '/Users/gokhanuzman/007-HERMES/00-SISTEM/ceo-planlar/2026-11-04-kivilcim-runtime.md',
  hedef_dizin: '/Users/gokhanuzman/007-HERMES/12-PROJELER/kivilcim-runtime',
  npm_bagimliligi: { packageJson: existsSync('package.json') ? j('package.json') : null, nodeModules: existsSync('node_modules') },
  dosyalar,
  kabul_maddeleri: kabul,
  hepsi_gecti: kabul.every((k) => k.gecti),
  determinizm: { senaryo: 'demo-smoke', hash1: smoke1.stateHash, hash2: smoke2.stateHash, esit: smoke1.stateHash === smoke2.stateHash, log: path.resolve(`${D}/determinism.log`) },
  artefaktlar: {
    smoke: path.resolve(`${D}/smoke-1/report.json`),
    smokePng: path.resolve(smoke1.captures[0].file),
    a11y: path.resolve(`${D}/a11y/report.json`),
    a11yPng: path.resolve(a11y.captures[0].file),
    balance: path.resolve(`${D}/balance/report.json`),
    balancePng: path.resolve(balance.captures[0].file),
    bad: path.resolve(`${D}/bad.stdout.json`),
    buildCheck: path.resolve(`${D}/build-check.json`),
    doctor: path.resolve(`${D}/doctor.json`),
    replay: path.resolve(`${D}/replay.json`),
    tests: path.resolve(`${D}/tests.log`),
    pngDenetim: [path.resolve(`${D}/smoke-1.png-denetim.json`), path.resolve(`${D}/a11y-1.png-denetim.json`), path.resolve(`${D}/balance-1.png-denetim.json`)],
  },
  kalan_riskler: [
    'flashes=0 ölçüldü: eşik aşılmadı, "hiç flash yok" anlamına gelir.',
    'Chrome/CDP ve dosya hataları CLI içinde hâlâ exit 2 üzerinden düşüyor; spec 2.4 te 3 ve 4 ayrımı kodda yok (AGENTS.md §4 dürüst not).',
    'dist/ üretim kopyası CLI içermez; `node dist/kivilcim.mjs doctor` yalnız çekirdek modülün yüklendiğini gösterir (exit 0, çıktı yok).',
  ],
};

writeFileSync(`${D}/OZET-1104-5ddd3c.json`, JSON.stringify(ozet, null, 2));
console.log(JSON.stringify({
  is: ozet.is,
  hepsi_gecti: ozet.hepsi_gecti,
  dosya_eksik: dosyalar.filter((d) => !d.var).map((d) => d.yol),
  maddeler: kabul.map((k) => ({ no: k.no, gecti: k.gecti })),
  determinizm: ozet.determinizm.esit,
  ozet_yolu: path.resolve(`${D}/OZET-1104-5ddd3c.json`),
}, null, 2));
process.exit(ozet.hepsi_gecti && dosyalar.every((d) => d.var) ? 0 : 1);
