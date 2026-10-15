// Records a Chrome heap capture from the command line, with no dependencies.
//
// Produces the same files the DevTools Memory panel saves, so the output feeds
// straight into analyze-heap-retained.mjs:
//   timeline  -> <name>.heaptimeline   (allocation instrumentation on timeline)
//   snapshot  -> <name>.heapsnapshot   (plain heap snapshot)
//
// This captures the JavaScript heap only. For GPU memory use capture-gpu.mjs.
//
// Two ways to reach the game page:
//   --url=<url>      Launch a clean Chrome (temporary profile, no extensions,
//                    no DevTools window, local HTTPS certificates accepted)
//                    and open the URL. Use it with the project's dev server.
//   --attach=<port>  Attach to a running Chrome or Electron app (for example
//                    Genesys Studio) that was started with
//                    --remote-debugging-port=<port>.
//
// Usage:
//   node capture-heap.mjs --attach=9222 --duration=60
//   node capture-heap.mjs --url=http://localhost:5173 --warmup=15 --duration=60
//   node capture-heap.mjs --attach=9222 --list
//
// Stop a timeline early with Enter (interactive terminal), by creating the
// stop file printed at startup, or with Ctrl+C. Requires Node 22+ (global
// WebSocket).
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  Cdp, defaultCaptureDir, fmtMB, launchChrome, parseFlags, pickPage, sleep, stopChrome, waitFor, waitForPageReady,
} from './cdp-common.mjs';

const flags = parseFlags();

if (flags.help || (!flags.url && !flags.attach)) {
  console.error(`Usage: node capture-heap.mjs (--url=<url> | --attach=<port>) [options]
  --mode=timeline|snapshot   timeline (default) records allocation stacks; snapshot is a single plain snapshot
  --duration=<seconds>       timeline: stop after this long; snapshot: wait this long before capturing
  --warmup=<seconds>         wait after page load before recording (default 15 with --url, 0 with --attach)
  --wait-for-load=<bool>     with --url: wait for document.readyState complete (default true)
  --wait-for-expression=<js> wait until this expression is truthy (e.g. window.__GAME_READY__)
  --target=<substring>       with --attach: page URL to pick (default: play-in-editor, then the first page)
  --list                     with --attach: print the available pages and exit
  --out=<dir>                output folder (default: <project>/.genesys/captures)
  --name=<label>             file name prefix (default: Heap)
  --chrome=<path>            Chrome executable for --url (default: auto-detect)
  --headless                 run the launched Chrome headless (WebGPU games usually need a window)
  --keep-chrome              do not close Chrome when the script exits
  --stop-file=<path>         creating this file stops the recording (default: <out>/STOP)
  --no-gc                    skip the forced GC before the capture

JavaScript heap only. For GPU memory use capture-gpu.mjs.`);
  process.exit(flags.help ? 0 : 1);
}

const log = (...a) => console.error('[capture-heap]', ...a);
const mode = flags.mode ?? 'timeline';
if (mode !== 'timeline' && mode !== 'snapshot') throw new Error(`--mode must be timeline or snapshot, got ${mode}`);

const outDir = path.resolve(flags.out ?? defaultCaptureDir());
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const baseLabel = flags.name ?? 'Heap';
const outFile = path.join(outDir, `${baseLabel}-${stamp}.${mode === 'timeline' ? 'heaptimeline' : 'heapsnapshot'}`);
const metaFile = path.join(outDir, `${baseLabel}-${stamp}.meta.json`);
const stopFile = path.resolve(flags['stop-file'] ?? path.join(outDir, 'STOP'));

let chromeHandle = null;
process.on('exit', () => stopChrome(chromeHandle, { keep: flags['keep-chrome'] === 'true' }));

async function resolveEndpoint() {
  if (flags.attach) {
    const hostPort = flags.attach.includes(':') ? flags.attach : `127.0.0.1:${flags.attach}`;
    return `http://${hostPort}`;
  }
  // about:blank first so CDP can trust mkcert / local HTTPS before the game URL loads.
  chromeHandle = await launchChrome({ chrome: flags.chrome, startUrl: 'about:blank', headless: Boolean(flags.headless), log });
  return chromeHandle.endpoint;
}

async function waitForStop(seconds) {
  const deadline = seconds > 0 ? Date.now() + seconds * 1000 : Infinity;
  let stop = false;
  const onStdin = () => { stop = true; };
  if (process.stdin.isTTY) { process.stdin.setRawMode?.(false); process.stdin.resume(); process.stdin.once('data', onStdin); }
  process.once('SIGINT', onStdin);
  mkdirSync(path.dirname(stopFile), { recursive: true });
  rmSync(stopFile, { force: true });
  while (!stop && Date.now() < deadline && !existsSync(stopFile)) await sleep(250);
  rmSync(stopFile, { force: true });
  process.stdin.pause();
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

  if (flags.url) {
    log(`opening ${flags.url}`);
    await cdp.send('Page.enable');
    await cdp.send('Page.navigate', { url: flags.url });
    await waitFor(
      async () => (await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result.value !== 'about:blank',
      'the page to start loading', 60000,
    );
  }

  await waitForPageReady(cdp, flags, log);

  const warmup = Number(flags.warmup ?? (flags.url ? 15 : 0));
  if (warmup > 0) { log(`warming up for ${warmup}s`); await sleep(warmup * 1000); }

  await cdp.send('HeapProfiler.enable');
  const usage = async (label) => {
    const u = await cdp.send('Runtime.getHeapUsage');
    log(`${label}: heap used ${fmtMB(u.usedSize)} of ${fmtMB(u.totalSize)}`);
  };
  const forceGc = async () => {
    if (flags['no-gc']) return;
    for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
  };

  await forceGc();
  await usage('before');

  if (mode === 'timeline') {
    await cdp.send('HeapProfiler.startTrackingHeapObjects', { trackAllocations: true });
    log(`recording allocations. Play the scenario now; the game runs slower while recording.`);
    log(`stop: press Enter${flags.duration ? `, wait ${flags.duration}s,` : ''} or create ${stopFile}`);
    await waitForStop(Number(flags.duration ?? 0));
    log('stopping');
    await forceGc();
  } else if (Number(flags.duration) > 0) {
    log(`waiting ${flags.duration}s before the snapshot`);
    await sleep(Number(flags.duration) * 1000);
    await forceGc();
  }
  await usage('after');

  const stream = createWriteStream(outFile);
  let bytes = 0;
  cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => { bytes += chunk.length; stream.write(chunk); });
  log('writing the capture (large games take a minute)');
  if (mode === 'timeline') await cdp.send('HeapProfiler.stopTrackingHeapObjects', { reportProgress: false });
  else await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  await new Promise((res) => stream.end(res));
  cdp.close();

  const meta = {
    capturedAt: new Date().toISOString(),
    url: page.url,
    title: page.title ?? '',
    mode,
    warmupSeconds: warmup,
    durationSeconds: Number(flags.duration ?? 0) || null,
    waitForExpression: flags['wait-for-expression'] ?? null,
    waitForLoad: flags['wait-for-load'] !== 'false',
    outFile,
    nodeVersion: process.version,
    projectCwd: process.cwd(),
  };
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);

  log(`saved ${fmtMB(bytes)} to ${outFile}`);
  log(`metadata ${metaFile}`);
  console.log(outFile);
}

main().then(() => { stopChrome(chromeHandle, { keep: flags['keep-chrome'] === 'true' }); process.exit(0); })
  .catch((e) => { console.error(e.message ?? e); stopChrome(chromeHandle, { keep: flags['keep-chrome'] === 'true' }); process.exit(1); });
