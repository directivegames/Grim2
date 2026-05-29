# Input Handling

The Genesys engine provides a centralized input management system via the InputManager class.

## Core Components

InputManager — Centralized system for capturing and distributing keyboard, mouse, gamepad, and touch input. Created by the World.

IInputHandler Interface — Objects implementing this receive events. Handlers return true to consume events.

BaseInputHandler — Convenience base class with default no-op methods. Extend this to override only specific inputs.

Reference: See InputManager.ts in engine source.

## Registering Handlers

Register handlers with inputManager.addInputHandler and remove with removeInputHandler.

## Pointer Lock

Essential for first-person controls. Use inputManager.requestPointerLock and exitPointerLock. Pointer lock requires user interaction (click) to activate.

## PlayerController Integration

PlayerController translates raw input into pawn movement commands:
1. InputManager captures raw input.
2. PlayerController receives events via IInputHandler.
3. PlayerController accumulates normalized movement values.
4. During tickPrePhysics, values are sent to the Pawn.
5. Pawn forwards to movementComponent.

## Best Practices

- Return true from handler methods to consume events and stop propagation.
- Register handlers in beginPlay and unregister in endPlay.
- Extend BaseInputHandler instead of implementing the full interface.
- Normalize movement input to -1..1 range.
