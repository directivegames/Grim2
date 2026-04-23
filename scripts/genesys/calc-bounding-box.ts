import fs, { readFileSync } from 'fs';
import path, { resolve } from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import type { Transform } from './common.js';

// Custom error types for better error handling
class GLBLoadError extends Error {
  constructor(message: string, public readonly filePath: string) {
    super(message);
    this.name = 'GLBLoadError';
  }
}

class BoundingBoxCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoundingBoxCalculationError';
  }
}

// Interface for manifest entry
interface ManifestEntry {
  readonly bounding_box: ENGINE.TBoundingBox;
  readonly timestamp: string;
}

// Interface for the entire manifest
interface BoundingBoxManifest {
  [filePath: string]: ManifestEntry;
}

function verifyPath(path: string) {
  if (path.startsWith(ENGINE.PROJECT_PATH_PREFIX) || path.startsWith(ENGINE.ENGINE_PATH_PREFIX)) {
    throw new Error(`Expecting a valid path, not a project or engine path: ${path}`);
  }
}

/**
 * Helper function to load and parse a GLB file
 * @param glbFilePath - Path to the GLB file
 * @returns Promise resolving to the loaded GLTF scene
 */
async function loadGLBFile(glbFilePath: string): Promise<any> {
  verifyPath(glbFilePath);

  // Resolve the absolute path
  const absolutePath = resolve(glbFilePath);
  try {
    // Read the GLB file
    const glbData = readFileSync(absolutePath);
    const arrayBuffer = glbData.buffer.slice(
      glbData.byteOffset,
      glbData.byteOffset + glbData.byteLength
    );

    // Load the GLB using GLTFLoader
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    loader.setDRACOLoader(dracoLoader);
    const gltf = await loader.parseAsync(arrayBuffer, '');

    if (!gltf.scene) {
      throw new BoundingBoxCalculationError('No scene found in GLB file');
    }

    return gltf;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'GLBLoadError' || error.name === 'BoundingBoxCalculationError') {
        throw error;
      }
      throw new GLBLoadError(`Failed to load GLB file: ${error.message}`, glbFilePath);
    }
    throw new GLBLoadError('Unknown error loading GLB file', glbFilePath);
  }
}

/**
 * Helper function to extract bounding box data from a Three.js Box3
 * @param boundingBox - Three.js Box3 object
 * @returns BoundingBox interface object
 */
function extractBoundingBoxData(boundingBox: THREE.Box3): ENGINE.TBoundingBox {
  return ENGINE.DescriptionHelper.dumpBoundingBox(boundingBox);
}

/**
 * Calculates the bounding box of a GLB mesh with applied transformations
 * @param glbFilePath - Path to the GLB file
 * @param transform - Transformation to apply (position, rotation, scale)
 * @returns Promise resolving to the calculated bounding box
 */
async function calculateGLBBoundingBox(
  glbFilePath: string,
  transform: Transform
): Promise<ENGINE.TBoundingBox> {
  const gltf = await loadGLBFile(glbFilePath);

  // Create a new object to apply transformations
  const transformedObject = new THREE.Object3D();
  transformedObject.add(gltf.scene);

  // Apply transformations
  transform.position && transformedObject.position.set(...transform.position as [number, number, number]);
  transform.rotation && transformedObject.rotation.set(...transform.rotation as [number, number, number]);
  transform.scale && transformedObject.scale.set(...transform.scale as [number, number, number]);

  // Update world matrix to ensure transformations are applied
  transformedObject.updateMatrixWorld(true);

  const boundingBox = ENGINE.GLTFMeshComponent.calcBoundingBoxFromGLTF(gltf);
  return extractBoundingBoxData(boundingBox);
}

/**
 * Calculates the original bounding box of a GLB mesh without any transformations
 * @param glbFilePath - Path to the GLB file
 * @returns Promise resolving to the original mesh bounding box
 */
async function calculateGLBOriginalBoundingBox(glbFilePath: string): Promise<ENGINE.TBoundingBox> {
  const gltf = await loadGLBFile(glbFilePath);

  const boundingBox = ENGINE.GLTFMeshComponent.calcBoundingBoxFromGLTF(gltf);
  return extractBoundingBoxData(boundingBox);
}

/**
 * Helper function to create a default transform
 */
function createTransform(
  position: [number, number, number] = [0, 0, 0],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1]
): Transform {
  return { position, rotation, scale };
}

/**
 * Utility function to convert degrees to radians
 */
function degreesToRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}


/**
 * Fetches the bounding box data from the manifest file, and returns the bounding box data
 * It internally keeps a bounding box manifest as a cache, and only recalculates the bounding box data if the file has been modified since last calculation
 * @param manifestFile - Path to the manifest JSON file, must be a valid path, not `@project` or `@engine` path
 * @param gltfPaths - Dictionary of gltf key to GLTF file paths, key in theory can be any ID of a gltf mesh.
 */
async function fetchBoundingBoxData(manifestFile: string, gltfPaths: {[key: string]: string}): Promise<{[filePath: string]: ENGINE.TBoundingBox}> {
  verifyPath(manifestFile);
  manifestFile = resolve(manifestFile);
  try {
    // Read existing manifest or create empty one
    let manifest: BoundingBoxManifest = {};

    try {
      if (fs.existsSync(manifestFile)) {
        const manifestContent = fs.readFileSync(manifestFile, 'utf-8');
        manifest = JSON.parse(manifestContent) as BoundingBoxManifest;
        console.log(`Loaded existing manifest with ${Object.keys(manifest).length} entries`);
      } else {
        console.log('Creating new manifest file');
      }
    } catch (error) {
      console.warn(`Failed to read existing manifest, starting fresh: ${error instanceof Error ? error.message : String(error)}`);
      manifest = {};
    }

    // Process each GLTF file
    const updatedManifest: BoundingBoxManifest = { ...manifest };
    let processedCount = 0;
    let skippedCount = 0;

    for (const [key, gltfPath] of Object.entries(gltfPaths)) {
      try {
        // Resolve absolute path for consistent comparison
        const absolutePath = resolve(gltfPath);

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
          console.warn(`Warning: File not found: ${gltfPath}`);
          continue;
        }

        // Get file stats to check modification time
        const stats = fs.statSync(absolutePath);
        const currentTimestamp = stats.mtime.toISOString();

        // Check if we need to update this file
        const existingEntry = manifest[key];
        if (existingEntry && existingEntry.timestamp === currentTimestamp) {
          console.log(`Skipping ${gltfPath} (unchanged)`);
          skippedCount++;
          continue;
        }

        // Calculate bounding box for new/modified file
        console.log(`Processing ${gltfPath}...`);
        const boundingBox = await calculateGLBOriginalBoundingBox(absolutePath);

        // Update manifest entry
        updatedManifest[key] = {
          bounding_box: boundingBox,
          timestamp: currentTimestamp
        };

        processedCount++;
        console.log(`✓ Updated bounding box for ${gltfPath}`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to process ${gltfPath}: ${errorMessage}`);
        // Continue processing other files even if one fails
      }
    }

    // Save updated manifest if any changes were made
    if (processedCount > 0) {
      // Ensure directory exists
      const manifestDir = path.dirname(manifestFile);
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }

      // Write manifest with pretty formatting
      fs.writeFileSync(manifestFile, JSON.stringify(updatedManifest, null, 2), 'utf-8');
      console.log(`\n✓ Manifest updated: ${processedCount} files processed, ${skippedCount} files skipped`);
      console.log(`Manifest saved to: ${manifestFile}`);
    } else {
      console.log(`\n✓ No updates needed: ${skippedCount} files already up to date`);
    }

    return Object.fromEntries(
      Object.entries(gltfPaths).map(([key, absPath]) => [key, updatedManifest[key].bounding_box])
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to update bounding box manifest: ${errorMessage}`);
  }
}

// Export the main functions for use as a module
export {
  calculateGLBBoundingBox,
  calculateGLBOriginalBoundingBox,
  createTransform,
  degreesToRadians,
  fetchBoundingBoxData,
  extractBoundingBoxData,
  GLBLoadError,
  BoundingBoxCalculationError
};

export type { Transform, ManifestEntry, BoundingBoxManifest };
export { BoundingBoxSchema } from '@gnsx/genesys.js';


