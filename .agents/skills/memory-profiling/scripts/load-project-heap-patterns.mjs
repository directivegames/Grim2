// Loads optional project-owned heap pattern rules (never from the skill template).
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_PROJECT_PATTERNS_REL = path.join('.genesys', 'heap-patterns.json');

/**
 * @param {{
 *   projectRoot?: string,
 *   patternsPath?: string,
 *   captureMeta?: { projectCwd?: string } | null,
 * }} opts
 * @returns {Promise<{ file: string | null, patterns: object[] }>}
 */
export async function loadProjectHeapPatterns(opts = {}) {
  const root = path.resolve(
    opts.projectRoot
    ?? opts.captureMeta?.projectCwd
    ?? process.cwd(),
  );
  const file = path.resolve(opts.patternsPath ?? path.join(root, DEFAULT_PROJECT_PATTERNS_REL));
  if (!existsSync(file)) {
    return { file: null, patterns: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(`invalid ${file}: ${e.message ?? e}`);
  }
  const patterns = Array.isArray(parsed) ? parsed : parsed?.patterns;
  if (!Array.isArray(patterns)) {
    throw new Error(`${file} must be a JSON array or { "patterns": [ ... ] }`);
  }
  return { file, patterns };
}
