/**
 * Minimal CDP istemcisi — bağımlılık yok. Node 22+ global WebSocket kullanır.
 * Chrome'u headless başlatır, hedef sekme açar, Runtime.evaluate ile köprüyü çağırır.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.KIVILCIM_CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessionId = null;
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (err) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, timer } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else resolve(msg.result);
      }
    });
  }

  static async connect(wsUrl, timeoutMs = 15000) {
    if (typeof WebSocket !== 'function') throw new Error('Bu Node sürümünde global WebSocket yok (Node 22+ gerekir).');
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`WebSocket açılmadı: ${wsUrl}`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
      ws.addEventListener('error', (e) => { clearTimeout(t); reject(new Error(`WebSocket hatası: ${e.message || e}`)); }, { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId = this.sessionId, timeoutMs = 30000) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP zaman aşımı: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  async attachTo(url) {
    const { targetId } = await this.send('Target.createTarget', { url });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    return { targetId, sessionId };
  }

  async evaluate(expression, timeoutMs = 60000) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, this.sessionId, timeoutMs);
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`Sayfa hatası: ${d.exception && d.exception.description ? d.exception.description : d.text}`);
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    try { this.ws.close(); } catch (err) { /* yut */ }
  }
}

export async function waitFor(url, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (err) { /* henüz açılmadı */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Zaman aşımı: ${url} yanıt vermedi`);
}

export async function launchChrome({ chromePath, port, headless = true, extraArgs = [] } = {}) {
  const exe = chromePath || findChrome();
  if (!exe) throw new Error('Chrome/Chromium bulunamadı. KIVILCIM_CHROME ile yol ver.');
  const profile = mkdtempSync(path.join(tmpdir(), 'kivilcim-chrome-'));
  const args = [
    headless ? '--headless=new' : '--headless=old',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1200,760',
    '--allow-file-access-from-files',
    ...extraArgs,
    'about:blank',
  ];
  const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const errors = [];
  child.stderr.on('data', (d) => { const s = String(d); if (/ERROR|FATAL/.test(s)) errors.push(s.trim().slice(0, 300)); });
  child.on('exit', (code) => { errors.push(`chrome çıktı: ${code}`); });

  const version = await waitFor(`http://127.0.0.1:${port}/json/version`, 30000);
  return {
    child,
    profile,
    version,
    wsUrl: version.webSocketDebuggerUrl,
    stop() {
      try { child.kill('SIGTERM'); } catch (err) { /* yut */ }
      try { rmSync(profile, { recursive: true, force: true }); } catch (err) { /* yut */ }
    },
    errors,
  };
}
