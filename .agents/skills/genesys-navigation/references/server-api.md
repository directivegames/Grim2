# Navigation server API

The short version is in [SKILL.md → What's available](../SKILL.md#whats-available). Exact signatures: `.engine/src/navigation/NavigationServer.ts`, `RecastNavigationServer.ts`.

- **Access**: `world.gameLoop?.navigationServer`. It is `null` before the session subsystems exist and after `destroy()`. Always guard for `null` and call `isReady()` before querying. A server does not mean a navmesh exists.
- **Baking (editor)**: Tools → Generate NavMesh dialog, or MCP `action_navmesh` (`generate`, `export`, `import`, `clear`, `setSettings`, `toggleDebug`) and `query_navmesh` (`getInfo`, `getSettings`). Bake parameters are the `NavigationSettings` resource (`.engine/src/navigation/NavigationSettings.ts`). Details: [navmesh-baking](navmesh-baking.md).
- **Baking (runtime)**: `await world.createNavigationMeshFromScene()` scans static geometry and calls `navigationServer.createNavigationMeshFromMeshes({ walkableMeshes, obstacleMeshes }, overrideOptions?)`. Use it for procedurally generated levels. The reference lists which nodes contribute.
- **Persistence**: an editor bake exports to a `.navmesh` binary referenced by scene resources (`World.setNavMeshResource`). `GameLoop` auto-imports it on level load, unless `navigationOptions.generateOnStartUp` is `true`: then Play builds the navmesh with `createNavigationMeshFromScene()` instead. A failed import logs a warning and leaves no navmesh.
- **Readiness**: `isReady()` is `true` only once a navmesh is set (bake plus import, or `createNavigationMesh*`). Every query below silently no-ops or returns an empty or failed result when not ready.
- **On-demand runtime**: the Recast WASM module loads on the first bake or import, not when the server is created. Always `await` those calls; the navmesh is not set until the promise resolves.
- **Point queries**:
  - `isPointOnNavigationMesh(point)` is `true` only if the point is directly over a poly.
  - `getClosestPointOnNavigationMesh(point, { halfExtents?, maxSnapDistance? })` snaps to the nearest poly. It returns a clone of `point` unchanged if the query fails or the snap exceeds `maxSnapDistance`; it never jumps to an unrelated poly.
  - `getRandomReachablePoint(center, radius)` returns a random navmesh point within `radius`, or `null` (wander and patrol targets, spawn points).
- **Path query**: `calculatePath(start, end): THREE.Vector3[]` snaps both points to their nearest poly and returns the straight path. It returns `[]` if either point has no nearby poly or the query fails. When the end is unreachable it returns the path to the closest reachable point; `calculatePathResult(start, end)` returns `{ path, complete }` with `complete` false in that case.
- **Debug view**: `createDebugVisualization(): THREE.Group | null`. Add the group to the scene yourself. It is already sanitized for WebGPU (no `LineSegments2` or point instancing). In the editor, `action_navmesh` `toggleDebug`.
- **Export / import**: `exportNavigationMesh(scenePath)`, `importNavigationMesh(scenePath)`, `importNavigationMeshFromData(buffer)`. Binary round-trip used by the bake dialog and level load; rarely called from gameplay.
- **Clear**: `clearNavigationMesh()`.
