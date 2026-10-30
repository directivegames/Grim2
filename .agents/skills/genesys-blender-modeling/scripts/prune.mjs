#!/usr/bin/env node
// Prune .scratch/blender: sheets, pose renders and bake images whose blender/<folder> is gone,
// state files of deleted folders, and temp folders left by crashed runs. Dry run by default.
// Run from the game project root (blender.sh prune calls this):
//
//   blender.sh prune            list what would go, with sizes
//   blender.sh prune --apply    delete it
//   blender.sh prune --all      also clear sheets/ (model sheets) and cache/ (converted engine GLBs)
//
// Kept: every file a live folder's last build wrote (state/<folder>.json "files"), and
// <folder>.png / <folder>-look.png for every folder under blender/.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apply = process.argv.includes('--apply');
const all = process.argv.includes('--all');
const scr = path.join(root, '.scratch', 'blender');
if (!fs.existsSync(scr)) {
  console.log('RESULT ok — no .scratch/blender folder');
  process.exit(0);
}
const live = new Set(
  (fs.existsSync(path.join(root, 'blender')) ? fs.readdirSync(path.join(root, 'blender'), { withFileTypes: true }) : [])
    .filter((e) => e.isDirectory()).map((e) => e.name),
);
const sizeOf = (p) => {
  const st = fs.statSync(p);
  if (!st.isDirectory()) return st.size;
  return fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0);
};
const fmt = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

const keep = new Set();
const drop = [];
const stateDir = path.join(scr, 'state');
for (const f of fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : []) {
  const name = f.replace(/\.json$/, '');
  let st = {};
  try { st = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf8')); } catch { /* unreadable: treat as stale */ }
  if (live.has(name)) (st.files || []).forEach((x) => keep.add(x));
  else drop.push([path.join(stateDir, f), `state of deleted folder blender/${name}`]);
}
const owned = (file) => {
  const stem = file.replace(/\.[^.]+$/, '');
  for (const n of live) if (stem === n || stem === `${n}-look`) return true;
  return false;
};
for (const e of fs.readdirSync(scr, { withFileTypes: true })) {
  const p = path.join(scr, e.name);
  if (e.isDirectory()) {
    if (e.name === 'tmp') {
      for (const t of fs.readdirSync(p)) {
        const age = (Date.now() - fs.statSync(path.join(p, t)).mtimeMs) / 60000;
        if (age > 30) drop.push([path.join(p, t), `temp folder of a run that ended ${Math.round(age)} min ago without cleaning up`]);
      }
    } else if (all && (e.name === 'sheets' || e.name === 'cache')) {
      drop.push([p, e.name === 'sheets' ? 'model sheets (--all)' : 'converted engine GLBs (--all; rebuilt on demand)']);
    } else if (!['state', 'sheets', 'cache'].includes(e.name)) {
      drop.push([p, 'folder no build writes']);
    }
    continue;
  }
  if (keep.has(e.name) || owned(e.name)) continue;
  drop.push([p, 'no folder under blender/ owns it']);
}
let total = 0;
for (const [p, why] of drop) {
  const b = sizeOf(p);
  total += b;
  console.log(`${apply ? 'DELETE' : 'WOULD DELETE'} ${path.relative(root, p)}  ${fmt(b)}  (${why})`);
  if (apply) fs.rmSync(p, { recursive: true, force: true });
}
console.log(drop.length
  ? `RESULT ${apply ? 'deleted' : 'dry run:'} ${drop.length} item(s), ${fmt(total)}${apply ? '' : ' — run `blender.sh prune --apply` to delete'}`
  : 'RESULT ok — nothing to prune');
