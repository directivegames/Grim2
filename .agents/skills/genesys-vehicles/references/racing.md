# Racing: gates, laps, AI racers, reset, position

Source: `.engine/src/nodes/gameplay/TriggerZoneNode.ts`, `.engine/src/nodes/movement/VehicleMovementNode.ts`, `.engine/src/entities/MovementPawn.ts` (`moveForward`, `moveRight`), `.engine/src/physics/PhysicsEngine.ts` (`teleportBody`, `PhysicsVectorParam`). The engine has no race, lap or checkpoint class; these are composed on top of it. All code here is composed — typechecked against 18.1.0-alpha.317. Behaviour is unverified until Play (verify in Play).

## Decide

| Item | Default |
|---|---|
| Laps | 3 (sprint: 1 lap on a point-to-point track) |
| Gates | One every 40–80 m and at every corner apex, gate 0 = start/finish. Cars spawn 5–10 m past gate 0, facing gate 1. |
| Gate size | Road width + 2 m wide, 4 m tall, 3 m deep (a 40 m/s car moves ~0.7 m per 60 Hz frame) |
| Opponents | 5 AI cars, `skill` 0.92–1.05 spread across the grid; rubber band ±5 % by rank |
| Racing line | Waypoints every 10–20 m along the centre line (or a `THREE.CatmullRomCurve3` sampled with `getSpacedPoints`) |
| Reset | R key, or automatically after 2 s upside down / no wheels on the ground, or below a kill height; at the last passed gate, facing the next |
| Position | Recomputed every 0.25 s for the HUD (`genesys-ui`), not every frame |
| Countdown, result, retry | GameMode state machine (`genesys-game-boot`); retry resets every car to its grid slot with `resetToTrack` |

Place gates with MCP when the track is authored in the editor (`TriggerZoneNode`, `filter` = `PawnsOnly`) and look them up by name in order (`Gate_00`, `Gate_01`, …), or build them from the track's points in code with `createGate`. `TriggerZoneNode` logs every enter and exit to the console; expect that noise.

## Gates, laps, position

A car advances only through its **next** gate. A shortcut that skips a gate, or a reverse lap through the finish, earns nothing.

Source: Composed — typechecked against 18.1.0-alpha.317 (TriggerZoneNode.ts, MovementPawn.ts, VehicleMovementNode.ts, PhysicsEngine.ts)
```ts
export class RaceTracker {
  public readonly onLap = new ENGINE.Delegate<[ENGINE.SceneNode, number]>();   // car, laps done
  public readonly onFinish = new ENGINE.Delegate<[ENGINE.SceneNode]>();
  private readonly passed = new Map<ENGINE.SceneNode, number>();              // gates passed, ever

  constructor(private readonly gates: ENGINE.TriggerZoneNode[], private readonly laps = 3) {
    gates.forEach((gate, i) => gate.onActorEntered.add((car) => this.enter(car, i)));
  }

  public addRacer(car: ENGINE.SceneNode): void { this.passed.set(car, 0); }
  public lapsDone(car: ENGINE.SceneNode): number { return Math.floor((this.passed.get(car) ?? 0) / this.gates.length); }
  public nextGate(car: ENGINE.SceneNode): ENGINE.TriggerZoneNode { return this.gates[((this.passed.get(car) ?? 0) + 1) % this.gates.length]; }
  public lastGate(car: ENGINE.SceneNode): ENGINE.TriggerZoneNode { return this.gates[(this.passed.get(car) ?? 0) % this.gates.length]; }

  /** 1st place first: more gates passed wins, ties go to whoever is closer to their next gate. */
  public ranking(): ENGINE.SceneNode[] {
    const score = (car: ENGINE.SceneNode): number => (this.passed.get(car) ?? 0) * 1e6
      - car.getWorldPosition(new THREE.Vector3()).distanceTo(this.nextGate(car).getWorldPosition(new THREE.Vector3()));
    return [...this.passed.keys()].sort((a, b) => score(b) - score(a));
  }

  private enter(car: ENGINE.SceneNode, gateIndex: number): void {
    const done = this.passed.get(car);
    if (done === undefined || gateIndex !== (done + 1) % this.gates.length) return;  // wrong gate
    this.passed.set(car, done + 1);
    if (gateIndex !== 0) return;
    const laps = this.lapsDone(car);
    this.onLap.invoke(car, laps);
    if (laps >= this.laps) this.onFinish.invoke(car);
  }
}
```

Source: Composed — typechecked against 18.1.0-alpha.317 (TriggerZoneNode.ts, MovementPawn.ts, VehicleMovementNode.ts, PhysicsEngine.ts)
```ts
/** One gate: a pawns-only box across the road. */
export function createGate(world: ENGINE.World, position: THREE.Vector3, yaw: number, roadWidth: number): ENGINE.TriggerZoneNode {
  const gate = ENGINE.TriggerZoneNode.create({
    position, rotation: new THREE.Euler(0, yaw, 0),
    scale: new THREE.Vector3(roadWidth + 2, 4, 3),  // 3 m deep: a 40 m/s car moves 0.7 m per frame
    filter: ENGINE.TriggerFilter.PawnsOnly,
  });
  world.add(gate);
  return gate;
}
```

The GameMode owns one `RaceTracker`, calls `addRacer` for the player car and each AI car at the start, binds `onLap` to the lap HUD and a sound, and `onFinish` for the player to the result screen (finishing order = order of `onFinish` calls). The trigger reports the car's root, so the car pawn must be the root (it is, as a pawn). Gates need a `Vehicle`-profile chassis to overlap a `Trigger` sensor; confirm the first lap counts in Play.

## AI racers

An `AIDriverNode` under each AI car steers through the car's own input, exactly like a player's keys, so the same `VehicleMovementNode` handles it.

Source: Composed — typechecked against 18.1.0-alpha.317 (TriggerZoneNode.ts, MovementPawn.ts, VehicleMovementNode.ts, PhysicsEngine.ts)
```ts
@ENGINE.GameClass()
export class AIDriverNode extends ENGINE.SceneNode {
  public waypoints: THREE.Vector3[] = [];   // racing line, 10–20 m apart, in driving order
  public skill = 1;                         // speedModifier; 0.9–1.1 per rank = rubber band
  private index = 0;

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    const car = this.getRoot();
    if (!(car instanceof ENGINE.MovementPawn) || this.waypoints.length === 0) return;
    const pos = car.getWorldPosition(new THREE.Vector3());
    if (pos.distanceTo(this.waypoints[this.index]) < 8) this.index = (this.index + 1) % this.waypoints.length;

    const to = this.waypoints[this.index].clone().sub(pos).setY(0).normalize();
    const fwd = car.forwardDirection().setY(0).normalize();     // −Z, world space
    const right = car.rightDirection().setY(0).normalize();
    const steer = THREE.MathUtils.clamp(Math.atan2(to.dot(right), to.dot(fwd)) * 2, -1, 1);
    car.moveRight(steer);                                        // +1 = steer right, like D
    car.moveForward(1 - 0.5 * Math.abs(steer));                 // lift in hard corners
    if (car.movementNode) car.movementNode.speedModifier = this.skill;
  }
}
```

- An `AIDriverNode` car is not possessed, so `VehicleMovementNode` adds `autoBreakWhenNotPossessed` (default 1) to its brake every tick. Create its movement node with `autoBreakWhenNotPossessed: 0`. A car possessed by any controller, AI or player, does not get this brake.
- Set `index` to the waypoint nearest the grid slot at the start and after a reset.
- Rubber band: every 0.25 s, from `ranking()`, set `skill` 1.05 for AI cars behind the player and 0.95 for those ahead. Keep the spread small; a visible catch-up reads as cheating.
- AI cars use `ArcadeVehicleMovementNode` too if they should drift; they never press it, so grip stays normal.

## Reset to track

`teleportBody` moves the Dynamic chassis but clears velocities only on kinematic bodies, so zero both velocities yourself (the engine's `flipVehicle` does the same after writing the world transform).

Source: Composed — typechecked against 18.1.0-alpha.317 (TriggerZoneNode.ts, MovementPawn.ts, VehicleMovementNode.ts, PhysicsEngine.ts)
```ts
/** Put a car back on the road at `position`, facing `lookAt`, with no leftover spin. */
export function resetToTrack(car: ENGINE.Pawn, position: THREE.Vector3, lookAt: THREE.Vector3): void {
  const spot = position.clone().setY(position.y + 1);           // drop from 1 m
  const yaw = Math.atan2(-(lookAt.x - spot.x), -(lookAt.z - spot.z));  // forward is −Z
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
  car.setWorldPosition(spot);
  car.setWorldQuaternion(rotation);
  car.getPhysicsEngine()?.teleportBody(car, spot, rotation);    // Dynamic: velocities are NOT cleared
  car.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
  car.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
}
```

Call it with `tracker.lastGate(car)` and `tracker.nextGate(car)` world positions. Auto-reset: in a tick, count time while `getPhysicsVehicle()?.getState()?.wheelsOnGround === 0` or the chassis up vector's `y` < 0.3; reset after 2 s. A small tilt (up `y` 0.3–0.5) is `flipVehicle()`'s job instead. Spread AI cars sideways 3 m when two reset at the same gate.

## Boost key

Source: Composed — typechecked against 18.1.0-alpha.317 (TriggerZoneNode.ts, MovementPawn.ts, VehicleMovementNode.ts, PhysicsEngine.ts)
```ts
@ENGINE.GameClass()
export class RacerController extends ENGINE.DefaultPlayerController {
  private boost(on: boolean): boolean {
    const pawn = this.getPawn();
    const mover = pawn instanceof ENGINE.MovementPawn ? pawn.movementNode : null;
    if (!(mover instanceof ArcadeVehicleMovementNode)) return false;
    mover.setBoost(on);                              // + FOV kick and trail: genesys-camera, genesys-vfx
    return true;
  }
  public override handleKeyDown(e: KeyboardEvent): boolean {
    return (e.code === 'ShiftLeft' && this.boost(true)) || super.handleKeyDown(e);
  }
  public override handleKeyUp(e: KeyboardEvent): boolean {
    return (e.code === 'ShiftLeft' && this.boost(false)) || super.handleKeyUp(e);
  }
}
```

`ArcadeVehicleMovementNode` is the drift + boost node in SKILL.md. A boost that drains a meter: track the meter in the controller, refill 1 unit/s, drain 2 units/s while held, and `setBoost(false)` at empty. Touch: a hold button (`genesys-touch-controls`).

## Done

- Lap HUD reads 1/3 → 3/3 on clean laps; skipping a gate or reversing through the finish does not change it.
- Each AI car completes 3 laps unaided with no reset more than once per lap.
- `ranking()` order matches the visible order when cars are 10+ m apart.
- R puts the car upright on the road at the last gate, at rest, facing the next gate.
