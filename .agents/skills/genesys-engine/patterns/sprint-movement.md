Use when the user wants a sprint/run toggle that temporarily increases pawn movement speed.

- Create a custom Pawn class (e.g., SprintCharacterPawn) that extends `ENGINE.CharacterPawn` or `ENGINE.MovementPawn` (base `Pawn` has no `movementNode`), and define a sprint speed multiplier property.
- Add a setSprinting API to your Pawn that sets `this.movementNode.speedModifier` accordingly (`speedModifier` lives on `BasePawnMovementNode` and is honored by CharacterMovementNode, SpectatorMovementNode, TopDownMovementNode, VehicleMovementNode, and AirplaneMovementNode — not by AerialMovementNode, which uses bare `maxSpeed`).
- Create a custom PlayerController class extending ENGINE.PlayerController (or DefaultPlayerController).
- Add input handling (keyboard and gamepad) for the sprint button and call the pawn accordingly.
- See [pawn-player-controller](../references/pawn-player-controller.md) for the input handling flow and [input-handling](../references/input-handling.md) for the input system architecture.

## Follow-up

- Verify the main implementation with the user.
- Ask if advanced functionality (stamina, etc.) is required.
