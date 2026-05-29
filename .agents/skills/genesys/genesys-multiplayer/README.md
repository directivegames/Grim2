# genesys-multiplayer (skill)

Provides practical guidance for writing multiplayer game code in Genesys using the server-authority model.

## Why Server Authority?

In a multiplayer game every player's client runs its own instance of the game. Without coordination, each instance would reach different conclusions about what is happening — who won a race, whether a hit connected, how much health an enemy has — and players would see different realities.

The engine resolves this by designating one machine as the authority for all game logic. The server is the only machine that may make binding decisions. Clients send their intentions (move forward, fire, jump) to the server; the server decides whether those intentions are valid, updates the canonical game state, and replicates the result to every client. Clients display what the server tells them; they do not invent outcomes.

This model also prevents common cheating vectors. If a client claims it fired a bullet and the server validates that claim independently, a malicious client cannot simply report "I killed everyone" without the server agreeing.

## Why RPCs Instead of Direct Calls?

Clients and the server run in separate processes, possibly on different machines. A normal TypeScript method call does not cross that boundary. RPCs (Remote Procedure Calls) are method decorators that tell the engine's networking layer to serialise the method name and arguments, transmit them over the network, and call the matching method on the target machine.

Each RPC type encodes a specific direction and execution contract, so the right code runs in the right place without writing low-level networking code by hand.

## Why Is GameMode Server-Only?

GameMode owns the canonical rules of the match: scoring, win conditions, player spawning, and session lifecycle. Letting clients hold a copy would require keeping all those copies in sync, opening the door to authoritative conflicts and exploits. Because only the server ever runs GameMode, there is a single source of truth for match state.

Clients interact with match state through replicated properties on other actors (PlayerInfo, GameState, etc.) rather than through GameMode directly.

## Contents

- `SKILL.md` - Entry point, methodology, and coding guidelines.
- `references/` - Deep dives into each multiplayer subsystem.
