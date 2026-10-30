# Export, runtime, bench and Assets row

The short procedure is in [SKILL.md → Build](../SKILL.md#build) and [Look at it](../SKILL.md#look-at-it). This file holds the export outputs, the runtime details, the hero pawn, the full bench steps, the Assets row, and the pipeline limitations and traps.

## Project setup

Set the `include` list in the project's `tsconfig.json` to the four base entries plus `"tools/**/*"`: `src/**/*`, `scripts/**/*`, `vite.config.ts`, `packs/*/src/**/*`, `tools/**/*`. An `include` there replaces the base list. `pnpm build` and `pnpm lint` then check the builders.

List each model in `tools/models/index.ts` (`MODELS: [{ file: 'sprout', build: buildSprout }]`). List only models the game spawns or the scene places; an unplaced variant is an unwired asset.

## Export

From the project root, run `pnpm exec tsx .agents/skills/genesys-code-modeling/scripts/export-glb.ts`. Use `--only sprout` for one model and `--dry` to preview. The script uses `tsx`, `@gltf-transform/*` and `sharp` from the SDK's devDependencies. It writes:
- `assets/models/<file>.glb` for each `MODELS` entry;
- `assets/textures/T_Palette.png`: one 8 px swatch per colour; every vertex's UV points at its swatch;
- `assets/textures/T_ToonRamp.png` from `TOON_BANDS` when a model uses `TOON`;
- `assets/materials/M_<Look>.material.json` for each look the models use;
- `tools/models/palette.json`: the swatch of every colour. Swatches keep their place between runs, so reordering `MODELS` or keeping a hand-edited GLB never shifts a colour. A new colour takes a free swatch. `--repack` lays the palette out from scratch and changes every GLB.

Each GLB material carries the engine's `GENESYS_material_overrides` extension (`.engine/src/utils/ResourceManager.ts`), so the engine swaps in `M_<Look>` on load, in the editor and in Play. The GLB also embeds the palette, so viewers and Blender show the right colours. Add `"@project/assets/materials"` and `"@project/assets/textures"` to `alwaysCopyAssets` in `.genesys-project`: only the GLBs reference them, and the build copies only paths it sees (`asset-check` fails without it). Run `asset-check`, then `buildProject`.

The code is the source of truth: each run overwrites every listed GLB. If the creator edits a GLB by hand, remove its entry from `MODELS` before the next export, and write that in `GAME.md` → Decisions.

## Runtime

A model the game animates is a `GAME` class that extends `GlbModel` (template).
- `GlbModel` extends `ENGINE.ModelMeshNode`. It loads the GLB, turns physics off and calls `onRigReady()` once the GLB is in place.
- Find pivots in `onRigReady()` with `part(name)`. Until then they are null, so guard every tick.
- `flash(seconds)` swaps in one shared white material. `setLook(mat)` swaps a shared tint. Both change every mesh, ink and glow included.
- `toonTint()` keeps the palette and ramp. Build each tint once and share it.

Source: .engine/src/nodes/visual/ModelMeshNode.ts (`onMeshLoaded`, `getAllMeshes`) — typechecked against 19.0.0-alpha.351
```ts
@ENGINE.GameClass()
export class SproutModel extends GlbModel {
  private head: THREE.Object3D | null = null;
  protected glbPath(): string {
    return '@project/assets/models/sprout.glb'; // one whole literal: the build copies only literal paths
  }
  protected onRigReady(): void {
    this.head = this.part('head');
  }
}
```

Other placements:
- **Static props** need no class. Place an `ENGINE.ModelMeshNode` with MCP, with `modelUrl` set to the GLB (`genesys-level-authoring`). Set `physicsOptions.enabled` to `false` (`PrimitiveNode` physics defaults to on, with a convex hull, so a prop without it blocks the player), and `castShadow`, `receiveShadow` and `static` to `true`.
- **Roots and collision.** If a model class stands alone in the scene, it sets `this.isRoot = true` in its constructor. If it dresses an enemy, pickup or pawn, it is a child; that owner is the root and carries collision (`genesys-engine`). Collision for a scene prop is its own node: a `MeshNode` with `selfHidden: true` and physics on, or a small `GAME` class that adds transient colliders.
- **Variants.** Build 2–3 variants of a repeated prop. Each variant is its own `MODELS` entry and GLB (`crate_0`, `crate_1`).
- **In the editor.** A placed GLB or `GlbModel` shows its rest pose. Tick starts at `beginPlay`, so motion shows only in Play.
- **Many copies.** If one model repeats dozens of times, use one instanced node ([recipes](recipes.md) → *Many copies*).

## The hero

A pawn wears the model in place of the mannequin. The pawn origin is the capsule centre, so lower the model by half the height. `GSSCharacterPawn` has the same two hooks.

Source: .engine/src/entities/CharacterPawn.ts (`setupVisualNode`, `setupAnimationNode`), .engine/src/const.ts (`CHARACTER_HEIGHT`) — typechecked against 19.0.0-alpha.351
```ts
@ENGINE.GameClass()
export class HeroPawn extends ENGINE.DefaultCharacterPawn {
  protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null {
    return null; // no skeletal clips: the model animates its own pivots
  }
  protected override setupVisualNode(): ENGINE.SceneNode | null {
    const body = SproutModel.create({
      name: 'Body',
      position: new THREE.Vector3(0, -ENGINE.CHARACTER_HEIGHT / 2, 0),
      scale: new THREE.Vector3().setScalar(1.3), // 1.34 m model → about 1.74 m hero
    });
    this.add(body);
    return body;
  }
}
```

## Bench: the full look steps

The parent runs these steps, because they build and change the editor. A worker that wrote the model reports it ready, and the parent looks. Before you open an image, state what it must show.

1. Run the export, `asset-check --prebuild`, `pnpm lint`, `pnpm build`, then `action_build(action="buildProject")`. For an animated model, confirm the class with `query_editor(getRegisteredClasses, filter="SproutModel")`.
2. Run `query_editor(getPlayModeState)`. If Play is running, look later; never stop the creator's Play.
3. On open floor near the spawn, add the model three times, 1.5 m apart, at yaw 0, π/2 and π: an `ENGINE.ModelMeshNode` with `modelUrl` the GLB and `physicsOptions.enabled` `false` (or `GAME.SproutModel` for an animated model). Add an `ENGINE.ModelMeshNode` with `modelUrl` `@engine/assets/character/mannequinG.glb` beside them as a 1.8 m scale reference.
4. `action_node(select, …)` the bench nodes, then `action_editor(frameSelection)`, then `action_editor(captureScreenshot, includeImage=true)`.
5. Label the image "editor capture (not Play)". Check it against the bar. Write each defect as a code with the thing and the image: `look.stand-in`, `look.shapeless`, `look.scale`, `look.facing`, `look.hovering`, `look.mixed-styles` (`genesys-verification` → [defect-codes](../../genesys-verification/references/defect-codes.md)).
6. Fix the builder and export again.
7. `action_scene(open)` the active scene. The editor keeps the old GLB in memory until the scene reloads.
8. If a colour is new or changed, check it in a Play capture. Play loads the new `T_Palette.png`; the editor keeps the old one until the creator reloads the project.
9. Capture again. Delete the bench nodes you added. Captures land in `.editor/captures/` (never shipped); copy kept ones to `.scratch/captures/`.
10. Prove motion and gameplay scale in Play: a smoke-step capture with the model moving next to the hero (`genesys-verification`).

## Assets row

A code model is one `GAME.md` Assets row with route `code` and its GLB as the Path:

```markdown
| Sprout enemy | code | @project/assets/models/sprout.glb | ~20 spawned | reads as a leafy sprout at 12 m; legs swing when it walks | landed |
```

A kit row lists every variant GLB. `asset-check` treats the GLB like any other asset: it fails a `wired` row that nothing references. It also fails a GLB whose linked material or texture is missing or outside `alwaysCopyAssets`.

Status moves `planned` → `landed` (the GLB exists and the bench screenshot was opened) → `wired` (the game spawns or places it, and it is seen: a Play capture for what the game spawns, an editor screenshot for a scene-placed prop). Only the parent edits the table (`genesys-assets`).

## Limitations

- If a soft colour gradient turns into jagged patches, the export gave each triangle one colour (a palette UV cannot blend). Shade each triangle from its centre in the builder, or add more triangles.

## Traps

- If the game loads but a model shows untextured grey or white, its material link broke: the GLB links a material or palette that does not exist. Run `asset-check` and export again. The build follows GLB material links itself, so `asset-check`'s "add its folder to `alwaysCopyAssets`" line for a material that exists is not the cause.
- If `part(name)` throws "missing pivot", no object in the GLB has that name. The export warns when two objects share a name, because the loader renames one. Give every pivot a unique name.
- If a class extending `GlbModel` fails to compile with "defines instance member property 'pivot'", a method is named `pivot`: `SceneNode` already has that property. Use `part()`.
- If a hand edit to a GLB vanished, the export overwrote it. Remove the model from `MODELS` once someone edits its GLB by hand.
- If `merge` throws, the parts have different attributes. Build every part with `part()`.
- If the outline cracks at corners, the hull was not welded. Build it with `inkHull()`.
- If a crowd costs frame time, the ink hulls double its triangles. Drop the hull on the crowd model first.
- If the whole model blooms, the base is above the bloom threshold. Keep glow on `GLOW` parts only (`genesys-lighting`).
- If the model ticks but no pivot moves, `onRigReady` never ran because the GLB did not load. Check the console for the GLB path.
