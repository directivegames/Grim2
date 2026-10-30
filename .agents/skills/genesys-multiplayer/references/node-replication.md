# Node Replication

Source: .engine/src/nodes/multiplayer/ReplicationInfo.ts, .engine/src/nodes/multiplayer/MultiplayerSpawner.ts, .engine/src/multiplayer/Networking.ts (`SpawnMethod`), .engine/src/multiplayer/ServerAuthorityNetWorld.ts.

Replication is the mechanism by which the server keeps clients up to date. A replicated entity is an `isRoot && replicated` `SceneNode` plus its replicated descendants, stopping at nested roots (those are their own entities). The engine auto-creates `ReplicationInfo` on the entity root and periodically transmits property updates for every member (see Replication Send Rate below — not every game tick).

## Enabling Replication

On a root node, set `this.isRoot = true` and `this.replicated = true`. That auto-creates `ReplicationInfo`. Non-root nodes with `replicated = true` join the nearest entity root's member map.

```typescript
@ENGINE.GameClass()
export class PickupRoot extends ENGINE.PrimitiveNode {
  constructor() {
    super();
    this.isRoot = true;
    this.replicated = true;
  }
}
```

Call `this.ensureReplicationInfo()` when you need the info object before play (for example to call `setAutonomousProxy`). `PlayerController` and `Pawn` already do this internally.

When the server adds a replicated entity root to the world, the engine assigns a global `NetId` to its `ReplicationInfo` and spawns a copy on all relevant clients. When the server destroys the root, the copies are removed. The info also carries `netLocalRole` / `netRemoteRole` — Authority on the server, `SimulatedProxy` on clients by default (`AutonomousProxy` for the owning client's controller/pawn — see [player-ownership](player-ownership.md)).

## Replicating Properties

Mark individual properties with `replicate: true` inside the `@ENGINE.property` decorator. The enclosing class must be `@ENGINE.GameClass()`.

```typescript
@ENGINE.GameClass()
export class EnemyNode extends ENGINE.PrimitiveNode {
  constructor() {
    super();
    this.isRoot = true;
    this.replicated = true;
  }

  @ENGINE.property({ replicate: true })
  public health: number = 100;

  @ENGINE.property({ replicate: true })
  public teamId: number = 0;
}
```

The server sends the current value of each replicated property to relevant clients at the replication send rate (default 30 Hz, configurable via `netWorld.setReplicationSendRate(hz)`). Clients apply the values as they arrive.

Rules:
- Only the authority (server) should write to replicated properties. Client writes have no effect on the server or other clients.
- A property only participates in replication when its node is inside a replicated entity's member map (the entity root, or a `replicated` descendant under it that isn't itself a nested entity root). A `replicated` node with no surrounding entity root replicates nothing — the flag is a no-op.
- Replicated properties are also persisted when the property metadata instructs it. Add `transient: true` if the property should travel over the network but not be saved to a scene file.
- Properties are transmitted in a compact binary format. See Net Type and Quantization below for how to control wire encoding.
- A replicated property that holds a reference to another node is only reconciled on the client once both nodes have replicated. If the referenced node is not inside a replicated entity, the reference will never resolve on the client.

### `onRep<PropName>()` callbacks

When a client applies an update, it calls a method named `onRep` + the property name with its first letter upper-cased (`isOpen` → `onRepIsOpen()`, `sessionState` → `onRepSessionState()`), with no arguments, after every property in that update has been applied (`.engine/src/multiplayer/ObjectSerializer.ts`, `ClientNetWorld.ts`). The property needs `replicate: true` and a resolved `net` block (the build's property-metadata step fills one in; a property still without `net` is skipped with a warning). Node-reference properties fire their callback once the reference resolves; for an array the callback fires once for the whole array. Callbacks never run on the server: call the same presentation method there directly. The engine's own example is `GameSessionInfo.onRepSessionState()`.

Source: .engine/src/multiplayer/ObjectSerializer.ts (`onRep` + capitalised property name), .engine/src/entities/GameSessionInfo.ts (`onRepSessionState`); typechecked against 18.1.0-alpha.317
```ts
@ENGINE.GameClass()
export class Gate extends ENGINE.PrimitiveNode {
  constructor() { super(); this.isRoot = true; this.replicated = true; }

  @ENGINE.property({ replicate: true, net: { netType: 'bool' } })
  public isOpen = false;

  // Client only: runs after an update that changed isOpen has been applied (no arguments).
  public onRepIsOpen(): void {
    this.setHiddenInGame(this.isOpen);
  }
}
```

## Reparenting

Reparent the **entity root** only (`isRoot && replicated`). Moving a replicated non-root member at runtime is unsupported. The server replicates the root's parent; if that parent is not on the client yet, the entity stays under its previous parent until the parent exists, then snaps over. Do not reparent unreplicated spawn trees expecting clients to follow — those stay where `MultiplayerSpawner` attached them.

## Net Type and Quantization

By default the engine auto-infers binary encoding from the TypeScript type. For `number` this defaults to an unquantized `float32` — correct but wasteful for integers. Always provide a `net` override for numeric properties so the codec uses the appropriate wire type.

### Choosing a `netType`

| TypeScript type | Use when | `net.netType` |
|---|---|---|
| `number` | Non-negative integer (count, ID, score) | `'uint'` |
| `number` | Signed integer (delta, offset) | `'int'` |
| `number` | Floating-point | `'float'` with a quantization mode |
| `boolean` | Flag | `'bool'` |
| `THREE.Vector3` | 3D position / direction | `'vector3'` with quantization |
| `THREE.Euler` | 3-axis rotation | `'euler'` with quantization |
| `THREE.Quaternion` | Unit rotation | `'quaternion'` with `drop-w` |
| Node reference | Pointer to another `SceneNode` | `'nodeRef'` (auto-inferred for `nodeReference`, or the deprecated `componentReference` alias); add `nullable: true` if it can be null |
| String union / enum | Enumerated string values | auto-inferred as `'enum'` |

```typescript
@ENGINE.GameClass()
export class EnemyNode extends ENGINE.PrimitiveNode {
  // uint — zigzag varint; compact for small values
  @ENGINE.property({ replicate: true, net: { netType: 'uint' } })
  public health: number = 100;

  // int — signed zigzag varint
  @ENGINE.property({ replicate: true, net: { netType: 'int' } })
  public score: number = 0;

  // float — with quantization (see below)
  @ENGINE.property({ replicate: true, net: { netType: 'float', quantization: { mode: 'scale', scale: 10 } } })
  public countdown: number = 0;
}
```

### Quantization Modes

Quantization converts a float to a compact integer representation on the wire. Choose based on the property's domain and precision requirements.

| Mode | Description | Best for |
|---|---|---|
| `range` | Fixed-bit index in `[min, max]`; always `bits` bits per value | Bounded values with predictable cost (rotation, bounded position) |
| `scale` | Multiply by `scale`, round, zigzag varint; cheap near zero | Unbounded floats with a fixed decimal precision (velocity, health fraction) |
| `float16` | IEEE 754 half-precision delta; ~3 sig. figs | General floats where ~0.001 error is acceptable |
| `float32` | 32-bit monotone delta varint; full precision | High-precision floats where delta compression still helps |
| `drop-w` | Quaternion only — drops w, transmits x/y/z in `bits` bits each | Unit quaternion rotations |

```typescript
// Position in a ±655m world — 16 bits per axis (~2 cm precision)
@ENGINE.property({ replicate: true, net: {
  netType: 'vector3',
  quantization: { mode: 'range', min: -655.35, max: 655.35, bits: 16 }
}})
public position: THREE.Vector3 = new THREE.Vector3();

// Euler rotation — 16 bits per axis over full [-π, π] range
@ENGINE.property({ replicate: true, net: {
  netType: 'euler',
  quantization: { mode: 'range', min: -Math.PI, max: Math.PI, bits: 16 }
}})
public rotation: THREE.Euler = new THREE.Euler();

// Velocity — no fixed bounds, 2 decimal places is enough
@ENGINE.property({ replicate: true, net: {
  netType: 'float',
  quantization: { mode: 'scale', scale: 100 }
}})
public speed: number = 0;
```

### `replicateTo` — Per-Property Client Filter

By default a replicated property is sent to all clients. Use `replicateTo` to restrict delivery:

- `'all'` — sent to every connected client (default).
- `'owner'` — sent only to the group's owning client (`netOwningClientId`) — use for input acknowledgements, private state.
- `'non-owner'` — sent to all clients except the owning client (use when the owning client computes the value locally and doesn't need a redundant copy from the server).

```typescript
// Owning client predicts velocity locally — only non-owners need the server copy
@ENGINE.property({ replicate: true, transient: true, net: {
  netType: 'float',
  replicateTo: 'non-owner',
  quantization: { mode: 'scale', scale: 100 }
}})
public forwardVelocity: number = 0;
```

### `epsilon` — Suppressing Tiny Changes

Set `epsilon` on a `net` descriptor to skip sending an update when the serialized value changes by ≤ `epsilon`. Useful for slowly-drifting floats where every sub-threshold tick would otherwise produce a packet.

```typescript
@ENGINE.property({ replicate: true, net: {
  netType: 'float',
  quantization: { mode: 'scale', scale: 10 },
  epsilon: 1   // don't send until the quantized value shifts by more than 1 unit
}})
public blendWeight: number = 0;
```

## Transform Replication

There is no generic `replicateTransform` flag for `SceneNode`/`PrimitiveNode` roots. For a plain `Pawn`, transform replication is not automatic: creating a `ReplicationInfo` does not by itself move the node on remote clients.

- For player/AI-controlled movement, use a `MovementPawn` subclass (e.g. `CharacterPawn`) whose movement node predicts and reconciles the owning client (saved moves in `BasePawnMovementNode`); `NetMovementPredictor` only smooths simulated proxies.
- For simple non-player roots that move (projectiles, pickups, moving platforms), implement an explicit replicated `NetTransform`-style property (position/rotation as replicated properties with quantization, see above) with authority-side writes and an `onRep*` callback that applies the value on remote clients. Merely adding replicated position/rotation properties is sufficient.

## Relevance and Ownership Scoping

By default, once a replicated root's `ReplicationInfo` channel is established with a client, that client keeps receiving its updates for as long as both are connected — there is no per-tick distance/relevance culling hook on `SceneNode`/`PrimitiveNode` roots. To scope *who* sees what:

- Use `replicateTo: 'owner'` / `'non-owner'` (above) to control which clients receive a given property, not the whole entity.
- Use a `MultiplayerSpawner` method decorated `@ENGINE.SpawnMethod({ audience: 'owner' })`, or `spawnPrefab(path, [clientId])` (see Scene-Placed vs Dynamically Spawned Roots below), to spawn a whole subtree that only materializes for one client — the right tool for a player's private inventory, hand-UI, or other per-player-only entity.

There is no distance-culling hook and no `setNetRelevant` / `onlyRelevantToOwner` API. Owner-only entities go through the spawner audience above.

## Replication Send Rate

The server batches replication into packets sent at a fixed global rate, independent of the game loop tick rate. The default is 30 Hz and applies to all replicated roots uniformly. Change it via `setReplicationSendRate` on the `ServerAuthorityNetWorld`, typically from server-only setup code (e.g. inside `GameMode.initialize` or the server entry point), not inside node code:

Source: .engine/src/multiplayer/ServerAuthorityNetWorld.ts (`setReplicationSendRate`), .engine/src/game/World.ts (`netWorld` getter) — typechecked against 18.1.0-alpha.317
```typescript
import * as ENGINE from '@gnsx/genesys.js';

declare const world: ENGINE.World;

// The server's net world (ServerAuthorityNetWorld) has setReplicationSendRate, but the class is not exported,
// so narrow structurally. On clients and standalone the method is absent and the call does nothing.
const net = world.netWorld as ENGINE.NetWorld & { setReplicationSendRate?: (hz: number) => void };

// Send 20 packets per second instead of the default 30
net.setReplicationSendRate?.(20);

// Disable throttling — send a replication packet every game tick
net.setReplicationSendRate?.(0);
```

A lower rate reduces outbound bandwidth at the cost of higher client-visible latency for property updates. RPCs are not affected by this setting — they are sent immediately regardless of the replication send rate.

## Scene-Placed vs Dynamically Spawned Roots

How a replicated root arrives in the world determines how the server binds its channel to a client.

Scene-placed roots are nodes loaded from a scene file — both the server and every client load the same scene, so the node already exists at the same `NodePath` on both sides before any networking happens. The server sends a spawn entry containing that stable `NodePath` (`rootPath`) plus the initial replicated state; the client resolves the existing node at that path and applies the state to it. No construction data is transmitted.

Dynamically spawned roots (pickups, projectiles, spawned enemies, per-player private entities) do not exist ahead of time on the client, so a bare `world.add(node)` on the server has nothing for the client to bind to. Use a `MultiplayerSpawner` node instead:

```typescript
@ENGINE.GameClass()
class PickupSpawner extends ENGINE.MultiplayerSpawner {
  @ENGINE.SpawnMethod()
  async spawnPickup(position: THREE.Vector3): Promise<PickupRoot | null> {
    const pickup = await ENGINE.instantiatePrefabAsync('@project/assets/prefabs/pickup.prefab.json');
    pickup?.setWorldPosition(position);
    return pickup;
  }

  @ENGINE.SpawnMethod({ audience: 'owner' })
  async spawnPrivateItem(ownerClientId: ENGINE.ClientId): Promise<SceneNode | null> {
    return await ENGINE.instantiatePrefabAsync('@project/assets/prefabs/private-item.prefab.json');
  }
}

// Scene- or code-placed once, as a sibling of where spawns should appear:
const spawner = PickupSpawner.create();
world.add(spawner);

// Server: spawn a pickup visible to every client
await spawner.spawnPickup(position);

// Server: spawn a private entity visible only to one player
await spawner.spawnPrivateItem(ownerClientId);
```

With `audience: 'owner'`, the first call argument is the owner `ClientId` (non-zero; it is not sent on the wire), and the spawned entity is owned by that client. A spawner method without `@SpawnMethod` is refused (`is not a @SpawnMethod`). Remove a spawn with `despawn(spawnId)` or `despawnInstance(root)`.

`MultiplayerSpawner` keeps a journal of its spawns (recipe + args) keyed by its own stable `NodePath`. The server notifies clients (or the owner-only audience) of new/removed journal entries; each client materializes the same recipe locally via `applyRemoteSpawn`, so both sides end up with an equivalent tree that the generic `ReplicationInfo` channel can then bind to and delta-update. Late-joining clients replay the spawner's current journal instead of missing spawns that happened before they connected.

`GameSessionInfo` is spawned once at world begin play (`GameMode.ensureGameSessionInfo`). `PlayerController`, `Pawn`, and `PlayerInfo` are spawned and bound through the engine's built-in join flow (`GameMode.onPlayerJoined` after the client loads the level → `handleNewPlayer` → `restartPlayer`) — game code should not try to hand-spawn these framework types with a `MultiplayerSpawner` of its own; call the `GameMode` hooks documented in [game-mode](game-mode.md) instead.

Reference: See `ReplicationInfo.ts`, `MultiplayerSpawner.ts`, and `ServerAuthorityNetWorld.ts` in engine source (`.engine/src/multiplayer/`, `.engine/src/nodes/multiplayer/`).
