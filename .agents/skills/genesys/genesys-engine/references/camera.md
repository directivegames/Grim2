# Camera System

## Overview

The Genesys camera system resolves the active camera through a priority chain: view target stack (temporary overrides) → player pawn camera (default gameplay) → fallback.

## Key Concepts

- **Main Pattern**: Vanilla `THREE.PerspectiveCamera` attached to a pawn's component hierarchy
- **ViewTargetCameraComponent**: Specialized component that integrates with the view target stack for temporary camera overrides
- **View Target Stack**: Stack of cameras that temporarily override the pawn's camera without disrupting its setup

## Usage Patterns

### Main Pattern: Vanilla Three.js Camera on Pawn

Attach a vanilla `THREE.PerspectiveCamera` directly to your pawn. The world automatically finds it via `Actor.getCamera()`.

**Reference implementation:** See `node_modules/@gnsx/genesys.js/src/actors/Actor.ts` method `getCamera()`.

### Alternative: ViewTargetCameraComponent

Use `ViewTargetCameraComponent` when you need view target stack integration - primarily for temporary camera overrides:

- Cutscene cameras
- Debug/free-fly cameras
- Spectator cameras

**Reference implementation:** See `node_modules/@gnsx/genesys.js/src/components/ViewTargetCameraComponent.ts`.

This component provides:
- Automatic push/pop from view target stack via `startActive` property
- Property serialization for saved games/editor
- Camera helper visualization for debugging

## How the Active Camera Is Resolved

Each frame, `World.getActiveCamera()` resolves the camera through this priority order:

1. **View target stack** - Topmost camera from cameras pushed via `pushViewTargetCamera()`
2. **First player controller's pawn camera** - Camera from `playerControllers[0].getPawn().getCamera()`
3. **Null** - No camera available (rendering uses a fallback)

### Which Pawn's Camera Is Used?

When there are multiple pawns in the world, the camera is resolved from the **first player controller's possessed pawn** (`playerControllers[0]`). In single-player, this is the only player controller. In multiplayer, this is the first player controller registered with the world (typically the local client's controller in single-player contexts, or the server-authoritative controller for dedicated servers).

**Reference implementation:** See `node_modules/@gnsx/genesys.js/src/game/World.ts` methods `getActiveCamera()`, `getFirstPlayerPawn()`, `pushViewTargetCamera()`, `removeViewTargetCamera()`.

### Common View Target Stack Use Cases

- **Cutscenes**: Push cinematic camera at start, pop at end
- **Debug mode**: Push free-fly camera when entering debug, pop when exiting
- **Spectator mode**: Push spectator camera when player dies

## Tips
- Aspect ratio of the perspective camera is automatically adjusted by the engine during rendering, always use 1 as the default value.
- When using orthographic camera for rendering, the engine automatically adjusts its frustum's left/right based on the bottom/up value and the screen aspect ratio. Always use a square frustum by default.

