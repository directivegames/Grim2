# Custom Movement Modes, Transitions, and Controllers

## Writing a custom IGSSMovementMode

Implement the `IGSSMovementMode` contract from `.engine/src/gameplay-sim/IGSSMovementMode.ts`. A body
mode that must collide (swim, glide, wall-run) is easiest as a subclass of `GSSFallingMode` or
`GSSWalkingMode`: they own the character-controller sweep, and the shared controller helpers are not
exported. Every mode needs a way in and a way out.

Example: swimming. A trigger volume sets an external tag; walking and falling switch to `swimming`
while it is held; swimming leaves when it is gone.

Source: .engine/src/gameplay-sim/modes/GSSFallingMode.ts, IGSSMovementModeTransition.ts, GSSNode.ts (`addExternalTagId`), .engine/src/nodes/gameplay/TriggerZoneNode.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
export const IN_WATER = ENGINE.GSSTagRegistry.register('status.InWater'); // external tag, set by the volume

class EnterWater implements ENGINE.IGSSMovementModeTransition {
  public evaluate(ctx: ENGINE.GSSMovementContext): string | null {
    return ctx.tags.has(IN_WATER) ? 'swimming' : null;
  }
}
class LeaveWater implements ENGINE.IGSSMovementModeTransition {
  public evaluate(ctx: ENGINE.GSSMovementContext): string | null {
    return ctx.tags.has(IN_WATER) ? null : 'falling'; // falling hands over to walking on contact
  }
}

/** Falling-mode subclass: inherits the controller sweep, so walls and the pool floor collide. */
export class SwimmingMode extends ENGINE.GSSFallingMode {
  public swimUp = 3;   // m/s while Jump is held
  public sink = -1;    // m/s otherwise
  public speedScale = 0.6;
  constructor() {
    super({ id: 'swimming', maxMidAirJumps: 0, accelerationLambda: 4, decelerationLambda: 2 });
    this.transitions.length = 0;          // drop falling's "grounded → walking" exit
    this.transitions.push(new LeaveWater());
  }
  public override generateMove(ctx: ENGINE.GSSMovementContext, proposals: readonly ENGINE.GSSProposedMove[]): ENGINE.GSSDesiredMove {
    const move = super.generateMove(ctx, proposals); // MoveSpeed attribute, camera-relative, proposals mixed
    move.velocity.x *= this.speedScale;
    move.velocity.z *= this.speedScale; // leave Y: it is the current vertical speed plus any effect
    return move;
  }
  public override tick(ctx: ENGINE.GSSMovementSimContext, move: ENGINE.GSSDesiredMove, dt: number): void {
    const target = ctx.inputTags.has(ENGINE.GSSTags.InputJump) ? this.swimUp : this.sink;
    const g = (ctx.target.getPhysicsEngine()?.getOptions()?.gravity.y ?? -9.81) * this.characterControllerOptions.simulatedGravityScale;
    // super.tick adds g*dt to move.velocity.y; pre-subtract it so the net vertical speed is the damped swim target
    const vy = THREE.MathUtils.damp(ctx.getVelocityY(), target, 6, dt);
    move.velocity.y = vy - g * Math.min(dt, 0.2);
    super.tick(ctx, move, dt);
  }
}

/** Trigger volume over the water. Place it with MCP; size it to the swimmable depth. */
@ENGINE.GameClass()
export class WaterVolume extends ENGINE.TriggerZoneNode {
  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.onActorEntered.add((actor) => actor.getNode(ENGINE.GSSNode)?.addExternalTagId(IN_WATER));
    this.onActorExited.add((actor) => actor.getNode(ENGINE.GSSNode)?.removeExternalTagId(IN_WATER));
    return true;
  }
}
```

Register on the pawn, in `createGSSNode()`. Walking and falling get the way in; the first non-null
transition wins, so put it first.

Source: .engine/src/gameplay-sim/entities/GSSCharacterPawn.ts (`createGSSNode`) (composed — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class Swimmer extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    const walking = new ENGINE.GSSWalkingMode();
    const falling = new ENGINE.GSSFallingMode();
    walking.transitions.unshift(new EnterWater());
    falling.transitions.unshift(new EnterWater());
    sim.addMovementMode(walking);                  // replace in place, now with a way into water
    sim.addMovementMode(falling);
    sim.addMovementMode(new SwimmingMode());
    return sim;
  }
}
```

Size the volume to the swimmable depth: inside it the pawn always swims, so shallow water left outside it stays walking. Swim animation is
presentation: react to `onMovementModeChanged` ([gss-mechanics](gss-mechanics.md)). Overlap events
between a trigger and the kinematic character capsule, and the in-water feel, verify in Play. A mode
written from scratch (no subclass) must collide on its own: `ctx.translate` alone moves through
geometry, like `GSSIdleMode`'s effect displacement.

Required members:

- `id` — registration id, also the target of `queueMovementMode` and transitions.
- `transitions` — outgoing automatic transitions, checked after movement.
- `generateMove(ctx, proposals)` — the desired velocity for this tick, from input and the effect proposals. Do not call physics and do not mutate anything. `mixProposedMoves(seed, proposals)` applies each proposal per axis. A mode that ignores `proposals` does not move from effects.
- `tick(ctx, proposedMove, dt)` — integrate that desired move (character controller, etc.)
  through `ctx`; `dt` is in seconds. `proposedMove.velocity` is already resolved, including effect contributions the mode chose to mix.
- `onActivate(target)` / `onDeactivate(target)` — mode switch hooks.
- Optional `onTeleported(ctx)` (runs instead of `tick` on a teleport tick), `cleanup(target)`, `onPostPhysics(target)`, `applySyncState(target, state)`,
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

A transition reads the `GSSMovementContext` (read-only) and returns a mode id or `null`. `EnterWater`
and `LeaveWater` above are complete examples. Transitions live on the mode's `transitions` array
(readonly property, mutable array): `push` adds a fallback, `unshift` adds a priority check.

First non-null `evaluate` result wins. An ability or effect requests a switch this tick with
`ctx.movement.queueMovementMode(id, priority?)`; the switch runs in post-physics.

## Writing a custom IGSSInputProducer / controller

`GSSPlayerController` is the reference biped producer: it writes `moveInput`,
`controlRotation`, and currently-down input tags (`input.Jump`, `input.Dash`, …). It does **not**
detect edges.

`AIController` implements the same producer against `GSSNode` for path follow / look-at.

Source: .engine/src/gameplay-sim/IGSSInputProducer.ts, entities/GSSPlayerController.ts
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
