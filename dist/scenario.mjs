/**
 * KIVILCIM senaryo motoru — deterministik adım yürütücü.
 * Duvar saati kullanmaz: `wait` adım sayısıdır. Hata metni "ne / nerede / ne yapmalı" içerir.
 */
import { KivilcimError } from './kivilcim.mjs';

const OPS = ['wait', 'press', 'release', 'tap', 'pointer', 'set', 'expect', 'until', 'command', 'capture', 'screenshot', 'contrast', 'flashes', 'viewport', 'reducedMotion'];

export function getPath(root, path) {
  if (!path) return undefined;
  let cur = root;
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function compare(actual, spec) {
  let op = 'eq';
  let expected = spec;
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const keys = Object.keys(spec);
    if (keys.length !== 1) {
      throw new KivilcimError('EXPECT_SHAPE', `Beklenti nesnesi tek karşılaştırıcı içermeli, verilen: ${JSON.stringify(spec)}`);
    }
    op = keys[0];
    expected = spec[op];
  }
  const numeric = ['gt', 'gte', 'lt', 'lte', 'approx'];
  if (numeric.includes(op) && (typeof actual !== 'number' || typeof expected !== 'number')) {
    return { ok: false, op, expected, actual, hint: `"${op}" sayısal karşılaştırma; gerçek değer ${JSON.stringify(actual)} (${typeof actual}).` };
  }
  let ok = false;
  switch (op) {
    case 'eq': ok = JSON.stringify(actual) === JSON.stringify(expected); break;
    case 'gt': ok = actual > expected; break;
    case 'gte': ok = actual >= expected; break;
    case 'lt': ok = actual < expected; break;
    case 'lte': ok = actual <= expected; break;
    case 'approx': ok = Math.abs(actual - expected) <= 1e-6; break;
    default:
      throw new KivilcimError('EXPECT_OP', `Bilinmeyen karşılaştırıcı: ${op}`, 'eq|gt|gte|lt|lte|approx');
  }
  return { ok, op, expected, actual };
}

function failure(i, opName, path, res, scenarioName) {
  const ne = path
    ? `${path} beklenen koşulu sağlamıyor: beklenen ${res.op} ${JSON.stringify(res.expected)}, gerçek ${JSON.stringify(res.actual)}`
    : `${opName} adımı başarısız`;
  const nerede = `senaryo "${scenarioName}", adım ${i} (${opName})`;
  const neYapmali = res.hint || `state/params yolunu ve beklenen eşiği kontrol et (gerçek değer ${JSON.stringify(res.actual)}).`;
  return { step: i, op: opName, path, expected: { op: res.op, value: res.expected }, actual: res.actual, hint: neYapmali, ne, nerede, ne_yapmali: neYapmali };
}

/* --- piksel ölçümleri --- */

function makeSampler(game) {
  if (typeof document === 'undefined' || !game.ctx || game.stub) return null;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 18;
  const cx = c.getContext('2d', { willReadFrequently: true });
  if (!cx) return null;
  return {
    sample() {
      try {
        cx.drawImage(game.canvas, 0, 0, 32, 18);
        const d = cx.getImageData(0, 0, 32, 18).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        return sum / (32 * 18);
      } catch (err) { return null; }
    },
  };
}

export function measureContrast(game, rect) {
  const [x, y, w, h] = rect.map(Number);
  if (game.stub || !game.ctx) {
    return { rect, ratio: null, ok: true, skipped: true, note: 'piksel yok (stub canvas) — ölçüm atlandı' };
  }
  const s = game.pixelScale || 1;
  const data = game.ctx.getImageData(Math.round(x * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))).data;
  const lums = [];
  const hist = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const lin = [data[i], data[i + 1], data[i + 2]].map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    lums.push(L);
    const key = Math.round(L * 1000) / 1000;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const total = lums.length;
  // Zemin = en sık parlaklık. Metin = toplam pikselin >=%0.5'i olan kümelerin en parlağı.
  // (Tek tük anti-alias pikseli "metin" sayılmaz; %10/%90 yüzdelik dilim soluk metni kaçırıyordu.)
  let bg = 0; let bgCount = 0;
  for (const [k, n] of hist) if (n > bgCount) { bgCount = n; bg = k; }
  const minShare = Math.max(3, Math.floor(total * 0.005));
  let hi = bg;
  for (const [k, n] of hist) if (n >= minShare && k > hi) hi = k;
  const lo = bg;
  const ratio = (Math.max(hi, lo) + 0.05) / (Math.min(hi, lo) + 0.05);
  return {
    rect,
    ratio: Number(ratio.toFixed(2)),
    ok: ratio >= 4.5,
    threshold: 4.5,
    bgLum: Number(bg.toFixed(4)),
    textLum: Number(hi.toFixed(4)),
    textShare: Number(([...hist].filter(([k, n]) => k === hi).reduce((s, [, n]) => s + n, 0) / total).toFixed(4)),
  };
}

/* --- yürütücü --- */

export function runScenario(game, scenario, opts = {}) {
  const scenarioName = scenario && scenario.name ? scenario.name : (opts.name || 'scenario');
  if (!scenario || !Array.isArray(scenario.steps)) {
    throw new KivilcimError('SCENARIO_SHAPE', `Senaryo "${scenarioName}" geçersiz: "steps" dizisi yok`, 'Senaryo {"steps":[...]} biçiminde olmalı.');
  }
  const failures = [];
  const captures = [];
  const contrast = [];
  let flashes = 0;
  let prevLum = null;
  let stepsRun = 0;

  game.reset();
  if (Array.isArray(scenario.viewport) && typeof game.setViewport === 'function') game.setViewport(scenario.viewport);
  if (typeof scenario.reducedMotion === 'boolean') game.reducedMotion = scenario.reducedMotion;

  const sampler = makeSampler(game);
  const flashHook = () => {
    if (!sampler) return;
    const lum = sampler.sample();
    if (lum == null) return;
    if (prevLum != null && Math.abs(lum - prevLum) > 0.35) flashes++;
    prevLum = lum;
  };
  if (sampler) game.hooks.afterRender.push(flashHook);

  try {
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      if (!step || typeof step !== 'object') throw new KivilcimError('SCENARIO_STEP', `Adım ${i} nesne değil`);
      const opName = Object.keys(step).find((k) => OPS.includes(k));
      if (!opName) {
        throw new KivilcimError('SCENARIO_OP', `Adım ${i}: bilinmeyen işlem "${Object.keys(step).join(',')}"`, `Geçerli işlemler: ${OPS.join(', ')}`);
      }
      try {
        switch (opName) {
          case 'wait':
            game.step(Number(step.wait) || 0);
            stepsRun++;
            break;
          case 'press':
            game.input.inject({ code: step.press, down: true });
            game.step(Number(step.steps) || 1);
            stepsRun++;
            break;
          case 'release':
            game.input.inject({ code: step.release, down: false });
            game.step(1);
            stepsRun++;
            break;
          case 'tap':
            game.input.inject({ code: step.tap, down: true });
            game.step(1);
            game.input.inject({ code: step.tap, down: false });
            game.step(1);
            stepsRun++;
            break;
          case 'pointer': {
            const p = step.pointer || {};
            game.input.pointerTo(p.x, p.y, typeof p.down === 'boolean' ? p.down : undefined);
            game.step(Number(step.steps) || 1);
            stepsRun++;
            break;
          }
          case 'set': {
            for (const [path, value] of Object.entries(step.set || {})) game.params.set(path, value);
            break;
          }
          case 'expect': {
            const snap = game.inspect.snapshot();
            for (const [path, spec] of Object.entries(step.expect || {})) {
              const res = compare(getPath(snap, path), spec);
              if (!res.ok) failures.push(failure(i, 'expect', path, res, scenarioName));
            }
            break;
          }
          case 'until': {
            const within = Number(step.within) || 600;
            let satisfied = false;
            let last = null;
            for (let k = 0; k < within; k++) {
              game.step(1);
              const snap = game.inspect.snapshot();
              let allOk = true;
              for (const [path, spec] of Object.entries(step.until || {})) {
                const res = compare(getPath(snap, path), spec);
                last = { path, res };
                if (!res.ok) { allOk = false; break; }
              }
              if (allOk) { satisfied = true; break; }
            }
            stepsRun++;
            if (!satisfied && last) failures.push(failure(i, 'until', last.path, last.res, scenarioName));
            break;
          }
          case 'command':
            game.invokeCommand(step.command, step.args || []);
            break;
          case 'capture':
          case 'screenshot': {
            const name = step.capture || step.screenshot || `capture-${i}`;
            const shot = game.capture(name);
            captures.push({ ...shot, step: i });
            break;
          }
          case 'contrast': {
            const res = measureContrast(game, step.contrast);
            contrast.push(res);
            if (!res.ok) {
              failures.push(failure(i, 'contrast', 'contrast', {
                op: 'gte', expected: 4.5, actual: res.ratio,
                hint: `Bölge [${step.contrast.join(',')}] kontrast ${res.ratio}:1 < 4.5:1. Metin rengini aç veya zemini koyulaştır.`,
              }, scenarioName));
            }
            break;
          }
          case 'flashes': {
            if (flashes > Number(step.flashes)) {
              failures.push(failure(i, 'flashes', 'flashes', {
                op: 'lte', expected: Number(step.flashes), actual: flashes,
                hint: `Parlaklık sıçraması ${flashes} kez; sınır ${step.flashes}. Animasyon kontrastını azalt veya reducedMotion kullan.`,
              }, scenarioName));
            }
            break;
          }
          case 'viewport':
            if (typeof game.setViewport === 'function') game.setViewport(step.viewport);
            break;
          case 'reducedMotion':
            game.reducedMotion = !!step.reducedMotion;
            break;
          default:
            break;
        }
      } catch (err) {
        if (err instanceof KivilcimError && err.code === 'SCENARIO_OP') throw err;
        failures.push({
          step: i, op: opName, path: null, expected: null, actual: null,
          hint: err && err.hint ? err.hint : (err && err.message) || String(err),
          error: (err && err.message) || String(err),
          ne: `Adım ${i} çalışırken hata: ${(err && err.message) || err}`,
          nerede: `senaryo "${scenarioName}", adım ${i} (${opName})`,
          ne_yapmali: err && err.hint ? err.hint : 'Adım parametrelerini ve runtime durumunu kontrol et.',
        });
      }
    }
  } finally {
    if (sampler) {
      const idx = game.hooks.afterRender.indexOf(flashHook);
      if (idx >= 0) game.hooks.afterRender.splice(idx, 1);
    }
  }

  const snapshot = game.inspect.snapshot();
  return {
    ok: failures.length === 0,
    scenario: scenarioName,
    steps: scenario.steps.length,
    stepsRun,
    failures,
    captures,
    contrast,
    flashes,
    stateHash: game.hash(),
    snapshot,
  };
}
