---
name: genesys-level-authoring
description: "Build the play space: Poly Builder, primitives, models, prefabs, packs, spline roads, CSG, voxels or a bulk layout file; instanced prop dressing; bounds, spawns, kill zones. Use for level, arena, track, map, room, street, town, road, greybox, set dressing, placing many props, too many draw calls from dressing. Not for outdoor terrain, islands, water, sky, fog, grass or forests (use `genesys-world-building`), lights (use `genesys-lighting`) or where a model comes from (use `genesys-assets`)."
metadata:
  tokens: 3464
---

# Level authoring

This skill picks the owner for every piece of the play space before any geometry is created, and sets the bar for when a space is done. The most important rule: the space is editor state. Build and change it through MCP or a layout file, prove it with queries, and never write the layout into `beginPlay`.

This skill owns the **space** (layout, rooms, routes, walls, bounds, spawn points, how repeated dressing is placed), not the **things in it**: each chest, door or enemy keeps its own Assets row (`genesys-assets`).

## Use another skill when
- Poly Builder boxes, stairs, ramps, mesh ops → `genesys-polybuilder`; the same hierarchy placed more than once or spawned → `genesys-prefabs`
- MCP availability gate, `run_script` / `batch_execute`, approvals → `genesys-mcp-orchestrator`
- Outdoor ground and look: terrain, islands, water, grass, forests, sky, sun, fog, exposure → `genesys-world-building` (a world recipe); lights, shadows, interior and night mood → `genesys-lighting` (scene nodes, not `GAME.md` Assets rows)
- Where a prop, kit piece or dressing model comes from → `genesys-assets`; building one in code → `genesys-code-modeling`
- Doors, lifts, moving platforms, pickups, triggers as gameplay → `genesys-interactions`; laps and reset-to-track → `genesys-vehicles`
- Navmesh → `genesys-navigation`; draw-call and collider budgets, the phone pass → `genesys-profiler`; camera → `genesys-camera`
- Editing the level in Blender → `genesys-blender-bridge`; packaging the kit → `asset-pack-authoring`

## Decide: which owner

One space can mix owners. Options, file paths and proofs for every class: [nodes](references/nodes.md).

| Need | Owner |
|---|---|
| Rooms, ground, stairs, ramps, platforms sculpted in the scene | `genesys-polybuilder` (proof: `query_polybuilder` bounds) |
| A box, sphere or other primitive prop | `ENGINE.MeshNode` / `PrimitiveNode` via MCP |
| The same hierarchy in several places, or spawned at runtime | `genesys-prefabs` (linked instance, not a hand-edited `.prefab.json`) |
| A model in `assets/`, `packs/` or `@engine/assets/models/` | `ENGINE.ModelMeshNode` via MCP, `modelUrl` the logical `@project/...` / `@engine/...` path |
| Fewer than about 30 placements | One `batch_execute` through MCP (`genesys-mcp-orchestrator`) |
| Dozens or more rule-based placements (streets, fence runs, tree lines, kit grids, rings) | A layout file → generated prefab (*Bulk placement*) |
| Hundreds of identical props in a built space (hedges, fences, rocks, lamps, lawn tufts) | `ENGINE.InstancedModelMeshNode` (*Instancing*); `InstancedMeshNode` for engine geometry |
| Outdoor ground: terrain, islands, water, grass, forests | `genesys-world-building` (`applyWorld` recipe: `TerrainMeshNode` with `GrassNode` and `ScatterNode` children, `WaterNode`) |
| Roads, paths, race loops | `ENGINE.SplineMeshNode`, `points` in a layout item; physics off by default, a drivable road needs `trimesh` |
| Solids with doorways, windows, arches cut in | CSG: `ENGINE.CSGCombiner` with cube, sphere and cylinder children (`add`/`subtract`/`intersect`) |
| Voxel props from MagicaVoxel | `ENGINE.VoxelMeshNode` (`voxPath`) |
| Invisible wall or blocker | `ENGINE.CollisionShapeNode` (size is the node scale) |

Search before building: `node .agents/skills/genesys-assets/scripts/asset-search.mjs <words> --type model` (engine, project and packs, with real sizes), and look at a model before placing it. If a result has a `card:` line (most projects have none), read the card (pivot, facing, how far to raise it, stand-on height) and, before dressing a space from that pack, the Pack notes in the `ASSETS.md` search names (pack scale, front direction): `genesys-assets` → routes → Asset cards. Engine kits (dungeon, foliage, rocks, trees, clouds) are under `@engine/assets/models/demo/`: [engine-assets.md](references/engine-assets.md).

## Decide: space defaults by game type

When the user did not say, use the game type's row in [space-defaults.md](references/space-defaults.md): footprint, key dimensions, spawn, camera, bound and dressing priority. Sizes are metres (the engine character is ~1.8 m); e.g. a twin-stick arena is a 40–60 m floor with 4–8 cover props and a code clamp.

## Bounds: pick the mechanism

A bound must stop the player leaving the playable space, and the player must be able to read it.

| Mechanism | Fits | Does not fit |
|---|---|---|
| **Collider walls** (physics Poly Builder pieces, `MeshNode`s, `CollisionShapeNode`s) | First/third person, physics or GSS movement, walled rooms and arenas | Open top-down fields where walls hide the view |
| **Code clamp** of the pawn's position in its tick | Top-down and twin-stick arenas, side-scroller depth lock, fixed cameras, non-physics pawns | Physics-body or GSS pawns (a position write fights them) |
| **Kill volume** (`TriggerZoneNode`, `playerOnly`) → fail or respawn | Falling off platforms, water, lava, the void, leaving a track | The only edge of a flat arena (the player dies for walking) |

Combine them: a platformer has collider walls on its rooms and a kill volume below. Every mode also needs a cleanup bound for projectiles and enemies (despawn beyond the play rect). A kill volume is a small `GAME` class on `TriggerZoneNode` placed with MCP, `filter: playerOnly`, sized by scale ([nodes → Kill volume](references/nodes.md#kill-volume)).

## Bulk placement

Each MCP mutation costs about 0.6 s (a placed node about 1.2 s), so a few hundred nodes take minutes and long scripts hit the MCP client's 300 s timeout. When the placements follow rules, write a layout file instead and build it from the game project root:

```bash
node .agents/skills/genesys-level-authoring/scripts/layout.mjs build levels/street.layout.json
```

It expands repeats, rings, mirrors and seeded jitter into one generated prefab with stable ids, which MCP places once (`action_prefab` `instantiate`, then `action_scene(save)`: about 0.2 s for 300 nodes). Edit the layout and build again to iterate; placed instances reload. Hand edits go through the Prefab Editor, then `layout.mjs pull`; `unlink` hands the nodes to the scene for good. Items may be other engine classes (a `SplineMeshNode` road). Format, loop, hand edits: [layouts.md](references/layouts.md); worked layouts: [examples/](examples/).

Use MCP directly for a handful of nodes or for edits to existing ones. Gameplay nodes the code finds by class (spawners, kill volumes, triggers) stay ordinary MCP-placed nodes.

## Instancing

On terrain, grass is one `GrassNode` and plants are seeded `ScatterNode` children (`genesys-world-building`); this section is for props in a built space. Every separate `ModelMeshNode` costs at least one draw call per mesh in its model; a 416-node backyard came to about 1,800 draw calls on a phone target.

1. **More than ~10 copies of one model as dressing → one instanced node.** In a layout, `"instanced": true` on the item or group; `layout.mjs build` prints a `HINT` for every model still placed more than 10 times.
2. **Colliders only where gameplay needs them.** Grass, flowers, pebbles, distant trees: `physics: false`. Hedges and fences the pawn must not cross: `boundingBox`. Instanced nodes build one body per instance.
3. **No shadows on small scatter** (grass, flowers, pebbles, floor tiles); keep them on trees, hedges and buildings.
4. **Far copies:** `cullDistance` (metres, 0 = off) hides instances; `lods` (`[{ modelUrl, distance }]`) swap in lower-detail GLBs.
5. **Off-centre pivots:** the engine culls each instance with a sphere around its pivot, so corner-pivot kit pieces (walls, floor tiles) and tall bottom-pivot models vanish while still on screen. Set `"props": { "perInstanceFrustumCulling": false }` on those items; `layout.mjs build` prints a `HINT` naming them.
5. Keep separate nodes (`"instanced": false`) for props gameplay code finds one by one, or that need their own prefab overrides.

Runtime scatter from code: [nodes → Runtime scatter](references/nodes.md#runtime-scatter-from-code).

## Build

1. **Blockout first.** Floor, bounds, spawn point and the main route as Poly Builder pieces or primitives with the engine grid materials `@engine/assets/materials/M_Floor.material.json` and `M_Wall.material.json`. Label it blockout in the report and `GAME.md`.
2. **Make it collide.** Poly Builder pieces start with physics off: enable it on every piece the pawn stands on or bumps into. `MeshNode` and `ModelMeshNode` default to static physics on; `SplineMeshNode` to off. Pieces with openings (arches, door frames) need `trimesh`.
3. **Spawn point** on the floor, facing into the space, ≥ 2 m from props.
4. **Dress.** Replace or cover the pieces the player reads up close with the kit and props from the Assets table (`genesys-assets`), as `ModelMeshNode`s with physics only where the pawn touches. Repeated pieces become prefabs; rule-based runs become a layout (*Bulk placement*), instanced when one model repeats (*Instancing*).
5. **Light** through `genesys-lighting`; a level is not presentable under the default single light.
6. **Save** with `action_scene(save)`, then re-query what you changed (material and colour edits can read back fine and still not persist; `genesys-mcp-orchestrator`).

A colour or material on an existing node is an MCP edit too. If the first Genesys MCP server fails, probe the other configured Genesys servers before any code fallback. Keep one copy of the level, the scene: `genesys-blender-bridge` mirrors it and pushes reviewed edits back; it is not a second world.

## Blockout versus finished

A primitive or Poly Mesh blockout is the right first pass for a space; a blockout room with finished props reads better than a finished room full of boxes. A cone, box, sphere or octahedron used as a hero, enemy or vehicle is a blockout until a model from its Assets row replaces it (`genesys-assets`; the enemy version is in `genesys-creatures`). A box called a crate is still a blockout.

## Installed packs

Packs live in `packs/<id>/` (`config.json`, `src/`, `assets/`); runtime paths are `@project/packs/<id>/assets/...`, `<id>` being the folder name. Catalog packs install from the editor UI (Browse Asset Packs); `action_asset(installAssetPack)` only scaffolds an empty pack. Packs can ship broken material paths (a wrong pack id, or the game's `assets/textures/`), so props render untextured with `Failed to load texture`: [packs.md](references/packs.md).

## Bugs

- Pawn falls through the floor → Poly Builder pieces have physics off → enable physics on the pieces (`genesys-polybuilder`).

## Traps

- Car falls through a spline road → `SplineMeshNode` physics is off by default → `"physics": "trimesh"` in the layout item, or `physicsOptions` `{ enabled: true, collisionMeshType: "trimesh" }`.
- Pawn walks out of the arena → no bound for this camera type → pick a mechanism from the bounds table.
- Player dies when touching the arena edge → a kill volume used as the only edge of a flat arena → use colliders or a clamp.
- Concave floor or stair collides like a solid block → convex-hull collision → `collisionMeshType: trimesh` on static concave pieces.
- Invisible wall the wrong size → a `CollisionShapeNode` is sized by its node scale; scale the node.
- `Failed to load texture` in the console → a material path that does not exist, often from a pack → [packs.md](references/packs.md). Do not invent a pack id.
- Layout appears only in Play → the level was built in `beginPlay` → rebuild it with MCP as scene nodes.
- Model sits under `assets/` but is not in the level, or one default grid and nothing else → nothing placed it; a file is not in the level until MCP adds it.
- Hundreds of nodes placed one `action_node(add)` at a time, timing out half-way → write a layout file (*Bulk placement*).
- Phone frame rate collapses with hundreds of separate nodes of the same few models → instance them (*Instancing*), drop colliders and shadows on scatter.
- Instanced walls or floor tiles pop out when their corner goes behind the camera → per-instance culling tests a sphere around the pivot, not the model → `"props": { "perInstanceFrustumCulling": false }` on the item (*Instancing* step 5).
- Hand edits on a generated layout vanished → they were made on the placed instance → edit in the Prefab Editor, then `layout.mjs pull`. More layout traps: [layouts.md](references/layouts.md#traps).

## Done

- `query_polybuilder` / `query_node` show the floor, every bound, and the spawn point at the intended positions; the scene is saved and re-queried.
- In Play, the pawn stands on the floor, cannot leave the space, and every kill volume respawns or ends the run.
- No `Failed to load texture` lines in the console.
- No model is placed more than ~10 times as separate dressing nodes (`layout.mjs build` prints no `HINT`); small scatter has no collider and no shadow.
- Props the player reads up close are models or dressed meshes, or they are reported as blockout with the reason.
- Lighting was set through `genesys-lighting`, and a capture (`genesys-verification`) reads clearly.

## References
- [nodes.md](references/nodes.md) — every owner with class options and proof, the kill-volume class, runtime scatter from code
- [space-defaults.md](references/space-defaults.md) — sizes, spawn, camera and bound per game type
- [layouts.md](references/layouts.md) — layout format, loop, hand edits, instancing, other engine nodes, traps
- [engine-assets.md](references/engine-assets.md) — `@engine/assets` for blockout and dressing; [packs.md](references/packs.md) — pack layout and broken material paths
- [scripts/layout.mjs](scripts/layout.mjs) — layout → prefab generator; [examples/](examples/) — `arena.layout.json` (engine models, instanced grass), `street.layout.json` (illustrative, placeholder models)
