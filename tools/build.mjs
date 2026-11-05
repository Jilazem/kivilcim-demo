/**
 * KIVILCIM üretim paketi üreticisi — bağımlılık yok, import yan etkisi yok.
 *
 * build-check komutu ve regresyon testleri bu modülü paylaşır. Üretim HTML'i
 * düz adla yazılan paket dosyalarına işaret edecek şekilde yeniden yazılır:
 *   demo/index.html + './game.mjs'      → './demo__game.mjs'
 *   demo/index.html + '../scenario.mjs' → './scenario.mjs'
 * Çözülemeyen göreli import kalırsa rapor ok:false olur (sessiz 404 yok).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEV_REGION = /\/\*[^*]*@dev-start[\s\S]*?@dev-end[^*]*\*\/|<!--\s*@dev-start[\s\S]*?@dev-end\s*-->/g;
export const SHIPPED = ['kivilcim.mjs', 'scenario.mjs', 'attach.mjs', 'demo/game.mjs', 'demo/index.html'];

export function flatName(rel) {
  return rel.split('/').join('__');
}

/** Göreli import belirtecini paket içi düz ada çevirir; dış adreslere dokunmaz. */
export function rewriteHtmlImports(html, rel, shipped = SHIPPED) {
  const flat = new Map(shipped.map((r) => [r, flatName(r)]));
  const dir = path.posix.dirname(rel);
  const rewrites = [];
  const unresolved = [];

  const map = (spec) => {
    if (!spec.startsWith('.')) return spec;
    const target = path.posix.normalize(path.posix.join(dir, spec));
    const name = flat.get(target);
    if (!name) {
      unresolved.push({ spec, target });
      return spec;
    }
    const next = './' + name;
    rewrites.push({ from: spec, to: next, target });
    return next;
  };

  let out = html;
  out = out.replace(/(\bfrom\s*)(['"])([^'"]+)\2/g, (m, pre, q, spec) => pre + q + map(spec) + q);
  out = out.replace(/(\bimport\s*\(\s*)(['"])([^'"]+)\2/g, (m, pre, q, spec) => pre + q + map(spec) + q);
  out = out.replace(/(\bimport\s+)(['"])([^'"]+)\2/g, (m, pre, q, spec) => pre + q + map(spec) + q);
  return { out, rewrites, unresolved };
}

function repoRel(root, file) {
  const raw = String(file);
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`build-check dosyası depo kökü dışında: ${abs} (kök: ${root})`);
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    throw new Error(`build-check dosyası bulunamadı: ${abs}`);
  }
  return rel.split(path.sep).join('/');
}

/**
 * @param {{root: string, write?: string|null, file?: string|null}} opts
 *   file: demo/index.html yerine paketlenecek HTML kaynağı (depo köküne göre).
 * @returns rapor nesnesi (ok, devLeak, files, imports, unresolvedImports, leaks)
 */
/**
 * Paketlenen .mjs dosyalarındaki göreli import belirteçlerini düz ada çevirir.
 * HTML yeniden yazımıyla aynı eşleme kullanılır: demo/game.mjs içindeki
 * '../kivilcim.mjs' → './kivilcim.mjs'. Aksi halde GitHub Pages alt yolunda
 * (/kivilcim-demo/) import site köküne çözülür ve 404 olur (yerelde görünmez).
 */
export function rewriteModuleImports(src, rel, shipped = SHIPPED) {
  const flat = new Map(shipped.map((r) => [r, flatName(r)]));
  const dir = path.posix.dirname(rel);
  const rewrites = [];
  const unresolved = [];
  const out = src.replace(/(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (whole, lead, q, spec) => {
    const target = path.posix.normalize(path.posix.join(dir, spec));
    const name = flat.get(target);
    if (!name) { unresolved.push({ spec, target }); return whole; }
    const next = './' + name;
    rewrites.push({ from: spec, to: next, target });
    return `${lead}${q}${next}${q}`;
  });
  return { out, rewrites, unresolved };
}

export function buildProduction({ root, write = null, file = null } = {}) {
  const shipped = [...SHIPPED];
  if (file) {
    const rel = repoRel(root, file);
    const idx = shipped.indexOf('demo/index.html');
    if (!shipped.includes(rel)) shipped[idx >= 0 ? idx : shipped.length - 1] = rel;
  }

  const files = [];
  const imports = [];
  const leaks = [];
  const unresolvedImports = [];
  const writeDir = write ? (mkdirSync(path.resolve(write), { recursive: true }), path.resolve(write)) : null;

  for (const rel of shipped) {
    const src = readFileSync(path.join(root, rel), 'utf8');
    const prod = src.replace(DEV_REGION, '');
    const hit = prod.includes('__KIVILCIM_DEV__');
    let out = prod;
    if (rel.endsWith('.html')) {
      const rewritten = rewriteHtmlImports(prod, rel, shipped);
      out = rewritten.out;
      imports.push({ file: rel, rewrites: rewritten.rewrites, unresolved: rewritten.unresolved });
      for (const u of rewritten.unresolved) unresolvedImports.push({ file: rel, spec: u.spec, target: u.target });
    } else if (rel.endsWith('.mjs')) {
      const rewritten = rewriteModuleImports(prod, rel, shipped);
      out = rewritten.out;
      imports.push({ file: rel, rewrites: rewritten.rewrites, unresolved: rewritten.unresolved });
      for (const u of rewritten.unresolved) unresolvedImports.push({ file: rel, spec: u.spec, target: u.target });
    }
    if (hit) {
      prod.split('\n').forEach((line, i) => {
        if (line.includes('__KIVILCIM_DEV__')) leaks.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    files.push({
      file: rel,
      flat: flatName(rel),
      rawBytes: Buffer.byteLength(src),
      prodBytes: Buffer.byteLength(out),
      strippedBytes: Buffer.byteLength(src) - Buffer.byteLength(prod),
      devLeak: hit,
    });
    if (writeDir) writeFileSync(path.join(writeDir, flatName(rel)), out);
  }

  return {
    ok: leaks.length === 0 && unresolvedImports.length === 0,
    devLeak: leaks.length > 0,
    importsOk: unresolvedImports.length === 0,
    files,
    imports,
    unresolvedImports,
    leaks,
  };
}
