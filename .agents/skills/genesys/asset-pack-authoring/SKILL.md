---
name: asset-pack-authoring
description: 'Move an existing class, prefab, or set of assets into a self-contained asset pack under `<project>/packs/<name>/`. Use when the user asks to extract, package, migrate, or isolate project content into an asset pack.'
---

# Asset Pack Authoring

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
   - Use the CLI: `pnpm exec genesys-sdk new-asset-pack --name <name> --id <id> --description "<desc>" --version 0.1.0`
   - Or instruct the user to run the editor's New Asset Pack dialog.
   - Confirm `<project>/packs/<name>/{config.json, src/, assets/}` exists.

3. Build the dependency closure (full transitive — see
   ./references/migration-checklist.md)
   - Scan each input file for `@project/...` references.
   - For prefabs/materials walk the JSON tree, every string value.
   - Recurse into any referenced prefab or material.
   - `@project/...` refs that point at assets needed by the pack must be
     moved into the pack and rewritten.

4. Plan target paths
   - Class files: `src/<rel>.ts` → `packs/<name>/src/<rel>.ts` (preserve subpath).
   - Assets: `assets/<category>/<rel>` → `packs/<name>/assets/<category>/<rel>`.

5. Move files (physical relocation; preserve sub-folder structure).

6. Rewrite references in moved code/prefabs/materials — see
   ./references/path-rewrite-rules.md. Summary:
   - `@project/assets/<sub>` referenced from inside the pack →
     `@project/packs/<name>/assets/<sub>` only if the file was moved with the
     pack.
   - `@engine/...` — never rewritten.
   - Relative TS imports between two files that both moved into the pack —
     leave as-is.

7. Fix reverse-direction imports — search `<project>/src/**/*.{ts,tsx}` for
   relative imports of each moved file and rewrite to
   `import { X } from '@packs/<name>/<rel>';`. Skip `src/auto-imports.ts`
   and `src/game-data.ts` — run `pnpm build` if `pnpm compile` reports stale
   imports in them. Leave imports inside the moved code itself untouched.

8. Verify — run all three; fix every issue; repeat until clean.

   ```bash
   pnpm compile
   pnpm validate-prefabs
   pnpm check-pack-isolation --pack <name>
   ```

9. Optional polish
   - Declare cross-pack dependencies in `config.json` `dependencies.packs`
     if step 3 flagged cross-pack refs. The `contents` counts field is
     populated by the build pipeline; do not author it by hand.
   - Mention to the user that scene files referencing moved assets must be
     re-saved from the editor.

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

## References

- ./references/pack-structure.md
- ./references/migration-checklist.md
- ./references/path-rewrite-rules.md
