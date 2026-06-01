/**
 * Split iconsformap.webp into icon1..icon8.png and compass.png (2x4 grid + compass).
 */
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('assets/UI/iconsformap.webp');
const OUT_DIR = path.resolve('assets/UI');

/** 2 rows × 4 columns — tuned for 1536×1024 source. */
const ICON_CELLS = [
  // Row 1 (top)
  { left: 28, top: 68, width: 352, height: 188 },
  { left: 400, top: 68, width: 352, height: 188 },
  { left: 772, top: 68, width: 352, height: 188 },
  { left: 1144, top: 68, width: 352, height: 188 },
  // Row 2 (bottom)
  { left: 28, top: 285, width: 352, height: 188 },
  { left: 400, top: 285, width: 352, height: 188 },
  { left: 772, top: 285, width: 352, height: 188 },
  { left: 1144, top: 285, width: 352, height: 188 },
];

const COMPASS = { left: 40, top: 630, width: 340, height: 290 };

async function main() {
  for (let i = 0; i < ICON_CELLS.length; i++) {
    const cell = ICON_CELLS[i];
    const out = path.join(OUT_DIR, `icon${i + 1}.png`);
    await sharp(SRC).extract(cell).png().toFile(out);
    console.log(`icon${i + 1}.png`, cell);
  }

  const out = path.join(OUT_DIR, 'compass.png');
  await sharp(SRC).extract(COMPASS).png().toFile(out);
  console.log('compass.png', COMPASS);
  console.log('Done — saved to', OUT_DIR);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
