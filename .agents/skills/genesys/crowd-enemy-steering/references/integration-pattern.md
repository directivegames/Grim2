# Integration pattern

## Building the separation vector

`computeCrowdSteerGoal` requires a pre-summed separation vector. Iterate agents within `STEER_SEPARATION_RADIUS` of the current agent and accumulate repulsion:

```ts
import { STEER_SEPARATION_RADIUS, STEER_SEPARATION_WEIGHT } from './CrowdEnemySteering.js';

private _buildSeparation(myPos: THREE.Vector3): THREE.Vector3 {
  this._separationOut.set(0, 0, 0);
  const scratch = this._steerScratch.toTarget; // reuse scratch; safe because not in use yet

  for (const other of this._nearbyAgents) {
    if (other === this) continue;
    const otherPos = other.rootComponent.position;

    scratch.copy(myPos).sub(otherPos);
    scratch.y = 0;
    const dist = scratch.length();

    if (dist < STEER_SEPARATION_RADIUS && dist > 0.001) {
      const weight = ((STEER_SEPARATION_RADIUS - dist) / STEER_SEPARATION_RADIUS) * STEER_SEPARATION_WEIGHT;
      scratch.normalize().multiplyScalar(weight);
      this._separationOut.add(scratch);
    }
  }

  return this._separationOut;
}
```

`_separationOut` and `_nearbyAgents` are pre-allocated fields on the agent. `_nearbyAgents` should be updated from a spatial query or zone list — querying the full agent list every frame is fine for small crowds (<50 agents).

## Full tick example

```ts
public override tickPrePhysics(deltaTime: number): void {
  super.tickPrePhysics(deltaTime);

  const myPos = this.rootComponent.position;
  const targetPos = this._target?.rootComponent.position;
  if (!targetPos) return;

  // Seek direction (XZ only)
  this._steerScratch.toTarget.copy(targetPos).sub(myPos);
  this._steerScratch.toTarget.y = 0;
  const distToTarget = this._steerScratch.toTarget.length();

  if (distToTarget < STEER_GOAL_STOP) return;
  this._steerScratch.toTarget.normalize();

  const separation = this._buildSeparation(myPos);

  const goal = computeCrowdSteerGoal({
    myPos,
    seekDir: this._steerScratch.toTarget,
    separation,
    tangentialSign: this._tangentialSign,
    distToTarget,
    attackRange: this.attackRange,
    scratch: this._steerScratch,
  });

  ensureSteerGoalMinDistance(myPos, goal, this._steerScratch.toTarget, this._steerScratch.goalDelta);

  // pass goal to your nav system, e.g.:
  this.movementComponent.setGoalPosition(goal.clone());
}
```

## Agent field declarations

```ts
private _steerScratch!: CrowdSteerScratch;
private _tangentialSign = 1;
private readonly _separationOut = new THREE.Vector3();
private _nearbyAgents: MyEnemyActor[] = [];
```

Initialise in `beginPlay`:

```ts
public override beginPlay(): void {
  super.beginPlay();
  this._steerScratch = createCrowdSteerScratch();
  this._tangentialSign = tangentialSignFromSeed(this._spawnIndex);
}
```
