import fs from 'fs';
import path from 'path';

import { parseJson } from '@gnsx/genesys.js';

import { getProjectRoot } from './common.js';

const PROJECT_PREFIX = '@project';
const PACKS_FOLDER = 'packs';
const PACK_MANIFEST_FILENAME = 'config.json';
const ASSET_REF_REGEX = /@project\/[^"'\s<>`)\]}]+/g;
const AUTO_GENERATED_BASENAMES = new Set(['auto-imports.ts', 'game-data.ts']);

interface Violation {
  file: string;
  ref: string;
  kind: 'external-project' | 'cross-pack' | 'dangling';
}

interface StaleProjectRef {
  file: string;
  ref: string;
}

function parseArgs(): { pack: string | undefined; all: boolean; skipStale: boolean } {
  const argv = process.argv.slice(2);
  let pack: string | undefined;
  let all = false;
  let skipStale = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack') pack = argv[++i];
    else if (a === '--all') all = true;
    else if (a === '--no-stale-scan') skipStale = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: check-pack-isolation --pack <name> | --all [--no-stale-scan]');
      process.exit(0);
    }
  }
  return { pack, all, skipStale };
}

function walk(dir: string, accept: (p: string) => boolean, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git' || entry.name === '.dist' || entry.name === '.turbo') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}

function isPackFile(p: string): boolean {
  return /\.(ts|tsx|json)$/.test(p);
}

function extractRefsFromText(text: string): string[] {
  return Array.from(text.matchAll(ASSET_REF_REGEX), m => m[0]);
}

function extractRefsFromJsonValues(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (value.startsWith(`${PROJECT_PREFIX}/`)) out.push(value);
    return;
  }
  if (Array.isArray(value)) { for (const v of value) extractRefsFromJsonValues(v, out); return; }
  if (value && typeof value === 'object') { for (const v of Object.values(value)) extractRefsFromJsonValues(v, out); }
}

function refsInFile(absPath: string): string[] {
  const text = fs.readFileSync(absPath, 'utf-8');
  if (absPath.endsWith('.json')) {
    try { const out: string[] = []; extractRefsFromJsonValues(parseJson(text), out); return out; }
    catch { return extractRefsFromText(text); }
  }
  return extractRefsFromText(text);
}

/** Returns the `id` field from a pack's config.json, or null when unavailable. */
function readPackManifestId(packRoot: string): string | null {
  const configPath = path.join(packRoot, PACK_MANIFEST_FILENAME);
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    return typeof config['id'] === 'string' ? config['id'] : null;
  } catch { return null; }
}

/** Returns the set of declared pack dependency ids from a pack's config.json. */
function readDeclaredPackIds(packRoot: string): Set<string> {
  const configPath = path.join(packRoot, PACK_MANIFEST_FILENAME);
  if (!fs.existsSync(configPath)) return new Set();
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const packs = (config['dependencies'] as Record<string, unknown>)?.['packs'];
    if (packs && typeof packs === 'object' && !Array.isArray(packs)) {
      return new Set(Object.keys(packs));
    }
  } catch { /* ignore */ }
  return new Set();
}

function classifyPackRef(
  ref: string,
  packName: string,
  projectRoot: string,
  declaredPackIds: Set<string>,
): Violation['kind'] | 'ok' {
  const packPrefix = `${PROJECT_PREFIX}/${PACKS_FOLDER}/${packName}/`;
  if (ref.startsWith(packPrefix)) {
    const relFromProject = ref.slice(`${PROJECT_PREFIX}/`.length);
    if (!fs.existsSync(path.join(projectRoot, relFromProject))) return 'dangling';
    return 'ok';
  }
  if (ref.startsWith(`${PROJECT_PREFIX}/${PACKS_FOLDER}/`)) {
    // Cross-pack ref — only a violation if the referenced pack is not a declared dependency.
    // Resolve the folder name to the pack's manifest id (dependencies.packs keys are ids).
    const referencedFolder = ref.slice(`${PROJECT_PREFIX}/${PACKS_FOLDER}/`.length).split('/')[0] ?? '';
    const referencedPackRoot = path.join(projectRoot, PACKS_FOLDER, referencedFolder);
    const referencedPackId = readPackManifestId(referencedPackRoot) ?? referencedFolder;
    if (declaredPackIds.has(referencedPackId)) return 'ok';
    return 'cross-pack';
  }
  if (ref.startsWith(`${PROJECT_PREFIX}/`)) return 'external-project';
  return 'ok';
}

function checkPack(packName: string, projectRoot: string): Violation[] {
  const packRoot = path.join(projectRoot, PACKS_FOLDER, packName);
  if (!fs.existsSync(packRoot)) throw new Error(`Pack folder not found: ${packRoot}`);
  const declaredPackIds = readDeclaredPackIds(packRoot);
  const files = walk(packRoot, isPackFile);
  const violations: Violation[] = [];
  for (const file of files) {
    const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
    for (const ref of refsInFile(file)) {
      const kind = classifyPackRef(ref, packName, projectRoot, declaredPackIds);
      if (kind !== 'ok') violations.push({ file: rel, ref, kind });
    }
  }
  return violations;
}

function scanProjectForStaleRefs(projectRoot: string): StaleProjectRef[] {
  const roots = ['src', 'assets'].map(s => path.join(projectRoot, s));
  const stale: StaleProjectRef[] = [];
  for (const root of roots) {
    for (const file of walk(root, isPackFile)) {
      if (AUTO_GENERATED_BASENAMES.has(path.basename(file))) continue;
      const rel = path.relative(projectRoot, file).replace(/\\/g, '/');
      for (const ref of refsInFile(file)) {
        if (!ref.startsWith(`${PROJECT_PREFIX}/`)) continue;
        const target = path.join(projectRoot, ref.slice(`${PROJECT_PREFIX}/`.length));
        if (!fs.existsSync(target)) stale.push({ file: rel, ref });
      }
    }
  }
  return stale;
}

function listAllPacks(projectRoot: string): string[] {
  const packsRoot = path.join(projectRoot, PACKS_FOLDER);
  if (!fs.existsSync(packsRoot)) return [];
  return fs.readdirSync(packsRoot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
}

function main(): void {
  const { pack, all, skipStale } = parseArgs();
  const projectRoot = getProjectRoot();
  const targets = all ? listAllPacks(projectRoot) : pack ? [pack] : [];
  if (targets.length === 0) { console.error('No pack selected. Use --pack <name> or --all.'); process.exit(2); }

  let totalViolations = 0;
  for (const name of targets) {
    console.log(`\n=== Pack: ${name} ===`);
    const violations = checkPack(name, projectRoot);
    if (violations.length === 0) console.log('✅ No isolation violations.');
    else {
      totalViolations += violations.length;
      for (const v of violations) console.log(`❌ [${v.kind}] ${v.file} -> ${v.ref}`);
    }
  }

  if (!skipStale) {
    console.log('\n=== Project stale-reference scan ===');
    const stale = scanProjectForStaleRefs(projectRoot);
    if (stale.length === 0) console.log('✅ No stale project references found.');
    else { for (const s of stale) console.log(`⚠️  [stale] ${s.file} -> ${s.ref}`); }
  }

  console.log('');
  if (totalViolations > 0) { console.log(`Found ${totalViolations} isolation violation(s).`); process.exit(1); }
  console.log('🎉 Pack isolation check passed.');
}

main();
