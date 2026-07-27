/**
 * Headless fallback for eval-world.
 * 
 * It accepts the same format as the live eval-world script, but evaluates
 * headless, without an open editor.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as ENGINE from '@gnsx/genesys.js';
import { AssetPathEncodeState } from '@gnsx/genesys.js';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import type { IEditorContext, IActorSpawnTransform } from './editorContext.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

ENGINE.mockBrowserEnvironment(JSDOM);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getProjectRoot(): string {
  let dir = __dirname;
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not find project root');
    dir = parent;
  }
}

const projectRoot = getProjectRoot();

// ── Storage provider ──────────────────────────────────────────────────────────

class StorageProvider implements ENGINE.IStorageProvider {
  resolvePath(assetPath: ENGINE.AssetPath): Promise<ENGINE.AssetPath> {
    if (!assetPath.isResolved()) {
      assetPath.resolvePath(this.getFullPath(assetPath.initialPath), AssetPathEncodeState.Decoded);
    }
    return Promise.resolve(assetPath);
  }

  getFullPath(filePath: string): string {
    if (filePath.startsWith(ENGINE.PROJECT_PATH_PREFIX)) {
      filePath = ENGINE.AssetPath.stripPrefix(filePath, ENGINE.PROJECT_PATH_PREFIX);
      return ENGINE.AssetPath.join(projectRoot, filePath);
    }
    if (filePath.startsWith(ENGINE.ENGINE_PATH_PREFIX)) {
      filePath = ENGINE.AssetPath.stripPrefix(filePath, ENGINE.ENGINE_PATH_PREFIX);
      return ENGINE.AssetPath.join(projectRoot, 'node_modules', 'genesys.js', filePath);
    }
    return filePath;
  }

  async downloadFileAsJson<T>(assetPath: ENGINE.AssetPath): Promise<T> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = assetPath.getResolvedPath(false);
    if (!fs.existsSync(fullPath)) return {} as T;
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }

  async downloadFileAsBuffer(assetPath: ENGINE.AssetPath): Promise<ArrayBuffer> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = assetPath.getResolvedPath(false);
    if (!fs.existsSync(fullPath)) return new ArrayBuffer(0);
    const buf = fs.readFileSync(fullPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  async downloadFileAsText(assetPath: ENGINE.AssetPath): Promise<string> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = assetPath.getResolvedPath(false);
    if (!fs.existsSync(fullPath)) return '';
    return fs.readFileSync(fullPath, 'utf8');
  }

  async exists(assetPath: ENGINE.AssetPath): Promise<boolean> {
    assetPath = await this.resolvePath(assetPath);
    return fs.existsSync(assetPath.getResolvedPath(false));
  }

  async uploadFile(assetPath: ENGINE.AssetPath, content: string | Blob | File | ArrayBuffer): Promise<{ path: string; name: string }> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = assetPath.getResolvedPath(false);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (typeof content === 'string') {
      fs.writeFileSync(fullPath, content);
    } else {
      throw new Error(`Unsupported content type: ${typeof content}`);
    }
    return { path: fullPath, name: path.basename(fullPath) };
  }

  async deleteFile(assetPath: ENGINE.AssetPath): Promise<void> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = assetPath.getResolvedPath(false);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  async listFiles(assetPath: ENGINE.AssetPath): Promise<ENGINE.FileListResult> {
    return { files: [], directories: [] };
  }

  async buildCurrentProject(): Promise<boolean> {
    throw new Error('Not implemented');
  }
}

// ── Scene resolution ───────────────────────────────────────────────────────────

function resolveScenePath(): string {
  const projectFilePath = path.join(projectRoot, `${path.basename(projectRoot)}.genesys-project`);
  if (fs.existsSync(projectFilePath)) {
    try {
      const project = JSON.parse(fs.readFileSync(projectFilePath, 'utf8'));
      if (typeof project.defaultScene === 'string') {
        return path.resolve(projectRoot, project.defaultScene);
      }
    } catch {
      // fall through to default
    }
  }
  return path.join(projectRoot, 'assets', 'default.genesys-scene');
}

// ── World options ─────────────────────────────────────────────────────────────

const defaultWorldOptions: ENGINE.WorldOptions = {
  headless: true,
  backgroundColor: 0x2e2e2e,
  physicsOptions: {
    engine: ENGINE.PhysicsEngine.Rapier,
    gravity: ENGINE.MathHelpers.makeVector({ up: -9.81 }),
  },
  navigationOptions: {
    engine: ENGINE.NavigationEngine.RecastNavigation,
  },
};

// ── EditorContext adapter ─────────────────────────────────────────────────────

function createEditorContext(world: ENGINE.World): IEditorContext {
  return {
    addActor(className: string, transform?: IActorSpawnTransform): ENGINE.Actor | null {
      const allClasses = ENGINE.ClassRegistry.getRegistry();
      let resolvedName = className;

      if (!allClasses.has(resolvedName)) {
        const withGame = ENGINE.Prefix.GAME + className;
        const withEngine = ENGINE.Prefix.ENGINE + className;
        if (allClasses.has(withGame)) resolvedName = withGame;
        else if (allClasses.has(withEngine)) resolvedName = withEngine;
        else {
          console.error(`[headless] Class not found: ${className}`);
          return null;
        }
      }

      const actor = ENGINE.ClassRegistry.constructObject(resolvedName, false) as ENGINE.Actor | null;
      if (!actor) return null;

      if (transform) {
        actor.setWorldTransform({
          position: transform.position
            ? new THREE.Vector3(transform.position.x, transform.position.y, transform.position.z)
            : undefined,
          rotation: transform.rotation
            ? new THREE.Euler(transform.rotation.x, transform.rotation.y, transform.rotation.z)
            : undefined,
          scale: transform.scale
            ? new THREE.Vector3(transform.scale.x, transform.scale.y, transform.scale.z)
            : undefined,
        });
      }

      world.addActor(actor);
      return actor;
    },

    deleteActors(...actors: ENGINE.Actor[]): void {
      world.removeActors(...actors);
    },

    getSelectedActor(): ENGINE.Actor | null {
      // No selection concept in headless mode.
      return null;
    },

    listActors(): ENGINE.Actor[] {
      return world.getActors(ENGINE.Actor);
    },

    getActorByName(name: string): ENGINE.Actor | null {
      return world.getActorByName(name) ?? null;
    },

    getActorByUuid(uuid: string): ENGINE.Actor | null {
      return world.getActorByUuid(uuid) ?? null;
    },

    addComponent(actor: ENGINE.Actor, component: ENGINE.SceneComponent): ENGINE.SceneComponent {
      actor.addComponent(component);
      return component;
    },

    setProperty(target: object, path: string, value: unknown): void {
      // No undo system in headless mode — apply directly.
      const parts = path.split('.');
      let obj: any = target;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]];
        if (obj == null) {
          console.error(`[headless] setProperty: path segment '${parts[i]}' is null/undefined`);
          return;
        }
      }
      obj[parts[parts.length - 1]] = value;
    },
  };
}

// ── Result serialization ──────────────────────────────────────────────────────

function serializeItem(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as any).describe === 'function') {
    return (value as any).describe();
  }
  return value;
}

function serializeEvalResult(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(item => serializeItem(item)));
  }
  return JSON.stringify(serializeItem(value));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const script = args[0];

if (!script) {
  console.error('Usage: eval-world-headless.ts <script>');
  console.error('  <script>  JavaScript string to evaluate. Must use `return` to produce a result.');
  process.exit(1);
}

const storageProvider = new StorageProvider();
const cleanUp = ENGINE.projectContext({ project: 'local-project', storageProvider });

const scenePath = resolveScenePath();
const sceneAssetPath = ENGINE.AssetPath.fromString(scenePath);

let world: ENGINE.World | null = null;
let isDirty = false;

try {
  world = new ENGINE.World(defaultWorldOptions);

  const worldData = await storageProvider.downloadFileAsJson<any>(sceneAssetPath);
  await ENGINE.WorldSerializer.loadWorld(world, worldData);

  const editor = createEditorContext(world);

  const contextKeys = ['world', 'editor', 'ENGINE', 'THREE'] as const;
  const contextValues = [world, editor, ENGINE, THREE];

  const fn = new Function(...contextKeys, `"use strict"; return (async () => { ${script} })();`);
  const result = await fn(...contextValues);
  isDirty = true;

  console.log(serializeEvalResult(result));
} catch (err) {
  console.error('[headless] Script error:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  if (world && isDirty) {
    try {
      const newContent = JSON.stringify(world.asExportedObject(), null, 2);
      fs.writeFileSync(scenePath, newContent, 'utf-8');
    } catch (err) {
      console.error('[headless] Failed to save scene:', err instanceof Error ? err.message : err);
    }
  }
  cleanUp();
}
