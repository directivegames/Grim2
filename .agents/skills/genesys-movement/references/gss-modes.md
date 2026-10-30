# GSS modes

GSS ships grounded, airborne, and stationary modes plus a dash example.
`GSSCharacterPawn` registers walking, falling, and dash by default; `GSSIdleMode` is opt-in.

Source: `.engine/src/gameplay-sim/modes/`, `.engine/src/gameplay-sim/abilities/GSSDashAbility.ts`,
`.engine/src/gameplay-sim/effects/GSSDashEffect.ts`, `.engine/src/gameplay-sim/entities/GSSCharacterPawn.ts`.

## What GSSCharacterPawn registers

Source: .engine/src/gameplay-sim/entities/GSSCharacterPawn.ts (`createGSSNode`)
```ts
const sim = GSSNode.create({ name: 'GSSNode', useNetworkPrediction: this.useNetworkPrediction,
  startingMovementModeId: 'walking', target: this });
sim.addMovementMode(new GSSWalkingMode());
sim.addMovementMode(new GSSFallingMode());
sim.addAbility(new GSSDashAbility());
sim.addEffect(new GSSDashEffect());
sim.setBaseAttribute(GSSTags.MoveSpeed, CHARACTER_MAX_SPEED); // 5
```

The pawn is a `KinematicPositionBased` capsule with the `Character` collision profile,
`useNetworkPrediction` true, and camera properties `cameraMinDistance` 1, `cameraMaxDistance` 10,
`cameraZoomSensitivity` 0.5, `cameraCollisionBuffer` 0.05, `cameraSpringStiffness` 4.5,
`cameraMinPitchDegrees` -80, `cameraMaxPitchDegrees` 80. Camera pitch each frame is
`controlRotation.x` clamped to those limits (see `genesys-camera`).

## Speed comes from the MoveSpeed attribute

Both walking and falling read `ctx.attributes.get(GSSTags.MoveSpeed) ?? this.maxSpeed`. Because the
pawn seeds `MoveSpeed`, the mode's `maxSpeed` is only a fallback. Change speed with
`sim.setBaseAttribute(GSSTags.MoveSpeed, v)` in `createGSSNode()`, or temporarily with an effect's
`modifyAttributes` (sprint, slow, haste).

## GSSWalkingMode

Grounded locomotion. It flattens movement input to XZ, handles `input.Jump`, and maintains the
`gameplay.Grounded` tag. Pair it with `GSSFallingMode`; `fallingModeName` defaults to
`'falling'`. Its own registration id defaults to `'walking'` and is overridable through the `id`
option.

| Option | Default |
|---|---|
| `maxSpeed` | `CHARACTER_MAX_SPEED` (5), fallback only |
| `accelerationLambda` | 100 |
| `decelerationLambda` | 10 |
| `jumpSpeed` | `CHARACTER_JUMP_SPEED` (12) |
| `characterControllerOptions` | shared character defaults (`simulatedGravityScale` 5) |

`generateMove` builds the desired velocity, then `mixProposedMoves` applies the effect proposals. The seed's Y is the current vertical speed, or `jumpSpeed` when Jump was just pressed. `tick` uses that resolved Y and then adds gravity. Horizontal damping uses `THREE.MathUtils.damp`: `accelerationLambda` while the desired XZ velocity is non-zero, `decelerationLambda` when it is zero, so a vertical-only launch still decelerates on the ground. A stop that slides is a low `decelerationLambda`. `tick` clamps dt to 0.2 s. The capsule never yaws; `ctx.setRotation(0, controlRotation.y, 0)` sets the pawn yaw from the controller. There is no coyote-time field on the GSS walk mode; coyote, buffer, variable height and fast fall are the feel modes in [jump-and-knockback](jump-and-knockback.md).

## GSSFallingMode

Airborne locomotion with gravity and configurable mid-air jumps. It transitions to walking when
ground contact returns and maintains the `gameplay.Falling` tag. `walkingModeName` defaults to
`'walking'`, and its own registration id defaults to `'falling'`.

`generateMove` matches walking: input becomes the horizontal seed, Y starts as the current vertical speed (or `jumpSpeed` while `jumpsUsed < maxMidAirJumps` on a new Jump), then effect proposals mix onto that seed. `tick` adds gravity to the resolved Y.

| Option | Default |
|---|---|
| `maxSpeed` | 5, fallback only |
| `accelerationLambda` | 5 |
| `decelerationLambda` | 0.5 |
| `jumpSpeed` | 12 |
| `maxMidAirJumps` | 0 (1 = double jump) |

## GSSIdleMode

Stationary locomotion for actors that act but do not drive themselves — turrets, props, spawners.
It proposes no movement of its own and declares no transitions; its id defaults to `'idle'`.

`applyEffectMoves` (default `true`) is read in `generateMove`. `true` mixes effect proposals onto a zero velocity, so knockback and launches still land on an otherwise-immobile actor. `false` returns zero and pins the actor. `tick` integrates that velocity and skips the translate when it is zero. Displacement has no character controller and no sweep, so it passes through geometry; use a character mode when effect-driven movement has to collide. Rotation is never written, leaving the target on its authored orientation — aim a turret by rotating a child node.

The target still follows the simulation every tick, so an idle actor cannot be repositioned by
writing its transform; displace it with an effect instead.

Prefer this over registering no modes at all, which drops effect-proposed movement silently.

## GSSDashAbility and GSSDashEffect

The dash example activates from `input.Dash` (`GSSPlayerController`: Shift, or gamepad left-stick
click). `GSSDashAbility` (id `ability.Dash`) has `cooldownTime` 600 ms. `GSSDashEffect` (id
`effect.Dash`, `durationMs` 180, `speed` 18) proposes a temporary horizontal override (`mixMode`
Override, `mixY` Ignore) while `gameplay.StatusDashing` is active.

The effect's direction is `ctx.getYaw()`, the pawn yaw that walking copies from `controlRotation.y`.
In third person that is the camera's facing, so it works. In top-down, side or fixed-camera games the
control yaw never changes and every dash goes the same screen direction. Re-register `ability.Dash` /
`effect.Dash` with the stick-direction pair in [gss-abilities-effects](gss-abilities-effects.md).

Another burst (a longer dash, a custom id) is a new `IGSSAbility` registered in `createGSSNode()`
after `super.createGSSNode()` (shape: [gss-abilities-effects](gss-abilities-effects.md)). Show the cooldown on a widget (`genesys-ui`); a hidden cooldown reads
as a dead button.

## GSSPlayerController bindings

Source: `.engine/src/gameplay-sim/entities/GSSPlayerController.ts`.

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move | W/A/S/D, arrows | left stick | left virtual stick |
| Look | mouse (only while pointer-locked) | right stick | right virtual stick |
| Jump (`input.Jump`) | Space | face-bottom | touch button (`genesys-touch-controls`) |
| Dash (`input.Dash`) | Shift | left-stick click | touch button (`genesys-touch-controls`) |
| Fire, interact | — | — | — (no fire/interact path; `genesys-combat`, `genesys-interactions`) |
| Zoom | mouse wheel (spring-arm steps) | — | — |

`moveInput` is built in the yaw frame of `controlRotation`, so movement is camera-relative.
`GSSPlayerController.inputSettings` (static): `lookSensitivity` 0.02, `lookYawSpeed` 0.05,
`lookPitchSpeed` 0.05, `gamepadLookSensitivity` 80, `joystickLookSensitivity` 0.6,
`joystickMovementSensitivity` 0.03, `minPitch` -π/2, `maxPitch` π/2. Mouse look per pixel =
`lookSensitivity × lookYawSpeed` (0.001 rad); a negative `lookPitchSpeed` inverts Y. Sensitivity and
invert-Y settings: `genesys-camera`.

## Other locomotion

Classic movement nodes cover flying, aerial, airplane, top-down pan, vehicle, directional, NPC,
path, and tween movement ([classic-movement](classic-movement.md)). If a pawn needs one of those
behaviours inside GSS, implement a custom `IGSSMovementMode`; Mover was removed in engine 19.
A classic node on a different pawn is fine until it must collide or trace against a GSS pawn —
classic nodes are not `IRewindable`; see [gss-mechanics](gss-mechanics.md).
