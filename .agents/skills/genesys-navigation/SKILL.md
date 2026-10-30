---
name: genesys-navigation
description: "Navmesh baking, pathfinding, path queries (RecastNavigationServer, calculatePath), agent size, and click-to-move. Use for navigation, navmesh, AI pathing, pathfinding not working, NPCs walk through walls or need to walk around walls, navmesh missing, click to move, point-and-click movement. Not for pawn movement tuning (use `genesys-movement`) or when to chase or patrol (use `behavior-tree`)."
metadata:
  tokens: 2723
---

# Navigation and pathfinding

Genesys pathfinding is one `INavigationServer` (`.engine/src/navigation/NavigationServer.ts`) implemented by `RecastNavigationServer` (wrapping `recast-navigation`). The server lives on the game loop, not the world: `world.gameLoop?.navigationServer`. It holds at most one baked navmesh; there is no per-region or multi-tile API. The rule: **guard for `null`, check `isReady()`, and treat an empty path as "no path".**

## Use another skill when
- How an NPC follows the path (speed, turning, stop distance, look-at) → `genesys-movement`
- When to chase, flee, or patrol → `behavior-tree`
- Which enemies need a navmesh at all → `genesys-creatures`
- Building the level geometry that gets baked → `genesys-level-authoring`
- The Generate NavMesh dialog by hand → `genesys-editor-manual`
- MCP call mechanics (`action_navmesh`, `query_navmesh`) → `genesys-mcp-orchestrator`
- Cursor visibility, pointer lock and the fixed camera a click-to-move game needs → `genesys-camera`
- Raycast options and collision profiles beyond the click ray → `genesys-physics`

## Decide

| Situation | Default |
|---|---|
| Hand-built level in the editor | Bake in the editor (MCP `action_navmesh` `generate`, then `export`). It ships as a `.navmesh` file and auto-loads. |
| Procedural or runtime-built level | `await world.createNavigationMeshFromScene()` after static geometry is placed and models have loaded, before any NPC needs a path. |
| Open arena with no obstacles | No navmesh. `NpcMovementNode` falls back to straight lines. |
| Shmup, bullet hell, pattern enemies | No navmesh (`genesys-creatures`). |
| Walls and props NPCs must go around | `NavigationRole.Obstacle` on them, physics `Static`. |
| Decorative geometry | `NavigationRole.Exclude`. |
| Floors, ramps, stairs | `NavigationRole.Walkable` (the default). |
| Agent size (engine mannequin: capsule 1.8 m tall, 0.45 m radius) | Radius 0.45 m (0.3–0.5), height 1.8 m, climb 0.4 m, slope 35–45°. Enter metres in the NavMesh dialog or MCP `setSettings`; raw server options are voxels (below). |
| Click-to-move hero | Hero on `NpcMovementNode` + a controller that turns a left click into `setTargetPosition` (Build). |
| Moving doors and hazards | Leave them out of the bake; handle them in gameplay (tree conditions, target choice). |

**Metres vs voxels.** The scene's `NavigationSettings` (NavMesh dialog, MCP `setSettings`, `<scene>.navmsettings.json`) hold the agent sizes in metres and convert them to voxels for every bake, editor or Play. Options handed straight to the server in code (`navigationServer.initialize` / `updateOptions`, `createNavigationMeshFromMeshes(…, overrideOptions)`) are raw Recast voxel counts: `walkableHeight` / `walkableClimb` in `cellHeight` voxels, `walkableRadius` in `cellSize` voxels. After a bake, check that the wall gap in `toggleDebug` equals the radius in metres ([navmesh-baking](references/navmesh-baking.md)).

## What's available

- **Access**: `world.gameLoop?.navigationServer`, `null` before session subsystems exist and after `destroy()`. A server does not mean a navmesh: call `isReady()` before any query, or it no-ops or returns an empty result.
- **Bake**: editor (Tools → Generate NavMesh, or MCP `action_navmesh` `generate` / `export` / `setSettings` / `toggleDebug`, `query_navmesh` `getInfo`) exports a `.navmesh` that `GameLoop` auto-imports on load; runtime `await world.createNavigationMeshFromScene()`. Always `await` bakes and imports (the WASM module loads on first use).
- **Queries**: `calculatePath(start, end)` (snaps both ends; `[]` on failure), `calculatePathResult(start, end)` (`{ path, complete }`; `complete` false when the end is unreachable and the path stops at the closest reachable point), `getClosestPointOnNavigationMesh(point, { maxSnapDistance })`, `isPointOnNavigationMesh`, `getRandomReachablePoint(center, radius)` (or `null`).
- **Debug**: `createDebugVisualization()` (add the group yourself) or `toggleDebug` in the editor. Also export/import and `clearNavigationMesh()`.

Every call and its edge cases: [server-api](references/server-api.md).

## Build

### Feeding a path to an NPC

`NpcMovementNode` (`.engine/src/nodes/movement/NpcMovementNode.ts`) is the usual consumer. It fetches `world.gameLoop?.navigationServer` itself, so you do not pass it in. Two ways to drive it:
- `mover.setTargetPosition(target)`: the node snaps to the mesh, calls `calculatePath`, and follows the result. Simplest.
- `mover.setPath(points, looped?)`: feed a path you computed (for example `calculatePath` output or a waypoint list). Use this to inspect or modify the path first.

`canUseNavigationServer()` reports whether the node will actually path: it needs a live server and `isReady()`. When false, the node moves in a straight line to the target. `AIController` (`.engine/src/entities/AIController.ts`) is the second consumer of the same server for GSS pawns. Movement tuning belongs to `genesys-movement`.

Source: .engine/src/navigation/NavigationServer.ts, .engine/src/nodes/movement/NpcMovementNode.ts
```ts
/** Periodically sends the owning NPC to a random reachable point nearby. */
@ENGINE.GameClass()
export class WanderNode extends ENGINE.SceneNode {
  private repathTimer = 0;
  private readonly wanderRadius = 15;

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this.repathTimer -= deltaTime;
    if (this.repathTimer > 0) return;
    this.repathTimer = 2;

    const navigationServer = this.getWorld()?.gameLoop?.navigationServer;
    const mover = this.getNode(ENGINE.NpcMovementNode);
    if (!navigationServer?.isReady() || !mover) return; // no navmesh yet, or no mover sibling

    const origin = this.getWorldPosition(new THREE.Vector3());
    const target = navigationServer.getRandomReachablePoint(origin, this.wanderRadius);
    if (!target) return;                                 // try again next timer tick

    const path = navigationServer.calculatePath(origin, target);
    if (path.length === 0) return;                       // unreachable right now
    mover.setPath(path);
  }
}
```

### Click-to-move

Ray from the camera through the click, snap the hit to the navmesh (`getClosestPointOnNavigationMesh`, `maxSnapDistance` 2), and call `setTargetPosition` on the hero's `NpcMovementNode`. The hero is a `DefaultCharacterPawn` whose `createMovementNode` returns an `NpcMovementNode` (WASD still works); a `DefaultPlayerController` subclass consumes left click in `handleMouseDown`, so left click no longer fires. Use a fixed top-down or isometric camera with the cursor visible (`genesys-camera`) and a 0.5 s marker at the goal (`genesys-vfx`). A GSS hero cannot use this (`AIController` only drives a pawn it possesses). Snippet and wiring: [click-to-move](references/click-to-move.md).

### Runtime bake for a generated level

Source: .engine/src/game/World.ts (`createNavigationMeshFromScene`)
```ts
// After placing static level pieces and awaiting model loads:
const nav = world.gameLoop?.navigationServer;
if (nav) {
  await world.createNavigationMeshFromScene();   // throws if the server does not exist
  if (!nav.isReady()) console.warn('Navmesh bake produced nothing; check Static motion + roles');
}
```

## Limitations

- Level changed and NPCs walk through new walls → the navmesh is a static snapshot from bake time; there is no dynamic re-carve → re-bake in the editor, or call `createNavigationMeshFromScene()` again after layout changes.
- NPCs walk into a closing door or a moving hazard → Recast builds one solo navmesh; there is no runtime obstacle add/remove or tile rebuild → avoid them at the gameplay layer (tree conditions, target choice).
- A horde stacks into one blob on the same path → the default `Character` collision profile ignores the Pawn channel, so classic NPCs never block each other or the player → offset each NPC's target 1–2 m (ring around the player, or `getRandomReachablePoint(target, 2)`) and add separation steering; profiles in `genesys-physics` → [collision-profiles](../genesys-physics/references/collision-profiles.md).
- A click-to-move hero spins the camera (no fixed-angle follow rig): [click-to-move](references/click-to-move.md#limitations).

## Traps

- An NPC walks to a wall edge and stops short of an unreachable target → `calculatePath` returns the partial path to the closest reachable point → check `calculatePathResult(start, end).complete` and pick another target when it is false.
- Silent failure → querying before `isReady()` logs an error and returns `[]`; points with no nearby poly return `[]` with no log; it never throws → treat `[]` as "no path", not as an engine error.
- NPCs walk over walls and crates → every `PrimitiveNode` defaults `navigationGeometryRole` to `NavigationRole.Walkable` → set `Obstacle` on things to path around, `Exclude` on things to ignore.
- NPC paths hug walls or clip corners → the agent radius is smaller than the capsule → set Agent Radius to the capsule radius in metres and re-bake; in raw server options, use the radius ÷ `cellSize`, rounded up.

- Bake traps (cleared navmesh, props missing from the bake, empty runtime bake, metres in code-set server options): [navmesh-baking](references/navmesh-baking.md#traps). Click-to-move traps: [click-to-move](references/click-to-move.md#traps).

## Done

- `query_navmesh` `getInfo` reports a navmesh for the scene (editor bake), or the runtime `isReady()` check logs true (runtime bake).
- `toggleDebug` (or `createDebugVisualization()`) shows walkable polys on floors and holes around obstacles, with no polys on wall tops or decor.
- In Play, an NPC sent across the level walks around walls, not through them. A target off the mesh produces no motion and no exception.
- After a layout change, the bake was redone and the debug view matches the new layout.
- The debug view leaves a gap of about the agent radius (0.45 m for the mannequin) along walls, and no polys under 1.8 m ceilings.
- Click-to-move: a click across the level walks the hero around a wall to the spot; a click on a wall top or off the mesh does nothing and logs no error.

## References
- [navmesh-baking](references/navmesh-baking.md) — bake parameters and both default sets, metres vs voxels, what contributes, editor vs runtime bake, bake traps
- [server-api](references/server-api.md) — every server call: access, baking, persistence, readiness, point and path queries, debug, export/import
- [click-to-move](references/click-to-move.md) — the click-to-move hero and controller, wiring, limitations and traps
- [source-index](references/source-index.md) — which engine file holds what
