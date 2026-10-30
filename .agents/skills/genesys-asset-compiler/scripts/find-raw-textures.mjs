#!/usr/bin/env node
/**
 * Finds project textures that must ship as the original PNG/JPEG/WebP and
 * suggests `assetCompiler.textureCompression.exclude` patterns for them:
 *
 * - UI textures (HTML, CSS, DOM code, UI data). Browsers cannot display KTX2 in
 *   `<img>` or CSS, and the build rewrites `@project/...png` in UI templates to
 *   the baked `.ktx2`.
 * - CPU textures: images whose pixels game code reads (canvas `getImageData`,
 *   `createImageBitmap`, heightmaps, masks, level layouts, `fetch` of the bytes).
 *   KTX2 holds GPU block-compressed data with no readable RGBA pixels, and the
 *   raw file is removed from `.dist`.
 *
 * Also verifies the current setup: lists those textures the build would still
 * convert, applying enabled flags, format toggles, exclude patterns, and the
 * conversion hook.
 *
 * Usage (from the project root; --help prints the exact path of this script):
 *   node <this-script> [options]
 *
 * Options:
 *   --project <dir>    Project root (default: current directory)
 *   --include-review   Treat ambiguous references as must-stay-raw when suggesting patterns
 *   --no-collapse      Suggest one pattern per file instead of folder patterns
 *   --write            Merge suggested patterns into the .genesys-project exclude list
 *   --check            Exit 1 if any must-stay-raw texture would still be converted
 *   --json             Print a machine-readable report
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEXTURE_FILE = /\.(png|jpe?g|webp)$/i;
const TEXTURE_REF = /[A-Za-z0-9_@.\/\-~%+${}]*\.(?:png|jpe?g|webp)\b/gi;
const MARKUP_EXTS = new Set(['.html', '.htm', '.css', '.scss', '.sass', '.less']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);
const ENGINE_ONLY_DATA = ['.material.json', '.vfx.json'];

const UI_CODE_CONTEXT =
  /\.src\b|srcset|<img\b|<picture|<source\b|url\(|background-image|backgroundImage|innerHTML|outerHTML|insertAdjacentHTML|new Image\(|createElement\(\s*['"`]img|imageUrl|iconUrl|avatarUrl|setImageUrl|setIcon|iconHtml|imageHtml|customStyles|\.style\b|cursor:|favicon/i;
const CPU_CODE_CONTEXT =
  /getImageData|putImageData|drawImage|createImageBitmap|new ImageData|ImageBitmapLoader|\bImageLoader\b|OffscreenCanvas|getContext\(\s*['"`]2d|\.image\.data\b|readPixels|toDataURL|toBlob|\bfetch\(|\.arrayBuffer\(|\.blob\(|decodeImage|loadImage|sharp\(|\bpngjs\b|PNG\.sync|\bjimp\b|heightmap|height_map|setHeightMap|HeightField|getPixel|pixelData|type:\s*['"`]img['"`]/i;
const CPU_FILE_HINT =
  /getImageData|createImageBitmap|new ImageData|\.image\.data\b|readPixels|setHeightMap|HeightField|ImageBitmapLoader|\bImageLoader\b|getPixel/;
const ENGINE_CODE_CONTEXT =
  /texture|material|\bmaps?\b|normalMap|envMap|loadTexture|TextureLoader|ktx2|skybox|lightmap|decal|particle|vfx|splat|\bsprite\b/i;
const UI_FILE_HINT = /(^|\/)(ui|hud|menus?|widgets?|screens?|overlays?)(\/|$)/i;
const UI_DATA_KEY =
  /(^src$|srcset|image|img|icon|avatar|logo|thumb|portrait|banner|cursor|background|badge|emblem|flag|poster|picture|photo|html|style|css)/i;
const CPU_DATA_KEY = /(height|mask|lookup|layout|collision|spawn|density|pixel|grid|level|navmap|sample)/i;
const ENGINE_DATA_KEY =
  /(map|texture|material|normal|albedo|diffuse|roughness|metal|emissive|occlusion|^ao$|env|hdr|skybox|lightmap|noise|decal|particle|terrain|splat)/i;
const TEXTURE_FORMAT_KEY = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp' };
const STANDALONE_TEXTURE_COMPILER = 'ktx2-standalone-texture-compression';
const RAW_KINDS = new Set(['ui', 'cpu']);
// The build itself keeps raw every texture these files name by an `@project/` path (the engine's UI loader reads them).
const BUILD_KEPT_UI_EXTS = new Set(['.html', '.htm', '.css']);

function parseArgs(argv) {
  const args = { project: process.cwd(), includeReview: false, collapse: true, write: false, check: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--project') args.project = path.resolve(argv[++i] ?? '.');
    else if (arg === '--include-review') args.includeReview = true;
    else if (arg === '--no-collapse') args.collapse = false;
    else if (arg === '--write') args.write = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') {
      const self = fileURLToPath(import.meta.url);
      const rel = path.relative(process.cwd(), self);
      const shown = rel && !rel.startsWith('..') ? rel : self;
      console.log(fs.readFileSync(self, 'utf8').split('*/')[0].replace('<this-script>', shown));
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/** Walks the project, skipping dot-folders (.dist, .genesys, .engine, .agents, …) and build output. */
function walkProject(root) {
  const files = [];
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) stack.push(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
      }
    }
  }
  return files.sort();
}

function createLineLookup(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return index => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Returns the line containing `index` and the line before it. */
function linesAt(text, index) {
  const start = text.lastIndexOf('\n', index - 1) + 1;
  const prevStart = start > 0 ? text.lastIndexOf('\n', start - 2) + 1 : start;
  const end = text.indexOf('\n', index);
  return { line: text.slice(start, end === -1 ? text.length : end), previous: text.slice(prevStart, start) };
}

/**
 * Classifies a code reference as `ui`, `cpu`, `engine` (3D, safe to compress), or `review`.
 * The reference itself is stripped from the context so words in the path (`textures/`) do not count.
 */
function classifyCodeReference(line, previous, fileHints) {
  if (CPU_CODE_CONTEXT.test(line) || CPU_CODE_CONTEXT.test(previous)) return ['cpu', 'CPU pixel access nearby'];
  const ui = UI_CODE_CONTEXT.test(line);
  const engine = ENGINE_CODE_CONTEXT.test(line);
  if (ui && !engine) return ['ui', 'DOM/UI usage nearby'];
  if (ui && engine) return ['review', 'both UI and 3D usage nearby'];
  if (engine) {
    return fileHints.cpu ? ['review', 'loaded as a texture in a file that reads pixels on the CPU'] : ['engine', ''];
  }
  if (UI_CODE_CONTEXT.test(previous)) return ['ui', 'DOM/UI usage nearby'];
  if (fileHints.ui) return ['ui', 'UI source file'];
  if (fileHints.cpu) return ['cpu', 'file reads pixels on the CPU'];
  return ['review', 'no clear usage'];
}

function classifyDataKey(key) {
  const ui = UI_DATA_KEY.test(key);
  const engine = ENGINE_DATA_KEY.test(key);
  if (ui && !engine) return 'ui';
  if (ui && engine) return 'review';
  if (CPU_DATA_KEY.test(key)) return 'review';
  return engine ? 'engine' : 'review';
}

/** Yields `{ raw, index, kind, reason }` for every texture-looking reference in a source file. */
function* extractReferences(relPath, text) {
  const ext = path.extname(relPath).toLowerCase();
  const lower = relPath.toLowerCase();

  if (MARKUP_EXTS.has(ext)) {
    for (const match of text.matchAll(TEXTURE_REF)) {
      yield { raw: match[0], index: match.index, kind: 'ui', reason: `${ext.slice(1)} markup` };
    }
    return;
  }

  if (CODE_EXTS.has(ext)) {
    const fileHints = {
      ui: UI_FILE_HINT.test(relPath) || /extends\s+\w*UIComponent\b/.test(text),
      cpu: CPU_FILE_HINT.test(text),
    };
    for (const match of text.matchAll(TEXTURE_REF)) {
      const lines = linesAt(text, match.index);
      const line = lines.line.replace(match[0], '');
      const previous = lines.previous.replace(TEXTURE_REF, '');
      const [kind, reason] = classifyCodeReference(line, previous, fileHints);
      yield { raw: match[0], index: match.index, kind, reason };
    }
    return;
  }

  if (lower.endsWith('.json') || lower.endsWith('.genesys-scene')) {
    if (ENGINE_ONLY_DATA.some(suffix => lower.endsWith(suffix))) return;
    const keyValue = /"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    for (const match of text.matchAll(keyValue)) {
      const [, key, value] = match;
      if (!/\.(png|jpe?g|webp)\b/i.test(value)) continue;
      const kind = classifyDataKey(key);
      for (const ref of value.matchAll(TEXTURE_REF)) {
        yield { raw: ref[0], index: match.index, kind, reason: `data key "${key}"` };
      }
    }
  }
}

function stripProjectPrefix(raw) {
  let ref = raw;
  try {
    ref = decodeURIComponent(ref);
  } catch {
    // keep the raw form
  }
  if (ref.startsWith('@project/')) return { ref: ref.slice('@project/'.length), rooted: true };
  if (ref.startsWith('/')) return { ref: ref.replace(/^\/+/, ''), rooted: true };
  return { ref, rooted: false };
}

function candidatePaths(ref, rooted, sourceRel) {
  const fromSource = path.posix.normalize(path.posix.join(path.posix.dirname(sourceRel), ref));
  const fromRoot = path.posix.normalize(ref);
  const ordered = rooted ? [fromRoot] : ref.startsWith('.') ? [fromSource, fromRoot] : [fromRoot, fromSource];
  return ordered.filter(p => p && !p.startsWith('..'));
}

/** Resolves a static reference to a project texture path, or null. */
function resolveTexture(raw, sourceRel, textureIndex) {
  const { ref, rooted } = stripProjectPrefix(raw);
  for (const candidate of candidatePaths(ref, rooted, sourceRel)) {
    const hit = textureIndex.byPath.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  if (!ref.includes('/')) {
    const byName = textureIndex.byName.get(ref.toLowerCase());
    if (byName?.length === 1) return byName[0];
  }
  return null;
}

/** Resolves the static folder of a dynamic reference (`assets/ui/icons/${id}.png`), or null. */
function resolveDynamicFolder(raw, sourceRel, textureIndex) {
  const cut = raw.search(/\$\{|\{\{/);
  const prefix = raw.slice(0, cut);
  const slash = prefix.lastIndexOf('/');
  if (slash <= 0) return null;
  const { ref, rooted } = stripProjectPrefix(prefix.slice(0, slash));
  for (const candidate of candidatePaths(ref, rooted, sourceRel)) {
    const folder = candidate.replace(/\/+$/, '').toLowerCase();
    if (!folder || folder === '.') continue;
    const inside = textureIndex.all.find(t => t.toLowerCase().startsWith(`${folder}/`));
    if (inside) return inside.slice(0, folder.length);
  }
  return null;
}

// Gitignore-style matching, mirroring the compiler: case-insensitive, last rule wins,
// and a file under an excluded folder cannot be re-included by a later `!` rule.
function compileRule(line) {
  let p = line.trim();
  if (!p || p.startsWith('#')) return null;
  let negate = false;
  if (p.startsWith('!')) {
    negate = true;
    p = p.slice(1);
  }
  const dirOnly = p.endsWith('/');
  p = p.replace(/\/+$/, '');
  const anchored = p.includes('/');
  p = p.replace(/^\/+/, '');
  let body = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      i++;
      if (p[i + 1] === '/') {
        i++;
        body += '(?:.*/)?';
      } else {
        body += '.*';
      }
    } else if (c === '*') body += '[^/]*';
    else if (c === '?') body += '[^/]';
    else if (c === '[') {
      const close = p.indexOf(']', i + 1);
      if (close === -1) body += '\\[';
      else {
        body += p.slice(i, close + 1);
        i = close;
      }
    } else body += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return { negate, dirOnly, re: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`, 'i') };
}

function compileRules(patterns) {
  return patterns.map(compileRule).filter(Boolean);
}

function matchesRules(rules, target, isDir) {
  let excluded = false;
  for (const rule of rules) {
    if (rule.dirOnly && !isDir) continue;
    if (rule.re.test(target)) excluded = !rule.negate;
  }
  return excluded;
}

function isExcluded(rules, relPath) {
  const parts = relPath.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (matchesRules(rules, parts.slice(0, i).join('/'), true)) return true;
  }
  return matchesRules(rules, relPath, false);
}

function readExcludeList(value) {
  if (typeof value === 'string') return value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter(v => typeof v === 'string').map(s => s.trim()).filter(Boolean);
  return [];
}

function findProjectFile(root) {
  const names = fs.readdirSync(root).filter(name => name.endsWith('.genesys-project')).sort();
  return names.length > 0 ? path.join(root, names[0]) : null;
}

async function loadHook(root, hookPath, notes) {
  if (typeof hookPath !== 'string' || !hookPath.trim()) return null;
  const absolute = path.resolve(root, hookPath.trim());
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    notes.push(`conversionHook "${hookPath}" is outside the project; the build ignores it.`);
    return null;
  }
  const ext = path.extname(absolute).toLowerCase();
  if (!['.mjs', '.cjs', '.js'].includes(ext)) {
    notes.push(`conversionHook "${hookPath}" must be .mjs, .cjs, or .js; the build ignores it.`);
    return null;
  }
  if (!fs.existsSync(absolute)) {
    notes.push(`conversionHook "${hookPath}" does not exist; the build ignores it.`);
    return null;
  }
  try {
    const mod = ext === '.cjs' ? createRequire(absolute)(absolute) : await import(pathToFileURL(absolute).href);
    const fn = mod?.shouldConvertAsset ?? mod?.default?.shouldConvertAsset;
    if (typeof fn !== 'function') {
      notes.push(`conversionHook "${hookPath}" does not export shouldConvertAsset; the build ignores it.`);
      return null;
    }
    return fn;
  } catch (error) {
    notes.push(`conversionHook "${hookPath}" failed to load (${error?.message ?? error}); the build ignores it.`);
    return null;
  }
}

/** Mirrors the loose-texture compiler's decision for one texture. */
function wouldConvert(relPath, compilerConfig, rules, hook, keptByBuild) {
  if (compilerConfig.enabled !== true) return false;
  const texture = compilerConfig.textureCompression ?? {};
  if (texture.enabled === false) return false;
  const ext = path.extname(relPath).slice(1).toLowerCase();
  const formatKey = TEXTURE_FORMAT_KEY[ext];
  const formats = { png: true, jpeg: true, webp: false, ...(texture.formats ?? {}) };
  if (!formatKey || formats[formatKey] !== true) return false;
  const defaultConvert = !isExcluded(rules, relPath) && !keptByBuild.has(relPath);
  if (!hook) return defaultConvert;
  try {
    const result = hook({ relativePath: relPath, compiler: STANDALONE_TEXTURE_COMPILER, defaultConvert });
    return typeof result === 'boolean' ? result : defaultConvert;
  } catch {
    return defaultConvert;
  }
}

/** Collapses must-stay-raw texture paths into folder patterns where every texture below the folder is raw. */
function suggestPatterns(needed, rawSet, allTextures, dynamicFolders, collapse) {
  const patterns = new Set(dynamicFolders.map(folder => `${folder}/`));
  const coveredByDynamic = p => dynamicFolders.some(folder => p.startsWith(`${folder}/`));
  const remaining = needed.filter(p => !coveredByDynamic(p));

  const folderIsAllRaw = new Map();
  const allRawBelow = folder => {
    if (!folderIsAllRaw.has(folder)) {
      const below = allTextures.filter(t => t.startsWith(`${folder}/`));
      folderIsAllRaw.set(folder, below.length >= 2 && below.every(t => rawSet.has(t)));
    }
    return folderIsAllRaw.get(folder);
  };

  for (const file of remaining) {
    const parts = file.split('/');
    let chosen = null;
    if (collapse) {
      // Never collapse to a top-level folder such as `assets/`; future 3D textures would be excluded too.
      for (let depth = 2; depth < parts.length; depth++) {
        const folder = parts.slice(0, depth).join('/');
        if (allRawBelow(folder)) {
          chosen = `${folder}/`;
          break;
        }
      }
    }
    patterns.add(chosen ?? (file.includes('/') ? file : `/${file}`));
  }
  const folders = [...patterns].filter(p => p.endsWith('/'));
  return [...patterns]
    .filter(p => !folders.some(folder => folder !== p && p.startsWith(folder)))
    .sort();
}

function detectIndent(text) {
  const match = text.match(/\n([ \t]+)"/);
  return match ? match[1] : 2;
}

function pushTo(map, key, value) {
  map.set(key, [...(map.get(key) ?? []), value]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.project;
  const notes = [];

  const files = walkProject(root);
  const allTextures = files.filter(f => TEXTURE_FILE.test(f));
  const textureIndex = { all: allTextures, byPath: new Map(), byName: new Map() };
  for (const texture of allTextures) {
    textureIndex.byPath.set(texture.toLowerCase(), texture);
    pushTo(textureIndex.byName, path.posix.basename(texture).toLowerCase(), texture);
  }

  const rawRefs = new Map();
  const reviewRefs = new Map();
  const dynamicFolders = new Map();
  const unresolved = [];
  const keptByBuild = new Set();

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const lower = file.toLowerCase();
    if (!MARKUP_EXTS.has(ext) && !CODE_EXTS.has(ext) && !lower.endsWith('.json') && !lower.endsWith('.genesys-scene')) {
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), 'utf8');
    } catch {
      continue;
    }
    const lineAt = createLineLookup(text);
    for (const ref of extractReferences(file, text)) {
      if (ref.kind === 'engine' || ref.raw.startsWith('@engine/')) continue;
      if (text[ref.index - 1] === ':' || ref.raw.startsWith('//')) continue;
      const where = { file, line: lineAt(ref.index), ref: ref.raw, kind: ref.kind, reason: ref.reason };
      const mustStayRaw = RAW_KINDS.has(ref.kind);
      if (/\$\{|\{\{/.test(ref.raw)) {
        const folder = resolveDynamicFolder(ref.raw, file, textureIndex);
        if (folder && mustStayRaw) pushTo(dynamicFolders, folder, where);
        else if (mustStayRaw) unresolved.push(where);
        continue;
      }
      const texture = resolveTexture(ref.raw, file, textureIndex);
      if (!texture) {
        if (mustStayRaw) unresolved.push(where);
        continue;
      }
      pushTo(mustStayRaw ? rawRefs : reviewRefs, texture, where);
      if (mustStayRaw && BUILD_KEPT_UI_EXTS.has(ext) && ref.raw.startsWith('@project/')) keptByBuild.add(texture);
    }
  }
  for (const texture of rawRefs.keys()) reviewRefs.delete(texture);

  const rawSet = new Set(rawRefs.keys());
  for (const folder of dynamicFolders.keys()) {
    for (const texture of allTextures) if (texture.startsWith(`${folder}/`)) rawSet.add(texture);
  }
  if (args.includeReview) for (const texture of reviewRefs.keys()) rawSet.add(texture);

  const projectFile = findProjectFile(root);
  let projectText = null;
  let projectConfig = {};
  if (projectFile) {
    projectText = fs.readFileSync(projectFile, 'utf8');
    try {
      projectConfig = JSON.parse(projectText);
    } catch (error) {
      notes.push(`Could not parse ${path.basename(projectFile)}: ${error.message}`);
    }
  } else {
    notes.push('No *.genesys-project file found in the project root.');
  }
  const compilerConfig = projectConfig.assetCompiler ?? {};
  const currentExclude = readExcludeList(compilerConfig.textureCompression?.exclude);
  const currentRules = compileRules(currentExclude);
  const hook = await loadHook(root, compilerConfig.conversionHook, notes);

  const rawList = [...rawSet].sort();
  const needed = rawList.filter(t => !keptByBuild.has(t) && !isExcluded(currentRules, t));
  const newDynamic = [...dynamicFolders.keys()].filter(folder =>
    allTextures.some(t => t.startsWith(`${folder}/`) && !isExcluded(currentRules, t)),
  );
  const suggested = suggestPatterns(needed, rawSet, allTextures, newDynamic, args.collapse).filter(
    p => !currentExclude.includes(p),
  );
  const mergedExclude = [...currentExclude, ...suggested];
  const mergedRules = compileRules(mergedExclude);

  const convertedNow = rawList.filter(t => wouldConvert(t, compilerConfig, currentRules, hook, keptByBuild));
  const convertedAfter = rawList.filter(t => wouldConvert(t, compilerConfig, mergedRules, hook, keptByBuild));
  const blockedByNegation = needed.filter(t => !isExcluded(mergedRules, t));

  if (compilerConfig.enabled !== true) notes.push('assetCompiler.enabled is not true; nothing is converted yet.');
  if (hook) notes.push('conversionHook loaded; "would convert" results include its decisions.');

  let wrote = false;
  if (args.write && suggested.length > 0) {
    if (!projectFile || projectText === null) {
      console.error('Cannot --write: no readable .genesys-project file.');
      process.exit(2);
    }
    projectConfig.assetCompiler ??= {};
    projectConfig.assetCompiler.textureCompression ??= {};
    projectConfig.assetCompiler.textureCompression.exclude = mergedExclude;
    const trailingNewline = projectText.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(projectFile, JSON.stringify(projectConfig, null, detectIndent(projectText)) + trailingNewline);
    wrote = true;
  }

  const kindsFor = texture => {
    const kinds = new Set((rawRefs.get(texture) ?? []).map(r => r.kind));
    for (const [folder, refs] of dynamicFolders) {
      if (texture.startsWith(`${folder}/`)) for (const r of refs) kinds.add(r.kind);
    }
    if (kinds.size === 0) kinds.add('review');
    return [...kinds].sort();
  };

  const report = {
    projectFile: projectFile ? toPosix(path.relative(root, projectFile)) : null,
    texturesInProject: allTextures.length,
    rawTextures: rawList.map(texture => ({
      path: texture,
      kinds: kindsFor(texture),
      keptByBuild: keptByBuild.has(texture),
      references: rawRefs.get(texture) ?? [],
    })),
    dynamicFolders: [...dynamicFolders].map(([folder, references]) => ({ folder, references })),
    review: [...reviewRefs].map(([texture, references]) => ({ path: texture, references })),
    unresolvedReferences: unresolved,
    currentExclude,
    suggestedPatterns: suggested,
    wroteProjectFile: wrote,
    rawTexturesConvertedNow: convertedNow,
    rawTexturesConvertedAfterSuggestions: convertedAfter,
    blockedByNegation,
    notes,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report, args);
  }

  const stillConverted = wrote ? convertedAfter : convertedNow;
  if (args.check && stillConverted.length > 0) process.exit(1);
}

function printReport(report, args) {
  const out = [];
  const refLine = r => `      ${r.file}:${r.line}  ${r.ref}  (${r.kind}: ${r.reason})`;
  const countKind = kind => report.rawTextures.filter(t => t.kinds.includes(kind)).length;
  out.push(`Project file: ${report.projectFile ?? '(none)'}`);
  out.push(
    `Textures in project: ${report.texturesInProject}; must stay raw: ${report.rawTextures.length} ` +
      `(UI ${countKind('ui')}, CPU ${countKind('cpu')})`,
  );

  if (report.rawTextures.length > 0) {
    out.push('', 'Textures that must stay raw:');
    for (const t of report.rawTextures) {
      out.push(`  [${t.kinds.join(', ')}] ${t.path}${t.keptByBuild ? '  (kept raw by the build: named in UI markup)' : ''}`);
      for (const r of t.references.slice(0, 3)) out.push(refLine(r));
      if (t.references.length > 3) out.push(`      … ${t.references.length - 3} more`);
    }
  }
  if (report.dynamicFolders.length > 0) {
    out.push('', 'Folders referenced with dynamic paths (every texture inside must stay raw):');
    for (const d of report.dynamicFolders) {
      out.push(`  ${d.folder}/`);
      for (const r of d.references.slice(0, 3)) out.push(refLine(r));
    }
  }
  if (report.review.length > 0) {
    const hint = args.includeReview ? 'included because of --include-review' : 'rerun with --include-review to keep them raw';
    out.push('', `Needs review (ambiguous usage; ${hint}):`);
    for (const t of report.review) {
      out.push(`  ${t.path}`);
      for (const r of t.references.slice(0, 2)) out.push(refLine(r));
    }
  }
  if (report.unresolvedReferences.length > 0) {
    out.push('', 'UI/CPU references that did not resolve to a project texture (check by hand):');
    for (const r of report.unresolvedReferences.slice(0, 20)) out.push(`  ${r.file}:${r.line}  ${r.ref}  (${r.kind}: ${r.reason})`);
  }

  out.push('', `Current exclude: ${report.currentExclude.length > 0 ? JSON.stringify(report.currentExclude) : '[]'}`);
  if (report.suggestedPatterns.length > 0) {
    out.push(`${report.wroteProjectFile ? 'Added' : 'Suggested additions'}: ${JSON.stringify(report.suggestedPatterns)}`);
    if (!report.wroteProjectFile) out.push('  Rerun with --write to merge them into the project file.');
  } else {
    out.push('No new patterns needed.');
  }

  const converted = report.wroteProjectFile ? report.rawTexturesConvertedAfterSuggestions : report.rawTexturesConvertedNow;
  out.push('', converted.length === 0
    ? 'OK: the build would not convert any texture that must stay raw.'
    : `PROBLEM: the build would convert ${converted.length} texture(s) that must stay raw: ${converted.join(', ')}`);
  if (!report.wroteProjectFile && report.suggestedPatterns.length > 0 && report.rawTexturesConvertedAfterSuggestions.length > 0) {
    out.push(`  Still converted after the suggestions: ${report.rawTexturesConvertedAfterSuggestions.join(', ')} (conversion hook forces them on)`);
  }
  if (report.blockedByNegation.length > 0) {
    out.push(`  A "!" rule re-includes: ${report.blockedByNegation.join(', ')}`);
  }
  for (const note of report.notes) out.push(`Note: ${note}`);
  console.log(out.join('\n'));
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});
