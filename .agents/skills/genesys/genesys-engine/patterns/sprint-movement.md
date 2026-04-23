- Create a custom Pawn class (e.g., `SprintCharacterPawn`) that extends `ENGINE.ThirdPersonCharacterPawn` or `ENGINE.Pawn`, define a sprint speed modifier property
- Add a `setSprinting` API to your Pawn that sets `this.movementComponent.speedModifier` accordingly
- Create a custom PlayerController class extending `ENGINE.PlayerController`
- Add input handling (keyboard and gamepad) for the sprint button and call the pawn accordingly
- See `SKILL_DIR/references/pawn-player-controller.md` for the input handling flow and `SKILL_DIR/references/input-handling.md` for the input system architecture

/*
BONUS:
- When the main implementation is completed, ask the user to verify
- Once verified, ask if advanced functionality (stamina, etc) is required
*/
