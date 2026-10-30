# Input handling

The engine centralizes input in `InputManager`. Raw input reaches gameplay through a `PlayerController`, which calls action methods on the pawn.

Source: .engine/src/systems/InputManager.ts, .engine/src/entities/PlayerController.ts, .engine/src/entities/DefaultPlayerController.ts, .engine/src/nodes/movement/BasePawnMovementNode.ts

## Core classes

- **InputManager** — captures keyboard, mouse, gamepad, and touch input and distributes it. The World creates it: `world.inputManager`.
- **IInputHandler** — objects that receive events. Methods return `true` to consume an event. Members: `handleKeyDown`, `handleKeyUp`, `handleMouseDown`, `handleMouseUp`, `handleMouseMove`, `handleMouseClick`, and optional `handleGamepadButtonDown`, `handleGamepadButtonUp`, `handleGamepadAxisChange`, `handleVirtualJoystick`, `handleSwipe`, `handleTap`, `handleMouseWheel`, plus `setInputManager`.
- **BaseInputHandler** — convenience base with no-op methods. Extend it and override only what you need. `UIManager` is one.

## Registering handlers

`world.inputManager.addInputHandler(handler)` and `removeInputHandler(handler)`. Register in `beginPlay`, unregister in `endPlay`.

## Pointer lock

First-person and mouse-look controls need pointer lock. Use `inputManager.requestPointerLock(options?)` and `exitPointerLock()`. The browser grants it only after a user gesture (a click). `PointerLockOptions.unadjustedMovement` (default false) requests raw mouse movement without OS acceleration. `PlayerController` requests pointer lock on `beginPlay` unless created with `noPointerLock: true`. When to lock and unlock (aim with cursor, menus, pause) is owned by `genesys-camera` and `genesys-ui`.

## Virtual joysticks (mobile)

On mobile browsers `InputManager` creates nipplejs virtual joysticks in the game container. Configure them with `virtualJoystickOptions` on `BaseGameLoopOptions` (forwarded through `WorldOptions` to `InputManager`).

- Types: `VirtualJoystickOptions`, `VirtualJoystickStickOptions`, `VirtualJoystickZoneOptions`, `VirtualJoystickPositionOptions`.
- Shared options: `size`, `color`, `opacity`, `mode`, `fadeTime`, `threshold`, `catchDistance`.
- Per-stick overrides: `left` and `right` (each `VirtualJoystickStickOptions | false`), which also take `zone` and `position`.
- `enabled: 'auto' | boolean` — `auto` (default) creates sticks on mobile, or on desktop when the page URL has `?debugTouchInput=1` (editor Play's Mobile Preview adds it). Use `enabled: false` to turn them off.
- Modes: `static`, `dynamic`, `semi`.
- Zone elements carry `data-genesys-virtual-joystick-zone="left"` or `"right"` for CSS targeting.
- Runtime: `world.inputManager.showVirtualJoystick()` / `hideVirtualJoystick()` / `isVirtualJoystickEnabled()` / `isVirtualJoystickVisible()`.

Touch layouts per genre, buttons, and recipes: `genesys-touch-controls`.

## PlayerController integration

`PlayerController` is a minimal base (identity, networking, possession, pointer lock, handler registration) that implements `IInputHandler` with inert stubs. `DefaultPlayerController` does the raw-input-to-action translation and owns all raw input handling. `Pawn`, `MovementPawn`, `CharacterPawn`, and `GameplayPawn` have no `onKeyDown` / `handleKeyDown`-style input methods; they expose actions only.

1. `InputManager` captures raw input.
2. `DefaultPlayerController` receives events through `IInputHandler`.
3. It accumulates normalized movement values. It guards movement dispatch with `instanceof MovementPawn`, and combat/interaction with the structural `isCombatPawn` / `isInteractPawn` guards from `PawnActions.ts`, because not every pawn supports them and `GameplayPawn` / `DefaultCharacterPawn` share no ancestor for that code.
4. In `tickPrePhysics` it calls the pawn's actions: `moveForward`, `moveRight`, `lookUp`, `lookRight`, `zoom`, `jump`, `stopJump`.
5. `MovementPawn` and subclasses forward these to `movementNode`.

`DefaultCharacterPawn` is the exception. It re-exposes `onKeyDown`, `onKeyUp`, `onMouseDown`, `onMouseUp`, `onGamepadButtonDown`, `onGamepadButtonUp`, and `onGamepadAxisChange` delegates, which `DefaultPlayerController` invokes first whenever the possessed pawn is a `DefaultCharacterPawn`. This exists so older games can migrate by swapping `CharacterPawn` for `DefaultCharacterPawn`. New pawns use a `PlayerController` subclass instead.

Write a custom `PlayerController` subclass when a game needs a different control scheme (vehicle or RTS layout) or extra keys. Override `handleKeyDown` and friends, narrow `this.pawn` with `instanceof YourPawn`, and call a public action on the pawn.

Source: .engine/src/entities/PlayerController.ts
```typescript
@ENGINE.GameClass()
export class PuzzleController extends ENGINE.DefaultPlayerController {
  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'KeyR' && this.pawn instanceof PuzzlePawn) {
      this.pawn.resetBoard();
      return true;
    }
    return super.handleKeyDown(e);
  }
}
```

## Movement nodes and the mouse

`BasePawnMovementNode` has no-op `handleMouseDown`, `handleMouseUp`, `handleMouseMove`, and a `handleMouseWheel`. `DefaultPlayerController` forwards raw mouse events to `this.pawn.movementNode` (when the pawn is a `MovementPawn`) before its own handling. `TopDownMovementNode` uses this for middle-mouse drag pan without pointer lock.

## Best practices

- Return `true` from a handler to consume the event and stop propagation.
- Register handlers in `beginPlay`, unregister in `endPlay`.
- Extend `BaseInputHandler` instead of implementing the whole interface.
- Normalize movement input to -1..1.
- Check that each control moves the pawn the way its label says on screen (`genesys-movement`).
