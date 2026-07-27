/**
 * remove-png-originals.mjs
 *
 * Deletes PNG files that have a matching WebP file in the same directory.
 * A PNG is only deleted when a same-basename .webp exists alongside it.
 * If conversion failed and no .webp was produced, the PNG is kept.
 *
 * Usage:
 *   node tools/remove-png-originals.mjs <directory>
 *   node tools/remove-png-originals.mjs assets/UI
 *
 * Pass --dry-run to preview what would be deleted without deleting anything.
 *
 * Run AFTER verifying convert-png-to-webp.mjs output looks correct in-game.
 */
import fs from 'node:fs';
import path from 'node:path';

// ─── Args ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetArg = args.find((a) => !a.startsWith('--'));
const targetDir = path.resolve(targetArg ?? '.');

if (!fs.existsSync(targetDir)) {
  console.error(`Directory not found: ${targetDir}`);
  process.exit(1);
}

if (dryRun) {
  console.log('[DRY RUN] No files will be deleted.\n');
}

// ─── Walk ─────────────────────────────────────────────────────────────────────

function walkPngs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walkPngs(full));
    } else if (/\.png$/i.test(e.name)) {
      files.push(full);
    }
  }
  return files;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log(`Scanning ${targetDir}…\n`);
const pngs = walkPngs(targetDir);

let removed = 0;
let kept = 0;

for (const pngPath of pngs) {
  const webpPath = pngPath.replace(/\.png$/i, '.webp');
  const rel = path.relative(targetDir, pngPath);

  if (!fs.existsSync(webpPath)) {
    console.log(`  keep (no webp): ${rel}`);
    kept++;
    continue;
  }

  if (dryRun) {
    console.log(`  would delete:   ${rel}`);
  } else {
    fs.unlinkSync(pngPath);
    console.log(`  deleted:        ${rel}`);
  }
  removed++;
}

console.log(`\n${dryRun ? 'Would remove' : 'Removed'} ${removed} file(s). Kept ${kept} (no matching webp).`);
