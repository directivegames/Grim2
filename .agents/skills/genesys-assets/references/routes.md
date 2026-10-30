# Routes in detail

The route order, art-routes rule and style rule are in [SKILL.md](../SKILL.md#routes). This file holds the full per-role defaults, the search details, and the needs that have no route yet.

## Searching for reuse

```bash
node .agents/skills/genesys-assets/scripts/asset-search.mjs <words> [--type model|texture|audio|prefab|material|font|svg]
.agents/skills/genesys-blender-modeling/scripts/blender.sh sheet <@engine/... or @project/...>
```

Search prints real sizes in metres (skinned models in their rest pose), triangles, clip names, and whether a rig uses `mixamorig` bones (the engine clips play on it). If Blender is installed, `sheet` renders four views to `.scratch/blender/sheets/<engine|project>.<name>.png`. If it is not, place the model in the scene and take an editor screenshot. Look before you choose. A name match is not a fit until you have looked.

### Asset cards

Most projects have none. A folder has asset cards only if a developer ran the `mesh-classifier` dev tool on it: then each GLB has a `<Name>.md` card (~400 tokens; not the [first-asset-card](first-asset-card.md) checklist), a `<Name>.jpg` render and a `<Name>.detail.md`, and the folder or pack has an `ASSETS.md` index. Search prints a `card:` line under a carded model and names its index. With no `card:` lines, nothing here applies: search, then look, as above.

- **Dressing a space from a carded pack**: read the `ASSETS.md` search names, one row per asset. Its *Pack notes* hold the rules for every piece: the pack's real scale, which way fronts face, pivots that sink, modular sets and recipes.
- **Before placing a carded model**: read its card. The front matter and *Use it* rules give size, pivot, facing, how it sits (and how far to raise it), collision, what you can stand on, and what it goes with. The `.jpg` render counts as looking; you do not need a sheet or screenshot to choose it.
- Read only the cards you pick. Never read `.detail.md` to choose; it is raw measurements for debugging. A card marked `interpretation: pending` has measured facts but no judgement: trust the numbers and look at the render yourself.
- Use cards; do not run the classifier or write cards during a game build.

## Default route by role

| Role | Default | Notes |
|---|---|---|
| Player body, humanoid or animal | Code model with procedural motion: limb pivots swing with speed, idle bob, squash on landing (`genesys-code-modeling`) | Stylised and chibi bodies read well this way. If the creator wants real walk and run cycles, ask once: Blender on the mannequin rig plays the engine clips (`genesys-blender-modeling` → *Rigged characters*). The bare mannequin is a blockout. |
| Player body, not a person (ship, car, ball, drone, mech) | Code model | |
| Enemies and NPCs, any body plan | Code model with procedural motion (bob, squash, lunge, lean, limb swing) in the enemy class | `genesys-creatures` for behaviour. A sphere is a blockout; a slime has a face, a highlight, a squashed base. The spider (`SKM_Arachnids_Large_Spider`) is a reuse option with real clips. |
| Architecture: walls, floors, arches, pillars, stairs, houses | Reuse the engine kit when its style fits; else code pieces or Poly Builder (`genesys-level-authoring`) | Never mix two kit families in one space. |
| Props the player handles or gets close to: chest, door, lever, crate, barrel, torch | Code model (or an engine match) | These carry the game's identity; spend effort here. |
| Pickups: coin, potion, key, gem, heart, ammo | Code model | Small, bright, readable silhouette from the gameplay camera. |
| Background dressing: rocks, trees, foliage, rubble | On outdoor terrain: `ScatterNode` species (realistic, stylized, lowpoly) and one `GrassNode` (`genesys-world-building`). In a built space: reuse engine `LowPoly/` and `SandboxAsset/`, or code pieces, instanced (`genesys-level-authoring`) | Instance scale is fine for reused engine dressing. |
| Title art | The game's own scene, live, behind the title card: the hero framed by the title camera (`genesys-game-boot`, `genesys-ui`) | It matches the game because it *is* the game. A separate title image only when the creator asks. |
| Icons (HUD, inventory, spells) | Inline SVG drawn in the HUD style (`genesys-ui` → custom HUD), or `ENGINE.Icons` for generic glyphs | Built in code, so no image file blocks `buildProject`. |
| Surfaces | The palette texture and look materials of code models (`genesys-code-modeling`); engine materials for spaces (`asset-search stone --type material`) | |
| Terrain ground | A `scene` row: `TerrainMeshNode` `colorMode: "layers"` (procedural or CC0 photo-scan layers in the world style; `genesys-world-building`) | |
| Sky, sun, fog | A `scene` row: an outdoor recipe or environment preset, stylised skies through the recipe `sky.tint` or a world style (`genesys-world-building`); otherwise `SkyNode` / `SceneEnvironmentNode` (`genesys-lighting`) | |
| Music bed, SFX | Engine sounds where they fit (`asset-search --type audio`); otherwise `synth.mjs` (`genesys-audio`) | The engine ships no music. |

## Style families

Reused families must match the style: `SandboxAsset` is stylised low-poly with painted textures; `LowPoly` is flat-shaded. Pick one family per space and build the rest in code to match it. The shading style (flat, toon with outlines, soft) follows **Art direction** (`genesys-code-modeling` → Looks). Large near-white surfaces clip to white under the engine's sun (a `#f6f1e5` path did); the Blender runner warns.

## Gaps: needs with no route yet

| Need | Best current substitute |
|---|---|
| Attack, hit and death motion | Procedural on code models: a 0.15 s lunge or recoil tween, a scale pop, a launch-and-tumble death plus VFX (`genesys-code-modeling`, `genesys-game-feel`, `genesys-creatures`); the spider ships real Attack/Hit/Death clips |
| Real skeletal clips (walk cycles with knees and feet) | Blender on the mannequin rig, when the creator asks (`genesys-blender-modeling`) |
| VFX sprites and flipbooks | Particle definitions with engine textures (`genesys-vfx`) |
| Fonts, logos, wordmarks, UI frames | A web font and CSS or SVG in the HUD style (`genesys-ui` → custom HUD) |
| Seamless ambience loops, stingers, voice | `synth.mjs` beds and one-shots (`genesys-audio`); engine sounds; no voice |
| Collision proxies | `ModelMeshNode` static collision, `collisionMeshType: trimesh` for openings; a hidden primitive for simple shapes |
| LODs | Keep under the role budget; instance repeated dressing (`genesys-level-authoring`) |
