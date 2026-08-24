# Mover Mechanics

Source: `.engine/src/nodes/movement/mover/` (`MoverNode.ts`, `types.ts`, `IMovementMode.ts`,
`IMoverTransition.ts`, `IMoverBackend.ts`, `LayeredMove.ts`, `MovementModifier.ts`,
`InputCmdKeys.ts`, `backends/StandaloneMoverBackend.ts`).

## MoverNode

`MoverNode` extends `SceneNode` and attaches to any pawn via `pawn.add(mover)` — there is no
typed `movementNode`-style slot on the pawn base class for it. Configure before `beginPlay`:

```typescript
const mover = ENGINE.MoverNode.create({ backend: new ENGINE.StandaloneMoverBackend() });
mover.addMovementMode('walking', new ENGINE.WalkingMode({ maxSpeed: 5, jumpSpeed: 6 }));
mover.addMovementMode('falling', new ENGINE.FallingMode({ maxMidAirJumps: 1 }));
mover.startingModeName = 'walking';
pawn.add(mover);
```

`backend` defaults to a shared `StandaloneMoverBackend` instance if omitted.

## Tick cycle (driven by the backend from `tickPrePhysics`)

1. Merge inputs — every registered `IMovementInputProducer.produceInput()` is called in
   registration order and fills one shared `MovementInputCmd`.
2. Apply modifiers — every registered `MovementModifier.tick()` runs, in registration order,
   and may mutate `inputCmd`/`syncState`/`auxState` in place (e.g. `SpeedModifier` multiplies
   `SPEED_SCALE_KEY` into `inputCmd.custom`).
3. `generateMove` — the active mode's phase 1: pure intent, no side effects. Produces a
   `ProposedMove` (`velocity`, optional `orientationDir`, `mixMode`).
4. Layered moves — every queued `LayeredMove.generateMove()` runs and its velocity is
   combined into the proposed move (`Override` replaces, `Additive` adds), then finished moves
   (`isFinished(elapsedSeconds)` true) are removed.
5. `simulationTick` — the active mode's phase 2: physics/collision, produces the
   authoritative `MoverTickEndData` (`syncState`, `auxState`).
6. Apply transform — `syncState.position`/`rotation` are written to the pawn root via
   `setWorldPosition`/`setWorldRotation`.
7. Check transitions — every `IMoverTransition` on the active mode's `transitions` array is
   evaluated; the first one that returns a non-null mode name wins and is queued.
8. Input-suggested mode fallback — only if no transition already claimed a target,
   `inputCmd.suggestedMode` (if set) is queued instead.
9. Mode activation is deferred to `tickPostPhysics`: the just-simulated mode's optional
   `onPostPhysics(mover, deltaTime)` runs first (still `activeModeName`), then any queued mode
   change is applied (`onDeactivate` on the old mode, `onActivate` on the new one). This ordering
   means a mode's post-physics work (e.g. `VehicleMode`'s wheel-visual update / max-speed clamp)
   always completes before it can be torn down by a switch.

## Core data types (`types.ts`)

- `MovementInputCmd` — `moveInput: Vector3` (world-space directional intent, each axis
  `[-1, 1]`), `lookDelta: Vector2`, `orientationIntent: Vector3`, `controlRotation: Euler`,
  `jumpJustPressed` (edge)/`jumpPressed` (held), optional `suggestedMode`, and `custom`
  (`MovementDataCollection`) for axes that don't fit the shape above (throttle, discrete
  zoom/dolly — see `InputCmdKeys.ts`).
- `MovementSyncState` — `position`, `rotation`, `velocity`, `modeName`, `tags: string[]`
  (queried via `mover.hasSyncTag(tag, exactMatch?)` — prefix-matches by default, e.g.
  `hasSyncTag('mover')` matches any `mover.*` tag), and `custom` for mode-specific persisted
  data (e.g. `WalkingMode`/`FallingMode` store vertical velocity and jump count here via
  `CharacterMovementShared`, not on the mode instance — the mode instance is not per-pawn state).
- `MovementAuxState` — `custom` data that persists across ticks but is never replicated
  (locally-derived data like camera pitch, or config flags).
- `ProposedMove` — `velocity`, optional `orientationDir` (undefined = mode handles rotation
  itself), `mixMode: MoveMixMode` (`Override` | `Additive`).
- `MoverTimeStep` — `simTimeMs`, `stepMs`, `isResimulating` (reserved for a future networked
  backend's replay).

## IMovementMode contract

Two-phase design: `generateMove(startData, timeStep)` is pure intent (no side effects, may be
called speculatively); `simulationTick(params)` executes physics/collision and returns the
authoritative end state. Lifecycle hooks: `onActivate(mover)` / `onDeactivate(mover)` on every
switch, optional `cleanup(mover)` (called from `MoverNode.endPlay` for every registered
mode, not just the active one — release shared resources here, idempotently), optional
`onPostPhysics(mover, deltaTime)` (runs on the mode that was just simulated, before any queued
switch is applied). `transitions: IMoverTransition[]` — return `[]` for a mode with no automatic
outgoing transitions.

## IMoverTransition contract

`evaluate(startData, mover): string | null` — return a target mode name to switch, or `null` to
stay. Evaluated at the end of every tick for the active mode's `transitions` list; the first
non-null result wins. Because `MoverNode` only falls back to `inputCmd.suggestedMode` when no
transition claims a target, a transition can itself inspect `suggestedMode` to decide whether
physics-driven detection should always win (ignore it) or input should be able to override
physics (honor it) — see the two examples in `IMoverTransition.ts`'s doc comment.

## LayeredMove

Abstract class for a temporary velocity override stacked on top of the active mode's proposed
velocity — knockback, launch impulses, root-motion clips, scripted slides. Queue with
`mover.queueLayeredMove(move)`, cancel early with `mover.removeLayeredMove(move)`. Required
members: `mixMode: MoveMixMode`, `duration` (seconds; `-1` = indefinite, removed only via
`removeLayeredMove`), `generateMove(startData, timeStep): Pick<ProposedMove, 'velocity'>`.
`isFinished(elapsedSeconds)` defaults to `duration >= 0 && elapsedSeconds >= duration` and rarely
needs overriding.

## MovementModifier

Abstract class for a persistent per-tick mutation applied before the active mode's
`generateMove` — the correct place for crouch/prone/swim stance, speed buffs/debuffs, and
gravity overrides. Add with `mover.addModifier(modifier)` (returns a `MovementModifierHandle`),
remove with `mover.removeModifier(handle)`. Single method: `tick(mover, deltaTime, inputCmd,
syncState, auxState): boolean` — return `false` to auto-remove. Stance changes must go through a
modifier, not ad-hoc `MovementInputCmd` flags (per the class's own doc comment).

The built-in `SpeedModifier(scale)` multiplies `SPEED_SCALE_KEY` in `inputCmd.custom` each tick
(stacks multiplicatively with other speed modifiers); built-in modes read it back via
`getSpeedScale(custom)` from `InputCmdKeys.ts`.

## Well-known `custom` keys (`InputCmdKeys.ts`)

- `ZOOM_AXIS_KEY` — continuous zoom/throttle axis, `[-1, 1]`. Used by `TopDownMode` (camera
  dolly) and `AirplaneMode` (throttle).
- `ZOOM_STEPS_KEY` — discrete zoom notches (mouse wheel) accumulated this tick. Consumed by
  `MoverCharacterPawn` for spring-arm length, not by any movement mode.
- `SPEED_SCALE_KEY` — multiplicative speed scale, default `1`. Written by `SpeedModifier`, read
  via `getSpeedScale(custom)`.

## Backends

`IMoverBackend.tick(mover, deltaTime)` drives the cycle. `StandaloneMoverBackend` is
synchronous with no networking — suitable for single-player and server-authoritative
AI-controlled pawns. `IMoverBackend.ts`'s doc comment also describes a networked backend
(client-side prediction, server reconciliation).

Before relying on networked movement prediction through Mover, list
`.engine/src/nodes/movement/mover/backends/` and confirm which backends actually exist.
Do not assume prediction is available from the interface doc alone.
