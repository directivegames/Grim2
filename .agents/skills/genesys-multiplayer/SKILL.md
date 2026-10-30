---
name: genesys-multiplayer
description: "Online games: session plan, server authority, replication, RPCs, GameMode, spawning, matchmaking, chat, prediction, reconnect, Safe UI for network strings. Use for multiplayer, online, co-op, versus, PvP, lobby, server, RPC, replicate, rewind, GSS, findMatch, queue, party, \"feels laggy\", rubber-banding. Not for solo games or the single-player screen flow (use `genesys-game-boot`)."
metadata:
  tokens: 3079
---

# Multiplayer

This skill owns networked play: who changes state, how it reaches clients, and how it feels online. The rule: the server is the only machine that changes game state. Clients send requests (`@ServerRPC`) and display the replicated result.

## Use another skill when
- The GameMode screen flow (title → play → pause → result → retry), boot path, and bundle proof → `genesys-game-boot`
- HUD, scoreboard, lobby, or chat widget layout and general Safe UI → `genesys-ui`
- Pawn locomotion and movement modes → `genesys-movement`
- Weapons, damage, health → `genesys-combat`
- A hit, muzzle, or explosion effect → `genesys-vfx`
- Two-client evidence and playtest checklists → `genesys-verification`
- A shop or paid item → `monetization-store` (store ownership is not server-verified; see Limitations)
- Finding an engine networking class or doc → `genesys-engine` (Find an engine class)

## Decide

- **Solo or online.** A short pitch is solo; build multiplayer only when the user says online, co-op, versus, PvP, lobby, MMO or "with friends". Solo needs no networking work (standalone counts as server). Scoreboards, teams and rounds add a `GameSessionInfo` and a `PlayerInfo` subclass; an MMO gets the same model and a plain statement that the engine has no player-progress save.
- **Session plan.** Before any networking code, write one line in `GAME.md` and say it to the creator, decided from the experience, not the genre:
  `Session: <drop-in world | bounded match> — <why>; start: <when play begins / quorum N>; late join: <spawn in | spectate | refuse>; below quorum / end: <keep playing | end round → result → back to lobby>.`
  Hang-out, build and co-op roam games are drop-in worlds; rounds, races, versus and teams are bounded matches (quorum 2, late joiners spectate). Defaults: [session](references/session.md#session-plan).
- **Trust model.** Tell the creator: the server decides every outcome, so a modified client cannot grant itself score, items or hits. It is not anti-cheat and there is no ranked or anti-tamper layer; do not promise ranked-grade fairness. Store ownership is not server-verified ([session](references/session.md#trust-model)).

**Authority model.** There is one: server authority. Pick the transport per feature:

| Feature | Use |
|---|---|
| Own pawn movement | Classic `BasePawnMovementNode` or GSS prediction (`AutonomousProxy`). Built in; pick per [gameplay-systems](references/gameplay-systems.md). |
| Predicted gameplay that rewinds and lag-compensates | GSS (`GSSNode`), see `genesys-movement` |
| A custom simulation that needs rewind and does not fit GSS | `NetPredictionManager`, see [network-prediction](references/network-prediction.md) |
| Connecting a shipped game to a server | Matchmaking (`gameLoop.findMatch`), see [matchmaking](references/matchmaking.md) |
| An action the server must allow (fire, interact, respawn) | `@ENGINE.ServerRPC()` on a node the client owns |
| State every client reads (health, score, door open) | `@ENGINE.property({ replicate: true, net: {...} })`, written on the server |
| A one-off everyone sees (explosion) | `@ENGINE.MulticastRPC()`, never for state |
| A message for one player (damage flash) | `@ENGINE.ClientRPC()`; node needs `netOwningClientId` |
| A runtime-spawned networked node | `MultiplayerSpawner` with `@ENGINE.SpawnMethod()` |
| Private per-player node | `@ENGINE.SpawnMethod({ audience: 'owner' })` |
| Talking | Built-in session text chat. No voice. |

## Build

Order of work:
1. Decide where the code runs — server, client, or both ([server-authority](references/server-authority.md)).
2. Choose the system that owns predicted gameplay before movement, combat or a custom simulation ([gameplay-systems](references/gameplay-systems.md)).
3. State or events outside it: RPC, replicated property, or both ([rpcs](references/rpcs.md), [node-replication](references/node-replication.md)).
4. Match rules and player lifecycle ([game-mode](references/game-mode.md)); a player-controlled node ([player-ownership](references/player-ownership.md)); connecting a shipped game ([matchmaking](references/matchmaking.md)).
5. Guard authority-only logic with `this.hasAuthority()` or `NetRuntime.isServer()`; render replicated and join strings safely ([ui-security](references/ui-security.md)).
6. For a shipped multiplayer game, load `genesys-player-accounts` and turn on **Show Sign-in Bar** in Project Settings, unless the game already has its own account UI. Republish so players can sign in.

Core rules:
- Import with `import * as ENGINE from '@gnsx/genesys.js'`; `ENGINE.NetRuntime` gives runtime checks. Never read it in constructors or `initialize()`; guard in `beginPlay` or later.
- `this.isRoot = true` plus `this.replicated = true` makes a replicated entity root (auto-creating `ReplicationInfo`); nested `replicated` children join its member map, a nested `isRoot && replicated` node is its own entity. Setting `replicated` on a client does nothing; do not flip it after registration.
- Only nodes in a replicated entity's member map sync their `replicate: true` properties. Give every numeric property a `net.netType`.
- All replicated nodes are server-authoritative, including `PlayerController` and its `Pawn`, whose owning client is `AutonomousProxy`.
- Place one `PlayerSpawner` in every multiplayer scene; multiplayer spawning throws without it.
- A shipped game connects with `gameLoop.findMatch` / `gameLoop.matchmaking` and never sets `gameId` or `matchmaking`: the host injects the matchmaking client ([matchmaking](references/matchmaking.md)). `connectToServer` is only for a local editor test.
- Match rules, spawning and `restartPlayer` run only on the server. Each client also has a local, unreplicated GameMode ([game-mode](references/game-mode.md)).
- **`onRep<PropName>()`** (`isOpen` → `onRepIsOpen`) runs on clients with no arguments after an update that changed that property. Use it for presentation; it never runs on the server, so call the same code there directly ([node-replication](references/node-replication.md#onreppropname-callbacks)).

### GameMode flow and online feel

Match rules, spawning, scoring and win checks stay in server-guarded GameMode code and write to `GameSessionInfo` / `PlayerInfo`; each client shows its screens from that replicated state. Get the local player with `await world.gameMode?.waitForLocalPlayerController()`.

Online, the owner's move shows the same frame and accepts corrections; score, inventory, damage and door state only display replicated values; one-off effects play from `@MulticastRPC`. A client that applies damage or grants items locally is a defect even when it looks fine in solo play. For "it feels laggy" (rubber-banding, stutter, late reactions, flicker), ask the creator to play two windows for a minute and match the symptom table in [session](references/session.md#it-feels-laggy-reports).

### Safe UI for network strings (mandatory)

Replicated strings and `joinParams` are untrusted for HTML; the engine does not sanitize them. Render names, chat and team text with `textContent` or text setters (`setLabel`, `setMessage`, `setTitle`), never `innerHTML`, `iconHtml`, `setHTML` or `imageHtml`; icons come from `ENGINE.Icons.*` or static SVG you author. Validating names from `joinParams` in `GameMode` helps but does not replace safe rendering. Patterns: [ui-security](references/ui-security.md), [player-list-safe](references/player-list-safe.md).

### Chat, build id, reconnect

- **Chat.** Every multiplayer client gets a built-in text chat; configure it on the GameMode (`chatEnabled`, fade, history, emoji, join notices, `filterChatMessage`). Never build a second chat on RPCs. There is no voice.
- **Build id.** Show `build <BUILD_ID>` (from `src/const.ts`, bumped per build handed to players) in a corner of the title and pause screens, so reports name the build.
- **Reconnect.** `PlayerInfo.identityToken` (server-only) re-links a reconnecting player; invent no guest account or save slot.

Chat options and the build-id badge code: [chat-and-build-id](references/chat-and-build-id.md).

## Limitations
- Store items are not server-verified: [session](references/session.md#limitations). Classic and GSS pawns mis-predict each other: [gameplay-systems](references/gameplay-systems.md#limitations).

## Traps
- Score or health changes in one window only → client wrote a replicated property → write on the server via `@ServerRPC`.
- Runtime-spawned node missing on clients → bare `world.add` on the server → spawn through a `MultiplayerSpawner` `@SpawnMethod`.
- `@ClientRPC` never arrives → node has no `netOwningClientId` → set it, or use the owned controller/pawn.
- Late joiner misses an open door → state sent with `@MulticastRPC` → use a replicated property.
- Plain `Pawn` frozen on other clients → no transform replication on plain roots → use `CharacterPawn`/`MovementPawn` or replicated position/rotation properties.
- `NetRuntime` wrong in a constructor → runtime not set yet → read it in `beginPlay` or later.
- Player name renders as markup → `innerHTML` / `setHTML` → `textContent` or a text setter.
- Second chat panel → RPC chat built beside the built-in one → configure the GameMode chat properties.
- A `@ServerRPC` fires from server code too → with authority it executes directly → wrap the call site in `if (NetRuntime.isClient())` when the server should not trigger it.
- `onRepX` never fires → wrong name, no `replicate: true` / `net` block, or expected on the server → fix the name; call the presentation directly on the server.
- Spawning throws, or no player appears → the scene has no `PlayerSpawner`.
- Matchmaking fails with `Placement failed (422)`, or a shipped game calls `connectToServer` → `gameId` hand-set or matchmaking bypassed → [matchmaking](references/matchmaking.md).
- Controller, pawn, input and session traps (`getPawn<T>`, `onKeyDown`, null controller during load, no session plan): [session](references/session.md#traps).

## Done
- Two clients: the owner's move is immediate, the other client's copy follows replication, and a score or hit changes only after the server accepts it. Query the replicated fields; a capture of one window is not this test. The two-client recipe and evidence are owned by `genesys-verification`; say exactly which items stayed unverified.
- The Session line and the trust-model sentence are in `GAME.md`, and start, late join, and below-quorum behave as written.
- A build id shows in a corner of the title and pause screens.
- Every state-changing path goes through a server-guarded write.
- Every network string in UI renders through a text setter.
- When unsure where code runs, a temporary `console.log(ENGINE.NetRuntime.getType())` confirms it; remove it after.

## References
- [session](references/session.md) — solo or online, session plan defaults, trust model, GameMode flow, online feel and lag table, reconnect
- [gameplay-systems](references/gameplay-systems.md) — classic movement vs GSS vs `NetPredictionManager` vs properties and RPCs
- [server-authority](references/server-authority.md) — `NetRuntime`, `NetRole`, guarding server-only code
- [node-replication](references/node-replication.md) — entity roots, replicated properties, `onRep`, net types, `replicateTo`, send rate, `MultiplayerSpawner`
- [rpcs](references/rpcs.md) — RPC decorators, reliability, argument encodings, patterns
- [game-mode](references/game-mode.md) — join/leave hooks, factories, `GameSessionInfo`, `PlayerInfo`
- [player-ownership](references/player-ownership.md) — AutonomousProxy, input flow, owner-only spawns, local player
- [matchmaking](references/matchmaking.md) — Genesys servers, queues, parties, `joinParams`; [network-prediction](references/network-prediction.md) — `NetPredictionManager`
- [ui-security](references/ui-security.md), [player-list-safe](references/player-list-safe.md) — network strings in UI; [chat-and-build-id](references/chat-and-build-id.md) — chat options, build-id badge
- [why-server-authority](references/why-server-authority.md) — the reasoning, for explaining it to a creator
- Engine docs in `node_modules/@gnsx/genesys.js/docs/`: `multiplayer/README.md` (architecture), `multiplayer/lifecycle.md`, `replication.md`, `protocol.md`, `prediction.md`, `matchmaking.md`, `gameplay-sim/README.md`, `RPC_DECORATORS.md` (decorator options), and `security/multiplayer-ui-security.md`.
