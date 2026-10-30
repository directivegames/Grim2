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
  server when `useNavigationServer` is true and the server is ready
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

Movement speed and turn tuning. `initialize()` applies the options you pass. Omitted fields use these defaults:

| Field | When omitted |
|---|---|
| `maxSpeed` | 5 m/s (`CHARACTER_MAX_SPEED`, the player's). Walkers 2–4, chasers 4–6 |
| `lookRightSpeed` | 10 |
| `lookUpSpeed`, `jumpSpeed` | 0 |
| `midAirAccelerationLambda` / `midAirDecelerationLambda` | 100 / 10 |
| `pathFollowingAccuracy` | 0.5 (waypoint arrival radius) |
| `actorFollowingDistance` | 4 |
| `stopDistance` | 1 |
| `useNavigationServer` | true |
| `debugVisualization` | off. Pass `debugVisualization: { enabled: true }` or call `setDebugVisualizationEnabled(true)` |

The debug visualization draws the path line, target sphere, and waypoint spheres in the world. Knockback needs the lambda mute in [jump-and-knockback](jump-and-knockback.md).

## GSS: AIController + GSSNode

`AIController` (`.engine/src/entities/AIController.ts`) implements `IGSSInputProducer` and
steers a possessed pawn that has a `GSSNode` (for example `GSSCharacterPawn`).
Navmesh queries still belong to `genesys-navigation`; the controller turns path/look-at state
into `GSSInputCmd` vectors and down-tags each tick.

Mixing locomotion stacks is fine in single-player and in any game without network prediction,
and online for pawns that never collide or trace against each other: keep AI on classic
`NpcMovementNode` while the player uses GSS. With prediction on, a classic NPC
that the player can bump, shoot, or dash through is not rewindable, so those interactions
mis-predict unless the game adds `IRewindable` history and re-simulation — see
[gss-mechanics](gss-mechanics.md). To drive `GSSWalkingMode` /
`GSSFallingMode` from custom AI without `AIController`, set your own `IGSSInputProducer`
on the sim node — see [custom-modes-and-controllers](custom-modes-and-controllers.md).

There is no shipped GSS path-follow *mode*; path following is an input producer, not a
locomotion mode.
