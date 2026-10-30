# Top-down pan camera (RTS, strategy, map view)

Use for an RTS-style, strategy, city-builder, or overhead map camera that pans across a map and zooms.
It is not a walking character: `TopDownMovementNode` moves the pawn root with `addWorldPosition`, with
no collision and no gravity. A player-controlled top-down hero uses the character recipe in
`genesys-movement`.

Source: `.engine/src/nodes/movement/TopDownMovementNode.ts`.

## Overview

`TopDownMovementNode` moves the possessed pawn root on X/Z (pan) and optionally on Y or a child
camera's local Z (zoom). Attach a `THREE.Camera` as a child of the pawn root with a fixed pitch.
Input sources are toggled independently: keyboard, middle-mouse drag, edge scroll, and mouse wheel
need no game code. `DefaultPlayerController` forwards mouse down/up/move/wheel to
`MovementPawn.movementNode` before its own handling, so drag pan works without pointer lock.

`PanCameraRigComponent` and `TopDownPanMode` were removed. Use this node's `panSpace`, `zoomMode`, and
input toggles.

## Minimal setup

Source: .engine/src/nodes/movement/TopDownMovementNode.ts, .engine/src/entities/MovementPawn.ts
```typescript
const pawn = ENGINE.MovementPawn.create({
  movementNode: ENGINE.TopDownMovementNode.create({ panSpeed: 40, zoomSpeed: 30 }),
  position: ENGINE.MathHelpers.makeVector({ up: 50 }),
});

const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, 0.1, 1000);
pawn.add(camera);
pawn.setLocalRotation(ENGINE.MathHelpers.makeRotationDegrees({ pitch: -75 }));

const controller = ENGINE.DefaultPlayerController.create({ noPointerLock: true });
controller.possess(pawn);
```

## Pan

| Property | Default | Purpose |
| --- | --- | --- |
| `panSpace` | `world` | `world` = fixed X/Z; `cameraRelative` = pan follows camera yaw |
| `panYawPivotName` | `''` | Node name whose world yaw drives `cameraRelative` when there is no child camera; empty = root yaw |
| `panSpeed` | `10` | Keyboard/gamepad pan speed (world units/s), times `speedModifier` |
| `invertPan` | `false` | Flip keyboard pan axes |
| `clampToBounds` | `false` | Clamp X/Z via `setPanBounds()` |

| Input toggle | Default | Source |
| --- | --- | --- |
| `keyboardPanEnabled` | `true` | WASD / left stick via `DefaultPlayerController` |
| `mouseDragPanEnabled` | `false` | Middle-mouse drag, scaled by `dragPanSpeed` (0.35) |
| `edgeScrollEnabled` | `false` | Cursor within `edgeScrollMargin` (0.02 of the screen) of an edge, at `edgeScrollSpeed` (50) |

## Zoom

| `zoomMode` | Behavior |
| --- | --- |
| `rootY` (default) | Moves the pawn root on world Y (the camera child follows) |
| `cameraLocalOffset` | Sets the child camera's `position.z` between `zoomMin` (10) and `zoomMax` (200), starting at `zoomDefault` (50) |

| Input toggle | Default | Source |
| --- | --- | --- |
| `keyboardZoomEnabled` | `true` | Q/Z keys or gamepad triggers, at `zoomSpeed` (5) |
| `wheelZoomEnabled` | `false` | Mouse wheel, times `zoomWheelSpeed` (0.12) |

With `zoomMode: cameraLocalOffset`, `zoomToCursor: true` keeps the ground point under the cursor fixed
while zooming (it needs a child camera, and warns without one).

Runtime API: `setZoomDistance()` and `getZoomDistance()` (camera local Z only), `setFocalPoint(pos)`
(teleport X/Z, Y set to 0, then clamp), `setPanBounds(bounds | null)`, `isCameraPanning()`,
`cancelCameraInteraction()`.

## Presets

Keyboard-only overhead:

Source: .engine/src/nodes/movement/TopDownMovementNode.ts
```typescript
ENGINE.TopDownMovementNode.create({
  keyboardPanEnabled: true,
  keyboardZoomEnabled: true,
  zoomMode: ENGINE.TopDownZoomMode.RootY,
})
```

RTS mouse camera (replaces the old `screenRelative` + `PanCameraRigComponent`):

Source: .engine/src/nodes/movement/TopDownMovementNode.ts
```typescript
ENGINE.TopDownMovementNode.create({
  keyboardPanEnabled: false,
  mouseDragPanEnabled: true,
  edgeScrollEnabled: true,
  wheelZoomEnabled: true,
  panSpace: ENGINE.TopDownPanSpace.CameraRelative,
  zoomMode: ENGINE.TopDownZoomMode.CameraLocalOffset,
  zoomToCursor: true,
})
```

## Map bounds

Source: .engine/src/nodes/movement/TopDownMovementNode.ts
```typescript
movementNode.setPanBounds({ minX: -100, maxX: 100, minZ: -100, maxZ: 100 });
movementNode.clampToBounds = true;
```

## Related

- Possession and movement-node forwarding: `genesys-engine`.
- Unit selection, click-to-move, and pathing: `genesys-navigation`.
