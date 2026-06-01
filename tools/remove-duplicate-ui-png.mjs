/**
 * Remove assets/UI/*.png when a same-basename .webp exists (WebP is what the game loads).
 * Also removes legacy menu element.* filenames.
 *
 * Run: pnpm exec tsx tools/remove-duplicate-ui-png.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const UI_DIR = path.resolve('assets/UI');

const LEGACY_REMOVE = [
  'menu element.png',
  'menu element.webp',
  'menuelement.png',
];

function main() {
  let removed = 0;

  for (const name of LEGACY_REMOVE) {
    const file = path.join(UI_DIR, name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`removed legacy: ${name}`);
      removed++;
    }
  }

  const entries = fs.readdirSync(UI_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/\.png$/i.test(entry.name)) {
      continue;
    }
    const webpName = entry.name.replace(/\.png$/i, '.webp');
    const webpPath = path.join(UI_DIR, webpName);
    if (!fs.existsSync(webpPath)) {
      console.log(`keep (no webp): ${entry.name}`);
      continue;
    }
    fs.unlinkSync(path.join(UI_DIR, entry.name));
    console.log(`removed duplicate: ${entry.name}`);
    removed++;
  }

  console.log(`Done. Removed ${removed} file(s).`);
}

main();
