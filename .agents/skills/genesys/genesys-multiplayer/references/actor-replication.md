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

The server sends the current value of each replicated property to relevant clients every network tick. Clients apply the values as they arrive.

Rules:
- Only the authority (server) should write to replicated properties. Client writes have no effect on the server or other clients.
- Replicated properties are also persisted when the property metadata instructs it. Add `transient: true` if the property should travel over the network but not be saved to a scene file.
- Properties are transmitted efficiently in binary. Primitive types (`number`, `boolean`, `string`) work without any extra configuration. For complex types, specify the `net` metadata (see engine source for `NetPropertyMetadata`).
- A replicated property that holds a reference to another actor is only reconciled on the client once both actors have replicated. If the referenced actor is not itself replicated, the reference will never resolve on the client. Do not hold replicated actor references to non-replicated actors.

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
override isNetRelevantFor(clientId?: string, _clientData?: any): boolean {
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

## Spawning and Destroying Replicated Actors

Spawn replicated actors on the server. Because `replicated = true` is set in the constructor, every instance is replication-ready as soon as it is created; no additional setup is needed at the call site. When the server adds the actor to the world, the engine automatically spawns copies on all relevant clients. When the server destroys the actor, the engine removes the copies.

Clients cannot spawn or destroy replicated actors. Use a `@ServerRPC` to ask the server to do so.

Reference: See Actor.ts in engine source.
