---
name: genesys-blender-modeling
description: "Opt-in: model props, buildings, creatures, vehicles, rigged characters (on the engine mannequin rig), title stills and icons in headless Blender, only when the creator asks for Blender or a humanoid needs the engine's skeletal clips. Use for Blender, rig, skin, mannequin, skeletal walk cycle, contact sheet, high-to-low bake. Not for default modelling (use `genesys-code-modeling`), whether to model or wiring (use `genesys-assets`) or the scene bridge (use `genesys-blender-bridge`)."
metadata:
  tokens: 3144
---

# Blender modeling

**This route is opt-in.** Use it only when the creator asks for Blender, or when a humanoid needs the engine's skeletal clips and the creator agrees. The default for every model is code (`genesys-code-modeling`). If the prompt says "don't use Blender", do not open this skill.

An asset is Python step scripts that a headless Blender runs. Every run rebuilds it, prints its numbers against its role budget, renders a four-view contact sheet, and exports a GLB (or a still) under `assets/`. **Know what a run should produce before you run it, then check the numbers and open the sheet after.** A file that exported is not an asset that reads.

First asset of the session: read `genesys-assets` → [first-asset-card](../genesys-assets/references/first-asset-card.md).

## Use another skill when
- The default route: a model built in code → `genesys-code-modeling`
- Whether to model at all, the Assets table, budgets, wiring → `genesys-assets`
- The walkable space, laying out kit pieces → `genesys-level-authoring`
- Placing the GLB in the scene, prefabs → `genesys-mcp-orchestrator`, `genesys-prefabs`
- Enemy behaviour and procedural motion → `genesys-creatures`
- Mirroring the live scene into Blender → `genesys-blender-bridge` (a different tool)
- Showing a title image or icon on screen → `genesys-ui`
- Running asset folders in parallel workers → `genesys-subagents` (the Blender brief)

## The loop

One folder per asset under `blender/`: step scripts (`01-body.py`, `02-lid.py` …) run in name order on an empty scene, plus `asset.json` (`role`, `export`, `expect`: size, tris range, materials, markers). Build with `.agents/skills/genesys-blender-modeling/scripts/blender.sh build blender/<folder> [--look]`; it prints `BUDGET`, `NUMBERS`, `SHEET`, `EXPORT … → @project/...` and `RESULT ok`.

1. **Before running**, set the expectation in `asset.json`. `role` (required: `hero`, `creature`, `prop`, `pickup`, `kit`, `building`, `scatter`, `title`, `icon`) picks the budget in `genesys-assets` → *Weight budgets*, enforced whatever `expect` says. `size` is `[width, height, depth]` in glTF axes.
2. **Run.** Any `FAIL` exports nothing and leaves the file in `assets/` as it was. Read `WARN` and `EXPECT` lines.
3. **Open the sheet** (`.scratch/blender/<folder>.png`) with your file-reading tool, every run. Front = head-on view; top = footprint; hero = does it read as the thing. `--look` adds an engine-look tile.
4. **Fix the script and run again.** Most assets take 2–5 runs. Stop when the numbers pass and the sheet reads at gameplay distance.
5. **Use the printed `@project/...` path** in the Assets table and in code.

**The parent owns `role` and `expect`.** Changing them later needs a `"why"`; a worker that cannot meet a gate reports it with the numbers. Commands, output lines, all `asset.json` fields: [runner](references/runner.md).

## Building with gkit

Coordinates are Blender's: metres, X right, **Y depth, Z up**. **The front faces −Y** (exports as glTF +Z). `box` / `cyl` take `at` as the bottom-face centre, so pieces stack on z. Call `ground()` last.

Preloaded: `mat`, `shades`, `mix`, `box`, `cyl`, `sphere`, `ico`, `blob`, `lathe`, `rod`, `sweep`, `torus`, `plane`, `mesh`, `marker`, `cut`, `jitter`, `join`, `smooth`, `add_bevel`, `ground`, `mirror_x`, `import_glb`, `decimate`, `seed`, `rnd`, stills staging (`camera`, `sun`, `point_light`, `world`), and garch for buildings (`window`, `door`, `gable_roof`, `rail_run`). Signatures and in-game use of parts: [gkit](references/gkit.md).

Start from a tested example: copy a folder from [examples/](examples/) (`torch`, `chest`, `slime`, `wall`, `potion`, `potion-icon`, `cottage`, `title`, `character`, `rigid-creature`, `baked-crate`) into `blender/`.

## Craft: what makes it read

- **Silhouette first.** The player sees a shape, then two or three colours, then detail. Exaggerate the identifying feature: a chest's lid and lock, a torch's flame, a slime's eyes.
- **Proportion to the role.** Characters ~1.8 m, doors 2.2–2.5 m, crates 0.6–0.9 m, pickups 0.25–0.5 m (bigger than life), kit walls on a 2 m or 4 m grid, a one-storey house 4–6 m.
- **Bevel every box** (0.01–0.04 m); unbevelled boxes read as placeholders.
- **Break repetition**: `shades` for 2–3 variants, `jitter` 1–2 % of size, `rnd` for widths and small rotations; keep `seed` fixed.
- **Palette only**, albedo 0.02–0.85 (about `#272727` to `#ededed`); outside it prints `WARN palette` (clips white or reads as a hole). Emissive only for things that glow in game.
- **Materials are draw calls**: stay inside the role cap; merge colours that read the same at play distance. One colour per material name.
- **Triangles**: the budget is the ceiling; cylinders 8–16 segments, spheres 12×8.
- **Faces on creatures**: eyes, mouth or visor make a blob an enemy; a low `emit` highlight makes it glossy.
- **Moving parts are separate named objects** with the pivot where they rotate (`chest_lid` at the hinge, `door_leaf`, `turret_head`, `wheel_FL`); the game finds them by name.
- **Markers** for anything the game positions: `light_socket`, `muzzle`, `loot_spawn`, `hand_R`, `exit`.
- **No image textures** unless needed: flat palette plus geometry stays tiny and survives the asset compiler. **Transparency** (`alpha`, glTF BLEND) for glass, ghosts and slime only; it sorts poorly when large.

**Kit pieces** (role `kit`, e.g. `SM_Wall_4m`, `SM_Arch`): one grid, bottom centre at the origin, front −Y; `genesys-level-authoring` lays them out. A repeated house is one `building` built with garch. Pieces with openings need `collisionMeshType: trimesh` on the `ModelMeshNode`, or the opening is solid.

## Rigged characters

A humanoid that walks, runs and jumps is modelled **on the engine mannequin's armature**, never a rig of its own: the engine's clips (`Idle`, `Walk`, `Run`, `RunBackward`, `StrafeLeft`, `StrafeRight`, `Jump`) bind by bone name. Steps (`mannequin_rig` → model in T-pose → bind each part → `skin` → `pose_check` → export with `"rig": "mannequin"`), animation configs and pawn wiring: [rigged-characters](references/rigged-characters.md).

- **Never move, scale, re-pose or rename the armature.** The export check fails on any changed rest transform.
- **Region weights, not bone heat**: `bind_nearest(part, region(...))` for cloth and limbs. Blender's automatic weights leave low-poly parts unweighted.
- **Rigid is the default for anything bony**: `bind_rigid(piece, bone)` for heads, hands, armour, skeletons, robots, carried props.
- Keep soft parts continuous across joints (one sleeve from shoulder to wrist). The character is rig height (~1.8 m); a child or short creature changes proportions, not joints.

## Using the result in the game

- **Model** → `genesys-assets` → *Wire it*: scene placement through MCP, repeated pieces as prefabs, pawns and enemies in their class.
- **Named part or marker** → `getObjectByName` in `onMeshLoaded` ([gkit → in the game](references/gkit.md#using-named-parts-and-markers-in-the-game)).
- **Rigged model** → the pawn's `setupVisualNode` loads it like the mannequin (rotation `(0, π, 0)`, y `−CHARACTER_HEIGHT / 2`).
- **Still** → title backdrop or icon on the existing screen (`genesys-ui`). An image a UI `.html` or `.css` file names by `@project/` path stays raw at build; one set from code must be excluded from KTX2 baking (`genesys-asset-compiler`).

## Stills: title art and icons

Both go in the **first batch**: code that names `title.jpg` or an icon before it exists fails `buildProject`.

- **Title** — `still` only, role `title` (≤ 600 KB), 1920×1080 JPEG. Stage the game's exported models with `import_glb('@project/...')`; light it like a film still: warm key from the camera side, coloured practicals, cool rim, dark background. Build it after the models it imports.
- **Icons** — role `icon` (≤ 60 KB), 256×256 PNG, `"transparent": true`. Reuse the pickup's step script (`exec(open(resolve('blender/potion/01-potion.py')).read())`), frame close with a long lens.
- Open the image after rendering. Dark, empty or off-centre is a defect.

## Detailed assets: high → low bake (only on request)

Flat palette is the default. Bake **only when the creator asks** for realistic, painterly or textured detail, never across an asset set unprompted: a high-poly source (never exported), a low-poly game mesh, one baked material. Judge with `blender.sh preview`, not the sheet. Steps: [high-to-low-bake](references/high-to-low-bake.md).

## Parallel work

Blender folders touch no editor state and no build, so a subagent can own them (`genesys-subagents` → the Blender brief). A worker builds only its own folders (`build-all` is the parent's), never edits `role` or `expect`, and proposes Assets rows instead of adding them. Done for a worker: `RESULT ok` for each folder and each sheet opened.

## Traps

- `FAIL w|h|d <got> m, expected <want> m ±15%` → the model misses the parent's `expect.size` (not a role limit) → fix the script, not the instance scale in the scene; changing `expect` needs a `"why"`.
- `FAIL … over the <role> budget` → simplify (segments, `join`, fewer colours, smaller bake); the budget does not move for `expect`.
- `FAIL role/expect changed since the last build` → restore the gate, or (parent) add a `why`. `"role" is None` → add the role the parent gave.
- `bottom` not 0 → the model floats or sinks; call `ground()` last.
- Sheet front view shows the back → the front was built toward +Y; build it toward −Y.
- `WARN mat '<name>' already exists` → two colours under one material name; name each colour.
- Bevels missing after joining → use gkit `join` (it applies modifiers first). Everything grey on the sheet → materials made without gkit `mat`.
- Sheet fine, game washed out or glow missing → Workbench has no tone mapping or emission; check the `--look` tile and the palette warning.
- Title still nearly black → no light from the camera side. Icon background opaque → `"transparent": true` and a `.png`.
- Rigged model in T-pose in game, or `RIG … rest pose differs` → see [rigged-characters → Traps](references/rigged-characters.md#traps).
- Blender missing, crashing, timing out, or `import_glb` failing → [runner → Environment traps](references/runner.md#environment-traps).

## Done

- `blender.sh build blender/<asset>` prints `RESULT ok` with the `BUDGET` line for its role and no unexplained `EXPECT` line.
- The sheet was opened after the last run and reads as the thing; `--look` was opened for glowing, glass or pale assets.
- The Assets row has the printed `@project/...` path and status `landed`; `genesys-assets` takes it to `wired`.
- Rigged models: `RIG mannequin … 0 problems`, and every pose-check image was opened.

## References
- [runner](references/runner.md) — commands, output lines, `asset.json` fields, Blender environment traps
- [gkit](references/gkit.md) — gkit and garch signatures, named parts and markers in game
- [rigged-characters](references/rigged-characters.md) — rig build steps, weighting, animation configs, pawn wiring
- [high-to-low-bake](references/high-to-low-bake.md) — opt-in detailed route
- [examples/](examples/) — tested step scripts; [scripts/](scripts/) — runner and helpers with docstrings
