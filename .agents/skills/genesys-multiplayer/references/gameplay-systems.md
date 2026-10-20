# Gameplay systems

Pick one system to own predicted player gameplay. Read this page before you write movement, combat, or a custom simulation. Then follow only the reference for the system you picked.

These systems are not layers on the same pawn. `BasePawnMovementNode` and GSS already predict. `NetPredictionManager` is the rewind framework they share with custom nodes. Replicated properties and RPCs carry state and events. They do not predict by themselves.

## Which system

| Gameplay | Use | Then read |
| --- | --- | --- |
| One locomotion for the pawn's life. No rewind, hit lag compensation, or runtime mode changes. | A `BasePawnMovementNode` subclass on `MovementPawn` or `CharacterPawn` | `genesys-movement`, Classic vs GSS |
| Walking, falling, abilities, or other gameplay that must predict, rewind, resimulate, and lag-compensate | `GSSNode` on `GSSCharacterPawn`, with `GSSPlayerController` | `genesys-movement` |
| A moving platform, physics prop, or other simulation that must rewind and is not pawn locomotion | `NetPredictionManager` and `IRewindable` | [network-prediction](network-prediction.md) |
| Score, inventory, turn order, match rules, or a cosmetic event. The client shows the server result. | `@ENGINE.property({ replicate: true })` and RPC decorators | [node-replication](node-replication.md) and [rpcs](rpcs.md) |

## Classic movement

`BasePawnMovementNode` predicts the owning client's pawn. The client simulates a move and sends that move to the server. When the server corrects the pose, the client replays its saved moves. Subclasses cover walking, flying, vehicles, top-down, spectator, and NPC locomotion. The `genesys-movement` skill lists them.

This prediction does not rewind other actors. A classic pawn is not `IRewindable`. Do not use it when a hit, knockback, or collision must be checked at a past time. Use GSS for that gameplay.

## Gameplay Simulation System (GSS)

GSS is the predicted gameplay framework. A `GSSNode` replicates a proxy pose, predicts on the owning client, and resimulates when the server sends a correction. During that correction it rewinds nearby `IRewindable` nodes.

Lag compensation is narrower. On a dedicated server, prediction-aware queries rewind for player-owned authoritative nodes. The same ability code on a client queries the present world. Details are in `genesys-movement` [gss-mechanics](../../genesys-movement/references/gss-mechanics.md).

Use GSS when players interact through movement, abilities, or traces, and those interactions must agree under latency. Initialize `NetPredictionManager` from `GameMode.onBeforeBeginPlay`. `GSSNode.useNetworkPrediction` defaults to true and does nothing until that manager exists. Do not subclass `GSSNode`. Register modes, abilities, and effects from `GSSCharacterPawn.createGSSNode()`.

GSS does not replace match rules. Keep score, session state, and join policy on `GameSessionInfo`, `PlayerInfo`, and `GameMode`.

## Network prediction framework

`NetPredictionManager` stores canonical game time and rewinds nodes that implement `IRewindable`. It does not move a pawn. It does not run gameplay. You register each node, implement `rewind` and `restore`, and write the resimulation that calls those methods.

Use it for world objects a predicted simulation must see at a past time. Examples are a moving platform, `NetRewindablePhysicsProp`, and a custom simulator that does not fit GSS. Do not add a second prediction loop to a pawn that classic movement or GSS already predicts.

Setup and registration rules: [network-prediction](network-prediction.md).

## Replicated properties and RPCs

Use a replicated property for state that a late-joining client must receive. Use an RPC for a request or a one-shot event. The server writes replicated state. A client asks for a change with `@ServerRPC`.

Use this pair when the feature does not need client-side prediction. A card game, a scoreboard, a door, and a pickup can work this way. Do not build a second movement or combat predictor from RPCs when classic movement or GSS already owns that pawn.

Property and RPC rules: [node-replication](node-replication.md) and [rpcs](rpcs.md).

## What not to do

- Do not put `BasePawnMovementNode` and `GSSNode` on the same pawn.
- Do not treat a mix of classic pawns and GSS pawns as safe when they collide, trace, or knock each other back. Classic pawns are not rewindable. See `genesys-movement` [gss-mechanics](../../genesys-movement/references/gss-mechanics.md).
- Do not call `NetPredictionManager` a replacement for GSS. GSS is the gameplay simulator. The manager is the rewind clock GSS uses.
- Do not predict gameplay by writing client-local state plus an RPC, unless that code also owns rewind and resimulation. Prefer GSS or classic movement for a player pawn.
