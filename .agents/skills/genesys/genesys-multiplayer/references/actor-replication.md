# Actor Replication

Replication is the mechanism by which the server keeps clients up to date. Actors are replicated as a unit: enabling replication on an actor causes the engine to track its existence on each client and transmit property updates every tick.

## Enabling Replication

Set `replicated = true` in the actor's constructor. This is the correct place because replication setup needs to happen before the actor is registered with the world, and setting it on a client has no effect so there is no need to guard it.

```typescript
@ENGINE.GameClass()
export class EnemyActor extends ENGINE.Actor {
  constructor() {
    super();
    this.replicated = true;
  }
}
```

When the server adds a replicated actor to the world, the engine automatically spawns a copy on all relevant clients. When the server destroys it, the copies are removed. Setting `replicated = true` also sets `netRemoteRole` to `SimulatedProxy` on clients. The server retains `Authority`.

## Replicating Properties

Mark individual properties with `replicate: true` inside the `@ENGINE.property` decorator. The enclosing class must be `@ENGINE.GameClass()`.

```typescript
@ENGINE.GameClass()
export class EnemyActor extends ENGINE.Actor {

  @ENGINE.property({ replicate: true })
  public health: number = 100;

  @ENGINE.property({ replicate: true })
  public teamId: number = 0;
}
```

The server sends the current value of each replicated property to relevant clients at the replication send rate (default **30 Hz**, configurable via `netWorld.setReplicationSendRate(hz)`). Clients apply the values as they arrive.

Rules:
- Only the authority (server) should write to replicated properties. Client writes have no effect on the server or other clients.
- Replicated properties are also persisted when the property metadata instructs it. Add `transient: true` if the property should travel over the network but not be saved to a scene file.
- Properties are transmitted in a compact binary format. See the **Net Type and Quantization** section below for how to control wire encoding.
- A replicated property that holds a reference to another actor is only reconciled on the client once both actors have replicated. If the referenced actor is not itself replicated, the reference will never resolve on the client. Do not hold replicated actor references to non-replicated actors.

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
| Actor reference | Pointer to another actor | `'actorRef'`; add `nullable: true` if it can be null |
| String union / enum | Enumerated string values | auto-inferred as `'enum'` |

```typescript
@ENGINE.GameClass()
export class EnemyActor extends ENGINE.Actor {

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
- `'owner'` — sent only to the actor's owning client (use for input acknowledgements, private state).
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

For actors that do not use a movement component (e.g., projectiles, pickups), enable transform replication to sync position, rotation, and scale. Set both flags in the constructor alongside `replicated`.

```typescript
constructor() {
  super();
  this.replicated = true;
  this.replicateTransform = true;
}
```

This uses snap-to-position delivery. For smoother motion on characters, use `CharacterMovementComponent` with `CharacterPawn` — it has its own prediction and correction system built in.

## Relevance

By default the server sends an actor's replication data to every connected client. Override `isNetRelevantFor` to restrict which clients receive updates, for example to implement distance-based culling.

```typescript
override isNetRelevantFor(clientId?: ENGINE.ClientId, _clientData?: any): boolean {
  if (!clientId) return false;
  const world = this.getWorld();
  const ownerController = world?.getActors(ENGINE.PlayerController)
    .find(c => c.netOwningClientId === clientId);
  if (!ownerController) return false;
  const ownerPawn = ownerController.getPawn();
  if (!ownerPawn) return false;
  return this.getPosition().distanceTo(ownerPawn.getPosition()) < 500;
}
```

For actors that should only replicate to their owner, set `onlyRelevantToOwner = true` (used automatically for PlayerController).

## Replication Send Rate

The server batches replication into packets sent at a fixed **global** rate, independent of the game loop tick rate. The default is **30 Hz** and applies to all replicated actors uniformly. You can change it by calling `setReplicationSendRate` on the `ServerAuthorityNetWorld`. This is typically done in server-only setup code (e.g. inside `GameMode.initialize` or the server entry point), not inside actor code:

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

To reduce bandwidth for specific actors rather than globally, prefer `isNetRelevantFor` to cull irrelevant actors and `replicateTo` filters on individual properties.

## Scene-Placed vs Dynamically Spawned Actors

How an actor arrives in the world affects how the server synchronises it with clients.

**Scene-placed actors** are actors loaded from a scene file (`actor.scenePlaced === true`). Because both the server and every client load the same scene, these actors already exist on both sides when a client connects. The server does **not** send construction data for them — it sends a spawn packet containing the actor's `uuid` and initial replicated state only, and the client applies that state to the existing instance it already holds.

**Dynamically spawned actors** are actors created at runtime via `world.addActor(...)`. The server serialises the actor's class and non-replicated configuration and sends it to clients so they can construct a copy. Two requirements apply:

1. The actor class **must** be decorated with `@ENGINE.GameClass()` so it is registered in the `ClassRegistry`. If it is not registered, the server silently skips spawning it on clients (a warning is logged but nothing visible breaks on the server).
2. The actor **must** have `this.replicated = true` set in its constructor for the server to track and replicate it at all.

```typescript
// ✅ Correct — registered and replicated
@ENGINE.GameClass()
export class SpawnedPickup extends ENGINE.Actor {
  constructor() {
    super();
    this.replicated = true;
  }
}

// ❌ Missing @GameClass() — server will silently skip spawning this on clients
export class BrokenPickup extends ENGINE.Actor {
  constructor() {
    super();
    this.replicated = true;
  }
}
```

Spawn replicated actors on the server. The engine automatically spawns copies on all relevant clients and removes them when the server destroys the actor. Clients cannot spawn or destroy replicated actors — use a `@ServerRPC` to ask the server to do so.

Reference: See Actor.ts in engine source.
