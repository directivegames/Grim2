import fs from 'fs';
import path from 'path';

import { getProjectRoot } from './common.js';

const editorDir = path.join(getProjectRoot(), '.editor');
fs.mkdirSync(editorDir, { recursive: true });
const stampPath = path.join(editorDir, 'build-stamp.json');
fs.writeFileSync(
  stampPath,
  `${JSON.stringify({ builtAt: new Date().toISOString() }, null, 2)}\n`,
  'utf8',
);
