/**
 * convert-png-to-webp.mjs
 *
 * Converts every PNG in a directory (recursively) to WebP.
 * - Images with alpha   → lossless WebP (bit-exact, no quality loss)
 * - Images without alpha → quality-90 lossy WebP (~30–60% smaller than PNG)
 *
 * Originals are NOT deleted. Run remove-png-originals.mjs after verifying output.
 *
 * Usage:
 *   node tools/convert-png-to-webp.mjs <directory>
 *   node tools/convert-png-to-webp.mjs assets/UI
 *   node tools/convert-png-to-webp.mjs assets/textures
 *
 * Requires: sharp  (pnpm add -D sharp)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Filename patterns that should always use lossless encoding, regardless of
 * alpha detection. Add patterns for sprite sheets, pixel art, etc.
 */
const FORCE_LOSSLESS = [/sheet/i, /sprite/i, /batch/i];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function walkPngs(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await walkPngs(full)));
    } else if (/\.png$/i.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

function shouldForceLossless(filePath) {
  return FORCE_LOSSLESS.some((re) => re.test(path.basename(filePath)));
}

async function convertOne(pngPath, rootDir) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  const rel = path.relative(rootDir, pngPath);

  try {
    const meta = await sharp(pngPath).metadata();
    const lossless = shouldForceLossless(pngPath) || meta.hasAlpha === true;

    await sharp(pngPath)
      .webp(lossless ? { lossless: true } : { quality: 90 })
      .toFile(webpPath);

    const [pngStat, webpStat] = await Promise.all([fs.stat(pngPath), fs.stat(webpPath)]);
    const saved = Math.round((1 - webpStat.size / pngStat.size) * 100);
    const mode = lossless ? 'lossless' : 'q90';

    console.log(
      `  ${rel} → .webp  ` +
      `${kb(pngStat.size)}KB → ${kb(webpStat.size)}KB  ` +
      `-${saved}%  [${mode}]`,
    );
  } catch (err) {
    console.error(`  ERROR ${rel}: ${err.message}`);
  }
}

function kb(bytes) {
  return Math.round(bytes / 1024);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const targetDir = path.resolve(process.argv[2] ?? '.');

try {
  await fs.access(targetDir);
} catch {
  console.error(`Directory not found: ${targetDir}`);
  process.exit(1);
}

console.log(`Scanning ${targetDir} for PNG files…`);
const pngs = await walkPngs(targetDir);
console.log(`Found ${pngs.length} PNG file(s).\n`);

if (pngs.length === 0) {
  console.log('Nothing to convert.');
  process.exit(0);
}

for (const file of pngs) {
  await convertOne(file, targetDir);
}

console.log('\nDone. Originals are untouched — run remove-png-originals.mjs to delete them.');
