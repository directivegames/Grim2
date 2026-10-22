---
name: genesys-movement
description: Choose and implement pawn or character locomotion in Genesys — walking, falling, flying, swimming, driving, top-down, and NPC movement. Use when the user asks to make something move, mentions the Gameplay Simulation System (GSS), GSSNode, GSSCharacterPawn, movement modes, or mode transitions, or needs a character controller. Not for navmesh pathfinding (genesys-navigation) or wheel/suspension tuning (genesys-physics).
metadata:
  tokens: 1031
---

# Methodology

1. Read the Classic vs GSS decision guide below before writing any movement code.
2. If Classic: read [pawn-player-controller](../genesys-engine/references/pawn-player-controller.md) in the `genesys-engine` skill — it documents `BasePawnMovementNode` subclasses, `MovementPawn`, and `CharacterPawn`/`DefaultCharacterPawn`.
3. If GSS: use `GSSNode` + `GSSCharacterPawn` + `GSSPlayerController`. Register modes/abilities/effects on the pawn, in `createGSSNode()`. Input is vectors plus currently-down tags; the sim node derives press/release edges.
4. NPC locomotion: `AIController` implements `IGSSInputProducer` against `GSSNode`. Navmesh queries belong to `genesys-navigation`.
5. If existing code uses `MoverNode` (removed in engine 19), read [Mover to GSS migration](references/mover-to-gss.md).

# Classic vs GSS

If the task is which multiplayer system owns gameplay, read [gameplay systems](../genesys-multiplayer/references/gameplay-systems.md) in the `genesys-multiplayer` skill first. The table below chooses locomotion only: classic movement or GSS.

GSS (Gameplay Simulation System) is the networked simulation: replication, prediction, rollback, and reconciliation.

| | Classic (`BasePawnMovementNode`) | GSS (`GSSNode`) |
|---|---|---|
| Shape | One node, one locomotion for the pawn's lifetime | Named modes (`GSSWalkingMode`, `GSSFallingMode`) switch at runtime |
| Mode switching | Replace `MovementPawn.movementNode` | `IGSSMovementModeTransition` and `queueMovementMode` |
| Prediction | Built into `BasePawnMovementNode` | `NetPredictionManager` initialized in `GameMode.onBeforeBeginPlay`. `useNetworkPrediction` defaults to true and does nothing without that manager |
| Pawn | `MovementPawn` → `CharacterPawn` | `GSSCharacterPawn` (`getGSSNode()`) |
| Input | Controller action methods | `IGSSInputProducer` (down-tags only) |

Mover (`MoverNode` and its modes) was removed in engine 19. Migrate existing Mover games to GSS
or to a classic movement node.

A game may mix classic movement nodes on some pawns and GSS on others. Do not treat
that as a free mix for colliding or tracing actors: GSS rewinds nearby `IRewindable`
nodes during correction resimulation and, on a dedicated server, during prediction-aware
queries. A normal movement tick does not rewind them. Classic pawns are not rewindable.
Interactions (collision, traces, knockback, enter/exit) mis-predict unless the game adds
history, rewind/restore, and re-simulation on the non-sim pawn — see
[gss-mechanics](references/gss-mechanics.md).

```typescript
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
class MyPawn extends ENGINE.GSSCharacterPawn {}

@ENGINE.GameClass()
class MyController extends ENGINE.GSSPlayerController {}
```

Override `GSSCharacterPawn.createGSSNode()` to add custom modes, abilities, and effects — do not subclass `GSSNode`. Content carries its own `id`; re-registering an id replaces that entry in place, and applying an unregistered id warns and does nothing.

An actor that acts but does not walk (turret, prop, spawner) is still a GSS pawn: register `GSSIdleMode` instead of walking/falling. Registering no modes at all is legal but drops effect-proposed movement silently — see [gss-modes](references/gss-modes.md).

The sim node drives one **target** node (the entity root unless you pass `target`), fixed at creation. Its `Sync` state is private: modes, abilities, effects, and cues write through the context they are handed, everyone else reads copies (`getPosition()`, `getAttribute()`, `hasGSSTag()`, …), and nothing outside the simulation can move a sim-driven actor. Presentation reacts through `onMovementModeChanged` and `onVisualOffsetChanged` rather than reading the sim node; see [gss-mechanics](references/gss-mechanics.md).
