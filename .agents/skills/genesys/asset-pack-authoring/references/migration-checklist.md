# Asset Pack Migration Checklist

## Step 0 — Gather inputs

- [ ] Pack identity: `<name>`, `<id>`, `<version>`, `<description>`.
- [ ] List of class files (`.ts`, `.tsx`) under `src/`.
- [ ] List of prefab files (`.prefab.json`) under `assets/prefabs/`.
- [ ] List of any extra asset paths the user named explicitly.
- [ ] Confirm pack does not already exist at `<project>/packs/<name>/`, or that
      reuse is intended.

## Step 1 — Scaffold (or reuse) the pack

If the pack does not exist:

```bash
pnpm exec genesys-sdk new-asset-pack --name <name> --id <id> \
  --description "<one-line summary>" --version 0.1.0 \
  --min-engine-version 0.0.1
```

(Editor users may use the New Asset Pack dialog instead — same result.)

Confirm the resulting layout:

```text
packs/<name>/
├── config.json
├── LICENSE
├── assets/   (created if --include-assets)
└── src/      (created if --include-src)
```

If `assets/` or `src/` was not created, `mkdir` them now — they are required
for the migration.

## Step 2 — Build the dependency closure

For each input class/prefab, find every `@project/...` reference. Repeat the
scan transitively on every newly-discovered prefab or material. Stop when the
set stops growing.

Scanning rules:

- TS files (`.ts`, `.tsx`) — regex over file text for
  `@project/[^"'\s<>]+`. Inspect both string literals and template literals.
  Treat the bare path inside the quote as the reference.
- Prefab files (`*.prefab.json`) — `JSON.parse` then walk every string
  value. Any value starting with `@project/` is a reference.
- Material files (`*.material.json`) — same JSON walk as prefabs.

After the migration completes, warn the user that any scenes referencing the
old asset paths must be re-saved from the editor.

Categorise each ref:

- `@project/assets/...` for an asset the pack owns — move and rewrite to
  `@project/packs/<name>/assets/...`.
- `@project/assets/...` for an asset that stays project-wide — leave the
  path unchanged; the pack now depends on a project-wide asset. Flag for
  user awareness; if the pack is meant to be self-contained, the user should
  add it to the pack inputs.
- `@project/packs/<other>/assets/...` — cross-pack dependency. Flag — the
  pack must list `<other>` in `config.json` `dependencies.packs`.

## Step 3 — Plan target paths

For each item to move, compute the destination:

```text
src/<rel>.ts                 -> packs/<name>/src/<rel>.ts
assets/<category>/<rel>      -> packs/<name>/assets/<category>/<rel>
```

Preserve the relative sub-path under `src/` or `assets/<category>/` exactly.

## Step 4 — Move files

Use `git mv` if the project is in git, otherwise ordinary move. Move all planned files in one batch before rewriting any references.

## Step 5 — Rewrite references inside the pack

See `path-rewrite-rules.md` for concrete patterns. In short:

- In moved `.ts/.tsx` files: replace `@project/assets/<sub>` with
  `@project/packs/<name>/assets/<sub>` for assets that moved with the pack.
- In moved `.prefab.json` and `.material.json`: same rewrite, applied to every
  string value found in step 2.
- `@engine/...` — untouched.
- Relative TS imports between two moved files — untouched.

## Step 6 — Fix reverse-direction imports

For each moved class:

- Search `<project>/src/**/*.{ts,tsx}` for relative imports of the old file
  path (e.g. `./foo`, `../foo`, `./classes/foo`).
- Skip `src/auto-imports.ts` and `src/game-data.ts` — both are regenerated
  by the build pipeline. If `pnpm compile` reports stale imports in either
  after the move, run `pnpm build` (or
  `pnpm run generate-property-metadata`) instead of editing by hand.
- Rewrite remaining callers to `@packs/<name>/<rel-no-ext>`.
- Do not touch imports inside the moved code itself.

Example:

```ts
// Before (src/game.ts)
import { Foo } from './foo';

// After
import { Foo } from '@packs/my-pack/foo';
```

## Step 7 — Declare cross-pack dependencies (optional)

If the pack now depends on another pack's assets (cross-pack ref flagged in
step 2), add the dependency under `dependencies.packs` in `config.json`:

```json
"dependencies": { "packs": { "<other>": "^1.0.0" } }
```

The `contents` field (counts of prefabs / scripts / assets) is populated by
the build pipeline on ship. Do not author or update it by hand.

## Step 8 — Verify

Run all three in order. Fix every reported issue before moving on.

```bash
pnpm compile                                       # TypeScript type-check (includes pack sources)
pnpm validate-prefabs                              # JSON schema check for all prefabs
pnpm check-pack-isolation --pack <name>            # external-ref / stale-ref scan
```



## Step 9 — Hand off

Tell the user:

- Where the pack now lives.
- Whether any project-wide assets remain external dependencies of the pack.
- That any `.genesys-scene` files referencing moved assets must be opened and
  re-saved in the editor.
- Suggest running the game once to confirm the pack loads at runtime.

## Step 10 — Export (only on ship/publish request)

Run this only when the user asks to ship, publish, share, or export the
finished pack — not as part of the migration itself.

Procedure:

1. Ask the user whether to bump the pack `version` before exporting and
   which kind (`patch` / `minor` / `major`). Default to no bump if they
   decline or only want to re-zip the current version.
2. Run:

   ```bash
   pnpm export-pack --pack <name> [--bump patch|minor|major]
   ```

   Use `--set-version <x.y.z>` instead of `--bump` for an explicit version.
   Add `--out <dir>` to write the archive somewhere other than the project
   root, or `--dry-run` to preview without writing anything.

3. The script:
   - Rewrites `config.json` `version` if a bump or explicit version was
     requested.
   - Re-runs `check-pack-isolation --pack <name>` and aborts on failure.
   - Writes `<out>/<name>.zip` containing the pack folder's **contents** at
     the archive root (no `<name>/` directory prefix inside the zip).

4. If the isolation check fails, fix the reported violations and rerun.
