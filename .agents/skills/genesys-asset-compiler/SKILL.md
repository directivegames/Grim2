---
name: genesys-asset-compiler
description: Configure the Genesys build-time asset compiler — KTX2 texture compression, Meshopt GLB compression, MP3 audio transcoding, texture exclude patterns, and the shouldConvertAsset conversion hook — via the assetCompiler section of .genesys-project or Project Settings. Includes a scanner that finds textures used by UI or read as pixels on the CPU and writes exclude patterns for them. Use when setting up or verifying asset compilation, the user asks to compress, bake, or optimise textures, meshes, or audio, shrink build/download size, mentions KTX2, Basis, Meshopt, MP3, assetCompiler, baked-assets.json, or asks why an asset was (or was not) converted, why an HTML/CSS image broke, or why a heightmap/mask/getImageData read fails after a build.
---

# Asset Compiler

The asset compiler bakes assets into smaller runtime formats while building the project into `.dist/`. It never modifies source files under `assets/`. Game code, scenes, and materials keep referencing the original paths (`@project/assets/foo.png`). The build writes `.dist/.genesys/baked-assets.json`, and the engine loader uses it to swap in the baked file (`foo.png` → `foo.ktx2`).

It is **off by default**. All settings live under `assetCompiler` in the project's `.genesys-project` file. The editor exposes most of them in **Project Settings → Asset Compiler**.

## What gets converted

| Compiler id | Input | Output |
| --- | --- | --- |
| `glb-override-texture-strip` | `.glb` | Removes embedded textures from materials that use Genesys material overrides (`.material.json` replaces them at runtime). Runs first. |
| `ktx2-texture-compression` | `.glb` | Embedded textures re-encoded as KTX2 (Basis: ETC1S for colour, UASTC for normal maps). |
| `meshopt-mesh-compression` | `.glb` | Geometry compressed with Meshopt. Draco-compressed GLBs are skipped. |
| `ktx2-standalone-texture-compression` | Loose `.png`, `.jpg`/`.jpeg`, `.webp` | `.ktx2` next to it; the raw file is removed from `.dist`. |
| `mp3-audio-compression` | Loose `.wav`, `.flac`, `.aif`/`.aiff`, `.ogg`, `.aac`, `.m4a` | `.mp3`; the raw file is removed from `.dist`. |

GLBs are rewritten in place (same path). Loose textures and audio change extension and are remapped through the manifest.

## When it runs

`enabled: true` is required for anything to happen. Then:

- Share, upload, and explicit builds (including `genesys-sdk build`): always compile.
- Play-In-Editor: only when `compileOnPlay` is `true`. Off by default to keep the play loop fast.
- Opening the project in the editor: when `compileOnOpen` or `compileOnPlay` is `true`.

The project's own `pnpm build` only type-checks the TypeScript. It does not build `.dist` or run the asset compiler.

Compiler failures are logged and never fail the build. A file that cannot be converted ships raw.

Baked outputs are cached in `.genesys/cache/asset-compiler/` keyed by source hash and settings, so unchanged assets are restored instead of re-encoded. Deleting that folder forces a full re-bake.

## Configuration

Full shape with defaults. Omitted keys use these defaults; invalid values log a warning and fall back to the default.

```json
{
  "assetCompiler": {
    "enabled": false,
    "compileOnPlay": false,
    "compileOnOpen": false,
    "textureCompression": {
      "enabled": true,
      "quality": "medium",
      "maxSize": 2048,
      "formats": { "png": true, "jpeg": true, "webp": false },
      "exclude": []
    },
    "meshCompression": {
      "enabled": true,
      "level": "medium"
    },
    "audioCompression": {
      "enabled": true,
      "quality": "medium",
      "formats": { "wav": true, "flac": true, "aiff": true, "ogg": true, "aac": true, "m4a": true }
    },
    "warnExternalGlbTextures": false,
    "conversionHook": "scripts/asset-conversion-hook.mjs"
  }
}
```

| Key | Notes |
| --- | --- |
| `enabled` | Master switch. |
| `compileOnPlay` / `compileOnOpen` | See "When it runs". `compileOnOpen` is not shown in Project Settings. |
| `textureCompression.enabled` | Turns off both KTX2 compilers (loose and GLB-embedded). |
| `textureCompression.quality` | `low` / `medium` / `high`. Higher is larger and slower to encode. |
| `textureCompression.maxSize` | Longest edge in pixels before downscaling (aspect preserved). `0` keeps the original size. Applies to loose and GLB-embedded textures. |
| `textureCompression.formats` | Which **loose** texture types are baked. GLB-embedded textures ignore this. WebP is off so HTML UI images keep working. |
| `textureCompression.exclude` | Gitignore-style patterns; see below. |
| `textureCompression.binaryPath` | Optional absolute path to KTX-Software `ktx`. Otherwise `GENESYS_KTX_PATH`, the bundled copy, then `PATH`. |
| `meshCompression.level` | `low` / `medium` / `high`. `low` uses the smaller encoder tier; `medium` and `high` use the same higher-quality tier. |
| `audioCompression.quality` | MP3 bitrate: `low` 96 kbps, `medium` 128 kbps, `high` 192 kbps. |
| `audioCompression.formats` | Which loose audio types are transcoded. `aiff` covers `.aif` and `.aiff`. |
| `audioCompression.binaryPath` | Optional absolute path to `ffmpeg`. Otherwise `GENESYS_FFMPEG_PATH`, then `PATH`. |
| `warnExternalGlbTextures` | Warn about GLBs that reference sidecar texture files without material overrides. Not shown in Project Settings. |
| `conversionHook` | Optional project-relative path to a JS module that decides per asset; see below. |

Edit `.genesys-project` directly or use Project Settings; both are preserved on save. After editing the file by hand, rebuild (or reopen the project) for the change to take effect.

## Excluding textures

`textureCompression.exclude` takes gitignore-style patterns matched case-insensitively against project-relative paths (`assets/...`). A string with one pattern per line is also accepted.

```json
"exclude": ["assets/ui/", "*.icon.png", "assets/hud/*", "!assets/hud/atlas.png"]
```

- A matching loose texture ships as the original file.
- A matching GLB keeps its embedded textures. Meshopt and the override strip still run on it.
- Exclusions only affect textures. Use the conversion hook to skip meshes or audio.
- Gitignore rules apply strictly: a `!` rule cannot re-include a file inside an excluded folder. `assets/ui/` followed by `!assets/ui/atlas.png` still excludes the atlas; write `assets/ui/*` instead, or use the conversion hook.

## Deciding per asset with a conversion hook

When patterns are not enough (skip one GLB from Meshopt, keep a specific WAV raw, decisions driven by a data file), point `conversionHook` at a module exporting a synchronous `shouldConvertAsset(ctx)`. It returns `true` to convert, `false` to skip, or `undefined` to keep the built-in decision.

```js
// scripts/asset-conversion-hook.mjs
export function shouldConvertAsset({ relativePath, compiler, defaultConvert }) {
  if (compiler.startsWith('ktx2-') && relativePath.startsWith('assets/ui/')) {
    return relativePath === 'assets/ui/atlas.png';
  }
  return undefined;
}
```

The hook runs after the format toggles and exclude patterns and can override the patterns but not re-enable a disabled format. Read [references/conversion-hook.md](references/conversion-hook.md) before writing one: it covers evaluation order, the context fields, file-type rules, and failure behaviour.

## Common practices

### Exclude every texture that is not only sampled by the GPU

KTX2 is only useful for textures the renderer uploads to the GPU and samples in shaders. Two other kinds of consumer break after a bake, so their textures must stay raw:

- **UI (DOM).** Browsers cannot display KTX2 in `<img>` or CSS backgrounds. `@project/...png` paths in UI templates are rewritten to the `.ktx2` (blank image), and relative or `/assets/...` paths 404 because the raw file was removed from `.dist`.
- **CPU code.** Anything that reads pixel values in TypeScript: drawing to a 2D canvas and calling `getImageData`, `createImageBitmap`, `THREE.ImageLoader`, `fetch` of the image bytes, decoding with an image library, or `texture.image.data`. Typical cases are terrain heightmaps fed to `TerrainMeshNode.setHeightMap`, collision or spawn masks, level layouts painted as images, lookup tables sampled in gameplay code, and XR `CanvasUI` `{ type: 'img' }` entries. A KTX2 file holds GPU block-compressed data with no readable RGBA pixels, and the original `.png` path 404s.

Find them with the bundled scanner instead of guessing:

```bash
node .agents/skills/genesys-asset-compiler/scripts/find-raw-textures.mjs
```

It walks the project (skipping `.dist`, `.genesys`, `.engine`, `node_modules`, and other dot-folders) and tags each texture reference `ui`, `cpu`, 3D (ignored), or review:

- `.html` / `.css` / `.scss` / `.less` files: every reference is `ui`.
- TypeScript/JavaScript, per reference line:
  - CPU pixel access on the line (`getImageData`, `drawImage`, `createImageBitmap`, `ImageLoader`, `fetch(`, `.arrayBuffer()`, `heightmap`, `setHeightMap`, `sharp(`, `type: 'img'`, …): `cpu`.
  - DOM usage (`.src =`, `url(`, `innerHTML`, `new Image(`, `imageUrl`, `setIcon`, `customStyles`, …): `ui`.
  - Texture/material/map usage (`loadTexture`, `normalMap`, …): 3D, ignored. In a file that also reads pixels on the CPU it goes to review, because the loaded texture may be read back.
  - No clear usage: `ui` inside a `BaseUIComponent` subclass or a `ui/` / `hud/` / `menus/` folder, `cpu` in a file that reads pixels, otherwise review.
- JSON, prefabs, and scenes: UI-style keys (`icon`, `image`, `imageUrl`, `avatar`, `logo`, `background`, …) are `ui`. CPU-style keys (`heightMap`, `mask`, `collision`, `spawn`, `layout`, `lookup`, …) go to review. `.material.json` and `.vfx.json` are always 3D.
- Dynamic paths such as `` `assets/ui/icons/${id}.png` ``: every texture in the static folder (`assets/ui/icons/`) must stay raw.

It prints the textures that must stay raw with their tags and references, ambiguous references to review, and suggested `exclude` patterns. A folder pattern is used when every texture under it must stay raw (never a top-level folder such as `assets/`); otherwise individual files are listed. It also reports which of those textures the current config would still convert, after applying the enabled flags, format toggles, existing patterns, and the conversion hook.

Workflow:

1. Run the scanner and read the "Needs review" list. Open each reference and decide whether the texture is shown through the DOM or its pixels are read on the CPU. Rerun with `--include-review` if they all are, or add those paths to `exclude` by hand.
2. Search for CPU consumers the scanner cannot see: textures loaded in one module and read back in another (`texture.image` passed to a canvas helper), paths coming from config or network data, and custom `@property` fields on your nodes that hold image paths for CPU use. Exclude those paths or their folder.
3. Check "did not resolve" references by hand. They are usually paths built from variables; find where the value comes from and exclude that folder.
4. Apply with `--write` (merges into the `.genesys-project` exclude list and keeps existing patterns), or edit the list yourself.
5. Rerun with `--check`. It exits 1 while any must-stay-raw texture would still be converted. Run it again after adding UI screens, icons, or pixel-reading code.

False positives only cost download size; a missed texture is a broken image or a failed pixel read in the shipped game. When unsure, exclude.

Options: `--project <dir>`, `--include-review`, `--no-collapse` (one pattern per file), `--write`, `--check`, `--json`.

### Keep raw textures in their own folders

Put everything the DOM shows under one folder (for example `assets/ui/`) and pixel data under another (for example `assets/data/` for heightmaps, masks, and layouts), and exclude both folders. New files are covered automatically, and GPU textures never share those folders. If one image is both a GPU texture and a UI or CPU source, keep two copies so the GPU copy still gets compressed.

### Roll out in stages

1. Set `enabled: true` and temporarily `compileOnPlay: true`, so Play runs the same bake as a shared build.
2. Exclude UI and CPU textures (above) before the first build.
3. Play through every screen (menus, HUD, inventory, store, dialogs) and every level that builds terrain or gameplay data from images. Watch the browser console for 404s, image decode errors, and canvas read failures.
4. Set `compileOnPlay` back to `false` once the setup is stable, to keep Play fast.

### Prefer the simplest tool

Pick the first row that fits:

| Need | Use |
| --- | --- |
| Skip a whole texture or audio file type | Format toggle (`textureCompression.formats`, `audioCompression.formats`) |
| Keep a folder or file of textures raw (UI, CPU data) | Exclude pattern |
| Keep a GLB's embedded textures raw | Exclude pattern on the GLB path |
| Re-include one texture inside an excluded folder | `folder/*` plus a `!folder/file.png` pattern |
| Skip Meshopt, the override strip, or MP3 for specific files | Conversion hook |
| Force-convert a texture that a pattern excludes | Conversion hook |
| Decide from data (a JSON list, naming rules patterns cannot express) | Conversion hook |

Patterns are the default because they are plain data: editable in Project Settings (with a live match count), applied to asset-browser badges in every editor, and they cannot fail. The hook is a separate JavaScript file that must stay synchronous, only drives badges in the desktop app, and falls back to built-in rules with a single warning if it fails to load. When you do write one, keep it deterministic (same input, same answer, no reliance on time or environment), return `undefined` for everything it does not care about, and leave texture folders to patterns.

### Author sources the baker can compress

Make texture dimensions multiples of 4 (powers of two are ideal) and set `maxSize` for the target platform (for example `1024` for mobile-first games). Export GLBs without Draco. Re-exporting a source is cheaper than shipping it uncompressed.

## Verifying a change

1. Run `find-raw-textures.mjs --check` (see above).
2. Build (Share/upload, `genesys-sdk build`, or Play with `compileOnPlay: true`).
3. Read the build log. Lines are prefixed `[asset-compiler...]`. It reports skipped files with a reason (for example "not a multiple of 4 for KTX2. Leaving uncompressed.") and a size summary at the end.
4. Check `.dist/.genesys/baked-assets.json`. Each entry maps an original `@project/...` path to its baked target. A skipped texture has no entry, so no UI or CPU texture should appear there.
5. Play the built game, open every UI screen, and load every level that reads image data; check the console for 404s and decode errors.
6. In the editor, the asset browser badges textures that will be downscaled or cannot be compressed. Badges are hidden for excluded textures and follow the conversion hook when running in the desktop app.

## Footguns

- **UI images break after baking unless excluded.** Engine loading and `@project/` paths in UI templates are remapped to the baked file, which the browser cannot display; other paths (`<img src="/assets/...">`, relative CSS `url(...)`, a direct `fetch`) 404 because the raw file is removed from `.dist`. An `<audio>` element or `fetch` with a raw audio path 404s the same way after MP3 transcoding; keep that audio raw with the conversion hook. See "Exclude every texture that is not only sampled by the GPU".
- **CPU pixel reads fail on baked textures.** A heightmap, mask, or layout image read with a canvas, `createImageBitmap`, or `fetch` gets a 404 or GPU-compressed bytes instead of RGBA pixels. Exclude every image whose pixels gameplay code reads.
- **KTX2 needs dimensions that are multiples of 4** (after any `maxSize` downscale), and at least 4px on each edge. Other textures ship uncompressed with a warning. Resize the source, or rely on `maxSize` producing valid dimensions.
- **PIE does not compile by default.** If a bake issue only shows up in shared builds, set `compileOnPlay: true` to reproduce it locally.
- **`textureCompression.formats` only affects loose textures.** To stop GLB-embedded textures from being re-encoded, exclude the GLB path or return `false` from the hook for `ktx2-texture-compression`.
- **Draco-compressed GLBs are not re-compressed by Meshopt.** Re-export without Draco to get mesh compression.
- **Do not edit files in `.dist/` or `.genesys/cache/`.** They are regenerated on every build.
