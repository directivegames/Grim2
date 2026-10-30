---
name: genesys-asset-compiler
description: "Build-time asset compression: KTX2 textures, Meshopt GLBs, MP3 audio (turning it on for synth WAV clips), excludes, conversion hook, raw-texture scanner. Use to shrink builds, download size, slow first load, WAV files too big, compress audio or music, or when a texture or UI image broke after baking. Not for frame rate (use `genesys-profiler`), choosing or making sounds (use `genesys-audio`), or size budgets per asset (use `genesys-assets`)."
metadata:
  tokens: 3208
---

# Asset Compiler

The asset compiler bakes assets into smaller runtime formats while building the project into `.dist/`. It never modifies source files under `assets/`. Game code, scenes, and materials keep referencing the original paths (`@project/assets/foo.png`). The build writes `.dist/.genesys/baked-assets.json`, and the engine loader uses it to swap in the baked file (`foo.png` → `foo.ktx2`).

It is **off by default**. All settings live under `assetCompiler` in the project's `.genesys-project` file. The editor exposes most of them in **Project Settings → Asset Compiler**.

The most important rule: **exclude every texture the DOM shows or CPU code reads before the first build.** KTX2 holds GPU block-compressed data only.

## Use another skill when
- Frame time, hitches, or a phone performance pass → `genesys-profiler`
- Choosing size budgets for meshes, images, or audio before they land in `assets/` → `genesys-assets`
- Loading textures at runtime (`ENGINE.resourceManager.loadTexture`, asset paths) → `genesys-engine`
- Building a UI screen that shows images → `genesys-ui`
- Choosing, synthesising or wiring sound clips → `genesys-audio` (synth clips land as WAV; turn on MP3 here: *Compress synth audio*)
- Title art, icons and other images a UI screen shows → `genesys-ui` (they go in `textureCompression.exclude`: *Keep UI and CPU textures raw*)
- Packaging content into a pack → `asset-pack-authoring`

## What gets converted

| Compiler id | Input | Output |
| --- | --- | --- |
| `glb-override-texture-strip` | `.glb` | Removes embedded textures from materials that use Genesys material overrides (`.material.json` replaces them at runtime). Runs first. |
| `ktx2-texture-compression` | `.glb` | Embedded textures re-encoded as KTX2 (Basis: ETC1S for colour, UASTC for normal maps). |
| `meshopt-mesh-compression` | `.glb` | Geometry compressed with Meshopt. Draco-compressed GLBs are skipped. |
| `ktx2-standalone-texture-compression` | Loose `.png`, `.jpg`/`.jpeg`, `.webp` | `.ktx2` next to it; the raw file is removed from `.dist`. |
| `mp3-audio-compression` | Loose `.wav`, `.flac`, `.aif`/`.aiff`, `.ogg`, `.m4a` | `.mp3`; the raw file is removed from `.dist`. |

GLBs are rewritten in place (same path). Loose textures and audio change extension and are remapped through the manifest.

## When it runs

`enabled: true` is required for anything to happen. Then:

- Share, upload, and explicit builds (including `genesys-sdk build`): always compile.
- Play-In-Editor: only when `compileOnPlay` is `true`. Off by default to keep the play loop fast.
- Opening the project in the editor: when `compileOnOpen` or `compileOnPlay` is `true`.

The project's own `pnpm build` only type-checks the TypeScript. It does not build `.dist` or run the asset compiler.

Compiler failures are logged and never fail the build. A file that cannot be converted ships raw.

Baked outputs are cached in `.genesys/cache/asset-compiler/` keyed by source hash and settings, so unchanged assets are restored instead of re-encoded. Deleting that folder forces a full re-bake.

## Configure

Minimal opt-in. Every omitted key takes its default; invalid values log a warning and fall back.

Source: this skill's [configuration.md](references/configuration.md); key shape as in `node_modules/@gnsx/genesys.js/scripts/bake-assets.ts`
```json
{
  "assetCompiler": {
    "enabled": true,
    "textureCompression": { "quality": "medium", "maxSize": 2048, "exclude": ["assets/ui/", "assets/data/"] }
  }
}
```

Defaults worth knowing: texture `quality` `medium`, `maxSize` 2048 (`1024` for mobile-first, `0` keeps the size), loose `formats` png and jpeg on and webp off (so HTML UI images keep working), mesh `level` `medium`, MP3 at 96 / 128 / 192 kbps by audio `quality` (`medium` = 128). Edit `.genesys-project` or Project Settings (both preserved on save), then rebuild or reopen. Every key, binary paths and the exclude-pattern rules: [configuration.md](references/configuration.md).

## Compress synth audio

`synth.mjs` (`genesys-audio`) writes 16-bit mono 44.1 kHz WAV: about 5.3 MB per minute. With the compiler off, WAV ships raw: one real project shipped 3.5 MB of WAV, 2.6 MB of it one music loop. `audioCompression` is already on by default inside the section, so the switch that matters is the master `enabled`. Whoever adds synth clips turns it on in the same step (or keeps clips short):

- **Audio only** (no texture or mesh risk; use it when nobody has checked UI images yet):

Source: this skill's [configuration.md](references/configuration.md) (`enabled`, `textureCompression.enabled`, `meshCompression.enabled`, `audioCompression.quality`)
```json
{
  "assetCompiler": {
    "enabled": true,
    "textureCompression": { "enabled": false },
    "meshCompression": { "enabled": false },
    "audioCompression": { "enabled": true, "quality": "medium" }
  }
}
```

- **Everything on**: the *Configure* block above, with every UI and CPU image excluded first (`find-raw-textures.mjs --check` passes). Title art and icons under `assets/ui/` must be in `textureCompression.exclude`, or the title screen shows a broken image in the shipped build.

Edit only the `assetCompiler` key and keep the other keys as they are. At `medium` a clip shrinks about 5.5×; the music bed budget (≤ 1.5 MB after compression, `genesys-assets`) holds about 90 s at `medium` or 2 min at `low`. Play-In-Editor still plays the WAV unless `compileOnPlay` is on; the size win shows in the build log and in `baked-assets.json` (`….wav` → `….mp3`).

**Exclude patterns** (`textureCompression.exclude`) are gitignore-style, case-insensitive, against `assets/...` paths. A matching loose texture ships raw; a matching GLB keeps its embedded textures but still gets Meshopt. A `!` rule cannot re-include a file inside an excluded folder: write `folder/*` ([configuration.md](references/configuration.md#excluding-textures)).

## Decide per asset with a conversion hook

When patterns are not enough (skip one GLB from Meshopt, keep a specific WAV raw, decisions driven by a data file), point `conversionHook` at a module exporting a synchronous `shouldConvertAsset(ctx)`. It returns `true` to convert, `false` to skip, or `undefined` to keep the built-in decision.

Source: this skill's [conversion-hook.md](references/conversion-hook.md) (`shouldConvertAsset` contract)
```js
// scripts/asset-conversion-hook.mjs
export function shouldConvertAsset({ relativePath, compiler, defaultConvert }) {
  if (compiler.startsWith('ktx2-') && relativePath.startsWith('assets/ui/')) {
    return relativePath === 'assets/ui/atlas.png';
  }
  return undefined;
}
```

The hook runs after the format toggles and exclude patterns. It can override the patterns but cannot re-enable a disabled format. Read [conversion-hook.md](references/conversion-hook.md) before writing one: it covers evaluation order, the context fields, file-type rules, and failure behaviour.

## Keep UI and CPU textures raw

Two consumers break after a bake:

- **UI (DOM).** Browsers cannot display KTX2 in `<img>` or CSS backgrounds. The build keeps raw, on its own, every texture that a project `.html`, `.htm` or `.css` file names by its `@project/...` path (the log says "Keeping N texture(s) referenced by UI HTML/CSS uncompressed"). Images that DOM code or UI data set, and relative or `/assets/...` paths, still need an exclude.
- **CPU code.** `getImageData`, `createImageBitmap`, `THREE.ImageLoader`, `fetch` of image bytes, `texture.image.data`, `TerrainMeshNode.setHeightMap`, masks, layouts, lookup tables, XR `CanvasUI` `{ type: 'img' }`.

Find them with the bundled scanner instead of guessing. Run it from the project root, with the path to this skill's folder (`--help` prints the exact command):

Source: `scripts/find-raw-textures.mjs` in this skill
```bash
node .agents/skills/genesys-asset-compiler/scripts/find-raw-textures.mjs
```

Resolve its "Needs review" list, look for CPU consumers it cannot see, apply with `--write`, then confirm with `--check` (exits 1 while a must-stay-raw texture would still convert). When unsure, exclude: a false positive costs download size, a miss is a broken image in the shipped game. Keep DOM images under `assets/ui/` and pixel data under `assets/data/`, exclude both, and keep two copies of an image that is both a GPU texture and a UI or CPU source. Classification, the full workflow, options and staged rollout: [raw-textures.md](references/raw-textures.md).

## Prefer the simplest tool

Use a format toggle to skip a whole file type, an exclude pattern to keep a folder, file or GLB's textures raw, and the conversion hook only to skip Meshopt, the override strip or MP3 for specific files, to force-convert an excluded texture, or to decide from data. Patterns are plain data (editable in Project Settings, they drive asset-browser badges, they cannot fail); a hook must stay synchronous and deterministic and return `undefined` for everything it does not care about. Table and reasoning: [conversion-hook.md](references/conversion-hook.md#patterns-or-a-hook).

## Limitations

- **UI images set from code break after baking unless excluded.** The build keeps raw only the textures that `.html` / `.css` files name by `@project/` path. An image that DOM code or UI data sets (`img.src`, `imageUrl`) is baked, and the browser cannot display the KTX2; other paths (`<img src="/assets/...">`, relative CSS `url(...)`, a direct `fetch`) 404 because the raw file is removed from `.dist`. An `<audio>` element or `fetch` with a raw audio path 404s the same way after MP3 transcoding; keep that audio raw with the conversion hook.
- **A looping music bed clicks or gaps at the loop point after the build.** MP3 encoding can pad the start and end of a clip. Listen to the built game (verify on first use); if the loop breaks, keep that one file raw with the conversion hook (`mp3-audio-compression` → `false`) and shorten it instead.
- `formats` only covers loose textures, Draco GLBs skip Meshopt: [configuration.md](references/configuration.md#limitations).

## Traps

- **CPU pixel reads fail on baked textures.** A heightmap, mask, or layout image read with a canvas, `createImageBitmap`, or `fetch` gets a 404 or GPU-compressed bytes instead of RGBA pixels. Exclude every image whose pixels gameplay code reads.
- **KTX2 needs dimensions that are multiples of 4** (after any `maxSize` downscale), and at least 4px on each edge. Other textures ship uncompressed with a warning. Resize the source, or rely on `maxSize` producing valid dimensions.
- **Synth WAVs ship raw, the build is several MB of audio.** `assetCompiler.enabled` is `false` (the default), so `audioCompression` never runs. Turn it on (*Compress synth audio*).
- **Title screen image broken only in the shipped build.** The compiler was turned on for audio with textures still on, the image is set from code, and `assets/ui/` was not excluded. Exclude it, or use the audio-only config.
- PIE does not compile by default, `.dist/` and the cache are regenerated: [configuration.md](references/configuration.md#traps).

## Done

1. Run `find-raw-textures.mjs --check` (see above). If the game has synth WAVs, `assetCompiler.enabled` is `true` and `audioCompression` is on.
2. Build (Share/upload, `genesys-sdk build`, or Play with `compileOnPlay: true`).
3. Read the build log. Lines are prefixed `[asset-compiler...]`. It reports skipped files with a reason (for example "not a multiple of 4 for KTX2. Leaving uncompressed.") and a size summary at the end.
4. Check `.dist/.genesys/baked-assets.json`. Each entry maps an original `@project/...` path to its baked target. A skipped texture has no entry, so no UI or CPU texture should appear there; every `.wav` should map to an `.mp3`.
5. Play the built game, open every UI screen, and load every level that reads image data; check the console for 404s and decode errors.
6. In the editor, the asset browser badges textures that will be downscaled or cannot be compressed. Badges are hidden for excluded textures and follow the conversion hook when running in the desktop app.

## References
- [configuration.md](references/configuration.md) — full `assetCompiler` shape, every key, binary paths, exclude-pattern rules, config limitations and traps
- [raw-textures.md](references/raw-textures.md) — scanner classification, review workflow, folder layout, staged rollout, source authoring
- [conversion-hook.md](references/conversion-hook.md) — patterns or a hook, `shouldConvertAsset` contract, evaluation order, failure behaviour
