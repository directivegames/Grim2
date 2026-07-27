# png-to-webp

Convert PNG assets to WebP and remove the originals. Reduces asset bundle size with no visible quality loss for most game textures. Uses the `sharp` library, which runs natively in Node.js with no extra runtime dependencies.

---

## How it works

Two scripts run in sequence. The first converts every PNG in a target directory to WebP, choosing lossless encoding for images with alpha and quality-90 lossy for opaque images. The second deletes the PNG originals where a corresponding WebP now exists.

---

## 1. Install sharp

```bash
pnpm add -D sharp
```

---

## 2. Convert PNGs

Copy `convert-png-to-webp.mjs` from this skill's assets. Run it with a target directory:

```bash
node tools/convert-png-to-webp.mjs assets/UI
node tools/convert-png-to-webp.mjs assets/textures
```

The script walks the directory recursively and converts every `.png` it finds. It logs each conversion with before/after sizes and percentage saved. Originals are left in place.

---

## 3. Delete PNG originals

Once you have verified the WebP output looks correct, run the cleanup script:

```bash
node tools/remove-png-originals.mjs assets/UI
```

This deletes any `.png` file where a same-basename `.webp` exists. It never deletes a PNG that has no WebP counterpart (i.e. if conversion failed for a file, the original stays).

---

## 4. Update asset references in code

After deleting PNGs, any code that references `.png` paths must be updated to `.webp`. Search for the affected strings:

```bash
rg "\.png" src/
```

Batch-replace per folder if all assets in a directory were converted:

```bash
rg -l "assets/UI/.*\.png" src/ | xargs sed -i 's|assets/UI/\([^"]*\)\.png|assets/UI/\1.webp|g'
```

Or update references manually when only a subset of PNGs were converted.

---

## 5. Update scene / material JSON files

Asset paths also appear in `.genesys-scene`, `.material.json`, and `.prefab.json` files. Run the same replacement against those:

```bash
rg -l "\.png" assets/ | grep -v ".png$" | xargs sed -i 's/\.png/.webp/g'
```

Limit scope to specific subdirectories to avoid touching PNG file entries themselves.

---

## When to use lossless vs lossy

Lossless (`lossless: true`) — use for images with alpha channels (transparency), sprite sheets, pixel art, and any image where colour accuracy matters. File size savings are smaller but quality is identical to the original.

Lossy quality 90 (`quality: 90`) — use for opaque photographs, environment textures, and UI backgrounds without hard edges. Savings are typically 30–60% over PNG.

The conversion script detects alpha automatically using `sharp`'s `metadata()`. Override the threshold in the script if you want to force lossless for specific filename patterns (e.g. sprite sheets).

---

## Constraints

- `sharp` must be installed as a dev dependency. It is not included in engine packages.
- WebP is not supported in very old browsers. For a web game targeting modern browsers (2020+) it is universally safe.
- Do not convert the cloud shadow noise texture or any texture that relies on precise floating-point channel values — these are not typical PNG assets.
- Run conversion before committing to version control to avoid bloating git history with both PNG and WebP versions.
- Do not run the delete script until you have verified the converted WebP files visually in-game.
