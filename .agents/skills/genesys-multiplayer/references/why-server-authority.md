# Why the engine uses server authority

Background for explaining the model to a creator, or for deciding when a feature looks like it could skip the server.

## Why server authority?

In a multiplayer game every player's client runs its own instance of the game. Without coordination, each instance would reach different conclusions about what is happening — who won a race, whether a hit connected, how much health an enemy has — and players would see different realities.

The engine resolves this by designating one machine as the authority for all game logic. The server is the only machine that may make binding decisions. Clients send their intentions (move forward, fire, jump) to the server; the server decides whether those intentions are valid, updates the canonical game state, and replicates the result to every client. Clients display what the server tells them; they do not invent outcomes.

This model also prevents common cheating vectors. If a client claims it fired a projectile and the server validates that claim independently, a malicious client cannot simply report "I defeated everyone" without the server agreeing.

## Why RPCs instead of direct calls?

Clients and the server run in separate processes, possibly on different machines. A normal TypeScript method call does not cross that boundary. RPCs (Remote Procedure Calls) are method decorators that tell the engine's networking layer to serialise the method name and arguments, transmit them over the network, and call the matching method on the target machine.

Each RPC type encodes a specific direction and execution contract, so the right code runs in the right place without writing low-level networking code by hand. See [rpcs](rpcs.md).

## Where does GameMode run?

Every world instantiates a GameMode: the server's world and each client's world (`world.gameMode`). The GameMode node is never replicated, so each instance is local to its machine.

Run state is decided on the server. Scoring, win conditions, player spawning, and the session lifecycle run in server-guarded GameMode code (match hooks such as `canPlayerJoin` and `onPlayerJoined` run only there) and are written to replicated nodes: `GameSessionInfo` for the match, `PlayerInfo` for each player. A client's GameMode instance has no authority; it drives local presentation (title, HUD, result screens) from that replicated state. That keeps one source of truth without syncing several copies of the rules.

Clients therefore read match state from `PlayerInfo`, `GameSessionInfo`, and other replicated nodes, never from fields on their own GameMode. See [game-mode](game-mode.md).

## Node architecture

Genesys multiplayer is built on `SceneNode` / `PrimitiveNode` roots, not the removed `Actor` shell. A networked root becomes a replicated entity by setting `isRoot` and `replicated` (auto-creates `ReplicationInfo`). Nested `replicated` children join that entity; a nested root is its own entity. `PlayerController`, `Pawn`, `PlayerInfo`, and `GameSessionInfo` already do this internally. See [node-replication](node-replication.md).
