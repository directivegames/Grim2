# Player Control and Autonomous Proxy

Source: .engine/src/entities/PlayerController.ts, Pawn.ts, Controller.ts; owning-client prediction is the saved moves in .engine/src/nodes/movement/BasePawnMovementNode.ts.

All net entities in the game are server-authoritative — the server spawns them, controls their state, and replicates updates to clients. `PlayerController` (a `SceneNode`/`Controller` subclass) and the `Pawn` it possesses (a `PrimitiveNode` subclass) are no exception: they are still replicated nodes owned and managed by the server. What makes them special is the `AutonomousProxy` role granted to the controlling client.

## AutonomousProxy: How It Works

When a player finishes loading the level, `GameMode` on the server spawns through the scene `PlayerSpawner` (see [game-mode](game-mode.md)):

1. Spawns a `PlayerController` for that owner (`PlayerController.initialize()` already calls `this.replicated = true` and `this.ensureReplicationInfo().setAutonomousProxy(true)`), then sets `controller.netOwningClientId = clientId`.
2. Spawns a `Pawn` (via `restartPlayer` → `spawnPlayerPawnWithTransform`), sets `pawn.netOwningClientId = clientId`, then calls `controller.possess(pawn)`. Possession flags the pawn `AutonomousProxy` too when the controller is a `PlayerController`.

`AutonomousProxy` means this client may send input for that controller and pawn. The server still owns the result. How movement is predicted and reconciled is the `genesys-movement` skill (system choice: [gameplay-systems](gameplay-systems.md)), not this page.

Other replicated entities are `SimulatedProxy` on that client: it displays them from replicated state. Unreplicated nodes have no network role.

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

There is no owner-only visibility flag on a `SceneNode`. To spawn a node that only materializes for one client (a player's private inventory, hand UI, etc.), spawn it through a `MultiplayerSpawner` method decorated `@ENGINE.SpawnMethod({ audience: 'owner' })`, or `spawnPrefab(path, [ownerClientId])` (full spawner example in [node-replication](node-replication.md)):

```typescript
override beginPlay(): boolean {
  if (!super.beginPlay()) return false;
  if (this.hasAuthority()) {
    // Owner-audience spawn methods are async; do not rely on the node inside beginPlay.
    // First argument is the owner ClientId (non-zero).
    void spawner.spawnPrivateItem(ownerClientId);
  }
  return true;
}
```

An owner-audience spawn journals the spawn for a single-client audience and stamps `netOwningClientId` on every `ReplicationInfo` in the spawned tree — other clients never receive it. For individual properties on an already-shared node, use `net: { replicateTo: 'owner' }` instead (see [node-replication](node-replication.md)).

## Input Flow for the Controlled Pawn

The owning client runs the `PlayerController`'s `IInputHandler` methods locally (`handleKeyDown`, `handleMouseDown`, and the rest; `DefaultPlayerController` is the built-in handler). Movement prediction and reconciliation live in `genesys-movement`.

For non-movement actions (firing, interacting, using an ability), send a `@ServerRPC` to the server, which validates and acts.

Keys arrive in `handleKeyDown(e: KeyboardEvent): boolean` on the controller (return `true` when handled, otherwise call `super`). There is no `onKeyDown(key)` method hook; `DefaultPlayerController.onKeyDown` is a `Delegate` you can `add` a `(e) => boolean` callback to instead. `getPawn()` is not generic; narrow with `instanceof`.

Source: .engine/src/entities/PlayerController.ts (`handleKeyDown`), .engine/src/entities/DefaultPlayerController.ts, .engine/src/entities/Controller.ts (`getPawn`); typechecked against 18.1.0-alpha.317
```typescript
@ENGINE.GameClass()
export class MyPlayerController extends ENGINE.DefaultPlayerController {
  // Client: raw keys arrive here. Return true when handled.
  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'KeyG') {
      this.requestAbility(); // @ServerRPC — sent to the server for validation
      return true;
    }
    return super.handleKeyDown(e);
  }

  @ENGINE.ServerRPC()
  requestAbility(): void {
    // Runs on the server. Validate, then act on the pawn.
    const pawn = this.getPawn(); // not generic: narrow with instanceof
    if (pawn instanceof MyPawn) pawn.useAbility();
  }
}
```

Jump and other movement inputs are predicted by the movement node; send them through the pawn's movement actions, not a custom RPC.

Do not modify game state (health, ammo, scores) directly from client input handlers. That must go through a `@ServerRPC` so the server validates it before the state changes.

## Movement prediction

`CharacterPawn` predicts and reconciles its own movement with no extra code. Which system to use and how it behaves: [gameplay-systems](gameplay-systems.md) and `genesys-movement`. A custom node that must rewind uses [network-prediction](network-prediction.md), not a hand-rolled input-sequence RPC.

## Accessing the Local Player

To get the local player's controller from client code, use the async helper that waits until the controller has replicated from the server:

```typescript
const controller = await world.gameMode?.waitForLocalPlayerController();
const pawn = controller?.getPawn();
```

In standalone (single-player) mode, `world.getPlayerControllerAt(0)` returns the single local controller synchronously.

On the server, access all connected controllers with `world.getNodes(ENGINE.PlayerController)`.

Reference: See `PlayerController.ts`, `Pawn.ts`, and `Controller.ts` in engine source.
