#!/usr/bin/env node
// Asset ledger check. Compares the GAME.md `## Assets` table with what the game actually
// references, and checks asset weight and scratch hygiene. Run from the game project root:
//
//   node <skills-root>/genesys-assets/scripts/asset-check.mjs              full check (before every report)
//   node <skills-root>/genesys-assets/scripts/asset-check.mjs --prebuild   before every buildProject
//
// --prebuild checks only what breaks a build: every '@project/...' string literal in src/ (comments
// ignored) and in prefab, material and layout JSON must name a file that exists, and no asset path
// may be built from parts. It does not read GAME.md.
//
// FAIL:
//   - a row marked `wired` whose path nothing references (code, scene, prefab, material, layout)
//   - a row marked `landed` / `wired` whose file does not exist (a code row with no asset file: the src/ file in Path)
//   - an @project path built from parts: `'@project/…' + x`, `x + '@project/…'`, a template literal
//     with ${…}, .concat(), or a folder/prefix literal ('@project/assets/ui/' or one without a file
//     extension) — unless it sits under a folder listed in .genesys-project alwaysCopyAssets
//   - code that references .scratch/ (sheets and captures never ship)
//   - a GLB whose material links (GENESYS_material_overrides) name a missing .material.json or
//     texture, or one outside .genesys-project alwaysCopyAssets (also with --prebuild)
//   - (--prebuild) an @project literal whose file does not exist
// WARN:
//   - a row still planned / building / requested / proposed (open work — report it)
//   - a row `landed` but not `wired`
//   - a `scene` row whose node name is in no scene, prefab or layout file (confirm it with MCP)
//   - a model / image / sound under assets/ that no row lists and nothing references
//   - a blender/<asset>/asset.json export that no row lists; an empty blender/ folder
//   - a file over its weight budget (the budget table in genesys-assets SKILL.md; role from the
//     blender folder's asset.json, otherwise the largest budget of its kind)
//   - WAV files under assets/ while the asset compiler's audio compression is off
//   - .scratch/ or art-source/ not ignored by git
//   - (--prebuild) an @engine literal whose file does not exist
//
// Path cells: list every file. Separate paths with `,` or `·`. A bare file name after a full path
// shares its folder (`@project/assets/ui/a.png, b.png`). A numbered range expands:
// `@project/assets/ui/tier-1.png … tier-5.png` checks tier-1 … tier-5.
//
// Exit codes: 0 no FAIL (warnings may remain — report them), 1 at least one FAIL,
// 2 not run from a project root.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = process.cwd();
const PREBUILD = process.argv.includes('--prebuild');
if (!fs.existsSync(path.join(root, 'package.json'))) {
  console.log('FAIL run from the game project root (the folder with package.json)');
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const fails = [];
const warns = [];
const notes = [];

function walk(dir, filter, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, filter, out);
    else if (filter(full)) out.push(full);
  }
  return out;
}
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const kb = (bytes) => Math.round(bytes / 1024);
const fmt = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${kb(bytes)} KB`);

// Blank out // and /* */ comments (and <!-- --> in HTML), keeping strings and line numbers.
function stripComments(text, html = false) {
  let out = '';
  let i = 0;
  let q = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    const end = (stop) => {
      const j = text.indexOf(stop, i + 2);
      const k = j < 0 ? text.length : j + stop.length;
      out += text.slice(i, k).replace(/[^\n]/g, ' ');
      i = k;
    };
    if (c === '/' && n === '/') { const j = text.indexOf('\n', i); const k = j < 0 ? text.length : j; out += ' '.repeat(k - i); i = k; continue; }
    if (c === '/' && n === '*') { end('*/'); continue; }
    if (html && c === '<' && text.startsWith('<!--', i)) { end('-->'); continue; }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- budgets (single table in SKILL.md)
const budgets = {};
{
  const lines = read(path.join(HERE, '..', 'SKILL.md')).split('\n');
  const i = lines.findIndex((l) => l.includes('budget-table'));
  for (const l of i < 0 ? [] : lines.slice(i + 1)) {
    if (!l.trim().startsWith('|')) { if (Object.keys(budgets).length) break; continue; }
    const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const role = cells[0].match(/^`([a-z]+)`/);
    const m = (cells[1] || '').match(/([\d.]+)\s*(KB|MB)/i);
    if (role && m) budgets[role[1]] = Math.round(Number(m[1]) * (m[2].toUpperCase() === 'MB' ? 1024 : 1));
  }
  if (!Object.keys(budgets).length) warns.push('weight budgets: no budget table in genesys-assets SKILL.md — size checks skipped');
}

// ---------------------------------------------------------------- project config
const projectFile = fs.readdirSync(root).find((f) => f.endsWith('.genesys-project'));
let project = {};
if (projectFile) { try { project = JSON.parse(read(path.join(root, projectFile))); } catch { /* ignore */ } }
const alwaysCopy = (project.alwaysCopyAssets || []).map((d) => d.replace(/\/$/, ''));
const underAlwaysCopy = (logical) => alwaysCopy.some((d) => logical === d || logical.startsWith(d + '/'));

const toFile = (logical) => logical.startsWith('@engine/')
  ? path.join(root, 'node_modules', '@gnsx', 'genesys.js', logical.slice('@engine/'.length))
  : path.join(root, logical.slice('@project/'.length));

// ---------------------------------------------------------------- corpus
const codeFiles = walk(path.join(root, 'src'), (f) => /\.(ts|tsx|js|mjs|css|html|json)$/.test(f) && !f.endsWith('auto-imports.ts'));
const jsonData = [
  ...walk(path.join(root, 'assets'), (f) => /\.(prefab\.json|material\.json|json)$/.test(f)),
  ...walk(path.join(root, 'levels'), (f) => f.endsWith('.json')),
  ...walk(path.join(root, 'packs'), (f) => /\.json$/.test(f)),
];
const scenes = [
  ...walk(path.join(root, 'assets'), (f) => f.endsWith('.genesys-scene')),
  ...walk(path.join(root, 'packs'), (f) => f.endsWith('.genesys-scene')),
];
const packCode = walk(path.join(root, 'packs'), (f) => /\.(ts|tsx|js|mjs)$/.test(f));
const code = [...codeFiles, ...packCode].map((f) => ({ f, text: f.endsWith('.json') ? read(f) : stripComments(read(f), f.endsWith('.html')) }));
const data = [...jsonData, ...(PREBUILD ? [] : scenes)].map((f) => ({ f, text: read(f) }));
const corpus = [...code, ...data];
const referenced = (logical) => corpus.some(({ text }) => text.includes(logical)) || underAlwaysCopy(logical);

// ---------------------------------------------------------------- literals and paths built from parts
const LIT = /(['"`])(@(?:project|engine)\/[^'"`\n]*)\1/g;
const literals = [];
for (const { f, text } of code.filter(({ f }) => !f.endsWith('.json'))) {
  text.split('\n').forEach((l, i) => {
    const at = `${rel(f)}:${i + 1}`;
    const parts = [];
    if (/`[^`]*@project\/[^`]*\$\{/.test(l)) parts.push('a template literal with ${…}');
    if (/(['"`])@project\/[^'"`]*\1\s*\+/.test(l)) parts.push("'@project/…' + …");
    if (/\+\s*(['"`])@project\//.test(l)) parts.push("… + '@project/…'");
    if (/(['"`])@project\/[^'"`]*\1\s*\)?\s*\.concat\(/.test(l)) parts.push('.concat()');
    for (const m of l.matchAll(LIT)) {
      const v = m[2];
      if (v.includes('${')) continue;
      if (v.startsWith('@project/') && (v.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(v.split('/').pop()))) {
        if (!underAlwaysCopy(v.replace(/\/$/, ''))) parts.push(`the folder/prefix literal '${v}'`);
        continue;
      }
      literals.push({ at, v });
    }
    const exempt = [...l.matchAll(/@project\/[^'"`\s$]*/g)].every((m) => {
      const v = m[0].replace(/\/$/, '');
      return underAlwaysCopy(v) || underAlwaysCopy(path.posix.dirname(v));
    });
    if (parts.length && !exempt) {
      fails.push(`${at} builds an @project path from parts (${[...new Set(parts)].join(', ')}) — the build copies only full `
        + 'string literals: write each path whole, or list a runtime-chosen folder in .genesys-project alwaysCopyAssets');
    }
    if (/\.scratch\//.test(l)) fails.push(`${at} references .scratch/ — captures and sheets never ship; export to assets/`);
  });
}
for (const { f, text } of data.filter(({ f }) => !f.endsWith('.genesys-scene'))) {
  text.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/"(@(?:project|engine)\/[^"]+)"/g)) {
      if (/\.[A-Za-z0-9]+$/.test(m[1])) literals.push({ at: `${rel(f)}:${i + 1}`, v: m[1] });
    }
  });
}
const missing = literals.filter(({ v }) => !fs.existsSync(toFile(v)));
for (const { at, v } of missing) {
  if (v.startsWith('@project/')) fails.push(`${at} references ${v}, which does not exist — buildProject fails on it. Make the file first, or reference it only once it is landed`);
  else warns.push(`${at} references ${v}, which is not in the engine package — check the path (asset-search)`);
}

// GLB material links (GENESYS_material_overrides, genesys-code-modeling → export-glb): the linked
// .material.json and its textures are referenced only inside the GLB, so the build copies them only
// when they sit under alwaysCopyAssets.
let glbLinks = 0;
const linkedFrom = new Map(); // material link → GLBs that use it
for (const f of walk(path.join(root, 'assets'), (x) => /\.glb$/i.test(x))) {
  let json = null;
  try {
    const b = fs.readFileSync(f);
    if (b.readUInt32LE(0) === 0x46546c67) json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  } catch { /* not a readable GLB: other checks report it */ }
  for (const m of json?.materials ?? []) {
    const link = m.extensions?.GENESYS_material_overrides?.materialOverride;
    if (typeof link !== 'string' || !link.startsWith('@project/')) continue;
    glbLinks++;
    linkedFrom.set(link, [...(linkedFrom.get(link) ?? []), `@project/${rel(f)}`]);
  }
}
for (const [link, glbs] of linkedFrom) {
  const from = `${glbs.length} GLB${glbs.length > 1 ? 's' : ''} (${glbs[0]}${glbs.length > 1 ? ', …' : ''})`;
  if (!fs.existsSync(toFile(link))) { fails.push(`${from} link material ${link}, which does not exist — run the export again (genesys-code-modeling)`); continue; }
  if (!underAlwaysCopy(link)) fails.push(`${link} is linked only from ${from} — add its folder to .genesys-project alwaysCopyAssets`);
  for (const t of new Set(read(toFile(link)).match(/@project\/[\w./-]+\.(png|jpe?g|webp|ktx2)/gi) ?? [])) {
    if (!fs.existsSync(toFile(t))) fails.push(`${link} uses ${t}, which does not exist`);
    else if (!underAlwaysCopy(t)) fails.push(`${t} is used only by ${link} — add its folder to .genesys-project alwaysCopyAssets`);
  }
}

if (PREBUILD) {
  notes.push(`prebuild: ${literals.length} asset literals checked in src/, prefabs, materials and layouts; ${glbLinks} GLB material links`);
  report();
}

// ---------------------------------------------------------------- the ledger
const gameMd = read(path.join(root, 'GAME.md'));
const rows = [];
{
  const lines = gameMd.split('\n');
  const start = lines.findIndex((l) => /^##\s+Assets\b/i.test(l));
  if (start < 0) {
    fails.push('GAME.md has no `## Assets` table (genesys-assets → The Assets table)');
  } else {
    let header = null;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^#{1,2}\s/.test(l)) break;
      if (!l.startsWith('|')) continue;
      const cells = l.slice(1, l.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
      if (!header) { header = cells.map((c) => c.toLowerCase()); continue; }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const get = (name) => cells[header.findIndex((h) => h.startsWith(name))] ?? '';
      rows.push({ role: get('role'), route: get('route').replace(/[`*]/g, '').trim().toLowerCase(), pathCell: get('path'), status: get('status').toLowerCase(), line: i + 1 });
    }
    if (!header) fails.push('GAME.md `## Assets` has no table rows');
    else for (const col of ['role', 'route', 'path', 'status']) {
      if (!header.some((h) => h.startsWith(col))) fails.push(`GAME.md Assets table is missing the \`${col}\` column`);
    }
  }
}

// Every path in a cell: full paths, bare names sharing the previous folder, numbered ranges.
function cellPaths(cell) {
  const out = [];
  const toks = cell.replace(/`/g, ' ').split(/\s*(?:,|·|;)\s*|\s+/).filter(Boolean);
  let dir = null;
  let range = false;
  for (let t of toks) {
    t = t.replace(/[.;:)]+$/, '').replace(/^\(/, '');
    if (/^(…|\.\.\.|–|—|to)$/.test(t)) { range = true; continue; }
    let p = null;
    if (/^@(project|engine)\//.test(t)) p = t;
    else if (dir && /^[\w.-]+\.[A-Za-z0-9]+$/.test(t)) p = `${dir}/${t}`;
    if (!p) { range = false; continue; }
    if (range && out.length) {
      const a = out[out.length - 1];
      const A = path.posix.basename(a);
      const B = path.posix.basename(p);
      const ma = A.match(/^(.*?)(\d+)(\D*)$/);
      const mb = B.match(/^(.*?)(\d+)(\D*)$/);
      if (ma && mb && ma[1] === mb[1] && ma[3] === mb[3] && Number(mb[2]) > Number(ma[2])) {
        const pad = ma[2].length === mb[2].length ? ma[2].length : 0;
        for (let k = Number(ma[2]) + 1; k <= Number(mb[2]); k++) out.push(`${path.posix.dirname(a)}/${ma[1]}${String(k).padStart(pad, '0')}${ma[3]}`);
        range = false;
        continue;
      }
    }
    range = false;
    out.push(p);
    dir = path.posix.dirname(p);
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- rows
const listed = new Set();
for (const r of rows) {
  r.paths = cellPaths(r.pathCell);
  const where = `GAME.md:${r.line} ${r.role || '(no role)'}`;
  const st = r.status.replace(/[`*]/g, '');
  r.paths.forEach((p) => listed.add(p));
  if (/^(cut|dropped)/.test(st)) continue;
  if (/^(planned|building|requested|proposed)/.test(st)) {
    warns.push(`${where} is ${st || 'open'} — open work, report it`);
    continue;
  }
  if (/^scene/.test(r.route)) {
    // Scene rows (sky, sun, fog, placed lights): Path names the scene node(s). The editor is the
    // source of truth; this only looks for the names in saved scene, prefab and layout files.
    const names = [...r.pathCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((n) => !n.startsWith('@'));
    if (!names.length && !r.paths.length) warns.push(`${where} is a scene row: put the node name(s) in backticks in its Path cell`);
    for (const n of names) {
      if (/^wired/.test(st) && !corpus.some(({ text }) => text.includes(`"${n}"`))) {
        warns.push(`${where}: scene node "${n}" is in no saved scene, prefab or layout file — query_node(find) it, then action_scene(save)`);
      }
    }
    if (!r.paths.length) continue;
  }
  if (!r.paths.length) {
    // Code-built rows (procedural splash, particles) have no asset file: the Path cell names the source file instead.
    if (/^code/.test(r.route)) {
      const src = (r.pathCell.match(/(?:src|packs)\/[\w./-]+\.\w+/g) ?? []);
      if (/^(landed|wired)/.test(st) && !src.length) warns.push(`${where} is a code row with no path: put its GLB (@project/assets/models/...) in the Path cell, or the source file (src/...) for a code-only piece`);
      if (!/^(landed|wired)/.test(st)) continue; // planned or building: the class may not exist yet
      for (const s of src) {
        if (!fs.existsSync(path.join(root, s))) { fails.push(`${where}: ${s} does not exist`); continue; }
        // wired: some other source file imports this code-only module (a title screen, SVG icons)
        const mod = s.replace(/\.\w+$/, '').split('/').pop();
        const importers = codeFiles.filter((f) => path.relative(root, f) !== s && new RegExp(`['"/]${mod}(\\.js|\\.ts)?['"]`).test(read(f)));
        if (/^wired/.test(st) && /^src\//.test(s) && !importers.length) warns.push(`${where} says wired, but no other source file imports ${s}`);
      }
      continue;
    }
    if (/^(landed|wired)/.test(st)) fails.push(`${where} is ${st} but its Path cell has no @project/@engine path`);
    continue;
  }
  for (const p of r.paths) {
    if (!fs.existsSync(toFile(p))) { fails.push(`${where}: ${p} does not exist`); continue; }
    const used = referenced(p);
    if (/^wired/.test(st) && !used) fails.push(`${where} says wired, but nothing in src/, scenes, prefabs, materials or layouts references ${p}`);
    else if (/^landed/.test(st)) warns.push(`${where}: ${p} landed but not wired${used ? ' (it IS referenced — mark the row wired once it is seen in a capture)' : ''}`);
    else if (!/^(landed|wired)/.test(st)) warns.push(`${where}: unknown status "${r.status}" (planned | building | requested | proposed | landed | wired | cut)`);
  }
}

// ---------------------------------------------------------------- orphans, blender folders
const MEDIA = /\.(glb|gltf|png|jpe?g|webp|ktx2|hdr|exr|mp3|wav|ogg|m4a|flac|aac)$/i;
const media = walk(path.join(root, 'assets'), (f) => MEDIA.test(f));
for (const f of media) {
  const logical = '@project/' + rel(f);
  if (listed.has(logical) || referenced(logical)) continue;
  if (logical.startsWith('@project/assets/screenshots/')) continue;
  warns.push(`${logical} is not in the Assets table and nothing references it — wire it or delete it if you made it`);
}
const roleOf = {};
const blenderDir = path.join(root, 'blender');
for (const e of fs.existsSync(blenderDir) ? fs.readdirSync(blenderDir, { withFileTypes: true }) : []) {
  if (!e.isDirectory() || e.name.startsWith('.')) continue;
  const dir = path.join(blenderDir, e.name);
  const files = fs.readdirSync(dir).filter((x) => !x.startsWith('.'));
  const hasCfg = files.includes('asset.json');
  if (!files.length) { warns.push(`blender/${e.name}/ is empty — build it or delete it`); continue; }
  if (hasCfg && !files.some((x) => x.endsWith('.py') && !x.startsWith('_'))) warns.push(`blender/${e.name}/ has an asset.json but no step scripts`);
  if (!hasCfg) continue;                    // a shared helper folder (exec'd by other steps)
  let cfg = {};
  try { cfg = JSON.parse(read(path.join(dir, 'asset.json'))); } catch { warns.push(`blender/${e.name}/asset.json is not valid JSON`); continue; }
  if (cfg.export) {
    roleOf[cfg.export] = cfg.role;
    if (!listed.has('@project/' + cfg.export)) warns.push(`blender/${e.name}/asset.json exports @project/${cfg.export}, which has no Assets row`);
  }
  if (cfg.still?.out) {
    roleOf[cfg.still.out] = cfg.still.role || (['title', 'icon'].includes(cfg.role) ? cfg.role : ((cfg.still.width ?? 1920) >= 1000 ? 'title' : 'icon'));
    if (!listed.has('@project/' + cfg.still.out)) warns.push(`blender/${e.name}/asset.json renders @project/${cfg.still.out}, which has no Assets row`);
  }
}

// ---------------------------------------------------------------- weight, audio compression, hygiene
if (Object.keys(budgets).length) {
  const kindCap = (f) => {
    if (/\.(glb|gltf)$/i.test(f)) return ['largest model', Math.max(...['hero', 'creature'].map((r) => budgets[r] || 0))];
    if (/\.(png|jpe?g|webp)$/i.test(f)) return /\/textures?\//.test(f) ? ['texture', budgets.texture] : ['largest image', budgets.title];
    if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f)) return ['music', budgets.music];
    return [null, null];
  };
  for (const f of media) {
    const r = rel(f);
    const role = roleOf[r];
    const [label, cap] = role && budgets[role] ? [role, budgets[role]] : kindCap(r);
    const size = fs.statSync(f).size;
    if (cap && kb(size) > cap) warns.push(`@project/${r} is ${fmt(size)}, over the ${label} budget ${cap} KB (genesys-assets → Weight budgets)`);
  }
}
const wavs = media.filter((f) => /\.wav$/i.test(f));
if (wavs.length) {
  const ac = project.assetCompiler || {};
  const on = ac.enabled === true && ac.audioCompression?.enabled !== false && ac.audioCompression?.formats?.wav !== false;
  if (!on) {
    const total = wavs.reduce((n, f) => n + fs.statSync(f).size, 0);
    warns.push(`${wavs.length} WAV file(s) under assets/ (${fmt(total)}) ship uncompressed: assetCompiler audio compression is off in ${projectFile || '.genesys-project'} — turn it on (genesys-asset-compiler) or keep clips short`);
  }
}
for (const p of ['.scratch', 'art-source']) {
  const g = spawnSync('git', ['check-ignore', '-q', `${p}/probe`], { cwd: root });
  const ignored = g.status === 0 || (g.status !== 1 && new RegExp(`^/?${p.replace('.', '\\.')}/?\\s*$`, 'm').test(read(path.join(root, '.gitignore'))));
  if (!ignored) warns.push(`${p}/ is not git-ignored — add this line to .gitignore:  ${p}/`);
}

const count = (re) => rows.filter((r) => re.test(r.status)).length;
notes.push(`rows ${rows.length}: wired ${count(/^wired/)}, landed ${count(/^landed/)}, open ${count(/^(planned|building|requested|proposed)/)}, cut ${count(/^(cut|dropped)/)}; ${literals.length} asset literals in code and data`);
report();

function report() {
  for (const n of notes) console.log('NOTE ' + n);
  for (const w of warns) console.log('WARN ' + w);
  for (const f of fails) console.log('FAIL ' + f);
  console.log(fails.length ? `RESULT fail (${fails.length})` : warns.length ? `RESULT ok with ${warns.length} warnings` : 'RESULT ok');
  process.exit(fails.length ? 1 : 0);
}
