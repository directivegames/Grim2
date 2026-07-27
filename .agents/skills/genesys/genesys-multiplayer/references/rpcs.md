# RPCs (Remote Procedure Calls)

RPCs let code on one machine call a method that executes on a different machine. Import them from `@gnsx/genesys.js`. They may only be used on methods of actors or components that are replicated (`this.replicated = true`).

## Decorator Types

### @ENGINE.ServerRPC

Client calls → server executes.

Use when a client needs the server to perform an authoritative action: fire a weapon, request a respawn, pick up an item.

```typescript
@ENGINE.ServerRPC()
fire(direction: THREE.Vector3): void {
  // Runs on the server only.
  // Validate the request here before changing any state.
  if (!this.canFire()) return;
  this.spawnProjectile(direction);
}
```

Calling `fire()` on a client sends the call to the server. The server validates and executes it. The method does not run locally on the client.

### @ENGINE.ClientRPC

Server calls → owning client executes.

Use when the server needs to send information or trigger a UI event on the specific client that owns this actor: show a damage indicator, play a personal sound effect, display a custom notification.

```typescript
@ENGINE.ClientRPC()
showDamageIndicator(amount: number): void {
  // Runs on the owning client only.
  this.hudOverlay.flashDamage(amount);
}
```

The actor must have `netOwningClientId` set. If it is not set, the RPC is not delivered.

### @ENGINE.MulticastRPC

Server calls → executes on the server and all clients.

Use for events that every player must see: an explosion, a door opening, a match-start countdown.

```typescript
@ENGINE.MulticastRPC()
playExplosionEffect(position: THREE.Vector3): void {
  // Runs on the server and all connected clients.
  this.spawnParticles(position);
  this.playSound('explosion');
}
```

Do not use multicast for state changes — modify replicated properties for state so latejoining clients receive the correct values.

### @ENGINE.RemoteRPC

Does not execute locally on the caller. Sends to the other side.

- Client calls → server executes (does not run on client).
- Server calls → clients execute (does not run on server).

Use when the call must never run locally regardless of which side initiates it.

### @ENGINE.ServerOnly / @ENGINE.ClientOnly

These are not RPCs; they mark methods that must only ever be invoked on the server or on clients respectively. No network transmission occurs. Use them to document and enforce intent.

## Reliable vs Unreliable

All RPCs default to reliable (guaranteed delivery, ordered). Pass `{ reliable: false }` for high-frequency calls where occasional loss is acceptable (e.g., cosmetic position hints).

```typescript
@ENGINE.MulticastRPC({ reliable: false })
updateFootstepEffect(position: THREE.Vector3): void { ... }
```

Use reliable for anything that changes game state. Use unreliable only for cosmetic or redundant data.

## Argument Types and Net Metadata

RPC arguments use the same binary codec as replicated properties. Every parameter has inferred `NetPropertyMetadata` that controls its wire encoding. For `number` parameters the default inference is an unquantized `float32`, which is correct but wasteful for integers or bounded floats. Override individual parameter encodings using the `params` array in the decorator options:

```typescript
@ENGINE.ServerRPC({
  reliable: true,
  params: [
    // param 0: direction — unit Vector3, 2 decimal places per component
    { netType: 'vector3', quantization: { mode: 'scale', scale: 100 } },
    // param 1: power — float in [0, 1], 8 bits is enough
    { netType: 'float', quantization: { mode: 'range', min: 0, max: 1, bits: 8 } },
    // param 2: projectileCount — non-negative integer
    { netType: 'uint' },
  ]
})
fire(direction: THREE.Vector3, power: number, projectileCount: number): void {
  // Runs on server only.
}
```

Each element in `params` corresponds to a method parameter by position. Pass `null` or omit an element to keep the auto-inferred encoding for that parameter. A partial object is merged with the inferred metadata; a full object overrides it entirely.

**`netType` quick reference for RPC parameters:**

| TypeScript type | Recommended `netType` |
|---|---|
| `number` (non-negative integer) | `'uint'` |
| `number` (signed integer) | `'int'` |
| `number` (float) | `'float'` + quantization |
| `boolean` | `'bool'` (auto-inferred) |
| `THREE.Vector3` | `'vector3'` (auto-inferred) + quantization |
| `THREE.Euler` | `'euler'` (auto-inferred) + quantization |
| `THREE.Quaternion` | `'quaternion'` (auto-inferred) |
| Actor reference | `'actorRef'`; add `nullable: true` if it can be null |

See [actor-replication](actor-replication.md) for the full quantization mode guide — the same modes apply to RPC parameters.

Avoid passing complex class instances, closures, or functions as RPC arguments.

## Common Patterns

### Client requests server action

```typescript
// In PlayerController (client-side input handler):
onFirePressed(): void {
  const dir = this.getAimDirection();
  this.getPawn<MyPawn>()?.requestFire(dir);
}

// In MyPawn:
@ENGINE.ServerRPC()
requestFire(direction: THREE.Vector3): void {
  // Server validates and acts.
}
```

### Server notifies owning client

```typescript
// In PlayerController, called from server game logic:
@ENGINE.ClientRPC()
onMatchCountdownStarted(secondsRemaining: number): void {
  // Show countdown on this player's HUD.
}
```

### Server broadcasts event to all

```typescript
// In a replicated actor, called on server:
@ENGINE.MulticastRPC()
onActorDestroyed(): void {
  // Play destruction effect on every client.
}
```

Reference: See ActorNetworking.ts in engine source.
