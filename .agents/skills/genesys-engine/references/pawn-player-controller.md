# Pawn and PlayerController

The Pawn hierarchy and PlayerController system separate visual/physical representation (Pawn and
subclasses) from input handling logic (PlayerController). Input handling lives entirely in the
Controller; Pawns only expose action methods (`moveForward`, `jump`, `fire`, `interact`, etc.) for
a Controller (player or AI) to call.

Pawns extend `PrimitiveNode`. Controllers extend `SceneNode`. They are not `Actor` subclasses.

## Pawn hierarchy

`Pawn` is intentionally minimal. Capabilities are layered in subclasses so a game only pulls in
what it needs:

- Pawn — Possession bookkeeping only (controller reference, `onPossessed` / `onUnpossessed`,
  `getCamera()`). Creates `ReplicationInfo` but does not auto-snap-replicate transforms
  (that Actor-era default is gone). No movement node, no input, no combat/interaction.
- MovementPawn — Adds `movementNode` (a `BasePawnMovementNode`; deprecated `movementComponent`
  accessor remains) and action methods a Controller calls: `moveForward`, `moveRight`, `lookUp`,
  `lookRight`, `zoom`, `jump`, `stopJump`. Upgrades transform replication via movement prediction
  when configured.
- GameplayPawn — Extends MovementPawn with combat (`fire`, `endFire`, `altFire`, `endAltFire`,
  `reload` via equipped equipment nodes) and interaction (`interact`, `endInteract` via an
  auto-created interaction node), plus optional directional-light-following.
- CharacterPawn — Extends MovementPawn with a ready-made camera/animation/mesh scaffold
  (first- or third-person). No combat/interaction by itself.
- DefaultCharacterPawn — Extends CharacterPawn and adds the same combat/interaction/
  light-following as GameplayPawn (duplicated, not shared — see `ICombatPawn`/`IInteractPawn`
  below), plus raw `onKeyDown`/`onKeyUp`/`onMouseDown`/`onMouseUp`/`onGamepadButtonDown`/
  `onGamepadButtonUp`/`onGamepadAxisChange` delegates forwarded by `DefaultPlayerController` for
  compatibility with older `Pawn`-level input handling. This is the "batteries-included"
  pawn most demos and templates use; extend it directly if you just want a working player
  character.
- VRPawn — Extends Pawn directly (VR input/teleport/grab, no movement node).

Pick the shallowest class that has what you need: a flying camera rig with no combat is a
`MovementPawn`; a turret that only fires is a `GameplayPawn` without a mesh/camera scaffold; a
playable third-person character with a gun is a `DefaultCharacterPawn`.

Key API:
- `movementNode` (MovementPawn+) — `BasePawnMovementNode` accessor for locomotion physics.
- `getController()` — Returns the current controlling Controller, or null when unpossessed.
  Deprecated `getPlayerController()` returns the controller only when it is a `PlayerController`.
- `onPossessed` / `onUnpossessed` — Possession delegates on the pawn (signature: `(pawn, controller)`).
  Controllers also have protected `onPossess` / `onUnpossess` hooks.

`GameplayPawn` and `DefaultCharacterPawn` intentionally don't share a common ancestor for their
combat/interaction code. Both implement the same structural shape, described by the `ICombatPawn`
and `IInteractPawn` interfaces in `PawnActions.ts`, with `isCombatPawn` / `isInteractPawn`
type-guard helpers. Anything that needs to call combat/interaction actions on an arbitrary pawn
(like `DefaultPlayerController`) should use those guards instead of `instanceof GameplayPawn`.

Reference: See Pawn.ts, MovementPawn.ts, GameplayPawn.ts, CharacterPawn.ts,
DefaultCharacterPawn.ts, and PawnActions.ts in engine source (`entities/`).

## PlayerController

A minimal SceneNode base handling player identity, networking, and possession. Implements
IInputHandler with inert stubs — it registers itself as an input handler on beginPlay (and
requests pointer lock unless `noPointerLock`), but does not itself translate raw input into
gameplay actions.

- Manages possession lifecycle and PlayerInfo.
- Registers as an InputManager handler; concrete input handling is left to a subclass.

Key Accessors:
- getPawn() — currently possessed Pawn.
- getPlayerInfo() — player metadata (name, clientId).

Reference: See PlayerController.ts in engine source.

## DefaultPlayerController

Extends PlayerController with the engine's default control scheme: reads keyboard, mouse,
gamepad, and virtual-joystick input, normalizes it (-1 to 1), and each frame (via
`tickPrePhysics`) calls the possessed pawn's action methods — `moveForward`/`moveRight`/`lookUp`/
`lookRight`/`zoom`/`jump`/`stopJump` if it's a `MovementPawn`, and `fire`/`altFire`/`reload`/
`interact` if it structurally satisfies `ICombatPawn` / `IInteractPawn`. A plain `Pawn` (e.g.
`VRPawn`) simply skips movement/gameplay dispatch. If the possessed pawn is a
`DefaultCharacterPawn`, its raw input delegates are also invoked for backward compatibility.
This is the class `GameMode` spawns by default.

Write a custom `PlayerController` subclass only when a game needs an entirely different control
scheme, or needs extra keys/actions — override `handleKeyDown`/etc., check `this.pawn instanceof
YourPawnClass`, and call a public action method on the pawn (never re-add raw input handling to
the pawn itself).

Reference: See DefaultPlayerController.ts in engine source.

## Possession flow

PlayerController.possess(pawn)
  -> Pawn updates its internal controller reference (fires `onPossessed`).
  -> Controller.onPossess(pawn).

Unpossession:
PlayerController.unpossess()
  -> Controller.onUnpossess(pawn).
  -> Pawn clears its controller reference (fires `onUnpossessed`).

## CharacterPawn / DefaultCharacterPawn override points

- `createCollision()` — Replace the default capsule collision (returns `SceneNode | null`;
  `MoverCharacterPawn` requires non-null).
- `createMovementNode()` — Swap in a different `BasePawnMovementNode` subclass (CharacterPawn family).
  `MoverCharacterPawn` uses `createMoverNode()` / `MoverNode` instead — see the `genesys-movement`
  skill for the full mode-based Mover system (mode transitions, `LayeredMove`, `MovementModifier`,
  and custom modes/controllers).
- `getInitialCameraPositions()` — Returns `{ pivotPosition, cameraPosition }`. Equal positions
  produce a first-person camera; different positions produce a third-person spring-arm camera.
- `setupCamera()` — Override only if the default pivot/spring-arm hierarchy does not fit.
- `setupAnimationNode()` / `setupVisualNode()` — Return null to opt out (typical for first-person),
  or return a custom animation / visual node.
- `zoomStep(direction)` — CharacterPawn-only, one-shot spring-arm `armLength` nudge for discrete
  input (mouse wheel).

## Related movement nodes

Pawn movement nodes (subclasses of `BasePawnMovementNode`, used as `MovementPawn.movementNode`):
- CharacterMovementNode — Walking, jumping, falling.
- DirectionalCharacterMovementNode — Directional input model.
- AerialMovementNode — Flying.
- AirplaneMovementNode — Airplane physics.
- VehicleMovementNode — Car physics.
- TopDownMovementNode — Overhead / RTS camera pan and zoom. See [Top-Down Camera](../patterns/top-down-camera.md).
- SpectatorMovementNode — Noclip / free-fly observer.
- NpcMovementNode — NPC locomotion.

Other movement helpers (extend `SceneNode`, not drop-in `movementNode` types):
- PathMovementNode — Path-following.
- TweenMovementNode — Tween-driven movement.
- SpringArmNode — Camera distance control (used by CharacterPawn for third-person view).

Deprecated `*Component` type aliases may still resolve to these `*Node` classes.

## Setup guidelines

### First person pawn
- Extend CharacterPawn (or DefaultCharacterPawn for combat/interaction).
- Override getInitialCameraPositions() to return identical pivot and camera positions (e.g., at eye height).
- Override setupVisualNode() and setupAnimationNode() to return null.

### Third person pawn
- Extend CharacterPawn (or DefaultCharacterPawn). Default overrides produce a third-person spring-arm camera with the engine's default character mesh and animation set.
- Override setup methods only when customizing mesh, animation, or camera distance/pitch.

### Non-character movers (vehicles, flying cameras, turrets, NPCs)
- Extend MovementPawn directly and pass a `movementNode` in options — no camera/animation scaffold is created for you.
- Add GameplayPawn (or extend it) only if the pawn needs to fire/interact.
