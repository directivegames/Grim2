// Shared Chrome DevTools Protocol helpers for the capture scripts
// (capture-heap.mjs, capture-gpu.mjs). No dependencies; needs Node 22+ for the
// global WebSocket.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtMB = (b) => `${(b / 1048576).toFixed(1)} MB`;

/** Default folder for capture scripts when run from the game project root. */
export function defaultCaptureDir(cwd = process.cwd()) {
  return path.join(cwd, '.genesys', 'captures');
}

export function parseFlags(argv = process.argv.slice(2)) {
  return Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }));
}

export function normalizePageUrl(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/\/$/, '') || '/';
    return `${u.protocol}//${u.host}${pathname}`;
  } catch {
    return url.replace(/\/$/, '');
  }
}

export function pageMatchesRequest(requested, pageUrl) {
  const want = normalizePageUrl(requested);
  const got = normalizePageUrl(pageUrl);
  if (got === want || got.startsWith(`${want}/`)) return true;
  try {
    const w = new URL(requested);
    const p = new URL(pageUrl);
    return w.host === p.host && p.pathname.startsWith(w.pathname || '/');
  } catch {
    return pageUrl.includes(requested);
  }
}

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((c) => c && existsSync(c));
}

export async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function waitFor(fn, what, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  let lastError = null;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { lastError = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${lastError ? `: ${lastError.message}` : ''}`);
    await sleep(250);
  }
}

/** Minimal CDP client. Pass a sessionId to talk to an auto-attached child target (worker, iframe). */
export class Cdp {
  constructor(ws) {
    this.ws = ws; this.nextId = 1; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (msg.id) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (p) msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params, msg.sessionId);
      }
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) p.reject(new Error('connection closed')); this.pending.clear(); });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error(`cannot connect to ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(method, fn) { const l = this.handlers.get(method) ?? []; l.push(fn); this.handlers.set(method, l); }
  close() { this.ws.close(); }
}

/**
 * Launches a clean Chrome (temporary profile, no extensions, no DevTools window)
 * and returns its debugging endpoint. Local HTTPS relies on the OS trust store
 * (run `mkcert -install` once). No certificate-bypass CLI flags — Chrome shows an
 * infobar for those and CDP overrides can break Vite module loads.
 */
export async function launchChrome({ chrome, startUrl, headless = false, log = () => {} }) {
  const exe = chrome ?? findChrome();
  if (!exe) throw new Error('Chrome not found. Pass --chrome=<path> or set CHROME_PATH.');
  const profileDir = mkdtempSync(path.join(tmpdir(), 'genesys-heap-'));
  const args = [
    '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(headless ? ['--headless=new'] : ['--start-maximized']), startUrl,
  ];
  log(`launching ${exe}`);
  const proc = spawn(exe, args, { stdio: 'ignore' });
  const port = await waitFor(() => {
    const f = path.join(profileDir, 'DevToolsActivePort');
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n')[0].trim() : null;
  }, 'Chrome to expose its debugging port');
  return { proc, profileDir, endpoint: `http://127.0.0.1:${port}` };
}

/** Browser-level CDP session (Security domain, window bounds). */
export async function connectBrowserCdp(endpoint) {
  const version = await getJson(`${endpoint}/json/version`);
  return Cdp.connect(version.webSocketDebuggerUrl);
}

/** Maximize the browser window that owns a page target (needs a browser-level CDP session). */
export async function maximizeChromeWindow(browserCdp, targetId) {
  if (!browserCdp || !targetId) return false;
  const { windowId } = await browserCdp.send('Browser.getWindowForTarget', { targetId });
  await browserCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  return true;
}

export function stopChrome(handle, { keep = false } = {}) {
  if (!handle || keep) return;
  if (handle.proc && !handle.proc.killed) handle.proc.kill();
  if (handle.profileDir) {
    try { rmSync(handle.profileDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
}

/** Picks the page target to drive. `flags` uses the shared --url / --attach / --target / --list options. */
export async function pickPage(endpoint, flags, { matchUrl = flags.url } = {}) {
  const pages = (await getJson(`${endpoint}/json/list`)).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (flags.list) {
    for (const p of pages) console.log(`${p.id}  ${p.title || '(untitled)'}  ${p.url}`);
    process.exit(0);
  }
  const want = flags.target ?? (flags.attach ? 'play-in-editor' : null);
  const page = (want && pages.find((p) => p.url.includes(want)))
    ?? (matchUrl ? pages.find((p) => pageMatchesRequest(matchUrl, p.url)) : null)
    ?? (flags.target ? null : pages[0]);
  if (!page) {
    throw new Error(`no page matches ${want ?? matchUrl ?? 'the request'}. Pages: ${pages.map((p) => p.url).join(' | ') || '(none)'}. Use --list.`);
  }
  return page;
}

/** Waits for document load and an optional readiness expression on the page session. */
export async function waitForPageReady(cdp, flags, log = () => {}) {
  const waitLoad = flags['wait-for-load'] !== 'false';
  await cdp.send('Runtime.enable');
  if (waitLoad) {
    log('waiting for document load');
    await waitFor(async () => {
      const r = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      return r.result.value === 'complete';
    }, 'document.readyState complete', 120000);
  }
  if (flags['wait-for-expression']) {
    const expr = flags['wait-for-expression'];
    log(`waiting for expression: ${expr}`);
    await waitFor(async () => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return Boolean(r.result.value);
    }, 'wait-for-expression', 300000);
  }
}
