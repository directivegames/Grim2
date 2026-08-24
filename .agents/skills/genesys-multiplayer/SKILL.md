---
name: genesys-multiplayer
description: Write multiplayer game code in Genesys — replication, RPCs, server authority, GameMode lifecycle, and player spawning. Use when the user mentions multiplayer, networking, server, client, replication, RPC, or authority, or when a feature must decide where it runs. Also use when a HUD shows player names, teams, chat, or scoreboards, since replicated strings are untrusted.
---

# Methodology

Follow these steps when working on multiplayer features:

1. Determine where the code must run — server, client, or both — before writing anything. Consult [server-authority](references/server-authority.md) to understand NetRuntime and NetRole.
2. Decide whether the feature needs an RPC, a replicated property, or both. Consult [rpcs](references/rpcs.md) and [node-replication](references/node-replication.md).
3. If the feature is part of match rules or player lifecycle, read [game-mode](references/game-mode.md).
4. If the feature involves a player-controlled node (Pawn/PlayerController), read [player-ownership](references/player-ownership.md).
5. Guard all authority-only logic with `this.hasAuthority()` or `NetRuntime.isServer()`.
6. If the feature displays replicated or join strings in the UI (names, teams, chat, scoreboards), read [ui-security](references/ui-security.md) and follow Safe UI for replicated strings below.

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
- GameMode methods only execute on the server. Do not call them from client-side code.
- All nodes are server-authoritative, including PlayerController and its Pawn. The controlling client has the AutonomousProxy role for its own controller and pawn, which allows local movement prediction. The server validates those actions and replicates the authoritative result back; the client corrects if there is a discrepancy.

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

# References

Read the reference that matches your current task:

- [Server Authority and Runtime](references/server-authority.md): NetRuntime API, NetRole values, and how to guard server-only code.
- [RPCs](references/rpcs.md): All RPC decorator types, execution rules, reliable vs unreliable, and common patterns.
- [Node Replication](references/node-replication.md): Enabling replication on `SceneNode`/`PrimitiveNode` roots, `ensureReplicationInfo`, replicating properties, transform sync, and relevance.
- [GameMode](references/game-mode.md): Server-only match lifecycle, player join/leave hooks, and factory configuration.
- [Player Control and Autonomous Proxy](references/player-ownership.md): How the controlling client runs local predictions for its PlayerController and Pawn, and how the server reconciles them.
- [Multiplayer UI security](references/ui-security.md): Rendering replicated / join strings safely (XSS).
- [Safe player list example](references/player-list-safe.md): Canonical lobby / scoreboard pattern (`textContent`).

# Tips

- When in doubt about where code runs, add a temporary `console.log(NetRuntime.getType())` to verify.
- Replicated property updates flow from server to clients only. A client writing to a replicated property has no network effect.
- `@ServerRPC` methods execute directly when called with authority on the server. Wrap the call site in `if (NetRuntime.isClient())` if the server shouldn't trigger the method.
- Consult the engine source under `.engine/` for exact method signatures before writing RPC or replication code.
