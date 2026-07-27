# Pawn and PlayerController

The Pawn hierarchy and PlayerController system separate visual/physical representation (Pawn and
subclasses) from input handling logic (PlayerController). Input handling lives entirely in the
Controller; Pawns only expose action methods (`moveForward`, `jump`, `fire`, `interact`, etc.) for
a Controller (player or, eventually, AI) to call.

## Pawn Hierarchy

`Pawn` is intentionally minimal. Capabilities are layered in subclasses so a game only pulls in
what it needs:

- **Pawn** — Possession bookkeeping only (controller reference, `onPossessed` / `onUnpossessed`,
  `getCamera()`). Uses Actor's generic snap-to-position replication (`replicateTransform = true`).
  No movement component, no input, no combat/interaction.
- **MovementPawn** — Adds `movementComponent` (a `BasePawnMovementComponent`) and the action
  methods a Controller calls: `moveForward`, `moveRight`, `lookUp`, `lookRight`, `zoom`, `jump`,
  `stopJump`. Upgrades transform replication to a timestamped `PawnNetTransform` +
  `NetMovementPredictor` for client-side prediction/interpolation.
- **GameplayPawn** — Extends MovementPawn with combat (`fire`, `endFire`, `altFire`, `endAltFire`,
  `reload` via equipped `IEquipment` components) and interaction (`interact`, `endInteract` via an
  auto-created `InteractionComponent`), plus optional directional-light-following.
- **CharacterPawn** — Extends MovementPawn with a ready-made camera/animation/mesh scaffold
  (first- or third-person). No combat/interaction by itself.
- **DefaultCharacterPawn** — Extends CharacterPawn and adds the same combat/interaction/
  light-following as GameplayPawn (duplicated, not shared — see `ICombatPawn`/`IInteractPawn`
  below), plus raw `onKeyDown`/`onKeyUp`/`onMouseDown`/`onMouseUp`/`onGamepadButtonDown`/
  `onGamepadButtonUp`/`onGamepadAxisChange` delegates forwarded by `DefaultPlayerController` for
  compatibility with pre-refactor `Pawn`-level input handling. This is the "batteries-included"
  pawn most demos and templates use; extend it directly if you just want a working player
  character.
- **VRPawn** — Extends Pawn directly (VR input/teleport/grab, no movement component).

Pick the shallowest class that has what you need: a flying camera rig with no combat is a
`MovementPawn`; a turret that only fires is a `GameplayPawn` without a mesh/camera scaffold; a
playable third-person character with a gun is a `DefaultCharacterPawn`.

Key API:
- `movementComponent` (MovementPawn+) — `BasePawnMovementComponent` accessor for locomotion physics.
- `getController()` / `getPlayerController()` — Returns the current controlling Controller (the
  latter only if it's a `PlayerController`), or null when unpossessed.
- `onPossessed` / `onUnpossessed` — Possession delegates (signature: `(pawn, controller)`).

`GameplayPawn` and `DefaultCharacterPawn` intentionally don't share a common ancestor for their
combat/interaction code (kept duplicated on purpose — see `GameplayPawn.ts` for why). Both
implement the same structural shape, described by the `ICombatPawn` (`fire`/`endFire`/`altFire`/
`endAltFire`/`reload`) and `IInteractPawn` (`interact`/`endInteract`/`getInteractionComponent`)
interfaces in `PawnActions.ts`, with `isCombatPawn` / `isInteractPawn` type-guard helpers. Anything
that needs to call combat/interaction actions on an arbitrary pawn (like `DefaultPlayerController`)
should use those guards instead of `instanceof GameplayPawn`, or it will silently miss
`DefaultCharacterPawn` (and any other pawn implementing the same shape).

Reference: See Pawn.ts, MovementPawn.ts, GameplayPawn.ts, CharacterPawn.ts,
DefaultCharacterPawn.ts, and PawnActions.ts in engine source.

## PlayerController

A minimal Actor base handling player identity, networking, and possession. Implements
IInputHandler with inert stubs — it registers itself as an input handler on beginPlay (and
requests pointer lock unless `noPointerLock`), but does not itself translate raw input into
gameplay actions.

- Manages possession lifecycle and PlayerInfo.
- Handles map-transition RPCs (requestLoadMap / notifyMapLoaded).
- Registers as an InputManager handler; concrete input handling is left to a subclass.

Key Accessors:
- getPawn() — currently possessed Pawn.
- getPlayerInfo() — player metadata (name, clientId).

Reference: See PlayerController.ts in engine source.

## DefaultPlayerController

Extends PlayerController with the engine's default control scheme: reads keyboard, mouse,
gamepad, and virtual-joystick input, normalizes it (-1 to 1), and each frame (via
`tickPrePhysics`) calls the possessed pawn's action methods — `moveForward`/`moveRight`/`lookUp`/
`lookRight`/`zoom`/`jump`/`stopJump` if it's a `MovementPawn` (checked via `instanceof
MovementPawn`), and `fire`/`altFire`/`reload`/`interact` if it structurally satisfies `ICombatPawn`
/ `IInteractPawn` (checked via `isCombatPawn` / `isInteractPawn`, which both `GameplayPawn` and
`DefaultCharacterPawn` satisfy). A plain `Pawn` (e.g. `VRPawn`) simply skips movement/gameplay
dispatch. If the possessed pawn is a `DefaultCharacterPawn`, its raw `onKeyDown`/`onMouseDown`/etc.
delegates are also invoked (before this controller's own built-in handling) for backward
compatibility with pre-refactor `Pawn`-level input handling. This is the class `GameMode` spawns
by default and what every built-in demo/template uses.

Write a custom `PlayerController` subclass (rather than `DefaultPlayerController`) only when a
game needs an entirely different control scheme (e.g. a bespoke vehicle or RTS input layout), or
needs extra keys/actions layered on top — override `handleKeyDown`/etc., check `this.pawn
instanceof YourPawnClass`, and call a public action method on the pawn (never re-add raw input
handling to the pawn itself).

Reference: See DefaultPlayerController.ts in engine source.

## Possession Flow

PlayerController.possess(pawn)
  -> Pawn updates its internal controller reference.
  -> Pawn.onPossessed.invoke(pawn, controller).

Unpossession:
PlayerController.unpossess()
  -> Pawn clears its controller reference.
  -> Pawn.onUnpossessed.invoke(pawn, controller).

## CharacterPawn / DefaultCharacterPawn override points

- createRootComponent() — Replace the default capsule collision root.
- createMovementComponent() — Swap in a different BasePawnMovementComponent subclass.
- getInitialCameraPositions() — Returns { pivotPosition, cameraPosition }. Equal positions produce a first-person camera; different positions produce a third-person spring-arm camera.
- setupCamera() — Override only if the default pivot/spring-arm hierarchy does not fit.
- setupAnimationComponent() / setupVisualComponent() — Return null to opt out (typical for first-person), or return a custom AnimationStateMachineComponent / SceneComponent.
- zoomStep(direction) — CharacterPawn-only, one-shot spring-arm `armLength` nudge for discrete input (mouse wheel). `DefaultPlayerController` calls this instead of `zoom()` when the possessed pawn is a `CharacterPawn`, since `zoom()` is a continuous per-frame rate (forwarded to `movementComponent` like any other `MovementPawn`) and would runaway-zoom if used for a one-shot step every frame a key/trigger is held.

## Related Components

Movement Components (all subclasses of BasePawnMovementComponent, used by MovementPawn+):
- CharacterMovementComponent — Walking, jumping, falling (first- and third-person).
- DirectionalCharacterMovementComponent — Character with directional input model.
- AerialMovementComponent — Flying.
- AirplaneMovementComponent — Airplane physics.
- VehicleMovementComponent — Car physics.
- TopDownMovementComponent — Overhead / RTS camera pan and zoom (world or camera-relative pan; root Y or camera local-Z zoom). See [Top-Down Camera](patterns/top-down-camera.md).
- SpectatorMovementComponent — Noclip / free-fly observer.
- PathMovementComponent — Path-following.
- NpcMovementComponent — NPC locomotion.
- TweenMovementComponent — Tween-driven movement.
- SpringArmComponent — Camera distance control (used by CharacterPawn for third-person view).

## Setup Guidelines

### First Person Pawn
- Extend CharacterPawn (or DefaultCharacterPawn for combat/interaction).
- Override getInitialCameraPositions() to return identical pivot and camera positions (e.g., at eye height).
- Override setupVisualComponent() and setupAnimationComponent() to return null.

### Third Person Pawn
- Extend CharacterPawn (or DefaultCharacterPawn). Default overrides produce a third-person spring-arm camera with the engine's default character mesh and animation set.
- Override setup methods only when customizing mesh, animation, or camera distance/pitch.

### Non-Character Movers (vehicles, flying cameras, turrets, NPCs)
- Extend MovementPawn directly and pass a `movementComponent` in options — no camera/animation scaffold is created for you.
- Add GameplayPawn (or extend it) only if the pawn needs to fire/interact.
