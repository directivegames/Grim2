# Module contracts — engine patterns

How modules talk to each other in Genesys code: events, the GameMode facade, root resolution, transforms, and ticking. Writing the contracts for a whole game (`TECH.md`, `src/contracts.ts`, work packages) is `genesys-tech-design`; this file is the engine side those contracts use.

## Events between modules: `Delegate`

`ENGINE.Delegate<[args], R>` (`.engine/src/utils/Delegate.ts`) is the engine's event primitive. The engine uses it for `PrimitiveNode.onCollideWith` / `onOverlapWith`, `GSSNode.onMovementModeChanged`, and `ChatSystem.onReplicatedMessage`.

| Method | Does |
|---|---|
| `add(cb)` | Subscribe. Adding the same function twice is ignored. |
| `remove(cb)` | Unsubscribe. Needs the same function reference that was added. |
| `clear()` | Drop every subscriber. |
| `invoke(...args)` | Call every subscriber in order; returns their results as an array. |
| `invokeWithPredicate(pred, ...args)` | Call in order until `pred(result)` is true. |

`ENGINE.SinglecastDelegate` holds one callback: `set(cb | null)`, `clear()`, `invoke(...args)` (returns the result or `undefined`). There is no `broadcast`, `emit`, or `on`.

Rules:
- The module that owns the state owns the delegate: `public readonly onX = new ENGINE.Delegate<[...]>()`. Subscribers never invoke it.
- Subscribe in `beginPlay`, unsubscribe in `endPlay` with the same function reference (an arrow-function field). A missing `remove` keeps a destroyed HUD alive after Retry and fires twice on the next run.
- Pass values, not the owner's internals: `invoke(score, delta)`, not `invoke(this)`.

Source: Composed — typechecked against 18.1.0-alpha.317
```typescript
@ENGINE.GameClass()
export class ScoreKeeper extends ENGINE.SceneNode {
  public readonly onScoreChanged = new ENGINE.Delegate<[score: number, delta: number]>();
  private score = 0;

  public addPoints(delta: number): void {
    this.score += delta;
    this.onScoreChanged.invoke(this.score, delta);
  }
}

@ENGINE.GameClass()
export class ScoreReadout extends ENGINE.SceneNode {
  private keeper: ScoreKeeper | null = null;
  // Keep one function reference so remove() finds it.
  private readonly handleScore = (score: number): void => {
    console.log(`score ${score}`);
  };

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.keeper = this.getWorld()?.getNodes(ScoreKeeper)[0] ?? null;
    this.keeper?.onScoreChanged.add(this.handleScore);
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    this.keeper?.onScoreChanged.remove(this.handleScore);
    this.keeper = null;
    return true;
  }
}
```

## The GameMode facade the UI reads

Run state (phase, score, lives, timer, wave) lives in the GameMode. It exposes a read side (getters + delegates) for the UI and a write side (a few verbs) for gameplay modules. The UI never reaches into pawns, enemies, or pickups; gameplay never touches widgets. Get the GameMode with `world.gameMode` (`GameMode | null`, `.engine/src/game/World.ts`). The screen state machine itself is owned by `genesys-game-boot`.

Source: .engine/src/game/GameMode.ts, .engine/src/game/World.ts (`gameMode`); composed — typechecked against 18.1.0-alpha.317
```typescript
export type RunPhase = 'title' | 'playing' | 'paused' | 'result';

@ENGINE.GameClass()
export class RunGameMode extends ENGINE.GameMode {
  public readonly onPhaseChanged = new ENGINE.Delegate<[phase: RunPhase]>();
  public readonly onScoreChanged = new ENGINE.Delegate<[score: number]>();
  private phase: RunPhase = 'title';
  private score = 0;

  // Read side: what the UI may read.
  public getPhase(): RunPhase { return this.phase; }
  public getScore(): number { return this.score; }

  // Write side: what gameplay modules may call.
  public addScore(points: number): void {
    if (this.phase !== 'playing') return;
    this.score += points;
    this.onScoreChanged.invoke(this.score);
  }

  public setPhase(phase: RunPhase): void {
    this.phase = phase;
    this.onPhaseChanged.invoke(phase);
  }
}

// A HUD module finds the facade through the world, never through pawns or enemies.
export function getRunMode(world: ENGINE.World): RunGameMode | null {
  return world.gameMode instanceof RunGameMode ? world.gameMode : null;
}
```

Online games: every world (server and each client) instantiates a GameMode, but run state is decided on the server and replicated (`genesys-multiplayer`).

## `isRoot`: what `getRoot()` returns

`getRoot()` walks up the parents and returns the first `SceneNode` with `isRoot` true (`.engine/src/utils/ThreeJsExtensions.ts`). Damage, pickups, triggers, and projectiles resolve what they touched through it: `Projectile.onHit`, `PickupNode`, `TriggerZoneNode`, `CharacterStatsNode`, and the weapon nodes all call `getRoot()`. A code-built gameplay object whose top node is not a root returns `null` (or the wrong ancestor), so it cannot be damaged, collected, or detected.

- Class that is always a placeable: `this.isRoot = true` in the constructor.
- One-off built-in: `.create({ isRoot: true, ... })`.
- Never set it in `initialize`, and never wrap a lone mesh in an empty `PrimitiveNode` (promote the mesh).

Source: .engine/src/nodes/SceneNode.ts (`SceneNodeOptions.isRoot`), .engine/src/utils/ThreeJsExtensions.ts (`getRoot`)
```typescript
// A code-built gameplay root: isRoot so getRoot() on any child resolves to it.
const crate = ENGINE.PrimitiveNode.create({
  isRoot: true,
  position: new THREE.Vector3(0, 0.5, 4),
  children: [ENGINE.MeshNode.create({ geometry, material })], // placeholder geometry and material
});
world.add(crate);
// A projectile hitting the mesh child now reports `crate` as the root it hit.
console.log(crate.getNode(ENGINE.MeshNode)?.getRoot() === crate); // true
```

## Local vs world transforms

| Call | Space | Notes |
|---|---|---|
| `node.position`, `rotation`, `quaternion` | Local (relative to the parent) | What MCP `setProperties` and `.create({ position })` set |
| `node.forwardDirection()` / `rightDirection()` | World: −Z / +X rotated by the world rotation | Pass `false` for the parent-space axis (`node.quaternion` only) |
| `node.getWorldPosition(v)` / `getWorldQuaternion(q)` | World | Use for aiming, spawning, distance |
| three `Object3D.getWorldDirection(v)` | World **+Z** | Pawn forward is −Z, so this points backwards |
| three `Camera.getWorldDirection(v)` | World −Z | Cameras negate it; this one is the look direction |

Pawn and model forward is −Z. A hitscan, melee box, or muzzle that is a child of a camera, boom, or rotated visual can use its own `forwardDirection()`: it is world space.

Source: .engine/src/nodes/SceneNode.ts (`forwardDirection`), node_modules/three/src/cameras/Camera.js (`getWorldDirection`)
```typescript
// World forward (−Z) of any node, including a child of a rotated pawn or camera boom.
const worldForward = node.forwardDirection();
// The same for a pawn: aim from its root, not from a visual child.
const rootForward = node.getRoot()?.forwardDirection() ?? worldForward;
```

## Pausing one node: `setTickEnabled`

`node.setTickEnabled(false)` stops `tickPrePhysics` / `tickPostPhysics` for that node only (children keep ticking); `isTickEnabled()` reads it; `setTickInterval(seconds)` throttles. `setTickEnabled(true)` only warns when the class has `canEverTick = false` (the `SceneNode` default is `true`). Hitstop built on this (attacker, victim, movement and animation nodes for 40–60 ms) is owned by `genesys-game-feel`; pausing the whole run is `genesys-game-boot`.

Source: .engine/src/nodes/SceneNode.ts (`setTickEnabled`, `setTickInterval`, `canEverTick`)
```typescript
@ENGINE.GameClass()
export class Spinner extends ENGINE.SceneNode {
  // canEverTick must be true (the SceneNode default); otherwise setTickEnabled(true) only warns.
  public freeze(frozen: boolean): void {
    this.setTickEnabled(!frozen);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this.rotation.y += deltaTime;
  }
}
```
