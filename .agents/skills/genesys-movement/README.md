# genesys-movement (skill)

Maps pawn locomotion architecture in the engine and provides a decision guide between classic
`BasePawnMovementNode` subclasses and `GSSNode`.

## Why two movement systems?

Classic `BasePawnMovementNode` subclasses (`CharacterMovementNode`, `VehicleMovementNode`, etc.)
are self-contained, single-purpose locomotion nodes with built-in multiplayer prediction, assigned
to `MovementPawn.movementNode`.

`GSSNode` (Gameplay Simulation System) is the composable alternative: one node holds named movement modes
(`GSSWalkingMode`, `GSSFallingMode`), abilities, effects, tags, and attributes. Modes switch at runtime
via `IGSSMovementModeTransition` / `queueMovementMode`. Network prediction is opt-in (`useNetworkPrediction`
plus `NetPredictionManager`).

The Mover stack remains loadable only so existing games do not break. It is unsupported and must
not be selected for new work. Use `references/mover-to-gss.md` to migrate it.

A game can mix classic nodes on some pawns and GSS on others. That split is only
safe when those pawns do not interact through collision, traces, or effects. GSS
rewinds and re-simulates nearby `IRewindable` actors during movement and prediction-aware
queries; classic pawns are not rewindable. Interactions with them will mis-predict unless
the game adds equivalent history, rewind/restore, and re-simulation — the work GSS
is meant to take off the game. Static geometry is fine. Independent locomotion that never
contacts a sim pawn is also fine.

## Contents

- `SKILL.md` — Entry point: methodology and Classic vs GSS.
- `references/gss-mechanics.md` — `GSSNode` simulate pipeline, Input/Sync and its read accessors, the movement target, presentation events, prediction.
- `references/gss-modes.md` — GSS Walking/Falling/Idle modes plus Dash.
- `references/custom-modes-and-controllers.md` — `IGSSMovementMode`, `IGSSMovementModeTransition`, `IGSSInputProducer`.
- `references/mover-to-gss.md` — migration only; Mover is unsupported.
- `references/vehicle-movement.md` — Classic `VehicleMovementNode` and custom GSS guidance.
- `references/npc-movement.md` — `NpcMovementNode` and `AIController` + `GSSNode`.

## Relationship to other skills

- Classic pawn/controller fundamentals live in the `genesys-engine` skill's
  `pawn-player-controller.md`. GSS pawns are `GSSCharacterPawn` +
  `GSSPlayerController`.
- `genesys-physics` owns `IPhysicsVehicle` wheel/suspension/friction tuning.
- `genesys-navigation` owns navmesh/pathfinding.
