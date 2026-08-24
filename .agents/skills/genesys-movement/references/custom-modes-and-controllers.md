# Custom Modes, Transitions, and Controllers

## Writing a custom IMovementMode

Implement `.engine/src/nodes/movement/mover/IMovementMode.ts`'s interface:

```typescript
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

class SwimmingMode implements ENGINE.IMovementMode {
  public readonly transitions: ENGINE.IMoverTransition[] = [];
  public maxSpeed = 4;

  public onActivate(_mover: ENGINE.MoverNode): void {}
  public onDeactivate(_mover: ENGINE.MoverNode): void {}

  public generateMove(
    startData: ENGINE.MoverTickStartData,
    _timeStep: ENGINE.MoverTimeStep,
  ): ENGINE.ProposedMove {
    const dir = startData.inputCmd.moveInput.clone();
    if (dir.lengthSq() > 1) dir.normalize();
    return { velocity: dir.multiplyScalar(this.maxSpeed), mixMode: ENGINE.MoveMixMode.Override };
  }

  public simulationTick(params: ENGINE.SimulationTickParams): ENGINE.MoverTickEndData {
    const { startData, proposedMove, timeStep } = params;
    const deltaTime = Math.min(timeStep.stepMs / 1000, 0.2);
    const syncState = { ...startData.syncState, custom: startData.syncState.custom.clone(), tags: ['mover.swimming'] };
    syncState.position.addScaledVector(proposedMove.velocity, deltaTime);
    return { syncState, auxState: { custom: startData.auxState.custom.clone() } };
  }
}
```

Required members:

- `transitions: IMoverTransition[]` — outgoing automatic transitions, checked at the end of
  every tick this mode is active. `[]` if none.
- `generateMove(startData, timeStep): ProposedMove` — pure intent, no side effects. Read
  `startData.inputCmd`/`syncState`/`auxState`; do not mutate them or touch the physics engine
  here. This may run ahead of `simulationTick` (layered moves are applied to its output first).
- `simulationTick(params): MoverTickEndData` — the only place to call into physics/collision
  (e.g. `mover.getPhysicsEngine()`), and the only place that produces the authoritative
  `syncState`/`auxState` for the tick. Always clone `startData.syncState`/`auxState` rather than
  mutating them in place (see the built-in modes' `cloneSyncState` helper pattern in
  `CharacterMovementShared.ts`).
- `onActivate(mover)` / `onDeactivate(mover)` — called on every switch into/out of this mode.
- Optional `cleanup(mover)` — called from `MoverNode.endPlay` for every registered mode
  (active or not). Use for resources that outlive mode switches (a shared physics controller);
  make it idempotent if multiple modes share the same resource (see `WalkingMode`/`FallingMode`).
- Optional `onPostPhysics(mover, deltaTime)` — runs on the mode that was just simulated, before
  a queued mode switch is applied. Use for post-physics-only work (`VehicleMode` uses this for
  its max-speed clamp and wheel-mesh visual update).

Set `syncState.tags` to a short, dot-namespaced string array (built-ins use a `'mover.'` prefix,
e.g. `'mover.onGround'`) so `mover.hasSyncTag(tag)` prefix-matching stays useful.

## Writing a custom IMoverTransition

```typescript
class ToSwimmingTransition implements ENGINE.IMoverTransition {
  evaluate(startData: ENGINE.MoverTickStartData, mover: ENGINE.MoverNode): string | null {
    return mover.hasSyncTag('mover.inWater', true) ? 'swimming' : null;
  }
}
```

`evaluate(startData, mover): string | null` returns a target mode name or `null` to stay. Only
the first transition (in `IMovementMode.transitions` array order) that returns non-null wins per
tick. A transition can inspect `startData.inputCmd.suggestedMode` itself to decide whether
physics-driven detection should always win (ignore it) or input should override physics (check
it) — see the two contrasting examples in `IMoverTransition.ts`'s doc comment.

## Writing a custom IMovementInputProducer / controller

`MoverPlayerController` (`.engine/src/entities/MoverPlayerController.ts`) is the reference
implementation for a biped Walking/Falling controller. The contract:

```typescript
export interface IMovementInputProducer {
  produceInput(simTimeMs: number, cmd: MovementInputCmd): void;
}
```

`produceInput` is called once per tick, in registration order, for every producer registered on
a `MoverNode`. `cmd` arrives pre-initialised with zero/false values — accumulate/merge into it
rather than unconditionally overwriting, since multiple producers (e.g. a player controller
plus a temporary ability override) may be registered on the same `MoverNode` simultaneously.

Wiring pattern, verified from `MoverPlayerController`:

```typescript
@ENGINE.GameClass()
class VehicleController extends ENGINE.PlayerController implements ENGINE.IMovementInputProducer {
  private moverNode: ENGINE.MoverNode | null = null;

  protected override onPossess(pawn: ENGINE.Pawn): void {
    super.onPossess(pawn);
    this.moverNode = pawn.getNode(ENGINE.MoverNode);
    this.moverNode?.addInputProducer(this);
  }

  protected override onUnpossess(pawn: ENGINE.Pawn): void {
    this.moverNode?.removeInputProducer(this);
    this.moverNode = null;
    super.onUnpossess(pawn);
  }

  public produceInput(_simTimeMs: number, cmd: ENGINE.MovementInputCmd): void {
    // VehicleMode reads moveInput.z as throttle, moveInput.x as steering, jumpPressed as handbrake.
    cmd.moveInput.z += this.throttle;
    cmd.moveInput.x += this.steering;
    cmd.jumpPressed = cmd.jumpPressed || this.handbrakeHeld;
  }

  private throttle = 0;
  private steering = 0;
  private handbrakeHeld = false;
}
```

Key points, all verified against `MoverPlayerController`:

- Get the `MoverNode` off the possessed pawn with `pawn.getNode(ENGINE.MoverNode)` in
  `onPossess` (a protected hook on `Controller`/`PlayerController`, called after possession is
  established) — do not assume the pawn exposes a `movementNode`-style property.
  `MoverCharacterPawn.getMoverNode()` also works if the pawn type is known statically.
  `MoverPlayerController` warns and no-ops if the possessed pawn has no `MoverNode`.
- Call `moverNode.addInputProducer(this)` in `onPossess` and
  `moverNode.removeInputProducer(this)` in `onUnpossess` — mirror the lifecycle exactly, or the
  controller keeps producing input for a pawn it no longer possesses.
- `MoverPlayerController` is Walking/Falling-only. Its own doc comment states other
  locomotion styles (vehicle, airplane, top-down) need dedicated controllers that write the axis
  layout those specific modes expect (see [mover-modes](mover-modes.md) for each mode's axis
  mapping) — do not subclass or reuse it for a vehicle/airplane/top-down pawn; write a new
  `IMovementInputProducer` as shown above instead.
- An AI/NPC driver does not need a `PlayerController` at all — anything implementing
  `IMovementInputProducer` can register on a `MoverNode` (see `IMovementInputProducer.ts`'s own
  doc comment, which explicitly calls out an `AIController` steering toward a navigation target
  as a valid producer alongside `PlayerController`).
