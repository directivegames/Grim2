// pnpm exec tsx ./scripts/genesys/dev/generate-manifest.ts
import * as fs from 'fs';
import * as path from 'path';

import * as ENGINE from '@gnsx/genesys.js';

import { ManifestPath } from './storage-provider.js';

import type { FileManifest, FileManifestItem} from './storage-provider.js';

/**
 * Recursively scans a directory and returns file information
 */
function scanDirectory(
  dirPath: string,
  basePath: string = '',
): FileManifestItem[] {

  const items: FileManifestItem[] = [];

  if (!fs.existsSync(dirPath)) {
    return items;
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;
      const stats = fs.statSync(fullPath);

      const item: FileManifestItem = {
        name: entry.name,
        path: relativePath.replace(/\\/g, '/'), // Normalize to forward slashes
        size: stats.size,
        modifiedTime: stats.mtime,
        isDirectory: entry.isDirectory(),
        contentType: getContentType(entry.name)
      };

      items.push(item);

      // Recursively scan subdirectories
      if (entry.isDirectory()) {
        const subItems = scanDirectory(fullPath, relativePath);
        items.push(...subItems);
      }
    }
  } catch (error) {
    console.warn(`Failed to scan directory ${dirPath}:`, error);
  }

  return items;
}

/**
 * Gets content type based on file extension
 */
function getContentType(fileName: string): string | undefined {
  const ext = path.extname(fileName).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.json': 'application/json',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.genesys-scene': 'application/json',
    '.genesys-project': 'application/json'
  };

  return contentTypes[ext];
}

/**
 * Groups files by directory path for efficient lookup
 */
function groupFilesByDirectory(files: FileManifestItem[]): Record<string, FileManifestItem[]> {
  const grouped: Record<string, FileManifestItem[]> = {};

  // Add root directory
  grouped[''] = [];

  for (const file of files) {
    const dir = path.dirname(file.path).replace(/\\/g, '/');
    const normalizedDir = dir === '.' ? '' : dir;

    if (!grouped[normalizedDir]) {
      grouped[normalizedDir] = [];
    }

    grouped[normalizedDir].push(file);
  }

  return grouped;
}

/**
 * Generates the file manifest
 */
export async function generateManifest(): Promise<void> {
  console.log('Generating file manifest...');

  const manifest: FileManifest = {
    generated: new Date().toISOString(),
    projectFiles: {},
    engineFiles: {}
  };

  // Scan project files
  console.log('Scanning project files...');
  const projectRoot = process.cwd();
  const builtProjectRoot = path.join(projectRoot, ENGINE.BUILT_PROJECT_FOLDER);
  const projectFiles = scanDirectory(builtProjectRoot);
  manifest.projectFiles = groupFilesByDirectory(projectFiles);

  // Scan engine files
  console.log('Scanning engine files...');
  const engineAssetsRoot = path.join(projectRoot, 'node_modules', 'genesys.js', 'assets');
  if (fs.existsSync(engineAssetsRoot)) {
    const engineFiles = scanDirectory(engineAssetsRoot, 'assets');
    manifest.engineFiles = groupFilesByDirectory(engineFiles);
    console.log(`Engine files: ${Object.values(manifest.engineFiles).flat().length}`);
  }

  // Write manifest to public directory so it's accessible to the dev server
  const manifestPath = path.join(projectRoot, ManifestPath);
  const manifestDir = path.dirname(manifestPath);

  // Ensure target directory exists
  if (!fs.existsSync(manifestDir)) {
    fs.mkdirSync(manifestDir, { recursive: true });
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`File manifest generated: ${manifestPath}`);
  console.log(`Project files: ${Object.values(manifest.projectFiles).flat().length}`);
  console.log(`Engine files: ${Object.values(manifest.engineFiles).flat().length}`);
}

generateManifest().catch(console.error);
