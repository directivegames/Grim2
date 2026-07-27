# IInputHandler Contract

## Interface

```ts
interface IInputHandler {
  handleMouseDown(button: ENGINE.MouseButton): boolean;
  handleMouseUp(button: ENGINE.MouseButton): boolean;
  handleMouseMove(dx: number, dy: number): boolean;
  handleMouseClick(button: ENGINE.MouseButton): boolean;
  handleKeyDown(e: KeyboardEvent): boolean;
  handleKeyUp(e: KeyboardEvent): boolean;
  setInputManager(mgr: ENGINE.InputManager): void;
}
```

## Return value

Return `true` to consume the input and stop propagation to lower-priority handlers.
Return `false` to pass the event on.

For ability actors, always return `false` from all handlers. The ability fires a side effect; it does not prevent other systems (camera, UI) from also receiving the event.

## Priority

Handlers are checked in registration order. The first handler registered gets first refusal. Register your ability handler in `beginPlay`, after any higher-priority handlers (such as a dialogue or menu handler) have been registered.

If a higher-priority handler returns `true` (e.g. a dialogue is consuming all input), your ability handler will not receive events. Design your handlers to be silent when they receive nothing — do not poll.

## Mouse buttons

```ts
ENGINE.MouseButton.Left   // 0
ENGINE.MouseButton.Right  // 2
ENGINE.MouseButton.Middle // 1
```

## Key event

`handleKeyDown` and `handleKeyUp` receive the browser `KeyboardEvent`. Match on `e.key` for letter keys (case-insensitive: check both `'e'` and `'E'`). Use `e.code` for physical key codes when you need layout independence.

```ts
handleKeyDown(e: KeyboardEvent): boolean {
  if (e.key === 'r' || e.key === 'R') {
    this._onReload();
    return false;
  }
  return false;
}
```

## Registration

```ts
world.inputManager.addInputHandler(this._inputHandler);
world.inputManager.removeInputHandler(this._inputHandler);
```

Always remove in `doEndPlay`. Leaving a handler registered after the actor is destroyed will silently call methods on a dead reference.
