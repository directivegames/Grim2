/**
 * Mesh classifier runner.
 *
 *   pnpm exec tsx .agents/skills/mesh-classifier/scripts/classify.ts <folder-or-glb>... [options]
 *
 * For every GLB found it writes, next to the GLB:
 *   <Name>.jpg  a 3/4 render with scale and axis markers
 *   <Name>.md          the card: front matter, placement rules, key facts (interpretation left for an agent)
 *   <Name>.detail.md   full measurements: height map, silhouettes, every surface and side
 * Existing files are overwritten. When the GLB is byte-identical to the one an existing card was made
 * from, the agent's interpretation in that card is carried into the new one; pass --fresh to drop it.
 * A folder target also gets ASSETS.md, an index of every description in it.
 *
 * Options:
 *   --index-only     rebuild ASSETS.md for folder targets without re-measuring (after agents fill interpretations)
 *   --fresh          discard existing interpretations even when the GLB is unchanged
 *   --size <px>      render size, default 512
 *   --quality <0-1>  JPEG quality, default 0.82
 *   --chrome <path>  Chrome or Chromium binary (or set CHROME_PATH)
 *   --verbose        print browser console output
 *
 * Measuring and rendering run in headless Chrome with three.js, driven over the DevTools protocol,
 * so the only requirement beyond the project's own packages is a local Chrome.
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import * as esbuild from 'esbuild';

import {
  buildIndex, carryInterpretation, describe, PACK_NOTES_END, PACK_NOTES_START, readFrontMatter, type IndexRow,
} from './describe.js';

import type { ClassifyResult, RenderOptions } from './types.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = 'ASSETS.md';

interface Args {
  targets: string[];
  indexOnly: boolean;
  fresh: boolean;
  render: RenderOptions;
  chrome: string | null;
  verbose: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const folders = args.targets.filter((t) => fs.statSync(t).isDirectory());
  const glbs = args.targets.flatMap((t) => (fs.statSync(t).isDirectory() ? findGlbs(t) : [path.resolve(t)]));

  if (!args.indexOnly) {
    if (!glbs.length) throw new Error('No .glb files found in the given targets.');
    console.log(`Classifying ${glbs.length} GLB file${glbs.length === 1 ? '' : 's'}...`);
    const failures = await classifyAll(glbs, root, args);
    if (failures.length) {
      console.log(`\n${failures.length} failed:`);
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    }
  }
  for (const folder of folders) writeIndex(path.resolve(folder));
}

async function classifyAll(glbs: string[], root: string, args: Args): Promise<string[]> {
  const bundle = await esbuild.build({
    entryPoints: [path.join(SCRIPT_DIR, 'page.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
  });
  const pageJs = bundle.outputFiles[0].text;

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>');
    } else if (url === '/page.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(pageJs);
    } else if (url.startsWith('/glb/')) {
      const file = glbs[Number(url.slice(5))];
      if (!file) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'model/gltf-binary' });
      fs.createReadStream(file).pipe(res);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  const chrome = await launchChrome(args.chrome, `http://127.0.0.1:${port}/`);
  const failures: string[] = [];
  try {
    const page = await connectToPage(chrome.debugPort);
    if (args.verbose) page.onEvent = logConsole;
    await page.send('Runtime.enable');
    await waitFor(async () => (await page.evaluate('window.classifierReady === true')) === true, 15000, 'page to load');

    for (let i = 0; i < glbs.length; i++) {
      const glb = glbs[i];
      const rel = path.relative(root, glb);
      try {
        const result = await page.evaluate(
          `window.classify('/glb/${i}', ${JSON.stringify(args.render)})`,
        ) as ClassifyResult;
        const kept = writeOutputs(glb, root, result, !args.fresh);
        console.log(`  ✓ ${rel}${kept ? ' (interpretation kept: GLB unchanged)' : ''}`);
      } catch (err) {
        failures.push(`${rel}: ${(err as Error).message}`);
        console.log(`  ✗ ${rel}: ${(err as Error).message}`);
      }
    }
    page.close();
  } finally {
    await stopChrome(chrome);
    server.close();
  }
  return failures;
}

/** Writes the render, card and detail file. Returns true when an earlier interpretation was kept. */
function writeOutputs(glb: string, root: string, result: ClassifyResult, keep: boolean): boolean {
  const dir = path.dirname(glb);
  const name = path.basename(glb, path.extname(glb));
  const jpgFile = `${name}.jpg`;
  const data = fs.readFileSync(glb);
  const jpeg = result.render.jpegDataUrl.replace(/^data:image\/jpeg;base64,/, '');
  fs.writeFileSync(path.join(dir, jpgFile), Buffer.from(jpeg, 'base64'));
  const detailFile = `${name}.detail.md`;
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const cardPath = path.join(dir, `${name}.md`);
  const detailPath = path.join(dir, detailFile);
  // The previous card's interpretation still holds only if it describes these exact bytes.
  const previousCard = keep && fs.existsSync(cardPath) && fs.existsSync(detailPath)
    && fs.readFileSync(detailPath, 'utf8').includes(`sha256 ${sha256}`)
    ? fs.readFileSync(cardPath, 'utf8')
    : null;
  const docs = describe({
    name,
    glbFile: path.basename(glb),
    jpgFile,
    detailFile,
    assetPath: assetPathFor(glb, root),
    sha256,
    bytes: data.length,
  }, result);
  const card = previousCard ? carryInterpretation(docs.card, previousCard, docs.sits) : docs.card;
  fs.writeFileSync(cardPath, card);
  fs.writeFileSync(detailPath, docs.detail);
  return card !== docs.card;
}

function writeIndex(folder: string): void {
  const rows: IndexRow[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md') && entry.name !== INDEX_FILE) {
        const fields = readFrontMatter(fs.readFileSync(full, 'utf8'));
        if (fields) rows.push({ id: path.relative(folder, full).split(path.sep).join('/').replace(/\.md$/, ''), fields });
      }
    }
  };
  walk(folder);
  const indexPath = path.join(folder, INDEX_FILE);
  let notes: string | null = null;
  if (fs.existsSync(indexPath)) {
    const old = fs.readFileSync(indexPath, 'utf8');
    const a = old.indexOf(PACK_NOTES_START);
    const b = old.indexOf(PACK_NOTES_END);
    if (a >= 0 && b > a) notes = old.slice(a + PACK_NOTES_START.length, b).trim();
  }
  const prefix = `${assetPathFor(folder, process.cwd())}/`;
  fs.writeFileSync(indexPath, buildIndex(path.basename(folder), prefix, rows, notes));
  console.log(`Index: ${path.relative(process.cwd(), indexPath)} (${rows.length} asset${rows.length === 1 ? '' : 's'})`);
}

function assetPathFor(file: string, root: string): string {
  const engineRoot = path.join(root, 'node_modules', '@gnsx', 'genesys.js');
  const rel = (from: string) => path.relative(from, file).split(path.sep).join('/');
  if (file.startsWith(engineRoot + path.sep)) return `@engine/${rel(engineRoot)}`;
  if (file.startsWith(root + path.sep)) return `@project/${rel(root)}`;
  return file;
}

function findGlbs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findGlbs(full));
    else if (entry.name.toLowerCase().endsWith('.glb')) out.push(path.resolve(full));
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Headless Chrome over the DevTools protocol

interface Chrome {
  process: ChildProcess;
  debugPort: number;
  profileDir: string;
}

function findChrome(explicit: string | null): string {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const which = spawnSync('which', [bin], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  throw new Error('Chrome not found. Pass --chrome <path> or set CHROME_PATH.');
}

async function launchChrome(explicit: string | null, url: string): Promise<Chrome> {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-classifier-'));
  const proc = spawn(findChrome(explicit), [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--mute-audio',
    '--hide-scrollbars',
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const debugPort = await new Promise<number>((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start within 20 s')), 20000);
    proc.stderr!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const m = buffer.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (code ${code})`)); });
  });
  return { process: proc, debugPort, profileDir };
}

/** Chrome keeps writing its profile until it exits, so wait for the exit before removing it. */
async function stopChrome(chrome: Chrome): Promise<void> {
  if (chrome.process.exitCode === null) {
    const exited = new Promise<void>((resolve) => chrome.process.once('exit', () => resolve()));
    chrome.process.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
  try {
    fs.rmSync(chrome.profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  } catch {
    // A leftover temp profile is harmless.
  }
}

interface CdpPage {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  evaluate: (expression: string) => Promise<unknown>;
  close: () => void;
  onEvent: ((method: string, params: Record<string, unknown>) => void) | null;
}

async function connectToPage(debugPort: number): Promise<CdpPage> {
  let wsUrl: string | undefined;
  await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const targets = await res.json() as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    return !!wsUrl;
  }, 10000, 'Chrome page target');

  const ws = new WebSocket(wsUrl!);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools connection failed')), { once: true });
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const page: CdpPage = {
    onEvent: null,
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    }),
    evaluate: async (expression) => {
      const res = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      const details = res.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
      if (details) throw new Error((details.exception?.description ?? details.text ?? 'evaluation failed').split('\n')[0]);
      return (res.result as { value?: unknown }).value;
    },
    close: () => ws.close(),
  };
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number; result?: Record<string, unknown>; error?: { message: string };
      method?: string; params?: Record<string, unknown>;
    };
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result ?? {});
    } else if (msg.method && page.onEvent) {
      page.onEvent(msg.method, msg.params ?? {});
    }
  });
  return page;
}

function logConsole(method: string, params: Record<string, unknown>): void {
  if (method === 'Runtime.consoleAPICalled') {
    const parts = (params.args as { value?: unknown; description?: string }[]).map((a) => a.value ?? a.description);
    console.log(`  [browser ${String(params.type)}]`, ...parts);
  } else if (method === 'Runtime.exceptionThrown') {
    console.log('  [browser exception]', JSON.stringify(params.exceptionDetails));
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // Not ready yet.
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  const args: Args = { targets: [], indexOnly: false, fresh: false, render: { size: 512, quality: 0.82 }, chrome: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--index-only') args.indexOnly = true;
    else if (a === '--fresh') args.fresh = true;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--size') args.render.size = Number(argv[++i]);
    else if (a === '--quality') args.render.quality = Number(argv[++i]);
    else if (a === '--chrome') args.chrome = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else args.targets.push(a);
  }
  if (!args.targets.length) {
    throw new Error('Usage: classify.ts <folder-or-glb>... [--index-only] [--fresh] [--size px] [--quality 0-1] [--chrome path] [--verbose]');
  }
  for (const t of args.targets) if (!fs.existsSync(t)) throw new Error(`Not found: ${t}`);
  return args;
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
