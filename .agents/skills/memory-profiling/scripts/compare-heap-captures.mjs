// Compare two heap captures (or their .summary.json sidecars) for before/after work.
//
// Usage:
//   node compare-heap-captures.mjs <before> <after> [--out=diff.txt]
//
// Each argument may be a .heapsnapshot / .heaptimeline or a .summary.json.
// Missing summaries are built with analyze-heap-retained.mjs --json-only.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const analyzer = path.join(__dirname, 'analyze-heap-retained.mjs');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));

if (args.length < 2) {
  console.error(`Usage: node compare-heap-captures.mjs <before> <after> [--out=<file>]`);
  process.exit(1);
}

const fmt = (b) => {
  const v = Math.abs(b);
  if (v < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB'];
  let s = v / 1024;
  let i = 0;
  while (s >= 1024 && i < 2) { s /= 1024; i++; }
  return `${b < 0 ? '-' : ''}${s.toFixed(s >= 100 ? 0 : s >= 10 ? 1 : 2)} ${u[i]}`;
};

function summaryPathFor(capturePath) {
  const resolved = path.resolve(capturePath);
  if (resolved.endsWith('.summary.json')) return resolved;
  return path.join(
    path.dirname(resolved),
    `${path.basename(resolved).replace(/\.(heaptimeline|heapsnapshot)$/, '')}.summary.json`,
  );
}

function ensureSummary(captureOrSummary) {
  const resolved = path.resolve(captureOrSummary);
  const summaryPath = summaryPathFor(resolved);
  if (existsSync(summaryPath)) return summaryPath;
  if (!/\.(heaptimeline|heapsnapshot)$/.test(resolved)) {
    throw new Error(`not a capture or summary: ${resolved}`);
  }
  const r = spawnSync(
    process.execPath,
    ['--max-old-space-size=20000', analyzer, resolved, '--json-only'],
    { stdio: 'inherit', encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`analyzer failed for ${resolved}`);
  if (!existsSync(summaryPath)) throw new Error(`expected ${summaryPath} after analyze`);
  return summaryPath;
}

function indexBy(list, key) {
  const m = new Map();
  for (const row of list) m.set(row[key], row);
  return m;
}

function diffMaps(before, after, key, retainedKey, limit = 20) {
  const b = indexBy(before, key);
  const a = indexBy(after, key);
  const keys = new Set([...b.keys(), ...a.keys()]);
  const rows = [];
  for (const k of keys) {
    const br = b.get(k)?.[retainedKey] ?? 0;
    const ar = a.get(k)?.[retainedKey] ?? 0;
    const delta = ar - br;
    if (br === 0 && ar === 0) continue;
    rows.push({ key: k, before: br, after: ar, delta });
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return rows.slice(0, limit);
}

async function main() {
  const beforeSummary = ensureSummary(args[0]);
  const afterSummary = ensureSummary(args[1]);
  const before = JSON.parse(await readFile(beforeSummary, 'utf8'));
  const after = JSON.parse(await readFile(afterSummary, 'utf8'));

  const outPath = path.resolve(
    flags.out ?? path.join(
      path.dirname(afterSummary),
      `compare-${before.capture}-vs-${after.capture}.txt`,
    ),
  );

  const L = [];
  L.push(`Compare: ${before.capture}  ->  ${after.capture}`);
  L.push(`Live heap: ${fmt(before.liveTotal)} -> ${fmt(after.liveTotal)}  (${fmt(after.liveTotal - before.liveTotal)} delta)`);
  const beforeStacks = before.allocationStacks ?? before.timeline ?? false;
  const afterStacks = after.allocationStacks ?? after.timeline ?? false;
  if (beforeStacks !== afterStacks) {
    L.push('');
    L.push(
      `Capture kind mismatch: before allocationStacks=${beforeStacks}, after=${afterStacks}. `
      + 'Retained totals and constructors are still comparable; allocation call trees are only on timelines.',
    );
  }
  L.push('');

  L.push('== Largest constructor deltas (retained) ==');
  for (const { key, before: br, after: ar, delta } of diffMaps(before.constructors, after.constructors, 'name', 'retained', 25)) {
    L.push(`${fmt(delta).padStart(10)}  ${fmt(br).padStart(9)} -> ${fmt(ar).padStart(9)}  ${key}`);
  }
  L.push('');

  L.push('== Largest named retainer deltas ==');
  for (const { key, before: br, after: ar, delta } of diffMaps(before.namedRetainers, after.namedRetainers, 'label', 'retained', 20)) {
    L.push(`${fmt(delta).padStart(10)}  ${fmt(br).padStart(9)} -> ${fmt(ar).padStart(9)}  ${key}`);
  }
  L.push('');

  L.push('== Pattern hits only in AFTER (new or grown >= 2 MB) ==');
  const beforePatterns = new Map((before.patterns ?? []).map((p) => [p.id, p]));
  for (const p of after.patterns ?? []) {
    const prev = beforePatterns.get(p.id);
    const delta = p.retained - (prev?.retained ?? 0);
    if (delta >= 2 * 1024 * 1024 || (!prev && p.retained >= 2 * 1024 * 1024)) {
      L.push(`${fmt(delta).padStart(10)}  [${p.kind}] ${p.id}: ${p.message}`);
    }
  }
  L.push('');

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${L.join('\n')}\n`);
  console.error(`wrote ${outPath}`);
  console.log(outPath);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
