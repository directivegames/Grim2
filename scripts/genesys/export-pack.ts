import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { parseJson } from '@gnsx/genesys.js';
import AdmZip from 'adm-zip';

import { getProjectRoot } from './common.js';

type BumpKind = 'patch' | 'minor' | 'major';

interface Args {
  pack: string | undefined;
  bump: BumpKind | undefined;
  setVersion: string | undefined;
  out: string | undefined;
  skipValidation: boolean;
  dryRun: boolean;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let pack: string | undefined;
  let bump: BumpKind | undefined;
  let setVersion: string | undefined;
  let out: string | undefined;
  let skipValidation = false;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pack') pack = argv[++i];
    else if (a === '--bump') {
      const v = argv[++i];
      if (v !== 'patch' && v !== 'minor' && v !== 'major') {
        throw new Error(`Invalid --bump value "${v}". Expected patch|minor|major.`);
      }
      bump = v;
    }
    else if (a === '--set-version') setVersion = argv[++i];
    else if (a === '--out') out = argv[++i];
    else if (a === '--skip-validation') skipValidation = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: export-pack --pack <name> [--bump patch|minor|major | --set-version <x.y.z>]');
      console.log('                   [--out <dir>] [--skip-validation] [--dry-run]');
      process.exit(0);
    }
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!pack) throw new Error('--pack <name> is required');
  if (bump && setVersion) throw new Error('--bump and --set-version are mutually exclusive');
  return { pack, bump, setVersion, out, skipValidation, dryRun };
}

function bumpSemver(version: string, kind: BumpKind): string {
  const m = SEMVER_RE.exec(version);
  if (!m) throw new Error(`Cannot bump non-semver version "${version}". Use --set-version instead.`);
  let major = Number(m[1]);
  let minor = Number(m[2]);
  let patch = Number(m[3]);
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else { patch += 1; }
  return `${major}.${minor}.${patch}`;
}

function validateSemver(version: string): void {
  if (!SEMVER_RE.test(version)) {
    throw new Error(`Version "${version}" is not a valid semver (expected x.y.z).`);
  }
}

interface PackConfig { version?: string; [k: string]: unknown }

function readPackConfig(packRoot: string): PackConfig {
  const configPath = path.join(packRoot, 'config.json');
  if (!fs.existsSync(configPath)) throw new Error(`Missing ${configPath}`);
  return parseJson(fs.readFileSync(configPath, 'utf-8')) as PackConfig;
}

function writePackConfig(packRoot: string, config: PackConfig): void {
  const configPath = path.join(packRoot, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function runValidation(projectRoot: string, packName: string): void {
  console.log(`\n=== Running isolation check for ${packName} ===`);
  const result = spawnSync(
    'pnpm',
    ['exec', 'tsx', './scripts/genesys/check-pack-isolation.ts', '--pack', packName],
    { stdio: 'inherit', cwd: projectRoot, shell: true }
  );
  if (result.status !== 0) {
    throw new Error(`Isolation check failed (exit ${result.status}). Fix the violations above and rerun.`);
  }
}

function zipPackContents(packRoot: string, outZipPath: string): void {
  const zip = new AdmZip();
  // addLocalFolder writes the folder's contents at the zip root (no <name>/ prefix inside).
  zip.addLocalFolder(packRoot);
  fs.rmSync(outZipPath, { force: true });
  zip.writeZip(outZipPath);
}

function main(): void {
  const args = parseArgs();
  const projectRoot = getProjectRoot();
  const packRoot = path.join(projectRoot, 'packs', args.pack!);
  if (!fs.existsSync(packRoot)) throw new Error(`Pack folder not found: ${packRoot}`);

  const config = readPackConfig(packRoot);
  const oldVersion = typeof config.version === 'string' ? config.version : '0.0.0';
  let newVersion = oldVersion;
  if (args.bump) newVersion = bumpSemver(oldVersion, args.bump);
  else if (args.setVersion) { validateSemver(args.setVersion); newVersion = args.setVersion; }
  if (newVersion !== oldVersion) {
    console.log(`Version: ${oldVersion} -> ${newVersion}`);
    if (!args.dryRun) {
      config.version = newVersion;
      writePackConfig(packRoot, config);
    }
  } else {
    console.log(`Version: ${oldVersion} (unchanged)`);
  }

  if (!args.skipValidation) runValidation(projectRoot, args.pack!);
  else console.log('Skipping validation (--skip-validation).');

  const outDir = args.out ? path.resolve(projectRoot, args.out) : projectRoot;
  fs.mkdirSync(outDir, { recursive: true });
  const outZip = path.join(outDir, `${args.pack!}.zip`);
  console.log(`\nWriting ${path.relative(projectRoot, outZip)}`);
  if (!args.dryRun) zipPackContents(packRoot, outZip);

  console.log(`\n✅ Exported pack "${args.pack!}" v${newVersion}.`);
}

try { main(); } catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
}
