# Classic movement nodes and recipes

Classic movement is one `BasePawnMovementNode` subclass assigned as `MovementPawn.movementNode`
(`CharacterPawn` builds one in `createMovementNode()`). Each node has built-in multiplayer
prediction. Pawn/controller fundamentals (possession, input routing) are in `genesys-engine`.

Source: `.engine/src/nodes/movement/`, `.engine/src/entities/MovementPawn.ts`,
`.engine/src/entities/CharacterPawn.ts`, `.engine/src/entities/DefaultPlayerController.ts`.

## Node catalog

| Node | What it does | Key defaults |
|---|---|---|
| `CharacterMovementNode` | First/third-person walking with acceleration, look rotation, jump, character controller | `maxSpeed` 5, `accelerationLambda` 100, `decelerationLambda` 10, `midAirAccelerationLambda` 5, `midAirDecelerationLambda` 0.5, `lookRightSpeed` / `lookUpSpeed` 0.05, `jumpSpeed` 20, `maxMidAirJumps` 0, protected `coyoteTimeMs` 100 |
| `DirectionalCharacterMovementNode` | Character movement locked to one axis, look rotation forced to 0 | `direction` (`ForwardBackward` / `LeftRight`), `autoMove` false |
| `TopDownMovementNode` | Pans and zooms an overhead camera rig on X/Z; no collision, no gravity | `panSpeed` 10, `zoomMode` RootY. Full table in `genesys-camera` |
| `SpectatorMovementNode` | 6-DOF fly-through relative to camera facing; wheel changes speed; no gravity or collision | `maxSpeed` 20, `minSpeed` 1, `maxSpeedCap` 1000, `scrollSpeedFactor` 1.2 |
| `AirplaneMovementNode` | Arcade flight: pitch/yaw/roll input with auto-level, forward throttle | `maxSpeed` 50, `minSpeed` 10, `throttleRate` 0.5, pitch/yaw/roll `maxSpeedDPS` 30/50/30 |
| `AerialMovementNode` | Floating enemy movement: hover, smooth target follow, tilt | `maxSpeed` 15, `hoverHeight` 20, `hoverVariation` 3, `rotationSpeed` 2, `maxTiltAngle` 15 |
| `NpcMovementNode` | AI character movement along paths / toward actors | [npc-movement](npc-movement.md) |
| `VehicleMovementNode` | Wheeled vehicle on a dynamic chassis | `genesys-vehicles` |
| `PathMovementNode` | Moves an actor along a `THREE.Curve`, loop or ping-pong, keeps kinematic velocity in sync | `genesys-interactions` |
| `TweenMovementNode` | Editor-friendly tween of position/rotation/scale | `genesys-interactions` |
| `SpringArmNode` | Camera boom, not locomotion | `genesys-camera` |

`CharacterMovementNode.DEFAULT_CHARACTER_CONTROLLER_OPTIONS`: `offset` 0.01,
`simulatedGravityScale` 5, `applyImpulsesToDynamicBodies` true, `slideEnabled` true,
`maxSlopeClimbAngle` / `minSlopeSlideAngle` π/4, `snapToGroundDistance` 0.1, auto-step
`maxHeight` `CHARACTER_HEIGHT / 4`. Pass `characterControllerOptions: null` to disable the controller.

`CharacterMovementNode` moves along the root's `forwardDirection()` (-Z) and `rightDirection()`, and
look-right input yaws the root. `getVelocities()` returns `{ forward, right, vertical }`;
`getGrounded()` includes coyote time.

## Input path

`DefaultPlayerController` reads keys, mouse, gamepad and virtual sticks and calls the
`MovementPawn` methods `moveForward`, `moveRight`, `lookUp`, `lookRight`, `zoom` every frame and
`jump` / `stopJump` on press and release. The pawn forwards them to its `movementNode`
(`addForwardInput`, `addRightInput`, `addLookUpInput`, `addLookRightInput`, `addZoomInput`, `jump`,
`stopJump`); each `add*Input` overwrites the value, so the last write in a frame wins. On a predicted
client the controller hands jump edges to `movementNode.setJumpEdges()` instead. Mouse down/up/move/wheel
go to `movementNode.handleMouse*` first, so `TopDownMovementNode` gets drag and wheel without pointer
lock. Mouse look applies only while pointer-locked.

Default bindings: W/A/S/D and arrows move, Space jump (gamepad face-bottom), Q/Z zoom in/out (gamepad
left trigger / left bumper), mouse wheel one zoom step (`CharacterPawn.zoomStep`). On a pawn that
implements `ICombatPawn` (`DefaultCharacterPawn`): LMB / right trigger `fire`/`endFire`, RMB / right
bumper `altFire`/`endAltFire`, R / face-left `reload`. On `IInteractPawn`: E `interact`/`endInteract`.
`DefaultCharacterPawn` also receives raw key, mouse and gamepad events on its own delegates first.

## Top-down or twin-stick character

Use `DefaultCharacterPawn` + `CharacterMovementNode` (walls, slopes, steps and gravity come free) and a
camera child above the root. Keep the root's yaw fixed (`lookRightSpeed: 0`, `lookUpSpeed: 0`,
controller `noPointerLock: true`), so forward input is screen-up. Turn only the visual child, and
override `getAnimationParameters()` so the run blend follows speed, not root-relative direction;
otherwise the turned body plays RunBackward and strafe clips (moonwalk). A camera child of a
non-yawing root needs no follow code. For lag, or a fixed world angle while the root turns, see
`genesys-camera`.

Source: .engine/src/entities/CharacterPawn.ts (`setupCamera`, `getAnimationParameters`), .engine/demos/examples/side-scroller-advanced/player.ts (same remap) (composed — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class TopDownPlayer extends ENGINE.DefaultCharacterPawn {
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.CharacterMovementNode.create({
      name: 'MovementNode', maxSpeed: 7, decelerationLambda: 20,
      lookRightSpeed: 0, lookUpSpeed: 0, // mouse/stick never yaws the root
    });
  }
  protected override setupCamera(): THREE.Camera {
    const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, ENGINE.CAMERA_NEAR, ENGINE.CAMERA_FAR);
    camera.name = 'Camera';
    camera.position.set(0, 14, 8); // above and behind; screen-up = -Z = forward
    camera.lookAt(0, 0, 0);
    this.add(camera);
    return camera;
  }
  /** Turn the visual (never the root) to face a world direction. The model faces +Z natively. */
  public faceDirection(dir: THREE.Vector3): void {
    if (dir.x * dir.x + dir.z * dir.z < 1e-4) return;
    this.visualNode?.rotation.set(0, Math.atan2(dir.x, dir.z) - this.rotation.y, 0);
  }
  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    const mn = this.movementNode;
    if (!(mn instanceof ENGINE.CharacterMovementNode)) return;
    const { forward, right } = mn.getVelocities(); // root-local: forward is -Z, right is +X
    this.faceDirection(new THREE.Vector3(right, 0, -forward).applyQuaternion(this.quaternion));
  }
  // The visual turns, so drive the run blend by speed; otherwise S plays RunBackward and A/D strafe.
  protected override getAnimationParameters(): Record<string, any> {
    const params = super.getAnimationParameters();
    const mn = this.movementNode;
    if (!(mn instanceof ENGINE.CharacterMovementNode)) return params;
    const { forward, right } = mn.getVelocities();
    const speed = Math.hypot(forward, right);
    return { ...params, forward: speed > 0.01 ? speed : 0, back: 0, left: 0, right: 0 };
  }
}
// Controller: ENGINE.DefaultPlayerController.create({ noPointerLock: true })
```

Twin-stick aim with the mouse: face the cursor's point on the ground plane. The touch aim stick is in
`genesys-touch-controls` and calls the same `faceDirection`.

Source: .engine/src/nodes/movement/TopDownMovementNode.ts (`getWorldPointUnderCursor`) (composed — typechecked against 18.1.0-alpha.317)
```ts
private readonly ray = new THREE.Raycaster();
private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
private readonly aim = new THREE.Vector3();

private faceCursor(): void { // call from tickPrePhysics after super
  const input = this.getWorld()?.inputManager;
  const camera = this.getCamera();
  if (!input || !camera) return;
  this.ray.setFromCamera(input.getMousePosition(), camera); // NDC mouse
  const here = this.getWorldPosition(new THREE.Vector3());
  this.ground.constant = -here.y;
  if (!this.ray.ray.intersectPlane(this.ground, this.aim)) return;
  this.faceDirection(this.aim.sub(here)); // TopDownPlayer.faceDirection
}
```

The default character model faces +Z and is authored with yaw π, so a visual yaw of `atan2(dx, dz)`
faces world direction `(dx, dz)`. `faceDirection` subtracts the root yaw, so it also works on an
isometric pawn whose root is yawed 45° at spawn (`genesys-camera`). Projectiles and damage are
`genesys-combat`.

On GSS, the same camera override works on a `GSSCharacterPawn` subclass. Without pointer lock the
mouse never changes `controlRotation`; zero `GSSPlayerController.inputSettings.lookYawSpeed` and
`lookPitchSpeed` so the gamepad right stick does not turn the view. `GSSWalkingMode` keeps the
capsule upright and sets yaw from `controlRotation.y`; turn the visual, not the capsule. Replace the
engine dash, which follows control yaw ([gss-abilities-effects](gss-abilities-effects.md)).

## Side-scroller

Source: .engine/demos/examples/side-scroller-advanced/player.ts
```ts
protected override createMovementNode(): ENGINE.BasePawnMovementNode {
  return ENGINE.DirectionalCharacterMovementNode.create({
    name: 'MovementNode',
    direction: ENGINE.CharacterMovementDirection.LeftRight,
    autoMove: false,          // true = endless runner
    maxMidAirJumps: 1,        // double jump
  });
}
```

The demo puts a `PerspectiveCamera` child at `(0, 3, 10)` looking at the origin (FOV 60), rotates
the mesh to yaw +π/2 when `getVelocities().right > 0.1` and -π/2 when below -0.1, and remaps
animation parameters so sideways speed drives the run blend.

## Sprint

1. Subclass `CharacterPawn` or `MovementPawn` (plain `Pawn` has no `movementNode`). Add a sprint
   multiplier property (1.5–1.8).
2. Add `setSprinting(on)` that sets `this.movementNode.speedModifier` to the multiplier or 1.
   `speedModifier` lives on `BasePawnMovementNode` and is honored by `CharacterMovementNode`,
   `SpectatorMovementNode`, `TopDownMovementNode`, `VehicleMovementNode`, and
   `AirplaneMovementNode`. `AerialMovementNode` ignores it and uses bare `maxSpeed`.
3. Subclass `DefaultPlayerController` (or `PlayerController`), handle the sprint key and gamepad
   button, and call the pawn. Default stamina: none unless the design asks for it.

GSS sprint: register a sprint tag, report it while down from a `GSSPlayerController` subclass, and add
an `IGSSAbility` that applies an `IGSSEffect` whose `modifyAttributes` scales `GSSTags.MoveSpeed`
(controller snippet in [gss-abilities-effects](gss-abilities-effects.md)).

## Flying and hovering

| Need | Use |
|---|---|
| Player-piloted plane or arcade flyer | `AirplaneMovementNode` on a `MovementPawn` |
| Debug or spectator camera | `SpectatorMovementNode` |
| Floating enemy | `AerialMovementNode` (`setLookAtTarget` for facing) |
| Hover vehicle, jetpack, or flight that must switch with walking | Custom `IGSSMovementMode` ([custom-modes-and-controllers](custom-modes-and-controllers.md)) |

## Arcade flight bindings (`AirplaneMovementNode`)

The node reads the standard pawn axes; there is no flight-specific controller.

| Input | Axis | Effect |
|---|---|---|
| W / S, left stick Y | `forwardInput`, negated | W = nose **down**, S = nose up (stick-forward convention) |
| A / D, left stick X | `rightInput` | Yaw **and** roll together (bank-and-turn) |
| Q / Z, gamepad left trigger / left bumper | `zoomInput` | Throttle up / down at `throttleRate` 0.5 per second, clamped 0..1 |
| Mouse | — | Nothing; pitch comes from W/S |

Speed = lerp(`minSpeed` 10, `maxSpeed` 50, throttle). `initialThrottle` defaults to 0, so the plane
starts at `minSpeed` and only Q raises it. The node does nothing unless a player controller possesses
the pawn. Pitch auto-levels at `autoLevelLambda` 0.5 and roll at 3; roll is capped at 60°.

If the design says "Shift = throttle", rebind; if it says "W = climb", invert the pawn's forward axis:

Source: .engine/src/nodes/movement/AirplaneMovementNode.ts, .engine/src/entities/DefaultPlayerController.ts (`tickPrePhysics`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export function createPlane(): ENGINE.MovementPawn {
  return ENGINE.MovementPawn.create({
    movementNode: ENGINE.AirplaneMovementNode.create({
      pitchParams: { maxSpeedDPS: 30, accelerationLambda: 2, decelerationLambda: 100, autoLevelLambda: 0.5 },
      yawParams: { maxSpeedDPS: 50, accelerationLambda: 3, decelerationLambda: 100 },
      rollParams: { maxSpeedDPS: 30, accelerationLambda: 2, decelerationLambda: 100, maxDegrees: 60, autoLevelLambda: 3 },
      throttleRate: 0.5, maxSpeed: 50, minSpeed: 10,
      initialThrottle: 0.5, // cruise at 30 m/s from the first frame
    }),
  });
}

/** Shift = throttle up while held. Q/Z still work: the zoom axis is the throttle. */
@ENGINE.GameClass()
export class FlightController extends ENGINE.DefaultPlayerController {
  private boost = false;
  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.boost = true; return true; }
    return super.handleKeyDown(e);
  }
  public override handleKeyUp(e: KeyboardEvent): boolean {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.boost = false; return true; }
    return super.handleKeyUp(e);
  }
  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);                                            // writes zoom (Q/Z) every frame
    const pawn = this.getPawn();
    if (this.boost && pawn instanceof ENGINE.MovementPawn) pawn.zoom(1); // last write wins
  }
}

/** Only if the design wants W = nose up. */
@ENGINE.GameClass()
export class InvertedPitchPlane extends ENGINE.MovementPawn {
  public override moveForward(value: number, isAbsolute = false): void {
    super.moveForward(-value, isAbsolute);
  }
}
```

A glider, a throttle-free flyer, or flight that must also walk is a custom movement node
(subclass `BasePawnMovementNode`, implement `performMovementStep`) or a custom GSS mode; decide that in
`genesys-tech-design` when the node's throttle model does not fit. Touch: a throttle button sets the
same held flag (`genesys-touch-controls`). Verify bindings in Play: hold each key 0.5 s and record
nose and speed.

## Traps

- Top-down view spins when the mouse moves → root yaws from look input → `lookRightSpeed: 0` (classic) or `noPointerLock: true` plus zero GSS look speeds.
- Top-down hero built on `TopDownMovementNode` floats through walls with no gravity → that node is the RTS camera pan → `CharacterMovementNode`.
- Plane crawls forward and never speeds up → `initialThrottle` 0 and throttle is Q/Z, not Shift → set `initialThrottle`, or rebind (*Arcade flight bindings*).
