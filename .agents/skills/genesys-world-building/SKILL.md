---
name: genesys-world-building
description: Build outdoor worlds and their look in Genesys — world recipes (applyWorld), environment presets, world styles (realistic, anime, low-poly, volcanic, snow, desert, alien), sky, sun, fog, tone mapping, textured terrain and islands, grass, trees and plants, water (ocean, lake, river), landmarks, floating objects, and orbit/showcase cameras. Use for any "make a scene / ocean / islands / forest / valley / landscape / city at night" prompt, before primitives or Poly Builder, when adding terrain or water to a scene that already has gameplay props, and when wrapping a three.js addon as a node.
metadata:
  tokens: 2341
---

# World Building

Genesys has engine nodes for every part of an outdoor scene. Use them; do not fake terrain with cones, water with a recoloured ground plane, or sky with a background colour. Engine source is at `.engine/src/` — read signatures there before setting unfamiliar properties.

## Decision: recipe, hand-build, or escape hatch

| Situation | Do |
|-----------|----|
| Outdoor prompt that matches a built-in recipe: `tropical-ocean` (ocean, islands), `temperate-valley` (forest valley, river), `night-street`, `overcast-plain`, `desert-canyon`, `volcanic-island`, `lake-basin`, `coastal-cliffs`, `arctic-coast` (snow, polar sea) | `action_scene(applyWorld, world: "<id>", dryRun: true)`, then apply. Per-recipe knobs: [recipes.md](references/recipes.md) |
| Close to a recipe (other time of day, size, style, density, seed) | `world: { extends: "<id>", ...tweaks }`, dry-run first. Fields and rules: [world-recipe.md](references/world-recipe.md) |
| A landform or mix no recipe fits | A custom recipe (`landform.shape`, `water.role`, `style`, `vegetation`, `sky`, `landmarks`, `camera.view`); `action_scene(listWorldRecipes)` shows what exists |
| An art direction only (photoreal, anime/toon/cel, low-poly, lava, snow, desert, alien, autumn) | `style` in the recipe; `applyWorldStyle` only on hand-built scenes — [world-styles.md](references/world-styles.md) |
| **Scene already has gameplay or authored props** | Read [existing-scene.md](references/existing-scene.md) first. A theme on a level with its own floors is a backdrop below them; when props must stand on the new ground, stop after the dry run and ask (keep their floors, or apply terrain and re-place props). `applyWorld` keeps those nodes but never moves them onto the new ground, removes only a root mesh named exactly `Ground` (not `Mesh_Floor` or mesh oceans), and MCP cannot sample terrain height |
| The recipe cannot express it (several terrains, heightmaps, custom structures) | Hand-wire the nodes with [compose-checklist.md](references/compose-checklist.md) |
| New scene for an outdoor prompt | `action_scene(create, template: "tropical" \| "valley" \| "night" \| "plain" \| "anime" \| "lowpoly" \| "volcanic" \| "snowy")` |
| A feature no node covers | Wrap the three.js object in a `@ENGINE.GameClass()` node: [escape-hatch.md](references/escape-hatch.md) |

Recipes write ordinary nodes (`SkyNode`, a "Sun" `DirectionalLightNode`, `HemisphereLightNode`, `FogNode`, `TerrainMeshNode` with `ScatterNode` / `GrassNode` children, `WaterNode`, `OrbitCameraNode`) plus ACES tone mapping; nothing recipe-specific is saved. Edit any of them with `action_node(setProperties)`. One apply is one undo step.

**Recipe vs style.** The recipe decides the layout (landform, water role, lights, camera, which nodes exist); the style decides how they look (terrain layers, grass, tree species, water presets, fog tint). "anime islands" = `{ extends: "tropical-ocean", style: "stylized-anime" }`; "volcanic valley" = `{ extends: "temperate-valley", style: "volcanic" }`.

## Outdoor recipe (in this order)

1. **Brief** — one line each: mood, time of day, palette (3–5 colours), hero element, scale.
2. **Environment and light** — from the recipe; hand-built: [compose-checklist.md](references/compose-checklist.md) step 4–5, exposure in [look-and-exposure.md](references/look-and-exposure.md).
3. **Landform and style** — `landform.shape` plus a `style`; never leave a hero terrain on plain `biomes` colours. Properties: [nodes.md](references/nodes.md#landform).
4. **Water** — the recipe's `water.role`; a hand-built `WaterNode` is a root node placed per [nodes.md](references/nodes.md#water). Pick the preset by art style first, then by body of water.
5. **Dressing** — `vegetation` layers (seeded `ScatterNode` children of the terrain) and one `GrassNode` per terrain.
6. **Landmarks** — `landmarks: [{ kind, count, scale, placement }]`; give every world a focal one. A floating object gets a `BuoyancyNode` child.
7. **Motion and life** — water flow, clouds, `WindNode`, orbit auto-rotate, birds or particles (`VFXNode`).
8. **Camera** — `OrbitCameraNode` framing the hero, or `camera: { mode: "none" }` when the game owns the camera.
9. **Verify** — see Done means.

## Rules

- Choose and change the style inside `applyWorld` and re-apply with `applyWorld`. Never follow an `applyWorld` with `applyWorldStyle`: it re-dresses everything, ignores what the recipe spelled out and swaps water by role (`volcanic` turns the sea into lava and replaces the atmosphere).
- Dry-run every custom recipe. Size the landform to the job before the first apply: each `applyWorld` is slow, and a second one to fix the first is avoidable.
- Apply once and wait. If `applyWorld` returns `operation_still_running` (or a renderer timeout on older editors), the build is still running in the editor: never apply again. Poll `query_editor(getBusyState)` until `isBusy` is false (older editors: `query_node(find, "TerrainMesh")`), then audit. A client-side `Request timed out` means the same. Every apply creates new node ids: take `focusNodeId` from the result or from `getBusyState`'s `lastWorldBuild`; never reuse an id from before the apply. On an existing scene, one script does the wait, look and audit ([existing-scene.md](references/existing-scene.md) step 5). Apply the first time with `landform.detail: "low"`.
- Judge the look only from framed captures taken after the style's textures have loaded (the terrain shows plain height-band colours until then). If metrics say `subject_off_screen`, reframe first. Tell the user whether you describe a capture or the live viewport.
- `applyWorld`, `applyEnvironmentPreset` and `applyNewSceneTemplateToWorld` return Promises in code: `await` them. A newer apply on the same world cancels an older one (`{ ok: false, cancelled: true }`). Over MCP the call waits for you.
- In a game, hold the first frame until `world.whenReady()`: [loading.md](references/loading.md).
- Sky moods come from the recipe: `sky.tint` (violet, alien), `sky.mist` (low mist), `sky.clouds` 0.6+ (grey day), dusk and dawn already lifted. Do not hand-tune sun, fill or exposure for these ([world-recipe.md](references/world-recipe.md#sky-time-of-day-haze-camera)).
- Make the recipe specific to the prompt: change seed, shape options, time of day, style; add landmarks and motion.
- Run `action_scene(auditWorld)` after any hand edit to terrain, water or scatter, and fix every error before capturing.
- Keep everything seeded (`seed`, `noiseSeed`). Never use `Math.random` for placement.
- `ScatterNode` and `GrassNode` are children of their `TerrainMeshNode`; `WaterNode` is a root node. Node-reference properties take a node id over MCP.
- Grass is `GrassNode`, never a `ScatterNode` of tufts.
- Scene look goes through MCP node and scene edits. Never build scenery in `beginPlay` and never hand-edit `*.genesys-scene`.
- Leave `quality: "auto"` on terrain, water, grass and scatter, and keep the default renderer. Tiers, the watchdog, settings menus and WebGL fallbacks: [nodes.md](references/nodes.md#quality-tiers).

## Authoring budget

- Iterate with `landform.detail: "low"`; set medium or high for the final. `TerrainMeshNode` segments ≤ 512 per side.
- Scatter: 6000 instances per layer, 15000 across the world (`dryRun` and `auditWorld` warn); ≤ 3 variants per item. A first volcanic run reached about 2.1M triangles and 2.7 GB of GPU memory: check `query_editor(getRenderStats)`.
- `landform.erosion` costs 0.1–0.5 s per terrain regenerate; keep it low while iterating.
- Heavy look presets (`cinematic-warm`: bloom, grading, AO, vignette, grain, aberration) cost fill-rate. Apply a look last, for the final only.

## Done means

- `action_scene(auditWorld)` reports no errors.
- Framed captures (check `query_editor(getState).viewportVisible` first; `action_editor(frameNodes)` then `captureScreenshot` with `focusNodeIds` and `views: ["overview", "hero", "ground"]`; [orchestrator screenshot recipe](../genesys-mcp-orchestrator/references/workflows.md#screenshot)) show `flatFrame: false` and no `subject_off_screen`. Read `metrics`, look at each image, fix the weakest aspect, at most 3 rounds.
- Each view looks intentional: readable landform, water, vegetation and sky; no plain-colour terrain; no blown or crushed exposure. On an existing scene, the gameplay cluster stands on the ground ([existing-scene.md](references/existing-scene.md)).
- Tell the user which recipe and seed you used and what you added.
