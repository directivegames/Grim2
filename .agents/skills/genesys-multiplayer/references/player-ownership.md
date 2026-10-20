# Player Control and Autonomous Proxy

All net entities in the game are server-authoritative — the server spawns them, controls their state, and replicates updates to clients. `PlayerController` (a `SceneNode`/`Controller` subclass) and the `Pawn` it possesses (a `PrimitiveNode` subclass) are no exception: they are still replicated nodes owned and managed by the server. What makes them special is the `AutonomousProxy` role granted to the controlling client.

## AutonomousProxy: How It Works

When a player finishes loading the level, `GameMode` on the server spawns through the scene `PlayerSpawner` (see [game-mode](game-mode.md)):

1. Spawns a `PlayerController` for that owner (`PlayerController.initialize()` already calls `this.replicated = true` and `this.ensureReplicationInfo().setAutonomousProxy(true)`), then sets `controller.netOwningClientId = clientId`.
2. Spawns a `Pawn` (via `restartPlayer` → `spawnPlayerPawnWithTransform`), sets `pawn.netOwningClientId = clientId`, then calls `controller.possess(pawn)`. Possession flags the pawn `AutonomousProxy` too when the controller is a `PlayerController`.

`AutonomousProxy` means this client may send input for that controller and pawn. The server still owns the result. How movement is predicted and reconciled is the `genesys-movement` skill, not this page.

Other replicated entities are `SimulatedProxy` on that client. The client displays them from replicated state. Unreplicated nodes have no network role.

## Checking the Controlling Client

```typescript
// Inside a PlayerController or Pawn:
this.isOwnedByLocalClient()     // true only on the owning client
this.isLocalAutonomousProxy()   // true on the owning client (AutonomousProxy role)

// Check the owning client ID (delegates to the node's ReplicationInfo):
this.netOwningClientId          // ClientId (uint16); 0 means server-owned / no owner
```

Use `isOwnedByLocalClient()` to decide whether to show a local HUD element or attach a local camera.

## Scoping a per-player-only node

There is no owner-only visibility flag on a `SceneNode`. To spawn a node that only materializes for one client (a private inventory, hand UI), use a `MultiplayerSpawner` method marked `@ENGINE.SpawnMethod({ audience: 'owner' })`, or `spawnPrefab(path, [ownerClientId])`. The owner `ClientId` is the audience. Other clients never receive that journal entry. For one property on an already-shared node, use `net: { replicateTo: 'owner' }` (see [node-replication](node-replication.md)).

## Input flow

The owning client runs the `PlayerController` `IInputHandler` methods locally (`handleKeyDown`, `handleMouseDown`, and the rest). `DefaultPlayerController` is the built-in handler. Actions that change health, ammo, scores, or other game state go through a `@ServerRPC` so the server validates them. Do not apply that state in the input handler.

Movement prediction and reconciliation live in the `genesys-movement` skill.

## Accessing the Local Player

To get the local player's controller from client code, use the async helper that waits until the controller has replicated from the server:

```typescript
const controller = await world.gameMode?.waitForLocalPlayerController();
const pawn = controller?.getPawn();
```

In standalone (single-player) mode, `world.getPlayerControllerAt(0)` returns the single local controller synchronously.

On the server, access all connected controllers with `world.getNodes(ENGINE.PlayerController)`.

Reference: See `PlayerController.ts`, `Pawn.ts`, and `Controller.ts` in engine source.
