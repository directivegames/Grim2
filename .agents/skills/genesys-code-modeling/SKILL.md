---
name: genesys-code-modeling
description: "Models built in code and shipped as GLB files: Three.js parts in tools/models/, toon/flat/soft looks, ink outlines, named pivots, GLB export with palette and engine materials, pivot motion at runtime. The default model route. Use to make a model, character, enemy, prop, pickup, vehicle, tree, low-poly, toon, cel-shaded, outline, GLB, no Blender. Not for Blender (use `genesys-blender-modeling`), the Assets table (use `genesys-assets`) or custom shaders (use `webgpu-tsl-node-material-assets`)."
metadata:
  tokens: 3248
---

# Code modeling

This skill builds the game's models in TypeScript and ships them as GLB files: many shaped Three.js parts in `tools/models/`, exported to `assets/models/<name>.glb`, coloured from one palette texture and shaded by engine material assets. The editor shows and edits the GLBs like any other model. It is the default route for anything with no reuse match. The most important rule: **a model is done when it reads as the thing in an editor screenshot and a Play capture you opened.** One box or capsule standing in for an object is a blockout (`look.stand-in`), never finished art.

## Use another skill when
- Choosing the route, the Assets table, budgets, `asset-check` → `genesys-assets`; placing many copies in the level → `genesys-level-authoring`
- The creator asks for Blender, or a humanoid needs the engine's skeletal clips → `genesys-blender-modeling`
- A shader effect (dissolve, rim, wave, glass) → `webgpu-tsl-node-material-assets`; bloom, glow strength, sun, exposure → `genesys-lighting`
- Enemy brains, telegraphs, death timing → `genesys-creatures`; hit-flash and pop feel → `genesys-game-feel`
- Colliders → `genesys-physics`; `isRoot`, `.create()`, registration → `genesys-engine`; Play captures, defect codes → `genesys-verification`

## Decide

Code is the route for props, pickups, weapons, vehicles, trees, rocks, crystals, creatures, animals, characters with procedural motion and environment pieces, unless a reused asset fits role, size and style (`genesys-assets` → search, then look). Use `genesys-blender-modeling` only when the creator asks for Blender, or a humanoid hero or NPC must play the engine's Walk, Run and Jump clips (*Rigged characters*). "No Blender" means code for every row; never switch routes silently.

A code model with pivots walks, hops and flaps without clips. Pick the look from `GAME.md` → **Art direction**: one look per game (two side by side is `look.mixed-styles`).

| Art direction says | Look (`tools/models/looks.ts`) | Ink outline |
|---|---|---|
| toon, cel, cartoon, anime, chibi, cozy | `TOON` → `M_Toon` (palette + 3-band ramp) | Yes, about 1 % of model height |
| low-poly, flat, papercraft, diorama | `FLAT` → `M_Flat` (flat shading, roughness 0.85) | No |
| toy, plastic, clean, soft | `SOFT` → `M_Soft` (roughness 0.6) | Optional |
| neon, sci-fi, magic | Dark base plus `GLOW` parts → `M_Glow` | No |

## The bar

Build in this order and look after steps 1 and 4:
1. **Silhouette.** Block the outline with 3–6 big parts. Exaggerate the feature that names the thing (lid and lock, flame, ears, cork).
2. **Shape.** Replace plain primitives with shaped parts: lathe profiles, extruded outlines, capsules, cones, tori, squashed spheres, rotated and scaled.
3. **Face and role.** Creatures get eyes (dark pupil, light glint), a mouth, beak or visor. Add one accessory that names the role (helmet, satchel, sword, crown).
4. **Values.** Use at least 3 values per model: a base, a darker shade, a light accent. Take every colour from the `GAME.md` palette.

| Role | Parts | Triangles ≤ (ink included) | Meshes (guide) |
|---|---|---|---|
| `hero` | 15–40 | 12000 | ≤ 12 |
| `creature` | 10–30 | 8000 | ≤ 10 |
| `prop` | 6–20 | 4000 | ≤ 4 |
| `pickup` | 3–8 | 1500 | ≤ 3 |
| `kit` | 2–10 | 3000 | 1–2 |
| `building` | 15–40 | 8000 | ≤ 8 |
| `scatter` | 3–10 | 1500 | 1–2 |

Triangles and the material limit per role are the `genesys-assets` *Weight budgets*; each mesh is one draw call per copy. Segments: spheres 12×8 (heads 16×12), cylinders and capsules 8–12 around, lathes 10–16, tori 6×16. Sizes: hero ≈ `ENGINE.CHARACTER_HEIGHT` (1.8 m), door 2.2 m, crate 0.8 m, pickup 0.3–0.5 m. Build the front toward −Z (pawn forward) with the feet or base at y = 0.

## Build

Three parts, kept apart: **source** in `tools/models/` (pure Three.js, never shipped), **assets** written by the export, **runtime** classes in `src/models/` that load the GLBs. Copy the [templates](templates/) into the game (`tools/models/parts.ts`, `looks.ts`, `index.ts`, `src/models/glb-model.ts`; worked example `sprout.ts` + `sprout-model.ts`). Kit API: [kit](references/kit.md); setup, export outputs, runtime and the hero pawn: [pipeline](references/pipeline.md).

**1. Source.** `part()` copies a template geometry, places it and paints it a palette colour; `merge()` joins parts that move together, once at module load. A builder returns one `THREE.Group` named `rig`; each moving part sits under a uniquely named pivot (`pivot('head', …)`) at its joint, and each mesh carries its look (`mesh(name, geo, TOON)`); ink hulls use `INK`. The sprout builder: [kit → Worked example](references/kit.md#worked-example-the-sprout); shape helpers and part lists per role: [recipes](references/recipes.md).

List each model the game spawns or the scene places in `tools/models/index.ts` `MODELS`; an unplaced variant is an unwired asset. Add `"tools/**/*"` to the project `tsconfig.json` `include`, with the four base entries ([pipeline](references/pipeline.md#project-setup)), so `pnpm build` and `pnpm lint` check the builders.

**2. Export.** From the project root: `pnpm exec tsx .agents/skills/genesys-code-modeling/scripts/export-glb.ts` (`--only sprout`, `--dry`). It writes each GLB, the shared palette and ramp textures, one `M_<Look>` material per look, and `tools/models/palette.json` (stable swatches). Each GLB links its engine material, so add `"@project/assets/materials"` and `"@project/assets/textures"` to `alwaysCopyAssets` in `.genesys-project`. Run `asset-check`, then `buildProject`. **The code is the source of truth:** each run overwrites every listed GLB; a GLB the creator hand-edits leaves `MODELS`, recorded in `GAME.md` → Decisions.

**3. Runtime.** A model the game animates is a `GAME` class that extends `GlbModel` (template): it loads the GLB, turns physics off and calls `onRigReady()`, where `part(name)` finds pivots (null until then, so guard every tick). `flash(seconds)` and `setLook(mat)` swap one shared material; build each `toonTint()` once and share it. Example class: [pipeline → Runtime](references/pipeline.md#runtime).

- **Static props** need no class: an `ENGINE.ModelMeshNode` placed with MCP, `modelUrl` the GLB, `physicsOptions.enabled: false`, `castShadow`, `receiveShadow` and `static` true.
- **Roots.** A model class standing alone sets `this.isRoot = true`; one dressing an enemy, pickup or pawn is a child, and the owner is the root and carries collision (`genesys-engine`).
- **Variants:** 2–3 per repeated prop, each its own `MODELS` entry. **Many copies:** one instanced node ([recipes](references/recipes.md) → *Many copies*). Motion shows only in Play; the editor shows the rest pose.
- **The hero** wears the model in `setupVisualNode` (with `setupAnimationNode` returning null), lowered by `CHARACTER_HEIGHT / 2` because the pawn origin is the capsule centre ([pipeline → The hero](references/pipeline.md#the-hero)).

## Looks

The `M_<Look>` materials are engine assets the creator can tune in the editor. Put glowing parts in their own mesh with `GLOW` and keep the bloom threshold at 0.9–1.0, so only they bloom (`genesys-lighting`). Draw each model once on the title, flash included, so no shader compiles mid-fight (`genesys-profiler`). Material types, ramps, swatches, ink cost: [kit](references/kit.md) → *Looks in detail*.

## Procedural motion

Drive every pivot from `tickPrePhysics` with game time and preallocated vectors (numbers match `genesys-creatures`). The template `src/models/sprout-model.ts` has the full set: stride (legs swing with speed, the rig bobs), idle breath, head look-at, hit flash and a death tumble. Speed comes from the position change, so the same code works on a pawn, a pattern mover and a behaviour-tree walker. Wings, tails, wheels, hover-spin: [recipes](references/recipes.md) → *More motion*.

## Look at it

Look at every model before you call it done, and state what the image must show before you open it. The parent runs the bench (it builds and changes the editor); a worker reports the model ready. Full steps: [pipeline → Bench](references/pipeline.md#bench-the-full-look-steps).

1. Export, `asset-check --prebuild`, `pnpm lint`, `pnpm build`, `buildProject`. If Play is running, look later; never stop the creator's Play.
2. Place the model three times at yaw 0, π/2 and π beside the `mannequinG.glb` scale reference, frame them, and capture.
3. Label it "editor capture (not Play)" and write each defect as a `look.*` code ([defect-codes](../genesys-verification/references/defect-codes.md)).
4. Fix, export, `action_scene(open)` the scene so the new GLB loads, capture again, delete the bench nodes. New colours show only in Play until the project reloads.
5. Prove motion and gameplay scale in a Play capture next to the hero (`genesys-verification`).

## Assets table

A code model is one `GAME.md` Assets row with route `code` and its GLB as the Path; a kit row lists every variant. Status: `landed` once the GLB exists and the bench screenshot was opened; `wired` once the game spawns or places it and it is seen (Play capture, or an editor screenshot for a scene prop). Only the parent edits the table. Example row: [pipeline → Assets row](references/pipeline.md#assets-row).

## Limitations

- A soft colour gradient turns into jagged patches (no vertex colours): [pipeline → Limitations](references/pipeline.md#limitations).

## Traps

- If a model is one box, capsule or sphere, it is a blockout (`look.stand-in`). Compose it from shaped parts to the bar.
- If a model reads as lumps, the silhouette has no identifying feature (`look.shapeless`). Exaggerate the one feature that names it.
- If the model faces sideways or backwards, its front was built toward +Z (`look.facing`). Build the front toward −Z.
- If the hero floats or sinks, the model sits at the pawn origin (`look.hovering`). Set y = −`CHARACTER_HEIGHT` / 2. If a prop floats, move its lowest point to y = 0.
- If the player bumps into a prop that should have no collision, its `ModelMeshNode` kept the default physics. Turn it off.
- If spawning hitches, a material or tint is created per spawn; if every copy flashes on one hit, a shared material's colour changed. Build each tint once and share it; use `flash()`.
- If legs do not swing in Play, the model never ticks. Call `super.beginPlay()` and check `canEverTick`.
- Grey or white model, missing pivots, `merge` or ink-hull errors, bloom on the whole model, vanished hand edits: [pipeline → Traps](references/pipeline.md#traps).

## Done

- Every model row in `GAME.md` is `wired`, or `cut — <reason>`. Its Path is the GLB.
- Each model meets its role row in *The bar*; `tris()` was logged once and is under budget.
- The export ran after the last builder change, and `asset-check` passes.
- Every exported GLB is in `MODELS` (or recorded as hand-edited) and placed or spawned by the game.
- A bench screenshot was opened for each model, and each spawned model was seen in a Play capture. No `look.*` code remains, and each moving model moves.
- Static props are `ModelMeshNode`s in the saved scene with physics off.
- No `new …Geometry` or `new …Material` runs per spawn; tints are built once and shared.

## References
- [pipeline](references/pipeline.md) — setup, export outputs, runtime and placement, the hero pawn, full bench steps, Assets row, pipeline limitations and traps
- [kit](references/kit.md) — template files, `part()`, `merge()`, `inkHull()`, the sprout builder, palette, ramp and material details
- [recipes](references/recipes.md) — shape helpers, part lists per model kind, many copies, more motion
- `templates/` (to copy into the game), `scripts/export-glb.ts` (the export)
