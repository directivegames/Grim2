# Custom Movement Modes, Transitions, and Controllers

## Writing a custom IGSSMovementMode

Implement the `IGSSMovementMode` contract from `.engine/src/gameplay-sim/IGSSMovementMode.ts`:

```typescript
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

class SwimmingMode implements ENGINE.IGSSMovementMode {
  public readonly id = 'swimming';
  public readonly transitions: ENGINE.IGSSMovementModeTransition[] = [];
  public maxSpeed = 4;

  public onActivate(_target: ENGINE.SceneNode): void {}
  public onDeactivate(_target: ENGINE.SceneNode): void {}

  public generateMove(ctx: ENGINE.GSSMovementContext): ENGINE.GSSDesiredMove {
    const dir = ctx.input.moveInput.clone();
    if (dir.lengthSq() > 1) dir.normalize();
    return { velocity: dir.multiplyScalar(this.maxSpeed) };
  }

  public tick(
    ctx: ENGINE.GSSMovementSimContext,
    proposedMove: ENGINE.GSSDesiredMove,
    dt: number,
  ): void {
    ctx.translate(proposedMove.velocity, dt);
    ctx.setVelocityFrom(proposedMove.velocity);
  }
}
```

Register on the pawn, in `createGSSNode()`:

```ts
protected override createGSSNode(): ENGINE.GSSNode {
  const sim = super.createGSSNode();
  sim.addMovementMode(new SwimmingMode());
  return sim;
}
```

Required members:

- `id` — registration id, also the target of `queueMovementMode` and transitions.
- `transitions` — outgoing automatic transitions, checked after movement.
- `generateMove(ctx)` — intent only; do not call physics and do not mutate anything.
- `tick(ctx, proposedMove, dt)` — resolve the proposed move (character controller, etc.)
  through `ctx`; `dt` is in seconds.
- `onActivate(target)` / `onDeactivate(target)` — mode switch hooks.
- Optional `cleanup(target)`, `onPostPhysics(target)`, `applySyncState(target, state)`,
  `getRewindRadius(dt, attrs)`. `tick` and `getRewindRadius` take seconds. `onPostPhysics` runs after the physics step and takes no delta.

### The two contexts

A mode never sees the sim node or its `GSSSyncState`. It gets a context instead, in two
flavours over the same object:

- `GSSMovementContext` — the read view, handed to `generateMove` and to transitions. Input, input-tag
  edges, attributes, tags, custom data, pose getters, and `target`. Vector/Euler getters return
  copies; `getPositionX()` / `getYaw()` / `getVelocityX()` and the rest return scalars with no
  allocation.
- `GSSMovementSimContext` — the write view, handed only to `tick`. Everything above plus
  `setPosition(x, y, z)` / `setPositionX/Y/Z` / `setPositionFrom(v)`, `translate(delta, scale?)`,
  `setRotation(pitch, yaw, roll, order?)` / `setPitch` / `setYaw` / `setRoll` /
  `setRotationFrom(euler)`, `setVelocity(x, y, z)` / `setVelocityX/Y/Z` / `setVelocityFrom(v)`, and
  writable `tags` / `custom`. Component setters leave the other axes alone. Omitting `order` on
  `setRotation` keeps the current Euler order.

Splitting them is what keeps "decide" free of side effects, which is what makes a tick safe to
replay when a correction arrives.

`tick` writes through `ctx` and nothing else. The node applies the resulting position and
rotation to the target in world space as soon as the mode returns, so a mode that also writes the
target duplicates that work and risks disagreeing with it. Use `ctx.target` only to read, to sweep a
character controller, or to set `setPhysicsTransformUpdateFlags` — the physics-integration policy is
the mode's, since only the mode knows whether it drives the body kinematically or lets physics own
it. The hooks that run outside a tick (`onActivate` and friends) get `target` directly, and it is
also the identity to register a character controller under.

When a mode owns something the node cannot place on its own — a character controller's body, say —
implement `applySyncState(target, state)` to reconcile it after a correction. `state` is a
`GSSStateReader`: pose, attributes, tags, and custom data, all read-only. Without it the node
just teleports the target.

## Writing a custom IGSSMovementModeTransition

```typescript
class ToSwimmingTransition implements ENGINE.IGSSMovementModeTransition {
  evaluate(ctx: ENGINE.GSSMovementContext): string | null {
    return ctx.tags.has(ENGINE.GSSTags.Falling) ? null : 'swimming';
  }
}
```

First non-null `evaluate` result wins. `GSSNode.queueMovementMode(id, priority)` overrides
when something (an ability or effect) requests a switch this tick.

## Writing a custom IGSSInputProducer / controller

`GSSPlayerController` is the reference biped producer: it writes `moveInput`,
`controlRotation`, and currently-down input tags (`input.Jump`, `input.Dash`, …). It does **not**
detect edges.

`AIController` implements the same producer against `GSSNode` for path follow / look-at.

```typescript
class MyProducer implements ENGINE.IGSSInputProducer {
  produceInputCmd(cmd: ENGINE.GSSInputCmd, _dt: number): void {
    cmd.moveInput.set(0, 0, 1);
    ENGINE.tagSetAdd(cmd.inputTagsDown, ENGINE.GSSTags.InputJump);
  }
}

sim.setInputProducer(new MyProducer());
```

A sim node has **one** producer — `setInputProducer` replaces whatever was there and warns, since
that usually means two controllers are fighting over the same pawn. Clear it with
`setInputProducer(null)` when the owner goes away, guarded by `getInputProducer() === this` so a
late unpossess cannot clear a producer that has already been replaced.

`cmd` belongs to the node: fill it, never retain it. `dt` is the tick delta in seconds — use it for
rate-based work (physics, gamepad look, turn rate) rather than deriving a delta from sim time.
