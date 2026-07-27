Use when the user wants an RTS-style, strategy, or overhead camera that pans across a map and zooms in/out.

## Overview

`TopDownMovementComponent` moves the possessed pawn root on X/Z (pan) and optionally on Y or via a child camera local Z (zoom). Attach a `THREE.Camera` as a child of the pawn root with a fixed pitch (typical overhead angle). Input sources are toggled independently — keyboard, middle-mouse drag, edge scroll, and mouse wheel do not require separate game code.

`PanCameraRigComponent` and `TopDownPanMode` were removed. Use this component's `panSpace`, `zoomMode`, and input toggles instead.

## Minimal Setup

```typescript
const pawn = ENGINE.MovementPawn.create({
  movementComponent: ENGINE.TopDownMovementComponent.create({
    panSpeed: 40,
    zoomSpeed: 30,
  }),
  position: ENGINE.MathHelpers.makeVector({ up: 50 }),
});

const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, 0.1, 1000);
pawn.rootComponent.add(camera);
pawn.rootComponent.setLocalRotation(ENGINE.MathHelpers.makeRotationDegrees({ pitch: -75 }));

const controller = ENGINE.DefaultPlayerController.create({ noPointerLock: true });
controller.possess(pawn);
```

Reference: engine demos `navigation.ts` and `timer.ts`.

## Pan

| Property | Default | Purpose |
| --- | --- | --- |
| `panSpace` | `world` | `world` = fixed X/Z; `cameraRelative` = pan follows yaw |
| `panYawPivotName` | `''` | SceneComponent name for yaw when `cameraRelative`; empty = root yaw |
| `panSpeed` | `10` | Keyboard/gamepad pan speed |
| `invertPan` | `false` | Flip keyboard pan axes |
| `clampToBounds` | `false` | Clamp X/Z via `setPanBounds()` |

| Input toggle | Default | Source |
| --- | --- | --- |
| `keyboardPanEnabled` | `true` | WASD / left stick via `DefaultPlayerController` |
| `mouseDragPanEnabled` | `false` | Middle-mouse drag |
| `edgeScrollEnabled` | `false` | Cursor near screen edge |

Mouse drag and edge scroll are forwarded automatically through `DefaultPlayerController` → `MovementPawn.movementComponent` — no pawn delegate wiring required.

## Zoom

| `zoomMode` | Behavior |
| --- | --- |
| `rootY` | Moves pawn root on world Y (camera child follows) |
| `cameraLocalOffset` | Adjusts child camera `position.z` between `zoomMin` / `zoomMax` |

| Input toggle | Default | Source |
| --- | --- | --- |
| `keyboardZoomEnabled` | `true` | Q/Z keys or gamepad triggers |
| `wheelZoomEnabled` | `false` | Mouse wheel |

When `zoomMode` is `cameraLocalOffset`, set `zoomToCursor: true` to keep the ground point under the cursor fixed while zooming (requires a child camera).

Runtime API: `setZoomDistance()`, `getZoomDistance()` (camera local Z only).

## Presets

**Keyboard-only overhead (engine demo default):**

```typescript
ENGINE.TopDownMovementComponent.create({
  keyboardPanEnabled: true,
  keyboardZoomEnabled: true,
  zoomMode: ENGINE.TopDownZoomMode.RootY,
})
```

**RTS mouse camera (replaces old `screenRelative` + `PanCameraRigComponent`):**

```typescript
ENGINE.TopDownMovementComponent.create({
  keyboardPanEnabled: false,
  mouseDragPanEnabled: true,
  edgeScrollEnabled: true,
  wheelZoomEnabled: true,
  panSpace: ENGINE.TopDownPanSpace.CameraRelative,
  zoomMode: ENGINE.TopDownZoomMode.CameraLocalOffset,
  zoomToCursor: true,
})
```

## Map Bounds

```typescript
movementComponent.setPanBounds({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
movementComponent.clampToBounds = true;
```

## Related

- [Pawn and PlayerController](../references/pawn-player-controller.md) — possession and movement component forwarding.
- [Input Handling](../references/input-handling.md) — `PlayerController` input routing.
- [Camera System](../references/camera.md) — child camera on pawn, `Actor.getCamera()`.
