# Virtual joysticks

Source: `.engine/src/systems/InputManager.ts`, `.engine/src/entities/DefaultPlayerController.ts`,
`.engine/src/gameplay-sim/entities/GSSPlayerController.ts`, `.engine/src/game/GameLoop.ts`.

## When joysticks appear

- By default (`enabled: 'auto'`), sticks are created on mobile browsers only. "Mobile" is
  `isMobileBrowser()`: a mobile user agent (`Mobi|Android|iPhone|iPad|iPod`) or `'ontouchstart' in window`.
- On desktop, `'auto'` also creates them when the page URL has `?debugTouchInput=1`
  (`ENGINE.isDebugTouchInputEnabled()`). Editor Play's Mobile Preview mode adds the flag when touch
  emulation is on. `VITE_DEBUG_TOUCH_INPUT` in a project `.env` never reaches the engine, which is built
  separately from `.dist/game.js`.
- `enabled: true` always creates sticks when a game container exists.
- `enabled: false` disables them.
- Sticks are never created without `gameContainer`, or under Node.
- Stick creation lazy-loads `nipplejs`.

## Configure at startup

Pass `virtualJoystickOptions` through `BaseGameLoopOptions` when creating the game loop:

Source: .engine/src/game/GameLoop.ts (`BaseGameLoopOptions.virtualJoystickOptions`)
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

Shared options (`size` 120, `color` `'white'`, `opacity` 0.7, `mode` `'static'`, `fadeTime` 250,
`threshold` 0.1, `catchDistance` 200) apply to both sticks unless overridden per stick.

Per-stick options live under `left` and `right`: the shared fields plus `zone`
(`top`/`right`/`bottom`/`left`/`width`/`height`, numbers are px, strings are CSS lengths) and `position`
(`top`/`right`/`bottom`/`left`, the static stick's center within its zone). Set either stick to `false`
to disable it. Default zones: left `{ left: 20, bottom: 20 }`, right `{ right: 20, bottom: 20 }`, sized
from the stick size.

## Recipes

### Default dual static sticks

Omit `virtualJoystickOptions` or pass only shared styling. Both sticks appear in the bottom corners.

### Floating right stick (look)

Source: .engine/src/systems/InputManager.ts (`VirtualJoystickOptions.right`, `mode: 'dynamic'`)
```typescript
virtualJoystickOptions: {
  right: {
    mode: 'dynamic',
    fadeTime: 250,
    zone: { top: 0, right: 0, bottom: 0, left: '50%' },
  },
}
```

The right stick spawns at the touch point, fades out on release, and the left stick keeps the static
default.

### Disable one stick

Source: .engine/src/systems/InputManager.ts (`resolveVirtualJoystickStickOptions`: `false` drops a stick)
```typescript
virtualJoystickOptions: {
  left: false,
  right: { mode: 'dynamic', zone: { top: 0, right: 0, bottom: 0, left: 0 } },
}
```

### Tune feel

`DefaultPlayerController.inputSettings` (classic pawns) and `GSSPlayerController.inputSettings` (GSS
pawns) both expose `joystickMovementSensitivity` (0.03) and `joystickLookSensitivity` (0.6). Move
input is the stick's offset from its start point (px) times the movement sensitivity, clamped to 0..1
per direction, so full speed arrives at ~33 px of travel; raise it to 0.05 for a small stick. Look is
offset × 0.6 × the look speed (0.05) × dt, about 1.5 rad/s at 50 px. The snippet setting all four is
in `SKILL.md`.

### Runtime visibility

Source: .engine/src/systems/InputManager.ts (`showVirtualJoystick`, `hideVirtualJoystick`, `isVirtualJoystickEnabled`)
```typescript
world.inputManager.showVirtualJoystick();
world.inputManager.hideVirtualJoystick();
world.inputManager.isVirtualJoystickVisible();
world.inputManager.isVirtualJoystickEnabled();
```

`isVirtualJoystickEnabled()` stays false until the sticks finish their lazy `nipplejs` load, so do not
use it at boot to decide whether to show touch buttons; use `ENGINE.isMobileBrowser()` or `FORCE_TOUCH`.

### Custom handling

Override `handleVirtualJoystick(index, joystickData)` on a `DefaultPlayerController` (or
`GSSPlayerController`) subclass to replace the default movement/look behavior. `joystickData.type` is
`'start'`, `'move'`, or `'end'`; `joystickData.position` is in screen pixels (+y down); `index` is
`VirtualJoystickIndex.Left` or `.Right`. For a direct `PlayerController` subclass, implement
`handleVirtualJoystick` from `IInputHandler`.

### Twin-stick aim and fire (right stick)

The right stick aims along its push and fires while pushed past a dead zone; the left stick keeps
the engine's move handling. Screen directions come from the camera: `screenRight = cameraForward ×
worldUp`, `screenUp = worldUp × screenRight`, which holds for any pitch or yaw of the camera.

Source: .engine/src/entities/DefaultPlayerController.ts (`handleVirtualJoystick`), .engine/src/entities/PawnActions.ts (`isCombatPawn`) (composed — typechecked against 18.1.0-alpha.317)
```ts
const DEAD_ZONE_PX = 12;
const UP = new THREE.Vector3(0, 1, 0);

/** Twin-stick: left stick moves (engine default), right stick aims and fires while pushed. */
@ENGINE.GameClass()
export class TwinStickController extends ENGINE.DefaultPlayerController {
  private aimStart: THREE.Vector2 | null = null;
  private firing = false;
  public override handleVirtualJoystick(index: ENGINE.VirtualJoystickIndex, data: ENGINE.VirtualJoystickData): boolean {
    if (index !== ENGINE.VirtualJoystickIndex.Right) return super.handleVirtualJoystick(index, data);
    const pawn = this.getPawn();
    if (data.type === 'end' || !this.aimStart) { this.aimStart = data.type === 'end' ? null : data.position.clone(); this.setFiring(pawn, false); return true; }
    const dx = data.position.x - this.aimStart.x;
    const dy = data.position.y - this.aimStart.y; // screen pixels, +y is down
    if (dx * dx + dy * dy < DEAD_ZONE_PX * DEAD_ZONE_PX) { this.setFiring(pawn, false); return true; }
    const camera = pawn?.getCamera();
    if (!pawn || !camera) return true;
    const forward = camera.getWorldDirection(new THREE.Vector3());   // cameras look along their -Z
    const screenRight = forward.clone().cross(UP).normalize();         // cross(cameraForward, worldUp)
    const screenUp = UP.clone().cross(screenRight);                    // ground direction of screen-up
    const aim = screenRight.multiplyScalar(dx).addScaledVector(screenUp, -dy);
    const face = (pawn as Partial<{ faceDirection(d: THREE.Vector3): void }>).faceDirection;
    face?.call(pawn, aim); // the top-down pawn in genesys-movement exposes faceDirection
    this.setFiring(pawn, true);
    return true;
  }
  private setFiring(pawn: ENGINE.Pawn | null, on: boolean): void {
    if (on === this.firing || !ENGINE.isCombatPawn(pawn)) return;
    this.firing = on;
    if (on) pawn.fire(); else pawn.endFire();
  }
}
```

Use `static` mode for the aim stick so the thumb finds it. The pawn's weapon must fire along the
visual's facing, not the root's (`genesys-combat`). Mouse twin-stick aim is `faceCursor` in
`genesys-movement`; both can run, the last input wins. Verify in Play: push the stick right and the
shots go screen-right.

### Zone CSS targeting

Each zone element carries `data-genesys-virtual-joystick-zone="left"` or `"right"` for project CSS.

## Modes

- `static` — fixed position within the zone (default).
- `dynamic` — spawns at the touch point, destroyed on release.
- `semi` — recycles the stick when the next touch lands within `catchDistance`.

## Related

- Input routing and the `InputManager` API: `genesys-engine`.
- On-screen buttons: [touch-buttons](touch-buttons.md); their styling: `genesys-ui`.
