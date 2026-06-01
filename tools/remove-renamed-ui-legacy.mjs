/**
 * Remove legacy UI assets superseded by renames (ComboBG, HitNumbersBG, KO-sign, Combo-Nx).
 * Run: pnpm exec tsx tools/remove-renamed-ui-legacy.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const UI_DIR = path.resolve('assets/UI');

const LEGACY = [
  'ComboBG 1.webp',
  'ComboBG 1.png',
  'HitNumbersBG 1.webp',
  'HitNumbersBG 1.png',
  'KO-sign 2.webp',
  'KO-sign 2.png',
  'Combo-10x 2.webp',
  'Combo-10x 2.png',
  'Combo-20x 2.webp',
  'Combo-20x 2.png',
  'Combo-30x 2.webp',
  'Combo-30x 2.png',
  'Combo-40x 2.webp',
  'Combo-40x 2.png',
  'Combo-50x 2.webp',
  'Combo-50x 2.png',
  'Combo-75x 2.webp',
  'Combo-75x 2.png',
  'Combo-100x 2.webp',
  'Combo-100x 2.png',
  'Combo-150x 2.webp',
  'Combo-150x 2.png',
  'Combo-200x 2.webp',
  'Combo-200x 2.png',
  'Combo-250x 2.webp',
  'Combo-250x 2.png',
  'Combo-500x 2.webp',
  'Combo-500x 2.png',
  'Combo-999x 2.webp',
  'Combo-999x 2.png',
];

let removed = 0;
for (const name of LEGACY) {
  const file = path.join(UI_DIR, name);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`removed: ${name}`);
    removed++;
  }
}
console.log(`Done. Removed ${removed} file(s).`);
