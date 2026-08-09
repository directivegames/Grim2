Use when the user wants to customize on-screen mobile touch controls (virtual joysticks).

## When Joysticks Appear

- By default (`enabled: 'auto'`), virtual joysticks are created on mobile browsers only.
- Set `VITE_DEBUG_TOUCH_INPUT=true` to force joysticks on desktop for testing.
- Set `enabled: true` to always create joysticks when a game container exists.
- Set `enabled: false` (or legacy `hidden: true`) to disable them.

## Configure At Startup

Pass `virtualJoystickOptions` through `BaseGameLoopOptions` when creating the game loop:

```typescript
export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    virtualJoystickOptions: {
      right: {
        mode: 'dynamic',
        fadeTime: 250,
        zone: { top: 0, right: 0, bottom: 0, left: '50%' },
      },
    },
  };
  return new MyGame(container, mergedOptions);
}
```

Shared options (`size`, `color`, `opacity`, `mode`, `fadeTime`, `threshold`, `catchDistance`) apply to both sticks unless overridden per stick.

Per-stick options live under `left` and `right`. Set either to `false` to disable that stick.

## Recipes

### Default Dual Static Sticks

Omit `virtualJoystickOptions` or pass only shared styling. Both sticks appear in the bottom corners.

### Floating Right Stick (Look)

```typescript
virtualJoystickOptions: {
  right: {
    mode: 'dynamic',
    fadeTime: 250,
    zone: { top: 0, right: 0, bottom: 0, left: '50%' },
  },
}
```

The right stick spawns at the touch point, fades out on release, and the left stick keeps the static default.

### Disable One Stick

```typescript
virtualJoystickOptions: {
  left: false,
  right: { mode: 'dynamic', zone: { top: 0, right: 0, bottom: 0, left: 0 } },
}
```

### Tune Feel

Adjust `DefaultPlayerController.inputSettings` for joystick movement/look sensitivity:

```typescript
ENGINE.DefaultPlayerController.inputSettings.joystickMovementSensitivity = 0.03;
ENGINE.DefaultPlayerController.inputSettings.joystickLookSensitivity = 0.6;
```

### Runtime Visibility

```typescript
world.inputManager.showVirtualJoystick();
world.inputManager.hideVirtualJoystick();
```

### Custom Handling

Override `handleVirtualJoystick` on a `DefaultPlayerController` subclass to replace default movement/look behavior. For a direct `PlayerController` subclass, implement `handleVirtualJoystick` on `IInputHandler` instead.

### Zone CSS Targeting

Joystick zones expose `data-genesys-virtual-joystick-zone="left"` or `"right"` for project-specific CSS.

## Modes

- `static` — fixed position within the zone (default)
- `dynamic` — spawns at touch point, destroyed on release
- `semi` — recycles joysticks within `catchDistance`

## Related References

- [input-handling](../references/input-handling.md) — InputManager API and event routing
- [pawn-player-controller](../references/pawn-player-controller.md) — DefaultPlayerController virtual joystick handling

Source: `.engine/systems/InputManager.ts`, `.engine/entities/DefaultPlayerController.ts`
