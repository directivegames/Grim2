# Raw textures, scanner, and rollout

Which textures must stay raw, how `scripts/find-raw-textures.mjs` classifies references, the review workflow, folder layout, staged rollout, and source authoring. Open this before the first build with the compiler enabled, or when a UI image or pixel read breaks after a build.

## Exclude every texture that is not only sampled by the GPU

KTX2 is only useful for textures the renderer uploads to the GPU and samples in shaders. Two other kinds of consumer break after a bake, so their textures must stay raw:

- **UI (DOM).** Browsers cannot display KTX2 in `<img>` or CSS backgrounds. The build keeps raw, on its own, every texture that a project `.html`, `.htm` or `.css` file names by its `@project/...` path (the log says "Keeping N texture(s) referenced by UI HTML/CSS uncompressed"). An image that DOM code or UI data sets is still baked and shows blank, and relative or `/assets/...` paths 404 because the raw file was removed from `.dist`.
- **CPU code.** Anything that reads pixel values in TypeScript: drawing to a 2D canvas and calling `getImageData`, `createImageBitmap`, `THREE.ImageLoader`, `fetch` of the image bytes, decoding with an image library, or `texture.image.data`. Typical cases are terrain heightmaps fed to `TerrainMeshNode.setHeightMap`, collision or spawn masks, level layouts painted as images, lookup tables sampled in gameplay code, and XR `CanvasUI` `{ type: 'img' }` entries. A KTX2 file holds GPU block-compressed data with no readable RGBA pixels, and the original `.png` path 404s.

Find them with the bundled scanner instead of guessing:

```bash
node .agents/skills/genesys-asset-compiler/scripts/find-raw-textures.mjs
```

It walks the project (skipping `.dist`, `.genesys`, `.engine`, `node_modules`, and other dot-folders) and tags each texture reference `ui`, `cpu`, 3D (ignored), or review:

- `.html` / `.css` / `.scss` / `.less` files: every reference is `ui`. An `@project/` reference in `.html`, `.htm` or `.css` is marked "kept raw by the build" and needs no pattern.
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

## Keep raw textures in their own folders

Put everything the DOM shows under one folder (for example `assets/ui/`) and pixel data under another (for example `assets/data/` for heightmaps, masks, and layouts), and exclude both folders. New files are covered automatically, and GPU textures never share those folders. If one image is both a GPU texture and a UI or CPU source, keep two copies so the GPU copy still gets compressed.

## Roll out in stages

1. Set `enabled: true` and temporarily `compileOnPlay: true`, so Play runs the same bake as a shared build.
2. Exclude UI and CPU textures (above) before the first build.
3. Play through every screen (menus, HUD, inventory, store, dialogs) and every level that builds terrain or gameplay data from images. Watch the browser console for 404s, image decode errors, and canvas read failures.
4. Set `compileOnPlay` back to `false` once the setup is stable, to keep Play fast.


## Author sources the baker can compress

Make texture dimensions multiples of 4 (powers of two are ideal) and set `maxSize` for the target platform (for example `1024` for mobile-first games). Export GLBs without Draco. Re-exporting a source is cheaper than shipping it uncompressed.

