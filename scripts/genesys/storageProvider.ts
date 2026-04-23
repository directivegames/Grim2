import fs from 'fs';
import path from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import { AssetPath, AssetPathEncodeState } from '@gnsx/genesys.js';

import { getProjectRoot } from './common.js';


export class StorageProvider implements ENGINE.IStorageProvider {
  public async resolvePath(assetPath: AssetPath, expiry?: number): Promise<AssetPath> {
    if (assetPath.isResolved()) {
      return assetPath;
    }

    assetPath.resolvePath(this.getFullPath(assetPath.initialPath), AssetPathEncodeState.Decoded);
    return assetPath;
  }

  public getFullPath(filePath: string): string {
    let fullPath = filePath;
    let rootPath = undefined;

    if (filePath.startsWith(ENGINE.PROJECT_PATH_PREFIX)) {
      filePath = AssetPath.stripPrefix(filePath, ENGINE.PROJECT_PATH_PREFIX);
      rootPath = getProjectRoot();
    }
    else if (filePath.startsWith(ENGINE.ENGINE_PATH_PREFIX)) {
      filePath = AssetPath.stripPrefix(filePath, ENGINE.ENGINE_PATH_PREFIX);
      rootPath = path.join(getProjectRoot(), 'node_modules', 'genesys.js');
    }

    if (rootPath !== undefined) {
      fullPath = AssetPath.join(rootPath, filePath);
    }
    return fullPath;
  }

  public async downloadFileAsBuffer(
    assetPath: AssetPath,
  ): Promise<ArrayBuffer> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);
    if (!fs.existsSync(fullPath)) {
      return new ArrayBuffer(0);
    }

    const data = fs.readFileSync(fullPath);
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    );
    return arrayBuffer;
  }

  public async downloadFileAsJson<T>(assetPath: AssetPath): Promise<T> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);
    if (!fs.existsSync(fullPath)) {
      return {} as T;
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }

  public async downloadFileAsText(assetPath: AssetPath): Promise<string> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);
    if (!fs.existsSync(fullPath)) {
      return '';
    }
    return fs.readFileSync(fullPath, 'utf8');
  }

  public async exists(assetPath: AssetPath): Promise<boolean> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);
    return fs.existsSync(fullPath);
  }

  public async buildCurrentProject(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  public async uploadFile(assetPath: AssetPath, content: Blob | File | string | ArrayBuffer, options?: ENGINE.FileUploadOptions): Promise<{
        path: string;
        name: string;
    }>
  {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    if (typeof content === 'string') {
      fs.writeFileSync(fullPath, content);
    } else {
      throw new Error(`Unsupported content type: ${typeof content}`);
    }

    return {
      path: fullPath,
      name: path.basename(fullPath)
    };
  }

  public async deleteFile(assetPath: AssetPath): Promise<void> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  public async listFiles(assetPath: AssetPath, recursive?: boolean, includeHiddenFiles?: boolean): Promise<ENGINE.FileListResult> {
    assetPath = await this.resolvePath(assetPath);
    const fullPath = getResolvedPath(assetPath);

    if (!fs.existsSync(fullPath)) {
      return { files: [], directories: [] };
    }

    const files: ENGINE.FileItem[] = [];
    const directories: ENGINE.FileItem[] = [];

    const processDirectory = (dirPath: string, basePath: string = '') => {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden files if not requested
        if (!includeHiddenFiles && entry.name.startsWith('.')) {
          continue;
        }

        const fullEntryPath = path.join(dirPath, entry.name);
        const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;
        const stats = fs.statSync(fullEntryPath);

        const fileItem: ENGINE.FileItem = {
          name: entry.name,
          path: relativePath,
          absolutePath: fullEntryPath,
          size: stats.size,
          modifiedTime: stats.mtime,
          isDirectory: entry.isDirectory()
        };

        if (entry.isDirectory()) {
          directories.push(fileItem);

          // Recursively process subdirectories if requested
          if (recursive) {
            processDirectory(fullEntryPath, relativePath);
          }
        } else {
          files.push(fileItem);
        }
      }
    };

    // Check if the path is a directory
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      processDirectory(fullPath);
    } else {
      // If it's a file, return just that file
      const fileItem: ENGINE.FileItem = {
        name: path.basename(fullPath),
        path: path.basename(fullPath),
        absolutePath: fullPath,
        size: stats.size,
        modifiedTime: stats.mtime,
        isDirectory: false
      };
      files.push(fileItem);
    }

    return { files, directories };
  }
}

export function getResolvedPath(assetPath: ENGINE.AssetPath): string {
  return assetPath.getResolvedPath(false);
}
