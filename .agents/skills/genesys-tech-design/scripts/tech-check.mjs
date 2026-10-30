#!/usr/bin/env node
// Check TECH.md against the project: module file ownership, work-package briefs, contracts,
// smoke-step ids and engine class names.
//
//   node <skills-root>/genesys-tech-design/scripts/tech-check.mjs [--root <project>] [--file TECH.md]
//
// Run from the game project root (the folder with package.json), or pass --root.
// Exit 0 = no FAIL lines (WARN lines are reported, and are work). Exit 1 = at least one FAIL. Exit 2 = usage.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: tech-check.mjs [--root <project-root>] [--file TECH.md]');
  process.exit(0);
}
const argVal = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
const root = argVal('--root') ? path.resolve(argVal('--root')) : findRoot(process.cwd());
if (!root || !fs.existsSync(path.join(root, 'package.json'))) {
  console.log('FAIL no package.json found; run from the game project root or pass --root');
  process.exit(2);
}
const techPath = path.join(root, argVal('--file') ?? 'TECH.md');
if (!fs.existsSync(techPath)) {
  // A single-agent build keeps its plan in GAME.md and writes no TECH.md (genesys-tech-design → Decide).
  console.log(`ok   ${path.relative(root, techPath)} not found: nothing to check (no code workers or handoff planned)`);
  process.exit(0);
}
const tech = fs.readFileSync(techPath, 'utf8');

let fails = 0, warns = 0;
const fail = (m) => { fails++; console.log(`FAIL ${m}`); };
const warn = (m) => { warns++; console.log(`WARN ${m}`); };
const ok = (m) => console.log(`ok   ${m}`);

// ---------- Markdown table helpers ----------
const lines = tech.split(/\r?\n/);
function sectionTable(headingRe) {
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && headingRe.test(l));
  if (start < 0) return null;
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith('|')) {
    if (/^#{1,3}\s/.test(lines[i])) return null; // next section before any table
    i++;
  }
  const rows = [];
  while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(lines[i]); i++; }
  if (rows.length < 2) return null;
  const split = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const header = split(rows[0]).map((h) => h.toLowerCase());
  const body = rows.slice(2).map(split).filter((cells) => cells.some((c) => c && !/^…$|^\.\.\.$/.test(c)));
  const col = (name) => header.findIndex((h) => h.includes(name));
  return { header, body, col, line: start + 1 };
}
const strip = (s) => (s ?? '').replace(/`/g, '').trim();

// ---------- Project files ----------
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}
const srcFiles = walk(path.join(root, 'src')).filter((f) => /\.(ts|tsx|js|mjs|css)$/.test(f));
const GENERATED = new Set(['src/auto-imports.ts', 'src/game-data.ts']);

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}
function expand(entry) {
  const p = entry.replace(/^\.\//, '').replace(/\s+—.*$/, '').replace(/\s+-\s+section.*$/i, '').trim();
  if (!p || p === '—' || p === '-') return { pattern: p, files: [] };
  if (p.includes('*')) {
    const re = globToRe(p.endsWith('/*') ? p + '*' : p);
    const all = walk(path.join(root, p.split('*')[0].replace(/\/[^/]*$/, '') || '.'));
    return { pattern: p, files: all.filter((f) => re.test(f)), glob: true };
  }
  if (p.endsWith('/')) return { pattern: p, files: walk(path.join(root, p)), glob: true };
  return { pattern: p, files: fs.existsSync(path.join(root, p)) ? [p] : [] };
}

// ---------- 1. Contracts ----------
const contractsLine = tech.match(/Contracts:\s*`?([^\s`·]+)`?/);
const contracts = contractsLine ? contractsLine[1] : 'src/contracts.ts';
if (/^(none|—|-)$/i.test(contracts)) warn('Contracts: none — fine for a single-agent build; write src/contracts.ts before briefing code workers');
else if (fs.existsSync(path.join(root, contracts))) ok(`contracts file ${contracts} exists`);
else if (/^##\s*1\./m.test(tech) && !/^##\s*4\./m.test(tech)) warn(`no ${contracts} (fine for TECH.md lite; required when code workers are briefed)`);
else fail(`contracts file ${contracts} is named in TECH.md but does not exist`);

// ---------- 2. Modules ----------
const mods = sectionTable(/modules/i);
const owner = new Map();
let modFails = 0;
if (!mods) fail('no Modules table (a "## 3. Modules" heading followed by a table)');
else {
  const cId = mods.col('id'), cMod = mods.col('module'), cOwns = mods.col('owns'), cStatus = mods.col('status'), cTier = mods.col('tier');
  if (cOwns < 0) fail(`Modules table (line ${mods.line}) has no "Owns files" column`);
  for (const r of mods.body) {
    const id = strip(r[cId >= 0 ? cId : 0]) || strip(r[cMod]);
    const status = strip(r[cStatus]).toLowerCase();
    const tier = strip(r[cTier]).toLowerCase();
    if (cTier >= 0 && tier && !/^(parent|strong|mid|small)\b/.test(tier)) warn(`${id}: tier "${tier}" is not parent | strong | mid | small`);
    if (cStatus >= 0 && status && !/^(planned|stub|in progress|done|cut)/.test(status)) warn(`${id}: status "${status}" is not planned | stub | in progress | done | cut`);
    if (cOwns < 0) continue;
    const entries = strip(r[cOwns]).split(/,|;|\s·\s/).map((s) => s.trim()).filter(Boolean);
    if (!entries.length) { warn(`${id}: owns no files`); continue; }
    for (const e of entries) {
      const { pattern, files, glob } = expand(e);
      if (!pattern || pattern === '—') continue;
      if (!files.length) {
        if (status.startsWith('planned') || status.startsWith('cut')) warn(`${id}: ${pattern} does not exist yet (${status || 'planned'})`);
        else { modFails++; fail(`${id}: owns ${pattern} but ${glob ? 'no file matches' : 'the file does not exist'}`); }
      }
      for (const f of files) {
        if (owner.has(f) && owner.get(f) !== id) { modFails++; fail(`${f} is owned by both ${owner.get(f)} and ${id}`); }
        else owner.set(f, id);
      }
    }
  }
  const unowned = srcFiles.filter((f) => !owner.has(f) && !GENERATED.has(f));
  if (unowned.length) warn(`${unowned.length} file(s) under src/ belong to no module: ${unowned.slice(0, 12).join(', ')}${unowned.length > 12 ? ', …' : ''}`);
  if (!modFails) ok(`Modules: ${mods.body.length} rows, ${owner.size} files owned, no overlaps`);
}

// ---------- 3. Work packages ----------
const wps = sectionTable(/work packages/i);
if (!wps) warn('no Work packages table (fine for TECH.md lite)');
else {
  const cWp = wps.col('wp'), cBrief = wps.col('brief'), cStatus = wps.col('status'), cTier = wps.col('tier');
  for (const r of wps.body) {
    const id = strip(r[cWp >= 0 ? cWp : 0]);
    const brief = strip(r[cBrief]);
    const status = strip(r[cStatus]).toLowerCase();
    const tier = strip(r[cTier]).toLowerCase();
    if (status && !/^(draft|ready|in progress|review|done|cut)/.test(status)) warn(`${id}: status "${status}" is not draft | ready | in progress | review | done | cut`);
    if (!brief || brief === '—' || brief === '-') {
      if (tier && !tier.startsWith('parent')) warn(`${id}: no brief file, but tier is ${tier} (only parent work may skip a brief)`);
      continue;
    }
    const bp = path.join(root, brief);
    if (!fs.existsSync(bp)) { fail(`${id}: brief ${brief} does not exist`); continue; }
    const text = fs.readFileSync(bp, 'utf8');
    for (const sec of ['Goal', 'Owns', 'Done when']) {
      if (!new RegExp(`^##\\s*${sec}`, 'mi').test(text)) fail(`${id}: brief has no "## ${sec}" section`);
    }
    if (/^(ready|in progress|review|done)/.test(status) && /<[^>\n]{2,80}>/.test(text.replace(/<skills-root>|<this-skill>/g, ''))) {
      warn(`${id}: brief is ${status} but still contains <placeholders>`);
    }
    if (status.startsWith('done')) {
      const v = text.match(/^Verified:\s*(.*)$/m);
      if (!v || !v[1].trim()) warn(`${id}: done, but the brief's "Verified:" line is empty (the parent records the evidence)`);
    }
  }
  ok(`Work packages: ${wps.body.length} rows checked`);
}

// ---------- 4. Smoke-step ids ----------
const ver = sectionTable(/verification plan/i);
if (!ver) warn('no Verification plan table');
else {
  const cStep = ver.col('step');
  const smokeText = srcFiles.filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const missing = [];
  for (const r of ver.body) {
    const id = strip(r[cStep >= 0 ? cStep : 0]);
    if (!id || id === '—') continue;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A step is found when a string literal in src/ starts with its id: name: 'S04 move right' or name: 'pause'.
    if (!new RegExp(`['"\`]${esc}(?![\\w-])`).test(smokeText)) missing.push(id);
  }
  if (missing.length) warn(`smoke step id(s) not found in src/: ${missing.join(', ')} (name each step with its id, e.g. name: 'S04 move right')`);
  else ok(`Verification plan: ${ver.body.length} steps, every id found in src/`);
}

// ---------- 5. Engine names in the mapping ----------
const map = sectionTable(/engine mapping/i);
if (!map) warn('no Engine mapping table');
else {
  const engineSrc = [path.join(root, '.engine', 'src'), path.join(root, 'node_modules', '@gnsx', 'genesys.js', 'dist')].find((p) => fs.existsSync(p));
  const cEng = map.col('engine');
  if (!engineSrc || cEng < 0) warn('engine source not found (.engine/src); skipped the class-name check');
  else {
    const names = new Set();
    const declRe = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|interface|type|enum|const|function)\s+([A-Za-z_]\w*)/g;
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) scan(full);
        else if (/\.(ts|d\.ts|js)$/.test(e.name)) {
          const t = fs.readFileSync(full, 'utf8');
          for (const m of t.matchAll(declRe)) names.add(m[1]);
        }
      }
    };
    scan(engineSrc);
    const unknown = [];
    for (const r of map.body) {
      for (const m of (r[cEng] ?? '').matchAll(/`(?:ENGINE\.)?([A-Z][A-Za-z0-9_]*)/g)) {
        if (!names.has(m[1])) unknown.push(m[1]);
      }
    }
    if (unknown.length) warn(`engine mapping names not found in ${path.relative(root, engineSrc)}: ${[...new Set(unknown)].join(', ')} (check the API digest: genesys-engine → Find an engine class)`);
    else ok(`Engine mapping: ${map.body.length} rows, every backticked class found in the engine`);
  }
}

console.log(`\nRESULT ${fails ? 'fail' : 'ok'} — ${fails} fail, ${warns} warn`);
process.exit(fails ? 1 : 0);
