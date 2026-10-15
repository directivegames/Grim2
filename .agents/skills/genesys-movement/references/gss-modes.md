# GSS modes

GSS ships grounded, airborne, and stationary modes plus a dash example.
`GSSCharacterPawn` registers walking, falling, and dash by default; `GSSIdleMode` is opt-in.

## GSSWalkingMode

Grounded locomotion. It flattens movement input to XZ, handles `input.Jump`, and maintains the
`gameplay.Grounded` tag. Pair it with `GSSFallingMode`; `fallingModeName` defaults to
`'falling'`. Its own registration id defaults to `'walking'` and is overridable through the `id`
option.

## GSSFallingMode

Airborne locomotion with gravity and configurable mid-air jumps. It transitions to walking when
ground contact returns and maintains the `gameplay.Falling` tag. `walkingModeName` defaults to
`'walking'`, and its own registration id defaults to `'falling'`.

## GSSIdleMode

Stationary locomotion for actors that act but do not drive themselves — turrets, props, spawners.
It proposes no movement of its own and declares no transitions; its id defaults to `'idle'`.

`applyEffectMoves` (default `true`) decides whether `IGSSEffect.proposeMove` may displace the node, so
knockback and launches still land on an otherwise-immobile actor. Set it to `false` to pin the
actor outright. Displacement integrates straight into position with no character controller and no
sweep, so it passes through geometry; use a character mode when effect-driven movement has to
collide. Rotation is never written, leaving the target on its authored orientation — aim a turret
by rotating a child node.

The target still follows the simulation every tick, so an idle actor cannot be repositioned by
writing its transform; displace it with an effect instead.

Prefer this over registering no modes at all, which drops effect-proposed movement silently.

## GSSDashAbility and GSSDashEffect

The dash example activates from `input.Dash`. `GSSDashEffect` proposes a temporary horizontal
override (`mixMode` Override, `mixY` Ignore) while `gameplay.StatusDashing` is active.

## Other locomotion

Classic movement nodes cover flying, aerial, airplane, top-down, vehicle, directional, NPC,
path, and tween movement. If a pawn needs one of those behaviours inside GSS, implement a
custom `IGSSMovementMode`; do not use the unsupported Mover stack. A classic node on a
different pawn is fine until it must collide or trace against a GSS pawn — classic
nodes are not `IRewindable`; see [gss-mechanics](gss-mechanics.md).
