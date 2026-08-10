# Node Replication

Replication is the mechanism by which the server keeps clients up to date. A **replicated root** — any `SceneNode` (or subclass: `PrimitiveNode`, `MeshNode`, a custom placeable, `InfoNode`, `Controller`, …) marked with a `ReplicationGroup` — is tracked as one net entity. The engine transmits property updates for every replicated node in that subtree every tick.

## Enabling Replication

Setting `this.replicated = true` on a `SceneNode` only flags that node as *eligible* to be collected into a nearby `ReplicationGroup`'s member map — it does **not** create the group. You must attach the group explicitly with `ENGINE.ensureReplicationGroup(node)` (creates one if missing, no-op if one already exists) on the node that is the **root** of the networked subtree:

```typescript
@ENGINE.GameClass()
export class PickupRoot extends ENGINE.PrimitiveNode {
  constructor() {
    super();
    this.isRoot = true;
    this.replicated = true;
  }

  public override initialize(options?: ENGINE.PrimitiveNodeOptions): void {
    super.initialize(options);
    ENGINE.ensureReplicationGroup(this);
    // Equivalent: this.add(ENGINE.ReplicationGroup.create());
  }
}
```

`ensureReplicationGroup` requires the node to be a root (`isRoot === true`) — call it from `initialize`/the constructor of a root node, not from a nested child. `PlayerController` and `Pawn` already call it internally; a custom `Controller` or `InfoNode` subclass that sets `replicated = true` must call it too, or it silently never registers as a net entity.

When the server adds a replicated root to the world, the engine assigns a global `NetId` to its `ReplicationGroup` and spawns a copy on all relevant clients. When the server destroys the root, the copies are removed. The group also carries `netLocalRole` / `netRemoteRole` — Authority on the server, `SimulatedProxy` on clients by default (`AutonomousProxy` for the owning client's controller/pawn — see [player-ownership](player-ownership.md)).

> **Deprecated `Actor` compatibility:** `ENGINE.Actor` (a deprecated `PrimitiveNode` shell) overrides the `replicated` setter to call `ensureReplicationGroup` for you, so `this.replicated = true` in an Actor's constructor is sufficient on its own. This convenience is **Actor-only**. Any other `SceneNode`/`PrimitiveNode` — including custom placeables and Controller/InfoNode subclasses — needs the explicit `ensureReplicationGroup` call above. Do not rely on the Actor shortcut in new code; prefer a semantic `SceneNode`/`PrimitiveNode` root instead of `Actor`.

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

  public override initialize(options?: ENGINE.PrimitiveNodeOptions): void {
    super.initialize(options);
    ENGINE.ensureReplicationGroup(this);
  }

  @ENGINE.property({ replicate: true })
  public health: number = 100;

  @ENGINE.property({ replicate: true })
  public teamId: number = 0;
}
```

The server sends the current value of each replicated property to relevant clients at the replication send rate (default **30 Hz**, configurable via `netWorld.setReplicationSendRate(hz)`). Clients apply the values as they arrive.

Rules:
- Only the authority (server) should write to replicated properties. Client writes have no effect on the server or other clients.
- A property only participates in replication when its node is inside a `ReplicationGroup`'s member map (the group root, or a `replicated` descendant under it that isn't itself behind a nested group). A `replicated` node with no surrounding group replicates nothing — the flag is a no-op.
- Replicated properties are also persisted when the property metadata instructs it. Add `transient: true` if the property should travel over the network but not be saved to a scene file.
- Properties are transmitted in a compact binary format. See **Net Type and Quantization** below for how to control wire encoding.
- A replicated property that holds a reference to another node is only reconciled on the client once both nodes have replicated. If the referenced node is not itself replicated (inside a group), the reference will never resolve on the client.

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
| Node reference | Pointer to another `SceneNode` | `'nodeRef'` (auto-inferred for `componentReference`); add `nullable: true` if it can be null |
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

By default a replicated property is sent to **all** clients. Use `replicateTo` to restrict delivery:

- `'all'` — sent to every connected client (default).
- `'owner'` — sent only to the group's owning client (`netOwningClientId`) — use for input acknowledgements, private state.
- `'non-owner'` — sent to all clients **except** the owning client (use when the owning client computes the value locally and doesn't need a redundant copy from the server).

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

There is no generic `replicateTransform` flag for `SceneNode`/`PrimitiveNode` roots (that flag is an `Actor`-only compatibility property — see the deprecated footnote below). For a plain `Pawn`, transform replication is **not** automatic: creating a `ReplicationGroup` does not by itself move the node on remote clients.

- For player/AI-controlled movement, use a `MovementPawn` subclass (e.g. `CharacterPawn`) whose movement node consumes `NetMovementPredictor` — client-side prediction and server reconciliation are built in.
- For simple non-player roots that move (projectiles, pickups, moving platforms), implement an explicit replicated `NetTransform`-style property (position/rotation as replicated properties with quantization, see above) with authority-side writes and an `onRep*` callback that applies the value on remote clients. Merely adding replicated position/rotation properties is sufficient — you do not need `replicateTransform`.

> **Deprecated `Actor` compatibility:** `Actor.replicateTransform = true` (set alongside `replicated = true` in the constructor) enables snap-to-position transform sync automatically. This is an Actor-only compat property with no `SceneNode`/`PrimitiveNode` equivalent — new code should use `MovementPawn`/`CharacterPawn` or explicit replicated transform properties instead.

## Relevance and Ownership Scoping

By default, once a replicated root's `ReplicationGroup` channel is established with a client, that client keeps receiving its updates for as long as both are connected — there is no per-tick distance/relevance culling hook on `SceneNode`/`PrimitiveNode` roots. To scope *who* sees what:

- Use `replicateTo: 'owner'` / `'non-owner'` (above) to control which clients receive a given **property**, not the whole entity.
- Use `MultiplayerSpawner.spawnOwnerOnly(clientId, ...)` (see **Scene-Placed vs Dynamically Spawned Roots** below) to spawn a whole subtree that only materializes for one client — the right tool for a player's private inventory, hand-UI, or other per-player-only entity.

> **Deprecated `Actor` compatibility:** `Actor.isNetRelevantFor(clientId)` (override for distance-based culling), `Actor.onlyRelevantToOwner = true` (whole-actor owner-only visibility), and `Actor.setNetRelevant(false)` are Actor-only compatibility hooks with no `ReplicationGroup`/`SceneNode` equivalent today. Prefer `replicateTo` filters and `MultiplayerSpawner.spawnOwnerOnly` for new node-based code.

## Replication Send Rate

The server batches replication into packets sent at a fixed **global** rate, independent of the game loop tick rate. The default is **30 Hz** and applies to all replicated roots uniformly. Change it via `setReplicationSendRate` on the `ServerAuthorityNetWorld`, typically from server-only setup code (e.g. inside `GameMode.initialize` or the server entry point), not inside node code:

```typescript
import * as ENGINE from '@gnsx/genesys.js';

// Access netWorld through the World instance (world.netWorld is a public readonly property).
const netWorld = world.netWorld as ENGINE.ServerAuthorityNetWorld;

// Send 20 packets per second instead of the default 30
netWorld.setReplicationSendRate(20);

// Disable throttling — send a replication packet every game tick
netWorld.setReplicationSendRate(0);
```

A lower rate reduces outbound bandwidth at the cost of higher client-visible latency for property updates. RPCs are not affected by this setting — they are sent immediately regardless of the replication send rate.

## Scene-Placed vs Dynamically Spawned Roots

How a replicated root arrives in the world determines how the server binds its channel to a client.

**Scene-placed roots** are nodes loaded from a scene file — both the server and every client load the same scene, so the node already exists at the same `NodePath` on both sides before any networking happens. The server sends a spawn entry containing that stable `NodePath` (`rootPath`) plus the initial replicated state; the client resolves the existing node at that path and applies the state to it. No construction data is transmitted.

**Dynamically spawned roots** (pickups, projectiles, spawned enemies, per-player private entities) do **not** exist ahead of time on the client, so a bare `world.add(node)` on the server has nothing for the client to bind to. Use a `MultiplayerSpawner` node instead:

```typescript
// Scene- or code-placed once, as a sibling of where spawns should appear:
const spawner = ENGINE.MultiplayerSpawner.create({ defaultPrefabPath: '@project/assets/prefabs/pickup.prefab.json' });
world.add(spawner);

// Server: spawn a pickup visible to every client
spawner.spawn();

// Server: spawn a private entity visible only to one player (e.g. a hand-held item)
spawner.spawnOwnerOnly(ownerClientId);
```

`MultiplayerSpawner` keeps a journal of its spawns (recipe + args) keyed by its own stable `NodePath`. The server notifies clients (or the owner-only audience) of new/removed journal entries; each client materializes the same recipe locally via `applyRemoteSpawn`, so both sides end up with an equivalent tree that the generic `ReplicationGroup` channel can then bind to and delta-update. Late-joining clients replay the spawner's current journal instead of missing spawns that happened before they connected.

`PlayerController`, `Pawn`, `PlayerInfo`, and `GameSessionInfo` are spawned and bound through the engine's built-in join/session flow (`GameMode.onPlayerJoined` → `handleNewPlayer` → `restartPlayer`, and `NetWorld`'s handshake) — game code should not try to hand-spawn these framework types with a `MultiplayerSpawner` of its own; call the `GameMode` hooks documented in [game-mode](game-mode.md) instead.

Reference: See `ReplicationGroup.ts`, `MultiplayerSpawner.ts`, and `ServerAuthorityNetWorld.ts` in engine source (`packages/engine/src/multiplayer/`, `packages/engine/src/nodes/`).
