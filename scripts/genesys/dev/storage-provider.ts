import * as ENGINE from '@gnsx/genesys.js';

export type FileManifestItem = Omit<ENGINE.FileItem, 'absolutePath'>;

export const ManifestPath = 'dist/file-manifest.json';

export interface FileManifest {
  generated: string;
  projectFiles: Record<string, FileManifestItem[]>;
  engineFiles: Record<string, FileManifestItem[]>;
}

export class DevStorageProvider implements ENGINE.IStorageProvider {
  private manifestCache: FileManifest | null = null;
  private manifestPromise: Promise<FileManifest> | null = null;

  private async loadManifest(): Promise<FileManifest> {
    if (this.manifestCache) {
      return this.manifestCache;
    }

    if (this.manifestPromise) {
      return this.manifestPromise;
    }

    this.manifestPromise = this.fetchManifest();
    this.manifestCache = await this.manifestPromise;
    this.manifestPromise = null;

    return this.manifestCache;
  }

  private async fetchManifest(): Promise<FileManifest> {
    try {
      const response = await fetch(`/${ManifestPath}`);
      if (!response.ok) {
        throw new Error(`Failed to load manifest: ${response.status} ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.warn('Failed to load file manifest, falling back to empty manifest:', error);
      return {
        generated: new Date().toISOString(),
        projectFiles: {},
        engineFiles: {}
      };
    }
  }

  async resolvePath(path: ENGINE.AssetPath, expiry?: number): Promise<ENGINE.AssetPath> {
    if (path.isResolved()) {
      return path;
    }

    let resolvedUrl: string;

    if (path.initialPath.startsWith(ENGINE.PROJECT_PATH_PREFIX)) {
      resolvedUrl = path.initialPath.replace(ENGINE.PROJECT_PATH_PREFIX, ENGINE.BUILT_PROJECT_FOLDER);
    } else if (path.initialPath.startsWith(ENGINE.ENGINE_PATH_PREFIX)) {
      resolvedUrl = path.initialPath.replace(ENGINE.ENGINE_PATH_PREFIX, '/node_modules/@gnsx/genesys.js');
    } else if (path.initialPath.startsWith('/')) {
      resolvedUrl = `/node_modules/@gnsx/genesys.js${path.initialPath}`;
    } else if (path.initialPath.startsWith('http') || path.initialPath.startsWith('https')) {
      resolvedUrl = path.initialPath;
    } else {
      // Paths without prefix are treated as engine paths
      resolvedUrl = `/node_modules/@gnsx/genesys.js/${path.initialPath}`;
    }

    path.resolvePath(resolvedUrl, ENGINE.AssetPathEncodeState.Unknown);
    return path;
  }

  async downloadFileAsBuffer(path: ENGINE.AssetPath): Promise<ArrayBuffer> {
    const resolvedPath = await this.resolvePath(path);
    const response = await fetch(resolvedPath.getResolvedPath());
    this.checkResponse(path, response);
    return response.arrayBuffer();
  }

  async downloadFileAsJson<T>(path: ENGINE.AssetPath): Promise<T> {
    const resolvedPath = await this.resolvePath(path);
    const response = await fetch(resolvedPath.getResolvedPath());
    this.checkResponse(path, response);
    return response.json();
  }

  async downloadFileAsText(path: ENGINE.AssetPath): Promise<string> {
    const resolvedPath = await this.resolvePath(path);
    const response = await fetch(resolvedPath.getResolvedPath());
    this.checkResponse(path, response);
    return response.text();
  }

  async uploadFile(
    path: ENGINE.AssetPath,
    content: Blob | File | string | ArrayBuffer,
    options?: ENGINE.FileUploadOptions
  ): Promise<{ path: string; name: string }> {
    throw new Error('ViteDevStorageProvider does not support uploading files.');
  }

  async listFiles(
    path: ENGINE.AssetPath,
    recursive?: boolean,
    includeHiddenFiles?: boolean
  ): Promise<ENGINE.FileListResult> {
    try {
      const manifest = await this.loadManifest();
      const initialPath = path.initialPath;
      const targetPath = this.normalizePathForManifest(initialPath);

      // Determine which file collection to use
      // Paths without prefix are treated as engine assets
      const isEngineAsset = initialPath.startsWith(ENGINE.ENGINE_PATH_PREFIX);
      const isProjectAsset = initialPath.startsWith(ENGINE.PROJECT_PATH_PREFIX);
      if (!isEngineAsset && !isProjectAsset) {
        throw new Error(`Invalid path: ${path}`);
      }
      const fileCollection = isEngineAsset ? manifest.engineFiles : manifest.projectFiles;

      const files: ENGINE.FileItem[] = [];
      const directories: ENGINE.FileItem[] = [];

      if (recursive) {
        // For recursive listing, include all files that start with the target path
        for (const [dirPath, items] of Object.entries(fileCollection)) {
          if (dirPath === targetPath || dirPath.startsWith(targetPath + '/') || (targetPath === '' && !dirPath.includes('/'))) {
            for (const item of items) {
              const engineFileItem = this.convertToEngineFileItem(item, isEngineAsset);

              if (!includeHiddenFiles && item.name.startsWith('.')) {
                continue;
              }

              if (item.isDirectory) {
                directories.push(engineFileItem);
              } else {
                files.push(engineFileItem);
              }
            }
          }
        }
      } else {
        // For non-recursive listing, only include direct children
        const directItems = fileCollection[targetPath] || [];

        for (const item of directItems) {
          const engineFileItem = this.convertToEngineFileItem(item, isEngineAsset);

          if (!includeHiddenFiles && item.name.startsWith('.')) {
            continue;
          }

          // Only include direct children (not nested)
          const itemDirPath = item.path.substring(0, item.path.lastIndexOf('/'));
          const normalizedItemDirPath = itemDirPath === '.' || itemDirPath === '' ? '' : itemDirPath;

          if (normalizedItemDirPath === targetPath) {
            if (item.isDirectory) {
              directories.push(engineFileItem);
            } else {
              files.push(engineFileItem);
            }
          }
        }
      }

      return { files, directories };
    } catch (error) {
      console.warn(`Failed to list files for path ${path.initialPath}:`, error);
      return { files: [], directories: [] };
    }
  }

  async exists(path: ENGINE.AssetPath): Promise<boolean> {
    try {
      const resolvedPath = await this.resolvePath(path);
      const response = await fetch(resolvedPath.getResolvedPath(), { method: 'HEAD' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async buildCurrentProject(): Promise<boolean> {
    // For development, we don't need to build the project
    // Vite handles the compilation
    return true;
  }

  private normalizePathForManifest(pathStr: string): string {
    // Remove @project/ or @engine/ prefix
    let normalized = pathStr.replace(ENGINE.PROJECT_PATH_PREFIX, '').replace(ENGINE.ENGINE_PATH_PREFIX, '');

    // Remove leading slash if present
    if (normalized.startsWith('/')) {
      normalized = normalized.substring(1);
    }

    // Remove trailing slash if present
    if (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }

    return normalized;
  }

  private convertToEngineFileItem(manifestItem: FileManifestItem, isEngineAsset: boolean): ENGINE.FileItem {
    const prefix = isEngineAsset ? ENGINE.ENGINE_PATH_PREFIX : ENGINE.PROJECT_PATH_PREFIX;
    const path = `${prefix}/${manifestItem.path}`;
    return {
      name: manifestItem.name,
      path: path,
      absolutePath: path,
      size: manifestItem.size,
      modifiedTime: new Date(manifestItem.modifiedTime),
      isDirectory: manifestItem.isDirectory,
      contentType: manifestItem.contentType
    };
  }


  private checkResponse(path: ENGINE.AssetPath, response: Response): void {
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path.initialPath}: ${response.status} ${response.statusText}`);
    }
  }
}
