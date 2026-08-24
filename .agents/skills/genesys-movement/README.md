# genesys-movement (skill)

Maps pawn locomotion architecture in the engine and provides a decision guide between the two
parallel movement systems.

## Why two movement systems?

Classic `BasePawnMovementNode` subclasses (`CharacterMovementNode`, `VehicleMovementNode`, etc.)
predate the Mover stack. Each one is a self-contained, single-purpose locomotion node with
multiplayer prediction/reconciliation built in, assigned to `MovementPawn.movementNode`.

`MoverNode` is a newer, composable alternative: one node holds several named `IMovementMode`
instances (walking, falling, flying, driving, ...) and switches between them at runtime via
automatic transitions, plus supports stacking temporary (`LayeredMove`) and persistent
(`MovementModifier`) effects on top of whichever mode is active. It does not (yet) have the
classic system's built-in networked prediction — see the decision table in `SKILL.md`.

Neither system is deprecated. A game can use classic nodes for some pawns and Mover for others.

## Contents

- `SKILL.md` — Entry point: methodology, the Classic vs Mover decision guide, Mover core
  guidelines, and a mode-switching pawn example.
- `references/mover-mechanics.md` — `MoverNode`'s produce → simulate → apply tick cycle, the
  core data types (`MovementInputCmd`, `MovementSyncState`, `MovementAuxState`, `ProposedMove`),
  `IMoverTransition`, `LayeredMove`, `MovementModifier`, sync tags, and backends.
- `references/mover-modes.md` — Catalog of every built-in `IMovementMode`: options, sync tags,
  pairing requirements, and the classic node each was ported from.
- `references/custom-modes-and-controllers.md` — Contracts for a custom `IMovementMode`,
  `IMoverTransition`, and `IMovementInputProducer`, with `MoverPlayerController` as the
  reference implementation.
- `references/vehicle-movement.md` — `VehicleMovementNode` vs `VehicleMode` at the
  pawn/movement-node integration level (which class to extend, chassis/physics requirements,
  input axis mapping). Wheel/suspension/friction tuning is out of scope — see `genesys-physics`.
- `references/npc-movement.md` — Driving `NpcMovementNode` once a path or target exists, and
  the current gap in Mover for path-following AI. Navmesh queries are out of scope — see
  `genesys-navigation`.

## Relationship to other skills

- Classic pawn/controller fundamentals (`Pawn`, `MovementPawn`, `CharacterPawn`,
  `DefaultPlayerController`, possession flow) live in the `genesys-engine` skill's
  `pawn-player-controller.md` reference — this skill does not duplicate that content, only adds
  what it left out (the Mover stack).
- `genesys-physics` owns `IPhysicsVehicle` wheel/suspension/friction tuning in depth.
- `genesys-navigation` owns navmesh/pathfinding (path calculation, closest-point queries).
