# Input Handling

The Genesys engine provides a centralized input management system via the InputManager class.

## Core Components

InputManager — Centralized system for capturing and distributing keyboard, mouse, gamepad, and touch input. Created by the World.

IInputHandler Interface — Objects implementing this receive events. Handlers return true to consume events.

BaseInputHandler — Convenience base class with default no-op methods. Extend this to override only specific inputs.

Reference: See InputManager.ts in engine source.

## Virtual Joysticks (Mobile)

On mobile browsers, InputManager creates nipplejs virtual joysticks in the game container. Configure them via `virtualJoystickOptions` on `BaseGameLoopOptions` (forwarded through `WorldOptions` to `InputManager`).

Key types: `VirtualJoystickOptions`, `VirtualJoystickStickOptions`, `VirtualJoystickZoneOptions`.

- Shared options apply to both sticks: `size`, `color`, `opacity`, `mode`, `fadeTime`, `threshold`, `catchDistance`
- Per-stick overrides: `left` and `right` (each `VirtualJoystickStickOptions | false`)
- `enabled: 'auto' | boolean` — `auto` (default) limits joysticks to mobile; set `VITE_DEBUG_TOUCH_INPUT=true` to test on desktop
- `hidden: true` is deprecated; use `enabled: false`
- Modes: `static`, `dynamic`, `semi`
- Zone elements use `data-genesys-virtual-joystick-zone="left"` or `"right"` for CSS targeting

Runtime API on `world.inputManager`:

- `showVirtualJoystick()` / `hideVirtualJoystick()`
- `isVirtualJoystickEnabled()` / `isVirtualJoystickVisible()`

See [mobile-controls pattern](../patterns/mobile-controls.md) for configuration recipes.

## Registering Handlers

Register handlers with inputManager.addInputHandler and remove with removeInputHandler.

## Pointer Lock

Essential for first-person controls. Use inputManager.requestPointerLock and exitPointerLock. Pointer lock requires user interaction (click) to activate.

## PlayerController Integration

`PlayerController` is a minimal base (identity, networking, possession, pointer-lock/input-handler
registration) that implements `IInputHandler` with inert stubs. `DefaultPlayerController` (the
concrete class every demo/template uses) does the actual raw-input-to-action translation, and owns
*all* raw input handling — `Pawn`/`MovementPawn`/`CharacterPawn`/`GameplayPawn` have no
`onKeyDown`/`onMouseDown`/etc. delegates or `handleKeyDown`/etc. methods; they only expose action
methods for a controller to call:
1. InputManager captures raw input.
2. DefaultPlayerController receives events via IInputHandler.
3. DefaultPlayerController accumulates normalized movement values, and guards pawn-specific
   dispatch with `instanceof MovementPawn` for movement, and the structural `isCombatPawn` /
   `isInteractPawn` guards (from `PawnActions.ts`) for combat/interaction — since not every
   possessed Pawn supports movement or combat/interaction, and `GameplayPawn` /
   `DefaultCharacterPawn` intentionally don't share a common ancestor for that code.
4. During tickPrePhysics, values are sent to the Pawn via its action methods (`moveForward`,
   `moveRight`, `lookUp`, `lookRight`, `zoom`, `jump`, `stopJump`).
5. `MovementPawn` (and subclasses) forward these calls to `movementComponent`.

`DefaultCharacterPawn` is the one exception: it re-exposes `onKeyDown`/`onKeyUp`/`onMouseDown`/
`onMouseUp`/`onGamepadButtonDown`/`onGamepadButtonUp`/`onGamepadAxisChange` delegates, which
`DefaultPlayerController` invokes first (before its own built-in handling) whenever the possessed
pawn is a `DefaultCharacterPawn`. This exists purely so existing games built against the
pre-refactor `Pawn` can migrate by swapping `CharacterPawn` for `DefaultCharacterPawn` without
having to move input handling into a controller; new pawns should not rely on this and should use
a `PlayerController` subclass instead.

Write a custom `PlayerController` subclass instead of `DefaultPlayerController` when a game needs
a different control scheme entirely (e.g. bespoke vehicle or RTS input layout), or extra
game-specific keys — override the relevant `handleKeyDown`/etc. method, narrow `this.pawn` with
`instanceof YourPawnClass`, and call a public action method on the pawn.

Movement components may also handle mouse directly: `BasePawnMovementComponent` provides default no-op `handleMouseDown`, `handleMouseUp`, and `handleMouseMove`. `DefaultPlayerController` forwards raw mouse events straight to `this.pawn.movementComponent` (when the pawn is a `MovementPawn`) before falling back to its own delegate events — used by `TopDownMovementComponent` for middle-mouse drag pan without pointer lock.

## Best Practices

- Return true from handler methods to consume events and stop propagation.
- Register handlers in beginPlay and unregister in endPlay.
- Extend BaseInputHandler instead of implementing the full interface.
- Normalize movement input to -1..1 range.
