# Gameplay systems

Pick one system to own predicted player gameplay before you write movement, combat, or a custom simulation. Then open only the reference for that system.

The systems are not layers on one pawn. `BasePawnMovementNode` and GSS already predict. `NetPredictionManager` is the rewind framework GSS and custom nodes share. Replicated properties and RPCs carry state and events; they do not predict.

## Which system

| Gameplay | Use | Then read |
|---|---|---|
| One locomotion for the pawn's life; no rewind, lag-compensated hits, or runtime mode changes | A `BasePawnMovementNode` subclass on `MovementPawn` / `CharacterPawn` | `genesys-movement` |
| Walking, falling, abilities that must predict, rewind, resimulate, and lag-compensate | `GSSNode` on `GSSCharacterPawn`, with `GSSPlayerController` | `genesys-movement` |
| A moving platform, physics prop, or other non-pawn simulation that must rewind | `NetPredictionManager` and `IRewindable` | [network-prediction](network-prediction.md) |
| Score, inventory, turn order, match rules, a cosmetic event: the client shows the server result | `@ENGINE.property({ replicate: true })` and RPC decorators | [node-replication](node-replication.md), [rpcs](rpcs.md) |

## Classic movement

`BasePawnMovementNode` predicts the owning client's pawn: the client simulates a move, sends it, and replays saved moves when the server corrects the pose. It does not rewind other actors, and a classic pawn is not `IRewindable`. When a hit, knockback, or collision must be checked at a past time, use GSS.

## GSS

A `GSSNode` replicates a proxy pose, predicts on the owning client, and resimulates on a server correction, rewinding nearby `IRewindable` nodes. Lag compensation is narrower: on a dedicated server, prediction-aware queries rewind for player-owned authoritative nodes; the same ability code on a client queries the present world (`genesys-movement`, [gss-mechanics](../../genesys-movement/references/gss-mechanics.md)).

Use GSS when players interact through movement, abilities, or traces that must agree under latency. Initialize `NetPredictionManager` from `GameMode.onBeforeBeginPlay`; `GSSNode.useNetworkPrediction` defaults to true and does nothing until that manager exists. Do not subclass `GSSNode`: register modes, abilities, and effects from `GSSCharacterPawn.createGSSNode()`.

GSS does not replace match rules. Score, session state, and join policy stay on `GameSessionInfo`, `PlayerInfo`, and `GameMode`.

## `NetPredictionManager`

It stores canonical game time and rewinds `IRewindable` nodes. It moves no pawn and runs no gameplay: you register nodes, implement `rewind` / `restore`, and write the resimulation. Use it for world objects a predicted simulation must see at a past time (moving platform, `NetRewindablePhysicsProp`, a custom simulator that does not fit GSS). Setup and rules: [network-prediction](network-prediction.md).

## Replicated properties and RPCs

A replicated property carries state a late joiner must receive; an RPC carries a request or a one-shot event. The server writes state; a client asks with `@ServerRPC`. Use this pair when the feature needs no client prediction (card game, scoreboard, door, pickup).

## Limitations

- Classic pawns and GSS pawns collide, trace, or knock each other back → classic pawns are not rewindable, so it mis-predicts → one stack for interacting pawns.

## Traps

- Both `BasePawnMovementNode` and `GSSNode` on one pawn → two predictors fight → pick one.
- `NetPredictionManager` treated as a GSS replacement → it is only the rewind clock → use GSS for pawn gameplay.
- Client-local state plus an RPC as a predictor → no rewind or resimulation → classic movement or GSS for a player pawn.
