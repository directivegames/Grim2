# Pawn and PlayerController

The Pawn and PlayerController system separates visual/physical representation (Pawn) from input handling logic (PlayerController).

## Pawn

A controllable Actor representing the player's physical presence.

- Owns a movement component for locomotion.
- Processes input forwarded from the PlayerController.
- Manages possession state.

Key API:
- movementComponent — BasePawnMovementComponent accessor for locomotion physics.
- getPlayerController() — Returns the current controlling PlayerController, or null when unpossessed.
- onPossessed / onUnpossessed — Possession delegates (signature: (pawn, playerController)).

Reference: See Pawn.ts in engine source.

## PlayerController

An Actor translating raw user input into movement commands for the possessed Pawn. Implements IInputHandler.

- Reads input from InputManager (registers itself as an input handler on beginPlay).
- Processes raw input into normalized movement values (-1 to 1).
- Forwards commands to the Pawn each frame.
- Manages possession lifecycle.

Key Accessors:
- getPawn() — currently possessed Pawn.
- getPlayerInfo() — player metadata (name, clientId).

Reference: See PlayerController.ts in engine source.

## Possession Flow

PlayerController.possess(pawn)
  -> Pawn updates its internal playerController reference.
  -> Pawn.onPossessed.invoke(pawn, playerController).

Unpossession:
PlayerController.unpossess()
  -> Pawn clears its playerController reference.
  -> Pawn.onUnpossessed.invoke(pawn, playerController).

## Built-in Pawn Types

CharacterPawn — Opinionated pawn with camera, animation, and movement. Uses MeshComponent as the root (capsule, KinematicVelocityBased), CharacterMovementComponent for locomotion, and a camera built via setupCamera() that automatically chooses first-person vs third-person based on getInitialCameraPositions().

CharacterPawn override points:
- createRootComponent() — Replace the default capsule collision root.
- createMovementComponent() — Swap in a different BasePawnMovementComponent subclass.
- getInitialCameraPositions() — Returns { pivotPosition, cameraPosition }. Equal positions produce a first-person camera; different positions produce a third-person spring-arm camera.
- setupCamera() — Override only if the default pivot/spring-arm hierarchy does not fit.
- setupAnimationComponent() / setupVisualComponent() — Return null to opt out (typical for first-person), or return a custom AnimationStateMachineComponent / SceneComponent.

## Related Components

Movement Components (all subclasses of BasePawnMovementComponent):
- CharacterMovementComponent — Walking, jumping, falling (first- and third-person).
- DirectionalCharacterMovementComponent — Character with directional input model.
- AerialMovementComponent — Flying.
- AirplaneMovementComponent — Airplane physics.
- VehicleMovementComponent — Car physics.
- TopDownMovementComponent — Click-to-move.
- SpectatorMovementComponent — Noclip / free-fly observer.
- PathMovementComponent — Path-following.
- NpcMovementComponent — NPC locomotion.
- TweenMovementComponent — Tween-driven movement.
- SpringArmComponent — Camera distance control (used by CharacterPawn for third-person view).

## Setup Guidelines

### First Person Pawn
- Extend CharacterPawn.
- Override getInitialCameraPositions() to return identical pivot and camera positions (e.g., at eye height).
- Override setupVisualComponent() and setupAnimationComponent() to return null.

### Third Person Pawn
- Extend CharacterPawn. Default overrides produce a third-person spring-arm camera with the engine's default character mesh and animation set.
- Override setup methods only when customizing mesh, animation, or camera distance/pitch.
