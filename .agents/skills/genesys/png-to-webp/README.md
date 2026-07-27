# png-to-webp — Rationale

## Why WebP over PNG

WebP achieves comparable visual quality to PNG at significantly smaller file sizes. For a web game, smaller assets mean faster initial load and less bandwidth consumed — which matters especially on mobile. Typical savings in Grim's UI folder were 30–60% per file.

## Why two separate scripts

Conversion and deletion are intentionally separate so you can verify the output before committing to removing the originals. Running the conversion, checking the game visually, and only then running the delete step prevents losing originals to a bad conversion (e.g. sharp failing on a particular file, or a lossless/lossy choice being wrong for an asset).

## Why lossless for alpha images

WebP lossless with alpha is bit-exact — the decoded pixels are identical to the PNG source. For UI sprites with transparent backgrounds, lossy compression introduces fringing artifacts along alpha edges that are visually obvious. The automatic alpha detection in `sharp`'s `metadata()` handles this without manual annotation.

## Why quality 90 for opaque images

Quality 90 is the practical maximum for lossy WebP — it is visually indistinguishable from the source for game textures and UI backgrounds, while still saving 30–50% over PNG. Going above 90 produces negligible additional quality at much larger file sizes.

## Why --dry-run on the delete script

Deleting build artifacts is irreversible (without version control). The dry-run flag lets you audit the full list of files that would be removed before committing. It costs nothing and prevents accidents when the script is run in the wrong directory.

## The FORCE_LOSSLESS pattern list

Some assets should always use lossless regardless of whether they have alpha — sprite sheets and batch textures where individual pixels carry distinct colour values. The `FORCE_LOSSLESS` array in the conversion script catches these by filename pattern. Add to it as needed for your project's naming conventions.
