---
name: genesys-navigation
description: Genesys navmesh, pathfinding, and NPC path queries — NavigationServer, RecastNavigationServer, navmesh baking, calculatePath. Use for navigation, pathfinding, navmesh, NPC pathing, AI navigation, or path-following setup. Not for movement-node/pawn mechanics (see genesys-movement) or behavior-tree AI logic (see behavior-tree).
---

# Navigation & Pathfinding

Genesys pathfinding is a single `INavigationServer` interface (`.engine/src/navigation/NavigationServer.ts`) backed by one implementation, `RecastNavigationServer` (`.engine/src/navigation/RecastNavigationServer.ts`), which wraps `recast-navigation` / `@recast-navigation/core`. The server lives on the session game loop, not the world: `world.gameLoop?.navigationServer`. It holds at most one baked navmesh at a time; there is no per-region or multi-tile navmesh API.

Read the source above for exact signatures — this skill maps what exists and the pitfalls that aren't obvious from the types.

## What's available

- Access: `world.gameLoop?.navigationServer` (may be `null` before the session subsystems are created, or after `destroy()`). Always guard for `null` and call `isReady()` before querying — never assume a navmesh exists just because the server does.
- Baking (editor): Tools → Generate NavMesh dialog, or MCP `action_navmesh` (`generate`, `export`, `import`, `clear`, `setSettings`, `toggleDebug`) / `query_navmesh` (`getInfo`, `getSettings`). Bake parameters are the `NavigationSettings` resource (`.engine/src/navigation/NavigationSettings.ts`). See the `genesys-editor-manual` and `genesys-mcp-orchestrator` skills for dialog/tool mechanics — not duplicated here. Details on the parameters and how source meshes are classified: [references/navmesh-baking.md](references/navmesh-baking.md).
- Baking (runtime/code): `await world.createNavigationMeshFromScene()` scans static geometry in the world and calls `navigationServer.createNavigationMeshFromMeshes(...)`. Use this for procedurally generated levels, after your static geometry is placed and before any NPC needs a path. See the reference doc for exactly which nodes/roles contribute.
- Persistence: an editor bake exports to a `.navmesh` binary referenced by scene resources; `GameLoop` auto-imports it on level load and only falls back to `createNavigationMeshFromScene()` if `navigationOptions.generateOnStartUp` is `true` and no baked file is found.
- Readiness: `navigationServer.isReady()` — `true` only once a navmesh has been set (bake+import or `createNavigationMesh*`). Everything below silently no-ops or returns an empty/failed result when not ready.
- Point queries:
  - `isPointOnNavigationMesh(point)` — `true` only if the point is directly over a poly.
  - `getClosestPointOnNavigationMesh(point, { halfExtents?, maxSnapDistance? })` — snaps to the nearest poly; returns a clone of `point` unchanged if the query fails or the snap exceeds `maxSnapDistance` (never silently jumps to an unrelated poly).
  - `getRandomReachablePoint(center, radius)` — random point on the navmesh within `radius` of `center`, or `null` if none found (wander/patrol targets).
- Path query: `calculatePath(start, end): THREE.Vector3[]` — snaps both points to their nearest poly internally and returns the straight path. Returns `[]` if either point has no nearby poly, or if the underlying query fails.
- Debug visualization: `createDebugVisualization(): THREE.Group | null` — add the returned group to the scene yourself; already sanitized for WebGPU (no `LineSegments2`/point instancing).
- Export/import: `exportNavigationMesh(scenePath)` / `importNavigationMesh(scenePath)` / `importNavigationMeshFromData(buffer)` — binary round-trip, used by the editor bake dialog and level load; rarely called directly from gameplay code.

## Feeding a path to an NPC

`NpcMovementNode` (`.engine/src/nodes/movement/NpcMovementNode.ts`) is the usual consumer. It fetches `world.gameLoop?.navigationServer` itself in `beginPlay`, so you don't need to pass it in. Two ways to drive it:

- `mover.setTargetPosition(target)` — the node queries the navigation server itself (snap-to-mesh + `calculatePath`) and follows the result. Simplest option.
- `mover.setPath(points, looped?)` — feed a path you computed yourself (e.g. `calculatePath` output, or a custom waypoint list). Use this when you need to inspect/modify the path before the NPC follows it.

`canUseNavigationServer()` reports whether the node will actually path (requires `useNavigationServer` option, a live server, and `isReady()`); when false it falls back to a straight line to the target. Movement tuning (speed, turning, stop distance, actor-follow, look-at) is `NpcMovementNode`/`AIController` territory — see `genesys-movement`, not this skill.

## Footguns

- No partial-path signal. `calculatePath` returns a bare `THREE.Vector3[]` with no completeness flag, so a non-empty path is not guaranteed to reach your exact `end` — only the nearest reachable point the query found. Compare the last path point's distance to `end` yourself if you need to detect a short or partial route.
- Empty array is silent failure, not an exception. Querying before `isReady()`, or with points that have no nearby poly, logs a `console.error` and returns `[]` — it never throws. Treat `[]` from `calculatePath` as "no path," not as "engine error."
- Navmesh is a static snapshot. It reflects geometry at bake/`createNavigationMeshFromScene()` time only. Moving, adding, or removing static geometry afterward does not update it — there is no dynamic re-carve. Re-bake (editor) or re-call `createNavigationMeshFromScene()` (runtime) after layout changes.
- No live dynamic obstacles. Recast builds one solo `NavMesh` from a single mesh snapshot; there's no runtime obstacle add/remove or tile-rebuild API. Moving hazards, closing doors, etc. are never carved out automatically — handle avoidance at the gameplay layer (behavior-tree conditions, custom target selection), not the navmesh.
- `clearNavigationMesh()` flips `isReady()` false immediately, destroying the underlying WASM `NavMesh`/`NavMeshQuery`. Any NPC mid-path falls back to a direct line to its last target until the mesh is rebuilt — don't clear the navmesh while NPCs are actively pathing unless you intend that.
- Only static geometry contributes. `createNavigationMeshFromScene()` only gathers meshes on nodes whose physics `motionType` is `Static`; `Dynamic`/`Kinematic` geometry never contributes, even if its `navigationGeometryRole` is set.
- Default role is `Walkable`. Every `PrimitiveNode` defaults `navigationGeometryRole` to `NavigationRole.Walkable` when unset. Walls/props you want to block pathing through need `NavigationRole.Obstacle`; geometry you don't want in the bake at all (e.g. decorative overlays) needs `NavigationRole.Exclude` (the legacy `excludeFromNavigation = true` maps to `Exclude`).

## Minimal example

```typescript
import * as ENGINE from '@gnsx/genesys.js';
import { NpcMovementNode } from '@gnsx/genesys.js';
import * as THREE from 'three';

/** Periodically sends the owning NPC to a random reachable point nearby. */
@ENGINE.GameClass()
export class WanderNode extends ENGINE.SceneNode {
  private repathTimer = 0;
  private readonly wanderRadius = 15;

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this.repathTimer -= deltaTime;
    if (this.repathTimer > 0) {
      return;
    }
    this.repathTimer = 2;

    const navigationServer = this.getWorld()?.gameLoop?.navigationServer;
    const mover = this.getNode(NpcMovementNode);
    if (!navigationServer?.isReady() || !mover) {
      return; // no navmesh yet, or this node has no NpcMovementNode sibling
    }

    const origin = this.getWorldPosition();
    const target = navigationServer.getRandomReachablePoint(origin, this.wanderRadius);
    if (!target) {
      return; // no reachable point found this attempt, try again next timer tick
    }

    const path = navigationServer.calculatePath(origin, target);
    if (path.length === 0) {
      return; // unreachable right now — keep following whatever path is already set
    }

    mover.setPath(path);
  }
}
```

## Source index

| File | Contents |
| --- | --- |
| `navigation/index.ts` | Barrel export |
| `navigation/NavigationServer.ts` | `INavigationServer`, `NavigationEngine`, `NavigationOptions`, `createNavigationServer()` |
| `navigation/RecastNavigationServer.ts` | The only backend: bake, query, debug viz, export/import |
| `navigation/NavigationSettings.ts` | Persisted per-scene Recast bake parameters (Resource) |
| `nodes/PrimitiveNode.ts` | `NavigationRole` enum, `navigationGeometryRole` property |
| `nodes/movement/NpcMovementNode.ts` | Path-following consumer (`setPath`, `setTargetPosition`, `canUseNavigationServer`) |
| `game/World.ts` | `createNavigationMeshFromScene()`, `exportNavigationMesh`, `importNavigationMeshFromData`, scene navmesh resource getters/setters |
| `game/GameLoop.ts` | `navigationServer` getter, `ensureNavigationServer`, level-load navmesh import/fallback |
| `entities/AIController.ts` | Second consumer of the same server (`Controller`-based NPC path following) |
