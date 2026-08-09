# Player Control and Autonomous Proxy

All net entities in the game are server-authoritative — the server spawns them, controls their state, and replicates updates to clients. `PlayerController` (a `SceneNode`/`Controller` subclass) and the `Pawn` it possesses (a `PrimitiveNode` subclass) are no exception: they are still replicated nodes owned and managed by the server. What makes them special is the `AutonomousProxy` role granted to the controlling client.

## AutonomousProxy: How It Works

When a player joins, `GameMode` on the server:

1. Spawns a `PlayerController` and adds it to the world (`PlayerController.initialize()` already calls `this.replicated = true` and `ENGINE.ensureReplicationGroup(this)`, and marks its group `setAutonomousProxy(true)`), then sets `controller.netOwningClientId = clientId`.
2. Spawns a `Pawn` (via `restartPlayer` → `spawnPlayerPawnWithTransform`), sets `pawn.netOwningClientId = clientId`, adds it to the world, then calls `controller.possess(pawn)` — possession flags the pawn's group `AutonomousProxy` too when the controller is a `PlayerController`.

`AutonomousProxy` means the controlling client is allowed to perform movement and other actions locally without waiting for a server round-trip. The client applies input immediately for responsiveness, sends those actions to the server via `@ServerRPC`, and the server validates and replicates the authoritative result back. If the server's result differs from what the client predicted, the client corrects itself.

All other nodes have `netLocalRole = SimulatedProxy` on a given client. The client displays them based on replicated state but cannot act on them.

## Checking the Controlling Client

```typescript
// Inside a PlayerController or Pawn:
this.isOwnedByLocalClient()     // true only on the owning client
this.isLocalAutonomousProxy()   // true on the owning client (AutonomousProxy role)

// Check the owning client ID (delegates to the node's ReplicationGroup):
this.netOwningClientId          // ClientId (uint16); 0 means server-owned / no owner
```

Use `isOwnedByLocalClient()` to decide whether to show a local HUD element or attach a local camera.

## Scoping a per-player-only node

There is no generic "owner-only visibility" flag on `SceneNode`/`PrimitiveNode` roots (that is an `Actor`-only compatibility property — see the footnote below). To spawn a node that only materializes for one client (a player's private inventory, hand UI, etc.), spawn it through a `MultiplayerSpawner`:

```typescript
override beginPlay(): boolean {
  if (!super.beginPlay()) return false;
  if (!this.hasAuthority()) return true;

  // spawner is a MultiplayerSpawner already in the world (see node-replication.md).
  spawner.spawnOwnerOnly(ownerClientId);
  return true;
}
```

`spawnOwnerOnly` journals the spawn for a single-client audience and stamps `netOwningClientId` on every `ReplicationGroup` in the spawned tree — other clients never receive it. For individual **properties** on an already-shared node, use `net: { replicateTo: 'owner' }` instead (see [node-replication](node-replication.md)).

> **Deprecated `Actor` compatibility:** `Actor.onlyRelevantToOwner = true` is a compatibility flag on the deprecated `Actor` shell that restricts replication of that one actor to its owning client. It has no `SceneNode`/`PrimitiveNode` equivalent. Prefer `MultiplayerSpawner.spawnOwnerOnly` or per-property `replicateTo: 'owner'` in new code.

## Input Flow for the Controlled Pawn

The client runs the `PlayerController`'s `IInputHandler` methods locally (keyboard, mouse, gamepad events). For movement, `CharacterMovementNode` applies the input on the client immediately as a prediction, then sends it to the server. The server validates and replicates the authoritative position back; the client corrects if needed.

For non-movement actions (firing, interacting, using an ability), send a `@ServerRPC` to the server, which validates and acts.

```typescript
// PlayerController on the client receives input:
onKeyDown(key: string): void {
  if (key === 'Space') {
    this.requestJump();   // @ServerRPC — sends to server for validation
  }
}

@ENGINE.ServerRPC()
requestJump(): void {
  // Runs on server. Validate and tell the pawn to jump.
  this.getPawn<MyPawn>()?.jump();
}
```

Do not modify game state (health, ammo, scores) directly from client input handlers. That must go through a `@ServerRPC` so the server validates it before the state changes.

## Client-Side Prediction (CharacterPawn)

`CharacterPawn` and `CharacterMovementNode` include client-side prediction and server reconciliation automatically. The engine applies input locally on the client immediately for smooth feel, then corrects the position if the server disagrees. This is handled internally; no extra code is required when using these classes.

For custom nodes that need prediction, implement the prediction logic manually and use `@ServerRPC` to send input sequences with a tick counter. Consult `InputBuffer.ts` and `MovementPrediction.ts` in engine source for the pattern used by `CharacterPawn`.

## Accessing the Local Player

To get the local player's controller from client code, use the async helper that waits until the controller has replicated from the server:

```typescript
const controller = await world.netWorld.waitForLocalPlayerController();
const pawn = controller?.getPawn();
```

In standalone (single-player) mode, `world.getPlayerControllerAt(0)` returns the single local controller synchronously.

On the server, access all connected controllers with `world.getNodes(ENGINE.PlayerController)`.

Reference: See `PlayerController.ts`, `Pawn.ts`, and `Controller.ts` in engine source.
