# Vehicle Physics

Source of truth: `.engine/src/physics/IPhysicsVehicle.ts` (interface + doc-commented defaults), `.engine/src/physics/implementations/RapierVehicle.ts` (how each parameter is actually applied — a thin wrapper around Rapier's `DynamicRayCastVehicleController`). Verify defaults there before relying on this file if the engine has changed since.

This covers the `IPhysicsVehicle` tuning API itself. Pawn-level driving integration — `VehicleMovementNode`, `VehicleMode`, input-to-force wiring — is owned by the `genesys-movement` skill; read that for how a drivable car/pawn is actually assembled. This reference is for anyone hand-tuning wheels or building a custom vehicle controller directly on top of `IPhysicsVehicle`.

## Creating a vehicle

```typescript
const physicsEngine = this.getPhysicsEngine();
const vehicle: ENGINE.IPhysicsVehicle | null = physicsEngine?.createVehicle(movementNode, chassisNode) ?? null;
```

- `chassisNode` must already be a Dynamic `PrimitiveNode` with a physics body in the simulation (physics enabled, added to the world) — `createVehicle` looks up its existing body record and fails (returns `null`, logs) if none exists.
- `movementNode` is only used as an identity key for the controller (any `SceneNode` works) — it does not need to be the chassis.
- Coordinate convention (from `RapierVehicle`): chassis up axis is `+Y`, forward axis is `-Z` (matches `SceneNode.forwardDirection()`). Wheel `position` is relative to the chassis center, so front wheels get negative `z`, rear wheels positive `z`, left `-x` / right `+x` (for a chassis modeled with +X to the right).
- `vehicle.isDestroyed()` becomes true after `vehicle.destroy()`, and also automatically if the chassis `PrimitiveNode` is removed from physics or its body is rebuilt (e.g. a contributing child collider added/removed) — always check before reusing a stored reference.

## Wheels

`vehicle.addWheel(config: VehicleWheelConfig): number` returns the wheel index (or `-1` on failure) and can be called repeatedly to add more wheels; there is no `removeWheel`.

Required fields: `position` (Vector3, relative to chassis), `radius`, `width`, `canSteer`, `isPowered`, `canBrake`, `suspensionRestLength`.

Optional tuning fields and their documented defaults (`IPhysicsVehicle.ts`):

| Field | Default | Effect |
| --- | --- | --- |
| `suspensionStiffness` | 5.88 | Spring stiffness. Higher = less compression, stiffer ride. Too low: chassis bottoms out / bounces on landing. |
| `suspensionCompression` | 0.83 | Damping while compressing. Higher = less bounce on bumps. |
| `suspensionRelaxation` | 0.88 | Damping while extending. Higher = less overshoot/oscillation after a bump. |
| `maxSuspensionForce` | 6000.0 | Force cap the suspension can apply. Too low on a heavy chassis: suspension can't hold the vehicle up, it sinks/clips into the ground. |
| `maxSuspensionTravel` | 5.0 | Max compress/extend distance from rest length. The interface default (5.0) is far larger than a typical `suspensionRestLength` (often well under 1) — for a normal car, cap this close to `suspensionRestLength` or the wheel can dangle unrealistically far below the chassis before the suspension engages. |
| `sideFrictionStiffness` | 1.0 | Lateral grip multiplier. Lower = more sliding/drifting in corners; much higher than 1.0 can make cornering feel like it's on rails. |
| `frictionSlip` | 10.5 | Overall tire traction. Higher = more grip and more instantaneous braking, but also more risk of flipping (a high-grip tire "catches" instead of sliding, converting lateral speed into rollover torque). Lower values slide more but stay planted. |
| `enginePowerShare` | 1 (normalized across powered wheels) | Drive-torque split between powered wheels — see Engine force below. |
| `wheelDirection` | `(0, -1, 0)` | Suspension ray direction (down). |
| `wheelAxle` | `(-1, 0, 0)` | Wheel spin axis. |

Tuning heuristics:
- Vehicle flips on turns → `frictionSlip` and/or `sideFrictionStiffness` too high for the chassis's mass/center of gravity, or `suspensionStiffness` too low (chassis leans hard into the turn before the tire grip acts). Lower `frictionSlip` first; a lightweight arcade car often wants noticeably below the 10.5 default.
- Vehicle slides / feels like it's on ice → `frictionSlip` or `sideFrictionStiffness` too low, or `maxSuspensionForce` too low so wheels aren't pressed into the ground with enough force to generate grip.
- Suspension bounces or bottoms out over bumps → raise `suspensionCompression`/`suspensionRelaxation` toward 1.0, or raise `suspensionStiffness`.
- Wheels visually sink through the ground / hover → `maxSuspensionTravel` mismatched with `suspensionRestLength`, or wheel `radius` doesn't match the visual mesh.
- Iterate one parameter at a time — suspension and friction interact (soft suspension changes effective tire load, which changes how friction values feel).

## Forces and steering

- `setEngineForce(force)` — applies `force` split across all `isPowered` wheels, weighted by each wheel's `enginePowerShare` normalized against the total powered share. Zero-torque is set explicitly on non-powered wheels.
- `setBrakeForce(force)` — applies to all `canBrake` wheels.
- `setWheelBrake(wheelIndex, force)` — single-wheel brake (e.g. handbrake on rear only).
- `setSteering(angle)` (radians) — applies to all `canSteer` wheels equally; there is no per-wheel Ackermann steering built in.
- `setWheelFrictionSlip(wheelIndex, value)` / `setWheelSideFrictionStiffness(wheelIndex, value)` — retune an individual wheel's grip at runtime (e.g. a flat tire, a surface-dependent grip system).

## State queries

- `vehicle.getState(): VehicleState | null` — `velocity`, `angularVelocity`, `speed`, `wheelsOnGround`, `totalWheels`. Use `wheelsOnGround` to gate things like "is airborne" VFX/SFX.
- `vehicle.getWheelState(wheelIndex): VehicleWheelState | null` — per-wheel transform (`relativePosition`/`relativeQuaternion`, for driving a visual wheel mesh), plus live suspension/friction values, `contactNormal`/`contactPoint`, `isInContact`, and current `brakeForce`/`engineForce`. Read this every frame to keep wheel meshes in sync — the wheel's rotation angle is tracked internally from forward speed, not read back from Rapier (its native wheel-rotation value is unreliable per the implementation).
- `vehicle.numWheels()` — total wheel count.

## Example: four-wheel car with sane starting values

```typescript
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

@ENGINE.GameClass()
export class SimpleCarNode extends ENGINE.PrimitiveNode {
  private vehicle: ENGINE.IPhysicsVehicle | null = null;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this.setupVehicle();
    return true;
  }

  private setupVehicle(): void {
    const physicsEngine = this.getPhysicsEngine();
    if (!physicsEngine) {
      return;
    }

    // `this` is the chassis: a Dynamic PrimitiveNode (physicsOptions.motionType = Dynamic,
    // physics enabled) with its visual MeshNode attached elsewhere, e.g. in initialize().
    this.vehicle = physicsEngine.createVehicle(this, this);
    if (!this.vehicle) {
      return;
    }

    // Forward is -Z, so front wheels sit at negative z, rear wheels at positive z.
    const wheelLayout = [
      { position: new THREE.Vector3(-0.8, -0.3, -1.4), isFront: true },
      { position: new THREE.Vector3(0.8, -0.3, -1.4), isFront: true },
      { position: new THREE.Vector3(-0.8, -0.3, 1.4), isFront: false },
      { position: new THREE.Vector3(0.8, -0.3, 1.4), isFront: false },
    ];

    for (const { position, isFront } of wheelLayout) {
      this.vehicle.addWheel({
        position,
        radius: 0.35,
        width: 0.25,
        canSteer: isFront,
        isPowered: !isFront, // rear-wheel drive
        canBrake: true,
        suspensionRestLength: 0.3,
        suspensionStiffness: 24,      // stiffer than the 5.88 default - a light arcade chassis bottoms out at the default
        suspensionCompression: 0.83,
        suspensionRelaxation: 0.88,
        maxSuspensionForce: 6000,
        maxSuspensionTravel: 0.3,     // kept close to suspensionRestLength, unlike the 5.0 interface default
        sideFrictionStiffness: 1.0,
        frictionSlip: 4,              // well below the 10.5 default - the default grip flips a light chassis on hard turns
      });
    }
  }

  public setThrottle(amount: number): void {
    this.vehicle?.setEngineForce(amount * 2000);
  }

  public setSteering(angle: number): void {
    this.vehicle?.setSteering(angle);
  }

  public setBrake(amount: number): void {
    this.vehicle?.setBrakeForce(amount * 4000);
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.vehicle?.destroy();
    this.vehicle = null;
    return true;
  }
}
```

The starting values above (`suspensionStiffness: 24`, `frictionSlip: 4`) are a deliberate departure from the interface defaults for a light arcade-style chassis — treat them as a starting point, not a universal constant, and retune against your chassis mass and desired handling feel using the heuristics above.
