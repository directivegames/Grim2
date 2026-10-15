// Compares two GPU captures (before / after a fix, or two lifecycle states).
//
// Usage:
//   node compare-gpu-captures.mjs <before> <after> [--out=<file>] [--project=<regex>]
//
// Each argument may be a .gpumem.json from capture-gpu.mjs or the
// .gpu.summary.json written by analyze-gpu-memory.mjs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeCapture, fmt } from './analyze-gpu-memory.mjs';

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (args.length < 2) {
  console.error('Usage: node compare-gpu-captures.mjs <before> <after> [--out=<file>] [--project=<regex>]');
  process.exit(1);
}

async function load(file) {
  const resolved = path.resolve(file);
  const json = JSON.parse(await readFile(resolved, 'utf8'));
  if (json.schema === 'genesys-gpumem/1') {
    json.name = path.basename(resolved).replace(/\.gpumem\.json$/, '');
    return { name: json.name, a: analyzeCapture(json, { project: flags.project }) };
  }
  if (json.captureKind === 'gpumem') return { name: json.capture ?? path.basename(resolved), a: json };
  throw new Error(`not a GPU capture or GPU summary: ${resolved}`);
}

function diff(before, after, key, limit) {
  const b = new Map(before.map((r) => [r[key], r]));
  const a = new Map(after.map((r) => [r[key], r]));
  const rows = [];
  for (const k of new Set([...b.keys(), ...a.keys()])) {
    const br = b.get(k)?.bytes ?? 0;
    const ar = a.get(k)?.bytes ?? 0;
    if (br === 0 && ar === 0) continue;
    rows.push({ key: k, before: br, after: ar, delta: ar - br, bc: b.get(k)?.count ?? 0, ac: a.get(k)?.count ?? 0 });
  }
  return rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, limit);
}

const [before, after] = await Promise.all([load(args[0]), load(args[1])]);
const L = [];
L.push(`GPU compare: ${before.name}  ->  ${after.name}`);
L.push(`Tracked live: ${fmt(before.a.trackedLiveBytes)} -> ${fmt(after.a.trackedLiveBytes)}  (${fmt(after.a.trackedLiveBytes - before.a.trackedLiveBytes)})`);
const bo = before.a.osLast?.process?.dedicatedBytes;
const ao = after.a.osLast?.process?.dedicatedBytes;
if (bo != null && ao != null) L.push(`OS GPU process dedicated: ${fmt(bo)} -> ${fmt(ao)}  (${fmt(ao - bo)})`);
const bs = before.a.osLast?.process?.sharedBytes;
const as = after.a.osLast?.process?.sharedBytes;
if (bs != null && as != null) L.push(`OS GPU process shared: ${fmt(bs)} -> ${fmt(as)}  (${fmt(as - bs)})`);
if (before.a.trackingFrom !== after.a.trackingFrom) {
  L.push(`WARNING: tracking differs (before: ${before.a.trackingFrom}, after: ${after.a.trackingFrom}); tracked totals are not comparable.`);
}
L.push('');

const section = (title, rows, label) => {
  L.push(`== ${title} ==`);
  for (const r of rows) L.push(`${fmt(r.delta).padStart(10)}  ${fmt(r.before).padStart(9)} -> ${fmt(r.after).padStart(9)}  (${r.bc} -> ${r.ac})  ${label(r.key)}`);
  L.push('');
};
section('By kind', diff(before.a.kinds, after.a.kinds, 'kind', 12), (k) => k);
section('Textures by format', diff(before.a.formats, after.a.formats, 'format', 12), (k) => k);
section('By creation site', diff(before.a.sites, after.a.sites, 'site', 15), (k) => k);

const beforeHints = new Set(before.a.hints.map((h) => h.id));
const added = after.a.hints.filter((h) => !beforeHints.has(h.id));
const afterHints = new Set(after.a.hints.map((h) => h.id));
const gone = before.a.hints.filter((h) => !afterHints.has(h.id));
L.push('== Hints ==');
for (const h of added) L.push(`  new      [${h.severity}] ${h.message}`);
for (const h of gone) L.push(`  resolved [${h.severity}] ${h.id}`);
if (!added.length && !gone.length) L.push('  (no change)');
L.push('');

const outPath = path.resolve(flags.out ?? path.join(path.dirname(path.resolve(args[1])), `compare-gpu-${before.name}-vs-${after.name}.txt`));
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${L.join('\n')}\n`);
console.error(`wrote ${outPath}`);
console.log(outPath);
