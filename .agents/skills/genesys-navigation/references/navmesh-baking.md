# Navmesh Baking Details

## Bake parameters (`NavigationSettings` / `RecastNavigationServer.DEFAULT_OPTIONS`)

`NavigationSettings` (`.engine/src/navigation/NavigationSettings.ts`) is a `Resource` — the persisted, per-scene set of Recast build parameters. The editor's Generate NavMesh dialog and MCP `action_navmesh({ action: 'setSettings', ... })` write to it. `RecastNavigationServer.DEFAULT_OPTIONS` mirrors the same fields for the runtime bake path (`world.createNavigationMeshFromScene()`), so game code passing `overrideOptions` to `createNavigationMeshFromMeshes` uses the same property names.

| Property | Default | Meaning |
| --- | --- | --- |
| `cellSize` (`cs`) | `0.2` (settings) / `1` (server default) | Horizontal voxel size — smaller is more precise, slower to bake |
| `cellHeight` (`ch`) | `0.2` | Vertical voxel size |
| `walkableSlopeAngle` | `35` | Max walkable slope in degrees |
| `walkableHeight` | `2` m (settings) / `1` voxel (server default) | Min clearance height |
| `walkableClimb` | `0.5` m / `1` voxel | Max climbable step height |
| `walkableRadius` | `0.5` m / `1` voxel | Agent radius — erodes walkable area from walls/ledges |
| `maxEdgeLength` (`maxEdgeLen`) | `12` | Max contour edge length before splitting |
| `maxSimplificationError` | `1.3` | Contour simplification tolerance |
| `minRegionArea` | `8` | Below this, small isolated regions are discarded. `RecastNavigationServer` squares this value before building regions — it is not the raw cell-area number in the settings UI |
| `mergeRegionArea` | `20` | Regions smaller than this get merged into neighbors. Also squared internally |
| `maxVertsPerPoly` | `6` | Max vertices per navmesh polygon |
| `detailSampleDist` | `6` | Detail mesh sampling distance |
| `detailSampleMaxError` | `1` | Detail mesh height sampling error tolerance |
| `borderSize` (settings only) | `0` | Extra border voxels around the tile |

**Units.** `NavigationSettings` stores the three agent fields in metres; `toRecastOptions()` converts them for every bake that uses the scene settings (editor Generate, Play-time `generateOnStartUp`): height and radius ÷ cell size rounded up, climb ÷ `cellHeight` rounded down. Recast itself, and so `RecastNavigationServer` options set in code, takes voxel counts. For the engine mannequin (1.8 m tall, 0.45 m capsule radius, 0.4 m step) at `cellSize` = `cellHeight` = 0.2 that is `walkableHeight` 9, `walkableClimb` 2, `walkableRadius` 3 voxels. Check the wall gap in the debug view after a bake.

Note the two default sources disagree on some values (`cellSize`/`walkableHeight`/`walkableClimb`/`walkableRadius`) — `NavigationSettings`'s defaults are the ones an editor-created scene actually starts with; `RecastNavigationServer.DEFAULT_OPTIONS` is what applies to a runtime bake in a scene with no saved settings file. Once the editor has baked a scene, its settings file (`<scene>.navmsettings.json`) exists, and the game applies it to the navigation server when the level loads, so a runtime bake uses the same settings as the editor bake. Each level starts from the defaults again.

## What contributes to the bake

`World.createNavigationMeshFromScene()` (`.engine/src/game/World.ts`) is the exact logic both the runtime path and (indirectly) the editor dialog rely on. It:

1. Collects all `ModelMeshNode`, `MeshNode`, and `BaseInstancedMeshNode` instances under every root node in the world.
2. Filters to nodes whose physics `motionType` is `PhysicsMotionType.Static` and whose `navigationGeometryRole` is not `NavigationRole.Exclude`. Anything `Dynamic`/`Kinematic`, or explicitly excluded, never reaches the bake.
3. Buckets the remaining meshes by `getNavigationGeometryRole()`:
   - `NavigationRole.Walkable` (default) → walkable surface contributor.
   - `NavigationRole.Obstacle` → rasterized as non-walkable but still blocks the mesh (walls, static clutter you should path around but never walk on).
   - `NavigationRole.Exclude` → skipped entirely (already filtered above).
4. For `ModelMeshNode`/instanced GLTF sources, awaits any in-flight cached model loads first — call this after your static content has finished loading, not immediately on level start.
5. Calls `navigationServer.createNavigationMeshFromMeshes({ walkableMeshes, obstacleMeshes })`, which deinterleaves geometry, snapshots world transforms, and runs the full Recast solo-navmesh pipeline (heightfield → compact heightfield → regions → contours → poly mesh → poly mesh detail → `NavMesh`).

If both `walkableMeshes` and `obstacleMeshes` end up empty (nothing static and role-eligible in the world), the bake logs a warning and does nothing — it does not throw.

## Editor bake vs. runtime bake

- Both use the scene's saved `NavigationSettings`, converted with `NavigationSettings.toRecastOptions()`: the editor when you bake, the game when the level loads (`GameLoop`). Settings changed in the dialog reach a runtime bake only after they are saved, which every editor bake does.

- Editor: Tools → Generate NavMesh dialog (or MCP `action_navmesh`) runs the same classification/bake pipeline against the currently open scene, then `export`s the result to a `.navmesh` binary referenced from scene resources (`World.setNavMeshResource`). This file is what ships with the game and is what `GameLoop` auto-imports on level load.

## Engine notes

- `createNavigationMeshFromScene()` **throws** `Navigation server not created` when `world.gameLoop?.navigationServer` is missing. Guard for the server before calling it from game code.
- The `Static` filter reads each mesh node's **own** `physicsOptions.motionType`. A `MeshNode` that only contributes to a parent's compound collider and has no `motionType` of its own is skipped. Give level geometry its own `Static` physics, or check with `toggleDebug` that it appears in the bake.
- A `MeshNode` whose mesh was collapsed out of the scene graph has its world matrix copied onto the mesh before the bake, so collapsed geometry still bakes in the right place.
- `navigationOptions.generateOnStartUp` (default `false`) builds the navmesh from the scene when entering play mode, after `preStart`, with the scene's saved settings. The level then does not import the baked `.navmesh` file. Use it when `preStart` spawns static geometry the editor bake cannot see; otherwise leave it off and ship the editor bake.
- `NavigationOptions` (`NavigationServer.ts`): `engine` (`NavigationEngine.RecastNavigation` or `NavigationEngine.Disable`), `debug`, `options` (passed to the backend), `generateOnStartUp`.

## Traps

- NPCs suddenly walk in straight lines → `clearNavigationMesh()` flipped `isReady()` false and destroyed the WASM `NavMesh`/`NavMeshQuery`; NPCs mid-path fall back to direct lines → do not clear while NPCs path unless intended.
- Moving platforms or physics props missing from the bake → only `Static` motion types contribute; `Dynamic`/`Kinematic` never do, whatever their role.
- Runtime bake is empty or misses models → it ran before `ModelMeshNode` loads finished, or before the level was placed → bake after content loads; the bake awaits in-flight cached model loads but cannot wait for nodes not yet added.
- Agent squeezes through 0.4 m gaps or the mesh hugs walls at 0.1 m → server options set in code were given in metres, which Recast reads as voxels → convert (*Bake parameters* → **Units**) and re-bake, or bake through the scene settings, which take metres.
