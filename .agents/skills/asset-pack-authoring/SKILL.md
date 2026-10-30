---
name: asset-pack-authoring
description: "Move existing classes, prefabs, materials, models, and other assets into a self-contained asset pack under packs/<name>/, verify isolation, and export the zip. Use when the user asks to extract, package, isolate, share, or export project content as an asset pack. Not for making prefabs (use `genesys-prefabs`) or finding and reusing assets (use `genesys-assets`)."
metadata:
  tokens: 2319
---

# Asset Pack Authoring

Owns relocating code and content into `<project>/packs/<name>/` so it can be shared, versioned, or removed as a unit. Two rules matter most: `@packs/<name>/` is a TypeScript import alias only (runtime asset URLs stay `@project/packs/<name>/assets/...`), and assets move through MCP `action_asset(move)`, which rewrites every reference, never by hand-editing prefab or material JSON while MCP is up.

## Use another skill when
- Creating, isolating, applying, or resyncing a prefab before it moves → `genesys-prefabs`
- Asset path conventions and `@ENGINE.GameClass()` registration in general → `genesys-engine`
- Compressing the pack's textures, meshes, or audio for the build → `genesys-asset-compiler`
- MCP readiness, `run_script` / `batch_execute`, and the build boundary → `genesys-mcp-orchestrator`
- `buildProject` and the `.dist/game.js` bundle proof → `genesys-game-boot`
- Why packs exist and common migration failures → [background.md](references/background.md)

## Path namespaces

- `@packs/<name>/...` — TypeScript `import` alias only. Resolves to `<project>/packs/<name>/src/...`.
- `@project/packs/<name>/assets/...` — runtime asset URL (string literals, prefab/material JSON). No `@packs/` prefix exists at runtime.

## Procedure (high level)

1. Identify inputs
   - Pack identity: `<name>` (folder + alias segment), `<id>` (registry key),
     `<version>`, `<description>`. If a pack already exists at
     `<project>/packs/<name>/`, reuse it.
   - Classes: explicit `.ts/.tsx` file paths under `src/`.
   - Prefabs: explicit `.prefab.json` file paths.
   - Extra assets/folders the user named explicitly.

2. Create the pack if missing
   - MCP (preferred; works without a ready editor): `action_asset(action="installAssetPack", packName="<name>", packId="<id>")` through `run_script` / `batch_execute` (compact-hidden). It scaffolds an empty `packs/<name>/` only, not a catalog pack.
   - CLI fallback: `genesys-sdk new-asset-pack --name <name> --description "<desc>" --pack-version 1.0.0`. `genesys-sdk` is the globally installed Genesys SDK CLI, not a project dependency; `pnpm exec` finds it only through the global install. Pack `id` is derived from `--name`; `assets/` and `src/` are scaffolded by default (`--no-assets` / `--no-src` to skip).
   - Or the editor: Menu → Tools → New Asset Pack….
   - Confirm `<project>/packs/<name>/{config.json, src/, assets/}` exists; `mkdir` a missing `src/` or `assets/`.

3. Build the dependency closure (full transitive — see
   [migration-checklist.md](references/migration-checklist.md))
   - Scan each input file for `@project/...` references.
   - For prefabs/materials walk the JSON tree, every string value.
   - Recurse into any referenced prefab or material.
   - `@project/...` refs that point at assets needed by the pack must be
     moved into the pack and rewritten.

4. Plan target paths
   - Class files: `src/<rel>.ts` → `packs/<name>/src/<rel>.ts` (preserve subpath).
   - Assets: `assets/<category>/<rel>` → `packs/<name>/assets/<category>/<rel>`.

5. Move assets with MCP (scenes, prefabs, materials, models, textures, audio)
   - One `run_script(apply, groupUndo=true)` per batch: `genesys.actionAsset({ action: 'move', assetPath: 'assets/prefabs/Crate.prefab.json', destinationPath: 'packs/<name>/assets/prefabs/Crate.prefab.json' })` per file. The editor rewrites every reference to the moved file (scenes, prefabs, materials), so no JSON edit and no scene re-save is needed.
   - If a move reports a missing folder, create it first with `action_asset(action="createFolder", parentPath, folderName)`.
   - Then `query_asset(operation="getReferences", assetPath=<old path>)` must return nothing, and `getReferences` on the new path lists the expected users.
   - MCP Off: move on disk and apply the regex rewrite in [path-rewrite-rules.md](references/path-rewrite-rules.md) to moved prefab and material JSON as a fallback only; then the user must open and re-save every scene that referenced a moved asset.

6. Move code and rewrite code references
   - Class files: move `.ts/.tsx` on disk (`git mv` when in git), preserving the sub-path.
   - In moved TypeScript, rewrite `@project/assets/<sub>` string literals to
     `@project/packs/<name>/assets/<sub>` only when that file moved with the pack. Write each path as one full literal.
   - `@engine/...` — never rewritten.
   - Relative TS imports between two files that both moved into the pack —
     leave as-is.

7. Fix reverse-direction imports — search `<project>/src/**/*.{ts,tsx}` for
   relative imports of each moved file and rewrite to
   `import { X } from '@packs/<name>/<rel>';`. Skip `src/auto-imports.ts`
   and `src/game-data.ts` — run `pnpm build` if it reports stale
   imports in them. Leave imports inside the moved code itself untouched.

8. Verify — fix every issue; repeat until clean.

   ```bash
   pnpm lint
   pnpm build
   # Prefab JSON is validated when the engine loads it (in-memory migration on outdated $version)
   pnpm check-pack-isolation --pack <name>
   ```

   Then the editor side, per `genesys-game-boot` → "Play loads the bundle": MCP `action_build(action="buildProject")` as its own call; bundle proof `grep -c "<MovedClass>" .dist/game.js` ≥ 1 for each moved class; `query_editor(getRegisteredClasses, filter="<MovedClass>")` lists it; `query_diagnostics(operation="getBuildErrors")` is empty. Play once and confirm a moved prefab or model loads (`genesys-verification`).

9. Optional polish
   - Declare cross-pack dependencies in `config.json` `dependencies.packs`
     if step 3 flagged cross-pack refs. The `contents` counts field is
     populated by the build pipeline; do not author it by hand.
   - MCP Off route only: tell the user that scene files referencing moved
     assets must be re-saved from the editor.

10. Export (only when the user asks to ship/publish the pack)
    - Ask the user whether to bump the pack version before exporting and
      which kind (`patch` / `minor` / `major`). Default to no bump if they
      decline or only want to re-zip the current version.
    - Run `pnpm export-pack --pack <name> [--bump patch|minor|major]` (or
      `--set-version <x.y.z>` for an explicit version).
    - The script bumps `config.json` `version` if requested, re-runs the
      isolation check, and writes `<project>/<name>.zip` containing the
      pack folder's contents at the archive root (no `<name>/` prefix
      inside). Use `--out <dir>` to write the zip elsewhere.
    - If isolation check fails, fix the reported violations and rerun.

## Constraints

- Never use `@packs/<name>/assets/...` in runtime asset URLs — TS-only prefix.
- Never re-scaffold a pack that already exists.
- `GAME.<ClassName>` prefab refs are unchanged by a class move — class registry is global.
- Never hand-edit `.prefab.json`, `.material.json`, or `.genesys-scene` to rewrite paths while MCP is ready; `action_asset(move)` does it.
- Never edit `src/auto-imports.ts` or `src/game-data.ts`; the build regenerates them.

## Traps

- A scene shows a missing model or prefab after the move → the asset was moved on disk, so references still point at the old path → move it back and re-move with `action_asset(move)`, or (MCP Off) rewrite and re-save the scene.
- `pnpm build` passes but Play is unchanged or a moved class is unknown in the editor → `buildProject` not run → run it and grep the bundle.
- `@packs/<name>/assets/...` in a runtime string → resolves nowhere at runtime → `@project/packs/<name>/assets/...`.
- `pnpm exec genesys-sdk` fails with "command not found" → the CLI is a global install, not a project dependency → scaffold with `action_asset(installAssetPack)` or the editor dialog.

## Done

- `packs/<name>/{config.json, src/, assets/}` exists and holds every planned file.
- `pnpm lint`, `pnpm build`, and `pnpm check-pack-isolation --pack <name>` are clean (or each external dependency is listed for the user).
- `query_asset(getReferences)` on every old asset path returns nothing.
- `buildProject` ran; every moved class is in `.dist/game.js` and `getRegisteredClasses`; build errors are empty.
- Play loads a moved prefab or model without console errors.
- The report says where the pack lives and lists remaining external dependencies.

## References

- [pack-structure.md](references/pack-structure.md) — folder layout, `config.json` fields, tsconfig and Vite alias wiring
- [migration-checklist.md](references/migration-checklist.md) — the full step-by-step move, dependency closure, verification
- [path-rewrite-rules.md](references/path-rewrite-rules.md) — exactly which strings and imports to rewrite, and which to leave
- [background.md](references/background.md) — why packs exist, the two path namespaces, common migration failures and remedies
