# GSS mechanics

GSS (Gameplay Simulation System) is the networked simulation: replication, prediction, rollback, and reconciliation.

Source: `.engine/src/gameplay-sim/` (`GSSNode.ts`, `types.ts`, `IGSSMovementMode.ts`,
`IGSSMovementModeTransition.ts`, `IGSSInputProducer.ts`, `GSSNetPredictionState.ts`).

## GSSNode

`GSSNode` extends `SceneNode` and attaches to a pawn. It knows nothing about specific
modes, abilities, or effects — the owning pawn creates it and fills it in
`createGSSNode()`, before the node is parented. You should not need to subclass it.

Each registry is keyed by the content's own `id` and assigns dense indices in registration order;
those indices travel in Sync, history, and corrections, so registration order must match on every
peer. Registering from one method on the pawn is what keeps that order identical everywhere —
never register from a lifecycle hook, event subscriber, or anything else whose ordering depends
on scene-tree layout, because reordering nodes would then shift indices and desync clients.

Re-registering an existing id replaces that entry and keeps its index — that is the supported way
to override base content after `super.createGSSNode()`. Applying or triggering an
unregistered id warns and is ignored; nothing registers lazily at apply time.

```ts
class MyPawn extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    sim.addMovementMode(new SwimmingMode());
    sim.addAbility(new GrappleAbility());
    return sim;
  }
}
```

`startingMovementModeId` selects the mode activated at `beginPlay`; empty or unregistered falls back to
the first registered mode. Seed base attributes alongside registration with
`setBaseAttribute(tagId, value)`.

Registering no modes at all is allowed — a sim node is a usable ability, attribute, and tag
container on its own, and it leaves the target's transform to whatever else moves the actor. Be
aware that it then has no movement of **any** kind: `simulate()` still collects
`IGSSEffect.proposeMove` proposals and mixes them, but with no mode to consume the result it is
discarded, so knockback and launch effects silently do nothing. When an actor should hold still yet
stay pushable, register `GSSIdleMode` rather than leaving the mode list empty.

## Sync is private

`Sync` is the simulation's own state — local, not a replicated property. Non-owners receive
`proxyState`; the owning client receives `replicatedAckSequence`. Corrections travel through RPCs.

The node keeps it private, because a tick has to produce the same result every time it replays and
it cannot if anything outside the simulation writes to it. Gameplay code reaches it through the
context it is handed (`GSSMovementContext`, `GSSAbilityContext`, `GSSEffectContext`, `GSSCueContext`), which is
the only place writes are allowed. Everyone else reads:

| Call | Returns |
| --- | --- |
| `getPosition()` / `getRotation()` / `getVelocity()` | A copy of the simulated pose |
| `getPositionX/Y/Z()`, `getPitch()` / `getYaw()` / `getRoll()`, `getVelocityX/Y/Z()` | Scalar components, no allocation |
| `getAttribute(tagId)` | Base attribute value, or `null` if it was never set. A stored `0` is a real zero. Excludes this tick's temp modifiers |
| `hasGSSTag(tagId)` | Whether a sim or external tag is held |
| `getActiveMovementModeId()` | The id of the mode driving the simulation |

Every one of these hands back a copy, so there is no writable path in from outside.

Typed custom-data accessors (`gssGetFloat` / `gssSetFloat`, and the matching `Int`, `Uint`,
`Bool`, `String`, `Vector2`, `Vector3`, `Euler`, `Quaternion` pair) take a
`GSSCustomReader` or `GSSCustomWriter` — `ctx.custom` on ability, effect, movement, and
cue contexts. Vector/Euler/quaternion getters copy out (pass an `out` argument to avoid
allocating); setters copy in. Omit the reconcile argument on a later write to keep the stored
threshold.

That also means there is no way to reposition a sim-driven actor by assignment. A respawn,
teleporter, or cutscene move has to go through the simulation so that it replays identically: apply
an effect, run an ability, or set an external tag a mode reacts to. `setSyncState` looks like the
exception but is not — it is the correction path, called by prediction with authoritative state.

## The movement target

The node writes the simulated pose onto one node, its **target**. Unset, that is the entity root,
so a sim node dropped under a pawn moves the pawn. Pass `target` at creation to drive something else
— a sub-node of a larger actor, for instance. The target is what a character controller sweeps and
what the simulated position and rotation land on each tick, and it is the identity a mode registers
its character controller under.

The target is fixed for the node's lifetime: it is resolved once at `beginPlay` and there is no
setter, since swapping it mid-play would strand every controller and ability keyed on the old one.
It is not serialized either, so pass the option every time the node is built, next to the content
registration.

Movement modes never touch the target's transform; they write through the context and the node
applies the result, in world space, right after `tick`. Writing an actor's transform
directly therefore will not stick while a sim node drives it.

## Presentation events

Two delegates carry simulation results out to whatever renders them, so nothing has to reach into
the sim node or find nodes by name.

| Delegate | Payload | Fires |
| --- | --- | --- |
| `onVisualOffsetChanged` | `(offset: THREE.Vector3)` | The net-correction smoothing offset changed |
| `onMovementModeChanged` | `(previousId: string, nextId: string)` | The presented movement mode changed |

Both fire at the end of `tickPostPhysics`, after the queued mode is flushed, so the id you are
handed matches `getActiveMovementModeId()` for the rest of the frame. `onMovementModeChanged` is derived by
comparing presented frames rather than hooked to mode activation, so correction replay — which
reactivates modes many times in one frame — cannot make it fire spuriously. Cues get the same
information without a subscription through `GSSCueContext.movementModeId`.

`onVisualOffsetChanged` reuses one vector; read it, never retain it. The offset is in world units
and deliberately unapplied: putting it on the simulated node would drag collision and the camera
along with the blend. Add it to a child visual instead, rotating it into that child's parent space
first — `GSSCharacterPawn` does exactly this with its mesh:

```ts
class MyPawn extends ENGINE.GSSCharacterPawn {
  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.getGSSNode().onMovementModeChanged.add(this.onMovementModeChanged);
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    this.getGSSNode().onMovementModeChanged.remove(this.onMovementModeChanged);
    return true;
  }

  private readonly onMovementModeChanged = (_from: string, to: string): void => {
    if (to === 'swimming') this.playSplash();
  };
}
```

## Tick pipeline

Each simulating tick:

1. Derive press/release edges from `input.inputTagsDown` and `sync.prevInputTagsDown`.
2. Run effect `modifyAttributes` pass A.
3. Run abilities (`shouldRun`, `onActivate`, `execute`, cooldown).
4. Run newly applied effects' `onApplied`, then `onTick`.
5. Run effect `modifyAttributes` pass B.
6. Collect effect movement proposals, then run the active mode.
7. Expire instant, timed, or explicitly removed effects after movement.
8. Queue transitions. The switch itself runs in post-physics, after the simulated mode's `onPostPhysics` and before the network digest, so that mode finishes before `onDeactivate` and the hashed state includes the new mode.
9. Store `prevInputTagsDown`.

Both attribute passes are snapshotted, and `ctx.attributes.get()` is phase-dependent: abilities
read the pass-A aggregate, effect `onApplied` / `onTick` read base, and modes get a read-only
reader over the pass-B aggregate. On ability and effect contexts, `getBase()` reads base directly
and every write (`add`, `subtract`, `set`, `tryConsume`) lands on base — temp modifiers from
`modifyAttributes` are discarded at the end of the tick, so only base survives and replicates.

A sim node pulls from a single input producer (`setInputProducer`), which reports currently-down
tags only. The sim node owns edge detection so correction replay and repeated inputs cannot
double-fire press-triggered abilities.

GSS and network-prediction bookkeeping uses integer milliseconds. `GSSTimeStep`
exposes `simTimeMs`, `dtMs`, and `traceTimeMs`; effect `durationMs` / `elapsedMs` and ability
cooldown durations use the same unit. Per-tick callbacks receive `dt` in seconds: input producers,
abilities, effects, movement `tick`, rewind-radius hooks, and cues. `onPostPhysics` takes no delta.

## Prediction

When `useNetworkPrediction` is true and `NetPredictionManager` is initialized:

- Autonomous proxies predict and save moves in pre-physics. The digest is built after the post-physics mode switch and sent as `serverReceiveGameplayInput`.
- The server flushes every caught-up input except the last during the drain, then hashes at the same post-physics point and sends `clientCorrectGameplayState` on divergence or possession.
- Correction replay applies saved external-tag operations before re-simulation and rewrites
  rewind history.

Prediction-aware queries are available through `GSSAbilityContext.world.raycast`, `raycastAll`,
`sweepShape`, and `overlapShape`. The same ability code runs on client and server: clients query
the present world, while the dedicated server rewinds only for player-owned authoritative nodes.
For several queries against one rewind, open a disposable session with
`GSSAbilityContext.world.beginQueries(rewindVolume)` and close it with `using` or `end()`. Trace time
accounts for the authored interpolation delay.

Movement ticks also rewind nearby `IRewindable` nodes (`rewindInRadius` around the sim pose)
before `tick`, then restore them. `GSSNode` registers as rewindable;
`NetRewindablePhysicsProp` is the shipped pattern for barrels, crates, and similar props.
Classic `BasePawnMovementNode` pawns do not implement `IRewindable`. Mixing classic locomotion
on some pawns and GSS on others is therefore safe only when they do not interact
through collision, traces, or effects. Contact with a non-rewindable pawn uses present pose
instead of sim-time pose, so dashes, jumps, knockback, and hit confirmation diverge. Making
those pawns trustworthy partners means adding history, `rewind`/`restore`, registration with
`NetPredictionManager`, and re-simulation from saved input — the work GSS already
does for sim-driven actors.

## Cues

`IGSSCue` supports state cues evaluated from simulation/proxy state and event cues multicast with
prediction-key deduplication.
