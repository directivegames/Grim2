# Asset Pack Structure

## Filesystem layout

```text
<project>/packs/<name>/
├── config.json          # manifest (required)
├── LICENSE              # SPDX text or empty for Custom (required)
├── assets/              # optional — pack-owned assets, any internal layout
└── src/                 # optional — pack-owned TypeScript code
    └── index.ts         # optional entry; treated as a regular module
```

- `<name>` is both the folder name on disk and the segment in the
  `@packs/<name>/...` TS import alias.
- `<id>` (in `config.json`) is the registry-level dedup key, separate from `<name>`.
- `assets/` may use any folder structure. Conventional buckets like
  `textures/`, `prefabs/`, `materials/`, `models/`, `audio/` are common but
  not required — the pack-isolation check only verifies that runtime asset
  URLs point inside the pack, not that they sit in named subfolders.

## `config.json` essentials

```json
{
  "type": "asset-pack",
  "id": "my-pack",
  "name": "MyPack",
  "description": "One-line summary.",
  "version": "0.1.0",
  "minEngineVersion": "0.0.1",
  "author": "optional",
  "tags": ["optional"],
  "dependencies": {
    "packs": { "other-pack-id": "^1.0.0" },
    "node":  { "dependencies": { }, "devDependencies": { } }
  }
}
```

Field rules (full schema is in `@gnsx/genesys-sdk` `asset-pack-types.ts`):
- `id` — `^[a-z][a-z0-9-]{2,47}$`. Stable across renames. Never on disk.
- `name` — display name and the on-disk folder segment.
- `version` — semver.
- `minEngineVersion` — semver of the oldest engine release this pack runs on.
- `dependencies.packs` — semver ranges keyed by pack `id`.
- `dependencies.node.{dependencies,devDependencies}` — merged into the host
  project's `package.json` on install (existing pins always win).
- `contents` — optional counts of `prefabs`, `scripts`, `assets`. Populated
  by the build pipeline on ship; do not author or update it by hand.



## Path-prefix rules — the two namespaces

| Namespace | Used in | Resolves to | Notes |
|---|---|---|---|
| `@packs/<name>/<sub>` | TypeScript `import` statements only | `<project>/packs/<name>/src/<sub>` | Wired by `tsconfig.paths` and Vite `resolve.alias`. One alias per pack auto-emitted by `scripts/genesys/dev/generate-manifest.ts` and the SDK's `collectPackAliases` in the pack vite config. |
| `@project/packs/<name>/assets/<sub>` | Runtime asset URLs (TS string literals, prefab/material JSON values) | `<project>/packs/<name>/assets/<sub>` | `@project` resolves to the project root via the storage provider; pack assets are addressed as siblings of `@project/assets/...`. |
| `@project/assets/<sub>` | Runtime asset URLs | `<project>/assets/<sub>` | Project-wide assets, not owned by any pack. |
| `@engine/assets/<sub>` | Runtime asset URLs | `node_modules/@gnsx/genesys.js/assets/<sub>` | Engine-shipped assets. Never rewritten when moving content into a pack. |

## TypeScript imports

- Inside the pack: use relative imports (`./util`, `../sub/foo`).
- From outside the pack: use `import { Foo } from '@packs/<name>/foo';`.
- `auto-imports.ts` is regenerated on build — never edit it manually.
