# Camera System

The Genesys camera system resolves the active camera through a priority chain: view target stack (overrides) -> possessed pawn camera (default) -> fallback.

## Usage Patterns

### Main Pattern: Three.js Camera on Pawn

Attach a THREE.Camera anywhere in the pawn's scene graph. The world finds it via Actor.getCamera(), which walks the actor's component tree depth-first.

Reference: See Actor.getCamera() in engine source.

### CharacterPawn Camera Hierarchy

CharacterPawn builds its camera in setupCamera() and chooses one of two layouts based on getInitialCameraPositions():

- First-person (pivot and camera positions are equal): root -> CameraPivot -> camera. The pivot provides pitch (looking up/down); yaw comes from the root component driven by the movement component.
- Third-person (positions differ): root -> CameraPivot -> CameraSpringArm -> camera. The SpringArmComponent maintains camera distance, collides with world geometry, and supports zoom via the cameraMinDistance / cameraMaxDistance / cameraZoomSensitivity properties on CharacterPawn.

Override setupCamera() only when the default pivot/spring-arm hierarchy does not fit; otherwise override getInitialCameraPositions() to position the camera.

Reference: See CharacterPawn.ts and SpringArmComponent.ts in engine source.

### Alternative: ViewTargetCameraComponent

Use ViewTargetCameraComponent for temporary camera overrides:
- Cutscenes.
- Debug/free-fly cameras.
- Spectator cameras.

Reference: See ViewTargetCameraComponent.ts in engine source.

## Active Camera Resolution

World.getActiveCamera() resolves the camera in this order:

1. View target stack — Topmost camera pushed via pushViewTargetCamera() (pop with popViewTargetCamera()).
2. Possessed pawn camera — Resolved from the first player controller's pawn via Actor.getCamera().
3. Null — Engine logs a warning and uses a fallback.

Reference: See World.ts in engine source.

## Tips

- Set perspective camera aspect to 1; the engine adjusts it during rendering.
- For orthographic cameras, use a square frustum; the engine adjusts left/right based on screen aspect.

