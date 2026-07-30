/**
 * Rewrites `<project>/.genesys/sdk/tsconfig.json` for TypeScript 6+ and asset packs.
 *
 * - Removes deprecated `compilerOptions.baseUrl` (TypeScript 6).
 * - When `baseUrl` is present, rewrites every relative `paths` value so it stays
 *   correct relative to the tsconfig file (under `.genesys/sdk/`).
 * - Ensures exactly one `@packs/<name>/*` -> `../../packs/<name>/src/*` entry per
 *   directory under `<project>/packs/`. Stale `@packs` entries are dropped.
 *
 * Path values are relative to the tsconfig file, not the project root — required
 * after dropping `baseUrl`.
 *
 * Per-pack entries are required because TypeScript's path mapping only permits
 * one `*` per pattern/substitution; a single `@packs/*` -> `packs/*\/src/*`
 * entry is rejected by `get-tsconfig`.
 *
 * This module is the single source of truth: copied into game projects under
 * `scripts/genesys/` and imported by the SDK (`asset-pack-shared`).
 *
 * Also hardcoded in the template vite config (`collectPackAliases`): if you
 * change {@link PACKS_FOLDER_NAME} or {@link PACKS_TS_NAMESPACE}, update that file.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { getProjectRoot } from './common.js';

/** Filesystem folder name where asset packs live at the project root. */
export const PACKS_FOLDER_NAME = 'packs';

/** TypeScript import-path namespace prefix for asset packs (`@packs/<name>/...`). */
export const PACKS_TS_NAMESPACE = '@packs';

function existsSyncSafe(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/** Strip a UTF-8 BOM so Windows-saved tsconfig files still parse. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseTsconfigJson(raw: string): Record<string, unknown> {
  return JSON.parse(stripBom(raw)) as Record<string, unknown>;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isAbsolutePathValue(pathValue: string): boolean {
  if (path.isAbsolute(pathValue)) {
    return true;
  }
  // Windows drive letter when running under posix path helpers
  return /^[a-zA-Z]:[\\/]/.test(pathValue);
}

/**
 * Joins a tsconfig `paths` substitution with the old `baseUrl` so the result is
 * relative to the tsconfig file (posix separators). Absolute values are unchanged.
 */
export function rewritePathRelativeToBaseUrl(baseUrl: string, pathValue: string): string {
  if (isAbsolutePathValue(pathValue)) {
    return pathValue;
  }
  return path.posix.normalize(path.posix.join(toPosix(baseUrl), toPosix(pathValue)));
}

/** Canonical `@packs/<name>/*` substitution relative to `.genesys/sdk/tsconfig.json`. */
export function canonicalPackPathPattern(packName: string): string {
  return `../../${PACKS_FOLDER_NAME}/${packName}/src/*`;
}

export function isPackPathKey(key: string): boolean {
  return key.startsWith(`${PACKS_TS_NAMESPACE}/`) && key.endsWith('/*');
}

export function packNameFromPathKey(key: string): string {
  return key.slice(`${PACKS_TS_NAMESPACE}/`.length, -'/*'.length);
}

/**
 * Returns true when `.genesys/sdk/tsconfig.json` still has deprecated `baseUrl`
 * or any `@packs/<name>/*` entry that is not in the canonical post-TS6 format.
 */
export async function isGenesysSdkTsconfigStale(projectFolder: string): Promise<boolean> {
  const tsconfigPath = path.join(projectFolder, '.genesys', 'sdk', 'tsconfig.json');
  if (!existsSyncSafe(tsconfigPath)) {
    return false;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(tsconfigPath, 'utf8');
  } catch {
    return false;
  }

  let json: Record<string, unknown>;
  try {
    json = parseTsconfigJson(raw);
  } catch {
    return false;
  }

  const compilerOptions = (json.compilerOptions ?? {}) as Record<string, unknown>;
  if (compilerOptions.baseUrl !== undefined && compilerOptions.baseUrl !== null) {
    return true;
  }

  const paths = (compilerOptions.paths ?? {}) as Record<string, string[]>;
  for (const key of Object.keys(paths)) {
    if (!isPackPathKey(key)) {
      continue;
    }
    const name = packNameFromPathKey(key);
    const expected = canonicalPackPathPattern(name);
    const values = paths[key];
    if (!Array.isArray(values) || values.length !== 1 || values[0] !== expected) {
      return true;
    }
  }

  return false;
}

/**
 * Migrates / syncs pack path mappings in `.genesys/sdk/tsconfig.json`.
 * Missing, unreadable, or invalid files are a no-op (never throws).
 */
export async function syncPacksTsconfigPaths(projectFolder: string): Promise<void> {
  const tsconfigPath = path.join(projectFolder, '.genesys', 'sdk', 'tsconfig.json');
  if (!existsSyncSafe(tsconfigPath)) {
    return;
  }

  let raw: string;
  try {
    raw = await fs.promises.readFile(tsconfigPath, 'utf8');
  } catch {
    return;
  }

  let json: Record<string, unknown>;
  try {
    json = parseTsconfigJson(raw);
  } catch {
    return;
  }

  const packsRoot = path.join(projectFolder, PACKS_FOLDER_NAME);
  const packNames: string[] = [];
  if (existsSyncSafe(packsRoot)) {
    try {
      const entries = await fs.promises.readdir(packsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          packNames.push(entry.name);
        }
      }
    } catch {
      // Treat unreadable packs root as empty
    }
  }

  const compilerOptions = (json.compilerOptions ?? (json.compilerOptions = {})) as Record<string, unknown>;
  const paths = (compilerOptions.paths ?? (compilerOptions.paths = {})) as Record<string, string[]>;

  const baseUrlRaw = compilerOptions.baseUrl;
  const hadBaseUrl = typeof baseUrlRaw === 'string' && baseUrlRaw.length > 0;

  if (hadBaseUrl) {
    const baseUrl = baseUrlRaw;
    for (const key of Object.keys(paths)) {
      const values = paths[key];
      if (!Array.isArray(values)) {
        continue;
      }
      const nextValues = values.map(value => {
        if (typeof value !== 'string') {
          return value;
        }
        return rewritePathRelativeToBaseUrl(baseUrl, value);
      });
      const changed = nextValues.some((value, index) => value !== values[index]);
      if (changed && !isPackPathKey(key)) {
        console.warn(
          `[sync-packs-tsconfig] Rewrote custom paths entry "${key}" after removing baseUrl ` +
            `(was relative to "${baseUrl}").`
        );
      }
      paths[key] = nextValues as string[];
    }
    delete compilerOptions.baseUrl;
  } else if (compilerOptions.baseUrl !== undefined) {
    // Empty / non-string baseUrl — still drop the deprecated key
    delete compilerOptions.baseUrl;
  }

  for (const key of Object.keys(paths)) {
    if (isPackPathKey(key)) {
      const name = packNameFromPathKey(key);
      if (!packNames.includes(name)) {
        delete paths[key];
      }
    }
  }
  for (const name of packNames) {
    paths[`${PACKS_TS_NAMESPACE}/${name}/*`] = [canonicalPackPathPattern(name)];
  }

  const next = JSON.stringify(json, null, 2);
  if (next === raw.trimEnd()) {
    return;
  }
  await fs.promises.writeFile(tsconfigPath, next);
}

async function main(): Promise<void> {
  await syncPacksTsconfigPaths(getProjectRoot());
}

const thisFile = fileURLToPath(import.meta.url);
const entryArg = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryArg && path.resolve(thisFile) === entryArg) {
  main().catch(error => {
    console.error('[sync-packs-tsconfig] Failed:', error);
    process.exitCode = 1;
  });
}
