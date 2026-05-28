Use when the user wants a sprint/run toggle that temporarily increases pawn movement speed.

- Create a custom Pawn class (e.g., SprintCharacterPawn) that extends ENGINE.CharacterPawn or ENGINE.Pawn, and define a sprint speed multiplier property.
- Add a setSprinting API to your Pawn that sets this.movementComponent.speedModifier accordingly (speedModifier lives on BasePawnMovementComponent and is honored by CharacterMovementComponent, AerialMovementComponent, SpectatorMovementComponent, TopDownMovementComponent, VehicleMovementComponent, and AirplaneMovementComponent).
- Create a custom PlayerController class extending ENGINE.PlayerController.
- Add input handling (keyboard and gamepad) for the sprint button and call the pawn accordingly.
- See [pawn-player-controller](../references/pawn-player-controller.md) for the input handling flow and [input-handling](../references/input-handling.md) for the input system architecture.

## Follow-up

- Verify the main implementation with the user.
- Ask if advanced functionality (stamina, etc.) is required.
