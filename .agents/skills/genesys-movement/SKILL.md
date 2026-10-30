---
name: genesys-movement
description: "Pawn locomotion (classic and GSS): walk, run, jump feel, dash, knockback, respawn, flying, swimming, twin-stick, NPC speed, abilities, tuning, controls that match the screen. Use when the user says move, walk, run, jump, floaty, slippery, double jump, coyote time, dash, sprint, knockback, launch pad, respawn, fly, plane, swim, twin-stick, or 'D moves left'. Not for pathfinding (use `genesys-navigation`), cars (use `genesys-vehicles`) or camera layout (use `genesys-camera`)."
metadata:
  tokens: 3319
---

# Movement

This skill owns how a pawn moves: which engine stack, which node or mode, its tuning numbers, and that every control moves the pawn the way it is labeled on screen. The rule: **pick an engine movement node or GSS mode; never integrate velocity and position by hand in `tick`.**

## Use another skill when
- Camera layout, FOV kick, sensitivity, invert-Y, pointer lock → `genesys-camera`
- Navmesh paths, click-to-move → `genesys-navigation`; where an NPC goes (patrol, chase, flee) → `behavior-tree`, `genesys-creatures`
- Cars, karts, entering a vehicle → `genesys-vehicles`; phone sticks and touch buttons → `genesys-touch-controls`
- Raycasts, impulses on physics props, joints → `genesys-physics`
- Pawn/controller basics, possession, `.create()`, class registration, transforms → `genesys-engine`
- Hitstop, shake, landing dust, "it feels flat" → `genesys-game-feel`
- Moving platforms, doors, lifts, kill zones, checkpoint triggers → `genesys-interactions` (the teleport itself is here)
- Fire and interact on a GSS pawn → `genesys-combat`, `genesys-interactions`
- Replication beyond GSS → `genesys-multiplayer`; module contracts → `genesys-tech-design`

## Decide

Which multiplayer system owns gameplay is decided in [gameplay systems](../genesys-multiplayer/references/gameplay-systems.md) (`genesys-multiplayer`); this section picks locomotion only.

**Stack.** Classic = one `BasePawnMovementNode` subclass for the pawn's lifetime (`CharacterPawn` builds `CharacterMovementNode`), built-in prediction. GSS (`GSSNode`) = modes switched at runtime, abilities, effects, attributes, rollback prediction (needs a `NetPredictionManager` initialized in `GameMode.onBeforeBeginPlay`); `GSSCharacterPawn` has no fire or interact. `MoverNode` was removed in engine 19 ([mover-to-gss](references/mover-to-gss.md)). Comparison: [stacks-and-tuning](references/stacks-and-tuning.md).

**Game type → default setup** (when the user did not say; controller is `DefaultPlayerController` unless noted):

| Game type | Pawn + movement | Notes |
|---|---|---|
| **Solo humanoid hero that fires or interacts** (the default) | `DefaultCharacterPawn` (classic `CharacterMovementNode`) | LMB/RT fire and E interact work with no input code |
| First-person shooter or walker | `DefaultCharacterPawn` with the FP camera | Eye height, hiding the body: `genesys-camera` |
| Online with prediction, or abilities/effects design | `GSSCharacterPawn` + `GSSPlayerController` | Walking, falling, dash built in |
| Platformer (3D) | `DefaultCharacterPawn` + `PlatformerMovementNode` | [jump-and-knockback](references/jump-and-knockback.md) |
| Side-scroller / 2.5D | `DefaultCharacterPawn` + `DirectionalCharacterMovementNode` (`LeftRight`) | Demo `side-scroller-advanced` |
| Top-down / twin-stick hero | `DefaultCharacterPawn` + `CharacterMovementNode` (`lookRightSpeed: 0`) | *Build*. Not `TopDownMovementNode` |
| RTS / map pan (no walking body) | `MovementPawn` + `TopDownMovementNode` | Camera rig: `genesys-camera` |
| Flying player (arcade plane) | `MovementPawn` + `AirplaneMovementNode` | W = nose down, Q/Z throttle: [classic-movement](references/classic-movement.md) |
| Free-fly / spectator; hovering enemy | `MovementPawn` + `SpectatorMovementNode`; `AerialMovementNode` | No gravity or collision; hover height 20 |
| Swim, wall-run, grapple, hover in GSS | Custom `IGSSMovementMode` | [custom-modes-and-controllers](references/custom-modes-and-controllers.md) |
| Ground NPC that walks paths | `NpcMovementNode` or `AIController` + `GSSCharacterPawn` | Pass `maxSpeed` ([npc-movement](references/npc-movement.md)) |
| Prop on a rail or loop | `PathMovementNode` / `TweenMovementNode` | `genesys-interactions` |
| GSS turret, spawner, prop that does not walk | `GSSIdleMode` | Never an empty mode list |

**Mixing stacks.** Classic NPCs are fine with any player stack except in an online game with prediction: classic pawns are not rewindable, so dashes, knockback and hits against them mis-predict ([stacks-and-tuning](references/stacks-and-tuning.md#mixing-stacks)).

**Tuning** (change the node or the registered mode, never subclass `GSSNode`; full table in [stacks-and-tuning](references/stacks-and-tuning.md#tuning-defaults)):
- Walk speed 5 (5–7 action, 3–4 horror); on GSS set the `MoveSpeed` attribute, which overrides a mode's `maxSpeed`. `decelerationLambda` 10 slides like ice; 15–25 reads crisp. `maxMidAirJumps: 1` = double jump.
- **Jump.** Default `jumpSpeed` 12 gives a 1.5 m apex and 0.49 s airtime. Pick the apex, then `jumpSpeed = √(98.1 × apex)`: 1 m → 9.9, 1.5 m → 12.1, 2 m → 14.0, 3 m → 17.2 ([jump table](references/stacks-and-tuning.md#jump-table)).

## Build

**Default hero (classic).** Subclass only to tune; the controller already maps WASD/arrows, mouse look, Space, LMB, RMB, R, E, gamepad and sticks.

Source: .engine/src/entities/DefaultCharacterPawn.ts, .engine/src/entities/CharacterPawn.ts (`createMovementNode`) (composed — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class Player extends ENGINE.DefaultCharacterPawn { // fire (LMB) and interact (E) work with no input code
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.CharacterMovementNode.create({
      name: 'MovementNode',
      maxSpeed: 6, decelerationLambda: 20, // crisp stop
      jumpSpeed: 14, maxMidAirJumps: 0,    // ~2 m apex (jump table)
    });
  }
}
// main(): pawn factory → Player.create(), controller → ENGINE.DefaultPlayerController.create()
```

**GSS pawn.** Subclass only to add content. Register every mode, ability, effect and cue in `createGSSNode()` so the order is identical on every peer; re-registering an id replaces it.

Source: .engine/src/gameplay-sim/entities/GSSCharacterPawn.ts
```ts
@ENGINE.GameClass()
export class Player extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode(); // walking, falling, dash, MoveSpeed = 5
    sim.addMovementMode(new ENGINE.GSSWalkingMode({ decelerationLambda: 20 })); // replaces 'walking'
    sim.addMovementMode(new ENGINE.GSSFallingMode({ maxMidAirJumps: 1 }));      // replaces 'falling'
    sim.setBaseAttribute(ENGINE.GSSTags.MoveSpeed, 8); // speed lives here, not in maxSpeed
    return sim;
  }
}
@ENGINE.GameClass()
export class PlayerController extends ENGINE.GSSPlayerController {}
```

The sim owns the pose: assigning a sim-driven transform does not stick. Read with `getPosition()`, `getVelocity()`, `getAttribute()`, `getActiveMovementModeId()`; write only through a mode, ability, effect or cue context ([gss-mechanics](references/gss-mechanics.md)). Respawn and teleport: `queueEvent('respawn', …)` → ability → effect → `ctx.teleport` ([gss-abilities-effects](references/gss-abilities-effects.md)).

**Top-down / twin-stick hero.** `CharacterMovementNode` with `lookRightSpeed: 0, lookUpSpeed: 0`, a camera child above (`setupCamera`), and `noPointerLock: true`. The root never yaws, so W is screen-up; `faceDirection` turns the visual child, and `getAnimationParameters` drives the run blend by speed so the body never moonwalks. The `TopDownPlayer` pawn, mouse aim and the GSS variant: [classic-movement](references/classic-movement.md#top-down-or-twin-stick-character).

**Screen direction.** A control labeled right moves or turns the pawn toward screen-right; look-right pans the view right. Derive hand-rolled steering from the camera: `screenRight = cameraForward × worldUp` (`camera.getWorldDirection(v).cross(UP)`), `screenUp = worldUp × screenRight`. Raw three.js yaw turns **left** when positive; `MathHelpers.makeRotation({ yaw })` negates it, so there positive turns right. If the mesh faces the wrong way, rotate the visual child or the camera; never invert an input axis to compensate.

**Extra actions.**
- A new button: classic, a `DefaultPlayerController` subclass calls a pawn method; GSS, register a tag (`GSSTagRegistry.register`), report it while held from a `GSSPlayerController` subclass, react in an `IGSSAbility` that applies an `IGSSEffect` ([gss-abilities-effects](references/gss-abilities-effects.md)).
- Jump feel, knockback, launch pads: [jump-and-knockback](references/jump-and-knockback.md).
- Sprint: `movementNode.speedModifier` 1.5–1.8 while held (plain `Pawn` has none); on GSS an effect scales `MoveSpeed` ([classic-movement](references/classic-movement.md#sprint)).
- Upper-body animation while the legs walk is an animation-node concern (`genesys-engine`).

Act on input in the handler that receives it. The animation follows the verb; it never gates it.

## Limitations
- Releasing Space does nothing to jump height → `stopJump()` is empty in the engine → `PlatformerMovementNode` (or GSS feel modes).
- Knockback does nothing on a classic character → `LinearVelocity` / impulses do not move a kinematic character → `setVelocities` + muted lambdas ([jump-and-knockback](references/jump-and-knockback.md)).
- Top-down GSS dash always goes screen-up (no direction option): [gss-mechanics](references/gss-mechanics.md#limitations).

## Traps
- Pawn moves left when the player presses right, or forward is screen-down → camera on the wrong side or the mesh faces backwards → move the camera or rotate the visual child; keep input axes un-inverted.
- Hand-rolled steering turns the wrong way → right vector written from intuition (`(cos yaw, 0, −sin yaw)` is right in raw three.js yaw and left in other conventions; the most-shipped direction bug) → use `cameraForward × worldUp`, then check hold-D in Play.
- Top-down hero moonwalks (S plays RunBackward, A/D strafe) → the run blend is root-relative while the visual turns → override `getAnimationParameters` ([classic-movement](references/classic-movement.md#top-down-or-twin-stick-character)).
- Pawn glides through walls → hand-rolled `position += velocity * dt` → `CharacterMovementNode` / `GSSWalkingMode` sweep a character controller.
- Respawn or `setWorldPosition` on a GSS pawn snaps back → the sim owns the pose → `queueEvent('respawn')` recipe.
- Code extends `MoverNode` / `MoverCharacterPawn` → removed in engine 19 → GSS or a classic node.
- GSS traps (`maxSpeed` ignored, launch pad, turret knockback, desync, two controllers, double-firing input): [gss-mechanics](references/gss-mechanics.md#traps). Top-down view spins, `TopDownMovementNode` hero, plane never speeds up: [classic-movement](references/classic-movement.md#traps).

## Done
- In Play, hold each of W/A/S/D (and the stick) for 0.5 s: the pawn moves screen-up/left/down/right. Look-right pans the view right and look-up tilts it up. Record each.
- Jump apex and airtime match the [jump table](references/stacks-and-tuning.md#jump-table) row you chose; jump, dash and sprint trigger on the input frame; holding does not retrigger a press ability.
- Stop distance is short; the pawn cannot pass through walls or fall through the floor.
- Respawn lands the pawn at the checkpoint and it stays there (GSS: no snap back).
- `query_node` shows the intended movement node or `GSSNode` modes (`getActiveMovementModeId()` matches the state).
- Bundle proof after any class change (`genesys-game-boot`); evidence per `genesys-verification`.

## References
- [stacks-and-tuning](references/stacks-and-tuning.md) — classic vs GSS, mixing stacks, tuning defaults, jump table
- [jump-and-knockback](references/jump-and-knockback.md) — variable jump, buffer, fast fall, coyote, knockback, launch pads (both stacks)
- [gss-abilities-effects](references/gss-abilities-effects.md) — abilities, effects, custom tags and input, events, respawn, stick-direction dash
- [gss-mechanics](references/gss-mechanics.md) — registration, private Sync, target, presentation events, tick, prediction, rewind, GSS limitations and traps
- [gss-modes](references/gss-modes.md) — Walking, Falling, Idle, Dash fields and bindings
- [custom-modes-and-controllers](references/custom-modes-and-controllers.md) — custom `IGSSMovementMode` (swimming), transitions, input producers
- [classic-movement](references/classic-movement.md) — classic nodes, input path, top-down pawn, side-scroller, sprint, flight bindings
- [npc-movement](references/npc-movement.md) — `NpcMovementNode`, `AIController` on GSS; [mover-to-gss](references/mover-to-gss.md) — Mover migration
