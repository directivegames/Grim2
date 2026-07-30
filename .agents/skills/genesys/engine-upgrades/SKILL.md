---
name: engine-upgrades
description: Migrate a Genesys project's game code across `@gnsx/genesys.js` major versions. Use when the project's engine major changes, when the user mentions upgrading the engine, or when build errors reference removed or renamed engine APIs after an engine version bump.
---

# Methodology

The editor bumps `@gnsx/genesys.js` in `package.json` when it opens the project, so the file on disk already shows the new version. The previous version is not stored anywhere in the project.

1. Read the current `@gnsx/genesys.js` version from `package.json`. This is the new version.
2. Determine the previous version from whatever signal is available, in this order:
   - The user states it directly.
   - The project's VCS shows a recent change to `package.json` (e.g. `git diff HEAD -- package.json`, `jj diff -- package.json`, or the equivalent for the VCS in use). Skip if no VCS is in use.
   - Build or typecheck errors reference APIs listed in one of the `references/` files — infer the old major from the file that matches.
3. If the major number is unchanged, no migration is needed.
4. For each major step between the old and new major, open the matching reference file under `references/` and apply every change in it, in order.
5. Run migration utilities referenced by that version guide in dry-run mode first. Do not apply until the dry run reports zero blocked files and zero unresolved references.
6. After each reference file, run `pnpm build` then `pnpm lint`.
7. When a step is ambiguous, confirm the new signature in `.engine/`.

# Version references

Reference files are named `references/<old>-<new>.md`, one per major bump:

- [11 → 12](references/11-12.md)
- [12 → 13](references/12-13.md)
- [13 → 14](references/13-14.md)
