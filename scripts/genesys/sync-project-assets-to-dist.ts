/**
 * Copies `assets/` into `.dist/assets/` so @project asset URLs resolve during dev
 * and in the editor file server (e.g. `.dist/assets/models/Grim.glb`).
 *
 * The Genesys build only ships models it discovers; code-only references can 404
 * until you run this or rebuild from the SDK. Run `pnpm sync-assets` after adding
 * GLBs or UI PNGs (shop item icons: Boneshard.png, cursedvial.png, etc.).
 */
import fs from 'fs';
import path from 'path';

import { getProjectRoot } from './common.js';

function main(): void {
  const root = getProjectRoot();
  const src = path.join(root, 'assets');
  const dest = path.join(root, '.dist', 'assets');
  if (!fs.existsSync(src)) {
    console.warn('sync-project-assets-to-dist: no assets/ folder, skipping.');
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('sync-project-assets-to-dist: copied assets/ → .dist/assets/');
}

main();
