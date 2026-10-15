// Records GPU memory for a WebGPU game from the command line, with no dependencies.
//
// Combines three sources into one <name>.gpumem.json that analyze-gpu-memory.mjs reads:
//   1. In-page tracker (gpu-hook.js): every live GPU texture and buffer with its
//      exact bytes, format, usage and creation stack. Main thread and workers.
//   2. OS counters: what the driver really allocated for the browser's GPU
//      process (Windows performance counters; nvidia-smi elsewhere).
//   3. A time series of both, sampled every --interval seconds.
//
// The JavaScript heap is separate: use capture-heap.mjs for that.
//
// Two ways to reach the game page:
//   --url=<url>      Launch a clean Chrome, install the tracker, then open the URL
//                    (so the tracker sees every allocation from the first frame).
//   --attach=<port>  Attach to a running Chrome or Electron app (for example
//                    Genesys Studio) started with --remote-debugging-port=<port>.
//                    Add --reload so the page restarts with the tracker installed;
//                    without it only allocations made after attaching are tracked.
//
// Usage:
//   node capture-gpu.mjs --url=https://localhost:3000/ --warmup=15 --duration=60
//   node capture-gpu.mjs --attach=9222 --reload
//
// Stop with Enter (interactive terminal), by creating the stop file printed at
// startup, with --duration, or with Ctrl+C. Requires Node 22+.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Cdp, connectBrowserCdp, defaultCaptureDir, fmtMB, getJson, launchChrome, maximizeChromeWindow, parseFlags, pickPage, sleep, stopChrome, waitFor, waitForPageReady,
} from './cdp-common.mjs';
import { sampleOsGpuMemory } from './gpu-os-sampler.mjs';

const flags = parseFlags();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (flags.help || (!flags.url && !flags.attach)) {
  console.error(`Usage: node capture-gpu.mjs (--url=<url> | --attach=<port>) [options]
  --duration=<seconds>       stop after this long (default: until Enter / stop file)
  --interval=<seconds>       sampling period for the time series (default 5)
  --warmup=<seconds>         wait after page load before recording (default 15 with --url, 0 with --attach)
  --reload                   with --attach: reload the page so the tracker sees every allocation
  --wait-for-load=<bool>     wait for document.readyState complete (default true)
  --wait-for-expression=<js> wait until this expression is truthy (e.g. window.__GAME_READY__)
  --min-stack-kb=<kb>        record creation stacks for resources at least this big (default 64)
  --top=<n>                  keep the n largest live resources in the report (default 300)
  --gpu-pid=<pid[,pid]>      GPU process pid(s) when auto-detection fails
  --no-os                    skip OS-level GPU counters
  --target=<substring>       with --attach: page URL to pick (default: play-in-editor, then the first page)
  --list                     with --attach: print the available pages and exit
  --out=<dir>                output folder (default: <project>/.genesys/captures)
  --name=<label>             file name prefix (default: GPU)
  --chrome=<path>            Chrome executable for --url (default: auto-detect)
  --headless                 run the launched Chrome headless (WebGPU games usually need a window)
  --keep-chrome              do not close Chrome when the script exits
  --stop-file=<path>         creating this file stops the recording (default: <out>/STOP)

GPU memory only. For the JavaScript heap use capture-heap.mjs.`);
  process.exit(flags.help ? 0 : 1);
}

const log = (...a) => console.error('[capture-gpu]', ...a);
const outDir = path.resolve(flags.out ?? defaultCaptureDir());
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const baseLabel = flags.name ?? 'GPU';
const outFile = path.join(outDir, `${baseLabel}-${stamp}.gpumem.json`);
const stopFile = path.resolve(flags['stop-file'] ?? path.join(outDir, 'STOP'));
const topN = Number(flags.top ?? 300);
const intervalMs = Math.max(1, Number(flags.interval ?? 5)) * 1000;
const durationMs = Number(flags.duration ?? 0) * 1000;

const hookOptions = { minStackBytes: Math.round(Number(flags['min-stack-kb'] ?? 64) * 1024), stackFrames: 8 };
const hookSource = `globalThis.__gnsx_gpumem_options=${JSON.stringify(hookOptions)};\n${readFileSync(path.join(__dirname, 'gpu-hook.js'), 'utf8')}`;

const STATS_EXPR = 'JSON.stringify(globalThis.__gnsx_gpumem && globalThis.__gnsx_gpumem.supported ? globalThis.__gnsx_gpumem.stats() : null)';
const SNAPSHOT_EXPR = `JSON.stringify(globalThis.__gnsx_gpumem && globalThis.__gnsx_gpumem.supported ? globalThis.__gnsx_gpumem.snapshot({ topN: ${topN} }) : null)`;

let chromeHandle = null;
process.on('exit', () => stopChrome(chromeHandle, { keep: flags['keep-chrome'] === 'true' }));

async function resolveEndpoint() {
  if (flags.attach) {
    const hostPort = flags.attach.includes(':') ? flags.attach : `127.0.0.1:${flags.attach}`;
    return `http://${hostPort}`;
  }
  // Start on a blank page so the tracker is installed before the game loads.
  chromeHandle = await launchChrome({ chrome: flags.chrome, startUrl: 'about:blank', headless: Boolean(flags.headless), log });
  return chromeHandle.endpoint;
}

// ── value merging across the page and its workers ───────────────────────────
const sum = (a, b) => ({ count: (a?.count ?? 0) + (b?.count ?? 0), bytes: (a?.bytes ?? 0) + (b?.bytes ?? 0) });
function mergeMaps(parts, key) {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p?.[key] ?? {})) out[k] = sum(out[k], v);
  return out;
}
function mergeTotals(parts) {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p?.totals ?? {})) out[k] = (out[k] ?? 0) + v;
  return out;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const endpoint = await resolveEndpoint();
  const page = await waitFor(
    () => pickPage(endpoint, flags, { matchUrl: flags.url ? 'about:blank' : undefined }),
    'a page to capture', flags.url ? 30000 : 3000,
  );
  log(`target: ${page.title || '(untitled)'} ${page.url}`);
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);

  // Browser-level connection: GPU process pid and adapter info.
  let browser = null;
  let gpuInfo = null;
  try {
    browser = await connectBrowserCdp(endpoint);
    const info = await browser.send('SystemInfo.getInfo');
    gpuInfo = {
      devices: info.gpu?.devices ?? [],
      machineModel: info.modelName ?? null,
      featureStatus: info.gpu?.featureStatus ?? null,
    };
  } catch (e) {
    log(`browser-level info unavailable: ${e.message}`);
  }
  if (browser && !flags.headless) {
    try {
      await maximizeChromeWindow(browser, page.id);
      log('maximized browser window');
    } catch (e) {
      log(`could not maximize window: ${e.message}`);
    }
  }
  const gpuPids = async () => {
    if (flags['gpu-pid']) return flags['gpu-pid'].split(',').map(Number).filter(Number.isFinite);
    if (!browser) return [];
    try {
      const r = await browser.send('SystemInfo.getProcessInfo');
      return (r.processInfo ?? []).filter((p) => p.type === 'GPU').map((p) => p.id);
    } catch { return []; }
  };

  // ── install the tracker everywhere ──
  const targets = new Map(); // sessionId -> { type, url, lastStats, detached }
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: hookSource });
  await cdp.send('Runtime.evaluate', { expression: hookSource });

  cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo, waitingForDebugger }) => {
    const type = targetInfo.type;
    try {
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    } catch { /* not every target type can attach children */ }
    try {
      if (type === 'iframe') {
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: hookSource }, sessionId);
      } else if (type === 'worker' || type === 'shared_worker') {
        const r = await cdp.send('Runtime.evaluate', { expression: hookSource }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        targets.set(sessionId, { type, url: targetInfo.url, lastStats: null, detached: false });
        log(`tracking ${type}: ${targetInfo.url}`);
      }
    } catch (e) {
      log(`could not install the tracker in ${type} ${targetInfo.url}: ${e.message}`);
    } finally {
      if (waitingForDebugger) await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    }
  });
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
    const t = targets.get(sessionId);
    if (t) t.detached = true;
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const evalJson = async (sessionId, expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    return r.result?.value ? JSON.parse(r.result.value) : null;
  };

  // ── load the game ──
  let trackingFrom = 'page-start';
  if (flags.url) {
    log(`opening ${flags.url}`);
    await cdp.send('Page.navigate', { url: flags.url });
    await waitFor(async () => (await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result.value !== 'about:blank', 'the page to start loading', 60000);
  } else if (flags.reload) {
    log('reloading the page so the tracker sees every allocation');
    await cdp.send('Runtime.evaluate', { expression: 'window.__gnsx_pre_reload = 1' });
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor(async () => (await cdp.send('Runtime.evaluate', { expression: 'window.__gnsx_pre_reload === undefined', returnByValue: true })).result.value, 'the page to reload', 60000);
  } else {
    trackingFrom = 'attach';
    log('attached without --reload: allocations made before now are not tracked (use --reload for a complete picture)');
  }
  await waitForPageReady(cdp, flags, log);

  const warmup = Number(flags.warmup ?? (flags.url ? 15 : 0));
  if (warmup > 0) { log(`warming up for ${warmup}s`); await sleep(warmup * 1000); }

  const env = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ webgpu: typeof navigator !== "undefined" && !!navigator.gpu, hook: !!globalThis.__gnsx_gpumem, supported: !!(globalThis.__gnsx_gpumem && globalThis.__gnsx_gpumem.supported) })',
    returnByValue: true,
  });
  const envInfo = JSON.parse(env.result.value);
  const where = await cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({ url: location.href, title: document.title })', returnByValue: true });
  const { url: pageUrl, title: pageTitle } = JSON.parse(where.result.value);
  const ready = await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ canvas: !!document.querySelector("canvas"), w: document.querySelector("canvas")?.width ?? 0, h: document.querySelector("canvas")?.height ?? 0 })',
    returnByValue: true,
  });
  const canvasInfo = JSON.parse(ready.result.value);
  if (!envInfo.webgpu) log('WARNING: navigator.gpu is missing in this page. The game is probably using WebGL; only OS-level numbers and the engine snapshot will be available.');
  else if (!envInfo.supported && !targets.size) log('note: no WebGPU device activity seen yet (the game may create its device in a worker or later).');
  if (!canvasInfo.canvas || canvasInfo.w < 16 || canvasInfo.h < 16) {
    log(`WARNING: the game canvas is missing or tiny (${canvasInfo.w}x${canvasInfo.h}). Check the Chrome window — HTTPS or module load may have failed (try mkcert -install).`);
  }

  // ── sampling ──
  const startedAt = Date.now();
  const samples = [];
  const collectStats = async () => {
    const parts = [];
    try { const v = await evalJson(undefined, STATS_EXPR); if (v) parts.push(v); } catch { /* page navigating */ }
    for (const [sid, t] of targets) {
      if (t.detached) { if (t.lastStats) parts.push(t.lastStats); continue; }
      try { const v = await evalJson(sid, STATS_EXPR); if (v) { t.lastStats = v; parts.push(v); } } catch { if (t.lastStats) parts.push(t.lastStats); }
    }
    return parts;
  };
  const takeSample = async () => {
    const parts = await collectStats();
    const totals = mergeTotals(parts);
    const byKind = mergeMaps(parts, 'byKind');
    let jsHeapUsed = null;
    try { jsHeapUsed = (await cdp.send('Runtime.getHeapUsage')).usedSize; } catch { /* ignore */ }
    const os = flags['no-os'] ? null : await sampleOsGpuMemory(await gpuPids());
    const sample = { t: Math.round((Date.now() - startedAt) / 100) / 10, trackedBytes: totals.liveBytes ?? 0, trackedCount: totals.liveCount ?? 0, totals, byKind, jsHeapUsed, os };
    samples.push(sample);
    const osText = os?.process ? `, OS GPU dedicated ${fmtMB(os.process.dedicatedBytes)} shared ${fmtMB(os.process.sharedBytes)}` : (os ? `, OS: ${os.reason ?? os.source}` : '');
    log(`t=${sample.t}s tracked ${fmtMB(sample.trackedBytes)} in ${sample.trackedCount} resources${osText}`);
  };

  let stop = false;
  const onStdin = () => { stop = true; };
  if (process.stdin.isTTY) { process.stdin.setRawMode?.(false); process.stdin.resume(); process.stdin.once('data', onStdin); }
  process.once('SIGINT', onStdin);
  mkdirSync(path.dirname(stopFile), { recursive: true });
  rmSync(stopFile, { force: true });
  log(`recording GPU memory. Play the scenario now.`);
  log(`stop: press Enter${durationMs ? `, wait ${flags.duration}s,` : ''} or create ${stopFile}`);

  await takeSample();
  let last = Date.now();
  while (!stop && !existsSync(stopFile) && !(durationMs && Date.now() - startedAt >= durationMs)) {
    await sleep(250);
    if (Date.now() - last >= intervalMs) { await takeSample(); last = Date.now(); }
  }
  rmSync(stopFile, { force: true });
  process.stdin.pause();
  log('stopping');
  await takeSample();

  // ── final snapshot from every tracked context ──
  const snaps = [];
  try { const v = await evalJson(undefined, SNAPSHOT_EXPR); if (v) snaps.push({ ...v, target: 'page' }); } catch (e) { log(`page snapshot failed: ${e.message}`); }
  for (const [sid, t] of targets) {
    if (t.detached) { log(`worker ${t.url} ended before the final snapshot; only its last sampled totals are included`); continue; }
    try { const v = await evalJson(sid, SNAPSHOT_EXPR); if (v) snaps.push({ ...v, target: `${t.type}:${t.url}` }); } catch (e) { log(`worker snapshot failed: ${e.message}`); }
  }

  const bySiteMap = new Map();
  for (const s of snaps) for (const e of s.bySite) {
    const cur = bySiteMap.get(e.stack) ?? { stack: e.stack, count: 0, bytes: 0 };
    cur.count += e.count; cur.bytes += e.bytes;
    bySiteMap.set(e.stack, cur);
  }
  const final = snaps.length ? {
    totals: mergeTotals(snaps),
    byKind: mergeMaps(snaps, 'byKind'),
    byFormat: mergeMaps(snaps, 'byFormat'),
    bySite: [...bySiteMap.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 200),
    resources: snaps.flatMap((s) => s.resources.map((r) => ({ ...r, target: s.target })))
      .sort((a, b) => b.bytes - a.bytes).slice(0, topN),
    contexts: snaps.map((s) => ({ target: s.target, devices: s.devices, installedAtMs: s.installedAtMs })),
  } : null;
  if (!final) log('WARNING: the tracker saw no WebGPU activity. Report will contain OS-level samples only.');

  const capture = {
    schema: 'genesys-gpumem/1',
    capturedAt: new Date().toISOString(),
    url: pageUrl,
    title: pageTitle ?? '',
    trackingFrom,
    warmupSeconds: warmup,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    intervalSeconds: intervalMs / 1000,
    hookOptions,
    webgpuAvailable: envInfo.webgpu,
    gpu: gpuInfo,
    samples,
    final,
    nodeVersion: process.version,
    platform: process.platform,
    projectCwd: process.cwd(),
  };
  writeFileSync(outFile, `${JSON.stringify(capture, null, 1)}\n`);
  cdp.close();
  browser?.close();
  log(`saved ${outFile}`);
  console.log(outFile);
}

main().then(() => { stopChrome(chromeHandle, { keep: flags['keep-chrome'] === 'true' }); process.exit(0); })
  .catch((e) => { console.error(e.message ?? e); stopChrome(chromeHandle, { keep: flags['keep-chrome'] === 'true' }); process.exit(1); });
