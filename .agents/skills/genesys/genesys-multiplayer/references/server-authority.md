# Server Authority and Runtime

## Runtime Environment

The engine runs in one of three modes. Check the current mode before writing any code that must behave differently on the server versus the client.

```typescript
import * as ENGINE from '@gnsx/genesys.js';

ENGINE.NetRuntime.isServer()          // true on dedicated server and in standalone (single-player)
ENGINE.NetRuntime.isClient()          // true only on a connected browser client
ENGINE.NetRuntime.isDedicatedServer() // true only on a headless server process
ENGINE.NetRuntime.isStandalone()      // true in single-player mode (no network)
ENGINE.NetRuntime.getType()           // returns NetRuntimeType enum value
```

Use `isServer()` as the standard authority guard. It returns true in both single-player standalone and dedicated server modes, so code guarded by it runs correctly in all contexts.

Do not read `NetRuntime` during actor or component construction. Read it in `beginPlay` or later.

## NetRole

Every actor has a local role and a remote role that reflect its position in the authority hierarchy.

```typescript
actor.netLocalRole   // the role this actor has on the current machine
actor.netRemoteRole  // the role this actor has on other machines
```

Role values:

- `Authority` — This machine owns this actor and can change its state. The server has Authority for most actors.
- `AutonomousProxy` — This machine has input authority for this actor but the server still owns the state. A client has AutonomousProxy for its own PlayerController and pawn.
- `SimulatedProxy` — This machine displays a remote copy of the actor. It receives replicated state but cannot modify the actor.
- `None` — Not networked.

## Checking Authority on Actors

Use the convenience methods on Actor instead of reading netLocalRole directly.

```typescript
this.hasAuthority()             // netLocalRole === Authority
this.isLocalAutonomousProxy()   // netLocalRole === AutonomousProxy
this.isSimulatedProxy()         // netLocalRole === SimulatedProxy
this.isOwnedByLocalClient()     // actor's owning client matches the current client
```

## Guarding Server-Only Logic

Wrap all state-modifying logic in authority guards.

```typescript
override beginPlay(): void {
  super.beginPlay();
  if (!this.hasAuthority()) return;

  // This code only runs on the server.
  this.health = 100;
  this.startRespawnTimer();
}
```

For code outside an actor (e.g., in a standalone utility function), use `NetRuntime.isServer()`.

## Common Mistakes

- Writing to a replicated property from a client has no effect on the server or other clients. Always modify replicated state on the server.
- Spawning actors from a client does not create them on the server. Spawn actors on the server via a `@ServerRPC`.
- Destroying actors must also happen on the server. A client can request destruction via a `@ServerRPC`; the server calls `actor.destroy()`.

Reference: See NetRuntime.ts and Actor.ts in engine source.
