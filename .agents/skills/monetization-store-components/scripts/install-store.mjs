#!/usr/bin/env node
/**
 * Installs or updates the in-game store templates in a Genesys game project.
 *
 *   node .agents/skills/monetization-store-components/scripts/install-store.mjs [--dry-run] [--force]
 *
 * Copies templates/src/store -> src/store and templates/assets/ui/store -> assets/ui/store,
 * writes the project's gameId into src/store/store-config.ts, checks the engine has the
 * widgets the store composes, and prints the game-mode wiring that remains to be done.
 * On an existing install it overwrites every file except store-config.ts when the shipped
 * STORE_VERSION is newer, and deletes template files that newer versions dropped
 * (OBSOLETE_FILES), so a stale module cannot break the build. Plain Node, no dependencies.
 * Updates across a breaking version print what game code must change (BREAKING_CHANGES).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesDir = path.join(skillDir, 'templates');
const projectDir = process.cwd();

const COPY_SETS = [
  { from: path.join(templatesDir, 'src', 'store'), to: path.join(projectDir, 'src', 'store') },
  { from: path.join(templatesDir, 'assets', 'ui', 'store'), to: path.join(projectDir, 'assets', 'ui', 'store') },
];
const CONFIG_REL = path.join('src', 'store', 'store-config.ts');
/** Files earlier store versions shipped and later ones dropped. Deleted on update. */
const OBSOLETE_FILES = [
  // v1.0.0 (Q30): Silicon is bought on the Sandbox top-up page, not in the game.
  path.join('src', 'store', 'ui', 'get-coins-modal.ts'),
  path.join('src', 'store', 'package-value.ts'),
  path.join('assets', 'ui', 'store', 'get-coins-modal.html'),
  path.join('assets', 'ui', 'store', 'get-coins-modal.css'),
];
const REQUIRED_WIDGETS = ['BaseUIComponent', 'Button', 'Keystroke', 'Achievement'];
/** What game code must change when an update crosses `version`. */
const BREAKING_CHANGES = [
  {
    version: '2.0.0',
    note: 'items now live in core and are named by their item id (Store Manager shows it), not by SKU. In your game code: '
      + "purchased / claimed / consumed / needs-coins events carry { itemId } instead of { sku }; owns(), quantityOf(), "
      + 'acquire() and consume() take the item id; ItemView and InventoryItem have itemId instead of sku; state.busySku is '
      + 'state.busyItemId. Buying needs the Studio login on the page (core knows players only by it).',
  },
];

function fail(message) {
  console.error(`store install: ${message}`);
  process.exit(1);
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full, base)));
    else files.push(path.relative(base, full));
  }
  return files.sort();
}

function versionOf(source) {
  const match = source.match(/STORE_VERSION\s*=\s*'([^']+)'/);
  return match ? match[1] : null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function readProjectGameId() {
  const entries = await fs.readdir(projectDir);
  const projectFile = entries.find(name => name.endsWith('.genesys-project'));
  if (!projectFile) fail(`no *.genesys-project file in ${projectDir}; run this from the project root.`);
  const raw = await fs.readFile(path.join(projectDir, projectFile), 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    fail(`${projectFile} is not valid JSON.`);
  }
  const gameId = typeof data.gameId === 'string' ? data.gameId.trim() : '';
  if (!gameId) {
    fail(`${projectFile} has no gameId. Link the game first: genesys.actionStore({ action: 'linkGame' }) through the editor's MCP (or open Store Manager in the editor, which links it on open). Then rerun this script.`);
  }
  return { projectFile, gameId };
}

async function checkEngine() {
  const componentsDir = path.join(projectDir, '.engine', 'src', 'ui', 'components');
  if (!(await exists(componentsDir))) {
    console.warn('store install: .engine/src/ui/components not found (run pnpm install so post-install copies the engine source); skipping the widget check.');
    return;
  }
  const files = await listFiles(componentsDir);
  const missing = REQUIRED_WIDGETS.filter(widget => !files.some(file => path.basename(file).replace(/\.[^.]+$/, '') === widget));
  if (missing.length > 0) fail(`this engine lacks UI kit widgets the store composes: ${missing.join(', ')}. Upgrade the engine (engine-upgrades skill) before installing the store.`);
}

async function findGameModeFile() {
  const srcDir = path.join(projectDir, 'src');
  if (!(await exists(srcDir))) return null;
  const files = (await listFiles(srcDir)).filter(file => file.endsWith('.ts') || file.endsWith('.tsx'));
  for (const file of files) {
    const source = await fs.readFile(path.join(srcDir, file), 'utf8');
    if (/extends\s+ENGINE\.GameMode\b/.test(source)) return { file: path.join('src', file), wired: source.includes('installStore(') };
  }
  return null;
}

async function main() {
  const { projectFile, gameId } = await readProjectGameId();
  await checkEngine();

  const shippedConfig = await fs.readFile(path.join(templatesDir, CONFIG_REL), 'utf8');
  const shippedVersion = versionOf(shippedConfig);
  if (!shippedVersion) fail('shipped templates carry no STORE_VERSION; the skill is damaged.');

  const projectConfigPath = path.join(projectDir, CONFIG_REL);
  const installed = await exists(projectConfigPath);
  const installedVersion = installed ? versionOf(await fs.readFile(projectConfigPath, 'utf8')) : null;

  if (installed && installedVersion && !force && compareVersions(shippedVersion, installedVersion) <= 0) {
    console.log(`store install: project already has store v${installedVersion} (shipped v${shippedVersion}); nothing to do. Use --force to rewrite.`);
    await printWiring(gameId);
    return;
  }

  const writes = [];
  for (const set of COPY_SETS) {
    for (const rel of await listFiles(set.from)) {
      const target = path.join(set.to, rel);
      const isConfig = path.relative(projectDir, target) === CONFIG_REL;
      if (installed && isConfig) continue; // the creator's settings survive updates
      writes.push({ from: path.join(set.from, rel), to: target, isConfig });
    }
  }

  console.log(
    installed
      ? `store install: updating store v${installedVersion ?? '?'} -> v${shippedVersion} (${writes.length} files, store-config.ts kept)`
      : `store install: installing store v${shippedVersion} for game ${gameId} (${writes.length} files)`
  );
  const removals = [];
  for (const rel of OBSOLETE_FILES) {
    if (await exists(path.join(projectDir, rel))) removals.push(rel);
  }

  for (const write of writes) console.log(`  ${dryRun ? 'would write' : 'write'} ${path.relative(projectDir, write.to)}`);
  for (const rel of removals) console.log(`  ${dryRun ? 'would delete' : 'delete'} ${rel} (no longer part of the store)`);
  if (dryRun) return;

  for (const write of writes) {
    await fs.mkdir(path.dirname(write.to), { recursive: true });
    let content = await fs.readFile(write.from);
    if (write.isConfig) {
      content = Buffer.from(content.toString('utf8').replace(/gameId:\s*'[^']*'/, `gameId: '${gameId}'`), 'utf8');
    }
    await fs.writeFile(write.to, content);
  }
  for (const rel of removals) await fs.rm(path.join(projectDir, rel));
  if (installed) {
    // The creator's settings stay; only the version line follows the shipped templates.
    const current = await fs.readFile(projectConfigPath, 'utf8');
    await fs.writeFile(projectConfigPath, current.replace(/STORE_VERSION\s*=\s*'[^']*'/, `STORE_VERSION = '${shippedVersion}'`));
    console.log(`  ${CONFIG_REL} kept (STORE_VERSION set to ${shippedVersion})`);
  } else {
    console.log(`  gameId ${gameId} from ${projectFile} written into ${CONFIG_REL}`);
  }
  if (installed) {
    const from = installedVersion ?? '0.0.0';
    for (const change of BREAKING_CHANGES) {
      if (compareVersions(from, change.version) < 0 && compareVersions(shippedVersion, change.version) >= 0) {
        console.log(`\nstore install: v${change.version} changes the game-facing API: ${change.note}`);
      }
    }
  }
  await printWiring(gameId);
}

async function printWiring(gameId) {
  const gameMode = await findGameModeFile();
  if (gameMode?.wired) {
    console.log(`store install: ${gameMode.file} already calls installStore. Create items in the editor's Store Manager, then play (B opens the store).`);
    return;
  }
  const where = gameMode ? `${gameMode.file} (class extending ENGINE.GameMode)` : 'your game mode file (the class extending ENGINE.GameMode; none found under src/)';
  console.log(`
store install: wire the store in ${where}:

  import { installStore, type InstalledStore } from './store/index.js';
  // field:            private store: InstalledStore | null = null;
  // in beginPlay():   const world = this.getWorld();
  //                   if (world?.gameContainer) void installStore(world).then((store) => { this.store = store; /* store.controller.on('purchased', …) */ });
  // in endPlay():     this.store?.destroy(); this.store = null;

Full snippet: .agents/skills/monetization-store-components/references/components.md
Then: create items in the editor's Store Manager (game ${gameId}), pnpm build, play (B opens the store).`);
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)));
