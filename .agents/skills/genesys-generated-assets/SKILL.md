---
name: genesys-generated-assets
description: "The Scenario route, only when the art-routes line names Scenario: models, painted images, textures, skyboxes and audio via the Scenario MCP, one allowance, early batches, every file normalised through Blender. Use for Scenario, AI-generated art, generate a model/image/texture/skybox/sound, a generated character that must walk. Not for choosing the route or wiring (use `genesys-assets`) or anything Blender can model (use `genesys-blender-modeling`)."
metadata:
  tokens: 2693
---

# Generated assets (Scenario)

This skill runs Scenario for rows that `genesys-assets` routed here. It does not decide *whether* to generate; the Assets table already did. The most important rule: **every batch is collected, normalised, wired and seen in a capture before the next batch is sent.** Paid files nobody loads are the failure this skill exists to prevent.

## Use another skill when
- Which route an object takes, the Assets table, wiring, weight budgets → `genesys-assets`
- The object can be built in code (props, pickups, kit, creatures, icons) → `genesys-code-modeling`
- Music beds and sound effects without Scenario → `genesys-audio` (`synth.mjs`)
- The walkable space → `genesys-level-authoring`
- Skybox wiring and mood → `genesys-lighting`
- Build-time compression → `genesys-asset-compiler`

## When this route is on

**Off by default.** Only when the project's **art-routes line** names Scenario (`AGENTS.md` custom section, `GAME.md` Design, or the creator's request) **and** the Scenario MCP answers. If either is false, the row goes to the next route in `genesys-assets` (reuse, code). "Scenario off" or "not connected" is never an open commitment on its own.

Scenario earns its cost on what code will not reach: a specific human likeness, painted 2D key art, photographic or painterly textures, skyboxes, composed music and voiced lines. A generated character is a mesh; it walks only after it is rigged to the mannequin in Blender (below).

Raw downloads go in `art-source/`, which the SDK-managed `.gitignore` ignores, so they are never committed or shipped. A project whose `.gitignore` predates that line gets a warning from `blender.sh` and `asset-check.mjs`; updating the SDK adds it.

## Allowance: ask once

1. For every Scenario row in the first batch, find the model and price it with `dry_run` (procedure below).
2. Ask the user **once** for the batch total: "The first batch is hero, slime, title art — 128 credits. Go?" Carry on with the build until they answer; no answer means no.
3. That answer is the allowance for this build. Later batches inside it run without asking; a batch that would pass it asks again with the new total. Silence never raises it.
4. Record the allowance and what is spent in `GAME.md` **Status → Open commitments** only while a price question is unanswered.

## Pinned models

The first time a kind is generated in a project (hero mesh, prop mesh, painted image, texture, skybox, music, SFX), record the chosen model in `GAME.md` **Design → Scenario models**:

```markdown
- **Scenario models** — mesh: <model_id> (image-to-3D via <image model_id>); key art: <model_id>; sfx: <model_id>
```

Later rows of the same kind reuse that model and its schema with no new `recommend`. Re-discover only when it fails or is deprecated. One model per kind keeps the set in one style.

## Send early, collect before the next batch

1. **Send the first batch at the start**, while the boot path is being built: `model_run` returns job ids at once. Write each id into its Assets row (`requested — job <id>`), then keep building. Do not sit in `jobs_wait`.
2. **Collect** with `jobs_wait` on those ids once the boot path is Built. Download, normalise, QA, wire (below). Every row goes to `wired`.
3. **Only then** send the next batch. Sending a new batch before the last one is collected fills `assets/` with files the game never shows.
4. **Before you stop**, every requested id is collected or listed as open with its id, so the next session can `jobs_wait` it.

## The Scenario procedure

Read before the first generation:
1. Scenario skill `scenario`, via the Scenario MCP `skill_get` tool: scope, `recommend`, `model_schema_get`, `dry_run`, `model_run`, `jobs_wait`. Sandbox Studio's Scenario proxy blocks `asset_download`; files come in through `action_asset_generation` `import`.
2. The kind skill, also via `skill_get`:

| Need | `skill_get` name | Output |
|---|---|---|
| Hero, enemy, creature, character mesh | `scenario-3d` | Concept image of one centred subject on a plain background, **T-pose, arms straight out to the sides**, then image-to-3D. GLB, **unrigged**: skip the skill's own rigging step — its skeleton is not the mannequin's, so the engine clips would not play. Rig it in Blender (below). |
| Prop, weapon, vehicle mesh | `scenario-3d` | Same pipeline; not rigged. |
| Key art, menu backdrop, icon, sprite, UI panel | `scenario-game-assets` | PNG. Transparency from a native-alpha model or a removal pass, not the word "transparent". |
| Seamless floor, wall or trim texture | `scenario-textures` | Power-of-two square. Check the seam. |
| Sky, 360 backdrop | `scenario-skyboxes` | A skybox model, not a generic image model. |
| SFX, ambience, music | `scenario-audio` (or `scenario-sonilo` / `scenario-elevenlabs` when that skill matches) | Audio file, then `genesys-audio`. |

3. `memory_recall` when Scenario is signed in with OAuth, before the first paid call in a project.

Then:
- Pass `team_id` and `project_id` from `teams_list` then `projects_list`. If more than one project matches, ask once and record it in `GAME.md`.
- `recommend` is for a capability in the user's words; `search` for a model name they gave. Skip both for a kind that has a pinned model.
- Read `next_step.type`. On `ask_user`, the user picks. On `proceed`, prefer `specialty.model_id`; otherwise the first `ranked` entry not marked deprecated.
- `model_schema_get` on the chosen id before `model_run`. Copy field names from the schema.
- A failed or timed-out job is not a second `model_run`: call `jobs_wait` again with those `job_ids` (the response names them `pending_job_ids`). A transport error with no status means `jobs_list` before any retry.

## Prompt for a game, not a poster

Reuse the art-direction sentence and palette from `GAME.md` in every prompt, so the set shares one look.

- One subject, centred, plain background, front view. State material, wear, silhouette and gameplay size ("crate about one metre tall"). Characters: T-pose, arms straight out, feet apart, no cape or loose cloth below the knees.
- Strip baked lighting when the schema offers it, unless the style is hand-painted.
- Use the lower end of the schema's face-count range; the role budget in `genesys-assets` → *Weight budgets* is the ceiling after normalising.
- Hold one seed across a set; change only the subject words. Pin prompt expansion off when the schema has that flag.

## Land and normalise

1. `action_asset_generation(action: "import", scenarioAssetIds, name)` brings the file into `assets/generated/`. Move that raw file to `art-source/` before normalising, so only the normalised export ships.
2. **Meshes** go through Blender so they match the Blender-built set: a folder `blender/<asset>/` whose step script imports the raw file and fixes it, with `asset.json` `role` and `export` → `assets/models/...`:

   Source: .agents/skills/genesys-blender-modeling/scripts/gkit.py (`import_glb`, `decimate`, `shrink_textures`, `clamp_metal`, `ground`)
   ```python
   # blender/barrel/01-normalise.py
   s = 1.0                           # from the first sheet: target size / measured size
   root = import_glb('art-source/barrel_raw.glb')
   root.scale = (s, s, s)
   root.rotation_euler.z = math.pi   # only if the sheet's front view shows the back
   for o in meshes():
       decimate(o, 3000)             # under the role's triangle budget
   shrink_textures(1024)             # image maps are most of a generated file's weight
   clamp_metal()                     # metal > 0.85 and rough < 0.2 → 0.6 / 0.35
   ground()
   ```
   Open the sheet: front faces −Y (the sheet's front view), feet on the floor, the `BUDGET` line passes. Add `--look` to see the materials under a sun.
3. **Characters** that must walk: rig the raw mesh to the mannequin in the same folder — [rig-generated-character](references/rig-generated-character.md) (scale to rig height, centre on the hips, `bind_nearest` by body region, `skin`, `pose_check`, `"rig": "mannequin"`). Rigid creatures with no humanoid shape stay static and move in code (`genesys-creatures`).
4. **Images** go to `assets/ui/` or `assets/textures/`, resized to their use (title ≤ 1920 px wide, icons 256 px), inside the `title` / `icon` / `texture` budgets.
5. **Audio** goes to `assets/audio/`; the asset compiler's audio compression turns WAV into MP3 at build only when it is on (`genesys-asset-compiler`).
6. Mark the row `landed`, then wire it (`genesys-assets` → *Wire it*), capture it, and mark it `wired`.

Orientation, pivot and measuring details: [asset-qa.md](references/asset-qa.md).

## Traps

- Second paid run after a timeout → retry with `jobs_wait` and `job_ids`, not `model_run`.
- A deprecated model picked → `ranked[0]` taken blindly; read `next_step` and skip deprecated rows.
- A different model per asset, so the set looks like five games → pin one model per kind.
- A price question asked per asset → ask once for the batch total.
- Generated GLB is 4–5 MB, faces sideways, floats → it skipped the Blender normalise folder.
- Generated character stands in T-pose or slides in game → it kept Scenario's own rig, or was never rigged; rig it to the mannequin in Blender.
- Generated prop renders black or chrome → mirror metal; `clamp_metal()` in the normalise step.
- Raw downloads show up in `git status` → the project's `.gitignore` predates the `/art-source/` line; update the SDK, or add the line.
- Files in `art-source/` or `assets/` that the game never loads → a batch was sent before the previous one was wired; run `asset-check.mjs`.

## Done

- The art-routes line names Scenario, and the user agreed to the allowance before any paid run started.
- Every Scenario row is `wired` (referenced and captured) or listed open with its job id.
- Every generated mesh went through a `blender/` folder that prints `RESULT ok` with its role budget; characters print `RIG mannequin … 0 problems`.
- `asset-check.mjs` passes (`genesys-assets`).

## References
- [rig-generated-character](references/rig-generated-character.md) — a generated T-pose mesh onto the mannequin rig so the engine clips play
- [asset-qa.md](references/asset-qa.md) — measuring bounds, orientation, scale, pivot, images; budgets live in `genesys-assets`
