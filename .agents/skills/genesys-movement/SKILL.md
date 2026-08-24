---
name: genesys-movement
description: Choose and implement pawn or character locomotion in Genesys — walking, falling, flying, swimming, driving, top-down, and NPC movement. Use when the user asks to make something move, mentions MoverNode, movement modes, or mode transitions, or needs a character controller. Not for navmesh pathfinding (genesys-navigation) or wheel/suspension tuning (genesys-physics).
---

# Methodology

1. Read the Classic vs Mover decision guide below before writing any movement code.
2. If Classic: read [pawn-player-controller](../genesys-engine/references/pawn-player-controller.md) in the `genesys-engine` skill — it documents `BasePawnMovementNode` subclasses, `MovementPawn`, and `CharacterPawn`/`DefaultCharacterPawn`. This skill does not duplicate that content.
3. If Mover: read [mover-mechanics](references/mover-mechanics.md) for the tick cycle and core types, then [mover-modes](references/mover-modes.md) for the built-in mode catalog.
4. Writing a custom mode, transition, or input producer: read [custom-modes-and-controllers](references/custom-modes-and-controllers.md).
5. Vehicles (either system): read [vehicle-movement](references/vehicle-movement.md). Wheel/suspension/friction tuning is owned by the `genesys-physics` skill — do not duplicate it here.
6. NPC locomotion: read [npc-movement](references/npc-movement.md). Navmesh queries and path calculation are owned by the `genesys-navigation` skill — do not duplicate it here.

# Classic vs Mover: which one to use

Two parallel movement systems exist in the engine. Both are real, current, and neither is deprecated.

| | Classic (`BasePawnMovementNode` subclasses) | Mover (`MoverNode` + `IMovementMode`) |
|---|---|---|
| Shape | One node = one fixed locomotion behavior for the pawn's lifetime (`CharacterMovementNode`, `AerialMovementNode`, `AirplaneMovementNode`, `VehicleMovementNode`, `TopDownMovementNode`, `SpectatorMovementNode`, `NpcMovementNode`, `DirectionalCharacterMovementNode`) | One `MoverNode` holds multiple named modes (`WalkingMode`, `FallingMode`, `FlyingMode`, `AerialMode`, `AirplaneMode`, `TopDownMode`, `VehicleMode`) and switches between them at runtime |
| Mode switching | Not supported — swapping locomotion means replacing `MovementPawn.movementNode` with a different node instance | First-class: `IMovementMode.transitions` (`IMoverTransition[]`) are evaluated every tick for automatic switches (e.g. walking → falling when ground contact is lost); `MoverNode.queueNextMode(name)` forces one explicitly |
| Stacking/composable effects | Not composable beyond the single `speedModifier` scalar on `BasePawnMovementNode` — crouch, knockback, buffs have to be hand-built into the node subclass | `LayeredMove` (temporary velocity override/additive — knockback, launch, root motion) and `MovementModifier` (persistent per-tick mutation — crouch, speed buffs, gravity change) stack on top of whichever mode is active, mode-agnostic |
| Multiplayer prediction | Built into `BasePawnMovementNode` itself: a `SavedMove` queue, `@ServerRPC`/`@ClientRPC` reconciliation, `positionCorrectionThreshold` — works out of the box for every classic node | Depends on the backend. Check which `IMoverBackend` implementations exist in `.engine/src/nodes/movement/mover/` before relying on prediction: `StandaloneMoverBackend` is synchronous with no networking, and `IMoverBackend`'s doc comment describes a networked backend that may or may not be implemented |
| Pawn base | `Pawn` → `MovementPawn` (`movementNode` property, action methods `moveForward`/`moveRight`/`jump`/etc. for a Controller to call) → `CharacterPawn`/`GameplayPawn`/`DefaultCharacterPawn` | `Pawn` → `MoverCharacterPawn` directly (skips `MovementPawn` — no `movementNode`, no action methods). Exposes `getMoverNode()` instead |
| Input wiring | `PlayerController` calls pawn action methods each tick (`pawn.moveForward(value)`, `pawn.jump()`, ...) | `PlayerController` (or an AI controller) implements `IMovementInputProducer` and registers directly on the `MoverNode` via `addInputProducer(this)` — no pawn action methods involved at all |
| Path following | `NpcMovementNode` follows navmesh paths — see [npc-movement](references/npc-movement.md) | No path-following mode ships; pair a Mover pawn with classic `NpcMovementNode` or drive the mover from your own path logic |

Pick Mover when the pawn genuinely needs runtime mode switching (walk → fall → fly,
or drive in and out of a vehicle) or stacked layered/modifier effects, and the game
does not need client-side movement prediction from the Mover stack itself.

Pick Classic when the pawn's locomotion is fixed for its lifetime, the game is
multiplayer and needs the built-in prediction/reconciliation for a human-controlled
pawn, or NPC path-following is required (`NpcMovementNode`).

Nothing prevents mixing both systems in one game — e.g. a Mover-based player character alongside classic `NpcMovementNode` AI, or a classic `VehicleMovementNode` car alongside a Mover-based on-foot player.

# Core guidelines (Mover)

- Import the engine with `import * as ENGINE from '@gnsx/genesys.js'`. Decorate custom classes with `@ENGINE.GameClass()`, never `@EngineClass`.
- `MoverNode` attaches to any pawn via `pawn.add(mover)` — it is not a typed pawn slot like classic `movementNode`. `MoverCharacterPawn` stores it as `this.moverNode` and exposes `getMoverNode()`.
- Register modes with `mover.addMovementMode(name, modeInstance)` and set `mover.startingModeName` before `beginPlay`.
- A custom `PlayerController` for Mover implements `IMovementInputProducer` and calls `moverNode.addInputProducer(this)` in `onPossess` / `removeInputProducer(this)` in `onUnpossess` — mirror `MoverPlayerController` (`.engine/src/entities/MoverPlayerController.ts`).
- `MoverPlayerController` only drives biped Walking/Falling axis layout. Its own doc comment says other locomotion styles (vehicle, airplane, top-down) need dedicated controllers that write the axis layout those modes expect — do not try to reuse it for a vehicle or airplane pawn.
- Stance/buff changes go through `MovementModifier`, never ad-hoc `MovementInputCmd` flags.

```typescript
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
class HoverCarPawn extends ENGINE.MoverCharacterPawn {
  protected override createMoverNode(): ENGINE.MoverNode {
    const mover = ENGINE.MoverNode.create({ name: 'MoverNode' });
    mover.addMovementMode('walking', new ENGINE.WalkingMode({ maxSpeed: 6, jumpSpeed: 7 }));
    mover.addMovementMode('falling', new ENGINE.FallingMode({ maxMidAirJumps: 1 }));
    mover.addMovementMode('flying', new ENGINE.FlyingMode({ maxSpeed: 20 }));
    mover.startingModeName = 'walking';
    return mover;
  }
}
```

# References

- [Mover mechanics](references/mover-mechanics.md): `MoverNode` tick cycle, core data types, `IMoverTransition`, `LayeredMove`, `MovementModifier`, sync tags, and the current single backend.
- [Mover modes catalog](references/mover-modes.md): every built-in `IMovementMode` — options, tags, pairing requirements, and which classic node each was ported from.
- [Custom modes and controllers](references/custom-modes-and-controllers.md): the `IMovementMode` contract, writing an `IMoverTransition`, and the `IMovementInputProducer` contract a custom controller must implement (`MoverPlayerController` as reference).
- [Vehicle movement](references/vehicle-movement.md): `VehicleMovementNode` (classic) vs `VehicleMode` (Mover) at the pawn/movement integration level. Wheel/suspension/friction tuning lives in `genesys-physics`.
- [NPC movement](references/npc-movement.md): driving `NpcMovementNode` once a path/target exists. Navmesh queries and path calculation live in `genesys-navigation`.

# Tips

- Consult `.engine/src/nodes/movement/mover/` and `.engine/src/entities/MoverCharacterPawn.ts` / `MoverPlayerController.ts` for exact signatures before writing mode or controller code — this skill is a map, not a full API reference.
- `mover.hasSyncTag('mover.onGround')` prefix-matches by default (`hasSyncTag('mover', false)` also matches `mover.onGround`); pass `exactMatch: true` for an exact tag check.
- `mover.getActiveMode(YourModeClass)` / `mover.findMode(YourModeClass)` let a controller or ability query mode state without hardcoding the active mode name.
