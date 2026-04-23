# Input Handling

The Genesys engine provides a centralized input management system that handles keyboard, mouse, gamepad, and touch input through the `InputManager` class.

## Core Components

### InputManager

`InputManager` is the centralized system for capturing and distributing input events. It is created by the World and routes input to registered handlers.

**Key Responsibilities:**
- Captures keyboard, mouse, gamepad, and touch events
- Maintains input state (keys pressed, mouse position, gamepad axes)
- Routes events to registered `IInputHandler` instances
- Provides pointer lock support for first-person controls
- Manages virtual joysticks for mobile/touch devices

**Location:** `node_modules/@gnsx/genesys.js/src/systems/InputManager.ts`

---

### IInputHandler Interface

Objects that want to receive input events must implement the `IInputHandler` interface:

**Return value:** Handlers return `true` to indicate the event was consumed and should not propagate to other handlers.

---

### BaseInputHandler

A convenience base class that implements `IInputHandler` with default no-op methods. Extend this class and override only the methods you need.

---

## Registering Input Handlers

Input handlers must be registered with the InputManager to receive events, see `inputManager.addInputHandler` and `inputManager.removeInputHandler`

---

## Pointer Lock

Pointer lock hides the cursor and provides raw mouse movement data, essential for first-person controls, see `inputManager.requestPointerLock` and `inputManager.exitPointerLock`

**Note:** Pointer lock requires user interaction (click) to activate. The InputManager automatically requests pointer lock on the first mouse click when `requestPointerLock()` has been called.

---


## PlayerController Integration

The `PlayerController` actor is the primary input handler in Genesys. It translates input into pawn movement commands, input flow:
1. InputManager captures raw input
2. PlayerController receives events via IInputHandler
3. PlayerController accumulates input values (forward, right, lookUp, etc.)
4. During tickPrePhysics, PlayerController sends values to Pawn
5. Pawn forwards to movementComponent.addForwardInput(), etc.

---

## Best Practices

1. **Return true to consume events** - If your handler processes an event, return `true` to stop propagation to other handlers.

2. **Register in beginPlay, unregister in endPlay** - Always clean up input handlers to prevent memory leaks and unwanted input processing.

3. **Use BaseInputHandler for convenience** - Extend this class instead of implementing the full interface when you only need a few input types.

4. **Normalize input values** - PlayerController normalizes movement input to -1..1 range before sending to pawns.
