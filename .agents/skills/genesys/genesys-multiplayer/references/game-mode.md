# GameMode

GameMode is the server-only class that owns the canonical rules of the match. It runs only on the server and in standalone (single-player) mode. It does not exist on clients; clients must not call GameMode methods directly.

## What GameMode Does

- Decides whether a connecting player is allowed to join (`canPlayerJoin`).
- Spawns PlayerController, Pawn, and PlayerInfo for each player that joins (`onPlayerJoined`).
- Responds to player disconnects and handles cleanup or respawn logic (`onPlayerDisconnected`).
- Provides factory hooks for customising which classes are instantiated for each player.

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

Called after a client is admitted. The default implementation spawns a PlayerController, adds it to the world, assigns ownership, and calls `handleNewPlayer` to spawn the pawn. Override to add custom logic after spawn — `super.onPlayerJoined` must be called to preserve the standard flow.

```typescript
override async onPlayerJoined(clientId: ClientId): Promise<PlayerController | null> {
  const controller = await super.onPlayerJoined(clientId);
  if (controller) {
    this.assignTeam(controller);  // custom post-spawn logic; do not call handleNewPlayer again
  }
  return controller;
}
```

### onPlayerDisconnected

Called when a player disconnects. Use it to clean up player-owned actors, notify other players, or start a respawn timer.

```typescript
override onPlayerDisconnected(clientId: ClientId, pawn: Pawn | null, reason: DisconnectReason): void {
  super.onPlayerDisconnected(clientId, pawn, reason);
  this.broadcastPlayerLeft(clientId);
}
```

`DisconnectReason` is either `Voluntary` (player quit) or `Timeout` (connection lost).

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
    });
  }
}
```

The engine calls these factories in `onPlayerJoined`. Each factory must return a fully constructed actor created with `.create()` — do not pass a `world` argument; the engine wires the world when adding the actor.

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

GameMode spawns a `GameSessionInfo` actor at the start of play. Unlike GameMode itself, `GameSessionInfo` is replicated and is visible to all clients. Use it as the canonical place to store match state that clients need to read.

Built-in replicated properties on `GameSessionInfo`:
- `sessionState` — current lifecycle state (`WaitingForPlayers`, `InProgress`, `Ending`, etc.).
- `playerCount` — number of connected players.
- `maxPlayers` — maximum players allowed.
- `countdown` — countdown timer value, or `undefined` when not counting down.

The server keeps these in sync automatically. On the server, read and write them via `gameMode.getGameSessionInfo()`. On clients, `GameSessionInfo` is a regular replicated actor in the world — retrieve it from the world's actor list.

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

The server spawns one `PlayerInfo` actor per connected player. `PlayerInfo` is replicated, so all clients can read every player's data — use it for scoreboards, player lists, team assignments, and lobby ready-up systems.

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

On the server, access a specific player's info via `controller.getPlayerInfo()`. On clients, all `PlayerInfo` actors are regular replicated actors in the world — retrieve them with `world.getActors(ENGINE.PlayerInfo)` to build a scoreboard or player list.

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

- Do not call GameMode methods from a client. They only exist on the server; calling them on a client throws or silently does nothing.
- Do not store match state that clients need to see directly on GameMode. GameMode is not replicated — put shared state on `GameSessionInfo` or another replicated actor instead.
- Do not spawn actors from `canPlayerJoin`. Only spawn from `onPlayerJoined` or later.

Reference: See GameMode.ts in engine source.
