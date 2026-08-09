# Server Authority and Runtime

## Runtime Environment

The engine runs in one of three modes. Check the current mode before writing any code that must behave differently on the server versus the client.

```typescript
import * as ENGINE from '@gnsx/genesys.js';

ENGINE.NetRuntime.isServer()          // true on dedicated server and in standalone (single-player)
ENGINE.NetRuntime.isClient()          // true only on a connected browser client
ENGINE.NetRuntime.isDedicatedServer() // true only on a headless server process
ENGINE.NetRuntime.isStandalone()      // true in single-player mode (no network)
ENGINE.NetRuntime.isHeadless()        // true on a dedicated server (no rendering or UI)
ENGINE.NetRuntime.getType()           // returns NetRuntimeType enum value
ENGINE.NetRuntime.ensureInitialized() // browser → Standalone, Node → DedicatedServer (if not yet set)
ENGINE.NetRuntime.initialize(type)    // explicit once-only init at app entry (preferred for servers)
```

Use `isServer()` as the standard authority guard. It returns true in both single-player standalone and dedicated server modes, so code guarded by it runs correctly in all contexts.

Do not read `NetRuntime` during node construction or `initialize()`. Read it in `beginPlay` or later.

## NetRole and ReplicationGroup

Authority and role live on the node's `ReplicationGroup`, not on the node itself. A node only has roles once it is inside a group (see [node-replication](node-replication.md) for how the group is attached).

```typescript
node.getReplicationGroup()?.netLocalRole   // the role this node's group has on the current machine
node.getReplicationGroup()?.netRemoteRole  // the role this node's group has on other machines
```

Role values:

- `Authority` — This machine owns this group and can change its state. The server has Authority for most groups.
- `AutonomousProxy` — This machine has input authority for this group but the server still owns the state. A client has AutonomousProxy for its own `PlayerController` and `Pawn`.
- `SimulatedProxy` — This machine displays a remote copy of the group. It receives replicated state but cannot modify it.
- `None` — Not networked (no `ReplicationGroup`).

## Checking Authority on a Node

Use the convenience methods on `SceneNode` instead of reading the group's roles directly — they delegate to the node's nearest `ReplicationGroup` and default safely (`false`) when there is none:

```typescript
this.hasAuthority()             // group?.netLocalRole === Authority, else false
this.isLocalAutonomousProxy()   // group?.netLocalRole === AutonomousProxy, else false
this.isSimulatedProxy()         // group?.netLocalRole === SimulatedProxy, else false
this.isOwnedByLocalClient()     // group's owning client matches the current client, else false
```

`hasAuthority()` returns `false` on a plain `SceneNode`/`PrimitiveNode` with no `ReplicationGroup` — do not assume authority from `hasAuthority()` alone on an unreplicated Controller, GameMode, or InfoNode. This differs from the deprecated `Actor`, whose `hasAuthority()` defaults to `true` even with no group.

## Guarding Server-Only Logic

Wrap all state-modifying logic in authority guards.

```typescript
public override beginPlay(): boolean {
  if (!super.beginPlay()) {
    return false;
  }
  if (!this.hasAuthority()) return true;

  // This code only runs on the server.
  this.health = 100;
  this.startRespawnTimer();
  return true;
}
```

For code outside a node (e.g., in a standalone utility function), use `NetRuntime.isServer()`.

## Common Mistakes

- Writing to a replicated property from a client has no effect on the server or other clients. Always modify replicated state on the server.
- Setting `replicated = true` on a `SceneNode`/`PrimitiveNode` does nothing by itself — it must also have a `ReplicationGroup` (see [node-replication](node-replication.md)).
- Spawning nodes from a client does not create them on the server. Spawn networked nodes on the server (directly, or via `MultiplayerSpawner` for dynamic, non-scene-placed roots) via a `@ServerRPC`.
- Destroying networked nodes must also happen on the server. A client can request destruction via a `@ServerRPC`; the server calls `node.removeFromParent()` / `MultiplayerSpawner.despawn()`.

> **Deprecated `Actor` compatibility:** `Actor.netLocalRole` / `Actor.netRemoteRole` and `Actor.hasAuthority()` (true-by-default when unreplicated) remain as compatibility shims on the deprecated `Actor` shell. New code should read roles through `getReplicationGroup()` on a `SceneNode`/`PrimitiveNode` root as shown above.

Reference: See `NetRuntime.ts`, `SceneNode.ts`, and `ReplicationGroup.ts` in engine source.
