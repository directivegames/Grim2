---
name: genesys-camera
description: "Camera layouts and look feel: first/third person, over-the-shoulder, top-down, side-scroller, isometric, chase, fixed, RTS pan; spring arm, pointer lock, FOV kick, sensitivity, invert-Y. Use when the user says camera, view, follow, zoom, aim down sights, FOV, sensitivity, invert mouse, cutscene, or 'the camera clips/spins'. Not for shake or hitstop (use `genesys-game-feel`) or which way the pawn walks (use `genesys-movement`)."
metadata:
  tokens: 3260
---

# Camera

This skill owns which camera renders, where it sits relative to the pawn, how looking feels, and whether the mouse is locked. The rule: **build the camera inside the pawn's `setupCamera()` / `getInitialCameraPositions()` (or a `ViewTargetCameraNode` for a shot), so the engine finds it; never bolt a loose camera onto a pawn from `beginPlay` or a second follow script.**

## Use another skill when
- The pawn moves the wrong way for this camera, or needs a movement node → `genesys-movement`
- Screen shake, hitstop, kill-cam timing → `genesys-game-feel` (FOV kick is here)
- A vehicle chase camera and enter/exit handoff → `genesys-vehicles` (this skill owns the rig types)
- Phone look stick, touch aim stick → `genesys-touch-controls`
- Crosshair, cursor reticle widget, pause card, settings screen → `genesys-ui`; pause state, saving settings → `genesys-game-boot`
- Moving or tuning a camera node already placed in the editor → `genesys-mcp-orchestrator`
- Pawn/controller basics and possession → `genesys-engine`

## Decide

One camera owns the frame. The world resolves it in this order: top of the view-target stack (`world.pushViewTargetCamera`) → the first player controller's possessed pawn camera (`SceneNode.getCamera()` returns the first enabled `THREE.Camera` in the pawn subtree) → fallback with a warning.

| Game type | Rig | Pointer lock | Default numbers |
|---|---|---|---|
| First person (FPS, horror, puzzle-walk) | `DefaultCharacterPawn`; `getInitialCameraPositions` returns pivot == camera (eye height); `setupVisualNode` and `setupAnimationNode` return `null` | locked | Eye at `CHARACTER_HEIGHT * 0.4` above root (engine FPS demo), FOV 70 (60–75), aim FOV 45 |
| Third person (action, adventure) | Default `DefaultCharacterPawn` / `GSSCharacterPawn`: root → `CameraPivot` → `SpringArmNode` → camera | locked | Camera at `(0, 1.3·H, 2·H)` from pivot (H = 1.8), zoom 1–10 |
| Third-person shooter (over the shoulder) | Same rig; `getInitialCameraPositions` offsets pivot and camera to one shoulder | locked | Pivot `(0.45, 0.7, 0)`, camera `(0.45, 1.15, 4.0)`: about 6° down. The weapon aims at the screen centre, so a steeper default puts the aim point on the floor |
| Top-down follow / twin-stick | Override `setupCamera`: camera child of a root that never yaws, pitched down | `noPointerLock: true`; cursor is the reticle | Height 12–18, back 6–10, pitch 55–70° |
| Side-scroller / 2.5D | Override `setupCamera`: camera child at a fixed side offset | `noPointerLock: true` unless aiming with the mouse | `(0, 3, 10)` looking at origin, FOV 60 (engine side-scroller demo) |
| Isometric / tactics | `THREE.OrthographicCamera` child with pitch only; the **root** is yawed 45° at spawn | `noPointerLock: true` | Root yaw π/4, camera pitch −35.264°, local `(0, d, d·√2)`, square frustum half-height 10–15 |
| Racing / vehicle chase | `FollowNode` with the camera under it, built in `setupCamera` | locked only if the mouse steers the view | Offset `(0, 4, 10)`, `positionDamping` 0.02 per 1/60 s (engine vehicle demo) |
| Fixed arena, single-screen, board game | `ViewTargetCameraNode` placed with MCP, `startActive: true` | `noPointerLock: true` | Frame the whole play space plus 10 % margin |
| RTS / strategy / map pan | `MovementPawn` + `TopDownMovementNode` + child camera | `noPointerLock: true` | Pitch -75°, start height 50 |
| Cutscene, intro, kill-cam, spectator | `ViewTargetCameraNode.setActive(true/false)` | unchanged | Restore by `setActive(false)` |

Override `getInitialCameraPositions()` when only the distances are wrong. Override `setupCamera()` when the hierarchy is wrong. The camera shows the player pawn and the next threat; a chase distance or pitch that hides incoming danger is a defect.

**Look feel defaults.** Mouse 0.001 rad per pixel, Y not inverted, a 0.5–2 sensitivity multiplier on the settings screen; aim FOV 45; FOV kick +8–12° (default 10), 0.2 s in, 0.4 s out; lookahead 10–20 % of the screen toward travel ([fov-and-aim](references/fov-and-aim.md)).

## Build

**Follow from above (top-down, twin-stick).** The camera is a child of the pawn, created in `setupCamera()` and returned so the pawn and world use it. The root never yaws, so the view never spins and W stays screen-up. Pair with the top-down pawn in `genesys-movement`.

Source: .engine/src/entities/CharacterPawn.ts (`setupCamera`), .engine/demos/examples/side-scroller-advanced/player.ts
```ts
@ENGINE.GameClass()
export class TopDownPlayer extends ENGINE.CharacterPawn { // or ENGINE.GSSCharacterPawn
  protected override setupCamera(): THREE.Camera {
    const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, ENGINE.CAMERA_NEAR, ENGINE.CAMERA_FAR);
    camera.name = 'Camera';
    camera.position.set(0, 14, 8);
    camera.lookAt(0, 0, 0);
    this.add(camera);
    return camera; // no pivot or spring arm: updateCamera() and zoom steps become no-ops
  }
}
// main(): ENGINE.DefaultPlayerController.create({ noPointerLock: true }) (or GSSPlayerController)
```

Smoothed follow or a yawing root: a `FollowNode` in `setupCamera()` with the camera under it; a fixed world angle on a yawing root uses `useAbsolutePosition` + `useAbsoluteRotation` and a per-tick position write. FollowNode options and the isometric recipe (root yawed 45° at spawn): [camera-system](references/camera-system.md).

**Third and first person.** Keep the engine hierarchy and change only the positions in `getInitialCameraPositions()`. First person returns pivot == camera at eye height and returns `null` from `setupVisualNode` and `setupAnimationNode`, so the head and arms do not sit in the lens; weapons attach to `this.camera`. Third person returns a camera offset from the pivot, and the pawn builds a `SpringArmNode` of that length (collision buffer 0.05, zoom 1–10). The `FpsPlayer` snippet and spring-arm numbers: [camera-system](references/camera-system.md#first-person-and-third-person-in-code).

**FOV kick and zoom-on-aim.** Write `camera.fov` and ease it per tick with `THREE.MathUtils.damp` (frame-rate independent); the engine updates the projection every frame. Right mouse and the right bumper already call `altFire()` on a `DefaultCharacterPawn`, so aim while it is held; a dash, boost or big hit calls a `kickFov(degrees)` that decays back. The `AimPlayer` pawn and the GSS and vehicle variants: [fov-and-aim](references/fov-and-aim.md#fov-kick-and-zoom-on-aim).

**Lookahead.** Slide the camera child 10–20 % of the visible ground toward travel (≈ 2.4 m for a camera 14 m up at FOV 60), eased with `1 − e^(−3·dt)`; move it, never rotate it, so W stays screen-up ([camera-system](references/camera-system.md#lookahead)).

On a GSS pawn, catch the right mouse button in a `GSSPlayerController` subclass (`handleMouseDown`/`handleMouseUp`) and set the same flag. A vehicle boost calls `kickFov` on its own pawn the same way. Scale mouse sensitivity by `FOV.aim / FOV.base` while aiming if aim feels twitchy.

**Mouse sensitivity and invert-Y.** Mouse look per pixel = `lookSensitivity` (0.02) × look speed (0.05). Classic: `DefaultPlayerController.inputSettings.lookSensitivity`, and a negative `CharacterMovementNode.lookUpSpeed` inverts Y. GSS: `GSSPlayerController.inputSettings` (`lookSensitivity`, `lookYawSpeed`, `lookPitchSpeed`; negative pitch speed inverts Y). Write both stacks' settings ([camera-system](references/camera-system.md#look-sensitivity-and-invert-y) has `applyLookSettings`). The settings screen is `genesys-ui`; saving it is `genesys-game-boot`.

**Shots and fixed cameras.** A placed `ViewTargetCameraNode` with `startActive: true` pushes itself on the view-target stack at `beginPlay` and removes itself at `endPlay`; in code, `setActive(true/false)`. Possession does not change while a view target is active.

**RTS pan.** `TopDownMovementNode` on a `MovementPawn` with a pitched child camera; presets and every option in [top-down-pan](references/top-down-pan.md).

**Pointer lock.** `PlayerController` requests it through `world.inputManager` unless `noPointerLock` is true. Keep it (`false`) when the mouse aims the view (first and third person); set `noPointerLock: true` for top-down, twin-stick, isometric, RTS, side-scroller, cursor tools and stick-only phone look, where the cursor is the reticle and there is no centred crosshair. Escape releases the lock and opens pause; Resume requests it again. Never call `document.requestPointerLock` directly ([camera-system](references/camera-system.md#pointer-lock)).

**Handoffs.** `Controller.possess(pawn)` switches to that pawn's camera; `unpossess()` releases it. A shot that must not change possession uses a view target.

**Scene versus code.** A placed camera node is tuned with MCP; a pawn class sets its layout in code. Never patch an editor camera from `beginPlay`.

## Limitations
- Isometric camera orbits when the pawn turns (no fixed-angle follow rig): [camera-system](references/camera-system.md#limitations).

## Traps
- Agent creates `new THREE.PerspectiveCamera()` in `beginPlay` and adds it next to the pawn's own camera → two cameras, and `getCamera()` returns whichever enabled camera it finds first → build it in `setupCamera()` and return it.
- First-person view shows the inside of the head, or arms clip into the lens → the mannequin and its animation are still built → return `null` from `setupVisualNode` and `setupAnimationNode`.
- Isometric W moves diagonally across the screen → camera yawed 45° over an unrotated root, so forward (−Z) is not screen-up → yaw the root 45° at spawn and give the camera pitch only ([camera-system](references/camera-system.md)).
- Top-down view spins with the mouse or right stick → root yaws from look input → `lookRightSpeed: 0` (classic) or zero GSS look speeds, `noPointerLock: true` (`genesys-movement`).
- Mouse look feels inverted vertically, or invert-Y does nothing → wrong stack's settings, or only yaw was checked → classic `lookUpSpeed` sign, GSS `lookPitchSpeed` sign; test both axes.
- Cursor stays visible in a first-person game, or an aiming game never locks → wrong `noPointerLock` → see *Pointer lock*.
- Cutscene camera never returns → `setActive(false)` not called on end → deactivate it, or let `endPlay` remove it.
- Third-person camera clips into walls → spring-arm collision off or pivot inside geometry → `collisionEnabled: true`, raise the pivot.
- Third-person shots land on the floor a few metres ahead → the default pitch (about 33° down at `(0, 1.3·H, 2·H)`) puts the screen centre on the ground, and weapons aim at that point. Use the over-the-shoulder row.
- Camera hides incoming enemies (chase too close, pitch too flat) → raise height or pull back until the next threat is on screen.
- Frame-rate-dependent chase lag, GSS sensitivity slider: [camera-system](references/camera-system.md#traps).

## Done
- In Play, `world.getActiveCamera()` is the intended camera (query or `run_script` read).
- The player pawn and the nearest threat are both on screen at spawn and during movement.
- Name both look axes in the evidence: mouse/stick right pans the view right **and** mouse/stick up tilts it up (checking yaw alone once let a game ship with inverted pitch). Repeat with invert-Y on if the game offers it.
- Pointer-lock state matches the play style (*Pointer lock*); Escape shows the cursor on the pause card and Resume restores the previous state.
- Screen directions hold for this camera: right input moves screen-right, W moves screen-up (`genesys-movement`).
- Aim and FOV kick ease in and out with no pop; FOV returns to base.
- Any shot restores the gameplay camera when it ends.
- Evidence per `genesys-verification`: a capture from the active camera, not the editor viewport.

## References
- [camera-system](references/camera-system.md) — resolution chain, CharacterPawn/GSS hierarchy, first-person pawn, SpringArmNode, FollowNode, ViewTargetCameraNode, absolute transforms, isometric recipe, lookahead, look sensitivity and invert-Y, pointer lock, limitations and traps
- [fov-and-aim](references/fov-and-aim.md) — look-feel defaults, FOV kick and aim-down-sights pawn, GSS and vehicle variants
- [top-down-pan](references/top-down-pan.md) — `TopDownMovementNode` options, RTS presets, bounds, zoom modes
