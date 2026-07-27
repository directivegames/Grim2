/**
 * Write resized copies beside locked originals, then print the new paths.
 * Does not overwrite in-use files.
 *
 * Usage:
 *   node tools/resize-model-textures.mjs [dir=assets/models] [maxDim=1024]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(process.argv[2] ?? 'assets/models');
const maxDim = Number(process.argv[3] ?? 1024);

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (/\.(webp|png|jpe?g)$/i.test(entry.name) && !/\.1k\./i.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function kb(n) {
  return Math.round(n / 1024);
}

function sizedPath(file) {
  const ext = path.extname(file);
  const base = file.slice(0, -ext.length);
  return `${base}.1k${ext.toLowerCase() === '.jpeg' ? '.jpg' : ext.toLowerCase()}`;
}

const files = await walk(root);
let changed = 0;
const renames = [];
for (const file of files) {
  const before = (await fs.stat(file)).size;
  if (before < 1.5 * 1024 * 1024) continue;

  const meta = await sharp(file).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w <= maxDim && h <= maxDim && before < 4 * 1024 * 1024) continue;

  const pipeline = sharp(file).resize({
    width: maxDim,
    height: maxDim,
    fit: 'inside',
    withoutEnlargement: true,
  });

  const outPath = sizedPath(file);
  const ext = path.extname(outPath).toLowerCase();
  let afterBuf;
  if (ext === '.png') {
    afterBuf = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  } else if (ext === '.jpg' || ext === '.jpeg') {
    afterBuf = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } else {
    afterBuf = await pipeline
      .webp(meta.hasAlpha === true ? { lossless: true } : { quality: 82 })
      .toBuffer();
  }

  await fs.writeFile(outPath, afterBuf);
  changed += 1;
  renames.push({ from: path.basename(file), to: path.basename(outPath) });
  console.log(
    `  ${path.relative(root, file)} → ${path.basename(outPath)}  ${w}x${h}  ${kb(before)}KB → ${kb(afterBuf.length)}KB`,
  );
}

console.log(`Wrote ${changed} resized texture(s).`);
if (renames.length) {
  console.log(JSON.stringify(renames));
}
