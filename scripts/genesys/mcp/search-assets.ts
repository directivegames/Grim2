import * as fs from 'fs';
import * as path from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { BoundingBoxSchema, fetchBoundingBoxData } from '../calc-bounding-box.js';
import { ENGINE_PREFIX, JS_CLASSES_DIR_NAME, PROJECT_PREFIX, SCENE_EXTENSION } from '../const.js';
import { StorageProvider } from '../storageProvider.js';

import { populateClassesInfo } from './search-actors.js';
import { conditionallyRegisterGameClasses } from './utils.js';
import { isSubclass } from './utils.js';


// TODO: make it consistent to AssetType in genesys.ai
export enum AssetType {
  Model = 'model',
  Texture = 'texture',
  HDRI = 'hdri',
  Video = 'video',
  Audio = 'audio',
  Json = 'json',
  Scene = 'scene',
  Prefab = 'prefab',
  Material = 'material',
  SourceCode = 'sourcecode',
  JsClass = 'jsclass',
}

const modelTypes = ['.glb', '.gltf'];

export const assetDescriptions: Record<AssetType, string> = {
  [AssetType.Model]: '3D model files',
  [AssetType.Texture]: 'Texture files',
  [AssetType.HDRI]: 'HDRI files',
  [AssetType.Video]: 'Video files',
  [AssetType.Audio]: 'Audio files',
  [AssetType.Scene]: 'Scenes, also known as levels, are generally used to represent distinct, playable areas in the game.',
  [AssetType.Prefab]: 'Prefabs are actors that are prebuilt with components and can be placed in the scene directly. They generally extend Javascript classes to achieve more visual complex behavior.',
  [AssetType.Material]: 'Material files',
  [AssetType.SourceCode]: 'Source code files, including TypeScript and JavaScript files.',
  [AssetType.JsClass]: 'JavaScript classes, which are actors that are implemented in code (Javascript). They contain visual and audio components, logics, or anything as they are implemented in code. They are often used directly in the scene, they also be used as a prefab base. Always consider this when placing things in the scene.',
  [AssetType.Json]: 'JSON files, which are used to store data in a structured format.',
};

const assetTypeToExtensions: Record<AssetType, string[]> = {
  [AssetType.Model]: modelTypes,
  [AssetType.Texture]: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.ico', '.webp'],
  [AssetType.HDRI]: ['.hdr', '.exr'],
  [AssetType.Video]: ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
  [AssetType.Audio]: ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
  [AssetType.Scene]: [SCENE_EXTENSION],
  [AssetType.Prefab]: ['.prefab.json'],
  [AssetType.Material]: ['.material.json'],
  [AssetType.SourceCode]: ['.ts', '.js', '.tsx', '.jsx'],
  [AssetType.JsClass]: [],
  [AssetType.Json]: ['.json'],
};

interface AssetPopulationOptions {
  peek?: boolean; // if true, only populate the basic metadata, such as name and description
}

const findAssetType = (filePath: string) => {
  if (filePath.includes(JS_CLASSES_DIR_NAME)) {
    return AssetType.JsClass;
  }

  const extension = path.extname(filePath).toLowerCase();
  for (const [assetType, extensions] of Object.entries(assetTypeToExtensions)) {
    // make sure .json is checked last
    if (assetType === AssetType.Json) {
      continue;
    }

    if (extensions.includes(extension)) {
      return assetType as AssetType;
    }
  }

  if (assetTypeToExtensions[AssetType.Json].includes(extension)) {
    return AssetType.Json;
  }

  return undefined;
};

export interface Metadata {
  [key: string]: any;
}

export interface AssetsInfo {
  metadataDescription: Record<string, any>;
  assets: Record<string, Metadata>;
}



/**
 * Recursively iterates a given directory and returns an array of all file paths
 * that match the accepted types.
 * @param dir The directory to iterate.
 * @param acceptedTypes Array of accepted types.
 * @returns An array of file paths.
 */
export async function searchForAssets(
  dirs: string[],
  acceptedTypes: AssetType[] = [],
  searchKeywords: string[] = []
): Promise<AssetsInfo> {
  for (const dir of dirs) {
    if (!dir.startsWith(ENGINE.PROJECT_PATH_PREFIX) && !dir.startsWith(ENGINE.ENGINE_PATH_PREFIX)) {
      throw new Error(`Directory ${dir} is not a valid project or engine directory`);
    }
  }

  // make sure the game is built and classes are registered
  await conditionallyRegisterGameClasses();

  const acceptedExtensions = acceptedTypes.map(type => assetTypeToExtensions[type]).flat();
  const getAll = acceptedTypes.length === 0;
  const files = dirs.map(dir => collectFiles(dir, { getAll, acceptedExtensions })).flat();

  // handle js classes in a special way.
  if (getAll || acceptedTypes.includes(AssetType.JsClass)) {
    const jsClasses = dirs.map(dir => {
      const prefix = dir.includes(PROJECT_PREFIX) ? ENGINE.Prefix.GAME : (dir.includes(ENGINE_PREFIX) ? ENGINE.Prefix.ENGINE : '');
      const registeredClasses = ENGINE.ClassRegistry.getRegistry();
      const actorClasses = Array.from(registeredClasses.entries()).filter(
        ([className, classCtor]) => className.startsWith(prefix) && isSubclass(classCtor, ENGINE.Actor) && !isSubclass(classCtor, ENGINE.BaseGameLoop));
      return actorClasses.map(([key]) => `${JS_CLASSES_DIR_NAME}/${key}`);
    });
    files.push(...jsClasses.flat());
  }

  // convert file paths to unix paths
  const assetPaths: string[] = files.map(filePath => filePath.replace(/\\/g, '/'));

  // only peeking for basic metadata when searching assets to reduce the amount of data transferred
  const result: AssetsInfo = await populateAssets(assetPaths, { peek: true });

  // filter assets as we rely on not only names, but the metadata as well, to filter them
  filterAssets(result, searchKeywords);

  return result;
}


/**
 * Gets the assets info with metadata for the given asset paths.
 * @param assetPaths The paths of the assets to populate. It must be retrieved from `searchForAssets` function.
 * @param options population options, such as `peek` to only populate basic metadata.
 * @returns A promise that resolves to the assets info with metadata.
 */
export async function populateAssets(
  assetPaths: string[],
  options: AssetPopulationOptions
): Promise<AssetsInfo> {

  const result: AssetsInfo = {
    metadataDescription: {},
    assets: assetPaths.reduce((acc, assetPath) => {
      acc[assetPath] = {type: findAssetType(assetPath)};
      return acc;
    }, {} as Record<string, Metadata>)
  };

  await populateModels(result, options);
  await populateJsClasses(result, options);

  return result;
}


function collectFiles(
  dir: string,
  options: {
    getAll: boolean;
    acceptedExtensions: string[];
  }
): string[] {
  let results: string[] = [];
  const storageProvider = new StorageProvider();
  const actualDir = storageProvider.getFullPath(dir);
  const list = fs.readdirSync(actualDir);
  // Normalize accepted extensions to lower case for case-insensitive comparison
  const normalizedExtensions = options.acceptedExtensions.map(ext => ext.toLowerCase());
  list.forEach((file) => {
    const filePath = path.join(dir, file);
    const actualFilePath = storageProvider.getFullPath(filePath);
    const stat = fs.statSync(actualFilePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(collectFiles(filePath, options));
    } else {
      let shouldKeep = false;
      if (options.getAll) {
        shouldKeep = true;
      }
      else {
        const fileName = path.basename(filePath).toLowerCase();
        if (normalizedExtensions.some((ext) => fileName.endsWith(ext))) {
          shouldKeep = true;
        }
      }
      if (shouldKeep) {
        results.push(filePath);
      }
    }
  });
  return results;
}


function filterAssets(assets: AssetsInfo, searchKeywords: string[] = []) {
  // if searchKeywords is not empty, filter the result
  if (searchKeywords.length > 0) {
    const rule = (filePath: string, metadata: any) => {
      for (const keyword of searchKeywords) {
        const kw = keyword.toLowerCase();

        // if the file path contains any of the search keywords, return true
        if (filePath.toLowerCase().includes(kw)) {
          return true;
        }

        // if the file metadata values contains any of the search keywords, return true
        if (Object.values(metadata).some((metadataValue: any) => {
          return JSON.stringify(metadataValue).toLowerCase().includes(kw);
        })) {
          return true;
        }
      }
      return false;
    };

    assets.assets = Object.fromEntries(
      Object.entries(assets.assets).filter(([filePath, metadata]) => rule(filePath, metadata))
    );
  }
}

async function populateModels(assets: AssetsInfo, options: AssetPopulationOptions) {
  if (Object.values(assets.assets).some(asset => asset.type === AssetType.Model)) {
    await populateModelsMetadata(assets);
    if (!options?.peek) {
      await populateBoundingBoxes(assets);
    }
  }
}

async function populateModelsMetadata(assets: AssetsInfo): Promise<void> {
  // read manifest.json, and populate the result with the file details
  const manifest: Record<string, Record<string, string>> = {};
  const storageProvider = new StorageProvider();
  for (const dir of [ENGINE.PROJECT_PATH_PREFIX, ENGINE.ENGINE_PATH_PREFIX]) {
    const assetsManifest = path.join(dir, 'assets', 'manifest.json');
    Object.assign(manifest, await storageProvider.downloadFileAsJson<any>(ENGINE.AssetPath.fromString(assetsManifest)));
  }

  let metadataDescription: Record<string, any> = {};
  if (manifest) {
    // populate metadata description if it exists
    metadataDescription = manifest['$metadata_description'] ?? {};

    // populate the result with the file details
    for (const [filePath, targetMetadata] of Object.entries(assets.assets)) {
      const metadata = manifest[filePath];
      if (metadata !== undefined && metadata !== null && metadata.constructor == Object) {
        Object.assign(targetMetadata, metadata);
      }
    }
  }

  assets.metadataDescription[AssetType.Model] = {
    ...assets.metadataDescription[AssetType.Model],
    ...metadataDescription,
  };
}

async function populateBoundingBoxes(assets: AssetsInfo) {
  const modelFiles = Object.keys(assets.assets).filter(filePath =>
    modelTypes.includes(path.extname(filePath).toLowerCase())
  );

  // split model files into two groups - engine and project
  const engineModelFiles = modelFiles.filter(filePath =>
    filePath.startsWith(ENGINE.ENGINE_PATH_PREFIX)
  );
  const projectModelFiles = modelFiles.filter(filePath =>
    filePath.startsWith(ENGINE.PROJECT_PATH_PREFIX)
  );

  const update = async (root: string, modelFiles: string[]) => {
    const manifestFile = path.join(root, 'assets', 'bounding_box.json');
    const storageProvider = new StorageProvider();
    const gltfPaths: {[key: string]: string} = {};
    for (const filePath of modelFiles) {
      gltfPaths[filePath] = storageProvider.getFullPath(filePath);
    }
    const boundingBoxes = await fetchBoundingBoxData(storageProvider.getFullPath(manifestFile), gltfPaths);
    for (const [filePath, boundingBox] of Object.entries(boundingBoxes)) {
      assets.assets[filePath]['boundingBox'] = boundingBox;
    }
  };

  if (engineModelFiles.length > 0) {
    await update(ENGINE.ENGINE_PATH_PREFIX, engineModelFiles);
  }

  if (projectModelFiles.length > 0) {
    await update(ENGINE.PROJECT_PATH_PREFIX, projectModelFiles);
  }

  if (engineModelFiles.length > 0 || projectModelFiles.length > 0) {
    // also populate the metadata description for bounding box
    const boundingBoxSchema = zodToJsonSchema(BoundingBoxSchema, 'BoundingBoxSchema');
    const properties = (boundingBoxSchema as any).definitions.BoundingBoxSchema.properties;
    const boundingBoxDescription: Record<string, string> = {};
    for (const key in properties) {
      if (properties[key].description) {
        boundingBoxDescription[key] = properties[key].description;
      }
    }
    const metadataDescription = {
      boundingBox: {
        description: 'The bounding box info of model assets',
        properties: boundingBoxDescription,
      }
    };
    assets.metadataDescription[AssetType.Model] = {
      ...assets.metadataDescription[AssetType.Model],
      ...metadataDescription
    };
  }
}

async function populateJsClasses(assets: AssetsInfo, options: AssetPopulationOptions): Promise<void> {
  const jsClassNames: Record<string, string> = {};
  for (const [filePath, metadata] of Object.entries(assets.assets)) {
    if (filePath.includes(JS_CLASSES_DIR_NAME)) {
      jsClassNames[filePath] = path.basename(filePath);
    }
  }

  if (Object.keys(jsClassNames).length === 0) {
    return;
  }
  const result = await populateClassesInfo({
    classesToSearch: Object.values(jsClassNames),
    includeConstructorParams: !options?.peek
  });

  if (result.actors
    && Object.keys(result.actors).length > 0
    && result.metadataDescription
    && Object.keys(result.metadataDescription).length > 0) {

    assets.metadataDescription[AssetType.JsClass] = result.metadataDescription;
  }

  for (const [filePath, metadata] of Object.entries(assets.assets)) {
    if (filePath in jsClassNames) {
      const className = jsClassNames[filePath];
      const actorInfo = result.actors[className];
      if (actorInfo) {
        metadata.jsClassName = actorInfo.className;
        if (!options?.peek) {
          metadata.jsClassFilePath = actorInfo.filePath;
          metadata.jsClassConstructorParams = actorInfo.constructorParams ?? [];
          metadata.jsClassCanPopulateFromJson = actorInfo.canPopulateFromJson ?? false;
        }
        metadata.jsClassDescription = actorInfo.description ?? '';
      } else {
        console.warn(`Actor class ${className} not found in classes info for file ${filePath}`);
      }
    }
  }
}

