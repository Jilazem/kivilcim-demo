// kabul kanıtı özeti — out/ altındaki gerçek koşu çıktılarından üretir
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const scenarios = ['smoke', 'demo-smoke', 'demo-balance', 'demo-a11y'];
const runs = {};
for (const s of scenarios) {
  try {
    const r = read(path.join('out', s, 'report.json'));
    runs[s] = {
      ok: r.ok,
      gates: r.gates,
      failures: r.failures.length,
      stepsRun: r.stepsRun,
      stateHash: r.stateHash,
      contrast: (r.contrast || []).map((c) => ({ rect: c.rect, ratio: c.ratio, ok: c.ok })),
      captures: r.captures.map((c) => ({ name: c.name, file: c.file, bytes: c.bytes, sha256: c.sha256, unique: c.unique, drawn: c.drawn })),
    };
  } catch (err) {
    runs[s] = { ok: false, error: String(err.message) };
  }
}
const replay = read('out/replay.json');
const inspect = read('out/inspect.json');
const summary = {
  generatedAt: new Date().toISOString(),
  runtimeVersion: '1.0.0',
  scenarios: runs,
  replay: {
    steps: replay.steps,
    inputs: replay.inputs.length,
    stateHash: replay.stateHash,
    replayHash: replay.replayHash,
    identical: replay.stateHash === replay.replayHash,
    file: path.resolve('out/replay.json'),
  },
  inspect: { file: path.resolve('out/inspect.json'), scene: inspect.scene, tick: inspect.tick, keys: Object.keys(inspect.state) },
  build: { file: path.resolve('out/build.log') },
};
writeFileSync('out/acceptance.json', JSON.stringify(summary, null, 2));
const okAll = Object.values(runs).every((r) => r.ok) && summary.replay.identical;
console.log(JSON.stringify({ ok: okAll, scenarios: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { ok: v.ok, stateHash: v.stateHash, bytes: (v.captures || []).map((c) => c.bytes) }])), replayIdentical: summary.replay.identical }, null, 2));
process.exit(okAll ? 0 : 1);
