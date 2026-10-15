# Vehicle Movement

Covers `VehicleMovementNode` at the pawn/movement-node integration level — which class to extend
and how the pawn is wired up. Wheel/suspension/friction tuning on `IPhysicsVehicle` is owned by
the `genesys-physics` skill.

GSS does not ship a vehicle mode. Use classic `VehicleMovementNode` or write a custom
`IGSSMovementMode`. Do not use the unsupported Mover vehicle mode.

The pawn's root node must be a `PrimitiveNode` with `PhysicsMotionType.Dynamic` — that root is
the vehicle chassis. `physicsEngine.createVehicle(owner, chassis)` is skipped if it is not a
dynamic `PrimitiveNode`. Implementations set
`chassis.setPhysicsTransformUpdateFlags({ sendPosition: false, sendRotation: false,
receivePosition: true, receiveRotation: true })` so the engine never fights the physics result.

## Classic: VehicleMovementNode

`VehicleMovementNode` (`.engine/src/nodes/movement/VehicleMovementNode.ts`) extends
`BasePawnMovementNode`. Assign it as a `MovementPawn`'s `movementNode`:

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

Axis mapping: `forwardInput`/`rightInput` drive throttle/steering, and `jump()`/`stopJump()`
set/clear `brakeInput` — so `MovementPawn.jump()` is the handbrake. A `DefaultPlayerController`
jump key therefore triggers the handbrake with no extra wiring.

`isPlayerControlled()` (via `getRoot()?.isPlayerControlled()`) gates idle auto-brake.

`flipVehicle(forceFlip?)`, `getPhysicsVehicle()`, `getCurrentSteeringAngle()`, and the
`onWheelUpdated` delegate are public for camera rigs, HUD, or recovery.

## Which to use

A standalone car should use classic `VehicleMovementNode` (built-in prediction). A GSS
pawn that needs to enter/exit a vehicle needs a custom mode. Do not put a predicted sim
character against a classic vehicle they collide with or board unless the vehicle is
`IRewindable` and re-simulated — classic `VehicleMovementNode` is not; see
[gss-mechanics](gss-mechanics.md).
