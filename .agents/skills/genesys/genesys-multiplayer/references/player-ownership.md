# Player Control and Autonomous Proxy

All actors in the game are server-authoritative — the server spawns them, controls their state, and replicates updates to clients. PlayerController and the Pawn it possesses are no exception: they are still replicated actors owned and managed by the server. What makes them special is the `AutonomousProxy` role granted to the controlling client.

## AutonomousProxy: How It Works

When a player joins, the server:

1. Spawns a PlayerController and marks it with `replicated = true`, `onlyRelevantToOwner = true`, and `netOwningClientId = clientId`.
2. Calls `setAutonomousProxy(true)` on the PlayerController so the owning client has `netLocalRole = AutonomousProxy` for it.
3. Spawns a Pawn and applies the same setup.

`AutonomousProxy` means the controlling client is allowed to perform movement and other actions locally without waiting for a server round-trip. The client applies input immediately for responsiveness, sends those actions to the server via `@ServerRPC`, and the server validates and replicates the authoritative result back. If the server's result differs from what the client predicted, the client corrects itself.

All other actors have `netLocalRole = SimulatedProxy` on a given client. The client displays them based on replicated state but cannot act on them.

## Checking the Controlling Client

```typescript
// Inside a PlayerController or Pawn:
this.isOwnedByLocalClient()     // true only on the owning client
this.isLocalAutonomousProxy()   // true on the owning client (AutonomousProxy role)

// Check the owning client ID:
this.netOwningClientId          // ClientId (uint16); 0 means server-owned / no owner
```

Use `isOwnedByLocalClient()` to decide whether to show a local HUD element or attach a local camera.

## onlyRelevantToOwner

PlayerController is automatically flagged as `onlyRelevantToOwner = true`. The server only replicates it to the owning client; other clients never receive it. Apply this to any actor that is private to a single player (e.g., a player's inventory actor).

```typescript
override beginPlay(): void {
  super.beginPlay();
  if (!this.hasAuthority()) return;

  // replicated = true is set in InventoryActor's constructor.
  const inventory = InventoryActor.create({ world: this.getWorld()! });
  inventory.netOwningClientId = ownerClientId;
  inventory.onlyRelevantToOwner = true;
  this.getWorld()!.addActor(inventory);
}
```

## Input Flow for the Controlled Pawn

The client runs the PlayerController's `IInputHandler` methods locally (keyboard, mouse, gamepad events). For movement, `CharacterMovementComponent` applies the input on the client immediately as a prediction, then sends it to the server. The server validates and replicates the authoritative position back; the client corrects if needed.

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

`CharacterPawn` and `CharacterMovementComponent` include client-side prediction and server reconciliation automatically. The engine applies input locally on the client immediately for smooth feel, then corrects the position if the server disagrees. This is handled internally; no extra code is required when using these classes.

For custom actors that need prediction, implement the prediction logic manually and use `@ServerRPC` to send input sequences with a tick counter. Consult `InputBuffer.ts` and `MovementPrediction.ts` in engine source for the pattern used by `CharacterPawn`.

## Accessing the Local Player

To get the local player's controller from client code, use the async helper that waits until the controller has replicated from the server:

```typescript
const controller = await world.netWorld.waitForLocalPlayerController();
const pawn = controller?.getPawn();
```

In standalone (single-player) mode, `world.getPlayerController(0)` returns the single local controller synchronously.

On the server, access all connected controllers with `world.getActors(ENGINE.PlayerController)`.

Reference: See PlayerController.ts and Actor.ts in engine source.
