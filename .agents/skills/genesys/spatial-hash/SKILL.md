# spatial-hash

A flat-grid spatial hash that replaces O(n) linear scans with O(1) cell lookups when querying nearby actors. Use it whenever you need to find actors within a radius many times per frame — hit detection, AI separation, aggro checks, area-of-effect queries.

---

## How it works

The world is divided into a uniform grid of square cells. Each actor is registered into exactly one cell based on its XZ position. A radius query checks only the cells that overlap the search circle (3×3 cells at most for a radius ≤ cell size, 5×5 for larger radii). Cell keys are packed into a single integer to avoid string allocation.

Cell membership is not updated automatically. Call `update(actor)` in your actor's tick at whatever frequency suits your game — typically every 0.3–0.5 seconds for slowly-moving actors, every frame for fast projectiles.

---

## 1. Instantiate

Copy `SpatialHash.ts` from this skill's assets. Create one instance per actor category. Export it as a module-level singleton:

```ts
import { SpatialHash } from './SpatialHash.js';
export const enemySpatialHash = new SpatialHash({ cellSize: 4 });
```

Use separate instances for different entity types (enemies, projectiles, pickups). Mixing unrelated types increases query overhead.

---

## 2. Register in beginPlay

```ts
protected override doBeginPlay(): void {
  super.doBeginPlay();
  enemySpatialHash.register(this);
}
```

---

## 3. Update position during tick

Do not update every frame unless the actor moves fast. A throttled update avoids unnecessary map operations:

```ts
private _spatialUpdateTimer = 0;
private static readonly SPATIAL_UPDATE_INTERVAL = 0.4; // seconds

public override tickPrePhysics(dt: number): void {
  super.tickPrePhysics(dt);
  this._spatialUpdateTimer += dt;
  if (this._spatialUpdateTimer >= EnemyActor.SPATIAL_UPDATE_INTERVAL) {
    this._spatialUpdateTimer = 0;
    enemySpatialHash.update(this);
  }
}
```

For hit detection actors that move every frame (projectiles), call `update` every tick.

---

## 4. Unregister in endPlay

```ts
protected override doEndPlay(): void {
  enemySpatialHash.unregister(this);
  super.doEndPlay();
}
```

Failing to unregister leaves dead actors in the grid. They will appear in query results and cause null-reference errors.

---

## 5. Query nearby actors

```ts
const nearby = enemySpatialHash.query(centerPos, radius);
for (const actor of nearby) {
  // actor is within the radius
}
```

The returned array is a reused scratch array — do not store it, iterate it immediately. Copy to a new array if you need to keep results beyond the current frame:

```ts
const snapshot = [...enemySpatialHash.query(centerPos, radius)];
```

---

## 6. Clear on level reset

```ts
enemySpatialHash.clear();
```

Call this before loading a new scene or when resetting the mission world.

---

## Choosing cell size

Set `cellSize` to roughly 4× the typical query radius. A radius of 1 unit (melee hit) works well with `cellSize = 4`. A radius of 8 units (AoE) works better with `cellSize = 10–12`.

Too-small cells increase the number of cells checked per query. Too-large cells put many actors in the same cell and degrade to O(n) within that cell. See `references/cell-size-tuning.md`.

---

## Constraints

- The scratch results array is overwritten on every `query` call. Never hold a reference to the returned array across frames or across multiple queries in the same frame.
- The hash uses XZ coordinates only (Y is ignored). It is for flat-plane or isometric games. For full 3D spatial queries, extend with a Y cell dimension.
- Registration is not thread-safe. All calls must be on the main game thread.
- Do not query from inside a `register`/`unregister` callback — the grid may be mid-update.
