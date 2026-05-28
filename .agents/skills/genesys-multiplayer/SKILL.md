---
name: genesys-multiplayer
description: Guidance for writing multiplayer game code in Genesys. Use when implementing networked features, RPCs, replicated actors or properties, server-authoritative logic, game mode lifecycle, player spawning in multiplayer, or when the user mentions multiplayer, networking, server, client, replication, RPC, latency, or authority.
---

# Methodology

Follow these steps when working on multiplayer features:

1. Determine where the code must run — server, client, or both — before writing anything. Consult [server-authority](references/server-authority.md) to understand NetRuntime and NetRole.
2. Decide whether the feature needs an RPC, a replicated property, or both. Consult [rpcs](references/rpcs.md) and [actor-replication](references/actor-replication.md).
3. If the feature is part of match rules or player lifecycle, read [game-mode](references/game-mode.md).
4. If the feature involves a player-controlled actor, read [player-ownership](references/player-ownership.md).
5. Guard all authority-only logic with `this.hasAuthority()` or `NetRuntime.isServer()`.

# Core Multiplayer Guidelines

- Import the engine module with `import * as ENGINE from '@gnsx/genesys.js'`.
- Import `NetRuntime` from `@gnsx/genesys.js` for runtime environment checks.
- The server is the only machine that changes game state. Clients send requests (via `@ServerRPC`) and display the result.
- Guard all state-modifying logic with `this.hasAuthority()` on actors or `NetRuntime.isServer()` for non-actor code.
- Do not read `NetRuntime` in constructors. The runtime type is set before `beginPlay` is called; guard in `beginPlay` or later.
- Enable replication on an actor by setting `this.replicated = true` in its constructor. Setting it on a client has no effect, so no server guard is needed. Do not set it after the actor is already in the world.
- Mark properties for network sync with `@ENGINE.property({ replicate: true })`. Only replicated actors synchronise their replicated properties.
- Use `@ServerRPC` when a client needs the server to perform an action (e.g., fire a weapon, request a respawn).
- Use `@ClientRPC` when the server needs to notify the owning client of something (e.g., display a UI prompt).
- Use `@MulticastRPC` for events that every client must see simultaneously (e.g., an explosion visual).
- GameMode methods only execute on the server. Do not call them from client-side code.
- All actors are server-authoritative, including PlayerController and its Pawn. The controlling client has the AutonomousProxy role for its own controller and pawn, which allows local movement prediction. The server validates those actions and replicates the authoritative result back; the client corrects if there is a discrepancy.

# References

Read the reference that matches your current task:

- [Server Authority and Runtime](references/server-authority.md): NetRuntime API, NetRole values, and how to guard server-only code.
- [RPCs](references/rpcs.md): All RPC decorator types, execution rules, reliable vs unreliable, and common patterns.
- [Actor Replication](references/actor-replication.md): Enabling replication on actors, replicating properties, transform sync, and relevance.
- [GameMode](references/game-mode.md): Server-only match lifecycle, player join/leave hooks, and factory configuration.
- [Player Control and Autonomous Proxy](references/player-ownership.md): How the controlling client runs local predictions for its PlayerController and Pawn, and how the server reconciles them.

# Tips

- When in doubt about where code runs, add a temporary `console.log(NetRuntime.getType())` to verify.
- Replicated property updates flow from server to clients only. A client writing to a replicated property has no network effect.
- `@ServerRPC` methods are no-ops when called on the server — the server simply executes them directly. Wrap in `if (NetRuntime.isClient())` only if the call is client-only by intent.
- Consult the engine source under `.engine/` for exact method signatures before writing RPC or replication code.
