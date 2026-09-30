# Conversion hook

`assetCompiler.conversionHook` is an optional project-relative path to a Node module that decides, per asset and per compiler, whether the asset compiler converts it.

```json
{ "assetCompiler": { "enabled": true, "conversionHook": "scripts/asset-conversion-hook.mjs" } }
```

## Module contract

The module must export a function named `shouldConvertAsset`:

```ts
type AssetCompilerId =
  | 'glb-override-texture-strip'
  | 'ktx2-texture-compression'
  | 'ktx2-standalone-texture-compression'
  | 'meshopt-mesh-compression'
  | 'mp3-audio-compression';

function shouldConvertAsset(ctx: {
  relativePath: string;      // project-relative, forward slashes, e.g. 'assets/ui/logo.png'
  compiler: AssetCompilerId; // which compiler is asking
  defaultConvert: boolean;   // the built-in decision
}): boolean | undefined;
```

- `true`: convert, even if an exclude pattern matched.
- `false`: skip, leave the asset raw for this compiler.
- `undefined` (or no `return`): keep `defaultConvert`.

## Evaluation order

For each asset and each compiler:

1. **Wrong file type** for this compiler (a `.png` for Meshopt, a `.glb` for the loose texture compiler): not converted, hook not called.
2. **Format toggle off** (`textureCompression.formats`, `audioCompression.formats`) or the compiler's section disabled: not converted, hook not called. The hook cannot turn a disabled format back on.
3. **`defaultConvert`** is `false` when a `textureCompression.exclude` pattern matches (both KTX2 compilers), otherwise `true`. Meshopt, MP3, and the override strip always start from `true`.
4. **Hook** result replaces `defaultConvert` unless it is `undefined`.

A GLB is asked about once per GLB compiler, so one GLB can keep its textures but still get Meshopt, or the reverse. Returning `false` for `ktx2-texture-compression` skips re-encoding all textures embedded in that GLB; the hook is not called per embedded texture.

The hook only decides *whether* to convert. It cannot change quality, bitrate, or `maxSize`, and it cannot force conversion of a texture whose dimensions KTX2 cannot encode.

## File requirements

- Extension `.mjs` (ES module), `.cjs` (CommonJS), or `.js` (follows the project's `package.json` `"type"`). TypeScript (`.ts`, `.mts`, `.cts`, `.tsx`) is rejected: the build runs compiled JavaScript and does not load TypeScript.
- The path must stay inside the project: no absolute paths, no `..`, and it must not resolve outside the project through a symlink.
- Keep it outside `assets/` (for example under `scripts/`) so it is not copied into the build.
- **Synchronous only.** Returning a Promise (an `async` function) is treated as an error for that asset. If you need data from disk, read it with synchronous APIs.
- **Keep it self-contained.** The module is imported once and reused across builds until the hook file itself changes. Edits to the hook are picked up on the next build, but edits to modules it imports and data it reads at module load time are not, until the hook file changes or the desktop app restarts. Put the logic in the hook file, and read data files you edit often inside `shouldConvertAsset` (see the JSON example below).

## Failure behaviour

The build never fails because of the hook.

- Missing file, disallowed path or extension, import error, or no exported `shouldConvertAsset` function: one warning, then the build uses built-in rules for every asset.
- The hook throws or returns a Promise: that asset keeps `defaultConvert`; the warning is logged once per build.

Log lines are prefixed `[asset-compiler]` in the build output.

## Examples

Keep UI images raw (HTML/CSS reference them directly) except one atlas the engine loads:

```js
export function shouldConvertAsset({ relativePath, compiler }) {
  if (compiler.startsWith('ktx2-') && relativePath.startsWith('assets/ui/')) {
    return relativePath === 'assets/ui/atlas.png';
  }
  return undefined;
}
```

Skip Meshopt for GLBs that are edited at runtime, and keep music lossless:

```js
export function shouldConvertAsset({ relativePath, compiler }) {
  if (compiler === 'meshopt-mesh-compression' && relativePath.includes('/editable/')) {
    return false;
  }
  if (compiler === 'mp3-audio-compression' && relativePath.startsWith('assets/music/')) {
    return false;
  }
  return undefined;
}
```

Drive decisions from a JSON list, re-read only when the list changes, so edits to it apply on the next build (CommonJS):

```js
// scripts/asset-conversion-hook.cjs
const fs = require('fs');
const path = require('path');

const listPath = path.join(__dirname, 'keep-raw.json');
let cached = { mtimeMs: -1, keepRaw: new Set() };

function keepRawList() {
  const { mtimeMs } = fs.statSync(listPath);
  if (mtimeMs !== cached.mtimeMs) {
    cached = { mtimeMs, keepRaw: new Set(JSON.parse(fs.readFileSync(listPath, 'utf8'))) };
  }
  return cached.keepRaw;
}

exports.shouldConvertAsset = ({ relativePath }) => (keepRawList().has(relativePath) ? false : undefined);
```

If `keep-raw.json` is missing, `statSync` throws; that asset keeps its built-in decision and the build logs one warning.

## Editor behaviour

In the desktop app, the editor asks the app to run the same hook, so asset-browser texture badges and import warnings match the build. In a browser-only editor the badges use exclude patterns only; builds still run the hook. After editing the hook, reopen Project Settings and save, or reopen the project, to refresh the badges.
