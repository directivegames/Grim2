# Tweened props and moving platforms

Two tween APIs share one owner, Tween.js through the engine's `world.tweenManager`, plus a curve follower for platforms. None of them is a pawn's locomotion (`genesys-movement`) or a particle effect (`genesys-vfx`).

| Need | API | Source |
| --- | --- | --- |
| Editor-authored move, rotate, or scale on a node, including auto-start | `ENGINE.TweenMovementNode` | `.engine/src/nodes/movement/TweenMovementNode.ts` |
| A tween created from gameplay code | `world.tweenManager.createTween(object).to(...).start(world.tweenManager.getCurrentTime())` | the same file's class comment and `startTween`; manager class `.engine/src/systems/TweenManager.ts` |
| A platform or lift following a route (riders need `PlatformCarryNode`, *Riding a moving platform*) | `ENGINE.PathMovementNode` | `.engine/src/nodes/movement/PathMovementNode.ts` |

Read `TweenMovementNode.ts` before adding fields. Its header comment is the supported code shape for `world.tweenManager`.

## Time units

- `TweenMovementNode.duration` is in **seconds** (option comment "Duration in seconds"; `startTween` multiplies by 1000).
- `world.tweenManager` tweens use **milliseconds**: `.to(target, 400)` is 0.4 s. The manager advances its own clock by `deltaTime × 1000` each world tick. `getCurrentTime()` returns that clock in ms.
- `DoorNode.animationDuration` is in seconds.
- `world.timerSystem.setTimeout` / `setInterval` take seconds.

The manager only advances while the world ticks, so pause stops tweens, and the world's slow-motion factor scales them.

## `TweenMovementNode`

| Property / option | Default | Notes |
|---|---|---|
| `duration` | `1` s | |
| `targetPosition` | `(0, 0, 0)` | **World** position the root moves to. Not an offset. |
| `targetRotation` | `(0, 0, 0)` | Degrees, applied as world rotation. |
| `targetScale` | `(1, 1, 1)` | World scale. |
| `easing` | `'Cubic.InOut'` | `TweenEasingType`: `Linear`, and `In` / `Out` / `InOut` for `Quadratic`, `Cubic`, `Quartic`, `Quintic`, `Sinusoidal`, `Exponential`, `Circular`, `Elastic`, `Back`, `Bounce` (for example `'Back.Out'`). |
| `loop` | `'NoLoop'` | `'Loop'` snaps back to the start pose and replays. There is no ping-pong; use `PathMovementNode` or a code tween with `yoyo` for back-and-forth. |
| `autoStart` | `false` | Start on `beginPlay`. |

Methods: `startTween()`, `stopTween()`, `resetToStart()`. The start pose is the root's world transform at `beginPlay`. It moves the node's **root** (`getRoot()`), not the node itself. Every target field is applied, so leaving `targetRotation` at 0 rotates the prop to 0, and leaving `targetScale` at 1 rescales it to 1. Set all three to the intended end pose. In the editor, selecting the node draws a debug line and arrow to the target.

Placement: add it to a placed prop with MCP (`action_node(add, className="ENGINE.TweenMovementNode", parentComponentId=<prop>)`, then `setProperties`; see `genesys-mcp-orchestrator`). Trigger it from gameplay by finding the node and calling `startTween()` (for example from a switch's `onActivated`).

## `world.tweenManager`

API: `createTween(obj)` (tracked; auto-removed on complete or stop, also with your own `.onComplete` / `.onStop`; starting it again re-tracks it), `addTween(t)`, `removeTween(t)` (untracks without stopping), `stopTween(t)`, `getCurrentTime()` (ms), `getActiveTweenCount()`, `destroy()`.

A tween from `createTween` runs on the manager's game clock. Pass `world.tweenManager.getCurrentTime()` to `.start()`, as the engine does: the project's lint rule `custom/tween-time-argument` rejects a bare `.start()`. (Without an argument `createTween` tweens still fall back to that clock, as do `.pause()` and `.resume()`.)

Source: .engine/src/nodes/movement/TweenMovementNode.ts (`startTween`), .engine/src/systems/TweenManager.ts — typechecked against 18.1.0-alpha.317
```ts
const state = { y: platform.position.y };
const tween = world.tweenManager.createTween(state)
  .to({ y: state.y + 3 }, 1500)                      // ms
  .easing((k: number) => k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
  .onUpdate(() => { platform.position.y = state.y; })
  .onComplete(() => { /* arrived */ })              // the manager still untracks the finished tween
  .start(world.tweenManager.getCurrentTime());     // the manager's game clock (lint requires the argument)
// Cancel: world.tweenManager.stopTween(tween);
```

- A tween handed to `addTween` keeps Tween.js's wall-clock default: start it with `world.tweenManager.getCurrentTime()`, or it starts late or jumps. It is also never auto-removed; call `removeTween` when it finishes.
- `@tweenjs/tween.js` is bundled inside the engine and is not a dependency of the game project, so `import * as TWEEN from '@tweenjs/tween.js'` does not resolve. Pass an easing function `(k: number) => number` as above, or use `TweenMovementNode` with an easing name.
- The header comment's example writes `TWEEN.Easing.Cubic.InOut` and `.start()` with no time. Follow `startTween` instead.

## `PathMovementNode`

| Option | Default | Notes |
|---|---|---|
| `path` | required | `THREE.Curve<THREE.Vector3>` in world space (for example `new THREE.CatmullRomCurve3(points)` or `new THREE.LineCurve3(a, b)`). |
| `speed` | `5` | Units per second along the curve. |
| `loop` | `'NoLoop'` | `'Loop'` wraps to the start; `'PingPong'` reverses at each end. |
| `autoStart` | `false` | |

Methods: `startMovement()`, `stopMovement()`, `isMoving()`, `setProgress(0..1)`.

Each tick it moves the root by the delta to the next curve point. If the root's `PrimitiveNode` is `KinematicPositionBased` or `KinematicVelocityBased`, it also sets the body's linear velocity, which pushes **dynamic** bodies resting on it. It does not carry characters: `CharacterMovementNode` (Rapier's kinematic character controller) has no moving-platform logic, so add `PlatformCarryNode` under the platform root (*Riding a moving platform*). The curve is a code object, so create it in code (a `GAME` platform class) rather than through MCP properties.

## Riding a moving platform

**Riders are not carried.** `PathMovementNode` moves the platform and sets a kinematic body's velocity, but the character controller (`CharacterMovementNode`, Rapier KCC) has no platform logic: a standing player stays put while the platform slides out from under them. Add a carry node under the platform root; it moves each grounded classic pawn whose down-ray hits this platform by the platform's frame delta (verify in Play).

Source: .engine/src/nodes/movement/PathMovementNode.ts, CharacterMovementNode.ts (`setPawnWorldTransform`, `getGrounded`)
```ts
@ENGINE.GameClass()
export class PlatformCarryNode extends ENGINE.SceneNode {
  private readonly last = new THREE.Vector3();
  private readonly now = new THREE.Vector3();
  private hasLast = false;

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    const platform = this.getRoot();
    const world = this.getWorld();
    if (!platform || !world) return;
    platform.getWorldPosition(this.now);
    const delta = this.now.clone().sub(this.last);
    this.last.copy(this.now);
    if (!this.hasLast) { this.hasLast = true; return; }
    if (delta.lengthSq() < 1e-10) return;

    for (const pawn of world.getRootNodes(ENGINE.MovementPawn)) {
      const mover = pawn.movementNode;
      if (!(mover instanceof ENGINE.CharacterMovementNode) || !mover.getGrounded()) continue;
      const centre = pawn.getWorldPosition(new THREE.Vector3());
      if (centre.distanceTo(this.now) > 10) continue;      // cheap reject before the ray
      const hit = pawn.getPhysicsEngine()?.raycast({
        origin: centre, direction: new THREE.Vector3(0, -1, 0),
        maxDistance: 1.5, ignoredRootNodes: [pawn] });   // capsule centre is 0.9 m above the feet
      if (hit?.hitNode?.getRoot() !== platform) continue;
      mover.setPawnWorldTransform({ position: pawn.position.clone().add(delta) }); // also teleports the body
    }
  }
}
```
Rotating platforms need the rotation delta too (rotate the rider's offset about the platform centre). GSS riders snap back when you write their position; carry them through the sim (`genesys-movement`).

## Physics rules

- A **static** body that moves leaves the physics world out of step. Give moving props a kinematic motion type.
- A **dynamic** body is moved by the physics engine. Tweening its transform fights the simulation. Tween a kinematic or non-physics node, or teleport through the physics API (`teleportBody`, `genesys-physics`).
- Never drive the same transform from two sources (a `TweenMovementNode` and code, or a tween and `PathMovementNode`).
- Navmesh bakes ignore kinematic and dynamic geometry, so NPCs do not path onto moving platforms (`genesys-navigation`).

## Bar

The player can see the motion start and finish. A door or lift that pops to its end pose skipped the tween, or got milliseconds where seconds were expected. Motion that matters gets a sound at start and stop (`genesys-audio`).

## Limitations

- Player stays behind while the platform moves away → the character controller does not inherit platform motion → `PlatformCarryNode` (above).

## Traps

- Tweens pile up (`getActiveTweenCount()` keeps rising) → tweens added with `addTween` are never auto-removed → `removeTween` when each finishes, or create them with `createTween`.
- A tween added with `addTween` starts late or jumps → its `.start()` with no argument used the wall clock → pass `world.tweenManager.getCurrentTime()`.
- Door or lift pops to the end pose → no tween ran, or `duration` was given in ms to `TweenMovementNode` (1000 = 16 minutes) → seconds on the node, milliseconds in `.to()`.
- Player sinks into a moving platform → the platform was tweened as a static body, or a dynamic body was tweened while simulated → kinematic root plus `PathMovementNode` (it drives kinematic velocity), or move through `teleportBody` (`genesys-physics`).
- `import * as TWEEN from '@tweenjs/tween.js'` fails to build → it is bundled inside the engine, not a game dependency → use `TweenMovementNode` easing names, or pass an easing function.
