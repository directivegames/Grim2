# VehicleMovementNode

Source: `.engine/src/nodes/movement/VehicleMovementNode.ts`; engine demo
`.engine/demos/examples/vehicle/` (`base-vehicle.ts`, `primitive-vehicle.ts`, `mesh-vehicle.ts`).

`VehicleMovementNode` extends `BasePawnMovementNode`. Assign it as a `MovementPawn`'s `movementNode`
(or return it from `CharacterPawn.createMovementNode()`, as the demo does). Wheel, suspension, and
friction tuning goes through `IPhysicsVehicle` ([vehicle-physics](vehicle-physics.md)).

GSS does not ship a vehicle mode. Use classic `VehicleMovementNode` or write a custom
`IGSSMovementMode`.

## Chassis requirements

The pawn's root node must be a `PrimitiveNode` with `PhysicsMotionType.Dynamic`; that root is the
vehicle chassis. `physicsEngine.createVehicle(this, chassis)` is skipped if it is not a dynamic
`PrimitiveNode`. The node then sets
`chassis.setPhysicsTransformUpdateFlags({ sendPosition: false, sendRotation: false,
receivePosition: true, receiveRotation: true })` so the engine never fights the physics result.

Vehicle physics is created lazily in `tickPrePhysics`. If the chassis body is rebuilt (a contributing
collider added or removed), the stale controller is dropped and a new one is created.

## Minimal MovementPawn form

Source: .engine/src/nodes/movement/VehicleMovementNode.ts, .engine/src/entities/MovementPawn.ts
```typescript
@ENGINE.GameClass()
class CarPawn extends ENGINE.MovementPawn {
  public override initialize(options?: ENGINE.MovementPawnOptions): void {
    super.initialize({
      ...options,
      movementNode: ENGINE.VehicleMovementNode.create({ maxEnginePower: 40 }),
      physicsOptions: { enabled: true, motionType: ENGINE.PhysicsMotionType.Dynamic, ...options?.physicsOptions },
    });
  }
}
```

The demo form (a `CharacterPawn` subclass with `createCollision`, `createMovementNode`, and a
`FollowNode` camera in `setupCamera`) is in the skill's Build section.

## Options

| Option | Default | Effect |
|---|---|---|
| `maxEnginePower` | 35 | Force applied to powered wheels at full throttle |
| `maxSteeringAngle` | π/6 (30°) | Wheel lock in radians |
| `maxBrakeForce` | 1 | Brake force at full brake input |
| `maxSpeed` | 0 | Top speed in m/s (0 = unlimited); the engine tapers and velocity is clamped |
| `engineResponseRate` | 8 | How fast engine force follows input |
| `steeringResponseRate` | 12 | How fast steering follows input |
| `brakeResponseRate` | 15 | How fast brake force follows input |
| `wheels` | 4 wheels (below) | `VehicleWheelConfig[]` |
| `createWheelMeshes` | true | Builds cylinder wheel meshes automatically |
| `wheelMaterialColor` | `0x333333` | Color of auto wheel meshes |
| `autoBreakWhenNotPossessed` | 1 | Normalized brake when no controller possesses the pawn |
| `autoStopBreak` | 0.5 | Normalized brake when the player gives no input |
| `steeringSpeedReduction` | 0 | Less steering at speed; ~1 moderate, ~2 strong |
| `steeringSpeedHalfPoint` | 15 | Speed (m/s) that scales the reduction |
| `steeringSpeedReductionMinSpeed` | 0 | Full lock below this speed |
| `steeringResponseReductionMinSpeed` | 12 | Steering input rate stays snappy below this speed |
| `minSteeringSpeed` | 0 | No wheel steering below this speed (0 = always steer) |

`speedModifier` (from `BasePawnMovementNode`) scales engine and brake force, which makes a boost.

Default wheels: track width 2.6, wheelbase 3.0, height 0, radius 0.5, width 0.4,
`suspensionRestLength` 0.6, `suspensionStiffness` 20, `suspensionCompression` 0.83,
`suspensionRelaxation` 0.88, `maxSuspensionForce` 6000, `maxSuspensionTravel` 5.0,
`sideFrictionStiffness` 2, `frictionSlip` 10.5. Front wheels (negative z) steer and brake; rear wheels
(positive z) are powered and brake. The demo's `PrimitiveVehicle` uses the same layout with
`frictionSlip` 8.

## Input mapping

`forwardInput` and `rightInput` drive throttle and steering (forward is -Z, so the node negates them
internally). `jump()` / `stopJump()` set and clear `brakeInput`, so `MovementPawn.jump()` is the
handbrake and a `DefaultPlayerController` jump key brakes with no extra wiring.

Possession of the pawn root (`getRoot()?.getController()`, player or AI controller) gates the auto-brake:
`autoStopBreak` when possessed with no input, `autoBreakWhenNotPossessed` whenever no controller possesses it,
even with input. The node itself is not a pawn, so its own `getController()` is always null.

## Public API

| Member | Use |
|---|---|
| `getPhysicsVehicle()` | The `IPhysicsVehicle` (null until created); speed via `getState()` |
| `getCurrentSteeringAngle()` | Current smoothed steering for a steering-wheel visual or camera lean |
| `getInputState()` | `VehicleMovementInputState` including `brakeInput` (brake lights in the demo) |
| `flipVehicle(forceFlip = false)` | Rights the car when upside down or on its side; `true` forces it |
| `onWheelUpdated` | Delegate `(node, wheelIndex, wheelState)` every update for custom wheel visuals, dust, skid marks |

## Which to use

A standalone car uses classic `VehicleMovementNode`. A GSS pawn that must itself drive needs a custom
mode. Do not put a predicted GSS character against a classic vehicle it collides with or boards unless
the vehicle is `IRewindable` and re-simulated; `VehicleMovementNode` is not (see `genesys-movement`).
