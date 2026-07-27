---
name: isometric-movement
description: Use when implementing Vampire Survivors or twin-stick style isometric player movement in a Genesys project. Covers fixed-angle world-axis movement, diagonal normalisation, mobile virtual stick input, input locking for pause/cutscenes, and teleport buffering on a CharacterMovementComponent.
---

Copy [assets/IsometricMovementComponent.ts](assets/IsometricMovementComponent.ts) into your project.

## Add to a pawn

In your pawn's `initialize`:

```ts
import {
  IsometricMovementComponent,
  ISO_YAW,
  ISO_FORWARD_AXIS,
  ISO_RIGHT_AXIS,
} from './IsometricMovementComponent.js';

// Movement component
const movement = IsometricMovementComponent.create({ actor: this });
this.movementComponent = movement;

// Camera rig — fixed isometric angle, root never rotates
const pivot = ENGINE.SceneComponent.create({ actor: this, attachTo: this.rootComponent });
pivot.setWorldRotationEuler(ISO_PITCH, ISO_YAW, 0);  // ISO_PITCH = -Math.atan(1 / Math.sqrt(2))
const arm = ENGINE.SpringArmComponent.create({ actor: this, attachTo: pivot, length: 15 });
ENGINE.CameraComponent.create({ actor: this, attachTo: arm });
```

`ISO_YAW` is 45° (π/4). `ISO_PITCH` is -35.26° (−arctan(1/√2)) — declare it in your pawn: `const ISO_PITCH = -Math.atan(1 / Math.sqrt(2));`

## Bind WASD input

```ts
// In setupInput or beginPlay:
context.bindAxis('MoveForward', (v) => { this.movementComponent.forwardInput.value = v; });
context.bindAxis('MoveRight',   (v) => { this.movementComponent.rightInput.value = v; });
```

See [references/input-wiring.md](references/input-wiring.md) for mobile stick and full binding examples.

## Visual mesh facing

The component never rotates the root. Read the heading each tick and smooth-rotate your visual mesh:

```ts
const yaw = this.movementComponent.getMovementHeadingYaw();
if (yaw !== null) {
  // lerp or slerp your mesh rotation toward yaw
  const current = this.visualMesh.rotation.y;
  this.visualMesh.rotation.y += (yaw - current) * Math.min(1, rotateSpeed * deltaTime);
}
```

## Lock input during pause, cutscenes, or menus

```ts
this.movementComponent.inputLocked = true;   // zeros inputs; physics still runs
this.movementComponent.inputLocked = false;  // restores
```

The character controller runs even when locked so gravity resolves and buffered teleports execute.

## Respawn or teleport

Clear buffered velocity before repositioning the pawn:

```ts
this.movementComponent.resetRuntimeMotion();
pawn.rootComponent.setWorldPosition(spawnPos);
```

## Root component requirement

The root component must have `PhysicsMotionType.KinematicVelocityBased` for the character controller path. If your root is static or dynamic, the component falls back to direct position updates (no collision response).

## Adaptation required

- Wire `inputLocked` to your own pause/cutscene/modal state.
- `ISO_YAW` and `ISO_PITCH` are exported constants — changing `ISO_YAW` changes both movement axes and should be matched by the camera pivot rotation.
- `speedModifier` property is available at runtime for sprint, slow, or debuff effects.
- For multiplayer: the `_trackNetTransform` method passes position snapshots to a `movementPredictor` if present on the owner actor — this is an engine-internal hook and is a no-op if the predictor is absent.
