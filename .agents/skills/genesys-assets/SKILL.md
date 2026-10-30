---
name: genesys-assets
description: "Where every model, image, texture and sound comes from (reuse, code; Blender or Scenario only when asked), the GAME.md Assets table, search, budgets, wiring and the asset check. Use for any art, model, prop, character look, title art, icon, sound file, 'make it look real', 'it looks like a box', asset size, missing asset, or buildProject failing on an asset path. Not for building a model (use `genesys-code-modeling`) or Blender and Scenario work."
metadata:
  tokens: 3174
---

# Assets

You decide where each thing the player sees or hears comes from, and you own the `GAME.md` **Assets** table and the weight budgets. Rule one: **every object is recognisable for what it is**, in the game's style. A single plain primitive standing in for it is a blockout; a model composed in code from many shaped parts, in the palette, is finished art when it is recognisable. Rule two: **a batch is wired and seen in a capture before the next batch starts.** An asset folder full of files the game never loads is the most common failure.

Before the first asset of a session, read [first-asset-card](references/first-asset-card.md) (one page: metres, front, pivot, class, look, wire, capture).

## Use another skill when
- Building a model in code → `genesys-code-modeling`
- Blender (only when asked, or for real skeletal clips) → `genesys-blender-modeling`; Scenario (only when the art-routes line names it) → `genesys-generated-assets`
- The walkable space, placing many props → `genesys-level-authoring`
- Placing nodes and prefabs → `genesys-mcp-orchestrator`, `genesys-prefabs`
- Sounds and `synth.mjs` → `genesys-audio`; sky, fog, light → `genesys-lighting`
- Widgets that show an image → `genesys-ui`; compression (KTX2, Meshopt, MP3) → `genesys-asset-compiler`
- Captures that prove an asset is seen → `genesys-verification`

## Routes

Choose a route for **each object on its own**, tried in this order:

1. **Reuse** — an engine, pack or project asset that fits the role, size and style. Search, then look: `node .agents/skills/genesys-assets/scripts/asset-search.mjs <words> [--type model|texture|audio|prefab|material|font|svg]` prints real sizes, triangles, clips and rig. A name match is not a fit until you have looked (a Blender `sheet` or an editor screenshot). If a result has a `card:` line (only in folders a developer catalogued), read that card before placing it (its `.jpg` render is your look), and the `ASSETS.md` search names before dressing a space from that pack ([routes → Asset cards](references/routes.md#asset-cards)).
2. **Code** — the default for every model with no good reuse match (`genesys-code-modeling`): hero, creatures, props, pickups, weapons, vehicles, trees, rocks. Code also covers spaces (`genesys-level-authoring`), skies (`genesys-lighting`), effects (`genesys-vfx`), icons as inline SVG (`genesys-ui`) and sound (`synth.mjs`, `genesys-audio`).
3. **Blender** — **only when the creator asks**, or when a humanoid needs the engine's skeletal clips and the creator agrees. Baked realistic detail is Blender on request only (`genesys-blender-modeling` → *Detailed assets*).
4. **Scenario** — **off unless the project's art-routes line names it** (`genesys-generated-assets`).

**Art routes** are set in `AGENTS.md` (custom section) or the creator's request; with no line they are **reuse, code**. The creator's words always win: "don't use Blender" turns it off for the session, asking for it turns it on. Copy the result into `GAME.md` **Design → Art routes**. A route that is off is never an open commitment; the next route owns the row.

Defaults per role: code models for the player body, enemies, props and pickups, each creature with procedural motion; engine kit or code pieces for architecture (never two kit families in one space); reused `LowPoly/` / `SandboxAsset/` or code dressing, instanced; the live scene behind the title card for title art; inline SVG for icons; engine sounds or `synth.mjs` for audio (the engine ships no music). Full table, search details and needs with no route yet: [routes](references/routes.md).

**Style.** `GAME.md` **Design → Art direction** names the style in one sentence and a **palette** of 5–8 hex colours between about `#272727` and `#ededed` (albedo 0.02–0.85; near-white glares under the sun). Every code-model material comes from the palette. One reused family per space; build the rest in code to match it.

## Weight budgets

The one budget table for the pack. Code models keep their counts under the `role` row; the Blender runner enforces it on every build; `asset-check` warns on any file over budget.

<!-- budget-table: read by genesys-blender-modeling/scripts/runner.py and genesys-assets/scripts/asset-check.mjs. Keep: role in backticks first, then file, tris, materials. -->
| Role (`asset.json` `role`) | File ≤ | Tris ≤ | Materials ≤ | Covers |
|---|---|---|---|---|
| `hero` | 1.5 MB | 12000 | 10 | the player character or vehicle |
| `creature` | 1.5 MB | 8000 | 8 | enemies, NPCs, bosses |
| `prop` | 300 KB | 4000 | 6 | things the player handles or gets close to: chest, door, lever, crate, torch |
| `pickup` | 150 KB | 1500 | 4 | coin, potion, key, gem, heart |
| `kit` | 150 KB | 3000 | 4 | wall, floor, pillar, stair, fence pieces placed many times |
| `building` | 600 KB | 8000 | 8 | a house, shop or tower placed a few times |
| `scatter` | 100 KB | 1500 | 2 | grass, rocks, bushes, trees placed dozens to hundreds of times |
| `title` | 600 KB | — | — | title still, JPEG 1920 × 1080 |
| `icon` | 60 KB | — | — | HUD or inventory icon, PNG 256 px |
| `texture` | 1 MB | — | — | tileable texture, 1024² (2048² max) |
| `music` | 1.5 MB after compression | — | — | music bed (a WAV ships raw unless the asset compiler's audio compression is on) |

Materials are draw calls: each one costs a draw per placed copy. Over budget: fewer segments, `join`, merge colours that read the same at play distance, bake size 1024, enable the asset compiler (textures and mesh compression) for build output, and audio compression for music.

## The Assets table

Write it in `GAME.md` during design, **before the first code or editor edit**, one row per distinct role:

```markdown
| Role | Route | Path | Reuse | Done when | Status |
|---|---|---|---|---|---|
| Slime enemy | code | @project/assets/models/slime.glb | ~20 spawned | squashes when it moves, readable at 12 m | landed |
```

- **Route**: `reuse`, `code`, `scene`, `synth`, `blender (<folder>)`, `scenario`. **Path** is the exact `@project/...` / `@engine/...` string the game uses (a source file for a code row with no asset; node names in backticks for a `scene` row). **Done when** is visible or playable, not "file exists".
- **Status**: `planned` → `building` → `landed` (file exists, numbers in range, and you looked at it) → `wired` (**referenced** by the game **and seen in a capture**; both, or it stays `landed`), or `cut — <reason>`.
- **Only the parent edits the table.** A worker proposes a row; it never adds rows or flips statuses.

Full example, column rules and Scenario/worker statuses: [ledger](references/ledger.md).

## Batches

1. **First batch at the start**, while the boot path is built: the hero, the main opposition, the first thing the player interacts with, and the architecture kit. Code models are code modules, so a subagent can own them from the first minute (`genesys-subagents`). Make every image the code references in this batch; code that names a missing image fails `buildProject`.
2. **Wire before the next batch.** Every row in a batch is `wired` before the next starts. Update the table after each batch, not at the end.
3. **Before every `buildProject`**: `node .agents/skills/genesys-assets/scripts/asset-check.mjs --prebuild` (fails on a referenced file that does not exist, or a path built from parts).
4. **Before every report and handoff**: `node .agents/skills/genesys-assets/scripts/asset-check.mjs`. Fix every FAIL; report every remaining WARN — warnings are work. What it checks: [ledger → asset-check](references/ledger.md#asset-checkmjs).

## Wire it

| Asset | Where it goes | How |
|---|---|---|
| Prop or dressing placed once | Scene | MCP `action_node(add)` `ENGINE.ModelMeshNode` with `modelUrl` = the row's path, then `action_scene(save)` |
| Repeated prop, kit piece, scatter | Prefab or layout | `genesys-prefabs`, `genesys-level-authoring` (instanced layouts for scatter) |
| Code model | Its GLB | `genesys-code-modeling`: a `GlbModel` class for what the game spawns and animates; a `ModelMeshNode` placed with MCP for a static prop |
| GLB on the pawn Play spawns, or a runtime enemy | The pawn / enemy class | A `ModelMeshNode` child in `setupVisualNode` ([wiring](references/wiring.md)) |
| Title art, icons | The screen that already exists | `genesys-ui` |
| Material or texture | The node's material | MCP `material` property or a material asset (`genesys-mcp-orchestrator`) |
| Sound, music | A sound call on the right bus | `genesys-audio` |

A pawn that Play spawns does not exist in the editor: attach its GLB in its class (rotation `(0, π, 0)`, y `−CHARACTER_HEIGHT / 2`, physics off). Never add a `GLTFLoader`.

**Asset paths** are always one complete string literal (`AGENTS.md`). A folder constant plus a file name fails the build (the folder or partial path is reported missing); a path with no `@project/` literal at all is dropped silently. A path chosen at runtime needs its folder in `.genesys-project` `alwaysCopyAssets`.

QA bars (size, front, pivot, weight, engine look, reads in game): [wiring → QA](references/wiring.md#qa).

## Traps

- `assets/` full of files, the game shows blockouts → batches started before earlier ones were wired → wire, capture, then continue.
- `buildProject` fails on an image or model path → code referenced it before it existed. Make referenced images in batch 1; run `--prebuild` before every build.
- Hero row "done" but Play shows the mannequin or a capsule → the mesh sits on a static scene node, not the spawned pawn class. The stock mannequin or a capsule is a blockout: build the hero in code.
- A code creature slides like a statue → no procedural motion. Swing limb pivots from speed, add an idle bob (`genesys-code-modeling`).
- Faces backwards, a speck, or building-sized → front or scale never checked ([first-asset-card](references/first-asset-card.md)).
- File loads in the editor but is missing in the published build → no complete `@project/...` literal for it in the source (the path came from a variable, data or runtime choice) → write the full literal, or add its folder to `alwaysCopyAssets`. A literal prefix joined with `${}` or `+` fails the build instead, naming the partial path.
- A path in a comment counted as wired, or statuses flipped to `wired` in bulk at the end → each row needs a code reference and its capture.
- A worker raised `expect` after a `FAIL` → the runner fails a changed gate without a new `why`; the parent decides.
- A reused engine prop looks wrong next to code models → two styles in one space. Build the missing piece in code, in the palette.
- The prompt said "don't use Blender" and a `blender/` folder exists → a default overrode the creator; build it in code.
- Near-white floor or path glares in Play → albedo over 0.85; darken toward the palette's mid tones.
- "Scenario not connected" listed as an open commitment → Scenario is off unless named; the next route owns the row.

## Done

- `GAME.md` has an Assets table; every required role is `wired` (referenced and captured) or `cut — <reason>`.
- `asset-check.mjs --prebuild` passed before the last `buildProject`; `asset-check.mjs` passes and every remaining warning is reported.
- A capture in Play shows the hero, the opposition and the key props as the things they are.
- A `blender/` folder exists only when Blender is on: the creator asked for it, or Scenario meshes are normalised through it.

## References
- [first-asset-card](references/first-asset-card.md) — read before the first asset of a session
- [routes](references/routes.md) — default route per role, searching for reuse, style families, needs with no route yet
- [ledger](references/ledger.md) — full Assets table example, column and status rules, what `asset-check` reports
- [wiring](references/wiring.md) — GLB on a spawned pawn (code), QA bars
- [asset-search.mjs](scripts/asset-search.mjs), [asset-check.mjs](scripts/asset-check.mjs) — search with real sizes, rigs and clips; the ledger check (its header lists every FAIL, WARN and exit code)
