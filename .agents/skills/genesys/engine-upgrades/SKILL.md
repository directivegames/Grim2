---
name: engine-upgrades
description: Migrate a Genesys project's game code across `@gnsx/genesys.js` versions — both major-version bumps and breaking changes introduced within a major version line. Use when the project's engine version changes, when the user mentions upgrading the engine, or when build errors reference removed or renamed engine APIs after an engine version bump.
---

# Methodology

The editor bumps `@gnsx/genesys.js` in `package.json` when it opens the project, so the file on disk already shows the new version. The previous version is not stored anywhere in the project.

1. Read the current `@gnsx/genesys.js` version from `package.json`. This is the new version.
2. Determine the previous version from whatever signal is available, in this order:
   - The user states it directly.
   - The project's VCS shows a recent change to `package.json` (e.g. `git diff HEAD -- package.json`, `jj diff -- package.json`, or the equivalent for the VCS in use). Skip if no VCS is in use.
   - Build or typecheck errors reference APIs listed in one of the `references/` files — infer the old version from the file that matches.
3. If the old and new versions share the same major number, breaking changes may still have landed within that major line:
   - Open `references/<major>.x.md` if it exists.
   - Apply only the sections whose "introduced in" version is greater than the old version and less than or equal to the new version. If the file doesn't exist, or every section predates the old version, no migration is needed.
4. If the major number changed:
   - For each major step between the old and new major, open the matching `references/<oldMajor>-<newMajor>.md` file and apply every change in it, in order.
   - Also check `references/<oldMajor>.x.md` for any section introduced after the old version but before the major bump — those still apply even though the major changed, since the old project never picked them up.
5. Run migration utilities referenced by any applied guide in dry-run mode first. Do not apply until the dry run reports zero blocked files and zero unresolved references.
6. After each reference file, run `pnpm build` then `pnpm lint`.
7. When a step is ambiguous, confirm the new signature in `.engine/`.
8. **Safe UI:** search the project for `innerHTML`, `setHTML`, `setIconHtml`,
   `imageHtml`, and `setIcon` used with player names, chat, or other replicated /
   join strings. Prefer `textContent` or UI kit text setters. See the
   `genesys-ui-kit` **Safe UI** section and `genesys-multiplayer`
   [player-list-safe](../genesys-multiplayer/references/player-list-safe.md).

# Version references

Major-bump files are named `references/<oldMajor>-<newMajor>.md`. In-major files are named `references/<major>.x.md` and accumulate breaking changes as they land within that major line — each section is labeled with the exact version that introduced it, so apply only the sections that postdate the project's old version.

- [11 → 12](references/11-12.md)
- [12 → 13](references/12-13.md)
- [13 → 14](references/13-14.md)
- [13.x — in-major changes](references/13.x.md)
