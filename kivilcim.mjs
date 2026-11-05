/**
 * KIVILCIM runtime — çekirdek.
 * Sıfır npm bağımlılığı, vanilla ESM. Tarayıcıda DOM ile, Node'da stub canvas ile çalışır.
 *
 * Sözleşme: simülasyon duvar saatine BAKMAZ. İlerleme yalnızca game.step() ile olur;
 * RAF sürücüsü yalnızca gerçek zamanlı oynatmada devrededir.
 */

export const VERSION = '1.0.0';

export class KivilcimError extends Error {
  constructor(code, message, hint = '') {
    super(message);
    this.name = 'KivilcimError';
    this.code = code;
    this.hint = hint;
  }
}

/* ---------------------------------------------------------------- hash */

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function stateHash(value) {
  return fnv1a(stableStringify(value));
}

/* ---------------------------------------------------------------- dev sınırı */

export function devEnabled(search) {
  const q = typeof search === 'string' ? search : (typeof location !== 'undefined' ? location.search : '');
  if (typeof globalThis.__KIVILCIM_DEV_FLAG__ !== 'undefined' && globalThis.__KIVILCIM_DEV_FLAG__) return true;
  return /(^|[?&])dev=1(&|$)/.test(q || '');
}

/* @dev-start — build-check bu bölgeyi üretim paketinden çıkarır */
/** Dev köprüsünü kurar. `__KIVILCIM_DEV__` adı YALNIZ bu bölgede geçer (build-check bunu doğrular). */
export function installDevBridge(obj) {
  globalThis.__KIVILCIM_DEV__ = obj;
  return obj;
}
/* @dev-end */

/* ---------------------------------------------------------------- RNG */

export class RNG {
  constructor(seed = 1) {
    this.seed = (seed >>> 0) || 1;
    this.s = this.seed >>> 0;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) {
    const lo = Math.ceil(a), hi = Math.floor(b);
    if (hi < lo) throw new KivilcimError('RNG_RANGE', `int(${a},${b}) geçersiz aralık`);
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  float(a = 0, b = 1) {
    return a + this.next() * (b - a);
  }
  pick(arr) {
    if (!arr || arr.length === 0) throw new KivilcimError('RNG_PICK', 'pick() boş dizi');
    return arr[this.int(0, arr.length - 1)];
  }
  save() {
    return { seed: this.seed, s: this.s };
  }
  restore(st) {
    if (!st || typeof st.s !== 'number') throw new KivilcimError('RNG_RESTORE', 'RNG.save() çıktısı bekleniyordu');
    this.seed = st.seed >>> 0;
    this.s = st.s >>> 0;
  }
}

/* ---------------------------------------------------------------- stub canvas (Node) */

class StubCtx {
  constructor(w, h) {
    this.canvas = { width: w, height: h };
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.font = '12px monospace';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.globalAlpha = 1;
    this.globalCompositeOperation = 'source-over';
    this.imageSmoothingEnabled = true;
    this.shadowBlur = 0;
    this.shadowColor = '#000';
    this._stack = [];
  }
  save() { this._stack.push({ a: this.globalAlpha, f: this.fillStyle, s: this.strokeStyle, l: this.lineWidth }); }
  restore() { const s = this._stack.pop(); if (s) { this.globalAlpha = s.a; this.fillStyle = s.f; this.strokeStyle = s.s; this.lineWidth = s.l; } }
  translate() {} rotate() {} scale() {} setTransform() {} resetTransform() {}
  clearRect() {} fillRect() {} strokeRect() {}
  beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} rect() {} ellipse() {}
  fill() {} stroke() {} clip() {}
  fillText() {} strokeText() {}
  measureText(t) { return { width: String(t == null ? '' : t).length * 7 }; }
  drawImage() {}
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return {}; }
  getImageData(x, y, w, h) {
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
  }
  putImageData() {}
}

export function makeStubCanvas(w = 960, h = 540) {
  const ctx = new StubCtx(w, h);
  return { width: w, height: h, getContext: () => ctx, toDataURL: null };
}

/* ---------------------------------------------------------------- params */

const TYPES = new Set(['number', 'int', 'bool', 'enum', 'string']);

export class Params {
  constructor(game) {
    this.game = game;
    this.schema = new Map(); // group -> Map(key -> def)
    this.listeners = [];
  }

  define(group, schema) {
    if (typeof group !== 'string' || !group) throw new KivilcimError('PARAM_GROUP', 'params.define(group, schema): group adı zorunlu');
    if (!schema || typeof schema !== 'object') throw new KivilcimError('PARAM_SCHEMA', `"${group}" için şema nesnesi gerekli`);
    const g = new Map();
    for (const [key, def] of Object.entries(schema)) {
      if (!def || typeof def !== 'object') throw new KivilcimError('PARAM_SCHEMA', `"${group}.${key}" tanımı nesne olmalı`);
      if (!TYPES.has(def.type)) throw new KivilcimError('PARAM_SCHEMA', `"${group}.${key}" tipi geçersiz: ${def.type}`, 'type: number|int|bool|enum|string olmalı');
      if ((def.type === 'number' || def.type === 'int') && (typeof def.min !== 'number' || typeof def.max !== 'number')) {
        throw new KivilcimError('PARAM_SCHEMA', `"${group}.${key}" min/max sayı olmalı`, 'Aralık zorunlu: sessiz clamp yok.');
      }
      if (def.type === 'enum' && (!Array.isArray(def.options) || def.options.length === 0)) {
        throw new KivilcimError('PARAM_SCHEMA', `"${group}.${key}" enum için options dizisi gerekli`);
      }
      g.set(key, {
        type: def.type,
        min: def.min,
        max: def.max,
        options: def.options,
        unit: def.unit || '',
        desc: def.desc || '',
        default: def.default,
      });
    }
    this.schema.set(group, g);
    for (const [key, def] of g) this._write(group, key, def.default);
    return { values: this.values() };
  }

  _def(group, key) {
    const g = this.schema.get(group);
    if (!g || !g.has(key)) {
      throw new KivilcimError('PARAM_UNKNOWN', `Bilinmeyen parametre: ${group}.${key}`, 'params.describe() ile tanımlı adları listele.');
    }
    return g.get(key);
  }

  _write(group, key, value) {
    if (!this.game._values) this.game._values = {};
    if (!this.game._values[group]) this.game._values[group] = {};
    this.game._values[group][key] = value;
  }

  _validate(group, key, value) {
    const def = this._def(group, key);
    const path = `${group}.${key}`;
    if (def.type === 'number' || def.type === 'int') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new KivilcimError('PARAM_TYPE', `${path} sayı olmalı, verilen: ${JSON.stringify(value)}`, 'Senaryoda sayısal değer kullan.');
      }
      if (def.type === 'int' && !Number.isInteger(value)) {
        throw new KivilcimError('PARAM_TYPE', `${path} tam sayı olmalı, verilen: ${value}`);
      }
      if (value < def.min || value > def.max) {
        throw new KivilcimError(
          'PARAM_RANGE',
          `${path} = ${value} aralık dışı [${def.min}, ${def.max}]`,
          `Değeri ${def.min}..${def.max} aralığına çek; runtime sessiz clamp YAPMAZ.`,
        );
      }
    } else if (def.type === 'bool') {
      if (typeof value !== 'boolean') throw new KivilcimError('PARAM_TYPE', `${path} boolean olmalı`);
    } else if (def.type === 'enum') {
      if (!def.options.includes(value)) {
        throw new KivilcimError('PARAM_TYPE', `${path} geçersiz enum değeri: ${JSON.stringify(value)}`, `Geçerli: ${def.options.join(', ')}`);
      }
    } else if (def.type === 'string') {
      if (typeof value !== 'string') throw new KivilcimError('PARAM_TYPE', `${path} string olmalı`);
    }
  }

  set(a, b, c) {
    let group, key, value;
    if (c === undefined && typeof a === 'string' && a.includes('.')) {
      const i = a.indexOf('.');
      group = a.slice(0, i);
      key = a.slice(i + 1);
      value = b;
    } else {
      group = a; key = b; value = c;
    }
    if (typeof key !== 'string' || !key) throw new KivilcimError('PARAM_KEY', `params.set: anahtar zorunlu (${group})`);
    this._validate(group, key, value);
    const prev = this.values()[group] ? this.values()[group][key] : undefined;
    this._write(group, key, value);
    const ev = { path: `${group}.${key}`, group, key, value, previous: prev };
    for (const fn of this.listeners) {
      try { fn(ev); } catch (err) { /* dinleyici hatası simülasyonu durdurmaz */ }
    }
    return ev;
  }

  get(path) {
    return this.values()[path.split('.')[0]]?.[path.split('.').slice(1).join('.')];
  }

  values() {
    const out = {};
    if (!this.game._values) this.game._values = {};
    for (const [group, g] of this.schema) {
      out[group] = {};
      for (const key of g.keys()) out[group][key] = this.game._values[group]?.[key];
    }
    return out;
  }

  describe() {
    const groups = {};
    for (const [group, g] of this.schema) {
      groups[group] = {};
      for (const [key, def] of g) {
        groups[group][key] = {
          type: def.type,
          min: def.min,
          max: def.max,
          options: def.options,
          unit: def.unit,
          desc: def.desc,
          default: def.default,
          value: this.game._values?.[group]?.[key],
        };
      }
    }
    return { groups, values: this.values() };
  }

  onChange(fn) {
    if (typeof fn !== 'function') throw new KivilcimError('PARAM_LISTENER', 'onChange(fn) fonksiyon bekler');
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((f) => f !== fn); };
  }

  reset(group) {
    for (const [g, defs] of this.schema) {
      if (group && g !== group) continue;
      for (const [key, def] of defs) this._write(g, key, def.default);
    }
  }

  applyValues(values) {
    if (!values || typeof values !== 'object') return;
    for (const [group, kv] of Object.entries(values)) {
      if (!this.schema.has(group) || !kv || typeof kv !== 'object') continue;
      for (const [key, value] of Object.entries(kv)) {
        if (this.schema.get(group).has(key)) this.set(group, key, value);
      }
    }
  }
}

/* ---------------------------------------------------------------- inspect */

export class Inspect {
  constructor(game) {
    this.game = game;
    this.registry = new Map();
  }

  register(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') {
      throw new KivilcimError('INSPECT_ARGS', 'inspect.register(name, fn) bekleniyordu');
    }
    this.registry.set(name, fn);
    return () => this.registry.delete(name);
  }

  collect() {
    const state = {};
    for (const [name, fn] of this.registry) {
      let v;
      try { v = fn(); } catch (err) { v = { error: String(err && err.message ? err.message : err) }; }
      if (name === 'state') {
        if (v && typeof v === 'object') Object.assign(state, v);
      } else {
        state[name] = v;
      }
    }
    const scene = this.game.current;
    if (scene && typeof scene.inspect === 'function') {
      try {
        const extra = scene.inspect();
        if (extra && typeof extra === 'object') Object.assign(state, extra);
      } catch (err) {
        state.sceneError = String(err && err.message ? err.message : err);
      }
    }
    return state;
  }

  snapshot() {
    return {
      scene: this.game.current ? this.game.current.id : null,
      tick: this.game.tick,
      time: Number(this.game.time.toFixed(6)),
      params: this.game.params.values(),
      state: this.collect(),
      events: { ...this.game.events },
      stats: { fps: this.game.stats.fps, frames: this.game.stats.frames },
      dev: !!this.game.dev,
    };
  }
}

/* ---------------------------------------------------------------- input */

export class Input {
  constructor(game) {
    this.game = game;
    this.keys = new Set();
    this._just = new Set();
    this.pointer = { x: 0, y: 0, down: false };
    this.bindings = {
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      up: ['ArrowUp', 'KeyW'],
      down: ['ArrowDown', 'KeyS'],
      fire: ['Space', 'KeyJ'],
    };
    this._cleanup = [];
    if (typeof window !== 'undefined' && window.addEventListener) {
      const onKey = (ev) => {
        const code = ev.code;
        if (ev.type === 'keydown') this.inject({ code, down: true });
        else if (ev.type === 'keyup') this.inject({ code, down: false });
      };
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onKey);
      this._cleanup.push(() => {
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('keyup', onKey);
      });
      const c = game.canvas;
      if (c && c.addEventListener) {
        const toLogical = (ev) => {
          const r = c.getBoundingClientRect ? c.getBoundingClientRect() : { left: 0, top: 0, width: game.width, height: game.height };
          const sx = game.width / (r.width || game.width);
          const sy = game.height / (r.height || game.height);
          return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
        };
        const onDown = (ev) => { const p = toLogical(ev); this.pointerTo(p.x, p.y, true); };
        const onUp = (ev) => { const p = toLogical(ev); this.pointerTo(p.x, p.y, false); };
        const onMove = (ev) => { const p = toLogical(ev); this.pointerTo(p.x, p.y, this.pointer.down); };
        c.addEventListener('pointerdown', onDown);
        c.addEventListener('pointerup', onUp);
        c.addEventListener('pointermove', onMove);
        this._cleanup.push(() => {
          c.removeEventListener('pointerdown', onDown);
          c.removeEventListener('pointerup', onUp);
          c.removeEventListener('pointermove', onMove);
        });
      }
    }
  }

  inject(ev) {
    if (!ev || typeof ev.code !== 'string') throw new KivilcimError('INPUT_EVENT', 'inject({code,down}) bekleniyordu');
    const code = ev.code;
    if (ev.down) {
      if (!this.keys.has(code)) this._just.add(code);
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
    this.game.recordInput(code, !!ev.down);
    return this;
  }

  pointerTo(x, y, down) {
    this.pointer.x = Number(x) || 0;
    this.pointer.y = Number(y) || 0;
    if (typeof down === 'boolean') this.pointer.down = down;
    return this;
  }

  down(code) { return this.keys.has(code); }
  justPressed(code) { return this._just.has(code); }

  axis(name) {
    const b = this.bindings[name] || [];
    const neg = this.bindings[axisOpposite(name)] || [];
    let v = 0;
    for (const k of b) if (this.keys.has(k)) v += 1;
    for (const k of neg) if (this.keys.has(k)) v -= 1;
    return Math.max(-1, Math.min(1, v));
  }

  _clearJust() { this._just.clear(); }
  clearAll() { this.keys.clear(); this._just.clear(); this.pointer.down = false; }
  dispose() { for (const fn of this._cleanup) fn(); this._cleanup = []; this.clearAll(); }
}

function axisOpposite(name) {
  return { left: 'right', right: 'left', up: 'down', down: 'up' }[name] || '';
}

/* ---------------------------------------------------------------- draw */

export class Draw {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;
    this.shake = { amount: 0, steps: 0, x: 0, y: 0 };
  }

  clear(color) {
    const c = this.ctx;
    if (!c) return;
    c.save();
    c.fillStyle = color || this.game.background;
    c.fillRect(0, 0, this.game.width, this.game.height);
    c.restore();
  }

  rect(x, y, w, h, color, opts = {}) {
    const c = this.ctx;
    if (!c) return;
    c.save();
    c.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    c.fillStyle = color || '#fff';
    c.fillRect(x, y, w, h);
    if (opts.stroke) {
      c.strokeStyle = opts.stroke;
      c.lineWidth = opts.lineWidth || 1;
      c.strokeRect(x, y, w, h);
    }
    c.restore();
  }

  circle(x, y, r, color, opts = {}) {
    const c = this.ctx;
    if (!c) return;
    c.save();
    c.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    c.fillStyle = color || '#fff';
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  line(x1, y1, x2, y2, color, width = 1) {
    const c = this.ctx;
    if (!c) return;
    c.save();
    c.strokeStyle = color || '#fff';
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.restore();
  }

  text(str, x, y, opts = {}) {
    const c = this.ctx;
    if (!c) return;
    c.save();
    c.fillStyle = opts.color || '#e8eef7';
    c.font = opts.font || '16px ui-monospace, monospace';
    c.textAlign = opts.align || 'left';
    c.textBaseline = opts.baseline || 'alphabetic';
    c.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    c.fillText(String(str), x, y);
    c.restore();
  }

  sprite(atlas, frame, x, y, opts = {}) {
    const c = this.ctx;
    if (!c || !atlas || !atlas.image) return;
    const f = atlas.frames && atlas.frames[frame];
    if (!f) return;
    c.save();
    c.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    c.drawImage(atlas.image, f.x, f.y, f.w, f.h, x, y, opts.w || f.w, opts.h || f.h);
    c.restore();
  }

  particles(list) {
    for (const p of list || []) {
      if (p.life <= 0) continue;
      this.circle(p.x, p.y, Math.max(0.5, p.r * (p.life / p.maxLife)), p.color, { alpha: Math.max(0, p.life / p.maxLife) });
    }
  }

  screenshake(amount, steps) {
    this.shake.amount = Math.max(this.shake.amount, amount);
    this.shake.steps = Math.max(this.shake.steps, steps);
  }

  /** Her karede çağrılır; sarsıntı RNG ile üretilir → deterministik. */
  applyShake() {
    const c = this.ctx;
    if (!c) return;
    if (this.shake.steps > 0) {
      const a = this.shake.amount * (this.shake.steps / 12);
      this.shake.x = (this.game.random.next() * 2 - 1) * a;
      this.shake.y = (this.game.random.next() * 2 - 1) * a;
      this.shake.steps--;
      if (this.shake.steps <= 0) this.shake.amount = 0;
    } else {
      this.shake.x = 0;
      this.shake.y = 0;
    }
    if (c.translate) c.translate(this.shake.x, this.shake.y);
  }
}

/* ---------------------------------------------------------------- storage */

export class Storage {
  constructor(ns = 'kivilcim', opts = {}) {
    this.ns = ns;
    this.version = opts.version || 1;
    this.migrate = typeof opts.migrate === 'function' ? opts.migrate : null;
    this.memory = new Map();
    this.warnings = [];
    this._ls = null;
    try {
      if (typeof localStorage !== 'undefined' && localStorage) {
        localStorage.setItem('__kivilcim_probe__', '1');
        localStorage.removeItem('__kivilcim_probe__');
        this._ls = localStorage;
      }
    } catch (err) {
      this._ls = null;
    }
  }

  _key(key) { return `${this.ns}:${key}`; }

  _readRaw(key) {
    if (this._ls) {
      try { return this._ls.getItem(this._key(key)); } catch (err) { /* düş */ }
    }
    return this.memory.has(key) ? this.memory.get(key) : null;
  }

  _writeRaw(key, raw) {
    this.memory.set(key, raw);
    if (this._ls) {
      try { this._ls.setItem(this._key(key), raw); } catch (err) { /* kota dolu → bellek yedeği yeterli */ }
    }
  }

  /** Asla throw etmez. Bozuk kayıt → null + uyarı (bellek içi yedek korunur). */
  load(key, schema = null) {
    try {
      const raw = this._readRaw(key);
      if (raw == null) return null;
      let data;
      try { data = JSON.parse(raw); } catch (err) {
        this.warnings.push({ key, code: 'STORAGE_CORRUPT', message: `${key}: JSON bozuk, bellek içi yedek kullanılıyor` });
        return null;
      }
      if (this.migrate && data && typeof data.version === 'number' && data.version < this.version) {
        try { data = this.migrate(data, this.version); } catch (err) {
          this.warnings.push({ key, code: 'STORAGE_MIGRATE', message: `${key}: migrate başarısız (${err.message})` });
          return null;
        }
      }
      if (schema && data && data.value && typeof data.value === 'object') {
        for (const [field, type] of Object.entries(schema)) {
          if (!(field in data.value)) {
            this.warnings.push({ key, code: 'STORAGE_SCHEMA', message: `${key}: "${field}" anahtarı kayıp (build hatası adayı)` });
          } else if (typeof data.value[field] !== type) {
            this.warnings.push({ key, code: 'STORAGE_SCHEMA', message: `${key}: "${field}" tipi ${typeof data.value[field]}, beklenen ${type}` });
          }
        }
      }
      return data ? data.value : null;
    } catch (err) {
      this.warnings.push({ key, code: 'STORAGE_ERROR', message: `${key}: ${err && err.message}` });
      return null;
    }
  }

  /** Asla throw etmez. */
  save(key, value, schema = null) {
    try {
      if (schema) {
        for (const [field, type] of Object.entries(schema)) {
          if (!(field in (value || {}))) {
            this.warnings.push({ key, code: 'STORAGE_SCHEMA', message: `${key}: "${field}" kaydedilmedi (kayıp anahtar)` });
          } else if (typeof value[field] !== type) {
            this.warnings.push({ key, code: 'STORAGE_SCHEMA', message: `${key}: "${field}" tipi ${typeof value[field]}, beklenen ${type}` });
          }
        }
      }
      const payload = { version: this.version, savedAtTick: value && value.__tick, value };
      this._writeRaw(key, JSON.stringify(payload));
      return true;
    } catch (err) {
      this.warnings.push({ key, code: 'STORAGE_ERROR', message: `${key}: ${err && err.message}` });
      return false;
    }
  }

  clear(key) {
    this.memory.delete(key);
    if (this._ls) { try { this._ls.removeItem(this._key(key)); } catch (err) { /* yut */ } }
  }
}

/* ---------------------------------------------------------------- Game */

export class Game {
  constructor(opts = {}) {
    const o = opts || {};
    this.width = Number(o.width) || 960;
    this.height = Number(o.height) || 540;
    this.dt = Number(o.step) || 1 / 60;
    if (!(this.dt > 0)) throw new KivilcimError('GAME_STEP', 'step > 0 olmalı');
    this.seed = (Number(o.seed) || 1) >>> 0;
    this.background = o.background || '#080d18';
    this.pixelArt = !!o.pixelArt;
    this.fit = o.fit || 'fit';
    this.tick = 0;
    this.time = 0;
    this.timeScale = 1;
    this.reducedMotion = false;
    this._frozenSteps = 0;
    this._running = false;
    this._raf = null;
    this._last = 0; // wallclock-ok: yalnız RAF sürücüsünde kullanılır
    this._acc = 0;
    this._rec = null;
    this._values = {};
    this.scenes = new Map();
    this.current = null;
    this.events = {};
    this.eventDetails = {};
    this.hooks = { beforeUpdate: [], afterUpdate: [], beforeRender: [], afterRender: [], sceneChange: [] };
    this.commands = new Map();
    this.random = new RNG(this.seed);
    this.stats = { fps: 0, frames: 0 };
    this.pixelScale = 1;
    this.stub = !o.canvas;
    this.dev = devEnabled(o.search);

    const canvas = o.canvas || makeStubCanvas(this.width, this.height);
    this.canvas = canvas;
    this.ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { alpha: false }) : null;

    if (o.canvas) {
      const dpr = o.dpr != null ? o.dpr : (typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1);
      this.pixelScale = this.fit === 'none' ? 1 : (this.fit === 'integer' ? Math.max(1, Math.floor(dpr)) : dpr);
      try {
        canvas.width = Math.round(this.width * this.pixelScale);
        canvas.height = Math.round(this.height * this.pixelScale);
        if (canvas.style) { canvas.style.width = this.width + 'px'; canvas.style.height = this.height + 'px'; }
        if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
      } catch (err) { /* canvas yoksa stub davranışı */ }
    }

    this.input = new Input(this);
    this.params = new Params(this);
    this.inspect = new Inspect(this);
    this.storage = new Storage(o.storageNS || 'kivilcim', { version: o.storageVersion || 1 });
    this.draw = new Draw(this);

    /* @dev-start */
    if (this.dev) {
      installDevBridge({
        game: this,
        params: () => this.params.describe(),
        snapshot: () => this.inspect.snapshot(),
        hash: () => this.hash(),
        step: (n) => this.step(n),
        capture: (name) => this.capture(name),
        command: (name, args) => this.invokeCommand(name, args || []),
        runScenario: (scenario) => this.runScenario(scenario),
      });
    }
    /* @dev-end */
  }

  /** Mantıksal çözünürlüğü değiştirir (senaryo `viewport` adımı). */
  setViewport(w, h) {
    const W = Number(w) || this.width;
    const H = Number(h) || this.height;
    this.width = W;
    this.height = H;
    if (this.canvas) {
      const s = this.pixelScale || 1;
      try {
        this.canvas.width = Math.round(W * s);
        this.canvas.height = Math.round(H * s);
        if (this.canvas.style) { this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px'; }
        if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(s, 0, 0, s, 0, 0);
      } catch (err) { /* stub canvas */ }
    }
    return this;
  }

  /**
   * Canvas'ı gerçek viewport'a göre ölçekler. Mantıksal dünya (width×height) DEĞİŞMEZ;
   * yalnız piksel arabelleği ve CSS ölçüsü uyarlanır. Simülasyon birimi/dengesi etkilenmez.
   *
   * - Arabellek: viewport×dpr ölçeği; alt sınır mantıksal boyut (960x540), üst sınır 1920x1080.
   * - CSS: kapak (cover) — viewport'u tamamen doldurur, letterbox yok; taşan kısım kırpılır.
   * - Dönen rapor CDP denetimine ölçülebilir değer verir (uydurma "dolu" iddiası yok).
   *
   * @param {{vw?:number, vh?:number, dpr?:number}} opts
   * @returns {{world:number[], buffer:number[], css:number[], cover:number, scale:number[], vw:number, vh:number, dpr:number, mode:string}}
   */
  fitToViewport(opts = {}) {
    const W = this.width;
    const H = this.height;
    const vw = Math.max(1, Math.round(Number(opts.vw) || W));
    const vh = Math.max(1, Math.round(Number(opts.vh) || H));
    const dprRaw = Number(opts.dpr);
    const dpr = dprRaw > 0 ? Math.min(4, dprRaw) : 1;

    // Arabellek ölçeği: viewport×dpr'yi kapsayan tek oran; 1..2 aralığında kırpılır
    // (1 → 960x540 alt sınır, 2 → 1920x1080 üst sınır). En-boy oranı korunur.
    const coverBuffer = Math.max((vw * dpr) / W, (vh * dpr) / H);
    const r = Math.max(1, Math.min(2, coverBuffer));
    const bw = Math.round(W * r);
    const bh = Math.round(H * r);
    const sx = bw / W;
    const sy = bh / H;

    // CSS: kapak ölçeği — her iki eksende viewport'u doldurur, kırpma merkezden yapılır.
    const cover = Math.max(vw / W, vh / H);
    const cssW = Math.ceil(W * cover);
    const cssH = Math.ceil(H * cover);

    if (this.canvas) {
      try {
        this.canvas.width = bw;
        this.canvas.height = bh;
        if (this.canvas.style) {
          this.canvas.style.width = cssW + 'px';
          this.canvas.style.height = cssH + 'px';
        }
        if (this.ctx && this.ctx.setTransform) this.ctx.setTransform(sx, 0, 0, sy, 0, 0);
      } catch (err) { /* stub canvas */ }
    }

    this.pixelScale = sx;
    this.fitInfo = {
      mode: 'cover',
      world: [W, H],
      vw, vh, dpr,
      buffer: [bw, bh],
      css: [cssW, cssH],
      cover: Number(cover.toFixed(4)),
      scale: [Number(sx.toFixed(4)), Number(sy.toFixed(4))],
    };
    return this.fitInfo;
  }

  /**
   * Kapak ölçekte ekranda görünen dünya dikdörtgeni (mantıksal birim). fitInfo yoksa tam dünya.
   * HUD gibi ekran sabitli öğeler bunun içine yerleştirilir; kırpılan bölgeye çizilmez.
   */
  visibleWorld() {
    const f = this.fitInfo;
    if (!f || !f.css || !f.css[0] || !f.css[1]) return { x: 0, y: 0, w: this.width, h: this.height };
    const w = this.width * Math.min(1, f.vw / f.css[0]);
    const h = this.height * Math.min(1, f.vh / f.css[1]);
    return { x: (this.width - w) / 2, y: (this.height - h) / 2, w, h };
  }

  /* -- sahneler -- */

  addScene(scene) {
    if (!scene || typeof scene.id !== 'string' || !scene.id) {
      throw new KivilcimError('SCENE_ID', 'addScene({id, enter, update, render, exit, inspect}): id zorunlu');
    }
    if (typeof scene.update !== 'function') throw new KivilcimError('SCENE_UPDATE', `"${scene.id}" için update(dt) zorunlu`);
    this.scenes.set(scene.id, scene);
    return scene;
  }

  go(id) {
    const scene = this.scenes.get(id);
    if (!scene) throw new KivilcimError('SCENE_MISSING', `Sahne bulunamadı: ${id}`, `Tanımlı sahneler: ${[...this.scenes.keys()].join(', ') || 'yok'}`);
    if (this.current && typeof this.current.exit === 'function') this.current.exit();
    const prev = this.current ? this.current.id : null;
    this.current = scene;
    if (typeof scene.enter === 'function') scene.enter({ tick: this.tick, params: this.params.values() });
    this._runHooks('sceneChange', { from: prev, to: id });
    return this;
  }

  /* -- döngü -- */

  start() {
    if (this._running) return this;
    this._running = true;
    const frame = (ts) => { // wallclock-ok: gerçek zamanlı sürücü
      if (!this._running) return;
      if (!this._last) this._last = ts;
      let delta = (ts - this._last) / 1000; // wallclock-ok
      this._last = ts;
      if (delta > 0.25) delta = 0.25;
      this._acc += delta;
      let guard = 0;
      while (this._acc >= this.dt && guard < 8) {
        this._tickOnce();
        this._acc -= this.dt;
        guard++;
      }
      this._raf = requestAnimationFrame(frame);
    };
    this._raf = requestAnimationFrame(frame);
    return this;
  }

  stop() {
    this._running = false;
    if (this._raf != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this._raf);
    this._raf = null;
    this._last = 0;
    return this;
  }

  dispose() {
    this.stop();
    if (this.current && typeof this.current.exit === 'function') this.current.exit();
    this.current = null;
    this.input.dispose();
    this.scenes.clear();
    return this;
  }

  freeze(seconds) {
    const s = Number(seconds) || 0;
    this._frozenSteps = Math.max(this._frozenSteps, Math.round(s / this.dt));
    return this;
  }

  /** Sabit adım (saniye) — simülasyonun tek zaman kaynağı. */
  get fixedStep() { return this.dt; }

  step(n = 1) {
    const count = Math.max(0, Math.floor(Number(n) || 0));
    for (let i = 0; i < count; i++) this._tickOnce();
    return this.tick;
  }

  _tickOnce() {
    this._runHooks('beforeUpdate');
    const dt = this.dt * this.timeScale;
    if (this._frozenSteps > 0) {
      this._frozenSteps--;
    } else if (this.current && typeof this.current.update === 'function') {
      this.current.update(dt);
    }
    this.time += dt;
    this.tick++;
    this.input._clearJust();
    this._runHooks('afterUpdate');
    this.render();
  }

  render() {
    const c = this.ctx;
    if (c) {
      c.save && c.save();
      this.draw.clear();
    }
    this._runHooks('beforeRender');
    if (this.current && typeof this.current.render === 'function') {
      this.current.render(this.draw, 1);
    }
    this._runHooks('afterRender');
    if (c && c.restore) c.restore();
    this.stats.frames++;
    return this;
  }

  /* -- hooks / olaylar -- */

  on(hookName, fn) {
    const list = this.hooks[hookName];
    if (!list) throw new KivilcimError('HOOK_NAME', `Geçersiz hook: ${hookName}`, `Geçerli: ${Object.keys(this.hooks).join(', ')}`);
    if (typeof fn !== 'function') throw new KivilcimError('HOOK_FN', `${hookName} için fonksiyon gerekli`);
    list.push(fn);
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
  }

  _runHooks(name, payload) {
    for (const fn of this.hooks[name] || []) {
      try { fn(payload || this); } catch (err) { /* hook hatası simülasyonu bozmaz */ }
    }
  }

  emit(name, detail) {
    if (typeof name !== 'string' || !name) throw new KivilcimError('EMIT_NAME', 'emit(name, detail): ad zorunlu');
    this.events[name] = (this.events[name] || 0) + 1;
    this.eventDetails[name] = detail === undefined ? null : detail;
    return this.events[name];
  }

  /* -- komutlar -- */

  command(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') throw new KivilcimError('COMMAND_ARGS', 'command(name, fn) bekleniyordu');
    this.commands.set(name, fn);
    return this;
  }

  invokeCommand(name, args = []) {
    const fn = this.commands.get(name);
    if (!fn) throw new KivilcimError('COMMAND_MISSING', `Dev komutu yok: ${name}`, `Tanımlı: ${[...this.commands.keys()].join(', ') || 'yok'}`);
    return fn.apply(this, Array.isArray(args) ? args : [args]);
  }

  /* -- hash / reset -- */

  hash() {
    return stateHash({
      tick: this.tick,
      scene: this.current ? this.current.id : null,
      params: this.params.values(),
      events: this.events,
      state: this.inspect.collect(),
    });
  }

  reset() {
    this.stop();
    this.tick = 0;
    this.time = 0;
    this._frozenSteps = 0;
    this.events = {};
    this.eventDetails = {};
    this.random = new RNG(this.seed);
    this.input.clearAll();
    this.params.reset();
    this.stats.frames = 0;
    if (this.current) {
      const id = this.current.id;
      this.current = null;
      this.go(id);
    }
    return this;
  }

  /* -- replay -- */

  startRecording() {
    this._rec = { seed: this.seed, step: this.dt, params: this.params.values(), steps: 0, inputs: [], stateHash: null };
    return this._rec;
  }

  recordInput(code, down) {
    if (!this._rec) return;
    this._rec.inputs.push({ tick: this.tick, code, down: !!down });
  }

  stopRecording() {
    if (!this._rec) return null;
    const rec = this._rec;
    rec.steps = this.tick;
    rec.stateHash = this.hash();
    this._rec = null;
    return rec;
  }

  replay(data) {
    if (!data || !Array.isArray(data.inputs)) throw new KivilcimError('REPLAY_SHAPE', 'replay(data): {seed, steps, inputs} bekleniyordu');
    this.seed = (Number(data.seed) || this.seed) >>> 0;
    this.reset();
    if (data.params) this.params.applyValues(data.params);
    const byTick = new Map();
    for (const inp of data.inputs) {
      if (!byTick.has(inp.tick)) byTick.set(inp.tick, []);
      byTick.get(inp.tick).push(inp);
    }
    const total = Math.max(0, Math.floor(Number(data.steps) || 0));
    for (let i = 0; i < total; i++) {
      const arr = byTick.get(i);
      if (arr) for (const inp of arr) this.input.inject({ code: inp.code, down: inp.down });
      this.step(1);
    }
    return this.hash();
  }

  /* -- yakalama -- */

  /** Renk çeşitliliği: gerçekten çizilmiş mi? (boş/tek renk canvas → nonuniform:false) */
  colorStats() {
    if (this.stub || !this.ctx || typeof document === 'undefined') return { unique: 0, nonuniform: false, skipped: true };
    try {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 36;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(this.canvas, 0, 0, 64, 36);
      const d = cx.getImageData(0, 0, 64, 36).data;
      const set = new Set();
      for (let i = 0; i < d.length; i += 4) {
        set.add(((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3));
      }
      return { unique: set.size, nonuniform: set.size >= 3, skipped: false };
    } catch (err) {
      return { unique: 0, nonuniform: false, skipped: true, error: String(err && err.message ? err.message : err) };
    }
  }

  capture(name = 'capture') {
    const c = this.canvas;
    const stats = this.colorStats();
    if (c && typeof c.toDataURL === 'function') {
      const dataUrl = c.toDataURL('image/png');
      return {
        name,
        dataUrl,
        bytes: Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4),
        unique: stats.unique,
        nonuniform: stats.nonuniform,
      };
    }
    return { name, dataUrl: null, bytes: 0, unique: 0, nonuniform: false };
  }
}

export function createGame(opts) {
  return new Game(opts);
}
