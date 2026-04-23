import fs from 'fs';
import path from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { isDev } from '../common.js';
import { getResolvedPath, StorageProvider } from '../storageProvider.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const fileServerPort = !isDev ? 4000 : 4001;
const fileServerProtocol = process.env.GENESYS_FILE_SERVER_PROTOCOL ?? 'http';
const fileServerBaseUrl = process.env.GENESYS_FILE_SERVER_URL ?? `${fileServerProtocol}://localhost:${fileServerPort}`;

class ResourceManagerSkippingLoadingGLTF extends ENGINE.ResourceManager {
  public override async loadModel(path: ENGINE.AssetPath): Promise<GLTF | null> {
    return null;
  }
}

export const fixUpClassName = (className: string) => {
  const allClasses = ENGINE.ClassRegistry.getRegistry();

  if (allClasses.has(className)) {
    return className;
  }

  const gameClassName = ENGINE.Prefix.GAME + className;
  if (allClasses.has(gameClassName)) {
    return gameClassName;
  }

  const engineClassName = ENGINE.Prefix.ENGINE + className;
  if (allClasses.has(engineClassName)) {
    return engineClassName;
  }

  throw new Error(`Class ${className} not found`);
};

export interface LoadWorldOptions {
  readonly?: boolean;
  skipLoadingGLTF?: boolean;
}

export async function loadWorld(scenePath: string, options: LoadWorldOptions = {}) {
  const storageProvider = new StorageProvider();
  const cleanUp = ENGINE.projectContext({ project: 'local-project', storageProvider: storageProvider });

  const sceneFile = scenePath;

  let world: ENGINE.World | null = null;

  let originalResourceManager = null;
  if (!options.skipLoadingGLTF) {
    originalResourceManager = ENGINE.resourceManager;
    ENGINE.setResourceManager(new ResourceManagerSkippingLoadingGLTF());
  }

  try {
    world = new ENGINE.World(defaultWorldOptions);
    const worldData = await storageProvider.downloadFileAsJson<any>(ENGINE.AssetPath.fromString(sceneFile));

    // wait for all gltf mesh components to load, should probably move this into engine.
    const actors = world.getActors(ENGINE.Actor);
    const promises = actors.map(actor => actor.waitForComponentsToLoad());
    await Promise.all(promises);

    await ENGINE.WorldSerializer.loadWorld(world, worldData);
  } catch (error) {
    cleanUp();
    throw new Error(`Failed to load world from ${sceneFile}: ${error instanceof Error ? error.message : error}`);
  } finally {
    if (originalResourceManager) {
      ENGINE.setResourceManager(originalResourceManager);
    }
  }

  return {
    world: world,
    [Symbol.dispose]() {
      if (!options.readonly && world) {
        const worldData = world.asExportedObject();
        fs.writeFileSync(storageProvider.getFullPath(sceneFile), JSON.stringify(worldData, null, 2));
      }
      cleanUp();
    }
  };
}

export const defaultWorldOptions: ENGINE.WorldOptions = {
  headless: true,
  backgroundColor: 0x2E2E2E,
  physicsOptions: {
    engine: ENGINE.PhysicsEngine.Rapier,
    gravity: ENGINE.MathHelpers.makeVector({ up: -9.81 }),
  },
  navigationOptions: {
    engine: ENGINE.NavigationEngine.RecastNavigation,
  },
  useManifold: true
};

export function mcpLogger(server: McpServer): Disposable {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  // it seems sendLoggingMessage isn't picked up by cursor as of 2025 July 17th,
  // The log can't be found in any of the output channels, or in cursor logs
  // for now we log to stderr, which is supported by MCP
  // https://modelcontextprotocol.io/docs/tools/debugging#implementing-logging
  const sendLogToClient = false;

  console.log = (...args: any[]) => {
    originalConsoleError('[MCP Info]: ', ...args);
    if (sendLogToClient) {
      server.server.sendLoggingMessage({ level: 'info', data: args.join(' ') });
    }
  };
  console.warn = (...args: any[]) => {
    originalConsoleError('[MCP Warning]: ', ...args);
    if (sendLogToClient) {
      server.server.sendLoggingMessage({ level: 'warning', data: args.join(' ') });
    }
  };
  console.error = (...args: any[]) => {
    originalConsoleError('[MCP Error]: ', ...args);
    if (sendLogToClient) {
      server.server.sendLoggingMessage({ level: 'error', data: args.join(' ') });
    }
  };

  return {
    [Symbol.dispose]() {
      console.log = originalConsoleLog;
      console.warn = originalConsoleWarn;
      console.error = originalConsoleError;
    }
  };
}

export function isSubclass(child: Function | null | undefined, parent: Function): boolean {
  if (typeof child !== 'function' || typeof parent !== 'function') return false;
  let proto: any = child;
  while (proto) {
    if (proto === parent) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

async function buildProject() {
  const url = `${fileServerBaseUrl}/api/build-project`;
  const options = {
    method: 'POST'
  };
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Failed to rebuild game.js: ${response.statusText}`);
  }
  const result = await response.json();
  return result;
}

export async function registerGameClasses(): Promise<void> {
  const bundlePath = ENGINE.AssetPath.fromString(ENGINE.AssetPath.join(ENGINE.PROJECT_PATH_PREFIX, '.dist', 'game.js'));
  const storageProvider = new StorageProvider();
  storageProvider.resolvePath(bundlePath);
  try {
    const buildProjectResult = await buildProject();

    const bundleFullPath = getResolvedPath(bundlePath);
    if (!fs.existsSync(bundleFullPath)) {
      throw new Error(`bundle file not found at ${bundleFullPath}, please make sure build project is successful, buildProject result: ${JSON.stringify(buildProjectResult)}`);
    }

    const bundleText = fs.readFileSync(bundleFullPath, 'utf8');
    const injectedDependencies = (mod: string) => {
      if (mod === 'genesys.js') return ENGINE;
      if (mod === 'three') return THREE;
      throw new Error(`Unknown module: ${mod}`);
    };

    ENGINE.ClassRegistry.clearGameClasses();
    // Create a module-like object to simulate CommonJS environment
    const moduleObj = { exports: {} };
    const run = new Function('require', 'module', bundleText);
    run(injectedDependencies, moduleObj);

    // Apply any exports to the global scope if needed
    if (moduleObj.exports && typeof moduleObj.exports === 'object') {
      Object.assign(globalThis as Record<string, unknown>, moduleObj.exports);
    }
  } catch (error) {
    console.error('Error registering game classes', error);
  }
}

export function isClassRegistered(className: string): boolean {
  return ENGINE.ClassRegistry.getRegistry().has(className);
}

export async function registerGameClassesIfAnyNotRegistered(classNamesToCheck: string[]): Promise<void> {
  const validNames = classNamesToCheck.filter((className) => className.startsWith(ENGINE.Prefix.GAME) || className.startsWith(ENGINE.Prefix.ENGINE));
  if (validNames.some(className => !isClassRegistered(className))) {
    await registerGameClasses();
  }
}

export async function conditionallyRegisterGameClasses(): Promise<void> {
  const storageProvider = new StorageProvider();

  const bundlePath = ENGINE.AssetPath.fromString(ENGINE.AssetPath.join(ENGINE.PROJECT_PATH_PREFIX, '.dist', 'game.js'));
  storageProvider.resolvePath(bundlePath);

  const srcDir = ENGINE.AssetPath.fromString(ENGINE.AssetPath.join(ENGINE.PROJECT_PATH_PREFIX, 'src'));
  storageProvider.resolvePath(srcDir);

  // Check if .dist/game.js exists
  if (!fs.existsSync(bundlePath.getResolvedPath())) {
    // If game.js doesn't exist, we need to register classes
    await registerGameClasses();
    return;
  }

  const bundleFileStats = fs.statSync(getResolvedPath(bundlePath));
  const bundleFileTimestamp = bundleFileStats.mtime.getTime();
  console.log('bundleFileTimestamp:', new Date(bundleFileTimestamp));

  // Check if src directory exists
  if (!fs.existsSync(getResolvedPath(srcDir))) {
    console.log('No src directory, no need to register classes');
    return; // No src directory, nothing to check
  }

  // Recursively find all js, jsx, ts, tsx files in src directory
  const sourceFiles = findSourceFiles(getResolvedPath(srcDir));

  // Check if any source file is newer than game.js
  for (const sourceFile of sourceFiles) {
    const sourceStats = fs.statSync(sourceFile);
    const sourceTime = sourceStats.mtime.getTime();

    if (sourceTime > bundleFileTimestamp) {
      // Found a newer source file, register classes and return
      console.log(`Found a newer source file, ${sourceFile}, timestamp ${new Date(sourceTime)}, registering classes`);
      await registerGameClasses();
      return;
    }
  }

  console.log('No newer source files found, no need to register classes');
}

function findSourceFiles(dir: string): string[] {
  const sourceFiles: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recursively search subdirectories
      sourceFiles.push(...findSourceFiles(fullPath));
    } else if (entry.isFile()) {
      // Check if file has one of the target extensions
      const ext = path.extname(entry.name).toLowerCase();
      if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
        sourceFiles.push(fullPath);
      }
    }
  }

  return sourceFiles;
}

