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

## GSS: AIController + GSSNode

`AIController` (`.engine/src/entities/AIController.ts`) implements `IGSSInputProducer` and
steers a possessed pawn that has a `GSSNode` (for example `GSSCharacterPawn`).
Navmesh queries still belong to `genesys-navigation`; the controller turns path/look-at state
into `GSSInputCmd` vectors and down-tags each tick.

Mixing locomotion stacks is fine for pawns that never collide or trace against each other:
keep some AI on classic `NpcMovementNode` while the player uses GSS. A classic NPC
that the player can bump, shoot, or dash through is not rewindable, so those interactions
mis-predict unless the game adds `IRewindable` history and re-simulation — see
[gss-mechanics](gss-mechanics.md). To drive `GSSWalkingMode` /
`GSSFallingMode` from custom AI without `AIController`, set your own `IGSSInputProducer`
on the sim node — see [custom-modes-and-controllers](custom-modes-and-controllers.md).

There is no shipped GSS path-follow *mode*; path following is an input producer, not a
locomotion mode.
