// Analyzes a <name>.gpumem.json written by capture-gpu.mjs.
//
// Usage:
//   node analyze-gpu-memory.mjs <capture.gpumem.json> [options]
// Options:
//   --perf-snapshot=<file>  engine PerformanceSnapshotV1 JSON (console command `perf.snapshot`)
//                           to cross-check the engine's own GPU accounting
//   --project=<regex>       frame URL pattern for "project code" (default: /src/|/packs/|.dist/|@fs/)
//   --top=<n>               rows in the largest-resources table (default 25)
//   --out=<file>            text report path (default: next to the capture, <name>.gpu.txt)
//   --json-out=<file>       summary path (default: <name>.gpu.summary.json)
//   --json-only / --no-json
//
// Reads one capture; never re-runs the game. Output sections:
//   0 Summary   1 By kind   2 Textures by format   3 Largest resources
//   4 By creation site   5 Over time   6 Hints   7 Engine cross-check
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MiB = 1048576;
export const fmt = (b) => {
  if (b == null || Number.isNaN(b)) return 'n/a';
  const v = Math.abs(b);
  const sign = b < 0 ? '-' : '';
  if (v < 1024) return `${b} B`;
  if (v < MiB) return `${sign}${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * MiB) return `${sign}${(v / MiB).toFixed(v >= 100 * MiB ? 0 : 1)} MB`;
  return `${sign}${(v / (1024 * MiB)).toFixed(2)} GB`;
};
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : '-');
const pad = (s, n) => String(s).padStart(n);
const readJson = async (file) => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));

// 8-bit color formats are the ones block compression (BC7/ASTC) replaces. HDR formats are handled by the float hint.
const UNCOMPRESSED_COLOR = /^(rgba8|bgra8)/;
const FLOAT_RT = /^(rgba16float|rgba32float|rg32float|rg16float)/;

/** Pure analysis of a parsed capture; exported for tests. */
export function analyzeCapture(capture, { project = '/src/|/packs/|\\.dist/|@fs/', top = 25, perf = null } = {}) {
  const projectRe = new RegExp(project);
  const NOISE = /node_modules|\/deps\/|@gnsx|three|webgpu/i;
  const siteOf = (stack) => {
    const lines = (stack || '').split('\n').filter(Boolean);
    const frame = lines.find((l) => projectRe.test(l)) ?? lines.find((l) => !NOISE.test(l)) ?? lines[0];
    return frame ? frame.replace(/\?[^:)\s]*/g, '') : '(no stack recorded)';
  };

  const final = capture.final;
  const samples = capture.samples ?? [];
  const lastOs = [...samples].reverse().find((s) => s.os?.process)?.os ?? null;
  const osSamples = samples.filter((s) => s.os?.process);
  const osPeakDedicated = osSamples.reduce((m, s) => Math.max(m, s.os.process.dedicatedBytes), 0);
  const trackedLive = final?.totals?.liveBytes ?? 0;
  const resources = final?.resources ?? [];

  // by kind / format
  const kinds = Object.entries(final?.byKind ?? {}).map(([k, v]) => ({ kind: k, ...v })).sort((a, b) => b.bytes - a.bytes);
  const formats = Object.entries(final?.byFormat ?? {}).map(([k, v]) => ({ format: k, ...v })).sort((a, b) => b.bytes - a.bytes);

  // by creation site
  const siteMap = new Map();
  for (const e of final?.bySite ?? []) {
    const key = siteOf(e.stack);
    const cur = siteMap.get(key) ?? { site: key, count: 0, bytes: 0, example: e.stack };
    cur.count += e.count; cur.bytes += e.bytes;
    siteMap.set(key, cur);
  }
  const sites = [...siteMap.values()].sort((a, b) => b.bytes - a.bytes);

  // identical resources (same site, label, shape) are shown once with a count
  const groupMap = new Map();
  for (const r of resources.filter((x) => x.bytes >= 64 * 1024)) {
    const key = [r.kind, r.label, r.format, r.width, r.height, r.depth, r.mips, r.samples, r.usageNames, r.target, siteOf(r.stack), r.bytes].join('|');
    const g = groupMap.get(key) ?? { count: 0, each: r.bytes, bytes: 0, sample: r };
    g.count++; g.bytes += r.bytes;
    groupMap.set(key, g);
  }
  const topGroups = [...groupMap.values()].sort((a, b) => b.bytes - a.bytes);

  // churn over the recording
  const first = samples.find((s) => s.totals?.createdCount != null);
  const lastS = [...samples].reverse().find((s) => s.totals?.createdCount != null);
  const churn = first && lastS && first !== lastS ? {
    created: lastS.totals.createdCount - first.totals.createdCount,
    destroyed: lastS.totals.destroyedCount - first.totals.destroyedCount,
    gcReleased: lastS.totals.gcReleasedCount - first.totals.gcReleasedCount,
    createdBytes: lastS.totals.createdBytes - first.totals.createdBytes,
    liveDeltaBytes: lastS.trackedBytes - first.trackedBytes,
    seconds: lastS.t - first.t,
  } : null;

  // hints
  const hints = [];
  /** Describes the first few distinct items; identical ones collapse into "(xN)". */
  const examplesOf = (list, describe, n = 5) => {
    const counts = new Map();
    for (const r of list) { const k = describe(r); counts.set(k, (counts.get(k) ?? 0) + 1); }
    return [...counts].slice(0, n).map(([k, c]) => (c > 1 ? `${k}  (x${c})` : k));
  };
  const sampled = resources.filter((r) => r.kind === 'texture:sampled');
  const rawColor = sampled.filter((r) => UNCOMPRESSED_COLOR.test(r.format) && r.bytes >= MiB);
  if (rawColor.length) {
    const bytes = rawColor.reduce((s, r) => s + r.bytes, 0);
    hints.push({
      id: 'uncompressed-textures', severity: bytes >= 16 * MiB ? 'high' : 'medium', bytes,
      message: `${rawColor.length} sampled textures >= 1 MB are stored uncompressed (${fmt(bytes)}). GPU block compression (BC7 on desktop, ASTC on mobile, via KTX2) is about 4x smaller (save roughly ${fmt(bytes * 0.75)}).`,
      examples: examplesOf(rawColor, (r) => `${r.label || '(no label)'} ${r.width}x${r.height} ${r.format} ${fmt(r.bytes)}`),
    });
  }
  const noMips = sampled.filter((r) => r.mips === 1 && r.dimension === '2d' && r.bytes >= 2 * MiB && r.width >= 512);
  if (noMips.length) {
    const bytes = noMips.reduce((s, r) => s + r.bytes, 0);
    hints.push({
      id: 'no-mip-chain', severity: 'info', bytes,
      message: `${noMips.length} large sampled textures have no mip chain (${fmt(bytes)}). That is correct for UI, lightmaps and data textures. For world textures it causes shimmering at distance, and adding mips costs about 33% more.`,
      examples: examplesOf(noMips, (r) => `${r.label || '(no label)'} ${r.width}x${r.height} ${r.format}`),
    });
  }
  const floatRt = resources.filter((r) => (r.kind === 'texture:renderTarget' || r.kind === 'texture:sampled') && FLOAT_RT.test(r.format) && r.bytes >= 8 * MiB);
  if (floatRt.length) {
    const bytes = floatRt.reduce((s, r) => s + r.bytes, 0);
    hints.push({
      id: 'float-targets', severity: 'medium', bytes,
      message: `${floatRt.length} large floating-point textures (${fmt(bytes)}). Check that the precision is needed; rgba16float is half of rgba32float and rg11b10ufloat is a quarter for HDR color.`,
      examples: examplesOf(floatRt, (r) => `${r.label || '(no label)'} ${r.width}x${r.height} ${r.format} ${fmt(r.bytes)}`),
    });
  }
  const rtBytes = (final?.byKind?.['texture:renderTarget']?.bytes ?? 0) + (final?.byKind?.['texture:depth']?.bytes ?? 0);
  if (trackedLive && rtBytes / trackedLive >= 0.25 && rtBytes >= 32 * MiB) {
    hints.push({
      id: 'render-target-share', severity: 'medium', bytes: rtBytes,
      message: `Render targets and depth buffers are ${pct(rtBytes, trackedLive)} of tracked GPU memory (${fmt(rtBytes)}). Resolution scale, pooling transient targets, or dropping unused post effects are the levers.`,
    });
  }
  const dupMap = new Map();
  for (const r of resources.filter((x) => x.type === 'texture' && x.label && x.bytes >= MiB)) {
    const key = `${r.label}|${r.format}|${r.width}x${r.height}x${r.depth}|${r.mips}`;
    const e = dupMap.get(key) ?? { r, count: 0 };
    e.count++; dupMap.set(key, e);
  }
  const dups = [...dupMap.values()].filter((e) => e.count > 1);
  if (dups.length) {
    const bytes = dups.reduce((s, e) => s + e.r.bytes * (e.count - 1), 0);
    hints.push({
      id: 'duplicate-textures', severity: 'high', bytes,
      message: `${dups.length} textures exist more than once with the same label, size and format (${fmt(bytes)} extra). The same image is probably loaded twice or cloned per instance.`,
      examples: dups.slice(0, 5).map((e) => `${e.r.label} x${e.count} ${e.r.width}x${e.r.height} ${e.r.format}`),
    });
  }
  const staging = final?.byKind?.['buffer:staging'];
  if (staging && staging.bytes >= 4 * MiB) {
    hints.push({
      id: 'staging-buffers', severity: 'medium', bytes: staging.bytes,
      message: `${staging.count} mappable (upload/readback) buffers still live (${fmt(staging.bytes)}). Staging buffers should be destroyed right after the copy.`,
    });
  }
  const t = final?.totals;
  if (t && t.gcReleasedCount >= 10 && t.gcReleasedCount >= t.destroyedCount * 0.25) {
    hints.push({
      id: 'relies-on-gc', severity: 'medium', bytes: t.gcReleasedBytes,
      message: `${t.gcReleasedCount} GPU resources (${fmt(t.gcReleasedBytes)}) were never destroyed and were freed only when the JavaScript object was garbage collected, versus ${t.destroyedCount} explicit destroys. Memory stays high until GC runs; call destroy()/dispose() as soon as the resource is unused.`,
    });
  }
  if (churn && churn.seconds >= 20 && churn.liveDeltaBytes > Math.max(8 * MiB, trackedLive * 0.1)) {
    hints.push({
      id: 'growth', severity: 'high', bytes: churn.liveDeltaBytes,
      message: `Tracked GPU memory grew by ${fmt(churn.liveDeltaBytes)} in ${churn.seconds.toFixed(0)}s (${churn.created} created, ${churn.destroyed} destroyed). Suspected leak; confirm by repeating the scenario and comparing with compare-gpu-captures.mjs.`,
    });
  }
  if (lastOs && trackedLive && capture.trackingFrom !== 'attach') {
    const gap = lastOs.process.dedicatedBytes - trackedLive;
    if (gap > 64 * MiB && lastOs.process.dedicatedBytes > trackedLive * 1.5) {
      hints.push({
        id: 'untracked-gap', severity: 'info', bytes: gap,
        message: `The driver reports ${fmt(lastOs.process.dedicatedBytes)} dedicated memory for the GPU process but the tracker accounts for ${fmt(trackedLive)} (gap ${fmt(gap)}). The gap is usually the browser compositor, swap chains, compiled shader pipelines, driver padding and other tabs. If it is large with a clean browser, suspect swap-chain or canvas size, or WebGL contexts.`,
      });
    }
  }
  if (capture.trackingFrom === 'attach') {
    hints.push({
      id: 'late-tracking', severity: 'info', bytes: 0,
      message: 'Tracker was attached after the page loaded; resources created earlier are not counted. Re-run with --reload (or --url) for a complete picture.',
    });
  }
  hints.sort((a, b) =>  ({ high: 0, medium: 1, info: 2 }[a.severity] - { high: 0, medium: 1, info: 2 }[b.severity]) || b.bytes - a.bytes);

  // engine cross-check
  let engine = null;
  if (perf) {
    const gpu = perf.memory?.gpu ?? null;
    engine = {
      schemaVersion: perf.schemaVersion ?? null,
      totalBytes: gpu?.totalBytes ?? null,
      textures: gpu?.textures ?? null,
      attributes: gpu?.attributes ?? null,
      indexAttributes: gpu?.indexAttributes ?? null,
      storageAttributes: gpu?.storageAttributes ?? null,
      programs: gpu?.programs ?? null,
      renderTargets: gpu?.renderTargets ?? null,
      depthTextures: gpu?.depthTextures ?? null,
      topTextures: (perf.memory?.topTextures ?? []).slice(0, 15),
      topTexturesTotal: perf.memory?.topTexturesTotal ?? null,
      topGpuTextures: (perf.memory?.topGpuTextures ?? []).slice(0, 15),
      topGpuTexturesTotal: perf.memory?.topGpuTexturesTotal ?? null,
    };
  }

  return {
    capture: capture.name ?? null,
    url: capture.url,
    trackingFrom: capture.trackingFrom,
    durationSeconds: capture.durationSeconds,
    gpuDevices: (capture.gpu?.devices ?? []).map((d) => d.deviceString || d.vendorString).filter(Boolean),
    trackedLiveBytes: trackedLive,
    trackedPeakBytes: final?.totals?.peakBytes ?? 0,
    totals: final?.totals ?? null,
    contexts: final?.contexts ?? [],
    osLast: lastOs,
    osPeakDedicatedBytes: osPeakDedicated,
    kinds, formats, sites: sites.slice(0, 30), churn,
    topResources: resources.filter((r) => r.bytes >= 64 * 1024).slice(0, top),
    topResourceGroups: topGroups.slice(0, top).map((g) => ({ count: g.count, eachBytes: g.each, bytes: g.bytes, site: siteOf(g.sample.stack), resource: g.sample })),
    hints, engine,
    // internal helpers for the text report
    _samples: samples, _siteOf: siteOf, _resourceCount: resources.length,
  };
}

function textReport(a, capture, name, top) {
  const L = [];
  L.push(`GPU capture ${name}  (${capture.url})`);
  L.push(`Recorded ${a.durationSeconds}s; tracker installed ${a.trackingFrom === 'attach' ? 'AFTER page load (partial)' : 'before the game started (complete)'}; contexts: ${(a.contexts.map((c) => c.target).join(', ')) || 'none'}`);
  if (a.gpuDevices.length) L.push(`GPUs reported by Chrome: ${a.gpuDevices.join('; ')}`);
  L.push('');

  L.push('== 0. Summary ==');
  if (!capture.final) {
    L.push('The tracker saw no WebGPU activity. The game is probably using WebGL, or never created a device.');
    L.push('Only OS-level counters (below, when available) and the engine snapshot (--perf-snapshot) can describe this run.');
  } else {
    const t = a.totals;
    L.push(`Tracked GPU memory held right now: ${fmt(a.trackedLiveBytes)} in ${t.liveCount} resources (peak ${fmt(a.trackedPeakBytes)}).`);
    L.push(`Lifetime: ${t.createdCount} created (${fmt(t.createdBytes)}), ${t.destroyedCount} destroyed (${fmt(t.destroyedBytes)}), ${t.gcReleasedCount} freed only by GC (${fmt(t.gcReleasedBytes)}).`);
  }
  if (a.osLast) {
    L.push(`OS view of the browser GPU process: ${fmt(a.osLast.process.dedicatedBytes)} dedicated (peak ${fmt(a.osPeakDedicatedBytes)}), ${fmt(a.osLast.process.sharedBytes)} shared system memory [${a.osLast.source}].`);
    for (const ad of a.osLast.adapters ?? []) L.push(`  whole-system adapter ${ad.instance}: ${fmt(ad.dedicatedBytes)} dedicated in use${ad.totalBytes ? ` of ${fmt(ad.totalBytes)}` : ''}, ${fmt(ad.sharedBytes ?? 0)} shared`);
    if (a.osLast.note) L.push(`  note: ${a.osLast.note}`);
    if (capture.final && capture.trackingFrom !== 'attach') {
      const gap = a.osLast.process.dedicatedBytes - a.trackedLiveBytes;
      L.push(gap >= 0
        ? `Not tracked by the page (driver, compositor, swap chain, other tabs): about ${fmt(gap)}.`
        : `The tracker counts ${fmt(-gap)} more than the driver reports. Resources that were created but never written or bound are often not backed by physical memory yet, so treat the tracker as the upper bound the game asked for and the OS number as what is resident now.`);
    }
  } else {
    const reason = (capture.samples ?? []).map((s) => s.os?.reason).find(Boolean);
    L.push(`OS-level GPU memory: unavailable${reason ? ` (${reason})` : ''}.`);
  }
  L.push('Integrated GPUs use system RAM as "shared"; on those, shared usage is the number that competes with the JavaScript heap.');
  L.push('');

  if (capture.final) {
    L.push('== 1. By kind ==');
    L.push(`${pad('MB', 10)} ${pad('share', 6)} ${pad('count', 7)}  kind`);
    for (const k of a.kinds) L.push(`${pad(fmt(k.bytes), 10)} ${pad(pct(k.bytes, a.trackedLiveBytes), 6)} ${pad(k.count, 7)}  ${k.kind}`);
    L.push('');

    L.push('== 2. Textures by format ==');
    L.push(`${pad('MB', 10)} ${pad('share', 6)} ${pad('count', 7)}  format`);
    for (const f of a.formats) L.push(`${pad(fmt(f.bytes), 10)} ${pad(pct(f.bytes, a.trackedLiveBytes), 6)} ${pad(f.count, 7)}  ${f.format}`);
    L.push('');

    L.push(`== 3. Largest live resources (top ${top}; identical resources are grouped) ==`);
    for (const g of a.topResourceGroups) {
      const r = g.resource;
      const dims = r.type === 'texture' ? ` ${r.width}x${r.height}${r.depth > 1 ? `x${r.depth}` : ''} ${r.format} mips=${r.mips}${r.samples > 1 ? ` msaa=${r.samples}` : ''}` : '';
      const count = g.count > 1 ? `${g.count} x ${fmt(g.eachBytes)} = ` : '';
      L.push(`${pad(count + fmt(g.bytes), 20)}  ${r.kind}${dims}  [${r.usageNames}]  "${r.label || ''}"${r.target && r.target !== 'page' ? `  in ${r.target}` : ''}${g.count === 1 ? `  age ${(r.ageMs / 1000).toFixed(0)}s` : ''}`);
      if (g.site && g.site !== '(no stack recorded)') L.push(`${' '.repeat(22)}at ${g.site}`);
    }
    L.push('');
    L.push('== 4. By creation site (nearest project frame; resources under the stack threshold are grouped) ==');
    for (const s of a.sites.slice(0, 20)) {
      L.push(`${pad(fmt(s.bytes), 9)} ${pad(s.count, 6)}x  ${s.site}`);
      const callers = (s.example || '').split('\n').filter((f) => f.replace(/\?[^:)\s]*/g, '') !== s.site).slice(0, 3);
      if (callers.length) L.push(`            called from: ${callers.join('  <-  ')}`);
    }
    L.push('');
  }

  L.push('== 5. Over time ==');
  const samples = a._samples;
  const stride = Math.max(1, Math.ceil(samples.length / 30));
  L.push(`${pad('t(s)', 7)} ${pad('tracked', 10)} ${pad('textures', 10)} ${pad('buffers', 10)} ${pad('OS dedic.', 10)} ${pad('OS shared', 10)} ${pad('JS heap', 10)}`);
  samples.forEach((s, i) => {
    if (i % stride && i !== samples.length - 1) return;
    const tex = Object.entries(s.byKind ?? {}).filter(([k]) => k.startsWith('texture:')).reduce((n, [, v]) => n + v.bytes, 0);
    const buf = Object.entries(s.byKind ?? {}).filter(([k]) => k.startsWith('buffer:')).reduce((n, [, v]) => n + v.bytes, 0);
    L.push(`${pad(s.t, 7)} ${pad(fmt(s.trackedBytes), 10)} ${pad(fmt(tex), 10)} ${pad(fmt(buf), 10)} ${pad(s.os?.process ? fmt(s.os.process.dedicatedBytes) : '-', 10)} ${pad(s.os?.process ? fmt(s.os.process.sharedBytes) : '-', 10)} ${pad(s.jsHeapUsed != null ? fmt(s.jsHeapUsed) : '-', 10)}`);
  });
  if (a.churn) L.push(`During the recording (${a.churn.seconds.toFixed(0)}s): ${a.churn.created} created (${fmt(a.churn.createdBytes)}), ${a.churn.destroyed} destroyed, ${a.churn.gcReleased} freed by GC; live ${fmt(a.churn.liveDeltaBytes)} change.`);
  L.push('A single capture is one lifecycle state. Growth over a steady scenario is a leak signal; compare two captures to confirm.');
  L.push('');

  L.push('== 6. Hints ==');
  if (!a.hints.length) L.push('  (nothing stands out)');
  for (const h of a.hints) {
    L.push(`  [${h.severity}] ${h.message}`);
    for (const ex of h.examples ?? []) L.push(`        - ${ex}`);
  }
  L.push('');

  if (a.engine) {
    L.push('== 7. Engine cross-check (perf.snapshot: renderer.info.memory + texture estimates) ==');
    const e = a.engine;
    if (e.totalBytes != null) L.push(`Engine total GPU bytes: ${fmt(e.totalBytes)}   tracker: ${fmt(a.trackedLiveBytes)}   difference: ${fmt(a.trackedLiveBytes - e.totalBytes)}`);
    for (const key of ['textures', 'attributes', 'indexAttributes', 'storageAttributes', 'programs']) {
      if (e[key]) L.push(`  engine ${key}: ${e[key].count} objects${e[key].sizeBytes != null ? `, ${fmt(e[key].sizeBytes)}` : ''}`);
    }
    if (e.renderTargets) {
      L.push(`  engine renderTargets: ${e.renderTargets.count}${e.renderTargets.sizeBytes != null ? `, ${fmt(e.renderTargets.sizeBytes)}` : ''}`);
    }
    if (e.depthTextures?.sizeBytes != null) {
      L.push(`  engine depthTextures: ${e.depthTextures.count}, ${fmt(e.depthTextures.sizeBytes)}`);
    }
    const trackedSampled = a.kinds.find((k) => k.kind === 'texture:sampled')?.bytes ?? 0;
    const trackedRt = a.kinds.find((k) => k.kind === 'texture:renderTarget')?.bytes ?? 0;
    const trackedDepth = a.kinds.find((k) => k.kind === 'texture:depth')?.bytes ?? 0;
    if (e.textures?.sizeBytes != null) L.push(`Sampled textures: engine ${fmt(e.textures.sizeBytes)} vs tracker ${fmt(trackedSampled)}.`);
    if (e.renderTargets?.sizeBytes != null) L.push(`Render targets: engine ${fmt(e.renderTargets.sizeBytes)} vs tracker ${fmt(trackedRt)}.`);
    if (e.depthTextures?.sizeBytes != null) L.push(`Depth attachments: engine ${fmt(e.depthTextures.sizeBytes)} vs tracker ${fmt(trackedDepth)}.`);
    L.push('Compressed formats and MSAA use estimates; uniform buffers and driver padding sit outside texture buckets.');
    if (e.topGpuTextures?.length) {
      L.push(`Engine's largest GPU textures (${e.topGpuTexturesTotal ?? e.topGpuTextures.length} at or above 1 MB; includes render targets and depth):`);
      for (const tx of e.topGpuTextures) {
        L.push(`  ${pad(fmt(tx.estimatedBytes), 9)}  [${tx.kind}]  ${tx.width}x${tx.height} ${tx.format}${tx.mipmaps ? '' : ' (no mips)'}  ${tx.name}`);
      }
    } else if (e.topTextures?.length) {
      L.push(`Engine's largest material textures (${e.topTexturesTotal ?? e.topTextures.length} at or above 1 MB; scene materials only):`);
      for (const tx of e.topTextures) L.push(`  ${pad(fmt(tx.estimatedBytes), 9)}  ${tx.width}x${tx.height} ${tx.format}${tx.mipmaps ? '' : ' (no mips)'}  ${tx.name}${tx.referencedBy?.length ? `  <- ${tx.referencedBy.slice(0, 3).join(', ')}` : ''}`);
    }
    L.push('');
  }
  return L;
}

async function main() {
  const flags = Object.fromEntries(process.argv.slice(2).filter((x) => x.startsWith('--')).map((x) => {
    const [k, ...v] = x.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }));
  const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  if (!positional[0]) {
    console.error('Usage: node analyze-gpu-memory.mjs <capture.gpumem.json> [--perf-snapshot=<file>] [--project=<regex>] [--top=<n>] [--out=<file>] [--json-only] [--no-json]');
    process.exit(1);
  }
  const inputPath = path.resolve(positional[0]);
  if (!inputPath.endsWith('.gpumem.json')) {
    console.error('Expected a .gpumem.json written by capture-gpu.mjs (this analyzer is for GPU memory; use analyze-heap-retained.mjs for .heapsnapshot/.heaptimeline).');
    process.exit(1);
  }
  const capture = await readJson(inputPath);
  if (capture.schema !== 'genesys-gpumem/1') throw new Error(`unsupported capture schema: ${capture.schema}`);
  const name = path.basename(inputPath).replace(/\.gpumem\.json$/, '');
  capture.name = name;
  const perf = flags['perf-snapshot'] ? await readJson(path.resolve(flags['perf-snapshot'])) : null;
  const top = Number(flags.top ?? 25);
  const a = analyzeCapture(capture, { project: flags.project, top, perf });

  const outPath = path.resolve(flags.out ?? path.join(path.dirname(inputPath), `${name}.gpu.txt`));
  const jsonPath = path.resolve(flags['json-out'] ?? path.join(path.dirname(inputPath), `${name}.gpu.summary.json`));
  await mkdir(path.dirname(outPath), { recursive: true });

  if (flags['json-only'] !== 'true') {
    await writeFile(outPath, `${textReport(a, capture, name, top).join('\n')}\n`);
    console.error(`wrote ${outPath}`);
  }
  if (flags['no-json'] !== 'true') {
    const { _samples, _siteOf, _resourceCount, ...summary } = a;
    summary.captureKind = 'gpumem';
    summary.samples = _samples.map((s) => ({
      t: s.t, trackedBytes: s.trackedBytes, trackedCount: s.trackedCount, jsHeapUsed: s.jsHeapUsed,
      osDedicatedBytes: s.os?.process?.dedicatedBytes ?? null, osSharedBytes: s.os?.process?.sharedBytes ?? null,
    }));
    summary.topResources = summary.topResources.map(({ stack, ...r }) => ({ ...r, site: _siteOf(stack) }));
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.error(`wrote ${jsonPath}`);
  }
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
}
