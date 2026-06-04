/**
 * Converts every PNG in assets/VFX (recursively) to WebP alongside the original.
 * Originals are NOT deleted. Lossless for sprite sheets, quality-90 for textures.
 */
import sharp from 'sharp';
import { readdirSync, statSync } from 'fs';
import { join, extname, basename } from 'path';

const VFX_DIR = new URL('../assets/VFX', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const LOSSLESS_PATTERNS = [/sheet/i, /sprite/i, /batch/i, /blooduse/i, /blade/i];

function isLossless(filePath) {
  return LOSSLESS_PATTERNS.some(p => p.test(basename(filePath)));
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...walk(full));
    else if (extname(e.name).toLowerCase() === '.png') files.push(full);
  }
  return files;
}

const pngs = walk(VFX_DIR);
console.log(`Found ${pngs.length} PNGs\n`);

for (const src of pngs) {
  const dest = src.replace(/\.png$/i, '.webp');
  const lossless = isLossless(src);
  try {
    await sharp(src)
      .webp(lossless ? { lossless: true } : { quality: 90 })
      .toFile(dest);
    const srcStat = statSync(src);
    const dstStat = statSync(dest);
    const saved = Math.round((1 - dstStat.size / srcStat.size) * 100);
    console.log(`✓ ${basename(src)} → ${basename(dest)}  (${saved}% smaller, ${lossless ? 'lossless' : 'q90'})`);
  } catch (err) {
    console.error(`✗ ${src}: ${err.message}`);
  }
}

console.log('\nDone — originals untouched.');
