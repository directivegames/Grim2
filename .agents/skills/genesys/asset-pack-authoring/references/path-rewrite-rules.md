# Path Rewrite Rules

## Rule 1 — Runtime asset URLs in TypeScript

`@project/assets/<sub>` → `@project/packs/<name>/assets/<sub>` only when
the referenced file was moved with the pack.

```ts
// Before (src/foo.ts referencing a project-wide texture)
const url = '@project/assets/textures/foo.png';

// After (packs/my-pack/src/foo.ts, with foo.png moved into the pack)
const url = '@project/packs/my-pack/assets/textures/foo.png';
```

If `foo.png` is not moved (it stays a project-wide asset the pack depends
on), leave the string untouched and flag the external dependency to the user.

## Rule 2 — TypeScript imports between source files

| Source location | Target location | Rewrite |
|---|---|---|
| Pack file | Pack file (both moved together) | Keep relative path unchanged. |
| Pack file | Project `src/` | Leave as-is only if the imported symbol genuinely belongs in `src/` and not the pack. Otherwise pull the dependency into the pack too. |
| Pack file | Other pack `<other>` | `import ... from '@packs/<other>/<rel>';` and declare `<other>` in `config.json` `dependencies.packs`. |
| Project `src/` | Moved file (now in pack) | `import ... from '@packs/<name>/<rel>';` (step 6 of the checklist). |

Example:

```ts
// Before (src/game.ts)
import { Foo } from './foo';
import { helper } from './foo/util';

// After
import { Foo } from '@packs/my-pack/foo';
import { helper } from '@packs/my-pack/foo/util';
```

Imports inside the moved code stay relative:

```ts
// packs/my-pack/src/foo.ts
import { helper } from './util';   // unchanged — util.ts moved alongside foo.ts
```

## Rule 3 — Prefab JSON string values

Walk every string in the prefab object after `JSON.parse`. Apply Rule 1 to
every match. Common keys that hold asset paths:

- Texture-map paths on materials (`map`, `normalMap`, `roughnessMap`, ...)
- `geometry.url`, `texture.url`
- Any `$bc: "TextureLoader"` `_` argument
- Direct material asset refs (`material: "@project/assets/materials/Foo.material.json"`)

```jsonc
// Before
{
  "$bc": "ENGINE.MeshNode",
  "geometry": { "$bc": "THREE.PlaneGeometry", "_": [1, 1] },
  "material": "@project/assets/materials/Bar.material.json"
}

// After (Bar.material.json moved into the pack)
{
  "$bc": "ENGINE.MeshNode",
  "geometry": { "$bc": "THREE.PlaneGeometry", "_": [1, 1] },
  "material": "@project/packs/my-pack/assets/materials/Bar.material.json"
}
```

`$bc` class refs are unchanged by the move:

```jsonc
{ "$bc": "GAME.MyPickupRoot" }   // stays "GAME.MyPickupRoot" even though the class moved
{ "$bc": "ENGINE.SceneNode" }    // engine refs never change
```

## Rule 4 — Material JSON string values

Same scan-and-rewrite rule as prefabs. Material files commonly reference
textures by `@project/assets/textures/...`. Rewrite to
`@project/packs/<name>/assets/textures/...` when the texture was moved.

```jsonc
// Before
{ "type": "MeshStandardMaterial", "map": "@project/assets/textures/foo.png" }

// After
{ "type": "MeshStandardMaterial", "map": "@project/packs/my-pack/assets/textures/foo.png" }
```

## Rule 5 — HTML strings passed to `ENGINE.resolveAssetPathsInText`

`resolveAssetPathsInText` resolves `@project/...` paths at runtime. Pack-internal
HTML should follow Rule 1:

```ts
// Before
const html = '<img src="@project/assets/textures/icon.png" />';

// After (icon.png moved with the pack)
const html = '<img src="@project/packs/my-pack/assets/textures/icon.png" />';
```

## Rule 6 — What is never rewritten

- `@engine/...` paths (engine-shipped assets).
- Relative imports inside the pack itself (both files moved together).
- Prefab/material `$bc` values (class registry is global).
- Asset paths that intentionally stay project-wide (with the user's awareness).
- Scene files — these are not touched by the migration; warn the user to re-save.

## Rule 7 — Common mistakes to avoid

- Do not invent `@packs/<name>/assets/...` URLs. `@packs/` is TS-import-only.
- Do not rewrite `@engine/` anything.
- Do not rewrite `GAME.<Class>` prefab refs after a class move.
- Do not leave a reverse import unfixed — relative imports from `src/` to a
  moved file will fail to resolve.

## Quick regex cheat-sheet

- `@project/[^"'\s<>]+` — project asset paths in TS / JSON.
- `from\s+['"]\./[^'"]+['"]` — relative TS imports (Rule 2 reverse fixups).
- `"\$bc"\s*:\s*"GAME\.` — game class refs in prefabs (sanity-check only, do
  not rewrite).
