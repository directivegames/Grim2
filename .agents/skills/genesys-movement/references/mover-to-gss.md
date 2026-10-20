# Mover to GSS migration

Mover remains loadable for compatibility with existing projects, but it is unsupported. Do not
add new Mover modes, modifiers, layered moves, pawns, or controllers. Migrate each Mover pawn to
GSS or to a classic movement node.

## API mapping

- `MoverNode` → `GSSNode`
- `MoverCharacterPawn` → `GSSCharacterPawn`
- `MoverPlayerController` → `GSSPlayerController`
- `IMovementMode` → `IGSSMovementMode`
- `WalkingMode` / `FallingMode` → `GSSWalkingMode` / `GSSFallingMode`
- `MoveMixMode` → `GSSMoveMixMode` (effect contributions; includes `Ignore`)
- `ProposedMove` → `GSSDesiredMove` from `generateMove` / mixed result; `GSSProposedMove` from `IGSSEffect.proposeMove`
- `SimulationTickParams` → direct `tick(ctx, proposedMove, dt)` arguments
- `MovementInputCmd` → `GSSInputCmd`
- `MovementSyncState` → `GSSSyncState`
- `IMoverTransition` → `IGSSMovementModeTransition`
- `startingModeName` → `startingMovementModeId`
- `addMovementMode(name, mode)` → `addMovementMode(mode)` — the id now lives on `IGSSMovementMode.id`
- `queueNextMode(name)` → `queueMovementMode(id, priority?)`
- `applyEffect(effectInstance)` → `applyEffect(effectId)` — ids only, registered up front

The `GS` prefix distinguishes GSS movement types from compatibility-only Mover exports.

## Pawn and controller

```ts
// Before: unsupported Mover
class MyPawn extends ENGINE.MoverCharacterPawn {
  protected override createMoverNode(): ENGINE.MoverNode {
    const mover = ENGINE.MoverNode.create({ name: 'MoverNode' });
    mover.addMovementMode('walking', new ENGINE.WalkingMode());
    mover.addMovementMode('falling', new ENGINE.FallingMode());
    return mover;
  }
}

// After: GSS — the base pawn already registers walking, falling, and dash
class MyPawn extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    sim.addMovementMode(new ENGINE.GSSWalkingMode({ maxSpeed: 8 })); // replaces 'walking' in place
    return sim;
  }
}
```

Replace a custom `MoverPlayerController` subclass or Mover input producer with
`GSSPlayerController` or `IGSSInputProducer`. The GSS producer signature is:

```ts
produceInputCmd(cmd: ENGINE.GSSInputCmd, deltaTime: number): void
```

## Input conversion

Mover exposes `jumpJustPressed` and `jumpPressed`. GSS input carries currently-down
numeric tags; the sim derives edges from the previous Sync:

```ts
if (jumpIsDown) {
  ENGINE.tagSetAdd(cmd.inputTagsDown, ENGINE.GSSTags.InputJump);
}
```

Convert custom boolean actions in the same way: register a stable tag alongside the pawn's other
content, report it while down, and test the `newInputTags` or `removedInputTags` view in an
ability.

## Modes and transitions

Implement `IGSSMovementMode`. `generateMove(ctx)` returns `GSSDesiredMove` and mutates nothing;
`tick(ctx, proposedMove, dt)` advances the simulation through the writable
`GSSMovementSimContext` and returns nothing; `dt` is in seconds. Transitions receive a read-only
`GSSMovementContext` and return a mode id or `null`. Neither ever sees the sim node or
`GSSSyncState` — where Mover handed you `sync`, GSS hands you `ctx.translate`,
`ctx.setRotation`, `ctx.setVelocity`, and the `ctx.tags` / `ctx.custom` facades, and the node
applies the pose to `ctx.target` afterwards.

Register all modes, abilities, effects, cues, tags, and custom keys from the pawn's
`createGSSNode()`, so registration order — and the indices that travel on the wire — is
identical on every peer.

## Layered moves and modifiers

- Convert `LayeredMove.generateMove` to an `IGSSEffect.proposeMove`.
- Convert temporary speed or attribute modifiers to `IGSSEffect.modifyAttributes`.
- Convert activation/lifetime logic to an `IGSSAbility` that applies/removes an effect.
- Convert Mover string sync tags to registered GSS tag ids.

GSS effect slots, cooldowns, attributes, and custom data are part of deterministic Sync
and correction replay; avoid keeping simulation-critical state only on mode instances.

## Sync and networking

Do not copy Mover's backend or direct Sync replication. Sync is local state and private to the sim
node; read it from outside with `getPosition()`, `getRotation()`, `getVelocity()`, the scalar
component getters, `getAttribute()`, or `hasGSSTag()`. Vector and Euler getters return copies.
Prediction sends a digest upstream, corrections downstream, `proxyState` to non-owners, and an
acknowledgement to the owner.

Initialize `NetPredictionManager` from `GameMode.onBeforeBeginPlay` and shut it down from
`onAfterEndPlay`. `useNetworkPrediction` defaults to true and stays local-only until that
manager exists. Preserve the same registration order for tags, modes, abilities, effects,
and cues on every peer. Snapshot time is `NetPredictionManager.getGameTimeMs` — see
`genesys-multiplayer` `references/network-prediction.md`.

## Unsupported modes

If the Mover pawn uses flying, airplane, top-down, vehicle, or aerial modes, choose one:

1. Use the corresponding classic movement node.
2. Port the behaviour to a custom `IGSSMovementMode`.

Do not keep extending the unsupported Mover implementation.
