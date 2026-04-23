# Pawn and PlayerController

## Overview

The **Pawn** and **PlayerController** system provides the core player interaction architecture in Genesys. This pattern separates the **visual/physical representation** (Pawn) from the **input handling logic** (PlayerController), enabling flexible player possession, AI takeover, and seamless multiplayer replication.

## Key Concepts

### Pawn

A **Pawn** is a controllable Actor that can receive input from a PlayerController. It represents the player's physical presence in the world — complete with movement capabilities, visual mesh, and collision.

**Responsibilities:**
- Owns a **BasePawnMovementComponent** for locomotion (walking, flying, vehicle movement)
- Receives and processes input forwarded from the PlayerController
- Manages possession state (which PlayerController currently controls it)
- Handles client-side prediction and server reconciliation for multiplayer

**Key Properties:**
- `movementComponent` - The component handling actual locomotion physics
- `playerController` - The current controlling PlayerController (null if unpossessed)
- `onPossessed` / `onUnpossessed` - Delegates for possession state changes

**Reference:** See `node_modules/@gnsx/genesys.js/src/actors/Pawn.ts`

---

### PlayerController

A **PlayerController** is an Actor that translates raw user input (keyboard, mouse, gamepad, touch) into movement commands for the possessed Pawn. It acts as the bridge between human input devices and the Pawn's movement system.

**Responsibilities:**
- Reads input from InputManager (keyboard, mouse, gamepad, virtual joysticks)
- Processes input into normalized movement values (-1 to 1)
- Forwards processed input to the possessed Pawn each frame
- Tracks active input device (keyboard/mouse vs gamepad vs touch)
- Manages possession lifecycle (`possess()`, `unpossess()`)
- Handles multiplayer map loading coordination
- Manages PlayerInfo actor for player metadata

**Key Properties:**
- `pawn` - The currently possessed Pawn (null if not controlling anything)
- `playerInfo` - Associated PlayerInfo actor containing player metadata (name, score, etc.)

**Input Handling (Critical):**

PlayerController implements the `IInputHandler` interface to receive input events from the InputManager. It processes raw input into normalized movement commands and forwards them to the possessed Pawn during each tick.

The base `PlayerController` already implements:
- Pointer lock and raw mouse look
- WASD movement, jumping, reloading
- Gamepad and touch joystick support

The Pawn only receives processed movement commands via `addForwardInput()`, `addLookRightInput()`, etc.

For detailed input system documentation, see `SKILL_DIR/references/input-handling.md`.

---

## Possession Flow

The possession system allows dynamic switching of which controller owns a pawn:

```
PlayerController.possess(pawn)
    ↓
Pawn.setPlayerController(this)
    ↓
Pawn.onPossessed.invoke(pawn, playerController)
```

**Unpossession:**
```
PlayerController.unpossess()
    ↓
Pawn.setPlayerController(null)
    ↓
Pawn.onUnpossessed.invoke(pawn, playerController)
```

**Use Cases:**
- Player death and respawn (unpossess destroyed pawn, possess new one)
- Vehicle entry/exit (possess vehicle pawn, unpossess character pawn)
- Spectator mode (unpossess, switch to fly camera)
- AI takeover (PlayerController unpossesses, AIController possesses)

---

## Built-in Pawn Types

### ThirdPersonCharacterPawn

A ready-made pawn for third-person games with:
- `CharacterMovementComponent` for walking, jumping, falling
- `GLTFMeshComponent` for visual character mesh
- `AnimationStateMachineComponent` for locomotion animations
- Auto-syncs animation parameters (isRunning, isJumping, forward/back/left/right)

---

## Related Components

### Movement Components

Pawns work with specific movement components:

- `CharacterMovementComponent` - Walking, jumping, falling (humanoids)
- `BasePawnMovementComponent` - Base class for all movement
- `AerialMovementComponent` - Flying, hovering
- `AirplaneMovementComponent` - Aircraft physics
- `VehicleMovementComponent` - Car/ground vehicle physics
- `TopDownMovementComponent` - Click-to-move, isometric

### Camera

Pawns meant to be controlled by a player should have an attached camera. See `SKILL_DIR/references/camera.md` for details.

---

## Tips

### First Person Pawn Setup
- Use `MeshComponent` (capsule geometry, collision enabled, KinematicVelocityBased as the motion type) as the root component.
- Attach perspective camera to the root at eye level.
- Use `CharacterMovementComponent` (FirstPerson movement type) as the move component.

### Third Person Pawn Setup
- Create a custom class (extends from `ThirdPersonCharacterPawn`) to represent the pawn.
- You cannot use `ThirdPersonCharacterPawn` directly because it lacks the necessary configuration to make the character work.
- Use `createDefaultAnimatedCharacter` (GameBuilder.ts) as a reference of how to setup the custom pawn.
  DO NOT copy it 1:1, harvest what you need out of it and apply to your custom class.
