# Camera System

The Genesys camera system resolves the active camera through a priority chain: view target stack (overrides) -> possessed pawn camera (default) -> fallback.

## Usage patterns

### Main pattern: Three.js Camera on pawn

Attach a THREE.Camera anywhere in the pawn's scene graph. The world finds it via `SceneNode.getCamera()`, which walks the subtree depth-first.

Reference: See SceneNode.getCamera() in engine source.

### CharacterPawn camera hierarchy

CharacterPawn builds its camera in setupCamera() and chooses one of two layouts based on getInitialCameraPositions():

- First-person (pivot and camera positions are equal): root -> CameraPivot -> camera. The pivot provides pitch (looking up/down); yaw comes from the root driven by the movement node.
- Third-person (positions differ): root -> CameraPivot -> CameraSpringArm -> camera. The SpringArmNode maintains camera distance, collides with world geometry, and supports zoom via the cameraMinDistance / cameraMaxDistance / cameraZoomSensitivity properties on CharacterPawn.

Override setupCamera() only when the default pivot/spring-arm hierarchy does not fit; otherwise override getInitialCameraPositions() to position the camera.

Reference: See CharacterPawn.ts and SpringArmNode.ts in engine source.

### Alternative: ViewTargetCameraNode

Use ViewTargetCameraNode for temporary camera overrides:
- Cutscenes.
- Debug/free-fly cameras.
- Spectator cameras.

Reference: See ViewTargetCameraNode.ts in engine source. (`ViewTargetCameraComponent` is a deprecated alias.)

### TopDownMovementNode

For strategy / overhead cameras on a plain `Pawn` (not `CharacterPawn`):

- Attach `TopDownMovementNode` and a child `THREE.Camera` with fixed pitch on the pawn root.
- Pan moves the pawn on X/Z; zoom moves world Y (`rootY`) or camera local Z (`cameraLocalOffset`).
- Enable `keyboardPanEnabled`, `mouseDragPanEnabled`, `edgeScrollEnabled`, `wheelZoomEnabled` independently.

Mouse drag pan is routed through `DefaultPlayerController.handleMouseMove` → `pawn.movementNode?.handleMouseMove` without pointer lock. Wheel zoom uses the same path as other movement nodes via `handleMouseWheel`.

See [Top-Down Camera](../patterns/top-down-camera.md) for setup recipes and RTS presets.

## Active camera resolution

World.getActiveCamera() resolves the camera in this order:

1. View target stack — Topmost camera pushed via `pushViewTargetCamera()` (remove with `removeViewTargetCamera(camera)`).
2. Possessed pawn camera — Resolved from the first player controller's pawn via `getCamera()`.
3. Null — Engine logs a warning and uses a fallback.

Reference: See World.ts in engine source.

## Tips

- Set perspective camera aspect to 1; the engine adjusts it during rendering.
- For orthographic cameras, use a square frustum; the engine adjusts left/right based on screen aspect.
