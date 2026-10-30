# Network prediction

`NetPredictionManager` is a shared rewind framework. GSS, `NetRewindablePhysicsProp`, and custom nodes can each use it. GSS correction and proxy replication stay in `genesys-movement`.

Use it only when [gameplay-systems](gameplay-systems.md) says the feature needs custom rewind; GSS and classic movement already predict player pawns. Engine doc: `node_modules/@gnsx/genesys.js/docs/multiplayer/prediction.md`.

## Setup

Initialize from `GameMode.onBeforeBeginPlay` and shut down from `onAfterEndPlay`. Nodes register during `beginPlay`, so the manager must exist first. `GSSNode.useNetworkPrediction` is true by default and still does nothing until the manager exists.

Source: node_modules/@gnsx/genesys.js/docs/multiplayer/prediction.md; verify with snipcheck before shipping
```ts
public override onBeforeBeginPlay(): void {
  ENGINE.NetPredictionManager.initialize(this.getWorld()!);
}

public override onAfterEndPlay(): void {
  ENGINE.NetPredictionManager.shutdown(this.getWorld()!);
}
```

## Rules

- Register every node whose changing state can affect a predicted simulation: implement `IRewindable`, `register` in `beginPlay`, `unregister` in `endPlay`. Leave static geometry and cosmetic-only nodes out.
- Key snapshots, simulation, and timestamps shared with the server by `ENGINE.NetPredictionManager.getGameTimeMs(world)` (server game time on the server, predicted server time on a client). Local game time is for UI and cosmetics.
- Prefer a pose that is a function of that time: a platform lerps start to end from `getGameTimeMs`, and `rewind` evaluates the same function at the requested time. Use `HistoryBuffer` only for non-analytical motion, sampled with `getGameTimeMs`.
- Spawn and despawn replicated entities only on the server.
- After a gameplay destroy, keep the entity registered and returned by physics overlap queries until the rewind horizon passes. Unregistering, `endPlay`, or removing the query collider drops it from spatial rewind at once (`NetRewindablePhysicsProp.endPlay` also clears its history).
- Do not change collider shape, topology, or query filters on a rewindable entity unless `rewind` and `restore` put that collider back. Spatial rewind selects targets from the collider that exists now.

`rewindInRadius` and the other spatial helpers overlap **current** physics, then rewind the registered nodes they hit.
