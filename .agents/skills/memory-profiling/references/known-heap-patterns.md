# Known heap patterns

Patterns seen in Genesys game captures. Match against sections 6-8 of the
report before treating a large owner as game cost. Sizes are examples from past
captures, not budgets.

Game-specific signatures belong in the project's `.genesys/heap-patterns.json`,
not in this file. See [project-heap-patterns.md](project-heap-patterns.md).

## Capture artifacts

These are not shipped costs. Mark them in the report; do not rank them as
findings.

| Signature | Meaning |
| --- | --- |
| `system / ExternalStringData` or `(string)` held by `(Global handles) / DevTools debugger` | Script source kept by an attached DevTools. The Vite deps bundle alone is ~75 MB. |
| `(code).script -> .source_mapping_url -> (string)` of 10-30 MB | Inline source map of a dev bundle |
| `(V8 API)` as the allocation root of large strings | Script compilation. It is the source text, not a runtime allocation. |
| `chrome-extension://...` frames or scopes (`phantom.js`, `evmMetamask.js`, `iframe_form_detection.js`) | Browser extensions injected into the page. Use a clean profile for comparisons. |
| Large `(string)` allocated in `startGame` | The game bundle text being evaluated |

## Runtime-owned blocks

| Signature | Meaning |
| --- | --- |
| `ArrayBuffer` allocated in `updateMemoryViews` in `recast-navigation...` / `manifold...` | Emscripten WASM linear memory. It only grows, so it shows the high-water mark. |
| `Memory.[2]` retaining a 16-64 MB backing store | A WebAssembly `Memory` object |
| `system / CppGCManaged (WasmNativeModule)` | Compiled WASM code |

## Bundler patterns

| Signature | Meaning |
| --- | --- |
| Hundreds of thousands of `(closure get)`, each with its own `system / Context`, plus `system / AccessorPair`s, allocated in `CO <= S <= startGame` | esbuild CommonJS interop: `S` = `__toESM`, `CO` = `__copyProps`. Each `S(require("three"))` builds a full getter copy of the namespace. Count them with `rg -o '=S\(require\("[^"]+"\)' .dist/game.js`. |
| Hundreds of module-scope objects with ~950 accessor properties (`--holders="system / AccessorPair"`) | The same copies, one per importing module |

## Engine and game owners seen before

| Signature | Owner |
| --- | --- |
| `.originalClips -> Map` of ~10 MB under an animation node | `AnimationStateMachineNode.addAnimation` stores a deep `clip.clone()` per clip, per character |
| `AnimationAction` / `AnimationClip` counts in the thousands for a handful of characters | `loadBaseClips` creates actions for every clip in the global `AnimationClipCache` |
| `system / Context / scope` with ~90 k instances allocated in `compile <= precompileAll` | Precompiled animation transition conditions |
| `ResourceManager.cachedModels.<path> -> Promise -> Object.parser -> GLTFParser` | The model cache keeps the whole parser, including JSON and the binary chunk |
| `WeakMap ... part of key (World) -> value (X)` | A per-`World` registry. It is released only when that `World` is. |
| `Object.cached -> Map` of decoded ArrayBuffers in the game module scope | A game-owned payload store (for example baked terrain data) |
| `ProceduralSfxSystem.buffers -> Map -> Map -> Array -> AudioBuffer` | Prewarmed procedural SFX PCM |
| `DataArrayTexture.source -> TextureSource` holding an 8 MB `Uint8Array` | CPU copy of a texture after GPU upload. The same image also costs GPU memory; see [gpu-memory.md](gpu-memory.md) |

## Misattributed stacks

Buffers filled by native code (`DecompressionStream`, `Response.arrayBuffer`,
`crypto.subtle`, audio decoding) get whatever JS frame was active when V8
stamped them. Baked payloads have appeared under three.js
`getNodeProperties` / `VarNode`. When a stack disagrees with the dominator
path, trust the path and read the owner's source.
