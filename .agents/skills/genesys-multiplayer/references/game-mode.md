# GameMode

GameMode owns the canonical rules of the match. The world constructs it on the server, in standalone, and on clients when a game-mode class is configured. Call join policy, spawning, and `restartPlayer` only on the server. Clients read replicated `PlayerInfo` and `GameSessionInfo` instead.

`GameMode` itself is an unreplicated `InfoNode` — the framework classes it spawns (`PlayerController`, `Pawn`, `PlayerInfo`, `GameSessionInfo`) are the replicated `SceneNode`/`PrimitiveNode` roots; each already sets `replicated` and creates `ReplicationInfo` internally, so subclassing them "just works" without extra replication plumbing (see [node-replication](node-replication.md)).

## Scene prerequisite

Every multiplayer scene needs one scene-placed `PlayerSpawner`. `getPlayerSpawner()` throws when it is missing. Standalone spawning does not use it. Do not hand-spawn `PlayerController`, `Pawn`, `PlayerInfo`, or `GameSessionInfo` from your own `MultiplayerSpawner`.

## What GameMode Does

- Decides whether a connecting player is allowed to join (`canPlayerJoin`) or rejoin (`canPlayerRejoin`).
- After `LEVEL_LOADED`, spawns `PlayerInfo`, then `PlayerController` and `Pawn`.
- Responds to player disconnects (`onPlayerDisconnected`) once a controller or pawn exists. A disconnect during level load does not call it.
- Provides factory hooks for which classes are instantiated for each player.

## Lifecycle Hooks

### canPlayerJoin

Called when a client requests to join, before they are admitted. Return `{ allowed: false, reason: string }` to reject; the client receives the reason.

```typescript
override canPlayerJoin(_clientId: ClientId, joinParams: JoinParams): PlayerJoinResult {
  if (joinParams.password !== this.requiredPassword) {
    return { allowed: false, reason: 'Invalid password.' };
  }
  return { allowed: true };
}
```

### onPlayerJoined

Called when the controller and pawn are spawned. In multiplayer that is after the client finishes loading the level, not at handshake. `PlayerInfo` already exists. The default implementation spawns a PlayerController, assigns ownership, and calls `handleNewPlayer` to spawn the pawn. Override to add custom logic after spawn — `super.onPlayerJoined` must be called to preserve the standard flow.

A connected client has no controller or pawn until this runs. `PlayerInfo` is already spawned. Do not treat `getPlayerControllerForClient` returning `null` during load as an error.

```typescript
override async onPlayerJoined(clientId: ClientId): Promise<PlayerController | null> {
  const controller = await super.onPlayerJoined(clientId);
  if (controller) {
    this.assignTeam(controller);  // custom post-spawn logic; do not call handleNewPlayer again
  }
  return controller;
}
```

### onClientLevelLoaded

Called after the client's PlayerInfo, PlayerController, and pawn already exist. Override for post-entry logic (HUD, match start). Do not spawn those entities here.

```typescript
override async onClientLevelLoaded(controller: PlayerController, clientId: ClientId): Promise<void> {
  await super.onClientLevelLoaded(controller, clientId);
  this.announcePlayerReady(clientId);
}
```

### onPlayerDisconnected

Called when a player disconnects after they have entered the world (controller or pawn exists). Use it to clean up player-owned nodes, notify other players, or start a respawn timer. It does **not** run if the client disconnects while still loading the level — do not pair `canPlayerJoin` bookkeeping with this hook unless you also handle that early-leave path.

```typescript
override onPlayerDisconnected(clientId: ClientId, pawn: Pawn | null, reason: DisconnectReason): void {
  super.onPlayerDisconnected(clientId, pawn, reason);
  this.broadcastPlayerLeft(clientId);
}
```

`DisconnectReason` is either `Voluntary` (player quit) or `Timeout` (connection lost).

### canPlayerRejoin

Called at handshake when `joinParams.identityToken` matches a snapshot in `inactivePlayerInfos`. The default allows the rejoin. The server stores that snapshot only when `PlayerInfo.identityToken` was set before disconnect. The engine does not save the token on the client: persist it in game code and send the same `joinParams` on the next connect. A new `ClientId` is assigned every connection.

### Display names

`spawnPlayerInfoForClient` sets `playerName` from `generatePlayerName(clientId)`. `joinParams` are not applied automatically. Override `generatePlayerName`, or assign a name you already validated in `canPlayerJoin`. Still render the string as text ([ui-security](ui-security.md)).

To trigger a respawn from server code, call `restartPlayer(controller)`. Override `handleNewPlayer` or `restartPlayer` to insert custom respawn logic such as resetting health or applying spawn protection.

## Factory Methods

The preferred way to configure factories is via `initialize(options)`. Pass the factory functions in the options so they compose cleanly with base class options.

```typescript
@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  public override initialize(options?: ENGINE.GameModeOptions): void {
    super.initialize({
      ...options,
      pawnFactory: async () => MyCustomPawn.create(),
      playerControllerFactory: async () => MyPlayerController.create(),
      playerInfoFactory: async () => MyPlayerInfo.create(),
      gameSessionInfoFactory: () => MySessionInfo.create(),
    });
  }
}
```

The engine calls these factories when the player enters the world (`onPlayerJoined` and the surrounding PlayerInfo spawn). Each factory must return a fully constructed node created with `.create()` — do not pass a `world` argument; the engine wires the world when adding the node.

Override the getter methods (`getPawnFactory`, `getPlayerControllerFactory`, `getPlayerInfoFactory`) instead when the factory depends on runtime state that is not available at `initialize` time.

## Registering GameMode

Decorate the GameMode subclass with `@ENGINE.GameClass()`, then pass it as `defaultGameModeClass` when constructing the game loop.

```typescript
import * as ENGINE from '@gnsx/genesys.js';
import { MyGameMode } from './myGameMode.js';

class MyGame extends ENGINE.BaseGameLoop {
}

export function main(container: HTMLElement): ENGINE.IGameLoop {
  return new MyGame(container, {
    defaultGameModeClass: MyGameMode,
  });
}
```

`defaultGameModeClass` is used when no scene file specifies a game mode. When a scene is loaded, the game mode stored in the scene takes precedence.

## GameSessionInfo

GameMode spawns a `GameSessionInfo` node after the world begins play (so a scene
`PlayerSpawner` is already registered). Unlike GameMode
itself, `GameSessionInfo` is replicated and is visible to all clients. Use it as the
canonical place to store match state that clients need to read.

Built-in replicated properties on `GameSessionInfo`:
- `sessionState` — `Initializing`, `WaitingForPlayers`, `Starting`, `InProgress`, `Ending`, or `Shutdown`.
- `playerCount` — number of connected players.
- `maxPlayers` — maximum players allowed.
- `countdown` — countdown timer value, or `undefined` when not counting down.

The server keeps these in sync automatically. On the server, read and write them via `gameMode.getGameSessionInfo()`. On clients, `GameSessionInfo` is a regular replicated node in the world — retrieve it with `world.getNode(ENGINE.GameSessionInfo)`.

To expose additional match state to clients, extend `GameSessionInfo` and add replicated properties, then register the subclass via `getGameSessionInfoFactory()` on your `GameMode`.

```typescript
@ENGINE.GameClass()
class MySessionInfo extends ENGINE.GameSessionInfo {
  @ENGINE.property({ replicate: true })
  public roundNumber: number = 1;

  @ENGINE.property({ replicate: true })
  public winningTeamId: number = -1;
}

// In MyGameMode:
override getGameSessionInfoFactory(): () => ENGINE.GameSessionInfo {
  return () => MySessionInfo.create();
}
```

## PlayerInfo

The server spawns one `PlayerInfo` node per connected player. `PlayerInfo` is replicated, so all clients can read every player's data — use it for scoreboards, player lists, team assignments, and lobby ready-up systems.

Built-in replicated properties on `PlayerInfo`:
- `clientId` — `ClientId` (uint16) unique identifier for the player's connection.
- `playerName` — display name.
- `isReady` — ready state for lobby systems.
- `team` — team assignment string (e.g., `'red'`, `'blue'`, `'spectator'`, or empty for FFA).
- `score` — current score.
- `ping` — current ping in milliseconds.
- `isAlive` — whether the player is currently alive.
- `kills` / `deaths` — kill and death counts for deathmatch modes.

`identityToken` is present on `PlayerInfo` but is not replicated — it is server-only and used to re-link a reconnecting player to their preserved info.

On the server, access a specific player's info via `controller.getPlayerInfo()`. On clients, all `PlayerInfo` instances are regular replicated nodes in the world — retrieve them with `world.getNodes(ENGINE.PlayerInfo)` to build a scoreboard or player list.

To add per-player state that clients need to see, extend `PlayerInfo` and register the subclass via `getPlayerInfoFactory()` on your `GameMode`.

```typescript
@ENGINE.GameClass()
class MyPlayerInfo extends ENGINE.PlayerInfo {
  @ENGINE.property({ replicate: true })
  public characterClass: string = 'warrior';

  @ENGINE.property({ replicate: true })
  public coins: number = 0;
}

// In MyGameMode:
override getPlayerInfoFactory(): () => Promise<ENGINE.PlayerInfo> {
  return async () => MyPlayerInfo.create();
}
```

## What Not to Do

- Do not ship a multiplayer scene without a scene-placed `PlayerSpawner`.
- Do not call spawning, `restartPlayer`, or join policy from a client. Those methods are ordinary TypeScript: a client call is not rejected for you, and it will not update the server.
- Do not store match state that clients need to see directly on GameMode. GameMode is not replicated — put shared state on `GameSessionInfo` or another replicated node instead.
- Do not spawn nodes from `canPlayerJoin`. Only spawn from `onPlayerJoined` or later. A client that is still loading the level has not entered the game yet.

Reference: See GameMode.ts in engine source.
