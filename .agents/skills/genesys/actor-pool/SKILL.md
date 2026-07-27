---
name: actor-pool
description: Use when implementing object pooling for Genesys actors that are created once and reused instead of destroyed and re-created on each spawn. Covers idle pool management, death-triggered respawn queues with configurable delay, GLTF reveal gating, and cross-mission actor reuse.
---

Copy both [assets/ActorPool.ts](assets/ActorPool.ts) and [assets/GltfReveal.ts](assets/GltfReveal.ts) into your project.

The pool manages three actor states: active (alive in world), queued (dead, waiting for respawn delay), and idle (parked off-screen, ready for immediate reuse).

## Implement the poolable contract

Every actor class used with this pool must implement the `PoolableActor` interface. See [references/poolable-contract.md](references/poolable-contract.md) for the full requirements.

```ts
import type { PoolableActor } from './ActorPool.js';

class MyEnemy extends ENGINE.Actor implements PoolableActor {
  public isPooled = false;
  public onDied: (() => void) | null = null;

  public softReset(position: THREE.Vector3): void {
    this.rootComponent.position.copy(position);
    this.setHiddenInGame(false);
    // restore health, re-enable NPC, set aggro...
  }

  protected override handleDeath(): void {
    // death VFX, animation...
    this.onDied?.(); // MUST call — notifies the pool
    // do NOT destroy pooled actors here
  }
}
```

## Create the pool

```ts
import { ActorPool } from './ActorPool.js';

const pool = new ActorPool<MyEnemy>({
  create: (world, position) => {
    const actor = MyEnemy.create({ position });
    world.addActor(actor);
    return actor;
  },
  maxActive: 30,
  respawnDelaySec: 5,    // seconds before a dead actor re-enters the ready queue
  onSpawned: (actor, pos) => {
    // optional: VFX, audio at the spawn point
  },
});
```

## Spawn actors

```ts
// In your manager's tick or wave logic:
const pos = this._getSpawnPosition(world);
if (pos) {
  pool.spawn(world, pos);
}
```

`spawn` pulls from the idle pool first. It only creates a new actor when the idle pool is empty. It does nothing if `activeCount >= maxActive`.

## Tick the respawn queue each frame

```ts
public override tickPrePhysics(deltaTime: number): void {
  // collect actors whose respawn delay has elapsed
  const ready = pool.tickAndCollectReady(deltaTime);
  for (const actor of ready) {
    const pos = this._getSpawnPosition(world);
    if (pos) {
      pool.reuse(actor, world, pos);   // re-activates at new position
    } else {
      pool.returnToIdle(actor);        // no position available, park for later
    }
  }
}
```

## Between missions

```ts
// Replay or next mission — park all actors into idle pool for reuse:
pool.reset();

// Full session end (back to main menu) — destroy everything:
pool.destroy();
```

`reset()` hides and parks all active and queued actors. The next `spawn()` call will pull from the idle pool before creating anything new. `destroy()` removes all pooled actors from the world and clears all state.

## Read pool state

```ts
pool.getActiveCount()  // currently alive
pool.getQueuedCount()  // waiting for respawn delay
pool.getIdleCount()    // parked, available immediately
```

## Pre-load models before spawning

```ts
// In your manager's doBeginPlay — prevents reveal-retry delays on first spawn:
void ENGINE.resourceManager.loadModel(ENGINE.AssetPath.fromString(MY_ENEMY_MODEL_URL));
```

## Constraints

- Do not call `actor.destroy()` inside `handleDeath` for pooled actors. The pool reuses the actor. Destroying it leaks the pool slot permanently.
- `softReset` is called inside an async reveal callback. It must be safe to call on an actor that may have been hidden for an arbitrarily long time.
- If `softReset` leaves the actor hidden (e.g. a guard condition inside it returns early), the pool detects this and re-queues the actor with `respawnRetrySec` delay rather than counting it as active.
- `onSpawned` fires after `softReset` succeeds and the actor is confirmed visible. It is safe to play world-space VFX from here.
- The pool does not manage scale. If your placed actors have non-default scale, set `actor.rootComponent.scale` in `softReset` or in the `create` factory.
