# Update Frequency

## The update call

`hash.update(actor)` checks if the actor has moved to a new cell since the last call. If it has, it removes the actor from the old cell and adds it to the new one. If it hasn't (most common case), it does nothing.

The check is a single integer comparison, so calling it every frame is safe. However, calling it every 0.3–0.5 seconds for slowly-moving actors keeps pressure off the Map operations during large waves.

## Throttle pattern

```ts
private _hashUpdateTimer = 0;
private static readonly HASH_UPDATE_INTERVAL = 0.4;

public override tickPrePhysics(dt: number): void {
  super.tickPrePhysics(dt);
  this._hashUpdateTimer += dt;
  if (this._hashUpdateTimer >= EnemyActor.HASH_UPDATE_INTERVAL) {
    this._hashUpdateTimer = 0;
    enemyHash.update(this);
  }
}
```

Stagger the timer start across actors to avoid all of them updating on the same frame:

```ts
protected override doBeginPlay(): void {
  super.doBeginPlay();
  enemyHash.register(this);
  // Spread updates across the interval to avoid frame spikes
  this._hashUpdateTimer = Math.random() * EnemyActor.HASH_UPDATE_INTERVAL;
}
```

## Fast-moving actors

For projectiles or fast-moving enemies, call `update` every frame (or several times per frame if the projectile could cross multiple cells in one tick). Skipping an update for a fast actor can leave it in the wrong cell and cause missed queries.

A projectile moving at 18 units/sec with `cellSize = 4` crosses a cell boundary roughly every 0.22 seconds. Updating every frame is safe; updating every 0.4 s would miss boundaries.

## On register

`register` snapshots the actor's position at the moment it is called. If `beginPlay` is called before the actor has been positioned (spawned at origin first, then moved), call `update` once after positioning:

```ts
this.rootComponent.position.copy(spawnPos);
enemyHash.register(this); // or update if already registered
```
