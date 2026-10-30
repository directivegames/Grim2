---
name: engine-upgrades
description: "Migrate game code across @gnsx/genesys.js versions, major or minor: find the from-version, apply each version guide in order, run the shipped migration scripts, and diff the engine when no guide exists. Use when the engine version changes, the user mentions upgrading or updating the engine/SDK, or build errors name removed or renamed engine APIs. Not for learning a current API you never used (use `genesys-engine`) or ordinary build errors in game code (use `genesys-engine`)."
metadata:
  tokens: 2185
---

# Engine upgrades

Owns moving game code from one `@gnsx/genesys.js` version to another, one reference file at a time. The most important rule: apply every guide between the old and new version in order, and confirm each ambiguous signature in `.engine/`.

Run the commands in the references from the game project root.

## Use another skill when
- Reading the current signature of a class, or finding which class replaced a removed one → `genesys-engine` (Find an engine class: API digest, then source)
- Fixing Safe UI findings (text setters vs `*Html` APIs) → `genesys-ui`
- Fixing replicated or join strings in a player list or chat → `genesys-multiplayer`
- Rebuilding the Play bundle and proving the new classes load → `genesys-game-boot`
- Re-setting renamed scene or prefab property values in the editor → `genesys-mcp-orchestrator`

# Methodology

The editor bumps `@gnsx/genesys.js` in `package.json` (and `engineVersion` in `<project>.genesys-project`) when it opens the project, so the files on disk already show the new version. The previous version survives only in version control or the user's memory. `.engine/` is git-ignored, so the old engine source is not in history.

1. Read the current `@gnsx/genesys.js` version from `package.json` and `engineVersion` from `<project>.genesys-project`. This is the new version.
2. Determine the previous version from whatever signal is available, in this order:
   - The user states it directly.
   - Version control: the last committed values, `git show HEAD:package.json | grep genesys.js` and `git show HEAD:<project>.genesys-project | grep engineVersion`, or `git log -p -- package.json <project>.genesys-project` for older bumps (`jj` or another VCS: the equivalent). Skip if no VCS is in use.
   - Build or typecheck errors reference APIs listed in one of the `references/` files — infer the old version from the file that matches.
3. If the old and new versions share the same major number, breaking changes may still have landed within that major line:
   - Open `references/<major>.x.md` if it exists.
   - Apply only the sections whose "introduced in" version is greater than the old version and less than or equal to the new version.
   - **A missing file is not proof that nothing changed.** If the file doesn't exist, or every section predates the old version, still run `pnpm build` and treat every error as a migration item (step 9).
4. If the major number changed:
   - For each major step between the old and new major, open the matching `references/<oldMajor>-<newMajor>.md` file and apply every change in it, in order.
   - Also check `references/<oldMajor>.x.md` for any section introduced after the old version but before the major bump — those still apply even though the major changed, since the old project never picked them up.
   - Also check `references/<newMajor>.x.md` for any section introduced at or before the new version — those changes landed within the new major line after the bump and still apply.
   - When a guide says a target was **superseded in a later version**, migrate straight to the newest form the callout names.
5. Run migration utilities referenced by any applied guide in dry-run mode first. Do not apply until the dry run reports zero blocked files and zero unresolved references.
6. After each reference file, run `pnpm build` then `pnpm lint`.
7. When a step is ambiguous, confirm the new signature in `.engine/`.
8. Safe UI: search the project for `innerHTML`, `setHTML`, `setIconHtml`,
   `imageHtml`, and `setIcon` used with player names, chat, or other replicated /
   join strings. Prefer `textContent` or widget text setters (`setLabel`, `setMessage`,
   `setTitle`). See the Safe UI section of `genesys-ui` and `genesys-multiplayer`
   [player-list-safe](../genesys-multiplayer/references/player-list-safe.md).
9. No guide for a step, or errors no guide explains: diff the engine. Each error names a removed or changed symbol; find its replacement in the API digest (`genesys-engine` → Find an engine class: class files and class hierarchy) and read its source at the line ranges the digest gives. For a wide change, fetch the old package into `.scratch/engine-old/` (`npm pack @gnsx/genesys.js@<old> --pack-destination .scratch/engine-old`, then extract; works only if the registry still serves that version) and `diff -r` its `src/` against `.engine/src`. The editor's Help → Changelog lists the release notes. Record each finding in your report so the pack owner can add a version file.
10. Scene and prefab data: when a guide says saved values under old property names are ignored, re-set them through MCP (`getEditableProperties` → `setProperties` → `action_scene(save)` → re-query; prefabs via `action_prefab.open` / `save`). Never hand-rename keys in `.genesys-scene` or `.prefab.json`.

# Migration scripts

| Script | What it does | Run |
|---|---|---|
| `.agents/skills/engine-upgrades/scripts/migrate-animation-configs.mjs` | 13.2.0: converts every project `*.anim.json` to an `*.animconfig.json` resource, embeds a sibling `*.anim.meta` graph layout, rewrites `@project/...` and relative references in scenes, prefabs and source, then **deletes** the old `.anim.json` and migrated `.anim.meta` files. Blocks the whole write if any item is unsafe. | `node .agents/skills/engine-upgrades/scripts/migrate-animation-configs.mjs` (dry run, default) → fix every blocked item → `--write`. Commit first. Details: [13.x](references/13.x.md) §2 |
| `node_modules/@gnsx/genesys.js/scripts/migrate-audio-resources.ts` | Writes a `<clip>.res.json` `SoundResource` (`audioPath`, volume 1, `maxDistance` 10000, inverse distance) beside every `.mp3/.wav/.ogg/.aac/.flac/.m4a` under `assets/` that lacks one; skips existing files. No dry run. | Only when a guide or the user calls for sound-resource asset files: `pnpm exec tsx node_modules/@gnsx/genesys.js/scripts/migrate-audio-resources.ts .` from the project root, then review `git status` |

Run every script from the game project root, after committing, so its changes can be reviewed and reverted.

# Version references

Major-bump files are named `references/<oldMajor>-<newMajor>.md`. In-major files are named `references/<major>.x.md` and accumulate breaking changes as they land within that major line — each section is labeled with the exact version that introduced it, so apply only the sections that postdate the project's old version.

- [11 → 12](references/11-12.md)
- [12 → 13](references/12-13.md)
- [13 → 14](references/13-14.md)
- [13.x — in-major changes](references/13.x.md)
- [14.x — in-major changes](references/14.x.md)
- [15 → 16](references/15-16.md)
- [16 → 17](references/16-17.md)
- [17 → 18](references/17-18.md)
- [18 → 19](references/18-19.md)

No `14-15`, `15.x`, `16.x`, `17.x`, `18.x`, or `19.x` file exists. A span that crosses one of those still needs step 9.

# Traps

- A migration targets an API that no longer exists (`getEstimatedServerGameTime()`, `predictionTime`, `MultiplayerSpawner.spawn`) → an older guide was applied without its "superseded" callout → use the newest form (`getEstimatedServerGameTimeMs()`, `predictionTimeMs`, `spawnPrefab` / `@SpawnMethod`) and confirm in `.engine/src`.
- "No migration needed" because no version file matched → errors appear later in Play → run `pnpm build` and step 9 for every error.
- Hand-renamed keys in a `.genesys-scene` or `.prefab.json` → the editor overwrites or rejects them, or the scene breaks → re-set the values through MCP.
- `migrate-animation-configs.mjs --write` refuses → some configs are blocked or have unresolved references (it does not need a prior dry run) → fix what the dry run lists. On success `--write` deletes the `.anim.json` sources in the same run → always dry-run first and commit before `--write`.

# Done

- From-version and to-version are named in the report, with the source of the from-version.
- Every applicable guide section (and its superseded callouts) was applied in order, or marked not applicable.
- `pnpm build` and `pnpm lint` pass; every remaining error was traced through step 9.
- Migration scripts ran dry first; their write output was reviewed.
- MCP `action_build(buildProject)` and the bundle proof pass (`genesys-game-boot`), and Play runs without new console errors (`genesys-verification`).
