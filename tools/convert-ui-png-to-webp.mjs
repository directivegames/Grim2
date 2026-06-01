/**
 * Convert PNG images under assets/UI to WebP (lossless when alpha, else q=90).
 * Run: pnpm exec tsx tools/convert-ui-png-to-webp.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const UI_DIR = path.resolve('assets/UI');

async function walkPngFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkPngFiles(full)));
    } else if (/\.png$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

async function convertOne(pngPath) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  const meta = await sharp(pngPath).metadata();
  const hasAlpha = meta.hasAlpha === true;

  const pipeline = sharp(pngPath);
  if (hasAlpha) {
    await pipeline.webp({ lossless: true }).toFile(webpPath);
  } else {
    await pipeline.webp({ quality: 90 }).toFile(webpPath);
  }

  const pngStat = await fs.stat(pngPath);
  const webpStat = await fs.stat(webpPath);
  const saved = Math.round((1 - webpStat.size / pngStat.size) * 100);
  console.log(
    `${path.relative(UI_DIR, pngPath)} → ${path.relative(UI_DIR, webpPath)} (${Math.round(pngStat.size / 1024)}KB → ${Math.round(webpStat.size / 1024)}KB, -${saved}%)`,
  );
}

const pngFiles = await walkPngFiles(UI_DIR);
console.log(`Converting ${pngFiles.length} PNG files in assets/UI…`);
for (const file of pngFiles) {
  await convertOne(file);
}
console.log('Done.');
