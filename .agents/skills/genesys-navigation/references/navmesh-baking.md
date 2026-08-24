# Navmesh Baking Details

## Bake parameters (`NavigationSettings` / `RecastNavigationServer.DEFAULT_OPTIONS`)

`NavigationSettings` (`.engine/src/navigation/NavigationSettings.ts`) is a `Resource` — the persisted, per-scene set of Recast build parameters. The editor's Generate NavMesh dialog and MCP `action_navmesh({ action: 'setSettings', ... })` write to it. `RecastNavigationServer.DEFAULT_OPTIONS` mirrors the same fields for the runtime bake path (`world.createNavigationMeshFromScene()`), so game code passing `overrideOptions` to `createNavigationMeshFromMeshes` uses the same property names.

| Property | Default | Meaning |
| --- | --- | --- |
| `cellSize` (`cs`) | `0.2` (settings) / `1` (server default) | Horizontal voxel size — smaller is more precise, slower to bake |
| `cellHeight` (`ch`) | `0.2` | Vertical voxel size |
| `walkableSlopeAngle` | `35` | Max walkable slope in degrees |
| `walkableHeight` | `2` (settings) / `1` (server default) | Min clearance height, in voxels for the server default |
| `walkableClimb` | `0.5` / `1` | Max climbable step height |
| `walkableRadius` | `0.5` / `1` | Agent radius — erodes walkable area from walls/ledges |
| `maxEdgeLength` (`maxEdgeLen`) | `12` | Max contour edge length before splitting |
| `maxSimplificationError` | `1.3` | Contour simplification tolerance |
| `minRegionArea` | `8` | Below this, small isolated regions are discarded. `RecastNavigationServer` squares this value before building regions — it is not the raw cell-area number in the settings UI |
| `mergeRegionArea` | `20` | Regions smaller than this get merged into neighbors. Also squared internally |
| `maxVertsPerPoly` | `6` | Max vertices per navmesh polygon |
| `detailSampleDist` | `6` | Detail mesh sampling distance |
| `detailSampleMaxError` | `1` | Detail mesh height sampling error tolerance |
| `borderSize` (settings only) | `0` | Extra border voxels around the tile |

Note the two default sources disagree on some values (`cellSize`/`walkableHeight`/`walkableClimb`/`walkableRadius`) — `NavigationSettings`'s defaults are the ones an editor-created scene actually starts with; `RecastNavigationServer.DEFAULT_OPTIONS` is what applies if you call the runtime bake path with no scene-level settings at all.

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

- Editor: Tools → Generate NavMesh dialog (or MCP `action_navmesh`) runs the same classification/bake pipeline against the currently open scene, then `export`s the result to a `.navmesh` binary referenced from scene resources (`World.setNavMeshResource`). This file is what ships with the game and is what `GameLoop` auto-imports on level load.
