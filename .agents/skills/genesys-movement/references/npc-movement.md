# NPC Movement

Covers how `NpcMovementNode` is driven once a path or target already exists — steering,
waypoint advancement, arrival/stop behavior, look-at targets. Navmesh queries (path calculation,
closest-point-on-navmesh, navmesh readiness) are owned by the `genesys-navigation` skill —
read that for how a path gets produced in the first place; it is not repeated here.

## Classic: NpcMovementNode

`NpcMovementNode` (`.engine/src/nodes/movement/NpcMovementNode.ts`) extends `CharacterMovementNode`.
It is not typically driven by a `PlayerController` — an AI controller, behavior tree, or plain
script calls its public setters, and its own `tickPrePhysics` converts path/target state into
forward/turn input every frame before delegating to `CharacterMovementNode`'s physics step:

- `setPath(points, looped?)` — follow an explicit waypoint list (points too close to the NPC's
  current position are filtered out on assignment).
- `setTargetPosition(target, stopDistance?)` — computes a path to `target` via the navigation
  server if available (`useNavigationServer`, default `true`) and ready
  (`navigationServer.isReady()`), otherwise falls back to a direct straight-line path.
- `followActor(actor, continueAfterReached?)` / `setFollowedActor(actor, continueAfterReached?)`
  — continuously path toward a moving `SceneNode`, recalculating when it drifts far enough from
  the last path endpoint (`shouldRecalculatePathToActor`).
- `setTargetActor(actor, followDistance?, continueAfterReached?)` — combines following with an
  explicit stop distance.
- `setLookAtTarget(pos, threshold?)` / `clearLookAtTarget()` / `isLookingAtTargetComplete()` —
  face a point independent of movement direction (takes priority over movement-direction facing
  while active); `hasReachedCurrentTarget()` / `getCurrentTarget()` / `getCurrentPath()` /
  `getCurrentPathIndex()` / `getPathLength()` / `getFollowedActor()` for querying state.
- `stop()` clears all targets/paths/following and zeroes input; `stopMovement()` zeroes forward
  input only (keeps a look-at target active).

`canUseNavigationServer()` gates whether path calculation and per-waypoint speed scaling go
through `INavigationServer` (`getWorld()?.gameLoop?.navigationServer`) or fall back to a direct
line — this is the extent of `NpcMovementNode`'s own navmesh integration; the actual
`calculatePath`/`getClosestPointOnNavigationMesh`/`isPointOnNavigationMesh` calls belong to
`genesys-navigation`.

Movement speed/turn tuning: `movementSpeed`/`turnSpeed` options (mapped to the inherited
`maxSpeed`/`lookRightSpeed`), `pathFollowingAccuracy` (waypoint arrival radius),
`actorFollowingDistance` (how far a followed actor may drift before repathing), `stopDistance`.
Optional built-in debug visualization (`debugVisualization` options) draws the path line, target
sphere, and waypoint spheres in the world.

## Mover: no dedicated NPC mode

No `IMovementMode` in `.engine/src/nodes/movement/mover/modes/` provides path-following. This is
a genuine gap, not an oversight to route around silently — verify against
`.engine/src/nodes/movement/mover/modes/` before assuming otherwise, in case a mode is added later.

Until then, three real options, none of them a shipped built-in:

1. Keep AI pawns on classic `NpcMovementNode` even if the player pawn uses Mover. Nothing in
   the engine ties movement system choice to a single pawn class across the whole game — mixing
   is normal (see the decision guide in `SKILL.md`).
2. Write a custom `IMovementInputProducer` that turns a path/target into `moveInput` toward
   the next waypoint — mirroring `NpcMovementNode`'s own `moveTowardPoint`/yaw-difference logic
   — and register it on the AI pawn's `MoverNode` in place of a `PlayerController`-based
   producer, feeding ordinary `WalkingMode`/`FallingMode` humanoid modes. `IMovementInputProducer`
   is explicitly meant to support this (its doc comment calls out an `AIController` steering
   toward a navigation target as a first-class use case, no `PlayerController` required — see
   [custom-modes-and-controllers](custom-modes-and-controllers.md)).
3. Reuse `AerialMode`'s target-driven design (`setTargetPosition`/
   `setLastKnownPlayerPosition`/`setLookAtTarget`) as the closest Mover analog for a flying or
   hovering enemy that does not need directional `moveInput` at all — it already ignores
   `MovementInputCmd` and drives movement purely from mode-instance target state, the same shape
   `NpcMovementNode` uses. This does not cover grounded path-following, only hover/flight.
