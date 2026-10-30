# Pawn and PlayerController

The Pawn hierarchy and the PlayerController separate the physical body (Pawn and subclasses) from input logic (Controller). Input handling lives entirely in the Controller. Pawns only expose action methods (`moveForward`, `jump`, `fire`, `interact`, …) for a player or AI Controller to call.

Pawns extend `PrimitiveNode`. Controllers extend `SceneNode`. Neither is an `Actor` subclass.

Source: .engine/src/entities/ (`Pawn.ts`, `MovementPawn.ts`, `GameplayPawn.ts`, `CharacterPawn.ts`, `DefaultCharacterPawn.ts`, `PawnActions.ts`, `Controller.ts`, `PlayerController.ts`, `DefaultPlayerController.ts`, `AIController.ts`), .engine/src/xr/VRPawn.ts

## Pawn hierarchy

`Pawn` is minimal. Capabilities are layered in subclasses so a game pulls in only what it needs.

| Class | Adds |
|---|---|
| `Pawn` | Possession bookkeeping (controller reference, `onPossessed` / `onUnpossessed`, `getCamera()`). Creates `ReplicationInfo` but does not auto-replicate transforms. No movement, input, combat, or interaction. |
| `MovementPawn` | `movementNode` (a `BasePawnMovementNode`; the old `movementComponent` accessor was removed in engine 19) and actions: `moveForward`, `moveRight`, `lookUp`, `lookRight`, `zoom`, `jump`, `stopJump`. Upgrades transform replication through movement prediction when configured. |
| `GameplayPawn` | Extends `MovementPawn` with combat (`fire`, `endFire`, `altFire`, `endAltFire`, `reload` via equipped equipment nodes) and interaction (`interact`, `endInteract` via an auto-created interaction node), plus optional directional-light following. |
| `CharacterPawn` | Extends `MovementPawn` with a camera / animation / mesh scaffold (first or third person). No combat or interaction. |
| `DefaultCharacterPawn` | Extends `CharacterPawn` with the same combat, interaction, and light following as `GameplayPawn` (duplicated, not shared), plus raw input delegates for compatibility. The batteries-included pawn most demos and templates use. |
| `AvatarCharacterPawn` | `CharacterPawn` with `useAvatarAppearance` on. The look comes from an `AvatarDescription`. Spawn it from `pawnFactory` (or set the flag on `CharacterPawn` / `GSSCharacterPawn`, including on a prefab). See [avatars](avatars.md). |
| `VRPawn` | Extends `Pawn` directly (VR input, teleport, grab; no movement node). |
| `GSSCharacterPawn` | Gameplay Simulation System pawn with prediction and rollback; pair it with `GSSPlayerController`. Implements neither `ICombatPawn` nor `IInteractPawn`, so fire and interact need the wiring in `genesys-combat` / `genesys-interactions`. See `genesys-movement`. |

Pick the shallowest class that has what you need: a flying camera rig with no combat is a `MovementPawn`; a turret that only fires is a `GameplayPawn` with no mesh/camera scaffold; a playable solo hero that fires or interacts (third person, first person, or top-down with a fixed camera) is a `DefaultCharacterPawn` with `DefaultPlayerController`. Online games and GSS-ability designs use `GSSCharacterPawn` + `GSSPlayerController`.

Key API:
- `movementNode` (MovementPawn and up) — the locomotion node.
- `getController()` — current Controller, or null when unpossessed. `getPlayerController()` returns it only when it is a `PlayerController`.
- `onPossessed` / `onUnpossessed` — delegates on the pawn, signature `(pawn, controller)`. Controllers have protected `onPossess` / `onUnpossess` hooks.

`GameplayPawn` and `DefaultCharacterPawn` do not share an ancestor for combat and interaction. Both match the `ICombatPawn` and `IInteractPawn` interfaces in `PawnActions.ts`, with `isCombatPawn` / `isInteractPawn` type guards. Code that calls combat or interaction actions on any pawn uses those guards, not `instanceof GameplayPawn`.

## PlayerController

A minimal `SceneNode` base for player identity, networking, and possession. It implements `IInputHandler` with inert stubs: on `beginPlay` it registers itself as an input handler and requests pointer lock unless `noPointerLock` is set, but it does not translate input into actions.

- `getPawn()` — the possessed pawn.
- `getPlayerInfo()` — player metadata (name, clientId).

## DefaultPlayerController

Extends `PlayerController` with the engine's default scheme. It reads keyboard, mouse, gamepad, and virtual-joystick input, normalizes it to -1..1, and each `tickPrePhysics` calls the pawn's actions:
- `moveForward` / `moveRight` / `lookUp` / `lookRight` / `zoom` / `jump` / `stopJump` when the pawn is a `MovementPawn`;
- `fire` / `altFire` / `reload` / `interact` when the pawn satisfies `ICombatPawn` / `IInteractPawn`.

A plain `Pawn` (such as `VRPawn`) skips that dispatch. A `DefaultCharacterPawn` also gets its raw input delegates invoked first, for backward compatibility. `GameMode` spawns `DefaultPlayerController` by default.

Write a `PlayerController` subclass only for an entirely different control scheme (bespoke vehicle or RTS layout) or extra keys. Override `handleKeyDown` and friends, narrow with `this.pawn instanceof YourPawn`, and call a public action on the pawn. Never add raw input handling to the pawn itself.

## Possession flow

```
PlayerController.possess(pawn)
  -> pawn stores the controller reference (fires onPossessed)
  -> controller.onPossess(pawn)

PlayerController.unpossess()
  -> controller.onUnpossess(pawn)
  -> pawn clears the controller reference (fires onUnpossessed)
```

## CharacterPawn / DefaultCharacterPawn override points

- `createCollision()` — replace the default capsule (returns `SceneNode | null`; `GSSCharacterPawn` requires a collision child).
- `createMovementNode()` — swap in another `BasePawnMovementNode` subclass. `GSSCharacterPawn` uses `createGSSNode()` / `GSSNode` instead (`genesys-movement`).
- `getInitialCameraPositions()` — returns `{ pivotPosition, cameraPosition }`. Equal positions give a first-person camera; different positions give a third-person spring-arm camera.
- `setupCamera()` — override only when the default pivot / spring-arm hierarchy does not fit.
- `setupAnimationNode()` / `setupVisualNode()` — return null to opt out (typical for first person), or return a custom node.
- `zoomStep(direction)` — CharacterPawn only; a one-shot spring-arm `armLength` nudge for discrete input (mouse wheel). Range and feel come from `cameraMinDistance` (default 1), `cameraMaxDistance` (default 10), and `cameraZoomSensitivity` (default 0.5).

`MoverCharacterPawn` and `MoverPlayerController` were removed in engine 19. To port an existing Mover pawn, read the `genesys-movement` migration reference ([mover-to-gss](../../genesys-movement/references/mover-to-gss.md)).

## Movement nodes

Drop-in `movementNode` types (subclasses of `BasePawnMovementNode`, in `.engine/src/nodes/movement/`):
- `CharacterMovementNode` — walking, jumping, falling.
- `DirectionalCharacterMovementNode` — directional input model.
- `AerialMovementNode` — flying.
- `AirplaneMovementNode` — airplane physics.
- `VehicleMovementNode` — car physics (`genesys-vehicles`).
- `TopDownMovementNode` — RTS camera pan and zoom, not a top-down hero (`genesys-camera`).
- `SpectatorMovementNode` — noclip / free-fly observer.
- `NpcMovementNode` — NPC locomotion (`genesys-creatures`).

Other helpers extend `SceneNode` and are not `movementNode` types:
- `PathMovementNode` — path following.
- `TweenMovementNode` — tween-driven movement (`genesys-interactions`).
- `SpringArmNode` — camera distance with world collision (`genesys-camera`).

The old `*Component` aliases were removed in engine 19, in code and in saved data. Movement choice and tuning are owned by `genesys-movement`.

## Setup guidelines

**First-person pawn.** Extend `CharacterPawn` (or `DefaultCharacterPawn` for combat/interaction). Return identical pivot and camera positions (eye height) from `getInitialCameraPositions()`. Return null from `setupVisualNode()` and `setupAnimationNode()`.

**Third-person pawn.** Extend `CharacterPawn` or `DefaultCharacterPawn`. The defaults give a spring-arm camera with the engine's default character mesh and animation set. Override setup methods only to change mesh, animation, or camera distance/pitch.

**Avatar character pawn.** Don't write one: return `ENGINE.AvatarCharacterPawn.create()` from `pawnFactory`, or set `useAvatarAppearance` on `CharacterPawn` / `GSSCharacterPawn` (see [avatars](avatars.md)). To put an avatar on a different base pawn, override `setupVisualNode()` to add `ENGINE.createCharacterAvatarAppearance()` and return it; it carries the capsule-relative pose the mannequin uses.

**Non-character movers (vehicles, flying rigs, turrets, NPCs).** Extend `MovementPawn` and pass a `movementNode` in options; no camera/animation scaffold is created. Use `GameplayPawn` only when the pawn fires or interacts.

Camera layouts: `genesys-camera`. Sprint, dash, and abilities: `genesys-movement`. Touch input: `genesys-touch-controls`.
