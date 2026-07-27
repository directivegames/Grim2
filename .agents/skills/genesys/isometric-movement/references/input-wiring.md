# Input wiring

## WASD keyboard

Bind in your pawn's `setupInput` or `beginPlay`:

```ts
context.bindAxis('MoveForward', (value) => {
  this.movementComponent.forwardInput.value = value;
});
context.bindAxis('MoveRight', (value) => {
  this.movementComponent.rightInput.value = value;
});
```

Map `MoveForward` to W (−1) / S (+1) and `MoveRight` to A (−1) / D (+1) in your project's input config. Diagonal input (W+D) is automatically normalised by the component — the player moves at the same speed whether pressing one key or two.

## Mobile virtual stick

Call `setMobileStickInput` from your joystick's move and release callbacks:

```ts
joystick.onMove = (forward: number, right: number) => {
  this.movementComponent.setMobileStickInput(forward, right);
};

joystick.onRelease = () => {
  this.movementComponent.setMobileStickInput(0, 0);
};
```

Values are in the range −1 to +1. The same diagonal normalisation applies.

## Input locking

Set `inputLocked` whenever the player should not be able to move:

```ts
// On pause / cutscene start:
this.movementComponent.inputLocked = true;

// On resume:
this.movementComponent.inputLocked = false;
```

The character controller keeps running while locked — gravity and any queued teleport position still resolve. Do not call `resetRuntimeMotion` to implement locking because it clears the teleport buffer and resets accumulated gravity.

## Teleport and respawn

Always call `resetRuntimeMotion` before repositioning the pawn after a respawn or mission reset:

```ts
this.movementComponent.resetRuntimeMotion();
this.rootComponent.setWorldPosition(spawnPosition);
```

If you teleport via a physics position set (e.g. during a cutscene), you may skip `resetRuntimeMotion` — the component will handle position reconciliation on the next tick.
