# Stacks and tuning

The short rules are in [SKILL.md → Decide](../SKILL.md#decide). This file holds the full classic-vs-GSS comparison, mixing stacks online, the tuning defaults table and the jump table.

## Classic or GSS

Classic = one `BasePawnMovementNode` subclass on a `MovementPawn` (`CharacterPawn` builds `CharacterMovementNode`), with built-in prediction. GSS (`GSSNode`) = named modes switched at runtime, abilities, effects, attributes, prediction with rollback. `MoverNode` was removed in engine 19 ([mover-to-gss](mover-to-gss.md)).

| | Classic (`BasePawnMovementNode`) | GSS (`GSSNode`) |
|---|---|---|
| Shape | One node for the pawn's lifetime | Modes (`GSSWalkingMode`, `GSSFallingMode`) switch at runtime |
| Mode switching | Replace `MovementPawn.movementNode` | `IGSSMovementModeTransition`, `queueMovementMode` |
| Prediction | Built into `BasePawnMovementNode` | `NetPredictionManager` initialized in `GameMode.onBeforeBeginPlay`, rollback. `useNetworkPrediction` defaults to true and does nothing without that manager |
| Player pawn | `DefaultCharacterPawn` (fire, interact) / `CharacterPawn` | `GSSCharacterPawn` (`getGSSNode()`); no fire or interact |
| Input | Controller calls pawn methods | `IGSSInputProducer` (currently-down tags only) |

## Mixing stacks

Classic NPCs with any player stack are fine in single-player and in any game without network prediction. In an online game with prediction, GSS rewinds nearby `IRewindable` nodes during correction resimulation (and, on a dedicated server, in prediction-aware queries; a normal movement tick does not rewind). Classic pawns are not rewindable, so dashes, knockback and hit confirmation against them mis-predict ([gss-mechanics](gss-mechanics.md#prediction)).

## Tuning defaults

Change the node or the registered mode; never subclass `GSSNode`.

| Field | Where | Default | Feel |
|---|---|---|---|
| Walk speed | `maxSpeed` (classic); `sim.setBaseAttribute(ENGINE.GSSTags.MoveSpeed, v)` (GSS) | 5 (`CHARACTER_MAX_SPEED`) | 5–7 action, 3–4 horror; on GSS the attribute overrides the mode's `maxSpeed` |
| `accelerationLambda` / `decelerationLambda` | `CharacterMovementNode`, `GSSWalkingMode` | 100 / 10 | 10 or less slides like ice; 15–25 reads crisp |
| Air lambdas | `midAir*` (classic), `GSSFallingMode` | 5 / 0.5 | 8–12 accel for platformer air control |
| `jumpSpeed` | classic node, walking and falling modes | 12 (`CHARACTER_JUMP_SPEED`) | Jump table below |
| `maxMidAirJumps` | `CharacterMovementNode`, `GSSFallingMode` | 0 | 1 = double jump |
| `coyoteTimeMs` | `CharacterMovementNode` (protected) | 100 | GSS has none built in: feel modes ([jump-and-knockback](jump-and-knockback.md)) |
| `jumpStrengthModifier` | any classic node | 1 | Multiplies jump speed; apex scales with its square (1.5 → 2.25× height) |
| Dash | `GSSDashAbility` (cooldown 600 ms) + `GSSDashEffect` (180 ms, 18 m/s) | Shift / left-stick click | Goes along control yaw: replace it for top-down |
| Sprint (classic) | `movementNode.speedModifier` | 1 | 1.5–1.8 while held |

## Jump table

Gravity is −9.81 × `simulatedGravityScale` 5 = −49 m/s². Apex = jumpSpeed² / 98.1; airtime on flat ground = jumpSpeed / 24.5 s. Default 12 → 1.5 m apex (≈ 1.4 m at 60 fps), 0.49 s in the air: a crate-height hop. Pick the apex first, then `jumpSpeed = √(98.1 × apex)`. Derivation: [jump-and-knockback](jump-and-knockback.md#jump-numbers).

| Apex | 1 m | 1.5 m | 2 m | 3 m |
|---|---|---|---|---|
| `jumpSpeed` | 9.9 | 12.1 | 14.0 | 17.2 |
| Airtime | 0.40 s | 0.49 s | 0.57 s | 0.70 s |
