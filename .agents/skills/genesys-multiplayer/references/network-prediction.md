# Network prediction

`NetPredictionManager` is a shared rewind framework. Gameplay Simulation System (GSS), `NetRewindablePhysicsProp`, and custom nodes can use it independently. GSS-specific correction and proxy replication stay in the `genesys-movement` skill.

Choose this framework only when [gameplay systems](gameplay-systems.md) says the feature needs custom rewind. GSS and classic movement already predict player pawns.

Canonical detail: `docs/multiplayer/prediction.md` in `@gnsx/genesys.js` (`packages/engine/docs/multiplayer/prediction.md` in the Genesys repository).

## Setup

Initialize from `GameMode.onBeforeBeginPlay` and shut down from `onAfterEndPlay`. Nodes register during `beginPlay`, so the manager must exist first.

```typescript
public override onBeforeBeginPlay(): void {
  ENGINE.NetPredictionManager.initialize(this.getWorld()!);
}

public override onAfterEndPlay(): void {
  ENGINE.NetPredictionManager.shutdown(this.getWorld()!);
}
```

`GSSNode.useNetworkPrediction` defaults to `true` and still does nothing until this manager exists.

## Rules

- Register every node whose changing state can affect a predicted simulation. Implement `IRewindable`, call `register` from `beginPlay`, and `unregister` from `endPlay`. Leave static geometry and cosmetic-only nodes unregistered.
- Key snapshots, simulation, and timestamps shared with the server with `ENGINE.NetPredictionManager.getGameTimeMs(world)`. That is server game time on the server, and predicted server time on a client. Local game time is for UI and other cosmetics.
- Prefer a pose that is a function of that time. A platform can lerp from start to end using `getGameTimeMs` and implement `rewind` by evaluating the same function at the requested time. Use `HistoryBuffer` only when the motion is not analytical. Record those samples with `getGameTimeMs`.
- Spawn and despawn replicated entities only on the server.
- After a gameplay destroy, keep the entity registered and still returned by physics overlap queries until the rewind horizon has passed. Unregistering, `endPlay`, or removing the query collider drops it out of spatial rewind immediately. `NetRewindablePhysicsProp.endPlay` also clears its history.
- Do not change collider shape, topology, or query filters on a rewindable entity unless `rewind` and `restore` put that collider back too. Spatial rewind selects targets from the collider that exists now.

`rewindInRadius` and the other spatial helpers overlap **current** physics, then rewind the registered nodes they hit.
