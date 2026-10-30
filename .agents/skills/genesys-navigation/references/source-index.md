# Navigation source index

Paths are relative to `.engine/src/`.

| File | Contents |
| --- | --- |
| `navigation/index.ts` | Barrel export |
| `navigation/NavigationServer.ts` | `INavigationServer`, `NavigationEngine`, `NavigationOptions`, `NavigationClosestPointOptions`, `NavigationMeshGenerationInput`, `createNavigationServer()` |
| `navigation/RecastNavigationServer.ts` | The only backend: bake, query, debug viz, export/import, `DEFAULT_OPTIONS` |
| `navigation/NavigationSettings.ts` | Persisted per-scene Recast bake parameters (Resource) |
| `nodes/PrimitiveNode.ts` | `NavigationRole` enum (`Walkable`, `Obstacle`, `Exclude`), `navigationGeometryRole` property |
| `nodes/movement/NpcMovementNode.ts` | Path-following consumer (`setPath`, `setTargetPosition`, `setTargetActor`, `canUseNavigationServer`) |
| `entities/AIController.ts` | Second consumer of the same server (controller-based path following for GSS pawns) |
| `game/World.ts` | `createNavigationMeshFromScene()`, `exportNavigationMesh`, `importNavigationMeshFromData`, `setNavMeshResource` and scene navmesh resource getters |
| `game/GameLoop.ts` | `navigationServer` getter, `ensureNavigationServer`, level-load navmesh settings and import, `generateOnStartUp` bake at Play |
| `npc/behavior-tree/behaviors/actions/utility/CalculateTacticalPositionAction.ts` | Tree action that snaps a tactical point to the navmesh |

`NavigationServer.ts` also declares `PathFollowingOptions`, `DEFAULT_PATH_FOLLOWING_OPTIONS` (`waypointThreshold` 0.5, `looped` false, `speed` 1.0), and `NavigationQueryResult` (`{ path, complete }`), which `calculatePathResult` returns. `calculatePath` returns only the points.
