# Vehicle Movement

Covers `VehicleMovementNode` (classic) and `VehicleMode` (Mover) at the pawn/movement-node
integration level only — which class to extend or register, and how the pawn is wired up.
Wheel/suspension/friction tuning on the underlying `IPhysicsVehicle` (spring stiffness, friction
slip, suspension travel, etc.) is owned by the `genesys-physics` skill — read that for
`VehicleWheelConfig` field-by-field tuning; it is not repeated here.

Both systems require the same physics precondition: the pawn's root node must be a
`PrimitiveNode` with `PhysicsMotionType.Dynamic` — that root is the vehicle chassis, and the
vehicle physics call (`physicsEngine.createVehicle(owner, chassis)`) is skipped entirely if it
is not a dynamic `PrimitiveNode`. Once created, the chassis is driven entirely by Rapier's
ray-cast vehicle controller; both implementations set
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

Axis mapping, verified from source: `forwardInput`/`rightInput` (the same `PawnInput` fields
every `BasePawnMovementNode` exposes) drive throttle/steering, and `jump()`/`stopJump()` are
overridden to set/clear `brakeInput` — meaning `MovementPawn.jump()` becomes the handbrake for
a vehicle pawn for free, since `MovementPawn.jump(strength)` calls
`this.movementNode?.jump(strength)` regardless of node type. A `DefaultPlayerController`'s jump
key press therefore triggers the handbrake with no extra wiring, as long as
`movementNode` is a `VehicleMovementNode`.

`isPlayerControlled()` (via `getRoot()?.isPlayerControlled()`) gates the idle/no-controller
auto-brake behavior (`autoStopBreak` vs `autoBreakWhenNotPossessed`) — note the node itself is
never player-controlled (`this.isPlayerControlled()` on the node is always false; it checks the
owning actor).

`flipVehicle(forceFlip?)`, `getPhysicsVehicle()`, `getCurrentSteeringAngle()`, and the
`onWheelUpdated` delegate are all public and available for camera rigs, HUD (speedometer), or
recovery logic.

## Mover: VehicleMode

`VehicleMode` (`.engine/src/nodes/movement/mover/modes/VehicleMode.ts`) is a `MoverNode` mode with
the same axis convention (`moveInput.z` throttle, `moveInput.x` steering, `jumpPressed`
handbrake) and the same public surface (`getPhysicsVehicle()`, `getCurrentSteeringAngle()`,
`flipVehicle(mover, forceFlip?)`, `onWheelUpdated` delegate) as `VehicleMovementNode`. Register
it like any other mode:

```typescript
const mover = ENGINE.MoverNode.create();
mover.addMovementMode('driving', new ENGINE.VehicleMode({ maxEnginePower: 40 }));
mover.startingModeName = 'driving';
pawnWithDynamicChassisRoot.add(mover);
```

Its motion is driven entirely by Rapier forces applied in `simulationTick` — `generateMove`
always returns a zero velocity (`mixMode: Override`); the pawn's `MovementSyncState` only
mirrors the resulting physics transform after the fact. `onDeactivate` calls
`destroyVehiclePhysics()`, so switching away from `'driving'` tears down the `IPhysicsVehicle`
and wheel meshes — switching back in re-creates them via `onActivate`'s lazy
`ensureVehiclePhysics`.

No built-in `IMovementInputProducer` targets `VehicleMode`'s axis layout —
`MoverPlayerController` is Walking/Falling-only (see
[custom-modes-and-controllers](custom-modes-and-controllers.md)). A vehicle pawn on the Mover
stack needs its own controller (or input producer) that writes `moveInput.z`/`moveInput.x`/
`jumpPressed` in the vehicle axis convention shown above.

## Which to use

Follow the general [Classic vs Mover](../SKILL.md#classic-vs-mover-which-one-to-use) guidance:
`VehicleMode` only pays off if the vehicle needs to switch into/out of another Mover mode at
runtime (e.g. a pawn that walks on foot and can also enter/exit a drivable vehicle body sharing
one `MoverNode`) or needs `LayeredMove`/`MovementModifier` stacking. A standalone car with no
mode-switching or multiplayer prediction requirement is simplest as classic
`VehicleMovementNode`, which also gets the built-in networked prediction/reconciliation.
Confirm whether `VehicleMode` has an equivalent before choosing it for a networked game.
