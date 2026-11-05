/**
 * CLI sayfa yolu çözücü — bağımlılık yok, yan etkisiz (testler doğrudan import eder).
 *
 * Kural: verilen dosya argümanı yok sayılmaz. Argüman yoksa eski varsayılan
 * (/demo/index.html) korunur; argüman varsa depo köküne göre HTTP yoluna çevrilir.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_PAGE_PATH = '/demo/index.html';

export function resolvePagePath(input, { root, cwd = process.cwd() } = {}) {
  if (input === undefined || input === null || input === '') {
    return { ok: true, pagePath: DEFAULT_PAGE_PATH, abs: null, source: 'default' };
  }
  if (input === true) {
    return { ok: false, error: '--file için dosya yolu gerekli (ör. --file demo/index.html)' };
  }
  const raw = String(input);
  const candidates = path.isAbsolute(raw)
    ? [path.normalize(raw)]
    : [path.resolve(cwd, raw), path.resolve(root, raw)];
  const abs = candidates.find((p) => {
    try { return existsSync(p) && statSync(p).isFile(); } catch (err) { return false; }
  });
  if (!abs) {
    return { ok: false, error: `sayfa bulunamadı: ${raw} (denendi: ${candidates.join(', ')})` };
  }
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: `sayfa depo kökü dışında: ${abs} (kök: ${root})` };
  }
  const pagePath = '/' + rel.split(path.sep).join('/');
  return { ok: true, pagePath, abs, source: 'arg' };
}
