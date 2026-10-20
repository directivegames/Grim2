# Matchmaking

A shipped multiplayer game runs on Genesys servers. Matchmaking is the only way to connect to those servers. `findMatch` and party follow choose a server and fill `joinParams`. The session after connect is [game-mode](game-mode.md): handshake, `LOAD_LEVEL`, and the scene `PlayerSpawner`.

Use `connectToServer` only to test a local server in the editor. The editor play session does not use matchmaking. Do not use `connectToServer` for a shipped game.

API detail: `docs/multiplayer/matchmaking.md` in `@gnsx/genesys.js`. That page describes the API. This skill's connection rule still applies.

## Solo search

```typescript
const result = await gameLoop.findMatch({
  queueId: 'solo-1v1',
  onStatus: (status) => { /* drive a searching UI */ },
  onTicket: (ticket) => { /* player list, acceptance */ },
});
```

Configure the API on the game loop. Omit `baseUrl` to use `ENGINE.DEFAULT_MATCHMAKING_BASE_URL`. `playerId` is the matchmaking identity. Omit it and one is generated on first use. It is not the `ClientId` the game server assigns.

**Never set `gameId` yourself, not on the game loop and not in `matchmaking`.** The host (editor, player, SDK) passes the published game's id in the `options` that `main()` receives, and matchmaking uses it to find the game's approved release and its server. A hand-written id such as the project name overrides it, and every search then fails at placement with `Placement failed (422): game <that id> has no approved release`, even though the game is published and approved. `matchmaking.gameId` falls back to the game loop's `gameId`, so leaving both unset is correct.

Pass the host's options through, as the project templates do:

```typescript
export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  return new MyGame(container, {
    ...options, // carries the published game's id; do not add gameId or matchmaking.gameId
    defaultGameModeClass: MyGameMode,
  });
}
```

While a ticket is `REQUIRES_ACCEPTANCE`, call `gameLoop.acceptMatch(true)` or `acceptMatch(false)`. The `findMatch` promise is still pending. `cancelMatch` aborts the wait and cancels a solo ticket that has not connected.

`result.ackError` means the game socket connected and the matchmaking ack failed. The player is still in the server. Other failures throw `ENGINE.MatchmakingError`. `error.aborted` is a local cancel.

## Parties

Use `gameLoop.matchmaking`, not `findMatch`, so the group shares one ticket.

```typescript
await gameLoop.matchmaking.createParty({
  queueId: 'duo-2v2',
  minPlayers: 2,
  maxPlayers: 2,
});
await gameLoop.matchmaking.setReady(true);
const result = await gameLoop.matchmaking.followParty();
```

`createParty` returns the party. `followParty` returns the connected match. `onParty` fires on each party update. `autoStart` defaults to true. Call `startParty()` when it is false. `leaveParty` does not cancel the ticket the other members are on.

`listQueues()` and `health()` are on the same controller. Shipped queue ids include `solo-1v1`, `duo-2v2`, `squad-4v4`, and `ffa-8`.

## Server

Placement connects with `joinParams.sessionId`, `playerId`, and, when the backend sent one, `authToken`. A local `connectToServer` call does not send those fields. Reject guests in `canPlayerJoin` by checking those values against the match this process is hosting. A non-empty check is not proof the token was issued for this session.
