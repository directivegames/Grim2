---
name: genesys-multiplayer
description: Write multiplayer game code in Genesys — choose classic movement, the network prediction framework, GSS, or replicated properties and RPCs, then apply server authority, GameMode lifecycle, player spawning, and matchmaking. Use when the user mentions multiplayer, networking, server, client, replication, RPC, authority, prediction, rewind, resimulation, lag compensation, gameplay simulation, GSS, NetPredictionManager, matchmaking, findMatch, queues, or parties, or when a feature must decide where it runs. Also use when a HUD shows player names, teams, chat, or scoreboards, since replicated strings are untrusted.
---

# Methodology

Follow these steps when working on multiplayer features:

1. Determine where the code must run — server, client, or both — before writing anything. Consult [server-authority](references/server-authority.md) to understand NetRuntime and NetRole.
2. Choose the system that owns predicted gameplay. Read [gameplay systems](references/gameplay-systems.md) before you write movement, combat, or a custom simulation. Then open only the skill or reference for that row:

   | Gameplay | System | Read next |
   | --- | --- | --- |
   | Pawn locomotion with built-in prediction, and no rewind between actors | `BasePawnMovementNode` | `genesys-movement` |
   | Predicted gameplay that rewinds, resimulates, and lag-compensates | GSS (`GSSNode`) | `genesys-movement` |
   | A custom simulation that needs rewind and does not fit GSS | `NetPredictionManager` | [network-prediction](references/network-prediction.md) |
   | Authoritative state or events with no client prediction | Replicated properties and RPCs | [rpcs](references/rpcs.md) and [node-replication](references/node-replication.md) |

3. If the feature is state or an event outside that system, decide whether it needs an RPC, a replicated property, or both. Consult [rpcs](references/rpcs.md) and [node-replication](references/node-replication.md).
4. Place one `PlayerSpawner` in every multiplayer scene. Read [game-mode](references/game-mode.md) before you change match rules or player lifecycle. Spawning throws when that node is missing.
5. Connect a shipped game only through matchmaking. Read [matchmaking](references/matchmaking.md). Use `connectToServer` only to test a local server in the editor.
6. If the feature involves a player-controlled node (Pawn/PlayerController), read [player-ownership](references/player-ownership.md).
7. If a moving platform, physics prop, or hit trace must rewind, read [network-prediction](references/network-prediction.md). GSS hit queries are documented in `genesys-movement`.
8. Guard all authority-only logic with `this.hasAuthority()` or `NetRuntime.isServer()`.
9. If the feature displays replicated or join strings in the UI (names, teams, chat, scoreboards), read [ui-security](references/ui-security.md) and follow Safe UI for replicated strings below.

# Core Multiplayer Guidelines

- Import the engine module with `import * as ENGINE from '@gnsx/genesys.js'`.
- Import `NetRuntime` from `@gnsx/genesys.js` for runtime environment checks.
- The server is the only machine that changes game state. Clients send requests (via `@ServerRPC`) and display the result.
- Guard all state-modifying logic with `this.hasAuthority()` on the replicated node or `NetRuntime.isServer()` for non-node code.
- Do not read `NetRuntime` in constructors. The runtime type is set before `beginPlay` is called; guard in `beginPlay` or later.
- Setting `this.isRoot = true` and `this.replicated = true` on a `SceneNode` makes that node a replicated entity root and auto-creates `ReplicationInfo`. Nested `replicated` children join that entity's member map; a nested `isRoot && replicated` node is its own entity. Call `this.ensureReplicationInfo()` when you need the info before the setter runs. Setting `replicated` on a client has no effect; do not flip it after the node is registered with NetWorld. Details: [node-replication](references/node-replication.md).
- Mark properties for network sync with `@ENGINE.property({ replicate: true })`. Only nodes inside a replicated entity's member map synchronise their replicated properties.
- Use `@ServerRPC` when a client needs the server to perform an action (e.g., fire a weapon, request a respawn).
- Use `@ClientRPC` when the server needs to notify the owning client of something (e.g., display a UI prompt).
- Use `@MulticastRPC` for events that every client must see simultaneously (e.g., an explosion visual).
- `GameMode` is present on any peer whose world was given a game-mode class. Call match rules, spawning, and `restartPlayer` only on the server (`NetRuntime.isServer()`).
- Place one `PlayerSpawner` in every multiplayer scene. Multiplayer player and session spawning uses that node. A missing spawner throws. Standalone play does not use it.
- A shipped multiplayer game runs on Genesys servers. Connect with `gameLoop.findMatch` or `gameLoop.matchmaking`. Do not call `connectToServer` for a shipped game. Call `connectToServer` only to test a local server in the editor. The editor play session does not use matchmaking.
- All replicated nodes are server-authoritative, including PlayerController and its Pawn. The controlling client has the AutonomousProxy role for its own controller and pawn. Which system predicts that pawn is [gameplay systems](references/gameplay-systems.md). Locomotion details are in the `genesys-movement` skill.

# Safe UI for replicated strings (mandatory)

Replicated strings and `joinParams` are untrusted for HTML. The engine does
not sanitize them. Render as text; never as markup.

| Do | Don't |
|----|-------|
| `playerName` / chat / team → `textContent`, `setLabel`, `setMessage`, `setTitle` | `` innerHTML = `<span>${playerName}</span>` `` |
| Icons → `ENGINE.Icons.*` or static SVG you author | Pass network strings to `iconHtml`, `setHTML`, `imageHtml` |
| Optional: validate display names in `GameMode` from `joinParams` | Rely on server name checks alone instead of safe rendering |

```ts
// ✅
row.appendChild(document.createElement('span')).textContent = playerInfo.playerName;
chat.setMessage({ name: playerName, body: messageText });

// ❌
el.innerHTML = `<span>${playerInfo.playerName}</span>`;
uiElement.setHTML(`<b>${playerName}</b>`);
```

Details and `joinParams` validation: [ui-security](references/ui-security.md).
Canonical player list: [player-list-safe](references/player-list-safe.md).
General HUD rules: Safe UI in the `genesys-ui-kit` skill and
[safe-ui](../genesys-ui-kit/references/safe-ui.md).

# Built-in session chat

Every multiplayer client gets an in-game text chat (bottom-left). While idle, new lines fade
out; Enter (or the key hint) opens the composer, and touch gets a Chat button. Enter or Send
sends and closes; Escape closes and discards the draft; leaving the field keeps the draft.
Arrow Up/Down recalls sent lines. Typing `:fi` suggests emojis (Enter, Tab, or click
inserts one; a finished `:fire:` converts on its own). Lines reach only the players
connected to the same server.
Do not build a second chat on top of RPCs; configure the built-in one instead:

- Disable it: set `chatEnabled = false` on the GameMode (Chat category).
- Fade, idle lines, scrollback, and the key hint: `chatFadeDelaySeconds` (`0` keeps lines),
  `chatVisibleLines`, `chatHistoryLines`, and `chatShowKeyHint` on the GameMode (Chat category).
- Emoji shortcodes: `chatEmojiShortcodes` on the GameMode. `false` leaves `:fire:` as text.
  Visual tokens (`--chat-width`, `--chat-font-size`, and the rest) live on `.ui-chat-panel`.
- Join/leave notices: set `chatJoinLeaveNotices = false` on the GameMode to silence them.
- Moderate it: override `protected filterChatMessage(senderClientId, text)` on the GameMode.
  The relay runs on a dedicated server when `chatEnabled` is true. Return rewritten text or `null` to drop the line.
- React to lines (sounds, notifications): listen to `world.chatSystem.onServiceChanged` and
  subscribe to the service's `onMessage` (`ENGINE.IChatService`). Entry text is untrusted;
  render it with `textContent`.
- The sender name comes from `PlayerInfo.playerName` on the server; clients cannot spoof it.
- Closing with Escape releases the mouse; the player clicks the game to capture it again
  (browsers do not let Escape re-lock the pointer).

# References

Read the reference that matches your current task:

- [Gameplay systems](references/gameplay-systems.md): When to use classic movement, GSS, `NetPredictionManager`, or replicated properties and RPCs.
- [Server Authority and Runtime](references/server-authority.md): NetRuntime API, NetRole values, and how to guard server-only code.
- [RPCs](references/rpcs.md): All RPC decorator types, execution rules, reliable vs unreliable, and common patterns.
- [Node Replication](references/node-replication.md): Enabling replication on `SceneNode`/`PrimitiveNode` roots, `ensureReplicationInfo`, replicating properties, transform sync, and relevance.
- [GameMode](references/game-mode.md): Server-only match lifecycle, player join/leave hooks, and factory configuration.
- [Matchmaking](references/matchmaking.md): Required connection to Genesys servers. Queues, parties, and the `joinParams` a placement sends to `canPlayerJoin`. `connectToServer` is only for a local editor test.
- [Player Control and Autonomous Proxy](references/player-ownership.md): Ownership, possession, and which client may send input for a PlayerController and Pawn.
- [Network prediction](references/network-prediction.md): `NetPredictionManager`, rewind registration, and canonical game time.
- [Multiplayer UI security](references/ui-security.md): Rendering replicated / join strings safely (XSS).
- [Safe player list example](references/player-list-safe.md): Canonical lobby / scoreboard pattern (`textContent`).

# Tips

- When in doubt about where code runs, add a temporary `console.log(NetRuntime.getType())` to verify.
- Replicated property updates flow from server to clients only. A client writing to a replicated property has no network effect.
- `@ServerRPC` methods execute directly when called with authority on the server. Wrap the call site in `if (NetRuntime.isClient())` if the server shouldn't trigger the method.
- Consult the engine source under `.engine/` for exact method signatures before writing RPC or replication code.
