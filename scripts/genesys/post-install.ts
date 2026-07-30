import fs from 'fs';
import path from 'path';

import { getProjectRoot } from './common.js';
import { syncPacksTsconfigPaths } from './sync-packs-tsconfig.js';


async function main() {
  const projectRoot = getProjectRoot();
  const engineInstallFolder = path.join(projectRoot, 'node_modules/@gnsx/genesys.js');
  if (fs.existsSync(engineInstallFolder)) {
    const copiedEngineFolder = path.join(projectRoot, '.engine');
    if (fs.existsSync(copiedEngineFolder)) {
      fs.rmSync(copiedEngineFolder, { recursive: true });
    }
    fs.mkdirSync(copiedEngineFolder, { recursive: true });

    const foldersToCopy: string[] = [
      'demos/examples',
      'src',
    ];
    for (const folder of foldersToCopy) {
      const engineFolderPath = path.join(engineInstallFolder, folder);
      if (!fs.existsSync(engineFolderPath)) {
        continue;
      }
      const localFolderPath = path.join(copiedEngineFolder, folder);
      fs.cpSync(engineFolderPath, localFolderPath, { recursive: true });
    }

    // copy all *.md files
    const files = fs.readdirSync(engineInstallFolder);
    for (const file of files) {
      if (file.endsWith('.md')) {
        const engineFilePath = path.join(engineInstallFolder, file);
        const localFilePath = path.join(copiedEngineFolder, file);
        fs.copyFileSync(engineFilePath, localFilePath);
      }
    }
  }

  // Migrate .genesys/sdk/tsconfig.json for TypeScript 6 (baseUrl / @packs paths).
  // Runs even when the engine package is missing so CLI install/build stays safe.
  await syncPacksTsconfigPaths(projectRoot);
}

main();
