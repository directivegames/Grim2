# Mover Modes Catalog

Source: `.engine/src/nodes/movement/mover/modes/`. Seven built-in `IMovementMode` implementations.
Most were ported from a specific classic `BasePawnMovementNode` subclass — the classic axis
mapping and control feel were kept where noted.

## WalkingMode + FallingMode (paired)

Grounded locomotion via a shared Rapier kinematic character controller (`CharacterMovementShared.ts`).
Always register both under one `MoverNode` — each declares a one-way `IMoverTransition` to
the other by name (`WalkingMode`'s `fallingModeName` option, default `'falling'`;
`FallingMode`'s `walkingModeName` option, default `'walking'`), and both must be constructed with
the same `characterControllerOptions` (the first `onActivate` call wins and creates the shared
KCC; only the last-standing `cleanup()` call actually releases it, via
`releaseCharacterController` — safe to call from both).

- `WalkingMode` — `moveInput.x`/`.z` flattened to XZ (look pitch ignored), faces
  `controlRotation.y` directly. `maxSpeed`, `accelerationLambda`/`decelerationLambda`,
  `jumpSpeed` (jump only while grounded), `characterControllerOptions`. Tags:
  `'mover.onGround'` when grounded, `'mover.falling'` when not (auto-transitions to
  `FallingMode` on the latter).
- `FallingMode` — same horizontal-input handling with reduced default acceleration, gravity
  applied to a persistent vertical velocity (stored in `syncState.custom`, not the mode
  instance), configurable `maxMidAirJumps` (0 = none, 1 = double jump, ...). Tags:
  `'mover.onGround'` (auto-transitions to `WalkingMode`) or `'mover.falling'`.

## FlyingMode

Physics-free 6-DOF flight — no gravity, no collision. Uses the full pitch+yaw `moveInput` and
faces `controlRotation` directly every tick (no accumulated rotation state). Ported from
`SpectatorMovementNode`. Options: `maxSpeed` (default 4× the character base speed),
`accelerationLambda`/`decelerationLambda`. No outgoing transitions of its own. Tag:
`'mover.flying'`.

## AerialMode

Target/state-driven, not input-driven — ignores `MovementInputCmd` entirely. Intended for AI
(hovering/flying enemies), driven via `setTargetPosition(pos)`, `setLastKnownPlayerPosition(pos)`
(slow circular search when no explicit target), `setLookAtTarget(pos, threshold?)` /
`clearLookAtTarget()`, `isLookingAtTargetComplete(mover)`. Ported from `AerialMovementNode`.
Holds per-pawn state (target, hover offset, look-at) directly on the instance — use a separate
`AerialMode` instance per pawn, matching the legacy component. Options: `maxSpeed`,
`accelerationLambda`/`decelerationLambda`, `hoverHeight` (+ random `hoverVariation` per
instance), `rotationSpeed`, `maxTiltAngle`, `searchRadius`. Tag: `'mover.aerial'`.

## AirplaneMode

Arcade flight controls: pitch/yaw/roll rotation rates driven by input, throttle-driven forward
speed, optional auto-leveling per axis. Ported from `AirplaneMovementNode`. Reads
`moveInput.z` as pitch, `moveInput.x` as combined yaw+roll (banked-turn style), and the shared
`ZOOM_AXIS_KEY` custom entry as throttle — `lookDelta`/`controlRotation` are ignored;
`syncState.rotation` is the source of truth. Options: `pitchParams`/`yawParams`/`rollParams`
(each `maxSpeedDPS`, `accelerationLambda`, `decelerationLambda`, optional `maxDegrees` clamp,
optional `autoLevelLambda`), `throttleRate`, `maxSpeed`, `minSpeed` (planes rarely stop dead in
the air), `initialThrottle`. Holds per-pawn rotation-rate state on the instance — use one
instance per pawn. Tag: `'mover.airplane'`.

## TopDownMode

Overhead camera-style movement: world-space XZ pan plus Y zoom, never touches rotation. Ported
from `TopDownMovementNode`'s keyboard/gamepad axis subset only — mouse drag-pan, edge-scroll,
and zoom-to-cursor are input-device concerns for a custom `IMovementInputProducer`, not the mode
itself. Reads `moveInput.x`/`.z` as pan and `ZOOM_AXIS_KEY` as a world-Y zoom rate. Options:
`panSpeed`, `zoomSpeed`, `zoomMin`/`zoomMax`; `setPanBounds(bounds | null)` restricts pan to a
world X/Z rectangle. Tag: `'mover.topDown'`. See also the `top-down-camera` pattern in the
`genesys-engine` skill for the classic-side equivalent.

## VehicleMode

Rapier physics-based wheeled-vehicle simulation. Ported from `VehicleMovementNode`. The pawn's
root node must be a `PrimitiveNode` with `PhysicsMotionType.Dynamic` (the chassis) — motion is
driven entirely by Rapier's dynamic-body simulation via an `IPhysicsVehicle`, not by `MoverNode`
transform writes; this mode only mirrors the resulting transform into `MovementSyncState`. Reads
`moveInput.z` as throttle, `moveInput.x` as steering, `jumpPressed` as handbrake. Owns one
`IPhysicsVehicle` — use a separate `VehicleMode` instance per pawn. See
[vehicle-movement](vehicle-movement.md) for the integration-level details and `genesys-physics`
for wheel/suspension/friction tuning. Tag: `'mover.driving'`.

## Coverage gaps vs. classic nodes

No Mover mode ships for `DirectionalCharacterMovementNode`'s directional input model or for
`NpcMovementNode`'s path/actor-following behavior — see [npc-movement](npc-movement.md) for
handling AI locomotion.
