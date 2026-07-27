# sharp Setup

## Installing

```bash
pnpm add -D sharp
```

`sharp` is a native Node.js module backed by `libvips`. It is fast and has no runtime browser dependency — it only runs during your build/tooling step.

## Platform notes

On Windows, `sharp` downloads a prebuilt binary. If the install fails, ensure you have the latest Node.js (18+) and run:

```bash
pnpm add -D sharp --ignore-scripts=false
```

On macOS (Apple Silicon), pnpm/npm should automatically pull the arm64 binary.

## Verifying the install

```js
import sharp from 'sharp';
const meta = await sharp('assets/UI/test.png').metadata();
console.log(meta.width, meta.height, meta.hasAlpha);
```

## Common sharp API

```js
// Lossless WebP (best for alpha images)
await sharp(input).webp({ lossless: true }).toFile(output);

// Lossy WebP quality 90 (best for opaque photos/textures)
await sharp(input).webp({ quality: 90 }).toFile(output);

// Get image metadata (width, height, format, hasAlpha, etc.)
const meta = await sharp(input).metadata();

// Resize during conversion
await sharp(input).resize(512, 512).webp({ quality: 85 }).toFile(output);
```

## Checking output size

```js
import fs from 'node:fs/promises';
const before = (await fs.stat(pngPath)).size;
const after  = (await fs.stat(webpPath)).size;
const saving = Math.round((1 - after / before) * 100);
console.log(`-${saving}%`);
```
