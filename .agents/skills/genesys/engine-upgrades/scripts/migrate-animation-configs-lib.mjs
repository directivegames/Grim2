import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AnimationConfigResource,
  WorldSerializer,
} from '@gnsx/genesys.js';

export const LEGACY_SUFFIX = '.anim.json';
export const RESOURCE_SUFFIX = '.animconfig.json';

const IGNORED_DIRECTORIES = new Set([
  '.dist',
  '.engine',
  '.git',
  '.genesys',
  '.intermediate',
  '.next',
  '.turbo',
  'dist',
  'node_modules',
]);
const REFERENCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.genesys-project',
  '.genesys-scene',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.prefab',
  '.ts',
  '.tsx',
]);
const GRAPH_IDS = ['base', 'layer'];
const CONFIG_FIELDS = new Set([
  'autoPlay',
  'clipOptions',
  'events',
  'externalAnimationSources',
  'initialState',
  'layer',
  'masks',
  'oneShotClips',
  'parameters',
  'states',
  'targetSkeletonProfile',
]);
const PATH_TOKEN_CHARACTER = '[A-Za-z0-9_./\\\\-]';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function collectFiles(root, predicate) {
  const files = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && predicate(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort();
}

function isReferenceFile(filePath) {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith('.prefab.json')) {
    return true;
  }
  return REFERENCE_EXTENSIONS.has(path.extname(lowerPath));
}

function isLayoutData(value) {
  return isPlainObject(value)
    && value.version === 1
    && isPlainObject(value.positions)
    && isPlainObject(value.anyStatePosition)
    && typeof value.anyStatePosition.x === 'number'
    && typeof value.anyStatePosition.y === 'number'
    && (value.edges === undefined || isPlainObject(value.edges))
    && (value.selectedModel === undefined || typeof value.selectedModel === 'string');
}

function hasLayoutContent(layout) {
  return Object.keys(layout.positions).length > 0
    || Object.keys(layout.edges ?? {}).length > 0
    || !!layout.selectedModel
    || layout.anyStatePosition.x !== 0
    || layout.anyStatePosition.y !== 0;
}

export function validateAndParseSidecar(rawMeta) {
  if (!isPlainObject(rawMeta)) {
    return { ok: false, reason: 'layout sidecar must contain an object' };
  }

  if (rawMeta.version === 2) {
    if (!isPlainObject(rawMeta.graphs)) {
      return { ok: false, reason: 'v2 layout sidecar must contain a graphs object' };
    }
    if (
      rawMeta.selectedModel !== undefined
      && typeof rawMeta.selectedModel !== 'string'
    ) {
      return { ok: false, reason: 'layout sidecar selectedModel must be a string' };
    }
    const unsupportedGraph = Object.keys(rawMeta.graphs).find(graphId => !GRAPH_IDS.includes(graphId));
    if (unsupportedGraph) {
      return { ok: false, reason: `layout sidecar graph '${unsupportedGraph}' is unsupported` };
    }
    const graphs = {};
    for (const graphId of GRAPH_IDS) {
      const graph = rawMeta.graphs[graphId];
      if (graph === undefined) continue;
      if (!isLayoutData(graph)) {
        return { ok: false, reason: `layout sidecar graph '${graphId}' is malformed` };
      }
      graphs[graphId] = { ...graph };
    }
    if (
      Object.keys(graphs).length === 0
      || (!rawMeta.selectedModel && !Object.values(graphs).some(hasLayoutContent))
    ) {
      return { ok: false, reason: 'layout sidecar has no usable graph data' };
    }
    return {
      ok: true,
      layout: {
        version: 1,
        selectedModel: rawMeta.selectedModel,
        graphs,
      },
    };
  }

  if (!isLayoutData(rawMeta)) {
    return { ok: false, reason: 'layout sidecar has an unsupported format' };
  }
  if (!hasLayoutContent(rawMeta)) {
    return { ok: false, reason: 'layout sidecar has no usable graph data' };
  }
  return {
    ok: true,
    layout: {
      version: 1,
      selectedModel: rawMeta.selectedModel,
      graphs: { base: { ...rawMeta } },
    },
  };
}

export function validateLegacyConfig(rawConfig) {
  if (!isPlainObject(rawConfig)) {
    return { ok: false, reason: 'animation config must contain an object' };
  }
  if (rawConfig.$root?.$bc) {
    return { ok: false, reason: 'file is already serialized resource data' };
  }
  const unsupportedField = Object.keys(rawConfig).find(field => !CONFIG_FIELDS.has(field));
  if (unsupportedField) {
    return { ok: false, reason: `unsupported config field '${unsupportedField}'` };
  }
  if (typeof rawConfig.initialState !== 'string') {
    return { ok: false, reason: 'initialState must be a string' };
  }
  if (!isPlainObject(rawConfig.states)) {
    return { ok: false, reason: 'states must be an object' };
  }
  if (
    rawConfig.initialState
    && !Object.prototype.hasOwnProperty.call(rawConfig.states, rawConfig.initialState)
  ) {
    return { ok: false, reason: `initialState '${rawConfig.initialState}' does not exist in states` };
  }

  for (const field of ['parameters', 'clipOptions', 'masks', 'events']) {
    if (rawConfig[field] !== undefined && !isPlainObject(rawConfig[field])) {
      return { ok: false, reason: `${field} must be an object` };
    }
  }
  for (const field of ['oneShotClips', 'externalAnimationSources']) {
    if (rawConfig[field] !== undefined && !Array.isArray(rawConfig[field])) {
      return { ok: false, reason: `${field} must be an array` };
    }
  }

  try {
    const resource = AnimationConfigResource.fromConfig(rawConfig);
    const serialized = WorldSerializer.exportObject(resource);
    if (!isPlainObject(serialized) || !isPlainObject(serialized.$root)) {
      return { ok: false, reason: 'serialization did not produce resource data' };
    }
    return { ok: true, resource, serialized };
  } catch (error) {
    return {
      ok: false,
      reason: `serialization failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function normalizeRelativePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).replaceAll(path.sep, '/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addPathPattern(patterns, source, target) {
  patterns.set(source, target);
}

export function createReferencePatterns(projectRoot, sourcePath, targetPath) {
  const sourceRelative = normalizeRelativePath(projectRoot, sourcePath);
  const targetRelative = normalizeRelativePath(projectRoot, targetPath);
  const patterns = new Map();

  for (const [sourcePrefix, targetPrefix] of [
    ['@project/', '@project/'],
    ['./', './'],
    ['/', '/'],
    ['', ''],
  ]) {
    addPathPattern(patterns, `${sourcePrefix}${sourceRelative}`, `${targetPrefix}${targetRelative}`);
  }

  const sourceBackslash = sourceRelative.replaceAll('/', '\\');
  const targetBackslash = targetRelative.replaceAll('/', '\\');
  for (const [sourcePrefix, targetPrefix] of [
    ['@project\\', '@project\\'],
    ['.\\', '.\\'],
    ['\\', '\\'],
    ['', ''],
  ]) {
    const source = `${sourcePrefix}${sourceBackslash}`;
    const target = `${targetPrefix}${targetBackslash}`;
    addPathPattern(patterns, source, target);
    addPathPattern(
      patterns,
      source.replaceAll('\\', '\\\\'),
      target.replaceAll('\\', '\\\\'),
    );
  }

  return Array.from(patterns, ([source, target]) => ({ source, target }))
    .sort((a, b) => b.source.length - a.source.length);
}

function createPathRegex(source, caseInsensitive) {
  return new RegExp(
    `(?<!${PATH_TOKEN_CHARACTER})${escapeRegExp(source)}(?!${PATH_TOKEN_CHARACTER})`,
    caseInsensitive ? 'gi' : 'g',
  );
}

export function replacePathReferences(content, patterns, options = {}) {
  let updated = content;
  let replacements = 0;
  const caseInsensitive = options.platform === 'win32';

  for (const pattern of patterns) {
    const expression = createPathRegex(pattern.source, caseInsensitive);
    updated = updated.replace(expression, () => {
      replacements += 1;
      return pattern.target;
    });
  }

  return { content: updated, replacements };
}

export function findPathReferences(content, patterns, options = {}) {
  const caseInsensitive = options.platform === 'win32';
  return patterns.some(pattern => createPathRegex(pattern.source, caseInsensitive).test(content));
}

function findUnresolvedLegacyReference(content, sourceRelative, options = {}) {
  const separator = String.raw`(?:/|\\{1,2})`;
  const relativePattern = sourceRelative.split('/').map(escapeRegExp).join(separator);
  const prefix = `(?:@project${separator}|\\.${separator}|${separator})?`;
  const expression = new RegExp(
    `(?<!${PATH_TOKEN_CHARACTER})${prefix}${relativePattern}(?!${PATH_TOKEN_CHARACTER})`,
    options.platform === 'win32' ? 'i' : '',
  );
  return expression.test(content);
}

export async function buildMigrationPlan(projectRoot, sourcePath) {
  const targetPath = sourcePath.slice(0, -LEGACY_SUFFIX.length) + RESOURCE_SUFFIX;
  const metaPath = sourcePath.slice(0, -LEGACY_SUFFIX.length) + '.anim.meta';

  let rawConfig;
  try {
    rawConfig = JSON.parse(await readFile(sourcePath, 'utf8'));
  } catch (error) {
    return {
      sourcePath,
      targetPath,
      status: 'blocked',
      reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const validation = validateLegacyConfig(rawConfig);
  if (!validation.ok) {
    return {
      sourcePath,
      targetPath,
      status: 'blocked',
      reason: validation.reason,
    };
  }

  let migratedMetaPath = null;
  if (await fileExists(metaPath)) {
    let rawMeta;
    try {
      rawMeta = JSON.parse(await readFile(metaPath, 'utf8'));
    } catch (error) {
      return {
        sourcePath,
        targetPath,
        status: 'blocked',
        reason: `invalid layout sidecar JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const parsedMeta = validateAndParseSidecar(rawMeta);
    if (!parsedMeta.ok) {
      return {
        sourcePath,
        targetPath,
        status: 'blocked',
        reason: parsedMeta.reason,
      };
    }
    validation.resource.graphEditorLayout = parsedMeta.layout;
    validation.serialized = WorldSerializer.exportObject(validation.resource);
    migratedMetaPath = metaPath;
  }

  const serializedText = `${JSON.stringify(validation.serialized, null, 2)}\n`;
  let targetState = 'new';
  if (await fileExists(targetPath)) {
    const existingTarget = await readFile(targetPath, 'utf8');
    if (existingTarget !== serializedText) {
      return {
        sourcePath,
        targetPath,
        status: 'blocked',
        reason: 'target already exists with different contents',
      };
    }
    targetState = 'equivalent';
  }

  return {
    sourcePath,
    targetPath,
    status: 'ready',
    targetState,
    serializedText,
    sourceRelative: normalizeRelativePath(projectRoot, sourcePath),
    patterns: createReferencePatterns(projectRoot, sourcePath, targetPath),
    metaPath: migratedMetaPath,
  };
}

async function collectReferenceFiles(projectRoot) {
  return collectFiles(
    projectRoot,
    filePath => isReferenceFile(filePath)
      && !filePath.toLowerCase().endsWith(LEGACY_SUFFIX)
      && !filePath.toLowerCase().endsWith(RESOURCE_SUFFIX),
  );
}

export async function planReferenceUpdates(projectRoot, migrations, options = {}) {
  const referenceFiles = await collectReferenceFiles(projectRoot);
  const updates = [];
  const unresolved = [];

  for (const filePath of referenceFiles) {
    const original = await readFile(filePath, 'utf8');
    let updated = original;
    for (const migration of migrations) {
      updated = replacePathReferences(updated, migration.patterns, options).content;
    }
    if (updated !== original) {
      updates.push({ filePath, original, updated });
    }
    for (const migration of migrations) {
      if (findUnresolvedLegacyReference(updated, migration.sourceRelative, options)) {
        unresolved.push({ filePath, sourcePath: migration.sourcePath });
      }
    }
  }

  return { updates, unresolved };
}

async function verifyReferences(updates, migrations, options, read = readFile) {
  const unresolved = [];
  for (const update of updates) {
    const content = await read(update.filePath, 'utf8');
    for (const migration of migrations) {
      if (findUnresolvedLegacyReference(content, migration.sourceRelative, options)) {
        unresolved.push({ filePath: update.filePath, sourcePath: migration.sourcePath });
      }
    }
  }
  return unresolved;
}

export async function applyMigrationPlan(migrations, referenceUpdates, options = {}) {
  const exists = options.fileExists ?? fileExists;
  const read = options.readFile ?? readFile;
  const remove = options.unlink ?? unlink;
  const write = options.writeFile ?? writeFile;
  const createdTargets = [];
  const writtenReferences = [];
  let deletionStarted = false;

  try {
    for (const migration of migrations) {
      if (migration.targetState === 'new') {
        await write(migration.targetPath, migration.serializedText, 'utf8');
        createdTargets.push(migration.targetPath);
      }
    }
    for (const update of referenceUpdates) {
      await write(update.filePath, update.updated, 'utf8');
      writtenReferences.push(update);
    }

    const unresolved = await verifyReferences(referenceUpdates, migrations, options, read);
    if (unresolved.length > 0) {
      throw new Error(`Reference verification failed for ${unresolved.length} file(s)`);
    }

    deletionStarted = true;
    for (const migration of migrations) {
      if (migration.metaPath && await exists(migration.metaPath)) {
        await remove(migration.metaPath);
      }
      if (await exists(migration.sourcePath)) {
        await remove(migration.sourcePath);
      }
    }
  } catch (error) {
    if (!deletionStarted) {
      for (const update of writtenReferences.reverse()) {
        await write(update.filePath, update.original, 'utf8');
      }
      for (const targetPath of createdTargets.reverse()) {
        if (await exists(targetPath)) {
          await remove(targetPath);
        }
      }
    }
    throw error;
  }
}

export async function runMigration(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const legacyConfigs = await collectFiles(
    projectRoot,
    filePath => filePath.toLowerCase().endsWith(LEGACY_SUFFIX),
  );
  const migrations = [];
  for (const sourcePath of legacyConfigs) {
    migrations.push(await buildMigrationPlan(projectRoot, sourcePath));
  }

  const ready = migrations.filter(migration => migration.status === 'ready');
  const blocked = migrations.filter(migration => migration.status === 'blocked');
  const referencePlan = await planReferenceUpdates(projectRoot, ready, options);
  const ok = blocked.length === 0 && referencePlan.unresolved.length === 0;

  if (options.write && ok) {
    await applyMigrationPlan(ready, referencePlan.updates, options);
  }

  return {
    projectRoot,
    migrations,
    ready,
    blocked,
    referenceUpdates: referencePlan.updates,
    unresolvedReferences: referencePlan.unresolved,
    ok,
    applied: !!options.write && ok,
  };
}

export function toProjectPath(projectRoot, filePath) {
  return `@project/${normalizeRelativePath(projectRoot, filePath)}`;
}
