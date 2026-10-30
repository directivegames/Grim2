# Matchmaking

A shipped multiplayer game runs on Genesys servers, and matchmaking is the only way to reach them. `findMatch` and party follow pick a server and fill `joinParams`; the session after connect is [game-mode](game-mode.md) (handshake, `LOAD_LEVEL`, the scene `PlayerSpawner`).

Call `connectToServer` only to test a local server in the editor. The editor play session does not use matchmaking. Engine doc: `node_modules/@gnsx/genesys.js/docs/multiplayer/matchmaking.md` describes the API; the rule above still applies.

## Queues

Use one of these ids. Every queue matches players of the same game. Pass `skill` when you have a rating. The default is `1000`. The gap below is how far a player, or a team average, may sit from the match average. It widens while the oldest ticket waits.

| Id | Players | Skill |
| --- | --- | --- |
| `solo-1v1` | 2 | Each player starts within 50. At 10 s, 100. At 20 s, 200. At 40 s, 500 |
| `duo-2v2` | 4, two teams of 2 | Each team's average follows the same steps |
| `squad-4v4` | 8, two teams of 4 | Each team's average starts within 75. At 15 s, 150. At 30 s, 300. Players must accept the match |
| `ffa-8` | 8, or 4 after 30 s | Each player starts within 100. At 20 s, 250. At 45 s, 500 |

Call `acceptMatch` when the ticket is in `REQUIRES_ACCEPTANCE` status.

A party is one ticket, sized to the players you queue together. Two players fill `solo-1v1` or one team of `duo-2v2`. Four players fill `duo-2v2` or one team of `squad-4v4`. `squad-4v4` and `ffa-8` allow a party of up to 8. A smaller `ffa-8` party waits, and after 30 s four players can start.

## Solo search

Source: node_modules/@gnsx/genesys.js/docs/multiplayer/matchmaking.md
```ts
const result = await gameLoop.findMatch({
  queueId: 'solo-1v1',
  onStatus: (status) => { /* drive a searching UI */ },
  onTicket: (ticket) => { /* player list, acceptance */ },
});
```

Do not configure the matchmaking API in game code. The host injects `matchmaking.client`, and that client sends the signed-in player's credential. With no client, `findMatch` throws `ENGINE.MatchmakingError`.

**Never set `gameId` or `matchmaking` yourself.** The host (editor, player, SDK) passes the published game's id in the `options` that `main()` receives, and the injected client sends it so placement finds the game's approved release. A hand-written id such as the project name overrides it, and every search then fails with `Placement failed (422): game <id> has no approved release` even though the game is published. Spread the host options through:

Source: project templates' `main()`; shape only, verify with snipcheck
```ts
export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  return new MyGame(container, {
    ...options, // carries the published game's id and the host matchmaking client
    defaultGameModeClass: MyGameMode,
  });
}
```

While a ticket is `REQUIRES_ACCEPTANCE`, call `gameLoop.acceptMatch(true | false)`; the `findMatch` promise is still pending. `cancelMatch` aborts the wait and cancels a solo ticket that has not connected.

`result.ackError` means the game socket connected but the matchmaking ack failed; the player is still in the server. Other failures throw `ENGINE.MatchmakingError`; `error.aborted` is a local cancel.

## Parties

Use `gameLoop.matchmaking`, not `findMatch`, so the group shares one ticket.

Source: node_modules/@gnsx/genesys.js/docs/multiplayer/matchmaking.md
```ts
await gameLoop.matchmaking.createParty({ queueId: 'duo-2v2', minPlayers: 2, maxPlayers: 2 });
await gameLoop.matchmaking.setReady(true);
const result = await gameLoop.matchmaking.followParty();
```

`createParty` returns the party; `followParty` returns the connected match; `onParty` fires on each update. `autoStart` defaults to true; call `startParty()` when false. `leaveParty` does not cancel the ticket the other members are on.

## Server

Placement connects with `joinParams.sessionId` so a second match on the same URL is a new connection. The account id is not on the handshake. A local `connectToServer` call sends no session id.
