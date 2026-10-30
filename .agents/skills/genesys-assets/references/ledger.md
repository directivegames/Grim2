# The Assets table and asset-check

The rules that matter on every row are in [SKILL.md](../SKILL.md#the-assets-table). This file holds a full example table, the column rules in detail, and what `asset-check.mjs` reports.

## Example

```markdown
## Assets
| Role | Route | Path | Reuse | Done when | Status |
|---|---|---|---|---|---|
| Hero body | code | @project/assets/models/hero.glb | 1 pawn | legs swing with speed, faces travel, readable at 10 m | wired |
| Slime enemy | code | @project/assets/models/slime.glb | ~20 spawned | squashes when it moves, readable at 12 m | landed |
| Wall kit | reuse | @engine/assets/models/demo/SandboxAsset/Dungeon/SM_SB_Wall.glb | ~120 | rooms read as stone halls | wired |
| Title screen | code | src/ui/title.ts | 1 | live scene with the hero framed behind the title card | building |
| Ability icons | code | src/ui/icons.ts | HUD | readable at 48 px | planned |
| Sky + sun | scene | `Sky`, `Sun` | 1 | warm late-afternoon light | wired |
| Music bed | synth (dark, 16 bars) | @project/assets/audio/music-dark.wav | 1 | loops from Start through Retry | wired |
```

## Columns

- **Route**: `reuse`, `code`, `scene`, `synth`, `blender (<folder>)`, `scenario`. A `code` model row names its exported GLB in Path (`@project/assets/models/slime.glb`, `genesys-code-modeling`). A `code` row with no asset file (a title screen, SVG icons) names its source file (`src/ui/splash.ts`). A `scene` row (sky, sun, fog, placed lights) names the scene node(s) in backticks; the check looks for those names in saved scene, prefab and layout files and only warns, because the editor is the truth (`query_node(operation="find", …)`).
- **Path** is the exact `@project/...` / `@engine/...` string the code or scene uses. List every file: separate with `,` or `·`; a bare file name after a full path shares its folder; `tier-1.png … tier-5.png` expands to all five.
- **Reuse** is how many instances, or who shares it. One implementation per role.
- **Done when** is visible or playable, not "file exists".
- **Status**: `planned` → `building` → `landed` → `wired`, or `cut — <reason>`. `requested — job <id>` for a Scenario job; `proposed` for a row a worker suggests.
  - `landed`: the file exists and its numbers are in range. For a code model: the export wrote the GLB, and you looked at it in an editor screenshot or capture. For a Blender model: its sheet was opened.
  - `wired`: **referenced** (the game loads it: pawn class, prefab, scene, screen or sound call — `asset-check` confirms) **and seen in a capture**: an in-Play capture for anything the game spawns or shows on a screen, an editor capture for a scene-placed prop (`genesys-verification`). Both, or it stays `landed`.
- **Only the parent edits the table.** Workers (`genesys-subagents`) never add rows or flip statuses; a worker that sees a missing asset reports it as `proposed` in its hand-back, and the parent adds the row. The same holds for a Blender folder's `role` and `expect`: the parent sets them; a worker that needs a change proposes it with a reason.

## asset-check.mjs

`--prebuild` fails on any `@project/...` literal in `src/`, prefabs, materials or layouts whose file does not exist, and on paths built from parts.

The full check fails on a `wired` row nothing references, a missing file, a path built from parts (`'@project/…' + n`, a template literal, a prefix constant), and code pointing at `.scratch/`. It warns on open rows, `landed` rows, unconfirmed `scene` rows, unlisted files under `assets/`, files over budget, raw WAV with audio compression off, empty `blender/` folders, and `.scratch/` or `art-source/` not ignored by git. Comments do not count as references.

Exit 0 = no FAIL, 1 = FAIL, 2 = not a project root. Fix the fails; report every warning that remains — warnings are work. The script header lists every FAIL and WARN.
