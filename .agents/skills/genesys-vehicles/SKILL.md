---
name: genesys-vehicles
description: "Drivable vehicles and racing: VehicleMovementNode, wheels, suspension, steering, drift, boost, flipping back, reset to track, enter/exit by possession, chase camera, laps, ordered checkpoints, AI racers, race position. Use for car, kart, truck, driving, racing game, lap counter, checkpoints, opponents, the car flips or slides, or drifting. Not for walking or flying pawns (use `genesys-movement`) or the race HUD and result screen (use `genesys-ui`)."
metadata:
  tokens: 3286
---

# Vehicles

This skill owns the drivable vehicle pawn, its wheel and suspension tuning, entering and exiting by possession, and the camera that follows it. The rule: **a vehicle is its own pawn whose root is a Dynamic physics chassis driven by `VehicleMovementNode`; the player drives it by being possessed into it.**

## Use another skill when
- Chase-camera rig types, view targets, pointer lock → `genesys-camera`
- The on-foot pawn, its movement and screen direction → `genesys-movement`
- The "Press E to enter" prompt and interaction volumes → `genesys-interactions`
- Speedometer, lap, and position HUD; the result screen → `genesys-ui`
- Countdown, result and retry screens in the GameMode state machine → `genesys-game-boot` (laps, gates and ranking stay here: [racing](references/racing.md))
- FOV kick on boost → `genesys-camera`; impact shake → `genesys-game-feel`
- Engine sound, skid, impact audio → `genesys-audio`; dust, sparks, boost trails → `genesys-vfx`
- Phone steering → `genesys-touch-controls`
- Networked driving and server-authorised possession → `genesys-multiplayer`
- Raycasts, impulses, joints outside a vehicle → `genesys-physics`

## Decide

GSS does not ship a vehicle mode. Use classic `VehicleMovementNode` (built-in prediction), or write a custom `IGSSMovementMode` when a GSS pawn must be the vehicle.

| Game | Setup | Defaults to change |
|---|---|---|
| Arcade racer, kart | Vehicle pawn as below with `ArcadeVehicleMovementNode` (drift + boost), player spawns already possessed into it; 3 laps, 5 AI racers, gates every 40–80 m ([racing](references/racing.md)) | `maxSpeed` 30–45 m/s, `steeringSpeedReduction` ~1, `frictionSlip` 4–8 on a light chassis |
| Open world with enter/exit | On-foot pawn + vehicle pawns, possession swap on interact | Engine defaults; `autoBreakWhenNotPossessed` 1 parks empty cars |
| Physics toy, monster truck | Vehicle pawn, soft suspension | `suspensionStiffness` 15–25, `maxSuspensionTravel` close to `suspensionRestLength` |
| Combat car | Vehicle pawn + weapons on child nodes (`genesys-combat`) | Collision profile `Vehicle` so it blocks characters |

**Stack rule.** A predicted GSS character must not collide with or board a classic vehicle unless the vehicle is `IRewindable` and re-simulated; `VehicleMovementNode` is not. Single-player and non-predicted games are unaffected (`genesys-movement`, GSS mechanics reference).

Default controls (`DefaultPlayerController`): W/S throttle and reverse, A/D steer, Space handbrake (`MovementPawn.jump()` sets `brakeInput`, which brakes all four default wheels: a full stop, not a drift), left stick on touch and gamepad. Flip is a game key that calls `flipVehicle()`. Racers add Space = drift, Shift = boost, R = reset to track.

**Two sets of wheel defaults.** `VehicleMovementNode`'s own default wheels (`createDefaultWheels`) are what a car gets: `suspensionStiffness` 20, `sideFrictionStiffness` 2, `frictionSlip` 10.5, `maxSuspensionTravel` 5.0. The `IPhysicsVehicle` interface documents different fallbacks (`suspensionStiffness` 5.88, `sideFrictionStiffness` 1.0), which apply only to a wheel config that leaves the field out, such as a hand-built `addWheel` call. "Engine defaults" below means the `VehicleMovementNode` set.

## Build

**The vehicle pawn.** The engine vehicle demo extends `CharacterPawn` so it can use the `createCollision` / `createMovementNode` / `setupCamera` hooks. The root is the Dynamic chassis with the `Vehicle` collision profile; the chassis mesh contributes its collider; the camera is a `FollowNode` chase rig.

Source: .engine/demos/examples/vehicle/base-vehicle.ts, primitive-vehicle.ts
```ts
@ENGINE.GameClass()
export class Car extends ENGINE.CharacterPawn {
  public override initialize(options?: ENGINE.CharacterPawnOptions): void {
    super.initialize({ ...options, physicsOptions: {
      enabled: true, motionType: ENGINE.PhysicsMotionType.Dynamic,
      collisionProfile: ENGINE.DefaultCollisionProfile.Vehicle, // Character ignores other pawns
      generateCollisionEvents: true } });
  }
  protected override createCollision(): ENGINE.SceneNode {
    return ENGINE.MeshNode.create({ name: 'chassis', geometry: new THREE.BoxGeometry(2, 1, 4),
      physicsOptions: { enabled: true, contributeToParentCollider: true } });
  }
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.VehicleMovementNode.create({ maxEnginePower: 35, maxSpeed: 40, createWheelMeshes: true });
  }
  protected override setupCamera(): THREE.Camera {
    const follow = ENGINE.FollowNode.create({ name: 'FollowNode', target: this,
      positionOffset: new THREE.Vector3(0, 4, 10), positionDamping: 0.02 });
    this.add(follow);
    const camera = new THREE.PerspectiveCamera(ENGINE.CAMERA_FOV, 1, ENGINE.CAMERA_NEAR, ENGINE.CAMERA_FAR);
    camera.name = 'Camera';                            // as the engine demo names it
    follow.add(camera);
    return camera;
  }
  protected override setupAnimationNode(): ENGINE.AnimationStateMachineNode | null { return null; }
  protected override setupVisualNode(): ENGINE.SceneNode | null { return null; } // or a car model
}
```

A plain `MovementPawn` with `movementNode: VehicleMovementNode.create(...)` and Dynamic `physicsOptions` also works; then add a camera child yourself. `VehicleMovementNode` creates its `IPhysicsVehicle` lazily in `tickPrePhysics` once the root is a Dynamic `PrimitiveNode`, recreates it if the chassis body is rebuilt, and sets the chassis to receive (never send) the physics transform. Wheels default to four (front steer, rear drive); pass `wheels` to change them. Option table: [vehicle-movement-node](references/vehicle-movement-node.md).

Use a real car model for the hero: reuse one, or build a code model with separate wheel meshes (`genesys-assets`, `genesys-code-modeling`). A box chassis is a blockout. Visual meshes get `physicsOptions: { enabled: false }` so they do not change handling.

**Enter and exit.** There is no seat component and no enter method in the engine. Entering is possession; the demo flow is in [enter-exit](references/enter-exit.md):
1. Detect the on-foot pawn within 5 units of the vehicle.
2. On interact: mark the driver, `controller.unpossess()`, `controller.possess(vehicle)`, hide the driver (`visible = false`) and disable its root physics (`setPhysicsEnabled(false, false)`).
3. On exit: place the driver about 2 units to the vehicle's right and 1 up, face the vehicle's heading, restore visibility and physics, `unpossess()`, `possess(driver)`.

On possess, the world renders the possessed pawn's camera, so the handoff needs no camera code. A shot that must not change possession uses `ViewTargetCameraNode` (`genesys-camera`). In multiplayer, the server authorises the possess and occupancy is "who possesses this pawn".

**Drift and boost.** `setWheelSideFrictionStiffness` keeps the value you set. Lower rear grip while drifting and restore the wheel config when the drift ends. `speedModifier` scales engine force, brake force and `maxSpeed` together, which is a boost.

Source: .engine/src/nodes/movement/VehicleMovementNode.ts (`jump`, `speedModifier`), .engine/src/physics/IPhysicsVehicle.ts
```ts
@ENGINE.GameClass()
export class ArcadeVehicleMovementNode extends ENGINE.VehicleMovementNode {
  public driftSideFriction = 0.4;   // rear sideFrictionStiffness while drifting (default wheels: 2)
  public boostMultiplier = 1.5;     // speedModifier while boosting (scales force and maxSpeed)

  public override jump(_strength: number = 1): void { this.setDrift(true); }  // replaces the full-stop handbrake
  public override stopJump(): void { this.setDrift(false); }
  public setBoost(on: boolean): void { this.speedModifier = on ? this.boostMultiplier : 1; }

  private setDrift(on: boolean): void {
    const vehicle = this.getPhysicsVehicle();
    if (!vehicle) return;
    this.wheels.forEach((wheel, i) => {
      if (!wheel.isPowered) return;                  // default layout: rear wheels are powered
      vehicle.setWheelSideFrictionStiffness(i, on ? this.driftSideFriction : (wheel.sideFrictionStiffness ?? 2));
    });
  }
}
```
Return it from `createMovementNode()`. Releasing Space restores the configured rear grip. Boost from a controller key: a `DefaultPlayerController` subclass whose `handleKeyDown` / `handleKeyUp` on `ShiftLeft` call `setBoost(true/false)` and otherwise defer to `super` ([racing](references/racing.md) has it). Boost = `speedModifier` + an FOV kick of +8–12° eased over 0.2 s (`genesys-camera`) + a trail (`genesys-vfx`) + a whoosh (`genesys-audio`). Rear grip 0.3–0.5 drifts; tune in Play (verify in Play).

**Racing.** Laps, anti-shortcut gates, AI racers, reset-to-track and race position are in [racing](references/racing.md): ordered `TriggerZoneNode` gates, an `AIDriverNode` that steers the car's own `moveForward` / `moveRight`, and `resetToTrack` (teleport the Dynamic chassis and zero both velocities).

**Tuning.** Start from the engine defaults, then change one parameter at a time. Flips on turns: lower `frictionSlip` first (4–8 for a light chassis). Ice: raise `frictionSlip` / `sideFrictionStiffness` or `maxSuspensionForce`. Bounce: raise `suspensionCompression` / `suspensionRelaxation` toward 1, or stiffness. Full table: [vehicle-physics](references/vehicle-physics.md).

## Traps
- Car does not move, no wheels created → root not a Dynamic `PrimitiveNode` → Dynamic `physicsOptions` on the pawn root.
- Characters pass through the car, or the car ignores other pawns → `CharacterPawn` default `Character` profile → `DefaultCollisionProfile.Vehicle`.
- Steering feels reversed or throttle drives backward → model faces +Z → the chassis forward is -Z; rotate the visual mesh, never negate inputs.
- Car flips on every turn → `frictionSlip` too high for the mass → lower it before touching suspension.
- Wheels hover or sink → `maxSuspensionTravel` (default 5.0) far above `suspensionRestLength`, or wheel `radius` does not match the mesh → match them.
- Hidden driver still collides inside the car → driver physics left on → `setPhysicsEnabled(false, false)` on enter, re-enable on exit.
- Exit spawns the driver inside a wall → fixed side offset → check the spot with `overlapShape` (`genesys-physics`) and try the other side.
- On a GSS on-foot pawn, writing `position` on exit snaps back → the sim owns the pose → teleport through the sim (`genesys-movement`).
- Stored `IPhysicsVehicle` used after the chassis changed → it was destroyed → check `isDestroyed()` or read `getPhysicsVehicle()` each time.
- Empty cars roll away → `autoBreakWhenNotPossessed` set to 0 → keep 1 for parked cars.
- AI racers crawl with the throttle held → an `AIDriverNode` car has no controller, and cars no controller possesses add `autoBreakWhenNotPossessed` (1) to the brake every tick → create AI cars' movement node with `autoBreakWhenNotPossessed: 0`, or possess them with your own `Controller`.
- Reset car keeps spinning or shoots off → `teleportBody` clears velocities only on kinematic bodies → zero `LinearVelocity` and `AngularVelocity` after the teleport (`resetToTrack`).
- A shortcut completes a lap → laps counted on the finish line alone → count only the next gate in order ([racing](references/racing.md)).

## Done
- In Play, W drives toward screen-up from the chase camera, A/D steer screen-left/right, Space stops the car.
- The car corners at speed without flipping and stays planted over bumps; `getState().wheelsOnGround` equals the wheel count on flat ground.
- Enter puts the camera on the vehicle; exit returns the on-foot pawn beside it with its camera. Query the possessed pawn rather than judging from a picture.
- Speed is readable (HUD or audio pitch) and impacts are seen and heard (`genesys-game-feel`).
- Racing: a full lap through every gate adds one lap; driving backwards through the finish or cutting past a gate adds none. AI cars finish a lap without the player. The position readout matches the visible order. R or 2 s upside down puts the car on the road at the last gate, facing the next one, at rest.
- Drift: holding Space in a 30 m/s corner swings the tail out and the car keeps rolling; releasing restores grip. Boost: Shift raises top speed by the multiplier and the FOV widens.
- Evidence per `genesys-verification`.

## References
- [vehicle-movement-node](references/vehicle-movement-node.md) — every `VehicleMovementNode` option and default, input mapping, public API, demo wheel layout
- [vehicle-physics](references/vehicle-physics.md) — `IPhysicsVehicle`: wheels, suspension and friction defaults, tuning heuristics, forces, state, a hand-built car
- [enter-exit](references/enter-exit.md) — the engine vehicle demo's possession swap, step by step
- [racing](references/racing.md) — gates and lap counting, race position, AI racers, reset-to-track, the boost key controller
