# Session plan, trust, and online feel

The short rules are in [SKILL.md → Decide](../SKILL.md#decide). This file holds the solo-or-online table, the session plan defaults, the full trust model, the GameMode flow online, the online-feel and "it feels laggy" tables, reconnect, and the limitations and traps for these areas.

## Solo or online

A short game pitch is solo. Build multiplayer only when the user says online, co-op, versus, PvP, lobby, MMO, or "with friends". Solo code still runs through the same engine model (standalone counts as server), so solo games need no networking work.

| User said | Build |
|---|---|
| Nothing about other players | Solo. Skip this skill. |
| Co-op, versus, party, "play with friends" | Server-authoritative session: built-in `PlayerController` / `Pawn` / `PlayerInfo`, gameplay through `@ServerRPC`, shared state on replicated nodes. |
| Scoreboard, teams, rounds | Same, plus a `GameSessionInfo` subclass for match state and a `PlayerInfo` subclass for per-player fields. |
| MMO, persistent world | Same authority model. Say plainly that the engine has no player-progress save; `.engine/src/storage/` is asset storage. |

## Session plan

Before any networking code, write one line in `GAME.md` and say it to the creator. Decide it from the experience, not the genre name:

`Session: <drop-in world | bounded match> — <why>; start: <when play begins / quorum N>; late join: <spawn in | spectate | refuse>; below quorum / end: <keep playing | end round → result → back to lobby>.`

| Experience | Default |
|---|---|
| Hang out, build, explore, sandbox, co-op roam | Drop-in world: play starts on join, late joiners spawn in, nothing ends when players leave |
| Rounds, races, versus, teams, a winner | Bounded match: `GameSessionInfo.sessionState` WaitingForPlayers → Starting (`countdown`) → InProgress → Ending; quorum 2; late joiners spectate until the next round; below quorum mid-round → end the round and return to waiting |

## Trust model

Spell it out for the creator: the server decides every outcome, so a modified client cannot grant itself score, items, or hits. That covers state the game routes through the server; it is not anti-cheat (no aimbot or speed-hack detection beyond the server's own movement validation) and the engine has no ranked or anti-tamper layer. Do not promise ranked-grade fairness.

Store ownership is outside it: each client reads ownership from core through the in-game store, and no game server verifies it. Treat owned items as cosmetic or convenience; never gate competitive power on them without a server check (`monetization-store-items`).

## GameMode flow online

`genesys-game-boot` owns the single-player state machine in the GameMode. Online:
- Match rules, spawning, scoring, and win checks stay in server-guarded GameMode code and write to `GameSessionInfo` / `PlayerInfo`.
- Each client shows title, HUD, pause, and result from replicated state (`GameSessionInfo.sessionState`, `countdown`, `PlayerInfo.score`), read with `world.getNode(ENGINE.GameSessionInfo)` and `world.getNodes(ENGINE.PlayerInfo)`.
- Get the local player with `await world.gameMode?.waitForLocalPlayerController()`. In standalone, `world.getPlayerControllerAt(0)` is synchronous.

## Online feel

| Data | Where it changes | What the client does |
|---|---|---|
| Own pawn movement on `CharacterPawn` / GSS prediction | Server, with client prediction | Show the local move the same frame. Accept the correction. |
| Score, inventory, damage, door state | Server only | Display the replicated property. |
| A hit spark everyone sees | Server decides the hit | `@MulticastRPC` plays the effect (`genesys-vfx`). |
| Names, chat, scoreboard text | Server | Render with text setters. |

A client that applies damage or grants items locally is a defect even when it looks fine in solo play.

### "It feels laggy" reports

A capture can't show smoothness; only playing can: after the two-client check, ask the creator to play two windows for a minute and say which row matches.

| Symptom | Likely engine cause | Fix |
|---|---|---|
| Own character rubber-bands or snaps back | Client and server disagree on movement: speed, jump or a movement mode changed only on the client, or a teleport written on the client | Change movement parameters on the server (or both, from replicated state); teleports and respawns from the server (`genesys-movement` for GSS) |
| Other players stutter or jump | `interpolationDelay` on the GameMode below 2 × the send interval (the engine logs a warning), or `setReplicationSendRate` lowered | Keep `interpolationDelay` ≥ 2 / send rate (default 2/30 s at 30 Hz) |
| Other players or props frozen, then teleport | Plain `Pawn` or root with no transform replication | `CharacterPawn` / `MovementPawn`, or replicated position/rotation properties |
| Fire, door, pickup reacts late | Waiting for the `@ServerRPC` round trip before any feedback | Play the local cosmetic (muzzle flash, click sound) at once; keep the outcome on the server |
| Hit or score flickers back | Client wrote a replicated property; the server overwrote it | Write on the server only |
| Late joiner sees a door closed that is open | State sent by `@MulticastRPC` | Replicated property + `onRep<Prop>()` |
| An important action is sometimes lost | `{ reliable: false }` on an RPC that must arrive | Drop the flag; RPCs are reliable by default ([rpcs](rpcs.md)) |
| Everyone lags at once, worse with more players | Server frame time, not the network | Profile the server-side tick (`genesys-profiler`) |

## Reconnect

`PlayerInfo.identityToken` is server-only (not replicated) and re-links a reconnecting player to preserved info. Do not invent a guest account or a save slot beside it.

## Limitations

- A store item's effect granted in an online game → store ownership is not server-verified (*Trust model*) → cosmetic or convenience only.

## Traps

- `getPlayerControllerForClient` returns `null` during load → the controller spawns after level load → wait for `onPlayerJoined` / `waitForLocalPlayerController`.
- `this.getPawn<MyPawn>()` fails to typecheck → `getPawn()` is not generic → `const pawn = this.getPawn(); if (pawn instanceof MyPawn) …`.
- An `onKeyDown(key)` method on a controller never runs → it is not a hook → override `handleKeyDown(e: KeyboardEvent): boolean` (or add to the `DefaultPlayerController.onKeyDown` delegate).
- Matches start with one player, or never end when players leave → no session plan → write the Session line and implement start, late join, and below-quorum from it.
