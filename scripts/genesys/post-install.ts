import fs from 'fs';
import path from 'path';

import { getProjectRoot } from './common.js';


async function main() {
  const engineInstallFolder = path.join(getProjectRoot(), 'node_modules/@gnsx/genesys.js');
  if (!fs.existsSync(engineInstallFolder)) {
    return;
  }
  const copiedEngineFolder = path.join(getProjectRoot(), '.engine');
  if (fs.existsSync(copiedEngineFolder)) {
    fs.rmSync(copiedEngineFolder, { recursive: true });
  }
  fs.mkdirSync(copiedEngineFolder, { recursive: true });

  const foldersToCopy: string[] = [
    'games/examples',
    'src',
  ];
  for (const folder of foldersToCopy) {
    const engineFolderPath = path.join(engineInstallFolder, folder);
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

main();
