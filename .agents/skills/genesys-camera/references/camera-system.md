# Camera system

Source: `.engine/src/game/World.ts` (`getActiveCamera`, view-target stack),
`.engine/src/entities/CharacterPawn.ts`, `.engine/src/gameplay-sim/entities/GSSCharacterPawn.ts`,
`.engine/src/nodes/movement/SpringArmNode.ts`, `.engine/src/nodes/FollowNode.ts`,
`.engine/src/nodes/ViewTargetCameraNode.ts`, `.engine/src/utils/ThreeJsExtensions.ts`,
`.engine/src/game/GameLoop.ts` (`renderFrame`).

## Active camera resolution

`World.getActiveCamera()` resolves the camera in this order:

1. **View-target stack** — the topmost live camera pushed with `world.pushViewTargetCamera(camera)`
   (no-op if it is already on top). Remove with `world.removeViewTargetCamera(camera)`, which
   removes it from anywhere in the stack. The stack holds weak references; dead entries are dropped.
2. **Possessed pawn camera** — `playerControllers[0].getCamera()`, which is the pawn's
   `getCamera()` (the first enabled `THREE.Camera` among the pawn's nodes), else the controller's own.
3. **Null** — the engine logs a rate-limited warning ("No camera found…") and renders with a fallback.

Main pattern: attach a `THREE.Camera` anywhere in the pawn's scene graph. The world finds it.

## CharacterPawn and GSSCharacterPawn hierarchy

Both pawns build the camera in `setupCamera()` and choose a layout from `getInitialCameraPositions()`:

- **First person** (pivot and camera positions equal): root → `CameraPivot` → camera. The pivot
  provides pitch; yaw comes from the root, driven by the movement node or sim.
- **Third person** (positions differ): root → `CameraPivot` → `CameraSpringArm` → camera. The arm
  length is the distance between the two points and the pivot's initial pitch is
  `-atan2(dy, dz)`.

Default positions: pivot `(0, 0, 0)`, camera `(0, CHARACTER_HEIGHT * 1.3, CHARACTER_HEIGHT * 2)`
with `CHARACTER_HEIGHT` 1.8. Camera: `PerspectiveCamera(CAMERA_FOV 60, 1, CAMERA_NEAR 0.1, CAMERA_FAR 2000)`.

Pawn camera properties (both classes): `cameraMinDistance` 1, `cameraMaxDistance` 10 (raised to twice
the initial arm length), `cameraZoomSensitivity` 0.5, `cameraCollisionBuffer` 0.05,
`cameraSpringStiffness` 4.5, `cameraMinPitchDegrees` -80, `cameraMaxPitchDegrees` 80.

Pitch update differs:
- `CharacterPawn.updateCamera` adds `lookUpInput * lookUpSpeed` from the `CharacterMovementNode` to
  the pivot pitch, clamped.
- `GSSCharacterPawn.updateCamera` sets pivot pitch to the controller's `controlRotation.x`, clamped,
  every frame. `GSSPlayerController` starts that pitch at the pivot's pitch on possession, so the
  angle from `getInitialCameraPositions` holds until look input moves it.

Zoom: `CharacterPawn.zoomStep(direction)` changes the arm by one notch; `GSSCharacterPawn` consumes
`GSSPlayerController.consumeZoomSteps()` after physics. Both clamp to min/max distance and do nothing
without a spring arm.

Override `setupCamera()` only when the pivot/spring-arm hierarchy does not fit; otherwise override
`getInitialCameraPositions()`.

### First person and third person, in code

Keep the engine hierarchy and change only the positions. In first person the eye sits inside the mannequin's head, so drop the body and its animation node, as the engine FPS demo does.

Source: .engine/demos/examples/fps-advanced/player.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class FpsPlayer extends ENGINE.DefaultCharacterPawn {
  protected override getInitialCameraPositions(): { pivotPosition: THREE.Vector3; cameraPosition: THREE.Vector3 } {
    const eye = new THREE.Vector3(0, ENGINE.CHARACTER_HEIGHT * 0.4, 0);
    return { pivotPosition: eye, cameraPosition: eye }; // equal = first person, no spring arm
  }
  protected override setupVisualNode(): ENGINE.SceneNode | null { return null; }               // no body in front of the eye
  protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null { return null; }
}
```

Weapons and arms attach to `this.camera` (the demo's `setWeapon` does `this.camera.add(weapon)`); the third-person body for other players is a multiplayer concern.

For third person return a camera position offset from the pivot. The pawn builds a `SpringArmNode` with that length, initial pitch, `collisionBuffer` = `cameraCollisionBuffer` (0.05), and `springBackLambda` = `cameraSpringStiffness` (4.5). Wheel zoom clamps to `cameraMinDistance`..`cameraMaxDistance` (1..10, raised to 2× the arm length). On `GSSCharacterPawn`, pivot pitch each frame is `controlRotation.x` clamped to `cameraMinPitchDegrees`..`cameraMaxPitchDegrees` (-80..80), starting from the initial pitch.

## SpringArmNode

Options: `armLength` (null = keep the child's distance), `collisionBuffer` 0.05, `pivotOffset`
`(0,0,0)`, `springBackLambda` 4.5 (damps the return after a collision pull-in), `collisionEnabled`
true. It updates in `tickPostPhysics`, pulls the camera in front of geometry, and springs back. It raycasts only while its camera is the rendered view, so an enemy pawn's arm stays at its rest length.

## FollowNode

A node that moves itself toward a target with damping and looks at it.

| Option | Default | Notes |
|---|---|---|
| `target` | null | The node to follow; `setTarget()` |
| `positionOffset` | `(0, 5, 10)` | In the target's local space, so it turns with the target (chase cam) |
| `lookAtOffset` | `(0, 0, 0)` | Target-local look point |
| `positionDamping` | 0.05 | Fraction of the gap closed per 1/60 s, scaled by delta time; 1 = rigid |
| `useCameraLookAtConvention` | true | Leave true when a camera is the child |

It writes its world position and rotation in `tickPrePhysics`, so it works even as a child of the
pawn it follows. The engine vehicle demo builds it in `setupCamera()`:

Source: .engine/demos/examples/vehicle/base-vehicle.ts
```ts
protected override setupCamera(): THREE.Camera {
  const follow = ENGINE.FollowNode.create({
    name: 'FollowNode', target: this,
    positionOffset: new THREE.Vector3(0, 4, 10), positionDamping: 0.02,
    lookAtOffset: new THREE.Vector3(0, 0, 0), useCameraLookAtConvention: true,
  });
  this.add(follow);
  const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, ENGINE.CAMERA_NEAR, ENGINE.CAMERA_FAR);
  camera.name = 'Camera';
  follow.add(camera);
  return camera;
}
```

The engine scales `positionDamping` by delta time, so the lag is the same on a phone at 30 fps and a
144 Hz monitor. Tune it at 60 fps; do not convert it per tick yourself (a `SteadyFollowNode` subclass from
an older version of this skill converts twice: delete it, per `engine-upgrades`).

`positionDamping` 0 means "do not follow" (the node skips the update), not "rigid"; rigid is 1.

## ViewTargetCameraNode

Wraps a `THREE.PerspectiveCamera` and the view-target stack. Use it for cutscenes, debug/free-fly,
spectator, intro flyovers, and fixed single-screen cameras.

| Option / call | Default | Effect |
|---|---|---|
| `fov`, `aspect`, `near`, `far` | 75, 1, 0.1, 1000 | `setFOV`, `setAspect`, `setNear`, `setFar` update the projection |
| `startActive` | false | Pushes itself at `beginPlay` |
| `setActive(true / false)` | — | Push / remove on the world stack (warns if not in a world) |
| `isActive()` | — | True when it is the world's active camera |
| `getCamera()` | — | The wrapped camera |

`endPlay` removes it if active.

## Absolute transforms

Any `THREE.Object3D` (and `SceneNode` options) supports `useAbsolutePosition`, `useAbsoluteRotation`,
and `useAbsoluteScale`. When set, that component of the local transform is treated as world space;
the others still compose with the parent. With only `useAbsoluteRotation`, the position offset is
still rotated by the parent, so the camera orbits a yawing parent.

## Isometric and orthographic

1. Use `THREE.OrthographicCamera` with a square frustum (`-h, h, h, -h`). Each frame the engine sets
   `left = bottom * aspect` and `right = top * aspect`. `h` is the half-height of the view in world
   units (10–15 for a room-sized arena).
2. The classic iso angle is yaw 45°, pitch −35.264° (camera at `(d, d, d)` looking at the pawn).
3. Put the 45° on the **pawn root**, not on the camera. Movement runs along the root's forward (−Z)
   and right (+X); a camera yawed over an unrotated root makes W move diagonally on screen. With the
   root yawed π/4 the camera child needs pitch only, at local `(0, d, d·√2)`: the same view as world
   `(d, d, d)`, and W is screen-up.
4. Yaw the root at spawn from the GameMode (below), or rotate the placed `PlayerStart` to yaw 45° with
   MCP. A GSS pawn picks the yaw up too: `GSSPlayerController` seeds `controlRotation` from the pawn's
   rotation on possess. Keep the root from yawing afterwards (`lookRightSpeed: 0`, `noPointerLock: true`).
5. Visual facing on a yawed root subtracts the root yaw (`faceDirection` in `genesys-movement` does).

Source: .engine/src/game/GameMode.ts (`spawnPlayerPawnWithTransform`), .engine/src/game/GameLoop.ts (`renderFrame` ortho handling) (composed — typechecked against 18.1.0-alpha.317)
```ts
const ISO_YAW = Math.PI / 4; // root yaw; W then moves along the camera's ground-forward

@ENGINE.GameClass()
export class IsoPlayer extends ENGINE.DefaultCharacterPawn {
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.CharacterMovementNode.create({ name: 'MovementNode', lookRightSpeed: 0, lookUpSpeed: 0 });
  }
  protected override setupCamera(): THREE.Camera {
    const h = 12; // half-height of the view in metres
    const camera = new THREE.OrthographicCamera(-h, h, h, -h, 0.1, 500);
    camera.name = 'Camera';
    camera.position.set(0, 20, 20 * Math.SQRT2); // behind the yawed root: same view as world (20, 20, 20)
    camera.rotation.set(THREE.MathUtils.degToRad(-35.264), 0, 0, 'YXZ'); // yaw comes from the root
    this.add(camera);
    return camera;
  }
}

@ENGINE.GameClass()
export class IsoGameMode extends ENGINE.GameMode {
  public override async spawnPlayerPawnWithTransform(
    clientId: ENGINE.ClientId, controller: ENGINE.PlayerController, position: THREE.Vector3, _rotation: THREE.Euler,
  ): Promise<ENGINE.Pawn | null> {
    return super.spawnPlayerPawnWithTransform(clientId, controller, position, new THREE.Euler(0, ISO_YAW, 0));
  }
}
// Controller: ENGINE.DefaultPlayerController.create({ noPointerLock: true })
```

If the root must yaw (a tank that turns), keep the camera's world angle fixed instead: set
`camera.useAbsolutePosition = true` and `camera.useAbsoluteRotation = true`, give it world rotation
`(-35.264°, 45°, 0, 'YXZ')`, and write `camera.position` = pawn world position + `(d, d, d)` in the
pawn's `tickPrePhysics`. Movement input is then root-relative, so steer with
`screenRight = cameraForward × worldUp` (`genesys-movement`).

## Lookahead

Lead the camera toward travel so the player sees what they move into: 10–20 % of the visible ground
(default 15 %). Visible ground height ≈ `2 · height · tan(fov / 2)`, so a camera 14 m up at FOV 60
sees ≈ 16 m and 15 % ≈ 2.4 m. The lead scales with speed, eases in and out, and only translates the
camera child; rotating it would change which way W goes on screen.

Source: .engine/src/entities/CharacterPawn.ts (`setupCamera`), .engine/src/nodes/movement/CharacterMovementNode.ts (`getVelocities`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export const LOOKAHEAD = { metres: 2.4, lambda: 3 };

@ENGINE.GameClass()
export class LookaheadPlayer extends ENGINE.DefaultCharacterPawn {
  private readonly camBase = new THREE.Vector3(0, 14, 8);
  private readonly lead = new THREE.Vector3();
  protected override setupCamera(): THREE.Camera {
    const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, ENGINE.CAMERA_NEAR, ENGINE.CAMERA_FAR);
    camera.name = 'Camera';
    camera.position.copy(this.camBase);
    camera.lookAt(0, 0, 0);
    this.add(camera);
    return camera;
  }
  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    const mn = this.movementNode;
    if (!(mn instanceof ENGINE.CharacterMovementNode)) return;
    const { forward, right } = mn.getVelocities();           // root-local, same frame as the camera child
    const dir = new THREE.Vector3(right, 0, -forward);
    const speed = dir.length();
    const goal = speed > 0.1 ? dir.multiplyScalar(LOOKAHEAD.metres / Math.max(speed, mn.maxSpeed)) : dir.set(0, 0, 0);
    const k = 1 - Math.exp(-LOOKAHEAD.lambda * dt);           // frame-rate independent ease
    this.lead.lerp(goal, k);
    this.camera.position.copy(this.camBase).add(this.lead);  // camera keeps its pitch; it slides, never rotates
  }
}
```

Side-scroller: lead on X only. Chase rigs on a `FollowNode`: feed the lead into `setLookAtOffset`
instead of moving the camera. Put the same lines on the top-down pawn from `genesys-movement`.

## Look sensitivity and invert-Y

| Stack | Mouse | Gamepad / touch stick | Invert-Y |
|---|---|---|---|
| Classic (`DefaultPlayerController` → `CharacterMovementNode`) | `inputSettings.lookSensitivity` 0.02 × node `lookRightSpeed` / `lookUpSpeed` 0.05 | `gamepadLookSensitivity` 80, `joystickLookSensitivity` 0.6, × the same node speeds (yaw also × dt; classic pitch is not, so check pad pitch in Play) | `lookUpSpeed` < 0 (pitch is `lookUpInput × lookUpSpeed` in `CharacterPawn.updateCamera`) |
| GSS (`GSSPlayerController`) | `inputSettings.lookSensitivity` 0.02 × `lookYawSpeed` / `lookPitchSpeed` 0.05 | same pair × dt | `lookPitchSpeed` < 0 |

All four `inputSettings` objects are static: one change applies to every controller of that class.
Pitch clamps: classic pawn `cameraMinPitchDegrees` / `cameraMaxPitchDegrees` (−80..80); GSS controller
`minPitch` / `maxPitch` (±π/2), then the pawn's ±80°.

Source: .engine/src/entities/DefaultPlayerController.ts (`inputSettings`, `handleMouseMove`), .engine/src/entities/CharacterPawn.ts (`updateCamera`), .engine/src/gameplay-sim/entities/GSSPlayerController.ts (`produceInputCmd`) (composed — typechecked against 18.1.0-alpha.317)
```ts
/** Apply look settings at boot and whenever the settings screen changes them. */
export function applyLookSettings(pawn: ENGINE.Pawn | null, sensitivity = 1, invertY = false): void {
  // Classic stack: radians per mouse pixel = lookSensitivity (0.02) × node lookRightSpeed / lookUpSpeed (0.05)
  ENGINE.DefaultPlayerController.inputSettings.lookSensitivity = 0.02 * sensitivity;
  if (pawn instanceof ENGINE.MovementPawn && pawn.movementNode instanceof ENGINE.CharacterMovementNode) {
    pawn.movementNode.lookUpSpeed = Math.abs(pawn.movementNode.lookUpSpeed) * (invertY ? -1 : 1); // mouse, pad and stick
  }
  // GSS stack: the same product on the static controller settings
  const gss = ENGINE.GSSPlayerController.inputSettings;
  gss.lookSensitivity = 0.02 * sensitivity;
  gss.lookPitchSpeed = Math.abs(gss.lookPitchSpeed) * (invertY ? -1 : 1);
}
```

Call it again after every respawn on the classic stack (a new pawn builds a new movement node).
Persist the two values with the game's other settings (`genesys-game-boot`).

## Pointer lock

`PlayerController` calls `world.inputManager.requestPointerLock({ unadjustedMovement: true })` on local input setup unless `noPointerLock` is true.

| Play style | `noPointerLock` |
|---|---|
| First person, third person, any game where the mouse aims the view and no cursor tool exists | `false` (default) |
| Top-down, twin-stick, isometric, RTS, side-scroller, point-and-click, inventory or cursor tools | `true`; the cursor is the tool |
| Phone play where the right stick is the only look control | `true` |

With `noPointerLock: true` the cursor is the reticle: no centered crosshair. Escape releases the lock and opens pause (`genesys-game-boot` state, `genesys-ui` card) with the cursor visible; Resume calls `world.inputManager.requestPointerLock(...)` again. Use the input manager, never `document.requestPointerLock` / `exitPointerLock` directly (`world.inputManager.exitPointerLock()` exists).

## Tips

- Create a perspective camera with aspect 1; the engine sets aspect from the window every frame.
- Orthographic zoom is `h` (top/bottom), followed by `updateProjectionMatrix()`.
- Pointer-lock and the cursor policy: *Pointer lock* above.
- FOV: write `camera.fov`; the engine calls `updateProjectionMatrix()` on the active perspective
  camera every frame. `ViewTargetCameraNode.setFOV()` does the same for shots.

## Limitations

- Isometric camera orbits when the pawn turns → camera is a plain child of a yawing root → absolute position + rotation and a per-tick position write, or keep the root from yawing.

## Traps

- Chase lag differs between 30, 60 and 144 fps → a `SteadyFollowNode` subclass converts the damping a second time → delete it and use `FollowNode` (*FollowNode*).
- Sensitivity slider does nothing on a GSS pawn → it wrote `DefaultPlayerController.inputSettings` → write `GSSPlayerController.inputSettings` too.
